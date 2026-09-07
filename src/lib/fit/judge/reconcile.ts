/**
 * Stage 8c · the informed reconciliation (plan § PR 3.1; spec §16 "Informed
 * reconciliation", "Reconciliation rules"; docs/fit-engine/prompts/
 * reconciler.md — the prompt here is pinned to that file byte for byte by
 * reconcile.test.ts). Two things live here:
 *
 *   runReconciler   the model call that sees everything — components,
 *                   provisional tier, both blind variants, the skeptic, the
 *                   two profile excerpts, the evidence — and returns an
 *                   explanation of any disagreement, zero or more grounded
 *                   corrections (validated by corrections.ts: ids must exist,
 *                   quotes must verify, paths must be known — invalid ones
 *                   dropped and logged), an inexpressible insight, and the
 *                   rationale / "Why not?" text. It never emits a score or a
 *                   tier.
 *
 *   reconcile       the §16 reconciliation table as a pure function over the
 *                   engine's result (before and after the validated
 *                   corrections were applied and the pair re-scored), the
 *                   blind result and the skeptic result — the tier after
 *                   adjudication, the caps added, the confidence shown, the
 *                   review item, the structured-miss flag. Rows, in the order
 *                   they are tried (reconcile.test.ts has one test per row):
 *
 *     R5 / R7c  a re-score after corrections raised the tier → it follows the
 *               floors, never more than one tier per cycle without strategist
 *               confirmation (`stage8_pending_confirmation`); a gated Poor
 *               rises only on a gate-input correction (R7c), else the gate
 *               stands (R7).
 *     R8        the blind variants disagree by ≥ 2 tiers → the blind verdict
 *               is absent; structured only.
 *     Strong    requires agreement (post-rule 5): R1 blind Strong and no
 *               gate-level objection → Strong, high; R2 blind Moderate → Strong
 *               at medium, or Moderate when an emphasis objection is grounded;
 *               R3 blind Exploratory / Poor with a grounded gate-level
 *               objection → the blind verdict, structured-miss logged; R4 blind
 *               Exploratory / Poor without one → Strong stands, low, review.
 *               A grounded gate-level objection with a higher blind verdict
 *               lowers to the objection's implied tier (post-rule 5).
 *     Moderate / Exploratory  blind Strong with a stated correction → R5
 *               (re-scored, above); with none → R6, the tier stands with the
 *               model's rationale and an AI-flagged lead (the table's
 *               "Exploratory" is read as "never below Exploratory": a Moderate
 *               is confirmed, not demoted, by a higher verdict); agreement →
 *               confirmed; a lower verdict → the tier stands at low confidence
 *               with a review item (the skeptic did not run, so the dissent
 *               cannot be grounded).
 *     Poor      gated (P or U under the Poor gate) → R7, the gate stands
 *               unless a gate input was corrected and the re-score lifted it;
 *               by floors → an inexpressible insight or the scout's latent fit
 *               lifts it to Exploratory with that as the rationale (post-rule
 *               6; the scout rule), else it stands.
 *
 * `applyAdjudication` re-derives the final result from a stored row for the
 * nightly sweep: provisional corrections re-applied, the pair re-scored,
 * the table re-run on the stored blind / skeptic / reconciler outputs.
 */
import { scorePair } from "@/lib/fit/engine";
import { tierRank, worseTier } from "@/lib/fit/engine/util";
import { applyCorrectionToProfile, isGateInput, parseCorrectionPath, validateCorrections, type CorrectionContext } from "@/lib/fit/judge/corrections";
import { renderEvidence } from "@/lib/fit/judge/inputs";
import { callJson, JUDGE_MAX_TOKENS, type JudgeModelFn } from "@/lib/fit/judge/model";
import type { Adjudication, Agreement, AppliedCorrection, BlindResult, JudgeInputs, ProfileVersions, Reconciliation, ReconciliationRow, ReconcilerOutput, ReviewItem, ShownConfidence, SkepticResult, StoredAdjudication } from "@/lib/fit/judge/types";
import { JUDGE_VERSION } from "@/lib/fit/judge/types";
import { enumOf, isRecord, str } from "@/lib/fit/judge/validate";
import { confidenceCap, paradigmGates, TIER_IDS, unitGates } from "@/lib/fit/taxonomy";
import type { CapId, FitResult, InvestigatorFitProfile, OpportunityFitProfile, ScoreContext, Stage8CapId, Tier } from "@/lib/fit/types";

