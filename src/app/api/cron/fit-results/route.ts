import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron/authorize-cron-request";
import { FIT_RESULTS_CRON_LIMIT, FIT_RESULTS_CRON_TIME_BUDGET_MS, FIT_RESULTS_JOB_TYPE, formatRefreshSummary, refreshFitResults, supabaseFitStore, type RefreshFitResultsResult } from "@/lib/fit/service";
import { createServiceRoleClient } from "@/lib/supabase/admin-service";

export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A trimmed, lower-cased UUID, or null. */
function asUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim().toLowerCase();
  return UUID.test(s) ? s : null;
}

async function logStart(db: SupabaseClient, details: Record<string, unknown>): Promise<string | null> {
  const { data } = await db.from("sync_job_logs").insert({ job_type: FIT_RESULTS_JOB_TYPE, status: "started", details }).select("id").single();
  return (data as { id?: string } | null)?.id ?? null;
}

/** sync_job_logs.status is CHECK-constrained to started / success / error, so partial and skipped runs are `success` with `details.outcome` saying which. */
async function logFinish(db: SupabaseClient, id: string | null, outcome: RefreshFitResultsResult["outcome"], message: string, details: Record<string, unknown>): Promise<void> {
  if (!id) return;
  await db
    .from("sync_job_logs")
    .update({ status: outcome === "error" ? "error" : "success", message, details: { ...details, outcome }, finished_at: new Date().toISOString() })
    .eq("id", id);
}

/**
 * Daily 09:45 UTC (vercel.json), after fit-profiles (09:00) and
 * fit-opportunity-profiles (09:15): refresh the topic IDF over the open
 * notices with a fit profile, then sweep the investigators with a stored
 * profile in id order — retrieval candidates (spec §7 stage 1) scored by the
 * pure engine and written to fit_results, stale pairs deleted — until the
 * time budget (240 s inside maxDuration 300) stops it; the response carries
 * `next_cursor` for a manual rerun. No model call and no embedding call:
 * every vector is read from the outreach tables. Logged to sync_job_logs as
 * job_type `fit_results`; while fit_results is not on the database the run
 * is logged as skipped and answers 200 `{ skipped: … }`, never 500, so the
 * merge can deploy before the migration is applied.
 *
 * Its own route rather than an extension of fit-opportunity-profiles: that
 * run is bounded by the model budget and its deadline, this one by reads
 * alone, and each needs the whole 240 s on a full night.
 *
 * Vercel Cron uses GET; manual runs may POST { limit?, cursor?, investigatorIds?, dryRun?, refreshIdf? }:
 * `cursor` and every `investigatorIds` entry must be investigator UUIDs (400 otherwise);
 * `dryRun` scores in memory and writes no result, no IDF row and no log row.
 * Headers: Authorization: Bearer <CRON_SECRET>
 */
async function handle(req: Request) {
  const denied = authorizeCronRequest(req);
  if (denied) return denied;

  const supabase = createServiceRoleClient();
  if (!supabase) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 503 });

  let params: { limit?: number; cursor?: string; investigatorIds?: string[]; dryRun?: boolean; refreshIdf?: boolean } = {};
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
      if (bad.length) return NextResponse.json({ ok: false, error: `investigatorIds must be UUIDs; rejected ${bad.length}` }, { status: 400 });
      investigatorIds = Array.from(new Set(body.investigatorIds.map((v) => asUuid(v)!))).slice(0, 500);
    }
    params = {
      limit: typeof body.limit === "number" ? Math.min(Math.max(1, Math.floor(body.limit)), 1000) : undefined,
      cursor: asUuid(body.cursor) ?? undefined,
      investigatorIds,
      dryRun: Boolean(body.dryRun),
      refreshIdf: body.refreshIdf === undefined ? undefined : Boolean(body.refreshIdf),
    };
  }

  const limit = params.limit ?? FIT_RESULTS_CRON_LIMIT;
  const dryRun = Boolean(params.dryRun);
  let jobId: string | null = null;
  try {
    if (!dryRun) jobId = await logStart(supabase, { limit, cursor: params.cursor ?? null, investigator_ids: params.investigatorIds ?? null, refresh_idf: params.refreshIdf ?? true });
    const store = supabaseFitStore(supabase, { log: (line) => console.log(`[fit-results] ${line}`) });
    const result = await refreshFitResults(store, { limit, cursor: params.cursor, investigatorIds: params.investigatorIds, dryRun, refreshIdf: params.refreshIdf, timeBudgetMs: FIT_RESULTS_CRON_TIME_BUDGET_MS, log: (line) => console.log(`[fit-results] ${line}`) });
    const message = formatRefreshSummary(result);
    const { investigators, ok: _ok, ...details } = result;
    void _ok;
    await logFinish(supabase, jobId, result.outcome, message, { ...details, lines: investigators.map((i) => i.line) });
    if (result.skipped) return NextResponse.json({ ok: true, skipped: result.skipped, message });
    return NextResponse.json({ ok: true, message, ...details, investigators: investigators.map((i) => i.line) });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logFinish(supabase, jobId, "error", message, {}).catch(() => undefined);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
