-- v2 step 4 — Investigator sources model.
--
-- One row per (investigator, source) for RePORTER, PubMed, Biosketch, ORCID and
-- UCSF Profiles: state, item count, freshness, how the identity was matched,
-- and (for biosketches) the authorization record. Per-item identity methods
-- live on the cache tables so evidence can cite how each item was matched.

-- ---------------------------------------------------------------------------
-- investigators: connector identifiers + soft delete (Undo)
-- ---------------------------------------------------------------------------
ALTER TABLE public.investigators
  ADD COLUMN IF NOT EXISTS profiles_url_name TEXT,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID;

CREATE INDEX IF NOT EXISTS idx_investigators_archived_at
  ON public.investigators (archived_at)
  WHERE archived_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- investigator_sources
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.investigator_sources (
  investigator_id UUID NOT NULL REFERENCES public.investigators (id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('reporter', 'pubmed', 'biosketch', 'orcid', 'profiles')),
  -- Write-time state. Freshness (stale / updated this week) is derived from
  -- last_refreshed_at when read, so it never goes out of date.
  state TEXT NOT NULL DEFAULT 'unavailable'
    CHECK (state IN ('available', 'unavailable', 'error', 'not_requested', 'requested', 'on_file', 'declined', 'revoked')),
  item_count INTEGER NOT NULL DEFAULT 0,
  -- Items matched by name only and not yet confirmed or rejected.
  unverified_count INTEGER NOT NULL DEFAULT 0,
  -- How this source is tied to the person.
  identity_method TEXT
    CHECK (identity_method IN ('profile_id', 'orcid', 'affiliation', 'profiles', 'name_only', 'manual', 'self')),
  external_id TEXT,
  external_url TEXT,
  last_refreshed_at TIMESTAMPTZ,
  last_attempted_at TIMESTAMPTZ,
  last_error TEXT,
  -- Biosketch authorization record.
  document_date DATE,
  written_for TEXT,
  authorized_at TIMESTAMPTZ,
  authorized_by TEXT,
  revoked_at TIMESTAMPTZ,
  requested_at TIMESTAMPTZ,
  requested_by UUID,
  reminder_sent_at TIMESTAMPTZ,
  declined_at TIMESTAMPTZ,
  request_token TEXT,
  storage_path TEXT,
  personal_statement TEXT,
  contributions JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Source-specific extras (Profiles keywords and URL, ORCID works, notes).
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (investigator_id, source)
);

CREATE UNIQUE INDEX IF NOT EXISTS investigator_sources_request_token_uniq
  ON public.investigator_sources (request_token)
  WHERE request_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_investigator_sources_source_state
  ON public.investigator_sources (source, state);

ALTER TABLE public.investigator_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS investigator_sources_all_authenticated ON public.investigator_sources;
CREATE POLICY investigator_sources_all_authenticated ON public.investigator_sources
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Per-item identity method + review status on the evidence caches
-- ---------------------------------------------------------------------------
ALTER TABLE public.investigator_publications
  ADD COLUMN IF NOT EXISTS identity_method TEXT NOT NULL DEFAULT 'affiliation'
    CHECK (identity_method IN ('affiliation', 'orcid', 'profiles', 'profile_id', 'name_only', 'manual')),
  ADD COLUMN IF NOT EXISTS identity_status TEXT NOT NULL DEFAULT 'verified'
    CHECK (identity_status IN ('verified', 'unverified', 'rejected')),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID;

ALTER TABLE public.investigator_nih_grants
  ADD COLUMN IF NOT EXISTS identity_method TEXT NOT NULL DEFAULT 'profile_id'
    CHECK (identity_method IN ('affiliation', 'orcid', 'profiles', 'profile_id', 'name_only', 'manual')),
  ADD COLUMN IF NOT EXISTS identity_status TEXT NOT NULL DEFAULT 'verified'
    CHECK (identity_status IN ('verified', 'unverified', 'rejected')),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID;

ALTER TABLE public.investigator_clinical_trials
  ADD COLUMN IF NOT EXISTS identity_method TEXT NOT NULL DEFAULT 'affiliation'
    CHECK (identity_method IN ('affiliation', 'orcid', 'profiles', 'profile_id', 'name_only', 'manual')),
  ADD COLUMN IF NOT EXISTS identity_status TEXT NOT NULL DEFAULT 'verified'
    CHECK (identity_status IN ('verified', 'unverified', 'rejected')),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID;

