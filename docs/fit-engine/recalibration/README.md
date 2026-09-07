# Recalibration proposals

`npm run fit:recalibrate` (plan Phase 4; spec §12 "Periodically, globally") fits the §10 tier floors and the §4 family / level matrices to the adjudicated `fit_labels`, and writes what it found here:

| File | What it is |
|---|---|
| `<date>-proposal.md` | The run: the parameter set and its ranges, what the search moved, METRICS before and after, agreement per tier, labels per stratum, the objective trace, and the diff |
| `<date>-taxonomy.patch` | A unified diff over `src/lib/fit/taxonomy.json` — a textual substitution of the numbers named in the proposal, nothing else |

**Nothing here is applied automatically.** A change to a matrix or a floor is a spec change (CLAUDE.md), so a person reads the proposal, applies the patch by hand (`git apply docs/fit-engine/recalibration/<date>-taxonomy.patch`), re-runs `npm test` — the §13 adversarial fixtures are the regression suite for exactly this change — and `npm run fit:metrics`, and records the decision in `../DECISIONS.md`. The script itself never writes `taxonomy.json`, makes no model call and writes nothing to the database.

Spec §12 asks for a recalibration every quarter, or whenever ≥ 50 new tier labels accumulate; `--min-labels` (default 50) enforces that, and a run below it reports the before-METRICS and fits nothing. The nine §13 adversarial cases are in **every** fit at their expected tiers — they are spec, not labels — so they constrain the search whether or not a label file names them, and they do not count towards `--min-labels`.

## Reading a proposal — the reviewer's checklist

The search optimizes an objective. The objective is not the decision; you are. Work down this list before you type `git apply`, and stop at the first line that fails.

1. **Stop on the fixture banner.** A proposal headed **FIXTURE RUN — not a calibration** was fitted to constructed labels. Nothing in it may be applied, whatever the numbers say. Read it to exercise the machinery, then close it.
2. **Read the after-column for the 0.85 / 0.70 targets, not the objective.** §14's question is whether tier precision reaches 85 % on Strong and 70 % on Moderate — go to "METRICS before and after", read those two rows, and let the objective number wait. An objective that rose while the targets did not is a proposal that bought something else.
3. **Decompose the objective table, and reject a gain that is mostly penalty relief.** The Δ column separates `net` from each penalty. A gain that comes from a penalty falling is a constraint being relaxed, not agreement being won; only movement in `net` is agreement with the strategist.
4. **The set ratio is secondary — re-run `fit:metrics` and read the grid.** The Strong-list row over the label set is information: the set over-samples what legacy shows. The primary reading is over the whole grid, and it does not move inside a proposal — apply the patch on a branch, run `npm run fit:metrics`, and read the grid row there before you believe anything about the 30 % rule.
5. **Check the unpriced rows: wrong-type ≤ 5 % and recall ≥ 75 %.** Neither is in the objective, so the search will happily spend them. They are in the METRICS table with their targets beside them; a proposal that pushes either through its target is rejected however good the agreement looks.
6. **Reject any moved forbidden-cell parameter without a paradigm-level reason.** Parameters marked ·  forbidden cell in the parameter table are §14's four cells. The constraint only holds them under the gate — and the gate is itself fitted — so a forbidden cell that moved at all is a stop sign: it wants a paradigm argument from a person, not a label count.
7. **Watch `poor_below` down and `tiers.exploratory.P` up together.** That pair widens the band between the paradigm gate and the Exploratory floor, which surfaces pairs the gate used to cut. It can be right. It is never incidental, and it is not what "recalibrating a floor" sounds like.
8. **Watch tiers collapsing to equal floors.** If Strong, Moderate and Exploratory end up at or near the same number on a key, the tier has stopped meaning anything on that axis — the ordering constraint permits it, and it is a modelling failure, not a fit.
9. **Run `npm test` before deciding, not only after.** Apply the patch on a branch and run the suite while you are still reading. The §13 table in the proposal says the same thing earlier, but the suite is the arbiter, and finding out afterwards is finding out too late.
10. **Confirm "converged", not the evaluation cap** — a run stopped by `--max-evaluations` is a partial search and its optimum means little. And distrust a long one-directional chain of floor drops in the trace: a dozen steps all loosening in the same direction is the search finding the edge of its ranges, not a calibration.
11. **`git apply --check`, then read the diff itself.** Confirm it touches only `src/lib/fit/taxonomy.json`, that the line count is unchanged, and that every number in it appears in the proposal's change table — with **both** mirror cells present for each symmetric matrix parameter.
12. **Record the decision in `../DECISIONS.md`** — applied or rejected, with the reason. A rejected proposal is as much a decision as an applied one, and the next recalibration needs to know.

## `fixture-labels.csv`

A **constructed** label set — not strategist judgment — used to exercise the search and the patch while D4 is open and `fit_labels` is empty:

- the nine §13 adversarial cases (`fixture:<case id>`, scored from `src/lib/fit/__fixtures__/adversarial-cases.json`) — these are now folded into every run from the fixture file itself, so the CSV rows are redundant and kept only so the file reads as a whole label set; where a row disagrees with the fixture's expected tier, the fixture wins and the proposal says so;
- the 28 `fit_v1` supplementary pairs labeled Moderate (the strategist agrees with the new engine's own list);
- the first 40 `current`-stratum pairs labeled as the legacy engine tiered them (page-shown tier, else the Outreach snapshot) — deliberately adversarial, since the whole point of the redesign is that legacy's list is partly wrong.

    npm run fit:recalibrate -- --labels-csv docs/fit-engine/recalibration/fixture-labels.csv --date fixture --out-dir /tmp/recalibration-fixture

Every row's `notes` column says it is a fixture, and a run whose labels come from a CSV with no `fit_labels` rows behind them is marked **FIXTURE RUN — not a calibration** at the top of its proposal. Do not apply a patch from such a run.
