# Prompt spec — Blind holistic pass (stage 8a)

**Role.** Independent assessment of one investigator–notice pair from evidence and notice text alone (spec §16). It **never** sees the structured score, components, provisional tier, or axis labels. Its output is one signal into reconciliation; it does not decide anything by itself.

**Model.** `FIT_MODEL_JUDGE` (strong model). `temperature: 0`, JSON mode. Run **twice** with the two prompt variants below (or once each on two models); if verdicts differ by ≥ 2 tiers, record `blind_verdict: null` (spec §16 guardrail 6). Cache by `(investigator_profile_version, opportunity_profile_version, prompt_variant)`.

**When it runs.** For the top ~15 candidates per investigator (or per notice) after stages 1–7, plus the near-miss set (paradigm-compatible, topic-low) for the scout variant (see below).

## Inputs

```
evidence: [ { id, kind, year, role, title, text } ]      // top 8 items by w_item · similarity to the notice; text ≤ 1,200 chars each; ids are stable (PMID, project number, NCT id, 'biosketch:statement')
collaborators: [ { name_or_id, one_line_summary } ]      // ≤ 6, from investigator_relationships
notice: { number, title, activity_code, clinical_trial_designation, section_I_text (≤ 6,000 chars), non_responsive_text, eligibility_text (III.3), team_text }
masking: boolean   // when true, disease/pathway/topic terms in evidence and notice are replaced by [DISEASE], [PATHWAY], [POPULATION] placeholders (spec §16 guardrail 3) — used for the paradigm/unit/design fields
```

Two calls per pair:
- **Call A (masked):** produce `paradigm`, `unit`, `design`, `materials` fields only, from masked text.
- **Call B (unmasked):** given Call A's output verbatim, produce `topic`, `verdict`, `biggest_gap`, `counter_case`.

This ordering is the guardrail: the model commits to "what kind of research does this person do, and what kind does the notice want" before it is allowed to see what either is about.

## System prompt (both calls)

```
You are an experienced research-development strategist at an academic medical center. You are assessing whether one investigator is a realistic applicant for one funding announcement. You reason from the evidence you are given and nothing else; you never assume facts about the person that the evidence does not show, and you never treat shared vocabulary as fit.

Definitions:
- Paradigm: the kind of research (discovery/mechanistic; preclinical/animal; translational human biology; clinical observational or interventional; clinical trials; epidemiology/population; health services/outcomes/implementation; computational/methods).
- Unit of analysis: molecule/cell → animal → human individual/specimen → cohort/population → health system.
- Study design: what is actually done (wet-lab experiments, animal studies, omics, cohorts, trials, EHR/claims analysis, surveys, implementation studies…).

Rules:
1. Judge paradigm, unit and design FIRST, each with the evidence ids that support the judgment. If the notice requires a design the evidence never shows this person leading, say so plainly.
2. A person's role matters: leading a trial as PI is different from being a site sub-investigator; a first/last-author paper is different from a middle-author paper.
3. Topic overlap can make a fit better; it can never make a paradigm or design mismatch acceptable.
4. Cite only ids that appear in the evidence list. Never invent a paper, grant or trial.
5. Output JSON only.
```

## Call A user template (masked)

```
EVIDENCE (topic terms masked):
[{id}] {kind} · {year} · role: {role}
{title}
{text}
...

NOTICE (topic terms masked):
{number} · {activity_code} · clinical trial: {clinical_trial_designation}
Section I:
{section_I_text}
Non-responsive:
{non_responsive_text}

Return:
{
 "investigator_paradigm": { "dominant": [cat...], "secondary": [cat...], "evidence_ids": [...] , "note": string },
 "notice_paradigm": { "required": [cat...], "allowed": [cat...], "excluded": [cat...], "note": string },
 "paradigm_fit": "strong" | "adjacent" | "weak" | "incompatible",
 "unit_fit": "match" | "adjacent" | "mismatch",
 "design": { "notice_requires": [design...], "investigator_has_led": [design...], "investigator_has_contributed": [design...], "unmet_required": [design...], "evidence_ids": [...] },
 "materials": { "notice_expects": [...], "investigator_has": [...], "gap": string | null }
}
```

## Call B user template (unmasked; includes Call A output)

```
Your structural assessment (do not revise it unless the unmasked text shows it was wrong; if you do revise, explain):
{call_A_output}

EVIDENCE (unmasked): ...
NOTICE (unmasked): ... plus eligibility_text and team_text
COLLABORATORS: ...

Return:
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
}
```

**Post-rule (in code):** if `verdict` is `strong` or `moderate` and `counter_case_is_gate_level` is true, lower the blind verdict by one tier before storing it.

## Prompt variant 2 (self-consistency)

Same content, different framing: "You are a program officer at the issuing institute deciding whether to encourage this investigator to apply." Same schema. Store both verdicts.

## Scout variant (near-miss set only)

Run Call A + B with an additional field in B: `"latent_fit": { "found": boolean, "shape": "methodological_transfer" | "asset_ownership" | "trajectory" | "mechanistic_adjacency" | "team_shape" | "constraint_in_prose" | null, "explanation": string, "evidence_ids": [...] }`. A `found: true` result with ≥ 2 cited ids surfaces the pair as Exploratory with the explanation as its rationale, and creates an "AI-flagged lead" review item.

## Fixtures

The nine §13 pairs, rendered as evidence + notice text (write them under `src/lib/fit/__fixtures__/blind-pass/`). Expected verdicts: 1 poor · 2 poor · 3 exploratory · 4 moderate · 5 strong · 6a strong · 6b exploratory-or-poor · 7a poor · 7b moderate. A prompt change that moves any of these by two tiers is rejected.