// ---------------------------------------------------------------------------
// Prompt (reconciler.md › System prompt, User template)
// ---------------------------------------------------------------------------

export const RECONCILER_SYSTEM_PROMPT = `You reconcile two assessments of the same investigator–notice pair: a structured, rule-based score and an independent expert reading. Your job is not to pick a winner. It is to explain the disagreement, and — where you believe the structured inputs are WRONG — to propose specific, checkable corrections to those inputs.

A correction names one field of the investigator profile or the notice profile, the current value, the proposed value, and the evidence (ids, or a verbatim notice quote) that supports it. Examples of valid corrections:
- investigator.design.rct: 0.10 → 0.70, evidence: NCT0…, NCT0… list this person as PRINCIPAL_INVESTIGATOR (the ingest recorded no role).
- notice.paradigm.required += human_biospecimen, quote: "…mechanistic studies in human tissue…" (Section I, para 3).
- investigator.characteristics.trial_pi_count: 0 → 2, evidence: NCT0…, NCT0….

Corrections that are NOT valid: "the topics are very similar so the paradigm gate should not apply"; "this investigator seems capable"; anything without an id or quote. A topical argument never reopens a paradigm gate.

If the expert reading found fit that no correction can express (a latent relationship the schema cannot represent), say so in \`inexpressible_insight\` — it will be shown to a strategist, not applied.

Write the rationale for a research-development strategist: three sentences at most, citing evidence ids, naming the single most important gap when the pair is not Strong. Output JSON only.`;

export const RECONCILER_RETURN = `Return:
{
 "agreement": "agree" | "structured_higher" | "blind_higher" | "blind_unavailable",
 "disagreement_explanation": string | null,
 "corrections": [
   { "target": "investigator" | "notice", "path": string, "from": any, "to": any,
     "evidence_ids": [string], "quote": string | null, "section": string | null,
     "kind": "ingest_miss" | "misread_requirement" | "profile_weight" | "characteristic",
     "confidence": "high" | "medium" }
 ],
 "inexpressible_insight": string | null,
 "rationale": string,
 "why_not": string | null          // for poor/exploratory: the one-sentence explanation shown under "Why not?"
}`;

/** The field paths a correction may name, printed under each profile excerpt so the model addresses fields that exist. */
export const INVESTIGATOR_PATH_LEGEND = "Correction paths: paradigm.recent.<category>, paradigm.career.<category>, unit.<L1–L5>, design.<design>, materials.<kind>, objective.<objective>, characteristics.{trial_pi_count, active_awards, esi, mechanisms_held, career_stage, clinical_role, degrees}. Weights are in [0, 1].";
export const NOTICE_PATH_LEGEND = "Correction paths: paradigm.{required, required_any, allowed, excluded}.<category>, unit.{required, required_any, allowed} (lists of L1–L5), design.{required_any, required_any_2, allowed, prohibited} (lists), materials.{expected, required, required_any} (lists), materials.human_required, eligibility.{esi_only, new_investigator_only, clinician_required, independent_appointment_required, degree_required, citizenship_rule, investigator_rules}, mechanism.clinical_trial. Every notice correction needs a verbatim quote and its section.";

const r2 = (n: number) => Math.round(n * 100) / 100;
const roundWeights = (w: Record<string, number | undefined>) => Object.fromEntries(Object.entries(w).filter(([, v]) => typeof v === "number").map(([k, v]) => [k, r2(v!)]));

/** The structured block: components, caps, the provisional tier and the provenance that explains them; item ids mapped to the short ids the evidence uses. */
export function structuredExcerpt(engine: FitResult, refToId: ReadonlyMap<string, string>): Record<string, unknown> {
  const map = (ids: readonly string[]) => ids.map((i) => refToId.get(i) ?? i);
  return {
    components: Object.fromEntries(Object.entries(engine.components).map(([k, v]) => [k, r2(v)])),
    caps: engine.caps,
    provisional_tier: engine.tier,
    provenance: {
      E: engine.provenance.E,
      P: { view: engine.provenance.P.view, best_pair: engine.provenance.P.best_pair, excluded_hit: engine.provenance.P.excluded_hit },
      U: engine.provenance.U,
      D: engine.provenance.D,
      T: { top_items: map(engine.provenance.T.top_items), coded_matches: engine.provenance.T.coded_matches },
      M: engine.provenance.M,
      K: engine.provenance.K,
      floors: engine.provenance.floors,
    },
    flags: engine.flags,
  };
}

