import type { SupabaseClient } from "@supabase/supabase-js";
import { ROLE_RANK, type TeamRole } from "@/lib/team/types";

/** Who cleared the gate: the pre-teams global flag, or a role on the user's current team. */
export type AdminGrant = "profile_role" | "team_role";

export type AdminCheck = { ok: true; userId: string; via: AdminGrant } | { ok: false; error: string };

/** Team roles that count as an administrator of the workspace. */
const ADMIN_TEAM_ROLES: readonly TeamRole[] = ["owner", "admin"];

/**
 * The gate on the fit inspectors, the gold-set labeling page and the
 * admin-only actions beside them.
 *
 * Two things can open it, and the second one is why this is not just a
 * `profiles.role` read:
 *
 *   1. `profiles.role = 'admin'` — a global flag from the April 2026 init
 *      schema, before teams existed. **Nothing in the product writes it**;
 *      it only ever sits on the account that seeded the database, and there
 *      is no screen that can grant it. On its own it makes these pages
 *      unreachable by anyone who joined afterwards.
 *   2. `team_memberships.role` of `owner` or `admin` on the user's current
 *      team — the role the Team screen shows and the only one the product
 *      can actually assign. This is the same bar D50 set for deciding a fit
 *      correction, which mutates an institution-wide profile and re-scores
 *      the roster: strictly heavier than reading an inspector or saving a
 *      gold label, so accepting it here does not widen the class of person
 *      who can already do the most consequential thing these surfaces lead
 *      to.
 *
 * Without (2) the Team screen says "Admin" beside a name while every admin
 * page refuses them, with no way for anyone to fix it from inside the app.
 */
export async function requireAdmin(supabase: SupabaseClient): Promise<AdminCheck> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Unauthorized" };

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role, current_team_id")
    .eq("id", user.id)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  const p = (profile ?? {}) as { role?: string | null; current_team_id?: string | null };
  if (p.role === "admin") return { ok: true, userId: user.id, via: "profile_role" };

  const teamId = p.current_team_id ?? null;
  if (!teamId) return { ok: false, error: "Admin role required" };

  const { data: membership, error: membershipError } = await supabase
    .from("team_memberships")
    .select("role")
    .eq("team_id", teamId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) return { ok: false, error: membershipError.message };
  const role = (membership as { role?: TeamRole } | null)?.role;
  if (role && ADMIN_TEAM_ROLES.includes(role)) return { ok: true, userId: user.id, via: "team_role" };

  return { ok: false, error: "Admin role required" };
}

/** Pure. Whether a team role administers the workspace — `ROLE_RANK` ordered, so a new role above admin counts automatically. */
export function isAdminTeamRole(role: TeamRole | null | undefined): boolean {
  return Boolean(role && ROLE_RANK[role] >= ROLE_RANK.admin);
}
