/**
 * Stage 8 is the judge (Phase 3); this is §8's composite, for ordering only:
 *
 *   C = E · P^p · D^d · U^u          (compatibility — vetoes, multiplicative)
 *   R = wT·T + wM·M + wO·O + wK·K + wA·A   (relevance — trade-offs, additive)
 *   S = 100 · C · R
 *
 * Exponents from `compose.exponents`, weights from `compose.relevance_weights`.
 * S orders; tiers come from floors (tier.ts).
 */
import { composeExponents, relevanceWeights } from "@/lib/fit/taxonomy";
import type { Components } from "@/lib/fit/types";
import { clamp01 } from "@/lib/fit/engine/util";

export type Composite = { C: number; R: number; S: number };

export function compose(c: Components): Composite {
  const e = composeExponents();
  const w = relevanceWeights();
  const C = (c.E > 0 ? 1 : 0) * Math.pow(clamp01(c.P), e.P) * Math.pow(clamp01(c.D), e.D) * Math.pow(clamp01(c.U), e.U);
  const R = w.T * clamp01(c.T) + w.M * clamp01(c.M) + w.O * clamp01(c.O) + w.K * clamp01(c.K) + w.A * clamp01(c.A);
  return { C, R, S: 100 * C * R };
}
