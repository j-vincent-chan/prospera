/**
 * The pure fit engine (plan § PR 2.1; spec §7–§10). `scorePair` takes the
 * two stored profiles and a plain context and returns a `FitResult`: nine
 * components, the caps that bound the tier, the ordering score S, the tier
 * by floors and caps, provenance for every stage, flags, and the gap /
 * "Why not?" / rationale text. No clock, no I/O, no taxonomy mutation; the
 * same inputs give a byte-identical result.
 *
 * Stage order: eligibility (1), unit (3) and design (4) before paradigm (2)
 * because a cross-cutting paradigm takes P from U and D, then topic (5) over
 * the items compatible with the notice, methods (6), objective, track
 * record and actionability (7), compose (§8), tier (9), explain.
 */
import { TAXONOMY_VERSION } from "@/lib/fit/taxonomy";
import type { Components, FitResult, InvestigatorFitProfile, OpportunityFitProfile, ParadigmFamily, ScoreContext } from "@/lib/fit/types";
import { compose } from "@/lib/fit/engine/compose";
import { design } from "@/lib/fit/engine/design";
import { eligibility } from "@/lib/fit/engine/eligibility";
import { explain } from "@/lib/fit/engine/explain";
import { forbiddenCell, forbiddenCellPairs, type ForbiddenCell } from "@/lib/fit/engine/fixtures";
import { methods } from "@/lib/fit/engine/methods";
import { objective } from "@/lib/fit/engine/objective";
import { paradigm } from "@/lib/fit/engine/paradigm";
import { assignTier, type StageResults, type TierResult } from "@/lib/fit/engine/tier";
import { topic } from "@/lib/fit/engine/topic";
import { actionability, track } from "@/lib/fit/engine/track";
import { unit } from "@/lib/fit/engine/unit";
import { uniq } from "@/lib/fit/engine/util";

/** Bumped when a formula changes without a taxonomy change; stored on `fit_results.engine_version` (PR 2.2). */
export const ENGINE_VERSION = "engine-1";

export type { Cap, StageResults, TierResult } from "@/lib/fit/engine/tier";

/** Every stage's output, for callers that want more than the `FitResult` (the inspector, tests). */
export type ScoredPair = { result: FitResult; stages: StageResults; tier: TierResult };

export function scorePairDetailed(inv: InvestigatorFitProfile, opp: OpportunityFitProfile, ctx: ScoreContext): ScoredPair {
  const E = eligibility(inv, opp, ctx);
  const U = unit(inv, opp);
  const D = design(inv, opp);
  const ud = { U: U.U, D: D.D };
  const P = paradigm(inv, opp, ud);
  const T = topic(inv, opp, ctx, ud);
  const M = methods(inv, opp, ctx);
  const O = objective(inv, opp);
  const K = track(inv, opp, ctx);
  const A = actionability(inv, opp, ctx);
  const components: Components = { E: E.E, P: P.P, U: U.U, D: D.D, T: T.T, M: M.M, O: O.O, K: K.K, A: A.A };
  const { S } = compose(components);
  const stages: StageResults = { inv, opp, ctx, components, E, P, U, D, T, M, O, K, A };
  const tier = assignTier(stages);
  const text = explain(stages, tier);

  const result: FitResult = {
    investigator_id: inv.investigator_id,
    opportunity_id: opp.opportunity_id,
    engine_version: ENGINE_VERSION,
    taxonomy_version: TAXONOMY_VERSION,
    computed_at: ctx.now,
    components,
    caps: tier.caps.map((c) => c.id),
    score: S,
    tier: tier.tier,
    provenance: {
      E: { failed: [...E.failed], unknown: [...E.unknown] },
      P: { view: P.view, best_pair: P.best_pair, excluded_hit: P.excluded_hit, exception: tier.exception },
      U: { best_pair: U.best_pair },
      D: { unmet_required: D.unmet_required.map((g) => [...g]), dominant_prohibited: D.dominant_prohibited },
      T: { top_items: [...T.top_items], coded_matches: T.coded.matches.map((m) => ({ ...m })) },
      M: { met: [...M.met], missing: [...M.missing] },
      K: { mechanisms_held: [...K.mechanisms_held], activity_code: K.activity_code },
      A: { ...ctx.actionability },
      floors: { tier_by_floors: tier.tier_by_floors, unmet: tier.unmet },
      collaborators: [...tier.collaborators],
    },
    flags: uniq(tier.flags),
    gap: text.gap,
    why_not: text.why_not,
    rationale: text.rationale,
  };
  return { result, stages, tier };
}

/** Score one investigator–notice pair (spec §7–§10). Pure and deterministic. */
export function scorePair(inv: InvestigatorFitProfile, opp: OpportunityFitProfile, ctx: ScoreContext): FitResult {
  return scorePairDetailed(inv, opp, ctx).result;
}

/**
 * The forbidden family cells (fixture `forbidden_family_cells`): for each
 * [investigator family, notice family] pair a dominant-family investigator
 * at `weight` against a notice requiring the other family at `weight`, with
 * the topic score supplied at `topic`. Every cell must score Poor with
 * `paradigm_gate`.
 */
export function* forbiddenCells(pairs: ReadonlyArray<[ParadigmFamily, ParadigmFamily]> = forbiddenCellPairs(), weight = 0.9, topic = 0.9): Generator<ForbiddenCell> {
  for (const pair of pairs) yield forbiddenCell(pair, weight, topic);
}
