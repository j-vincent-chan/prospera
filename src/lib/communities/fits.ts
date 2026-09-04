/**
 * "Open opportunities that fit this community": every roster member's
 * embedding against open notices (one RPC per community), aggregated per
 * notice with the suggestion engine's thresholds so tiers never disagree.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { SIM } from "@/lib/outreach/suggest";

export type FitsRefresh = { ok: true; communityId: string; members: number; embedded: number; notices: number } | { ok: false; error: string };

export async function refreshCommunityFits(db: SupabaseClient, communityId: string): Promise<FitsRefresh> {
  const { data: members } = await db.from("community_members").select("investigator_id, investigators!inner(id, archived_at)").eq("community_id", communityId).is("investigators.archived_at", null);
  const ids = ((members ?? []) as Array<{ investigator_id: string }>).map((m) => m.investigator_id);
  const { data: embeds } = ids.length ? await db.from("investigator_embeddings").select("investigator_id").in("investigator_id", ids) : { data: [] };
  const embedded = ((embeds ?? []) as Array<{ investigator_id: string }>).map((e) => e.investigator_id);
  const byNotice = new Map<string, { ids: string[]; strong: number; potential: number; score: number }>();
  if (embedded.length) {
    for (let i = 0; i < embedded.length; i += 25) {
      const { data, error } = await db.rpc("match_opportunities_for_investigators", { p_investigator_ids: embedded.slice(i, i + 25), match_count: 25, similarity_floor: SIM.potential });
      if (error) return { ok: false, error: error.message };
      for (const h of (data ?? []) as Array<{ investigator_id: string; opportunity_id: string; similarity: number }>) {
        const cur = byNotice.get(h.opportunity_id) ?? { ids: [], strong: 0, potential: 0, score: 0 };
        cur.ids.push(h.investigator_id);
        if (h.similarity >= SIM.strong) cur.strong += 1;
        else cur.potential += 1;
        cur.score += h.similarity >= SIM.strong ? 1 : 0.5;
        byNotice.set(h.opportunity_id, cur);
      }
    }
  }
  const now = new Date().toISOString();
  const rows = Array.from(byNotice.entries()).map(([opportunity_id, v]) => ({ community_id: communityId, opportunity_id, investigator_ids: v.ids, strong_count: v.strong, potential_count: v.potential, score: v.score, computed_at: now }));
  const { error: delErr } = await db.from("community_fits").delete().eq("community_id", communityId);
  if (delErr) return { ok: false, error: delErr.message };
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from("community_fits").insert(rows.slice(i, i + 200));
    if (error) return { ok: false, error: error.message };
  }
  await db.from("pipeline_communities").update({ fits_refreshed_at: now }).eq("id", communityId);
  return { ok: true, communityId, members: ids.length, embedded: embedded.length, notices: rows.length };
}

export async function refreshAllCommunityFits(db: SupabaseClient): Promise<{ refreshed: number; failed: number }> {
  const { data } = await db.from("pipeline_communities").select("id").eq("monitored", true).eq("active", true);
  let refreshed = 0;
  let failed = 0;
  for (const c of (data ?? []) as Array<{ id: string }>) {
    const r = await refreshCommunityFits(db, c.id);
    if (r.ok) refreshed += 1;
    else failed += 1;
  }
  return { refreshed, failed };
}
