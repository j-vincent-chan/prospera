/**
 * The reads behind `/team/fit-review` (plan § PR 3.3). Server-side only; the
 * view model in `queue.ts` is pure and tested, and nothing here writes — the
 * actions do (`src/app/actions/fit-review-actions.ts`).
 *
 * Every read answers `available: false` instead of throwing while a migration
 * is not applied (`fit_adjudications`, `fit_corrections`, and this PR's
 * `fit_adjudications.reviewed_at` / `fit_corrections.rescored_at`), the
 * inspector's rule. The two sides are independent: a database with the
 * adjudications but not the corrections still renders the leads and dissents,
 * and says which migration the correction sections are waiting for.
 *
 * The reads, counted — the page's whole cost is **6 + N**, N being the
 * distinct notices with a pending correction (capped at
 * `RESCORE_COUNT_MAX_NOTICES`), and one more when the review-state columns
 * are not on the database yet (the re-read without them):
 *
 *   1 `fit_adjudications` rows whose `reconciliation.result.review.kind` is a
 *     queued kind — sections 1 and 3 in one read, newest first, deduplicated
 *     to the newest row per pair here. The review item is read from the
 *     adjudication row, not from the `fit_results.adjudication` copy the sweep
 *     drops whenever the profile versions move (on 2026-09 data that copy held
 *     14 of the 36 items on file). `reviewed_by` / `reviewed_at` are columns of
 *     the same row, so the review state costs no read of its own.
 *   2 `fit_corrections` with `status = 'proposed'` — sections 2 and 4 in one
 *     read.
 *   3 `fit_results` for the flagged pairs — the tier and score each pair is
 *     shown at, slim columns, one read over the rectangle of the queue's
 *     investigators × its notices (4 × 27 on 2026-09 data; the flagged set is
 *     capped at `REVIEW_ROW_LIMIT`, and the rows are filtered to the pairs in
 *     hand).
 *   4 `investigators` names for every investigator in the queue.
 *   5 `funding_opportunities` number and title for every notice in the queue.
 *   6 `fit_corrections` applied-but-unrescored rows, both targets — the
 *     subjects the nightly prelude still owes a re-score, which is what the
 *     "re-judging" marker means.
 *   N one head count per notice with a pending correction, all in parallel:
 *     how many investigators approving it re-scores.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { MISSING_COLUMN, MISSING_TABLE, type CorrectionRow } from "@/lib/fit/judge/corrections";
import { FIT_RESULT_REVIEW_COLUMNS, type FitResultReviewRow } from "@/lib/fit/results";
import { pairKey, QUEUED_REVIEW_KINDS, queueView, type ReviewAdjudicationRow, type ReviewQueue, type ShownResult, type SubjectNames } from "@/lib/fit/review/queue";

export const REVIEW_STATE_MIGRATION = "supabase/migrations/20260921100000_fit_review_state.sql";

/** The queue reads at most this many flagged adjudications and this many proposed corrections — **per read, and each read feeds two sections**; older ones wait until these are decided. */
export const REVIEW_ROW_LIMIT = 200;
/** Notices we will pay a head count for; beyond that the item shows no count and the action decides the scope for itself when it is approved. */
export const RESCORE_COUNT_MAX_NOTICES = 20;
/** The ceiling on read 3's rectangle (the flagged investigators × the flagged notices); far above what `REVIEW_ROW_LIMIT` pairs can need. */
export const REVIEW_RESULT_ROW_LIMIT = 20_000;

/** The PostgREST path the queue filters on: `fit_adjudications.reconciliation.result.review.kind`. The derived `Reconciliation` is stored under `reconciliation.result` (see `StoredAdjudication`), not at the root. */
export const FIT_ADJUDICATION_REVIEW_KIND_PATH = "reconciliation->result->review->>kind";

/** The slim stage-8 scalars the queue renders, aliased out of the stored blobs — never the blobs themselves (D44). */
const ADJUDICATION_REVIEW_COLUMNS_BASE =
  "investigator_id, opportunity_id, created_at, review_kind:reconciliation->result->review->>kind, review_note:reconciliation->result->review->>note, judged_tier:reconciliation->result->>tier, judged_from:reconciliation->result->>tier_structured, judged_confidence:reconciliation->result->>confidence, blind_verdict:blind->>verdict";
/** With this PR's review state; a read falls back to the base list while the columns are not on the database. */
export const FIT_ADJUDICATION_REVIEW_COLUMNS = `${ADJUDICATION_REVIEW_COLUMNS_BASE}, reviewed_at`;

