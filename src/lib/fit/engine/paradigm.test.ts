import { describe, expect, it } from "vitest";
import { chooseView, crossCuttingCompat, paradigm, paradigmSupport } from "@/lib/fit/engine/paradigm";
import { hydrateInvestigator, hydrateOpportunity, type FixtureInvestigator, type FixtureOpportunity } from "@/lib/fit/engine/fixtures";
import { categoryCompat, familyCompat, paradigmGates, TaxonomyError, thinEvidence, withinFamily } from "@/lib/fit/taxonomy";

const inv = (fx: FixtureInvestigator) => hydrateInvestigator("i", fx);
const opp = (fx: FixtureOpportunity) => hydrateOpportunity("o", fx);
const UD = { U: 1, D: 1 };

describe("stage 2 · paradigm (§7 stage 2; §4 matrix; D14)", () => {
  it("support = max over investigator paradigms of w_i · compat(i, o); P = weighted mean over required paradigms", () => {
    // Fixture case 3: clinical_trials 0.85 · compat(clinical, population) 0.45 = 0.3825 beats
    // clinical_observational 0.60 · 0.45 = 0.27 and human_biospecimen 0.30 · compat(translational, population) 0.20 = 0.06,
    // for both required categories → P = (0.9 · 0.3825 + 0.7 · 0.3825) / 1.6 = 0.3825.
    const r = paradigmSupport({ clinical_trials: 0.85, clinical_observational: 0.6, human_biospecimen: 0.3 }, opp({ paradigm: { required: { genetic_epidemiology: 0.9, epidemiology: 0.7 } } }), UD);
    const expected = 0.85 * familyCompat("clinical", "population");
    expect(expected).toBeCloseTo(0.3825, 10);
    expect(r.P).toBeCloseTo(expected, 10);
    expect(r.terms.map((t) => t.support)).toEqual([expected, expected]);
    expect(r.best_pair).toEqual({ investigator: "clinical_trials", notice: "genetic_epidemiology" });
    expect(r.requirement).toBe("required");
  });

  it("same category is w · same_category; a sibling is w · sibling_category", () => {
    expect(paradigmSupport({ clinical_trials: 0.81 }, opp({ paradigm: { required: { clinical_trials: 1 } } }), UD).P).toBeCloseTo(0.81 * withinFamily().same_category, 10);
    expect(paradigmSupport({ clinical_observational: 0.9 }, opp({ paradigm: { required: { clinical_trials: 1 } } }), UD).P).toBeCloseTo(0.9 * withinFamily().sibling_category, 10); // 0.765
  });

  it("weights the mean by the notice's required weights", () => {
    // required {epidemiology 0.9, clinical_trials 0.1}; investigator epidemiology 1.0 → supports 1.0 and compat(population, clinical) 0.45
    // P = (0.9 · 1.0 + 0.1 · 0.45) / 1.0 = 0.945
    const r = paradigmSupport({ epidemiology: 1 }, opp({ paradigm: { required: { epidemiology: 0.9, clinical_trials: 0.1 } } }), UD);
    expect(r.P).toBeCloseTo(0.9 * 1 + 0.1 * familyCompat("population", "clinical"), 10);
  });

  it("required_any is one term whose support is the max over the set and whose weight is the set's largest (D14)", () => {
    // Fixture case 6a: required_any {early_phase_human_experimental 1.0, human_biospecimen 0.8, molecular_cellular_mechanistic 0.8}
    // vs {mcm 0.85, human_biospecimen 0.60, translational 0.45}:
    //   support(ephe) = max(0.85 · compat(discovery, translational) 0.40, 0.60 · sibling 0.85, 0.45 · 0.85) = 0.51
    //   support(hb)   = max(0.85 · 0.40, 0.60 · 1.00, 0.45 · 0.85) = 0.60
    //   support(mcm)  = 0.85 · 1.00 = 0.85 → term support 0.85, weight 1.0
    // plus required {basic_discovery 0.5}: support = 0.85 · sibling 0.85 = 0.7225
    // P = (0.5 · 0.7225 + 1.0 · 0.85) / 1.5 = 0.8075
    const weights = { molecular_cellular_mechanistic: 0.85, human_biospecimen: 0.6, translational: 0.45 };
    const anyOnly = paradigmSupport(weights, opp({ paradigm: { required: {}, required_any: { early_phase_human_experimental: 1, human_biospecimen: 0.8, molecular_cellular_mechanistic: 0.8 } } }), UD);
    expect(anyOnly.P).toBeCloseTo(0.85, 10);
    expect(anyOnly.terms).toHaveLength(1);
    expect(anyOnly.terms[0]).toMatchObject({ any_of: true, weight: 1, support: 0.85, best: { investigator: "molecular_cellular_mechanistic", notice: "molecular_cellular_mechanistic" } });
    const both = paradigmSupport(weights, opp({ paradigm: { required: { basic_discovery: 0.5 }, required_any: { early_phase_human_experimental: 1, human_biospecimen: 0.8, molecular_cellular_mechanistic: 0.8 } } }), UD);
    const sibling = 0.85 * withinFamily().sibling_category;
    expect(both.P).toBeCloseTo((0.5 * sibling + 1 * 0.85) / 1.5, 10);
  });

  it("falls back to the allowed set as any-of, and to P = 1 when the notice names no paradigm", () => {
    const allowed = paradigmSupport({ epidemiology: 0.8 }, opp({ paradigm: { required: {}, allowed: { population_health: 0.6, health_services: 0.4 } } }), UD);
    expect(allowed.requirement).toBe("allowed");
    expect(allowed.P).toBeCloseTo(0.8 * withinFamily().sibling_category, 10);
    const none = paradigmSupport({ epidemiology: 0.8 }, opp({ paradigm: { required: {} } }), UD);
    expect(none).toMatchObject({ P: 1, requirement: "none", terms: [], best_pair: null });
  });

  it("cross-cutting: a cross-cutting dominant investigator takes P = sqrt(U · D); a cross-cutting required category contributes w_i · sqrt(U · D)", () => {
    expect(crossCuttingCompat({ U: 0.81, D: 0.64 })).toBeCloseTo(0.72, 10);
    const r = paradigm(inv({ paradigm: { recent: { computational_data_science: 0.9, genetic_epidemiology: 0.7 } } }), opp({ paradigm: { required: { genetic_epidemiology: 0.8, computational_data_science: 0.7 } } }), { U: 0.81, D: 0.64 });
    expect(r.cross_cutting).toBe(true);
    expect(r.P).toBeCloseTo(0.72, 10);
    // matrix investigator against a cross-cutting requirement: epidemiology 0.9 · sqrt(0.81 · 0.64) = 0.648
    const m = paradigmSupport({ epidemiology: 0.9 }, opp({ paradigm: { required: { computational_data_science: 1 } } }), { U: 0.81, D: 0.64 });
    expect(m.P).toBeCloseTo(0.9 * 0.72, 10);
    // a cross-cutting side line contributes through the same factor: bioinformatics 0.5 · 0.72 = 0.36 beats epidemiology 0.9 · compat(population, discovery) 0.05
    const side = paradigmSupport({ epidemiology: 0.9, bioinformatics: 0.5 }, opp({ paradigm: { required: { molecular_cellular_mechanistic: 1 } } }), { U: 0.81, D: 0.64 });
    expect(side.P).toBeCloseTo(0.5 * 0.72, 10);
    expect(side.best_pair).toEqual({ investigator: "bioinformatics", notice: "molecular_cellular_mechanistic" });
  });

  it("excluded rule: dominant ≥ excluded_dominant_weight in the excluded set and no support ≥ excluded_min_required_support → P := min(P, excluded_cap)", () => {
    const g = paradigmGates();
    const notice = opp({ paradigm: { required: { genetic_epidemiology: 0.9 }, excluded: { clinical_trials: 1 } } });
    // support = 0.85 · 0.45 = 0.3825 < 0.4 → capped at 0.15
    const capped = paradigm(inv({ paradigm: { recent: { clinical_trials: 0.85 } } }), notice, UD);
    expect(capped.P).toBe(g.excluded_cap);
    expect(capped.excluded_hit).toBe("clinical_trials");
    // support exactly at the threshold clears it: w = 0.4 / 0.45
    const w = g.excluded_min_required_support / familyCompat("clinical", "population");
    const clear = paradigm(inv({ paradigm: { recent: { clinical_trials: w } } }), notice, UD);
    expect(clear.P).toBeCloseTo(g.excluded_min_required_support, 10);
    expect(clear.excluded_hit).toBeNull();
    // dominant weight under the dominance threshold: no cap even though the support is low
    const light = paradigm(inv({ paradigm: { recent: { clinical_trials: g.excluded_dominant_weight - 0.01 } } }), notice, UD);
    expect(light.excluded_hit).toBeNull();
    expect(light.P).toBeCloseTo((g.excluded_dominant_weight - 0.01) * familyCompat("clinical", "population"), 10);
    const edge = paradigm(inv({ paradigm: { recent: { clinical_trials: g.excluded_dominant_weight } } }), notice, UD);
    expect(edge.excluded_hit).toBe("clinical_trials");
    // an excluded category that is not the dominant one does not trigger the rule
    const secondary = paradigm(inv({ paradigm: { recent: { epidemiology: 0.9, clinical_trials: 0.7 } } }), notice, UD);
    expect(secondary.excluded_hit).toBeNull();
    expect(secondary.P).toBeCloseTo(0.9 * withinFamily().sibling_category, 10);
  });

  it("view: recent unless no recent category exceeds thin_evidence.cap, then career", () => {
    const cap = thinEvidence().cap;
    expect(chooseView({ paradigm: { career: { epidemiology: 0.9 }, recent: { epidemiology: cap + 0.01 } } })).toBe("recent");
    expect(chooseView({ paradigm: { career: { epidemiology: 0.9 }, recent: { epidemiology: cap } } })).toBe("career");
    expect(chooseView({ paradigm: { career: { epidemiology: 0.9 }, recent: {} } })).toBe("career");
    const r = paradigm(inv({ paradigm: { career: { epidemiology: 0.9 }, recent: { epidemiology: 0.2 } } }), opp({ paradigm: { required: { epidemiology: 1 } } }), UD);
    expect(r.view).toBe("career");
    expect(r.P).toBeCloseTo(0.9, 10);
    expect(r.weights).toEqual({ epidemiology: 0.9 });
  });

  it("aspirations: a self-declared direction naming a required category gives P_with_aspiration with that category at same_category weight", () => {
    const r = paradigm(inv({ paradigm: { recent: { molecular_cellular_mechanistic: 0.85 } }, aspirations: ["clinical_trials", "epidemiology"] }), opp({ paradigm: { required: { clinical_trials: 1 } } }), UD);
    expect(r.P).toBeCloseTo(0.85 * familyCompat("discovery", "clinical"), 10); // 0.1275
    expect(r.aspiration_match).toEqual(["clinical_trials"]);
    expect(r.P_with_aspiration).toBeCloseTo(withinFamily().same_category, 10);
    const none = paradigm(inv({ paradigm: { recent: { molecular_cellular_mechanistic: 0.85 } }, aspirations: ["epidemiology"] }), opp({ paradigm: { required: { clinical_trials: 1 } } }), UD);
    expect(none.P_with_aspiration).toBeNull();
    expect(none.aspiration_match).toEqual([]);
  });

  it("missing profile: no paradigm evidence gives P = 0 with no pair; an unknown category throws TaxonomyError", () => {
    const r = paradigm(inv({ paradigm: { recent: {}, career: {} } }), opp({ paradigm: { required: { clinical_trials: 1 } } }), UD);
    expect(r).toMatchObject({ P: 0, view: "career", dominant: null, best_pair: null, cross_cutting: false, excluded_hit: null });
    expect(r.terms[0]!.support).toBe(0);
    expect(() => paradigmSupport({ not_a_category: 0.9 } as never, opp({ paradigm: { required: { clinical_trials: 1 } } }), UD)).toThrow(TaxonomyError);
    expect(() => paradigmSupport({ clinical_trials: 0.9 }, opp({ paradigm: { required: { bogus: 1 } as never } }), UD)).toThrow(TaxonomyError);
  });

  it("uses categoryCompat for every pair (same, sibling, matrix)", () => {
    expect(categoryCompat("clinical_trials", "clinical_trials")).toBe(withinFamily().same_category);
    expect(categoryCompat("clinical_trials", "clinical_observational")).toBe(withinFamily().sibling_category);
    expect(categoryCompat("clinical_trials", "epidemiology")).toBe(familyCompat("clinical", "population"));
  });
});
