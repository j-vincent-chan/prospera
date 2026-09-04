-- PR 0.1b · PubMed identity recovery.
--
-- The PubMed refresh now walks a fallback ladder (override → strict name →
-- initials → ORCID [auid] → RePORTER publication linkage) and records the rung
-- that matched in investigator_sources.identity_method. Two new values:
--   * 'initials'      — source row only: the initials author variant matched.
--   * 'reporter_link' — source row and publication rows: PMID linked to one of
--                       the investigator's NIH projects via RePORTER v2
--                       /publications/search (verified, no affiliation needed).
--
-- Constraint names are the Postgres defaults for inline column CHECKs. If a
-- DROP reports the name does not exist, list them with:
--   select conname from pg_constraint where conrelid = 'public.investigator_sources'::regclass;

ALTER TABLE public.investigator_sources
  DROP CONSTRAINT IF EXISTS investigator_sources_identity_method_check;
ALTER TABLE public.investigator_sources
  ADD CONSTRAINT investigator_sources_identity_method_check
  CHECK (identity_method IN (
    'profile_id', 'orcid', 'affiliation', 'profiles', 'name_only', 'manual', 'self',
    'initials', 'reporter_link'
  ));

ALTER TABLE public.investigator_publications
  DROP CONSTRAINT IF EXISTS investigator_publications_identity_method_check;
ALTER TABLE public.investigator_publications
  ADD CONSTRAINT investigator_publications_identity_method_check
  CHECK (identity_method IN (
    'affiliation', 'orcid', 'profiles', 'profile_id', 'name_only', 'manual',
    'reporter_link'
  ));

COMMENT ON COLUMN public.investigator_sources.identity_method IS
  'How the source was tied to the person. For pubmed: the identity-ladder rung that matched (manual = pubmed_query_override, affiliation = strict name + UCSF, initials = initials variant + UCSF, orcid = [auid] search, reporter_link = RePORTER project linkage).';
