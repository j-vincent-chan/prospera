/**
 * Sync the orcid source row after investigators.orcid changes (PR 0.7), the
 * way scripts/fit-fix-profile-ids.ts --set-orcid records it: state available,
 * identity self, external_url, and the provenance in meta.note, merged into
 * whatever the row already holds. Every surface that writes the iD — the
 * onboarding step, the edit sheet, the profile-page identifiers, the import
 * wizard — goes through here, so a refresh, the directory chips and a later
 * audit all see where it came from. Clearing the iD leaves the row
 * unavailable with a note saying so.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { orcidUrl } from "@/lib/investigators/orcid";
import { touchSource } from "@/lib/investigators/refresh-sources";

export type OrcidProvenance = "entered in onboarding" | "entered in edit profile" | "entered on the profile page" | `imported from ${string}`;

/** "orcid 0000-… set 2026-09-05 — entered in onboarding (was 0000-…)" */
export function orcidNote(orcid: string | null, previous: string | null, provenance: OrcidProvenance, on: Date): string {
  const day = on.toISOString().slice(0, 10);
  if (orcid) return `orcid ${orcid} set ${day} — ${provenance}${previous && previous !== orcid ? ` (was ${previous})` : ""}`;
  return `orcid ${previous ?? "—"} cleared ${day} — ${provenance}`;
}

/**
 * The caller has already written investigators.orcid; this brings the source
 * row in step. No-op when the value did not change, so re-saving a sheet
 * never restamps the note.
 */
export async function syncOrcidSource(db: SupabaseClient, investigatorId: string, orcid: string | null, previous: string | null, provenance: OrcidProvenance): Promise<void> {
  if ((orcid ?? null) === (previous ?? null)) return;
  const { data: cur } = await db.from("investigator_sources").select("meta").eq("investigator_id", investigatorId).eq("source", "orcid").maybeSingle();
  const meta = { ...(((cur as { meta?: Record<string, unknown> | null } | null)?.meta) ?? {}), note: orcidNote(orcid, previous, provenance, new Date()) };
  await touchSource(db, investigatorId, "orcid", {
    state: orcid ? "available" : "unavailable",
    identity_method: orcid ? "self" : null,
    external_id: orcid,
    external_url: orcid ? orcidUrl(orcid) : null,
    last_error: null,
    meta,
  });
}
