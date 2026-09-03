-- Step 7 · Institutional layer (UCSF-wide, shared across all teams)
--
--  * curated_opportunities: Internal (UCSF) funding records and curated
--    non-federal notices entered by Curators. Never mixed into the federal
--    catalog; provenance is required to publish; "Needs review" is derived
--    from review_by; records auto-hide after their application deadline.
--  * limited_submission_overlays: UCSF nomination process keyed to a synced
--    federal notice (or a curated non-federal notice). Members express
--    interest; curators track nominations against the institutional cap.
--  * library_items (+ versions, flags, events): the proposal library with
--    trust tiers (osr | curated | community), steward review, review dates,
--    full-text and semantic search.
--  * osr_awards / osr_declines: award history. Awards are readable by every
--    signed-in user; declines are never readable directly — only counted
--    through the SECURITY DEFINER aggregate `osr_success_rates`.
--  * institution_rates / reference_success_rates: OSR rate agreement figures
--    and NIH-wide reference rates maintained by Library stewards.
--  * institution_audit_log: publish/unpublish, imports, role grants.
--  * Institution roles live on profiles.institution_roles ('curator',
--    'library_steward'); helper `has_institution_role` for RLS.

-- ---------------------------------------------------------------------------
-- Role helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_institution_role(role_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role_name = ANY (COALESCE(institution_roles, '{}'))
  );
$$;

CREATE TABLE IF NOT EXISTS public.institution_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID,
  action TEXT NOT NULL,
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_name TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS institution_audit_log_entity_idx ON public.institution_audit_log (entity_type, entity_id, created_at DESC);
ALTER TABLE public.institution_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit log readable by curators and stewards" ON public.institution_audit_log;
CREATE POLICY "audit log readable by curators and stewards" ON public.institution_audit_log
  FOR SELECT TO authenticated USING (public.has_institution_role('curator') OR public.has_institution_role('library_steward'));

-- ---------------------------------------------------------------------------
-- Curated opportunities (Internal scope + curated non-federal notices)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.curated_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL DEFAULT 'internal' CHECK (kind IN ('internal', 'nonfederal')),
  title TEXT NOT NULL,
  funder TEXT,
  award_summary TEXT,
  application_due DATE,
  loi_due DATE,
  eligibility TEXT,
  review_process TEXT CHECK (review_process IS NULL OR review_process IN ('committee_scored', 'program_director', 'external_reviewers')),
  contact_name TEXT,
  contact_email TEXT,
  program_url TEXT,
  sponsor_notice_number TEXT,
  -- provenance (required to publish)
  source_kind TEXT CHECK (source_kind IS NULL OR source_kind IN ('program_office', 'rap', 'infoready', 'email', 'sponsor_site')),
  source_url TEXT,
  verified_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  verified_by_name TEXT,
  verified_at TIMESTAMPTZ,
  review_by DATE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at TIMESTAMPTZ,
  published_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  needs_review_notified_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS curated_opportunities_status_idx ON public.curated_opportunities (kind, status, application_due);
ALTER TABLE public.curated_opportunities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "curated records: published to everyone, drafts to curators" ON public.curated_opportunities;
CREATE POLICY "curated records: published to everyone, drafts to curators" ON public.curated_opportunities
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND (status = 'published' OR public.has_institution_role('curator')));

-- ---------------------------------------------------------------------------
-- Limited-submission overlays + expressions of interest
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.limited_submission_overlays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID REFERENCES public.funding_opportunities(id) ON DELETE CASCADE,
  curated_opportunity_id UUID REFERENCES public.curated_opportunities(id) ON DELETE CASCADE,
  internal_due DATE,
  cap INTEGER CHECK (cap IS NULL OR cap >= 0),
  nominated_count INTEGER NOT NULL DEFAULT 0 CHECK (nominated_count >= 0),
  interest_count INTEGER NOT NULL DEFAULT 0 CHECK (interest_count >= 0),
  process TEXT,
  infoready_url TEXT,
  source_kind TEXT CHECK (source_kind IS NULL OR source_kind IN ('program_office', 'rap', 'infoready', 'email', 'sponsor_site')),
  source_url TEXT,
  verified_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  verified_by_name TEXT,
  verified_at TIMESTAMPTZ,
  review_by DATE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at TIMESTAMPTZ,
  published_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  needs_review_notified_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT limited_overlay_one_notice CHECK ((opportunity_id IS NOT NULL)::int + (curated_opportunity_id IS NOT NULL)::int = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS limited_overlays_opportunity_uniq ON public.limited_submission_overlays (opportunity_id) WHERE opportunity_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS limited_overlays_curated_uniq ON public.limited_submission_overlays (curated_opportunity_id) WHERE curated_opportunity_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS limited_overlays_due_idx ON public.limited_submission_overlays (status, internal_due);
ALTER TABLE public.limited_submission_overlays ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "overlays: published to everyone, drafts to curators" ON public.limited_submission_overlays;
CREATE POLICY "overlays: published to everyone, drafts to curators" ON public.limited_submission_overlays
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND (status = 'published' OR public.has_institution_role('curator')));

