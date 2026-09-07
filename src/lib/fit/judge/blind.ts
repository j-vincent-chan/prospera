/**
 * Stage 8a · the blind holistic pass (plan § PR 3.1; spec §16 "Blind, then
 * informed"; docs/fit-engine/prompts/blind-pass.md — the prompts here are
 * pinned to that file byte for byte by blind.test.ts). It never sees the
 * structured score, the components, the provisional tier or the axis labels.
 *
 * Two calls per variant: Call A judges paradigm, unit, design and materials
 * from topic-masked text (mask.ts) in which the issuing institute is hidden
 * too — the notice number and the project numbers lose their IC letters
 * (`RFA-··-27-136`, `5R01··120003`), in the header and in the prose (a
 * companion FOA, a cited award), and every IC acronym the notice carries is
 * masked in the texts (S4); the masked ids are aliases the validator maps back, so Call B and
 * everything after it see the canonical ids (F6). Call B, given Call A's
 * output verbatim, reads the unmasked text, the eligibility and team language
 * and the collaborators, and returns topic, the verdict, the biggest gap and
 * a counter-case. Two variants (a strategist, a program officer — the spec's
 * self-consistency check); the pass's verdict is the lower of the two, and
 * absent when they disagree by two tiers (R8). `callALeaks` is the leak
 * check over the rendered evidence and notice blocks only — the `Return:`
 * schema names fields ("materials", "design") no mask should trip on (F12).
 *
 * Post-rules, in code as the spec writes them: a `strong` or `moderate`
 * verdict whose counter-case is gate-level drops one tier; a `strong`
 * verdict that contradicts the model's own structural fields (a required
 * design it left unmet, a weak or incompatible paradigm, a unit mismatch) is
 * rejected to `exploratory` (guardrail 1); a verdict whose claims cite no id
 * that exists is absent (guardrail 2); the scout's `latent_fit` counts only
 * with ≥ 2 cited ids. Unusable replies (not JSON, cut off, no verdict) are
 * returned with the reason and never cached (the caller writes no row for
 * them).
 */
import { buildMask, IC_MASK, maskIcInId, maskLeaks, type MaskTerm } from "@/lib/fit/judge/mask";
import { renderCollaborators, renderEvidence, renderNotice } from "@/lib/fit/judge/inputs";
import { callJson, JUDGE_MAX_TOKENS, type JudgeModelFn } from "@/lib/fit/judge/model";
import type { BlindCallA, BlindCallB, BlindResult, BlindVariant, BlindVariantResult, JudgeInputs, LatentFit, LatentFitShape, ParadigmFit, TopicFit, UnitFit } from "@/lib/fit/judge/types";
import { bool, enumOf, idList, isRecord, knownIds, str, strList } from "@/lib/fit/judge/validate";
import { tierRank } from "@/lib/fit/engine/util";
import { TIER_IDS } from "@/lib/fit/taxonomy";
import type { Tier } from "@/lib/fit/types";

// ---------------------------------------------------------------------------
// Prompts (blind-pass.md › System prompt, Call A / Call B templates, variant 2, scout)
// ---------------------------------------------------------------------------

export const BLIND_SYSTEM_PROMPT = `You are an experienced research-development strategist at an academic medical center. You are assessing whether one investigator is a realistic applicant for one funding announcement. You reason from the evidence you are given and nothing else; you never assume facts about the person that the evidence does not show, and you never treat shared vocabulary as fit.

Definitions:
- Paradigm: the kind of research (discovery/mechanistic; preclinical/animal; translational human biology; clinical observational or interventional; clinical trials; epidemiology/population; health services/outcomes/implementation; computational/methods).
- Unit of analysis: molecule/cell → animal → human individual/specimen → cohort/population → health system.
- Study design: what is actually done (wet-lab experiments, animal studies, omics, cohorts, trials, EHR/claims analysis, surveys, implementation studies…).

Rules:
1. Judge paradigm, unit and design FIRST, each with the evidence ids that support the judgment. If the notice requires a design the evidence never shows this person leading, say so plainly.
2. A person's role matters: leading a trial as PI is different from being a site sub-investigator; a first/last-author paper is different from a middle-author paper.
3. Topic overlap can make a fit better; it can never make a paradigm or design mismatch acceptable.
4. Cite only ids that appear in the evidence list. Never invent a paper, grant or trial.
5. Output JSON only.`;

