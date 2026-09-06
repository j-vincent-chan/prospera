import { describe, expect, it } from "vitest";
import { unit, unitSupport } from "@/lib/fit/engine/unit";
import { hydrateInvestigator, hydrateOpportunity, type FixtureOpportunity } from "@/lib/fit/engine/fixtures";
import { levelCompat, TaxonomyError } from "@/lib/fit/taxonomy";

const opp = (fx: FixtureOpportunity) => hydrateOpportunity("o", fx);

describe("stage 3 · unit of analysis (§7 stage 3; §4 level matrix)", () => {
  it("support = max over investigator levels of w_i · compat(i, o)", () => {
    // Fixture case 3: {L3 0.90, L4 0.40} vs required L4 → max(0.90 · compat(L3, L4) 0.55 = 0.495, 0.40 · 1.00) = 0.495
    const r = unitSupport({ L3: 0.9, L4: 0.4 }, opp({ unit: { required: ["L4"] } }));
    expect(r.U).toBeCloseTo(0.9 * levelCompat("L3", "L4"), 10);
    expect(r.U).toBeCloseTo(0.495, 10);
    expect(r.best_pair).toEqual({ investigator: "L3", notice: "L4" });
    expect(r.requirement).toBe("required");
  });

  it("required levels are all-of (mean); required_any is any-of (max)", () => {
    // {L1 0.9, L3 0.55}: support(L1) = 0.9; support(L3) = max(0.9 · compat(L1, L3) 0.50 = 0.45, 0.55) = 0.55
    const all = unitSupport({ L1: 0.9, L3: 0.55 }, opp({ unit: { required: ["L1", "L3"] } }));
    expect(all.U).toBeCloseTo((0.9 + 0.55) / 2, 10);
    const any = unitSupport({ L1: 0.9, L3: 0.55 }, opp({ unit: { required: [], required_any: ["L1", "L3"] } }));
    expect(any.U).toBeCloseTo(0.9, 10);
    expect(any.terms[0]).toMatchObject({ any_of: true, best: { investigator: "L1", notice: "L1" } });
  });

  it("falls back to the allowed set as any-of and to U = 1 with no unit requirement", () => {
    const allowed = unitSupport({ L4: 0.8 }, opp({ unit: { required: [], allowed: ["L3", "L5"] } }));
    expect(allowed.requirement).toBe("allowed");
    expect(allowed.U).toBeCloseTo(0.8 * Math.max(levelCompat("L4", "L3"), levelCompat("L4", "L5")), 10); // 0.8 · 0.60
    expect(unitSupport({ L4: 0.8 }, opp({ unit: { required: [] } }))).toMatchObject({ U: 1, requirement: "none", terms: [], best_pair: null });
  });

  it("dominant level breaks ties by taxonomy order; an empty vector gives U = 0 with no pair", () => {
    expect(unitSupport({ L5: 0.7, L4: 0.7 }, opp({ unit: { required: ["L5"] } })).dominant).toEqual({ level: "L4", weight: 0.7 });
    const empty = unit(hydrateInvestigator("i", { paradigm: { recent: {} } }), opp({ unit: { required: ["L1"] } }));
    expect(empty).toMatchObject({ U: 0, best_pair: null, dominant: null });
  });

  it("an unknown level throws TaxonomyError", () => {
    expect(() => unitSupport({ L9: 0.9 } as never, opp({ unit: { required: ["L1"] } }))).toThrow(TaxonomyError);
  });
});
