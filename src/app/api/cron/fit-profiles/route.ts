import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron/authorize-cron-request";
import { FIT_PROFILES_CRON_LIMIT, FIT_PROFILES_CRON_TIME_BUDGET_MS, modelCallsPerRun, syncInvestigatorFitProfiles } from "@/lib/fit/profile/sync";
import { createServiceRoleClient } from "@/lib/supabase/admin-service";

export const maxDuration = 300;

/**
 * Daily 09:00 UTC (vercel.json), after embed-opportunities: rebuild the
 * investigator fit profiles that are due — never built, on an old taxonomy
 * version, older than the refresh window, or older than the newest source
 * refresh — in id order, stopping new investigators after 240 s or once the
 * run's model budget (FIT_PROFILE_MODEL_CALLS_PER_RUN, default 300) is spent.
 * Logged to sync_job_logs as job_type `fit_profiles`.
 * Vercel Cron uses GET; manual runs may POST { limit?, cursor?, investigatorIds?, force?, dryRun?, maxModelCalls? }.
 * Headers: Authorization: Bearer <CRON_SECRET>
 */
async function handle(req: Request) {
  const denied = authorizeCronRequest(req);
  if (denied) return denied;

  const supabase = createServiceRoleClient();
  if (!supabase) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 503 });

  let params: { limit?: number; cursor?: string; investigatorIds?: string[]; force?: boolean; dryRun?: boolean; maxModelCalls?: number } = {};
  if (req.method === "POST") {
    try {
      const body = (await req.json()) as typeof params;
      params = {
        limit: typeof body.limit === "number" ? Math.min(Math.max(1, body.limit), 500) : undefined,
        cursor: typeof body.cursor === "string" && body.cursor.trim() ? body.cursor.trim() : undefined,
        investigatorIds: Array.isArray(body.investigatorIds) ? body.investigatorIds.filter((n) => typeof n === "string").slice(0, 200) : undefined,
        force: Boolean(body.force),
        dryRun: Boolean(body.dryRun),
        maxModelCalls: typeof body.maxModelCalls === "number" && body.maxModelCalls >= 0 ? Math.floor(body.maxModelCalls) : undefined,
      };
    } catch {
      /* no body */
    }
  }

  try {
    const result = await syncInvestigatorFitProfiles(supabase, {
      limit: params.limit ?? FIT_PROFILES_CRON_LIMIT,
      cursor: params.cursor,
      investigatorIds: params.investigatorIds,
      force: params.force,
      dryRun: params.dryRun,
      maxModelCalls: params.maxModelCalls ?? modelCallsPerRun(),
      timeBudgetMs: FIT_PROFILES_CRON_TIME_BUDGET_MS,
    });
    const { investigators, ...summary } = result;
    return NextResponse.json({ ...summary, lines: investigators.map((i) => i.line) });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
