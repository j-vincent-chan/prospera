/**
 * Stage 7 · track record (K) and actionability (A) (spec §7 stage 7; §9
 * readiness and runway rows; §10 K and A floors). Parameters from
 * `compose.track` and `compose.actionability`.
 *
 * K = w_readiness · readiness
 *   + w_active_awards · min(1, active_awards / active_awards_saturation)
 *   + w_prior_awardees · min(1, prior UCSF awardees under the code / prior_awardees_saturation)
 *
 *   readiness from the notice's row on the readiness ladder (K → R21/R03 →
 *   R01 → U01/P01) against the highest row held: `held_or_below` when a
 *   held code is on the notice's row or above ("has held this tier");
 *   `far_above` when the notice is on row ≥ `far_above.notice_min_rung`
 *   (U01/P01) and nothing held is on row ≥ `far_above.held_below_rung`
 *   (R01) — the §9 "P01/U54 to an investigator with no R01" row, nothing
 *   held included (tier.ts caps at `confidence_caps.readiness_far`);
 *   `one_above` otherwise ("or the one below" — within readiness); and
 *   `unknown` when the notice code is on no row (held codes on no row are
 *   ignored). On a Clinical Trial Required notice, trial experience only as
 *   a sub-investigator multiplies readiness by `sub_investigator_trial_credit`
 *   ("halves the credit for 'can lead a trial'").
 *
 * A = runway factor · (in pipeline ? 0 : 1) · (recently dismissed ? 0 : 1)
 *   · (active awards ≥ active_r01_equiv_load_penalty_at ? load_penalty_factor : 1)
 *
 *   runway factor = 1 at or above the weeks the mechanism needs
 *   (`runway_weeks_r21` for codes on a `short_runway_rungs` row, else
 *   `runway_weeks_r01`), runway / needed below it, 0 at or past the
 *   deadline, and 1 when no deadline is on file (unknown is not fail; the
 *   Strong A floor still needs a known, sufficient runway). Runway under
 *   `runway_weeks_r21` on a code that needs the R01-scale runway is the §9
 *   "runway < 3 weeks (R01 scale)" row (tier.ts caps at
 *   `confidence_caps.runway_short`); an R21-scale code is never capped for
 *   it — its factor already says how short the runway is.
 */
import { actionabilityParams, readinessRung, trackParams } from "@/lib/fit/taxonomy";
import type { ActionabilityInputs, InvestigatorFitProfile, OpportunityFitProfile, ScoreContext } from "@/lib/fit/types";
import { clamp01 } from "@/lib/fit/engine/util";

export type TrackResult = {
  K: number;
  readiness: number;
  notice_rung: number | null;
  held_rung: number | null;
  /** notice rung − highest held rung; null when either is unknown (nothing held, or the notice code on no row). */
  distance: number | null;
  far: boolean;
  sub_investigator_only: boolean;
  active_awards_term: number;
  prior_awardees_term: number;
  mechanisms_held: string[];
  activity_code: string | null;
};

const normalizeCode = (code: string | null | undefined): string | null => {
  const c = code?.trim().toUpperCase() ?? "";
  return c.length ? c : null;
};

/** §9 "mechanism far above readiness": the notice on the top rows while nothing at the R01 row or above is held (`compose.track.far_above`). */
export function farAboveReadiness(notice_rung: number, held_rung: number | null): boolean {
  const rule = trackParams().far_above;
  return notice_rung >= rule.notice_min_rung && (held_rung === null || held_rung < rule.held_below_rung);
}

export function track(inv: InvestigatorFitProfile, opp: OpportunityFitProfile, ctx: ScoreContext): TrackResult {
  const p = trackParams();
  const activity_code = normalizeCode(opp.mechanism.activity_code);
  const notice_rung = readinessRung(activity_code);
  const mechanisms_held = inv.characteristics.mechanisms_held.map(normalizeCode).filter((c): c is string => c !== null);
  const heldRungs = mechanisms_held.map((c) => readinessRung(c)).filter((r): r is number => r !== null);
  const held_rung = heldRungs.length ? Math.max(...heldRungs) : null;

  let distance: number | null = null;
  let readiness: number;
  let far = false;
  if (notice_rung === null) readiness = p.readiness.unknown;
  else {
    distance = held_rung === null ? null : notice_rung - held_rung;
    if (held_rung !== null && held_rung >= notice_rung) readiness = p.readiness.held_or_below;
    else if (farAboveReadiness(notice_rung, held_rung)) {
      readiness = p.readiness.far_above;
      far = true;
    } else readiness = p.readiness.one_above;
  }
  const sub_investigator_only = opp.mechanism.clinical_trial === "required" && inv.characteristics.trial_pi_count === 0 && inv.evidence_summary.trials > 0;
  if (sub_investigator_only) readiness *= p.sub_investigator_trial_credit;

  const active_awards_term = clamp01(inv.characteristics.active_awards / p.active_awards_saturation);
  const prior = ctx.track?.prior_ucsf_awardees_same_code ?? null;
  const prior_awardees_term = prior === null ? 0 : clamp01(prior / p.prior_awardees_saturation);
  const K = p.weights.readiness * readiness + p.weights.active_awards * active_awards_term + p.weights.prior_awardees * prior_awardees_term;

  return { K, readiness, notice_rung, held_rung, distance, far, sub_investigator_only, active_awards_term, prior_awardees_term, mechanisms_held, activity_code };
}

export type ActionabilityResult = {
  A: number;
  runway_needed_weeks: number;
  runway_factor: number;
  /** A known runway at or above what the mechanism needs (the Strong A floor). */
  runway_sufficient: boolean;
  /** Runway under `runway_weeks_r21` on a code that needs the R01-scale runway (§9 "runway < 3 weeks (R01 scale)" cap). */
  runway_short: boolean;
  load: boolean;
  inputs: ActionabilityInputs;
};

/** Whether a code's row is one of `compose.actionability.short_runway_rungs` (the R21-scale mechanisms). */
export function needsShortRunway(activity_code: string | null | undefined): boolean {
  const rung = readinessRung(activity_code);
  return rung !== null && actionabilityParams().short_runway_rungs.includes(rung);
}

export function actionability(inv: InvestigatorFitProfile, opp: OpportunityFitProfile, ctx: ScoreContext): ActionabilityResult {
  const p = actionabilityParams();
  const inputs = ctx.actionability;
  const shortScale = needsShortRunway(opp.mechanism.activity_code);
  const runway_needed_weeks = shortScale ? p.runway_weeks_r21 : p.runway_weeks_r01;
  const runway = inputs.runway_weeks;
  const runway_factor = runway === null ? 1 : runway <= 0 ? 0 : Math.min(1, runway / runway_needed_weeks);
  const runway_sufficient = runway !== null && runway >= runway_needed_weeks;
  const runway_short = !shortScale && runway !== null && runway < p.runway_weeks_r21;
  const load = inv.characteristics.active_awards >= p.active_r01_equiv_load_penalty_at;
  const A = runway_factor * (inputs.in_pipeline ? 0 : 1) * (inputs.recently_dismissed ? 0 : 1) * (load ? p.load_penalty_factor : 1);
  return { A, runway_needed_weeks, runway_factor, runway_sufficient, runway_short, load, inputs };
}