/** The variant-1 framing the spec's variant 2 replaces. */
export const VARIANT_1_FRAMING = "You are an experienced research-development strategist at an academic medical center. You are assessing whether one investigator is a realistic applicant for one funding announcement.";
/** blind-pass.md › Prompt variant 2: "Same content, different framing". */
export const VARIANT_2_FRAMING = "You are a program officer at the issuing institute deciding whether to encourage this investigator to apply.";

export const BLIND_SYSTEM_PROMPT_VARIANT_2 = BLIND_SYSTEM_PROMPT.replace(VARIANT_1_FRAMING, VARIANT_2_FRAMING);

export function blindSystemPrompt(variant: BlindVariant): string {
  return variant === 2 ? BLIND_SYSTEM_PROMPT_VARIANT_2 : BLIND_SYSTEM_PROMPT;
}

export const CALL_A_RETURN = `Return:
{
 "investigator_paradigm": { "dominant": [cat...], "secondary": [cat...], "evidence_ids": [...] , "note": string },
 "notice_paradigm": { "required": [cat...], "allowed": [cat...], "excluded": [cat...], "note": string },
 "paradigm_fit": "strong" | "adjacent" | "weak" | "incompatible",
 "unit_fit": "match" | "adjacent" | "mismatch",
 "design": { "notice_requires": [design...], "investigator_has_led": [design...], "investigator_has_contributed": [design...], "unmet_required": [design...], "evidence_ids": [...] },
 "materials": { "notice_expects": [...], "investigator_has": [...], "gap": string | null }
}`;

export const CALL_B_LEAD = "Your structural assessment (do not revise it unless the unmasked text shows it was wrong; if you do revise, explain):";

export const CALL_B_RETURN = `Return:
{
 "structural_revision": null | { "field": string, "from": ..., "to": ..., "why": string },
 "topic_fit": "strong" | "moderate" | "weak", "topic_note": string, "topic_evidence_ids": [...],
 "eligibility_concerns": [string],
 "verdict": "strong" | "moderate" | "exploratory" | "poor",
 "biggest_gap": string,                       // one sentence; the single thing that most limits the fit
 "what_would_make_it_strong": string | null,  // for moderate/exploratory: collaborator, capability, direction
 "collaborator_suggestion": string | null,    // a name/id from COLLABORATORS if one closes the gap
 "counter_case": string,                      // 2 sentences arguing the opposite of your verdict
 "counter_case_is_gate_level": boolean,       // true if the counter-case names a paradigm/design/eligibility problem
 "rationale": string                          // ≤ 3 sentences, quoting evidence ids
}`;

/** blind-pass.md › Scout variant: the additional Call B field. */
export const SCOUT_FIELD = `"latent_fit": { "found": boolean, "shape": "methodological_transfer" | "asset_ownership" | "trajectory" | "mechanistic_adjacency" | "team_shape" | "constraint_in_prose" | null, "explanation": string, "evidence_ids": [...] }`;

/** The Call B return block with the scout field appended after `rationale`. */
export const CALL_B_RETURN_SCOUT = CALL_B_RETURN.replace(' "rationale": string                          // ≤ 3 sentences, quoting evidence ids\n}', ` "rationale": string,                         // ≤ 3 sentences, quoting evidence ids\n ${SCOUT_FIELD}\n}`);

/** The mask for a pair: every topic term and descriptor name on both sides, the issuing institute's acronym and every institute token the notice carries (mask.ts; F6, S4). */
export function pairMask(inputs: Pick<JudgeInputs, "evidence" | "notice">, descriptors: Array<{ name: string; tree_numbers: string[]; ui?: string }> = []): MaskTerm[] {
  const ics = [...(inputs.notice.issuing_ic ? [inputs.notice.issuing_ic] : []), ...inputs.notice.nih_ic_tokens];
  const terms = [...inputs.evidence.flatMap((e) => e.topic_terms), ...inputs.notice.topic_terms, ...inputs.notice.rcdc, ...ics];
  const names = new Set(descriptors.map((d) => d.name.toLowerCase()));
  const nameOnly = [...inputs.evidence.flatMap((e) => e.mesh_names), ...inputs.notice.mesh_names].filter((n) => !names.has(n.toLowerCase()));
  return buildMask({ terms: [...terms, ...nameOnly], descriptors });
}

