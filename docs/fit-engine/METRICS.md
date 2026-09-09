# Fit engine — metrics

Generated 2026-09-08T05:37:02.502Z by `scripts/fit-metrics.ts` over the gold set v1 (seed 1) — 228 pairs (20 synthetic); taxonomy `fit-v1`, engine `engine-1`; both engines re-run at generation time (fit-v1 through `scorePair` with the service's context, legacy through the investigator page's rule over stored vectors — the top 20 by cosine of every open embedded notice, the first 5 over the floor shown — no model or embedding call, no write). Spec §14 defines the metrics and targets; plan § PR 2.4 makes the wrong-type rate the primary one.

Labels: 0 of 228 pairs carry an adjudicated tier (0 agreed, 0 adjudicated, 0 awaiting adjudication, 0 with one label, 228 unlabeled). Scored: fit-v1 228, legacy 206 (a pair without a document vector on a side is legacy "dropped"; a synthetic pair has none).

Strata: Legacy engine Strong / Potential (page-shown or Outreach snapshot) 80 · Adversarial (off-diagonal family cell) 60 · Random above the exploratory floor 40 · Dropped by both engines (thin evidence) 20 · fit-v1 Strong / Moderate (supplementary) 28.

Synthetic pairs (20: fixture investigators of the families the roster lacks, against real notices) are scored by fit-v1 only; they are excluded from every legacy number, from precision@k, from the Strong ratio and from the distribution baseline, and counted in the confusion matrices and both wrong-type readings.

> Legacy tiers follow the investigator page's rule over stored vectors (goldset/legacy.ts): the top 20 of 1302 open embedded notices by cosine, the first 5 over the floor shown; a pair behind them is "not shown" and counts as Poor. The Outreach snapshots recorded at export are in the manifest's `at_export`.

## Pre-label baseline — tier distribution over the set

| engine | Strong | Moderate | Exploratory | Poor | unscored |
|---|---|---|---|---|---|
| fit-v1 | 1 | 26 | 41 | 140 | 0 |
| legacy (mapped: potential → Moderate, not_shown / dropped → Poor) | 48 | 33 | 0 | 127 | 0 |
| synthetic pairs, fit-v1 only (outside the baseline) | 0 | 0 | 14 | 6 | 0 |

Legacy raw: strong 48 · potential 33 · exploratory 0 · not shown 23 (in the top 20, behind the five the page shows) · dropped 104 (outside the top 20, under the floor, or no vector).

fit-v1 (rows) × legacy (columns):

| fit-v1 ↓ · legacy → | Strong | Moderate | Exploratory | Poor |
|---|---|---|---|---|
| Strong | 0 | 0 | 0 | 1 |
| Moderate | 2 | 0 | 0 | 24 |
| Exploratory | 19 | 8 | 0 | 14 |
| Poor | 27 | 25 | 0 | 88 |
| unscored | 0 | 0 | 0 | 0 |

## Strong-list length (the 30 % rule)

Spec §14 "Rollout comparison": promote when fit-v1's Strong list is not more than 30 % shorter than legacy's (ratio ≥ 0.70). The primary reading is over the whole grid — the manifest's tallies of stored `fit_results` Strong against the legacy pairs the investigator page shows at Strong — because the set over-samples what the legacy engine shows; the set's own ratio is for information.

|  | fit-v1 | legacy | ratio | rule (≥ 0.70) |
|---|---|---|---|---|
| Strong — grid (62,784 fit_results rows vs 141 investigators × top 5) | 0 | 315 | 0.00 | fails — spec §14: the floors are too tight; §12's recalibration runs first (fit the §10 floors and the §4 matrices to the label set until ≥ 85 % of Strong and ≥ 70 % of Moderate labels agree — Phase 4 `scripts/fit-recalibrate.ts`, a proposed taxonomy.json diff for review, never auto-applied) before the flag is flipped |
| Strong + Moderate / Potential — grid | 28 | 694 | 0.04 | for information |
| Strong — the set | 1 | 48 | 0.02 | for information |
| Strong + Moderate / Potential — the set | 27 | 81 | 0.33 | for information |

Scope of the grid row: 436 of the 700 page-shown legacy pairs (62.3 %) are on notices outside the 436-notice profiled corpus — non-NIH notices, or NIH notices without Guide sections — which fit-v1 never scores. That corpus is the pilot's scope (D1; the Guide-synced set of PR 0.5), so a fit-v1 user's list is shorter by those pairs before any floor applies; the grid row counts them on the legacy side only.

