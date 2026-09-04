"use server";

import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/institution/audit";
import { INSTITUTION_ROLE_LABEL, type InstitutionRole } from "@/lib/institution/types";
import { requireTeamRole } from "@/lib/team/require-team";

type Result<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; error: string };

/**
 * Team owners and admins grant UCSF-wide roles to members of their team.
 * Roles are institution-wide (not per team) and every change is audited.
 */
export async function setInstitutionRolesAction(input: { userId: string; roles: InstitutionRole[]; teamId?: string }): Promise<Result<{ previous: InstitutionRole[] }>> {
  const guard = await requireTeamRole("admin", input.teamId);
  if (!guard.ok) return guard;
  const { admin, actor } = guard;
  const { data: member } = await admin.from("team_memberships").select("user_id").eq("team_id", actor.teamId).eq("user_id", input.userId).maybeSingle();
  if (!member) return { ok: false, error: "That person isn't a member of this team." };
  const roles = Array.from(new Set(input.roles.filter((r): r is InstitutionRole => r === "curator" || r === "library_steward")));
  const { data: profile } = await admin.from("profiles").select("institution_roles, full_name").eq("id", input.userId).maybeSingle();
  const previous = ((profile as { institution_roles?: string[] } | null)?.institution_roles ?? []).filter((r): r is InstitutionRole => r === "curator" || r === "library_steward");
  const { error } = await admin.from("profiles").update({ institution_roles: roles }).eq("id", input.userId);
  if (error) return { ok: false, error: error.message };
  const added = roles.filter((r) => !previous.includes(r));
  const removed = previous.filter((r) => !roles.includes(r));
  for (const r of added) await logAudit(admin, { entityType: "institution_role", entityId: input.userId, action: "grant", actorId: actor.userId, actorName: actor.fullName, details: { role: r, label: INSTITUTION_ROLE_LABEL[r], teamId: actor.teamId, person: (profile as { full_name?: string | null } | null)?.full_name ?? null } });
  for (const r of removed) await logAudit(admin, { entityType: "institution_role", entityId: input.userId, action: "revoke", actorId: actor.userId, actorName: actor.fullName, details: { role: r, label: INSTITUTION_ROLE_LABEL[r], teamId: actor.teamId, person: (profile as { full_name?: string | null } | null)?.full_name ?? null } });
  revalidatePath("/team");
  revalidatePath("/library");
  revalidatePath("/curate");
  revalidatePath("/opportunities");
  return { ok: true, previous };
}
