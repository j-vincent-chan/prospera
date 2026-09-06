/**
 * "Open opportunities that fit this community": every roster member's
 * embedding against open notices (one RPC per community), aggregated per
 * notice with the suggestion engine's thresholds so tiers never disagree.
 *
 * Flag (PR 2.2, `teams.fit_engine`): under `fit-v1` the cache is aggregated
 * from `fit_results` instead — Strong pairs count as strong, Moderate as
 * potential, with the same per-notice score (1 / 0.5) — so the community
 * screen, the investigator page and Outreach show one tier per pair.
 * Under `legacy` the embedding path below runs unchanged.
 *
 * The cache is not team-scoped, and need not be (PR 2.3): a community is an
 * institution-level object — `pipeline_communities` carries no team, its RLS
 * lets every signed-in user read it, and `community_fits` is one row set per
 * community that every team's screen reads. So the cache follows ONE rule
 * for every writer, the on-demand refresh from a screen as much as the
 * nightly: `fit-v1` only when every live team is on it (`loadCronFitEngine`;
 * an archived team does not count), else legacy. PR 2.2 let a server action
 * use the acting team's flag, which
 * made the cache flip engines between a flipped team's click and the next
 * night; with one rule it is deterministic. The trade is that a flipped test
 * team sees legacy community counts until every team is flipped — counts,
 * not pairs: the three per-pair surfaces (investigator page, opportunity
 * page and peek, Outreach) are each gated on the acting team's own flag.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCronFitEngine, type FitEngine } from "@/lib/fit/flag";
import { loadFitResultsForInvestigators, type FitResultKeyRow } from "@/lib/fit/results";
import { SIM } from "@/lib/outreach/suggest";
import { openNoticeFilter } from "@/lib/ingestion/reporter/exemplars";

export type FitsRefresh = { ok: true; communityId: string; members: number; embedded: number; notices: number; engine: FitEngine } | { ok: false; error: string };

export type CommunityFitRow = { community_id: string; opportunity_id: string; investigator_ids: string[]; strong_count: number; potential_count: number; score: number; computed_at: string };

export type RefreshFitsOptions = {
  /** An engine already resolved (the nightly refresh resolves it once for every community); default: the every-team rule, whoever is refreshing. */
  engine?: FitEngine;
};

/** Pure. One cache row per open notice from the members' fit results (the four key columns): strong → strong_count, moderate → potential_count, members best first (score desc, then id), notices in id order. */
export function communityFitRowsFromResults(communityId: string, rows: readonly FitResultKeyRow[], openIds: ReadonlySet<string>, now: string): CommunityFitRow[] {
  const byNotice = new Map<string, { hits: Array<{ id: string; score: number }>; strong: number; potential: number; score: number }>();
  for (const r of rows) {
    if (!openIds.has(r.opportunity_id)) continue;
    if (r.tier !== "strong" && r.tier !== "moderate") continue;
    const cur = byNotice.get(r.opportunity_id) ?? { hits: [], strong: 0, potential: 0, score: 0 };
    cur.hits.push({ id: r.investigator_id, score: Number(r.score) });
    if (r.tier === "strong") cur.strong += 1;
    else cur.potential += 1;
    cur.score += r.tier === "strong" ? 1 : 0.5;
    byNotice.set(r.opportunity_id, cur);
  }
  return Array.from(byNotice.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([opportunity_id, v]) => ({ community_id: communityId, opportunity_id, investigator_ids: v.hits.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((h) => h.id), strong_count: v.strong, potential_count: v.potential, score: v.score, computed_at: now }));
}

async function writeRows(db: SupabaseClient, communityId: string, rows: CommunityFitRow[], now: string): Promise<string | null> {
  const { error: delErr } = await db.from("community_fits").delete().eq("community_id", communityId);
  if (delErr) return delErr.message;
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from("community_fits").insert(rows.slice(i, i + 200));
    if (error) return error.message;
  }
  await db.from("pipeline_communities").update({ fits_refreshed_at: now }).eq("id", communityId);
  return null;
}

