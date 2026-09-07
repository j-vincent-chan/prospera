/**
 * The review queue's view model (plan § PR 3.3): four sections from two
 * tables, the counts the page shows, the order inside each section, the two
 * view-rows of a 3.2 dismissal confirmation shown as one item, the reviewed
 * items kept out, and the "re-judging" marker.
 */
import { describe, expect, it } from "vitest";
import { evidenceHash, type CorrectionRow } from "@/lib/fit/judge/corrections";
import type { Adjudication } from "@/lib/fit/judge/types";
import { compareLeads, pairKey, proposalKey, QUEUED_REVIEW_KINDS, queueView, reviewFieldsOf, withoutViewSuffix, type ReviewQueueInput, type ReviewResultRow } from "@/lib/fit/review/queue";
import { FIT_RESCORE_SYNC_MAX_INVESTIGATORS } from "@/lib/fit/service";

const INV_A = "11111111-1111-4111-8111-111111111111";
const INV_B = "22222222-2222-4222-8222-222222222222";
const OPP_A = "aaaaaaaa-1111-4111-8111-111111111111";
const OPP_B = "bbbbbbbb-2222-4222-8222-222222222222";

const names = {
  investigators: new Map([
    [INV_A, "Ada Lovelace"],
    [INV_B, "Grace Hopper"],
  ]),
  notices: new Map([
    [OPP_A, { number: "RFA-AR-27-001", title: "Lupus trials" }],
    [OPP_B, { number: "PA-27-002", title: "Biomarker discovery" }],
  ]),
};

function flagged(over: Partial<ReviewResultRow> = {}): ReviewResultRow {
  return {
    investigator_id: INV_A,
    opportunity_id: OPP_A,
    tier: "exploratory",
    score: 61,
    rationale: "Overlaps on lupus but not on the trial requirement.",
    review_kind: "ai_flagged_lead",
    review_note: "the methods transfer from her registry work",
    judged_at: "2026-09-06T10:00:00.000Z",
    judged_tier: "exploratory",
    judged_from: "poor",
    judged_confidence: "review",
    blind_verdict: "moderate",
    ...over,
  };
}

function correction(over: Partial<CorrectionRow> = {}): CorrectionRow {
  const evidence = { ids: ["NCT04000001"], quote: null, section: null, confidence: "high" as const, pair: null, via: "reconciler", ...(over.evidence ?? {}) };
  return {
    id: "c-1",
    target: "investigator_profile",
    target_id: INV_A,
    path: "paradigm.recent.clinical_trials",
    from_value: 0.81,
    to_value: 0.15,
    evidence_hash: evidenceHash(evidence),
    kind: "profile_weight",
    proposed_by: "judge",
    status: "proposed",
    decided_by: null,
    created_at: "2026-09-06T09:00:00.000Z",
    decided_at: null,
    ...over,
    evidence,
  };
}

const input = (over: Partial<ReviewQueueInput> = {}): ReviewQueueInput => ({
  reviewRows: [],
  reviewed: new Map(),
  corrections: [],
  names,
  rescoreCounts: new Map(),
  reJudgingInvestigators: new Set(),
  reJudgingNotices: new Set(),
  ...over,
});

