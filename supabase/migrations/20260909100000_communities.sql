-- Step 8 · Communities v2 (monitored partner communities)
--
--  * pipeline_communities gains the curated profile from the README data model
--    (mission, focus, keywords, populations, active flag), the people on the
--    Communities screen (RD strategist, listserv), the generated strategy brief,
--    and a `monitored` flag (the legacy "Other" bucket is not a community).
--  * community_members is the roster (many-to-many, with lead/member roles).
--    investigators.research_community_id stays as the "primary community" for
--    the directory and suggestion engine; triggers keep both in sync.
--  * community_fits caches "open opportunities that fit this community"
--    (member embeddings × open notices), refreshed nightly and on demand.
--  * saved_funding_searches.community_id links a team's saved search to a
--    community ("Saved searches for this community").

ALTER TABLE public.pipeline_communities
  ADD COLUMN IF NOT EXISTS mission TEXT,
  ADD COLUMN IF NOT EXISTS focus TEXT,
  ADD COLUMN IF NOT EXISTS keywords TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS populations TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS monitored BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS strategist_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS listserv TEXT,
  ADD COLUMN IF NOT EXISTS brief_text TEXT,
  ADD COLUMN IF NOT EXISTS brief_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS brief_generated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS brief_model TEXT,
  ADD COLUMN IF NOT EXISTS brief_inputs JSONB,
  ADD COLUMN IF NOT EXISTS fits_refreshed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE public.pipeline_communities SET monitored = false WHERE slug = 'other';

-- ---------------------------------------------------------------------------
-- Roster
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.community_members (
  community_id UUID NOT NULL REFERENCES public.pipeline_communities(id) ON DELETE CASCADE,
  investigator_id UUID NOT NULL REFERENCES public.investigators(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('lead', 'member')),
  added_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, investigator_id)
);
CREATE INDEX IF NOT EXISTS community_members_investigator_idx ON public.community_members (investigator_id);
ALTER TABLE public.community_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "community members readable by signed-in users" ON public.community_members;
CREATE POLICY "community members readable by signed-in users" ON public.community_members FOR SELECT TO authenticated USING (true);

-- Backfill from the single-valued column (every monitored community).
INSERT INTO public.community_members (community_id, investigator_id, role)
SELECT i.research_community_id, i.id, 'member'
FROM public.investigators i
JOIN public.pipeline_communities c ON c.id = i.research_community_id
WHERE c.monitored
ON CONFLICT DO NOTHING;

-- Keep investigators.research_community_id (primary community) in step with the roster.
CREATE OR REPLACE FUNCTION public.community_members_sync_primary()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_next UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.investigators SET research_community_id = NEW.community_id
    WHERE id = NEW.investigator_id
      AND (research_community_id IS NULL OR research_community_id IN (SELECT id FROM public.pipeline_communities WHERE NOT monitored));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT community_id INTO v_next FROM public.community_members
    WHERE investigator_id = OLD.investigator_id AND community_id <> OLD.community_id
    ORDER BY added_at LIMIT 1;
    UPDATE public.investigators SET research_community_id = v_next
    WHERE id = OLD.investigator_id AND research_community_id = OLD.community_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS community_members_sync_primary ON public.community_members;
CREATE TRIGGER community_members_sync_primary
  AFTER INSERT OR DELETE ON public.community_members
  FOR EACH ROW EXECUTE FUNCTION public.community_members_sync_primary();

-- The investigator form still sets research_community_id directly: mirror it into the roster.
CREATE OR REPLACE FUNCTION public.investigators_sync_membership()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.research_community_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.research_community_id IS DISTINCT FROM OLD.research_community_id)
     AND EXISTS (SELECT 1 FROM public.pipeline_communities c WHERE c.id = NEW.research_community_id AND c.monitored) THEN
    INSERT INTO public.community_members (community_id, investigator_id, role)
    VALUES (NEW.research_community_id, NEW.id, 'member')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS investigators_sync_membership ON public.investigators;
CREATE TRIGGER investigators_sync_membership
  AFTER INSERT OR UPDATE OF research_community_id ON public.investigators
  FOR EACH ROW EXECUTE FUNCTION public.investigators_sync_membership();

-- ---------------------------------------------------------------------------
-- Fits cache
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.community_fits (
  community_id UUID NOT NULL REFERENCES public.pipeline_communities(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES public.funding_opportunities(id) ON DELETE CASCADE,
  investigator_ids UUID[] NOT NULL DEFAULT '{}',
  strong_count INTEGER NOT NULL DEFAULT 0,
  potential_count INTEGER NOT NULL DEFAULT 0,
  score DOUBLE PRECISION NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, opportunity_id)
);
CREATE INDEX IF NOT EXISTS community_fits_score_idx ON public.community_fits (community_id, score DESC);
ALTER TABLE public.community_fits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "community fits readable by signed-in users" ON public.community_fits;
CREATE POLICY "community fits readable by signed-in users" ON public.community_fits FOR SELECT TO authenticated USING (true);

-- Per-member fits (which investigators fit which open notice): one RPC call per community
-- instead of one per member. Each member's vector is read into a variable so the HNSW index
-- is used exactly as in match_opportunities; only open notices are returned.
CREATE OR REPLACE FUNCTION public.match_opportunities_for_investigators(
  p_investigator_ids UUID[],
  match_count INTEGER DEFAULT 25,
  similarity_floor DOUBLE PRECISION DEFAULT 0.4
)
RETURNS TABLE (investigator_id UUID, opportunity_id UUID, similarity DOUBLE PRECISION)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, extensions
SET statement_timeout = '30s'
AS $$
#variable_conflict use_column
DECLARE
  v_inv UUID;
  v_emb extensions.vector(1536);
BEGIN
  PERFORM set_config('hnsw.ef_search', '80', true);
  FOREACH v_inv IN ARRAY p_investigator_ids LOOP
    SELECT ie.embedding INTO v_emb FROM public.investigator_embeddings ie WHERE ie.investigator_id = v_inv;
    IF v_emb IS NULL THEN
      CONTINUE;
    END IF;
    RETURN QUERY
    SELECT v_inv, s.opportunity_id, s.similarity
    FROM (
      SELECT o.opportunity_id, 1 - (o.embedding <=> v_emb) AS similarity
      FROM public.opportunity_embeddings o
      JOIN public.funding_opportunities f ON f.id = o.opportunity_id
      WHERE f.close_date >= CURRENT_DATE OR f.next_due >= CURRENT_DATE OR f.expiration_date >= CURRENT_DATE
      ORDER BY o.embedding <=> v_emb
      LIMIT GREATEST(match_count, 1)
    ) s
    WHERE s.similarity >= similarity_floor;
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION public.match_opportunities_for_investigators(UUID[], INTEGER, DOUBLE PRECISION) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Saved searches ↔ community
-- ---------------------------------------------------------------------------
ALTER TABLE public.saved_funding_searches
  ADD COLUMN IF NOT EXISTS community_id UUID REFERENCES public.pipeline_communities(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS saved_funding_searches_community_idx ON public.saved_funding_searches (community_id);
