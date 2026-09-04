import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron/authorize-cron-request";
import { notifyFailingSources, runDigests } from "@/lib/notifications/digest";
import { createServiceRoleClient } from "@/lib/supabase/admin-service";

export const maxDuration = 300;

/**
 * Personal digests plus failing-source alerts. Vercel's Hobby plan allows daily
 * crons only, so the schedule fires once a day (8 AM PT) with `window=day`:
 * everyone not yet sent today gets their digest. Pass `?window=hour` from an
 * hourly schedule to honor each member's chosen digest hour instead.
 */
async function handle(req: Request) {
  const denied = authorizeCronRequest(req);
  if (denied) return denied;
  const supabase = createServiceRoleClient();
  if (!supabase) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 503 });
  const window = new URL(req.url).searchParams.get("window") === "hour" ? "hour" : "day";
  try {
    const digests = await runDigests(supabase, new Date(), { window });
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
