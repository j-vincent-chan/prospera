import type { SupabaseClient } from "@supabase/supabase-js";

/** Institution-wide audit trail: publish/unpublish, imports, role grants ("logged to the audit trail"). */
export async function logAudit(admin: SupabaseClient, input: { entityType: string; entityId?: string | null; action: string; actorId?: string | null; actorName?: string | null; details?: Record<string, unknown> }): Promise<void> {
  await admin.from("institution_audit_log").insert({ entity_type: input.entityType, entity_id: input.entityId ?? null, action: input.action, actor_id: input.actorId ?? null, actor_name: input.actorName ?? null, details: input.details ?? {} });
}
