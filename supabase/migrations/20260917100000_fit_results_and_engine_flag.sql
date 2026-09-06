-- PR 2.2 · Retrieval, orchestration, feature flag.
--
-- Three things:
--
--   teams.fit_engine     the per-team feature flag ('legacy' | 'fit-v1'). The
--                        three surfaces — the investigator page's "Opportunities
--                        that fit", Outreach suggestions (runSuggestions) and the
--                        community fits cache — read the acting team's value and
--                        serve fit_results under 'fit-v1'; under 'legacy' the
--                        embedding engine runs unchanged. Default 'legacy'; a
--                        person flips a team by hand (plan: human checkpoint
--                        "before PR 2.2's flag is flipped for any team").
--
--   fit_results          one row per scored investigator–notice pair: the pure
--                        engine's FitResult (src/lib/fit/types.ts) — nine
--                        components, the caps that bound the tier, the ordering
--                        score S, the tier by floors and caps, provenance per
--                        stage, rationale, gap and "Why not?" — written by the
--                        nightly /api/cron/fit-results sweep (src/lib/fit/service.ts)
--                        over the retrieval candidates (spec §7 stage 1: open
--                        notices passing E and P ≥ paradigm.gates.poor_below
--                        from the stored profiles, plus the embedding recall
--                        net). Pairs outside the candidate set have no row. Read
--                        by page renders — never computed there. Stage 8 (PR 3.1)
--                        fills `adjudication` and may replace `rationale`.
--
--   fit_topic_idf        inverse document frequency of MeSH tree-number prefixes
--                        and RCDC categories over the open-notice corpus (spec §11
--                        rule 2), refreshed by the same nightly run before the
--                        sweep and read into the engine's IdfTable (a code the
--                        table does not know takes the `unknown` weight, the
--                        rarest one).
--
-- Written, never applied by a script (CLAUDE.md); the coordinator applies it
-- before the merge deploys. Every statement is idempotent.

-- ---------------------------------------------------------------------------
-- teams.fit_engine
-- ---------------------------------------------------------------------------

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS fit_engine TEXT NOT NULL DEFAULT 'legacy'
    CHECK (fit_engine IN ('legacy', 'fit-v1'));

COMMENT ON COLUMN public.teams.fit_engine IS
  'Which matching engine this team''s surfaces read (PR 2.2 feature flag): legacy = the embedding suggestion engine (SIM thresholds); fit-v1 = fit_results from the structured fit engine (spec §7–§10). Default legacy; flipped by hand per team after the Phase 2 checkpoints.';

