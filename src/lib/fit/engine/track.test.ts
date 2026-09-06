import { describe, expect, it } from "vitest";
import { actionability, track } from "@/lib/fit/engine/track";
import { hydrateContext, hydrateInvestigator, hydrateOpportunity, type FixtureCharacteristics, type FixtureOpportunity } from "@/lib/fit/engine/fixtures";
import { actionabilityParams, readinessRung, trackParams } from "@/lib/fit/taxonomy";

const T = trackParams();
const A = actionabilityParams();

const inv = (c: FixtureCharacteristics, trials = 0) => hydrateInvestigator("i", { paradigm: { recent: {} }, characteristics: { mechanisms_held: [], active_awards: 0, trial_pi_count: 0, ...c }, evidence_summary: { trials } });
const opp = (fx: FixtureOpportunity = {}) => hydrateOpportunity("o", { mechanism: { activity_code: "R01" }, ...fx });
const ctx = (c: FixtureCharacteristics = {}, prior: number | null = null) => ({ ...hydrateContext({ paradigm: { recent: {} }, characteristics: c }), track: prior === null ? null : { prior_ucsf_awardees_same_code: prior } });

describe("stage 7 · track record K (§7 stage 7; §9 readiness row)", () => {
  it("readinessRung follows compose.track.readiness_ladder, case-insensitively; an unlisted code is null", () => {
    expect(readinessRung("K23")).toBe(0);
    expect(readinessRung("r21")).toBe(1);
    expect(readinessRung(" R01 ")).toBe(2);
    expect(readinessRung("U01")).toBe(3);
    expect(readinessRung("X01")).toBeNull();
    expect(readinessRung(null)).toBeNull();
    expect(T.readiness_ladder[2]).toContain("R18");
  });

  it("K = w_readiness · readiness + w_active · min(1, active / saturation) + w_prior · min(1, prior / saturation)", () => {
    // Fixture case 5: R01 held vs R01 (distance 0 → held_or_below 1.0), 2 active awards (2 / 2 → 1), no prior awardees
    // K = 0.6 · 1.0 + 0.2 · 1 + 0.2 · 0 = 0.8
    const r = track(inv({ mechanisms_held: ["K23", "R01", "U01"], active_awards: 2 }), opp(), ctx());
    expect(r).toMatchObject({ readiness: T.readiness.held_or_below, notice_rung: 2, held_rung: 3, distance: -1, far: false, active_awards_term: 1, prior_awardees_term: 0 });
    expect(r.K).toBeCloseTo(T.weights.readiness * T.readiness.held_or_below + T.weights.active_awards * 1, 10);
    expect(r.K).toBeCloseTo(0.8, 10);
    // prior awardees saturate at prior_awardees_saturation
    expect(track(inv({ mechanisms_held: ["R01"], active_awards: 0 }), opp(), ctx({}, 1)).prior_awardees_term).toBeCloseTo(1 / T.prior_awardees_saturation, 10);
    expect(track(inv({ mechanisms_held: ["R01"], active_awards: 0 }), opp(), ctx({}, 99)).prior_awardees_term).toBe(1);
  });

  it("one rung above readiness is one_above; far_above_distance and beyond is far (the readiness_far cap); nothing held sits one rung below the ladder", () => {
    const oneAbove = track(inv({ mechanisms_held: ["R21"] }), opp(), ctx());
    expect(oneAbove).toMatchObject({ distance: 1, readiness: T.readiness.one_above, far: false });
    expect(oneAbove.K).toBeCloseTo(T.weights.readiness * T.readiness.one_above, 10); // 0.42
    const far = track(inv({ mechanisms_held: ["K23"] }), opp({ mechanism: { activity_code: "P01" } }), ctx());
    expect(far).toMatchObject({ distance: 3, readiness: T.readiness.far_above, far: true });
    expect(track(inv({ mechanisms_held: [] }), opp(), ctx())).toMatchObject({ held_rung: null, distance: 3, far: true });
    expect(track(inv({ mechanisms_held: [] }), opp({ mechanism: { activity_code: "K23" } }), ctx())).toMatchObject({ distance: 1, far: false });
    expect(track(inv({ mechanisms_held: ["R01"] }), opp({ mechanism: { activity_code: "K23" } }), ctx())).toMatchObject({ distance: -2, readiness: T.readiness.held_or_below });
    expect(track(inv({ mechanisms_held: ["R21"] }), opp({ mechanism: { activity_code: "R01" } }), ctx()).distance).toBe(T.far_above_distance - 1);
  });

  it("an activity code on no rung is unknown readiness; held codes on no rung are ignored", () => {
    const r = track(inv({ mechanisms_held: ["X01", "R01"] }), opp({ mechanism: { activity_code: "U24X" } }), ctx());
    expect(r).toMatchObject({ notice_rung: null, held_rung: 2, distance: null, readiness: T.readiness.unknown, far: false, activity_code: "U24X" });
    expect(track(inv({ mechanisms_held: [] }), opp({ mechanism: { activity_code: null } }), ctx())).toMatchObject({ notice_rung: null, readiness: T.readiness.unknown, activity_code: null });
  });

  it("trial experience only as a sub-investigator on a Clinical Trial Required notice halves the readiness credit", () => {
    const sub = track(inv({ mechanisms_held: ["R01"], trial_pi_count: 0 }, 2), opp({ mechanism: { activity_code: "R01", clinical_trial: "required" } }), ctx());
    expect(sub.sub_investigator_only).toBe(true);
    expect(sub.readiness).toBeCloseTo(T.readiness.held_or_below * T.sub_investigator_trial_credit, 10);
    expect(track(inv({ mechanisms_held: ["R01"], trial_pi_count: 1 }, 2), opp({ mechanism: { activity_code: "R01", clinical_trial: "required" } }), ctx()).sub_investigator_only).toBe(false);
    expect(track(inv({ mechanisms_held: ["R01"], trial_pi_count: 0 }, 0), opp({ mechanism: { activity_code: "R01", clinical_trial: "required" } }), ctx()).sub_investigator_only).toBe(false);
    expect(track(inv({ mechanisms_held: ["R01"], trial_pi_count: 0 }, 2), opp({ mechanism: { activity_code: "R01", clinical_trial: "optional" } }), ctx()).sub_investigator_only).toBe(false);
  });
});

