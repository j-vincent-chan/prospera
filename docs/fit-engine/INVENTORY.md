# Fit engine · data inventory (PR 0.1)

Generated 2026-09-04T18:42:14.845Z by `npm run fit:inventory` from `docs/fit-engine/queries/inventory.sql`. Read-only. "Open" notices = close_date, next_due or expiration_date on/after 2026-09-04.

## 1. Directory and identity coverage

| Metric | Value |
|---|---|
| investigators (not archived) | 144 |
| with_nih_profile_id | 112 |
| with_orcid | 103 |
| with_profiles_url | 125 |
| in_a_community | 144 |

## 2. Evidence per investigator (verified publications, grants, trials)

| Metric | Value |
|---|---|
| investigators | 144 |
| median_pubs_verified | 76 |
| no_verified_pubs | 7 |
| pubs_10_plus | 132 |
| with_any_grant | 112 |
| with_active_grant | 112 |
| with_any_trial | 5 |
| (rows scanned) publications / grants (not rejected) / trials | 15107 / 818 / 14 |

## 3. Source states (biosketch, profiles, orcid, reporter, pubmed)

| source | state | count |
|---|---|---|
| biosketch | not_requested | 144 |
| orcid | available | 103 |
| orcid | unavailable | 41 |
| profiles | available | 125 |
| profiles | error | 2 |
| profiles | unavailable | 17 |
| pubmed | available | 129 |
| pubmed | unavailable | 15 |
| reporter | available | 112 |
| reporter | unavailable | 32 |

## 4. Notice corpus: open notices, NIH share, Guide coverage, clinical-trial designation from title

| Metric | Value |
|---|---|
| open_notices | 1304 |
| nih_like | 657 |
| guide_ok | 313 |
| guide_not_found | 341 |
| guide_never_fetched | 650 |
| ct_required | 80 |
| ct_optional | 156 |
| ct_not_allowed | 202 |
| besh | 0 |
| reissues | 39 |
| with_activity_code | 307 |
| median_description_chars | 1023 |

## 5. Activity-code mix among open notices (top 30)

| activity_code | count |
|---|---|
| R01 | 82 |
| R21 | 33 |
| R61 | 17 |
| R34 | 14 |
| U01 | 14 |
| R25 | 12 |
| R03 | 11 |
| UG3 | 11 |
| R33 | 8 |
| K99 | 7 |
| K22 | 6 |
| T32 | 6 |
| R15 | 5 |
| K01 | 4 |
| R24 | 4 |
| F32 | 3 |
| K12 | 3 |
| UH3 | 3 |
| X01 | 3 |
| F30 | 2 |
| K02 | 2 |
| K08 | 2 |
| K18 | 2 |
| K23 | 2 |
| K24 | 2 |
| K25 | 2 |
| K43 | 2 |
| P41 | 2 |
| P50 | 2 |
| R16 | 2 |

## 6. Embedding coverage (what the current engine can see)

| Metric | Value |
|---|---|
| investigators_embedded | 141 |
| notices_embedded | 1314 |
| evidence_items_embedded | 7462 |
| evidence_kinds (distinct, non-empty) | 3 |

| evidence kind | count |
|---|---|
| publication | 6548 |
| grant | 789 |
| biosketch | 0 |
| profile | 125 |
| focus | 0 |
| trial | 0 |

## 7. Feedback already collected

### 7a. outreach_suggestions · dismissed, by reason

_(no rows)_

### 7b. outreach_suggestions · by status

| status | count |
|---|---|
| active | 385 |
| added | 5 |

### 7c. outreach_items · by stage

| stage | count |
|---|---|
| triage | 27 |
| parked | 1 |

### 7d. outreach_recipients (not removed) · by status

| status | count |
|---|---|
| selected | 27 |
| declined | 4 |
| replied_interested | 3 |
| contacted | 2 |

## 8. Raw-row field checks (the Phase 0 backfills depend on these)

### 8a. RePORTER · 5 most recently updated grants