-- ---------------------------------------------------------------------------
-- fit_results
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.fit_results (
  investigator_id UUID NOT NULL REFERENCES public.investigators (id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES public.funding_opportunities (id) ON DELETE CASCADE,
  engine_version TEXT NOT NULL,
  components JSONB NOT NULL,
  caps TEXT[] NOT NULL DEFAULT '{}',
  score NUMERIC NOT NULL,
  tier TEXT NOT NULL,
  provenance JSONB NOT NULL,
  adjudication JSONB,
  rationale TEXT,
  why_not TEXT,
  gap TEXT,
  flags TEXT[] NOT NULL DEFAULT '{}',
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (investigator_id, opportunity_id)
);

-- Columns added after the first draft, for a database that took it.
ALTER TABLE public.fit_results ADD COLUMN IF NOT EXISTS gap TEXT;
ALTER TABLE public.fit_results ADD COLUMN IF NOT EXISTS flags TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON TABLE public.fit_results IS
  'Scored investigator–notice pairs (PR 2.2, spec §7–§10): the pure engine''s FitResult per retrieval candidate, refreshed nightly by /api/cron/fit-results. Read by the three surfaces under teams.fit_engine = fit-v1; never computed in a page render.';
COMMENT ON COLUMN public.fit_results.investigator_id IS
  'The investigator; the row goes with the person.';
COMMENT ON COLUMN public.fit_results.opportunity_id IS
  'The notice; the row goes with the notice. Only open notices with an opportunity_fit_profiles row are scored.';
COMMENT ON COLUMN public.fit_results.engine_version IS
  'src/lib/fit/taxonomy.json version the pair was scored under (the flag value, fit-v1); provenance.engine carries the engine module version (ENGINE_VERSION). A row on another version is recomputed by the next sweep.';
COMMENT ON COLUMN public.fit_results.components IS
  'Components: E P U D T M O K A, each in [0, 1] (E is 0 or 1) — spec §8.';
COMMENT ON COLUMN public.fit_results.caps IS
  'CapId[]: every reason the tier was capped (paradigm_gate, unit_gate, design_required_unsupported, eligibility_unknown, low_profile_confidence, low_notice_confidence, readiness_far, runway_short, paradigm_gate_relaxed_*) — spec §9.';
COMMENT ON COLUMN public.fit_results.score IS
  'S = 100 · E · P · D^0.75 · U^0.5 · R — orders, never labels (spec §8).';
COMMENT ON COLUMN public.fit_results.tier IS
  'strong | moderate | exploratory | poor — the worst of the floor tier and every cap (spec §10). Poor rows are kept for "Why not?".';
COMMENT ON COLUMN public.fit_results.provenance IS
  'FitProvenance (src/lib/fit/types.ts) per stage — the best-supporting pairs, unmet design groups, the compatible items and coded matches that carried T, met and missing capabilities, mechanisms held, floors missed — plus `engine` (ENGINE_VERSION).';
COMMENT ON COLUMN public.fit_results.adjudication IS
  'Stage 8 verdicts (PR 3.1): blind pass, skeptic and reconciliation; NULL until then.';
COMMENT ON COLUMN public.fit_results.rationale IS
  'One clause per component from provenance (engine/explain.ts); stage 8 may replace it.';
COMMENT ON COLUMN public.fit_results.why_not IS
  'The one-line explanation for a Poor pair (spec §10).';
COMMENT ON COLUMN public.fit_results.gap IS
  'The gap sentence shown first on an Exploratory item — each missed floor of the next tier and each cap, naming the fix (spec §10).';
COMMENT ON COLUMN public.fit_results.flags IS
  'Human-readable flags for the rationale ("ESI status not on file", "notice prohibits the dominant design").';
COMMENT ON COLUMN public.fit_results.computed_at IS
  'When the pair was scored (the ScoreContext `now` the engine stamped).';

CREATE INDEX IF NOT EXISTS idx_fit_results_opportunity_tier
  ON public.fit_results (opportunity_id, tier);
CREATE INDEX IF NOT EXISTS idx_fit_results_investigator_score
  ON public.fit_results (investigator_id, score DESC);

ALTER TABLE public.fit_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fit_results_all_authenticated ON public.fit_results;
CREATE POLICY fit_results_all_authenticated ON public.fit_results
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- fit_topic_idf
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.fit_topic_idf (
  code TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('mesh', 'rcdc')),
  df INTEGER NOT NULL,
  n INTEGER NOT NULL,
  idf NUMERIC NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.fit_topic_idf IS
  'Inverse document frequency of topic codes over the open-notice corpus (PR 2.2, spec §11 rule 2): every ancestor prefix of every MeSH tree number a notice profile carries, and every RCDC category name. Refreshed nightly by /api/cron/fit-results before the sweep; read into the engine''s IdfTable (src/lib/fit/topic/idf.ts).';
COMMENT ON COLUMN public.fit_topic_idf.code IS
  'A MeSH tree-number prefix (C04, C04.557, C04.557.470 …) or an RCDC category name as RePORTER spells it.';
COMMENT ON COLUMN public.fit_topic_idf.kind IS
  'mesh | rcdc.';
COMMENT ON COLUMN public.fit_topic_idf.df IS
  'Open notices (with a fit profile) whose codes are at or under this prefix, or that carry this RCDC category; a notice counts once per code.';
COMMENT ON COLUMN public.fit_topic_idf.n IS
  'Open notices with a fit profile at the time of the refresh — the corpus size.';
COMMENT ON COLUMN public.fit_topic_idf.idf IS
  'ln((n + 1) / (df + 1)): 0 for a code every notice carries, largest for a code in one notice. A code absent from the table takes the df = 1 value (IdfTable.unknown).';
COMMENT ON COLUMN public.fit_topic_idf.computed_at IS
  'When the refresh wrote the row; rows an older refresh wrote and the newest did not touch are deleted by it.';

CREATE INDEX IF NOT EXISTS idx_fit_topic_idf_kind
  ON public.fit_topic_idf (kind);

ALTER TABLE public.fit_topic_idf ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fit_topic_idf_all_authenticated ON public.fit_topic_idf;
CREATE POLICY fit_topic_idf_all_authenticated ON public.fit_topic_idf
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
