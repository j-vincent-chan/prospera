import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron/authorize-cron-request";
import { FIT_JUDGE_CRON_TIME_BUDGET_MS, FIT_JUDGE_JOB_TYPE, formatJudgeSummary, judgeModelCallsPerRun, refreshFitJudge, supabaseJudgeStore, type RefreshFitJudgeResult } from "@/lib/fit/judge/service";
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
  const { data } = await db.from("sync_job_logs").insert({ job_type: FIT_JUDGE_JOB_TYPE, status: "started", details }).select("id").single();
  return (data as { id?: string } | null)?.id ?? null;
}

/** sync_job_logs.status is CHECK-constrained to started / success / error, so partial and skipped runs are `success` with `details.outcome` saying which. */
async function logFinish(db: SupabaseClient, id: string | null, outcome: RefreshFitJudgeResult["outcome"], message: string, details: Record<string, unknown>): Promise<void> {
  if (!id) return;
  await db
    .from("sync_job_logs")
    .update({ status: outcome === "error" ? "error" : "success", message, details: { ...details, outcome }, finished_at: new Date().toISOString() })
    .eq("id", id);
}

/**
 * Daily 09:45 UTC (vercel.json), after fit-results (09:35, hard stop 09:40)
 * whose rows it reads and before refresh-outreach-suggestions (09:50; this
 * run's own hard stop is 09:50, so a night that uses its whole budget hands
 * the Outreach refresh the previous judgment of its last investigator):
 * stage 8 over the roster — never judged first, then the oldest
 * (`investigator_fit_profiles.fit_judged_at`) — the top 15 pairs by score
 * plus the near-miss scout set per investigator through the blind pass,
 * the skeptic and the reconciler (src/lib/fit/judge/service.ts), cached per
 * profile version in fit_adjudications, the tier / caps / rationale written
 * to fit_results with the adjudication, corrections to fit_corrections;
 * until its time budget (240 s inside maxDuration 300; no call starts in
 * the last 90 s — the client's timeout, with no SDK retry, so the last call
 * to start ends by the deadline) stops it — time, not the model budget
 * (FIT_JUDGE_MODEL_CALLS_PER_RUN, default 150), is the stop: the client
 * paces itself under FIT_JUDGE_TPM (default 25,000 tokens per sliding
 * minute; PR 3.1c), a call takes 10–15 s, so a night makes ≈ 8–12 calls,
 * ≈ 2 pairs; a pacing wait that would cross the 90 s margin is a deadline
 * stop, and a 429 is retried once when its retry-after fits before it. An
 * investigator the stop interrupted is not stamped and leads the next
 * night; a model call that throws (transport, auth, timeout) stops the run
 * the same way, nothing of its pair persisted, as does a 429 the client
 * could not retry (`stopped_by: rate_limit`). The log's message names the
 * stop: "stopped by deadline after N calls", "budget exhausted after N
 * calls", "stopped by rate limit (message) after N calls", "stopped by
 * error (message) after N calls"; the pair lines say what the client
 * waited ("paced 12.4 s"). Logged to
 * sync_job_logs as job_type `fit_judge`; while fit_adjudications is not on
 * the database the run is logged as skipped and answers 200 `{ skipped: … }`,
 * never 500, so the merge can deploy before the migration is applied.
 *
 * Vercel Cron uses GET; manual runs may POST { limit?, cursor?, investigatorIds?, dryRun?, maxModelCalls?, top?, scout?, variants?, force? }:
 * `cursor` and every `investigatorIds` entry must be investigator UUIDs (400 otherwise);
 * `cursor` resumes after that investigator's position in the judge order; `dryRun`
 * judges in memory (the model IS called) and writes no row and no log row.
 * Headers: Authorization: Bearer <CRON_SECRET>
 */
async function handle(req: Request) {
  const denied = authorizeCronRequest(req);
  if (denied) return denied;

  const supabase = createServiceRoleClient();
  if (!supabase) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 503 });

  let params: { limit?: number; cursor?: string; investigatorIds?: string[]; dryRun?: boolean; maxModelCalls?: number; top?: number; scout?: number; variants?: 1 | 2; force?: boolean } = {};
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
    const int = (v: unknown, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(min, Math.floor(v)), max) : undefined);
    params = {
      limit: int(body.limit, 1, 1000),
      cursor: asUuid(body.cursor) ?? undefined,
      investigatorIds,
      dryRun: Boolean(body.dryRun),
      maxModelCalls: int(body.maxModelCalls, 0, 10_000),
      top: int(body.top, 0, 100),
      scout: int(body.scout, 0, 100),
      variants: body.variants === 1 ? 1 : body.variants === 2 ? 2 : undefined,
      force: Boolean(body.force),
    };
  }

  const dryRun = Boolean(params.dryRun);
  let jobId: string | null = null;
  try {
    if (!dryRun) jobId = await logStart(supabase, { limit: params.limit ?? null, cursor: params.cursor ?? null, investigator_ids: params.investigatorIds ?? null, max_model_calls: params.maxModelCalls ?? judgeModelCallsPerRun(), top: params.top ?? null, scout: params.scout ?? null, variants: params.variants ?? null, force: params.force ?? false });
    const store = supabaseJudgeStore(supabase, { log: (line) => console.log(`[fit-judge] ${line}`) });
    const result = await refreshFitJudge(store, { ...params, timeBudgetMs: FIT_JUDGE_CRON_TIME_BUDGET_MS, log: (line) => console.log(`[fit-judge] ${line}`) });
    const message = formatJudgeSummary(result);
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
