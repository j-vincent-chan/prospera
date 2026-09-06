import { describe, expect, it } from "vitest";
import { scorePairDetailed } from "@/lib/fit/engine";
import { hydrateContext, hydrateInvestigator, hydrateOpportunity, type FixtureInvestigator, type FixtureOpportunity } from "@/lib/fit/engine/fixtures";
import { noticeAllowsHumanTissue, profileConfidence } from "@/lib/fit/engine/tier";
import { confidenceCap, designGates, exploratoryException, floors, paradigmGates, unitGates } from "@/lib/fit/taxonomy";
import type { ScoreContext } from "@/lib/fit/types";

/** A pair that meets every Strong floor: same-category paradigm 0.9, L3, rct, enrolled participants, a depth-3 coded match, R01 held, 10 weeks runway. */
const BASE_INV: FixtureInvestigator = {
  paradigm: { recent: { clinical_trials: 0.9 } },
  unit: { L3: 0.9 },
  design: { rct: 0.9 },
  materials: { enrolled_participants: 0.9 },
  objective: { treatment_evaluation_efficacy: 0.9 },
  topic: { mesh_major: ["C20.111.590"], rcdc: ["Lupus"] },
  characteristics: { mechanisms_held: ["R01"], active_awards: 1, trial_pi_count: 2, runway_weeks: 10, esi: false },
};
const BASE_OPP: FixtureOpportunity = {
  mechanism: { activity_code: "R01", clinical_trial: "required" },
  paradigm: { required: { clinical_trials: 1 } },
  unit: { required: ["L3"] },
  design: { required_any: ["rct"] },
  materials: { expected: ["enrolled_participants"] },
  objective: { treatment_evaluation_efficacy: 0.9 },
  topic: { mesh: ["C20.111.590"], rcdc: ["Lupus"] },
  confidence: "high",
};

type Over = { inv?: Partial<FixtureInvestigator>; opp?: FixtureOpportunity; ctx?: Partial<ScoreContext>; topic?: number | null };
function score(o: Over = {}) {
  const invFx: FixtureInvestigator = { ...BASE_INV, ...o.inv, characteristics: { ...BASE_INV.characteristics, ...o.inv?.characteristics } };
  const oppFx: FixtureOpportunity = { ...BASE_OPP, ...o.opp };
  const inv = hydrateInvestigator("i", invFx);
  const opp = hydrateOpportunity("o", oppFx);
  const ctx: ScoreContext = { ...hydrateContext(invFx, {}, o.topic === undefined ? 0.9 : o.topic), ...o.ctx };
  return scorePairDetailed(inv, opp, ctx);
}

const S = floors("strong");
const M = floors("moderate");
const X = floors("exploratory");
const PG = paradigmGates();

