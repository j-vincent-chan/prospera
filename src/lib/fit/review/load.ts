/**
 * The reads behind `/team/fit-review` (plan § PR 3.3). Server-side only; the
 * view model in `queue.ts` is pure and tested, and nothing here writes — the
 * actions do (`src/app/actions/fit-review-actions.ts`).
 *
 * Every read answers `available: false` instead of throwing while a migration
 * is not applied (`fit_results`, `fit_corrections`, and this PR's
 * `fit_adjudications.reviewed_at` / `fit_corrections.rescored_at`), the
 * inspector's rule.
 *
 * The reads, counted — the page's whole cost is **7 + N**, N being the
 * distinct notices with a pending correction (capped at
 * `RESCORE_COUNT_MAX_NOTICES`):
 *
 *   1 `fit_results` rows whose `adjudication.reconciliation.review.kind` is a
 *     queued kind — sections 1 and 3 in one read (`FIT_RESULT_REVIEW_COLUMNS`,
 *     slim JSON paths, never the blob — D44).
 *   2 `fit_corrections` with `status = 'proposed'` — sections 2 and 4 in one
 *     read.
 *   3 `fit_adjudications` rows of those investigators that are *already*
 *     marked reviewed (`reviewed_at IS NOT NULL`) — the small side of the
 *     flag; everything unread is in the queue.
 *   4 `investigators` names for every investigator in the queue.
 *   5 `funding_opportunities` number and title for every notice in the queue.
 *   6 `investigator_fit_profiles` — which of those investigators are back in
 *     the judge's queue (`fit_judged_at IS NULL`), the "re-judging" marker.
 *   7 `fit_corrections` applied-but-unrescored notice rows — the notices whose
 *     re-score the nightly prelude still owes.
 *   N one head count per notice with a pending correction: how many
 *     investigators approving it re-scores.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { MISSING_TABLE, type CorrectionRow } from "@/lib/fit/judge/corrections";
import { MISSING_TABLE as RESULTS_MISSING_TABLE, FIT_RESULT_REVIEW_COLUMNS, FIT_RESULT_REVIEW_KIND_PATH } from "@/lib/fit/results";
import { pairKey, QUEUED_REVIEW_KINDS, queueView, type ReviewQueue, type ReviewResultRow, type SubjectNames } from "@/lib/fit/review/queue";

export const REVIEW_STATE_MIGRATION = "supabase/migrations/20260921100000_fit_review_state.sql";

/** The queue reads at most this many flagged pairs and this many proposed corrections; older ones wait for the next pass. */
export const REVIEW_ROW_LIMIT = 200;
/** Notices we will pay a head count for; beyond that the item shows no count and is treated as "the nightly re-scores it". */
export const RESCORE_COUNT_MAX_NOTICES = 20;

export type ReviewQueueRead = {
  queue: ReviewQueue;
  /** `fit_results` and `fit_corrections` are both on the database. */
  available: boolean;
  /** This PR's migration is applied — without it nothing can be marked reviewed and the nightly cannot be told what it owes. */
  reviewStateAvailable: boolean;
  error: string | null;
};

const EMPTY_NAMES: SubjectNames = { investigators: new Map(), notices: new Map() };

const emptyQueue = (): ReviewQueue => queueView({ reviewRows: [], reviewed: new Map(), corrections: [], names: EMPTY_NAMES, rescoreCounts: new Map(), reJudgingInvestigators: new Set(), reJudgingNotices: new Set() });

const unavailable = (over: Partial<ReviewQueueRead> = {}): ReviewQueueRead => ({ queue: emptyQueue(), available: false, reviewStateAvailable: false, error: null, ...over });

/** Load everything `/team/fit-review` shows. Never throws: a missing table or column answers `available: false`. */
export async function loadReviewQueue(db: SupabaseClient): Promise<ReviewQueueRead> {
  // 1 — the flagged pairs (sections 1 and 3).
  const flagged = await db
    .from("fit_results")
    .select(FIT_RESULT_REVIEW_COLUMNS)
    .in(FIT_RESULT_REVIEW_KIND_PATH, [...QUEUED_REVIEW_KINDS])
    .order("score", { ascending: false })
    .limit(REVIEW_ROW_LIMIT);
  if (flagged.error) {
    if (RESULTS_MISSING_TABLE.test(flagged.error.message)) return unavailable();
    return unavailable({ available: true, error: flagged.error.message });
  }
  const reviewRows = ((flagged.data ?? []) as ReviewResultRow[]).map((r) => ({ ...r, score: Number(r.score) }));

  // 2 — the proposed corrections (sections 2 and 4). `*` on purpose: it returns `evidence_hash` and `rescored_at` after this PR's migration and every other column before it, with no second round trip.
  const proposed = await db.from("fit_corrections").select("*").eq("status", "proposed").order("created_at", { ascending: false }).limit(REVIEW_ROW_LIMIT);
  if (proposed.error) {
    if (MISSING_TABLE.test(proposed.error.message)) return unavailable({ available: false });
    return unavailable({ available: true, error: proposed.error.message });
  }
  const corrections = (proposed.data ?? []) as CorrectionRow[];

  const investigatorIds = Array.from(new Set([...reviewRows.map((r) => r.investigator_id), ...corrections.filter((c) => c.target === "investigator_profile").map((c) => c.target_id)]));
  const noticeIds = Array.from(new Set([...reviewRows.map((r) => r.opportunity_id), ...corrections.filter((c) => c.target === "opportunity_profile").map((c) => c.target_id)]));

  // 3–7 — the state around the rows.
  const [reviewed, names, reJudgingInvestigators, reJudgingNotices] = await Promise.all([
    loadReviewedPairs(db, investigatorIds),
    loadNames(db, investigatorIds, noticeIds),
    loadReJudgingInvestigators(db, investigatorIds),
    loadNoticesAwaitingRescore(db),
  ]);

  // N — what approving each notice correction re-scores.
  const pendingNotices = Array.from(new Set(corrections.filter((c) => c.target === "opportunity_profile").map((c) => c.target_id))).slice(0, RESCORE_COUNT_MAX_NOTICES);
  const rescoreCounts = await loadRescoreCounts(db, pendingNotices);

  return {
    queue: queueView({ reviewRows, reviewed: reviewed.pairs, corrections, names, rescoreCounts, reJudgingInvestigators, reJudgingNotices }),
    available: true,
    reviewStateAvailable: reviewed.available,
    error: null,
  };
}

