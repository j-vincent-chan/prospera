import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron/authorize-cron-request";
import type { RulesFn } from "@/lib/fit/classify";
import { loadMeshIndex } from "@/lib/fit/classify/mesh-db";
import { DEFAULT_RULE_TABLES, evaluateRules, type EvaluateContext } from "@/lib/fit/classify/rules";
import { MISSING_TABLE } from "@/lib/fit/profile/investigator";
import {
  OPPORTUNITY_PROFILES_JOB_TYPE,
  OPPORTUNITY_PROFILES_LIMIT,
  OPPORTUNITY_PROFILES_MIGRATION,
  OPPORTUNITY_PROFILES_TIME_BUDGET_MS,
  opportunityModelCallsPerRun,
  runOpportunityProfiles,
  type OpportunityProfilesRunSummary,
} from "@/lib/fit/profile/opportunity";
import { createServiceRoleClient } from "@/lib/supabase/admin-service";

export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An opportunity number as the Guide and Simpler print them (RFA-DK-26-315, PAR-25-122, NOT-OD-25-001). */
const OPPORTUNITY_NUMBER = /^[A-Z0-9][A-Z0-9-]{2,39}$/;

/** A trimmed, lower-cased UUID, or null. */
function asUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim().toLowerCase();
  return UUID.test(s) ? s : null;
}

/** A trimmed, upper-cased opportunity number, or null. */
function asOpportunityNumber(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim().toUpperCase();
  return OPPORTUNITY_NUMBER.test(s) ? s : null;
}

type Outcome = "success" | "partial" | "error" | "skipped";

async function logStart(db: SupabaseClient, details: Record<string, unknown>): Promise<string | null> {
  const { data } = await db.from("sync_job_logs").insert({ job_type: OPPORTUNITY_PROFILES_JOB_TYPE, status: "started", details }).select("id").single();
  return (data as { id?: string } | null)?.id ?? null;
}

/** sync_job_logs.status is CHECK-constrained to started / success / error, so partial and skipped runs are `success` with `details.outcome` saying which. */
async function logFinish(db: SupabaseClient, id: string | null, outcome: Outcome, message: string, details: Record<string, unknown>): Promise<void> {
  if (!id) return;
  await db
    .from("sync_job_logs")
    .update({ status: outcome === "error" ? "error" : "success", message, details: { ...details, outcome }, finished_at: new Date().toISOString() })
    .eq("id", id);
}

/** Whether `opportunity_fit_profiles` is on the database yet (the migration is applied by hand, after the merge deploys). */
async function profilesTableMissing(db: SupabaseClient): Promise<boolean> {
  const { error } = await db.from("opportunity_fit_profiles").select("opportunity_id").limit(1);
  if (!error) return false;
  if (MISSING_TABLE.test(error.message)) return true;
  throw new Error(`opportunity_fit_profiles read failed: ${error.message}`);
}

/** `error` when every attempted build failed; `partial` when a build was left incomplete or a notice deferred; else `success`. */
function runOutcome(s: OpportunityProfilesRunSummary): Outcome {
  if (s.errors.length > 0 && s.built === 0) return "error";
  if (s.incomplete > 0 || s.deferred > 0) return "partial";
  return "success";
}

function summaryMessage(s: OpportunityProfilesRunSummary, outcome: Outcome): string {
  return `${OPPORTUNITY_PROFILES_JOB_TYPE}${s.dry_run ? " (dry run)" : ""} ${outcome}: ${s.attempted} of ${s.due} due attempted — ${s.built} built (${s.incomplete} incomplete), ${s.deferred} deferred, ${s.errors.length} errors; model calls ${s.model_calls}/${s.model_budget}; ${s.elapsed_ms} ms${s.next_cursor ? `; next cursor ${s.next_cursor}` : ""}`;
}

/**
 * Daily 09:15 UTC (vercel.json), after fit-profiles at 09:00: build the
 * opportunity fit profiles that are due — open NIH notices with Guide
 * sections whose profile is missing, on an old taxonomy version, built from
 * an earlier Guide page (`guide_html_hash`), or incomplete (D22) — never
 * profiled first, then incomplete, then changed, newest posted first within
 * each. Stops starting notices after 240 s (the same instant stops model
 * calls inside a build, which is then written incomplete and is due again) or
 * when fewer than 3 model calls remain of the run's budget
 * (FIT_OPPORTUNITY_MODEL_CALLS_PER_RUN, default 150 — the extractor's three
 * section groups plus the exemplar classifier share it). One OpenAI client
 * serves the run. Logged to sync_job_logs as job_type
 * `fit_opportunity_profiles`; while `opportunity_fit_profiles` is not on the
 * database yet the run is logged as skipped and answers 200
 * `{ skipped: "table missing" }`, never 500.
 * Vercel Cron uses GET; manual runs may POST { limit?, cursor?, only?, force?, dryRun?, maxModelCalls? }:
 * `cursor` is a notice UUID (a `next_cursor` of an earlier response), `only` an
 * array of opportunity numbers (still subject to the due predicate; `force`
 * rebuilds them), `dryRun` builds in memory and writes no profile, no cache
 * row and no log row (pass `maxModelCalls: 0` for a run with no model call).
 * 400 on a malformed cursor or number.
 * Headers: Authorization: Bearer <CRON_SECRET>
 */
