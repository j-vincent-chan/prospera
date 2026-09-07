import { describe, expect, it } from "vitest";
import { forbiddenCellPairs } from "@/lib/fit/engine/fixtures";
import { numberAtPath, readTaxonomyNumber } from "@/lib/fit/recalibrate/override";
import { deltas, gridValues, isValidVector, overridesFor, parameterById, recalibrationParameters, shippedVector, violations, type ParameterVector } from "@/lib/fit/recalibrate/parameters";
import taxonomy from "@/lib/fit/taxonomy.json";
import { familyCompat, floors, levelCompat, paradigmGates } from "@/lib/fit/taxonomy";

const params = recalibrationParameters(forbiddenCellPairs());
const shipped = shippedVector(params);
const move = (id: string, value: number): ParameterVector => ({ ...shipped, [id]: value });

describe("the parameter set", () => {
  it("is 44 parameters: 18 floors, 15 family cells, 10 unit cells, the paradigm gate", () => {
    expect(params).toHaveLength(44);
    const byKind = (kind: string) => params.filter((p) => p.kind === kind).length;
    expect(byKind("floor")).toBe(18);
    expect(byKind("family_cell")).toBe(15);
    expect(byKind("unit_cell")).toBe(10);
    expect(byKind("gate")).toBe(1);
    expect(new Set(params.map((p) => p.id)).size).toBe(params.length);
  });

  it("names taxonomy paths that exist and hold the value it reports", () => {
    for (const p of params) {
      for (const path of p.paths) expect(numberAtPath(taxonomy, path), `${p.id} ${path}`).toBe(p.current);
    }
  });

  it("reads what the accessors read — floors, both matrices and the gate", () => {
    expect(parameterById(params, "tiers.strong.P").current).toBe(floors("strong").P);
    expect(parameterById(params, "tiers.moderate.T").current).toBe(floors("moderate").T);
    expect(parameterById(params, "tiers.exploratory.P_with_aspiration").current).toBe(floors("exploratory").P_with_aspiration);
    expect(parameterById(params, "paradigm.family_compat.discovery↔clinical").current).toBe(familyCompat("discovery", "clinical"));
    expect(parameterById(params, "unit.level_compat.L1↔L3").current).toBe(levelCompat("L1", "L3"));
    expect(parameterById(params, "paradigm.gates.poor_below").current).toBe(paradigmGates().poor_below);
  });

  it("fits no non-[0,1] floor: the tree depth and the gap count stay out", () => {
    expect(params.some((p) => p.id.endsWith("T_specific_depth"))).toBe(false);
    expect(params.some((p) => p.id.endsWith("gaps_allowed"))).toBe(false);
  });

  it("keeps every current value inside its own range, and every range inside [0, 1]", () => {
    for (const p of params) {
      expect(p.min).toBeLessThanOrEqual(p.current);
      expect(p.max).toBeGreaterThanOrEqual(p.current);
      expect(p.min).toBeGreaterThanOrEqual(0);
      expect(p.max).toBeLessThanOrEqual(1);
      expect(p.step).toBeGreaterThan(0);
    }
  });

  it("gives floors ±0.15, matrix cells ±0.20 and the gate ±0.10, all on a 0.05 grid", () => {
    const strongP = parameterById(params, "tiers.strong.P");
    expect([strongP.min, strongP.max]).toEqual([0.6, 0.9]);
    const cell = parameterById(params, "paradigm.family_compat.discovery↔clinical");
    expect([cell.min, cell.max]).toEqual([0, 0.35]); // 0.15 − 0.20 clamps at 0
    const gate = parameterById(params, "paradigm.gates.poor_below");
    expect([gate.min, gate.max]).toEqual([0.15, 0.35]);
    for (const p of params) for (const v of gridValues(p)) expect(Math.round((v * 100) % 5)).toBe(0);
  });

  it("searches each parameter nearest-first, the current value excluded", () => {
    const gate = parameterById(params, "paradigm.gates.poor_below");
    expect(gridValues(gate)).toEqual([0.2, 0.3, 0.15, 0.35]);
  });

  it("writes both cells of a symmetric matrix parameter", () => {
    const p = parameterById(params, "unit.level_compat.L1↔L4");
    expect(p.paths).toEqual(["unit.level_compat.matrix[0][3]", "unit.level_compat.matrix[3][0]"]);
    expect(overridesFor(params, move(p.id, 0.25))).toEqual([{ paths: p.paths, value: 0.25 }]);
  });

  it("marks the §14 forbidden family cells and no others", () => {
    const forbidden = params.filter((p) => p.forbidden).map((p) => p.id).sort();
    expect(forbidden).toEqual([
      "paradigm.family_compat.discovery↔health_systems",
      "paradigm.family_compat.discovery↔population",
      "paradigm.family_compat.preclinical↔health_systems",
      "paradigm.family_compat.preclinical↔population",
    ]);
  });
});

