/**
 * The §12 fit: coordinate descent over the parameter set (`parameters.ts`)
 * against the adjudicated labels (plan Phase 4; spec §12 "Periodically,
 * globally" — "a handful of parameters fit to a few hundred labels — a
 * spreadsheet-scale problem, deliberately").
 *
 * OBJECTIVE. What the spec asks for is agreement with the strategist on what
 * the engine RECOMMENDS: "≥ 85 % of Strong and ≥ 70 % of Moderate labels
 * agree". Precision alone is degenerate — an engine that recommends nothing
 * has nothing to disagree with — so the objective counts pairs, not rates:
 *
 *   net = (agreeing Strong + agreeing Moderate) − (disagreeing Strong + disagreeing Moderate)
 *
 * over the labeled pairs, with "agreeing" read exactly as `goldset/metrics.ts`
 * reads tier precision (a Strong or Moderate label agrees; Exploratory or
 * Poor disagrees). Every labeled-Strong pair the engine lifts into the
 * recommended list adds one; every wrong recommendation costs one. Rates
 * enter as CONSTRAINTS, as penalties in pair-equivalents:
 *
 *   targets       missing §14's 0.85 / 0.70 tier precision costs
 *                 `target_shortfall` per point of shortfall
 *   Strong list   §14 "Rollout comparison": fit-v1's Strong list may not be
 *                 more than 30 % shorter than legacy's. Below the 0.70 ratio
 *                 costs `strong_list_shortfall` per point (over the pairs the
 *                 legacy engine actually saw; not applicable when legacy has
 *                 no Strong pair in scope)
 *   forbidden     ANY change in the forbidden-cell mass shown (§14: it
 *                 "should be zero") costs `forbidden_mass_change` per pair.
 *                 A fit may not buy agreement by opening a forbidden cell,
 *                 and may not quietly close one either: that is a judgment
 *                 about the matrix a person makes, not a search
 *
 *   objective = net − penalties
 *
 * SEARCH. Coordinate descent: one parameter at a time over its grid
 * (`gridValues`), taking the best improving value for that parameter, then
 * the next parameter, cycling until a whole cycle improves nothing or the
 * evaluation cap is reached. Candidates that break a constraint
 * (`violations`) are never evaluated. Deterministic: parameters in
 * parameter-set order, values nearest the current one first, ties to the
 * lower value, and a move must beat the incumbent by `min_improvement`.
 *
 * Coordinate descent, not a full grid: 44 parameters at 5–9 values each is
 * 10^40 vectors. It finds a local optimum, which is the right ambition for
 * a few hundred labels — the report prints the trace so a reviewer sees
 * every step, and the proposal is never applied automatically.
 *
 * Pure: the engine is re-run by the caller's `evaluate`, which the script
 * builds over `withTaxonomyOverrides` (`override.ts`).
 */
import { RECOMMENDED, TARGETS } from "@/lib/fit/goldset/metrics";
import { deltas as parameterDeltas, gridValues, shippedVector, violations, type ParameterDelta, type ParameterVector, type RecalibrationParameter } from "@/lib/fit/recalibrate/parameters";
import type { Tier } from "@/lib/fit/types";

/** One pair the fit is scored on. `label` null = unlabeled (it still counts for the Strong list and the forbidden-cell mass). */
export type FittedPair = {
  id: string;
  label: Tier | null;
  /** The pair sits in one of §14's forbidden family cells. */
  forbidden: boolean;
  /** The legacy engine's tier, mapped to the fit tiers; null when legacy never saw the pair (a synthetic or fixture pair has no vector). */
  legacy: Tier | null;
};

/** The engine's tier per pair id under one parameter vector; null when the pair could not be scored. */
export type TierAssignment = ReadonlyMap<string, Tier | null>;

/** Re-runs the engine under a candidate vector. The script's implementation wraps `scorePair` in `withTaxonomyOverrides`. */
export type Evaluate = (values: ParameterVector) => TierAssignment;

/** Penalty weights, in pair-equivalents (see the module docstring). */
export const OBJECTIVE_WEIGHTS = {
  /** Per point of tier-precision shortfall under §14's targets, summed over Strong and Moderate. */
  target_shortfall: 20,
  /** Per point of Strong-list ratio under §14's 0.70. */
  strong_list_shortfall: 20,
  /** Per pair of change — in either direction — in the forbidden-cell mass shown. */
  forbidden_mass_change: 10,
} as const;

