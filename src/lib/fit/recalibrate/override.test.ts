import { describe, expect, it } from "vitest";
import { scorePair } from "@/lib/fit/engine";
import { forbiddenCellPairs, loadAdversarialCases } from "@/lib/fit/engine/fixtures";
import { isTaxonomyOverrideActive, numberAtPath, pathSegments, readTaxonomyNumber, withTaxonomyOverrides } from "@/lib/fit/recalibrate/override";
import { overridesFor, recalibrationParameters, shippedVector } from "@/lib/fit/recalibrate/parameters";
import { familyCompat, floors, levelCompat, paradigmGates } from "@/lib/fit/taxonomy";

const params = recalibrationParameters(forbiddenCellPairs());
const shipped = shippedVector(params);
const cases = new Map(loadAdversarialCases().map((c) => [c.id, c]));

/** Every accessor the recalibration parameters reach, read through the public taxonomy API. */
const live = () => ({
  strongP: floors("strong").P,
  strongT: floors("strong").T,
  moderateP: floors("moderate").P,
  exploratoryP: floors("exploratory").P,
  aspiration: floors("exploratory").P_with_aspiration,
  discoveryClinical: familyCompat("discovery", "clinical"),
  clinicalDiscovery: familyCompat("clinical", "discovery"),
  l1l3: levelCompat("L1", "L3"),
  l3l1: levelCompat("L3", "L1"),
  gate: paradigmGates().poor_below,
});

const SHIPPED = live();

describe("paths", () => {
  it("reads bracket and dotted paths the same way", () => {
    expect(pathSegments("paradigm.family_compat.matrix[0][3]")).toEqual(["paradigm", "family_compat", "matrix", "0", "3"]);
    expect(readTaxonomyNumber("paradigm.family_compat.matrix[0][3]")).toBe(readTaxonomyNumber("paradigm.family_compat.matrix.0.3"));
    expect(readTaxonomyNumber("tiers.strong.P")).toBe(SHIPPED.strongP);
  });

  it("throws for a path that is absent or does not hold a number", () => {
    expect(() => readTaxonomyNumber("tiers.strong.nope")).toThrow(/does not hold a finite number/);
    expect(() => readTaxonomyNumber("tiers.strong")).toThrow(/does not hold a finite number/);
    expect(() => readTaxonomyNumber("tiers.strong.E")).toThrow(/does not hold a finite number/);
    expect(() => readTaxonomyNumber("")).toThrow(/empty taxonomy path/);
  });

  it("reads a parsed candidate the same way it reads the live taxonomy", () => {
    const parsed = { tiers: { strong: { P: 0.9 } } };
    expect(numberAtPath(parsed, "tiers.strong.P")).toBe(0.9);
  });
});

