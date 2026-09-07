import { describe, expect, it } from "vitest";
import { forbiddenCellPairs } from "@/lib/fit/engine/fixtures";
import { recalibrationParameters, type ParameterVector, type RecalibrationParameter } from "@/lib/fit/recalibrate/parameters";
import { forbiddenMass, minLabelsDecision, objectiveOf, search, type FittedPair, type TierAssignment } from "@/lib/fit/recalibrate/search";
import type { Tier } from "@/lib/fit/types";

const all = recalibrationParameters(forbiddenCellPairs());
const subset = (ids: readonly string[]): RecalibrationParameter[] => all.filter((p) => ids.includes(p.id));

/**
 * Six pairs, hand-derived (labels: two Strong-side, two Moderate-side, one
 * unlabeled, one in a forbidden cell). Legacy shows two Strong.
 */
const pairs: FittedPair[] = [
  { id: "s1", label: "strong", forbidden: false, legacy: "strong" },
  { id: "s2", label: "poor", forbidden: false, legacy: "strong" },
  { id: "m1", label: "moderate", forbidden: false, legacy: "moderate" },
  { id: "m2", label: "exploratory", forbidden: false, legacy: "moderate" },
  { id: "u1", label: null, forbidden: false, legacy: "poor" },
  { id: "f1", label: "poor", forbidden: true, legacy: "poor" },
];

const assign = (t: Record<string, Tier>): TierAssignment => new Map(Object.entries(t));

/** What the engine says today: two Strong (one wrong), two Moderate (one wrong). */
const A = assign({ s1: "strong", s2: "strong", m1: "moderate", m2: "moderate", u1: "poor", f1: "poor" });
/** Both wrong recommendations dropped, one unlabeled pair promoted: precision 100 %, but the Strong list halves. */
const B = assign({ s1: "strong", s2: "exploratory", m1: "moderate", m2: "poor", u1: "moderate", f1: "poor" });
/** Everything recommended, the forbidden cell included. */
const C = assign({ s1: "strong", s2: "strong", m1: "strong", m2: "strong", u1: "strong", f1: "strong" });

describe("the objective", () => {
  it("is net agreement minus the §14 target shortfall (hand-derived)", () => {
    const o = objectiveOf(pairs, A, { forbidden_baseline: 0 });
    expect(o.agreement.strong).toMatchObject({ shown: 2, labeled: 2, agree: 1, disagree: 1, rate: 0.5 });
    expect(o.agreement.moderate).toMatchObject({ shown: 2, labeled: 2, agree: 1, disagree: 1, rate: 0.5 });
    expect(o.net).toBe(0);
    // 20 · ((0.85 − 0.50) + (0.70 − 0.50)) = 11
    expect(o.penalties.targets).toBeCloseTo(11, 10);
    expect(o.strong_list).toMatchObject({ fit_v1: 2, legacy: 2, ratio: 1, applicable: true });
    expect(o.penalties.strong_list).toBe(0);
    expect(o.forbidden_mass).toBe(0);
    expect(o.objective).toBeCloseTo(-11, 10);
  });

  it("charges the 30 % rule when the Strong list shrinks", () => {
    const o = objectiveOf(pairs, B, { forbidden_baseline: 0 });
    expect(o.net).toBe(2);
    expect(o.penalties.targets).toBe(0); // both rates are 1.00
    // one Strong against legacy's two: ratio 0.50, 20 · (0.70 − 0.50) = 4
    expect(o.strong_list.ratio).toBe(0.5);
    expect(o.penalties.strong_list).toBeCloseTo(4, 10);
    expect(o.objective).toBeCloseTo(-2, 10);
  });

  it("charges any change in the forbidden-cell mass", () => {
    const o = objectiveOf(pairs, C, { forbidden_baseline: 0 });
    expect(o.net).toBe(-1); // 2 agreeing, 3 disagreeing
    expect(o.penalties.targets).toBeCloseTo(9, 10); // 20 · (0.85 − 0.40); no Moderate is shown, so no Moderate shortfall
    expect(o.penalties.strong_list).toBe(0); // 6 / 2: longer, not shorter
    expect(o.forbidden_mass).toBe(1);
    expect(o.penalties.forbidden).toBe(10);
    expect(o.objective).toBeCloseTo(-20, 10);
    // and symmetrically: closing a cell that was open is a change too
    expect(objectiveOf(pairs, A, { forbidden_baseline: 1 }).penalties.forbidden).toBe(10);
  });

  it("skips the Strong-list rule when legacy has no Strong pair in scope", () => {
    const synthetic = pairs.map((p) => ({ ...p, legacy: null }));
    const o = objectiveOf(synthetic, B, { forbidden_baseline: 0 });
    expect(o.strong_list).toMatchObject({ legacy: 0, ratio: null, applicable: false, scope: 0 });
    expect(o.penalties.strong_list).toBe(0);
  });

  it("counts the forbidden mass only over recommended pairs", () => {
    expect(forbiddenMass(pairs, A)).toBe(0);
    expect(forbiddenMass(pairs, C)).toBe(1);
  });
});

