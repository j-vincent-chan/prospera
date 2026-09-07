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
 * over the labeled pairs. "Agreeing" is read PER TIER, and the Strong rule is
 * stricter than `goldset/metrics.ts`'s precision rule on purpose: a pair the
 * engine shows at Strong agrees only when it is LABELED Strong, while a pair
 * shown at Moderate agrees on a Moderate-or-better label (the metrics rule).
 * Reading Strong the way the precision report does — Moderate or better —
 * makes promoting every recommended pair from Moderate to Strong free: `net`
 * does not move, and the search collects whatever the Strong list is worth
 * elsewhere. `metrics.ts` keeps its own rule for the precision report; this
 * is the objective's rule only, and the proposal prints both.
 *
 * Every labeled-Strong pair the engine lifts into the recommended list adds
 * one; every wrong recommendation costs one. The rest of §14 enters as
 * penalties in pair-equivalents:
 *
 *   targets       missing §14's 0.85 / 0.70 tier precision costs
 *                 `target_shortfall` per point of shortfall PER LABELED PAIR
 *                 AT THAT TIER. Unscaled, the term caps at 17 and 14
 *                 pair-equivalents whatever the set size, so on a few hundred
 *                 labels it is a rounding error against `net` and the targets
 *                 stop binding: the marginal rule decays to "accept a block of
 *                 pairs when more than half of it agrees". Scaled, the term is
 *                 `w · (target · labeled − agree)` — linear, scale-free, and
 *                 the marginal rule is a constant `(1 + w · target) / (2 + w)`:
 *                 81.8 % for Strong and 68.2 % for Moderate at `w = 20`, at
 *                 any set size. A tier the engine leaves empty (or fills only
 *                 with unlabeled pairs) has no rate at all; it scores a FULL
 *                 shortfall over the labels the set holds at that tier, so
 *                 emptying a tier does not switch its target off
 *   forbidden     ANY change in the forbidden-cell mass shown (§14: it
 *                 "should be zero") costs `forbidden_mass_change` per pair.
 *                 A fit may not buy agreement by opening a forbidden cell,
 *                 and may not quietly close one either: that is a judgment
 *                 about the matrix a person makes, not a search
 *   wrong type    the four forbidden family cells are only half of §14's
 *                 wrong-type rate: `metrics.ts`'s `isStructuralWrongType`
 *                 also counts a Clinical-Trial-Required notice recommended to
 *                 a discovery or preclinical investigator, which no family
 *                 cell names. Each ADDED structurally wrong-type pair in the
 *                 recommended list costs `wrong_type_mass_increase`. One-sided
 *                 on purpose: §14's ≤ 5 % is a ceiling, so a fit that shows
 *                 fewer of them is simply better, unlike a forbidden cell
 *
 *   objective = net − penalties
 *
 * NOT IN THE OBJECTIVE, reported instead. §14's Strong-list rule ("fit-v1's
 * Strong list may not be more than 30 % shorter than legacy's") is a REPORTED
 * metric here, not a penalty. Priced, it optimizes the label set's Strong/Strong
 * ratio, which `goldset/metrics.ts` and METRICS.md both call the secondary
 * reading — the set over-samples what legacy shows — and §14's rollout rule is
 * a month of side-by-side traffic, not a label count. Priced, it also dominated:
 * in the first fixture run 7.08 of an 11.08 objective gain was this one penalty
 * falling. The proposal prints the grid ratio (the primary reading) beside the
 * set ratio; a reviewer reads them, the search does not chase them. §14's
 * recall floor (≥ 75 % of labeled Strong in Strong or Moderate) is reported
 * the same way.
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

/** One pair the fit is scored on. `label` null = unlabeled (it still counts for the Strong list, the forbidden-cell mass and the wrong-type mass). */
export type FittedPair = {
  id: string;
  label: Tier | null;
  /** The pair sits in one of §14's forbidden family cells. */
  forbidden: boolean;
  /** `goldset/metrics.ts` `isStructuralWrongType`: a bench investigator against a population / health-systems / Clinical-Trial-Required notice. Overlaps `forbidden` without containing it. */
  wrong_type: boolean;
  /** The legacy engine's tier, mapped to the fit tiers; null when legacy never saw the pair (a synthetic or fixture pair has no vector). */
  legacy: Tier | null;
};

/** The engine's tier per pair id under one parameter vector; null when the pair could not be scored. */
export type TierAssignment = ReadonlyMap<string, Tier | null>;

