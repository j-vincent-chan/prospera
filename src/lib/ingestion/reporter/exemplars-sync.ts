/**
 * Supabase orchestration for RePORTER exemplars (PR 0.6): which notices are
 * due, their reissue lineage from funding_opportunities, the fetch, the
 * upsert-and-prune into opportunity_exemplars, and the per-notice stamp that
 * makes the next run resume where this one stopped. Shared by
 * /api/cron/fit-exemplars and scripts/fit-reporter-exemplars.ts.
 *
 * Resume predicate (exemplarsDueFilter): open NIH-like notices never fetched,
 * fetched more than 30 days ago, or whose last fetch errored more than 7 days
 * ago; oldest stamp first, then newest posted. Every notice a run touches is
 * stamped — zero exemplars included — so a rerun never re-fetches the corpus.
 * Writes per notice: upsert the fresh rows, delete the notice's rows older than
 * this run, stamp funding_opportunities. `dryRun` performs the fetch and the
 * report and writes nothing, not even sync_job_logs.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildLineage,
  EXEMPLAR_JOB_TYPE,
  exemplarsDueFilter,
  fetchNoticeExemplars,
  formatNoticeResult,
  indexLineageRows,
  LINEAGE_MAX_STEPS,
  NIH_LIKE_FILTER,
  normalizeAnnouncementNumber,
  openNoticeFilter,
  type LineageRow,
  type ReporterSearch,
} from "@/lib/ingestion/reporter/exemplars";

export const EXEMPLARS_MIGRATION = "supabase/migrations/20260913130000_fit_reporter_exemplars.sql";
/** Notices per cron run: ~1 request each, well inside maxDuration 300 with the 240 s budget. */
export const EXEMPLARS_CRON_LIMIT = 80;
export const EXEMPLARS_CRON_TIME_BUDGET_MS = 240_000;

export type ExemplarSyncParams = {
  /** Notices to process this run (default: every due notice). */
  limit?: number;
  /** Only these announcement numbers, regardless of the stamp (manual re-fetch, acceptance runs). */
  opportunityNumbers?: string[];
  /** Fetch and report; write nothing. */
  dryRun?: boolean;
  /** Stop starting new notices once this much wall time has passed. */
  timeBudgetMs?: number;
  /** Receives one line per notice as it completes. */
  log?: (line: string) => void;
  now?: Date;
  /** Tests substitute the RePORTER call. */
  search?: ReporterSearch;
};

export type ExemplarNoticeOutcome = {
  opportunity_number: string;
  status: "ok" | "error" | "skipped";
  lineage: string[];
  stored: number;
  distinct: number;
  apiTotal: number | null;
  pages: number;
  error?: string;
  line: string;
};

export type ExemplarSyncResult = {
  ok: true;
  dryRun: boolean;
  /** Notices matching the due predicate (or the explicit list) before the limit. */
  due: number;
  /** Notices this run took on. */
  scanned: number;
  fetched: number;
  withExemplars: number;
  zero: number;
  errors: number;
  skipped: number;
  /** Exemplar rows stored (or, in a dry run, that would have been). */
  stored: number;
  requests: number;
  budgetExhausted: boolean;
  durationMs: number;
  notices: ExemplarNoticeOutcome[];
};

type NoticeRow = {
  id: string;
  opportunity_number: string | null;
  reissue_of: string | null;
  posted_date: string | null;
  exemplars_fetched_at?: string | null;
  exemplars_fetch_status?: string | null;
};

const SELECT = "id, opportunity_number, reissue_of, posted_date, exemplars_fetched_at, exemplars_fetch_status";
const SELECT_PRE_MIGRATION = "id, opportunity_number, reissue_of, posted_date";
const PAGE = 1000;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Whether the PR 0.6 stamp columns exist yet. Probed with a real select: a
 * HEAD count against a missing column comes back with an empty error message,
 * so the message cannot be inspected there.
 */
export async function exemplarColumnsExist(supabase: SupabaseClient): Promise<boolean> {
  const { error } = await supabase.from("funding_opportunities").select("exemplars_fetched_at").limit(1);
  if (!error) return true;
  if (/exemplars_fetched_at/i.test(error.message)) return false;
  throw new Error(`funding_opportunities read failed: ${error.message}`);
}