describe("coordinate descent", () => {
  /** A toy engine: one parameter decides which assignment comes back. */
  const evaluateOnStrongP = (values: ParameterVector): TierAssignment => (values["tiers.strong.P"]! <= 0.65 ? B : A);

  it("moves the parameter that improves the objective and stops when a cycle changes nothing", () => {
    const params = subset(["tiers.strong.P", "tiers.moderate.T"]);
    const result = search(params, pairs, evaluateOnStrongP, { max_cycles: 5 });
    expect(result.before.objective).toBeCloseTo(-11, 10);
    expect(result.after.objective).toBeCloseTo(-2, 10);
    expect(result.values["tiers.strong.P"]).toBe(0.65); // the nearest improving value, not the furthest
    expect(result.values["tiers.moderate.T"]).toBe(0.45); // untouched
    expect(result.deltas.map((d) => [d.parameter.id, d.from, d.to])).toEqual([["tiers.strong.P", 0.75, 0.65]]);
    expect(result.converged).toBe(true);
    expect(result.capped).toBe(false);
    expect(result.cycles).toBe(2); // one cycle to move it, one to find nothing
    expect(result.trace[0]).toMatchObject({ step: 0, parameter: null, note: "shipped taxonomy" });
    expect(result.trace[1]).toMatchObject({ parameter: "tiers.strong.P", from: 0.75, to: 0.65 });
    expect(result.trace[result.trace.length - 1]!.note).toMatch(/converged/);
  });

  it("is deterministic", () => {
    const params = subset(["tiers.strong.P", "tiers.moderate.T"]);
    const a = search(params, pairs, evaluateOnStrongP, { max_cycles: 5 });
    const b = search(params, pairs, evaluateOnStrongP, { max_cycles: 5 });
    expect(b.values).toEqual(a.values);
    expect(b.trace).toEqual(a.trace);
    expect(b.evaluations).toBe(a.evaluations);
  });

  it("stops at the evaluation cap and says so", () => {
    const params = subset(["tiers.strong.P", "tiers.moderate.T"]);
    const result = search(params, pairs, evaluateOnStrongP, { max_evaluations: 3 });
    expect(result.capped).toBe(true);
    expect(result.converged).toBe(false);
    expect(result.evaluations).toBeLessThanOrEqual(4); // the cap, plus the final scoring of the outcome
    expect(result.trace[result.trace.length - 1]!.note).toMatch(/evaluation cap/);
  });

  it("stops at the cycle cap without claiming convergence", () => {
    const result = search(subset(["tiers.strong.P"]), pairs, evaluateOnStrongP, { max_cycles: 1 });
    expect(result.values["tiers.strong.P"]).toBe(0.65);
    expect(result.capped).toBe(false);
    expect(result.converged).toBe(false); // the cycle that would have confirmed it never ran
    expect(result.cycles).toBe(1);
    expect(result.trace[result.trace.length - 1]!.note).toMatch(/cycle cap \(1\)/);
  });

  it("never evaluates a vector that breaks a constraint, however good it would be", () => {
    const params = subset(["paradigm.family_compat.discovery↔population", "paradigm.gates.poor_below"]);
    const seen: number[] = [];
    const perfect = assign({ s1: "strong", s2: "exploratory", m1: "moderate", m2: "poor", u1: "poor", f1: "poor" });
    const evaluate = (values: ParameterVector): TierAssignment => {
      const cell = values["paradigm.family_compat.discovery↔population"]!;
      seen.push(cell);
      return cell >= 0.25 ? perfect : A;
    };
    const result = search(params, pairs, evaluate, { max_cycles: 4 });
    expect(Math.max(...seen)).toBeLessThan(0.25); // the gate is 0.25: the forbidden cell may not reach it
    expect(result.values["paradigm.family_compat.discovery↔population"]).toBe(0.05);
  });
});

describe("--min-labels", () => {
  it("refuses below the minimum, in the words the script prints", () => {
    expect(minLabelsDecision(0, 50)).toEqual({ fit: false, message: "0 labels, below --min-labels 50; nothing to fit" });
    expect(minLabelsDecision(49, 50).fit).toBe(false);
  });

  it("fits at or above it", () => {
    expect(minLabelsDecision(50, 50)).toEqual({ fit: true, message: "50 labels, at or above --min-labels 50; fitting" });
    expect(minLabelsDecision(3, 0).fit).toBe(true);
  });
});
