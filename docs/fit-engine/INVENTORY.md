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

## 12. RePORTER RCDC values seen (PR 0.4, D9)

Generated 2026-09-05T21:46:36.899Z by `npm run fit:backfill-reporter-fields -- --dry-run`, read-only over every row of `investigator_nih_grants`. RCDC = `raw_json.spending_categories_desc` split on `;`. Status: **mapped** = one of the seven research-type names D9 maps by default (the `rcdc_any` rules in `signal-mapping.json`); **unverified** = named by a `_verify_name` rule D9 has not confirmed against the current RCDC list; **unmapped** = a disease / topic category no rule keys on.

| Metric | Value |
|---|---|
| rows | 818 |
| rows with activity_code parsed | 818 (100%) |
| rows with spending_categories_desc | 508 (62.1%) |
| rows with rcdc_categories parsed | 508 (62.1%) |
| distinct RCDC values | 184 |
| mapped names seen | 5 of 7 |
| unverified names seen | 0 of 3 |
| unmapped values | 179 |

Research-type names in the mapping (D9) and the rows carrying each; 0 = in the mapping, not in this corpus:

| RCDC value | status | rules | rows |
|---|---|---|---|
| Clinical Trials | mapped | `reporter_rcdc_clinical_trials` | 0 |
| Clinical Research | mapped | `reporter_rcdc_clinical_research` | 210 |
| Health Services | mapped | `reporter_rcdc_hsr` | 1 |
| Comparative Effectiveness Research | mapped | `reporter_rcdc_cer` | 0 |
| Prevention | mapped | `reporter_rcdc_prevention` | 83 |
| Behavioral and Social Science | mapped | `reporter_rcdc_behavioral` | 6 |
| Basic Behavioral and Social Science | mapped | `reporter_rcdc_behavioral` | 3 |
| Epidemiology and Longitudinal Studies | unverified | `reporter_rcdc_epi` | 0 |
| Dissemination and Implementation Research | unverified | `reporter_rcdc_di` | 0 |
| Translational Research | unverified | `reporter_rcdc_translational` | 0 |

Unmapped values seen (179; disease / topic categories — no rule keys on them):