/** Re-runs the engine under a candidate vector. The script's implementation wraps `scorePair` in `withTaxonomyOverrides`. */
export type Evaluate = (values: ParameterVector) => TierAssignment;

/** Penalty weights, in pair-equivalents (see the module docstring). */
export const OBJECTIVE_WEIGHTS = {
  /** Per point of tier-precision shortfall under §14's targets, per labeled pair at that tier, summed over Strong and Moderate. */
  target_shortfall: 20,
  /** Per pair of change — in either direction — in the forbidden-cell mass shown. */
  forbidden_mass_change: 10,
  /** Per pair ADDED to the structurally wrong-type mass shown (§14's ≤ 5 % is a ceiling: showing fewer is never penalized). */
  wrong_type_mass_increase: 10,
} as const;

export type ObjectiveWeights = typeof OBJECTIVE_WEIGHTS;

/** The two recommended tiers, the only ones the objective scores. */
export type RecommendedTier = "strong" | "moderate";

/**
 * Which labels agree with a recommendation AT THIS TIER. Strong is stricter
 * than `goldset/metrics.ts`'s precision rule (see the module docstring):
 * reading Strong as "Moderate or better" makes a Moderate → Strong promotion
 * free, so the search takes it for whatever it is worth elsewhere.
 */
const AGREEMENT_RULE: Record<RecommendedTier, { ok: (label: Tier) => boolean; rule: string }> = {
  strong: { ok: (l) => l === "strong", rule: "labeled Strong" },
  moderate: { ok: (l) => (RECOMMENDED as readonly string[]).includes(l), rule: "labeled Moderate or better" },
};

export type AgreementRow = {
  tier: RecommendedTier;
  /** Pairs the engine puts at this tier. */
  shown: number;
  labeled: number;
  agree: number;
  disagree: number;
  rate: number | null;
  target: number;
  /** Pairs the LABEL SET holds at this tier, whatever the engine does with them: the target's scale when the engine shows nothing labeled here. */
  pool: number;
  /** The agreement rule this row counted by, for the proposal. */
  rule: string;
};

export type ObjectiveBreakdown = {
  objective: number;
  net: number;
  agreement: { strong: AgreementRow; moderate: AgreementRow };
  penalties: { targets: number; forbidden: number; wrong_type: number };
  /** REPORTED, never priced (see the module docstring): §14's Strong-list rule over the label set — the secondary reading. */
  strong_list: { fit_v1: number; legacy: number; ratio: number | null; scope: number; applicable: boolean };
  forbidden_mass: number;
  forbidden_baseline: number;
  wrong_type_mass: number;
  wrong_type_baseline: number;
  distribution: Record<string, number>;
  labeled: number;
  scored: number;
};

const isRecommended = (t: Tier | null): boolean => t !== null && (RECOMMENDED as readonly string[]).includes(t);

const rateOf = (num: number, den: number): number | null => (den > 0 ? num / den : null);

function agreementRow(tier: RecommendedTier, pairs: readonly FittedPair[], tiers: TierAssignment, target: number): AgreementRow {
  const { ok, rule } = AGREEMENT_RULE[tier];
  let shown = 0;
  let labeled = 0;
  let agree = 0;
  let pool = 0;
  for (const p of pairs) {
    if (p.label === tier) pool += 1;
    if (tiers.get(p.id) !== tier) continue;
    shown += 1;
    if (!p.label) continue;
    labeled += 1;
    if (ok(p.label)) agree += 1;
  }
  return { tier, shown, labeled, agree, disagree: labeled - agree, rate: rateOf(agree, labeled), target, pool, rule };
}

export type ObjectiveOptions = {
  /** The forbidden-cell mass shown at the shipped values; any change from it is penalized. */
  forbidden_baseline: number;
  /** The structurally wrong-type mass shown at the shipped values; only an increase over it is penalized. */
  wrong_type_baseline: number;
  weights?: ObjectiveWeights;
};

