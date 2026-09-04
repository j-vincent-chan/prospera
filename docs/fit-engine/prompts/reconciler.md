# Prompt spec — Informed reconciliation (stage 8c)

**Role.** Sees everything — structured components and provisional tier, blind verdicts, skeptic output, evidence, notice — and explains any disagreement. It **never emits a score or a tier**. It produces (a) a reconciliation explanation, (b) zero or more **grounded corrections** to inputs, (c) the user-facing rationale text. Tier decisions are made in code by the reconciliation rules (spec §16 table), after any accepted corrections are applied and the structured score is recomputed.

**Model.** `FIT_MODEL_JUDGE`. `temperature: 0`, JSON mode.

## Inputs

```
structured: { components: {E,P,U,D,T,M,O,K,A}, caps: [...], provisional_tier, provenance: { P: {best_pair}, D: {unmet_required, dominant_prohibited}, T: {top_items}, ... } }
blind: { variant1: {...}, variant2: {...} } | null
skeptic: {...} | null
investigator_profile_excerpt: { paradigm.recent, unit, design, materials, characteristics }    // the structured record, with per-category top evidence ids
notice_profile_excerpt: { paradigm, unit, design, materials, eligibility, confidence, evidence quotes }
evidence: [...]   // same items as blind pass
```

## System prompt

```
You reconcile two assessments of the same investigator–notice pair: a structured, rule-based score and an independent expert reading. Your job is not to pick a winner. It is to explain the disagreement, and — where you believe the structured inputs are WRONG — to propose specific, checkable corrections to those inputs.

A correction names one field of the investigator profile or the notice profile, the current value, the proposed value, and the evidence (ids, or a verbatim notice quote) that supports it. Examples of valid corrections:
- investigator.design.rct: 0.10 → 0.70, evidence: NCT0…, NCT0… list this person as PRINCIPAL_INVESTIGATOR (the ingest recorded no role).
- notice.paradigm.required += human_biospecimen, quote: "…mechanistic studies in human tissue…" (Section I, para 3).
- investigator.characteristics.trial_pi_count: 0 → 2, evidence: NCT0…, NCT0….

Corrections that are NOT valid: "the topics are very similar so the paradigm gate should not apply"; "this investigator seems capable"; anything without an id or quote. A topical argument never reopens a paradigm gate.

If the expert reading found fit that no correction can express (a latent relationship the schema cannot represent), say so in `inexpressible_insight` — it will be shown to a strategist, not applied.

Write the rationale for a research-development strategist: three sentences at most, citing evidence ids, naming the single most important gap when the pair is not Strong. Output JSON only.
```

## User template

```
STRUCTURED: {structured as JSON}
BLIND PASS: {blind as JSON or "not available"}
SKEPTIC: {skeptic as JSON or "not run"}
INVESTIGATOR PROFILE (structured, with evidence ids): ...
NOTICE PROFILE (structured, with quotes): ...
EVIDENCE: ...

Return:
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
}
```

## Post-rules (in code — these ARE the reconciliation table in spec §16)

1. Validate every correction: ids must exist in evidence; quotes must verify against notice sections; `path` must be a known field. Invalid → dropped and logged.
2. Investigator-profile corrections of kind `ingest_miss` or `characteristic` with `confidence: high` → **applied automatically**, recorded in `fit_corrections` with `proposed_by: 'llm'`, `status: 'applied'`; the pair is re-scored.
3. Investigator `profile_weight` corrections → applied provisionally for this pair; queued for strategist confirmation before persisting to the profile.
4. Notice-profile corrections (`misread_requirement`) → applied for this pair only; queued for strategist confirmation before applying globally.
5. After re-score, apply the reconciliation table: Strong requires structured floors met AND blind verdict ≥ moderate (both variants) AND no grounded gate-level skeptic objection. Grounded gate-level objection lowers to the objection's implied tier. Ungrounded dissent → tier stands, confidence `low`, review item.
6. `inexpressible_insight` non-null and structured tier ≤ exploratory → create an "AI-flagged lead" review item; show as Exploratory with the insight as rationale.
7. Persist `rationale` and `why_not` to `fit_results`; render component provenance alongside — the rationale never replaces the components.
