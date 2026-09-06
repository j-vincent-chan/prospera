import { describe, expect, it } from "vitest";
import { PAIR } from "@/lib/fit/goldset/test-fixtures";
import type { GoldLabelRow } from "@/lib/fit/goldset/labels";
import type { ManifestPair } from "@/lib/fit/goldset/manifest";
import { axisCategoryOptions, axisReasonLabel, labeledCsvRows, labelsPageView, parseFilter } from "@/lib/fit/goldset/page-view";
import { parseSaveGoldLabel } from "@/lib/fit/goldset/save";
import { pairKey } from "@/lib/fit/goldset/stratify";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";
const D = "dddddddd-0000-4000-8000-000000000004";
const PAIR2: ManifestPair = { ...PAIR, id: "g002", opportunity_id: "8b1c6b5e-4e0d-4c2a-9c7f-2f5f6a1b3c4d", stratum: "current", forbidden: false, cell: { investigator: "discovery", notice: "none" } };
const PAIR3: ManifestPair = { ...PAIR, id: "g003", opportunity_id: "9c2d7c6f-5f1e-4d3b-8d8a-3a6a7b2c4d5e", stratum: "random", forbidden: false };
const manifest = { version: "v1", pairs: [PAIR, PAIR2, PAIR3] };
const identities = [
  { id: A, email: "a@ucsf.edu", name: "Ann" },
  { id: B, email: "b@ucsf.edu", name: null },
  { id: C, email: "c@ucsf.edu", name: "Cy" },
];
const config = { a: null, b: null, adjudicator: null };

let seq = 0;
function row(over: Partial<GoldLabelRow> & { labeler: string; tier: string; opportunity_id?: string }): GoldLabelRow {
  seq += 1;
  return { id: `r${seq}`, investigator_id: PAIR.investigator_id, opportunity_id: PAIR.opportunity_id, reason: null, axis_reason: null, engine_version: "engine-1", source: "gold", created_at: `2026-09-10T00:00:${String(seq).padStart(2, "0")}.000Z`, ...over };
}

const rows: GoldLabelRow[] = [
  row({ labeler: A, tier: "poor", reason: "wrong_type", axis_reason: "paradigm:epidemiology" }),
  row({ labeler: B, tier: "poor", reason: "not_relevant" }),
  row({ labeler: A, tier: "strong", opportunity_id: PAIR2.opportunity_id }),
  row({ labeler: B, tier: "moderate", opportunity_id: PAIR2.opportunity_id }),
  row({ labeler: A, tier: "moderate", opportunity_id: PAIR3.opportunity_id }),
];

