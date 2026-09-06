/**
 * Fit engine · PR 1.5 · build opportunity fit profiles (the backfill; the
 * nightly runner covers ~40 notices a run, this script the whole open set).
 *
 *   npm run fit:build-opportunity-profiles -- --dry-run                    # no model calls, no writes: candidates, due, chunk and exemplar-abstract counts, the expected call count
 *   npm run fit:build-opportunity-profiles -- --dry-run --limit 50         # plan the first 50 due notices only
 *   npm run fit:build-opportunity-profiles -- --write                      # build every due notice, upsert opportunity_fit_profiles
 *   npm run fit:build-opportunity-profiles -- --write --limit 100 --concurrency 6 --max-model-calls 400
 *   npm run fit:build-opportunity-profiles -- --write --only RFA-DK-26-315,PAR-25-122   # named notices (still subject to the due predicate; add --force to rebuild)
 *   npm run fit:build-opportunity-profiles -- --write --cursor PAR-25-300  # resume: skip notices whose number sorts before the cursor
 *   npm run fit:build-opportunity-profiles -- --write --no-exemplar-model  # exemplar abstracts by the rules only (no item-classifier calls); such profiles are stored complete and the cron does not upgrade them until the notice changes or --force
 *   npm run fit:build-opportunity-profiles -- --write --json               # per-notice lines on stderr, one JSON summary on stdout
 *
 * Selection: open NIH-like notices with Guide sections and a page hash
 * (runOpportunityProfiles' candidates), then profileDue — no row, taxonomy
 * moved, guide_html_hash changed, or an incomplete build — as the resume
 * predicate, so a rerun after an abort picks up where it stopped. Due notices
 * are processed in opportunity_number order (stable; --cursor resumes it) by a
 * small worker pool (--concurrency, default 4, max 8) over one shared
 * extractor and classifier (one OpenAI client) and one shared model budget
 * (--max-model-calls; a notice is deferred when fewer than 3 calls remain).
 *
 * Writes: the two caches (fit_notice_extractions, fit_item_profiles) are written
 * after every model call — they are keyed by content and are the point of
 * calling; opportunity_fit_profiles rows are upserted only with --write. Without
 * --write and without --dry-run the script refuses to start (a run that calls
 * the model and keeps nothing is a mistake).
 *
 * Exit codes: 0 every due notice built complete; 2 partial (deferred, incomplete
 * or errored notices — rerun to continue); 3 aborted before any build (missing
 * table, missing credentials); 1 unexpected error.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ModelFn } from "../src/lib/fit/classify/llm";
import { loadMeshIndex } from "../src/lib/fit/classify/mesh-db";
import { DEFAULT_RULE_TABLES, evaluateRules, type EvaluateContext } from "../src/lib/fit/classify/rules";
import { InMemoryItemProfileCache, supabaseItemProfileCache } from "../src/lib/fit/classify/cache";
import {
  buildOpportunityFitProfile,
  extractModelName,
  InMemoryNoticeExtractionCache,
  MIN_CALLS_PER_NOTICE,
  ModelBudget,
  OPPORTUNITY_PROFILES_MIGRATION as MIGRATION,
  resolveModelFns,
  selectDue,
  SKIPPED_BUDGET,
  supabaseNoticeExtractionCache,
  supabaseOpportunityProfileStore,
  type CandidateNotice,
  type ProfileBuild,
} from "../src/lib/fit/profile/opportunity";
import { classifyModelName } from "../src/lib/fit/classify/llm";
import { TAXONOMY_VERSION } from "../src/lib/fit/taxonomy";
import { OPPORTUNITY_PROFILES_JOB_TYPE } from "../src/lib/fit/profile/opportunity";

config({ path: ".env.local", quiet: true });

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const DRY_RUN = flag("--dry-run");
const WRITE = flag("--write");
const JSON_OUT = flag("--json");
const FORCE = flag("--force");
const NO_EXEMPLAR_MODEL = flag("--no-exemplar-model");
const LIMIT = opt("--limit") ? Number(opt("--limit")) : null;
const ONLY = (opt("--only") ?? "")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);
const CURSOR = opt("--cursor")?.trim().toUpperCase() ?? null;
const CONCURRENCY = Math.max(1, Math.min(8, Number(opt("--concurrency") ?? 4) || 4));
const MAX_MODEL_CALLS = opt("--max-model-calls") ? Number(opt("--max-model-calls")) : Number.MAX_SAFE_INTEGER;

if (!DRY_RUN && !WRITE) {
  console.error("usage: fit:build-opportunity-profiles -- --dry-run | --write  [--limit N] [--only NUM,...] [--cursor NUM] [--concurrency N] [--max-model-calls N] [--no-exemplar-model] [--force] [--json]");
  console.error("refusing to call the model without --write (nothing would be kept); use --dry-run to plan");
  process.exit(1);
}
if (LIMIT !== null && !(LIMIT > 0)) {
  console.error("--limit must be a positive number");
  process.exit(1);
}

const err = (s: string) => console.error(s);
const out = (s: string) => (JSON_OUT ? console.error(s) : console.log(s));

function db(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    err("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
    process.exit(3);
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

const isMissingTable = (message: string, code?: string) => code === "42P01" || code === "PGRST205" || /relation .* does not exist|Could not find the table/i.test(message);

/** `null` when the table answers, else the error message; exit 3 on anything but a missing table. (A HEAD probe does not surface a missing table, so one row is selected.) */
async function probeTable(supabase: SupabaseClient, table: string, column: string): Promise<string | null> {
  const { error } = await supabase.from(table).select(column).limit(1);
  if (!error) return null;
  if (isMissingTable(error.message, error.code)) return `${table} is not on the database (apply ${MIGRATION})`;
  err(`${table} probe failed: ${error.message}`);
  process.exit(3);
}

