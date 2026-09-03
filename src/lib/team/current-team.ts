import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getProfile,
  listMyAccessRequests,
  listMyInvitations,
  listMyMemberships,
} from "@/lib/team/queries";
import {
  ROLE_LABEL,
  teamInitials,
  teamLogoUrl,
  type Membership,
  type Profile,
  type Team,
  type TeamRole,
} from "@/lib/team/types";

/** What the sidebar switcher renders for one team. */
export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  initials: string;
  logoUrl: string | null;
  role: TeamRole;
  roleLabel: string;
  archived: boolean;
};

export type CurrentWorkspace = WorkspaceSummary & {
  /** All workspaces the user belongs to, current one included. */
  teams: WorkspaceSummary[];
  /** Open invitations + pending access requests awaiting this user. */
  pendingCount: number;
};

export type WorkspaceContext = {
  profile: Profile;
  memberships: Array<Membership & { team: Team }>;
  /** Null when the user belongs to no team yet (onboarding / waiting room). */
  current: (Membership & { team: Team }) | null;
  workspace: CurrentWorkspace | null;
  pendingCount: number;
};

function summarize(m: Membership & { team: Team }): WorkspaceSummary {
  return {
    id: m.team.id,
    name: m.team.name,
    slug: m.team.slug,
    initials: teamInitials(m.team.name),
    logoUrl: teamLogoUrl(m.team.logoPath),
    role: m.role,
    roleLabel: ROLE_LABEL[m.role],
    archived: Boolean(m.team.archivedAt),
  };
}

/**
 * Resolve the signed-in user's workspace: profile, memberships, the current
 * team (profile.current_team_id, falling back to the first membership) and
 * the switcher model. Pending count covers invitations to the user's email
 * plus their own open access requests.
 */
export async function loadWorkspaceContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<WorkspaceContext | null> {
  const profile = await getProfile(supabase, userId);
  if (!profile) return null;

  const [memberships, invitations, requests] = await Promise.all([
    listMyMemberships(supabase, userId),
    listMyInvitations(supabase, profile.email),
    listMyAccessRequests(supabase, userId),
  ]);

  const pendingCount = invitations.length + requests.filter((r) => r.status === "pending").length;

  const current =
    memberships.find((m) => m.teamId === profile.currentTeamId) ?? memberships[0] ?? null;

  const workspace: CurrentWorkspace | null = current
    ? {
        ...summarize(current),
        teams: memberships.map(summarize),
        pendingCount,
      }
    : null;

  return { profile, memberships, current, workspace, pendingCount };
}

/** Current team for the signed-in user: profile.current_team_id, else the first membership. */
export async function getCurrentTeamId(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("current_team_id")
    .eq("id", userId)
    .maybeSingle();
  const fromProfile = (profile as { current_team_id?: string | null } | null)?.current_team_id ?? null;
  if (fromProfile) return fromProfile;
  const { data: membership } = await supabase
    .from("team_memberships")
    .select("team_id")
    .eq("user_id", userId)
    .order("joined_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (membership as { team_id?: string } | null)?.team_id ?? null;
}