CREATE TABLE IF NOT EXISTS public.limited_submission_interests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  overlay_id UUID NOT NULL REFERENCES public.limited_submission_overlays(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  withdrawn_at TIMESTAMPTZ,
  UNIQUE (overlay_id, user_id)
);
ALTER TABLE public.limited_submission_interests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "interests: own rows, curators see all" ON public.limited_submission_interests;
CREATE POLICY "interests: own rows, curators see all" ON public.limited_submission_interests
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_institution_role('curator'));

-- ---------------------------------------------------------------------------
-- OSR awards & declines
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.osr_awards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL CHECK (source IN ('osr', 'reporter')),
  external_id TEXT NOT NULL,
  award_number TEXT,
  core_project_num TEXT,
  title TEXT NOT NULL,
  pi_name TEXT,
  pi_investigator_id UUID REFERENCES public.investigators(id) ON DELETE SET NULL,
  department TEXT,
  division TEXT,
  sponsor TEXT,
  institute TEXT,
  mechanism TEXT,
  application_type TEXT,
  is_resubmission BOOLEAN,
  fiscal_year INTEGER,
  award_date DATE,
  receipt_date DATE,
  project_start DATE,
  project_end DATE,
  direct_cost NUMERIC,
  total_cost NUMERIC,
  abstract TEXT,
  reporter_url TEXT,
  raw JSONB,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  import_batch_id UUID,
  UNIQUE (source, external_id)
);
CREATE INDEX IF NOT EXISTS osr_awards_mech_inst_fy_idx ON public.osr_awards (mechanism, institute, fiscal_year DESC);
CREATE INDEX IF NOT EXISTS osr_awards_core_idx ON public.osr_awards (core_project_num);
CREATE INDEX IF NOT EXISTS osr_awards_dept_idx ON public.osr_awards (department);
CREATE INDEX IF NOT EXISTS osr_awards_award_date_idx ON public.osr_awards (award_date DESC NULLS LAST);
ALTER TABLE public.osr_awards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "awards readable by signed-in users" ON public.osr_awards;
CREATE POLICY "awards readable by signed-in users" ON public.osr_awards FOR SELECT TO authenticated USING (true);

-- Declines: never readable directly. Counted through osr_success_rates only.
CREATE TABLE IF NOT EXISTS public.osr_declines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL DEFAULT 'osr' CHECK (source IN ('osr')),
  external_id TEXT NOT NULL,
  pi_name TEXT,
  pi_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  department TEXT,
  division TEXT,
  sponsor TEXT,
  institute TEXT,
  mechanism TEXT,
  application_type TEXT,
  is_resubmission BOOLEAN,
  fiscal_year INTEGER,
  submitted_date DATE,
  decided_date DATE,
  raw JSONB,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  import_batch_id UUID,
  UNIQUE (source, external_id)
);
CREATE INDEX IF NOT EXISTS osr_declines_mech_inst_fy_idx ON public.osr_declines (mechanism, institute, fiscal_year DESC);
ALTER TABLE public.osr_declines ENABLE ROW LEVEL SECURITY;
-- (no SELECT policy on purpose)

CREATE TABLE IF NOT EXISTS public.osr_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('osr_export', 'reporter_sync')),
  file_name TEXT,
  awards_upserted INTEGER NOT NULL DEFAULT 0,
  declines_upserted INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  fiscal_years INTEGER[] NOT NULL DEFAULT '{}',
  imported_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  imported_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.osr_import_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "import batches readable by signed-in users" ON public.osr_import_batches;
CREATE POLICY "import batches readable by signed-in users" ON public.osr_import_batches FOR SELECT TO authenticated USING (true);