type NoticeLine = {
  number: string;
  reason: string;
  status: "built" | "incomplete" | "deferred" | "error" | "planned";
  text?: string;
  chunks?: number;
  chunks_cached?: number;
  exemplar_abstracts?: number;
  exemplar_model_needed?: number;
  expected_calls?: number;
  extractor_calls?: number;
  classifier_calls?: number;
  unusable?: number;
  confidence?: string;
  incomplete?: string[];
  error?: string;
  ms: number;
};

type Summary = {
  mode: "dry-run" | "write";
  taxonomy_version: string;
  extract_model: string;
  classify_model: string | null;
  candidates: number;
  due: number;
  selected: number;
  built: number;
  written: number;
  incomplete: number;
  deferred: number;
  errors: number;
  extractor_calls: number;
  classifier_calls: number;
  unusable: number;
  expected_calls: number;
  chunks: number;
  exemplar_abstracts: number;
  last_number: string | null;
  elapsed_ms: number;
  exit_code: number;
  notices: NoticeLine[];
};

const counted = (fn: ModelFn | null, tally: { n: number }): ModelFn | null =>
  fn
    ? async (req) => {
        tally.n += 1;
        return fn(req);
      }
    : null;

function describe(build: ProfileBuild): { chunks: number; chunks_cached: number; exemplar_abstracts: number; exemplar_model_needed: number; unusable: number; expected_calls: number } {
  const chunks = build.runs.length;
  const chunks_cached = build.runs.filter((r) => r.cache === "hit").length;
  const unusable = build.runs.filter((r) => r.extraction && !r.extraction.usable).length;
  const exemplar_abstracts = build.exemplar.classified;
  // Exemplars the item classifier would be called for: model needed and no usable cached reply.
  const exemplar_model_needed = NO_EXEMPLAR_MODEL ? 0 : build.exemplar.items.filter((i) => i.classified && i.model_needed && i.cache !== "hit").length;
  const uncachedChunks = build.runs.filter((r) => r.cache !== "hit").length;
  return { chunks, chunks_cached, exemplar_abstracts, exemplar_model_needed, unusable, expected_calls: uncachedChunks + exemplar_model_needed };
}