/** The pairs already marked reviewed, of a bounded investigator set; `available: false` before this PR's migration (nothing can be marked, so nothing is). */
export async function loadReviewedPairs(db: SupabaseClient, investigatorIds: readonly string[]): Promise<{ pairs: Map<string, string>; available: boolean }> {
  const pairs = new Map<string, string>();
  if (!investigatorIds.length) return { pairs, available: true };
  const { data, error } = await db.from("fit_adjudications").select("investigator_id, opportunity_id, reviewed_at").in("investigator_id", [...investigatorIds]).not("reviewed_at", "is", null).limit(1000);
  // No table (before 3.1), no column (before 3.3) or a read failure: nothing is marked reviewed, and the page says the state is unavailable.
  if (error) return { pairs, available: false };
  for (const r of (data ?? []) as Array<{ investigator_id: string; opportunity_id: string; reviewed_at: string | null }>) {
    if (!r.reviewed_at) continue;
    const key = pairKey(r.investigator_id, r.opportunity_id);
    const prev = pairs.get(key);
    if (!prev || prev < r.reviewed_at) pairs.set(key, r.reviewed_at);
  }
  return { pairs, available: true };
}

/** Investigator names and notice numbers / titles for the ids in the queue. Two reads. */
export async function loadNames(db: SupabaseClient, investigatorIds: readonly string[], noticeIds: readonly string[]): Promise<SubjectNames> {
  const investigators = new Map<string, string | null>();
  const notices = new Map<string, { number: string | null; title: string | null }>();
  const [inv, opp] = await Promise.all([
    investigatorIds.length ? db.from("investigators").select("id, full_name").in("id", [...investigatorIds]).limit(1000) : Promise.resolve({ data: [], error: null }),
    noticeIds.length ? db.from("funding_opportunities").select("id, opportunity_number, title").in("id", [...noticeIds]).limit(1000) : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of ((inv.error ? [] : inv.data) ?? []) as Array<{ id: string; full_name: string | null }>) investigators.set(r.id, r.full_name);
  for (const r of ((opp.error ? [] : opp.data) ?? []) as Array<{ id: string; opportunity_number: string | null; title: string | null }>) notices.set(r.id, { number: r.opportunity_number, title: r.title });
  return { investigators, notices };
}

/** Which of these investigators are back in the judge's queue (`fit_judged_at IS NULL`) — the "re-judging" marker on their pairs. */
export async function loadReJudgingInvestigators(db: SupabaseClient, investigatorIds: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!investigatorIds.length) return out;
  const { data, error } = await db.from("investigator_fit_profiles").select("investigator_id").in("investigator_id", [...investigatorIds]).is("fit_judged_at", null).limit(1000);
  if (error) return out;
  for (const r of (data ?? []) as Array<{ investigator_id: string }>) out.add(r.investigator_id);
  return out;
}

/** Notices whose applied correction still owes its re-score (`status = 'applied' AND rescored_at IS NULL`) — the nightly prelude's list, shown as "re-scoring tonight". */
export async function loadNoticesAwaitingRescore(db: SupabaseClient): Promise<Set<string>> {
  const out = new Set<string>();
  const { data, error } = await db.from("fit_corrections").select("target_id").eq("target", "opportunity_profile").eq("status", "applied").is("rescored_at", null).limit(500);
  if (error) return out;
  for (const r of (data ?? []) as Array<{ target_id: string }>) out.add(r.target_id);
  return out;
}

/** How many investigators a re-score of each notice touches: one exact head count per notice (no rows returned). */
export async function loadRescoreCounts(db: SupabaseClient, noticeIds: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const id of noticeIds) {
    const { count, error } = await db.from("fit_results").select("investigator_id", { count: "exact", head: true }).eq("opportunity_id", id);
    if (error) continue;
    out.set(id, count ?? 0);
  }
  return out;
}

/** The count one approval of a notice correction would re-score — the action asks for it on its own before deciding sync or nightly. */
export async function countInvestigatorsForNotice(db: SupabaseClient, opportunityId: string): Promise<number | null> {
  const { count, error } = await db.from("fit_results").select("investigator_id", { count: "exact", head: true }).eq("opportunity_id", opportunityId);
  if (error) return null;
  return count ?? 0;
}
