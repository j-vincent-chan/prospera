/**
 * The correction surfaces' reads (PR 3.2): the inspector's row view, the
 * pairing of "wrong type of research" dismissals with the corrections already
 * on file (pure), and the loaders on the fake PostgREST builder.
 */
import { describe, expect, it } from "vitest";
import { fakeDb } from "@/lib/fit/__fixtures__/fake-db";
import { buildDismissalCorrection } from "@/lib/fit/feedback/correction";
import { correctionView, loadCorrectionsFor, loadPendingProposals, loadWrongTypeDismissals, openProposal, pendingProposals, priorCorrectionFor, sortCorrections, type DismissalSignal } from "@/lib/fit/feedback/load";
import type { CorrectionRow, NewCorrectionRow } from "@/lib/fit/judge/corrections";
import { TRIALIST } from "@/lib/fit/judge/test-fixtures";

const dismissalRow = (over: Partial<CorrectionRow> = {}): CorrectionRow => ({
  id: "c-1",
  target: "investigator_profile",
  target_id: "inv-lupus",
  path: "paradigm.recent.clinical_trials",
  from_value: 0.81,
  to_value: 0.15,
  evidence: { ids: [], quote: null, section: null, confidence: "high", pair: { investigator_id: "inv-lupus", opportunity_id: "opp-sle" }, via: "dismissal", dismissal: { reason: "wrong_research_type", axis_reason: "paradigm:clinical_trials", suggestion_id: "sug-1", item_id: "item-1", by: "u1", at: "2026-09-06T10:00:00.000Z" } },
  kind: "profile_weight",
  proposed_by: "strategist",
  status: "proposed",
  decided_by: null,
  created_at: "2026-09-06T10:00:00.000Z",
  decided_at: null,
  ...over,
});

const judgeRow = (over: Partial<CorrectionRow> = {}): CorrectionRow => dismissalRow({ id: "c-j", target: "opportunity_profile", target_id: "opp-sle", path: "paradigm.required.human_biospecimen", from_value: null, to_value: 1, evidence: { ids: ["PMID:31000001"], quote: "Applications must use human biospecimens.", section: "Section I", confidence: "high", pair: { investigator_id: "inv-lupus", opportunity_id: "opp-sle" }, via: "reconciler" }, kind: "misread_requirement", proposed_by: "judge", ...over });

const signal = (over: Partial<DismissalSignal> = {}): DismissalSignal => ({ suggestionId: "sug-1", itemId: "item-1", opportunityId: "opp-sle", noticeTitle: "SLE trials", axisReason: "paradigm:clinical_trials", dismissedBy: "u1", dismissedAt: "2026-09-06T10:00:00.000Z", ...over });

describe("feedback/load · correctionView and order", () => {
  it("a dismissal-proposed row names the dismissal; a judge row its quote; values print to two decimals; proposed sorts first, newest first within a status", () => {
    const d = correctionView(dismissalRow());
    expect(d).toMatchObject({ pathLabel: "Paradigm · Clinical trials", from: "0.81", to: "0.15", kind: "profile_weight", proposedBy: "strategist", status: "proposed", via: "dismissal" });
    expect(d.evidenceLine).toBe("wrong research type · paradigm:clinical_trials · dismissed 2026-09-06");
    const j = correctionView(judgeRow());
    expect(j).toMatchObject({ via: "judge", from: "—", to: "1.00", proposedBy: "judge" });
    expect(j.evidenceLine).toBe("“Applications must use human biospecimens.” — Section I");
    const ids = correctionView(judgeRow({ evidence: { ids: ["PMID:1", "NCT1"], quote: null, section: null, confidence: "medium", pair: null } }));
    expect(ids.evidenceLine).toBe("cites PMID:1, NCT1");
    const sorted = sortCorrections([dismissalRow({ id: "a", status: "applied", created_at: "2026-09-09" }), dismissalRow({ id: "p-old", created_at: "2026-09-01" }), dismissalRow({ id: "r", status: "rejected", created_at: "2026-09-10" }), dismissalRow({ id: "p-new", created_at: "2026-09-05" })]);
    expect(sorted.map((r) => r.id)).toEqual(["p-new", "p-old", "a", "r"]);
  });
});

