/**
 * The investigator page's "Opportunities that fit" under `fit_engine =
 * 'fit-v1'` (plan § PR 3.2): three groups from the nightly `fit_results` —
 * Recommended (Strong, Moderate), Exploratory with the gap sentence first,
 * and "Why not?" (the Poor pairs nearest the bar with their one-line reason)
 * — every shown row with a rationale that cites at least one evidence item,
 * and stage 8's marker where the pair was judged.
 *
 * Reads, all bounded, none per candidate:
 *   1. the open profiled notices (one head count — the corpus the sweep scores);
 *   2. Recommended: Strong then Moderate, each read bounded to the group size
 *      and score-ordered, stopped once the group is full (PR 2.3's cascade —
 *      a Strong is never cut by a higher-scoring Moderate);
 *   3. Exploratory: one read (strategists only — D7);
 *   4. "Why not?": one read of the top Poor rows with their count (strategists only);
 *   5. the stored profile's small columns — what the ranking ran on, the
 *      collaborator names, and (only when some row can cite nothing without
 *      it) the per-category provenance the citation fallback needs: one read;
 *   6. the notice titles for every shown row: one read;
 *   7. the evidence titles the rationales cite: at most one read per item kind;
 *   8. "Why this suggestion" for the shown pairs — components, caps and the
 *      stage provenance the disclosure names: one read (PR 3.2b).
 *
 * What a row *says* is `row-line.ts`' job: two sentences, the binding gap
 * first below Strong. The engine's nine-component rationale is never rendered
 * in a row.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { evidenceIdsToResolve, groupFitRows, judgedOf, needsProfileFallback, rationaleView, showsWhyNot, type FitAudience, type JudgedView, type RationaleView } from "@/lib/fit/explain-view";
import { EMPTY_LOOKUP, type EvidenceLookup } from "@/lib/fit/inspect/evidence";
import { loadEvidenceLookup } from "@/lib/fit/inspect/load";
import { detailsBy, type PairDetail } from "@/lib/fit/pair-detail";
import { newestComputedAt, profileState, type ProfileState, type ProfileStateRow } from "@/lib/fit/profile-state";
import { loadFitDetailsForInvestigator, loadFitListForInvestigator, loadWhyNotForInvestigator, MISSING_TABLE, suggestionTierOf, type FitResultListRow } from "@/lib/fit/results";
import { rowLine, whyNotLine, type RowLine } from "@/lib/fit/row-line";
import type { AxisProvenance, Collaborator, Tier } from "@/lib/fit/types";
import { openNoticeFilter } from "@/lib/ingestion/reporter/exemplars";
import type { SuggestionTier } from "@/lib/outreach/types";

export type InvestigatorFitRow = {
  opportunityId: string;
  title: string;
  agency: string | null;
  /** The pill vocabulary (Moderate → potential). */
  tier: SuggestionTier;
  fitTier: Tier;
  /** S, 0–100. */
  score: number;
  /** The binding gap, one clause; null on a Strong row (the engine writes a gap only below Strong). */
  lead: string | null;
  /** The row's whole line: at most two sentences, plus the engine's flags (PR 3.2b). */
  line: RowLine;
  rationale: RationaleView;
  judged: JudgedView | null;
  /** "Why this suggestion": the components, caps and provenance behind this pair; null when the detail read found no row. */
  detail: PairDetail | null;
  /** The one-line form the peek and legacy-shaped callers use — the same two sentences, joined. */
  why: string;
};

export type WhyNotRow = { opportunityId: string; title: string; agency: string | null; score: number; whyNot: string };

export type InvestigatorFitSurface = {
  engine: "fit-v1";
  audience: FitAudience;
  /** `fit_results` is not on the database yet. */
  unavailable: boolean;
  /** Open notices with a fit profile — the corpus the sweep scores. */
  openNotices: number;
  /** The person has at least one stored row. */
  scored: boolean;
  recommended: InvestigatorFitRow[];
  exploratory: InvestigatorFitRow[];
  /** Strategists only (D7): the Poor pairs nearest the bar; empty for a PI. */
  whyNot: WhyNotRow[];
  /** Every Poor pair of the person (shown or not); 0 for a PI. */
  poorTotal: number;
  /** What the ranking ran on, when it ran, and what it could not use (PR 3.2b). */
  profile: ProfileState;
  /** `provenance.collaborators` holds investigator ids; the subject's own profile carries their names. */
  collaboratorNames: ReadonlyMap<string, string>;
};

