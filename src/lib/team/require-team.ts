import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/admin-service";
import { createClient } from "@/lib/supabase/server";
import { ROLE_RANK, type TeamRole } from "@/lib/team/types";

export type TeamActor = {
  userId: string;
  email: string | null;
  fullName: string | null;
  teamId: string;
  role: TeamRole;
};

export type Guard<T> = { ok: true } & T | { ok: false; error: string };

/**
 * Server-action guard: the signed-in user's membership in `teamId` (or their
 * current team when omitted) at or above `minRole`. Returns the actor plus
 * a service-role client for the write, mirroring the rdsg_owners pattern.
 */
export async function requireTeamRole(
  minRole: TeamRole,
  teamId?: string,
): Promise<Guard<{ actor: TeamActor; admin: SupabaseClient; session: SupabaseClient }>> {
  const session = createClient();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to continue." };

  const { data: profile } = await session
    .from("profiles")
    .select("email, full_name, current_team_id")
    .eq("id", user.id)
    .maybeSingle();
  const p = (profile ?? {}) as { email?: string | null; full_name?: string | null; current_team_id?: string | null };

  const targetTeam = teamId ?? p.current_team_id ?? null;
  if (!targetTeam) return { ok: false, error: "You're not in a team yet." };

  const { data: membership } = await session
    .from("team_memberships")
    .select("role")
    .eq("team_id", targetTeam)
    .eq("user_id", user.id)
    .maybeSingle();
  const role = (membership as { role?: TeamRole } | null)?.role;
  if (!role) return { ok: false, error: "You're not a member of this team." };
  if (ROLE_RANK[role] < ROLE_RANK[minRole]) {
    return { ok: false, error: `${minRole === "owner" ? "Owners" : "Owners and admins"} only.` };
  }

  const admin = createServiceRoleClient();
  if (!admin) return { ok: false, error: "Service role client is not configured." };

  return {
    ok: true,
    actor: {
      userId: user.id,
      email: p.email ?? user.email ?? null,
      fullName: p.full_name?.trim() || null,
      teamId: targetTeam,
      role,
    },
    admin,
    session,
  };
}

/** Signed-in user without a membership requirement (onboarding, personal settings). */
export async function requireUser(): Promise<
  Guard<{ userId: string; email: string | null; fullName: string | null; admin: SupabaseClient; session: SupabaseClient }>
> {
  const session = createClient();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to continue." };

  const { data: profile } = await session
    .from("profiles")
    .select("email, full_name")
    .eq("id", user.id)
    .maybeSingle();
  const p = (profile ?? {}) as { email?: string | null; full_name?: string | null };

  const admin = createServiceRoleClient();
  if (!admin) return { ok: false, error: "Service role client is not configured." };

  return {
    ok: true,
    userId: user.id,
    email: (p.email ?? user.email ?? null)?.toLowerCase() ?? null,
    fullName: p.full_name?.trim() || null,
    admin,
    session,
  };
}