describe("feedback/load · pendingProposals (pure)", () => {
  const base = { investigatorId: "inv-lupus", profile: TRIALIST, proposedBy: "strategist" as const };

  it("a dismissal with no correction on its paths is pending, with the rows a confirmation writes — both paradigm views as one proposal", () => {
    const r = pendingProposals({ ...base, signals: [signal()], existing: [] });
    expect(r.skipped).toEqual([]);
    expect(r.pending).toHaveLength(1);
    expect(r.pending[0]!.rows.map((row) => row.path)).toEqual(["paradigm.recent.clinical_trials", "paradigm.career.clinical_trials"]);
    expect(r.pending[0]!.rows[0]).toMatchObject({ path: "paradigm.recent.clinical_trials", from_value: 0.81, to_value: 0.15, status: "proposed", proposed_by: "strategist", evidence: { via: "dismissal", dismissal: { suggestion_id: "sug-1", item_id: "item-1", by: "u1" }, pair: { opportunity_id: "opp-sle" } } });
    expect(r.pending[0]!.rows[1]).toMatchObject({ path: "paradigm.career.clinical_trials", from_value: 0.7, to_value: 0.15 });
    expect(r.pending[0]!.preview.sentence).toMatch(/^Lower Clinical trials \(paradigm\) from 0\.81 to 0\.15 in the recent view and from 0\.70 to 0\.15 in the career view/);
  });

  it("an open or applied correction on every path, or a rejection of this very dismissal on any, makes it not pending; a rejection of another dismissal does not", () => {
    const career = (over: Partial<CorrectionRow> = {}) => dismissalRow({ id: "c-career", path: "paradigm.career.clinical_trials", from_value: 0.7, ...over });
    expect(pendingProposals({ ...base, signals: [signal()], existing: [dismissalRow(), career()] }).skipped).toMatchObject([{ reason: "already proposed" }]);
    expect(pendingProposals({ ...base, signals: [signal()], existing: [dismissalRow({ status: "applied" }), career({ status: "applied" })] }).skipped).toMatchObject([{ reason: "already applied" }]);
    expect(pendingProposals({ ...base, signals: [signal()], existing: [dismissalRow({ status: "rejected" })] }).skipped).toMatchObject([{ reason: "rejected before on this dismissal" }]);
    expect(pendingProposals({ ...base, signals: [signal()], existing: [career({ status: "rejected" })] }).skipped).toMatchObject([{ reason: "rejected before on this dismissal" }]);
    const other = dismissalRow({ status: "rejected", evidence: { ...dismissalRow().evidence, dismissal: { ...dismissalRow().evidence.dismissal!, suggestion_id: "sug-0" } } });
    expect(pendingProposals({ ...base, signals: [signal()], existing: [other] }).pending[0]!.rows).toHaveLength(2);
    // a judge correction on another path never blocks
    expect(pendingProposals({ ...base, signals: [signal()], existing: [judgeRow()] }).pending[0]!.rows).toHaveLength(2);
  });

  it("dedupes per path: an open correction on one view leaves the other view pending, with the preview narrowed to it", () => {
    const r = pendingProposals({ ...base, signals: [signal()], existing: [dismissalRow({ id: "c-career", path: "paradigm.career.clinical_trials", from_value: 0.7, proposed_by: "judge", evidence: { ids: ["PMID:1", "PMID:2"], quote: "q", section: null, confidence: "high", pair: null, via: "reconciler" } })] });
    expect(r.skipped).toEqual([]);
    expect(r.pending[0]!.rows.map((row) => row.path)).toEqual(["paradigm.recent.clinical_trials"]);
    expect(r.pending[0]!.preview).toMatchObject({ path: "paradigm.recent.clinical_trials", paths: ["paradigm.recent.clinical_trials"], sentence: "Lower Clinical trials (paradigm, recent view) from 0.81 to 0.15 on the fit profile?" });
    // openProposal is the rule behind it
    const built = buildDismissalCorrection({ investigatorId: "inv-lupus", profile: TRIALIST, axisReason: "paradigm:clinical_trials", proposedBy: "strategist", dismissal: dismissalRow().evidence.dismissal!, pair: null });
    if (!built.ok) throw new Error(built.reason);
    const open = openProposal(built, [dismissalRow({ status: "applied" })]);
    expect(open.rows.map((row) => row.path)).toEqual(["paradigm.career.clinical_trials"]);
    expect(open.prior?.id).toBe("c-1");
    expect(open.rejected).toBeNull();
    expect(open.preview?.sentence).toBe("Lower Clinical trials (paradigm, career view) from 0.70 to 0.15 on the fit profile?");
    const closed = openProposal(built, [dismissalRow(), dismissalRow({ id: "c-2", path: "paradigm.career.clinical_trials" })]);
    expect(closed.rows).toEqual([]);
    expect(closed.preview).toBeNull();
  });

  it("two dismissals naming the same category collapse to the newest; a sub-reason that proposes nothing is skipped with why", () => {
    const r = pendingProposals({ ...base, signals: [signal({ suggestionId: "sug-2" }), signal({ suggestionId: "sug-1" }), signal({ suggestionId: "sug-3", axisReason: "materials" }), signal({ suggestionId: "sug-4", axisReason: "paradigm:epidemiology" })], existing: [] });
    expect(r.pending.map((p) => p.signal.suggestionId)).toEqual(["sug-2"]);
    expect(r.skipped.map((s) => [s.signal.suggestionId, s.reason])).toEqual([
      ["sug-1", "a newer dismissal already proposes this edit"],
      ["sug-3", expect.stringMatching(/names an axis but no category/)],
      ["sug-4", expect.stringMatching(/does not carry/)],
    ]);
  });

  it("priorCorrectionFor matches on target, id and path only among open, applied and same-dismissal rejections", () => {
    const row: NewCorrectionRow = pendingProposals({ ...base, signals: [signal()], existing: [] }).pending[0]!.rows[0]!;
    expect(priorCorrectionFor(row, [dismissalRow({ path: "paradigm.recent.translational" })])).toBeNull();
    expect(priorCorrectionFor(row, [dismissalRow({ target_id: "someone-else" })])).toBeNull();
    expect(priorCorrectionFor(row, [dismissalRow()])?.id).toBe("c-1");
  });
});

