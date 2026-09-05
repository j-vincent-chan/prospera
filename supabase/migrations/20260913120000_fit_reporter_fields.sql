-- PR 0.4 · RePORTER: materialize the structured fields the fit engine reads
-- from investigator_nih_grants.raw_json (the whole projects API v2 record the
-- ingest has always stored): activity code, RCDC spending categories, study
-- section, the contact-PI flag, abstract and public health relevance.
-- signal-mapping.json keys on them (activity_code_any, rcdc_any,
-- study_section_family_table); the rule classifier needs columns, not JSON
-- paths. Written by src/lib/community/reporter-fields.ts on every upsert and
-- by scripts/fit-backfill-reporter-fields.ts for rows already held;
-- fields_parsed_at makes the backfill resumable (NULL = not parsed yet).

ALTER TABLE public.investigator_nih_grants
  ADD COLUMN IF NOT EXISTS activity_code TEXT,
  ADD COLUMN IF NOT EXISTS rcdc_categories TEXT[],
  ADD COLUMN IF NOT EXISTS study_section TEXT,
  ADD COLUMN IF NOT EXISTS study_section_code TEXT,
  ADD COLUMN IF NOT EXISTS is_contact_pi BOOLEAN,
  ADD COLUMN IF NOT EXISTS abstract TEXT,
  ADD COLUMN IF NOT EXISTS phr_text TEXT,
  ADD COLUMN IF NOT EXISTS fields_parsed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.investigator_nih_grants.activity_code IS
  'NIH activity code parsed from project_num (R01, K23, DP2, UG3, …): the letter and two alphanumerics before the IC code; RePORTER''s own activity_code is the fallback. NULL only when neither is readable.';
COMMENT ON COLUMN public.investigator_nih_grants.rcdc_categories IS
  'raw_json.spending_categories_desc split on ";", trimmed and deduplicated (RCDC spending categories). NULL when RePORTER has none for the project — awards before FY2008 and new awards not yet categorized — never {}.';
COMMENT ON COLUMN public.investigator_nih_grants.study_section IS
  'raw_json.full_study_section.name with the trailing bracketed code removed ("Immunobiology Study Section", "Special Emphasis Panel"); a bare-code name on older awards is kept as is. NULL when no panel is on record.';
COMMENT ON COLUMN public.investigator_nih_grants.study_section_code IS
  'raw_json.full_study_section.srg_code (IMB, HAI, ZRG1, …); the SEP designator stays in raw_json.';
COMMENT ON COLUMN public.investigator_nih_grants.is_contact_pi IS
  'principal_investigators[].is_contact_pi for the entry carrying the investigator''s RePORTER profile id. false = on the award, not the contact PI (MPI); NULL = the id is unknown or not on the PI list (e.g. rows fit-fix-profile-ids rejected).';
COMMENT ON COLUMN public.investigator_nih_grants.abstract IS
  'raw_json.abstract_text with hard line wraps and padding collapsed; blank-line paragraphs joined with a blank line. NULL when empty.';
COMMENT ON COLUMN public.investigator_nih_grants.phr_text IS
  'raw_json.phr_text (public health relevance statement), normalized like abstract. NULL when empty.';
COMMENT ON COLUMN public.investigator_nih_grants.fields_parsed_at IS
  'When reporter-fields.ts last parsed raw_json into the columns above (the ingest on upsert, or the backfill). NULL = not parsed yet; the backfill selects on it.';
