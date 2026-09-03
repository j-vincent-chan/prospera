-- v2 step 5 — Outreach workspace.
--
-- Team-scoped outreach items (stages Triage → Contacting → Developing →
-- Submitted → Outcome, plus Parked), recipients (people + communities),
-- evidence-backed suggestions frozen as snapshots, monitored-community
-- evaluations, messages actually sent, an activity log, do-not-contact on
-- investigators, and pgvector embeddings for evidence, people and notices.

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- Investigators: do-not-contact (README: who / when)
-- ---------------------------------------------------------------------------
ALTER TABLE public.investigators
  ADD COLUMN IF NOT EXISTS do_not_contact_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS do_not_contact_by UUID,
  ADD COLUMN IF NOT EXISTS do_not_contact_reason TEXT;

-- ---------------------------------------------------------------------------
-- outreach_items
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.outreach_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.teams (id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES public.funding_opportunities (id) ON DELETE CASCADE,
  stage TEXT NOT NULL DEFAULT 'triage'
    CHECK (stage IN ('triage', 'contacting', 'developing', 'submitted', 'outcome', 'parked')),
  -- Leaving Submitted requires an outcome.
  outcome TEXT CHECK (outcome IN ('funded', 'not_funded', 'withdrawn', 'not_submitted', 'pending')),
  outcome_note TEXT,
  outcome_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  parked_reason TEXT,
  parked_until DATE,
  -- Stage to return to when un-parking.
  parked_from TEXT,
  owner_id UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  next_action TEXT,
  next_action_date DATE,
  -- Opportunity profile: nine facets extracted from the notice, editable.
  profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  profile_version INTEGER NOT NULL DEFAULT 0,
  suggestions_state TEXT NOT NULL DEFAULT 'none'
    CHECK (suggestions_state IN ('none', 'loading', 'ready', 'error', 'manual', 'outdated')),
  suggestions_error TEXT,
  suggestions_generated_at TIMESTAMPTZ,
  suggestions_profile_version INTEGER,
  suggestion_options JSONB NOT NULL DEFAULT '{"excludeRecentlyContacted": true, "earlyCareerOnly": false, "excludeRenewalsDue": false}'::jsonb,
  -- funding_opportunities.updated_at when suggestions ran; a later change marks them outdated.
  notice_version_seen TIMESTAMPTZ,
  -- Compose draft (subject, body, mode, recipient toggles), saved as you type.
  draft JSONB NOT NULL DEFAULT '{}'::jsonb,
  draft_saved_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  legacy_user_id UUID,
  created_by UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, opportunity_id)
);

CREATE INDEX IF NOT EXISTS idx_outreach_items_team_stage ON public.outreach_items (team_id, stage);
CREATE INDEX IF NOT EXISTS idx_outreach_items_team_next_action ON public.outreach_items (team_id, next_action_date);

DROP TRIGGER IF EXISTS tr_outreach_items_updated_at ON public.outreach_items;
CREATE TRIGGER tr_outreach_items_updated_at
  BEFORE UPDATE ON public.outreach_items
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.outreach_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS outreach_items_team ON public.outreach_items;
CREATE POLICY outreach_items_team ON public.outreach_items
  FOR ALL TO authenticated
  USING (public.is_team_member(team_id))
  WITH CHECK (public.is_team_member(team_id));