describe("withTaxonomyOverrides", () => {
  it("makes the accessors return the candidate values inside, and the shipped ones after", () => {
    const inside = withTaxonomyOverrides(
      [
        { paths: ["tiers.strong.P"], value: 0.6 },
        { paths: ["paradigm.family_compat.matrix[0][3]", "paradigm.family_compat.matrix[3][0]"], value: 0.5 },
        { paths: ["unit.level_compat.matrix[0][2]", "unit.level_compat.matrix[2][0]"], value: 0.9 },
        { paths: ["paradigm.gates.poor_below"], value: 0.15 },
      ],
      () => {
        expect(isTaxonomyOverrideActive()).toBe(true);
        return live();
      }
    );
    expect(inside.strongP).toBe(0.6);
    expect(inside.discoveryClinical).toBe(0.5);
    expect(inside.clinicalDiscovery).toBe(0.5); // the mirror moves with it
    expect(inside.l1l3).toBe(0.9);
    expect(inside.l3l1).toBe(0.9);
    expect(inside.gate).toBe(0.15);
    expect(live()).toEqual(SHIPPED);
    expect(isTaxonomyOverrideActive()).toBe(false);
  });

  it("restores the shipped values even when the callback throws", () => {
    expect(() =>
      withTaxonomyOverrides([{ paths: ["tiers.strong.P"], value: 0.9 }], () => {
        expect(floors("strong").P).toBe(0.9);
        throw new Error("boom");
      })
    ).toThrow("boom");
    expect(live()).toEqual(SHIPPED);
    expect(isTaxonomyOverrideActive()).toBe(false);
  });

  it("re-runs the engine under the candidate values and leaves production untouched", () => {
    const c = cases.get("5_lupus_trialist_vs_sle_trial")!;
    const before = scorePair(c.investigator, c.opportunity, c.ctx);
    expect(before.tier).toBe("strong");
    const under = withTaxonomyOverrides([{ paths: ["tiers.strong.T"], value: 0.9 }], () => scorePair(c.investigator, c.opportunity, c.ctx));
    expect(under.tier).not.toBe("strong");
    expect(under.provenance.floors.unmet.map((u) => u.key)).toContain("T");
    const after = scorePair(c.investigator, c.opportunity, c.ctx);
    expect(after).toEqual(before);
    expect(live()).toEqual(SHIPPED);
  });

  it("re-runs the gates: a wider matrix cell lifts a gated pair off the paradigm gate", () => {
    const c = cases.get("1_tcell_lab_vs_survivorship_epi")!;
    const before = scorePair(c.investigator, c.opportunity, c.ctx);
    expect(before.caps).toContain("paradigm_gate");
    const under = withTaxonomyOverrides(
      [
        { paths: ["paradigm.family_compat.matrix[0][4]", "paradigm.family_compat.matrix[4][0]"], value: 0.5 },
        { paths: ["unit.level_compat.matrix[0][3]", "unit.level_compat.matrix[3][0]"], value: 0.5 },
        { paths: ["tiers.exploratory.T"], value: 0.25 },
      ],
      () => scorePair(c.investigator, c.opportunity, c.ctx)
    );
    expect(under.components.P).toBeGreaterThan(before.components.P);
    expect(under.caps).not.toContain("paradigm_gate");
    expect(under.tier).toBe("exploratory");
    expect(scorePair(c.investigator, c.opportunity, c.ctx)).toEqual(before);
  });

  it("accepts the empty override — the shipped vector changes nothing", () => {
    expect(overridesFor(params, shipped)).toEqual([]);
    expect(withTaxonomyOverrides(overridesFor(params, shipped), () => floors("strong").P)).toBe(SHIPPED.strongP);
  });

  it("refuses to nest, to write twice, to write a non-number and to leave [0, 1]", () => {
    expect(() => withTaxonomyOverrides([], () => withTaxonomyOverrides([], () => 1))).toThrow(/does not nest/);
    expect(isTaxonomyOverrideActive()).toBe(false);
    expect(() => withTaxonomyOverrides([{ paths: ["tiers.strong.P"], value: 0.5 }, { paths: ["tiers.strong.P"], value: 0.6 }], () => 1)).toThrow(/overridden twice/);
    expect(() => withTaxonomyOverrides([{ paths: ["tiers.strong.P"], value: Number.NaN }], () => 1)).toThrow(/not a finite number/);
    expect(() => withTaxonomyOverrides([{ paths: ["tiers.strong.P"], value: 1.5 }], () => 1)).toThrow(/outside \[0, 1\]/);
    expect(() => withTaxonomyOverrides([{ paths: [], value: 0.5 }], () => 1)).toThrow(/names no path/);
    expect(() => withTaxonomyOverrides([{ paths: ["tiers.strong.nope"], value: 0.5 }], () => 1)).toThrow(/does not hold a finite number/);
    expect(live()).toEqual(SHIPPED);
  });

  it("refuses to build the parameter set inside an override (its `current` would be a candidate)", () => {
    withTaxonomyOverrides([{ paths: ["tiers.strong.P"], value: 0.6 }], () => {
      expect(() => recalibrationParameters(forbiddenCellPairs())).toThrow(/inside a taxonomy override/);
    });
  });
});
