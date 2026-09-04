# Prompt spec — Item classifier

**Role in the pipeline.** Phase 1 (spec §5). Runs once per evidence item that has prose but not enough structure for the rule classifier to decide: publications without MeSH (in-process / unindexed), RePORTER abstracts, biosketch contributions and personal statements, UCSF Profiles narratives, self-declared research focus text. Output is merged with rule-classifier output; **rules override the model on any axis where a rule fired.**

**Model.** `FIT_MODEL_CLASSIFY` (a cost-efficient model is acceptable; the schema is tight). `temperature: 0`, JSON mode. Cache by `contentHash(taxonomy_version + item_text)` in `fit_item_profiles`.

## Inputs

```
kind: "publication" | "grant" | "trial" | "biosketch_statement" | "biosketch_contribution" | "profiles_narrative" | "self_declared"
title: string | null
text: string          // abstract, statement, or narrative; ≤ 6,000 chars
year: number | null
mesh_names: string[]  // if present, for context only — rules already used them
```

## System prompt

```
You classify one biomedical research item for a research-development office. You do not judge quality or relevance to any funding notice. You describe HOW the research was done, on WHAT, and toward WHAT END, using a fixed vocabulary.

Output JSON only, matching the schema exactly. Every non-zero value must be supported by something in the text; when the text is silent on an axis, leave that axis empty. Do not infer "clinical" from disease words: a paper about lupus pathways in mice is not clinical research. Do not infer "human" from words like "patients" in a background sentence; only the work actually performed counts.

Vocabulary (use only these keys):
paradigm: basic_discovery, molecular_cellular_mechanistic, preclinical, animal_model, translational, human_biospecimen, early_phase_human_experimental, clinical_observational, interventional_clinical, clinical_trials, epidemiology, genetic_epidemiology, population_health, public_health, community_based, behavioral, comparative_effectiveness, health_services, outcomes_research, implementation_science, computational_data_science, bioinformatics, methods_technology_development
unit: L1 (molecule/gene/protein/pathway/cell/tissue/organoid), L2 (whole animal), L3 (human biospecimen / individual participant or patient), L4 (clinical cohort / population / community), L5 (healthcare organization / health system / policy)
design: wet_lab_experiment, perturbation, biochemical_structural, biospecimen_assay, animal_in_vivo, xenograft_pdx, animal_behavioral, bulk_omics, single_cell, spatial_imaging, proteomics_metabolomics, prospective_cohort, retrospective_cohort, case_control, cross_sectional, registry, rct, early_phase_trial, pragmatic_trial, pilot_feasibility_trial, single_arm_interventional, ehr_analysis, claims_analysis, linked_administrative, surveillance_data, survey, qualitative, mixed_methods, community_engaged, causal_inference, statistical_epi_modeling, population_simulation, ml_model_development, secondary_data_analysis, gwas, hybrid_effectiveness_implementation, implementation_evaluation, dissemination_study
materials: cell_lines, primary_cells_nonhuman, organoids_ipsc, animal_mouse, animal_rat, animal_zebrafish, animal_nhp, animal_other, human_tissue_biopsy, human_blood_fluids, human_primary_cells, biobank_specimens, enrolled_participants, patients_under_care, ehr, claims_administrative, registries_surveillance, surveys, cohort_biobank_datasets, genomic_datasets, imaging_datasets, digital_wearable, published_literature, simulated_data
objective: mechanism_discovery, target_identification_validation, biomarker_discovery_validation, therapeutic_development, treatment_evaluation_efficacy, diagnostic_prognostic_prediction, etiology_risk_factors, prevention, outcomes_quality, healthcare_delivery_access, implementation_dissemination, methods_tool_development, resource_infrastructure, training_capacity

Values are probabilities in [0,1] that the item belongs to that category. Multiple categories may be non-zero. Give at most 4 per axis.
```

## User template

```
Item kind: {kind}
Title: {title}
Year: {year}
Text:
{text}

Return:
{"paradigm": {...}, "unit": {...}, "design": {...}, "materials": {...}, "objective": {...},
 "topic_terms": string[],            // 3–8 specific scientific terms (diseases, pathways, molecules, populations); no generic words
 "justification": {"paradigm": string, "unit": string, "design": string, "materials": string, "objective": string},  // one short clause each, quoting the text where possible
 "confidence": "high" | "medium" | "low"}
```

## Validation (in code, after parsing)

- Reject unknown keys; clamp values to [0,1]; drop axes with > 4 entries (keep top 4).
- If `confidence` is `low`, halve all values before merging.
- If a rule fired on an axis for this item, discard the model's values for that axis entirely.
- Store raw model output alongside the merged profile for audit.

## Fixture items (run these when the prompt changes; paste outputs in the PR)

1. RePORTER abstract, mouse T-cell exhaustion, scRNA-seq — expect `molecular_cellular_mechanistic` ≥ .7, `animal_model` ≥ .6, `L1`/`L2`, `perturbation`/`single_cell`, `animal_mouse`; **no** clinical or L3.
2. Biosketch contribution describing leading two phase II SLE trials — expect `clinical_trials` ≥ .8, `L3`, `rct`, `enrolled_participants`.
3. Abstract: EHR-based retrospective cohort of statin adherence and MI incidence — expect `epidemiology`/`health_services`, `L4`, `retrospective_cohort`/`ehr_analysis`, `ehr`; **no** clinical_trials.
4. Abstract: hybrid type 2 effectiveness-implementation trial of a DPP in FQHCs — expect `implementation_science` ≥ .7, `L5`/`L4`, `hybrid_effectiveness_implementation`, `pragmatic_trial` optional.
5. Abstract: polygenic risk methods evaluated in UK Biobank, no disease focus — expect `computational_data_science`/`genetic_epidemiology`, `L4`, `secondary_data_analysis`/`gwas`, `genomic_datasets`.
6. Abstract: TCR signaling in primary human T cells from healthy donors with CRISPR — expect `molecular_cellular_mechanistic`, `human_biospecimen` ≥ .4, `L1` ≥ .8, `perturbation`, `human_primary_cells`; **no** clinical_trials, **no** L4.
