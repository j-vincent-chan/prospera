/**
 * Fit engine · PR 1.4 · the one-time pass that classifies the roster's
 * evidence and builds every investigator fit profile (D20: "the one-time pass
 * is scripts/fit-build-profiles.ts (concurrent, resumable); the nightly cron
 * is incremental"). Two phases:
 *
 *   phase 1 · classify   collectEvidence for the selected investigators (one
 *                        loadMeshIndex), evaluateRules + modelNeeded per item,
 *                        dedupe by itemCacheKey — a co-authored paper appears
 *                        under several investigators and is classified once —
 *                        prefetch fit_item_profiles in chunks, worklist = keys
 *                        with no usable `llm`, then classifyItem over the
 *                        worklist with `--concurrency` model calls in flight
 *                        through one openaiModel() and the Supabase item cache.
 *   phase 2 · build      buildInvestigatorFitProfile(db, id, { modelBudget: 0,
 *                        mesh, write }) per investigator — rules + the cache
 *                        phase 1 just filled — and one build line each.
 *
 *   npm run fit:build-profiles -- --dry-run                         # worklist size and expected call count; no model calls, no writes of any kind
 *   npm run fit:build-profiles -- --write                           # the real pass: classify, then build and upsert every profile
 *   npm run fit:build-profiles -- --classify-only                   # phase 1 only (fills the item cache; writes no profile)
 *   npm run fit:build-profiles -- --investigator <uuid>[,<uuid>…]   # one or more people (repeatable)
 *   npm run fit:build-profiles -- --limit 20 --cursor <uuid>        # a slice of the roster (id order, non-archived), resuming after an id
 *   npm run fit:build-profiles -- --concurrency 8 --max-model-calls 5000
 *   npm run fit:build-profiles -- --json                            # the summary as JSON on stdout (progress stays on stderr)
 *
 * Without `--write`, phase 2 builds in memory and prints; the item cache is
 * still written in phase 1 (that is the pass's resumability: a rerun skips
 * every key already classified, by content hash, and the profile upsert is
 * keyed by investigator_id). `--max-model-calls` (default 20,000) is a hard
 * cap; a thrown model error is recorded and the item skipped; when the first
 * 10 calls all throw (auth, quota) the run aborts. A run that writes logs
 * sync_job_logs job_type `fit_profiles` with details.mode = "backfill".
 *
 * Exit codes: 0 every selected profile complete · 2 partial (pending items,
 * failures, or the call cap) · 3 aborted (missing table, empty descriptor
 * index, no API key, the model refusing every call) · 1 unexpected error.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { classifyItem, classifyModelName, itemCacheKey, modelNeeded, openaiModel, supabaseItemProfileCache, type ItemProfileCache, type ModelFn, type NormalizedItem } from "../src/lib/fit/classify";
import { loadMeshIndex, MESH_EMPTY } from "../src/lib/fit/classify/mesh-db";
import { DEFAULT_RULE_TABLES, evaluateRules, type EvaluateContext } from "../src/lib/fit/classify/rules";
import { buildInvestigatorFitProfile, collectEvidence, formatBuildLine, INVESTIGATOR_PROFILES_MIGRATION, MISSING_TABLE, PREFETCH_CHUNK, type BuildResult, type NormalizeFailure } from "../src/lib/fit/profile/investigator";
import { FIT_PROFILES_JOB_TYPE, profilesTableExists } from "../src/lib/fit/profile/sync";
import { TAXONOMY_VERSION } from "../src/lib/fit/taxonomy";
import { runWorkerPool } from "../src/lib/utils/async-rate-limiter";

config({ path: ".env.local", quiet: true });

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opts = (name: string): string[] => args.flatMap((a, i) => (a === name && args[i + 1] !== undefined ? [args[i + 1]!] : []));
const optNumber = (name: string, fallback: number): number => {
  const raw = opts(name)[0];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`${name} expects a non-negative number, got ${raw}`);
    process.exit(1);
  }
  return Math.floor(n);
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DRY_RUN = flag("--dry-run");
const WRITE = flag("--write") && !DRY_RUN;
const CLASSIFY_ONLY = flag("--classify-only");
const JSON_OUT = flag("--json");
const INVESTIGATORS = Array.from(new Set(opts("--investigator").flatMap((v) => v.split(",")).map((v) => v.trim().toLowerCase()).filter(Boolean)));
const LIMIT = opts("--limit").length ? optNumber("--limit", 0) : null;
const CURSOR = opts("--cursor")[0]?.trim().toLowerCase() ?? null;
const CONCURRENCY = Math.max(1, Math.min(16, optNumber("--concurrency", 6)));
const MAX_MODEL_CALLS = optNumber("--max-model-calls", 20_000);
/** Phase-1 evidence reads and phase-2 builds in flight (database reads only; the model concurrency is `--concurrency`). */
const DB_CONCURRENCY = 4;
/** Consecutive throws at the start of phase 1 that mean the endpoint itself is refusing (auth, quota). */
const ABORT_AFTER_THROWS = 10;
const PROGRESS_EVERY = 50;

