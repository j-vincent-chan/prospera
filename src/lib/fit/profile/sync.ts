/**
 * Nightly orchestration for investigator fit profiles (plan § PR 1.4 cron):
 * which investigators are due, the build loop with its time and model
 * budgets, the resume cursor, and the sync_job_logs record. Shared by
 * /api/cron/fit-profiles and scripts/fit-profile-report.ts.
 *
 * Due predicate (`profilesDue`, pure): no stored row; a row on another
 * taxonomy version; a row older than FIT_PROFILES_REFRESH_DAYS; a row older
 * than the newest source refresh (investigator_sources.last_refreshed_at) or
 * than the directory row's own update (investigators.updated_at — the
 * self-declared edit). Due investigators are processed in id order; the
 * response carries `nextCursor` (the last id taken on) when a budget stopped
 * the run, and a manual POST may pass it back. A nightly run needs no cursor:
 * whatever it built is no longer due, so the next run resumes on its own.
 *
 * Budgets: the run stops starting new investigators after `timeBudgetMs`
 * (default 240 s inside maxDuration 300) or once the shared model budget is
 * exhausted (`maxModelCalls`, env FIT_PROFILE_MODEL_CALLS_PER_RUN, default
 * DEFAULT_MODEL_CALLS_PER_RUN). An investigator whose items outran the model
 * budget is built but not written (incomplete); the item cache keeps the
 * classifications, so the next run has fewer misses and converges.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModelFn } from "@/lib/fit/classify";
import type { MeshIndex } from "@/lib/fit/classify/mesh";
import { buildInvestigatorFitProfile, INVESTIGATOR_PROFILES_MIGRATION, loadMeshIndex, MISSING_TABLE, ModelBudget, type BuildResult } from "@/lib/fit/profile/investigator";
import { TAXONOMY_VERSION } from "@/lib/fit/taxonomy";

export const FIT_PROFILES_JOB_TYPE = "fit_profiles";
/** Investigators per cron run. ~100 items each, cache-served after the first pass, well inside the 240 s budget. */
export const FIT_PROFILES_CRON_LIMIT = 40;
export const FIT_PROFILES_CRON_TIME_BUDGET_MS = 240_000;
/** A stored profile older than this is rebuilt even when nothing visibly changed (the MeSH backfills and rule edits do not stamp the evidence rows). */
export const FIT_PROFILES_REFRESH_DAYS = 7;
/** Model calls per cron run when FIT_PROFILE_MODEL_CALLS_PER_RUN is unset: ~300 × ~8 s at 4 in flight would still not fit 240 s, so the time budget usually stops the run first; the cap bounds the bill when the endpoint is fast. */
export const DEFAULT_MODEL_CALLS_PER_RUN = 300;

/** `FIT_PROFILE_MODEL_CALLS_PER_RUN` as a non-negative integer, else the default. */
export function modelCallsPerRun(env: Record<string, string | undefined> = process.env): number {
  const raw = env.FIT_PROFILE_MODEL_CALLS_PER_RUN?.trim();
  if (!raw) return DEFAULT_MODEL_CALLS_PER_RUN;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_MODEL_CALLS_PER_RUN;
}

// ---------------------------------------------------------------------------
// Due predicate — pure
// ---------------------------------------------------------------------------

export type RosterEntry = { id: string; updated_at?: string | null };
export type StoredProfileStamp = { investigator_id: string; taxonomy_version: string; computed_at: string };
export type SourceStamp = { investigator_id: string; last_refreshed_at: string | null };

export type DueReason = "no_profile" | "taxonomy_version" | "stale" | "sources_refreshed" | "investigator_updated" | "requested";

export type DueEntry = { id: string; reason: DueReason };