export type ReviewQueueRead = {
  queue: ReviewQueue;
  /** `fit_adjudications` is on the database — without it the page has nothing to show. */
  available: boolean;
  /** `fit_corrections` is on the database; when it is not, the leads and dissents still render and the correction sections say so. */
  correctionsAvailable: boolean;
  /** This PR's migration is applied — without it nothing can be marked reviewed and the nightly cannot be told what it owes. */
  reviewStateAvailable: boolean;
  error: string | null;
};

const EMPTY_NAMES: SubjectNames = { investigators: new Map(), notices: new Map() };

const emptyQueue = (): ReviewQueue => queueView({ reviewRows: [], results: new Map(), corrections: [], names: EMPTY_NAMES, rescoreCounts: new Map(), reJudgingInvestigators: new Set(), reJudgingNotices: new Set() });

const unavailable = (over: Partial<ReviewQueueRead> = {}): ReviewQueueRead => ({ queue: emptyQueue(), available: false, correctionsAvailable: false, reviewStateAvailable: false, error: null, ...over });

/** Load everything `/team/fit-review` shows. Never throws: a missing table or column answers `available: false`. */
export async function loadReviewQueue(db: SupabaseClient): Promise<ReviewQueueRead> {
  // 1 — the flagged pairs (sections 1 and 3), from the adjudications themselves.
  const flagged = await loadFlaggedAdjudications(db);
  if (flagged.error) return unavailable({ available: true, error: flagged.error });
  if (!flagged.available) return unavailable();
  const reviewRows = flagged.rows;

  // 2 — the proposed corrections (sections 2 and 4). `*` on purpose: it returns `evidence_hash` and `rescored_at` after this PR's migration and every other column before it, with no second round trip.
  const proposed = await db.from("fit_corrections").select("*").eq("status", "proposed").order("created_at", { ascending: false }).limit(REVIEW_ROW_LIMIT);
  // Neither a missing corrections table nor a failed read is a missing page: the leads and dissents are already in hand, so the correction sections empty out and say why.
  const correctionsAvailable = !proposed.error || !MISSING_TABLE.test(proposed.error.message);
  const correctionsError = proposed.error && correctionsAvailable ? proposed.error.message : null;
  const corrections = (proposed.error ? [] : (proposed.data ?? [])) as CorrectionRow[];

  const investigatorIds = Array.from(new Set([...reviewRows.map((r) => r.investigator_id), ...corrections.filter((c) => c.target === "investigator_profile").map((c) => c.target_id)]));
  const noticeIds = Array.from(new Set([...reviewRows.map((r) => r.opportunity_id), ...corrections.filter((c) => c.target === "opportunity_profile").map((c) => c.target_id)]));
  const pendingNotices = Array.from(new Set(corrections.filter((c) => c.target === "opportunity_profile").map((c) => c.target_id))).slice(0, RESCORE_COUNT_MAX_NOTICES);

  // 3–6 and the N head counts — everything else the page needs, in parallel.
  const [results, names, awaiting, rescoreCounts] = await Promise.all([
    loadShownResults(db, reviewRows),
    loadNames(db, investigatorIds, noticeIds),
    loadSubjectsAwaitingRescore(db),
    loadRescoreCounts(db, pendingNotices),
  ]);

  return {
    queue: queueView({
      reviewRows,
      results,
      corrections,
      names,
      rescoreCounts,
      reJudgingInvestigators: awaiting.investigators,
      reJudgingNotices: awaiting.notices,
      truncated: { reviewRows: flagged.truncated, corrections: corrections.length >= REVIEW_ROW_LIMIT },
    }),
    available: true,
    correctionsAvailable,
    reviewStateAvailable: flagged.reviewState,
    error: correctionsError,
  };
}

export type FlaggedRead = {
  /** The newest row per pair, newest first. */
  rows: ReviewAdjudicationRow[];
  /** `fit_adjudications` is on the database. */
  available: boolean;
  /** The review-state columns are on it too. */
  reviewState: boolean;
  /** The read came back full: older flagged pairs were not taken. */
  truncated: boolean;
  error: string | null;
};

/**
 * The flagged pairs from `fit_adjudications`, newest first and deduplicated to
 * the newest row per pair — a pair judged again at new profile versions writes
 * a new row, and it is the latest judgment the queue shows (an older row's
 * `reviewed_at` does not clear it, which is the point: a lead raised by fresh
 * evidence comes back). Before this PR's migration the read is made again
 * without `reviewed_at`, so the queue still lists the items and only says the
 * review state is unavailable.
 */
