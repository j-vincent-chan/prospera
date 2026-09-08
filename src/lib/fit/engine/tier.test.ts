import { describe, expect, it } from "vitest";
import { scorePair, scorePairDetailed } from "@/lib/fit/engine";
import { hydrateContext, hydrateInvestigator, hydrateOpportunity, type FixtureInvestigator, type FixtureOpportunity } from "@/lib/fit/engine/fixtures";
import { noticeAllowsHumanTissue, paradigmAxisEmpty, profileConfidence } from "@/lib/fit/engine/tier";
import { confidenceCap, designGates, exceptionInvestigatorFamilies, exceptionNoticeFamilies, exploratoryException, familyCompat, floors, paradigmGates, thinEvidence, unitGates } from "@/lib/fit/taxonomy";
import type { MaterialsKind, ScoreContext } from "@/lib/fit/types";

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

/**
 * D23 normalizes the investigator's weights to the dominant category, so a
 * lone category always carries its full compatibility. To place P at an
 * exact value the tests pair a dominant `molecular_cellular_mechanistic` at
 * 1.0 (compat(discovery, clinical) 0.15 with the required clinical_trials)
 * with clinical_trials at the value itself: P = max(0.15, p) = p.
 */
const paradigmAt = (p: number): Partial<FixtureInvestigator> => ({ paradigm: { recent: { molecular_cellular_mechanistic: 1, clinical_trials: p } } });

