/**
 * Stage 9 · tier floors, gate caps, confidence caps and exploratory
 * exceptions (spec §7 stage 9; §9; §10; `taxonomy.tiers`,
 * `confidence_caps`, `exploratory_exceptions`).
 *
 * Floors are conjunctive per tier (`floors(tier)`). The tier the floors
 * alone give is the best tier whose every floor is met, with §10's gap
 * rule for Moderate: at most `gaps_allowed` Strong floors missed, none of
 * them in `gap_not_in` — P, U and the required-design floor are governed by
 * their own Moderate values (the spec's case 7b sits at a required-group
 * support of 0.35, under Strong's 0.40, and is Moderate), so the gap rule
 * counts the other Strong floors (D, T, M, K, A, confidence, E-no-unknowns).
 * Exploratory's P floor is met by P itself or, when an aspiration names the
 * required paradigm, by `P_with_aspiration` ≥ `P_with_aspiration`.
 *
 * Caps (each with the highest tier it allows):
 *   paradigm_gate · P < `paradigm.gates.poor_below` → poor;
 *                   < `exploratory_below` → exploratory
 *   paradigm_gate_relaxed_<exception> · a paradigm-gated Poor lifted to
 *     Exploratory by `exploratory_exceptions` (§9): translational_bridge —
 *     `translational` ≥ investigator_translational_min and a collaborator
 *     whose dominant family is one the notice requires; biospecimen_bridge —
 *     `human_biospecimen` ≥ investigator_human_biospecimen_min and the notice
 *     allows human tissue. Either fires only for the §9 row it was written
 *     for: the dominant paradigm's family is in the bridge's
 *     `investigator_families` (discovery and preclinical for the
 *     translational bridge's basic scientist; clinical for the biospecimen
 *     bridge's clinical investigator) and every family the notice requires
 *     is in its `notice_families` (clinical; discovery and preclinical), so
 *     no bridge reopens a forbidden family cell from either side — §9: "No
 *     collaborator makes a mechanist a cohort epidemiologist".
 *   paradigm_gate_relaxed_aspiration · an aspiration match with
 *     P_with_aspiration at the Exploratory floor relaxes the gate the same
 *     way (§10 Exploratory row). A relaxed gate also waives the Exploratory
 *     P floor.
 *   unit_gate · U < `unit.gates.poor_below` → poor
 *   design_required_unsupported · a required group under
 *     `design.gates.required_group_unsupported_below` → `required_unsupported_cap_tier`
 *   eligibility_unknown, low_profile_confidence (a low gate-axis confidence
 *     or a partial profile, `pending_items` > 0 — D20), low_notice_confidence
 *     (low, `sources.complete` false — D22 — or a notice whose paradigm axis
 *     is empty: nothing required, required_any or allowed, so P = 1 vetoed
 *     nothing), readiness_far, runway_short · `confidence_caps`
 *
 * The final tier is the worst of the floor tier and every cap. The stage-8
 * verdict does not exist yet (Phase 3): its floor counts as met.
 */
import { confidenceAtLeast } from "@/lib/fit/profile/aggregate";
import { confidenceCap, designGates, exceptionInvestigatorFamilies, exceptionNoticeFamilies, EXPLORATORY_EXCEPTION_IDS, exploratoryException, familyOf, floors, materialsGroupOf, PARADIGM_FAMILY_IDS, paradigmGates, trackParams, unitGates } from "@/lib/fit/taxonomy";
import type { CapId, Components, Confidence, ExploratoryExceptionId, FloorTier, InvestigatorFitProfile, NumericFloorKey, OpportunityFitProfile, ParadigmFamily, ScoreContext, Tier, UnmetFloor } from "@/lib/fit/types";
import type { EligibilityResult } from "@/lib/fit/engine/eligibility";
import type { ParadigmResult } from "@/lib/fit/engine/paradigm";
import type { UnitResult } from "@/lib/fit/engine/unit";
import type { DesignResult } from "@/lib/fit/engine/design";
import type { TopicResult } from "@/lib/fit/engine/topic";
import type { MethodsResult } from "@/lib/fit/engine/methods";
import type { ObjectiveResult } from "@/lib/fit/engine/objective";
import type { ActionabilityResult, TrackResult } from "@/lib/fit/engine/track";
import { uniq, weightOf, worseTier } from "@/lib/fit/engine/util";