export async function loadFlaggedAdjudications(db: SupabaseClient): Promise<FlaggedRead> {
  const none: FlaggedRead = { rows: [], available: false, reviewState: false, truncated: false, error: null };
  const read = (columns: string) => db.from("fit_adjudications").select(columns).in(FIT_ADJUDICATION_REVIEW_KIND_PATH, [...QUEUED_REVIEW_KINDS]).order("created_at", { ascending: false }).limit(REVIEW_ROW_LIMIT);
  let reviewState = true;
  let r = await read(FIT_ADJUDICATION_REVIEW_COLUMNS);
  if (r.error && MISSING_COLUMN.test(r.error.message)) {
    reviewState = false;
    r = await read(ADJUDICATION_REVIEW_COLUMNS_BASE);
  }
  if (r.error) {
    if (MISSING_TABLE.test(r.error.message)) return none;
    return { ...none, available: true, error: r.error.message };
  }
  const all = (r.data ?? []) as unknown as ReviewAdjudicationRow[];
  const rows: ReviewAdjudicationRow[] = [];
  const seen = new Set<string>();
  for (const row of all) {
    const key = pairKey(row.investigator_id, row.opportunity_id);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  return { rows, available: true, reviewState, truncated: all.length >= REVIEW_ROW_LIMIT, error: null };
}

/**
 * The tier and score the flagged pairs are shown at. One read over the
 * rectangle of the queue's investigators × its notices — PostgREST has no
 * composite `IN`, and `fit_adjudications` has no foreign key to `fit_results`
 * to embed through — filtered back to the pairs actually in hand. A pair with
 * no row (the sweep dropped it as a candidate) is simply absent, and the queue
 * shows its judged tier instead.
 */
export async function loadShownResults(db: SupabaseClient, rows: readonly ReviewAdjudicationRow[]): Promise<Map<string, ShownResult>> {
  const out = new Map<string, ShownResult>();
  if (!rows.length) return out;
  const wanted = new Set(rows.map((r) => pairKey(r.investigator_id, r.opportunity_id)));
  const investigatorIds = Array.from(new Set(rows.map((r) => r.investigator_id)));
  const noticeIds = Array.from(new Set(rows.map((r) => r.opportunity_id)));
  const { data, error } = await db.from("fit_results").select(FIT_RESULT_REVIEW_COLUMNS).in("investigator_id", investigatorIds).in("opportunity_id", noticeIds).limit(REVIEW_RESULT_ROW_LIMIT);
  // No `fit_results` (before the 2.2 migration) or a read failure: every item falls back to its judged tier.
  if (error) return out;
  for (const r of (data ?? []) as unknown as FitResultReviewRow[]) {
    const key = pairKey(r.investigator_id, r.opportunity_id);
    if (!wanted.has(key)) continue;
    out.set(key, { tier: r.tier, score: Number(r.score), rationale: r.rationale ?? null });
  }
  return out;
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

/**
 * The subjects whose applied correction still owes its re-score
 * (`status = 'applied' AND rescored_at IS NULL`) — the nightly prelude's work
 * list, shown as "re-judging" on their pairs and items. One read for both
 * targets.
 *
 * Deliberately **not** `investigator_fit_profiles.fit_judged_at IS NULL`: that
 * is every investigator the nightly judge has not reached (141 of 144 on the
 * 2026-09 roster), which would mark almost every pair in the queue and would
 * miss the ones an approval actually re-queued — `reQueueForJudge` clears the
 * subject's `fit_results.adjudication` too, so nothing here would even see it.
 */
export async function loadSubjectsAwaitingRescore(db: SupabaseClient): Promise<{ investigators: Set<string>; notices: Set<string> }> {
  const out = { investigators: new Set<string>(), notices: new Set<string>() };
  const { data, error } = await db.from("fit_corrections").select("target, target_id").eq("status", "applied").is("rescored_at", null).limit(500);
  // No table, or no `rescored_at` before this PR's migration: nothing is owed that we can see.
  if (error) return out;
  for (const r of (data ?? []) as Array<{ target: string; target_id: string }>) {
    if (r.target === "opportunity_profile") out.notices.add(r.target_id);
    else out.investigators.add(r.target_id);
  }
  return out;
}

/** How many investigators a re-score of each notice touches: one exact head count per notice (no rows returned), all in parallel. */
export async function loadRescoreCounts(db: SupabaseClient, noticeIds: readonly string[]): Promise<Map<string, number>> {
  const counted = await Promise.all(
    noticeIds.map(async (id) => {
      const { count, error } = await db.from("fit_results").select("investigator_id", { count: "exact", head: true }).eq("opportunity_id", id);
      return error ? null : ([id, count ?? 0] as const);
    })
  );
  return new Map(counted.filter((c): c is readonly [string, number] => c !== null));
}

/** The count one approval of a notice correction would re-score — the action asks for it on its own before deciding sync or nightly. */
export async function countInvestigatorsForNotice(db: SupabaseClient, opportunityId: string): Promise<number | null> {
  const { count, error } = await db.from("fit_results").select("investigator_id", { count: "exact", head: true }).eq("opportunity_id", opportunityId);
  if (error) return null;
  return count ?? 0;
}