describe("stage 9 · floors (§10)", () => {
  it("the base pair is Strong with every floor met and no cap", () => {
    const { result, tier } = score();
    expect(result.tier).toBe("strong");
    expect(result.caps).toEqual([]);
    expect(tier.missed_next).toEqual([]);
    expect(result.gap).toBeNull();
    expect(result.why_not).toBeNull();
    expect(result.rationale).toContain("Paradigm 0.90");
  });

  it("one non-gate Strong floor missed is Moderate; two are Exploratory (gaps_allowed = 1)", () => {
    const oneGap = score({ topic: S.T - 0.05 });
    expect(oneGap.result.tier).toBe("moderate");
    expect(oneGap.tier.strong_gaps).toEqual(["T"]);
    expect(oneGap.result.provenance.floors.unmet).toEqual([{ key: "T", value: S.T - 0.05, floor: S.T }]);
    expect(oneGap.result.gap).toContain("Topic");
    // M = 1 of 3 (rct met; two expected materials missing) also misses Strong's M floor
    const twoGaps = score({ topic: S.T - 0.05, inv: { materials: {} }, opp: { materials: { expected: ["enrolled_participants", "human_blood_fluids"] } } });
    expect(twoGaps.result.tier).toBe("exploratory");
    expect(twoGaps.tier.strong_gaps).toEqual(["T", "M"]);
  });

  it("P, U and the required-design floor are governed by their own Moderate values, not the gap allowance", () => {
    // P = 0.9 · sibling 0.85 = 0.765 ≥ Strong 0.75 → Strong; P 0.7 (0.7 · 1.0) with everything else perfect → Moderate, not Exploratory
    expect(score({ inv: { paradigm: { recent: { clinical_trials: 0.7 } } } }).result.tier).toBe("moderate");
    expect(score({ inv: { paradigm: { recent: { clinical_trials: M.P } } } }).result.tier).toBe("moderate");
    expect(score({ inv: { paradigm: { recent: { clinical_trials: M.P - 0.01 } } } }).result.tier).toBe("exploratory");
    // required group at 0.35: under Strong's 0.40, over Moderate's 0.20 → Moderate with the design gap (spec case 7b's reading)
    // D = 0.6 · 0.35 + 0.3 · 1.0 (the cohort work is allowed) + 0.1 = 0.61: between Moderate's 0.50 and Strong's 0.75
    const d = score({ inv: { design: { rct: 0.35, prospective_cohort: 0.55 } }, opp: { design: { required_any: ["rct"], allowed: ["prospective_cohort"] } } });
    expect(d.result.components.D).toBeCloseTo(0.61, 10);
    expect(d.result.tier).toBe("moderate");
    expect(d.tier.strong_gaps).not.toContain("D_required_group_min");
    // P between Moderate and Strong plus one other gap is still Moderate (P is not counted as the gap)
    expect(score({ inv: { paradigm: { recent: { clinical_trials: 0.7 } } }, topic: S.T - 0.05 }).result.tier).toBe("moderate");
  });

  it("Strong needs a coded match at the Strong depth and a sufficient runway outside the pipeline; either miss is the one gap", () => {
    const shallow = score({ inv: { topic: { mesh_major: ["C20"], rcdc: [] } }, opp: { topic: { mesh: ["C20.111.590"], rcdc: [] } } });
    expect(shallow.result.tier).toBe("moderate");
    expect(shallow.tier.strong_gaps).toEqual(["T"]);
    expect(shallow.result.gap).toContain(`no coded match at depth ≥ ${S.T_specific_depth}`);
    const pipeline = score({ inv: { characteristics: { in_pipeline: true } } });
    expect(pipeline.result.tier).toBe("moderate");
    expect(pipeline.tier.strong_gaps).toEqual(["A"]);
    const unknownDeadline = score({ inv: { characteristics: { runway_weeks: null } } });
    expect(unknownDeadline.result.tier).toBe("moderate");
    expect(unknownDeadline.result.gap).toContain("deadline not on file");
  });

  it("Exploratory floors: P ≥ its floor (or P_with_aspiration), U, T; below them is Poor", () => {
    expect(score({ topic: X.T }).result.tier).not.toBe("poor");
    expect(score({ topic: X.T - 0.01 }).result.tier).toBe("poor");
    const poor = score({ topic: X.T - 0.01 });
    expect(poor.result.why_not).toContain("Topic");
  });
});

