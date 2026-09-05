-- PR 0.5 · NIH Guide: sectioned full text and designation.
-- Written by src/lib/services/nih-guide-sync.ts (nightly) and
-- scripts/backfill-nih-guide.ts; source_updated_at by the Simpler sync
-- (src/lib/services/simpler-grants-sync.ts, hitToFundingRow).
--
-- Also fixes the re-queue predicate the 0.5a validator found: the sync used
-- updated_at > guide_fetched_at, but the set_updated_at trigger stamps the
-- Guide sync's own write, so every fetched row was due every night. The sync
-- now compares source_updated_at (Simpler-owned) with guide_fetched_at.

ALTER TABLE public.funding_opportunities
  ADD COLUMN IF NOT EXISTS guide_sections JSONB,
  ADD COLUMN IF NOT EXISTS clinical_trial_designation TEXT,
  ADD COLUMN IF NOT EXISTS program_division TEXT,
  ADD COLUMN IF NOT EXISTS guide_html_hash TEXT,
  ADD COLUMN IF NOT EXISTS guide_source TEXT,
  ADD COLUMN IF NOT EXISTS source_updated_at TIMESTAMPTZ;

-- guide_fetch_status gains 'not_applicable': forecasts, CDC -000 placeholders and
-- non-Guide numbers (PA-FPH-27-001) that can never have a Guide page, so
-- INVENTORY § 4 and the data-sources page stop counting them as failures.
ALTER TABLE public.funding_opportunities
  DROP CONSTRAINT IF EXISTS funding_opportunities_guide_fetch_status_check;
ALTER TABLE public.funding_opportunities
  ADD CONSTRAINT funding_opportunities_guide_fetch_status_check
    CHECK (guide_fetch_status IN ('ok', 'not_found', 'error', 'not_applicable'));

ALTER TABLE public.funding_opportunities
  DROP CONSTRAINT IF EXISTS funding_opportunities_clinical_trial_designation_check;
ALTER TABLE public.funding_opportunities
  ADD CONSTRAINT funding_opportunities_clinical_trial_designation_check
    CHECK (clinical_trial_designation IN ('required', 'optional', 'not_allowed', 'besh_required', 'unknown'));

ALTER TABLE public.funding_opportunities
  DROP CONSTRAINT IF EXISTS funding_opportunities_guide_source_check;
ALTER TABLE public.funding_opportunities
  ADD CONSTRAINT funding_opportunities_guide_source_check
    CHECK (guide_source IN ('grants_nih_gov', 'simpler_attachment'));

COMMENT ON COLUMN public.funding_opportunities.guide_sections IS
  'Sectioned full text of the Guide notice, parseGuideSections(): array of {part (1|2), section ("overview", "I", "II", "III", "III.3", "IV.2", "VII" …), heading (verbatim), text (one line per paragraph / list item)}. Part 1 keeps Announcement Type, Components of Participating Organizations and Funding Opportunity Purpose; Part 2 keeps Section I with its sub-headings, Section II rows, Section III minus the standard eligibility lists, Section IV clinical-trial / human-subjects / research-plan items, Section VII scientific and peer-review contacts. NULL until the page is parsed; the plain-text notices (no headings) get section-level text only.';
COMMENT ON COLUMN public.funding_opportunities.clinical_trial_designation IS
  'parseClinicalTrialDesignation(): the title suffix first ("Clinical Trial Required / Optional / Not Allowed", "Basic Experimental Studies with Humans Required" → besh_required), then Section II''s "Clinical Trial?" row; unknown when neither says.';
COMMENT ON COLUMN public.funding_opportunities.program_division IS
  'parseProgramDivision(): the organizational unit on the Section VII Scientific/Research Contact ("Division of Cancer Control and Population Sciences (DCCPS)"); the first unit line that is not the IC, a person, a job title or a phone/e-mail line. NULL when the contact lists only the IC or when three or more ICs are listed (parent notices).';
COMMENT ON COLUMN public.funding_opportunities.guide_html_hash IS
  'SHA-256 of the page''s visible text (comments, scripts, styles and markup removed, whitespace collapsed). The sync skips the re-parse and rewrites only guide_fetched_at / guide_url / guide_source when a re-fetched page hashes the same.';
COMMENT ON COLUMN public.funding_opportunities.guide_source IS
  'Host the Guide page was last read from: grants_nih_gov (classic guide/… path) or simpler_attachment (the <number>-Full-Announcement.html attachment on files.simpler.grants.gov, resolved through GET /v1/opportunities/{source_opportunity_id}). NULL when nothing was read (not_found, error, not_applicable).';
COMMENT ON COLUMN public.funding_opportunities.source_updated_at IS
  'Simpler''s own last-changed timestamp for the opportunity (the later of summary.updated_at and, on detail records, updated_at; created_at as fallback). Written by the Simpler sync on every upsert. The NIH Guide sync re-queues a row when source_updated_at > guide_fetched_at; the trigger-maintained updated_at is never used for that.';
COMMENT ON COLUMN public.funding_opportunities.guide_fetch_status IS
  'ok = Guide page read and parsed; not_found = 404 at every known location (retried after 7 days); error = transport / HTTP error (retried after 7 days); not_applicable = the notice cannot have a Guide page (forecast, -000 placeholder, non-Guide number) — re-evaluated when it posts or Simpler changes it. NULL = never attempted.';
