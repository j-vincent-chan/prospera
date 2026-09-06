-- PR 1.5 · Opportunity fit profile.
--
-- One row per notice: the structured OpportunityFitProfile (src/lib/fit/types.ts)
-- built by src/lib/fit/profile/opportunity.ts — deterministic overlays from the
-- activity code, the clinical-trial designation and the Section VII division,
-- the notice-extractor's reading of the sectioned Guide text (three section
-- groups, every field behind a verified verbatim quote), and the RePORTER
-- exemplar prior blended in per taxonomy.opportunity_profile.exemplar_blend.
-- Written by runOpportunityProfiles (the nightly fit-profiles cron) and never
-- by a page render; guide_html_hash records which notice version the profile
-- was built from, so a changed page re-queues the notice.
--
-- fit_notice_extractions caches the model's answer for one section group of one
-- notice version, keyed by the content hash of the taxonomy version and the
-- exact prompt sent (system + user — see extractionCacheKey), so a notice
-- version is extracted once per taxonomy version and prompt, and a prompt edit
-- re-extracts. Rows record sources.complete: an incomplete build (a chunk
-- skipped for budget or time, an unusable reply, a budget-skipped exemplar) is
-- due again on the next run.

CREATE TABLE IF NOT EXISTS public.opportunity_fit_profiles (
  opportunity_id UUID PRIMARY KEY REFERENCES public.funding_opportunities (id) ON DELETE CASCADE,
  taxonomy_version TEXT NOT NULL,
  profile JSONB NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
  sources JSONB NOT NULL,
  guide_html_hash TEXT,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.opportunity_fit_profiles IS
  'Structured notice profile (PR 1.5, spec §6): overlays + notice-extractor text + exemplar blend, one row per funding_opportunities row. Rebuilt when guide_html_hash or taxonomy_version changes.';
COMMENT ON COLUMN public.opportunity_fit_profiles.taxonomy_version IS
  'src/lib/fit/taxonomy.json version the profile was built under; a bump re-queues every notice.';
COMMENT ON COLUMN public.opportunity_fit_profiles.profile IS
  'The OpportunityFitProfile record (src/lib/fit/types.ts): mechanism, paradigm required / required_any / allowed / excluded, unit, design, materials, population, objective, topic, eligibility, team, non_responsive, provenance (field path → verified quote + section), sources, needs_review.';
COMMENT ON COLUMN public.opportunity_fit_profiles.confidence IS
  'profile.confidence mirrored for indexing: the extractor''s confidence over the full Guide text; capped at medium when only a synopsis was read; low when no text was read (overlays only).';
COMMENT ON COLUMN public.opportunity_fit_profiles.sources IS
  'What the profile rests on: text (full_text | synopsis | none), guide_source, exemplar_count / exemplars_classified / exemplars_informative, blend weights and n, per-group extraction status (chunks, cache hit or miss, model calls, skipped, dropped-claim log), the extractor model name, and complete (false with the reasons in incomplete when a chunk was skipped, a reply unusable or an exemplar budget-skipped — the runner re-queues such rows).';
COMMENT ON COLUMN public.opportunity_fit_profiles.guide_html_hash IS
  'funding_opportunities.guide_html_hash at build time; the cron re-queues the notice when the stored hash differs (new or changed Guide page). NULL when built without Guide text.';
COMMENT ON COLUMN public.opportunity_fit_profiles.computed_at IS
  'When the profile was (re)built.';

CREATE INDEX IF NOT EXISTS idx_opportunity_fit_profiles_computed_at
  ON public.opportunity_fit_profiles (computed_at);

ALTER TABLE public.opportunity_fit_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS opportunity_fit_profiles_all_authenticated ON public.opportunity_fit_profiles;
CREATE POLICY opportunity_fit_profiles_all_authenticated ON public.opportunity_fit_profiles
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Notice-extractor cache: one row per (notice version, section group, chunk).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fit_notice_extractions (
  content_hash TEXT PRIMARY KEY,
  opportunity_id UUID,
  section_group TEXT NOT NULL,
  taxonomy_version TEXT NOT NULL,
  output JSONB NOT NULL,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.fit_notice_extractions IS
  'Notice-extractor cache (PR 1.5): the validated model output for one section group of one notice version, keyed by sha1 of the prompt input. Read before any extractor call, written after a usable reply; unusable replies (not JSON, cut off) are never written.';
COMMENT ON COLUMN public.fit_notice_extractions.content_hash IS
  'sha1 of taxonomy_version, the system prompt and the user prompt joined by newlines — extractionCacheKey in src/lib/fit/profile/opportunity-extract.ts. The user prompt carries the notice header, the priors, the section group and chunk position, the sections, the quote reminder and the group return schema, so any prompt edit re-extracts.';
COMMENT ON COLUMN public.fit_notice_extractions.opportunity_id IS
  'The notice the row was first written for (informational; the key is the hash). Not a foreign key: a deleted notice must not delete a reusable extraction.';
COMMENT ON COLUMN public.fit_notice_extractions.section_group IS
  'Section group per docs/fit-engine/prompts/notice-extractor.md: "1" (Purpose + Section I objectives), "2" (non-responsive + Section II + Section IV clinical-trial items), "3" (Section III eligibility + Section VII + team language); "n/m" suffix when the group was split into chunks.';
COMMENT ON COLUMN public.fit_notice_extractions.output IS
  'GroupExtraction: the validated group output (verified evidence and prior_overrides only), the raw reply and the dropped-claim log.';
COMMENT ON COLUMN public.fit_notice_extractions.model IS
  'The model name the call was made with (FIT_MODEL_EXTRACT at the time).';
COMMENT ON COLUMN public.fit_notice_extractions.created_at IS
  'When the row was written.';

CREATE INDEX IF NOT EXISTS idx_fit_notice_extractions_opportunity
  ON public.fit_notice_extractions (opportunity_id);

ALTER TABLE public.fit_notice_extractions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fit_notice_extractions_all_authenticated ON public.fit_notice_extractions;
CREATE POLICY fit_notice_extractions_all_authenticated ON public.fit_notice_extractions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