export type ObjectiveWeights = typeof OBJECTIVE_WEIGHTS;

export type AgreementRow = {
  tier: Tier;
  /** Pairs the engine puts at this tier. */
  shown: number;
  labeled: number;
  agree: number;
  disagree: number;
  rate: number | null;
  target: number;
};

export type ObjectiveBreakdown = {
  objective: number;
  net: number;
  agreement: { strong: AgreementRow; moderate: AgreementRow };
  penalties: { targets: number; strong_list: number; forbidden: number };
  strong_list: { fit_v1: number; legacy: number; ratio: number | null; scope: number; applicable: boolean };
  forbidden_mass: number;
  forbidden_baseline: number;
  distribution: Record<string, number>;
  labeled: number;
  scored: number;
};

const agrees = (label: Tier): boolean => (RECOMMENDED as readonly string[]).includes(label);

const isRecommended = (t: Tier | null): boolean => t !== null && (RECOMMENDED as readonly string[]).includes(t);

const rateOf = (num: number, den: number): number | null => (den > 0 ? num / den : null);

function agreementRow(tier: Tier, pairs: readonly FittedPair[], tiers: TierAssignment, target: number): AgreementRow {
  let shown = 0;
  let labeled = 0;
  let agree = 0;
  for (const p of pairs) {
    if (tiers.get(p.id) !== tier) continue;
    shown += 1;
    if (!p.label) continue;
    labeled += 1;
    if (agrees(p.label)) agree += 1;
  }
  return { tier, shown, labeled, agree, disagree: labeled - agree, rate: rateOf(agree, labeled), target };
}

export type ObjectiveOptions = {
  /** The forbidden-cell mass shown at the shipped values; any change from it is penalized. */
  forbidden_baseline: number;
  weights?: ObjectiveWeights;
};

/** Pure. The objective and every number behind it, for one tier assignment. */
export function objectiveOf(pairs: readonly FittedPair[], tiers: TierAssignment, opts: ObjectiveOptions): ObjectiveBreakdown {
  const w = opts.weights ?? OBJECTIVE_WEIGHTS;
  const strong = agreementRow("strong", pairs, tiers, TARGETS.strong_precision);
  const moderate = agreementRow("moderate", pairs, tiers, TARGETS.moderate_precision);
  const net = strong.agree + moderate.agree - strong.disagree - moderate.disagree;

  const shortfall = (row: AgreementRow) => (row.rate === null ? 0 : Math.max(0, row.target - row.rate));
  const targets = w.target_shortfall * (shortfall(strong) + shortfall(moderate));

  const scope = pairs.filter((p) => p.legacy !== null);
  const legacyStrong = scope.filter((p) => p.legacy === "strong").length;
  const fitStrong = scope.filter((p) => tiers.get(p.id) === "strong").length;
  const ratio = rateOf(fitStrong, legacyStrong);
  const strongList = ratio === null ? 0 : w.strong_list_shortfall * Math.max(0, TARGETS.strong_list_ratio_min - ratio);

  const forbidden_mass = pairs.filter((p) => p.forbidden && isRecommended(tiers.get(p.id) ?? null)).length;
  const forbidden = w.forbidden_mass_change * Math.abs(forbidden_mass - opts.forbidden_baseline);

  const distribution: Record<string, number> = { strong: 0, moderate: 0, exploratory: 0, poor: 0, unscored: 0 };
  for (const p of pairs) distribution[tiers.get(p.id) ?? "unscored"] = (distribution[tiers.get(p.id) ?? "unscored"] ?? 0) + 1;

  return {
    objective: net - targets - strongList - forbidden,
    net,
    agreement: { strong, moderate },
    penalties: { targets, strong_list: strongList, forbidden },
    strong_list: { fit_v1: fitStrong, legacy: legacyStrong, ratio, scope: scope.length, applicable: ratio !== null },
    forbidden_mass,
    forbidden_baseline: opts.forbidden_baseline,
    distribution,
    labeled: pairs.filter((p) => p.label !== null).length,
    scored: pairs.filter((p) => tiers.get(p.id) != null).length,
  };
}

/** Pure. The forbidden-cell mass shown under one tier assignment (the baseline the objective compares against). */
export const forbiddenMass = (pairs: readonly FittedPair[], tiers: TierAssignment): number => pairs.filter((p) => p.forbidden && isRecommended(tiers.get(p.id) ?? null)).length;

export type SearchOptions = {
  max_cycles?: number;
  max_evaluations?: number;
  min_improvement?: number;
  weights?: ObjectiveWeights;
};