export type InvestigatorFitOptions = {
  audience: FitAudience;
  /** Group sizes. */
  recommended?: number;
  exploratory?: number;
  whyNot?: number;
};

type NoticeRow = { id: string; title: string; agency: string | null };

/** The investigator's fit surface; `audience` decides what is read at all (D7: a PI gets Recommended only). */
export async function loadInvestigatorFitSurface(db: SupabaseClient, investigatorId: string, opts: InvestigatorFitOptions): Promise<InvestigatorFitSurface> {
  const wantRecommended = Math.max(1, opts.recommended ?? 5);
  const wantExploratory = Math.max(0, opts.exploratory ?? 5);
  const wantWhyNot = Math.max(0, opts.whyNot ?? 5);
  const strategist = showsWhyNot(opts.audience);
  const base: InvestigatorFitSurface = { engine: "fit-v1", audience: opts.audience, unavailable: false, openNotices: 0, scored: false, recommended: [], exploratory: [], whyNot: [], poorTotal: 0, profile: profileState(null, null), collaboratorNames: new Map() };

  const today = new Date().toISOString().slice(0, 10);
  const { count } = await db.from("funding_opportunities").select("id, opportunity_fit_profiles!inner(opportunity_id)", { count: "exact", head: true }).or(openNoticeFilter(today));
  base.openNotices = count ?? 0;

  // Recommended: Strong, then Moderate, each bounded, stopped once full.
  const rows: FitResultListRow[] = [];
  for (const tier of ["strong", "moderate"] as const) {
    if (rows.length >= wantRecommended) break;
    const read = await loadFitListForInvestigator(db, investigatorId, { tiers: [tier], limit: wantRecommended });
    if (!read.available) return { ...base, unavailable: true };
    if (read.error) throw new Error(`fit_results: ${read.error}`);
    rows.push(...read.rows);
  }
  // Exploratory and "Why not?": strategists only (D7).
  let exploratoryRows: FitResultListRow[] = [];
  let whyNot: Awaited<ReturnType<typeof loadWhyNotForInvestigator>> = { rows: [], available: true, error: null, total: 0 };
  if (strategist) {
    if (wantExploratory > 0) {
      const read = await loadFitListForInvestigator(db, investigatorId, { tiers: ["exploratory"], limit: wantExploratory });
      if (!read.available) return { ...base, unavailable: true };
      if (read.error) throw new Error(`fit_results: ${read.error}`);
      exploratoryRows = read.rows;
    }
    if (wantWhyNot > 0) {
      whyNot = await loadWhyNotForInvestigator(db, investigatorId, wantWhyNot);
      if (!whyNot.available) return { ...base, unavailable: true };
      if (whyNot.error) throw new Error(`fit_results: ${whyNot.error}`);
    }
  }
  const groups = groupFitRows([...rows.slice(0, wantRecommended), ...exploratoryRows], (r) => r.opportunity_id, opts.audience);
  const shown = [...groups.recommended, ...groups.exploratory];
  const scored = shown.length > 0 || whyNot.total > 0 || (!strategist && (await hasAnyRow(db, investigatorId)));

  // What the ranking ran on (PR 3.2b): one read of the stored profile's small columns — the same read that
  // answers the citation fallback, so the provenance path is only asked for when a shown row needs it.
  const stored = await loadStoredProfile(db, investigatorId, { withProvenance: shown.some(needsProfileFallback) });
  const profile = profileState(stored?.state ?? null, newestComputedAt(shown));
  const collaboratorNames = stored?.collaboratorNames ?? new Map<string, string>();
  if (!shown.length && !whyNot.rows.length) return { ...base, scored, profile, collaboratorNames };

  // Titles for every shown row, one read.
  const ids = Array.from(new Set([...shown.map((r) => r.opportunity_id), ...whyNot.rows.map((r) => r.opportunity_id)]));
  const { data: notices, error: noticesError } = await db.from("funding_opportunities").select("id, title, agency").in("id", ids);
  if (noticesError) throw new Error(`funding_opportunities: ${noticesError.message}`);
  const byId = new Map(((notices ?? []) as NoticeRow[]).map((n) => [n.id, n]));

  const provenance: ReadonlyArray<AxisProvenance> | null = stored?.provenance ?? null;

  // The evidence titles behind every shown row: at most one read per kind.
  const lookup: EvidenceLookup = shown.length ? await loadEvidenceLookup(db, shown.flatMap((r) => evidenceIdsToResolve(r, { profileProvenance: provenance })), { investigatorId }) : EMPTY_LOOKUP;

  // "Why this suggestion" (PR 3.2b): one read keyed to the shown pairs — components, caps and the stage
  // provenance the disclosure names. Never on the list path (D44), which stays the summary columns.
  const details = await loadFitDetailsForInvestigator(db, investigatorId, shown.map((r) => r.opportunity_id));
  if (details.error) throw new Error(`fit_results: ${details.error}`);
  const detailBy = detailsBy(details.rows, "opportunity_id");

  const toRow = (r: FitResultListRow): InvestigatorFitRow | null => {
    const n = byId.get(r.opportunity_id);
    const tier = suggestionTierOf(r.tier);
    if (!n || !tier) return null;
    const rationale = rationaleView(r, lookup, { profileProvenance: provenance });
    const line = rowLine(r);
    return { opportunityId: n.id, title: n.title, agency: n.agency, tier, fitTier: r.tier, score: Number(r.score), lead: line.gap, line, rationale, judged: judgedOf(r), detail: detailBy.get(r.opportunity_id) ?? null, why: line.sentences.join(" ") };
  };
  const present = (x: InvestigatorFitRow | null): x is InvestigatorFitRow => x !== null;
  return {
    ...base,
    scored: true,
    profile,
    collaboratorNames,
    recommended: groups.recommended.map(toRow).filter(present),
    exploratory: groups.exploratory.map(toRow).filter(present),
    whyNot: whyNot.rows.flatMap((r) => {
      const n = byId.get(r.opportunity_id);
      return n ? [{ opportunityId: n.id, title: n.title, agency: n.agency, score: Number(r.score), whyNot: whyNotLine(r.why_not) }] : [];
    }),
    poorTotal: whyNot.total,
  };
}