describe("stage 7 · actionability A (§7 stage 7; §9 runway row)", () => {
  it("runway at or above the mechanism's weeks is sufficient; below it scales linearly; under runway_weeks_r21 is short", () => {
    const r01 = actionability(inv({}), opp(), ctx({ runway_weeks: A.runway_weeks_r01 }));
    expect(r01).toMatchObject({ A: 1, runway_needed_weeks: A.runway_weeks_r01, runway_sufficient: true, runway_short: false, load: false });
    const half = actionability(inv({}), opp(), ctx({ runway_weeks: A.runway_weeks_r01 / 2 }));
    expect(half.A).toBeCloseTo(0.5, 10);
    expect(half.runway_sufficient).toBe(false);
    expect(half.runway_short).toBe(A.runway_weeks_r01 / 2 < A.runway_weeks_r21);
    expect(actionability(inv({}), opp(), ctx({ runway_weeks: A.runway_weeks_r21 })).runway_short).toBe(false);
    expect(actionability(inv({}), opp(), ctx({ runway_weeks: A.runway_weeks_r21 - 1 })).runway_short).toBe(true);
    expect(actionability(inv({}), opp(), ctx({ runway_weeks: 0 })).A).toBe(0);
  });

  it("an R21-rung mechanism needs runway_weeks_r21", () => {
    const r = actionability(inv({}), opp({ mechanism: { activity_code: "R03" } }), ctx({ runway_weeks: A.runway_weeks_r21 }));
    expect(r).toMatchObject({ runway_needed_weeks: A.runway_weeks_r21, runway_sufficient: true, A: 1 });
    expect(actionability(inv({}), opp({ mechanism: { activity_code: "K23" } }), ctx({ runway_weeks: 10 })).runway_needed_weeks).toBe(A.runway_weeks_r01);
  });

  it("an unknown deadline is not a fail: factor 1, but never sufficient for the Strong floor", () => {
    expect(actionability(inv({}), opp(), ctx({ runway_weeks: null }))).toMatchObject({ A: 1, runway_factor: 1, runway_sufficient: false, runway_short: false });
  });

  it("in the pipeline or recently dismissed zeroes A; a heavy load applies load_penalty_factor", () => {
    expect(actionability(inv({}), opp(), ctx({ runway_weeks: 10, in_pipeline: true })).A).toBe(0);
    expect(actionability(inv({}), opp(), ctx({ runway_weeks: 10, recently_dismissed: true })).A).toBe(0);
    const heavy = actionability(inv({ active_awards: A.active_r01_equiv_load_penalty_at }), opp(), ctx({ runway_weeks: 10 }));
    expect(heavy).toMatchObject({ load: true, A: A.load_penalty_factor });
    expect(actionability(inv({ active_awards: A.active_r01_equiv_load_penalty_at - 1 }), opp(), ctx({ runway_weeks: 10 })).load).toBe(false);
  });
});
