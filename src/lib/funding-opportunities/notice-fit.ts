/**
 * "Suggested recipients" (plan § PR 2.3; redesigned in fit-UX PR 3): who in
 * the directory fits one notice, read from `fit_results` — the nightly
 * sweep's rows, the same rows the investigator page
 * (`outreach/rank-opportunities.ts`) and Outreach (`outreach/suggest.ts`)
 * read, so the three surfaces show one tier per pair.
 *
 * Reads, all bounded, none per candidate: one of the notice's Strong /
 * Moderate / Exploratory rows (the **verdict** columns — the list six plus
 * `components`, `caps`, `flags` and `why_not`, which is what `fitVerdicts`
 * needs to name the gate, the rule or the floor that binds); one of the names
 * for every ranked row; **one of the notice's own fit profile and one of the
 * shown people's** (C3 — before fit-UX PR 3 this surface loaded neither, so
 * nothing here could see `sources.complete`, the notice's eligibility rules
 * or the paradigm lists); then at most one read per evidence kind for the
 * titles the rationales cite. No per-candidate RPC, no embedding, never a
 * model call in the render path.
 *
 * Flag (`teams.fit_engine`, the acting team): under `legacy` nothing is read
 * and the surface says the per-notice ranking lives in Outreach. The
 * tag-overlap engine that used to fill this list was retired in this PR for
 * every team (DECISIONS D8); fit-v1 output stays behind the flag until a
 * team is flipped, like the other two surfaces.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FitEngine } from "@/lib/fit/flag";
import { evidenceIdsToResolve, judgedOf, leadLineOf, needsProfileFallback, rationaleView, type FitAudience, type JudgedView, type RationaleView } from "@/lib/fit/explain-view";
import { EMPTY_LOOKUP } from "@/lib/fit/inspect/evidence";
import { loadEvidenceLookup } from "@/lib/fit/inspect/load";
import { compareFitRows, loadFitVerdictsForNotice, SURFACED_TIERS, suggestionTierOf, whyLineOf, type FitResultSummaryRow, type FitResultVerdictRow } from "@/lib/fit/results";
import type { Tier } from "@/lib/fit/types";
import { personStatus, type DueField } from "@/lib/fit/verdict-fields";
import { verdictPanel, type PanelContent } from "@/lib/fit/verdict-panel";
import { loadInvestigatorProfiles, loadNoticeProfiles, noticeInputFor } from "@/lib/fit/verdict-profiles";
import { fitVerdicts, type FitVerdicts } from "@/lib/fit/verdicts";
import type { FundingListRowBucket } from "@/lib/funding-opportunities/funding-list-row-scope";
import type { SuggestionTier } from "@/lib/outreach/types";

export type NoticeFitMatch = {
  investigatorId: string;
  fullName: string;
  department: string | null;
  /** The snapshot vocabulary the pills use (Moderate → potential), as on the investigator page and in Outreach. */
  tier: SuggestionTier;
  /** The engine's own tier. */
  fitTier: Tier;
  /** S, 0–100. */
  score: number;
  /** The one-line rationale with its evidence ids read as titles (an Exploratory row: rationale, then the gap sentence). */
  why: string;
  /** PR 3.2: an Exploratory row's first line — the gap sentence. */
  lead: string | null;
  /** PR 3.2: the rationale with the evidence it cites (never empty: stage 5's items, else the paradigm evidence behind the match). */
  rationale: RationaleView;
  /** PR 3.2: stage 8's marker when the pair was judged. */
  judged: JudgedView | null;
  /** fit-UX PR 3: the row's judgment — label, three verdicts, reason, caveat, action. */
  verdicts: FitVerdicts;
  /** The line under the name: department, and the community when there is one. */
  meta: string | null;
  /** "Why, and what it rests on". */
  disclosure: PanelContent;
};

