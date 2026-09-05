-- PR 0.3 · ClinicalTrials.gov design fields and the investigator's role on the
-- study, parsed from the API v2 record every row already holds in raw_json
-- (designModule, enrollmentInfo, armsInterventionsModule, overallOfficials,
-- responsibleParty). Enums are stored the way CT.gov spells them
-- (INTERVENTIONAL, PHASE2, NA, RANDOMIZED, PARALLEL, COHORT, …) because the
-- ctgov rules in src/lib/fit/signal-mapping.json key on those strings.
-- phases = '{NA}' is a real value — an interventional study outside the drug
-- phase ladder (behavioral, device, procedure) — not a missing one; allocation
-- and intervention_model carry the design for those.
-- NULL study_type / investigator_role means the row has not been parsed yet
-- (design_parsed_at IS NULL); a parsed row with nothing to read stores
-- NULLs, '{}' and UNKNOWN with the stamp set.
-- Filled by src/lib/community/clinicaltrials-design.ts on every upsert and by
-- scripts/fit-backfill-ctgov-design.ts for existing rows (no network).

ALTER TABLE public.investigator_clinical_trials
  ADD COLUMN IF NOT EXISTS study_type TEXT,
  ADD COLUMN IF NOT EXISTS phases TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS primary_purpose TEXT,
  ADD COLUMN IF NOT EXISTS allocation TEXT,
  ADD COLUMN IF NOT EXISTS intervention_model TEXT,
  ADD COLUMN IF NOT EXISTS observational_model TEXT,
  ADD COLUMN IF NOT EXISTS time_perspective TEXT,
  ADD COLUMN IF NOT EXISTS enrollment INTEGER,
  ADD COLUMN IF NOT EXISTS intervention_types TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS investigator_role TEXT
    CHECK (investigator_role IN ('PRINCIPAL_INVESTIGATOR', 'STUDY_CHAIR', 'STUDY_DIRECTOR', 'RESPONSIBLE_PARTY_PI', 'LISTED', 'UNKNOWN')),
  ADD COLUMN IF NOT EXISTS design_parsed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.investigator_clinical_trials.study_type IS
  'designModule.studyType: INTERVENTIONAL, OBSERVATIONAL or EXPANDED_ACCESS. NULL until parsed, or when the record has no designModule.';
COMMENT ON COLUMN public.investigator_clinical_trials.phases IS
  'designModule.phases as CT.gov lists them (EARLY_PHASE1, PHASE1 … PHASE4). {NA} is a real value: interventional outside the drug ladder — read allocation and intervention_model for the design. {} when the record has none (observational).';
COMMENT ON COLUMN public.investigator_clinical_trials.primary_purpose IS
  'designModule.designInfo.primaryPurpose (TREATMENT, PREVENTION, BASIC_SCIENCE, HEALTH_SERVICES_RESEARCH, SUPPORTIVE_CARE, …).';
COMMENT ON COLUMN public.investigator_clinical_trials.allocation IS
  'designModule.designInfo.allocation: RANDOMIZED, NON_RANDOMIZED or NA (single group). Interventional studies only.';
COMMENT ON COLUMN public.investigator_clinical_trials.intervention_model IS
  'designModule.designInfo.interventionModel: SINGLE_GROUP, PARALLEL, CROSSOVER, FACTORIAL, SEQUENTIAL. Interventional studies only.';
COMMENT ON COLUMN public.investigator_clinical_trials.observational_model IS
  'designModule.designInfo.observationalModel: COHORT, CASE_CONTROL, CASE_ONLY, CASE_CROSSOVER, ECOLOGIC_OR_COMMUNITY, FAMILY_BASED, DEFINED_POPULATION, NATURAL_HISTORY, OTHER. Observational studies only.';
COMMENT ON COLUMN public.investigator_clinical_trials.time_perspective IS
  'designModule.designInfo.timePerspective: PROSPECTIVE, RETROSPECTIVE, CROSS_SECTIONAL, OTHER. Observational studies only.';
COMMENT ON COLUMN public.investigator_clinical_trials.enrollment IS
  'designModule.enrollmentInfo.count — actual or estimated participants (the type is not kept). The ctgov_observational_cohort_large rule reads this against enrollment_min.';
COMMENT ON COLUMN public.investigator_clinical_trials.intervention_types IS
  'armsInterventionsModule.interventions[].type, deduplicated in record order (DRUG, DEVICE, BIOLOGICAL, PROCEDURE, BEHAVIORAL, DIETARY_SUPPLEMENT, OTHER, …).';
COMMENT ON COLUMN public.investigator_clinical_trials.investigator_role IS
  'This investigator''s role on the study. PRINCIPAL_INVESTIGATOR / STUDY_CHAIR / STUDY_DIRECTOR from overallOfficials[].role on the entry whose name matches; RESPONSIBLE_PARTY_PI when responsibleParty (PRINCIPAL_INVESTIGATOR or SPONSOR_INVESTIGATOR) names them as investigatorFullName; the earliest of those wins when several apply. LISTED = the record names people and this investigator is not among them in a recognised role. UNKNOWN = nothing to match against. NULL until parsed.';
COMMENT ON COLUMN public.investigator_clinical_trials.design_parsed_at IS
  'When the design fields were last parsed from raw_json (ingest upsert or scripts/fit-backfill-ctgov-design.ts). NULL = never parsed; the backfill''s --pending selects on this.';
