import { describe, expect, it } from "vitest";
import { TARGETS } from "@/lib/fit/goldset/metrics";
import { forbiddenCellPairs } from "@/lib/fit/engine/fixtures";
import { recalibrationParameters, type ParameterVector, type RecalibrationParameter } from "@/lib/fit/recalibrate/parameters";
import { forbiddenMass, marginalAgreementRule, minLabelsDecision, objectiveOf, OBJECTIVE_WEIGHTS, search, wrongTypeMass, type FittedPair, type TierAssignment } from "@/lib/fit/recalibrate/search";
import type { Tier } from "@/lib/fit/types";

const all = recalibrationParameters(forbiddenCellPairs());
const subset = (ids: readonly string[]): RecalibrationParameter[] => all.filter((p) => ids.includes(p.id));

/**
 * Six pairs, hand-derived (labels: two Strong-side, two Moderate-side, one
 * unlabeled, one in a forbidden cell). Legacy shows two Strong.
 */
const pairs: FittedPair[] = [
  { id: "s1", label: "strong", forbidden: false, wrong_type: false, legacy: "strong" },
  { id: "s2", label: "poor", forbidden: false, wrong_type: false, legacy: "strong" },
  { id: "m1", label: "moderate", forbidden: false, wrong_type: false, legacy: "moderate" },
  { id: "m2", label: "exploratory", forbidden: false, wrong_type: false, legacy: "moderate" },
  { id: "u1", label: null, forbidden: false, wrong_type: false, legacy: "poor" },
  { id: "f1", label: "poor", forbidden: true, wrong_type: false, legacy: "poor" },
];

const assign = (t: Record<string, Tier>): TierAssignment => new Map(Object.entries(t));
const base = { forbidden_baseline: 0, wrong_type_baseline: 0 };

/** What the engine says today: two Strong (one wrong), two Moderate (one wrong). */
const A = assign({ s1: "strong", s2: "strong", m1: "moderate", m2: "moderate", u1: "poor", f1: "poor" });
/** Both wrong recommendations dropped, one unlabeled pair promoted: precision 100 %, but the Strong list halves. */
const B = assign({ s1: "strong", s2: "exploratory", m1: "moderate", m2: "poor", u1: "moderate", f1: "poor" });
/** Everything recommended, the forbidden cell included. */
const C = assign({ s1: "strong", s2: "strong", m1: "strong", m2: "strong", u1: "strong", f1: "strong" });

describe("the objective", () => {
  it("is net agreement minus the §14 target shortfall, scaled by the pairs at stake (hand-derived)", () => {
    const o = objectiveOf(pairs, A, base);
    expect(o.agreement.strong).toMatchObject({ shown: 2, labeled: 2, agree: 1, disagree: 1, rate: 0.5, pool: 1 });
    expect(o.agreement.moderate).toMatchObject({ shown: 2, labeled: 2, agree: 1, disagree: 1, rate: 0.5, pool: 1 });
    expect(o.net).toBe(0);
    // 20 · (2 · (0.85 − 0.50) + 2 · (0.70 − 0.50)) = 22 — the shortfall is charged per labeled pair at the tier
    expect(o.penalties.targets).toBeCloseTo(22, 10);
    expect(o.forbidden_mass).toBe(0);
    expect(o.wrong_type_mass).toBe(0);
    expect(o.objective).toBeCloseTo(-22, 10);
  });

  it("counts a Strong recommendation as agreeing only on a Strong label", () => {
    const o = objectiveOf(pairs, A, base);
    expect(o.agreement.strong.rule).toBe("labeled Strong");
    expect(o.agreement.moderate.rule).toBe("labeled Moderate or better");
    // m1 is labeled Moderate: it agrees at Moderate …
    expect(objectiveOf(pairs, assign({ ...Object.fromEntries(A), m1: "moderate" } as Record<string, Tier>), base).agreement.moderate.agree).toBe(1);
    // … and disagrees at Strong, which is what stops a free promotion.
    const lifted = assign({ s1: "strong", s2: "strong", m1: "strong", m2: "strong", u1: "poor", f1: "poor" });
    expect(objectiveOf(pairs, lifted, base).agreement.strong).toMatchObject({ shown: 4, labeled: 4, agree: 1, disagree: 3 });
  });

  it("scores promoting every recommended pair to Strong strictly worse than the truthful assignment", () => {
    // The gaming move the old objective priced at zero: the same pairs, all
    // recommended, only relabelled Strong. `net` alone did not move.
    const promoted = assign({ s1: "strong", s2: "strong", m1: "strong", m2: "strong", u1: "poor", f1: "poor" });
    const truthful = objectiveOf(pairs, A, base);
    const gamed = objectiveOf(pairs, promoted, base);
    expect(gamed.distribution.strong + gamed.distribution.moderate).toBe(truthful.distribution.strong + truthful.distribution.moderate);
    expect(gamed.net).toBeLessThan(truthful.net);
    expect(gamed.objective).toBeLessThan(truthful.objective);
    expect(gamed.objective).toBeCloseTo(-64, 10); // net −2, targets 20 · 4 · 0.60 + 20 · 1 · 0.70 = 62
  });

  it("charges a full shortfall for a recommended tier the engine empties", () => {
    // Moderate is empty under `lifted`: it has no rate, so the old shortfall
    // was 0 and emptying a tier switched its target off.
    const lifted = assign({ s1: "strong", s2: "strong", m1: "strong", m2: "strong", u1: "poor", f1: "poor" });
    const o = objectiveOf(pairs, lifted, base);
    expect(o.agreement.moderate).toMatchObject({ shown: 0, labeled: 0, rate: null, pool: 1 });
    // 20 · pool 1 · the whole 0.70 target
    expect(o.penalties.targets - 20 * 4 * (TARGETS.strong_precision - 0.25)).toBeCloseTo(14, 10);
  });

  it("reports the 30 % Strong-list rule without pricing it", () => {
    const o = objectiveOf(pairs, B, base);
    expect(o.net).toBe(2);
    expect(o.penalties.targets).toBe(0); // both rates are 1.00
    // one Strong against legacy's two — reported, and no longer a penalty
    expect(o.strong_list).toMatchObject({ fit_v1: 1, legacy: 2, ratio: 0.5, applicable: true });
    expect(Object.keys(o.penalties).sort()).toEqual(["forbidden", "targets", "wrong_type"]);
    expect(o.objective).toBeCloseTo(2, 10);
  });

  it("charges any change in the forbidden-cell mass", () => {
    const o = objectiveOf(pairs, C, base);
    expect(o.net).toBe(-3); // Strong shows 5 labeled pairs, only s1 labeled Strong
    expect(o.forbidden_mass).toBe(1);
    expect(o.penalties.forbidden).toBe(10);
    // and symmetrically: closing a cell that was open is a change too
    expect(objectiveOf(pairs, A, { ...base, forbidden_baseline: 1 }).penalties.forbidden).toBe(10);
  });

  it("charges the rest of §14's wrong-type rate, one-sided", () => {
    // A Clinical-Trial-Required notice recommended to a bench investigator is
    // structurally wrong-type without sitting in any forbidden family cell.
    const withWrongType: FittedPair[] = pairs.map((p) => (p.id === "m2" ? { ...p, wrong_type: true } : p));
    expect(wrongTypeMass(withWrongType, A)).toBe(1);
    expect(forbiddenMass(withWrongType, A)).toBe(0);
    expect(objectiveOf(withWrongType, A, base).penalties.wrong_type).toBe(OBJECTIVE_WEIGHTS.wrong_type_mass_increase);
    // showing fewer of them than the shipped values did is never penalized
    expect(objectiveOf(withWrongType, B, { ...base, wrong_type_baseline: 1 }).penalties.wrong_type).toBe(0);
  });

  it("skips the Strong-list rule when legacy has no Strong pair in scope", () => {
    const synthetic = pairs.map((p) => ({ ...p, legacy: null }));
    const o = objectiveOf(synthetic, B, base);
    expect(o.strong_list).toMatchObject({ legacy: 0, ratio: null, applicable: false, scope: 0 });
  });

  it("counts the forbidden mass only over recommended pairs", () => {
    expect(forbiddenMass(pairs, A)).toBe(0);
    expect(forbiddenMass(pairs, C)).toBe(1);
  });
});