/** The two masked blocks of Call A — what the leak check reads (F12: never the `Return:` schema). */
export function callAMaskedText(inputs: Pick<JudgeInputs, "evidence" | "notice">, mask: readonly MaskTerm[]): string {
  return [renderEvidence(inputs.evidence, mask), renderNotice(inputs.notice, { mask })].join("\n");
}

/** The mask terms still present in Call A's evidence and notice blocks. */
export function callALeaks(inputs: Pick<JudgeInputs, "evidence" | "notice">, mask: readonly MaskTerm[]): string[] {
  return maskLeaks(callAMaskedText(inputs, mask), mask);
}

export function buildCallAPrompt(inputs: JudgeInputs, mask: readonly MaskTerm[]): string {
  return ["EVIDENCE (topic terms masked):", renderEvidence(inputs.evidence, mask), "", "NOTICE (topic terms masked):", renderNotice(inputs.notice, { mask }), "", CALL_A_RETURN].join("\n");
}

/**
 * Lower-cased id → canonical id for Call A's validator: every evidence id
 * as given, plus the spelling Call A saw — the IC letters replaced by
 * `IC_MASK` (and by two ASCII dots, a model's likely transcription) — so a
 * citation of `5R01··120003` maps back to `5R01DK120003` (F6).
 */
export function evidenceIdIndex(evidenceIds: readonly string[]): Map<string, string> {
  const known = knownIds(evidenceIds);
  for (const id of evidenceIds) {
    const masked = maskIcInId(id);
    if (masked === id) continue;
    for (const alias of [masked, masked.replace(IC_MASK, "..")]) if (!known.has(alias.toLowerCase())) known.set(alias.toLowerCase(), id);
  }
  return known;
}

export function buildCallBPrompt(inputs: JudgeInputs, callAOutput: string, scout: boolean): string {
  return [CALL_B_LEAD, callAOutput, "", "EVIDENCE (unmasked):", renderEvidence(inputs.evidence), "", "NOTICE (unmasked):", renderNotice(inputs.notice, { title: true, eligibility: true, team: true }), "", "COLLABORATORS:", renderCollaborators(inputs.collaborators), "", scout ? CALL_B_RETURN_SCOUT : CALL_B_RETURN].join("\n");
}

// ---------------------------------------------------------------------------
// Validation (blind-pass.md › output schemas; spec §16 guardrails 1–2)
// ---------------------------------------------------------------------------

const PARADIGM_FITS: readonly ParadigmFit[] = ["strong", "adjacent", "weak", "incompatible"];
const UNIT_FITS: readonly UnitFit[] = ["match", "adjacent", "mismatch"];
const TOPIC_FITS: readonly TopicFit[] = ["strong", "moderate", "weak"];
const LATENT_SHAPES: readonly LatentFitShape[] = ["methodological_transfer", "asset_ownership", "trajectory", "mechanistic_adjacency", "team_shape", "constraint_in_prose"];

const LIST = { max: 8, each: 80 };
const NOTE = 400;
const SENTENCE = 600;

