import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron/authorize-cron-request";
import { notifyFailingSources, runDigests } from "@/lib/notifications/digest";
import { createServiceRoleClient } from "@/lib/supabase/admin-service";

export const maxDuration = 300;

/** Hourly: personal digests for members whose digest hour is now (Pacific), plus failing-source alerts. */
async function handle(req: Request) {
  const denied = authorizeCronRequest(req);
  if (denied) return denied;
  const supabase = createServiceRoleClient();
  if (!supabase) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 503 });
  try {
    const digests = await runDigests(supabase);
    const alerts = await notifyFailingSources(supabase);
    return NextResponse.json({ ok: true, digests, sourceAlerts: alerts });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return handle(req);
}
export async function POST(req: Request) {
  return handle(req);
}
