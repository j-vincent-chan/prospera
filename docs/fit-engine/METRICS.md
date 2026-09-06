# Fit engine — metrics

Generated 2026-09-06T19:47:42.890Z by `scripts/fit-metrics.ts` over the gold set v1 (seed 1) — 200 pairs; taxonomy `fit-v1`, engine `engine-1`; both engines re-run at generation time (fit-v1 through `scorePair` with the service's context, legacy through the investigator page's cosine rule over stored vectors — no model or embedding call, no write). Spec §14 defines the metrics and targets; plan § PR 2.4 makes the wrong-type rate the primary one.

Labels: 0 of 200 pairs carry an adjudicated tier (0 agreed, 0 adjudicated, 0 awaiting adjudication, 0 with one label, 200 unlabeled). Scored: fit-v1 200, legacy 197 (a pair without a document vector on a side is legacy "dropped").

Strata: Current engines Strong / Potential 80 · Adversarial (off-diagonal family cell) 60 · Random above the exploratory floor 40 · Dropped by both engines (thin evidence) 20.

> Legacy tiers follow the investigator page's cosine rule over stored vectors (goldset/legacy.ts); the Outreach snapshots recorded at export are in the manifest's `at_export`.

## Pre-label baseline — tier distribution over the set

| engine | Strong | Moderate | Exploratory | Poor | unscored |
|---|---|---|---|---|---|
| fit-v1 | 0 | 28 | 34 | 138 | 0 |
| legacy (mapped: potential → Moderate, dropped → Poor) | 73 | 73 | 17 | 37 | 0 |

Legacy raw: strong 73 · potential 73 · exploratory 17 · dropped 37.

fit-v1 (rows) × legacy (columns):

| fit-v1 ↓ · legacy → | Strong | Moderate | Exploratory | Poor |
|---|---|---|---|---|
| Strong | 0 | 0 | 0 | 0 |
| Moderate | 4 | 9 | 1 | 14 |
| Exploratory | 18 | 16 | 0 | 0 |
| Poor | 51 | 48 | 16 | 23 |
| unscored | 0 | 0 | 0 | 0 |

## Strong-list length (the 30 % rule)

|  | fit-v1 | legacy | ratio | rule (≥ 0.70) |
|---|---|---|---|---|
| Strong | 0 | 73 | 0.00 | fails — the floors may be too tight (§12 recalibration) |
| Strong + Moderate / Potential | 28 | 146 | 0.19 | for information |

## Wrong-type rate (primary)

Structural reading — no label needed: population / health-systems / Clinical-Trial-Required notices shown at Strong or Moderate to discovery or preclinical investigators, as a share of every pair shown at those tiers. Target ≤ 5.0 %.

| engine | shown (Strong + Moderate) | wrong type | rate |
|---|---|---|---|
| fit-v1 | 28 | 0 | 0.0 % |
| legacy | 146 | 28 | 19.2 % |

Labeled reading (spec §14): shown pairs whose adjudicated reason is "wrong type of research".

_No gold labels yet — this section fills in once labels are imported (`npm run fit:goldset-import`) or saved on `/admin/fit-labels`._

## Tier precision

_No gold labels yet — this section fills in once labels are imported (`npm run fit:goldset-import`) or saved on `/admin/fit-labels`._

## Precision@5 per investigator

_No gold labels yet — this section fills in once labels are imported (`npm run fit:goldset-import`) or saved on `/admin/fit-labels`._

## Family confusion matrix

Investigator dominant family (the view the engine scores) × notice required family, over the pairs each engine shows at Strong or Moderate. \* marks a forbidden cell (discovery->health_systems, discovery->population, health_systems->discovery, health_systems->preclinical, population->discovery, population->preclinical, preclinical->health_systems, preclinical->population); their mass should be zero.

**fit-v1** — 28 shown, forbidden-cell mass 0

| investigator ↓ · notice → | Discovery | Preclinical | Translational human biology | Clinical | Population | Health systems | Cross-cutting | none |
|---|---|---|---|---|---|---|---|---|
| Discovery | 6 | 1 | 0 | 0 | 0 \* | 0 \* | 3 | 9 |
| Preclinical | 2 | 0 | 0 | 0 | 0 \* | 0 \* | 0 | 1 |
| Translational human biology | 1 | 0 | 0 | 0 | 0 | 0 | 2 | 2 |
| Clinical | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| Population | 0 \* | 0 \* | 0 | 0 | 0 | 0 | 0 | 0 |
| Health systems | 0 \* | 0 \* | 0 | 0 | 0 | 0 | 0 | 0 |
| Cross-cutting | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| none | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

**legacy** — 146 shown, forbidden-cell mass 18

| investigator ↓ · notice → | Discovery | Preclinical | Translational human biology | Clinical | Population | Health systems | Cross-cutting | none |
|---|---|---|---|---|---|---|---|---|
| Discovery | 18 | 4 | 13 | 6 | 7 \* | 5 \* | 3 | 16 |
| Preclinical | 9 | 0 | 5 | 5 | 3 \* | 3 \* | 0 | 3 |
| Translational human biology | 12 | 3 | 1 | 5 | 3 | 2 | 2 | 3 |
| Clinical | 4 | 1 | 3 | 1 | 3 | 1 | 0 | 2 |
| Population | 0 \* | 0 \* | 0 | 0 | 0 | 0 | 0 | 0 |
| Health systems | 0 \* | 0 \* | 0 | 0 | 0 | 0 | 0 | 0 |
| Cross-cutting | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| none | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

**Set composition** — every pair, 200 pairs, 18 in forbidden cells

| investigator ↓ · notice → | Discovery | Preclinical | Translational human biology | Clinical | Population | Health systems | Cross-cutting | none |
|---|---|---|---|---|---|---|---|---|
| Discovery | 34 | 4 | 14 | 8 | 7 \* | 5 \* | 4 | 26 |
| Preclinical | 9 | 1 | 5 | 6 | 3 \* | 3 \* | 0 | 3 |
| Translational human biology | 13 | 3 | 8 | 6 | 3 | 3 | 3 | 6 |
| Clinical | 5 | 3 | 4 | 1 | 3 | 3 | 0 | 2 |
| Population | 0 \* | 0 \* | 0 | 0 | 0 | 0 | 0 | 0 |
| Health systems | 0 \* | 0 \* | 0 | 0 | 0 | 0 | 0 | 0 |
| Cross-cutting | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| none | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 |

## Recall check

Spec §14: share of labeled-Strong pairs the engine places in Strong or Moderate (target ≥ 75.0 %); the remainder should be Exploratory, not Poor.

_No gold labels yet — this section fills in once labels are imported (`npm run fit:goldset-import`) or saved on `/admin/fit-labels`._

The dropped stratum (pairs both engines dropped at export time, from the thinnest profiles): how many each engine surfaces at Exploratory or better when re-run, and what the labels say.

| engine | pairs | surfaced (≥ Exploratory) | Strong / Moderate | labeled | labeled Strong / Moderate |
|---|---|---|---|---|---|
| fit-v1 | 20 | 0 | 0 | 0 | 0 |
| legacy | 20 | 0 | 0 | 0 | 0 |

## Reading the checkpoint

Promote (flip `teams.fit_engine` for the pilot team) when fit-v1 beats legacy on tier precision and on the wrong-type rate and its Strong list is not more than 30 % shorter; if the list is shorter than that, the floors are too tight and §12's recalibration runs first.