describe("stage 9 · gate caps (§7 stages 2–4; §9)", () => {
  it("paradigm gate: P < poor_below caps Poor, P < exploratory_below caps Exploratory, at the thresholds nothing", () => {
    // health_services vs clinical_trials: compat(health_systems, clinical) = 0.50 → w · 0.5
    const withP = (p: number) => score({ inv: { paradigm: { recent: { health_services: p / 0.5 } } }, opp: { paradigm: { required: { clinical_trials: 1 }, excluded: {} } } });
    expect(withP(PG.poor_below - 0.001).result).toMatchObject({ tier: "poor", caps: ["paradigm_gate"] });
    expect(withP(PG.poor_below).result.caps).toEqual(["paradigm_gate"]);
    expect(withP(PG.poor_below).result.tier).toBe("exploratory");
    expect(withP(PG.exploratory_below - 0.001).result).toMatchObject({ tier: "exploratory", caps: ["paradigm_gate"] });
    expect(withP(PG.exploratory_below).result.caps).toEqual([]);
  });

  it("unit gate: U < unit.gates.poor_below caps Poor", () => {
    const ug = unitGates();
    expect(score({ inv: { unit: { L3: ug.poor_below - 0.001 } } }).result).toMatchObject({ tier: "poor", caps: ["unit_gate"] });
    expect(score({ inv: { unit: { L3: ug.poor_below } } }).result.caps).not.toContain("unit_gate");
  });

  it("a required design group under the threshold caps at required_unsupported_cap_tier even when the floors would say more", () => {
    const dg = designGates();
    const r = score({ inv: { design: { rct: dg.required_group_unsupported_below - 0.01, prospective_cohort: 0.9 } } });
    expect(r.result.caps).toContain("design_required_unsupported");
    expect(r.result.tier).toBe(dg.required_unsupported_cap_tier);
    expect(r.result.provenance.D.unmet_required).toEqual([["rct"]]);
    expect(r.result.gap).toContain("rct required, none in the evidence");
  });
});

describe("stage 9 · confidence caps (§7 stage 9; D20; D22)", () => {
  it("a low investigator gate-axis confidence, a partial profile, a low or incomplete notice profile, or an unknown eligibility rule caps at Moderate", () => {
    expect(score({ inv: { confidence: { paradigm: "low" } } }).result).toMatchObject({ tier: confidenceCap("low_profile_confidence"), caps: ["low_profile_confidence"] });
    expect(score({ inv: { confidence: { materials: "low", objective: "low" } } }).result.caps).toEqual([]);
    expect(score({ ctx: { investigator_pending_items: 3 } }).result).toMatchObject({ tier: "moderate", caps: ["low_profile_confidence"] });
    expect(score({ opp: { confidence: "low" } }).result).toMatchObject({ tier: confidenceCap("low_notice_confidence"), caps: ["low_notice_confidence"] });
    expect(score({ ctx: { notice_complete: false } }).result).toMatchObject({ tier: "moderate", caps: ["low_notice_confidence"] });
    expect(score({ opp: { confidence: "medium" } }).result.tier).toBe("strong");
    const unknown = score({ opp: { eligibility: { esi_only: true } }, inv: { characteristics: { esi: null } } });
    expect(unknown.result).toMatchObject({ tier: confidenceCap("eligibility_unknown"), caps: ["eligibility_unknown"] });
    expect(unknown.result.flags).toContain("ESI status not on file");
    expect(unknown.result.gap).toContain("ESI status not on file");
  });

  it("readiness far above and a short runway cap at Moderate with their flags", () => {
    const far = score({ inv: { characteristics: { mechanisms_held: ["K23"] } }, opp: { mechanism: { activity_code: "P01", clinical_trial: "required" } } });
    expect(far.result.caps).toContain("readiness_far");
    expect(far.result.tier).toBe(confidenceCap("readiness_far"));
    expect(far.result.flags).toContain("mechanism far above readiness; consider as project lead, not PI");
    const short = score({ inv: { characteristics: { runway_weeks: 2 } } });
    expect(short.result.caps).toContain("runway_short");
    expect(short.result.tier).toBe(confidenceCap("runway_short"));
  });

  it("profileConfidence is the weakest of paradigm, unit, design and topic", () => {
    const inv = hydrateInvestigator("i", { paradigm: { recent: {} }, confidence: { paradigm: "high", unit: "medium", design: "high", topic: "high", materials: "low", objective: "low" } });
    expect(profileConfidence(inv)).toBe("medium");
  });
});