export type DueOptions = { now: Date; refreshDays?: number; taxonomyVersion?: string; force?: boolean };

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** Which roster ids need a (re)build, in id order (code-unit order, the same `>` the cursor uses), with the first reason that applies. `force` makes every id due. */
export function profilesDue(roster: RosterEntry[], profiles: StoredProfileStamp[], sources: SourceStamp[], opts: DueOptions): DueEntry[] {
  const refreshDays = opts.refreshDays ?? FIT_PROFILES_REFRESH_DAYS;
  const version = opts.taxonomyVersion ?? TAXONOMY_VERSION;
  const staleBefore = opts.now.getTime() - refreshDays * 86_400_000;
  const byId = new Map(profiles.map((p) => [p.investigator_id, p]));
  const newestRefresh = new Map<string, number>();
  for (const s of sources) {
    const t = ms(s.last_refreshed_at);
    if (t == null) continue;
    newestRefresh.set(s.investigator_id, Math.max(newestRefresh.get(s.investigator_id) ?? 0, t));
  }
  const out: DueEntry[] = [];
  for (const inv of [...roster].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const stored = byId.get(inv.id);
    if (opts.force || !stored) {
      out.push({ id: inv.id, reason: "no_profile" });
      continue;
    }
    const computed = ms(stored.computed_at) ?? 0;
    if (stored.taxonomy_version !== version) out.push({ id: inv.id, reason: "taxonomy_version" });
    else if (computed < staleBefore) out.push({ id: inv.id, reason: "stale" });
    else if ((newestRefresh.get(inv.id) ?? 0) > computed) out.push({ id: inv.id, reason: "sources_refreshed" });
    else if ((ms(inv.updated_at) ?? 0) > computed) out.push({ id: inv.id, reason: "investigator_updated" });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Roster reads
// ---------------------------------------------------------------------------

const PAGE = 1000;

type Query = ReturnType<ReturnType<SupabaseClient["from"]>["select"]>;

async function pageAll<T>(db: SupabaseClient, table: string, columns: string, build: (q: Query) => Query, order: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(db.from(table).select(columns)).order(order).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} read failed: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/** Whether `investigator_fit_profiles` exists yet (the migration is applied by hand). */
export async function profilesTableExists(db: SupabaseClient): Promise<boolean> {
  const { error } = await db.from("investigator_fit_profiles").select("investigator_id").limit(1);
  if (!error) return true;
  if (MISSING_TABLE.test(error.message)) return false;
  throw new Error(`investigator_fit_profiles read failed: ${error.message}`);
}

export type RosterState = { roster: RosterEntry[]; profiles: StoredProfileStamp[]; sources: SourceStamp[]; tableExists: boolean };

/** The non-archived roster, the stored profile stamps and the source refresh stamps — everything `profilesDue` reads. */
export async function loadRosterState(db: SupabaseClient, investigatorIds?: string[]): Promise<RosterState> {
  const tableExists = await profilesTableExists(db);
  const only = investigatorIds && investigatorIds.length ? investigatorIds : null;
  const [roster, profiles, sources] = await Promise.all([
    pageAll<RosterEntry>(db, "investigators", "id, updated_at", (q) => (only ? q.in("id", only) : q.is("archived_at", null)), "id"),
    tableExists ? pageAll<StoredProfileStamp>(db, "investigator_fit_profiles", "investigator_id, taxonomy_version, computed_at", (q) => (only ? q.in("investigator_id", only) : q), "investigator_id") : Promise.resolve([]),
    pageAll<SourceStamp>(db, "investigator_sources", "investigator_id, last_refreshed_at", (q) => (only ? q.in("investigator_id", only) : q), "investigator_id"),
  ]);
  return { roster, profiles, sources, tableExists };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export type ProfileSyncParams = {
  /** Investigators to take on this run (default FIT_PROFILES_CRON_LIMIT). */
  limit?: number;
  /** Resume after this investigator id (manual runs). */
  cursor?: string | null;
  /** Only these investigators, due or not. */
  investigatorIds?: string[];
  /** Rebuild every roster member regardless of the stamps. */
  force?: boolean;
  /** Build in memory; write nothing — not even sync_job_logs. */
  dryRun?: boolean;
  timeBudgetMs?: number;
  /** Model calls the whole run may make (default `modelCallsPerRun()`); 0 = rules + cache only. */
  maxModelCalls?: number;
  now?: () => Date;
  log?: (line: string) => void;
  /** Tests substitute the model and the descriptor index. */
  model?: ModelFn;
  modelName?: string;
  mesh?: MeshIndex;
  /** Receives every build result (the report script keeps them). */
  onBuilt?: (result: BuildResult) => void;
};

export type InvestigatorOutcome = {
  investigator_id: string;
  name: string | null;
  status: "written" | "incomplete" | "dry_run" | "error";
  reason: DueReason;
  item_count: number;
  model_called: number;
  model_skipped: number;
  cache_hits: number;
  /** Model-skipped items or normalize failures left the profile partial (also reported for dry runs). */
  incomplete: boolean;
  error?: string;
  line: string;
};

export type ProfileSyncResult = {
  ok: true;
  dryRun: boolean;
  tableExists: boolean;
  /** Roster members due before the limit. */
  due: number;
  /** Investigators this run took on. */
  scanned: number;
  written: number;
  /** Builds left partial by skipped model calls or failed rows (dry runs included). */
  incomplete: number;
  errors: number;
  modelCalls: number;
  modelSkipped: number;
  cacheHits: number;
  budgetExhausted: "time" | "model" | null;
  /** The last investigator id taken on when a budget stopped the run; null when the run finished its list. */
  nextCursor: string | null;
  durationMs: number;
  investigators: InvestigatorOutcome[];
};

async function logStart(db: SupabaseClient, details: Record<string, unknown>): Promise<string | null> {
  const { data } = await db.from("sync_job_logs").insert({ job_type: FIT_PROFILES_JOB_TYPE, status: "started", details }).select("id").single();
  return (data as { id?: string } | null)?.id ?? null;
}

async function logFinish(db: SupabaseClient, id: string | null, status: "success" | "error", message: string, details: Record<string, unknown>): Promise<void> {
  if (!id) return;
  await db.from("sync_job_logs").update({ status, message, details, finished_at: new Date().toISOString() }).eq("id", id);
}

export function formatProfileSyncSummary(r: ProfileSyncResult): string {
  const budget = r.budgetExhausted ? `; ${r.budgetExhausted} budget exhausted, next cursor ${r.nextCursor}` : "";
  return `fit_profiles${r.dryRun ? " (dry run)" : ""}: ${r.scanned} of ${r.due} due built — ${r.written} written, ${r.incomplete} incomplete, ${r.errors} errors; model calls ${r.modelCalls}, skipped ${r.modelSkipped}, cache hits ${r.cacheHits}; ${r.durationMs} ms${budget}`;
}

/** Build the due investigators' profiles within the run's budgets. Never throws for a single investigator's failure; a roster read failure does. */
export async function syncInvestigatorFitProfiles(db: SupabaseClient, params: ProfileSyncParams = {}): Promise<ProfileSyncResult> {
  const started = Date.now();
  const now = params.now ?? (() => new Date());
  const dryRun = Boolean(params.dryRun);
  const limit = Math.max(1, params.limit ?? FIT_PROFILES_CRON_LIMIT);
  const timeBudgetMs = params.timeBudgetMs ?? FIT_PROFILES_CRON_TIME_BUDGET_MS;
  const budget = new ModelBudget(params.maxModelCalls ?? modelCallsPerRun());
  const log = params.log ?? (() => {});

  const state = await loadRosterState(db, params.investigatorIds);
  if (!state.tableExists && !dryRun) {
    throw new Error(`investigator_fit_profiles does not exist — apply ${INVESTIGATOR_PROFILES_MIGRATION} first`);
  }
  const explicit = params.investigatorIds && params.investigatorIds.length > 0;
  const due: DueEntry[] = explicit
    ? state.roster.map((r) => ({ id: r.id, reason: "requested" as const }))
    : profilesDue(state.roster, state.profiles, state.sources, { now: now(), force: params.force });
  const afterCursor = params.cursor ? due.filter((d) => d.id > params.cursor!) : due;
  const batch = afterCursor.slice(0, limit);
  log(`fit_profiles: ${state.roster.length} on the roster, ${due.length} due${params.cursor ? ` (${afterCursor.length} after cursor ${params.cursor})` : ""}, taking ${batch.length}; model budget ${budget.remaining}${dryRun ? "; DRY RUN" : ""}`);

  const jobId = dryRun ? null : await logStart(db, { limit, cursor: params.cursor ?? null, due: due.length, model_budget: budget.remaining, force: Boolean(params.force) });
  const mesh = params.mesh ?? (await loadMeshIndex(db));

  const outcomes: InvestigatorOutcome[] = [];
  let budgetExhausted: ProfileSyncResult["budgetExhausted"] = null;
  /** The id a manual rerun should resume after: the last investigator taken on, or the one before it when the model budget left it incomplete (so it is retried). */
  let lastId: string | null = null;
  let previousId: string | null = null;
  for (const entry of batch) {
    if (Date.now() - started > timeBudgetMs) {
      budgetExhausted = "time";
      break;
    }
    if (budget.exhausted && budget.used > 0) {
      budgetExhausted = "model";
      break;
    }
    previousId = lastId;
    lastId = entry.id;
    try {
      const r = await buildInvestigatorFitProfile(db, entry.id, { mesh, modelBudget: budget, model: params.model, modelName: params.modelName, write: !dryRun, now, log });
      params.onBuilt?.(r);
      outcomes.push({
        investigator_id: r.investigator_id,
        name: r.name,
        status: dryRun ? "dry_run" : r.written ? "written" : "incomplete",
        reason: entry.reason,
        item_count: r.item_count,
        model_called: r.model_called,
        model_skipped: r.model_skipped,
        cache_hits: r.cache_hits,
        incomplete: r.incomplete,
        line: `${r.name ?? r.investigator_id}: ${dryRun ? "dry run" : r.written ? "written" : "incomplete"} (${entry.reason}) — ${r.item_count} items, model ${r.model_called}, skipped ${r.model_skipped}, cached ${r.cache_hits}${r.failures.length ? `, ${r.failures.length} failed rows` : ""}`,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log(`${entry.id}: ERROR ${message}`);
      outcomes.push({ investigator_id: entry.id, name: null, status: "error", reason: entry.reason, item_count: 0, model_called: 0, model_skipped: 0, cache_hits: 0, incomplete: true, error: message, line: `${entry.id}: error — ${message}` });
    }
  }

  const finishedAll = outcomes.length === batch.length && afterCursor.length <= limit;
  const lastIncomplete = outcomes.length > 0 && outcomes[outcomes.length - 1]!.status === "incomplete" && budget.exhausted && budget.used > 0;
  if (lastIncomplete && !budgetExhausted) budgetExhausted = "model";
  const resumeAfter = lastIncomplete ? previousId : lastId;
  const result: ProfileSyncResult = {
    ok: true,
    dryRun,
    tableExists: state.tableExists,
    due: due.length,
    scanned: outcomes.length,
    written: outcomes.filter((o) => o.status === "written").length,
    incomplete: outcomes.filter((o) => o.incomplete && o.status !== "error").length,
    errors: outcomes.filter((o) => o.status === "error").length,
    modelCalls: budget.used,
    modelSkipped: outcomes.reduce((s, o) => s + o.model_skipped, 0),
    cacheHits: outcomes.reduce((s, o) => s + o.cache_hits, 0),
    budgetExhausted,
    nextCursor: budgetExhausted || !finishedAll ? resumeAfter : null,
    durationMs: Date.now() - started,
    investigators: outcomes,
  };
  log(formatProfileSyncSummary(result));
  if (!dryRun) {
    const { investigators, ...details } = result;
    await logFinish(db, jobId, result.errors > 0 && result.written === 0 ? "error" : "success", formatProfileSyncSummary(result), { ...details, lines: investigators.map((i) => i.line) });
  }
  return result;
}