-- Existing rows: the PubMed ingest only kept affiliation-verified hits
-- (match_confidence = high). Anything weaker is name-only and unverified.
UPDATE public.investigator_publications
SET identity_method = 'name_only', identity_status = 'unverified'
WHERE match_confidence <> 'high';

CREATE INDEX IF NOT EXISTS idx_investigator_publications_identity
  ON public.investigator_publications (investigator_id, identity_status);

-- ---------------------------------------------------------------------------
-- Backfill source rows from what the caches already hold
-- ---------------------------------------------------------------------------
INSERT INTO public.investigator_sources
  (investigator_id, source, state, item_count, identity_method, external_id, last_refreshed_at)
SELECT
  i.id,
  'reporter',
  CASE WHEN NULLIF(btrim(i.nih_profile_id), '') IS NULL THEN 'unavailable' ELSE 'available' END,
  count(g.id),
  CASE WHEN NULLIF(btrim(i.nih_profile_id), '') IS NULL THEN NULL ELSE 'profile_id' END,
  NULLIF(btrim(i.nih_profile_id), ''),
  max(g.updated_at)
FROM public.investigators i
LEFT JOIN public.investigator_nih_grants g ON g.investigator_id = i.id
GROUP BY i.id
ON CONFLICT (investigator_id, source) DO NOTHING;

INSERT INTO public.investigator_sources
  (investigator_id, source, state, item_count, unverified_count, identity_method, last_refreshed_at)
SELECT
  i.id,
  'pubmed',
  CASE WHEN count(p.id) = 0 THEN 'unavailable' ELSE 'available' END,
  count(p.id) FILTER (WHERE p.identity_status = 'verified'),
  count(p.id) FILTER (WHERE p.identity_status = 'unverified'),
  CASE WHEN count(p.id) = 0 THEN NULL ELSE 'affiliation' END,
  max(p.updated_at)
FROM public.investigators i
LEFT JOIN public.investigator_publications p ON p.investigator_id = i.id
GROUP BY i.id
ON CONFLICT (investigator_id, source) DO NOTHING;

INSERT INTO public.investigator_sources (investigator_id, source, state)
SELECT i.id, 'biosketch', 'not_requested'
FROM public.investigators i
ON CONFLICT (investigator_id, source) DO NOTHING;

INSERT INTO public.investigator_sources (investigator_id, source, state, identity_method, external_id)
SELECT
  i.id,
  'orcid',
  'unavailable',
  CASE WHEN NULLIF(btrim(i.orcid), '') IS NULL THEN NULL ELSE 'self' END,
  NULLIF(btrim(i.orcid), '')
FROM public.investigators i
ON CONFLICT (investigator_id, source) DO NOTHING;

INSERT INTO public.investigator_sources (investigator_id, source, state)
SELECT i.id, 'profiles', 'unavailable'
FROM public.investigators i
ON CONFLICT (investigator_id, source) DO NOTHING;

-- Every new investigator gets the five rows so the directory never has to
-- special-case a missing row.
CREATE OR REPLACE FUNCTION public.seed_investigator_sources()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.investigator_sources (investigator_id, source, state, identity_method, external_id)
  VALUES
    (NEW.id, 'reporter', CASE WHEN NULLIF(btrim(NEW.nih_profile_id), '') IS NULL THEN 'unavailable' ELSE 'available' END,
      CASE WHEN NULLIF(btrim(NEW.nih_profile_id), '') IS NULL THEN NULL ELSE 'profile_id' END, NULLIF(btrim(NEW.nih_profile_id), '')),
    (NEW.id, 'pubmed', 'unavailable', NULL, NULL),
    (NEW.id, 'biosketch', 'not_requested', NULL, NULL),
    (NEW.id, 'orcid', 'unavailable', CASE WHEN NULLIF(btrim(NEW.orcid), '') IS NULL THEN NULL ELSE 'self' END, NULLIF(btrim(NEW.orcid), '')),
    (NEW.id, 'profiles', 'unavailable', NULL, NEW.profiles_url_name)
  ON CONFLICT (investigator_id, source) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS investigators_seed_sources ON public.investigators;
CREATE TRIGGER investigators_seed_sources
  AFTER INSERT ON public.investigators
  FOR EACH ROW EXECUTE FUNCTION public.seed_investigator_sources();

-- Private bucket for authorized biosketch PDFs (created by an earlier
-- migration; re-asserted here so a fresh project gets it too).
INSERT INTO storage.buckets (id, name, public)
VALUES ('biosketches', 'biosketches', false)
ON CONFLICT (id) DO NOTHING;
