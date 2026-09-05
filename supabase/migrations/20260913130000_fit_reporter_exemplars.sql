-- PR 0.6 · RePORTER exemplars by announcement.
--
-- For every open NIH notice, the projects RePORTER shows were funded under the
-- notice's own number and its "Reissue of" lineage (funding_opportunities.reissue_of,
-- walked up to 4 steps). Up to 60 exemplars per notice, newest fiscal years first,
-- one row per core project (a project's continuation years collapse onto its newest
-- award). Refreshed monthly by /api/cron/fit-exemplars (daily schedule, 30-day
-- staleness predicate) and loaded by scripts/fit-reporter-exemplars.ts.
--
-- RePORTER v2 /projects/search filters by announcement with
-- criteria.opportunity_numbers (the documented name; criteria.foa is an
-- undocumented alias with identical behaviour — verified 2026-09-05, see
-- DECISIONS.md). The match is exact per number, case-insensitive, and does not
-- follow reissue lineage, so the lineage is walked here and each exemplar records
-- which number it was actually awarded under (awarded_under, lineage_depth).
--
-- item_profile is NULL until Phase 1 classifies the abstract with the same item
-- classifier used for investigator publications (spec §6, exemplar blend).

CREATE TABLE IF NOT EXISTS public.opportunity_exemplars (
  opportunity_number TEXT NOT NULL,
  project_num TEXT NOT NULL,
  core_project_num TEXT NOT NULL,
  appl_id BIGINT,
  awarded_under TEXT NOT NULL,
  lineage_depth INTEGER NOT NULL DEFAULT 0 CHECK (lineage_depth BETWEEN 0 AND 4),
  fiscal_year INTEGER,
  award_type TEXT,
  title TEXT,
  abstract TEXT,
  activity_code TEXT,
  rcdc_categories TEXT[],
  study_section TEXT,
  study_section_code TEXT,
  pi_names TEXT[] NOT NULL DEFAULT '{}',
  org_name TEXT,
  item_profile JSONB,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (opportunity_number, project_num)
);

COMMENT ON TABLE public.opportunity_exemplars IS
  'RePORTER projects funded under a notice''s announcement number or its reissue lineage (PR 0.6). Up to 60 per notice, newest fiscal years first, one row per core project. Replaced wholesale on each refresh (rows older than the run are pruned).';
COMMENT ON COLUMN public.opportunity_exemplars.opportunity_number IS
  'The notice the exemplar is stored for (funding_opportunities.opportunity_number) — not necessarily the number it was awarded under; see awarded_under.';
COMMENT ON COLUMN public.opportunity_exemplars.project_num IS
  'Full RePORTER project number of the newest award for this core project, e.g. 1R03TR006462-01.';
COMMENT ON COLUMN public.opportunity_exemplars.core_project_num IS
  'RePORTER core_project_num (activity code + IC + serial, e.g. R03TR006462); the deduplication key across fiscal years.';
COMMENT ON COLUMN public.opportunity_exemplars.appl_id IS
  'RePORTER application id of the stored award.';
COMMENT ON COLUMN public.opportunity_exemplars.awarded_under IS
  'The announcement number RePORTER lists for the award: the notice itself (lineage_depth 0) or one of its reissue_of predecessors.';
COMMENT ON COLUMN public.opportunity_exemplars.lineage_depth IS
  '0 = awarded under the notice''s own number; n = under the n-th reissue_of predecessor (walk capped at 4).';
COMMENT ON COLUMN public.opportunity_exemplars.fiscal_year IS
  'Fiscal year of the stored award (the newest year the core project appears under the lineage).';
COMMENT ON COLUMN public.opportunity_exemplars.award_type IS
  'RePORTER award_type (application type digit: 1 new, 2 renewal, 3 supplement, 5 continuation, …).';
COMMENT ON COLUMN public.opportunity_exemplars.abstract IS
  'RePORTER abstract_text, verbatim; NULL when RePORTER holds none.';