export function investigatorExcerpt(inv: InvestigatorFitProfile, refToId: ReadonlyMap<string, string>): Record<string, unknown> {
  return {
    paradigm: { recent: roundWeights(inv.paradigm.recent), career: roundWeights(inv.paradigm.career) },
    unit: roundWeights(inv.unit),
    design: roundWeights(inv.design),
    materials: roundWeights(inv.materials),
    objective: roundWeights(inv.objective),
    characteristics: inv.characteristics,
    confidence: inv.confidence,
    evidence_by_category: inv.provenance.map((p) => ({ axis: p.axis, category: p.category, top_items: p.top_items.map((i) => refToId.get(i) ?? i) })),
  };
}

export function noticeExcerpt(opp: OpportunityFitProfile): Record<string, unknown> {
  return {
    number: opp.number,
    mechanism: opp.mechanism,
    paradigm: { required: roundWeights(opp.paradigm.required), required_any: roundWeights(opp.paradigm.required_any), allowed: roundWeights(opp.paradigm.allowed), excluded: roundWeights(opp.paradigm.excluded) },
    unit: opp.unit,
    design: opp.design,
    materials: opp.materials,
    objective: roundWeights(opp.objective),
    eligibility: opp.eligibility,
    team: opp.team,
    confidence: opp.confidence,
    non_responsive: opp.non_responsive,
    quotes: opp.provenance,
  };
}

export type ReconcilerPromptInput = {
  inputs: JudgeInputs;
  engine: FitResult;
  blind: BlindResult | null;
  skeptic: SkepticResult | null;
  investigator: InvestigatorFitProfile;
  notice: OpportunityFitProfile;
};

const blindExcerpt = (b: BlindResult) => Object.fromEntries(b.variants.map((v) => [`variant${v.variant}`, v.usable ? { structural: v.a, assessment: v.b, verdict: v.verdict, lowered: v.lowered } : "unusable"]));

const skepticExcerpt = (s: SkepticResult) => ({ objection: s.objection, objection_kind: s.objection_kind, gate_level: s.gate_level, grounded: s.grounded, evidence_ids: s.evidence_ids, confidence: s.confidence, what_would_resolve_it: s.what_would_resolve_it });

