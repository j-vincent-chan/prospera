# Fit engine — open decisions

Claude Code: when a PR depends on an item marked **OPEN**, stop and ask rather than assume. Record the answer here (date, who) before proceeding.

| # | Decision | Status | Default if unanswered | Needed by |
|---|---|---|---|---|
| D2 | Models: `FIT_MODEL_CLASSIFY` / `FIT_MODEL_EXTRACT` / `FIT_MODEL_JUDGE` (names, vendor already in use: OpenAI-compatible) | **OPEN** | classify = the small model already used in `profile.ts`; extract and judge = the strongest approved model | PR 1.3, 1.5, 3.1 |
| D3 | Data governance: confirm investigator evidence + full FOA text may be sent to the configured model endpoint (today: abstracts already go to OpenAI via embeddings and `profile.ts`) | **OPEN** | Proceed as today; no new vendors | PR 1.3 |
| D4 | Who labels the gold set (two strategists + adjudicator) and by when | **OPEN** | — (blocks Phase 2 exit) | PR 2.4 |
| D5 | Self-declared paradigm question wording for onboarding (see IMPLEMENTATION_PLAN PR 0.7) | **OPEN** | Use the seven-family rating grid proposed in PR 0.7 | PR 0.7 |
| D6 | Whether strategist confirmation is required before *investigator* profile-weight corrections persist (spec §16 rule 3) | **OPEN** | Required for the pilot; revisit after 100 corrections | PR 3.1 |
| D7 | Investigator-facing surfaces: should PIs ever see Exploratory items, or strategists only? | **OPEN** | Strategists only during pilot; PIs see Strong + Moderate | PR 3.2 |
| D8 | Retire `lib/quick-match` immediately in PR 2.3 or keep behind flag one more release | **OPEN** | Retire in PR 2.3 (nothing else depends on it) | PR 2.3 |
| D9 | RCDC research-type category names to map (verify against current NIH RCDC list: "Clinical Research", "Clinical Trials", "Health Services", "Comparative Effectiveness Research", "Prevention", "Behavioral and Social Science", "Basic Behavioral and Social Science"; confirm "Epidemiology and Longitudinal Studies", "Dissemination and Implementation Research", "Translational Research") | **OPEN** | Map the seven confirmed names; log unmapped values seen in data | PR 0.4 |

## Decided

| # | Decision | Decided | Note |
|---|---|---|---|
| D1 | Pilot scope: **ImmunoX** | 2026-09-04, Vincent Chan | Settled by `INVENTORY.md`: all non-archived investigators are ImmunoX; other communities have zero members. Re-open when a population- or clinical-heavy roster exists. |
| D10 | MeSH descriptor source | 2026-09-04, Vincent Chan | Default taken: download the NLM MeSH descriptor XML once via script (PR 0.2) into `mesh_descriptors`; refresh yearly. |
| D11 | PubMed identity: ORCID and RePORTER linkage | 2026-09-04, Vincent Chan | ORCID- and RePORTER-linked publications are verified without affiliation matching and are additive to name-based results; RePORTER links require the investigator's last name on the author list. Name rungs (override → strict → initials) still stop at the first match. Per row: orcid > affiliation > reporter_link. RePORTER profile ids are guarded: the PI RePORTER returns must have the roster surname (equal, or containing it as a whole word — "Prakash Budde" matches "Prakash"; "Leech" does not match "Lee") and a matching first name or initial, else nothing is stored and the source row records "profile id <id> resolves to <name>". |
| — | Scoring is a gated-multiplicative core × additive relevance; tiers by conjunctive floors | spec §8, §10 | Values live in `src/lib/fit/taxonomy.json` |
| — | The model never emits a score; it proposes corrections to inputs | spec §16 | — |
| — | Feature flag per team: `teams.fit_engine in ('legacy','fit-v1')` | plan | — |
| — | One engine serves all three surfaces (investigator page, Outreach recipients, opportunity "Best fit") | spec §7, §15 | — |