COMMENT ON COLUMN public.opportunity_exemplars.activity_code IS
  'RePORTER activity_code (R01, R03, UG3 …), parsed from project_num when the field is absent.';
COMMENT ON COLUMN public.opportunity_exemplars.rcdc_categories IS
  'spending_categories_desc split on ";" (RCDC category names). NULL when RePORTER has none for the award (new awards are categorized later), never {}.';
COMMENT ON COLUMN public.opportunity_exemplars.study_section IS
  'full_study_section.name with the trailing bracketed code removed; study_section_code carries srg_code.';
COMMENT ON COLUMN public.opportunity_exemplars.pi_names IS
  'principal_investigators[].full_name, whitespace collapsed, in RePORTER order (contact PI first when RePORTER lists it first).';
COMMENT ON COLUMN public.opportunity_exemplars.org_name IS
  'organization.org_name as RePORTER reports it (upper case, unnormalized).';
COMMENT ON COLUMN public.opportunity_exemplars.item_profile IS
  'Phase 1: the item classifier''s axis vector for the abstract (same shape as investigator items). NULL until classified.';
COMMENT ON COLUMN public.opportunity_exemplars.fetched_at IS
  'When the refresh that produced this row ran; rows for a notice with fetched_at older than the latest run are pruned.';

-- Per-notice reads newest-first; core number joins to investigator_nih_grants for roster overlap.
CREATE INDEX IF NOT EXISTS idx_opportunity_exemplars_notice_fy
  ON public.opportunity_exemplars (opportunity_number, fiscal_year DESC);
CREATE INDEX IF NOT EXISTS idx_opportunity_exemplars_core
  ON public.opportunity_exemplars (core_project_num);

ALTER TABLE public.opportunity_exemplars ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS opportunity_exemplars_all_authenticated ON public.opportunity_exemplars;
CREATE POLICY opportunity_exemplars_all_authenticated ON public.opportunity_exemplars
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Per-notice fetch stamp on funding_opportunities: the cron's resume predicate.
-- Stamped for every notice a run touched — including notices with zero
-- exemplars (new RFAs) and non-announcement numbers (skipped) — so a rerun
-- never re-fetches the corpus. Refreshed after 30 days; errors retried after 7.
-- ---------------------------------------------------------------------------
ALTER TABLE public.funding_opportunities
  ADD COLUMN IF NOT EXISTS exemplars_fetched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS exemplars_fetch_status TEXT
    CHECK (exemplars_fetch_status IN ('ok', 'error', 'skipped')),
  ADD COLUMN IF NOT EXISTS exemplars_count INTEGER,
  ADD COLUMN IF NOT EXISTS exemplars_lineage TEXT[];

COMMENT ON COLUMN public.funding_opportunities.exemplars_fetched_at IS
  'When /api/cron/fit-exemplars last fetched RePORTER for this notice. NULL = never. Due again after 30 days (ok / skipped) or 7 days (error).';
COMMENT ON COLUMN public.funding_opportunities.exemplars_fetch_status IS
  'ok = fetched (exemplars_count may be 0 — a new RFA has no awards yet); error = RePORTER request failed, retried after 7 days; skipped = opportunity_number is not an NIH announcement number, nothing to ask RePORTER.';
COMMENT ON COLUMN public.funding_opportunities.exemplars_count IS
  'Rows stored in opportunity_exemplars for this notice by the last fetch (≤ 60).';
COMMENT ON COLUMN public.funding_opportunities.exemplars_lineage IS
  'Announcement numbers the last fetch asked RePORTER for, depth order: the notice''s own number, then its reissue_of predecessors (≤ 4 steps).';

CREATE INDEX IF NOT EXISTS idx_funding_opps_exemplars_fetch
  ON public.funding_opportunities (exemplars_fetched_at)
  WHERE agency_code LIKE 'HHS-NIH%' OR opportunity_number LIKE 'PA-%' OR opportunity_number LIKE 'PAR-%' OR opportunity_number LIKE 'RFA-%';
