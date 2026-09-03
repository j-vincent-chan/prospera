import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/admin-service";
import { createClient } from "@/lib/supabase/server";
import type { InstitutionRole } from "@/lib/institution/types";

export type InstitutionActor = { userId: string; email: string | null; fullName: string | null; department: string | null; teamId: string | null; roles: InstitutionRole[] };
export type InstitutionGuard = { ok: true; actor: InstitutionActor; admin: SupabaseClient; session: SupabaseClient } | { ok: false; error: string };

const ROLE_DENIED: Record<InstitutionRole, string> = { curator: "Curators only. Ask a team owner to grant you the Curator role.", library_steward: "Library stewards only. Ask a team owner to grant you the Library steward role." };

/** Signed-in user with profile context; `role` additionally requires that institution role. */
export async function requireInstitutionRole(role: InstitutionRole | null = null): Promise<InstitutionGuard> {
  const session = createClient();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to continue." };
  const { data: profile } = await session.from("profiles").select("email, full_name, department, current_team_id, institution_roles").eq("id", user.id).maybeSingle();
  const p = (profile ?? {}) as { email?: string | null; full_name?: string | null; department?: string | null; current_team_id?: string | null; institution_roles?: string[] | null };
  const roles = (p.institution_roles ?? []).filter((r): r is InstitutionRole => r === "curator" || r === "library_steward");
  if (role && !roles.includes(role)) return { ok: false, error: ROLE_DENIED[role] };
  const admin = createServiceRoleClient();
  if (!admin) return { ok: false, error: "Service role client is not configured." };
  return {
    ok: true,
    actor: { userId: user.id, email: (p.email ?? user.email ?? null)?.toLowerCase() ?? null, fullName: p.full_name?.trim() || null, department: p.department?.trim() || null, teamId: p.current_team_id ?? null, roles },
    admin,
    session,
  };
}

export function hasRole(roles: string[] | null | undefined, role: InstitutionRole): boolean {
  return (roles ?? []).includes(role);
}
