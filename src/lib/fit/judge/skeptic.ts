/**
 * Stage 8b · the skeptic pass (plan § PR 3.1; spec §16 "Skeptic pass";
 * docs/fit-engine/prompts/skeptic.md — the prompt here is pinned to that file
 * byte for byte by skeptic.test.ts). A program officer reading the
 * application as likely non-responsive: the single strongest objection, its
 * kind, the ids it rests on. It never confirms; it objects or says it
 * cannot. Run on every provisional Strong and every blind-pass Strong (the
 * service decides).
 *
 * Post-rules, in code as the spec writes them: `gate_level` is derived from
 * the kind (eligibility / paradigm / design / unit_materials), never taken
 * from the model; an objection with ≥ 1 verifying id — an evidence id or a
 * notice section reference such as "notice:non_responsive" — is grounded and
 * reaches reconciliation as such; one with no verifying id is recorded as
 * ungrounded and lowers confidence only; a `topic` objection is never
 * gate-level and lowers a tier by at most one step (reconcile.ts).
 */
import { renderEvidence, renderNotice } from "@/lib/fit/judge/inputs";
import { callJson, JUDGE_MAX_TOKENS, type JudgeModelFn } from "@/lib/fit/judge/model";
import type { JudgeInputs, ObjectionKind, SkepticResult } from "@/lib/fit/judge/types";
import { bool, enumOf, idList, isRecord, knownIds, str } from "@/lib/fit/judge/validate";

export const SKEPTIC_SYSTEM_PROMPT = `You are a program officer at the institute that issued this funding announcement. An application from this investigator has arrived. Your task is to find the single strongest reason it would be considered non-responsive, ineligible, or a poor fit for what the program intends to fund — using only the evidence provided.

Look, in this order, for:
1. Eligibility problems (career stage, degree, appointment, prior-funding rules).
2. Paradigm problems: the program funds one kind of research and the evidence shows another.
3. Design problems: a required study design (trial, cohort, wet-lab, implementation study) the investigator has never led; a prohibited design that dominates the evidence.
4. Unit / materials problems: wrong level of analysis, no evidence of the required human materials or participants.
5. Scale and role problems hidden inside a nominal match (single-site vs. multi-site; sub-investigator vs. PI; a small self-recruited cohort where an existing large cohort is required).
6. Only then, topical problems.

If no grounded objection exists, say so. Never invent evidence. Cite ids. Output JSON only.`;

export const SKEPTIC_RETURN = `Return:
{
 "objection": string | null,                  // one sentence; null if none
 "objection_kind": "eligibility" | "paradigm" | "design" | "unit_materials" | "scale_role" | "topic" | null,
 "gate_level": boolean,                       // true for eligibility / paradigm / design / unit_materials
 "evidence_ids": [...],                       // ids the objection rests on; may include "notice:non_responsive"
 "confidence": "high" | "medium" | "low",
 "what_would_resolve_it": string | null       // e.g. "a co-PI who has led a phase II trial", "evidence of multi-site data access"
}`;

/** Notice references an objection may cite beside evidence ids (skeptic.md: `may include "notice:non_responsive"`). */
export const NOTICE_REFS = ["notice:non_responsive", "notice:section_I", "notice:eligibility"] as const;

export const OBJECTION_KINDS: readonly ObjectionKind[] = ["eligibility", "paradigm", "design", "unit_materials", "scale_role", "topic"];

/** skeptic.md: "true for eligibility / paradigm / design / unit_materials". */
export const GATE_LEVEL_KINDS: ReadonlySet<ObjectionKind> = new Set(["eligibility", "paradigm", "design", "unit_materials"]);

export function isGateLevelKind(kind: ObjectionKind | null): boolean {
  return kind !== null && GATE_LEVEL_KINDS.has(kind);
}

/** The INVESTIGATOR CHARACTERISTICS line: facts only, no scores. */
export function characteristicsLine(c: JudgeInputs["characteristics"]): string {
  const rank = c.title_series ?? c.career_stage ?? "unknown";
  return `INVESTIGATOR CHARACTERISTICS: rank/title ${rank}${c.clinical_role ? ` (${c.clinical_role.replace(/_/g, " ")})` : ""}, mechanisms held ${c.mechanisms_held.length ? c.mechanisms_held.join(", ") : "none"}, trial PI count ${c.trial_pi_count}, active awards ${c.active_awards}${c.esi === true ? ", early-stage investigator" : ""}${c.degrees.length ? `, degrees ${c.degrees.join(", ")}` : ""}`;
}

