-- PR 2.4 · Gold set and metrics — a synthetic pair's labels enter fit_labels.
--
-- The gold set pairs two SYNTHETIC investigators (src/lib/fit/goldset/synthetic.ts:
-- adversarial-fixture cases standing in for the population and health-systems
-- families the ImmunoX roster lacks, D1) with real open notices. Their labels
-- had no home: fit_labels.investigator_id is a foreign key to investigators, and
-- a synthetic id (`synthetic:<case>`) names no roster row. This migration gives
-- them one — `synthetic_source`, the fixture case id, beside a NULL
-- investigator_id — and rewrites the subject CHECK so that
--   · a synthetic row has opportunity_id and synthetic_source and NO investigator_id;
--   · any other row has at least one of investigator_id / opportunity_id, as
--     before (a profile flag from the inspector names only one of them);
--   · no row carries both an investigator_id and a synthetic_source.
-- investigator_id is already nullable in 20260916100000_fit_labels.sql (the
-- inspector's notice-only flags need it); the guarded block below acts only on
-- a database where it drifted. Idempotent; RLS untouched (the existing policy
-- covers the new column).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fit_labels' AND column_name = 'investigator_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.fit_labels ALTER COLUMN investigator_id DROP NOT NULL;
  END IF;
END $$;

ALTER TABLE public.fit_labels ADD COLUMN IF NOT EXISTS synthetic_source TEXT;

COMMENT ON COLUMN public.fit_labels.synthetic_source IS
  'gold-set synthetic investigator: the adversarial fixture case id; `investigator_id` is NULL for these rows';
COMMENT ON COLUMN public.fit_labels.investigator_id IS
  'The investigator the label is about; NULL for a notice-only profile flag and for a gold-set synthetic investigator (see synthetic_source). A pair''s investigator is named by exactly one of investigator_id / synthetic_source.';

ALTER TABLE public.fit_labels DROP CONSTRAINT IF EXISTS fit_labels_subject_check;
ALTER TABLE public.fit_labels ADD CONSTRAINT fit_labels_subject_check CHECK (
  (synthetic_source IS NULL AND (investigator_id IS NOT NULL OR opportunity_id IS NOT NULL))
  OR (synthetic_source IS NOT NULL AND investigator_id IS NULL AND opportunity_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_fit_labels_synthetic_source
  ON public.fit_labels (synthetic_source, opportunity_id)
  WHERE synthetic_source IS NOT NULL;