-- Aggregate-only success rates. Filters are optional; NULL matches everything.
CREATE OR REPLACE FUNCTION public.osr_success_rates(
  p_mechanism TEXT DEFAULT NULL,
  p_institute TEXT DEFAULT NULL,
  p_department TEXT DEFAULT NULL,
  p_sponsor TEXT DEFAULT NULL,
  p_fy_from INTEGER DEFAULT NULL,
  p_fy_to INTEGER DEFAULT NULL
)
RETURNS TABLE (
  bucket TEXT,
  funded BIGINT,
  declined BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH a AS (
    SELECT CASE WHEN is_resubmission THEN 'resubmission' ELSE 'first' END AS bucket, count(*)::bigint AS n
    FROM public.osr_awards
    WHERE source = 'osr'
      AND (p_mechanism IS NULL OR mechanism = p_mechanism)
      AND (p_institute IS NULL OR institute = p_institute)
      AND (p_department IS NULL OR department = p_department)
      AND (p_sponsor IS NULL OR sponsor = p_sponsor)
      AND (p_fy_from IS NULL OR fiscal_year >= p_fy_from)
      AND (p_fy_to IS NULL OR fiscal_year <= p_fy_to)
      AND COALESCE(application_type, '1') IN ('1', '2', '9', 'new', 'renewal', 'resubmission', 'competing')
    GROUP BY 1
  ), d AS (
    SELECT CASE WHEN is_resubmission THEN 'resubmission' ELSE 'first' END AS bucket, count(*)::bigint AS n
    FROM public.osr_declines
    WHERE (p_mechanism IS NULL OR mechanism = p_mechanism)
      AND (p_institute IS NULL OR institute = p_institute)
      AND (p_department IS NULL OR department = p_department)
      AND (p_sponsor IS NULL OR sponsor = p_sponsor)
      AND (p_fy_from IS NULL OR fiscal_year >= p_fy_from)
      AND (p_fy_to IS NULL OR fiscal_year <= p_fy_to)
    GROUP BY 1
  )
  SELECT b.bucket, COALESCE(a.n, 0) AS funded, COALESCE(d.n, 0) AS declined
  FROM (VALUES ('first'), ('resubmission')) AS b(bucket)
  LEFT JOIN a ON a.bucket = b.bucket
  LEFT JOIN d ON d.bucket = b.bucket;
$$;
REVOKE ALL ON FUNCTION public.osr_success_rates(TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER) FROM public;
GRANT EXECUTE ON FUNCTION public.osr_success_rates(TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER) TO authenticated, service_role;

-- Rate agreement figures and NIH-wide reference rates (steward-maintained).
CREATE TABLE IF NOT EXISTS public.institution_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  agreement_label TEXT,
  effective_from DATE,
  source_url TEXT,
  verified_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  verified_by_name TEXT,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.institution_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rates readable by signed-in users" ON public.institution_rates;
CREATE POLICY "rates readable by signed-in users" ON public.institution_rates FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.reference_success_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mechanism TEXT NOT NULL,
  fiscal_year INTEGER NOT NULL,
  rate NUMERIC NOT NULL CHECK (rate >= 0 AND rate <= 100),
  label TEXT NOT NULL DEFAULT 'NIH-wide',
  source_url TEXT,
  entered_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  entered_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (mechanism, fiscal_year, label)
);
ALTER TABLE public.reference_success_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reference rates readable by signed-in users" ON public.reference_success_rates;
CREATE POLICY "reference rates readable by signed-in users" ON public.reference_success_rates FOR SELECT TO authenticated USING (true);

-- ---------------------------------------------------------------------------
-- Proposal library
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.library_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('institutional_description', 'rates', 'specific_aims', 'research_strategy', 'dms_plan', 'letter_of_support', 'budget_justification', 'human_subjects')),
  sponsor TEXT,
  mechanism TEXT,
  department TEXT,
  funding_year TEXT,
  outcome TEXT CHECK (outcome IS NULL OR outcome IN ('funded', 'not_funded', 'template')),
  trust_tier TEXT NOT NULL DEFAULT 'community' CHECK (trust_tier IN ('osr', 'curated', 'community')),
  uploader_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  uploader_name TEXT,
  uploader_department TEXT,
  source_label TEXT,
  linked_award_number TEXT,
  linked_award_id UUID REFERENCES public.osr_awards(id) ON DELETE SET NULL,
  effective_date DATE,
  review_due DATE,
  last_confirmed_at TIMESTAMPTZ,
  last_confirmed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  last_confirmed_by_name TEXT,
  review_status TEXT NOT NULL DEFAULT 'pending_review' CHECK (review_status IN ('pending_review', 'published', 'changes_requested', 'removed')),
  steward_note TEXT,
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  reminder_sent_at TIMESTAMPTZ,
  excerpt TEXT,
  extracted_text TEXT,
  sensitive_findings JSONB,
  tags TEXT[] NOT NULL DEFAULT '{}',
  download_count INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  storage_path TEXT,
  file_name TEXT,
  file_size INTEGER,
  mime_type TEXT,
  consent_at TIMESTAMPTZ,
  embedding extensions.vector(1536),
  search_tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(excerpt, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(array_to_string(tags, ' '), '')), 'B') ||
    setweight(to_tsvector('english', left(coalesce(extracted_text, ''), 200000)), 'C')
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ,
  removed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS library_items_status_idx ON public.library_items (review_status, review_due);
