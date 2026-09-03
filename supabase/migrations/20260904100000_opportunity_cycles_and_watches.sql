-- ---------------------------------------------------------------------------
-- v2 step 3: Opportunities.
--
--  * Receipt cycles on funding_opportunities (from the NIH Guide notice page;
--    Simpler.Grants.gov only carries a single close date, which for NIH
--    PA/PAR notices is the expiration), plus the Key Dates that come with
--    them and the fetch bookkeeping.
--  * opportunity_class: set by the pipeline, read-only. Only 'federal'
--    lives in this table; curated Internal (UCSF) records and Limited-
--    submission overlays get their own tables in step 7.
--  * next_due: materialised "next receipt date" used for sorting/filtering.
--  * Team-level watches ("Watch next cycle"), team-level dismissals, shared
--    saved searches, and RLS moved from "own rows" to team membership.
--  * Ask allowance per team per day.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- funding_opportunities: cycles + key dates
-- ---------------------------------------------------------------------------
ALTER TABLE public.funding_opportunities
  ADD COLUMN IF NOT EXISTS opportunity_class TEXT NOT NULL DEFAULT 'federal'
    CHECK (opportunity_class IN ('federal')),
  -- [{ "due": "2026-09-25", "kind": "new" | "renewal" | "aids",
  --    "review": "July 2026", "council": "October 2026", "start": "December 2026" }]
  ADD COLUMN IF NOT EXISTS receipt_cycles JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS cycles_source TEXT NOT NULL DEFAULT 'simpler'
    CHECK (cycles_source IN ('simpler', 'nih_guide')),
  ADD COLUMN IF NOT EXISTS standard_dates_apply BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS next_due DATE,
  ADD COLUMN IF NOT EXISTS open_date DATE,
  ADD COLUMN IF NOT EXISTS loi_due DATE,
  ADD COLUMN IF NOT EXISTS loi_note TEXT,
  ADD COLUMN IF NOT EXISTS expiration_date DATE,
  ADD COLUMN IF NOT EXISTS earliest_start TEXT,
  ADD COLUMN IF NOT EXISTS activity_code TEXT,
  ADD COLUMN IF NOT EXISTS activity_title TEXT,
  ADD COLUMN IF NOT EXISTS reissue_of TEXT,
  ADD COLUMN IF NOT EXISTS companion_of TEXT,
  ADD COLUMN IF NOT EXISTS related_notices JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS clinical_trial_note TEXT,
  ADD COLUMN IF NOT EXISTS guide_url TEXT,
  ADD COLUMN IF NOT EXISTS guide_fetched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS guide_fetch_status TEXT
    CHECK (guide_fetch_status IN ('ok', 'not_found', 'error')),
  ADD COLUMN IF NOT EXISTS guide_last_change TEXT;

COMMENT ON COLUMN public.funding_opportunities.opportunity_class IS
  'Set by the ingestion pipeline. federal = synced from Simpler.Grants.gov. Curated records never live here.';
COMMENT ON COLUMN public.funding_opportunities.next_due IS
  'Next receipt date on or after today (from receipt_cycles), else close_date. Refreshed by the NIH Guide sync and refresh_simpler_next_due().';

CREATE INDEX IF NOT EXISTS idx_funding_opps_next_due ON public.funding_opportunities (next_due);
CREATE INDEX IF NOT EXISTS idx_funding_opps_guide_fetch ON public.funding_opportunities (guide_fetched_at)
  WHERE agency_code LIKE 'HHS-NIH%';

-- Rows without Guide data use Simpler's close date as their single receipt date.
CREATE OR REPLACE FUNCTION public.refresh_simpler_next_due()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n INTEGER;
BEGIN
  UPDATE public.funding_opportunities
     SET next_due = close_date
   WHERE cycles_source = 'simpler'
     AND next_due IS DISTINCT FROM close_date;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

SELECT public.refresh_simpler_next_due();

-- ---------------------------------------------------------------------------
-- watches: "Watch next cycle" is a team-level flag on a notice
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.opportunity_watches (
  team_id UUID NOT NULL REFERENCES public.teams (id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES public.funding_opportunities (id) ON DELETE CASCADE,
  created_by UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, opportunity_id)
);

ALTER TABLE public.opportunity_watches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS opportunity_watches_team ON public.opportunity_watches;
CREATE POLICY opportunity_watches_team ON public.opportunity_watches
  FOR ALL TO authenticated
  USING (public.is_team_member(team_id))
  WITH CHECK (public.is_team_member(team_id));

-- ---------------------------------------------------------------------------
-- dismissals are team-level: one row per team and notice
-- ---------------------------------------------------------------------------
ALTER TABLE public.dismissed_funding_opportunities
  ADD COLUMN IF NOT EXISTS dismissed_by UUID REFERENCES public.profiles (id) ON DELETE SET NULL;
UPDATE public.dismissed_funding_opportunities SET dismissed_by = user_id WHERE dismissed_by IS NULL;

-- Keep the earliest row when a team already dismissed the same notice twice.
DELETE FROM public.dismissed_funding_opportunities d
 USING public.dismissed_funding_opportunities d2
 WHERE d.team_id = d2.team_id AND d.opportunity_id = d2.opportunity_id
   AND d.created_at > d2.created_at;
CREATE UNIQUE INDEX IF NOT EXISTS dismissed_funding_opportunities_team_idx
  ON public.dismissed_funding_opportunities (team_id, opportunity_id);