describe("feedback/load · loaders (fake client)", () => {
  const suggestions = [
    { id: "sug-1", item_id: "item-1", investigator_id: "inv-lupus", status: "dismissed", dismissed_reason: "wrong_research_type", axis_reason: "paradigm:clinical_trials", dismissed_by: "u1", dismissed_at: "2026-09-06T10:00:00.000Z", outreach_items: { opportunity_id: "opp-sle", funding_opportunities: { title: "SLE trials" } } },
    { id: "sug-2", item_id: "item-2", investigator_id: "inv-lupus", status: "dismissed", dismissed_reason: "wrong_research_type", axis_reason: null, dismissed_by: "u1", dismissed_at: "2026-09-05T10:00:00.000Z", outreach_items: { opportunity_id: "opp-2", funding_opportunities: null } },
    { id: "sug-3", item_id: "item-3", investigator_id: "inv-lupus", status: "dismissed", dismissed_reason: "not_relevant", axis_reason: null, dismissed_by: "u1", dismissed_at: "2026-09-04T10:00:00.000Z", outreach_items: null },
    { id: "sug-4", item_id: "item-4", investigator_id: "someone", status: "dismissed", dismissed_reason: "wrong_research_type", axis_reason: "paradigm:clinical_trials", dismissed_by: "u1", dismissed_at: "2026-09-03T10:00:00.000Z", outreach_items: null },
    { id: "sug-5", item_id: "item-5", investigator_id: "inv-lupus", status: "active", dismissed_reason: null, axis_reason: null, dismissed_by: null, dismissed_at: null, outreach_items: null },
  ];

  it("loadWrongTypeDismissals: the investigator's wrong-type dismissals that name a sub-reason, newest first, with the notice", async () => {
    const db = fakeDb({ outreach_suggestions: suggestions });
    const r = await loadWrongTypeDismissals(db, "inv-lupus");
    expect(r).toEqual({ available: true, error: null, rows: [{ suggestionId: "sug-1", itemId: "item-1", opportunityId: "opp-sle", noticeTitle: "SLE trials", axisReason: "paradigm:clinical_trials", dismissedBy: "u1", dismissedAt: "2026-09-06T10:00:00.000Z" }] });
    expect(db.log.reads).toEqual(["outreach_suggestions:id, item_id, axis_reason, dismissed_by, dismissed_at, outreach_items(opportunity_id, funding_opportunities(title))"]);
  });

  it("loadCorrectionsFor: rows for the target as the inspector shows them; the missing table is 'unavailable'", async () => {
    const db = fakeDb({ fit_corrections: [dismissalRow(), judgeRow(), dismissalRow({ id: "c-2", target_id: "someone" })] });
    const r = await loadCorrectionsFor(db, "investigator_profile", "inv-lupus");
    expect(r.available).toBe(true);
    expect(r.rows.map((c) => c.id)).toEqual(["c-1"]);
    expect(await loadCorrectionsFor(fakeDb({ fit_corrections: null }), "investigator_profile", "inv-lupus")).toEqual({ available: false, rows: [], error: null });
  });

  it("loadPendingProposals: three reads at most — dismissals, then corrections and the profile — and none past the first when there is no wrong-type dismissal", async () => {
    const db = fakeDb({ outreach_suggestions: suggestions, fit_corrections: [judgeRow()], investigator_fit_profiles: [{ investigator_id: "inv-lupus", profile: TRIALIST }] });
    const r = await loadPendingProposals(db, "inv-lupus", "strategist");
    expect(r.available).toBe(true);
    expect(r.profiled).toBe(true);
    expect(r.pending.map((p) => [p.signal.suggestionId, p.rows.map((row) => row.path), p.rows[0]!.proposed_by])).toEqual([["sug-1", ["paradigm.recent.clinical_trials", "paradigm.career.clinical_trials"], "strategist"]]);
    expect(db.log.reads).toHaveLength(3);

    const none = fakeDb({ outreach_suggestions: suggestions.filter((s) => s.investigator_id !== "inv-lupus"), fit_corrections: [], investigator_fit_profiles: [] });
    expect(await loadPendingProposals(none, "inv-lupus", "investigator")).toMatchObject({ pending: [], skipped: [], available: true, profiled: false });
    expect(none.log.reads).toHaveLength(1);

    const decided = fakeDb({ outreach_suggestions: suggestions, fit_corrections: [dismissalRow(), dismissalRow({ id: "c-2", path: "paradigm.career.clinical_trials", from_value: 0.7 })], investigator_fit_profiles: [{ investigator_id: "inv-lupus", profile: TRIALIST }] });
    expect((await loadPendingProposals(decided, "inv-lupus", "investigator")).pending).toEqual([]);

    const noTable = fakeDb({ outreach_suggestions: suggestions, fit_corrections: null, investigator_fit_profiles: [] });
    expect((await loadPendingProposals(noTable, "inv-lupus", "strategist")).available).toBe(false);
  });
});