async function logStart(supabase: SupabaseClient, details: Record<string, unknown>): Promise<string | null> {
  const { data } = await supabase.from("sync_job_logs").insert({ job_type: EXEMPLAR_JOB_TYPE, status: "started", details }).select("id").single();
  return (data as { id?: string } | null)?.id ?? null;
}

async function logFinish(supabase: SupabaseClient, id: string | null, status: "success" | "error", message: string, details: Record<string, unknown>) {
  if (!id) return;
  await supabase.from("sync_job_logs").update({ status, message, details, finished_at: new Date().toISOString() }).eq("id", id);
}

/** Open NIH-like notices due a fetch, oldest stamp first. Before the migration (dry run only) every open NIH-like notice counts as due. */
async function loadDueNotices(supabase: SupabaseClient, params: { limit: number; now: Date; migrationApplied: boolean }): Promise<NoticeRow[] | { error: string }> {
  const today = isoDate(params.now);
  let q = supabase
    .from("funding_opportunities")
    .select(params.migrationApplied ? SELECT : SELECT_PRE_MIGRATION)
    .or(openNoticeFilter(today))
    .or(NIH_LIKE_FILTER);
  if (params.migrationApplied) q = q.or(exemplarsDueFilter(params.now)).order("exemplars_fetched_at", { ascending: true, nullsFirst: true });
  const { data, error } = await q.order("posted_date", { ascending: false, nullsFirst: false }).limit(params.limit);
  if (error) return { error: error.message };
  return (data ?? []) as unknown as NoticeRow[];
}

/** How many open NIH-like notices are due right now (for the script's pre-flight print). Before the migration: every open NIH-like notice. */
export async function countDueNotices(supabase: SupabaseClient, now: Date = new Date()): Promise<{ due: number; migrationApplied: boolean }> {
  const migrationApplied = await exemplarColumnsExist(supabase);
  let q = supabase.from("funding_opportunities").select("id", { count: "exact", head: true }).or(openNoticeFilter(isoDate(now))).or(NIH_LIKE_FILTER);
  if (migrationApplied) q = q.or(exemplarsDueFilter(now));
  const { count, error } = await q;
  if (error) throw new Error(`due count failed: ${error.message || error.code || "no message (HEAD)"}`);
  return { due: count ?? 0, migrationApplied };
}

async function loadRequestedNotices(supabase: SupabaseClient, numbers: string[], migrationApplied: boolean): Promise<NoticeRow[] | { error: string }> {
  const { data, error } = await supabase
    .from("funding_opportunities")
    .select(migrationApplied ? SELECT : SELECT_PRE_MIGRATION)
    .in("opportunity_number", numbers);
  if (error) return { error: error.message };
  return (data ?? []) as unknown as NoticeRow[];
}

/**
 * The reissue_of chain for a batch of notices: up to LINEAGE_MAX_STEPS rounds
 * of one `in()` read each, following the predecessors' own reissue_of. The
 * notices themselves are in the index too (one may be another's predecessor).
 */
export async function loadLineageRows(supabase: SupabaseClient, notices: LineageRow[]): Promise<Map<string, LineageRow>> {
  const index = indexLineageRows(notices);
  let targets = Array.from(new Set(notices.map((n) => normalizeAnnouncementNumber(n.reissue_of)).filter((n): n is string => n != null && !index.has(n))));
  for (let round = 0; round < LINEAGE_MAX_STEPS && targets.length; round += 1) {
    const { data, error } = await supabase.from("funding_opportunities").select("opportunity_number, reissue_of").in("opportunity_number", targets);
    if (error) throw new Error(`lineage read failed: ${error.message}`);
    const next = new Set<string>();
    for (const row of (data ?? []) as LineageRow[]) {
      const n = normalizeAnnouncementNumber(row.opportunity_number);
      if (!n || index.has(n)) continue;
      index.set(n, row);
      const parent = normalizeAnnouncementNumber(row.reissue_of);
      if (parent && !index.has(parent)) next.add(parent);
    }
    targets = Array.from(next);
  }
  return index;
}

