import { describe, expect, it } from "vitest";
import { design, designCompatible, designSupport } from "@/lib/fit/engine/design";
import { hydrateInvestigator, hydrateOpportunity, type FixtureOpportunity } from "@/lib/fit/engine/fixtures";
import { designGates, designScoreWeights } from "@/lib/fit/taxonomy";

const opp = (fx: FixtureOpportunity) => hydrateOpportunity("o", fx);
const W = designScoreWeights();
const G = designGates();

describe("stage 4 · study design (§7 stage 4; §9 prohibited row)", () => {
  it("D = w_required · req + w_allowed · allowed + w_not_prohibited · (1 − prohibited)", () => {
    // Fixture case 5: {rct 0.70, prospective_cohort 0.58, early_phase_trial 0.41, biospecimen_assay 0.30} (mass 1.99)
    // required_any [rct, early_phase_trial] → req = max(0.70, 0.41) = 0.70
    // allowed set = allowed [biospecimen_assay, prospective_cohort, single_cell] ∪ required → every design → share 1.00
    // prohibited [animal_in_vivo] → 0 → D = 0.6 · 0.70 + 0.3 · 1.00 + 0.1 · 1 = 0.82
    const r = designSupport({ rct: 0.7, prospective_cohort: 0.58, early_phase_trial: 0.41, biospecimen_assay: 0.3 }, opp({ design: { required_any: ["rct", "early_phase_trial"], allowed: ["biospecimen_assay", "prospective_cohort", "single_cell"], prohibited: ["animal_in_vivo"] } }));
    expect(r.req).toBe(0.7);
    expect(r.allowed_share).toBeCloseTo(1, 10);
    expect(r.prohibited_share).toBe(0);
    expect(r.D).toBeCloseTo(W.w_required * 0.7 + W.w_allowed * 1 + W.w_not_prohibited * 1, 10);
    expect(r.D).toBeCloseTo(0.82, 10);
    expect(r.groups[0]).toEqual({ designs: ["rct", "early_phase_trial"], support: 0.7, best: "rct" });
    expect(r.unmet_required).toEqual([]);
    expect(r.penalized).toBe(false);
  });

  it("two required groups are all-of across (min) and any-of within (max); an unsupported group is reported", () => {
    // Fixture case 3: {rct 0.85, prospective_cohort 0.30, biospecimen_assay 0.30} (mass 1.45)
    // [gwas, secondary_data_analysis] → 0; [prospective_cohort, retrospective_cohort, case_control] → 0.30 → req = 0
    // allowed [causal_inference, statistical_epi_modeling] ∪ required → prospective_cohort 0.30 / 1.45 = 0.2069
    // prohibited [rct, pragmatic_trial, early_phase_trial] → 0.85 / 1.45 = 0.5862 < 0.6 → no penalty
    // D = 0 + 0.3 · 0.2069 + 0.1 · (1 − 0.5862) = 0.06207 + 0.04138 = 0.10345
    const r = designSupport({ rct: 0.85, prospective_cohort: 0.3, biospecimen_assay: 0.3 }, opp({ design: { required_any: ["gwas", "secondary_data_analysis"], required_any_2: ["prospective_cohort", "retrospective_cohort", "case_control"], allowed: ["causal_inference", "statistical_epi_modeling"], prohibited: ["rct", "pragmatic_trial", "early_phase_trial"] } }));
    expect(r.groups.map((g) => g.support)).toEqual([0, 0.3]);
    expect(r.req).toBe(0);
    expect(r.allowed_share).toBeCloseTo(0.3 / 1.45, 10);
    expect(r.prohibited_share).toBeCloseTo(0.85 / 1.45, 10);
    expect(r.D).toBeCloseTo(W.w_allowed * (0.3 / 1.45) + W.w_not_prohibited * (1 - 0.85 / 1.45), 10);
    expect(r.unmet_required).toEqual([["gwas", "secondary_data_analysis"]]);
    expect(r.penalized).toBe(false);
  });

  it("a prohibited share at or above prohibited_dominant_share multiplies D by prohibited_penalty_factor and names the dominant design", () => {
    // {prospective_cohort 0.85, ehr_analysis 0.6, causal_inference 0.5, retrospective_cohort 0.5} (mass 2.45), required [wet_lab_experiment, perturbation]
    // prohibited [prospective_cohort, retrospective_cohort, ehr_analysis, rct] → 1.95 / 2.45 = 0.7959 ≥ 0.6
    // D = (0 + 0 + 0.1 · (1 − 0.7959)) · 0.7 = 0.02041 · 0.7 = 0.01429
    const r = designSupport({ prospective_cohort: 0.85, ehr_analysis: 0.6, causal_inference: 0.5, retrospective_cohort: 0.5 }, opp({ design: { required_any: ["wet_lab_experiment", "perturbation"], allowed: ["animal_in_vivo"], prohibited: ["prospective_cohort", "retrospective_cohort", "ehr_analysis", "rct"] } }));
    expect(r.penalized).toBe(true);
    expect(r.dominant_prohibited).toBe("prospective_cohort");
    expect(r.D).toBeCloseTo(W.w_not_prohibited * (1 - 1.95 / 2.45) * G.prohibited_penalty_factor, 10);
    // boundary: exactly the dominant share is penalized, just under is not
    const at = designSupport({ rct: G.prohibited_dominant_share, survey: 1 - G.prohibited_dominant_share }, opp({ design: { prohibited: ["rct"] } }));
    expect(at.penalized).toBe(true);
    const under = designSupport({ rct: G.prohibited_dominant_share - 0.01, survey: 1 - G.prohibited_dominant_share + 0.01 }, opp({ design: { prohibited: ["rct"] } }));
    expect(under.penalized).toBe(false);
    expect(under.dominant_prohibited).toBeNull();
  });

  it("the allowed set is read at design-group level, minus the designs the notice prohibits (D23)", () => {
    // Fixture case 7b: {claims_analysis 0.85, ehr_analysis 0.80, retrospective_cohort 0.60, hybrid 0.35} (mass 2.60)
    // allowed [pragmatic_trial, mixed_methods, ehr_analysis, survey] ∪ required [hybrid, implementation_evaluation] admit the
    // interventional, social_behavioral, real_world_data and implementation groups: claims_analysis (real_world_data) counts
    // through its group, retrospective_cohort (human_observational) does not → (0.85 + 0.80 + 0.35) / 2.60 = 0.769
    // D = 0.6 · 0.35 + 0.3 · 0.769 + 0.1 = 0.541 — the spec's "D 0.55"
    const r = designSupport(
      { claims_analysis: 0.85, ehr_analysis: 0.8, retrospective_cohort: 0.6, hybrid_effectiveness_implementation: 0.35 },
      opp({ design: { required_any: ["hybrid_effectiveness_implementation", "implementation_evaluation"], allowed: ["pragmatic_trial", "mixed_methods", "ehr_analysis", "survey"], prohibited: ["wet_lab_experiment", "animal_in_vivo"] } })
    );
    expect(r.allowed_share).toBeCloseTo(2.0 / 2.6, 10);
    expect(r.D).toBeCloseTo(W.w_required * 0.35 + W.w_allowed * (2.0 / 2.6) + W.w_not_prohibited, 10);
    expect(r.D).toBeCloseTo(0.5408, 4);
    // a prohibited design never counts as allowed, even inside an allowed group: allowed [rct] admits the interventional group, pragmatic_trial is prohibited
    const p = designSupport({ rct: 0.5, pragmatic_trial: 0.5 }, opp({ design: { allowed: ["rct"], prohibited: ["pragmatic_trial"] } }));
    expect(p.allowed_share).toBeCloseTo(0.5, 10);
    expect(p.prohibited_share).toBeCloseTo(0.5, 10);
    // Fixture case 6b: wet-lab and single-cell work is admitted by allowed [biospecimen_assay, single_cell] → share 1, D = 0.3 + 0.1 with the trial groups unmet
    const b = designSupport({ wet_lab_experiment: 0.9, perturbation: 0.85, single_cell: 0.6 }, opp({ design: { required_any: ["rct", "early_phase_trial"], allowed: ["biospecimen_assay", "single_cell"] } }));
    expect(b.allowed_share).toBeCloseTo(1, 10);
    expect(b.D).toBeCloseTo(W.w_allowed + W.w_not_prohibited, 10);
    expect(b.unmet_required).toEqual([["rct", "early_phase_trial"]]);
  });

  it("unsupported means strictly below required_group_unsupported_below", () => {
    const at = designSupport({ rct: G.required_group_unsupported_below }, opp({ design: { required_any: ["rct"] } }));
    expect(at.unmet_required).toEqual([]);
    const under = designSupport({ rct: G.required_group_unsupported_below - 0.01 }, opp({ design: { required_any: ["rct"] } }));
    expect(under.unmet_required).toEqual([["rct"]]);
  });

  it("with no required group req = 1; with nothing allowed either the allowed share is 0", () => {
    const r = designSupport({ rct: 0.9 }, opp({ design: {} }));
    expect(r).toMatchObject({ req: 1, allowed_share: 0, prohibited_share: 0, requirement: "none", groups: [] });
    expect(r.D).toBeCloseTo(W.w_required + W.w_not_prohibited, 10); // 0.7
    const allowedOnly = designSupport({ rct: 0.9, survey: 0.1 }, opp({ design: { allowed: ["rct"] } }));
    expect(allowedOnly.D).toBeCloseTo(W.w_required + W.w_allowed * 0.9 + W.w_not_prohibited, 10);
  });

  it("an empty investigator design vector has no mass: shares are 0 and every required group is unmet", () => {
    const r = design(hydrateInvestigator("i", { paradigm: { recent: {} } }), opp({ design: { required_any: ["rct"], allowed: ["survey"] } }));
    expect(r).toMatchObject({ mass: 0, req: 0, allowed_share: 0, prohibited_share: 0, unmet_required: [["rct"]] });
    expect(r.D).toBeCloseTo(W.w_not_prohibited, 10);
  });

  it("designCompatible (stage 5): some required group met and prohibited designs not dominant; no designs is compatible", () => {
    const notice = opp({ design: { required_any: ["gwas", "secondary_data_analysis"], required_any_2: ["prospective_cohort"], prohibited: ["rct"] } });
    expect(designCompatible({ gwas: 0.9 }, notice)).toBe(true);
    expect(designCompatible({ prospective_cohort: 0.9 }, notice)).toBe(true);
    expect(designCompatible({ rct: 0.9 }, notice)).toBe(false);
    expect(designCompatible({ rct: 0.9, gwas: 0.9 }, notice)).toBe(true); // rct is 50% < 60%, gwas met
    expect(designCompatible({ survey: 0.9 }, notice)).toBe(false);
    expect(designCompatible({}, notice)).toBe(true);
    expect(designCompatible({ gwas: G.required_group_unsupported_below - 0.01 }, notice)).toBe(false);
  });
});