export type Cap = { id: CapId; max_tier: Tier; reason: string };

/** Everything the stages left behind, for tiering and explanation. */
export type StageResults = {
  inv: InvestigatorFitProfile;
  opp: OpportunityFitProfile;
  ctx: ScoreContext;
  components: Components;
  E: EligibilityResult;
  P: ParadigmResult;
  U: UnitResult;
  D: DesignResult;
  T: TopicResult;
  M: MethodsResult;
  O: ObjectiveResult;
  K: TrackResult;
  A: ActionabilityResult;
};

/** One floor of one tier, checked. `value` is null for non-numeric floors. */
export type FloorCheck = { key: string; ok: boolean; value: number | null; floor: number | string };

export type TierResult = {
  tier: Tier;
  tier_by_floors: Tier;
  caps: Cap[];
  /** Numeric floors of the next tier up that were missed (provenance). */
  unmet: UnmetFloor[];
  /** Every floor of the next tier up that was missed, numeric or not. */
  missed_next: FloorCheck[];
  /** Strong floors missed that count as gaps (not P, U or the required-design floor). */
  strong_gaps: string[];
  exception: ExploratoryExceptionId | null;
  aspiration_relaxed: boolean;
  /** Families the notice's paradigm terms belong to. */
  required_families: ParadigmFamily[];
  /** Collaborators whose dominant family is one the notice requires. */
  collaborators: string[];
  profile_confidence: Confidence;
  flags: string[];
};

/** The tier a paradigm-gated Poor may surface as under `exploratory_exceptions` (its `_comment`) and the aspiration rule (§10 Exploratory row). */
const RELAXED_TIER: Tier = "exploratory";

/** The `low_notice_confidence` reason (and flag) for a notice whose paradigm axis is empty, so P = 1 vetoed nothing (D24 point 2). */
export const NO_PARADIGM_REQUIREMENT = "notice names no paradigm requirement";

/** Decision (PR 2.1, kept in code): the axes whose confidence caps a profile are the three gates plus topic; materials and objective only score (§7 stages 2–5; D20). */
const GATE_AXES = ["paradigm", "unit", "design", "topic"] as const;

/** The investigator profile's confidence for capping: the weakest of the gate axes and topic (materials and objective only score). */
export function profileConfidence(inv: Pick<InvestigatorFitProfile, "confidence">): Confidence {
  let worst: Confidence = "high";
  for (const axis of GATE_AXES) {
    const c = inv.confidence[axis];
    if (!confidenceAtLeast(c, worst)) worst = c;
  }
  return worst;
}

/** Human tissue is welcome: a human-biological materials kind is expected or required, or `human_biospecimen` / `biospecimen_assay` is required or allowed (`exploratory_exceptions.biospecimen_bridge.notice_allows_human_tissue`). */
export function noticeAllowsHumanTissue(opp: OpportunityFitProfile): boolean {
  const kinds = [...opp.materials.expected, ...opp.materials.required, ...opp.materials.required_any];
  if (kinds.some((k) => materialsGroupOf(k) === "human_biological")) return true;
  const hb = "human_biospecimen";
  if (weightOf(opp.paradigm.allowed, hb) > 0 || weightOf(opp.paradigm.required, hb) > 0 || weightOf(opp.paradigm.required_any, hb) > 0) return true;
  const assay = "biospecimen_assay";
  return [...opp.design.allowed, ...opp.design.required_any, ...opp.design.required_any_2].includes(assay);
}

/** Collaborator ids whose dominant paradigm family is one of `families`, profile order. */
export function collaboratorsIn(inv: Pick<InvestigatorFitProfile, "collaborators">, families: readonly ParadigmFamily[]): string[] {
  return uniq(inv.collaborators.filter((c) => families.includes(c.dominant_family)).map((c) => c.id));
}

