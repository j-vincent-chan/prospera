-- Fit row actions: the two mechanisms AUDIT_AND_DECISIONS §3h left open.
--
--  1. `fit_consult_requests` — the PI's per-row action. §3h says the fourth
--     question ("what should I do next?") stays unanswered for a PI until
--     there is "a real mechanism (request a consult, flag interest to the
--     strategist who owns the community) rather than a button that goes
--     nowhere". This is that mechanism. Routing is resolved at write time
--     and stored, so a request still names the person who owed an answer
--     after the roster or the strategist changes.
--
--  2. `fit_labels.source` gains 'pair_flag' — "this match is wrong", said at
--     the row. The two controls that existed meant other things: a profile
--     flag ('profile_flag') is about an *axis of the person*, and a dismissal
--     ('dismissal') removes a person *from one notice's outreach queue*.
--     Neither says the pairing itself is wrong, and neither is reachable by
--     the investigator. A pair flag is keyed on both ids and carries the
--     reason vocabulary of whoever said it.
--
--  3. `notification_preferences.event_type` gains 'fit_consult_request', so a
--     request reaches the strategist through the same immediate/digest
--     controls as every other event rather than a private channel.

-- ---------------------------------------------------------------------------
-- 1. Consult requests
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fit_consult_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investigator_id UUID NOT NULL REFERENCES public.investigators (id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES public.funding_opportunities (id) ON DELETE CASCADE,
  -- The account that asked. Null only if the profile is later deleted.
  requested_by UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  note TEXT,
  -- Routing, resolved when the request is made and kept even if it changes after.
  community_id UUID REFERENCES public.pipeline_communities (id) ON DELETE SET NULL,
  strategist_id UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  team_id UUID REFERENCES public.teams (id) ON DELETE SET NULL,
  -- The row as the PI read it, so the strategist opens the same verdict.
  verdict_label TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'withdrawn')),
  answered_by UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  answered_at TIMESTAMPTZ,
  answer_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One open request per pair: asking twice is the same ask, not two.
CREATE UNIQUE INDEX IF NOT EXISTS fit_consult_requests_open_pair
  ON public.fit_consult_requests (investigator_id, opportunity_id)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS fit_consult_requests_strategist_idx
  ON public.fit_consult_requests (strategist_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS fit_consult_requests_team_idx
  ON public.fit_consult_requests (team_id, status, created_at DESC);

ALTER TABLE public.fit_consult_requests ENABLE ROW LEVEL SECURITY;

-- The office reads every request for its own team; the PI reads their own.
DROP POLICY IF EXISTS fit_consult_requests_select ON public.fit_consult_requests;
CREATE POLICY fit_consult_requests_select ON public.fit_consult_requests
  FOR SELECT TO authenticated
  USING (
    requested_by = auth.uid()
    OR (team_id IS NOT NULL AND public.is_team_member(team_id))
  );

-- ---------------------------------------------------------------------------
-- 2. Pair flags live in fit_labels beside the other feedback
-- ---------------------------------------------------------------------------
-- Drop whatever CHECK currently constrains `source`, by definition rather than
-- by name: an inline column CHECK is auto-named by Postgres, and dropping a
-- guessed name that does not exist would silently leave the old, narrower
-- constraint in place beside the new one — both would have to pass, and every
-- 'pair_flag' insert would fail at runtime instead of here.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.fit_labels'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%source%'
  LOOP
    EXECUTE format('ALTER TABLE public.fit_labels DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
ALTER TABLE public.fit_labels
  ADD CONSTRAINT fit_labels_source_check
  CHECK (source IN ('gold', 'override', 'profile_flag', 'dismissal', 'pair_flag'));

-- A pair flag names both sides. Nothing else in fit_labels requires that.
ALTER TABLE public.fit_labels DROP CONSTRAINT IF EXISTS fit_labels_pair_flag_check;
ALTER TABLE public.fit_labels
  ADD CONSTRAINT fit_labels_pair_flag_check
  CHECK (source <> 'pair_flag' OR (investigator_id IS NOT NULL AND opportunity_id IS NOT NULL));

-- One standing flag per person, notice and labeller: saying it twice is one opinion.
CREATE UNIQUE INDEX IF NOT EXISTS fit_labels_pair_flag_unique
  ON public.fit_labels (investigator_id, opportunity_id, labeler)
  WHERE source = 'pair_flag';

-- ---------------------------------------------------------------------------
-- 3. The request is an ordinary notification event
-- ---------------------------------------------------------------------------
-- Same reasoning as `fit_labels.source` above.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.notification_preferences'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%event_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.notification_preferences DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
ALTER TABLE public.notification_preferences
  ADD CONSTRAINT notification_preferences_event_type_check
  CHECK (event_type IN (
    'pi_reply',
    'access_requests',
    'saved_search_matches',
    'watched_forecasts',
    'next_actions_due',
    'data_source_failing',
    'fit_consult_request'
  ));
