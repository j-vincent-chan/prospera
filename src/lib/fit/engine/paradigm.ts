/**
 * Stage 2 · research-paradigm compatibility gate + score (spec §7 stage 2;
 * §4 family matrix; §9; D14).
 *
 *   for each required paradigm o with weight w_o:
 *     support(o) = max over investigator paradigms i of w_i · compat(i, o)
 *   P = Σ w_o · support(o) / Σ w_o
 *
 * `required_any` (D14) is one more term: its support is the max over the
 * set's members and its weight the set's largest weight. With no
 * requirement at all the notice's `allowed` set is scored the same any-of
 * way; with nothing on the paradigm axis P = 1 (nothing to veto — the
 * notice-confidence cap does the rest). Cross-cutting paradigms skip the
 * matrix: an investigator whose dominant paradigm is cross-cutting takes
 * P = sqrt(U · D) (`family_compat._comment`), and a cross-cutting category on
 * either side of a pair contributes w_i · sqrt(U · D).
 *
 * Excluded rule: when the dominant paradigm (weight ≥
 * `gates.excluded_dominant_weight`) is in the notice's excluded set and no
 * requirement term has support ≥ `gates.excluded_min_required_support`,
 * P := min(P, `gates.excluded_cap`). The gates themselves (P <
 * `poor_below` → Poor, < `exploratory_below` → Exploratory) are applied in
 * tier.ts.
 *
 * View: the recent view, falling back to career when recent evidence is
 * thin — no recent category above `aggregation.thin_evidence.cap`.
 *
 * Aspirations (§5): when a self-declared direction names a required
 * category, `P_with_aspiration` recomputes P with that category at the
 * same-category weight (`within_family.same_category`); tier.ts uses it for
 * the Exploratory floor only.
 */
import { categoryCompat, familyOf, PARADIGM_CATEGORY_IDS, paradigmGates, thinEvidence, withinFamily } from "@/lib/fit/taxonomy";
import type { InvestigatorFitProfile, OpportunityFitProfile, ParadigmCategory, ParadigmWeights } from "@/lib/fit/types";
import { clamp01, heaviest, uniq, weightEntries, weightOf } from "@/lib/fit/engine/util";

export type ParadigmPair = { investigator: ParadigmCategory; notice: ParadigmCategory };

/** One requirement term: a required category, or an any-of set scored by its best member (D14). */
export type SupportTerm = {
  notice: ParadigmCategory[];
  any_of: boolean;
  weight: number;
  support: number;
  best: ParadigmPair | null;
};

/** Where the terms came from: the notice's requirements, its allowed set (any-of fallback), or nothing. */
export type Requirement = "required" | "allowed" | "none";

export type ParadigmSupport = {
  P: number;
  terms: SupportTerm[];
  requirement: Requirement;
  best_pair: ParadigmPair | null;
};

/** sqrt(U · D): the compatibility of a cross-cutting paradigm, taken from stages 3–4 (§4 Axis A; `family_compat._comment`). */
export function crossCuttingCompat(ud: { U: number; D: number }): number {
  return Math.sqrt(clamp01(ud.U) * clamp01(ud.D));
}

function categorySupport(weights: ParadigmWeights, o: ParadigmCategory, crossP: number): { support: number; best: ParadigmCategory | null } {
  const oCross = familyOf(o) === "cross_cutting";
  let support = 0;
  let best: ParadigmCategory | null = null;
  for (const [i, w] of weightEntries(weights)) {
    if (w <= 0) continue;
    const compat = oCross || familyOf(i) === "cross_cutting" ? crossP : categoryCompat(i, o);
    const s = w * compat;
    if (s > support) {
      support = s;
      best = i;
    }
  }
  return { support, best };
}

function anyOfTerm(weights: ParadigmWeights, set: Array<[ParadigmCategory, number]>, crossP: number): SupportTerm {
  let support = 0;
  let weight = 0;
  let best: ParadigmPair | null = null;
  for (const [o, w] of set) {
    weight = Math.max(weight, w);
    const s = categorySupport(weights, o, crossP);
    if (s.best && (best === null || s.support > support)) best = { investigator: s.best, notice: o };
    support = Math.max(support, s.support);
  }
  return { notice: set.map(([o]) => o), any_of: true, weight, support, best };
}