export type NoticeFitState =
  /** The team is on the legacy engine: nothing is read; the per-notice ranking lives in Outreach. */
  | "legacy"
  /** A closed notice: the sweep scores open notices only. */
  | "closed"
  /** `fit_results` is not on the database yet (the PR 2.2 migration). */
  | "unavailable"
  /** No row at any tier: the sweep has not scored this notice yet. */
  | "unscored"
  /** Scored, and every pair is Poor. */
  | "none"
  | "ok";

export type NoticeFit = {
  engine: FitEngine;
  state: NoticeFitState;
  matches: NoticeFitMatch[];
  /**
   * Every surfaced row of this notice whose person is still in the directory —
   * what the aside's "See all *n* in Outreach →" counts. `matches` is the first
   * `limit` of them, so without this the link would say "See all 3" beside the
   * three rows it is offering to leave.
   */
  total: number;
};

/** Pure. The surfaced rows of one notice (`SURFACED_TIERS`; Poor hidden), best first (tier, then score, then investigator id); `limit` cuts the list (default: every row). */
export function rankNoticeFitRows<R extends Pick<FitResultSummaryRow, "investigator_id" | "tier" | "score">>(rows: readonly R[], limit?: number): R[] {
  const ranked = rows.filter((r) => SURFACED_TIERS.includes(r.tier)).sort((a, b) => compareFitRows(a, b, (r) => r.investigator_id));
  return limit == null ? ranked : ranked.slice(0, Math.max(0, limit));
}

/** Pure. Only open (and forecasted) notices are scored; a closed notice is not read. */
export function noticeIsScorable(statusBucket: FundingListRowBucket): boolean {
  return statusBucket !== "closed";
}

/** Pure. The sentence a surface shows when there is no list. */
export function noticeFitEmptyText(fit: Pick<NoticeFit, "state">): string {
  switch (fit.state) {
    case "legacy":
      return "Your team ranks people per notice in Outreach — open the notice there for suggested recipients with tiers and evidence.";
    case "closed":
      return "This notice is closed; only open notices are scored.";
    case "unavailable":
      return "Fit results are not available yet.";
    case "unscored":
      return "This notice has not been scored yet — the nightly fit-results run scores it once its profile is built.";
    case "none":
      return "No one in your directory clears the Exploratory bar for this notice.";
    default:
      return "";
  }
}

type NameRow = { id: string; full_name: string; home_department: string | null };

/**
 * The first `limit` surfaced rows whose investigator is still in the directory
 * (archived people drop out), with names and a verdict each: every surfaced
 * row is ranked and named, so however many archived people sit ahead, the live
 * ones are found.
 */