describe("fit/review/queue · the four sections and their counts", () => {
  it("splits the flagged pairs by review kind and the proposed corrections by target, and counts each", () => {
    const q = queueView(
      input({
        reviewRows: [flagged(), flagged({ investigator_id: INV_B, opportunity_id: OPP_B, review_kind: "ungrounded_dissent", review_note: "blind verdict poor; no grounded objection", tier: "moderate", judged_from: "moderate", judged_at: "2026-09-06T11:00:00.000Z" }), flagged({ opportunity_id: OPP_B, review_kind: "structured_miss", review_note: "paradigm: not a trialist" })],
        corrections: [correction(), correction({ id: "c-2", target: "opportunity_profile", target_id: OPP_A, path: "design.required_any", from_value: ["rct"], to_value: ["rct", "early_phase_trial"], kind: "misread_requirement", created_at: "2026-09-06T08:00:00.000Z" })],
        rescoreCounts: new Map([[OPP_A, 144]]),
      })
    );
    expect(q.counts).toEqual({ leads: 1, notice_corrections: 1, dissents: 1, profile_corrections: 1 });
    expect(q.total).toBe(4);
    // The three other review kinds (structured_miss, gate_correction, pending_confirmation) are decided through their correction rows, not on their own.
    expect(QUEUED_REVIEW_KINDS).toEqual(["ai_flagged_lead", "ungrounded_dissent"]);
    expect(q.leads.items.map((i) => i.kind)).toEqual(["ai_flagged_lead"]);
    expect(q.dissents.items[0]).toMatchObject({ kind: "ungrounded_dissent", note: "blind verdict poor; no grounded objection", tier: "moderate", engineTier: "moderate", blindVerdict: "moderate" });
    expect(q.noticeCorrections.items[0]).toMatchObject({ target: "opportunity_profile", subject: "RFA-AR-27-001 · Lupus trials", rescoreInvestigators: 144 });
    expect(q.profileCorrections.items[0]).toMatchObject({ target: "investigator_profile", subject: "Ada Lovelace", title: "Paradigm · Clinical trials", rescoreInvestigators: null, rescoreSynchronous: true });
  });

  it("a lead carries the pair, both inspector links, the judge's note and the engine's tier", () => {
    const q = queueView(input({ reviewRows: [flagged()] }));
    const lead = q.leads.items[0]!;
    expect(lead.key).toBe(pairKey(INV_A, OPP_A));
    expect(lead.pair).toMatchObject({ investigator: "Ada Lovelace", notice: "RFA-AR-27-001 · Lupus trials", investigatorInspectorHref: `/investigators/${INV_A}/fit`, noticeInspectorHref: `/opportunities/${OPP_A}/fit`, investigatorHref: `/investigators/${INV_A}`, noticeHref: `/opportunities/${OPP_A}` });
    expect(lead).toMatchObject({ note: "the methods transfer from her registry work", rationale: "Overlaps on lupus but not on the trial requirement.", tier: "exploratory", engineTier: "poor", confidence: "review", reviewed: false, reJudging: false });
  });

  it("reads the stage-8 scalars from the blob when a caller read that instead of the slim aliases", () => {
    const adjudication = { judged_at: "2026-09-06T12:00:00.000Z", blind: { verdict: "strong" }, reconciliation: { tier: "strong", tier_structured: "moderate", confidence: "low", review: { kind: "ungrounded_dissent", note: "no grounded objection" } } } as unknown as Adjudication;
    const f = reviewFieldsOf({ investigator_id: INV_A, opportunity_id: OPP_A, tier: "strong", score: 80, rationale: null, adjudication });
    expect(f).toEqual({ kind: "ungrounded_dissent", note: "no grounded objection", judgedAt: "2026-09-06T12:00:00.000Z", judgedTier: "strong", engineTier: "moderate", confidence: "low", blind: "strong" });
    expect(queueView(input({ reviewRows: [{ investigator_id: INV_A, opportunity_id: OPP_A, tier: "strong", score: 80, rationale: null, adjudication }] })).counts.dissents).toBe(1);
  });
});

describe("fit/review/queue · ordering, review state and re-judging", () => {
  it("lists leads newest judgment first, then the higher score, then the pair", () => {
    const q = queueView(
      input({
        reviewRows: [
          flagged({ opportunity_id: OPP_B, judged_at: "2026-09-05T10:00:00.000Z", score: 90 }),
          flagged({ judged_at: "2026-09-06T10:00:00.000Z", score: 40 }),
          flagged({ investigator_id: INV_B, judged_at: "2026-09-06T10:00:00.000Z", score: 70 }),
        ],
      })
    );
    expect(q.leads.items.map((i) => `${i.score}`)).toEqual(["70", "40", "90"]);
    expect(compareLeads(q.leads.items[0]!, q.leads.items[1]!)).toBeLessThan(0);
  });

  it("keeps a pair marked reviewed out of its section but counts it", () => {
    const q = queueView(input({ reviewRows: [flagged(), flagged({ investigator_id: INV_B })], reviewed: new Map([[pairKey(INV_B, OPP_A), "2026-09-07T08:00:00.000Z"]]) }));
    expect(q.leads.count).toBe(1);
    expect(q.leads.reviewed).toBe(1);
    expect(q.leads.items.map((i) => i.pair.investigator_id)).toEqual([INV_A]);
  });

  it("marks a pair and a correction as re-judging when its subject is back in the judge's queue or still owes a re-score", () => {
    const q = queueView(
      input({
        reviewRows: [flagged(), flagged({ investigator_id: INV_B, opportunity_id: OPP_B })],
        corrections: [correction(), correction({ id: "c-2", target: "opportunity_profile", target_id: OPP_B, kind: "misread_requirement", path: "design.required_any", to_value: ["rct"] })],
        reJudgingInvestigators: new Set([INV_A]),
        reJudgingNotices: new Set([OPP_B]),
      })
    );
    expect(q.leads.items.find((i) => i.pair.investigator_id === INV_A)!.reJudging).toBe(true);
    expect(q.leads.items.find((i) => i.pair.investigator_id === INV_B)!.reJudging).toBe(true); // via its notice
    expect(q.profileCorrections.items[0]!.reJudging).toBe(true);
    expect(q.noticeCorrections.items[0]!.reJudging).toBe(true);
    expect(q.reJudging).toBe(2);
  });

  it("a notice correction is synchronous only while the re-score it triggers is at or under the ops bound", () => {
    const big = queueView(input({ corrections: [correction({ id: "c-2", target: "opportunity_profile", target_id: OPP_A, kind: "misread_requirement" })], rescoreCounts: new Map([[OPP_A, FIT_RESCORE_SYNC_MAX_INVESTIGATORS + 1]]) }));
    expect(big.noticeCorrections.items[0]).toMatchObject({ rescoreSynchronous: false, rescoreInvestigators: FIT_RESCORE_SYNC_MAX_INVESTIGATORS + 1 });
    const small = queueView(input({ corrections: [correction({ id: "c-2", target: "opportunity_profile", target_id: OPP_A, kind: "misread_requirement" })], rescoreCounts: new Map([[OPP_A, FIT_RESCORE_SYNC_MAX_INVESTIGATORS]]) }));
    expect(small.noticeCorrections.items[0]!.rescoreSynchronous).toBe(true);
    // No count read (a notice past RESCORE_COUNT_MAX_NOTICES): the nightly owns it.
    const unknown = queueView(input({ corrections: [correction({ id: "c-2", target: "opportunity_profile", target_id: OPP_A, kind: "misread_requirement" })] }));
    expect(unknown.noticeCorrections.items[0]).toMatchObject({ rescoreInvestigators: null, rescoreSynchronous: false });
  });
});