describe("the §14 targets bind at any set size", () => {
  /** A tier below its target: 40 pairs at Strong, 20 of them labeled Strong. */
  const block = (n: number, agreeing: number) => {
    const set: FittedPair[] = [];
    const at: Record<string, Tier> = {};
    const without: Record<string, Tier> = {};
    for (let i = 0; i < 40; i += 1) {
      set.push({ id: `b${i}`, label: i < 20 ? "strong" : "poor", forbidden: false, wrong_type: false, legacy: null });
      at[`b${i}`] = "strong";
      without[`b${i}`] = "strong";
    }
    for (let i = 0; i < n; i += 1) {
      set.push({ id: `c${i}`, label: i < agreeing ? "strong" : "poor", forbidden: false, wrong_type: false, legacy: null });
      at[`c${i}`] = "strong";
      without[`c${i}`] = "poor";
    }
    return objectiveOf(set, assign(at), base).objective - objectiveOf(set, assign(without), base).objective;
  };

  it("takes a block of pairs into Strong at the same agreeing share whatever the set size", () => {
    const rule = marginalAgreementRule(TARGETS.strong_precision);
    expect(rule).toBeCloseTo(18 / 22, 10); // (1 + 20 · 0.85) / (2 + 20) = 81.8 %
    for (const n of [60, 120, 200]) {
      const over = Math.floor(n * rule) + 1;
      expect(block(n, over)).toBeGreaterThan(0);
      expect(block(n, over - 1)).toBeLessThan(0);
      // the exact linear form the rule comes from: 22 · agreeing − 18 · n
      expect(block(n, over)).toBeCloseTo(22 * over - 18 * n, 10);
    }
  });

  it("states the Moderate rule too", () => {
    expect(marginalAgreementRule(TARGETS.moderate_precision)).toBeCloseTo(15 / 22, 10); // 68.2 %
  });
});

describe("coordinate descent", () => {
  /** A toy engine: one parameter decides which assignment comes back. */
  const evaluateOnStrongP = (values: ParameterVector): TierAssignment => (values["tiers.strong.P"]! <= 0.65 ? B : A);

  it("moves the parameter that improves the objective and stops when a cycle changes nothing", () => {
    const params = subset(["tiers.strong.P", "tiers.moderate.T"]);
    const result = search(params, pairs, evaluateOnStrongP, { max_cycles: 5 });
    expect(result.before.objective).toBeCloseTo(-22, 10);
    expect(result.after.objective).toBeCloseTo(2, 10);
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

  it("measures the forbidden-cell and wrong-type masses against the shipped assignment", () => {
    const withWrongType: FittedPair[] = pairs.map((p) => (p.id === "u1" ? { ...p, wrong_type: true } : p));
    const result = search(subset(["tiers.strong.P"]), withWrongType, evaluateOnStrongP, { max_cycles: 5 });
    expect(result.before.wrong_type_baseline).toBe(0); // u1 is Poor under the shipped values …
    expect(result.after.wrong_type_mass).toBe(1); // … and Moderate under the proposal
    expect(result.after.penalties.wrong_type).toBe(OBJECTIVE_WEIGHTS.wrong_type_mass_increase);
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
