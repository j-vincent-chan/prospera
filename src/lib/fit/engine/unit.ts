/**
 * Stage 3 · unit-of-analysis compatibility gate + score (spec §7 stage 3;
 * §4 level matrix). "Same form" as stage 2 over the five-level matrix:
 *
 *   support(o) = max over investigator levels i of w_i · compat(i, o)
 *   U = mean of support over the notice's required levels (equal weights);
 *   `required_any` is one more term scored by its best member; with no
 *   requirement the allowed set is scored any-of; with nothing, U = 1.
 *
 * The gate (U < `unit.gates.poor_below` → Poor) is applied in tier.ts.
 */
import { levelCompat, UNIT_LEVEL_IDS } from "@/lib/fit/taxonomy";
import type { InvestigatorFitProfile, OpportunityFitProfile, UnitLevel, UnitLevelWeights } from "@/lib/fit/types";
import type { Requirement } from "@/lib/fit/engine/paradigm";
import { heaviest, weightEntries } from "@/lib/fit/engine/util";

export type UnitPair = { investigator: UnitLevel; notice: UnitLevel };

export type UnitTerm = { notice: UnitLevel[]; any_of: boolean; support: number; best: UnitPair | null };

export type UnitResult = {
  U: number;
  terms: UnitTerm[];
  requirement: Requirement;
  best_pair: UnitPair | null;
  dominant: { level: UnitLevel; weight: number } | null;
};

function levelSupport(weights: UnitLevelWeights, o: UnitLevel): { support: number; best: UnitLevel | null } {
  let support = 0;
  let best: UnitLevel | null = null;
  for (const [i, w] of weightEntries(weights)) {
    if (w <= 0) continue;
    const s = w * levelCompat(i, o);
    if (s > support) {
      support = s;
      best = i;
    }
  }
  return { support, best };
}

function anyOf(weights: UnitLevelWeights, set: readonly UnitLevel[]): UnitTerm {
  let support = 0;
  let best: UnitPair | null = null;
  for (const o of set) {
    const s = levelSupport(weights, o);
    if (s.best && (best === null || s.support > support)) best = { investigator: s.best, notice: o };
    support = Math.max(support, s.support);
  }
  return { notice: [...set], any_of: true, support, best };
}

/** The stage-3 formula over any unit vector. */
export function unitSupport(weights: UnitLevelWeights, opp: OpportunityFitProfile): UnitResult {
  const terms: UnitTerm[] = [];
  for (const o of opp.unit.required) {
    const s = levelSupport(weights, o);
    terms.push({ notice: [o], any_of: false, support: s.support, best: s.best ? { investigator: s.best, notice: o } : null });
  }
  if (opp.unit.required_any.length) terms.push(anyOf(weights, opp.unit.required_any));
  let requirement: Requirement = "required";
  if (!terms.length) {
    if (opp.unit.allowed.length) {
      requirement = "allowed";
      terms.push(anyOf(weights, opp.unit.allowed));
    } else requirement = "none";
  }
  const U = terms.length ? terms.reduce((s, t) => s + t.support, 0) / terms.length : 1;
  let top: UnitTerm | null = null;
  for (const t of terms) if (!top || t.support > top.support) top = t;
  const dom = heaviest(weights, UNIT_LEVEL_IDS);
  return { U, terms, requirement, best_pair: top?.best ?? null, dominant: dom ? { level: dom.id, weight: dom.weight } : null };
}

export function unit(inv: InvestigatorFitProfile, opp: OpportunityFitProfile): UnitResult {
  return unitSupport(inv.unit, opp);
}