| project_num | has_abstract | has_phr | has_rcdc | has_study_section | has_pis | has_terms |
|---|---|---|---|---|---|---|
| 1F32AI010120-01 | yes | yes | yes | yes | yes | yes |
| 1R01AI052116-01 | yes | yes | yes | yes | yes | yes |
| 1R21AI062899-01 | yes | yes | yes | yes | yes | yes |
| 1R21RR024895-01 | yes | yes | yes | yes | yes | yes |
| 1U01CA141451-01 | yes | yes | yes | yes | yes | yes |

### 8b. ClinicalTrials.gov · 5 most recently updated trials

| nct_id | study_type | phases | primary_purpose | observational_model | enrollment | officials |
|---|---|---|---|---|---|---|
| NCT04404075 | OBSERVATIONAL | — | — | OTHER | 11 | 1 |
| NCT03293030 | INTERVENTIONAL | PHASE4 | TREATMENT | — | 17 | 1 |
| NCT07390487 | INTERVENTIONAL | NA | SUPPORTIVE_CARE | — | 120 | 1 |
| NCT04645355 | INTERVENTIONAL | PHASE4 | TREATMENT | — | 25 | 1 |
| NCT02929745 | INTERVENTIONAL | NA | BASIC_SCIENCE | — | 16 | 1 |

## 9. Communities and teams (pilot selection; feature flag lives on teams)

| label | monitored | active | members |
|---|---|---|---|
| ImmunoX | yes | yes | 144 |
| IGHS | yes | yes | 0 |
| Diabetes Center | yes | yes | 0 |
| IHA | yes | yes | 0 |

| team id | name |
|---|---|
| f2765762-28f2-419e-aa07-6aad422ae928 | OCR Research Development |

## 10. PubMed identity coverage (PR 0.1b)

Generated 2026-09-04T22:34:23.965Z by `npm run fit:seed-pubmed-overrides -- --report`. Counts are esearch totals (retmax=0): strict = `Last First M[Author]` + UCSF; initials = `Last FM[Author]` + UCSF; unaffiliated = initials alone.

| Metric | Value |
|---|---|
| investigators counted | 144 |
| pubmed source not 'available' | 6 |
| strict / initials ratio < 0.3 (flagged for review) | 3 |
| manual override needed (zero hits on both strict and initials + UCSF) | 7 |
| median strict count | 30.5 |
| median initials + UCSF count | 34 |
| median unaffiliated initials count | 124 |
| with pubmed_query_override | 6 |
| name resolution errors | 1 |

Flagged (strict / initials < 0.3):

| investigator | pubmed state | method | items | strict | initials+UCSF | unaffiliated | strict/initials | flag |
|---|---|---|---|---|---|---|---|---|
| Art Weiss | available | manual | 140 | 1 | 74 | 3917 | 0.01 | REVIEW |
| Karl M Ansel | available | manual | 72 | 0 | 65 | 110 | 0 | REVIEW |
| James C Lee | available | affiliation | 10 | 10 | 39 | 5298 | 0.26 | REVIEW |

Manual override needed — zero UCSF-affiliated hits under either term (a strategist sets `pubmed_query_override`):

| investigator | pubmed state | method | items | strict | initials+UCSF | unaffiliated | strict/initials | flag |
|---|---|---|---|---|---|---|---|---|
| Judith F Ashouri-Sinha | available | — | 0 | 0 | 0 | 12 | — | manual override needed |
| Matija B Peterlin | unavailable | — | 0 | 0 | 0 | 3 | — | manual override needed |
| Kristen E Mengwasser | unavailable | — | 0 | 0 | 0 | 8 | — | manual override needed |
| Catera L Wilder | available | — | 0 | 0 | 0 | 14 | — | manual override needed |
| Paola A Betancur | unavailable | — | 0 | 0 | 0 | 1 | — | manual override needed |
| Chris S Hsiung | unavailable | — | 0 | 0 | 0 | 2 | — | manual override needed |
| Peng He | error | affiliation | 3 | 0 | 0 | 0 | — | name error |

## 11. PubMed capture coverage (PR 0.2)

Generated 2026-09-05T22:02:55.350Z by `npm run fit:backfill-pubmed-mesh -- --report`. Every row of `investigator_publications` by `mesh_fetch_outcome`: pending = never fetched; indexed = MeSH stored; no_mesh = returned without MeSH (in-process, retried after 30 days); not_returned = efetch did not return the PMID (retried once); not_returned_terminal = missed twice, never re-requested.

