-- PR 1.4 · Investigator fit profile.
--
-- One row per investigator: the aggregated fit profile (spec §5 "Profile
-- record" — paradigm career and recent views, unit / design / materials /
-- objective weights, coded topic, characteristics, aspirations,
-- do_not_suggest, evidence summary, provenance top-3 ids per category) built
-- by src/lib/fit/profile/investigator.ts from the classified evidence items
-- (fit_item_profiles is the item cache; this table is the aggregate).
--
-- profile     = the InvestigatorFitProfile (src/lib/fit/types.ts), verbatim
-- confidence  = profile.confidence duplicated as its own column so the
--               engine's confidence cap (§10) and the inspector can filter
--               without unpacking the profile
-- item_count  = evidence items the aggregate was computed over (verified
--               publications, non-rejected grants, trials, biosketch
--               statement and contributions, Profiles narrative, the
--               self-declared record, the directory item)
--
-- Written by the nightly /api/cron/fit-profiles run and by the
-- refreshInvestigatorSources completion hook (rules + cache only, never the
-- model in a request path); never by a page render. A taxonomy bump makes
-- every row due again (taxonomy_version <> the current one).

CREATE TABLE IF NOT EXISTS public.investigator_fit_profiles (
  investigator_id UUID PRIMARY KEY REFERENCES public.investigators (id) ON DELETE CASCADE,
  taxonomy_version TEXT NOT NULL,
  profile JSONB NOT NULL,
  confidence JSONB NOT NULL,
  item_count INTEGER NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.investigator_fit_profiles IS
  'Aggregated investigator fit profile (PR 1.4, spec §5): one row per investigator, rebuilt nightly from the classified evidence items and after a source refresh (rules + cache only).';
COMMENT ON COLUMN public.investigator_fit_profiles.investigator_id IS
  'The investigator; the row goes with the person.';
COMMENT ON COLUMN public.investigator_fit_profiles.taxonomy_version IS
  'src/lib/fit/taxonomy.json version the aggregate used; a row whose version differs from the current one is due a rebuild.';
COMMENT ON COLUMN public.investigator_fit_profiles.profile IS
  'InvestigatorFitProfile (src/lib/fit/types.ts): paradigm {career, recent}, unit, design, materials, objective, topic, characteristics, aspirations, do_not_suggest, evidence_summary, provenance, collaborators.';
COMMENT ON COLUMN public.investigator_fit_profiles.confidence IS
  'AxisConfidence: low | medium | high per axis (paradigm, unit, design, materials, objective) and topic, from evidence mass and distinct sources (taxonomy aggregation.confidence). Duplicates profile.confidence for filtering.';
COMMENT ON COLUMN public.investigator_fit_profiles.item_count IS
  'Evidence items the aggregate was computed over.';
COMMENT ON COLUMN public.investigator_fit_profiles.computed_at IS
  'When the profile was built. The nightly run rebuilds rows older than its refresh window, rows older than the newest source refresh, and rows on an old taxonomy version.';

CREATE INDEX IF NOT EXISTS idx_investigator_fit_profiles_computed_at
  ON public.investigator_fit_profiles (computed_at);

ALTER TABLE public.investigator_fit_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS investigator_fit_profiles_all_authenticated ON public.investigator_fit_profiles;
CREATE POLICY investigator_fit_profiles_all_authenticated ON public.investigator_fit_profiles
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