| RCDC value | rows |
|---|---|
| Genetics | 219 |
| Biotechnology | 156 |
| Infectious Diseases | 156 |
| Rare Diseases | 102 |
| Cancer | 94 |
| Lung | 94 |
| Autoimmune Disease | 82 |
| Human Genome | 66 |
| HIV/AIDS | 63 |
| Pediatric | 61 |
| Neurosciences | 60 |
| Emerging Infectious Diseases | 54 |
| Brain Disorders | 45 |
| Stem Cell Research | 45 |
| Immunization | 44 |
| Digestive Diseases | 43 |
| Vaccine Related | 40 |
| Immunotherapy | 39 |
| Transplantation | 36 |
| Bioengineering | 34 |
| Asthma | 29 |
| Orphan Drug | 29 |
| Biodefense | 28 |
| Diabetes | 27 |
| Hematology | 27 |
| Organ Transplantation | 26 |
| Aging | 25 |
| Contraception/Reproduction | 24 |
| Liver Disease | 24 |
| Neurodegenerative | 23 |
| Precision Medicine | 22 |
| Tuberculosis | 22 |
| Women's Health | 22 |
| Cardiovascular | 20 |
| Perinatal Period - Conditions Originating in Perinatal Period | 20 |
| Clinical Trials and Supportive Activities | 19 |
| Stem Cell Research - Nonembryonic - Non-Human | 18 |
| Breast Cancer | 16 |
| Microbiome | 16 |
| Regenerative Medicine | 16 |
| Cancer Genomics | 15 |
| Heart Disease | 14 |
| Stem Cell Research - Nonembryonic - Human | 14 |
| Arthritis | 13 |
| Biomedical Imaging | 13 |
| Kidney Disease | 12 |
| Minority Health | 12 |
| Multiple Sclerosis | 12 |
| Pregnancy | 12 |
| Gene Therapy | 11 |
| Brain Cancer | 10 |
| Health Disparities | 10 |
| Chronic Liver Disease and Cirrhosis | 9 |
| Lupus | 9 |
| Mental Health | 9 |
| Nutrition | 9 |
| Vector-Borne Diseases | 9 |
| Biodefense and Related Countermeasures | 8 |
| Chronic Obstructive Pulmonary Disease | 8 |
| Colorectal Cancer | 8 |
| Hepatitis | 8 |
| Infertility | 8 |
| Obesity | 8 |
| Stem Cell Research - Induced Pluripotent Stem Cell | 8 |
| Stem Cell Research - Induced Pluripotent Stem Cell - Human | 8 |
| Acute Respiratory Distress Syndrome | 7 |
| Conditions Affecting the Embryonic and Fetal Periods | 7 |
| Coronaviruses | 7 |
| Drug Abuse (NIDA only) | 7 |
| Preterm, Low Birth Weight and Health of the Newborn | 7 |
| Stem Cell Research - Embryonic - Human | 7 |
| Stem Cell Research - Embryonic - Non-Human | 7 |
| Substance Misuse | 7 |
| Tuberculosis Vaccine | 7 |
| Antimicrobial Resistance | 6 |
| Eye Disease and Disorders of Vision | 6 |
| Maternal Health | 6 |
| Networking and Information Technology R&D (NITRD) | 6 |
| Pediatric Cancer | 6 |
| Pneumonia and Influenza | 6 |
| Psoriasis | 6 |
| Rheumatoid Arthritis | 6 |
| Women's Health Research | 6 |
| Acquired Cognitive Impairment | 5 |
| Alzheimer's Disease including Alzheimer's Disease Related Dementias (AD/ADRD) | 5 |
| Childhood Leukemia | 5 |
| Cystic Fibrosis | 5 |
| Dementia | 5 |
| Heart Disease - Coronary Heart Disease | 5 |
| Machine Learning and Artificial Intelligence | 5 |
| Pediatric Research Initiative | 5 |
| Pneumonia | 5 |
| Sexually Transmitted Infections | 5 |
| Vaccine Related - AIDS | 5 |
| Alzheimer's Disease | 4 |
| Atherosclerosis | 4 |
| Cerebrovascular | 4 |
| Complementary and Integrative Health | 4 |
| Congenital Structural Anomalies | 4 |
| Eczema / Atopic Dermatitis | 4 |
| Fibroid Tumors (Uterine) | 4 |
| Genetic Testing | 4 |
| Hepatitis - B | 4 |
| Human Fetal Tissue | 4 |
| Infant Mortality/ (LBW) | 4 |
| Lung Cancer | 4 |
| Pancreatic Cancer | 4 |
| Sepsis | 4 |
| Chronic Pain | 3 |
| Coronaviruses Therapeutics and Interventions | 3 |
| Health Effects of Indoor Air Pollution | 3 |
| Hepatitis - C | 3 |
| Infant Mortality | 3 |
| Inflammatory Bowel Disease | 3 |
| Malaria | 3 |
| Pain Research | 3 |
| Physical Injury - Accidents and Adverse Effects | 3 |
| Pulmonary Fibrosis | 3 |
| Radiation Oncology | 3 |
| Urologic Diseases | 3 |
| Valley Fever | 3 |
| Alzheimer's Disease Related Dementias (ADRD) | 2 |
| Cannabinoid Research | 2 |
| Climate-Related Exposures and Conditions | 2 |
| Coronaviruses Disparities and At-Risk Populations | 2 |
| Crohn's Disease | 2 |
| Dental, Oral, and Craniofacial Disease | 2 |
| Dietary Supplements | 2 |
| Endocannabinoid System Research | 2 |
| Endometriosis | 2 |
| Epilepsy | 2 |
| Estrogen | 2 |
| Hydrocephalus | 2 |
| Liver Cancer | 2 |
| Mental Illness | 2 |
| Opioids | 2 |
| Osteoporosis | 2 |
| Pediatric - AIDS | 2 |
| Post-Acute Sequelae of SARS-CoV-2 infection (PASC) including Long COVID | 2 |
| Social Determinants of Health | 2 |
| Topical Microbicides | 2 |
| Traumatic Head and Spine Injury | 2 |
| American Indian or Alaska Native | 1 |
| Autism | 1 |
| Breastfeeding, Lactation and Breast Milk | 1 |
| Cannabidiol Research | 1 |
| Cooley's Anemia | 1 |
| Coronaviruses Diagnostics and Prognostics | 1 |
| Coronaviruses Vaccines | 1 |
| Data Science | 1 |
| Depression | 1 |
| Emphysema | 1 |
| Frontotemporal Dementia (FTD) | 1 |
| Health Disparities and Racial or Ethnic Minority Health Research | 1 |
| Health Disparities Research | 1 |
| Influenza | 1 |
| Intellectual and Developmental Disabilities (IDD) | 1 |
| Lymphatic Research | 1 |
| Lymphoma | 1 |
| Maternal Morbidity and Mortality | 1 |
| Mind and Body | 1 |
| Mucopolysaccharidoses (MPS) | 1 |
| Patient Safety | 1 |
| Peripheral Neuropathy | 1 |
| Physical Activity | 1 |
| Prostate Cancer | 1 |
| Pulmonary Hypertension | 1 |
| Scleroderma | 1 |
| Skin Cancer | 1 |
| Spinal Cord Injury | 1 |
| Stem Cell Research - Umbilical Cord Blood/ Placenta | 1 |
| Stem Cell Research - Umbilical Cord Blood/ Placenta - Non-Human | 1 |
| Stroke | 1 |
| Telehealth | 1 |
| Therapeutic Cannabinoid Research | 1 |
| Tobacco | 1 |
| Tobacco Smoke and Health | 1 |
| Uterine Cancer | 1 |
| Vascular Contributions to Cognitive Impairment and Dementia (VCID) | 1 |