| mesh_fetch_outcome | rows |
|---|---|
| pending | 26 |
| indexed | 13367 |
| no_mesh | 2013 |
| not_returned | 12 |
| not_returned_terminal | 0 |
| (all rows) | 15418 |

Terminal PMIDs — we hold them, PubMed does not return them (bad linkage or withdrawn record; someone should look): 0

Watch — `not_returned` once (first miss; re-requested by the next run after 30 days; a second miss is terminal): 12

| pmid | investigator | identity_method | publication_date | title |
|---|---|---|---|---|
| 24395479 | Mark R Looney | profiles | 2007-10-01 | The role of protein C in sepsis. |
| 26356593 | Philip J Norris | profiles | 2015-11-01 | Serum amyloid P (SAP) is associated with impaired brachial artery flow-mediated  |
| 32004204 | Peter W Hunt | profiles | 2020-01-30 | Presence of asymptomatic CMV and EBV DNA in blood of persons with HIV starting a |
| 32619187 | Michael D Rosenblum | profiles | 2019-05-03 | Y'all comeback now. |
| 32619187 | Jarish N Cohen | profiles | 2019-05-03 | Y'all comeback now. |
| 32663256 | Sagar P Bapat | profiles | 2020-07-14 | Magnitude and kinetics of anti-SARS-CoV-2 antibody responses and their relations |
| 34037213 | Jayanta Debnath | profiles | 2021-05-26 | Atg32 dependent mitophagy sustains spermidine and nitric oxide required for heat |
| 34432039 | Jayanta Debnath | profiles | 2021-01-15 | The pleiotropic functions of autophagy in metastasis. |
| 37221399 | Ajay V Maker | profiles | 2023-08-01 | ASO Visual Abstract: National Practice Patterns in Malignant Peritoneal Mesothel |
| 37918481 | James M Gardner | profiles | 2023-11-02 | Successful cryopreservation of functional kidney allografts using vitrification  |
| 39068310 | Ajay V Maker | profiles | 2024-07-27 | ASO Visual Abstract: Long-Duration Neoadjuvant Therapy with FOLFIRINOX Yields Fa |
| 39094951 | James M Gardner | profiles | 2024-07-31 | Impact of short-term vegan versus ketogenic diets on human immunity and microbio |

### 11a. Rows with any MeSH

| rows | all | stamped (outcome ≠ pending) | with MeSH | with MeSH / all | with MeSH / stamped |
|---|---|---|---|---|---|
| every row | 15418 | 15392 | 13367 | 86.7% | 86.8% |
| verified rows | 15375 | 15375 | 13351 | 86.8% | 86.8% |

The corpus figures below are over the 15375 verified rows (142 investigators). Triangle, descriptor and check-tag figures are over the 13351 verified rows with MeSH; publication types over all verified rows; author position over the 15375 stamped verified rows. The descriptor index held 31110 descriptors.

### 11b. Triangle of biomedicine, per row

`triangleClass` over each row's MeSH UIs (A animal, C cell/molecular, H human; compound classes are translational bridges; none = no vertex touched).

| class | rows | share |
|---|---|---|
| A | 324 | 2.4% |
| C | 267 | 2.0% |
| H | 3214 | 24.1% |
| AC | 2733 | 20.5% |
| AH | 471 | 3.5% |
| CH | 3522 | 26.4% |
| ACH | 2751 | 20.6% |
| none | 69 | 0.5% |
| (rows with MeSH) | 13351 | |

H-touching rows (H, AH, CH, ACH): 9958 (74.6%) — of which 3800 (28.5%) carry an M01 persons descriptor (Adult, Child, …: a human-participant signal) and 6158 (46.1%) touch H only through the Humans tag, which PubMed also puts on human cell-line work. Unknown UIs skipped (not in `mesh_descriptors`): 0 occurrences over 0 distinct UIs.

### 11c. Triangle of biomedicine, per investigator