CREATE INDEX IF NOT EXISTS library_items_facets_idx ON public.library_items (content_type, sponsor, mechanism, department);
CREATE INDEX IF NOT EXISTS library_items_tsv_idx ON public.library_items USING gin (search_tsv);
CREATE INDEX IF NOT EXISTS library_items_embedding_idx ON public.library_items USING hnsw (embedding extensions.vector_cosine_ops);
ALTER TABLE public.library_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "library: published to everyone, own and queue to stewards" ON public.library_items;
CREATE POLICY "library: published to everyone, own and queue to stewards" ON public.library_items
  FOR SELECT TO authenticated
  USING (
    (removed_at IS NULL AND review_status = 'published')
    OR uploader_id = auth.uid()
    OR public.has_institution_role('library_steward')
  );

CREATE TABLE IF NOT EXISTS public.library_item_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES public.library_items(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  storage_path TEXT,
  file_name TEXT,
  file_size INTEGER,
  mime_type TEXT,
  note TEXT,
  uploaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  uploaded_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (item_id, version)
);
ALTER TABLE public.library_item_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "versions follow their item" ON public.library_item_versions;
CREATE POLICY "versions follow their item" ON public.library_item_versions
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.library_items i WHERE i.id = item_id));

CREATE TABLE IF NOT EXISTS public.library_item_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES public.library_items(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('outdated', 'sensitive', 'wrong_metadata', 'other')),
  note TEXT,
  flagged_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  flagged_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolution TEXT
);
CREATE INDEX IF NOT EXISTS library_item_flags_open_idx ON public.library_item_flags (item_id) WHERE resolved_at IS NULL;
ALTER TABLE public.library_item_flags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "flags: own, item uploader, stewards" ON public.library_item_flags;
CREATE POLICY "flags: own, item uploader, stewards" ON public.library_item_flags
  FOR SELECT TO authenticated
  USING (flagged_by = auth.uid() OR public.has_institution_role('library_steward') OR EXISTS (SELECT 1 FROM public.library_items i WHERE i.id = item_id AND i.uploader_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.library_item_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES public.library_items(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('uploaded', 'submitted_for_review', 'published', 'changes_requested', 'confirmed', 'update_requested', 'flagged', 'flag_resolved', 'version_added', 'metadata_updated', 'reminder_sent', 'removed', 'restored')),
  text TEXT NOT NULL,
  actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS library_item_events_item_idx ON public.library_item_events (item_id, created_at DESC);
ALTER TABLE public.library_item_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "events follow their item" ON public.library_item_events;
CREATE POLICY "events follow their item" ON public.library_item_events
  FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.library_items i WHERE i.id = item_id));

-- Semantic search over published items (RLS applies: SECURITY INVOKER).
CREATE OR REPLACE FUNCTION public.match_library_items(
  query_embedding extensions.vector(1536),
  match_count INTEGER DEFAULT 40,
  similarity_floor DOUBLE PRECISION DEFAULT 0.2
)
RETURNS TABLE (item_id UUID, similarity DOUBLE PRECISION)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, extensions
SET statement_timeout = '8s'
AS $$
#variable_conflict use_column
BEGIN
  PERFORM set_config('hnsw.ef_search', '80', true);
  RETURN QUERY
  SELECT s.id, s.similarity
  FROM (
    SELECT li.id, 1 - (li.embedding <=> query_embedding) AS similarity
    FROM public.library_items li
    WHERE li.embedding IS NOT NULL AND li.removed_at IS NULL
    ORDER BY li.embedding <=> query_embedding
    LIMIT GREATEST(match_count, 1) * 2
  ) s
  WHERE s.similarity >= similarity_floor
  ORDER BY s.similarity DESC
  LIMIT GREATEST(match_count, 1);
END;
$$;
GRANT EXECUTE ON FUNCTION public.match_library_items(extensions.vector, INTEGER, DOUBLE PRECISION) TO authenticated, service_role;

-- Atomic download counter (service role only).
CREATE OR REPLACE FUNCTION public.increment_library_download(p_item_id UUID)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.library_items SET download_count = download_count + 1 WHERE id = p_item_id;
$$;
REVOKE ALL ON FUNCTION public.increment_library_download(UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.increment_library_download(UUID) TO service_role;

-- Private bucket for library originals (25 MB, PDF or Word).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('library', 'library', false, 26214400, ARRAY['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
ON CONFLICT (id) DO UPDATE SET file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Team-visible role grants are audited through institution_audit_log.
COMMENT ON COLUMN public.profiles.institution_roles IS 'UCSF-wide roles: curator, library_steward. Granted by team owners/admins; audited in institution_audit_log.';
