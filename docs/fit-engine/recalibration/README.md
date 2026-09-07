# Recalibration proposals

`npm run fit:recalibrate` (plan Phase 4; spec §12 "Periodically, globally") fits the §10 tier floors and the §4 family / level matrices to the adjudicated `fit_labels`, and writes what it found here:

| File | What it is |
|---|---|
| `<date>-proposal.md` | The run: the parameter set and its ranges, what the search moved, METRICS before and after, agreement per tier, labels per stratum, the objective trace, and the diff |
| `<date>-taxonomy.patch` | A unified diff over `src/lib/fit/taxonomy.json` — a textual substitution of the numbers named in the proposal, nothing else |

**Nothing here is applied automatically.** A change to a matrix or a floor is a spec change (CLAUDE.md), so a person reads the proposal, applies the patch by hand (`git apply docs/fit-engine/recalibration/<date>-taxonomy.patch`), re-runs `npm test` — the §13 adversarial fixtures are the regression suite for exactly this change — and `npm run fit:metrics`, and records the decision in `../DECISIONS.md`. The script itself never writes `taxonomy.json`, makes no model call and writes nothing to the database.

Spec §12 asks for a recalibration every quarter, or whenever ≥ 50 new tier labels accumulate; `--min-labels` (default 50) enforces that, and a run below it reports the before-METRICS and fits nothing.

## `fixture-labels.csv`

A **constructed** label set — not strategist judgment — used to exercise the search and the patch while D4 is open and `fit_labels` is empty:

- the nine §13 adversarial cases (`fixture:<case id>`, scored from `src/lib/fit/__fixtures__/adversarial-cases.json`), labeled with the tier the fixture expects, so the regression suite constrains the fit;
- the 28 `fit_v1` supplementary pairs labeled Moderate (the strategist agrees with the new engine's own list);
- the first 40 `current`-stratum pairs labeled as the legacy engine tiered them (page-shown tier, else the Outreach snapshot) — deliberately adversarial, since the whole point of the redesign is that legacy's list is partly wrong.

    npm run fit:recalibrate -- --labels-csv docs/fit-engine/recalibration/fixture-labels.csv --date fixture --out-dir /tmp/recalibration-fixture

Every row's `notes` column says it is a fixture, and a run whose labels come from a CSV with no `fit_labels` rows behind them is marked **FIXTURE RUN — not a calibration** at the top of its proposal. Do not apply a patch from such a run.