describe("constraints", () => {
  it("accepts the shipped vector", () => {
    expect(violations(params, shipped)).toEqual([]);
    expect(isValidVector(params, shipped)).toBe(true);
  });

  it("refuses a value off the grid or outside the range", () => {
    expect(violations(params, move("tiers.strong.P", 0.73)).join()).toMatch(/off the 0.05 grid/);
    expect(violations(params, move("tiers.strong.P", 0.95)).join()).toMatch(/outside \[0.6, 0.9\]/);
  });

  it("refuses floors that cross", () => {
    expect(violations(params, { ...shipped, "tiers.strong.T": 0.45, "tiers.moderate.T": 0.5 }).join()).toMatch(/strong T 0.45 is below moderate T 0.5/);
    expect(violations(params, { ...shipped, "tiers.moderate.U": 0.25, "tiers.exploratory.U": 0.3 }).join()).toMatch(/moderate U 0.25 is below exploratory U 0.3/);
    expect(violations(params, move("tiers.strong.T", 0.45))).toEqual([]); // 0.45 = moderate 0.45: equal floors are fine
  });

  it("keeps the aspiration floor at or above the Exploratory P floor", () => {
    expect(violations(params, { ...shipped, "tiers.exploratory.P_with_aspiration": 0.3, "tiers.exploratory.P": 0.4 }).join()).toMatch(/relaxes the floor, never tightens it/);
  });

  it("keeps the paradigm gate at or under the Exploratory P floor", () => {
    expect(violations(params, move("paradigm.gates.poor_below", 0.35)).join()).toMatch(/above the Exploratory P floor 0.25/);
    expect(violations(params, { ...shipped, "paradigm.gates.poor_below": 0.35, "tiers.exploratory.P": 0.4 })).toEqual([]);
  });

  it("keeps every forbidden family cell strictly under the gate, whatever the labels ask", () => {
    expect(violations(params, move("paradigm.family_compat.discovery↔population", 0.25)).join()).toMatch(/reaches the paradigm gate 0.25/);
    expect(violations(params, move("paradigm.family_compat.discovery↔population", 0.2))).toEqual([]);
    // Lowering the gate closes the cell that was legal a moment ago.
    expect(violations(params, { ...shipped, "paradigm.gates.poor_below": 0.2, "paradigm.family_compat.discovery↔population": 0.2 }).join()).toMatch(/reaches the paradigm gate 0.2/);
  });

  it("throws for a vector missing a parameter", () => {
    const partial = { ...shipped };
    delete partial["tiers.strong.P"];
    expect(() => violations(params, partial)).toThrow(/no value for tiers.strong.P/);
  });
});

describe("overrides and deltas", () => {
  it("names only the parameters a vector moves", () => {
    expect(overridesFor(params, shipped)).toEqual([]);
    expect(deltas(params, shipped)).toEqual([]);
    const moved = move("tiers.strong.M", 0.4);
    expect(deltas(params, moved).map((d) => [d.parameter.id, d.from, d.to])).toEqual([["tiers.strong.M", 0.5, 0.4]]);
  });

  it("reads the shipped values, not a stale copy", () => {
    for (const p of params) expect(readTaxonomyNumber(p.paths[0]!)).toBe(shipped[p.id]);
  });
});
