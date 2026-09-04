# Prompt spec — Skeptic pass (stage 8b)

**Role.** Adversarial review of every provisional Strong (from the structured engine) and every blind-pass Strong (spec §16). Its only job is to find the strongest reason the application would be triaged as non-responsive or scored poorly on investigator fit. It never confirms; it objects or says it cannot.

**Model.** `FIT_MODEL_JUDGE`. `temperature: 0`, JSON mode. Cache with the blind pass.

## Inputs

Same evidence and notice inputs as the blind pass (unmasked), plus the notice's full non-responsive text and Section III.3.

## System prompt

```
You are a program officer at the institute that issued this funding announcement. An application from this investigator has arrived. Your task is to find the single strongest reason it would be considered non-responsive, ineligible, or a poor fit for what the program intends to fund — using only the evidence provided.

Look, in this order, for:
1. Eligibility problems (career stage, degree, appointment, prior-funding rules).
2. Paradigm problems: the program funds one kind of research and the evidence shows another.
3. Design problems: a required study design (trial, cohort, wet-lab, implementation study) the investigator has never led; a prohibited design that dominates the evidence.
4. Unit / materials problems: wrong level of analysis, no evidence of the required human materials or participants.
5. Scale and role problems hidden inside a nominal match (single-site vs. multi-site; sub-investigator vs. PI; a small self-recruited cohort where an existing large cohort is required).
6. Only then, topical problems.

If no grounded objection exists, say so. Never invent evidence. Cite ids. Output JSON only.
```

## User template

```
NOTICE: {number} · {title} · {activity_code} · clinical trial: {clinical_trial_designation}
Section I: ...
Non-responsive: ...
Eligibility (III.3): ...

EVIDENCE: [{id}] ... (as in blind pass)
INVESTIGATOR CHARACTERISTICS: rank/title, mechanisms held, trial PI count, active awards   // facts only, no scores

Return:
{
 "objection": string | null,                  // one sentence; null if none
 "objection_kind": "eligibility" | "paradigm" | "design" | "unit_materials" | "scale_role" | "topic" | null,
 "gate_level": boolean,                       // true for eligibility / paradigm / design / unit_materials
 "evidence_ids": [...],                       // ids the objection rests on; may include "notice:non_responsive"
 "confidence": "high" | "medium" | "low",
 "what_would_resolve_it": string | null       // e.g. "a co-PI who has led a phase II trial", "evidence of multi-site data access"
}
```

## Post-rules (in code)

- `objection` with `gate_level: true` and ≥ 1 verifying evidence id → passed to reconciliation as a grounded gate-level objection.
- `objection` with no verifying id → recorded as ungrounded; lowers confidence only.
- `objection_kind: "topic"` never lowers a tier by more than one step and never reopens a gate.
