import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron/authorize-cron-request";
import { runSuggestions } from "@/lib/outreach/suggest";
import { createServiceRoleClient } from "@/lib/supabase/admin-service";

export const maxDuration = 300;

/** Nightly: re-rank suggestions for every item still in Triage or Contacting (design: "refreshed nightly"). */
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
  return NextResponse.json({ ok: true, items: (items ?? []).length, refreshed: ok, failed });
}

export async function GET(req: Request) {
  return handle(req);
}
export async function POST(req: Request) {
  return handle(req);
}