-- ---------------------------------------------------------------------------
-- outreach_recipients: people and communities selected for an item
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.outreach_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES public.outreach_items (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('person', 'community')),
  investigator_id UUID REFERENCES public.investigators (id) ON DELETE CASCADE,
  community_id UUID REFERENCES public.pipeline_communities (id) ON DELETE CASCADE,
  origin TEXT NOT NULL DEFAULT 'you' CHECK (origin IN ('you', 'suggested')),
  status TEXT NOT NULL DEFAULT 'selected'
    CHECK (status IN ('selected', 'contacted', 'replied_interested', 'replied_maybe', 'replied_not_now', 'declined', 'bounced')),
  contact_count INTEGER NOT NULL DEFAULT 0,
  contacted_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  reply_note TEXT,
  reply_source TEXT,
  -- Personal line used in personalized messages.
  hook TEXT,
  added_by UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ,
  removed_by UUID,
  CONSTRAINT outreach_recipients_target CHECK (
    (kind = 'person' AND investigator_id IS NOT NULL AND community_id IS NULL)
    OR (kind = 'community' AND community_id IS NOT NULL AND investigator_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS outreach_recipients_person_uniq
  ON public.outreach_recipients (item_id, investigator_id) WHERE kind = 'person';
CREATE UNIQUE INDEX IF NOT EXISTS outreach_recipients_community_uniq
  ON public.outreach_recipients (item_id, community_id) WHERE kind = 'community';
CREATE INDEX IF NOT EXISTS idx_outreach_recipients_investigator ON public.outreach_recipients (investigator_id);

ALTER TABLE public.outreach_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS outreach_recipients_team ON public.outreach_recipients;
CREATE POLICY outreach_recipients_team ON public.outreach_recipients
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.outreach_items i WHERE i.id = item_id AND public.is_team_member(i.team_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.outreach_items i WHERE i.id = item_id AND public.is_team_member(i.team_id)));

-- ---------------------------------------------------------------------------
-- outreach_suggestions: frozen snapshot per (item, person)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.outreach_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES public.outreach_items (id) ON DELETE CASCADE,
  investigator_id UUID NOT NULL REFERENCES public.investigators (id) ON DELETE CASCADE,
  tier TEXT NOT NULL CHECK (tier IN ('strong', 'potential', 'exploratory')),
  coverage TEXT NOT NULL CHECK (coverage IN ('strong', 'partial', 'limited')),
  score REAL NOT NULL DEFAULT 0,
  flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary TEXT,
  identity_line TEXT,
  fresh_line TEXT,
  fresh_warn BOOLEAN NOT NULL DEFAULT false,
  history_line TEXT,
  history_kind TEXT,
  is_new BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'added', 'dismissed', 'excluded')),
  excluded_reason TEXT,
  dismissed_reason TEXT,
  dismissed_by UUID,
  dismissed_at TIMESTAMPTZ,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  profile_version INTEGER,
  UNIQUE (item_id, investigator_id)
);

CREATE INDEX IF NOT EXISTS idx_outreach_suggestions_item ON public.outreach_suggestions (item_id, status);

ALTER TABLE public.outreach_suggestions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS outreach_suggestions_team ON public.outreach_suggestions;
CREATE POLICY outreach_suggestions_team ON public.outreach_suggestions
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.outreach_items i WHERE i.id = item_id AND public.is_team_member(i.team_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.outreach_items i WHERE i.id = item_id AND public.is_team_member(i.team_id)));

-- ---------------------------------------------------------------------------
-- outreach_community_evaluations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.outreach_community_evaluations (
  item_id UUID NOT NULL REFERENCES public.outreach_items (id) ON DELETE CASCADE,
  community_id UUID NOT NULL REFERENCES public.pipeline_communities (id) ON DELETE CASCADE,
  tier TEXT NOT NULL CHECK (tier IN ('strong', 'potential', 'not_suggested', 'cant_evaluate', 'inactive')),
  reason TEXT NOT NULL DEFAULT '',
  alignment TEXT[] NOT NULL DEFAULT '{}'::text[],
  member_matches INTEGER NOT NULL DEFAULT 0,
  member_total INTEGER NOT NULL DEFAULT 0,
  -- Dismissed suggestions stay recorded; tagging lives in outreach_recipients.
  dismissed_at TIMESTAMPTZ,
  dismissed_by UUID,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, community_id)
);

ALTER TABLE public.outreach_community_evaluations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS outreach_community_evaluations_team ON public.outreach_community_evaluations;
CREATE POLICY outreach_community_evaluations_team ON public.outreach_community_evaluations
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.outreach_items i WHERE i.id = item_id AND public.is_team_member(i.team_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.outreach_items i WHERE i.id = item_id AND public.is_team_member(i.team_id)));

-- ---------------------------------------------------------------------------
-- outreach_messages + per-recipient sends
-- ---------------------------------------------------------------------------
-- A pre-v2 experiment left tables under these names with a different shape
-- (no rows, no code references). Replace them; refuse if they hold data.
DO $$
DECLARE
  legacy TEXT;
  key_column TEXT;
  n BIGINT;