async function handle(req: Request) {
  const denied = authorizeCronRequest(req);
  if (denied) return denied;

  const supabase = createServiceRoleClient();
  if (!supabase) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 503 });

  let params: { limit?: number; cursor?: string; only?: string[]; force?: boolean; dryRun?: boolean; maxModelCalls?: number } = {};
  if (req.method === "POST") {
    let body: Record<string, unknown> = {};
    try {
      body = ((await req.json()) ?? {}) as Record<string, unknown>;
    } catch {
      /* no body */
    }
    if (body.cursor !== undefined && body.cursor !== null && body.cursor !== "" && !asUuid(body.cursor)) {
      return NextResponse.json({ ok: false, error: "cursor must be a funding_opportunities UUID" }, { status: 400 });
    }
    let only: string[] | undefined;
    if (body.only !== undefined && body.only !== null) {
      if (!Array.isArray(body.only)) return NextResponse.json({ ok: false, error: "only must be an array of opportunity numbers" }, { status: 400 });
      const bad = body.only.filter((v) => !asOpportunityNumber(v));
      if (bad.length) return NextResponse.json({ ok: false, error: `only must be opportunity numbers; rejected ${bad.length}: ${bad.slice(0, 5).map(String).join(", ")}` }, { status: 400 });
      only = Array.from(new Set(body.only.map((v) => asOpportunityNumber(v)!))).slice(0, 200);
    }
    params = {
      limit: typeof body.limit === "number" ? Math.min(Math.max(1, Math.floor(body.limit)), 500) : undefined,
      cursor: asUuid(body.cursor) ?? undefined,
      only,
      force: Boolean(body.force),
      dryRun: Boolean(body.dryRun),
      maxModelCalls: typeof body.maxModelCalls === "number" && body.maxModelCalls >= 0 ? Math.floor(body.maxModelCalls) : undefined,
    };
  }

  const limit = params.limit ?? OPPORTUNITY_PROFILES_LIMIT;
  const modelBudget = params.maxModelCalls ?? opportunityModelCallsPerRun();
  const dryRun = Boolean(params.dryRun);
  let jobId: string | null = null;
  try {
    if (await profilesTableMissing(supabase)) {
      const message = `${OPPORTUNITY_PROFILES_JOB_TYPE} skipped: opportunity_fit_profiles is not on the database — apply ${OPPORTUNITY_PROFILES_MIGRATION}`;
      console.warn(`[fit-opportunity-profiles] ${message}`);
      if (!dryRun) jobId = await logStart(supabase, { limit, cursor: params.cursor ?? null, only: params.only ?? null, force: Boolean(params.force), model_budget: modelBudget });
      await logFinish(supabase, jobId, "skipped", message, { migration: OPPORTUNITY_PROFILES_MIGRATION });
      return NextResponse.json({ ok: true, skipped: "table missing", migration: OPPORTUNITY_PROFILES_MIGRATION, message });
    }
    if (!dryRun) jobId = await logStart(supabase, { limit, cursor: params.cursor ?? null, only: params.only ?? null, force: Boolean(params.force), model_budget: modelBudget });

    const mesh = await loadMeshIndex(supabase);
    const ctx: EvaluateContext = { mesh, tables: DEFAULT_RULE_TABLES };
    const rules: RulesFn = (item) => evaluateRules(item, ctx);
    const summary = await runOpportunityProfiles(
      supabase,
      { limit, cursor: params.cursor, only: params.only, timeBudgetMs: OPPORTUNITY_PROFILES_TIME_BUDGET_MS, modelBudget, onlyChanged: !params.force, dryRun, log: (line) => console.log(`[fit-opportunity-profiles] ${line}`) },
      { rules }
    );
    const outcome = runOutcome(summary);
    const message = summaryMessage(summary, outcome);
    await logFinish(supabase, jobId, outcome, message, summary);
    return NextResponse.json({ ok: true, outcome, message, ...summary });
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
