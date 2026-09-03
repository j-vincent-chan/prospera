import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron/authorize-cron-request";
import { syncNihGuide } from "@/lib/services/nih-guide-sync";
import { createServiceRoleClient } from "@/lib/supabase/admin-service";

export const maxDuration = 300;

/**
 * Nightly, after the Simpler sync: NIH Guide pages → receipt cycles and Key Dates.
 * Vercel Cron uses GET; manual runs may POST { limit?, force?, opportunityNumbers? }.
 * Headers: Authorization: Bearer <CRON_SECRET>
 */
async function handle(req: Request) {
  const denied = authorizeCronRequest(req);
  if (denied) return denied;

  const supabase = createServiceRoleClient();
  if (!supabase) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 503 });

  let params: { limit?: number; force?: boolean; opportunityNumbers?: string[] } = {};
  if (req.method === "POST") {
    try {
      const body = (await req.json()) as typeof params;
      params = {
        limit: typeof body.limit === "number" ? Math.min(Math.max(1, body.limit), 1500) : undefined,
        force: Boolean(body.force),
        opportunityNumbers: Array.isArray(body.opportunityNumbers) ? body.opportunityNumbers.filter((n) => typeof n === "string").slice(0, 200) : undefined,
      };
    } catch {
      /* no body */
    }
  }

  const result = await syncNihGuide(supabase, params);
  if (!result.ok) return NextResponse.json(result, { status: 500 });
  return NextResponse.json(result);
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