describe("stage 9 · exploratory exceptions and aspirations (§9; §5)", () => {
  // A basic scientist (discovery) against a Clinical Trial Required notice: P = 0.85 · compat(discovery, clinical) 0.15 = 0.1275 < 0.25 → Poor unless bridged.
  const basic: Partial<FixtureInvestigator> = { paradigm: { recent: { molecular_cellular_mechanistic: 0.85 } }, unit: { L1: 0.9, L3: 0.5 }, design: { wet_lab_experiment: 0.9 }, materials: { human_primary_cells: 0.8 } };
  const bridge = exploratoryException("translational_bridge");
  const bio = exploratoryException("biospecimen_bridge");

  it("translational bridge: translational ≥ the minimum and a collaborator in a required family lifts a paradigm-gated Poor to Exploratory", () => {
    const lifted = score({ inv: { ...basic, paradigm: { recent: { molecular_cellular_mechanistic: 0.85, translational: bridge.investigator_translational_min } }, collaborators: [{ id: "trialist-1", dominant_family: "clinical", categories: ["clinical_trials"] }] } });
    expect(lifted.result.tier).toBe("exploratory");
    expect(lifted.result.caps).toEqual(["paradigm_gate_relaxed_translational_bridge", "design_required_unsupported"]);
    // P = max(0.85 · compat(discovery, clinical) 0.15, 0.40 · compat(translational, clinical) 0.60) = 0.24 < 0.25: gated, then lifted
    expect(lifted.result.components.P).toBeCloseTo(0.24, 10);
    expect(lifted.result.provenance.P.exception).toBe("translational_bridge");
    expect(lifted.result.provenance.collaborators).toEqual(["trialist-1"]);
    expect(lifted.result.gap).toContain("trialist-1");
    const noCollaborator = score({ inv: { ...basic, paradigm: { recent: { molecular_cellular_mechanistic: 0.85, translational: bridge.investigator_translational_min } } } });
    expect(noCollaborator.result.tier).toBe("poor");
    expect(noCollaborator.result.caps).toEqual(["paradigm_gate", "design_required_unsupported"]);
    const wrongFamily = score({ inv: { ...basic, paradigm: { recent: { molecular_cellular_mechanistic: 0.85, translational: bridge.investigator_translational_min } }, collaborators: [{ id: "epi-1", dominant_family: "population", categories: ["epidemiology"] }] } });
    expect(wrongFamily.result.tier).toBe("poor");
    // under the stage-2 formula a translational weight above 0.25 / compat(translational, clinical) = 0.4167 clears the Poor gate on its own, so the bridge has nothing to lift
    const selfLifted = score({ inv: { ...basic, paradigm: { recent: { molecular_cellular_mechanistic: 0.85, translational: 0.6 } } } });
    expect(selfLifted.result.components.P).toBeCloseTo(0.36, 10);
    expect(selfLifted.result.caps).toEqual(["paradigm_gate", "design_required_unsupported"]);
    expect(selfLifted.result.tier).toBe("exploratory");
    const thin = score({ inv: { ...basic, paradigm: { recent: { molecular_cellular_mechanistic: 0.85, translational: bridge.investigator_translational_min - 0.01 } }, collaborators: [{ id: "trialist-1", dominant_family: "clinical", categories: ["clinical_trials"] }] } });
    expect(thin.result.tier).toBe("poor");
  });

  it("biospecimen bridge: human_biospecimen ≥ the minimum and a notice that allows human tissue", () => {
    const clinician: Partial<FixtureInvestigator> = { paradigm: { recent: { clinical_observational: 0.85, human_biospecimen: bio.investigator_human_biospecimen_min } }, unit: { L3: 0.9 }, design: { prospective_cohort: 0.8 } };
    const mechanism: FixtureOpportunity = { mechanism: { activity_code: "R01", clinical_trial: "not_allowed" }, paradigm: { required: { molecular_cellular_mechanistic: 0.9 } }, unit: { required: ["L1"], allowed: ["L3"] }, design: { required_any: ["wet_lab_experiment"], allowed: ["biospecimen_assay"] }, materials: { expected: ["human_tissue_biopsy"] } };
    const lifted = score({ inv: clinician, opp: mechanism, topic: 0.8 });
    expect(lifted.result.caps).toContain("paradigm_gate_relaxed_biospecimen_bridge");
    expect(lifted.result.provenance.P.exception).toBe("biospecimen_bridge");
    expect(noticeAllowsHumanTissue(hydrateOpportunity("o", mechanism))).toBe(true);
    const noTissue = score({ inv: clinician, opp: { ...mechanism, design: { required_any: ["wet_lab_experiment"], allowed: [] }, materials: { expected: ["animal_mouse"] } }, topic: 0.8 });
    expect(noticeAllowsHumanTissue(hydrateOpportunity("o", { ...mechanism, design: { required_any: ["wet_lab_experiment"], allowed: [] }, materials: { expected: ["animal_mouse"] } }))).toBe(false);
    expect(noTissue.result.tier).toBe("poor");
  });

  it("the bridge never lifts a unit-gated Poor", () => {
    const r = score({ inv: { ...basic, unit: { L1: 0.9 }, paradigm: { recent: { molecular_cellular_mechanistic: 0.85, translational: bridge.investigator_translational_min } }, collaborators: [{ id: "trialist-1", dominant_family: "clinical", categories: ["clinical_trials"] }] }, opp: { ...BASE_OPP, unit: { required: ["L5"] } } });
    expect(r.result.caps).toEqual(["paradigm_gate_relaxed_translational_bridge", "unit_gate", "design_required_unsupported"]);
    expect(r.result.tier).toBe("poor");
  });

  it("an aspiration naming the required paradigm lifts the gate to Exploratory and never higher", () => {
    const r = score({ inv: { ...basic, aspirations: ["clinical_trials"] } });
    expect(r.result.tier).toBe("exploratory");
    expect(r.result.caps).toEqual(["paradigm_gate", "design_required_unsupported"]);
    expect(r.tier.aspiration_relaxed).toBe(true);
    expect(r.result.flags).toContain("aspiration names the required paradigm (clinical_trials); Exploratory at most");
    expect(r.result.provenance.floors.tier_by_floors).toBe("exploratory");
  });
});