/** The investigator a bridge is written for: the dominant paradigm's family is one of the bridge's `investigator_families`. */
function bridgeCoversInvestigator(id: ExploratoryExceptionId, P: ParadigmResult): boolean {
  return P.dominant !== null && exceptionInvestigatorFamilies(id).includes(familyOf(P.dominant.category));
}

/** The families a bridge is written for must cover every family the notice requires (cross-cutting requirements do not gate and are not counted). */
function bridgeCoversNotice(id: ExploratoryExceptionId, families: readonly ParadigmFamily[]): boolean {
  const gating = families.filter((f) => f !== "cross_cutting");
  const written = exceptionNoticeFamilies(id);
  return gating.length > 0 && gating.every((f) => written.includes(f));
}

function exceptionFires(id: ExploratoryExceptionId, x: StageResults, families: readonly ParadigmFamily[], collaborators: string[]): boolean {
  if (!bridgeCoversInvestigator(id, x.P) || !bridgeCoversNotice(id, families)) return false;
  if (id === "translational_bridge") {
    const rule = exploratoryException("translational_bridge");
    if (weightOf(x.P.weights, "translational") < rule.investigator_translational_min) return false;
    return rule.requires_collaborator_in_required_family ? collaborators.length > 0 : true;
  }
  const rule = exploratoryException("biospecimen_bridge");
  if (weightOf(x.P.weights, "human_biospecimen") < rule.investigator_human_biospecimen_min) return false;
  return rule.notice_allows_human_tissue ? noticeAllowsHumanTissue(x.opp) : true;
}

/** Check every floor of `tier`. `waiveP`: the paradigm gate was relaxed, so the P floor counts as met. */
export function checkFloors(tier: FloorTier, x: StageResults, waiveP = false): FloorCheck[] {
  const f = floors(tier);
  const out: FloorCheck[] = [];
  const push = (key: string, ok: boolean, value: number | null, floor: number | string) => out.push({ key, ok, value, floor });

  push("E", f.E === "pass_no_unknowns" ? x.E.E === 1 && x.E.unknown.length === 0 : x.E.E === 1, x.E.E, f.E);
  const aspirationOk = f.P_with_aspiration !== undefined && x.P.P_with_aspiration !== null && x.P.P_with_aspiration >= f.P_with_aspiration;
  push("P", waiveP || x.P.P >= f.P || aspirationOk, x.P.P, f.P);
  push("U", x.U.U >= f.U, x.U.U, f.U);
  if (f.D !== undefined) push("D", x.D.D >= f.D, x.D.D, f.D);
  if (f.D_required_group_min !== undefined) {
    const minGroup = x.D.groups.length ? Math.min(...x.D.groups.map((g) => g.support)) : null;
    push("D_required_group_min", minGroup === null || minGroup >= f.D_required_group_min, minGroup, f.D_required_group_min);
  }
  push("T", x.T.T >= f.T, x.T.T, f.T);
  if (f.T_specific_depth !== undefined) push("T_specific_depth", x.T.coded.max_depth >= f.T_specific_depth, x.T.coded.max_depth, f.T_specific_depth);
  if (f.M !== undefined) push("M", x.M.M >= f.M, x.M.M, f.M);
  if (f.K !== undefined) push("K", x.K.K >= f.K, x.K.K, f.K);
  if (f.A !== undefined) push("A", x.A.runway_sufficient && !x.A.inputs.in_pipeline && !x.A.inputs.recently_dismissed, x.A.A, f.A);
  if (f.confidence_min !== undefined) {
    const ok = confidenceAtLeast(profileConfidence(x.inv), f.confidence_min) && confidenceAtLeast(x.opp.confidence, f.confidence_min) && x.ctx.investigator_pending_items === 0 && x.ctx.notice_complete;
    push("confidence", ok, null, f.confidence_min);
  }
  // f.stage8: no verdict exists before Phase 3 — counts as met.
  return out;
}

const NUMERIC_FLOOR_KEYS: ReadonlySet<string> = new Set<NumericFloorKey>(["P", "U", "D", "T", "M", "K", "D_required_group_min", "T_specific_depth", "P_with_aspiration"]);