describe("fit/review/queue · a 3.2 confirmation's two view-rows are one item", () => {
  const dismissal = { reason: "wrong_research_type", axis_reason: "paradigm:clinical_trials", suggestion_id: "s-1", item_id: "i-1", by: "u-1", at: "2026-09-06T07:00:00.000Z" };
  const viewRow = (id: string, path: string, from: number, created_at = "2026-09-06T07:05:00.000Z") => {
    const evidence = { ids: [], quote: null, section: null, confidence: "high" as const, pair: null, via: "dismissal", dismissal };
    return correction({ id, path, from_value: from, to_value: 0.15, proposed_by: "strategist", evidence, evidence_hash: evidenceHash(evidence), created_at });
  };

  it("groups the recent and career rows of one dismissal into one decision, keeps the edits apart, and titles it without the view suffix", () => {
    // The two rows are written in one insert loop, the recent view first.
    const rows = [viewRow("c-recent", "paradigm.recent.clinical_trials", 0.81), viewRow("c-career", "paradigm.career.clinical_trials", 0.7, "2026-09-06T07:05:01.000Z")];
    expect(proposalKey(rows[0]!)).toBe(proposalKey(rows[1]!));
    const q = queueView(input({ corrections: rows }));
    expect(q.counts.profile_corrections).toBe(1);
    const item = q.profileCorrections.items[0]!;
    expect(item.ids).toEqual(["c-recent", "c-career"]);
    expect(item.key).toBe("c-recent");
    expect(item.title).toBe("Paradigm · Clinical trials");
    expect(item.edits).toEqual([
      { id: "c-recent", path: "paradigm.recent.clinical_trials", pathLabel: "Paradigm · Clinical trials", from: "0.81", to: "0.15" },
      { id: "c-career", path: "paradigm.career.clinical_trials", pathLabel: "Paradigm · Clinical trials (career view)", from: "0.70", to: "0.15" },
    ]);
    expect(item.via).toBe("dismissal");
    expect(item.evidenceLine).toContain("wrong research type · paradigm:clinical_trials");
    expect(withoutViewSuffix("Paradigm · Clinical trials (career view)")).toBe("Paradigm · Clinical trials");
  });

  it("does not group two rows of different dismissals, nor the judge's own corrections", () => {
    const other = { ...dismissal, suggestion_id: "s-2" };
    const otherEvidence = { ids: [], quote: null, section: null, confidence: "high" as const, pair: null, via: "dismissal", dismissal: other };
    const rows = [viewRow("c-recent", "paradigm.recent.clinical_trials", 0.81), correction({ id: "c-other", path: "paradigm.career.clinical_trials", from_value: 0.7, evidence: otherEvidence, evidence_hash: evidenceHash(otherEvidence), proposed_by: "investigator", created_at: "2026-09-06T07:06:00.000Z" }), correction({ id: "c-judge", path: "design.rct", from_value: 0.7, to_value: 0.9, kind: "ingest_miss" }), correction({ id: "c-judge-2", path: "unit.L3", from_value: 0.9, to_value: 0.4, kind: "ingest_miss" })];
    const q = queueView(input({ corrections: rows }));
    expect(q.counts.profile_corrections).toBe(4);
    // Newest proposal first, then the row id: the judge's two (09:00) lead, then the second dismissal (07:06), then the first (07:05).
    expect(q.profileCorrections.items.map((i) => i.key)).toEqual(["c-judge", "c-judge-2", "c-other", "c-recent"]);
  });

  it("skips rows that are not proposed", () => {
    const q = queueView(input({ corrections: [correction({ id: "a", status: "applied" }), correction({ id: "r", status: "rejected", path: "unit.L3" }), correction({ id: "p" })] }));
    expect(q.profileCorrections.items.map((i) => i.key)).toEqual(["p"]);
  });
});