describe("stage 9 · floors (§10)", () => {
  it("the base pair is Strong with every floor met and no cap", () => {
    const { result, tier } = score();
    expect(result.tier).toBe("strong");
    expect(result.caps).toEqual([]);
    expect(tier.missed_next).toEqual([]);
    expect(result.gap).toBeNull();
    expect(result.why_not).toBeNull();
    expect(result.rationale).toContain("Paradigm 1.00");
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
    // P 0.7 with everything else perfect → Moderate, not Exploratory; at the Moderate floor still Moderate; just under → Exploratory
    expect(score({ inv: paradigmAt(0.7) }).result.components.P).toBeCloseTo(0.7, 10);
    expect(score({ inv: paradigmAt(0.7) }).result.tier).toBe("moderate");
    expect(score({ inv: paradigmAt(M.P) }).result.tier).toBe("moderate");
    expect(score({ inv: paradigmAt(M.P - 0.01) }).result.tier).toBe("exploratory");
    // required group at 0.35: under Strong's 0.40, over Moderate's 0.20 → Moderate with the design gap (spec case 7b's reading)
    // D = 0.6 · 0.35 + 0.3 · 1.0 (the cohort work is allowed) + 0.1 = 0.61: between Moderate's 0.50 and Strong's 0.75
    const d = score({ inv: { design: { rct: 0.35, prospective_cohort: 0.55 } }, opp: { design: { required_any: ["rct"], allowed: ["prospective_cohort"] } } });
    expect(d.result.components.D).toBeCloseTo(0.61, 10);
    expect(d.result.tier).toBe("moderate");
    expect(d.tier.strong_gaps).not.toContain("D_required_group_min");
    // P between Moderate and Strong plus one other gap is still Moderate (P is not counted as the gap)
    expect(score({ inv: paradigmAt(0.7), topic: S.T - 0.05 }).result.tier).toBe("moderate");
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

describe("stage 9 · floor boundaries through scorePair (§10 table)", () => {
  it("D: Strong at 0.75, Moderate at 0.50", () => {
    // the base notice requires rct and allows nothing else, so with rct alone D = 0.6 · rct + 0.3 · 1 + 0.1
    const strong = score({ inv: { design: { rct: 0.6 } } });
    expect(strong.result.components.D).toBeCloseTo(0.76, 10);
    expect(strong.result.tier).toBe("strong");
    const belowStrong = score({ inv: { design: { rct: 0.58 } } });
    expect(belowStrong.result.components.D).toBeCloseTo(0.748, 10);
    expect(belowStrong.result.tier).toBe("moderate");
    expect(belowStrong.tier.strong_gaps).toEqual(["D"]); // rct 0.58 clears the Strong required-group floor; D itself is the one gap
    // rct at the Strong required-group floor with unrelated survey work diluting the allowed share: D = 0.24 + 0.3 · 0.4 / (0.4 + s) + 0.1
    const atModerate = score({ inv: { design: { rct: S.D_required_group_min, survey: 0.34 } } });
    expect(atModerate.result.components.D).toBeGreaterThanOrEqual(M.D!);
    expect(atModerate.result.components.D).toBeLessThan(M.D! + 0.01);
    expect(atModerate.result.tier).toBe("moderate");
    const belowModerate = score({ inv: { design: { rct: S.D_required_group_min, survey: 0.36 } } });
    expect(belowModerate.result.components.D).toBeLessThan(M.D!);
    expect(belowModerate.result.components.D).toBeGreaterThan(M.D! - 0.01);
    expect(belowModerate.result).toMatchObject({ tier: "exploratory", caps: [] });
    expect(belowModerate.result.provenance.floors.unmet.map((u) => u.key)).toEqual(["D"]);
  });

  it("U: Strong at 0.60, Moderate at 0.40, Exploratory at 0.20 (the unit gate), end to end", () => {
    // the notice works at L3; a dominant L1 (compat 0.50 with L3) beside L3 at the boundary value gives U = max(0.50, u)
    expect(score({ inv: { unit: { L1: 1, L3: S.U } } }).result.components.U).toBe(S.U);
    expect(score({ inv: { unit: { L1: 1, L3: S.U } } }).result.tier).toBe("strong");
    const belowStrong = score({ inv: { unit: { L1: 1, L3: S.U - 0.01 } } });
    expect(belowStrong.result.tier).toBe("moderate");
    expect(belowStrong.tier.strong_gaps).toEqual([]); // U is governed by its own Moderate value, never the gap allowance
    // a dominant L2 (compat 0.35 with L3): U = max(0.35, u)
    expect(score({ inv: { unit: { L2: 1, L3: M.U } } }).result.components.U).toBe(M.U);
    expect(score({ inv: { unit: { L2: 1, L3: M.U } } }).result.tier).toBe("moderate");
    expect(score({ inv: { unit: { L2: 1, L3: M.U - 0.01 } } }).result.tier).toBe("exploratory");
    // the Exploratory floor is the unit gate: a notice at L1 against a dominant L4 (compat 0.10) beside L1 at the floor
    expect(X.U).toBe(unitGates().poor_below);
    const atFloor = score({ inv: { unit: { L4: 1, L1: X.U } }, opp: { unit: { required: ["L1"] } } });
    expect(atFloor.result.components.U).toBe(X.U);
    expect(atFloor.result).toMatchObject({ tier: "exploratory", caps: [] });
    const under = score({ inv: { unit: { L4: 1, L1: X.U - 0.01 } }, opp: { unit: { required: ["L1"] } } });
    expect(under.result).toMatchObject({ tier: "poor", caps: ["unit_gate"] });
    expect(under.result.why_not).toContain("Unit: notice works at L1");
  });

  it("M: Strong at 0.50, Moderate at 0.30", () => {
    // the capability pool is the rct group plus each expected material; rct, enrolled participants and blood are the evidence
    const pool = (expected: MaterialsKind[]) => score({ inv: { materials: { enrolled_participants: 0.9, human_blood_fluids: 0.9 } }, opp: { materials: { expected } } });
    const half = pool(["enrolled_participants", "human_blood_fluids", "ehr", "claims_administrative", "registries_surveillance"]); // 3 of 6
    expect(half.result.components.M).toBe(0.5);
    expect(half.result.tier).toBe("strong");
    const belowStrong = pool(["enrolled_participants", "human_blood_fluids", "ehr", "claims_administrative", "registries_surveillance", "surveys"]); // 3 of 7
    expect(belowStrong.result.components.M).toBeCloseTo(3 / 7, 10);
    expect(belowStrong.result.tier).toBe("moderate");
    expect(belowStrong.tier.strong_gaps).toEqual(["M"]);
    const atModerate = pool(["enrolled_participants", "human_blood_fluids", "ehr", "claims_administrative", "registries_surveillance", "surveys", "cohort_biobank_datasets", "genomic_datasets", "imaging_datasets"]); // 3 of 10
    expect(atModerate.result.components.M).toBe(M.M);
    expect(atModerate.result.tier).toBe("moderate");
    const belowModerate = pool(["enrolled_participants", "human_blood_fluids", "ehr", "claims_administrative", "registries_surveillance", "surveys", "cohort_biobank_datasets", "genomic_datasets", "imaging_datasets", "digital_wearable"]); // 3 of 11
    expect(belowModerate.result.components.M).toBeLessThan(M.M!);
    expect(belowModerate.result).toMatchObject({ tier: "exploratory", caps: [] });
  });

  it("K: Strong at 0.40, Moderate at 0.25", () => {
    // K = 0.6 · readiness + 0.2 · min(1, active / 2). R01 held vs R01 with trial experience only as a sub-investigator on a
    // Clinical Trial Required notice halves readiness: 0.6 · 0.5 + 0.2 · 0.5 = 0.40 — at the Strong floor
    const atStrong = score({ inv: { characteristics: { trial_pi_count: 0, active_awards: 1 }, evidence_summary: { trials: 2 } } });
    expect(atStrong.result.components.K).toBe(S.K);
    expect(atStrong.result.tier).toBe("strong");
    expect(atStrong.result.flags).toContain("trial experience only as a sub-investigator; trial-leadership credit halved");
    const belowStrong = score({ inv: { characteristics: { trial_pi_count: 0, active_awards: 0 }, evidence_summary: { trials: 2 } } });
    expect(belowStrong.result.components.K).toBeCloseTo(0.3, 10);
    expect(belowStrong.result.tier).toBe("moderate");
    expect(belowStrong.tier.strong_gaps).toEqual(["K"]);
    // one_above (R21 held vs R01) with the halving: 0.6 · 0.7 · 0.5 = 0.21 < 0.25
    const belowModerate = score({ inv: { characteristics: { mechanisms_held: ["R21"], trial_pi_count: 0, active_awards: 0 }, evidence_summary: { trials: 2 } } });
    expect(belowModerate.result.components.K).toBeCloseTo(0.21, 10);
    expect(belowModerate.result).toMatchObject({ tier: "exploratory", caps: [] });
    expect(belowModerate.result.gap).toContain("Track record 0.21");
  });

  it("an empty investigator profile scores Poor without throwing", () => {
    const inv = hydrateInvestigator("empty", { paradigm: { recent: {} } });
    const opp = hydrateOpportunity("o", BASE_OPP);
    const r = scorePair(inv, opp, hydrateContext({ paradigm: { recent: {} } }));
    expect(r.tier).toBe("poor");
    expect(r.score).toBe(0);
    expect(r.components).toMatchObject({ E: 1, P: 0, U: 0, T: 0, M: 0 });
    expect(r.caps).toEqual(expect.arrayContaining(["paradigm_gate", "unit_gate", "design_required_unsupported"]));
    expect(r.provenance.P).toEqual({ view: "career", best_pair: null, excluded_hit: null, exception: null });
    expect(r.why_not).toContain("no paradigm evidence");
    expect(r.rationale).toContain("no NIH mechanism held");
  });

  it("chooseView: thin recent evidence falls back to the career view, end to end", () => {
    // recent clinical_observational at the thin-evidence cap would score sibling 0.85; the career view's clinical_trials scores 1.0
    const career = score({ inv: { paradigm: { recent: { clinical_observational: thinEvidence().cap }, career: { clinical_trials: 0.9 } } } });
    expect(career.result.provenance.P.view).toBe("career");
    expect(career.result.components.P).toBe(1);
    expect(career.result.tier).toBe("strong");
    const recent = score({ inv: { paradigm: { recent: { clinical_observational: thinEvidence().cap + 0.01 }, career: { clinical_trials: 0.9 } } } });
    expect(recent.result.provenance.P.view).toBe("recent");
    expect(recent.result.components.P).toBeCloseTo(0.85, 10);
  });
});

describe("stage 9 · gate caps (§7 stages 2–4; §9)", () => {
  it("paradigm gate: P < poor_below caps Poor, P < exploratory_below caps Exploratory, at the thresholds nothing", () => {
    // a dominant mcm at 1.0 (compat 0.15 with clinical_trials) beside health_services at p / 0.5: compat(health_systems, clinical) 0.50 → P = max(0.15, p)
    const withP = (p: number) => score({ inv: { paradigm: { recent: { molecular_cellular_mechanistic: 1, health_services: p / 0.5 } } }, opp: { paradigm: { required: { clinical_trials: 1 }, excluded: {} } } });
    expect(withP(PG.poor_below - 0.001).result).toMatchObject({ tier: "poor", caps: ["paradigm_gate"] });
    expect(withP(PG.poor_below).result.caps).toEqual(["paradigm_gate"]);
    expect(withP(PG.poor_below).result.tier).toBe("exploratory");
    expect(withP(PG.exploratory_below - 0.001).result).toMatchObject({ tier: "exploratory", caps: ["paradigm_gate"] });
    expect(withP(PG.exploratory_below).result.caps).toEqual([]);
  });

  it("unit gate: U < unit.gates.poor_below caps Poor", () => {
    const ug = unitGates();
    // the notice works at L1; a dominant L4 (compat 0.10 with L1) beside L1 at the value: U = max(0.10, u)
    expect(score({ inv: { unit: { L4: 1, L1: ug.poor_below - 0.001 } }, opp: { unit: { required: ["L1"] } } }).result).toMatchObject({ tier: "poor", caps: ["unit_gate"] });
    expect(score({ inv: { unit: { L4: 1, L1: ug.poor_below } }, opp: { unit: { required: ["L1"] } } }).result.caps).not.toContain("unit_gate");
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

  it("a notice whose paradigm axis is entirely empty is capped under low_notice_confidence: P = 1 vetoed nothing (D24 point 2, amended: allowed or excluded alone is structure)", () => {
    const r = score({ opp: { paradigm: { required: {} } } });
    expect(r.result.components.P).toBe(1);
    expect(r.result.caps).toEqual(["low_notice_confidence"]);
    expect(r.result.tier).toBe("moderate");
    expect(r.tier.caps[0]!.reason).toBe("notice names no paradigm requirement");
    expect(r.result.flags).toContain("notice names no paradigm requirement");
    // an allowed set alone is a paradigm axis (scored any-of), not an empty one
    expect(score({ opp: { paradigm: { required: {}, allowed: { clinical_trials: 0.5 } } } }).result.caps).toEqual([]);
    // an excluded set alone is structure too (the excluded rule can veto): P = 1, no cap, no flag
    const excludedOnly = score({ opp: { paradigm: { required: {}, excluded: { basic_discovery: 1 } } } });
    expect(excludedOnly.result.components.P).toBe(1);
    expect(excludedOnly.result.caps).toEqual([]);
    expect(excludedOnly.result.tier).toBe("strong");
    expect(excludedOnly.result.flags).not.toContain("notice names no paradigm requirement");
    // …and so is a required_any set
    expect(score({ opp: { paradigm: { required: {}, required_any: { clinical_trials: 1, human_biospecimen: 1 } } } }).result.caps).toEqual([]);
    // a zero weight is no structure
    expect(paradigmAxisEmpty({ paradigm: { required: {}, required_any: {}, allowed: {}, excluded: { basic_discovery: 0 } } })).toBe(true);
    expect(paradigmAxisEmpty({ paradigm: { required: {}, required_any: {}, allowed: {}, excluded: { basic_discovery: 0.2 } } })).toBe(false);
    // low confidence and an empty axis are one cap carrying both reasons
    const both = score({ opp: { paradigm: { required: {} }, confidence: "low" } });
    expect(both.result.caps).toEqual(["low_notice_confidence"]);
    expect(both.tier.caps[0]!.reason).toBe("notice profile confidence low; notice names no paradigm requirement");
  });

  it("readiness far above and a short runway cap at Moderate with their flags; an R21-scale code is never runway-capped", () => {
    const far = score({ inv: { characteristics: { mechanisms_held: ["K23"] } }, opp: { mechanism: { activity_code: "P01", clinical_trial: "required" } } });
    expect(far.result.caps).toContain("readiness_far");
    expect(far.result.tier).toBe(confidenceCap("readiness_far"));
    expect(far.result.flags).toContain("mechanism far above readiness; consider as project lead, not PI");
    expect(far.tier.caps.find((c) => c.id === "readiness_far")!.reason).toBe("mechanism P01 is far above readiness: nothing held at or above the R01 row");
    expect(far.result.gap).toContain("far above readiness; consider as project lead, not PI");
    const short = score({ inv: { characteristics: { runway_weeks: 2 } } });
    expect(short.result.caps).toContain("runway_short");
    expect(short.result.tier).toBe(confidenceCap("runway_short"));
    expect(short.result.flags).toContain("deadline runway short; show the next cycle if the notice has one");
    const r21 = score({ inv: { characteristics: { runway_weeks: 2 } }, opp: { mechanism: { activity_code: "R21", clinical_trial: "required" } } });
    expect(r21.result.caps).not.toContain("runway_short");
    expect(r21.result.components.A).toBeCloseTo(2 / 3, 10);
    expect(r21.result.tier).toBe("moderate"); // the Strong A floor (runway sufficient) is the one gap
    expect(r21.tier.strong_gaps).toEqual(["A"]);
  });

  it("profileConfidence is the weakest of paradigm, unit, design and topic", () => {
    const inv = hydrateInvestigator("i", { paradigm: { recent: {} }, confidence: { paradigm: "high", unit: "medium", design: "high", topic: "high", materials: "low", objective: "low" } });
    expect(profileConfidence(inv)).toBe("medium");
  });
});

describe("stage 9 · exploratory exceptions and aspirations (§9; §5)", () => {
  // A basic scientist (discovery) against a Clinical Trial Required notice: P = compat(discovery, clinical) 0.15 < 0.25 → Poor unless bridged.
  // The dominant category sits at 1.0 so a side line at the bridge minimum 0.40 carries 0.40 · compat(translational, clinical) 0.60 = 0.24, still under the gate.
  const basic: Partial<FixtureInvestigator> = { paradigm: { recent: { molecular_cellular_mechanistic: 1 } }, unit: { L1: 0.9, L3: 0.5 }, design: { wet_lab_experiment: 0.9 }, materials: { human_primary_cells: 0.8 } };
  const bridge = exploratoryException("translational_bridge");
  const bio = exploratoryException("biospecimen_bridge");
  const trialist = [{ id: "trialist-1", name: "Dana Okonjo", dominant_family: "clinical" as const, categories: ["clinical_trials" as const] }];
  // A clinical investigator against a fundamental-mechanism RFA that allows human tissue: clinical_observational 0.85 (compat 0.15 with discovery) beside human_biospecimen 0.40 → 0.40 / 0.85 · compat(translational, discovery) 0.40 = 0.19 → gated unless bridged.
  const clinician: Partial<FixtureInvestigator> = { paradigm: { recent: { clinical_observational: 0.85, human_biospecimen: bio.investigator_human_biospecimen_min } }, unit: { L3: 0.9 }, design: { prospective_cohort: 0.8 } };
  const mechanism: FixtureOpportunity = { mechanism: { activity_code: "R01", clinical_trial: "not_allowed" }, paradigm: { required: { molecular_cellular_mechanistic: 0.9 } }, unit: { required: ["L1"], allowed: ["L3"] }, design: { required_any: ["wet_lab_experiment"], allowed: ["biospecimen_assay"] }, materials: { expected: ["human_tissue_biopsy"] } };

  it("translational bridge: translational ≥ the minimum and a collaborator in a required family lifts a paradigm-gated Poor to Exploratory", () => {
    const lifted = score({ inv: { ...basic, paradigm: { recent: { molecular_cellular_mechanistic: 1, translational: bridge.investigator_translational_min } }, collaborators: trialist } });
    expect(lifted.result.tier).toBe("exploratory");
    expect(lifted.result.caps).toEqual(["paradigm_gate_relaxed_translational_bridge", "design_required_unsupported"]);
    expect(lifted.result.components.P).toBeCloseTo(0.24, 10);
    expect(lifted.result.provenance.P.exception).toBe("translational_bridge");
    // provenance stores the id (the UI resolves it to a profile link); the gap sentence names the person
    expect(lifted.result.provenance.collaborators).toEqual(["trialist-1"]);
    expect(lifted.result.gap).toContain("Collaborators in the directory who do this: Dana Okonjo.");
    expect(lifted.result.gap).not.toContain("trialist-1");
    // the same id leak in the other text channel: the relaxed-gate flag named the collaborator by id too
    expect(lifted.result.flags).toContain("paradigm gate relaxed: translational work with a collaborator in the required field (Dana Okonjo)");
    expect(lifted.result.flags.join(" ")).not.toContain("trialist-1");
    const noCollaborator = score({ inv: { ...basic, paradigm: { recent: { molecular_cellular_mechanistic: 1, translational: bridge.investigator_translational_min } } } });
    expect(noCollaborator.result.tier).toBe("poor");
    expect(noCollaborator.result.caps).toEqual(["paradigm_gate", "design_required_unsupported"]);
    const wrongFamily = score({ inv: { ...basic, paradigm: { recent: { molecular_cellular_mechanistic: 1, translational: bridge.investigator_translational_min } }, collaborators: [{ id: "epi-1", dominant_family: "population", categories: ["epidemiology"] }] } });
    expect(wrongFamily.result.tier).toBe("poor");
    // a translational weight above 0.25 / compat(translational, clinical) = 0.4167 of the dominant clears the Poor gate on its own, so the bridge has nothing to lift
    const selfLifted = score({ inv: { ...basic, paradigm: { recent: { molecular_cellular_mechanistic: 1, translational: 0.6 } } } });
    expect(selfLifted.result.components.P).toBeCloseTo(0.36, 10);
    expect(selfLifted.result.caps).toEqual(["paradigm_gate", "design_required_unsupported"]);
    expect(selfLifted.result.tier).toBe("exploratory");
    // under D23 a dominant under 0.96 makes translational 0.40 clear the gate by itself (0.40 / 0.85 · 0.60 = 0.28): the bridge is for near-pure basic scientists
    const lighterDominant = score({ inv: { ...basic, paradigm: { recent: { molecular_cellular_mechanistic: 0.85, translational: bridge.investigator_translational_min } }, collaborators: trialist } });
    expect(lighterDominant.result.components.P).toBeCloseTo((0.4 / 0.85) * familyCompat("translational", "clinical"), 10);
    expect(lighterDominant.result.caps).toEqual(["paradigm_gate", "design_required_unsupported"]);
    const thin = score({ inv: { ...basic, paradigm: { recent: { molecular_cellular_mechanistic: 1, translational: bridge.investigator_translational_min - 0.01 } }, collaborators: trialist } });
    expect(thin.result.tier).toBe("poor");
  });

  it("biospecimen bridge: human_biospecimen ≥ the minimum and a notice that allows human tissue", () => {
    const lifted = score({ inv: clinician, opp: mechanism, topic: 0.8 });
    expect(lifted.result.components.P).toBeCloseTo((0.4 / 0.85) * familyCompat("translational", "discovery"), 10);
    expect(lifted.result.caps).toContain("paradigm_gate_relaxed_biospecimen_bridge");
    expect(lifted.result.provenance.P.exception).toBe("biospecimen_bridge");
    expect(noticeAllowsHumanTissue(hydrateOpportunity("o", mechanism))).toBe(true);
    const noTissue = score({ inv: clinician, opp: { ...mechanism, design: { required_any: ["wet_lab_experiment"], allowed: [] }, materials: { expected: ["animal_mouse"] } }, topic: 0.8 });
    expect(noticeAllowsHumanTissue(hydrateOpportunity("o", { ...mechanism, design: { required_any: ["wet_lab_experiment"], allowed: [] }, materials: { expected: ["animal_mouse"] } }))).toBe(false);
    expect(noTissue.result.tier).toBe("poor");
  });

  it("a bridge is written for a notice family (exploratory_exceptions.notice_families): the translational bridge never opens a population or health-systems notice, the biospecimen bridge never a clinical one", () => {
    expect(exceptionNoticeFamilies("translational_bridge")).toEqual(["clinical"]);
    expect(exceptionNoticeFamilies("biospecimen_bridge")).toEqual(["discovery", "preclinical"]);
    // discovery investigator, translational bridge armed with a population collaborator, against an epidemiology notice:
    // P = max(0.05, 0.40 · compat(translational, population) 0.20) = 0.08 → gated; every bridge condition but the family holds
    const epi: FixtureOpportunity = { ...BASE_OPP, paradigm: { required: { epidemiology: 1 } }, unit: { required: ["L4"] }, design: { required_any: ["prospective_cohort"] } };
    const armed = score({ inv: { ...basic, paradigm: { recent: { molecular_cellular_mechanistic: 1, translational: bridge.investigator_translational_min } }, collaborators: [{ id: "epi-1", dominant_family: "population", categories: ["epidemiology"] }] }, opp: epi });
    expect(armed.result.components.P).toBeCloseTo(0.08, 10);
    expect(armed.tier.collaborators).toEqual(["epi-1"]);
    expect(armed.result.tier).toBe("poor");
    expect(armed.result.caps).toEqual(["paradigm_gate", "design_required_unsupported"]);
    expect(armed.result.provenance.P.exception).toBeNull();
    // the same shape against a health-services notice
    const hsr = score({ inv: { ...basic, paradigm: { recent: { molecular_cellular_mechanistic: 1, translational: bridge.investigator_translational_min } }, collaborators: [{ id: "hsr-1", dominant_family: "health_systems", categories: ["health_services"] }] }, opp: { ...epi, paradigm: { required: { health_services: 1 } } } });
    expect(hsr.result.tier).toBe("poor");
    expect(hsr.result.provenance.P.exception).toBeNull();
    // biospecimen bridge armed (human_biospecimen 0.40, the trial allows biospecimen assays) against the clinical-trial notice: P = max(0.15, 0.40 · 0.60) = 0.24 → gated; the bridge is for discovery / preclinical notices
    const tissueTrial: FixtureOpportunity = { ...BASE_OPP, design: { required_any: ["rct"], allowed: ["biospecimen_assay"] } };
    expect(noticeAllowsHumanTissue(hydrateOpportunity("o", tissueTrial))).toBe(true);
    const bioArmed = score({ inv: { ...basic, paradigm: { recent: { molecular_cellular_mechanistic: 1, human_biospecimen: bio.investigator_human_biospecimen_min } } }, opp: tissueTrial });
    expect(bioArmed.result.components.P).toBeCloseTo(0.24, 10);
    expect(bioArmed.result.tier).toBe("poor");
    expect(bioArmed.result.caps).toEqual(["paradigm_gate", "design_required_unsupported"]);
    // a notice requiring a clinical and a population category together is outside the translational bridge's families: P = (0.24 + 0.08) / 2 = 0.16 → gated, not lifted
    const mixed = score({ inv: { ...basic, paradigm: { recent: { molecular_cellular_mechanistic: 1, translational: bridge.investigator_translational_min } }, collaborators: trialist }, opp: { ...BASE_OPP, paradigm: { required: { clinical_trials: 1, epidemiology: 1 } } } });
    expect(mixed.result.components.P).toBeCloseTo(0.16, 10);
    expect(mixed.tier.required_families).toEqual(["clinical", "population"]);
    expect(mixed.result.tier).toBe("poor");
    expect(mixed.result.provenance.P.exception).toBeNull();
  });

  it("a bridge is written for an investigator family too (exploratory_exceptions.investigator_families): the translational bridge lifts a basic scientist only, the biospecimen bridge a clinical investigator only", () => {
    expect(exceptionInvestigatorFamilies("translational_bridge")).toEqual(["discovery", "preclinical"]);
    expect(exceptionInvestigatorFamilies("biospecimen_bridge")).toEqual(["clinical"]);
    // a cross-cutting dominant scores P = √(U · D) = √(0.56 · 0.10) = 0.24 → gated; translational 0.40 and a trialist collaborator hold, but the §9 row is the basic scientist's
    const crossCutting = score({ inv: { ...basic, paradigm: { recent: { computational_data_science: 1, translational: bridge.investigator_translational_min } }, collaborators: trialist } });
    expect(crossCutting.stages.P.dominant?.category).toBe("computational_data_science");
    expect(crossCutting.result.components.P).toBeCloseTo(Math.sqrt(crossCutting.result.components.U * crossCutting.result.components.D), 10);
    expect(crossCutting.result.components.P).toBeLessThan(PG.poor_below);
    expect(crossCutting.tier.required_families).toEqual(["clinical"]);
    expect(crossCutting.tier.collaborators).toEqual(["trialist-1"]);
    expect(crossCutting.result.tier).toBe("poor");
    expect(crossCutting.result.caps).toEqual(["paradigm_gate", "design_required_unsupported"]);
    expect(crossCutting.result.provenance.P.exception).toBeNull();
    // an epidemiologist with human_biospecimen 0.40 against the mechanism notice that allows human tissue: P = 0.40 / 0.85 · 0.40 = 0.19 → gated, and no bridge lifts it (§9: a mechanist and a cohort epidemiologist, either way round)
    const epidemiologist = score({ inv: { paradigm: { recent: { epidemiology: 0.85, human_biospecimen: bio.investigator_human_biospecimen_min } }, unit: { L4: 0.9, L1: 0.5 }, design: { prospective_cohort: 0.8 } }, opp: mechanism, topic: 0.8 });
    expect(epidemiologist.result.components.P).toBeCloseTo((0.4 / 0.85) * familyCompat("translational", "discovery"), 10);
    expect(noticeAllowsHumanTissue(hydrateOpportunity("o", mechanism))).toBe(true);
    expect(epidemiologist.result.tier).toBe("poor");
    expect(epidemiologist.result.caps).toEqual(["paradigm_gate", "design_required_unsupported"]);
    expect(epidemiologist.result.provenance.P.exception).toBeNull();
    // the same shape for a health-services investigator
    const hsr = score({ inv: { paradigm: { recent: { health_services: 0.85, human_biospecimen: bio.investigator_human_biospecimen_min } }, unit: { L5: 0.9, L1: 0.5 }, design: { prospective_cohort: 0.8 } }, opp: mechanism, topic: 0.8 });
    expect(hsr.result.tier).toBe("poor");
    expect(hsr.result.caps).toEqual(["paradigm_gate", "design_required_unsupported"]);
    expect(hsr.result.provenance.P.exception).toBeNull();
    // the clinical investigator of the §9 row is lifted by the same notice
    expect(score({ inv: clinician, opp: mechanism, topic: 0.8 }).result.provenance.P.exception).toBe("biospecimen_bridge");
  });

  it("the bridge never lifts a unit-gated Poor", () => {
    const r = score({ inv: { ...basic, unit: { L1: 0.9 }, paradigm: { recent: { molecular_cellular_mechanistic: 1, translational: bridge.investigator_translational_min } }, collaborators: trialist }, opp: { ...BASE_OPP, unit: { required: ["L5"] } } });
    expect(r.result.caps).toEqual(["paradigm_gate_relaxed_translational_bridge", "unit_gate", "design_required_unsupported"]);
    expect(r.result.tier).toBe("poor");
    expect(r.result.why_not).toContain("Paradigm:");
    expect(r.result.why_not).toContain("Unit:");
  });

  it("an aspiration naming the required paradigm lifts the gate to Exploratory under paradigm_gate_relaxed_aspiration and never higher", () => {
    const r = score({ inv: { ...basic, aspirations: ["clinical_trials"] } });
    expect(r.result.tier).toBe("exploratory");
    expect(r.result.caps).toEqual(["paradigm_gate_relaxed_aspiration", "design_required_unsupported"]);
    expect(r.tier.aspiration_relaxed).toBe(true);
    expect(r.tier.exception).toBeNull();
    expect(r.result.provenance.P.exception).toBeNull();
    expect(r.result.flags).toContain("aspiration names the required paradigm (clinical_trials); Exploratory at most");
    expect(r.result.provenance.floors.tier_by_floors).toBe("exploratory");
    expect(r.result.gap).toContain("Paradigm: notice requires Clinical trials");
    // an aspiration that names nothing the notice requires leaves the gate alone
    expect(score({ inv: { ...basic, aspirations: ["epidemiology"] } }).result.caps).toEqual(["paradigm_gate", "design_required_unsupported"]);
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
