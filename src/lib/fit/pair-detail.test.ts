/**
 * "Why this suggestion" (PR 3.2b): the components against the floors of the
 * tier above, the caps as reasons, and the four things the row stopped
 * printing — coded MeSH matches, required designs with no support, methods,
 * and the eligibility rules quoted in the notice's own words.
 */
import { describe, expect, it } from "vitest";
import { hasRawId } from "@/lib/fit/inspect/display-labels";
import { componentRows, detailsBy, eligibilityNotes, floorFor, floorRows, NEXT_TIER_UP, pairDetail } from "@/lib/fit/pair-detail";
import type { FitResultDetailRow } from "@/lib/fit/results";

const detail = (over: Partial<FitResultDetailRow> = {}): FitResultDetailRow => ({
  investigator_id: "p1",
  opportunity_id: "n1",
  tier: "exploratory",
  score: 41.5,
  computed_at: "2026-09-06T09:45:00Z",
  engine_version: "fit-v1",
  components: { E: 1, P: 0.62, U: 0.8, D: 0.1, T: 0.18, M: 0.5, O: 0.4, K: 0.2, A: 0.9 },
  caps: ["design_required_unsupported", "readiness_far"],
  flags: ["mechanism far above readiness; consider as project lead, not PI"],
  gap: null,
  why_not: null,
  e_failed: null,
  e_unknown: ['citizenship rule not evaluated: "Applicants must be U.S. citizens or permanent residents."'],
  p_view: "recent",
  p_best_pair: { investigator: "clinical_observational", notice: "clinical_trials" },
  p_excluded: null,
  p_exception: null,
  u_best_pair: { investigator: "L3", notice: "L3" },
  d_unmet: [["rct", "early_phase_trial", "pragmatic_trial"]],
  d_prohibited: null,
  t_coded: [{ code: "C20.111.197", depth: 3 }],
  t_items: ["publication:p1:31000001"],
  m_met: ["flow cytometry"],
  m_missing: ["single-cell RNA sequencing"],
  k_held: ["K23"],
  k_code: "R01",
  floors_tier: "exploratory",
  floors_unmet: [
    { key: "T", value: 0.18, floor: 0.35 },
    { key: "D_required_group_min", value: 0.1, floor: 0.4 },
  ],
  collaborators: ["7a2e0000-2222-4333-8444-555566667777"],
  ...over,
});

describe("pair-detail · components against the floors of the tier above", () => {
  it("measures an Exploratory pair against Moderate, and a Strong pair against nothing", () => {
    expect(NEXT_TIER_UP).toEqual({ poor: "exploratory", exploratory: "moderate", moderate: "strong", strong: null });
    expect(pairDetail(detail()).measuredAgainst).toBe("moderate");
    expect(pairDetail(detail({ tier: "strong", floors_tier: "strong" })).measuredAgainst).toBeNull();
  });

  it("gives the eight scored components in §8 order, floors only where a tier sets one", () => {
    const rows = componentRows({ E: 1, P: 0.62, U: 0.8, D: 0.1, T: 0.18, M: 0.5, O: 0.4, K: 0.2, A: 0.9 }, "moderate");
    expect(rows.map((r) => r.key)).toEqual(["P", "U", "D", "T", "M", "O", "K", "A"]);
    expect(rows.find((r) => r.key === "O")).toMatchObject({ floor: null, met: null });
    expect(rows.find((r) => r.key === "A")).toMatchObject({ floor: null, met: null });
    const t = rows.find((r) => r.key === "T")!;
    expect(t.floor).toBe(floorFor("moderate", "T"));
    expect(t.met).toBe(t.value >= t.floor!);
    // a component the row does not carry reads as 0, never as NaN
    expect(componentRows(null, "strong").every((r) => Number.isFinite(r.value))).toBe(true);
    expect(componentRows({ P: 4 }, null).find((r) => r.key === "P")!.value).toBe(1);
  });

  it("names the missed floors rather than keying them", () => {
    expect(floorRows([{ key: "T", value: 0.18, floor: 0.35 }, { key: "D_required_group_min", value: 0.1, floor: 0.4 }])).toEqual([
      { key: "T", label: "Topic", value: 0.18, floor: 0.35 },
      { key: "D_required_group_min", label: "Every required design group", value: 0.1, floor: 0.4 },
    ]);
    expect(floorRows(null)).toEqual([]);
  });
});

describe("pair-detail · everything the row stopped printing", () => {
  const d = pairDetail(detail());

  it("reads the caps as reasons, not as ids", () => {
    expect(d.caps).toEqual(["A required study design has no support in the evidence", "The mechanism is far above the track record on file"]);
    for (const c of d.caps) expect(hasRawId(c)).toBe(false);
  });

  it("reads the paradigm and unit pairs, the designs and the methods as labels", () => {
    expect(d.paradigm).toMatchObject({ pair: "Clinical observational → Clinical trials", view: "recent work only", excluded: null, exception: null });
    expect(d.unit).toBe("L3 · human individual → L3 · human individual");
    expect(d.design.unmet).toEqual(["Randomized controlled trial or Early-phase trial or Pragmatic trial"]);
    expect(d.methods).toEqual({ met: ["flow cytometry"], missing: ["single-cell RNA sequencing"] });
    expect(d.track).toEqual({ held: ["K23"], activityCode: "R01" });
  });

  it("keeps the MeSH codes with their depth, and the notice's eligibility words verbatim", () => {
    expect(d.topic.codes).toEqual([{ code: "C20.111.197", depth: 3 }]);
    expect(eligibilityNotes({ e_failed: ["ESI-only notice; investigator has held an R01-equivalent award"], e_unknown: ['not evaluated: "See Section III."'] })).toEqual([
      { kind: "failed", text: "ESI-only notice; investigator has held an R01-equivalent award" },
      { kind: "unchecked", text: 'not evaluated: "See Section III."' },
    ]);
    expect(d.eligibility[0]!.text).toContain("U.S. citizens or permanent residents");
  });

  it("keeps the flags and the collaborator ids for the surface to resolve", () => {
    expect(d.flags).toEqual(["mechanism far above readiness; consider as project lead, not PI"]);
    expect(d.collaborators).toEqual(["7a2e0000-2222-4333-8444-555566667777"]);
  });

  it("is total on a Poor row's stub provenance", () => {
    const poor = pairDetail(detail({ tier: "poor", floors_tier: "poor", p_best_pair: null, u_best_pair: null, d_unmet: null, t_coded: null, m_met: null, m_missing: null, k_held: null, k_code: null, e_unknown: null, collaborators: null, floors_unmet: null }));
    expect(poor).toMatchObject({ tierWord: "Poor", measuredAgainst: "exploratory", floorsMissed: [], collaborators: [] });
    expect(poor.paradigm.pair).toBeNull();
    expect(poor.unit).toBeNull();
    expect(poor.design.unmet).toEqual([]);
    expect(poor.topic.codes).toEqual([]);
  });
});

describe("pair-detail · detailsBy", () => {
  it("keys by whichever id varies on the surface reading it", () => {
    const rows = [detail(), detail({ investigator_id: "p2", opportunity_id: "n2" })];
    expect([...detailsBy(rows, "opportunity_id").keys()]).toEqual(["n1", "n2"]);
    expect([...detailsBy(rows, "investigator_id").keys()]).toEqual(["p1", "p2"]);
  });
});
