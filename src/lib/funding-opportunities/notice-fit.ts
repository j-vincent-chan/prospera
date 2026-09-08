/**
 * "Best fit in your directory" (plan § PR 2.3): who in the directory fits one
 * notice, read from `fit_results` — the nightly sweep's rows, the same rows
 * the investigator page (`outreach/rank-opportunities.ts`) and Outreach
 * (`outreach/suggest.ts`) read, so the three surfaces show one tier per pair.
 * One read of the notice's Strong / Moderate / Exploratory rows (the list
 * columns: the summary six plus slim JSON paths for the cited items and the
 * stage-8 marker — PR 3.2), one read of the names for every ranked row, then
 * for the shown rows at most one read per evidence kind for the titles the
 * rationales cite (and one of the profiles' provenance when a row cites
 * nothing on its own): no per-candidate RPC, no embedding, never a model
 * call in the render path.
 *
 * Flag (`teams.fit_engine`, the acting team): under `legacy` nothing is read
 * and the surface says the per-notice ranking lives in Outreach. The
 * tag-overlap engine that used to fill this list was retired in this PR for
 * every team (DECISIONS D8); fit-v1 output stays behind the flag until a
 * team is flipped, like the other two surfaces.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FitEngine } from "@/lib/fit/flag";
import { evidenceIdsToResolve, judgedOf, needsProfileFallback, rationaleView, type JudgedView, type RationaleView } from "@/lib/fit/explain-view";
import { EMPTY_LOOKUP } from "@/lib/fit/inspect/evidence";
import { loadEvidenceLookup } from "@/lib/fit/inspect/load";
import { detailsBy, type PairDetail } from "@/lib/fit/pair-detail";
import { compareFitRows, loadFitDetailsForNotice, loadFitListForNotice, MISSING_TABLE, SURFACED_TIERS, suggestionTierOf, type FitResultListRow, type FitResultSummaryRow } from "@/lib/fit/results";
import { rowLine, type RowLine } from "@/lib/fit/row-line";
import type { AxisProvenance, Tier } from "@/lib/fit/types";
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
  /** PR 3.2b: the row's two sentences, joined — what matched and the binding gap. Never the engine's nine-component rationale. */
  why: string;
  /** PR 3.2b: the binding gap, one clause; null on a Strong row. */
  lead: string | null;
  /** PR 3.2b: the whole line — the two sentences and the engine's flags. */
  line: RowLine;
  /** PR 3.2: the rationale with the evidence it cites (never empty: stage 5's items, else the paradigm evidence behind the match). */
  rationale: RationaleView;
  /** PR 3.2: stage 8's marker when the pair was judged. */
  judged: JudgedView | null;
  /** PR 3.2b: "Why this suggestion" — the components, caps and provenance behind this pair. */
  detail: PairDetail | null;
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

export type NoticeFit = { engine: FitEngine; state: NoticeFitState; matches: NoticeFitMatch[] };

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

/** The first `limit` surfaced rows whose investigator is still in the directory (archived people drop out), with names: every surfaced row is ranked and named, so however many archived people sit ahead, the live ones are found. */
export async function loadNoticeFit(
  db: SupabaseClient,
  opts: { opportunityId: string; statusBucket: FundingListRowBucket; fitEngine: FitEngine; limit?: number }
): Promise<NoticeFit> {
  const limit = Math.max(1, opts.limit ?? 5);
  if (opts.fitEngine !== "fit-v1") return { engine: "legacy", state: "legacy", matches: [] };
  const engine: FitEngine = "fit-v1";
  if (!noticeIsScorable(opts.statusBucket)) return { engine, state: "closed", matches: [] };

  const read = await loadFitListForNotice(db, opts.opportunityId, { tiers: SURFACED_TIERS });
  if (!read.available) return { engine, state: "unavailable", matches: [] };
  if (read.error) throw new Error(`fit_results: ${read.error}`);

  // Every surfaced row, ranked; the name read below covers every ranked person in one `in()`, and `limit` is applied after the archived ones drop out.
  const ranked = rankNoticeFitRows(read.rows);
  if (!ranked.length) {
    const { count } = await db.from("fit_results").select("investigator_id", { count: "exact", head: true }).eq("opportunity_id", opts.opportunityId);
    return { engine, state: count ? "none" : "unscored", matches: [] };
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

  // The first `limit` live rows, then what their rationales cite.
  const taken: FitResultListRow[] = [];
  for (const r of ranked) {
    if (taken.length >= limit) break;
    if (byId.has(r.investigator_id) && suggestionTierOf(r.tier)) taken.push(r);
  }
  const provenance = await loadProvenanceFor(db, taken.filter(needsProfileFallback).map((r) => r.investigator_id));
  const lookup = taken.length ? await loadEvidenceLookup(db, taken.flatMap((r) => evidenceIdsToResolve(r, { profileProvenance: provenance.get(r.investigator_id) ?? null }))) : EMPTY_LOOKUP;

  // "Why this suggestion" (PR 3.2b): one read keyed to the pairs this card shows.
  const details = await loadFitDetailsForNotice(db, opts.opportunityId, taken.map((r) => r.investigator_id));
  if (details.error) throw new Error(`fit_results: ${details.error}`);
  const detailBy = detailsBy(details.rows, "investigator_id");

  const matches: NoticeFitMatch[] = [];
  for (const r of taken) {
    const person = byId.get(r.investigator_id)!;
    const tier = suggestionTierOf(r.tier)!;
    const rationale = rationaleView(r, lookup, { profileProvenance: provenance.get(r.investigator_id) ?? null });
    const line = rowLine(r);
    matches.push({ investigatorId: person.id, fullName: person.full_name, department: person.home_department, tier, fitTier: r.tier, score: Number(r.score), why: line.sentences.join(" "), lead: line.gap, line, rationale, judged: judgedOf(r), detail: detailBy.get(r.investigator_id) ?? null });
  }
  return { engine, state: matches.length ? "ok" : "none", matches };
}

/** The stored profiles' provenance for the people whose row cites nothing on its own (one `in()` read; empty when none need it or before PR 1.4's migration). */
async function loadProvenanceFor(db: SupabaseClient, investigatorIds: readonly string[]): Promise<Map<string, ReadonlyArray<AxisProvenance>>> {
  const out = new Map<string, ReadonlyArray<AxisProvenance>>();
  const ids = Array.from(new Set(investigatorIds));
  if (!ids.length) return out;
  const { data, error } = await db.from("investigator_fit_profiles").select("investigator_id, provenance:profile->provenance").in("investigator_id", ids);
  if (error) {
    if (MISSING_TABLE.test(error.message)) return out;
    throw new Error(`investigator_fit_profiles: ${error.message}`);
  }
  for (const r of (data ?? []) as Array<{ investigator_id: string; provenance: unknown }>) if (Array.isArray(r.provenance)) out.set(r.investigator_id, r.provenance as AxisProvenance[]);
  return out;
}
