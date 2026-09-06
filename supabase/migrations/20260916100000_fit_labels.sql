-- PR 1.6 · Profile inspector — fit_labels (plan § PR 2.4 schema, created here
-- because the inspector's "flag as wrong" button is its first writer).
--
-- One row per human label about a fit profile or an investigator–notice pair:
--   source = 'profile_flag'  the inspector (PR 1.6): a strategist says an axis or
--                            category of a stored profile is wrong. investigator_id
--                            OR opportunity_id is set; tier is NULL; axis_reason is
--                            "<axis>" or "<axis>:<category>" (NULL = the whole
--                            profile); reason is the free text.
--   source = 'gold'          the labeled gold set (PR 2.4): both ids, tier set.
--   source = 'override'      a strategist overriding an engine tier (PR 3.x).
--   source = 'dismissal'     a dismissal with its reason (PR 3.2).
-- labeler is the auth user who wrote the row; engine_version is the taxonomy
-- version (profile flags) or the engine version (tier labels) at the time.
-- Rows are append-only evidence: a flag is never edited, a later row supersedes.

CREATE TABLE IF NOT EXISTS public.fit_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investigator_id UUID REFERENCES public.investigators (id) ON DELETE CASCADE,
  opportunity_id UUID REFERENCES public.funding_opportunities (id) ON DELETE CASCADE,
  tier TEXT,
  reason TEXT,
  axis_reason TEXT,
  labeler UUID,
  engine_version TEXT,
  source TEXT NOT NULL CHECK (source IN ('gold', 'override', 'profile_flag', 'dismissal')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fit_labels_subject_check CHECK (investigator_id IS NOT NULL OR opportunity_id IS NOT NULL)
);

COMMENT ON TABLE public.fit_labels IS
  'Human labels about fit profiles and investigator–notice pairs (plan § PR 2.4): profile flags from the inspector (PR 1.6), gold-set tiers, strategist overrides and dismissals. Append-only.';
COMMENT ON COLUMN public.fit_labels.investigator_id IS
  'The investigator the label is about; NULL for a notice-only profile flag. At least one of investigator_id / opportunity_id is set.';
COMMENT ON COLUMN public.fit_labels.opportunity_id IS
  'The notice the label is about; NULL for an investigator-only profile flag.';
COMMENT ON COLUMN public.fit_labels.tier IS
  'The labeled tier (strong | moderate | exploratory | poor) for gold, override and dismissal rows; NULL for profile flags.';
COMMENT ON COLUMN public.fit_labels.reason IS
  'Free text from the labeler (≤ 1,000 characters for profile flags).';
COMMENT ON COLUMN public.fit_labels.axis_reason IS
  'Which part of the profile is wrong: "<axis>" or "<axis>:<category>" with axis in paradigm | unit | design | materials | objective | topic and category a taxonomy id; NULL when the flag is about the whole profile.';
COMMENT ON COLUMN public.fit_labels.labeler IS
  'auth.users id of the person who wrote the row (profiles.id).';
COMMENT ON COLUMN public.fit_labels.engine_version IS
  'src/lib/fit/taxonomy.json version (profile flags) or the engine version (tier labels) current when the row was written.';
COMMENT ON COLUMN public.fit_labels.source IS
  'gold | override | profile_flag | dismissal — who produced the label and why.';
COMMENT ON COLUMN public.fit_labels.created_at IS
  'When the row was written.';

CREATE INDEX IF NOT EXISTS idx_fit_labels_investigator
  ON public.fit_labels (investigator_id);

CREATE INDEX IF NOT EXISTS idx_fit_labels_opportunity
  ON public.fit_labels (opportunity_id);

ALTER TABLE public.fit_labels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fit_labels_all_authenticated ON public.fit_labels;
CREATE POLICY fit_labels_all_authenticated ON public.fit_labels
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