/**
 * The stage-2 formula over any paradigm vector — a profile view or one
 * evidence item's classification (stage 5 uses it to decide which items are
 * compatible with the notice).
 */
export function paradigmSupport(weights: ParadigmWeights, opp: OpportunityFitProfile, ud: { U: number; D: number }): ParadigmSupport {
  const crossP = crossCuttingCompat(ud);
  const positive = (w: ParadigmWeights) => weightEntries(w).filter(([, x]) => x > 0);
  const terms: SupportTerm[] = [];
  for (const [o, w] of positive(opp.paradigm.required)) {
    const s = categorySupport(weights, o, crossP);
    terms.push({ notice: [o], any_of: false, weight: w, support: s.support, best: s.best ? { investigator: s.best, notice: o } : null });
  }
  const any = positive(opp.paradigm.required_any);
  if (any.length) terms.push(anyOfTerm(weights, any, crossP));
  let requirement: Requirement = "required";
  if (!terms.length) {
    const allowed = positive(opp.paradigm.allowed);
    if (allowed.length) {
      requirement = "allowed";
      terms.push(anyOfTerm(weights, allowed, crossP));
    } else requirement = "none";
  }
  const wsum = terms.reduce((s, t) => s + t.weight, 0);
  const P = terms.length && wsum > 0 ? terms.reduce((s, t) => s + t.weight * t.support, 0) / wsum : 1;
  let top: SupportTerm | null = null;
  for (const t of terms) if (!top || t.support > top.support) top = t;
  return { P, terms, requirement, best_pair: top?.best ?? null };
}

export type ParadigmResult = ParadigmSupport & {
  view: "recent" | "career";
  /** The view that was scored. */
  weights: ParadigmWeights;
  dominant: { category: ParadigmCategory; weight: number } | null;
  /** The dominant paradigm is cross-cutting: P = sqrt(U · D). */
  cross_cutting: boolean;
  excluded_hit: ParadigmCategory | null;
  /** Aspirations that name a category the notice requires (or, on the fallback, allows). */
  aspiration_match: ParadigmCategory[];
  /** P with each matching aspiration counted at the same-category weight; null when no aspiration matches. */
  P_with_aspiration: number | null;
};

/** Recent view unless it is thin — no category above `thin_evidence.cap` — then career (§7 stage 2). */
export function chooseView(inv: Pick<InvestigatorFitProfile, "paradigm">): "recent" | "career" {
  const top = heaviest(inv.paradigm.recent, PARADIGM_CATEGORY_IDS);
  return top && top.weight > thinEvidence().cap ? "recent" : "career";
}

export function paradigm(inv: InvestigatorFitProfile, opp: OpportunityFitProfile, ud: { U: number; D: number }): ParadigmResult {
  const view = chooseView(inv);
  const weights = inv.paradigm[view];
  const base = paradigmSupport(weights, opp, ud);
  const dom = heaviest(weights, PARADIGM_CATEGORY_IDS);
  const cross_cutting = dom !== null && familyOf(dom.id) === "cross_cutting";
  let P = cross_cutting ? crossCuttingCompat(ud) : base.P;

  const gates = paradigmGates();
  let excluded_hit: ParadigmCategory | null = null;
  if (dom && dom.weight >= gates.excluded_dominant_weight && weightOf(opp.paradigm.excluded, dom.id) > 0 && !base.terms.some((t) => t.support >= gates.excluded_min_required_support)) {
    P = Math.min(P, gates.excluded_cap);
    excluded_hit = dom.id;
  }

  const named = new Set<ParadigmCategory>(base.terms.flatMap((t) => t.notice));
  const aspiration_match = uniq(inv.aspirations.filter((a) => named.has(a)));
  let P_with_aspiration: number | null = null;
  if (aspiration_match.length && base.requirement !== "none") {
    const w2: ParadigmWeights = { ...weights };
    for (const a of aspiration_match) w2[a] = Math.max(weightOf(w2, a), withinFamily().same_category);
    P_with_aspiration = cross_cutting ? P : paradigmSupport(w2, opp, ud).P;
  }

  return { ...base, P, view, weights, dominant: dom ? { category: dom.id, weight: dom.weight } : null, cross_cutting, excluded_hit, aspiration_match, P_with_aspiration };
}
