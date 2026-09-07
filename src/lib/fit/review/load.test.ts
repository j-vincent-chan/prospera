/**
 * The review queue's reads (plan § PR 3.3) on the fake PostgREST builder: the
 * flagged pairs come from `fit_adjudications.reconciliation.result.review.kind`
 * through slim JSON paths — not from the `fit_results.adjudication` copy the
 * sweep drops — `fit_results` is joined for the tier and score, the
 * corrections come from one `status = 'proposed'` read, the review state is a
 * column of the adjudication row, and the page costs 6 + N reads (N = notices
 * with a pending correction). A missing table or column answers
 * `available: false` rather than throwing, and a missing `fit_corrections`
 * still lists the leads.
 */
import { describe, expect, it } from "vitest";
import { fakeDb, type FakeTables, type Row } from "@/lib/fit/__fixtures__/fake-db";
import { evidenceHash } from "@/lib/fit/judge/corrections";
import { loadReviewQueue } from "@/lib/fit/review/load";

const INV_A = "11111111-1111-4111-8111-111111111111";
const INV_B = "22222222-2222-4222-8222-222222222222";
const OPP_A = "aaaaaaaa-1111-4111-8111-111111111111";
const OPP_B = "bbbbbbbb-2222-4222-8222-222222222222";

/**
 * A `fit_adjudications` row as the queue's read sees it: PostgREST returns the
 * slim aliases, and the fake resolves the `->` filter against the stored blob,
 * so the fixture carries both — the same row, addressed two ways.
 */
function adjudicationRow(over: { investigator_id?: string; opportunity_id?: string; kind?: string; note?: string; tier?: string; created_at?: string; reviewed_at?: string | null } = {}): Row {
  const kind = over.kind ?? "ai_flagged_lead";
  const result = { tier: over.tier ?? "exploratory", tier_structured: "poor", confidence: "review", review: { kind, note: over.note ?? "a methods transfer the structure cannot see" } };
  return {
    investigator_id: over.investigator_id ?? INV_A,
    opportunity_id: over.opportunity_id ?? OPP_A,
    created_at: over.created_at ?? "2026-09-06T10:00:00.000Z",
    reviewed_at: over.reviewed_at ?? null,
    reviewed_by: null,
    blind: { verdict: "moderate" },
    reconciliation: { result, engine: { tier: "poor", score: 40 } },
    review_kind: kind,
    review_note: result.review.note,
    judged_tier: result.tier,
    judged_from: "poor",
    judged_confidence: "review",
    blind_verdict: "moderate",
  };
}

const resultRow = (investigator_id: string, opportunity_id: string, over: Row = {}): Row => ({ investigator_id, opportunity_id, tier: "exploratory", score: 61, rationale: "Overlaps on lupus.", adjudication: null, ...over });

function correctionRow(over: Row = {}): Row {
  const evidence = { ids: ["NCT04000001"], quote: null, section: null, confidence: "high" as const, pair: null, via: "reconciler", ...((over.evidence as Row) ?? {}) };
  return { id: "c-1", target: "investigator_profile", target_id: INV_A, path: "paradigm.recent.clinical_trials", from_value: 0.81, to_value: 0.15, evidence_hash: evidenceHash(evidence), kind: "profile_weight", proposed_by: "judge", status: "proposed", decided_by: null, created_at: "2026-09-06T09:00:00.000Z", decided_at: null, rescored_at: null, ...over, evidence };
}

const tables = (over: Partial<FakeTables> = {}): FakeTables => ({
  fit_adjudications: [adjudicationRow(), adjudicationRow({ investigator_id: INV_B, opportunity_id: OPP_B, kind: "ungrounded_dissent", tier: "moderate", created_at: "2026-09-06T11:00:00.000Z" }), adjudicationRow({ opportunity_id: OPP_B, kind: "structured_miss" })],
  fit_results: [resultRow(INV_A, OPP_A), resultRow(INV_B, OPP_B, { tier: "moderate", score: 72 }), resultRow(INV_B, OPP_A, { tier: "poor", score: 10, rationale: null })],
  fit_corrections: [correctionRow(), correctionRow({ id: "c-2", target: "opportunity_profile", target_id: OPP_A, path: "design.required_any", from_value: ["rct"], to_value: ["rct", "early_phase_trial"], kind: "misread_requirement", created_at: "2026-09-06T08:00:00.000Z" })],
  investigators: [
    { id: INV_A, full_name: "Ada Lovelace" },
    { id: INV_B, full_name: "Grace Hopper" },
  ],
  funding_opportunities: [
    { id: OPP_A, opportunity_number: "RFA-AR-27-001", title: "Lupus trials" },
    { id: OPP_B, opportunity_number: "PA-27-002", title: "Biomarker discovery" },
  ],
  investigator_fit_profiles: [
    { investigator_id: INV_A, fit_judged_at: "2026-09-06T02:00:00.000Z" },
    { investigator_id: INV_B, fit_judged_at: null },
  ],
  ...over,
});