## Wrong-type rate (primary)

Structural reading — no label needed: population / health-systems / Clinical-Trial-Required notices shown at Strong or Moderate to discovery or preclinical investigators, as a share of every pair shown at those tiers. Target ≤ 5.0 %.

| engine | shown (Strong + Moderate) | wrong type | rate |
|---|---|---|---|
| fit-v1 | 27 | 0 | 0.0 % |
| legacy | 81 | 6 | 7.4 % |

Labeled reading (spec §14): shown pairs whose adjudicated reason is "wrong type of research" (`wrong_research_type`).

_No gold labels yet — this section fills in once labels are imported (`npm run fit:goldset-import`) or saved on `/admin/fit-labels`._

## Tier precision

_No gold labels yet — this section fills in once labels are imported (`npm run fit:goldset-import`) or saved on `/admin/fit-labels`._

**Per stratum** — per engine tier: agreeing / labeled pairs with the rate (Strong: labeled Strong or Moderate; Moderate: Moderate or better; Exploratory: Exploratory or better; Poor: Poor) once the tier has labels, the engine's pair count until then.

| stratum | pairs | engine | Strong (agree / labeled, or pairs) | Moderate (agree / labeled, or pairs) | Exploratory (agree / labeled, or pairs) | Poor (agree / labeled, or pairs) |
|---|---|---|---|---|---|---|
| Legacy engine Strong / Potential (page-shown or Outreach snapshot) | 80 | fit-v1 | 0 | 0 | 29 | 51 |
| Legacy engine Strong / Potential (page-shown or Outreach snapshot) | 80 | legacy | 38 | 30 | 0 | 12 |
| Adversarial (off-diagonal family cell) | 60 | fit-v1 | 0 | 0 | 23 | 37 |
| Adversarial (off-diagonal family cell) | 60 | legacy | 8 | 3 | 0 | 29 |
| Random above the exploratory floor | 40 | fit-v1 | 0 | 0 | 2 | 38 |
| Random above the exploratory floor | 40 | legacy | 0 | 0 | 0 | 40 |
| Dropped by both engines (thin evidence) | 20 | fit-v1 | 0 | 0 | 0 | 20 |
| Dropped by both engines (thin evidence) | 20 | legacy | 0 | 0 | 0 | 20 |
| fit-v1 Strong / Moderate (supplementary) | 28 | fit-v1 | 1 | 26 | 1 | 0 |
| fit-v1 Strong / Moderate (supplementary) | 28 | legacy | 2 | 0 | 0 | 26 |

**Per draw source** (`at_export.source`: the bucket the pair came from; `cell` = the adversarial cells, `synthetic` = the fixture investigators).

| source | pairs | engine | Strong (agree / labeled, or pairs) | Moderate (agree / labeled, or pairs) | Exploratory (agree / labeled, or pairs) | Poor (agree / labeled, or pairs) |
|---|---|---|---|---|---|---|
| outreach:strong | 3 | fit-v1 | 0 | 0 | 3 | 0 |
| outreach:strong | 3 | legacy | 1 | 0 | 0 | 2 |
| legacy:strong | 37 | fit-v1 | 0 | 0 | 14 | 23 |
| legacy:strong | 37 | legacy | 37 | 0 | 0 | 0 |
| outreach:potential | 8 | fit-v1 | 0 | 0 | 5 | 3 |
| outreach:potential | 8 | legacy | 0 | 0 | 0 | 8 |
| legacy:potential | 32 | fit-v1 | 0 | 0 | 7 | 25 |
| legacy:potential | 32 | legacy | 0 | 30 | 0 | 2 |
| cell | 40 | fit-v1 | 0 | 0 | 9 | 31 |
| cell | 40 | legacy | 8 | 3 | 0 | 29 |
| synthetic | 20 | fit-v1 | 0 | 0 | 14 | 6 |
| synthetic | 20 | legacy | 0 | 0 | 0 | 0 |
| random | 40 | fit-v1 | 0 | 0 | 2 | 38 |
| random | 40 | legacy | 0 | 0 | 0 | 40 |
| thin | 20 | fit-v1 | 0 | 0 | 0 | 20 |
| thin | 20 | legacy | 0 | 0 | 0 | 20 |
| fit_v1:moderate | 28 | fit-v1 | 1 | 26 | 1 | 0 |
| fit_v1:moderate | 28 | legacy | 2 | 0 | 0 | 26 |

## Precision@k

