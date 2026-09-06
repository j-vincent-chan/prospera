/**
 * Stage 4 · study-design compatibility gate + score (spec §7 stage 4; §4
 * Axis C; §9 prohibited-design row).
 *
 *   D = w_required · req + w_allowed · allowed + w_not_prohibited · (1 − prohibited)
 *     req        = min over the notice's required groups (`required_any`,
 *                  `required_any_2`) of the investigator's max support inside
 *                  the group — any-of within a group, all-of across; 1 with
 *                  no required group
 *     allowed    = share of the investigator's design mass inside the
 *                  notice's allowed set — the listed `allowed` designs plus
 *                  every required design (a required design is allowed)
 *     prohibited = share inside the prohibited set
 *
 * A required group with support < `gates.required_group_unsupported_below`
 * is reported in `unmet_required` (tier.ts caps at
 * `gates.required_unsupported_cap_tier`). A prohibited share ≥
 * `gates.prohibited_dominant_share` is a penalty, not a gate:
 * D × `gates.prohibited_penalty_factor`, with the dominant prohibited design
 * named. Weights are read from `design.score`.
 */
import { DESIGN_IDS, designGates, designScoreWeights } from "@/lib/fit/taxonomy";
import type { DesignId, DesignWeights, InvestigatorFitProfile, OpportunityFitProfile } from "@/lib/fit/types";
import { heaviest, mass, weightEntries, weightOf } from "@/lib/fit/engine/util";

export type DesignGroupSupport = { designs: DesignId[]; support: number; best: DesignId | null };

export type DesignResult = {
  D: number;
  req: number;
  allowed_share: number;
  prohibited_share: number;
  /** Σ investigator design weights. */
  mass: number;
  groups: DesignGroupSupport[];
  /** Required groups with support below `gates.required_group_unsupported_below`. */
  unmet_required: DesignId[][];
  dominant_prohibited: DesignId | null;
  penalized: boolean;
  requirement: "required" | "none";
};

/** The stage-4 formula over any design vector. */
export function designSupport(weights: DesignWeights, opp: OpportunityFitProfile): DesignResult {
  const groups: DesignGroupSupport[] = [opp.design.required_any, opp.design.required_any_2]
    .filter((g) => g.length > 0)
    .map((g) => {
      let support = 0;
      let best: DesignId | null = null;
      for (const d of g) {
        const w = weightOf(weights, d);
        if (w > support) {
          support = w;
          best = d;
        }
      }
      return { designs: [...g], support, best };
    });
  const req = groups.length ? Math.min(...groups.map((g) => g.support)) : 1;

  const m = mass(weights);
  const allowedSet = new Set<string>([...opp.design.allowed, ...groups.flatMap((g) => g.designs)]);
  const prohibitedSet = new Set<string>(opp.design.prohibited);
  let allowedMass = 0;
  let prohibitedMass = 0;
  const prohibitedWeights: DesignWeights = {};
  for (const [d, w] of weightEntries(weights)) {
    if (w <= 0) continue;
    if (allowedSet.has(d)) allowedMass += w;
    if (prohibitedSet.has(d)) {
      prohibitedMass += w;
      prohibitedWeights[d] = w;
    }
  }
  const allowed_share = m > 0 ? allowedMass / m : 0;
  const prohibited_share = m > 0 ? prohibitedMass / m : 0;

  const w = designScoreWeights();
  let D = w.w_required * req + w.w_allowed * allowed_share + w.w_not_prohibited * (1 - prohibited_share);

  const gates = designGates();
  let dominant_prohibited: DesignId | null = null;
  let penalized = false;
  if (prohibited_share >= gates.prohibited_dominant_share) {
    penalized = true;
    D *= gates.prohibited_penalty_factor;
    dominant_prohibited = heaviest(prohibitedWeights, DESIGN_IDS)?.id ?? null;
  }
  const unmet_required = groups.filter((g) => g.support < gates.required_group_unsupported_below).map((g) => g.designs);

  return { D, req, allowed_share, prohibited_share, mass: m, groups, unmet_required, dominant_prohibited, penalized, requirement: groups.length ? "required" : "none" };
}

export function design(inv: InvestigatorFitProfile, opp: OpportunityFitProfile): DesignResult {
  return designSupport(inv.design, opp);
}

/**
 * Whether one evidence item's designs are compatible with the notice (stage
 * 5's "compatible items"): some required group is supported at or above the
 * unsupported threshold (or there is none) and prohibited designs do not
 * dominate. An item with no design classification contradicts nothing and
 * is compatible.
 */
export function designCompatible(weights: DesignWeights, opp: OpportunityFitProfile): boolean {
  if (mass(weights) <= 0) return true;
  const r = designSupport(weights, opp);
  const gates = designGates();
  const requiredMet = !r.groups.length || r.groups.some((g) => g.support >= gates.required_group_unsupported_below);
  return requiredMet && r.prohibited_share < gates.prohibited_dominant_share;
}
