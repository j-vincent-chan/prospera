-- v2 step 6 — Home, Calendar, Reports, Data sources, notifications digest.

-- Manual calendar entries (internal deadlines, LOIs, limited-submission dates).
CREATE TABLE IF NOT EXISTS public.calendar_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.teams (id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 200),
  kind TEXT NOT NULL DEFAULT 'internal' CHECK (kind IN ('sponsor', 'internal', 'loi', 'limited')),
  date DATE NOT NULL,
  notes TEXT,
  item_id UUID REFERENCES public.outreach_items (id) ON DELETE SET NULL,
  opportunity_id UUID REFERENCES public.funding_opportunities (id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_calendar_entries_team_date ON public.calendar_entries (team_id, date);

ALTER TABLE public.calendar_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS calendar_entries_team ON public.calendar_entries;
CREATE POLICY calendar_entries_team ON public.calendar_entries
  FOR ALL TO authenticated
  USING (public.is_team_member(team_id))
  WITH CHECK (public.is_team_member(team_id));

-- ICS subscription token per team (the feed URL is the credential).
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS calendar_token TEXT;

UPDATE public.teams
SET calendar_token = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
WHERE calendar_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS teams_calendar_token_uniq ON public.teams (calendar_token) WHERE calendar_token IS NOT NULL;

-- Outcome amounts feed the Reports funnel ("$1.9M total costs").
ALTER TABLE public.outreach_items
  ADD COLUMN IF NOT EXISTS outcome_amount NUMERIC;

-- Digest bookkeeping and "since your last visit".
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_digest_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_home_visit_at TIMESTAMPTZ;

-- Immediate notifications sent once per event.
CREATE TABLE IF NOT EXISTS public.notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, key)
);

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_log_own ON public.notification_log;
CREATE POLICY notification_log_own ON public.notification_log
  FOR SELECT TO authenticated USING (user_id = auth.uid());
