# Prompt spec — Notice extractor

**Role in the pipeline.** Phase 1 (spec §6). Builds the structured opportunity profile from the **full** solicitation text, section by section. Deterministic overlays (activity-code priors, clinical-trial designation, program division) are applied in code **before** this prompt runs and are passed in as context; the model may refine them only with a verbatim quote. The exemplar prior (RePORTER-funded projects) is blended in code **after**.

**Model.** `FIT_MODEL_EXTRACT` (use a strong model; this is judgment, and it runs once per notice version). `temperature: 0`, JSON mode. Cache by `contentHash(taxonomy_version + guide_sections)`.

**Chunking.** Run once per section group, then merge in code: (1) Part 1 Purpose + Section I Background/Research Objectives/Specific Areas of Research Interest; (2) Section I Non-Responsive + Section II Award Information + Section IV clinical-trial / human-subjects items; (3) Section III Eligibility (esp. III.3 PD/PI) + Section VII contacts + Section I team/collaboration language. Each chunk fills only the fields listed for it; later chunks may add `excluded`/`prohibited` entries but never remove `required` entries from earlier chunks.

## Inputs

```
number, title, agency, activity_code, activity_title, clinical_trial_designation, issuing_ic, program_division (if parsed)
priors: { paradigm_required, paradigm_allowed, paradigm_excluded, unit_required, design_required_any, design_prohibited, materials_required }   // from taxonomy overlays
section_group: 1 | 2 | 3
sections: [{ heading, text }]   // sectioned Guide text; ≤ 30,000 chars per group (split further if needed)
```

## System prompt

```
You read NIH and foundation funding announcements for a university research-development office and describe what kind of research the program will fund — not what topic, primarily, but what PARADIGM, at what UNIT OF ANALYSIS, with what STUDY DESIGNS and MATERIALS, toward what OBJECTIVE — plus the investigator-level eligibility rules and team expectations.

Be literal. Every non-empty field must carry a verbatim quote (≤ 240 chars) and the section heading it came from. Distinguish REQUIRED (the notice says applications must / are expected to), ALLOWED (may / encouraged / examples include) and EXCLUDED or PROHIBITED (non-responsive / not allowed / will not be reviewed). When the notice is silent, leave the field empty — do not fill from the title or from general knowledge of the mechanism. The priors you are given came from the activity code and title designation; keep them unless the text explicitly contradicts them, and if it does, say so in `prior_overrides` with the quote.

Use only the fixed vocabulary below. [same paradigm / unit / design / materials / objective vocabulary as item-classifier.md]

For `topic`, list the notice's DISTINGUISHING scientific terms — what would separate a responsive application from a non-responsive one. Never include generic words (mechanisms, novel, translational, biomedical, health, disease, clinical, data).
```

## User template (group 1 shown; groups 2–3 list their own fields)

```
Notice {number} · {agency} · {title}
Activity code: {activity_code} ({activity_title}) · Clinical trial: {clinical_trial_designation} · IC: {issuing_ic} · Division: {program_division}
Priors from code: {priors as JSON}

Sections:
## {heading}
{text}
...

Return JSON:
{
 "paradigm": { "required": {cat: weight}, "allowed": {cat: weight}, "excluded": {cat: weight} },
 "unit": { "required": [levels], "allowed": [levels] },
 "design": { "required_any": [designs], "required_any_2": [designs] | null, "allowed": [designs], "prohibited": [designs] },
 "materials": { "expected": [kinds], "human_required": true|false|null },
 "population": string | null,          // required study population, if any ("adults with T2D", "children under 5 in LMICs")
 "objective": {cat: weight},
 "topic": { "distinguishing_terms": string[], "diseases": string[], "biological_processes": string[] },
 "evidence": [ { "field": "paradigm.required", "quote": "...", "section": "Part 2 · Section I · Research Objectives" }, ... ],
 "prior_overrides": [ { "field": "...", "from": ..., "to": ..., "quote": "...", "section": "..." } ],
 "confidence": "high" | "medium" | "low"    // low when the text is a synopsis only
}
```

Group 2 adds: `non_responsive: string[]` (verbatim items), `design.prohibited`, `paradigm.excluded`, `mechanism: { ceiling_direct_per_year, period_years, budget_notes }`, `clinical_trial_text: string | null`.
Group 3 adds: `eligibility: { investigator_rules: string[], esi_only, new_investigator_only, clinician_required, degree_required: string|null, independent_appointment_required, citizenship_rule: string|null }`, `team: { multi_pi_allowed, consortium_required, required_partners: string[] }`, `contacts: [{ name, division, ic }]`.

## Validation (in code)

- Every quote must be a substring (whitespace-normalized) of the provided sections; drop fields whose quote does not verify and log them.
- `required` entries need a quote from Section I or the title designation; `allowed` entries may cite examples.
- Merge groups; unresolved contradictions (a category both required and excluded) → keep excluded, drop required, flag `needs_review`.
- Apply exemplar blend after merge (taxonomy `opportunity_profile.exemplar_blend`).
- Confidence: full Guide text → as returned; synopsis-only → cap at `medium`; no text → `low` (tags fallback).

## Fixture notices (use real numbers from the corpus; record outputs in the PR)

1. A "Clinical Trial Required" R01 (therapeutic) — expect `clinical_trials` required, `rct/early_phase_trial` required_any, `enrolled_participants`.
2. A "Basic Experimental Studies with Humans Required" R01 — expect `early_phase_human_experimental`/`human_biospecimen` required_any, wet-lab designs, human materials required.
3. A DCCPS population R01 with an explicit non-responsive list — expect population paradigms required, laboratory designs prohibited, `non_responsive` populated.
4. An R18 D&I PAR — expect `implementation_science` required, hybrid designs required_any.
5. A P30 center notice — expect `objective.resource_infrastructure`, paradigm mostly `allowed`, eligibility rules about center directors.
6. A foundation notice with a synopsis only — expect `confidence: medium` or `low` and mostly empty `required`.
