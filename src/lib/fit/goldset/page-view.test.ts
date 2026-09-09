import { describe, expect, it } from "vitest";
import { PAIR, SYNTHETIC_PAIR } from "@/lib/fit/goldset/test-fixtures";
import type { GoldLabelRow } from "@/lib/fit/goldset/labels";
import type { ManifestPair } from "@/lib/fit/goldset/manifest";
import { axisCategoryOptions, axisReasonLabel, labeledCsvRows, labelsPageView, parseFilter, reasonLabel } from "@/lib/fit/goldset/page-view";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";
const D = "dddddddd-0000-4000-8000-000000000004";
const PAIR2: ManifestPair = { ...PAIR, id: "g002", opportunity_id: "8b1c6b5e-4e0d-4c2a-9c7f-2f5f6a1b3c4d", stratum: "current", forbidden: false, cell: { investigator: "discovery", notice: "none" } };
const PAIR3: ManifestPair = { ...PAIR, id: "g003", opportunity_id: "9c2d7c6f-5f1e-4d3b-8d8a-3a6a7b2c4d5e", stratum: "random", forbidden: false };
const manifest = { version: "v1", pairs: [PAIR, PAIR2, PAIR3, SYNTHETIC_PAIR] };
const identities = [
  { id: A, email: "a@ucsf.edu", name: "Ann" },
  { id: B, email: "b@ucsf.edu", name: null },
  { id: C, email: "c@ucsf.edu", name: "Cy" },
];
const config = { a: null, b: null, adjudicator: null };

let seq = 0;
function row(over: Partial<GoldLabelRow> & { labeler: string; tier: string; opportunity_id?: string }): GoldLabelRow {
  seq += 1;
  return { id: `r${seq}`, investigator_id: PAIR.investigator_id, synthetic_source: null, opportunity_id: PAIR.opportunity_id, reason: null, axis_reason: null, engine_version: "engine-1", source: "gold", created_at: `2026-09-10T00:00:${String(seq).padStart(2, "0")}.000Z`, ...over };
}

const rows: GoldLabelRow[] = [
  row({ labeler: A, tier: "poor", reason: "wrong_research_type", axis_reason: "paradigm:epidemiology" }),
  row({ labeler: B, tier: "poor", reason: "not_relevant" }),
  row({ labeler: A, tier: "strong", opportunity_id: PAIR2.opportunity_id }),
  row({ labeler: B, tier: "moderate", opportunity_id: PAIR2.opportunity_id }),
  row({ labeler: A, tier: "moderate", opportunity_id: PAIR3.opportunity_id }),
];