async function main(): Promise<number> {
  const started = Date.now();
  const supabase = db();
  const mode = DRY_RUN ? "dry-run" : "write";
  out(`fit:build-opportunity-profiles · ${mode.toUpperCase()} · taxonomy ${TAXONOMY_VERSION} · extractor ${extractModelName()} · exemplar classifier ${NO_EXEMPLAR_MODEL ? "rules only" : classifyModelName()} · concurrency ${CONCURRENCY} · model budget ${MAX_MODEL_CALLS === Number.MAX_SAFE_INTEGER ? "unlimited" : MAX_MODEL_CALLS} · ${new Date().toISOString()}`);

  // Tables. A missing profile table aborts a write; a dry run plans with in-memory caches and says so.
  const missingProfiles = await probeTable(supabase, "opportunity_fit_profiles", "opportunity_id");
  const missingExtractions = await probeTable(supabase, "fit_notice_extractions", "content_hash");
  const missingItems = await probeTable(supabase, "fit_item_profiles", "content_hash");
  for (const m of [missingProfiles, missingExtractions, missingItems]) if (m) err(`warning: ${m}`);
  if (!DRY_RUN && (missingProfiles || missingExtractions || missingItems)) {
    err("aborting: the tables above must exist before a write run");
    return 3;
  }
  if (!DRY_RUN && !process.env.OPENAI_API_KEY?.trim()) {
    err("aborting: OPENAI_API_KEY missing in .env.local");
    return 3;
  }
  jobClient = supabase;
  jobId = DRY_RUN ? null : await logStart(supabase, { limit: LIMIT, only: ONLY, cursor: CURSOR, concurrency: CONCURRENCY, max_model_calls: MAX_MODEL_CALLS, write: WRITE, force: FORCE, no_exemplar_model: NO_EXEMPLAR_MODEL });

  err("loading mesh_descriptors …");
  const mesh = await loadMeshIndex(supabase);
  const ctx: EvaluateContext = { mesh, tables: DEFAULT_RULE_TABLES };
  const rules = (item: Parameters<typeof evaluateRules>[0]) => evaluateRules(item, ctx);

  const store = supabaseOpportunityProfileStore(supabase);
  const now = new Date();
  let candidates: CandidateNotice[] = await store.loadCandidates(now);
  if (ONLY.length) {
    const present = new Set(candidates.map((c) => (c.opportunity_number ?? "").toUpperCase()));
    const missing = ONLY.filter((n) => !present.has(n));
    if (missing.length) {
      // A named notice outside the open set (closed, or without sections) is loaded directly; it still needs sections and a hash.
      const { data, error } = await supabase.from("funding_opportunities").select("id, opportunity_number, guide_html_hash, posted_date").in("opportunity_number", missing).not("guide_sections", "is", null).not("guide_html_hash", "is", null);
      if (error) throw new Error(`funding_opportunities read failed: ${error.message}`);
      candidates.push(...((data ?? []) as CandidateNotice[]));
    }
    candidates = candidates.filter((c) => ONLY.includes((c.opportunity_number ?? "").toUpperCase()));
    const still = ONLY.filter((n) => !candidates.some((c) => (c.opportunity_number ?? "").toUpperCase() === n));
    for (const n of still) err(`warning: ${n} not found with Guide sections and a page hash; skipped`);
  }
  const existing = missingProfiles ? new Map() : await store.loadExistingProfiles(candidates.map((c) => c.id));
  const due = selectDue(candidates, existing, { onlyChanged: !FORCE, limit: Number.MAX_SAFE_INTEGER }).sort((a, b) => (a.opportunity_number ?? "").localeCompare(b.opportunity_number ?? "") || a.id.localeCompare(b.id));
  const afterCursor = CURSOR ? due.filter((c) => (c.opportunity_number ?? "").toUpperCase() >= CURSOR) : due;
  const selected = LIMIT !== null ? afterCursor.slice(0, LIMIT) : afterCursor;
  out(`${candidates.length} candidates (open NIH notices with Guide sections and a page hash${ONLY.length ? `, --only ${ONLY.join(",")}` : ""}) · ${due.length} due (${JSON.stringify(due.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.reason]: (acc[c.reason] ?? 0) + 1 }), {}))})${CURSOR ? ` · ${afterCursor.length} at or after cursor ${CURSOR}` : ""} · ${selected.length} selected${LIMIT !== null ? ` (limit ${LIMIT})` : ""}`);

  // One shared extractor and classifier (one OpenAI client) and one budget for the whole run.
  const extractorTally = { n: 0 };
  const classifierTally = { n: 0 };
  // Dry run: a zero budget makes every uncached chunk a counted skip (cache hits still show) and the
  // stub extractor can never be reached; exemplars go through the rules and the item cache only.
  const never: ModelFn = async () => {
    throw new Error("dry run: the model must not be called");
  };
  const models = DRY_RUN ? { extractor: never, classifier: null } : resolveModelFns({ ...(NO_EXEMPLAR_MODEL ? { classifier: null } : {}) });
  const extractor = counted(models.extractor, extractorTally);
  const classifier = counted(models.classifier, classifierTally);
  const budget = new ModelBudget(DRY_RUN ? 0 : MAX_MODEL_CALLS);
  const extractionCache = missingExtractions ? new InMemoryNoticeExtractionCache() : supabaseNoticeExtractionCache(supabase);
  const itemCache = missingItems ? new InMemoryItemProfileCache() : supabaseItemProfileCache(supabase);

  const summary: Summary = {
    mode,
    taxonomy_version: TAXONOMY_VERSION,
    extract_model: extractModelName(),
    classify_model: NO_EXEMPLAR_MODEL ? null : classifyModelName(),
    candidates: candidates.length,
    due: due.length,
    selected: selected.length,
    built: 0,
    written: 0,
    incomplete: 0,
    deferred: 0,
    errors: 0,
    extractor_calls: 0,
    classifier_calls: 0,
    unusable: 0,
    expected_calls: 0,
    chunks: 0,
    exemplar_abstracts: 0,
    last_number: null,
    elapsed_ms: 0,
    exit_code: 0,
    notices: [],
  };
  const lines: NoticeLine[] = [];
  let next = 0;
  let deferring = false;

  const worker = async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= selected.length) return;
      const c = selected[i]!;
      const number = c.opportunity_number ?? c.id;
      const t0 = Date.now();
      if (!DRY_RUN && (deferring || budget.remaining < MIN_CALLS_PER_NOTICE)) {
        deferring = true;
        lines[i] = { number, reason: c.reason, status: "deferred", ms: 0 };
        out(`${number.padEnd(16)} ${c.reason.padEnd(24)} DEFERRED (model budget: ${budget.remaining} calls left)`);
        continue;
      }
      try {
        const build = await buildOpportunityFitProfile(supabase, c.id, {
          rules,
          extractor,
          classifier,
          extractionCache,
          itemCache,
          budget,
          store,
          dryRun: DRY_RUN || !WRITE,
          now: () => now,
        });
        const d = describe(build);
        if (DRY_RUN) {
          lines[i] = { number, reason: c.reason, status: "planned", text: build.text.source, ...d, ms: Date.now() - t0 };
          out(`${number.padEnd(16)} ${c.reason.padEnd(24)} ${build.text.source.padEnd(9)} chunks ${d.chunks} (${d.chunks_cached} cached) · exemplar abstracts ${d.exemplar_abstracts} (${d.exemplar_model_needed} need the model) · expected calls ${d.expected_calls} · ${Date.now() - t0} ms`);
          continue;
        }
        const complete = build.row.sources.complete;
        const budgetSkipped = build.row.sources.incomplete.some((l) => l.includes(SKIPPED_BUDGET));
        lines[i] = {
          number,
          reason: c.reason,
          status: complete ? "built" : "incomplete",
          text: build.text.source,
          chunks: d.chunks,
          chunks_cached: d.chunks_cached,
          exemplar_abstracts: d.exemplar_abstracts,
          extractor_calls: build.runs.filter((r) => r.model_called).length,
          classifier_calls: build.exemplar.model_calls,
          unusable: d.unusable,
          confidence: build.profile.confidence,
          incomplete: build.row.sources.incomplete,
          ms: Date.now() - t0,
        };
        const req = Object.entries(build.profile.paradigm.required)
          .slice(0, 3)
          .map(([k, v]) => `${k} ${v}`)
          .join(", ");
        out(`${number.padEnd(16)} ${c.reason.padEnd(24)} ${complete ? "built     " : "INCOMPLETE"} ${build.text.source.padEnd(9)} groups ${build.runs.map((r) => `${r.group}${r.of > 1 ? `/${r.chunk}` : ""}:${r.cache}${r.model_called ? "+" : ""}${r.skipped ? "!" : ""}${r.extraction && !r.extraction.usable ? "?" : ""}`).join(" ")} · exemplars ${build.exemplar.informative}/${build.exemplar.classified}/${build.exemplar.rows} (w_e ${build.blend.weights.exemplar}, ${build.exemplar.model_calls} calls) · confidence ${build.profile.confidence}${build.profile.needs_review ? " · needs_review" : ""} · required ${req || "(none)"}${complete ? "" : ` · ${build.row.sources.incomplete.join("; ")}`} · ${Date.now() - t0} ms`);
        if (budgetSkipped) deferring = true;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        lines[i] = { number, reason: c.reason, status: "error", error: message, ms: Date.now() - t0 };
        out(`${number.padEnd(16)} ${c.reason.padEnd(24)} ERROR ${message}`);
        if (isMissingTable(message)) deferring = true;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, selected.length)) }, worker));

  for (const l of lines) {
    if (!l) continue;
    summary.notices.push(l);
    if (l.status === "planned") {
      summary.expected_calls += l.expected_calls ?? 0;
      summary.chunks += l.chunks ?? 0;
      summary.exemplar_abstracts += l.exemplar_abstracts ?? 0;
    }
    if (l.status === "built" || l.status === "incomplete") {
      summary.built += 1;
      if (WRITE) summary.written += 1;
      if (l.status === "incomplete") summary.incomplete += 1;
      summary.unusable += l.unusable ?? 0;
      summary.chunks += l.chunks ?? 0;
      summary.exemplar_abstracts += l.exemplar_abstracts ?? 0;
      summary.last_number = l.number;
    }
    if (l.status === "deferred") summary.deferred += 1;
    if (l.status === "error") summary.errors += 1;
  }
  summary.extractor_calls = extractorTally.n;
  summary.classifier_calls = classifierTally.n;
  summary.elapsed_ms = Date.now() - started;
  summary.exit_code = DRY_RUN ? 0 : summary.incomplete + summary.deferred + summary.errors > 0 ? 2 : 0;

  if (DRY_RUN) {
    out(`DRY RUN: ${summary.candidates} candidates, ${summary.due} due, ${summary.selected} planned · ${summary.chunks} extractor chunks · ${summary.exemplar_abstracts} exemplar abstracts · expected model calls ${summary.expected_calls}${NO_EXEMPLAR_MODEL ? " (extractor only)" : ""} · no model calls made, nothing written · ${summary.elapsed_ms} ms`);
  } else {
    out(`done: built ${summary.built}/${summary.selected} (${summary.written} written, ${summary.incomplete} incomplete), deferred ${summary.deferred}, errors ${summary.errors} · extractor calls ${summary.extractor_calls}, classifier calls ${summary.classifier_calls}, unusable replies ${summary.unusable} · last ${summary.last_number ?? "(none)"} · ${summary.elapsed_ms} ms · exit ${summary.exit_code}`);
  }
  if (JSON_OUT) console.log(JSON.stringify(summary, null, 2));
  await logFinish(summary.exit_code === 0 || summary.exit_code === 2 ? "success" : "error", `${OPPORTUNITY_PROFILES_JOB_TYPE} backfill ${summary.exit_code === 2 ? "partial" : summary.exit_code === 0 ? "complete" : "failed"}: built ${summary.built}/${summary.selected}, ${summary.written} written, ${summary.incomplete} incomplete, deferred ${summary.deferred}, errors ${summary.errors}`, { ...summary, outcome: summary.exit_code === 2 ? "partial" : summary.exit_code === 0 ? "success" : "error" });
  return summary.exit_code;
}

