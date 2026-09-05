import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron/authorize-cron-request";
import { EXEMPLARS_CRON_LIMIT, EXEMPLARS_CRON_TIME_BUDGET_MS, syncOpportunityExemplars } from "@/lib/ingestion/reporter/exemplars-sync";
import { createServiceRoleClient } from "@/lib/supabase/admin-service";

export const maxDuration = 300;

/**
 * Daily (vercel.json): RePORTER exemplars for open NIH notices that were never
 * fetched or were fetched more than 30 days ago — a monthly refresh per notice,
 * in batches the 300 s budget can hold. Each run takes the oldest-stamped
 * notices first and stops starting new ones after 240 s; the next run resumes.
 * Vercel Cron uses GET; manual runs may POST { limit?, opportunityNumbers?, dryRun? }.
 * Headers: Authorization: Bearer <CRON_SECRET>
 */
async function handle(req: Request) {
  const denied = authorizeCronRequest(req);
  if (denied) return denied;

  const supabase = createServiceRoleClient();
  if (!supabase) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 503 });

  let params: { limit?: number; opportunityNumbers?: string[]; dryRun?: boolean } = {};
  if (req.method === "POST") {
    try {
      const body = (await req.json()) as typeof params;
      params = {
        limit: typeof body.limit === "number" ? Math.min(Math.max(1, body.limit), 500) : undefined,
        opportunityNumbers: Array.isArray(body.opportunityNumbers) ? body.opportunityNumbers.filter((n) => typeof n === "string").slice(0, 200) : undefined,
        dryRun: Boolean(body.dryRun),
      };
    } catch {
      /* no body */
    }
  }

  const result = await syncOpportunityExemplars(supabase, {
    limit: params.limit ?? EXEMPLARS_CRON_LIMIT,
    opportunityNumbers: params.opportunityNumbers,
    dryRun: params.dryRun,
    timeBudgetMs: EXEMPLARS_CRON_TIME_BUDGET_MS,
  });
  if (!result.ok) return NextResponse.json(result, { status: 500 });
  const { notices, ...summary } = result;
  return NextResponse.json({ ...summary, lines: notices.map((n) => n.line) });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