/** Pure. Call A validated: enums checked, ids filtered to the evidence (a masked id maps back to its canonical spelling), lists capped. `usable` needs `paradigm_fit`. */
export function validateCallA(raw: unknown, evidenceIds: readonly string[]): { a: BlindCallA | null; dropped: string[]; usable: boolean } {
  const dropped: string[] = [];
  if (!isRecord(raw)) return { a: null, dropped: [`call A: not a JSON object`], usable: false };
  const known = evidenceIdIndex(evidenceIds);
  const ip = isRecord(raw.investigator_paradigm) ? raw.investigator_paradigm : {};
  const np = isRecord(raw.notice_paradigm) ? raw.notice_paradigm : {};
  const d = isRecord(raw.design) ? raw.design : {};
  const m = isRecord(raw.materials) ? raw.materials : {};
  const paradigm_fit = enumOf(raw.paradigm_fit, PARADIGM_FITS);
  if (!paradigm_fit) dropped.push(`call A: paradigm_fit missing or unknown (${String(raw.paradigm_fit)})`);
  const unit_fit = enumOf(raw.unit_fit, UNIT_FITS);
  if (!unit_fit) dropped.push(`call A: unit_fit missing or unknown (${String(raw.unit_fit)})`);
  const a: BlindCallA = {
    investigator_paradigm: { dominant: strList(ip.dominant, "investigator_paradigm.dominant", dropped, LIST), secondary: strList(ip.secondary, "investigator_paradigm.secondary", dropped, LIST), evidence_ids: idList(ip.evidence_ids, known, "investigator_paradigm.evidence_ids", dropped), note: str(ip.note, NOTE) ?? "" },
    notice_paradigm: { required: strList(np.required, "notice_paradigm.required", dropped, LIST), allowed: strList(np.allowed, "notice_paradigm.allowed", dropped, LIST), excluded: strList(np.excluded, "notice_paradigm.excluded", dropped, LIST), note: str(np.note, NOTE) ?? "" },
    paradigm_fit,
    unit_fit,
    design: { notice_requires: strList(d.notice_requires, "design.notice_requires", dropped, LIST), investigator_has_led: strList(d.investigator_has_led, "design.investigator_has_led", dropped, LIST), investigator_has_contributed: strList(d.investigator_has_contributed, "design.investigator_has_contributed", dropped, LIST), unmet_required: strList(d.unmet_required, "design.unmet_required", dropped, LIST), evidence_ids: idList(d.evidence_ids, known, "design.evidence_ids", dropped) },
    materials: { notice_expects: strList(m.notice_expects, "materials.notice_expects", dropped, LIST), investigator_has: strList(m.investigator_has, "materials.investigator_has", dropped, LIST), gap: str(m.gap, NOTE) },
  };
  return { a, dropped, usable: paradigm_fit !== null };
}

/** Pure. Call B validated: the verdict is required (else unusable), ids filtered, the scout field only when asked for and `found` only with ≥ 2 ids. */
export function validateCallB(raw: unknown, evidenceIds: readonly string[], opts: { scout: boolean; collaborators: readonly string[] }): { b: BlindCallB | null; dropped: string[]; usable: boolean } {
  const dropped: string[] = [];
  if (!isRecord(raw)) return { b: null, dropped: ["call B: not a JSON object"], usable: false };
  const known = knownIds(evidenceIds);
  const verdict = enumOf(raw.verdict, TIER_IDS);
  if (!verdict) {
    dropped.push(`call B: verdict missing or unknown (${String(raw.verdict)}); reply unusable`);
    return { b: null, dropped, usable: false };
  }
  let structural_revision: BlindCallB["structural_revision"] = null;
  if (raw.structural_revision !== null && raw.structural_revision !== undefined) {
    if (isRecord(raw.structural_revision) && typeof raw.structural_revision.field === "string") {
      structural_revision = { field: str(raw.structural_revision.field, 120) ?? "", from: raw.structural_revision.from ?? null, to: raw.structural_revision.to ?? null, why: str(raw.structural_revision.why, NOTE) ?? "" };
    } else dropped.push(`structural_revision: not an object with a field (${String(raw.structural_revision).slice(0, 60)})`);
  }
  const topic_fit = enumOf(raw.topic_fit, TOPIC_FITS);
  if (!topic_fit) dropped.push(`call B: topic_fit missing or unknown (${String(raw.topic_fit)})`);
  const gate = bool(raw.counter_case_is_gate_level);
  if (gate === null) dropped.push("counter_case_is_gate_level: missing; treated as false");
  let collaborator_suggestion = str(raw.collaborator_suggestion, 120);
  if (collaborator_suggestion && !opts.collaborators.some((c) => c.toLowerCase() === collaborator_suggestion!.toLowerCase() || collaborator_suggestion!.toLowerCase().includes(c.toLowerCase()))) {
    dropped.push(`collaborator_suggestion: not in COLLABORATORS (${collaborator_suggestion})`);
    collaborator_suggestion = null;
  }
  let latent_fit: LatentFit | null = null;
  if (raw.latent_fit !== undefined && raw.latent_fit !== null) {
    if (!opts.scout) dropped.push("latent_fit: given outside the scout variant; ignored");
    else if (isRecord(raw.latent_fit)) {
      const ids = idList(raw.latent_fit.evidence_ids, known, "latent_fit.evidence_ids", dropped);
      let found = bool(raw.latent_fit.found) ?? false;
      if (found && ids.length < 2) {
        dropped.push(`latent_fit: found with ${ids.length} cited id(s); needs 2 — treated as not found`);
        found = false;
      }
      latent_fit = { found, shape: enumOf(raw.latent_fit.shape, LATENT_SHAPES), explanation: str(raw.latent_fit.explanation, SENTENCE) ?? "", evidence_ids: ids };
    } else dropped.push("latent_fit: not an object");
  }
  const b: BlindCallB = {
    structural_revision,
    topic_fit,
    topic_note: str(raw.topic_note, NOTE) ?? "",
    topic_evidence_ids: idList(raw.topic_evidence_ids, known, "topic_evidence_ids", dropped),
    eligibility_concerns: strList(raw.eligibility_concerns, "eligibility_concerns", dropped, { max: 6, each: 300 }),
    verdict,
    biggest_gap: str(raw.biggest_gap, NOTE) ?? "",
    what_would_make_it_strong: str(raw.what_would_make_it_strong, NOTE),
    collaborator_suggestion,
    counter_case: str(raw.counter_case, SENTENCE) ?? "",
    counter_case_is_gate_level: gate ?? false,
    rationale: str(raw.rationale, 800) ?? "",
    latent_fit,
  };
  return { b, dropped, usable: true };
}