/** Group the notice rows by announcement number (a number can have several rows across sources); non-announcement numbers keep their raw value. */
function groupByNumber(rows: NoticeRow[]): Map<string, NoticeRow[]> {
  const out = new Map<string, NoticeRow[]>();
  for (const row of rows) {
    const key = normalizeAnnouncementNumber(row.opportunity_number) ?? String(row.opportunity_number ?? row.id);
    const list = out.get(key) ?? [];
    list.push(row);
    out.set(key, list);
  }
  return out;
}

export async function syncOpportunityExemplars(supabase: SupabaseClient, params: ExemplarSyncParams = {}): Promise<ExemplarSyncResult | { ok: false; error: string }> {
  const started = Date.now();
  const now = params.now ?? new Date();
  const dryRun = Boolean(params.dryRun);
  const limit = Math.max(1, params.limit ?? 5000);
  const budget = params.timeBudgetMs ?? Number.POSITIVE_INFINITY;
  const log = params.log ?? (() => undefined);
  const requested = params.opportunityNumbers?.map((n) => normalizeAnnouncementNumber(n) ?? n.trim().toUpperCase()).filter(Boolean) ?? null;

  // 0. The stamp columns: the real path needs them; a dry run works without (every open NIH notice counts as due).
  let migrationApplied: boolean;
  try {
    migrationApplied = await exemplarColumnsExist(supabase);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!migrationApplied && !dryRun) return { ok: false, error: `${EXEMPLARS_MIGRATION} is not applied; apply it before a real run (--dry-run works without it)` };
  if (!migrationApplied) log(`${EXEMPLARS_MIGRATION} is not applied — dry run treats every open NIH notice as due`);

  const logId = dryRun ? null : await logStart(supabase, { limit, opportunityNumbers: requested, dryRun });

  // 1. Which notices.
  let rows: NoticeRow[];
  let due: number;
  if (requested?.length) {
    const loaded = await loadRequestedNotices(supabase, requested, migrationApplied);
    if (!Array.isArray(loaded)) {
      await logFinish(supabase, logId, "error", loaded.error, {});
      return { ok: false, error: loaded.error };
    }
    rows = loaded;
    due = new Set(rows.map((r) => r.opportunity_number)).size;
    for (const n of requested) if (!rows.some((r) => normalizeAnnouncementNumber(r.opportunity_number) === n || r.opportunity_number === n)) log(`${n}: not in funding_opportunities — skipped`);
  } else {
    const counted = await countDueNotices(supabase, now).catch((e: Error) => ({ error: e.message }));
    if ("error" in counted) {
      await logFinish(supabase, logId, "error", counted.error, {});
      return { ok: false, error: counted.error };
    }
    due = counted.due;
    const loaded = await loadDueNotices(supabase, { limit: Math.min(limit, PAGE), now, migrationApplied });
    if (!Array.isArray(loaded)) {
      await logFinish(supabase, logId, "error", loaded.error, {});
      return { ok: false, error: loaded.error };
    }
    rows = loaded;
  }

  const groups = Array.from(groupByNumber(rows).entries()).slice(0, limit);

  // 2. Lineage rows for the whole batch (≤ 4 reads).
  let lineageIndex: Map<string, LineageRow>;
  try {
    lineageIndex = await loadLineageRows(
      supabase,
      groups.map(([, list]) => list[0]!)
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logFinish(supabase, logId, "error", message, {});
    return { ok: false, error: message };
  }

  // 3. Fetch, write, stamp — one notice at a time, inside the time budget.
  const notices: ExemplarNoticeOutcome[] = [];
  let fetched = 0;
  let withExemplars = 0;
  let zero = 0;
  let errors = 0;
  let skipped = 0;
  let stored = 0;
  let requests = 0;
  let budgetExhausted = false;

  for (const [key, list] of groups) {
    if (Date.now() - started > budget) {
      budgetExhausted = true;
      break;
    }
    const ids = list.map((r) => r.id);
    const fetchedAt = new Date().toISOString();
    const number = normalizeAnnouncementNumber(key);

    if (!number) {
      skipped += 1;
      const line = `${key}: not an NIH announcement number — skipped`;
      notices.push({ opportunity_number: key, status: "skipped", lineage: [], stored: 0, distinct: 0, apiTotal: null, pages: 0, line });
      log(line);
      if (!dryRun) {
        await supabase.from("funding_opportunities").update({ exemplars_fetched_at: fetchedAt, exemplars_fetch_status: "skipped", exemplars_count: 0, exemplars_lineage: [] }).in("id", ids);
      }
      continue;
    }

    const lineage = buildLineage(list[0]!, lineageIndex);
    try {
      const result = await fetchNoticeExemplars({ noticeNumber: number, lineage, fetchedAt, search: params.search });
      requests += result.pages;
      fetched += 1;
      if (result.rows.length) withExemplars += 1;
      else zero += 1;
      stored += result.rows.length;
      const notes = [lineage.missing.length ? `predecessor ${lineage.missing.join(", ")} not in corpus` : "", lineage.truncated ? "lineage truncated at 4 steps" : ""].filter(Boolean);
      const line = `${formatNoticeResult(result)}${notes.length ? ` (${notes.join("; ")})` : ""}`;
      notices.push({ opportunity_number: number, status: "ok", lineage: lineage.numbers, stored: result.rows.length, distinct: result.distinct, apiTotal: result.apiTotal, pages: result.pages, line });
      log(line);

      if (!dryRun) {
        if (result.rows.length) {
          const { error: upErr } = await supabase.from("opportunity_exemplars").upsert(result.rows, { onConflict: "opportunity_number,project_num" });
          if (upErr) throw new Error(`opportunity_exemplars upsert failed: ${upErr.message}`);
        }
        const { error: delErr } = await supabase.from("opportunity_exemplars").delete().eq("opportunity_number", number).lt("fetched_at", fetchedAt);
        if (delErr) throw new Error(`opportunity_exemplars prune failed: ${delErr.message}`);
        const { error: stampErr } = await supabase
          .from("funding_opportunities")
          .update({ exemplars_fetched_at: fetchedAt, exemplars_fetch_status: "ok", exemplars_count: result.rows.length, exemplars_lineage: lineage.numbers })
          .in("id", ids);
        if (stampErr) throw new Error(`funding_opportunities stamp failed: ${stampErr.message}`);
      }
    } catch (e) {
      errors += 1;
      const message = e instanceof Error ? e.message : String(e);
      const line = `${number}: ERROR ${message}`;
      notices.push({ opportunity_number: number, status: "error", lineage: lineage.numbers, stored: 0, distinct: 0, apiTotal: null, pages: 0, error: message, line });
      log(line);
      if (!dryRun) {
        // Best effort: an unstamped error would be retried next run anyway; a stamped one waits 7 days.
        await supabase.from("funding_opportunities").update({ exemplars_fetched_at: fetchedAt, exemplars_fetch_status: "error" }).in("id", ids);
      }
    }
  }

  const durationMs = Date.now() - started;
  const summary = { dryRun, due, scanned: groups.length, fetched, withExemplars, zero, errors, skipped, stored, requests, budgetExhausted, durationMs };
  await logFinish(
    supabase,
    logId,
    errors > 0 && fetched === 0 ? "error" : "success",
    `${fetched} notices fetched · ${withExemplars} with exemplars · ${stored} rows · ${errors} errors · ${due} due before this run`,
    summary
  );
  return { ok: true, ...summary, notices };
}

export function formatSyncSummary(r: ExemplarSyncResult): string {
  return [
    `${r.dryRun ? "Dry run — nothing written. " : ""}${r.scanned} of ${r.due} due notices processed in ${(r.durationMs / 1000).toFixed(1)} s (${r.requests} RePORTER requests)`,
    `  fetched ${r.fetched} · with exemplars ${r.withExemplars} · zero ${r.zero} · errors ${r.errors} · skipped ${r.skipped} · rows ${r.dryRun ? "that would be stored" : "stored"} ${r.stored}`,
    r.budgetExhausted ? "  time budget reached — the next run resumes with the notices still due" : "",
  ]
    .filter(Boolean)
    .join("\n");
}