export function buildReconcilerPrompt(x: ReconcilerPromptInput): string {
  const refToId = new Map(x.inputs.evidence.map((e) => [e.ref, e.id]));
  return [
    `STRUCTURED: ${JSON.stringify(structuredExcerpt(x.engine, refToId))}`,
    `BLIND PASS: ${x.blind && x.blind.variants.some((v) => v.usable) ? JSON.stringify(blindExcerpt(x.blind)) : "not available"}`,
    `SKEPTIC: ${x.skeptic && x.skeptic.usable ? JSON.stringify(skepticExcerpt(x.skeptic)) : "not run"}`,
    `INVESTIGATOR PROFILE (structured, with evidence ids): ${JSON.stringify(investigatorExcerpt(x.investigator, refToId))}`,
    INVESTIGATOR_PATH_LEGEND,
    `NOTICE PROFILE (structured, with quotes): ${JSON.stringify(noticeExcerpt(x.notice))}`,
    NOTICE_PATH_LEGEND,
    "EVIDENCE:",
    renderEvidence(x.inputs.evidence),
    "",
    RECONCILER_RETURN,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Validation (reconciler.md › Return; post-rule 1)
// ---------------------------------------------------------------------------

const AGREEMENTS: readonly Agreement[] = ["agree", "structured_higher", "blind_higher", "blind_unavailable"];

/** Ids from `known` that appear in a text. */
export function citedIds(text: string, ids: readonly string[]): string[] {
  const lower = text.toLowerCase();
  return ids.filter((id) => lower.includes(id.toLowerCase()));
}

/** Pure. The reconciler's reply validated; the rationale is kept only when it cites an id that exists (every claim cites an evidence id — spec §16 "Explanation"). */
export function validateReconciler(raw: unknown, ctx: CorrectionContext): Omit<ReconcilerOutput, "calls"> {
  const dropped: string[] = [];
  const empty: Omit<ReconcilerOutput, "calls"> = { agreement: null, disagreement_explanation: null, corrections: [], inexpressible_insight: null, rationale: null, why_not: null, usable: false, dropped };
  if (!isRecord(raw)) {
    dropped.push("reconciler: not a JSON object");
    return empty;
  }
  const agreement = enumOf(raw.agreement, AGREEMENTS);
  if (!agreement) dropped.push(`agreement missing or unknown (${String(raw.agreement)})`);
  const corrections = validateCorrections(raw.corrections, ctx);
  dropped.push(...corrections.dropped);
  let rationale = str(raw.rationale, 1_000);
  if (rationale && citedIds(rationale, ctx.evidenceIds).length === 0) {
    dropped.push("rationale cites no evidence id that exists; the engine's rationale is kept instead");
    rationale = null;
  }
  const usable = agreement !== null || rationale !== null;
  if (!usable) dropped.push("reconciler: neither an agreement nor a usable rationale; reply unusable");
  return {
    agreement,
    disagreement_explanation: str(raw.disagreement_explanation, 800),
    corrections: corrections.corrections,
    inexpressible_insight: str(raw.inexpressible_insight, 800),
    rationale,
    why_not: str(raw.why_not, 400),
    usable,
    dropped,
  };
}

export type ReconcilerDeps = { model: JudgeModelFn; modelName: string; takeCall?: () => boolean; deadline?: number | null; log?: (line: string) => void };

/** Pure given the model function. One call; null when the budget or deadline forbids it. */
export async function runReconciler(x: ReconcilerPromptInput, ctx: CorrectionContext, deps: ReconcilerDeps): Promise<ReconcilerOutput | null> {
  if (deps.deadline != null && Date.now() >= deps.deadline) return null;
  if (deps.takeCall && !deps.takeCall()) return null;
  const reply = await callJson(deps.model, { purpose: "reconciler", system: RECONCILER_SYSTEM_PROMPT, user: buildReconcilerPrompt(x), model: deps.modelName, maxTokens: JUDGE_MAX_TOKENS.reconciler });
  const v = reply.usable ? validateReconciler(reply.raw, ctx) : validateReconciler(null, ctx);
  const out: ReconcilerOutput = { ...v, dropped: [...reply.problems, ...v.dropped], usable: reply.usable && v.usable, calls: 1 };
  deps.log?.(`reconciler: ${out.usable ? `${out.agreement ?? "?"}; ${out.corrections.length} correction(s) kept${out.inexpressible_insight ? "; insight" : ""}` : "unusable"}${out.dropped.length ? `; dropped ${out.dropped.length}` : ""}`);
  return out;
}

// ---------------------------------------------------------------------------
// The reconciliation table (spec §16; reconciler.md post-rules 5–6)
// ---------------------------------------------------------------------------

export type ReconcileInformed = {
  /** The engine's result after the validated corrections were applied and the pair re-scored (the engine's own when none). */
  rescored?: FitResult;
  corrections?: AppliedCorrection[];
  reconciler?: ReconcilerOutput | null;
};

/** A Poor by a Poor-level gate: P under `paradigm.gates.poor_below` or U under `unit.gates.poor_below` (design caps at Exploratory, never Poor). */
export function gatedPoor(engine: Pick<FitResult, "tier" | "components">): boolean {
  return engine.tier === "poor" && (engine.components.P < paradigmGates().poor_below || engine.components.U < unitGates().poor_below);
}

/** The tier a grounded gate-level objection implies (post-rule 5): paradigm / unit-materials → Poor (§9 "cap at Poor"), design → the design cap's tier (Exploratory), eligibility → the eligibility-unknown cap (Moderate: the model extracts rules, it never decides eligibility — §16 division of labor), scale_role → Moderate, topic → one step at most. */
export function impliedTier(kind: SkepticResult["objection_kind"], current: Tier): Tier {
  switch (kind) {
    case "paradigm":
    case "unit_materials":
      return "poor";
    case "design":
      return "exploratory";
    case "eligibility":
      return confidenceCap("eligibility_unknown");
    case "scale_role":
      return "moderate";
    case "topic":
      return TIER_IDS[Math.min(TIER_IDS.length - 1, tierRank(current) + 1)]!;
    default:
      return current;
  }
}

/** One tier better; strong stays strong. */
const raiseTier = (t: Tier, steps = 1): Tier => TIER_IDS[Math.max(0, tierRank(t) - steps)]!;

const better = (a: Tier, b: Tier) => tierRank(a) < tierRank(b);

/** Pure. See the module note. */
export function reconcile(engine: FitResult, blind: BlindResult | null, skeptic: SkepticResult | null, informed: ReconcileInformed = {}): Reconciliation {
  const rescored = informed.rescored ?? engine;
  const corrections = informed.corrections ?? [];
  const reconciler = informed.reconciler ?? null;
  const reasons: string[] = [];
  const caps_added: Stage8CapId[] = [];
  let review: ReviewItem | null = null;
  let structured_miss = false;
  let row: ReconciliationRow = "structured_only";
  let confidence: ShownConfidence = "structured_only";
  let rationale: string | null = reconciler?.rationale ?? rescored.rationale;
  let tier: Tier = rescored.tier;

  const S0 = engine.tier;
  const r8 = blind !== null && !blind.self_consistent;
  const B: Tier | null = blind && !r8 ? blind.verdict : null;
  const usableVariants = blind?.variants.filter((v) => v.usable) ?? [];
  const bothAtLeastModerate = B !== null && usableVariants.length > 0 && usableVariants.every((v) => v.verdict !== null && tierRank(v.verdict) <= tierRank("moderate"));
  const objection = skeptic?.usable && skeptic.objection ? skeptic : null;
  const gateObjection = objection !== null && objection.gate_level && objection.grounded;
  const groundedEmphasis = objection !== null && !objection.gate_level && objection.grounded;
  const insight = reconciler?.inexpressible_insight ?? null;
  const latent = blind?.latent_fit?.found ? blind.latent_fit : null;
  const gated = gatedPoor(engine);
  const gateCorrected = corrections.some((c) => {
    const p = parseCorrectionPath(c.correction.target, c.correction.path);
    return p !== null && isGateInput(p);
  });
  const provisional = corrections.some((c) => c.correction.route === "provisional");

  // R5 / R7: a re-score after corrections raised the tier.
  let raised = false;
  if (better(rescored.tier, S0)) {
    if (gated && !gateCorrected) {
      tier = S0;
      row = "R7_gate_stands";
      reasons.push(`re-score after corrections gives ${rescored.tier}, but the paradigm / unit gate stands: no gate input was corrected`);
    } else {
      raised = true;
      const oneStep = raiseTier(S0);
      if (better(rescored.tier, oneStep)) {
        tier = oneStep;
        caps_added.push("stage8_pending_confirmation");
        reasons.push(`corrections re-score the pair at ${rescored.tier}; held to ${oneStep} — never more than one tier per cycle without strategist confirmation`);
      } else {
        tier = rescored.tier;
        reasons.push(`corrections re-score the pair from ${S0} to ${rescored.tier}`);
      }
      row = gated ? "R7_gate_corrected" : "R5_raise_by_correction";
      confidence = "medium";
      if (provisional) review = { kind: "pending_confirmation", note: `${corrections.filter((c) => c.correction.route === "provisional").map((c) => `${c.correction.target}.${c.correction.path}`).join(", ")} applied for this pair until a strategist confirms` };
    }
  }

  if (tier === "strong") {
    if (r8 || B === null) {
      row = raised ? row : r8 ? "R8_blind_void" : "structured_only";
      confidence = raised ? "medium" : "structured_only";
      reasons.push(r8 ? "blind variants disagree by two or more tiers; blind verdict treated as absent" : "no usable blind verdict");
      if (raised) {
        tier = "moderate";
        caps_added.push("stage8_verdict");
        reasons.push("re-scored Strong needs a blind verdict of Moderate or better on both variants; held at Moderate");
      }
      if (gateObjection) {
        tier = worseTier(tier, impliedTier(objection!.objection_kind, tier));
        caps_added.push("stage8_objection");
        row = "objection_lowers";
        reasons.push(`grounded ${objection!.objection_kind} objection lowers to ${tier}: ${objection!.objection}`);
        structured_miss = true;
        review = { kind: "structured_miss", note: objection!.objection! };
      }
    } else if (gateObjection && tierRank(B) > tierRank("moderate")) {
      // R3
      tier = B;
      caps_added.push("stage8_verdict");
      row = "R3_strong_gate_objection";
      structured_miss = true;
      confidence = "review";
      review = { kind: "structured_miss", note: `${objection!.objection_kind}: ${objection!.objection}` };
      reasons.push(`blind verdict ${B} and a grounded gate-level objection (${objection!.objection_kind}); lowered to the blind verdict; structured miss logged for taxonomy or ingest repair`);
    } else if (gateObjection) {
      tier = worseTier(tier, impliedTier(objection!.objection_kind, tier));
      caps_added.push("stage8_objection");
      row = "objection_lowers";
      confidence = "medium";
      structured_miss = true;
      review = { kind: "structured_miss", note: `${objection!.objection_kind}: ${objection!.objection}` };
      reasons.push(`blind verdict ${B}, but a grounded gate-level ${objection!.objection_kind} objection lowers to ${tier}: ${objection!.objection}`);
    } else if (raised) {
      // R5 / R7c decided the row; Strong still needs the blind pass at Moderate or better on both variants (post-rule 5).
      if (!bothAtLeastModerate) {
        tier = "moderate";
        caps_added.push("stage8_verdict");
        reasons.push(`re-scored Strong needs a blind verdict of Moderate or better on both variants (blind ${B}); held at Moderate`);
      }
    } else if (B === "strong" && bothAtLeastModerate) {
      row = "R1_strong_agree";
      confidence = "high";
      reasons.push(`structured Strong, blind Strong, no gate-level objection${objection && !objection.grounded ? ` (an ungrounded ${objection.objection_kind} objection was recorded)` : ""}`);
    } else if (B === "moderate" || (B === "strong" && !bothAtLeastModerate)) {
      row = "R2_strong_blind_moderate";
      if (groundedEmphasis) {
        tier = "moderate";
        caps_added.push("stage8_objection");
        reasons.push(`blind verdict ${B}; the ${objection!.objection_kind} objection is grounded in a cited item: ${objection!.objection}; Moderate`);
      } else reasons.push(`blind verdict ${B}; ${objection ? `an ungrounded ${objection.objection_kind} objection: ${objection.objection}` : "no objection"}; Strong at medium confidence`);
      confidence = "medium";
    } else {
      // R4: blind exploratory / poor, no grounded gate-level objection
      row = "R4_strong_unsupported_dissent";
      confidence = "low";
      review = { kind: "ungrounded_dissent", note: `blind verdict ${B}; ${objection ? `${objection.objection_kind} objection not grounded in any provided item` : "the skeptic found no grounded objection"}` };
      reasons.push(`AI dissent, unsupported: blind verdict ${B} with ${objection ? "an ungrounded objection" : "no objection"}; Strong stands`);
    }
  } else if (tier === "moderate" || tier === "exploratory") {
    if (raised) {
      // R5 / R7c already decided the row and confidence.
    } else if (r8 || B === null) {
      row = r8 ? "R8_blind_void" : "structured_only";
      confidence = "structured_only";
      reasons.push(r8 ? "blind variants disagree by two or more tiers; blind verdict treated as absent" : "no usable blind verdict");
    } else if (gateObjection && tierRank(B) <= tierRank(tier)) {
      const implied = impliedTier(objection!.objection_kind, tier);
      if (better(tier, implied)) {
        tier = implied;
        caps_added.push("stage8_objection");
        row = "objection_lowers";
        confidence = "medium";
        structured_miss = true;
        review = { kind: "structured_miss", note: `${objection!.objection_kind}: ${objection!.objection}` };
        reasons.push(`grounded gate-level ${objection!.objection_kind} objection lowers to ${tier}: ${objection!.objection}`);
      } else {
        row = "confirmed";
        confidence = "medium";
        reasons.push(`blind verdict ${B}; the grounded ${objection!.objection_kind} objection implies ${implied}, no lower than ${tier}`);
      }
    } else if (B === "strong") {
      if (corrections.length) {
        row = "R5_raise_by_correction";
        confidence = "medium";
        reasons.push(`blind Strong with ${corrections.length} stated correction(s); re-score keeps ${tier} — the floors decide`);
        if (provisional) review = { kind: "pending_confirmation", note: `${corrections.map((c) => `${c.correction.target}.${c.correction.path}`).join(", ")} applied for this pair until a strategist confirms` };
      } else {
        row = "R6_ai_flagged_lead";
        confidence = "review";
        review = { kind: "ai_flagged_lead", note: insight ?? reconciler?.disagreement_explanation ?? "blind Strong with no expressible correction" };
        if (insight) rationale = insight;
        reasons.push(`blind Strong with no expressible correction; ${tier} stands with the model's rationale; AI-flagged lead`);
      }
    } else if (B === tier) {
      row = "confirmed";
      confidence = "high";
      reasons.push(`structured ${tier}, blind ${B}`);
      if (latent) review = { kind: "ai_flagged_lead", note: latent.explanation };
    } else if (better(B, tier)) {
      row = insight || latent ? "R6_ai_flagged_lead" : "confirmed";
      confidence = insight || latent ? "review" : "medium";
      if (insight || latent) {
        review = { kind: "ai_flagged_lead", note: insight ?? latent!.explanation };
        rationale = insight ?? latent!.explanation;
      }
      reasons.push(`blind verdict ${B} above structured ${tier}; a rise needs a correction${corrections.length ? "" : " and none was stated"}`);
    } else {
      row = "dissent_stands";
      confidence = "low";
      review = { kind: "ungrounded_dissent", note: `blind verdict ${B} below structured ${tier}; no skeptic objection grounds it` };
      reasons.push(`blind verdict ${B} below structured ${tier}; the tier stands at low confidence`);
    }
  } else {
    // Poor
    if (raised) {
      // cannot happen: raised means tier > poor
    } else if (row === "R7_gate_stands") {
      confidence = "review";
      review = { kind: "ai_flagged_lead", note: `blind ${B ?? "absent"}; corrections did not touch a gate input — gate stands` };
    } else if (r8 || B === null) {
      row = r8 ? "R8_blind_void" : "structured_only";
      confidence = "structured_only";
      reasons.push(r8 ? "blind variants disagree by two or more tiers; blind verdict treated as absent" : "no usable blind verdict");
      if (!gated && latent) {
        tier = "exploratory";
        row = "R6_ai_flagged_lead";
        confidence = "review";
        rationale = latent.explanation;
        review = { kind: "ai_flagged_lead", note: latent.explanation };
        reasons.push(`the scout found latent fit (${latent.shape}); shown as Exploratory`);
      }
    } else if (better(B, "poor")) {
      if (gated) {
        row = "R7_gate_stands";
        confidence = "review";
        review = { kind: "ai_flagged_lead", note: `blind ${B} against a paradigm / unit gate; ${insight ?? latent?.explanation ?? "no gate input shown wrong"}` };
        reasons.push(`blind verdict ${B}, but the paradigm / unit gate stands: no specific gate input was shown wrong — a topical argument never reopens a gate`);
      } else if (insight || latent) {
        tier = "exploratory";
        row = "R6_ai_flagged_lead";
        confidence = "review";
        rationale = insight ?? latent!.explanation;
        review = { kind: "ai_flagged_lead", note: insight ?? latent!.explanation };
        reasons.push(`blind verdict ${B}; ${insight ? "the reconciler's insight" : `the scout's latent fit (${latent!.shape})`} lifts a floor-Poor to Exploratory`);
      } else if (B === "exploratory") {
        row = "confirmed";
        confidence = "medium";
        reasons.push(`structured Poor by floors, blind Exploratory; no correction or insight; Poor stands`);
      } else {
        row = "R6_ai_flagged_lead";
        confidence = "review";
        review = { kind: "ai_flagged_lead", note: reconciler?.disagreement_explanation ?? `blind ${B} against structured Poor with no expressible correction` };
        reasons.push(`blind verdict ${B} against a floor-Poor with no correction and no insight; Poor stands, AI-flagged lead`);
      }
    } else {
      row = "confirmed";
      confidence = "high";
      reasons.push("structured Poor, blind Poor");
    }
  }

  const caps: CapId[] = Array.from(new Set<CapId>([...rescored.caps, ...caps_added]));
  const why_not = tier === "poor" ? (reconciler?.why_not ?? rescored.why_not) : tier === "exploratory" ? (reconciler?.why_not ?? null) : null;
  return { row, tier_structured: S0, tier_rescored: rescored.tier, tier, caps, caps_added, confidence, reasons, review, structured_miss, rationale, why_not, corrections };
}

// ---------------------------------------------------------------------------
// Applying an adjudication to a result
// ---------------------------------------------------------------------------

/** Pure. The engine's re-scored result with the reconciliation's tier, caps and text. */
export function finalizeResult(rescored: FitResult, rec: Reconciliation): FitResult {
  const gap = rec.tier === "exploratory" ? (rescored.gap ?? (rec.rationale !== rescored.rationale ? rec.rationale : null)) : rec.tier === "strong" ? null : rescored.gap;
  return { ...rescored, tier: rec.tier, caps: [...rec.caps], rationale: rec.rationale, why_not: rec.tier === "poor" ? (rec.why_not ?? rescored.why_not) : null, gap };
}

/** Pure. The compact `fit_results.adjudication`. */
export function toAdjudication(x: { judged_at: string; model: string; profile_versions: ProfileVersions; blind: BlindResult | null; skeptic: SkepticResult | null; reconciliation: Reconciliation; evidence: Array<{ id: string; ref: string }> }): Adjudication {
  return {
    version: JUDGE_VERSION,
    judged_at: x.judged_at,
    model: x.model,
    profile_versions: x.profile_versions,
    blind: x.blind ? { verdict: x.blind.self_consistent ? x.blind.verdict : null, variants: x.blind.variants.map((v) => ({ variant: v.variant, verdict: v.verdict, verdict_raw: v.verdict_raw, usable: v.usable })), self_consistent: x.blind.self_consistent, scout: x.blind.scout, latent_fit: x.blind.latent_fit } : null,
    skeptic: x.skeptic ? { objection: x.skeptic.objection, objection_kind: x.skeptic.objection_kind, gate_level: x.skeptic.gate_level, grounded: x.skeptic.grounded, confidence: x.skeptic.confidence } : null,
    reconciliation: x.reconciliation,
    evidence: x.evidence,
  };
}

/** Pure. The provisional corrections of a stored adjudication applied to the two profiles (auto-applied ones already live in the stored profile). */
export function applyProvisionalCorrections(inv: InvestigatorFitProfile, opp: OpportunityFitProfile, corrections: readonly AppliedCorrection[]): { inv: InvestigatorFitProfile; opp: OpportunityFitProfile; applied: number } {
  let i = inv;
  let o = opp;
  let applied = 0;
  for (const c of corrections) {
    if (c.correction.route !== "provisional" || c.status === "rejected") continue;
    if (c.correction.target === "investigator") i = applyCorrectionToProfile(i, c.correction);
    else o = applyCorrectionToProfile(o, c.correction);
    applied += 1;
  }
  return { inv: i, opp: o, applied };
}

/**
 * Pure. Re-derive the final result from a stored adjudication whose profile
 * versions still match: provisional corrections re-applied, the pair
 * re-scored, the table re-run on the stored passes. The sweep calls this so
 * a judged pair keeps its tier night after night until a profile changes.
 */
export function applyAdjudication(inv: InvestigatorFitProfile, opp: OpportunityFitProfile, ctx: ScoreContext, stored: StoredAdjudication): { result: FitResult; adjudication: Adjudication } {
  const engine = scorePair(inv, opp, ctx);
  const patched = applyProvisionalCorrections(inv, opp, stored.reconciliation.result.corrections);
  const rescored = patched.applied ? scorePair(patched.inv, patched.opp, ctx) : engine;
  const reconciliation = reconcile(engine, stored.blind, stored.skeptic, { rescored, corrections: stored.reconciliation.result.corrections, reconciler: stored.reconciliation.reconciler });
  const result = finalizeResult(rescored, reconciliation);
  const adjudication = toAdjudication({ judged_at: stored.created_at, model: stored.model, profile_versions: stored.profile_versions, blind: stored.blind, skeptic: stored.skeptic, reconciliation, evidence: stored.reconciliation.evidence });
  return { result, adjudication };
}