/** Ids from `known` that appear in a text (a rationale's citations). */
export function citedIds(text: string, evidenceIds: readonly string[]): string[] {
  const lower = text.toLowerCase();
  return evidenceIds.filter((id) => lower.includes(id.toLowerCase()));
}

/** One tier lower; poor stays poor. */
export function lowerTier(tier: Tier, steps = 1): Tier {
  return TIER_IDS[Math.min(TIER_IDS.length - 1, tierRank(tier) + steps)]!;
}

/** Pure. The post-rules on one variant's calls: contradiction (guardrail 1), the counter-case rule, grounding (guardrail 2). */
export function applyBlindPostRules(a: BlindCallA | null, b: BlindCallB, evidenceIds: readonly string[]): { verdict: Tier | null; grounded: boolean; lowered: string[] } {
  const lowered: string[] = [];
  let verdict: Tier = b.verdict;
  if (verdict === "strong" && a) {
    const contradictions = [a.design.unmet_required.length ? `design.unmet_required = ${a.design.unmet_required.join(", ")}` : null, a.paradigm_fit === "weak" || a.paradigm_fit === "incompatible" ? `paradigm_fit = ${a.paradigm_fit}` : null, a.unit_fit === "mismatch" ? "unit_fit = mismatch" : null].filter((x): x is string => x !== null);
    if (contradictions.length) {
      verdict = "exploratory";
      lowered.push(`strong verdict contradicts the structural fields (${contradictions.join("; ")}); rejected to exploratory`);
    }
  }
  if ((verdict === "strong" || verdict === "moderate") && b.counter_case_is_gate_level) {
    verdict = lowerTier(verdict);
    lowered.push(`counter-case is gate-level; lowered to ${verdict}`);
  }
  const cited = new Set<string>([...(a?.investigator_paradigm.evidence_ids ?? []), ...(a?.design.evidence_ids ?? []), ...b.topic_evidence_ids, ...citedIds(b.rationale, evidenceIds)]);
  const grounded = cited.size > 0;
  if (!grounded) lowered.push("no claim cites an id that exists; verdict treated as absent");
  return { verdict: grounded ? verdict : null, grounded, lowered };
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

export type BlindPassDeps = {
  model: JudgeModelFn;
  modelName: string;
  /** Run variant 1 only, or both (default 2 — spec guardrail 6). */
  variants?: 1 | 2;
  /** Ask Call B for `latent_fit` (the near-miss scout). */
  scout?: boolean;
  /** Reserve one call; false when the run's model budget is spent (the service folds its deadline into this). */
  takeCall?: () => boolean;
  /** Epoch ms after which no new call is made, read through `now`. */
  deadline?: number | null;
  now?: () => Date;
  mask?: readonly MaskTerm[];
  log?: (line: string) => void;
};

/** Pure given the model function. Runs Call A then Call B per variant, validates, applies the post-rules and combines the variants. */
export async function runBlindPass(inputs: JudgeInputs, deps: BlindPassDeps): Promise<BlindResult> {
  const evidenceIds = inputs.evidence.map((e) => e.id);
  const mask = deps.mask ?? pairMask(inputs);
  const scout = Boolean(deps.scout);
  const variants: BlindVariantResult[] = [];
  const now = deps.now ?? (() => new Date());
  const take = () => (deps.deadline != null && now().getTime() >= deps.deadline ? false : deps.takeCall ? deps.takeCall() : true);
  for (const variant of ([1, 2] as const).slice(0, deps.variants ?? 2)) {
    const dropped: string[] = [];
    let calls = 0;
    const base: BlindVariantResult = { variant, a: null, b: null, verdict_raw: null, verdict: null, grounded: false, lowered: [], usable: false, dropped, calls };
    if (!take()) {
      dropped.push("call A: not made (model budget spent or past the deadline)");
      variants.push(base);
      continue;
    }
    const system = blindSystemPrompt(variant);
    const replyA = await callJson(deps.model, { purpose: "blind_a", variant, system, user: buildCallAPrompt(inputs, mask), model: deps.modelName, maxTokens: JUDGE_MAX_TOKENS.blind_a });
    calls += 1;
    dropped.push(...replyA.problems);
    const va = replyA.usable ? validateCallA(replyA.raw, evidenceIds) : { a: null, dropped: [], usable: false };
    dropped.push(...va.dropped);
    if (!va.usable) {
      variants.push({ ...base, a: va.a, calls });
      continue;
    }
    if (!take()) {
      dropped.push("call B: not made (model budget spent or past the deadline)");
      variants.push({ ...base, a: va.a, calls });
      continue;
    }
    const replyB = await callJson(deps.model, { purpose: "blind_b", variant, system, user: buildCallBPrompt(inputs, JSON.stringify(va.a, null, 1), scout), model: deps.modelName, maxTokens: JUDGE_MAX_TOKENS.blind_b });
    calls += 1;
    dropped.push(...replyB.problems);
    const vb = replyB.usable ? validateCallB(replyB.raw, evidenceIds, { scout, collaborators: inputs.collaborators.map((c) => c.name_or_id) }) : { b: null, dropped: [], usable: false };
    dropped.push(...vb.dropped);
    if (!vb.usable || !vb.b) {
      variants.push({ ...base, a: va.a, calls });
      continue;
    }
    const post = applyBlindPostRules(va.a, vb.b, evidenceIds);
    variants.push({ variant, a: va.a, b: vb.b, verdict_raw: vb.b.verdict, verdict: post.verdict, grounded: post.grounded, lowered: post.lowered, usable: true, dropped, calls });
  }
  const result = { ...combineVariants(variants, scout), evidence_ids: evidenceIds };
  deps.log?.(`blind: ${result.variants.map((v) => `v${v.variant} ${v.usable ? `${v.verdict_raw}→${v.verdict ?? "absent"}` : "unusable"}`).join(", ")} → ${result.verdict ?? "absent"}${result.self_consistent ? "" : " (variants disagree by ≥ 2 tiers)"}${result.latent_fit?.found ? `; latent fit ${result.latent_fit.shape}` : ""}; ${result.calls} calls`);
  return result;
}

/** Pure. The combined verdict: the lower of the usable variants' verdicts; absent when they disagree by ≥ 2 tiers (R8) or none is usable. */
export function combineVariants(variants: BlindVariantResult[], scout: boolean): BlindResult {
  const present = variants.filter((v) => v.usable && v.verdict !== null);
  let self_consistent = true;
  let verdict: Tier | null = null;
  if (present.length >= 2) {
    const ranks = present.map((v) => tierRank(v.verdict!));
    if (Math.max(...ranks) - Math.min(...ranks) >= 2) self_consistent = false;
    else verdict = present.reduce((worst, v) => (tierRank(v.verdict!) > tierRank(worst) ? v.verdict! : worst), present[0]!.verdict!);
  } else if (present.length === 1) verdict = present[0]!.verdict;
  const latent = variants.map((v) => v.b?.latent_fit ?? null).find((l) => l?.found) ?? null;
  return {
    variants,
    verdict,
    self_consistent,
    scout,
    latent_fit: latent,
    evidence_ids: [],
    calls: variants.reduce((s, v) => s + v.calls, 0),
  };
}