export async function loadNoticeFit(
  db: SupabaseClient,
  opts: { opportunityId: string; statusBucket: FundingListRowBucket; fitEngine: FitEngine; limit?: number; /** D7 — the aside is a strategist surface; a PI reading a notice page is not its subject. */ audience?: FitAudience }
): Promise<NoticeFit> {
  const limit = Math.max(1, opts.limit ?? 5);
  const audience: FitAudience = opts.audience ?? "strategist";
  if (opts.fitEngine !== "fit-v1") return { engine: "legacy", state: "legacy", matches: [], total: 0 };
  const engine: FitEngine = "fit-v1";
  if (!noticeIsScorable(opts.statusBucket)) return { engine, state: "closed", matches: [], total: 0 };

  const read = await loadFitVerdictsForNotice(db, opts.opportunityId, { tiers: SURFACED_TIERS });
  if (!read.available) return { engine, state: "unavailable", matches: [], total: 0 };
  if (read.error) throw new Error(`fit_results: ${read.error}`);

  // Every surfaced row, ranked; the name read below covers every ranked person in one `in()`, and `limit` is applied after the archived ones drop out.
  const ranked = rankNoticeFitRows(read.rows);
  if (!ranked.length) {
    const { count } = await db.from("fit_results").select("investigator_id", { count: "exact", head: true }).eq("opportunity_id", opts.opportunityId);
    return { engine, state: count ? "none" : "unscored", matches: [], total: 0 };
  }

  const { data: people, error } = await db
    .from("investigators")
    .select("id, full_name, home_department")
    .in(
      "id",
      ranked.map((r) => r.investigator_id)
    )
    .is("archived_at", null);
  if (error) throw new Error(`investigators: ${error.message}`);
  const byId = new Map(((people ?? []) as NameRow[]).map((p) => [p.id, p]));

  // The first `limit` live rows, then the profiles behind them and what their rationales cite.
  const live = ranked.filter((r) => byId.has(r.investigator_id) && suggestionTierOf(r.tier));
  const taken: FitResultVerdictRow[] = live.slice(0, limit);
  // C3: the notice's own profile and the shown people's — one bounded read
  // each, over the shown rows only. The investigator read replaces the
  // conditional `profile->provenance` select it used to do: every row needs
  // the record now (approach, evidence counts), and the provenance is a field
  // of it, so this is the same number of round trips, not one more.
  const [noticeProfiles, investigatorProfiles] = await Promise.all([
    loadNoticeProfiles(db, [opts.opportunityId]),
    loadInvestigatorProfiles(db, taken.map((r) => r.investigator_id)),
  ]);
  const provenanceFor = (id: string) => investigatorProfiles.profiles.get(id)?.provenance ?? null;
  const lookup = taken.length ? await loadEvidenceLookup(db, taken.flatMap((r) => evidenceIdsToResolve(r, { profileProvenance: needsProfileFallback(r) ? provenanceFor(r.investigator_id) : null }))) : EMPTY_LOOKUP;

  const { notice, noticeComplete } = noticeInputFor(noticeProfiles, opts.opportunityId);
  const matches: NoticeFitMatch[] = [];
  for (const r of taken) {
    const person = byId.get(r.investigator_id)!;
    const tier = suggestionTierOf(r.tier)!;
    const investigator = investigatorProfiles.profiles.get(r.investigator_id) ?? null;
    const rationale = rationaleView(r, lookup, { profileProvenance: provenanceFor(r.investigator_id) });
    const verdicts = fitVerdicts({ row: r, notice, investigator, lookup, audience, noticeComplete });
    matches.push({
      investigatorId: person.id,
      fullName: person.full_name,
      department: person.home_department,
      tier,
      fitTier: r.tier,
      score: Number(r.score),
      why: whyLineOf(r, rationale.text),
      lead: leadLineOf(r, rationale.text).lead,
      rationale,
      judged: judgedOf(r),
      verdicts,
      meta: person.home_department?.trim() || null,
      disclosure: verdictPanel({ row: r, label: verdicts.label, rationale, notice }),
    });
  }
  return { engine, state: matches.length ? "ok" : "none", matches, total: live.length };
}

/**
 * The contact state of the shown people on this notice's Outreach item — one
 * bounded read, over the shown rows only, and none at all until the notice has
 * an item.
 *
 * The aside's right-hand column is captioned **Status** and reads "Not
 * contacted"; that is a claim, and the surface has to have looked before it
 * makes one (`personStatus` returns no field for a caller that has not). This
 * is the read that lets it.
 */
export async function loadContactStates(db: SupabaseClient, itemId: string | null, investigatorIds: readonly string[]): Promise<Map<string, DueField>> {
  const out = new Map<string, DueField>();
  const ids = Array.from(new Set(investigatorIds));
  if (!ids.length) return out;
  const rows = itemId ? await db.from("outreach_recipients").select("investigator_id, status").eq("item_id", itemId).is("removed_at", null).in("investigator_id", ids) : { data: [], error: null };
  if (rows.error) throw new Error(`outreach_recipients: ${rows.error.message}`);
  const byId = new Map(((rows.data ?? []) as Array<{ investigator_id: string | null; status: string | null }>).map((r) => [r.investigator_id ?? "", r.status]));
  for (const id of ids) {
    const field = personStatus({ status: byId.get(id) ?? null });
    if (field) out.set(id, field);
  }
  return out;
}
