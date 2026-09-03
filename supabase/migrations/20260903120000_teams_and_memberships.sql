-- ---------------------------------------------------------------------------
-- v2 step 2: team workspaces.
--
-- teams, memberships (owner | admin | member), former members, access
-- requests, email invitations, invite links, per-user notification
-- preferences, institution roles; team_id on the tables that hold shared
-- work; a team-logos bucket; and an idempotent migration of the existing
-- single-workspace data into one launch team.
--
-- Reads go through RLS (a user sees their teams and anything discoverable in
-- their email domain). Writes go through server actions using the service
-- role after a role check in code, matching the existing rdsg_owners pattern,
-- so the write policies below are deliberately conservative.
-- ---------------------------------------------------------------------------

-- similar_teams() below uses similarity() for the duplicate-team warning.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- teams
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  -- Who can find the team in the onboarding chooser.
  discoverability TEXT NOT NULL DEFAULT 'invite_only'
    CHECK (discoverability IN ('invite_only', 'domain')),
  -- Email domain the team belongs to; discoverability applies within it.
  domain TEXT NOT NULL DEFAULT 'ucsf.edu',
  -- Storage object path in the team-logos bucket; NULL = show initials.
  logo_path TEXT,
  logo_on_briefs BOOLEAN NOT NULL DEFAULT true,
  -- Internal routing deadline rule: sponsor due date minus N days.
  routing_days INTEGER NOT NULL DEFAULT 5 CHECK (routing_days BETWEEN 0 AND 60),
  routing_day_type TEXT NOT NULL DEFAULT 'business'
    CHECK (routing_day_type IN ('business', 'calendar')),
  routing_holiday_calendar TEXT NOT NULL DEFAULT 'ucsf'
    CHECK (routing_holiday_calendar IN ('ucsf', 'us_federal', 'none')),
  -- Outreach sending identity.
  sending_identity TEXT NOT NULL DEFAULT 'strategist_via_prospera'
    CHECK (sending_identity IN ('strategist_via_prospera', 'team_address')),
  sending_address TEXT,
  reply_to_email TEXT,
  per_investigator_limit INTEGER NOT NULL DEFAULT 2
    CHECK (per_investigator_limit BETWEEN 0 AND 20),
  signature TEXT,
  -- Lifecycle: archived teams are read-only, restorable for 90 days.
  archived_at TIMESTAMPTZ,
  archived_by UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT teams_name_nonempty CHECK (char_length(trim(name)) > 0),
  CONSTRAINT teams_slug_format CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND char_length(slug) BETWEEN 2 AND 40),
  CONSTRAINT teams_domain_lowercase CHECK (domain = lower(domain))
);

CREATE INDEX IF NOT EXISTS teams_discoverable_idx
  ON public.teams (domain) WHERE discoverability = 'domain' AND archived_at IS NULL;

