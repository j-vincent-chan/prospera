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