DROP POLICY IF EXISTS dismissed_funding_opportunities_select_own ON public.dismissed_funding_opportunities;
DROP POLICY IF EXISTS dismissed_funding_opportunities_insert_own ON public.dismissed_funding_opportunities;
DROP POLICY IF EXISTS dismissed_funding_opportunities_delete_own ON public.dismissed_funding_opportunities;
DROP POLICY IF EXISTS dismissed_funding_opportunities_team ON public.dismissed_funding_opportunities;
CREATE POLICY dismissed_funding_opportunities_team ON public.dismissed_funding_opportunities
  FOR ALL TO authenticated
  USING (public.is_team_member(team_id))
  WITH CHECK (public.is_team_member(team_id));

-- ---------------------------------------------------------------------------
-- saved searches: personal or shared with the team
-- ---------------------------------------------------------------------------
ALTER TABLE public.saved_funding_searches
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'personal'
    CHECK (visibility IN ('personal', 'team'));

DROP POLICY IF EXISTS saved_funding_searches_select_own ON public.saved_funding_searches;
DROP POLICY IF EXISTS saved_funding_searches_insert_own ON public.saved_funding_searches;
DROP POLICY IF EXISTS saved_funding_searches_update_own ON public.saved_funding_searches;
DROP POLICY IF EXISTS saved_funding_searches_delete_own ON public.saved_funding_searches;
DROP POLICY IF EXISTS saved_funding_searches_select_team ON public.saved_funding_searches;
DROP POLICY IF EXISTS saved_funding_searches_insert_team ON public.saved_funding_searches;
DROP POLICY IF EXISTS saved_funding_searches_update_owner_or_admin ON public.saved_funding_searches;
DROP POLICY IF EXISTS saved_funding_searches_delete_owner_or_admin ON public.saved_funding_searches;

CREATE POLICY saved_funding_searches_select_team ON public.saved_funding_searches
  FOR SELECT TO authenticated
  USING (public.is_team_member(team_id) AND (visibility = 'team' OR user_id = auth.uid()));
CREATE POLICY saved_funding_searches_insert_team ON public.saved_funding_searches
  FOR INSERT TO authenticated
  WITH CHECK (public.is_team_member(team_id) AND user_id = auth.uid());
CREATE POLICY saved_funding_searches_update_owner_or_admin ON public.saved_funding_searches
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_team_admin(team_id))
  WITH CHECK (public.is_team_member(team_id));
CREATE POLICY saved_funding_searches_delete_owner_or_admin ON public.saved_funding_searches
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.is_team_admin(team_id));

-- ---------------------------------------------------------------------------
-- saved opportunities: visible to the whole team. The (user_id, opportunity_id)
-- key stays until step 5 replaces this table with outreach_items.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS saved_funding_opportunities_select_own ON public.saved_funding_opportunities;
DROP POLICY IF EXISTS saved_funding_opportunities_insert_own ON public.saved_funding_opportunities;
DROP POLICY IF EXISTS saved_funding_opportunities_update_own ON public.saved_funding_opportunities;
DROP POLICY IF EXISTS saved_funding_opportunities_delete_own ON public.saved_funding_opportunities;
DROP POLICY IF EXISTS saved_funding_opportunities_team ON public.saved_funding_opportunities;
CREATE POLICY saved_funding_opportunities_team ON public.saved_funding_opportunities
  FOR ALL TO authenticated
  USING (public.is_team_member(team_id))
  WITH CHECK (public.is_team_member(team_id));

-- ---------------------------------------------------------------------------
-- Ask allowance: questions per team per day
-- ---------------------------------------------------------------------------
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS ask_daily_limit INTEGER NOT NULL DEFAULT 200
    CHECK (ask_daily_limit BETWEEN 0 AND 10000);

CREATE TABLE IF NOT EXISTS public.team_ask_usage (
  team_id UUID NOT NULL REFERENCES public.teams (id) ON DELETE CASCADE,
  day DATE NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  users UUID[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (team_id, day)
);

ALTER TABLE public.team_ask_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_ask_usage_select_team ON public.team_ask_usage;
CREATE POLICY team_ask_usage_select_team ON public.team_ask_usage
  FOR SELECT TO authenticated
  USING (public.is_team_member(team_id));

-- Counts one question; returns the new count and the team's limit.
-- Days are Pacific, matching the "resets at midnight Pacific" copy.
CREATE OR REPLACE FUNCTION public.record_ask_usage(p_team UUID, p_user UUID)
RETURNS TABLE (count INTEGER, daily_limit INTEGER, user_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day DATE := (now() AT TIME ZONE 'America/Los_Angeles')::date;
  v_count INTEGER;
  v_users UUID[];
  v_limit INTEGER;
BEGIN
  SELECT ask_daily_limit INTO v_limit FROM public.teams WHERE id = p_team;
  INSERT INTO public.team_ask_usage (team_id, day, count, users)
  VALUES (p_team, v_day, 1, ARRAY[p_user])
  ON CONFLICT (team_id, day) DO UPDATE
    SET count = public.team_ask_usage.count + 1,
        users = CASE WHEN p_user = ANY (public.team_ask_usage.users)
                     THEN public.team_ask_usage.users
                     ELSE array_append(public.team_ask_usage.users, p_user) END
  RETURNING public.team_ask_usage.count, public.team_ask_usage.users INTO v_count, v_users;
  RETURN QUERY SELECT v_count, COALESCE(v_limit, 200), COALESCE(array_length(v_users, 1), 0);
END;
$$;
