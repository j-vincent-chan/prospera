import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AccessRequestRow,
  DiscoverableTeam,
  FormerMemberRow,
  InvitationRow,
  InviteLink,
  MemberRow,
  Membership,
  NotificationEventType,
  NotificationPreference,
  Profile,
  SimilarTeam,
  Team,
  TeamRole,
} from "@/lib/team/types";

/**
 * Read side of the team model. Every function takes the caller's session
 * client so RLS decides visibility; writes live in server actions.
 */

const TEAM_COLUMNS =
  "id, name, slug, description, discoverability, domain, logo_path, logo_on_briefs, routing_days, routing_day_type, routing_holiday_calendar, sending_identity, sending_address, reply_to_email, per_investigator_limit, signature, archived_at, created_at";

type TeamRecord = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  discoverability: Team["discoverability"];
  domain: string;
  logo_path: string | null;
  logo_on_briefs: boolean;
  routing_days: number;
  routing_day_type: Team["routingDayType"];
  routing_holiday_calendar: Team["routingHolidayCalendar"];
  sending_identity: Team["sendingIdentity"];
  sending_address: string | null;
  reply_to_email: string | null;
  per_investigator_limit: number;
  signature: string | null;
  archived_at: string | null;
  created_at: string;
};

export function mapTeam(r: TeamRecord): Team {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    discoverability: r.discoverability,
    domain: r.domain,
    logoPath: r.logo_path,
    logoOnBriefs: r.logo_on_briefs,
    routingDays: r.routing_days,
    routingDayType: r.routing_day_type,
    routingHolidayCalendar: r.routing_holiday_calendar,
    sendingIdentity: r.sending_identity,
    sendingAddress: r.sending_address,
    replyToEmail: r.reply_to_email,
    perInvestigatorLimit: r.per_investigator_limit,
    signature: r.signature,
    archivedAt: r.archived_at,
    createdAt: r.created_at,
  };
}

export async function getProfile(supabase: SupabaseClient, userId: string): Promise<Profile | null> {
  const { data } = await supabase
    .from("profiles")
    .select("id, email, full_name, title, department, role, institution_roles, current_team_id, digest_time, digest_weekdays_only")
    .eq("id", userId)
    .maybeSingle();
  if (!data) return null;
  const r = data as {
    id: string;
    email: string | null;
    full_name: string | null;
    title: string | null;
    department: string | null;
    role: string;
    institution_roles: string[] | null;
    current_team_id: string | null;
    digest_time: Profile["digestTime"] | null;
    digest_weekdays_only: boolean | null;
  };
  return {
    id: r.id,
    email: r.email,
    fullName: r.full_name?.trim() || null,
    title: r.title,
    department: r.department,
    legacyRole: r.role === "admin" ? "admin" : "staff",
    institutionRoles: r.institution_roles ?? [],
    currentTeamId: r.current_team_id,
    digestTime: r.digest_time ?? "07:30",
    digestWeekdaysOnly: r.digest_weekdays_only ?? true,
  };
}

export async function listMyMemberships(
  supabase: SupabaseClient,
  userId: string,
): Promise<Array<Membership & { team: Team }>> {
  const { data } = await supabase
    .from("team_memberships")
    .select(`team_id, user_id, role, joined_at, teams:team_id (${TEAM_COLUMNS})`)
    .eq("user_id", userId)
    .order("joined_at", { ascending: true });
  const rows = (data ?? []) as unknown as Array<{
    team_id: string;
    user_id: string;
    role: TeamRole;
    joined_at: string;
    teams: TeamRecord | TeamRecord[] | null;
  }>;
  return rows.flatMap((r) => {
    const t = Array.isArray(r.teams) ? r.teams[0] : r.teams;
    if (!t) return [];
    return [{ teamId: r.team_id, userId: r.user_id, role: r.role, joinedAt: r.joined_at, team: mapTeam(t) }];
  });
}

export async function getTeam(supabase: SupabaseClient, teamId: string): Promise<Team | null> {
  const { data } = await supabase.from("teams").select(TEAM_COLUMNS).eq("id", teamId).maybeSingle();
  return data ? mapTeam(data as TeamRecord) : null;
}