/** Pure. The objective and every number behind it, for one tier assignment. */
export function objectiveOf(pairs: readonly FittedPair[], tiers: TierAssignment, opts: ObjectiveOptions): ObjectiveBreakdown {
  const w = opts.weights ?? OBJECTIVE_WEIGHTS;
  const strong = agreementRow("strong", pairs, tiers, TARGETS.strong_precision);
  const moderate = agreementRow("moderate", pairs, tiers, TARGETS.moderate_precision);
  const net = strong.agree + moderate.agree - strong.disagree - moderate.disagree;

  // Scaled by the pairs at stake, so the target grows with the label set
  // instead of capping at 17 and 14 pair-equivalents. A tier with no rate —
  // empty, or filled only with unlabeled pairs — scores a full shortfall over
  // the labels the set holds at that tier, so emptying it is not a way out.
  const shortfall = (row: AgreementRow) => (row.rate === null ? row.target : Math.max(0, row.target - row.rate));
  const scaleOf = (row: AgreementRow) => (row.labeled > 0 ? row.labeled : row.pool);
  const targets = w.target_shortfall * (scaleOf(strong) * shortfall(strong) + scaleOf(moderate) * shortfall(moderate));

  // Reported, not priced: §14's Strong-list rule over the label set.
  const scope = pairs.filter((p) => p.legacy !== null);
  const legacyStrong = scope.filter((p) => p.legacy === "strong").length;
  const fitStrong = scope.filter((p) => tiers.get(p.id) === "strong").length;
  const ratio = rateOf(fitStrong, legacyStrong);

  const forbidden_mass = forbiddenMass(pairs, tiers);
  const forbidden = w.forbidden_mass_change * Math.abs(forbidden_mass - opts.forbidden_baseline);

  const wrong_type_mass = wrongTypeMass(pairs, tiers);
  const wrong_type = w.wrong_type_mass_increase * Math.max(0, wrong_type_mass - opts.wrong_type_baseline);

  const distribution: Record<string, number> = { strong: 0, moderate: 0, exploratory: 0, poor: 0, unscored: 0 };
  for (const p of pairs) distribution[tiers.get(p.id) ?? "unscored"] = (distribution[tiers.get(p.id) ?? "unscored"] ?? 0) + 1;

  return {
    objective: net - targets - forbidden - wrong_type,
    net,
    agreement: { strong, moderate },
    penalties: { targets, forbidden, wrong_type },
    strong_list: { fit_v1: fitStrong, legacy: legacyStrong, ratio, scope: scope.length, applicable: ratio !== null },
    forbidden_mass,
    forbidden_baseline: opts.forbidden_baseline,
    wrong_type_mass,
    wrong_type_baseline: opts.wrong_type_baseline,
    distribution,
    labeled: pairs.filter((p) => p.label !== null).length,
    scored: pairs.filter((p) => tiers.get(p.id) != null).length,
  };
}

/** Pure. The forbidden-cell mass shown under one tier assignment (the baseline the objective compares against). */
export const forbiddenMass = (pairs: readonly FittedPair[], tiers: TierAssignment): number => pairs.filter((p) => p.forbidden && isRecommended(tiers.get(p.id) ?? null)).length;

/** Pure. The structurally wrong-type mass shown under one tier assignment (§14's headline rate; the baseline an increase is measured against). */
export const wrongTypeMass = (pairs: readonly FittedPair[], tiers: TierAssignment): number => pairs.filter((p) => p.wrong_type && isRecommended(tiers.get(p.id) ?? null)).length;

/**
 * Pure. The marginal rule the scaled target penalty implies, for the
 * proposal: a block of pairs added to a tier that is BELOW its target changes
 * the objective by `a · (2 + w) − n · (1 + w · target)`, so the search takes
 * the block only when its agreeing share beats this — a constant, at any set
 * size. Above the target the rule is the bare majority `net` asks for (0.5).
 */
export const marginalAgreementRule = (target: number, weight: number = OBJECTIVE_WEIGHTS.target_shortfall): number => (1 + weight * target) / (2 + weight);

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
  const run = (v: ParameterVector, baselines: Pick<ObjectiveOptions, "forbidden_baseline" | "wrong_type_baseline">): ObjectiveBreakdown => {
    evaluations += 1;
    return objectiveOf(pairs, evaluate(v), { ...baselines, weights: opts.weights });
  };

  // The baseline scores itself: the forbidden-cell mass and the wrong-type
  // mass it shows are what any change is measured against.
  evaluations += 1;
  const baselineTiers = evaluate(values);
  const baselines = { forbidden_baseline: forbiddenMass(pairs, baselineTiers), wrong_type_baseline: wrongTypeMass(pairs, baselineTiers) };
  const before = objectiveOf(pairs, baselineTiers, { ...baselines, weights: opts.weights });

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
        const outcome = run(candidate, baselines);
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

  const after = run(values, baselines);
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