-- ---------------------------------------------------------------------------
-- memberships
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.team_memberships (
  team_id UUID NOT NULL REFERENCES public.teams (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  invited_by UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  PRIMARY KEY (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS team_memberships_user_idx ON public.team_memberships (user_id);

-- Attribution survives departure: "Jordan Kim · former member".
CREATE TABLE IF NOT EXISTS public.team_former_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.teams (id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  former_role TEXT NOT NULL CHECK (former_role IN ('owner', 'admin', 'member')),
  reason TEXT NOT NULL CHECK (reason IN ('left', 'removed')),
  left_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_by UUID REFERENCES public.profiles (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS team_former_members_team_idx ON public.team_former_members (team_id, left_at DESC);

-- ---------------------------------------------------------------------------
-- access requests (discoverable teams and invite links)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.team_access_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.teams (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  note TEXT,
  -- 'link' when the request came from an invite link rather than the chooser.
  source TEXT NOT NULL DEFAULT 'chooser' CHECK (source IN ('chooser', 'link')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied', 'cancelled', 'expired')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  approved_role TEXT CHECK (approved_role IN ('admin', 'member')),
  deny_note TEXT
);

-- One open request per team per person.
CREATE UNIQUE INDEX IF NOT EXISTS team_access_requests_one_pending_idx
  ON public.team_access_requests (team_id, user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS team_access_requests_user_idx ON public.team_access_requests (user_id, status);
CREATE INDEX IF NOT EXISTS team_access_requests_team_idx ON public.team_access_requests (team_id, status);

-- ---------------------------------------------------------------------------
-- email invitations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.team_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.teams (id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  -- Two UUIDs of randomness (244 bits); pgcrypto isn't enabled on the project.
  token TEXT NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  invited_by UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  last_sent_at TIMESTAMPTZ,
  send_count INTEGER NOT NULL DEFAULT 0,
  bounced BOOLEAN NOT NULL DEFAULT false,
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  declined_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  CONSTRAINT team_invitations_email_lowercase CHECK (email = lower(email))
);

-- One open invitation per team per address.
CREATE UNIQUE INDEX IF NOT EXISTS team_invitations_one_open_idx
  ON public.team_invitations (team_id, email)
  WHERE accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS team_invitations_email_idx ON public.team_invitations (email);

-- ---------------------------------------------------------------------------
-- invite links: one live link per team; opening it creates a pending request.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.team_invite_links (
  team_id UUID PRIMARY KEY REFERENCES public.teams (id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_by UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days')
);

-- ---------------------------------------------------------------------------
-- profiles: current workspace, title/department, institution roles
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS current_team_id UUID REFERENCES public.teams (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS department TEXT,
  -- 'curator' and 'library_steward' are institution-wide, not per team.
  ADD COLUMN IF NOT EXISTS institution_roles TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS digest_time TEXT NOT NULL DEFAULT '07:30'
    CHECK (digest_time IN ('07:30', '12:00', '17:00')),
  ADD COLUMN IF NOT EXISTS digest_weekdays_only BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS block_repeat_requests BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- notification preferences: immediate vs daily digest per event type
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'pi_reply',
    'access_requests',
    'saved_search_matches',
    'watched_forecasts',
    'next_actions_due',
    'data_source_failing'
  )),
  immediate BOOLEAN NOT NULL DEFAULT false,
  digest BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_type)
);

-- Defaults from Settings v2: replies, access requests and failing sources are
-- immediate; matches, forecasts and due items go in the digest.
CREATE OR REPLACE FUNCTION public.default_notification_preferences(p_user UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.notification_preferences (user_id, event_type, immediate, digest)
  VALUES
    (p_user, 'pi_reply', true, false),
    (p_user, 'access_requests', true, false),
    (p_user, 'saved_search_matches', false, true),
    (p_user, 'watched_forecasts', false, true),
    (p_user, 'next_actions_due', false, true),
    (p_user, 'data_source_failing', true, false)
  ON CONFLICT (user_id, event_type) DO NOTHING;
$$;

-- New users get defaults alongside their profile.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'role', ''), 'staff')
  );
  PERFORM public.default_notification_preferences(NEW.id);
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- team_id on shared work. Saved searches, saved opportunities and dismissals
-- belong to the team; the (user_id, opportunity_id) keys stay for now because
-- the activity / PI-match / community child tables hang off them — step 3
-- replaces that key when the Opportunities screen is rebuilt.
-- ---------------------------------------------------------------------------
ALTER TABLE public.saved_funding_searches
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES public.teams (id) ON DELETE CASCADE;
ALTER TABLE public.saved_funding_opportunities
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES public.teams (id) ON DELETE CASCADE;
ALTER TABLE public.dismissed_funding_opportunities
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES public.teams (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS saved_funding_searches_team_idx ON public.saved_funding_searches (team_id);
CREATE INDEX IF NOT EXISTS saved_funding_opportunities_team_idx ON public.saved_funding_opportunities (team_id, opportunity_id);
CREATE INDEX IF NOT EXISTS dismissed_funding_opportunities_team_idx ON public.dismissed_funding_opportunities (team_id, opportunity_id);

-- ---------------------------------------------------------------------------
-- helpers for RLS and server code
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.team_role(p_team UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.team_memberships
  WHERE team_id = p_team AND user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_team_member(p_team UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_memberships
    WHERE team_id = p_team AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_team_admin(p_team UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_memberships
    WHERE team_id = p_team AND user_id = auth.uid() AND role IN ('owner', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.current_user_email_domain()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lower(split_part(email, '@', 2)) FROM public.profiles WHERE id = auth.uid();
$$;

-- Chooser data: discoverable teams in the caller's domain with member count
-- and owner name, without exposing the membership table.
CREATE OR REPLACE FUNCTION public.discoverable_teams()
RETURNS TABLE (
  id UUID,
  name TEXT,
  slug TEXT,
  description TEXT,
  member_count BIGINT,
  owner_name TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id, t.name, t.slug, t.description,
    (SELECT count(*) FROM public.team_memberships m WHERE m.team_id = t.id) AS member_count,
    (SELECT p.full_name FROM public.team_memberships m
       JOIN public.profiles p ON p.id = m.user_id
      WHERE m.team_id = t.id AND m.role = 'owner'
      ORDER BY m.joined_at LIMIT 1) AS owner_name
  FROM public.teams t
  WHERE t.archived_at IS NULL
    AND t.discoverability = 'domain'
    AND t.domain = public.current_user_email_domain()
    AND NOT public.is_team_member(t.id)
  ORDER BY t.name;
$$;

-- Duplicate-team warning while creating: similar names in the same domain.
CREATE OR REPLACE FUNCTION public.similar_teams(p_name TEXT)
RETURNS TABLE (id UUID, name TEXT, member_count BIGINT, discoverable BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
-- pg_trgm lives in `extensions` on hosted Supabase; keep public first for the tables.
SET search_path = public, extensions
AS $$
  SELECT
    t.id, t.name,
    (SELECT count(*) FROM public.team_memberships m WHERE m.team_id = t.id) AS member_count,
    t.discoverability = 'domain' AS discoverable
  FROM public.teams t
  WHERE t.archived_at IS NULL
    AND t.domain = public.current_user_email_domain()
    AND char_length(trim(p_name)) >= 4
    AND (
      lower(t.name) LIKE '%' || lower(trim(p_name)) || '%'
      OR lower(trim(p_name)) LIKE '%' || lower(t.name) || '%'
      OR similarity(lower(t.name), lower(trim(p_name))) > 0.45
    )
  ORDER BY t.name
  LIMIT 3;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_former_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_invite_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS teams_select_member_or_discoverable ON public.teams;
CREATE POLICY teams_select_member_or_discoverable ON public.teams
  FOR SELECT TO authenticated
  USING (
    public.is_team_member(id)
    OR (discoverability = 'domain' AND domain = public.current_user_email_domain() AND archived_at IS NULL)
    OR EXISTS (
      SELECT 1 FROM public.team_invitations i
      WHERE i.team_id = teams.id
        AND i.email = (SELECT lower(email) FROM public.profiles WHERE id = auth.uid())
        AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.declined_at IS NULL
    )
    OR EXISTS (
      SELECT 1 FROM public.team_access_requests r
      WHERE r.team_id = teams.id AND r.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS teams_update_admin ON public.teams;
CREATE POLICY teams_update_admin ON public.teams
  FOR UPDATE TO authenticated
  USING (public.is_team_admin(id)) WITH CHECK (public.is_team_admin(id));

DROP POLICY IF EXISTS team_memberships_select_same_team ON public.team_memberships;
CREATE POLICY team_memberships_select_same_team ON public.team_memberships
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_team_member(team_id));

DROP POLICY IF EXISTS team_former_members_select_same_team ON public.team_former_members;
CREATE POLICY team_former_members_select_same_team ON public.team_former_members
  FOR SELECT TO authenticated
  USING (public.is_team_member(team_id));

DROP POLICY IF EXISTS team_access_requests_select_own_or_admin ON public.team_access_requests;
CREATE POLICY team_access_requests_select_own_or_admin ON public.team_access_requests
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_team_admin(team_id));

DROP POLICY IF EXISTS team_invitations_select_own_or_admin ON public.team_invitations;
CREATE POLICY team_invitations_select_own_or_admin ON public.team_invitations
  FOR SELECT TO authenticated
  USING (
    public.is_team_admin(team_id)
    OR email = (SELECT lower(email) FROM public.profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS team_invite_links_select_admin ON public.team_invite_links;
CREATE POLICY team_invite_links_select_admin ON public.team_invite_links
  FOR SELECT TO authenticated
  USING (public.is_team_admin(team_id));

DROP POLICY IF EXISTS notification_preferences_own ON public.notification_preferences;
CREATE POLICY notification_preferences_own ON public.notification_preferences
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- team logos bucket (public read; uploads by team admins via server action)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('team-logos', 'team-logos', true, 1048576, ARRAY['image/png', 'image/svg+xml'])
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS teams_touch_updated_at ON public.teams;
CREATE TRIGGER teams_touch_updated_at
  BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE PROCEDURE public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Data migration: one launch team. Idempotent.
--   * existing profiles: role 'admin' -> Owner, everyone else -> Member
--   * shared work (saved searches / opportunities / dismissals) -> the team
--   * active RDSG owners without a login -> pending Member invitations
--     (not emailed here; owners Resend from Team settings -> Invitations)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_team UUID;
  v_owner UUID;
BEGIN
  SELECT id INTO v_team FROM public.teams WHERE slug = 'ocr-rd';

  IF v_team IS NULL THEN
    SELECT id INTO v_owner FROM public.profiles WHERE role = 'admin' ORDER BY created_at LIMIT 1;
    IF v_owner IS NULL THEN
      SELECT id INTO v_owner FROM public.profiles ORDER BY created_at LIMIT 1;
    END IF;

    INSERT INTO public.teams (name, slug, description, discoverability, domain, created_by)
    VALUES (
      'OCR Research Development',
      'ocr-rd',
      'Research development for the Office of Collaborative Research: funding scans, investigator matching and outreach across UCSF communities.',
      'invite_only',
      'ucsf.edu',
      v_owner
    )
    RETURNING id INTO v_team;
  END IF;

  -- Memberships for every existing profile.
  INSERT INTO public.team_memberships (team_id, user_id, role, joined_at)
  SELECT v_team, p.id, CASE WHEN p.role = 'admin' THEN 'owner' ELSE 'member' END, p.created_at
  FROM public.profiles p
  ON CONFLICT (team_id, user_id) DO NOTHING;

  -- A team always keeps at least one owner.
  IF NOT EXISTS (SELECT 1 FROM public.team_memberships WHERE team_id = v_team AND role = 'owner') THEN
    UPDATE public.team_memberships SET role = 'owner'
    WHERE team_id = v_team
      AND user_id = (SELECT user_id FROM public.team_memberships WHERE team_id = v_team ORDER BY joined_at LIMIT 1);
  END IF;

  UPDATE public.profiles SET current_team_id = v_team WHERE current_team_id IS NULL;

  UPDATE public.saved_funding_searches SET team_id = v_team WHERE team_id IS NULL;
  UPDATE public.saved_funding_opportunities SET team_id = v_team WHERE team_id IS NULL;
  UPDATE public.dismissed_funding_opportunities SET team_id = v_team WHERE team_id IS NULL;

  -- Notification defaults for everyone who predates the trigger change.
  PERFORM public.default_notification_preferences(p.id) FROM public.profiles p;

  -- RDSG owners -> invitations (skip anyone who already has a login).
  SELECT user_id INTO v_owner FROM public.team_memberships
  WHERE team_id = v_team AND role = 'owner' ORDER BY joined_at LIMIT 1;

  INSERT INTO public.team_invitations (team_id, email, role, invited_by)
  SELECT v_team, lower(o.email), 'member', v_owner
  FROM public.rdsg_owners o
  WHERE o.is_active
    AND o.email IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE lower(p.email) = lower(o.email))
  ON CONFLICT DO NOTHING;

  INSERT INTO public.team_invite_links (team_id, created_by)
  VALUES (v_team, v_owner)
  ON CONFLICT (team_id) DO NOTHING;
END $$;

-- Shared work now always belongs to a team.
ALTER TABLE public.saved_funding_searches ALTER COLUMN team_id SET NOT NULL;
ALTER TABLE public.saved_funding_opportunities ALTER COLUMN team_id SET NOT NULL;
ALTER TABLE public.dismissed_funding_opportunities ALTER COLUMN team_id SET NOT NULL;
