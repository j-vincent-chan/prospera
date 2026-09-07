/**
 * The review queue's reads (plan § PR 3.3) on the fake PostgREST builder: the
 * flagged pairs come from `fit_results.adjudication.reconciliation.review.kind`
 * through slim JSON paths, the corrections from one `status = 'proposed'`
 * read, the reviewed state from `fit_adjudications.reviewed_at`, and the page
 * costs 7 + N reads (N = notices with a pending correction). A missing table
 * or column answers `available: false` rather than throwing.
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
 * A `fit_results` row as the queue's read sees it: PostgREST returns the slim
 * aliases, and the fake resolves the `->` filter against the stored blob, so
 * the fixture carries both — the same row, addressed two ways.
 */
function resultRow(over: { investigator_id?: string; opportunity_id?: string; kind?: string; note?: string; tier?: string; score?: number } = {}): Row {
  const kind = over.kind ?? "ai_flagged_lead";
  const reconciliation = { tier: over.tier ?? "exploratory", tier_structured: "poor", confidence: "review", review: { kind, note: over.note ?? "a methods transfer the structure cannot see" } };
  return {
    investigator_id: over.investigator_id ?? INV_A,
    opportunity_id: over.opportunity_id ?? OPP_A,
    tier: over.tier ?? "exploratory",
    score: over.score ?? 61,
    rationale: "Overlaps on lupus.",
    adjudication: { judged_at: "2026-09-06T10:00:00.000Z", blind: { verdict: "moderate" }, reconciliation },
    judged_at: "2026-09-06T10:00:00.000Z",
    judged_tier: reconciliation.tier,
    judged_from: "poor",
    judged_confidence: "review",
    review_kind: kind,
    review_note: reconciliation.review.note,
    blind_verdict: "moderate",
  };
}

function correctionRow(over: Row = {}): Row {
  const evidence = { ids: ["NCT04000001"], quote: null, section: null, confidence: "high" as const, pair: null, via: "reconciler", ...((over.evidence as Row) ?? {}) };
  return { id: "c-1", target: "investigator_profile", target_id: INV_A, path: "paradigm.recent.clinical_trials", from_value: 0.81, to_value: 0.15, evidence_hash: evidenceHash(evidence), kind: "profile_weight", proposed_by: "judge", status: "proposed", decided_by: null, created_at: "2026-09-06T09:00:00.000Z", decided_at: null, rescored_at: null, ...over, evidence };
}

const tables = (over: Partial<FakeTables> = {}): FakeTables => ({
  fit_results: [resultRow(), resultRow({ investigator_id: INV_B, opportunity_id: OPP_B, kind: "ungrounded_dissent", tier: "moderate", score: 72 }), resultRow({ opportunity_id: OPP_B, kind: "structured_miss" }), { investigator_id: INV_B, opportunity_id: OPP_A, tier: "poor", score: 10, rationale: null, adjudication: null }],
  fit_corrections: [correctionRow(), correctionRow({ id: "c-2", target: "opportunity_profile", target_id: OPP_A, path: "design.required_any", from_value: ["rct"], to_value: ["rct", "early_phase_trial"], kind: "misread_requirement", created_at: "2026-09-06T08:00:00.000Z" })],
  fit_adjudications: [],
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
  it("fills the four sections, names the subjects, counts the notice re-score, and costs 7 + N reads", async () => {
    const db = fakeDb(tables());
    const read = await loadReviewQueue(db);
    expect(read.available).toBe(true);
    expect(read.error).toBeNull();
    expect(read.queue.counts).toEqual({ leads: 1, notice_corrections: 1, dissents: 1, profile_corrections: 1 });
    expect(read.queue.leads.items[0]).toMatchObject({ note: "a methods transfer the structure cannot see", engineTier: "poor" });
    expect(read.queue.leads.items[0]!.pair).toMatchObject({ investigator: "Ada Lovelace", notice: "RFA-AR-27-001 · Lupus trials" });
    expect(read.queue.dissents.items[0]!.pair.investigator).toBe("Grace Hopper");
    // Three investigator rows are on `fit_results` for OPP_A (two flagged, one plain) — the head count says what approving would re-score.
    expect(read.queue.noticeCorrections.items[0]).toMatchObject({ subject: "RFA-AR-27-001 · Lupus trials", rescoreInvestigators: 2, rescoreSynchronous: true });
    // Grace has never been judged since the last approval: her pairs read "re-judging".
    expect(read.queue.dissents.items[0]!.reJudging).toBe(true);
    expect(read.queue.leads.items[0]!.reJudging).toBe(false);
    // 1 fit_results (flagged) + 1 fit_corrections (proposed) + 1 fit_adjudications + 2 names + 1 profiles + 1 fit_corrections (awaiting re-score) + 1 head count.
    expect(db.log.reads).toHaveLength(8);
    expect(db.log.reads.filter((r) => r.startsWith("fit_results"))).toHaveLength(2);
    expect(db.log.reads[0]).toContain("review_kind:adjudication->reconciliation->review->>kind");
    expect(db.log.reads[0]).not.toMatch(/(^|,\s)adjudication(,|$)/);
    expect(db.log.writes).toHaveLength(0);
  });

  it("keeps a pair marked reviewed out of the queue, and says so when the review state is not on the database yet", async () => {
    const reviewed = fakeDb(tables({ fit_adjudications: [{ investigator_id: INV_A, opportunity_id: OPP_A, reviewed_at: "2026-09-07T08:00:00.000Z", reviewed_by: "u-1" }] }));
    const withState = await loadReviewQueue(reviewed);
    expect(withState.reviewStateAvailable).toBe(true);
    expect(withState.queue.leads.count).toBe(0);
    expect(withState.queue.leads.reviewed).toBe(1);

    const noTable = await loadReviewQueue(fakeDb(tables({ fit_adjudications: null })));
    expect(noTable.available).toBe(true);
    expect(noTable.reviewStateAvailable).toBe(false);
    expect(noTable.queue.counts.leads).toBe(1);
  });

  it("marks notices whose applied correction still owes its re-score, and never lists a decided correction", async () => {
    const db = fakeDb(tables({ fit_corrections: [correctionRow({ id: "c-2", target: "opportunity_profile", target_id: OPP_A, kind: "misread_requirement" }), correctionRow({ id: "c-3", target: "opportunity_profile", target_id: OPP_B, kind: "misread_requirement", status: "applied", rescored_at: null }), correctionRow({ id: "c-4", status: "rejected" })] }));
    const read = await loadReviewQueue(db);
    expect(read.queue.counts.notice_corrections).toBe(1);
    expect(read.queue.counts.profile_corrections).toBe(0);
    expect(read.queue.leads.items[0]!.reJudging).toBe(false);
    expect(read.queue.dissents.items[0]!.reJudging).toBe(true); // OPP_B awaits its re-score
  });

  it("answers unavailable before the fit_results and fit_corrections migrations, without throwing", async () => {
    expect(await loadReviewQueue(fakeDb(tables({ fit_results: null })))).toMatchObject({ available: false, error: null });
    const noCorrections = await loadReviewQueue(fakeDb(tables({ fit_corrections: null })));
    expect(noCorrections).toMatchObject({ available: false, error: null });
    expect(noCorrections.queue.total).toBe(0);
  });
});