describe("goldset/page-view · labelsPageView", () => {
  it("assigns the slots by order of first label, names them, and shows each pair's three slots with the adjudication status", () => {
    const v = labelsPageView({ manifest, rows, identities, config, currentUserId: B });
    expect(v.assignment.slots).toEqual({ a: A, b: B, adjudicator: null });
    expect(v.slotNames).toEqual({ a: "Ann", b: "b@ucsf.edu", adjudicator: "unassigned" });
    expect(v.canLabel).toBe(true);
    expect(v.assignment.current).toBe("b");
    const g1 = v.pairs.find((p) => p.pair.id === "g001")!;
    expect(g1.slots.a).toMatchObject({ tier: "poor", tierLabel: "Poor", reasonLabel: "Wrong type of research", axisLabel: "Paradigm · Epidemiology" });
    expect(g1.slots.b).toMatchObject({ tier: "poor", reasonLabel: "Not relevant (topic)", axisLabel: null });
    expect(g1.adjudication).toMatchObject({ status: "agreed", tier: "poor" });
    expect(g1.mine).toMatchObject({ slot: "b", saved: { tier: "poor" } });
    expect(g1.hrefs).toEqual({ investigator: `/investigators/${PAIR.investigator_id}/fit`, notice: `/opportunities/${PAIR.opportunity_id}/fit` });
    expect(v.pairs.find((p) => p.pair.id === "g002")!.adjudication.status).toBe("unresolved");
    expect(v.pairs.find((p) => p.pair.id === "g003")!.adjudication.status).toBe("pending");
    expect(v.progress).toMatchObject({ total: 3, labeled: { a: 3, b: 2, adjudicator: 0 }, agreed: 1, awaiting_adjudication: 1, pending: 1, unlabeled: 0, resolved: 1 });
    expect(v.strata.map((s) => [s.stratum, s.count])).toEqual([["current", 1], ["adversarial", 1], ["random", 1], ["dropped", 0]]);
  });

  it("a third admin is the adjudicator; a fourth cannot label and is told why; configured labelers exclude everyone else", () => {
    const third = labelsPageView({ manifest, rows, identities, config, currentUserId: C });
    expect(third.assignment.current).toBe("adjudicator");
    const fourth = labelsPageView({ manifest, rows: [...rows, row({ labeler: C, tier: "strong", opportunity_id: PAIR2.opportunity_id })], identities, config, currentUserId: D });
    expect(fourth.canLabel).toBe(false);
    expect(fourth.cannotLabelReason).toMatch(/All three slots are taken/);
    expect(fourth.pairs.find((p) => p.pair.id === "g002")!.adjudication).toMatchObject({ status: "adjudicated", tier: "strong" });
    const configured = labelsPageView({ manifest, rows, identities, config: { a: "c@ucsf.edu", b: "b@ucsf.edu", adjudicator: null }, currentUserId: A });
    expect(configured.assignment).toMatchObject({ mode: "configured", slots: { a: C, b: B, adjudicator: null }, current: null, unassigned: [A] });
    expect(configured.cannotLabelReason).toMatch(/labelers\.json/);
  });

  it("filters: my to-do, disagreements, resolved; the adjudicator's to-do is the disagreements", () => {
    expect(labelsPageView({ manifest, rows, identities, config, currentUserId: B, filter: "todo" }).pairs.map((p) => p.pair.id)).toEqual(["g003"]);
    expect(labelsPageView({ manifest, rows, identities, config, currentUserId: C, filter: "todo" }).pairs.map((p) => p.pair.id)).toEqual(["g002"]);
    expect(labelsPageView({ manifest, rows, identities, config, currentUserId: A, filter: "disagreements" }).pairs.map((p) => p.pair.id)).toEqual(["g002"]);
    expect(labelsPageView({ manifest, rows, identities, config, currentUserId: A, filter: "done" }).pairs.map((p) => p.pair.id)).toEqual(["g001"]);
    expect(labelsPageView({ manifest, rows: [...rows, row({ labeler: C, tier: "strong", opportunity_id: PAIR2.opportunity_id })], identities, config, currentUserId: D, filter: "todo" }).shown).toBe(0);
    expect(parseFilter("nope")).toBe("all");
  });

  it("labeledCsvRows fills the slot columns from the latest rows, in manifest order", () => {
    const csv = labeledCsvRows(manifest, rows, { a: A, b: B, adjudicator: C });
    expect(csv.map((r) => r.pair_id)).toEqual(["g001", "g002", "g003"]);
    expect(csv[0]).toMatchObject({ tier_a: "poor", reason_a: "wrong_type", axis_reason_a: "paradigm:epidemiology", tier_b: "poor", reason_b: "not_relevant", tier_adj: "" });
    expect(csv[2]).toMatchObject({ tier_a: "moderate", tier_b: "" });
  });

  it("axis labels and the category options", () => {
    expect(axisReasonLabel("paradigm:clinical_trials")).toBe("Paradigm · Clinical trials");
    expect(axisReasonLabel("topic")).toBe("Topic");
    expect(axisReasonLabel(null)).toBeNull();
    const o = axisCategoryOptions();
    expect(o.paradigm).toHaveLength(23);
    expect(o.unit.map((u) => u.id)).toEqual(["L1", "L2", "L3", "L4", "L5"]);
    expect(o.topic).toEqual([]);
    expect(o.materials.find((m) => m.id === "claims_administrative")?.label).toBe("Claims administrative");
  });
});

describe("goldset/save · parseSaveGoldLabel (the action's validation)", () => {
  const byKey = new Map([[pairKey(PAIR.investigator_id, PAIR.opportunity_id), PAIR]]);
  it("needs two UUIDs naming a manifest pair and a valid label", () => {
    expect(parseSaveGoldLabel({ investigatorId: "x", opportunityId: PAIR.opportunity_id, tier: "strong" }, byKey)).toEqual({ ok: false, error: "Invalid investigator id." });
    expect(parseSaveGoldLabel({ investigatorId: PAIR.investigator_id, opportunityId: "y", tier: "strong" }, byKey)).toEqual({ ok: false, error: "Invalid opportunity id." });
    expect(parseSaveGoldLabel({ investigatorId: PAIR.investigator_id, opportunityId: PAIR2.opportunity_id, tier: "strong" }, byKey)).toEqual({ ok: false, error: "This pair is not in the gold set." });
    expect(parseSaveGoldLabel({ investigatorId: PAIR.investigator_id, opportunityId: PAIR.opportunity_id, tier: "poor", reason: "wrong_type" }, byKey)).toMatchObject({ ok: false, error: expect.stringMatching(/axis sub-reason/) });
    expect(parseSaveGoldLabel({ investigatorId: ` ${PAIR.investigator_id} `, opportunityId: PAIR.opportunity_id, tier: "poor", reason: "wrong_type", axisReason: "unit:L4" }, byKey)).toMatchObject({ ok: true, value: { tier: "poor", reason: "wrong_type", axis_reason: "unit:L4", investigator_id: PAIR.investigator_id, pair: PAIR } });
  });
});
