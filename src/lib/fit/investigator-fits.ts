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
 *   5. the notice titles for every shown row: one read;
 *   6. the evidence titles the rationales cite: at most one read per item kind;
 *   7. the profile's provenance — only when some row can cite nothing without it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { evidenceIdsToResolve, groupFitRows, judgedOf, leadLineOf, needsProfileFallback, rationaleView, showsWhyNot, type FitAudience, type JudgedView, type RationaleView } from "@/lib/fit/explain-view";
import { EMPTY_LOOKUP, type EvidenceLookup } from "@/lib/fit/inspect/evidence";
import { loadEvidenceLookup } from "@/lib/fit/inspect/load";
import { loadFitListForInvestigator, loadWhyNotForInvestigator, MISSING_TABLE, suggestionTierOf, whyLineOf, type FitResultListRow } from "@/lib/fit/results";
import type { AxisProvenance, Tier } from "@/lib/fit/types";
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
  /** An Exploratory row's first line: the gap sentence. */
  lead: string | null;
  rationale: RationaleView;
  judged: JudgedView | null;
  /** The one-line form the peek and legacy-shaped callers use (rationale with titles, then the gap for Exploratory). */
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
  const base: InvestigatorFitSurface = { engine: "fit-v1", audience: opts.audience, unavailable: false, openNotices: 0, scored: false, recommended: [], exploratory: [], whyNot: [], poorTotal: 0 };

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
  if (!shown.length && !whyNot.rows.length) return { ...base, scored };

  // Titles for every shown row, one read.
  const ids = Array.from(new Set([...shown.map((r) => r.opportunity_id), ...whyNot.rows.map((r) => r.opportunity_id)]));
  const { data: notices, error: noticesError } = await db.from("funding_opportunities").select("id, title, agency").in("id", ids);
  if (noticesError) throw new Error(`funding_opportunities: ${noticesError.message}`);
  const byId = new Map(((notices ?? []) as NoticeRow[]).map((n) => [n.id, n]));

  // The profile's provenance only when a shown row cites nothing on its own.
  let provenance: ReadonlyArray<AxisProvenance> | null = null;
  if (shown.some(needsProfileFallback)) provenance = await loadProfileProvenance(db, investigatorId);

  // The evidence titles behind every shown row: at most one read per kind.
  const lookup: EvidenceLookup = shown.length ? await loadEvidenceLookup(db, shown.flatMap((r) => evidenceIdsToResolve(r, { profileProvenance: provenance })), { investigatorId }) : EMPTY_LOOKUP;

  const toRow = (r: FitResultListRow): InvestigatorFitRow | null => {
    const n = byId.get(r.opportunity_id);
    const tier = suggestionTierOf(r.tier);
    if (!n || !tier) return null;
    const rationale = rationaleView(r, lookup, { profileProvenance: provenance });
    const { lead } = leadLineOf(r, rationale.text);
    return { opportunityId: n.id, title: n.title, agency: n.agency, tier, fitTier: r.tier, score: Number(r.score), lead, rationale, judged: judgedOf(r), why: whyLineOf(r, rationale.text) };
  };
  const present = (x: InvestigatorFitRow | null): x is InvestigatorFitRow => x !== null;
  return {
    ...base,
    scored: true,
    recommended: groups.recommended.map(toRow).filter(present),
    exploratory: groups.exploratory.map(toRow).filter(present),
    whyNot: whyNot.rows.flatMap((r) => {
      const n = byId.get(r.opportunity_id);
      return n ? [{ opportunityId: n.id, title: n.title, agency: n.agency, score: Number(r.score), whyNot: r.why_not?.trim() || "Below the Exploratory floors." }] : [];
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

/** The stored profile's per-category provenance (a slim JSON-path select); null before PR 1.4's migration or without a profile. */
async function loadProfileProvenance(db: SupabaseClient, investigatorId: string): Promise<ReadonlyArray<AxisProvenance> | null> {
  const { data, error } = await db.from("investigator_fit_profiles").select("investigator_id, provenance:profile->provenance").eq("investigator_id", investigatorId).maybeSingle();
  if (error) {
    if (MISSING_TABLE.test(error.message)) return null;
    throw new Error(`investigator_fit_profiles: ${error.message}`);
  }
  const prov = (data as { provenance?: unknown } | null)?.provenance;
  return Array.isArray(prov) ? (prov as AxisProvenance[]) : null;
}