Each investigator's modal class over their rows with MeSH (a tie goes to the earlier class in the order above) and the share of those rows that are H-touching. 142 investigators with at least one row with MeSH.

| modal class | investigators | median rows with MeSH | median H-touching share |
|---|---|---|---|
| A | 1 | 13 | 53.8% |
| C | 2 | 54.5 | 27.7% |
| H | 33 | 116 | 93.9% |
| AC | 36 | 50 | 48.6% |
| AH | 0 | — | — |
| CH | 39 | 77 | 85.7% |
| ACH | 31 | 59 | 75.1% |
| none | 0 | — | — |

Median H-touching share across investigators: 74.4%. Investigators by H-touching share: < 10%: 0 · 10–33%: 3 · 33–67%: 47 · ≥ 67%: 92.

### 11d. 30 most common descriptors (share of rows with MeSH)

| # | descriptor | UI | rows | share |
|---|---|---|---|---|
| 1 | Humans | D006801 | 9948 | 74.5% |
| 2 | Animals | D000818 | 6091 | 45.6% |
| 3 | Mice | D051379 | 4330 | 32.4% |
| 4 | Female | D005260 | 4282 | 32.1% |
| 5 | Male | D008297 | 3690 | 27.6% |
| 6 | Adult | D000328 | 2318 | 17.4% |
| 7 | Middle Aged | D008875 | 1947 | 14.6% |
| 8 | Mice, Inbred C57BL | D008810 | 1399 | 10.5% |
| 9 | Signal Transduction | D015398 | 1310 | 9.8% |
| 10 | T-Lymphocytes | D013601 | 1064 | 8.0% |
| 11 | Aged | D000368 | 1063 | 8.0% |
| 12 | Mice, Knockout | D018345 | 988 | 7.4% |
| 13 | Lymphocyte Activation | D008213 | 810 | 6.1% |
| 14 | Cells, Cultured | D002478 | 747 | 5.6% |
| 15 | HIV Infections | D015658 | 695 | 5.2% |
| 16 | Molecular Sequence Data | D008969 | 685 | 5.1% |
| 17 | Inflammation | D007249 | 646 | 4.8% |
| 18 | Cell Differentiation | D002454 | 644 | 4.8% |
| 19 | Mice, Transgenic | D008822 | 643 | 4.8% |
| 20 | Cell Line | D002460 | 616 | 4.6% |
| 21 | B-Lymphocytes | D001402 | 614 | 4.6% |
| 22 | Child | D002648 | 604 | 4.5% |
| 23 | Adolescent | D000293 | 601 | 4.5% |
| 24 | Mutation | D009154 | 598 | 4.5% |
| 25 | Lung | D008168 | 580 | 4.3% |
| 26 | Disease Models, Animal | D004195 | 575 | 4.3% |
| 27 | Young Adult | D055815 | 563 | 4.2% |
| 28 | Cytokines | D016207 | 561 | 4.2% |
| 29 | CD4-Positive T-Lymphocytes | D015496 | 555 | 4.2% |
| 30 | Biomarkers | D015415 | 553 | 4.1% |

### 11e. 30 most common major-topic descriptors (share of rows with MeSH)

