# Prompt spec — Notice extractor

**Role in the pipeline.** Phase 1 (spec §6). Builds the structured opportunity profile from the **full** solicitation text, section by section. Deterministic overlays (activity-code priors, clinical-trial designation, program division) are applied in code **before** this prompt runs and are passed in as context; the model may refine them only with a verbatim quote. The exemplar prior (RePORTER-funded projects) is blended in code **after**.

**Model.** `FIT_MODEL_EXTRACT` (default `gpt-4o` — D2, D22; this is judgment, and it runs once per notice version). `temperature: 0`, JSON mode, `max_tokens` 4,000. Cache by `contentHash(taxonomy_version + system prompt + user prompt)` in `fit_notice_extractions`, one row per section-group chunk; unusable replies are never cached.

**Chunking.** Run once per section group, then merge in code. Sections are routed by their stored `section` id and heading (`groupSections` in `src/lib/fit/profile/opportunity-extract.ts`):

- Group 1: the Part 1 `Funding Opportunity Purpose` section, plus every Section I section whose heading does **not** match `NON_RESPONSIVE_HEADING = /non-?respons|not respons|will not be reviewed|out of scope/i`.
- Group 2: the Section I sections matching `NON_RESPONSIVE_HEADING`, every Section II section (Award Information, `Clinical Trial?`), and the Section IV items whose heading matches `HUMAN_SUBJECTS_HEADING = /Human Subjects|Clinical Trial/i`.
- Group 3: every Section III item (III.1–III.3, PD/PI eligibility included), every Section VII section, and the Section I sections whose heading matches `TEAM_HEADING = /\b(?:teams?|collaborat\w*|consorti\w*|partner\w*|leadership|structure|multiple PDs?|multi-?PI)\b/i` (those stay in group 1 as well).
- A synopsis is group 1 only.

A group is packed in order into chunks of ≤ 30,000 characters; an over-long section splits at line boundaries into ≤ 30,000-char chunks; chunk i of k is stated in the prompt (`Section group: n (chunk i of k)`). Each chunk fills only the fields listed for it; later chunks may add `excluded`/`prohibited` entries but never remove `required` entries from earlier chunks.

## Inputs

```
number, title, agency, activity_code, activity_title, clinical_trial_designation, issuing_ic, program_division (if parsed)
priors: { paradigm_required, paradigm_required_any?, paradigm_allowed, paradigm_excluded, unit_required, unit_required_any?, design_required_any, design_prohibited, materials_required, materials_required_any? }   // from taxonomy overlays; the *_required_any sets (D14, BESH) are present only when non-empty
section_group: 1 | 2 | 3
sections: [{ heading, text }]   // sectioned Guide text; ≤ 30,000 chars per chunk (split further if needed)
```

## System prompt

```
You read NIH and foundation funding announcements for a university research-development office and describe what kind of research the program will fund — not what topic, primarily, but what PARADIGM, at what UNIT OF ANALYSIS, with what STUDY DESIGNS and MATERIALS, toward what OBJECTIVE — plus the investigator-level eligibility rules and team expectations.

Be literal. Every non-empty field must carry a verbatim quote (≤ 240 chars) and the section heading it came from. Distinguish REQUIRED (the notice says applications must / are expected to), ALLOWED (may / encouraged / examples include) and EXCLUDED or PROHIBITED (non-responsive / not allowed / will not be reviewed). When the notice is silent, leave the field empty — do not fill from the title or from general knowledge of the mechanism. The priors you are given came from the activity code and title designation; keep them unless the text explicitly contradicts them, and if it does, say so in `prior_overrides` with the quote.

Use only the fixed vocabulary below.
[VOCABULARY_PROMPT from item-classifier.md, verbatim]

For `topic`, list the notice's DISTINGUISHING scientific terms — what would separate a responsive application from a non-responsive one. Never include generic words (mechanisms, novel, translational, biomedical, health, disease, clinical, data).
```