BEGIN
  FOR legacy, key_column IN SELECT * FROM (VALUES ('outreach_messages', 'item_id'), ('outreach_message_recipients', 'message_id')) AS t(name, col) LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = legacy)
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = legacy AND column_name = key_column) THEN
      EXECUTE format('SELECT count(*) FROM public.%I', legacy) INTO n;
      IF n > 0 THEN
        RAISE EXCEPTION 'Legacy table public.% has % rows; rename it before applying this migration', legacy, n;
      END IF;
      EXECUTE format('DROP TABLE public.%I CASCADE', legacy);
    END IF;
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS public.outreach_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES public.outreach_items (id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams (id) ON DELETE CASCADE,
  sender_id UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  sender_name TEXT,
  from_address TEXT,
  reply_to TEXT,
  mode TEXT NOT NULL DEFAULT 'personalized' CHECK (mode IN ('one', 'personalized')),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outreach_messages_item ON public.outreach_messages (item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.outreach_message_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.outreach_messages (id) ON DELETE CASCADE,
  recipient_id UUID REFERENCES public.outreach_recipients (id) ON DELETE SET NULL,
  investigator_id UUID REFERENCES public.investigators (id) ON DELETE SET NULL,
  community_id UUID REFERENCES public.pipeline_communities (id) ON DELETE SET NULL,
  to_email TEXT NOT NULL,
  to_name TEXT,
  personal_line TEXT,
  rendered_subject TEXT,
  rendered_body TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  provider_id TEXT,
  error TEXT,
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_outreach_message_recipients_investigator
  ON public.outreach_message_recipients (investigator_id, sent_at DESC);

ALTER TABLE public.outreach_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_message_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS outreach_messages_team ON public.outreach_messages;
CREATE POLICY outreach_messages_team ON public.outreach_messages
  FOR ALL TO authenticated
  USING (public.is_team_member(team_id))
  WITH CHECK (public.is_team_member(team_id));
DROP POLICY IF EXISTS outreach_message_recipients_team ON public.outreach_message_recipients;
CREATE POLICY outreach_message_recipients_team ON public.outreach_message_recipients
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.outreach_messages m WHERE m.id = message_id AND public.is_team_member(m.team_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.outreach_messages m WHERE m.id = message_id AND public.is_team_member(m.team_id)));

-- ---------------------------------------------------------------------------
-- outreach_activity (notes + event log)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.outreach_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES public.outreach_items (id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams (id) ON DELETE CASCADE,
  actor_id UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL DEFAULT 'Prospera',
  kind TEXT NOT NULL CHECK (kind IN (
    'created', 'note', 'stage_change', 'outreach_sent', 'reply', 'recipient_added', 'recipient_removed',
    'community_tagged', 'community_removed', 'suggestions_generated', 'suggestion_dismissed', 'profile_edited',
    'owner_changed', 'next_action', 'parked', 'outcome'
  )),
  text TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  mentions UUID[] NOT NULL DEFAULT '{}'::uuid[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outreach_activity_item ON public.outreach_activity (item_id, created_at DESC);

ALTER TABLE public.outreach_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS outreach_activity_team ON public.outreach_activity;
CREATE POLICY outreach_activity_team ON public.outreach_activity
  FOR ALL TO authenticated
  USING (public.is_team_member(team_id))
  WITH CHECK (public.is_team_member(team_id));

-- ---------------------------------------------------------------------------
-- Embeddings (text-embedding-3-small, 1536 dims)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.evidence_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investigator_id UUID NOT NULL REFERENCES public.investigators (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('publication', 'grant', 'biosketch', 'profile', 'focus', 'trial')),
  ref_id TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  year INTEGER,
  embedding extensions.vector(1536) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (investigator_id, kind, ref_id)
);

CREATE INDEX IF NOT EXISTS idx_evidence_embeddings_investigator ON public.evidence_embeddings (investigator_id);
CREATE INDEX IF NOT EXISTS idx_evidence_embeddings_hnsw
  ON public.evidence_embeddings USING hnsw (embedding extensions.vector_cosine_ops);

CREATE TABLE IF NOT EXISTS public.investigator_embeddings (
  investigator_id UUID PRIMARY KEY REFERENCES public.investigators (id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 0,
  embedding extensions.vector(1536) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.opportunity_embeddings (
  opportunity_id UUID PRIMARY KEY REFERENCES public.funding_opportunities (id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  embedding extensions.vector(1536) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opportunity_embeddings_hnsw
  ON public.opportunity_embeddings USING hnsw (embedding extensions.vector_cosine_ops);

ALTER TABLE public.evidence_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investigator_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunity_embeddings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS evidence_embeddings_read ON public.evidence_embeddings;
CREATE POLICY evidence_embeddings_read ON public.evidence_embeddings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS investigator_embeddings_read ON public.investigator_embeddings;
CREATE POLICY investigator_embeddings_read ON public.investigator_embeddings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS opportunity_embeddings_read ON public.opportunity_embeddings;
CREATE POLICY opportunity_embeddings_read ON public.opportunity_embeddings FOR SELECT TO authenticated USING (true);

-- Evidence items nearest to a query (the opportunity profile).
CREATE OR REPLACE FUNCTION public.match_evidence(
  query_embedding extensions.vector(1536),
  match_count INTEGER DEFAULT 600,
  min_similarity DOUBLE PRECISION DEFAULT 0.2
)
RETURNS TABLE (investigator_id UUID, kind TEXT, ref_id TEXT, content TEXT, year INTEGER, similarity DOUBLE PRECISION)
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  SELECT e.investigator_id, e.kind, e.ref_id, e.content, e.year, 1 - (e.embedding <=> query_embedding) AS similarity
  FROM public.evidence_embeddings e
  WHERE 1 - (e.embedding <=> query_embedding) >= min_similarity
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- One person's evidence scored against a query (for the reverse direction and evidence views).
CREATE OR REPLACE FUNCTION public.score_investigator_evidence(
  p_investigator_id UUID,
  query_embedding extensions.vector(1536)
)
RETURNS TABLE (kind TEXT, ref_id TEXT, content TEXT, year INTEGER, similarity DOUBLE PRECISION)
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  SELECT e.kind, e.ref_id, e.content, e.year, 1 - (e.embedding <=> query_embedding) AS similarity
  FROM public.evidence_embeddings e
  WHERE e.investigator_id = p_investigator_id
  ORDER BY e.embedding <=> query_embedding;
$$;

-- Open notices nearest to a person's evidence document.
CREATE OR REPLACE FUNCTION public.match_opportunities(
  query_embedding extensions.vector(1536),
  match_count INTEGER DEFAULT 40,
  only_open BOOLEAN DEFAULT true
)
RETURNS TABLE (opportunity_id UUID, similarity DOUBLE PRECISION)
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  SELECT o.opportunity_id, 1 - (o.embedding <=> query_embedding) AS similarity
  FROM public.opportunity_embeddings o
  JOIN public.funding_opportunities f ON f.id = o.opportunity_id
  WHERE NOT only_open
     OR f.close_date >= CURRENT_DATE
     OR f.next_due >= CURRENT_DATE
     OR f.expiration_date >= CURRENT_DATE
  ORDER BY o.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Similarity between one investigator document and one notice.
CREATE OR REPLACE FUNCTION public.investigator_opportunity_similarity(p_investigator_id UUID, p_opportunity_id UUID)
RETURNS DOUBLE PRECISION
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  SELECT 1 - (i.embedding <=> o.embedding)
  FROM public.investigator_embeddings i, public.opportunity_embeddings o
  WHERE i.investigator_id = p_investigator_id AND o.opportunity_id = p_opportunity_id;
$$;

-- ---------------------------------------------------------------------------
-- Data migration: the per-user pipeline becomes team outreach items
-- ---------------------------------------------------------------------------
INSERT INTO public.outreach_items (team_id, opportunity_id, stage, owner_id, next_action, next_action_date, last_activity_at, legacy_user_id, created_by, created_at, parked_reason, outcome, outcome_at)
SELECT
  s.team_id,
  s.opportunity_id,
  CASE
    WHEN s.archived_at IS NOT NULL OR s.stage IN ('cold', 'archived') THEN 'parked'
    WHEN s.stage = 'closed' THEN 'outcome'
    WHEN s.stage = 'active_development' THEN 'developing'
    WHEN s.stage = 'outreach_sent' THEN 'contacting'
    ELSE 'triage'
  END,
  -- Owners and creators whose profile is gone are left unassigned.
  CASE WHEN EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = s.owner_id) THEN s.owner_id END,
  s.next_action,
  s.next_action_date,
  COALESCE(s.last_activity_at, s.created_at),
  s.user_id,
  CASE WHEN EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = s.user_id) THEN s.user_id END,
  s.created_at,
  CASE WHEN s.archived_at IS NOT NULL THEN 'Archived in the previous pipeline' WHEN s.stage = 'cold' THEN 'Cold in the previous pipeline' END,
  CASE WHEN s.stage = 'closed' THEN CASE s.closure_reason WHEN 'submitted' THEN 'pending' WHEN 'declined' THEN 'not_submitted' ELSE 'not_submitted' END END,
  CASE WHEN s.stage = 'closed' THEN s.updated_at END
FROM public.saved_funding_opportunities s
WHERE s.team_id IS NOT NULL
ON CONFLICT (team_id, opportunity_id) DO NOTHING;

INSERT INTO public.outreach_recipients (item_id, kind, investigator_id, origin, status, contact_count, contacted_at, hook, added_by, added_at)
SELECT
  i.id, 'person', m.investigator_id, 'you',
  CASE m.outreach_status
    WHEN 'sent' THEN 'contacted'
    WHEN 'responded_interested' THEN 'replied_interested'
    WHEN 'responded_maybe' THEN 'replied_maybe'
    WHEN 'responded_declined' THEN 'declined'
    ELSE 'selected'
  END,
  CASE WHEN m.outreach_sent_at IS NOT NULL THEN 1 ELSE 0 END,
  m.outreach_sent_at,
  m.rationale,
  CASE WHEN EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = m.user_id) THEN m.user_id END,
  m.created_at
FROM public.saved_opportunity_pi_matches m
JOIN public.outreach_items i ON i.opportunity_id = m.opportunity_id AND i.legacy_user_id = m.user_id
ON CONFLICT DO NOTHING;

INSERT INTO public.outreach_recipients (item_id, kind, community_id, origin, status, added_by, added_at)
SELECT i.id, 'community', c.community_id, 'you', 'selected', CASE WHEN EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = c.user_id) THEN c.user_id END, c.created_at
FROM public.saved_funding_opportunity_communities c
JOIN public.outreach_items i ON i.opportunity_id = c.opportunity_id AND i.legacy_user_id = c.user_id
ON CONFLICT DO NOTHING;

INSERT INTO public.outreach_activity (item_id, team_id, actor_id, actor_name, kind, text, payload, created_at)
SELECT
  i.id, i.team_id, p.id, COALESCE(p.full_name, 'Prospera'),
  CASE a.event_type WHEN 'note' THEN 'note' WHEN 'outreach_sent' THEN 'outreach_sent' WHEN 'stage_change' THEN 'stage_change' WHEN 'pi_added' THEN 'recipient_added' WHEN 'pi_removed' THEN 'recipient_removed' WHEN 'pi_updated' THEN 'recipient_added' WHEN 'closure' THEN 'outcome' ELSE 'stage_change' END,
  CASE a.event_type
    WHEN 'note' THEN COALESCE(a.payload->>'note', a.payload->>'text', 'note')
    WHEN 'outreach_sent' THEN 'sent outreach (previous pipeline)'
    WHEN 'stage_change' THEN 'moved to ' || COALESCE(a.payload->>'to', a.payload->>'stage', 'a new stage') || ' (previous pipeline)'
    WHEN 'pi_added' THEN 'added a recipient'
    WHEN 'pi_removed' THEN 'removed a recipient'
    WHEN 'pi_updated' THEN 'updated a recipient (previous pipeline)'
    WHEN 'closure' THEN 'closed (previous pipeline)'
    ELSE 'updated the pipeline record (previous pipeline)'
  END,
  a.payload,
  a.created_at
FROM public.saved_opportunity_activity a
JOIN public.outreach_items i ON i.opportunity_id = a.opportunity_id AND i.legacy_user_id = a.user_id
LEFT JOIN public.profiles p ON p.id = a.created_by;
