-- PR 5.2 · Announcement acquisition framework.
--
-- The Guide sync could read one funder's announcements from two hosts. The
-- generalised sync reads any funder's from whichever route that funder
-- publishes on, so the columns that recorded "which Guide host" have to record
-- "which announcement route" instead.
--
--   * guide_source widens from the two NIH hosts to every route Phase 5 adds.
--     No adapter beyond the NIH one is registered yet: this PR only makes the
--     values legal so 5.3-5.5 do not each need a migration.
--   * announcement_kind is the adapter id that produced the sections, which is
--     coarser than guide_source (one adapter can read more than one host).
--   * announcement_text_hash is the SHA-256 of the extracted text, for every
--     source. guide_html_hash only ever made sense for HTML from a Guide host;
--     a PDF has no HTML to hash, so re-parse detection needs a hash of the text.
--     It lands on BOTH tables: profileDue() compares a profile row against a
--     notice row, and a hash on one side only is not comparable.
--
-- Written, never applied by a script (CLAUDE.md); the coordinator applies it
-- before the merge deploys. Every statement is idempotent and re-runnable.

-- ---------------------------------------------------------------------------
-- funding_opportunities
-- ---------------------------------------------------------------------------

ALTER TABLE public.funding_opportunities
  ADD COLUMN IF NOT EXISTS announcement_kind TEXT,
  ADD COLUMN IF NOT EXISTS announcement_text_hash TEXT;

ALTER TABLE public.funding_opportunities
  DROP CONSTRAINT IF EXISTS funding_opportunities_guide_source_check;
ALTER TABLE public.funding_opportunities
  ADD CONSTRAINT funding_opportunities_guide_source_check
    CHECK (guide_source IN (
      'grants_nih_gov',
      'simpler_attachment',
      'grants_gov_attachment',
      'nsf_solicitation',
      'cdmrp_pa',
      'landing_page',
      'synopsis'
    ));

COMMENT ON COLUMN public.funding_opportunities.guide_source IS
  'Which route the sectioned announcement text was read from: grants_nih_gov (the classic NIH Guide page) | simpler_attachment (the <number>-Full-Announcement.html attachment on files.simpler.grants.gov) | grants_gov_attachment (a Grants.gov / Simpler attachment for a non-NIH notice, PR 5.3) | nsf_solicitation (the HTML solicitation at www.nsf.gov, PR 5.4) | cdmrp_pa (the CDMRP Program Announcement PDF, PR 5.5) | landing_page (an unstructured funder page) | synopsis (Simpler''s summary_description, no announcement read). NULL until an announcement is read. Only the first two are produced today; the rest are legal so PRs 5.3-5.5 need no further migration.';

COMMENT ON COLUMN public.funding_opportunities.announcement_kind IS
  'The announcement adapter that produced guide_sections (src/lib/ingestion/announcement/adapters/*), e.g. "nih_guide". Coarser than guide_source: one adapter can read more than one host, as the NIH one reads both grants.nih.gov and files.simpler.grants.gov. NULL until an adapter has read the notice.';

COMMENT ON COLUMN public.funding_opportunities.announcement_text_hash IS
  'SHA-256 of the extracted announcement text, for every source. guide_html_hash is the hash of the raw HTML and exists only for the two Guide hosts; a PDF or a sectioned landing page has no HTML to hash, so this is what re-parse detection compares. Mirrored onto opportunity_fit_profiles so profileDue() can compare the two sides.';

COMMENT ON COLUMN public.funding_opportunities.guide_sections IS
  'Sectioned announcement text, whatever the source: array of {part (1|2), section, heading (verbatim), text (one line per paragraph / list item), roles}. For an NIH Guide notice the sections are the Guide''s own Part 1 / Section I-VII blocks; for another funder they are whatever that funder''s heading table produced, and only `roles` is common to both. NULL until an announcement is read. roles is a LIST of "purpose" | "objectives" | "non_responsive" | "award_info" | "eligibility" | "human_subjects" | "review" | "contacts" | "team" | "synopsis" | "other" (PR 5.1), a list rather than a scalar because the routing is not a partition. Absent on rows written before PR 5.1: withRoles() derives the same values at read time.';

-- ---------------------------------------------------------------------------
-- opportunity_fit_profiles: the other side of profileDue()'s comparison
-- ---------------------------------------------------------------------------

ALTER TABLE public.opportunity_fit_profiles
  ADD COLUMN IF NOT EXISTS announcement_text_hash TEXT;

COMMENT ON COLUMN public.opportunity_fit_profiles.announcement_text_hash IS
  'funding_opportunities.announcement_text_hash at build time; the cron re-queues the notice when the stored hash differs. NULL for profiles built before PR 5.2 and for notices with no announcement text — guide_html_hash still carries the NIH case, and profileDue() re-queues on either changing.';