/** The Strong floor a check belongs to for gap counting: T's depth condition is part of the T floor. */
const gapName = (key: string) => (key === "T_specific_depth" ? "T" : key);

export function assignTier(x: StageResults): TierResult {
  const flags: string[] = [];
  const caps: Cap[] = [];
  const pg = paradigmGates();
  // D24(11)'s reading: the families of every requirement term, the allowed-set fallback included — a notice allowing clinical and population together is outside the translational bridge's `notice_families`.
  const required_families = PARADIGM_FAMILY_IDS.filter((f) => x.P.terms.some((t) => t.notice.some((c) => familyOf(c) === f)));
  const collaborators = collaboratorsIn(x.inv, required_families);

  if (x.E.unknown.length) caps.push({ id: "eligibility_unknown", max_tier: confidenceCap("eligibility_unknown"), reason: x.E.unknown.join("; ") });

  let waiveP = false;
  let exception: ExploratoryExceptionId | null = null;
  let aspiration_relaxed = false;
  if (x.P.P < pg.poor_below) {
    for (const id of EXPLORATORY_EXCEPTION_IDS) {
      if (exceptionFires(id, x, required_families, collaborators)) {
        exception = id;
        break;
      }
    }
    const explore = floors("exploratory");
    if (exception) {
      caps.push({ id: `paradigm_gate_relaxed_${exception}`, max_tier: RELAXED_TIER, reason: `P ${x.P.P.toFixed(2)} < ${pg.poor_below}, relaxed by ${exception}` });
      waiveP = true;
      flags.push(exception === "translational_bridge" ? `paradigm gate relaxed: translational work with a collaborator in the required field (${collaborators.join(", ")})` : "paradigm gate relaxed: human-biospecimen work and the notice allows human tissue");
    } else if (explore.P_with_aspiration !== undefined && x.P.P_with_aspiration !== null && x.P.P_with_aspiration >= explore.P_with_aspiration) {
      caps.push({ id: "paradigm_gate_relaxed_aspiration", max_tier: RELAXED_TIER, reason: `P ${x.P.P.toFixed(2)} < ${pg.poor_below}; aspiration names ${x.P.aspiration_match.join(", ")}` });
      waiveP = true;
      aspiration_relaxed = true;
      flags.push(`aspiration names the required paradigm (${x.P.aspiration_match.join(", ")}); Exploratory at most`);
    } else caps.push({ id: "paradigm_gate", max_tier: "poor", reason: `P ${x.P.P.toFixed(2)} < ${pg.poor_below}` });
  } else if (x.P.P < pg.exploratory_below) caps.push({ id: "paradigm_gate", max_tier: "exploratory", reason: `P ${x.P.P.toFixed(2)} < ${pg.exploratory_below}` });

  const ug = unitGates();
  if (x.U.U < ug.poor_below) caps.push({ id: "unit_gate", max_tier: "poor", reason: `U ${x.U.U.toFixed(2)} < ${ug.poor_below}` });
  const dg = designGates();
  if (x.D.unmet_required.length) caps.push({ id: "design_required_unsupported", max_tier: dg.required_unsupported_cap_tier, reason: `required design unsupported: ${x.D.unmet_required.map((g) => g.join(" | ")).join("; ")}` });

  const profile_confidence = profileConfidence(x.inv);
  if (profile_confidence === "low" || x.ctx.investigator_pending_items > 0) {
    caps.push({ id: "low_profile_confidence", max_tier: confidenceCap("low_profile_confidence"), reason: x.ctx.investigator_pending_items > 0 ? `investigator profile partial (${x.ctx.investigator_pending_items} items pending)` : "investigator profile confidence low" });
  }
  const noticeReasons = [x.opp.confidence === "low" ? "notice profile confidence low" : null, x.ctx.notice_complete ? null : "notice profile incomplete", x.P.requirement === "none" ? NO_PARADIGM_REQUIREMENT : null].filter((r): r is string => r !== null);
  if (noticeReasons.length) caps.push({ id: "low_notice_confidence", max_tier: confidenceCap("low_notice_confidence"), reason: noticeReasons.join("; ") });
  if (x.K.far) {
    const ladder = trackParams();
    const heldRow = ladder.readiness_ladder[ladder.far_above.held_below_rung]?.[0] ?? "?";
    caps.push({ id: "readiness_far", max_tier: confidenceCap("readiness_far"), reason: `mechanism ${x.K.activity_code ?? "?"} is far above readiness: nothing held at or above the ${heldRow} row` });
    flags.push("mechanism far above readiness; consider as project lead, not PI");
  }
  if (x.A.runway_short) {
    caps.push({ id: "runway_short", max_tier: confidenceCap("runway_short"), reason: `${x.A.inputs.runway_weeks} weeks to the deadline` });
    flags.push("deadline runway short; show the next cycle if the notice has one");
  }

  const strong = checkFloors("strong", x);
  const moderate = checkFloors("moderate", x);
  const exploratory = checkFloors("exploratory", x, waiveP);
  const strongMissed = strong.filter((c) => !c.ok);
  const moderateMissed = moderate.filter((c) => !c.ok);
  const exploratoryMissed = exploratory.filter((c) => !c.ok);
  const mod = floors("moderate");
  const gapNotIn = new Set<string>((mod.gap_not_in ?? []).map((k) => (k === "D_required" ? "D_required_group_min" : k)));
  const strong_gaps = uniq(strongMissed.map((c) => gapName(c.key))).filter((g) => !gapNotIn.has(g));

  let tier_by_floors: Tier;
  let missed_next: FloorCheck[];
  if (!strongMissed.length) {
    tier_by_floors = "strong";
    missed_next = [];
  } else if (!moderateMissed.length && strong_gaps.length <= (mod.gaps_allowed ?? 0)) {
    tier_by_floors = "moderate";
    missed_next = strongMissed;
  } else if (!exploratoryMissed.length) {
    tier_by_floors = "exploratory";
    missed_next = moderateMissed.length ? moderateMissed : strongMissed;
  } else {
    tier_by_floors = "poor";
    missed_next = exploratoryMissed;
  }
  const unmet: UnmetFloor[] = missed_next
    .filter((c): c is FloorCheck & { value: number; floor: number } => NUMERIC_FLOOR_KEYS.has(c.key) && typeof c.floor === "number" && typeof c.value === "number")
    .map((c) => ({ key: c.key as NumericFloorKey, value: c.value, floor: c.floor }));

  let tier = tier_by_floors;
  for (const c of caps) tier = worseTier(tier, c.max_tier);

  if (x.E.failed.length) flags.push(`excluded: ${x.E.failed.join("; ")}`);
  for (const u of x.E.unknown) flags.push(u);
  if (x.P.excluded_hit) flags.push(`the notice excludes ${x.P.excluded_hit}, the dominant paradigm`);
  if (x.P.requirement === "none") flags.push(NO_PARADIGM_REQUIREMENT);
  if (x.U.requirement === "none") flags.push("notice names no unit of analysis");
  if (x.D.penalized && x.D.dominant_prohibited) flags.push(`notice prohibits ${x.D.dominant_prohibited}, which dominates the design evidence (${Math.round(x.D.prohibited_share * 100)}%)`);
  if (x.K.sub_investigator_only) flags.push("trial experience only as a sub-investigator; trial-leadership credit halved");
  if (x.A.inputs.in_pipeline) flags.push("already in the Outreach pipeline");
  if (x.A.inputs.recently_dismissed) flags.push("dismissed by this investigator within the suppression window");
  if (x.A.inputs.runway_weeks === null) flags.push("deadline not on file");
  if (x.A.load) flags.push(`heavy load: ${x.inv.characteristics.active_awards} active awards`);
  if (x.opp.needs_review) flags.push("notice profile flagged needs_review");
  if (x.inv.taxonomy_version !== x.opp.taxonomy_version) flags.push(`taxonomy versions differ: investigator ${x.inv.taxonomy_version}, notice ${x.opp.taxonomy_version}`);

  return { tier, tier_by_floors, caps, unmet, missed_next, strong_gaps, exception, aspiration_relaxed, required_families, collaborators, profile_confidence, flags };
}