/** A PI sees no Poor count, so "scored at all" needs its own head count (one read) when nothing surfaced. */
async function hasAnyRow(db: SupabaseClient, investigatorId: string): Promise<boolean> {
  const { count, error } = await db.from("fit_results").select("opportunity_id", { count: "exact", head: true }).eq("investigator_id", investigatorId);
  if (error) {
    if (MISSING_TABLE.test(error.message)) return false;
    throw new Error(`fit_results: ${error.message}`);
  }
  return (count ?? 0) > 0;
}

type StoredProfile = { state: ProfileStateRow; provenance: ReadonlyArray<AxisProvenance> | null; collaboratorNames: ReadonlyMap<string, string> };

/**
 * One read of the stored profile: the small columns behind the profile-state
 * line, the collaborator names (`provenance.collaborators` stores ids, and
 * the profile is where the names live), and — only when a shown row can cite
 * nothing on its own — the per-category provenance the citation fallback
 * needs. Null before PR 1.4's migration or when the person has no profile.
 */
async function loadStoredProfile(db: SupabaseClient, investigatorId: string, opts: { withProvenance: boolean }): Promise<StoredProfile | null> {
  const columns = ["investigator_id", "taxonomy_version", "item_count", "pending_items", "computed_at", "confidence", "evidence_summary:profile->evidence_summary", "collaborators:profile->collaborators"];
  if (opts.withProvenance) columns.push("provenance:profile->provenance");
  const { data, error } = await db.from("investigator_fit_profiles").select(columns.join(", ")).eq("investigator_id", investigatorId).maybeSingle();
  if (error) {
    if (MISSING_TABLE.test(error.message)) return null;
    throw new Error(`investigator_fit_profiles: ${error.message}`);
  }
  if (!data) return null;
  const row = data as unknown as ProfileStateRow & { provenance?: unknown; collaborators?: unknown };
  const names = new Map<string, string>();
  if (Array.isArray(row.collaborators)) for (const c of row.collaborators as Collaborator[]) if (c?.id && c.name) names.set(c.id, c.name);
  return {
    state: { taxonomy_version: row.taxonomy_version, item_count: row.item_count, pending_items: row.pending_items, computed_at: row.computed_at, confidence: row.confidence, evidence_summary: row.evidence_summary },
    provenance: Array.isArray(row.provenance) ? (row.provenance as AxisProvenance[]) : null,
    collaboratorNames: names,
  };
}