export const SEARCH_DEFAULTS = { max_cycles: 8, max_evaluations: 1500, min_improvement: 1e-9 } as const;

export type TraceRow = {
  step: number;
  cycle: number;
  /** Null on the first and last rows (the baseline and the outcome). */
  parameter: string | null;
  from: number | null;
  to: number | null;
  objective: number;
  evaluations: number;
  note: string;
};

export type SearchResult = {
  values: ParameterVector;
  before: ObjectiveBreakdown;
  after: ObjectiveBreakdown;
  deltas: ParameterDelta[];
  trace: TraceRow[];
  cycles: number;
  evaluations: number;
  /** A whole cycle improved nothing. */
  converged: boolean;
  /** The evaluation cap stopped the search. */
  capped: boolean;
};

/**
 * Coordinate descent from the shipped values. `evaluate` re-runs the engine;
 * every call is counted against `max_evaluations` (the baseline included).
 */
export function search(params: readonly RecalibrationParameter[], pairs: readonly FittedPair[], evaluate: Evaluate, opts: SearchOptions = {}): SearchResult {
  const maxCycles = opts.max_cycles ?? SEARCH_DEFAULTS.max_cycles;
  const maxEvaluations = opts.max_evaluations ?? SEARCH_DEFAULTS.max_evaluations;
  const minImprovement = opts.min_improvement ?? SEARCH_DEFAULTS.min_improvement;

  let values: ParameterVector = shippedVector(params);
  let evaluations = 0;
  const run = (v: ParameterVector, baseline: number): ObjectiveBreakdown => {
    evaluations += 1;
    return objectiveOf(pairs, evaluate(v), { forbidden_baseline: baseline, weights: opts.weights });
  };

  // The baseline scores itself: the forbidden-cell mass it shows is what any
  // change is measured against.
  evaluations += 1;
  const baselineTiers = evaluate(values);
  const forbidden_baseline = forbiddenMass(pairs, baselineTiers);
  const before = objectiveOf(pairs, baselineTiers, { forbidden_baseline, weights: opts.weights });

  const trace: TraceRow[] = [{ step: 0, cycle: 0, parameter: null, from: null, to: null, objective: before.objective, evaluations, note: "shipped taxonomy" }];
  let best = before.objective;
  let cycles = 0;
  let capped = false;
  let converged = false;

  for (let cycle = 1; cycle <= maxCycles && !capped; cycle += 1) {
    cycles = cycle;
    let improved = false;
    for (const p of params) {
      let bestValue: number | null = null;
      let bestObjective = best;
      for (const v of gridValues(p)) {
        const candidate: ParameterVector = { ...values, [p.id]: v };
        if (violations(params, candidate).length) continue;
        if (evaluations >= maxEvaluations) {
          capped = true;
          break;
        }
        const outcome = run(candidate, forbidden_baseline);
        if (outcome.objective > bestObjective + minImprovement) {
          bestObjective = outcome.objective;
          bestValue = v;
        }
      }
      if (bestValue !== null) {
        trace.push({ step: trace.length, cycle, parameter: p.id, from: values[p.id]!, to: bestValue, objective: bestObjective, evaluations, note: `${p.label}` });
        values = { ...values, [p.id]: bestValue };
        best = bestObjective;
        improved = true;
      }
      if (capped) break;
    }
    if (!improved) {
      converged = !capped;
      break;
    }
  }

  const after = run(values, forbidden_baseline);
  trace.push({
    step: trace.length,
    cycle: cycles,
    parameter: null,
    from: null,
    to: null,
    objective: after.objective,
    evaluations,
    note: capped ? `stopped at the evaluation cap (${maxEvaluations})` : converged ? "converged: a whole cycle improved nothing" : `stopped at the cycle cap (${maxCycles})`,
  });

  return { values, before, after, deltas: parameterDeltas(params, values), trace, cycles, evaluations, converged, capped };
}

export type MinLabelsDecision = { fit: boolean; message: string };

/** The `--min-labels` rule: below it the script reports and fits nothing (spec §12 recalibrates "whenever ≥ 50 new tier labels accumulate"). */
export function minLabelsDecision(labeled: number, min: number): MinLabelsDecision {
  if (labeled < min) return { fit: false, message: `${labeled} labels, below --min-labels ${min}; nothing to fit` };
  return { fit: true, message: `${labeled} labels, at or above --min-labels ${min}; fitting` };
}