describe("stage 9 · exclusion and provenance", () => {
  it("E = 0 is Poor with the failure in why_not and the flags, score 0", () => {
    const r = score({ inv: { characteristics: { runway_weeks: -2 } } });
    expect(r.result).toMatchObject({ tier: "poor", score: 0 });
    expect(r.result.why_not).toContain("Ineligible: deadline has passed");
    expect(r.result.flags).toContain("excluded: deadline has passed");
    expect(r.result.provenance.E.failed).toEqual(["deadline has passed"]);
  });

  it("provenance carries the pairs, view, matches, methods and mechanisms", () => {
    const { result } = score();
    expect(result.provenance.P).toEqual({ view: "recent", best_pair: { investigator: "clinical_trials", notice: "clinical_trials" }, excluded_hit: null, exception: null });
    expect(result.provenance.U).toEqual({ best_pair: { investigator: "L3", notice: "L3" } });
    expect(result.provenance.T.coded_matches).toEqual([{ code: "C20.111.590", depth: 3 }, { code: "Lupus", depth: 1 }]);
    expect(result.provenance.M).toEqual({ met: ["rct", "enrolled_participants"], missing: [] });
    expect(result.provenance.K).toEqual({ mechanisms_held: ["R01"], activity_code: "R01" });
    expect(result.provenance.A).toEqual({ runway_weeks: 10, in_pipeline: false, recently_dismissed: false });
    expect(result.provenance.floors).toEqual({ tier_by_floors: "strong", unmet: [] });
  });

  it("a taxonomy-version mismatch and needs_review are flags, not errors", () => {
    const r = score({ opp: { needs_review: true } });
    expect(r.result.flags).toContain("notice profile flagged needs_review");
    const inv = hydrateInvestigator("i", BASE_INV);
    const opp = { ...hydrateOpportunity("o", BASE_OPP), taxonomy_version: "fit-v0" };
    const mismatch = scorePairDetailed(inv, opp, hydrateContext(BASE_INV, {}, 0.9));
    expect(mismatch.result.flags).toContain("taxonomy versions differ: investigator fit-v1, notice fit-v0");
  });
});
