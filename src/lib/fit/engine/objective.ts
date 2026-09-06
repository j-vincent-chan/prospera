/**
 * Scientific-objective alignment (spec §8 O term: "item classifier · 0.15 of
 * R; informative but not disqualifying"). The same weighted-mean form as the
 * gates without a matrix — objectives are flat:
 *
 *   O = Σ w_o · inv_o / Σ w_o over the notice's objectives
 *
 * A notice with no objective has nothing to mismatch: O = 1.
 */
import type { InvestigatorFitProfile, ObjectiveId, OpportunityFitProfile } from "@/lib/fit/types";
import { weightEntries, weightOf } from "@/lib/fit/engine/util";

export type ObjectiveTerm = { objective: ObjectiveId; weight: number; support: number };

export type ObjectiveResult = { O: number; terms: ObjectiveTerm[]; requirement: "required" | "none" };

export function objective(inv: InvestigatorFitProfile, opp: OpportunityFitProfile): ObjectiveResult {
  const terms: ObjectiveTerm[] = weightEntries(opp.objective)
    .filter(([, w]) => w > 0)
    .map(([o, w]) => ({ objective: o, weight: w, support: weightOf(inv.objective, o) }));
  const wsum = terms.reduce((s, t) => s + t.weight, 0);
  const O = terms.length && wsum > 0 ? terms.reduce((s, t) => s + t.weight * t.support, 0) / wsum : 1;
  return { O, terms, requirement: terms.length ? "required" : "none" };
}