export async function getTeamBySlug(supabase: SupabaseClient, slug: string): Promise<Team | null> {
  const { data } = await supabase.from("teams").select(TEAM_COLUMNS).eq("slug", slug).maybeSingle();
  return data ? mapTeam(data as TeamRecord) : null;
}

export async function listTeamMembers(
  supabase: SupabaseClient,
  teamId: string,
  viewerId: string,
): Promise<MemberRow[]> {
  const { data } = await supabase
    .from("team_memberships")
    .select("user_id, role, joined_at, profiles:user_id (full_name, email, department)")
    .eq("team_id", teamId)
    .order("joined_at", { ascending: true });
  const rows = (data ?? []) as unknown as Array<{
    user_id: string;
    role: TeamRole;
    joined_at: string;
    profiles: { full_name: string | null; email: string | null; department: string | null } | null;
  }>;
  return rows.map((r) => ({
    userId: r.user_id,
    fullName: r.profiles?.full_name?.trim() || r.profiles?.email || "Unknown",
    email: r.profiles?.email ?? null,
    department: r.profiles?.department ?? null,
    role: r.role,
    joinedAt: r.joined_at,
    isYou: r.user_id === viewerId,
  }));
}

export async function listFormerMembers(supabase: SupabaseClient, teamId: string): Promise<FormerMemberRow[]> {
  const { data } = await supabase
    .from("team_former_members")
    .select("id, full_name, email, former_role, reason, left_at")
    .eq("team_id", teamId)
    .order("left_at", { ascending: false })
    .limit(20);
  return ((data ?? []) as Array<{
    id: string;
    full_name: string;
    email: string | null;
    former_role: TeamRole;
    reason: "left" | "removed";
    left_at: string;
  }>).map((r) => ({
    id: r.id,
    fullName: r.full_name,
    email: r.email,
    formerRole: r.former_role,
    reason: r.reason,
    leftAt: r.left_at,
  }));
}

type RequestRecord = {
  id: string;
  team_id: string;
  user_id: string;
  note: string | null;
  source: "chooser" | "link";
  status: AccessRequestRow["status"];
  requested_at: string;
  expires_at: string;
  teams: { name: string } | null;
  profiles: { full_name: string | null; email: string | null; title: string | null } | null;
};

function mapRequest(r: RequestRecord): AccessRequestRow {
  return {
    id: r.id,
    teamId: r.team_id,
    teamName: r.teams?.name ?? "",
    userId: r.user_id,
    fullName: r.profiles?.full_name?.trim() || r.profiles?.email || "Unknown",
    email: r.profiles?.email ?? null,
    title: r.profiles?.title ?? null,
    note: r.note,
    source: r.source,
    status: r.status,
    requestedAt: r.requested_at,
    expiresAt: r.expires_at,
  };
}

const REQUEST_SELECT =
  "id, team_id, user_id, note, source, status, requested_at, expires_at, teams:team_id (name), profiles:user_id (full_name, email, title)";

/** Pending requests for a team (owners/admins). */
export async function listTeamAccessRequests(supabase: SupabaseClient, teamId: string): Promise<AccessRequestRow[]> {
  const { data } = await supabase
    .from("team_access_requests")
    .select(REQUEST_SELECT)
    .eq("team_id", teamId)
    .eq("status", "pending")
    .order("requested_at", { ascending: false });
  return ((data ?? []) as unknown as RequestRecord[]).map(mapRequest);
}

/** The caller's own requests, any status, newest first. */
export async function listMyAccessRequests(supabase: SupabaseClient, userId: string): Promise<AccessRequestRow[]> {
  const { data } = await supabase
    .from("team_access_requests")
    .select(REQUEST_SELECT)
    .eq("user_id", userId)
    .order("requested_at", { ascending: false });
  return ((data ?? []) as unknown as RequestRecord[]).map(mapRequest);
}

type InvitationRecord = {
  id: string;
  team_id: string;
  email: string;
  role: InvitationRow["role"];
  invited_by: string | null;
  created_at: string;
  expires_at: string;
  last_sent_at: string | null;
  bounced: boolean;
  accepted_at: string | null;
  declined_at: string | null;
  revoked_at: string | null;
  teams: { name: string } | null;
  inviter: { full_name: string | null } | null;
};

const INVITATION_SELECT =
  "id, team_id, email, role, invited_by, created_at, expires_at, last_sent_at, bounced, accepted_at, declined_at, revoked_at, teams:team_id (name), inviter:invited_by (full_name)";