| # | descriptor | UI | rows | share |
|---|---|---|---|---|
| 1 | HIV Infections | D015658 | 648 | 4.9% |
| 2 | T-Lymphocytes | D013601 | 629 | 4.7% |
| 3 | Signal Transduction | D015398 | 433 | 3.2% |
| 4 | Asthma | D001249 | 422 | 3.2% |
| 5 | B-Lymphocytes | D001402 | 403 | 3.0% |
| 6 | Killer Cells, Natural | D007694 | 369 | 2.8% |
| 7 | Neoplasms | D009369 | 368 | 2.8% |
| 8 | COVID-19 | D000086382 | 361 | 2.7% |
| 9 | T-Lymphocytes, Regulatory | D050378 | 359 | 2.7% |
| 10 | HIV-1 | D015497 | 311 | 2.3% |
| 11 | CD4-Positive T-Lymphocytes | D015496 | 278 | 2.1% |
| 12 | Lymphocyte Activation | D008213 | 270 | 2.0% |
| 13 | Lung | D008168 | 253 | 1.9% |
| 14 | Receptors, Antigen, T-Cell | D011948 | 252 | 1.9% |
| 15 | Inflammation | D007249 | 239 | 1.8% |
| 16 | Multiple Sclerosis | D009103 | 228 | 1.7% |
| 17 | MicroRNAs | D035683 | 221 | 1.7% |
| 18 | Telomere | D016615 | 221 | 1.7% |
| 19 | Brain Neoplasms | D001932 | 217 | 1.6% |
| 20 | Graft Rejection | D006084 | 214 | 1.6% |
| 21 | CD8-Positive T-Lymphocytes | D018414 | 210 | 1.6% |
| 22 | Integrins | D016023 | 210 | 1.6% |
| 23 | Kidney Transplantation | D016030 | 208 | 1.6% |
| 24 | Macrophages | D008264 | 196 | 1.5% |
| 25 | Receptors, Immunologic | D011971 | 196 | 1.5% |
| 26 | Diabetes Mellitus, Type 1 | D003922 | 188 | 1.4% |
| 27 | Transcription Factors | D014157 | 185 | 1.4% |
| 28 | Dendritic Cells | D003713 | 180 | 1.3% |
| 29 | Immune Tolerance | D007108 | 178 | 1.3% |
| 30 | Antibodies, Monoclonal | D000911 | 177 | 1.3% |

### 11f. Check tags

Matched by descriptor name in the row's MeSH, the way PR 1.2's `check_tag*` clauses will match them.

| check tag | rows | share |
|---|---|---|
| Humans | 9948 | 74.5% |
| Animals | 6091 | 45.6% |
| Mice | 4330 | 32.4% |
| Rats | 292 | 2.2% |
| Female | 4282 | 32.1% |
| Male | 3690 | 27.6% |
| Macaca | 5 | 0.0% |
| Primates | 7 | 0.1% |
| Zebrafish | 26 | 0.2% |

Humans / Animals split: Humans only 6808 (51.0%) · Animals only 2951 (22.1%) · both 3140 (23.5%) · neither 452 (3.4%).

### 11g. Publication types

Every publication type over the 15375 verified rows (a row can carry several).

| publication type | rows | share |
|---|---|---|
| Journal Article | 14597 | 94.9% |
| Research Support, Non-U.S. Gov't | 7369 | 47.9% |
| Research Support, N.I.H., Extramural | 6341 | 41.2% |
| Research Support, U.S. Gov't, P.H.S. | 2082 | 13.5% |
| Review | 1866 | 12.1% |
| Research Support, U.S. Gov't, Non-P.H.S. | 1125 | 7.3% |
| Preprint | 744 | 4.8% |
| Comment | 509 | 3.3% |
| Comparative Study | 495 | 3.2% |
| Case Reports | 365 | 2.4% |
| Multicenter Study | 338 | 2.2% |
| Letter | 267 | 1.7% |
| Randomized Controlled Trial | 242 | 1.6% |
| Editorial | 235 | 1.5% |
| Clinical Trial | 215 | 1.4% |
| Research Support, N.I.H., Intramural | 202 | 1.3% |
| Published Erratum | 163 | 1.1% |
| Observational Study | 149 | 1.0% |
| News | 68 | 0.4% |
| Meta-Analysis | 63 | 0.4% |
| Video-Audio Media | 56 | 0.4% |
| Evaluation Study | 53 | 0.3% |
| Conference Proceedings | 48 | 0.3% |
| Clinical Trial, Phase I | 44 | 0.3% |
| Clinical Trial, Phase II | 43 | 0.3% |
| Systematic Review | 43 | 0.3% |
| Validation Study | 40 | 0.3% |
| Consensus Statement | 37 | 0.2% |
| Historical Article | 33 | 0.2% |
| Controlled Clinical Trial | 26 | 0.2% |
| Introductory Journal Article | 20 | 0.1% |
| Research Support, American Recovery and Reinvestment Act | 19 | 0.1% |
| Practice Guideline | 16 | 0.1% |
| Clinical Trial, Phase III | 15 | 0.1% |
| Interview | 11 | 0.1% |
| Guideline | 10 | 0.1% |
| Twin Study | 10 | 0.1% |
| Biography | 9 | 0.1% |
| Autobiography | 6 | 0.0% |
| Lecture | 6 | 0.0% |
| Portrait | 6 | 0.0% |
| Clinical Trial Protocol | 4 | 0.0% |
| Consensus Development Conference, NIH | 3 | 0.0% |
| Dataset | 3 | 0.0% |
| Patient Education Handout | 3 | 0.0% |
| Retracted Publication | 3 | 0.0% |
| Scoping Review | 3 | 0.0% |
| Seminal Article | 3 | 0.0% |
| Clinical Conference | 2 | 0.0% |
| Clinical Trial, Phase IV | 2 | 0.0% |
| English Abstract | 2 | 0.0% |
| Retraction Notice | 2 | 0.0% |
| Clinical Study | 1 | 0.0% |
| Dictionary | 1 | 0.0% |
| Equivalence Trial | 1 | 0.0% |
| Expression of Concern | 1 | 0.0% |
| Network Meta-Analysis | 1 | 0.0% |
| Newspaper Article | 1 | 0.0% |
| Pragmatic Clinical Trial | 1 | 0.0% |

