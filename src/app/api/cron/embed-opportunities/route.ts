import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron/authorize-cron-request";
import { listOpenOpportunityIds, syncOpportunityEmbeddings } from "@/lib/outreach/embeddings";
import { createServiceRoleClient } from "@/lib/supabase/admin-service";

export const maxDuration = 300;

/** Nightly, after the Simpler sync: embed open notices that are new or changed. */
async function handle(req: Request) {
  const denied = authorizeCronRequest(req);
  if (denied) return denied;
  const supabase = createServiceRoleClient();
  if (!supabase) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 503 });
  try {
    const ids = await listOpenOpportunityIds(supabase);
    const result = await syncOpportunityEmbeddings(supabase, ids);
    await supabase.from("sync_job_logs").insert({ job_type: "opportunity_embeddings", status: "success", message: `${result.embedded} embedded, ${result.skipped} unchanged of ${ids.length} open notices`, details: { ...result, open: ids.length }, finished_at: new Date().toISOString() });
    return NextResponse.json({ ok: true, open: ids.length, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await supabase.from("sync_job_logs").insert({ job_type: "opportunity_embeddings", status: "error", message, finished_at: new Date().toISOString() });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return handle(req);
}
export async function POST(req: Request) {
  return handle(req);
}