// ---------------------------------------------------------------------------
// sync_job_logs (written only when not --dry-run; mirrors fit-build-profiles)
// ---------------------------------------------------------------------------

let jobClient: SupabaseClient | null = null;
let jobId: string | null = null;

async function logStart(supabase: SupabaseClient, details: Record<string, unknown>): Promise<string | null> {
  const { data } = await supabase.from("sync_job_logs").insert({ job_type: OPPORTUNITY_PROFILES_JOB_TYPE, status: "started", details: { mode: "backfill", ...details } }).select("id").single();
  return (data as { id?: string } | null)?.id ?? null;
}

async function logFinish(status: "success" | "error", message: string, details: Record<string, unknown>): Promise<void> {
  if (!jobId || !jobClient) return;
  const rest: Record<string, unknown> = { ...details };
  delete rest.lines; // per-notice lines stay on stdout, not in the log row
  await jobClient.from("sync_job_logs").update({ status, message, details: { mode: "backfill", ...rest }, finished_at: new Date().toISOString() }).eq("id", jobId);
  jobId = null;
}

main()
  .then((code) => process.exit(code))
  .catch(async (e) => {
    console.error(e instanceof Error ? e.stack ?? e.message : e);
    await logFinish("error", `${OPPORTUNITY_PROFILES_JOB_TYPE} backfill failed: ${e instanceof Error ? e.message : String(e)}`, {}).catch(() => undefined);
    process.exit(1);
  });