The placeholder line is `VOCABULARY_PROMPT` exported by `src/lib/fit/classify/llm.ts` (the item classifier's vocabulary block, spliced in verbatim). The D19 vocabulary definitions are **not** spliced in — vocabulary block only (D22). `EXTRACTOR_SYSTEM_PROMPT` in `opportunity-extract.ts` is pinned to this block byte for byte by `opportunity.test.ts`.

## User template (group 1 shown; groups 2–3 replace the `Return JSON:` block with theirs)

`{section label}` is `Part 1 · Overview · {heading}`, `Part 2 · Section {id} · {heading}` or `Synopsis`; every section of the chunk is one `## {section label}` line, its text, and a blank line. Missing header values print as `(unknown)`. `Section group: {n}` reads `Section group: {n} (chunk {i} of {k})` when the group was split.

```
Notice {number} · {agency} · {title}
Activity code: {activity_code} ({activity_title}) · Clinical trial: {clinical_trial_designation} · IC: {issuing_ic} · Division: {program_division}
Priors from code: {priors as JSON}
Section group: {n}

Sections:
## {section label}
{text}

Every quote in "evidence" and "prior_overrides" must be copied character for character from the sections above (no paraphrase, no shortening with "..."); a quote that is not found verbatim is discarded together with the claim it supports. Cite the "## " heading line as the section. Every non-empty field needs its own evidence entry with a verbatim quote; a field without one is discarded.

Return JSON:
{
 "paradigm": { "required_any": {<category>: weight},  // any-of, D14
    "required": {cat: weight}, "allowed": {cat: weight}, "excluded": {cat: weight} },
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

The two sentences between the sections and `Return JSON:` are `QUOTE_REMINDER` (the first added after the first real run, where gpt-4o shortened most quotes with `...`; the second after the validator's run, where the dominant loss was fields listed without any evidence entry).

Group 2 replaces the `Return JSON:` block with:

```
Return JSON (this group fills only these fields):
{
 "paradigm": { "excluded": {cat: weight} },
 "design": { "prohibited": [designs] },
 "non_responsive": string[],            // verbatim items from the non-responsive list
 "mechanism": { "ceiling_direct_per_year": number | null, "period_years": number | null, "budget_notes": string | null },
 "clinical_trial_text": string | null,  // verbatim clinical-trial sentence from Section II or IV
 "evidence": [ { "field": "paradigm.required", "quote": "...", "section": "Part 2 · Section I · Research Objectives" }, ... ],
 "prior_overrides": [ { "field": "...", "from": ..., "to": ..., "quote": "...", "section": "..." } ],
 "confidence": "high" | "medium" | "low"    // low when the text is a synopsis only
}
```

Group 3 replaces it with:

```
Return JSON (this group fills only these fields):
{
 "eligibility": { "investigator_rules": string[], "esi_only": boolean, "new_investigator_only": boolean, "clinician_required": boolean, "degree_required": string | null, "independent_appointment_required": boolean, "citizenship_rule": string | null },   // investigator_rules: verbatim
 "team": { "multi_pi_allowed": boolean | null, "consortium_required": boolean | null, "required_partners": string[] },
 "evidence": [ { "field": "paradigm.required", "quote": "...", "section": "Part 2 · Section I · Research Objectives" }, ... ],
 "prior_overrides": [ { "field": "...", "from": ..., "to": ..., "quote": "...", "section": "..." } ],
 "confidence": "high" | "medium" | "low"    // low when the text is a synopsis only
}
```

Group 3 carries no `contacts`: the Section VII division is read deterministically (`program_division`, PR 0.5) and contacts are not stored (N2).

## Validation (in code)

`validateGroupOutput` / `mergeExtractions` / `blend` in `src/lib/fit/profile/`; every removal or change is a line in the stored `dropped` / merge log.

- **Quote verification.** Every quote in `evidence` and `prior_overrides` is normalized — whitespace collapsed, typographic quotes (‘ ’ “ ”) and dashes (‐ – — −) folded to ASCII, non-breaking spaces to spaces — and must be a substring of a provided section normalized the same way. The cited section is tried first (its label, its heading, or a citation that contains the heading); a quote found only in another provided section is kept with the section corrected and the correction logged. An **elided quote** — text on both sides of `...` / `…` — is rejected outright (D22); a marker at either end is stripped; a bare marker is an empty quote. A quote over 240 characters is kept and logged. Field names written as `paradigm_required.x` are normalized to `paradigm.required.x`.
- **A claim needs a quote on its field or an ancestor.** A non-empty entry is kept only when a verified quote's `field` is the entry's path or an ancestor of it (`paradigm.required.clinical_trials` ← `paradigm.required.clinical_trials`, `paradigm.required` or `paradigm`); otherwise it is dropped and logged as `no verified quote (no evidence entry)` or `no verified quote (evidence quote failed)`.
- **Verbatim lists** (`non_responsive`, `eligibility.investigator_rules`, `clinical_trial_text`) are their own quotes and verify item by item; no evidence entry is needed for them.
- **Guards.** Only the group's own fields are read (anything else is logged as ignored — group 2's `paradigm.required`, a stray `contacts`); ids go through the taxonomy guards (unknown ids dropped); weights are clamped to [0, 1] with the clamp logged and zeros omitted; `confidence` outside `high | medium | low` becomes `medium` (logged); a claim-bearing boolean (`esi_only`, `new_investigator_only`, `clinician_required`, `independent_appointment_required`) needs a quote when `true` and defaults to `false`; `human_required`, `multi_pi_allowed` and `consortium_required` need a quote for either value and default to `null`; `topic` strings are trimmed and deduplicated case-insensitively.
- `required` entries may cite Part 1 Purpose or Section I (the group-1 sections) or rest on the title designation; `allowed` entries may cite examples.
- **Merge precedence** (highest first), with override semantics: (a) overlay entries, unless a verified `prior_override` removes the entry (a `to` of `null` / `0` / `false` / `[]`) or changes it (a number sets the weight; a list replaces a prior list); a verified override on a field the priors never set is taken as a quoted text claim on the group's own fields; (b) text `excluded` / `prohibited` from any group; (c) text `required` / `required_any` from group 1 only (group 2's and 3's are logged and ignored); (d) text `allowed` / `expected`. Weights are max-merged across chunks; the first verified quote per field path across groups is the profile's provenance; the `population`, `human_required`, `mechanism` and `clinical_trial_text` values are the first seen.
- **Conflicts.** A category both excluded and required: a title-level **designation** requirement survives a text exclusion (the exclusion is dropped; the model must contradict the designation through `prior_overrides`); any other conflict — text against text, an overlay exclusion against a text requirement, a text exclusion against an activity-code or division prior — → excluded wins and the requirement is dropped; both cases set `needs_review` (D22). `allowed` / `expected` entries that collide with an exclusion or repeat a requirement are dropped (logged); a category `required` outright leaves `required_any`.
- **Unusable replies.** A reply that is not JSON, or was cut off at `max_tokens` (`finish_reason: length`), is `usable: false`: nothing is merged from it, it is never cached, and the build is incomplete.
- **Exemplar blend** after the merge (taxonomy `opportunity_profile.exemplar_blend`, D21): the exemplar prior per axis is the plain mean of the classified item vectors; n = exemplars with a non-empty paradigm vector; a category the text or an overlay requires becomes `w_t · text + w_e · share`, a designation requirement never below its overlay weight; an exemplar-only category enters `paradigm.allowed` at `w_e · share`, never `required`; `objective` blends over the union; a list axis gains an exemplar category when `share ≥ list_min_share`; excluded / prohibited categories never re-enter.
- **Confidence** = the group-1 reply's (minimum over chunks; a usable reply without one counts as `medium`) over full Guide text; synopsis-only → capped at `medium`; no text, or no usable group-1 reply → `low`.
- **Completeness** (D22). A build with a chunk skipped for the model budget or the time budget, an unusable reply, or an exemplar the model was needed for but could not be called for is stored with `sources.complete: false` and the reasons in `sources.incomplete`, and is due again on the next run; the runner defers a notice when fewer than 3 model calls remain.

- Verbatim `eligibility.investigator_rules` and `non_responsive` items that match `signal-mapping.json › notice_boilerplate` (NIH template sentences that constrain no one) are dropped when the profile is assembled — after the extraction-cache read — and logged in `sources.merge_log` (D25).

## Fixture notices (real numbers from the corpus; section text is synthetic — short paraphrases written for the fixture, not the stored Guide text; outputs recorded in the PR)

1. A "Clinical Trial Required" R01 (therapeutic) — RFA-DK-26-315; expect `clinical_trials` required, `rct/early_phase_trial` required_any, `enrolled_participants`. Its mocked reply also carries a verified `prior_override` lowering the designation prior to 0.9 and an unverified one that changes nothing.
2. A "Basic Experimental Studies with Humans Required" R01 — PA-25-303; expect `early_phase_human_experimental`/`human_biospecimen` required_any, wet-lab designs, human materials required.
3. A DCCPS population R01 with an explicit non-responsive list — PA-25-172 (NCI's modular R01) with the division set as `parseProgramDivision` would store it and six synthetic exemplars (five with an abstract); expect population paradigms required, laboratory designs prohibited, `non_responsive` populated, and the D21 blend numbers the fixture file states.
4. A D&I hybrid effectiveness-implementation trial notice — PAR-25-178 (an R01: the corpus has no R18 D&I PAR; the R18 prior is covered by the overlay tests); expect `implementation_science` required, hybrid designs required_any.
5. A P30 center notice — RFA-DK-27-120; expect `objective.resource_infrastructure`, paradigm mostly `allowed`, eligibility rules about center directors.
6. A synopsis-only notice — PAR-28-007 (a forecast that exists only as a Simpler synopsis; Simpler carries no foundation notices); expect `confidence: medium` or `low` and mostly empty `required`.