export function buildSkepticPrompt(inputs: JudgeInputs): string {
  const n = inputs.notice;
  return [`NOTICE: ${renderNotice(n, { title: true, eligibility: true })}`, "", "EVIDENCE:", renderEvidence(inputs.evidence), characteristicsLine(inputs.characteristics), "", SKEPTIC_RETURN].join("\n");
}

/** Pure. The reply validated: the kind decides `gate_level`; ids filtered to the evidence and the notice references; an objection with no verifying id is ungrounded. */
export function validateSkeptic(raw: unknown, evidenceIds: readonly string[]): { result: Omit<SkepticResult, "calls">; usable: boolean } {
  const dropped: string[] = [];
  const empty: Omit<SkepticResult, "calls"> = { objection: null, objection_kind: null, gate_level: false, evidence_ids: [], confidence: null, what_would_resolve_it: null, grounded: false, usable: false, dropped };
  if (!isRecord(raw)) {
    dropped.push("skeptic: not a JSON object");
    return { result: empty, usable: false };
  }
  if (!("objection" in raw)) {
    dropped.push("skeptic: no objection field; reply unusable");
    return { result: empty, usable: false };
  }
  const objection = str(raw.objection, 400);
  const known = knownIds([...evidenceIds, ...NOTICE_REFS]);
  const ids = idList(raw.evidence_ids, known, "evidence_ids", dropped);
  const confidence = enumOf(raw.confidence, ["high", "medium", "low"] as const);
  if (!objection) {
    if (raw.objection_kind) dropped.push(`objection_kind given without an objection (${String(raw.objection_kind)}); ignored`);
    return { result: { ...empty, confidence, evidence_ids: ids, what_would_resolve_it: str(raw.what_would_resolve_it, 300), usable: true }, usable: true };
  }
  let kind = enumOf(raw.objection_kind, OBJECTION_KINDS);
  if (!kind) {
    dropped.push(`objection_kind missing or unknown (${String(raw.objection_kind)}); treated as topic (never gate-level)`);
    kind = "topic";
  }
  const gate = isGateLevelKind(kind);
  const said = bool(raw.gate_level);
  if (said !== null && said !== gate) dropped.push(`gate_level ${said} disagrees with the kind ${kind}; the kind decides (${gate})`);
  const grounded = ids.length > 0;
  if (!grounded) dropped.push("objection cites no id in the input; recorded as ungrounded");
  return { result: { objection, objection_kind: kind, gate_level: gate, evidence_ids: ids, confidence, what_would_resolve_it: str(raw.what_would_resolve_it, 300), grounded, usable: true, dropped }, usable: true };
}

export type SkepticDeps = { model: JudgeModelFn; modelName: string; takeCall?: () => boolean; deadline?: number | null; now?: () => Date; log?: (line: string) => void };

/** Pure given the model function. One call; null when the budget or deadline forbids it (the caller treats null as a refused call). */
export async function runSkeptic(inputs: JudgeInputs, deps: SkepticDeps): Promise<SkepticResult | null> {
  if (deps.deadline != null && (deps.now ?? (() => new Date()))().getTime() >= deps.deadline) return null;
  if (deps.takeCall && !deps.takeCall()) return null;
  const reply = await callJson(deps.model, { purpose: "skeptic", system: SKEPTIC_SYSTEM_PROMPT, user: buildSkepticPrompt(inputs), model: deps.modelName, maxTokens: JUDGE_MAX_TOKENS.skeptic });
  const evidenceIds = inputs.evidence.map((e) => e.id);
  const v = reply.usable ? validateSkeptic(reply.raw, evidenceIds) : validateSkeptic(null, evidenceIds);
  const result: SkepticResult = { ...v.result, dropped: [...reply.problems, ...v.result.dropped], usable: reply.usable && v.usable, calls: 1 };
  deps.log?.(`skeptic: ${result.usable ? (result.objection ? `${result.objection_kind}${result.gate_level ? " (gate-level)" : ""}, ${result.grounded ? "grounded" : "ungrounded"}` : "no objection") : "unusable"}`);
  return result;
}
