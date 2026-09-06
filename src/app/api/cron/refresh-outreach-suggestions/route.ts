import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron/authorize-cron-request";
import { runSuggestions } from "@/lib/outreach/suggest";
import { refreshAllCommunityFits } from "@/lib/communities/fits";
import { createServiceRoleClient } from "@/lib/supabase/admin-service";

export const maxDuration = 300;

/**
 * Nightly, 09:50 UTC (vercel.json): re-rank suggestions for every item still
 * in Triage or Contacting (design: "refreshed nightly"), then the community
 * fits cache. Scheduled after the fit-results sweep (09:35, hard stop 09:40)
 * so a fit-v1 team's items read the rows written the same night — PR 2.3
 * moved this entry from 09:15, removing the one-day lag D28 accepted.
 */
async function handle(req: Request) {
  const denied = authorizeCronRequest(req);
  if (denied) return denied;
  const supabase = createServiceRoleClient();
  if (!supabase) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 503 });
  const { data: items } = await supabase.from("outreach_items").select("id").in("stage", ["triage", "contacting"]).in("suggestions_state", ["ready", "outdated", "error"]).order("last_activity_at", { ascending: false }).limit(60);
  let ok = 0;
  let failed = 0;
  for (const it of (items ?? []) as Array<{ id: string }>) {
    const r = await runSuggestions(supabase, it.id);
    if (r.ok) ok += 1;
    else failed += 1;
  }
  await supabase.from("sync_job_logs").insert({ job_type: "outreach_suggestions", status: failed && !ok ? "error" : "success", message: `${ok} items re-ranked, ${failed} failed`, details: { ok, failed }, finished_at: new Date().toISOString() });
  // Communities: "open opportunities that fit this community" uses the same embeddings; refresh alongside.
  const fits = await refreshAllCommunityFits(supabase);
  await supabase.from("sync_job_logs").insert({ job_type: "community_fits", status: fits.failed && !fits.refreshed ? "error" : "success", message: `${fits.refreshed} communit${fits.refreshed === 1 ? "y" : "ies"} refreshed, ${fits.failed} failed`, details: fits, finished_at: new Date().toISOString() });
  return NextResponse.json({ ok: true, items: (items ?? []).length, refreshed: ok, failed, communityFits: fits });
}

export async function GET(req: Request) {
  return handle(req);
}
export async function POST(req: Request) {
  return handle(req);
}
