import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron/authorize-cron-request";
import { isoToday } from "@/lib/funding-opportunities/receipt-cycles";
import { currentFiscalYear } from "@/lib/institution/awards";
import { linkAwardPis, syncReporterAwards } from "@/lib/institution/reporter-sync";
import { createServiceRoleClient } from "@/lib/supabase/admin-service";

export const maxDuration = 300;

/** Weekly: refresh the last two fiscal years of UCSF awards from the public NIH RePORTER API. OSR exports are imported by stewards. */
async function handle(req: Request) {
  const denied = authorizeCronRequest(req);
  if (denied) return denied;
  const supabase = createServiceRoleClient();
  if (!supabase) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 503 });
  const fy = currentFiscalYear(isoToday());
  const r = await syncReporterAwards(supabase, { fiscalYears: [fy - 1, fy] });
  const linked = r.ok ? await linkAwardPis(supabase) : 0;
  return NextResponse.json({ ok: r.ok, upserted: r.upserted, pages: r.pages, linked, error: r.error });
}

export async function GET(req: Request) {
  return handle(req);
}
export async function POST(req: Request) {
  return handle(req);
}