Per investigator (the investigator page's list): k = min(5, the investigator's labeled pairs the engine surfaces at Exploratory or better), ranked by the engine's score; a hit is a label of Strong or Moderate. Per notice (the Outreach reading): the same with k = min(10, …), grouped by `opportunity_id`. Synthetic pairs excluded.

_No gold labels yet — this section fills in once labels are imported (`npm run fit:goldset-import`) or saved on `/admin/fit-labels`._

## Family confusion matrix

Investigator dominant family (the view the engine scores) × notice required family, over the pairs each engine shows at Strong or Moderate. \* marks a forbidden cell (discovery->health_systems, discovery->population, health_systems->discovery, health_systems->preclinical, population->discovery, population->preclinical, preclinical->health_systems, preclinical->population); their mass should be zero.

**fit-v1** — 27 shown, forbidden-cell mass 0

| investigator ↓ · notice → | Discovery | Preclinical | Translational human biology | Clinical | Population | Health systems | Cross-cutting | none |
|---|---|---|---|---|---|---|---|---|
| Discovery | 6 | 1 | 0 | 0 | 0 \* | 0 \* | 3 | 8 |
| Preclinical | 2 | 0 | 0 | 0 | 0 \* | 0 \* | 0 | 1 |
| Translational human biology | 1 | 0 | 0 | 0 | 0 | 0 | 2 | 2 |
| Clinical | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| Population | 0 \* | 0 \* | 0 | 0 | 0 | 0 | 0 | 0 |
| Health systems | 0 \* | 0 \* | 0 | 0 | 0 | 0 | 0 | 0 |
| Cross-cutting | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| none | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

**legacy** — 81 shown, forbidden-cell mass 3

| investigator ↓ · notice → | Discovery | Preclinical | Translational human biology | Clinical | Population | Health systems | Cross-cutting | none |
|---|---|---|---|---|---|---|---|---|
| Discovery | 29 | 0 | 4 | 0 | 3 \* | 0 \* | 2 | 5 |
| Preclinical | 3 | 0 | 2 | 0 | 0 \* | 0 \* | 0 | 3 |
| Translational human biology | 10 | 0 | 2 | 0 | 1 | 0 | 1 | 5 |
| Clinical | 3 | 0 | 2 | 1 | 1 | 0 | 1 | 3 |
| Population | 0 \* | 0 \* | 0 | 0 | 0 | 0 | 0 | 0 |
| Health systems | 0 \* | 0 \* | 0 | 0 | 0 | 0 | 0 | 0 |
| Cross-cutting | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| none | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

**Set composition** — every pair, 228 pairs, 18 in forbidden cells

| investigator ↓ · notice → | Discovery | Preclinical | Translational human biology | Clinical | Population | Health systems | Cross-cutting | none |
|---|---|---|---|---|---|---|---|---|
| Discovery | 51 | 4 | 8 | 7 | 4 \* | 2 \* | 6 | 20 |
| Preclinical | 6 | 1 | 4 | 3 | 2 \* | 2 \* | 1 | 6 |
| Translational human biology | 17 | 3 | 11 | 3 | 2 | 2 | 3 | 17 |
| Clinical | 4 | 2 | 3 | 3 | 2 | 2 | 1 | 4 |
| Population | 2 \* | 2 \* | 2 | 2 | 0 | 2 | 0 | 0 |
| Health systems | 2 \* | 2 \* | 2 | 2 | 2 | 0 | 0 | 0 |
| Cross-cutting | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| none | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 |

## Recall check

Spec §14: share of labeled-Strong pairs the engine places in Strong or Moderate (target ≥ 75.0 %); the remainder should be Exploratory, not Poor.

_No gold labels yet — this section fills in once labels are imported (`npm run fit:goldset-import`) or saved on `/admin/fit-labels`._

The dropped stratum (pairs both engines dropped at export time, from the thinnest profiles — the highest cosine under the floor, deterministic): how many each engine surfaces at Exploratory or better when re-run, and what the labels say.

| engine | pairs | surfaced (≥ Exploratory) | Strong / Moderate | labeled | labeled Strong / Moderate |
|---|---|---|---|---|---|
| fit-v1 | 20 | 0 | 0 | 0 | 0 |
| legacy | 20 | 0 | 0 | 0 | 0 |

## Reading the checkpoint

Promote (flip `teams.fit_engine` for the pilot team) when fit-v1 beats legacy on tier precision and on the wrong-type rate and its Strong list is not more than 30 % shorter on the grid reading above; if the list is shorter than that, the floors are too tight and §12's recalibration runs first — never a threshold edit in engine code.