for (const id of INVESTIGATORS) {
  if (!UUID.test(id)) {
    console.error(`--investigator expects UUIDs, got ${id}`);
    process.exit(1);
  }
}
if (CURSOR && !UUID.test(CURSOR)) {
  console.error(`--cursor expects a UUID, got ${CURSOR}`);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}
const supabase: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });

const log = (line: string) => console.error(line);
const elapsed = (since: number) => `${((Date.now() - since) / 1000).toFixed(1)} s`;

class Abort extends Error {
  constructor(message: string, public readonly code: 3) {
    super(message);
    this.name = "Abort";
  }
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

type RosterRow = { id: string; full_name: string | null };

async function loadRoster(): Promise<RosterRow[]> {
  const PAGE = 1000;
  const rows: RosterRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from("investigators").select("id, full_name").order("id");
    q = INVESTIGATORS.length ? q.in("id", INVESTIGATORS) : q.is("archived_at", null);
    if (CURSOR) q = q.gt("id", CURSOR);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(`investigators read failed: ${error.message}`);
    rows.push(...((data ?? []) as RosterRow[]));
    if (LIMIT != null && rows.length >= LIMIT) return rows.slice(0, LIMIT);
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function itemCacheTableExists(): Promise<boolean> {
  const { error } = await supabase.from("fit_item_profiles").select("content_hash").limit(1);
  if (!error) return true;
  if (MISSING_TABLE.test(error.message)) return false;
  throw new Error(`fit_item_profiles read failed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Phase 1 · classify
// ---------------------------------------------------------------------------

type WorkItem = { key: string; item: NormalizedItem; investigators: number };

type CollectSummary = {
  investigators: number;
  items: number;
  aspiration_items: number;
  model_needed_items: number;
  unique_keys: number;
  normalize_failures: NormalizeFailure[];
  collect_errors: Array<{ investigator_id: string; error: string }>;
};

async function collectWorklist(roster: RosterRow[], rulesCtx: EvaluateContext): Promise<{ byKey: Map<string, WorkItem>; summary: CollectSummary }> {
  const byKey = new Map<string, WorkItem>();
  const summary: CollectSummary = { investigators: roster.length, items: 0, aspiration_items: 0, model_needed_items: 0, unique_keys: 0, normalize_failures: [], collect_errors: [] };
  let done = 0;
  await runWorkerPool(roster, DB_CONCURRENCY, async (inv) => {
    try {
      const ev = await collectEvidence(supabase, inv.id, { mesh: rulesCtx.mesh });
      summary.items += ev.items.length;
      summary.aspiration_items += ev.aspirationItems.length;
      summary.normalize_failures.push(...ev.failures);
      for (const item of [...ev.items, ...ev.aspirationItems]) {
        const rules = evaluateRules(item, rulesCtx);
        if (!modelNeeded(item, rules).needed) continue;
        summary.model_needed_items += 1;
        const k = itemCacheKey(item);
        const w = byKey.get(k);
        if (w) w.investigators += 1;
        else byKey.set(k, { key: k, item, investigators: 1 });
      }
    } catch (e) {
      summary.collect_errors.push({ investigator_id: inv.id, error: e instanceof Error ? e.message : String(e) });
    }
    done += 1;
    if (done % 25 === 0 || done === roster.length) log(`phase 1 · evidence: ${done}/${roster.length} investigators, ${byKey.size} unique model-needed keys so far`);
  });
  summary.unique_keys = byKey.size;
  return { byKey, summary };
}

/** Keys with a usable model output already cached, read in chunks of PREFETCH_CHUNK (only `llm` is fetched — the worklist needs nothing else). */
async function cachedUsableKeys(keys: string[]): Promise<Set<string>> {
  const usable = new Set<string>();
  for (let i = 0; i < keys.length; i += PREFETCH_CHUNK) {
    const slice = keys.slice(i, i + PREFETCH_CHUNK);
    const { data, error } = await supabase.from("fit_item_profiles").select("content_hash, llm").in("content_hash", slice);
    if (error) throw new Error(`fit_item_profiles read failed: ${error.message}`);
    for (const row of (data ?? []) as Array<{ content_hash: string; llm: { usable?: boolean } | null }>) {
      if (row.llm && row.llm.usable !== false) usable.add(row.content_hash);
    }
  }
  return usable;
}

type ClassifyPhase = {
  worklist: number;
  calls: number;
  classified: number;
  unusable: number;
  skipped_cap: number;
  failures: Array<{ key: string; id: string; error: string }>;
  aborted: string | null;
  ms: number;
};

async function classifyWorklist(worklist: WorkItem[], rulesCtx: EvaluateContext): Promise<ClassifyPhase> {
  const started = Date.now();
  const out: ClassifyPhase = { worklist: worklist.length, calls: 0, classified: 0, unusable: 0, skipped_cap: 0, failures: [], aborted: null, ms: 0 };
  if (!worklist.length) return out;
  if (!process.env.OPENAI_API_KEY?.trim()) throw new Abort("OPENAI_API_KEY missing in .env.local — the worklist needs the model", 3);

  const modelName = classifyModelName();
  const real = openaiModel();
  let calls = 0;
  const model: ModelFn = async (req) => {
    calls += 1;
    return real(req);
  };
  // Every worklist key is a known miss (or an unusable row): skip the per-key read and only write.
  const base = supabaseItemProfileCache(supabase);
  const cache: ItemProfileCache = { get: async () => null, set: (row) => base.set(row) };

  let settled = 0;
  let threw = 0;
  let reserved = 0; // reserved synchronously at the check, so the cap cannot overshoot by the workers in flight
  let abort: string | null = null;
  await runWorkerPool(worklist, CONCURRENCY, async (w) => {
    if (abort) return;
    if (reserved >= MAX_MODEL_CALLS) {
      out.skipped_cap += 1;
      return;
    }
    reserved += 1;
    try {
      const r = await classifyItem(w.item, { rules: (it) => evaluateRules(it, rulesCtx), model, modelName, cache });
      if (r.llm?.usable === false) out.unusable += 1;
      else out.classified += 1;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      out.failures.push({ key: w.key, id: w.item.id, error: message });
      threw += 1;
      if (out.failures.length <= 5) log(`  model error on ${w.item.id}: ${message}`);
    }
    settled += 1;
    if (settled === ABORT_AFTER_THROWS && threw === ABORT_AFTER_THROWS) abort = `the first ${ABORT_AFTER_THROWS} model calls all failed (${out.failures[0]?.error ?? "?"})`;
    if (settled % PROGRESS_EVERY === 0 || settled === worklist.length) {
      log(`phase 1 · classify: ${settled}/${worklist.length} — ${out.classified} classified, ${out.unusable} unusable, ${out.failures.length} failed; ${calls} calls, ${CONCURRENCY} in flight; ${elapsed(started)}`);
    }
  });
  out.calls = calls;
  out.aborted = abort;
  out.ms = Date.now() - started;
  return out;
}

// ---------------------------------------------------------------------------
// Phase 2 · build
// ---------------------------------------------------------------------------

type BuildPhase = {
  built: number;
  written: number;
  pending: number;
  pending_items: number;
  errors: Array<{ investigator_id: string; error: string }>;
  ms: number;
};

async function buildProfiles(roster: RosterRow[], rulesCtx: EvaluateContext): Promise<BuildPhase> {
  const started = Date.now();
  const out: BuildPhase = { built: 0, written: 0, pending: 0, pending_items: 0, errors: [], ms: 0 };
  const results: Array<BuildResult | null> = new Array(roster.length).fill(null);
  await runWorkerPool(roster, DB_CONCURRENCY, async (inv, i) => {
    try {
      const r = await buildInvestigatorFitProfile(supabase, inv.id, { modelBudget: 0, mesh: rulesCtx.mesh, write: WRITE });
      results[i] = r;
      out.built += 1;
      if (r.written) out.written += 1;
      if (r.pending_items > 0) {
        out.pending += 1;
        out.pending_items += r.pending_items;
      }
      log(`phase 2 · ${formatBuildLine(r)}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      out.errors.push({ investigator_id: inv.id, error: message });
      log(`phase 2 · ${inv.full_name ?? inv.id}: ERROR ${message}`);
    }
  });
  out.ms = Date.now() - started;
  return out;
}

