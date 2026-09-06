import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron/authorize-cron-request";
import { FIT_PROFILES_CRON_LIMIT, FIT_PROFILES_CRON_TIME_BUDGET_MS, FIT_PROFILES_MODEL_CONCURRENCY, modelCallsPerRun, syncInvestigatorFitProfiles } from "@/lib/fit/profile/sync";
import { createServiceRoleClient } from "@/lib/supabase/admin-service";

export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A trimmed, lower-cased UUID, or null — ids reach PostgREST filter strings (`.or(...)` in loadCollaborators), so nothing else may pass. */
function asUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim().toLowerCase();
  return UUID.test(s) ? s : null;
}

/**
 * Daily 09:00 UTC (vercel.json), after embed-opportunities: rebuild the
 * investigator fit profiles that are due — never built, pending (a partial
 * build), on an old taxonomy version, older than the newest source refresh
 * or the record's own update, or older than the refresh window — most urgent
 * first, stopping new investigators after 240 s (the same instant stops new
 * model calls inside a build) or once the run's model budget
 * (FIT_PROFILE_MODEL_CALLS_PER_RUN, default 300) is spent; 4 model calls in
 * flight per build. Logged to sync_job_logs as job_type `fit_profiles`.
 * Vercel Cron uses GET; manual runs may POST { limit?, cursor?, investigatorIds?, force?, dryRun?, maxModelCalls?, modelConcurrency? }.
 * `cursor` and every `investigatorIds` entry must be UUIDs (400 otherwise).
 * Headers: Authorization: Bearer <CRON_SECRET>
 */
async function handle(req: Request) {
  const denied = authorizeCronRequest(req);
  if (denied) return denied;

  const supabase = createServiceRoleClient();
  if (!supabase) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 503 });

  let params: { limit?: number; cursor?: string; investigatorIds?: string[]; force?: boolean; dryRun?: boolean; maxModelCalls?: number; modelConcurrency?: number } = {};
  if (req.method === "POST") {
    let body: Record<string, unknown> = {};
    try {
      body = ((await req.json()) ?? {}) as Record<string, unknown>;
    } catch {
      /* no body */
    }
    if (body.cursor !== undefined && body.cursor !== null && body.cursor !== "" && !asUuid(body.cursor)) {
      return NextResponse.json({ ok: false, error: "cursor must be an investigator UUID" }, { status: 400 });
    }
    let investigatorIds: string[] | undefined;
    if (body.investigatorIds !== undefined && body.investigatorIds !== null) {
      if (!Array.isArray(body.investigatorIds)) return NextResponse.json({ ok: false, error: "investigatorIds must be an array of UUIDs" }, { status: 400 });
      const bad = body.investigatorIds.filter((v) => !asUuid(v));
      if (bad.length) return NextResponse.json({ ok: false, error: `investigatorIds must be UUIDs; rejected ${bad.length}: ${bad.slice(0, 5).map(String).join(", ")}` }, { status: 400 });
      investigatorIds = Array.from(new Set(body.investigatorIds.map((v) => asUuid(v)!))).slice(0, 200);
    }
    params = {
      limit: typeof body.limit === "number" ? Math.min(Math.max(1, Math.floor(body.limit)), 500) : undefined,
      cursor: asUuid(body.cursor) ?? undefined,
      investigatorIds,
      force: Boolean(body.force),
      dryRun: Boolean(body.dryRun),
      maxModelCalls: typeof body.maxModelCalls === "number" && body.maxModelCalls >= 0 ? Math.floor(body.maxModelCalls) : undefined,
      modelConcurrency: typeof body.modelConcurrency === "number" && body.modelConcurrency >= 1 ? Math.floor(body.modelConcurrency) : undefined,
    };
  }

  try {
    const result = await syncInvestigatorFitProfiles(supabase, {
      limit: params.limit ?? FIT_PROFILES_CRON_LIMIT,
      cursor: params.cursor,
      investigatorIds: params.investigatorIds,
      force: params.force,
      dryRun: params.dryRun,
      maxModelCalls: params.maxModelCalls ?? modelCallsPerRun(),
      modelConcurrency: params.modelConcurrency ?? FIT_PROFILES_MODEL_CONCURRENCY,
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
