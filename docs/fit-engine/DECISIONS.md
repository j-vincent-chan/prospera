# Fit engine — open decisions

Claude Code: when a PR depends on an item marked **OPEN**, stop and ask rather than assume. Record the answer here (date, who) before proceeding.

| # | Decision | Status | Default if unanswered | Needed by |
|---|---|---|---|---|
| D1 | Pilot scope: ImmunoX only, or ImmunoX + IGHS (population/implementation paradigms) | **OPEN** | ImmunoX only for Phase 0–1; add IGHS before Phase 2 gold-set labeling | PR 2.4 |
| D2 | Models: `FIT_MODEL_CLASSIFY` / `FIT_MODEL_EXTRACT` / `FIT_MODEL_JUDGE` (names, vendor already in use: OpenAI-compatible) | **OPEN** | classify = the small model already used in `profile.ts`; extract and judge = the strongest approved model | PR 1.3, 1.5, 3.1 |
| D3 | Data governance: confirm investigator evidence + full FOA text may be sent to the configured model endpoint (today: abstracts already go to OpenAI via embeddings and `profile.ts`) | **OPEN** | Proceed as today; no new vendors | PR 1.3 |
| D4 | Who labels the gold set (two strategists + adjudicator) and by when | **OPEN** | — (blocks Phase 2 exit) | PR 2.4 |
| D5 | Self-declared paradigm question wording for onboarding (see IMPLEMENTATION_PLAN PR 0.7) | **OPEN** | Use the seven-family rating grid proposed in PR 0.7 | PR 0.7 |
| D6 | Whether strategist confirmation is required before *investigator* profile-weight corrections persist (spec §16 rule 3) | **OPEN** | Required for the pilot; revisit after 100 corrections | PR 3.1 |
| D7 | Investigator-facing surfaces: should PIs ever see Exploratory items, or strategists only? | **OPEN** | Strategists only during pilot; PIs see Strong + Moderate | PR 3.2 |
| D8 | Retire `lib/quick-match` immediately in PR 2.3 or keep behind flag one more release | **OPEN** | Retire in PR 2.3 (nothing else depends on it) | PR 2.3 |
| D9 | RCDC research-type category names to map (verify against current NIH RCDC list: "Clinical Research", "Clinical Trials", "Health Services", "Comparative Effectiveness Research", "Prevention", "Behavioral and Social Science", "Basic Behavioral and Social Science"; confirm "Epidemiology and Longitudinal Studies", "Dissemination and Implementation Research", "Translational Research") | **OPEN** | Map the seven confirmed names; log unmapped values seen in data | PR 0.4 |
| D10 | MeSH descriptor source: annual `desc{year}.xml` download committed as a generated table, or fetched at build time | **OPEN** | Download once in PR 0.2 into `mesh_descriptors` via script; refresh yearly | PR 0.2 |

## Decided

| # | Decision | Decided | Note |
|---|---|---|---|
| — | Scoring is a gated-multiplicative core × additive relevance; tiers by conjunctive floors | spec §8, §10 | Values live in `src/lib/fit/taxonomy.json` |
| — | The model never emits a score; it proposes corrections to inputs | spec §16 | — |
| — | Feature flag per team: `teams.fit_engine in ('legacy','fit-v1')` | plan | — |
| — | One engine serves all three surfaces (investigator page, Outreach recipients, opportunity "Best fit") | spec §7, §15 | — |