function mapInvitation(r: InvitationRecord): InvitationRow {
  return {
    id: r.id,
    teamId: r.team_id,
    teamName: r.teams?.name ?? "",
    email: r.email,
    role: r.role,
    invitedById: r.invited_by,
    invitedByName: r.inviter?.full_name?.trim() || null,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    lastSentAt: r.last_sent_at,
    bounced: r.bounced,
    accepted: Boolean(r.accepted_at),
    declined: Boolean(r.declined_at),
    revoked: Boolean(r.revoked_at),
  };
}

/** Open invitations sent by a team (owners/admins). Expired ones stay listed so they can be re-sent. */
export async function listTeamInvitations(supabase: SupabaseClient, teamId: string): Promise<InvitationRow[]> {
  const { data } = await supabase
    .from("team_invitations")
    .select(INVITATION_SELECT)
    .eq("team_id", teamId)
    .is("accepted_at", null)
    .is("declined_at", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  return ((data ?? []) as unknown as InvitationRecord[]).map(mapInvitation);
}

/** Open invitations addressed to the caller's email. */
export async function listMyInvitations(supabase: SupabaseClient, email: string | null): Promise<InvitationRow[]> {
  if (!email) return [];
  const { data } = await supabase
    .from("team_invitations")
    .select(INVITATION_SELECT)
    .eq("email", email.toLowerCase())
    .is("accepted_at", null)
    .is("declined_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  return ((data ?? []) as unknown as InvitationRecord[]).map(mapInvitation);
}

export async function getInviteLink(supabase: SupabaseClient, teamId: string): Promise<InviteLink | null> {
  const { data } = await supabase
    .from("team_invite_links")
    .select("token, expires_at, created_at")
    .eq("team_id", teamId)
    .maybeSingle();
  if (!data) return null;
  const r = data as { token: string; expires_at: string; created_at: string };
  return { token: r.token, expiresAt: r.expires_at, createdAt: r.created_at };
}

export async function listDiscoverableTeams(supabase: SupabaseClient): Promise<DiscoverableTeam[]> {
  const { data } = await supabase.rpc("discoverable_teams");
  return ((data ?? []) as Array<{
    id: string;
    name: string;
    slug: string;
    description: string | null;
    member_count: number;
    owner_name: string | null;
  }>).map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    memberCount: Number(r.member_count),
    ownerName: r.owner_name,
  }));
}

export async function listSimilarTeams(supabase: SupabaseClient, name: string): Promise<SimilarTeam[]> {
  const { data } = await supabase.rpc("similar_teams", { p_name: name });
  return ((data ?? []) as Array<{ id: string; name: string; member_count: number; discoverable: boolean }>).map(
    (r) => ({ id: r.id, name: r.name, memberCount: Number(r.member_count), discoverable: r.discoverable }),
  );
}

export const NOTIFICATION_EVENT_TYPES: NotificationEventType[] = [
  "pi_reply",
  "access_requests",
  "saved_search_matches",
  "watched_forecasts",
  "next_actions_due",
  "data_source_failing",
];

const DEFAULT_PREFS: Record<NotificationEventType, { immediate: boolean; digest: boolean }> = {
  pi_reply: { immediate: true, digest: false },
  access_requests: { immediate: true, digest: false },
  saved_search_matches: { immediate: false, digest: true },
  watched_forecasts: { immediate: false, digest: true },
  next_actions_due: { immediate: false, digest: true },
  data_source_failing: { immediate: true, digest: false },
};

export async function getNotificationPreferences(
  supabase: SupabaseClient,
  userId: string,
): Promise<NotificationPreference[]> {
  const { data } = await supabase
    .from("notification_preferences")
    .select("event_type, immediate, digest")
    .eq("user_id", userId);
  const byType = new Map(
    ((data ?? []) as Array<{ event_type: NotificationEventType; immediate: boolean; digest: boolean }>).map((r) => [
      r.event_type,
      r,
    ]),
  );
  return NOTIFICATION_EVENT_TYPES.map((eventType) => {
    const row = byType.get(eventType);
    return {
      eventType,
      immediate: row?.immediate ?? DEFAULT_PREFS[eventType].immediate,
      digest: row?.digest ?? DEFAULT_PREFS[eventType].digest,
    };
  });
}