// ---------------------------------------------------------------------------
// sync_job_logs (writes only)
// ---------------------------------------------------------------------------

async function logStart(details: Record<string, unknown>): Promise<string | null> {
  const { data } = await supabase.from("sync_job_logs").insert({ job_type: FIT_PROFILES_JOB_TYPE, status: "started", details: { mode: "backfill", ...details } }).select("id").single();
  return (data as { id?: string } | null)?.id ?? null;
}

async function logFinish(id: string | null, status: "success" | "error", message: string, details: Record<string, unknown>): Promise<void> {
  if (!id) return;
  await supabase.from("sync_job_logs").update({ status, message, details: { mode: "backfill", ...details }, finished_at: new Date().toISOString() }).eq("id", id);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const started = Date.now();
  const mode = DRY_RUN ? "DRY RUN (no model calls, no writes)" : CLASSIFY_ONLY ? "classify only (item cache written)" : WRITE ? "classify (item cache written) + build + write profiles" : "classify (item cache written) + build in memory (no profile writes; pass --write)";
  log(`fit:build-profiles · ${mode} · taxonomy ${TAXONOMY_VERSION} · model ${classifyModelName()} · concurrency ${CONCURRENCY} · cap ${MAX_MODEL_CALLS} calls · ${new Date().toISOString()}`);

  let mesh;
  try {
    mesh = await loadMeshIndex(supabase);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (MESH_EMPTY.test(message)) throw new Abort(message, 3);
    throw e;
  }
  const rulesCtx: EvaluateContext = { mesh, tables: DEFAULT_RULE_TABLES };
  log(`mesh_descriptors: ${mesh.byUi.size} descriptors (${elapsed(started)})`);

  const cacheTable = await itemCacheTableExists();
  const profilesTable = await profilesTableExists(supabase);
  if (!cacheTable && !DRY_RUN) throw new Abort("fit_item_profiles does not exist — apply supabase/migrations/20260914110000_fit_item_profiles.sql first", 3);
  if (!profilesTable && WRITE) throw new Abort(`investigator_fit_profiles does not exist — apply ${INVESTIGATOR_PROFILES_MIGRATION} first`, 3);
  if (!cacheTable) log("fit_item_profiles does not exist yet: every model-needed key counts as a miss below");

  const roster = await loadRoster();
  log(`roster: ${roster.length} investigators${INVESTIGATORS.length ? ` (--investigator ${INVESTIGATORS.length})` : ""}${CURSOR ? ` after ${CURSOR}` : ""}${LIMIT != null ? ` (--limit ${LIMIT})` : ""}`);
  if (!roster.length) {
    console.log(JSON_OUT ? JSON.stringify({ investigators: 0 }) : "nothing to do: no investigator selected");
    return 0;
  }

  const jobId = DRY_RUN ? null : await logStart({ investigators: roster.length, concurrency: CONCURRENCY, max_model_calls: MAX_MODEL_CALLS, classify_only: CLASSIFY_ONLY, cursor: CURSOR, limit: LIMIT });

  // Phase 1 — the worklist.
  const { byKey, summary: collect } = await collectWorklist(roster, rulesCtx);
  const keys = Array.from(byKey.keys());
  const usable = cacheTable ? await cachedUsableKeys(keys) : new Set<string>();
  const worklist = keys.filter((k) => !usable.has(k)).map((k) => byKey.get(k)!);
  const expectedCalls = Math.min(worklist.length, MAX_MODEL_CALLS);
  log(
    `phase 1 · worklist: ${collect.investigators} investigators, ${collect.items} items (+${collect.aspiration_items} aspiration lines), ${collect.model_needed_items} model-needed, ${collect.unique_keys} unique keys, ${usable.size} already cached → ${worklist.length} to classify, ${expectedCalls} expected calls (cap ${MAX_MODEL_CALLS})` +
      `${collect.normalize_failures.length ? `; ${collect.normalize_failures.length} rows failed to normalize` : ""}${collect.collect_errors.length ? `; ${collect.collect_errors.length} investigators failed to collect` : ""}; ${elapsed(started)}`
  );
  for (const f of collect.normalize_failures.slice(0, 10)) log(`  normalize failure: ${f.id} — ${f.error}`);
  for (const f of collect.collect_errors.slice(0, 10)) log(`  collect error: ${f.investigator_id} — ${f.error}`);

  if (DRY_RUN) {
    const summary = {
      mode: "dry-run",
      taxonomy_version: TAXONOMY_VERSION,
      investigators: collect.investigators,
      items: collect.items,
      aspiration_items: collect.aspiration_items,
      model_needed_items: collect.model_needed_items,
      unique_keys: collect.unique_keys,
      cached_usable: usable.size,
      worklist: worklist.length,
      expected_calls: expectedCalls,
      concurrency: CONCURRENCY,
      normalize_failures: collect.normalize_failures.length,
      collect_errors: collect.collect_errors.length,
      elapsed_ms: Date.now() - started,
    };
    if (JSON_OUT) console.log(JSON.stringify(summary, null, 2));
    else {
      console.log(`# fit:build-profiles — dry run — ${new Date().toISOString()}`);
      console.log(`investigators ${summary.investigators} · items ${summary.items} (+${summary.aspiration_items} aspiration lines) · model-needed ${summary.model_needed_items} · unique keys ${summary.unique_keys} · cached ${summary.cached_usable}`);
      console.log(`worklist ${summary.worklist} unique keys → ${summary.expected_calls} expected model calls at ${CONCURRENCY} in flight (cap ${MAX_MODEL_CALLS}); ~${Math.ceil((summary.expected_calls * 8) / CONCURRENCY / 60)} min at 8 s a call`);
      console.log(`normalize failures ${summary.normalize_failures} · collect errors ${summary.collect_errors} · ${elapsed(started)} · no model calls, nothing written`);
    }
    return 0;
  }

  // Phase 1 — the calls.
  const classify = await classifyWorklist(worklist, rulesCtx);
  log(`phase 1 · done: ${classify.classified} classified, ${classify.unusable} unusable replies, ${classify.failures.length} failed, ${classify.skipped_cap} beyond the cap; ${classify.calls} calls in ${(classify.ms / 1000).toFixed(1)} s`);
  if (classify.aborted) {
    await logFinish(jobId, "error", `fit_profiles backfill aborted: ${classify.aborted}`, { classify });
    throw new Abort(classify.aborted, 3);
  }

  // Phase 2 — the profiles.
  const build = CLASSIFY_ONLY ? null : await buildProfiles(roster, rulesCtx);

  const partial = classify.unusable > 0 || classify.failures.length > 0 || classify.skipped_cap > 0 || collect.collect_errors.length > 0 || (build ? build.pending > 0 || build.errors.length > 0 : false);
  const summary = {
    mode: CLASSIFY_ONLY ? "classify-only" : WRITE ? "write" : "build-in-memory",
    taxonomy_version: TAXONOMY_VERSION,
    investigators: roster.length,
    built: build?.built ?? 0,
    written: build?.written ?? 0,
    still_pending: build?.pending ?? 0,
    pending_items: build?.pending_items ?? 0,
    build_errors: build?.errors.length ?? 0,
    unique_keys: collect.unique_keys,
    cached_before: usable.size,
    worklist: classify.worklist,
    classified: classify.classified,
    calls: classify.calls,
    unusable: classify.unusable,
    failures: classify.failures.length,
    skipped_cap: classify.skipped_cap,
    normalize_failures: collect.normalize_failures.length,
    concurrency: CONCURRENCY,
    elapsed_ms: Date.now() - started,
  };
  const line = `fit_profiles backfill ${partial ? "partial" : "complete"}: ${summary.built} built / ${summary.written} written / ${summary.still_pending} still pending (${summary.pending_items} items); ${summary.classified} of ${summary.worklist} unique keys classified in ${summary.calls} calls, ${summary.unusable} unusable, ${summary.failures} failed, ${summary.skipped_cap} beyond the cap; ${elapsed(started)}`;
  if (JSON_OUT) console.log(JSON.stringify({ ...summary, model_failures: classify.failures.slice(0, 25), build_errors_sample: build?.errors.slice(0, 25) ?? [] }, null, 2));
  else console.log(line);
  await logFinish(jobId, build && build.errors.length === roster.length ? "error" : "success", line, { ...summary, outcome: partial ? "partial" : "success", model_failures: classify.failures.slice(0, 25), build_errors: build?.errors.slice(0, 25) ?? [] });
  return partial ? 2 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    if (e instanceof Abort) {
      console.error(`aborted: ${e.message}`);
      process.exit(e.code);
    }
    console.error(e instanceof Error ? e.stack ?? e.message : String(e));
    process.exit(1);
  });