describe("fit/review/load · loadReviewQueue", () => {
  it("fills the four sections from the adjudications, joins fit_results for the tier and score, names the subjects, counts the notice re-score, and costs 6 + N reads", async () => {
    const db = fakeDb(tables());
    const read = await loadReviewQueue(db);
    expect(read).toMatchObject({ available: true, correctionsAvailable: true, reviewStateAvailable: true, error: null });
    expect(read.queue.counts).toEqual({ leads: 1, notice_corrections: 1, dissents: 1, profile_corrections: 1 });
    expect(read.queue.leads.items[0]).toMatchObject({ note: "a methods transfer the structure cannot see", engineTier: "poor", tier: "exploratory", score: 61, scored: true, rationale: "Overlaps on lupus." });
    expect(read.queue.leads.items[0]!.pair).toMatchObject({ investigator: "Ada Lovelace", notice: "RFA-AR-27-001 · Lupus trials" });
    expect(read.queue.dissents.items[0]!.pair.investigator).toBe("Grace Hopper");
    // Three investigator rows are on `fit_results` for OPP_A (two of them the queue's) — the head count says what approving would re-score.
    expect(read.queue.noticeCorrections.items[0]).toMatchObject({ subject: "RFA-AR-27-001 · Lupus trials", rescoreInvestigators: 2, rescoreSynchronous: true });
    // 1 fit_adjudications + 1 fit_corrections (proposed) + 1 fit_results (the pairs' tiers) + 2 names + 1 fit_corrections (awaiting a re-score) + 1 head count.
    expect(db.log.reads).toHaveLength(7);
    expect(db.log.reads[0]).toContain("review_kind:reconciliation->result->review->>kind");
    expect(db.log.reads[0]).toContain("reviewed_at");
    expect(db.log.reads[0]).not.toMatch(/(^|,\s)reconciliation(,|$)/);
    expect(db.log.reads.filter((r) => r.startsWith("fit_results"))).toHaveLength(2);
    expect(db.log.writes).toHaveLength(0);
  });

  it("reads the review item the sweep dropped from fit_results — the adjudication row is the record", async () => {
    // The pair was judged, then a correction moved the profile versions: `fit_results.adjudication` is NULL and the row's shown tier is the engine's.
    const db = fakeDb(tables({ fit_results: [resultRow(INV_A, OPP_A, { tier: "poor", score: 22, adjudication: null })] }));
    const read = await loadReviewQueue(db);
    expect(read.queue.counts.leads).toBe(1);
    expect(read.queue.leads.items[0]).toMatchObject({ tier: "poor", score: 22, scored: true, note: "a methods transfer the structure cannot see" });
    // The dissent's pair has no result row at all now; it stays in the queue at its judged tier.
    expect(read.queue.dissents.items[0]).toMatchObject({ tier: "moderate", scored: false, score: 0 });
  });

  it("takes the newest adjudication per pair, keeps a reviewed one out of the queue, and says so when the review state is not on the database yet", async () => {
    const older = adjudicationRow({ created_at: "2026-09-01T10:00:00.000Z", reviewed_at: "2026-09-02T08:00:00.000Z", note: "an older judgment, already read" });
    const newest = fakeDb(tables({ fit_adjudications: [adjudicationRow(), older] }));
    const fresh = await loadReviewQueue(newest);
    // The newest row is unreviewed, so the lead is back in the queue even though an older row of the pair was marked.
    expect(fresh.queue.leads.count).toBe(1);
    expect(fresh.queue.leads.items[0]!.note).toBe("a methods transfer the structure cannot see");

    const reviewed = fakeDb(tables({ fit_adjudications: [adjudicationRow({ reviewed_at: "2026-09-07T08:00:00.000Z" })] }));
    const withState = await loadReviewQueue(reviewed);
    expect(withState.reviewStateAvailable).toBe(true);
    expect(withState.queue.leads.count).toBe(0);
    expect(withState.queue.leads.reviewed).toBe(1);

    // Before this PR's migration the column is not there: the read is made again without it and the items stay listed.
    const { db, asked } = withoutReviewedAt(tables());
    const noColumn = await loadReviewQueue(db);
    expect(noColumn).toMatchObject({ available: true, reviewStateAvailable: false });
    expect(noColumn.queue.counts.leads).toBe(1);
    expect(asked).toEqual([expect.stringContaining("reviewed_at"), expect.not.stringContaining("reviewed_at")]);
  });

  it("marks the subjects whose applied correction still owes its re-score — never every investigator the judge has not reached", async () => {
    const db = fakeDb(
      tables({
        fit_corrections: [
          correctionRow({ id: "c-2", target: "opportunity_profile", target_id: OPP_B, kind: "misread_requirement", status: "applied", rescored_at: null }),
          correctionRow({ id: "c-3", target_id: INV_A, status: "applied", rescored_at: null }),
          correctionRow({ id: "c-4", target_id: INV_B, status: "applied", rescored_at: "2026-09-06T12:00:00.000Z" }),
          correctionRow({ id: "c-5", status: "rejected" }),
        ],
      })
    );
    const read = await loadReviewQueue(db);
    expect(read.queue.counts.notice_corrections).toBe(0);
    expect(read.queue.counts.profile_corrections).toBe(0);
    // Ada owes a re-score (c-3); Grace's was stamped, and her `fit_judged_at` being NULL is not this marker.
    expect(read.queue.leads.items[0]!.reJudging).toBe(true);
    expect(read.queue.dissents.items[0]!.reJudging).toBe(true); // via OPP_B's unrescored correction
    expect(read.queue.reJudging).toBe(2);

    const clean = fakeDb(tables({ fit_corrections: [correctionRow({ id: "c-6", status: "applied", rescored_at: "2026-09-06T12:00:00.000Z" })] }));
    const none = await loadReviewQueue(clean);
    expect((clean.tables.investigator_fit_profiles as Row[])[1]!.fit_judged_at).toBeNull();
    expect(none.queue.dissents.items[0]!.reJudging).toBe(false);
    expect(none.queue.reJudging).toBe(0);
  });

  it("still lists the leads when fit_corrections is missing, and answers unavailable only when the adjudications are", async () => {
    const noCorrections = await loadReviewQueue(fakeDb(tables({ fit_corrections: null })));
    expect(noCorrections).toMatchObject({ available: true, correctionsAvailable: false, error: null });
    expect(noCorrections.queue.counts).toEqual({ leads: 1, notice_corrections: 0, dissents: 1, profile_corrections: 0 });

    const noAdjudications = await loadReviewQueue(fakeDb(tables({ fit_adjudications: null })));
    expect(noAdjudications).toMatchObject({ available: false, correctionsAvailable: false, error: null });
    expect(noAdjudications.queue.total).toBe(0);
  });
});

/** A database before this PR's migration: a select naming `reviewed_at` fails the way PostgREST does; the same read without it works. */
function withoutReviewedAt(t: FakeTables) {
  const db = fakeDb(t);
  const from = db.from.bind(db);
  const asked: string[] = [];
  (db as unknown as { from: (t: string) => unknown }).from = (table: string) => {
    const q = from(table) as unknown as Record<string, (...a: unknown[]) => unknown>;
    if (table !== "fit_adjudications") return q;
    const select = q.select!;
    q.select = (cols: unknown, o?: unknown) => {
      asked.push(String(cols));
      if (!String(cols).includes("reviewed_at")) return select(cols, o);
      const fail = { data: null, error: { message: "column fit_adjudications.reviewed_at does not exist" }, count: null };
      const dead: Record<string, unknown> = { maybeSingle: async () => fail, single: async () => fail, then: (r: (v: unknown) => unknown) => Promise.resolve(fail).then(r) };
      for (const m of ["eq", "in", "is", "not", "order", "limit"]) dead[m] = () => dead;
      return dead;
    };
    return q;
  };
  return { db, asked };
}