Human study-design publication types — the 10 `pubtype*` values in signal-mapping.json (Clinical Trial; Clinical Trial, Phase I; Clinical Trial, Phase II; Clinical Trial, Phase III; Clinical Trial, Phase IV; Meta-Analysis; Observational Study; Pragmatic Clinical Trial; Randomized Controlled Trial; Systematic Review): 703 rows with any of them (4.6% of verified rows); 82 of 142 investigators with ≥ 1.

### 11h. Author position × method

Over the 15375 stamped verified rows. Method is how the author entry was found: orcid on the entry, name (strict name + UCSF, else name only), absent = not located.

| author_position | orcid | name | absent | (null) | total |
|---|---|---|---|---|---|
| first | 119 | 1898 | 0 | 0 | 2017 |
| last | 583 | 4146 | 0 | 0 | 4729 |
| corresponding | 40 | 158 | 0 | 0 | 198 |
| middle | 819 | 7524 | 0 | 0 | 8343 |
| unknown | 0 | 0 | 88 | 0 | 88 |
| (null) | 0 | 0 | 0 | 0 | 0 |
| (all) | 1561 | 13726 | 88 | 0 | 15375 |

### Reading for Phase 1 (2026-09-05, hand-written; `--report` regenerates the tables above and keeps this block — re-check it after a rerun)

The roster is not overwhelmingly animal/mechanistic. Of the 13,351 verified rows with MeSH, 74.6% touch the human vertex (H 24.1%, CH 26.4%, ACH 20.6%, AH 3.5%) and Humans is the most common descriptor (74.5% of rows); Humans-only rows (51.0%) outnumber Animals-only rows (22.1%) two to one, the modal class is H, CH or ACH for 103 of 142 investigators, and 92 investigators have an H-touching share ≥ 67% (median 74.4%; only 3 are below 33%). The animal-mechanistic block is real but a minority: Mice are on 32.4% of rows, AC is the modal class for 36 investigators, and Rats, Zebrafish, Primates and Macaca together are on under 3%. Two figures qualify the human share: only 28.5% of rows carry an M01 persons descriptor (Adult, Child, …) while 46.1% touch H through the Humans tag alone, which PubMed also puts on human cell-line and biospecimen work; and the 10 human study-design publication types the rules key on appear on 703 rows, 4.6% of verified rows (Randomized Controlled Trial 242, Clinical Trial 215, Observational Study 149, Meta-Analysis 63, Systematic Review 43), spread thinly over 82 of 142 investigators, so no investigator's evidence base is built on them. Implication for PR 1.2: population and trial gating will remove only the animal-only quarter, so the measurable win has to come from discriminating within the human three-quarters, and because publication types are too sparse to carry that, the rules should key on MeSH — Humans with M01 persons or epidemiologic-study descriptors (Cohort Studies, Case-Control Studies) versus Humans with A11 / B04 / G04 cell-molecular trees — calibrated so a CH row (human cells, mechanistic) reads as translational human biology rather than a human-participant study.