describe("goldset/page-view · labelsPageView", () => {
  it("assigns the slots by order of first label, names them, and shows each pair's three slots with the adjudication status", () => {
    const v = labelsPageView({ manifest, rows, identities, config, currentUserId: B, filter: "all" });
    expect(v.assignment.slots).toEqual({ a: A, b: B, adjudicator: null });
    expect(v.slotNames).toEqual({ a: "Ann", b: "b", adjudicator: "unassigned" });
    expect(v.slotInitials).toEqual({ a: "A", b: "B", adjudicator: "U" });
    expect(v.canLabel).toBe(true);
    expect(v.assignment.current).toBe("b");
    const g1 = v.pairs.find((p) => p.pair.id === "g001")!;
    expect(g1.slots.a).toMatchObject({ tier: "poor", tierLabel: "Poor", reasonLabel: "Wrong type of research", axisLabel: "Paradigm · Epidemiology" });
    expect(g1.slots.b).toMatchObject({ tier: "poor", reasonLabel: "Not relevant (topic)", axisLabel: null });
    expect(g1.adjudication).toMatchObject({ status: "agreed", tier: "poor" });
    expect(g1.mine).toMatchObject({ slot: "b", saved: { tier: "poor" } });
    expect(g1.hrefs).toEqual({ investigator: `/investigators/${PAIR.investigator_id}/fit`, notice: `/opportunities/${PAIR.opportunity_id}/fit` });
    expect(g1.canLabel).toBe(true);
    expect(v.pairs.find((p) => p.pair.id === "g002")!.adjudication.status).toBe("unresolved");
    expect(v.pairs.find((p) => p.pair.id === "g003")!.adjudication.status).toBe("pending");
    expect(v.progress).toMatchObject({ total: 4, labeled: { a: 3, b: 2, adjudicator: 0 }, agreed: 1, awaiting_adjudication: 1, pending: 1, unlabeled: 1, resolved: 1 });
    expect(v.strata.map((s) => [s.stratum, s.count])).toEqual([["current", 1], ["adversarial", 2], ["random", 1], ["dropped", 0], ["fit_v1", 0]]);
    expect(v.synthetic).toBe(1);
  });

  it("a synthetic pair has no investigator link; it takes a form and sits on the to-do list, its rows keyed by synthetic_source, and counts in progress and the export", () => {
    const v = labelsPageView({ manifest, rows, identities, config, currentUserId: B, filter: "all" });
    const g90 = v.pairs.find((p) => p.pair.id === "g090")!;
    expect(g90.hrefs.investigator).toBeNull();
    expect(g90.hrefs.notice).toBe(`/opportunities/${SYNTHETIC_PAIR.opportunity_id}/fit`);
    expect(g90.canLabel).toBe(true);
    expect(v.syntheticAvailable).toBe(true);
    expect(g90.adjudication.status).toBe("unlabeled");
    expect(labelsPageView({ manifest, rows, identities, config, currentUserId: B, filter: "todo" }).pairs.map((p) => p.pair.id)).toContain("g090");
    const synthetic = row({ labeler: A, tier: "poor", reason: "wrong_research_type", axis_reason: "paradigm", investigator_id: null, synthetic_source: SYNTHETIC_PAIR.synthetic_source, opportunity_id: SYNTHETIC_PAIR.opportunity_id });
    const labeled = labelsPageView({ manifest, rows: [...rows, synthetic], identities, config, currentUserId: A, filter: "all" });
    const g90l = labeled.pairs.find((p) => p.pair.id === "g090")!;
    expect(g90l.slots.a).toMatchObject({ tier: "poor", reasonLabel: "Wrong type of research", axisLabel: "Paradigm" });
    expect(g90l.mine).toMatchObject({ slot: "a", saved: { tier: "poor" } });
    expect(g90l.adjudication.status).toBe("pending");
    expect(labeled.progress).toMatchObject({ total: 4, labeled: { a: 4, b: 2, adjudicator: 0 }, pending: 2, unlabeled: 0 });
    expect(labeledCsvRows(manifest, [...rows, synthetic], { a: A, b: B, adjudicator: C })[3]).toMatchObject({ pair_id: "g090", synthetic: "yes", tier_a: "poor", reason_a: "wrong_research_type", axis_reason_a: "paradigm", tier_b: "" });
  });

  it("while fit_labels.synthetic_source is missing a synthetic pair takes no form and leaves the to-do list; real pairs are unaffected", () => {
    const v = labelsPageView({ manifest, rows, identities, config, currentUserId: B, filter: "all", syntheticAvailable: false });
    expect(v.syntheticAvailable).toBe(false);
    expect(v.pairs.find((p) => p.pair.id === "g090")!.canLabel).toBe(false);
    expect(v.pairs.find((p) => p.pair.id === "g001")!.canLabel).toBe(true);
    expect(labelsPageView({ manifest, rows, identities, config, currentUserId: B, filter: "todo", syntheticAvailable: false }).pairs.map((p) => p.pair.id)).toEqual(["g003"]);
  });

  it("a third admin without a configured adjudicator has no slot and is told the adjudicator comes from labelers.json (D4); configured labelers exclude everyone else", () => {
    const third = labelsPageView({ manifest, rows, identities, config, currentUserId: C, filter: "all" });
    expect(third.assignment.current).toBeNull();
    expect(third.canLabel).toBe(false);
    expect(third.cannotLabelReason).toMatch(/Both labeler slots are taken by order of first label.*adjudicator slot exists only when docs\/fit-engine\/goldset\/labelers\.json names it \(D4\).*rebuild and redeploy/);
    const asAdjudicator = labelsPageView({ manifest, rows: [...rows, row({ labeler: C, tier: "strong", opportunity_id: PAIR2.opportunity_id })], identities, config: { a: null, b: null, adjudicator: "c@ucsf.edu" }, currentUserId: C, filter: "all" });
    expect(asAdjudicator.assignment).toMatchObject({ mode: "first_label", slots: { a: A, b: B, adjudicator: C }, current: "adjudicator" });
    expect(asAdjudicator.pairs.find((p) => p.pair.id === "g002")!.adjudication).toMatchObject({ status: "adjudicated", tier: "strong" });
    const fourth = labelsPageView({ manifest, rows, identities, config, currentUserId: D, filter: "all" });
    expect(fourth.canLabel).toBe(false);
    const configured = labelsPageView({ manifest, rows, identities, config: { a: "c@ucsf.edu", b: "b@ucsf.edu", adjudicator: null }, currentUserId: A }, "docs/fit-engine/goldset/labelers.json");
    expect(configured.assignment).toMatchObject({ mode: "configured", slots: { a: C, b: B, adjudicator: null }, current: null, unassigned: [A] });
    expect(configured.cannotLabelReason).toMatch(/configured in docs\/fit-engine\/goldset\/labelers\.json/);
  });

  it("filters: my to-do, disagreements, resolved; the adjudicator's to-do is the disagreements", () => {
    const withAdjudicator = { a: null, b: null, adjudicator: "c@ucsf.edu" };
    expect(labelsPageView({ manifest, rows, identities, config, currentUserId: B, filter: "todo" }).pairs.map((p) => p.pair.id)).toEqual(["g003", "g090"]);
    expect(labelsPageView({ manifest, rows, identities, config: withAdjudicator, currentUserId: C, filter: "todo" }).pairs.map((p) => p.pair.id)).toEqual(["g002"]);
    expect(labelsPageView({ manifest, rows, identities, config, currentUserId: A, filter: "disagreements" }).pairs.map((p) => p.pair.id)).toEqual(["g002"]);
    expect(labelsPageView({ manifest, rows, identities, config, currentUserId: A, filter: "done" }).pairs.map((p) => p.pair.id)).toEqual(["g001"]);
    expect(labelsPageView({ manifest, rows, identities, config, currentUserId: D, filter: "todo" }).shown).toBe(0);
    expect(parseFilter("nope")).toBe("all");
  });

  it("without ?filter= the default is the role's: the to-do list for anyone holding a slot, the whole set for an admin without one; an explicit value still wins and an unknown one is still all", () => {
    // B holds slot b and has saved g001 and g002.
    expect(labelsPageView({ manifest, rows, identities, config, currentUserId: B }).filter).toBe("todo");
    expect(labelsPageView({ manifest, rows, identities, config, currentUserId: B }).pairs.map((p) => p.pair.id)).toEqual(["g003", "g090"]);
    const withAdjudicator = { a: null, b: null, adjudicator: "c@ucsf.edu" };
    expect(labelsPageView({ manifest, rows, identities, config: withAdjudicator, currentUserId: C }).filter).toBe("todo");
    // No slot: the whole set, as before.
    expect(labelsPageView({ manifest, rows, identities, config, currentUserId: D }).filter).toBe("all");
    expect(labelsPageView({ manifest, rows, identities, config, currentUserId: B, filter: "all" }).filter).toBe("all");
    expect(labelsPageView({ manifest, rows, identities, config, currentUserId: B, filter: "nope" }).filter).toBe("all");
    expect(labelsPageView({ manifest, rows, identities, config, currentUserId: B, filter: "" }).filter).toBe("todo");
  });

  it("blind grading: a grader with no row on a pair receives no other slot's label for it, only that one exists, and no adjudicated tier; the adjudicator is exempt and the filters still see the unredacted pairs", () => {
    const withAdjudicator = { a: null, b: null, adjudicator: "c@ucsf.edu" };
    // A labeled g003 and the adjudicator ruled on it; B has no row there.
    const ruled = [...rows, row({ labeler: C, tier: "strong", opportunity_id: PAIR3.opportunity_id })];
    const asB = labelsPageView({ manifest, rows: ruled, identities, config: withAdjudicator, currentUserId: B, filter: "all" });
    const g3 = asB.pairs.find((p) => p.pair.id === "g003")!;
    expect(g3.blind).toBe(true);
    expect(g3.slots.a).toBeNull();
    expect(g3.slots.adjudicator).toBeNull();
    expect(g3.slotLabeled).toEqual({ a: true, b: false, adjudicator: true });
    expect(g3.adjudication).toMatchObject({ tier: null, reason: null, axis_reason: null, by: null });
    expect(JSON.stringify(g3)).not.toContain("strong");
    // Nothing is withheld on a pair B has graded.
    const g1 = asB.pairs.find((p) => p.pair.id === "g001")!;
    expect(g1.blind).toBe(false);
    expect(g1.slots.a).toMatchObject({ tier: "poor" });
    // An unlabeled pair simply has nothing to hide.
    expect(asB.pairs.find((p) => p.pair.id === "g090")!.slotLabeled).toEqual({ a: false, b: false, adjudicator: false });
    // The redaction is applied after filtering, so "done" still means an adjudicated tier.
    expect(labelsPageView({ manifest, rows: ruled, identities, config: withAdjudicator, currentUserId: B, filter: "done" }).pairs.map((p) => p.pair.id)).toEqual(["g001", "g003"]);
    // The adjudicator sees both graders on every pair, graded or not.
    const asC = labelsPageView({ manifest, rows: ruled, identities, config: withAdjudicator, currentUserId: C, filter: "all" });
    const g2 = asC.pairs.find((p) => p.pair.id === "g002")!;
    expect(g2.blind).toBe(false);
    expect(g2.slots.a).toMatchObject({ tier: "strong" });
    expect(g2.slots.b).toMatchObject({ tier: "moderate" });
  });

  it("the focus card's pair: ?pair= when the filter holds it, else the first pair this user has not labeled; an unknown id falls back and an empty filter has none", () => {
    const all = labelsPageView({ manifest, rows, identities, config, currentUserId: B, filter: "all" });
    expect(all.pairs.map((p) => p.pair.id)).toEqual(["g001", "g002", "g003", "g090"]);
    expect([all.currentIndex, all.current?.pair.id]).toEqual([2, "g003"]);
    expect(labelsPageView({ manifest, rows, identities, config, currentUserId: B, filter: "all", pair: "g001" }).currentIndex).toBe(0);
    // Unknown, and outside the filter: the default, not an error.
    expect(labelsPageView({ manifest, rows, identities, config, currentUserId: B, filter: "all", pair: "nope" }).current?.pair.id).toBe("g003");
    expect(labelsPageView({ manifest, rows, identities, config, currentUserId: B, filter: "todo", pair: "g001" }).current?.pair.id).toBe("g003");
    // Everything in view already labeled by this user: the first one.
    expect(labelsPageView({ manifest, rows, identities, config, currentUserId: B, filter: "done" }).current?.pair.id).toBe("g001");
    const empty = labelsPageView({ manifest, rows, identities, config, currentUserId: D, filter: "todo" });
    expect([empty.shown, empty.currentIndex, empty.current]).toEqual([0, -1, null]);
  });

  it("labeledCsvRows fills the slot columns from the latest rows, in manifest order, the synthetic row marked", () => {
    const csv = labeledCsvRows(manifest, rows, { a: A, b: B, adjudicator: C });
    expect(csv.map((r) => r.pair_id)).toEqual(["g001", "g002", "g003", "g090"]);
    expect(csv[0]).toMatchObject({ tier_a: "poor", reason_a: "wrong_research_type", axis_reason_a: "paradigm:epidemiology", tier_b: "poor", reason_b: "not_relevant", tier_adj: "" });
    expect(csv[2]).toMatchObject({ tier_a: "moderate", tier_b: "" });
    expect(csv[3]).toMatchObject({ synthetic: "yes", tier_a: "" });
  });

  it("reason labels come from the taxonomy; an unknown stored id is shown raw", () => {
    expect(reasonLabel("wrong_research_type")).toBe("Wrong type of research");
    expect(reasonLabel("wrong_type")).toBe("wrong_type");
    expect(reasonLabel(null)).toBeNull();
  });

  it("axis labels and the category options", () => {
    expect(axisReasonLabel("paradigm:clinical_trials")).toBe("Paradigm · Clinical trials");
    expect(axisReasonLabel("topic")).toBe("Topic");
    expect(axisReasonLabel(null)).toBeNull();
    const o = axisCategoryOptions();
    expect(o.paradigm).toHaveLength(23);
    expect(o.unit.map((u) => u.id)).toEqual(["L1", "L2", "L3", "L4", "L5"]);
    expect(o.topic).toEqual([]);
    expect(o.materials.find((m) => m.id === "claims_administrative")?.label).toBe("Claims and administrative data");
  });
});