/** The fit-v1 path: the members' Strong and Moderate `fit_results` rows (four columns) over the open notices. */
async function refreshFromFitResults(db: SupabaseClient, communityId: string, ids: string[]): Promise<FitsRefresh> {
  const results = ids.length ? await loadFitResultsForInvestigators(db, ids, { tiers: ["strong", "moderate"] }) : { rows: [], available: true, error: null };
  if (!results.available) return { ok: false, error: "fit_results is not on the database yet — apply the fit-results migration, then wait for the nightly fit-results run." };
  if (results.error) return { ok: false, error: results.error };
  const noticeIds = Array.from(new Set(results.rows.map((r) => r.opportunity_id)));
  const today = new Date().toISOString().slice(0, 10);
  const open = new Set<string>();
  for (let i = 0; i < noticeIds.length; i += 100) {
    const { data, error } = await db.from("funding_opportunities").select("id").in("id", noticeIds.slice(i, i + 100)).or(openNoticeFilter(today));
    if (error) return { ok: false, error: error.message };
    for (const r of (data ?? []) as Array<{ id: string }>) open.add(r.id);
  }
  const now = new Date().toISOString();
  const rows = communityFitRowsFromResults(communityId, results.rows, open, now);
  const err = await writeRows(db, communityId, rows, now);
  if (err) return { ok: false, error: err };
  const scored = new Set(results.rows.map((r) => r.investigator_id)).size;
  return { ok: true, communityId, members: ids.length, embedded: scored, notices: rows.length, engine: "fit-v1" };
}

export async function refreshCommunityFits(db: SupabaseClient, communityId: string, opts: RefreshFitsOptions = {}): Promise<FitsRefresh> {
  const engine = opts.engine ?? (await loadCronFitEngine(db));
  const { data: members } = await db.from("community_members").select("investigator_id, investigators!inner(id, archived_at)").eq("community_id", communityId).is("investigators.archived_at", null);
  const ids = ((members ?? []) as Array<{ investigator_id: string }>).map((m) => m.investigator_id);
  if (engine === "fit-v1") return refreshFromFitResults(db, communityId, ids);

  const { data: embeds } = ids.length ? await db.from("investigator_embeddings").select("investigator_id").in("investigator_id", ids) : { data: [] };
  const embedded = ((embeds ?? []) as Array<{ investigator_id: string }>).map((e) => e.investigator_id);
  const byNotice = new Map<string, { hits: Array<{ id: string; sim: number }>; strong: number; potential: number; score: number }>();
  if (embedded.length) {
    for (let i = 0; i < embedded.length; i += 25) {
      const { data, error } = await db.rpc("match_opportunities_for_investigators", { p_investigator_ids: embedded.slice(i, i + 25), match_count: 25, similarity_floor: SIM.potential });
      if (error) return { ok: false, error: error.message };
      for (const h of (data ?? []) as Array<{ investigator_id: string; opportunity_id: string; similarity: number }>) {
        const cur = byNotice.get(h.opportunity_id) ?? { hits: [], strong: 0, potential: 0, score: 0 };
        cur.hits.push({ id: h.investigator_id, sim: h.similarity });
        if (h.similarity >= SIM.strong) cur.strong += 1;
        else cur.potential += 1;
        cur.score += h.similarity >= SIM.strong ? 1 : 0.5;
        byNotice.set(h.opportunity_id, cur);
      }
    }
  }
  const now = new Date().toISOString();
  const rows = Array.from(byNotice.entries()).map(([opportunity_id, v]) => ({ community_id: communityId, opportunity_id, investigator_ids: v.hits.sort((a, b) => b.sim - a.sim).map((h) => h.id), strong_count: v.strong, potential_count: v.potential, score: v.score, computed_at: now }));
  const err = await writeRows(db, communityId, rows, now);
  if (err) return { ok: false, error: err };
  return { ok: true, communityId, members: ids.length, embedded: embedded.length, notices: rows.length, engine: "legacy" };
}

/** The nightly refresh (no acting team): one engine for every community, `fit-v1` only when every live team is on it. */
export async function refreshAllCommunityFits(db: SupabaseClient): Promise<{ refreshed: number; failed: number; engine: FitEngine }> {
  const engine = await loadCronFitEngine(db);
  const { data } = await db.from("pipeline_communities").select("id").eq("monitored", true).eq("active", true);
  let refreshed = 0;
  let failed = 0;
  for (const c of (data ?? []) as Array<{ id: string }>) {
    const r = await refreshCommunityFits(db, c.id, { engine });
    if (r.ok) refreshed += 1;
    else failed += 1;
  }
  return { refreshed, failed, engine };
}
