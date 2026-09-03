import type { SupabaseClient } from "@supabase/supabase-js";

/** What the public authorization page needs to render, resolved from the emailed token. */
export type BiosketchRequest = {
  investigatorId: string;
  investigatorName: string;
  teamName: string;
  strategistName: string | null;
  state: string;
  requestedAt: string | null;
  documentDate: string | null;
};

export async function loadBiosketchRequest(admin: SupabaseClient, token: string): Promise<BiosketchRequest | null> {
  if (!/^[a-f0-9]{48}$/.test(token)) return null;
  const { data } = await admin
    .from("investigator_sources")
    .select("investigator_id, state, requested_at, requested_by, document_date, investigators(full_name)")
    .eq("source", "biosketch")
    .eq("request_token", token)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as { investigator_id: string; state: string; requested_at: string | null; requested_by: string | null; document_date: string | null; investigators: { full_name: string } | { full_name: string }[] | null };
  const inv = Array.isArray(row.investigators) ? row.investigators[0] : row.investigators;

  let strategistName: string | null = null;
  let teamName = "the research development team";
  if (row.requested_by) {
    const { data: profile } = await admin.from("profiles").select("full_name, current_team_id").eq("id", row.requested_by).maybeSingle();
    const p = profile as { full_name?: string | null; current_team_id?: string | null } | null;
    strategistName = p?.full_name?.trim() || null;
    if (p?.current_team_id) {
      const { data: team } = await admin.from("teams").select("name").eq("id", p.current_team_id).maybeSingle();
      teamName = (team as { name?: string } | null)?.name ?? teamName;
    }
  }
  return {
    investigatorId: row.investigator_id,
    investigatorName: inv?.full_name ?? "Investigator",
    teamName,
    strategistName,
    state: row.state,
    requestedAt: row.requested_at,
    documentDate: row.document_date,
  };
}
