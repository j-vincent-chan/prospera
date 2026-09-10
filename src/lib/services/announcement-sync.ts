import type { SupabaseClient } from "@supabase/supabase-js";
import { funderFamilyOf, type AnnouncementSource, type FunderFamily } from "@/lib/ingestion/announcement/registry";
import {
  acquireAnnouncement,
  adapterFor,
  isNihCorpusRow,
  type AnnouncementDeps,
  type AnnouncementRow,
  type NonNihAdapterId,
} from "@/lib/ingestion/announcement/router";
import { CDMRP_HOST, CDMRP_MIN_INTERVAL_MS } from "@/lib/ingestion/announcement/adapters/cdmrp-pa";
import type { SimplerClientLike } from "@/lib/ingestion/announcement/adapters/grants-gov-attachment";
import { createSimplerGrantsClient } from "@/lib/ingestion/simpler-grants/client";
import type { NoticeSection } from "@/lib/fit/profile/opportunity-extract";
import { AsyncRateLimiter } from "@/lib/utils/async-rate-limiter";

/**
 * The nightly non-NIH announcement sync (PR 5.5a) — the generalised sync
 * NON_NIH_PLAN.md § PR 5.2 named and 5.2 did not build.
 *
 * PRs 5.3–5.5 shipped three adapters and one hand-run backfill script, so no
 * scheduled job ever called them: on 2026-09-09 all 518 open, posted non-NIH
 * notices still had `guide_fetch_status IS NULL`. This service is the job.
 *
 * **It may never touch an NIH notice.** `src/lib/services/nih-guide-sync.ts`
 * owns those and re-sectioning one here would change `guide_sections` and
 * re-key every cached extraction — NON_NIH_PLAN.md § The NIH invariant. The
 * guard is `isNihCorpusRow` (the `NIH_NOTICE_FILTER` mirror, not
 * `funderFamilyOf`), applied in `planAnnouncementFetch` before anything else,
 * and again as an assertion in the write loop.
 *
 * Writing text changes nobody's fit results. `loadCandidates` in
 * `fit/profile/opportunity.ts` still requires `NIH_NOTICE_FILTER`, so a
 * non-NIH notice with `guide_sections` is still not profiled and still not
 * scored. Opening that gate is PR 5.6, deliberately separate.
 *
 * Cadence (`isAnnouncementFetchDue`, pure and tested):
 *   - never fetched → fetch, newest posted first;
 *   - Simpler changed the row since the last fetch (`source_updated_at >
 *     guide_fetched_at`) → fetch, whatever the stored status;
 *   - `error` / `not_found` older than `retryAfterDays` (14) → retry;
 *   - `ok` older than `refreshAfterDays` (30) → refresh;
 *   - `not_applicable` → never on a cadence. No announcement exists on any
 *     route (NSF's `PD-` rows, DOJ's 31, NASA's 11); that is a structural fact,
 *     which is why `20260914100000_fit_guide_sections.sql` added the value.
 *     Only `source_updated` re-examines such a row.
 *
 * The retry cadence is 14 days, not the Guide sync's 7, because the dominant
 * failure here is a different kind of thing. Measured on the 2026-09-09 dry run
 * over 20 real rows: 11 ok, 2 not_applicable, 7 `error` — and every one of the
 * seven was the adapter's own "no section could be recovered" / "no objectives
 * block", not a transport failure. Those documents will fail again identically,
 * so a 7-day retry over ~180 such rows would spend ~26 GETs a night re-reading
 * them. They are still retried rather than stamped permanently: an adapter
 * improvement should pick them up on its own, and `orderDue` puts every
 * never-read notice ahead of every retry, so a backlog of them can never crowd
 * out a new notice.
 *
 * 30 days for the refresh, not the Guide sync's 7: these are ~745 KB PDFs on funder hosts with
 * no published rate policy, at ≥ 700 ms per host (1000 ms for CDMRP). A 7-day
 * refresh over 518 rows is ~74 rows a night, which would consume the whole time
 * budget re-reading documents that had not changed and never reach a new
 * notice. Both are parameters, not thresholds — nothing here scores anything,
 * so `taxonomy.json` is not involved.
 */

export type AnnouncementSyncParams = {
  /** Max notices to fetch this run. Each is at least one document GET. */
  limit?: number;
  /** Stop starting notices after this many ms (the run then reports what is left). */
  timeBudgetMs?: number;
  /** Re-read successful rows older than this. */
  refreshAfterDays?: number;
  /** Retry not_found / error rows older than this. */
  retryAfterDays?: number;
  /** Restrict to these funder families. `nih` is refused. */
  families?: FunderFamily[];
  /** Only these opportunity numbers (manual refresh). NIH-corpus numbers are still refused. */
  opportunityNumbers?: string[];
  /** Ignore the cadence and re-read every candidate the adapter applies to. */
  force?: boolean;
  /** Resolve, fetch and parse; write nothing, not even a sync_job_logs row. */
  dryRun?: boolean;
  /** Minimum gap between document GETs on one host. */
  minIntervalMs?: number;
  /** Minimum gap between Simpler API requests. */
  simplerMinIntervalMs?: number;
  /**
   * NSF only: follow the solicitation's program page for the award-search
   * element codes (one extra GET per NSF row). Defaults to **false** here for
   * the same reason `--write` implies `--no-program-page` in the backfill: the
   * hop lifts code recovery from 8 % to 95 %, but nothing persists the codes
   * yet, so on a writing run those ~69 GETs at a federal host are spent and
   * discarded. PR 5.7 is what gives them a column; flip this then.
   */
  programPage?: boolean;
  /** Injectable Simpler client (tests); undefined = the configured one, null = no attachment resolution. */
  simplerClient?: SimplerClientLike | null;
  /** Per-notice outcome, for a dry run's listing. */
  onNotice?: (outcome: NoticeOutcome) => void;
  /** Injected in tests, so the runner can be exercised with no network. */
  acquire?: typeof acquireAnnouncement;
  now?: Date;
};

export type NoticeOutcome = {
  id: string;
  number: string;
  family: FunderFamily;
  adapter: NonNihAdapterId;
  reason: AnnouncementFetchReason;
  status: "ok" | "unchanged" | "not_applicable" | "not_found" | "error";
  url: string | null;
  source: AnnouncementSource | null;
  sections: number;
  pageFetches: number;
  simplerCalls: number;
  error: string | null;
};

export type AnnouncementSyncResult = {
  ok: true;
  scanned: number;
  nihSkipped: number;
  due: number;
  attempted: number;
  updated: number;
  unchanged: number;
  notApplicable: number;
  notFound: number;
  errors: number;
  /** Due rows the limit or the time budget left for the next run. */
  remaining: number;
  outOfTime: boolean;
  byFamily: Record<string, number>;
  bySource: Record<string, number>;
  pageFetches: number;
  simplerCalls: number;
  dryRun: boolean;
  durationMs: number;
};

/** Every column the adapters, the planner and the write path read. */
export const ANNOUNCEMENT_SELECT =
  "id, opportunity_number, title, agency, agency_code, source_system, forecasted, posted_date, source_opportunity_id, source_updated_at, guide_url, guide_fetched_at, guide_fetch_status, announcement_kind, announcement_text_hash, raw_payload_json";

export type AnnouncementCandidateRow = AnnouncementRow & {
  posted_date?: string | null;
  source_updated_at?: string | null;
  guide_fetched_at?: string | null;
  guide_fetch_status?: string | null;
  announcement_kind?: string | null;
  announcement_text_hash?: string | null;
};

export type AnnouncementFetchReason = "force" | "never_fetched" | "source_updated" | "retry" | "refresh";

export type AnnouncementPlan =
  | { action: "fetch"; adapter: NonNihAdapterId; family: FunderFamily; reason: AnnouncementFetchReason }
  | { action: "skip"; reason: "nih_corpus" | "forecast" | "no_adapter" | "not_applicable" | "not_due" };

export type AnnouncementPlanOptions = {
  now?: Date;
  refreshAfterDays?: number;
  retryAfterDays?: number;
  force?: boolean;
  families?: FunderFamily[];
};

/** How soon a due row is worth reading, lowest first. A never-read notice beats a re-read of one we already have. */
const REASON_RANK: Record<AnnouncementFetchReason, number> = { force: 0, never_fetched: 0, source_updated: 1, retry: 2, refresh: 3 };

/**
 * The re-queue predicate. `updated_at` is deliberately absent: the
 * `set_updated_at` trigger stamps this sync's own write, so it can never mean
 * "the funder changed this". `source_updated_at` is Simpler's own timestamp.
 */
export function isAnnouncementFetchDue(row: AnnouncementCandidateRow, opts: AnnouncementPlanOptions = {}): AnnouncementFetchReason | null {
  if (opts.force) return "force";
  if (!row.guide_fetched_at) return "never_fetched";
  // Ahead of the not_applicable rule: a funder that adds an attachment to a
  // notice we found nothing for is precisely the case worth re-reading.
  if (row.source_updated_at && row.source_updated_at > row.guide_fetched_at) return "source_updated";
  if (row.guide_fetch_status === "not_applicable") return null;
  const now = (opts.now ?? new Date()).getTime();
  if (row.guide_fetch_status === "ok") {
    return row.guide_fetched_at < new Date(now - (opts.refreshAfterDays ?? 30) * 86_400_000).toISOString() ? "refresh" : null;
  }
  return row.guide_fetched_at < new Date(now - (opts.retryAfterDays ?? 14) * 86_400_000).toISOString() ? "retry" : null;
}

/** Decide what the sync does with one candidate row. Pure. */
export function planAnnouncementFetch(row: AnnouncementCandidateRow, opts: AnnouncementPlanOptions = {}): AnnouncementPlan {
  // First, before any other consideration: the NIH corpus is not ours.
  if (isNihCorpusRow(row)) return { action: "skip", reason: "nih_corpus" };
  if (row.forecasted === true) return { action: "skip", reason: "forecast" };
  const family = funderFamilyOf(row);
  if (opts.families?.length && !opts.families.includes(family)) return { action: "skip", reason: "no_adapter" };
  const adapter = adapterFor(row);
  if (!adapter) return { action: "skip", reason: "no_adapter" };
  const reason = isAnnouncementFetchDue(row, opts);
  if (!reason) return { action: "skip", reason: row.guide_fetch_status === "not_applicable" ? "not_applicable" : "not_due" };
  return { action: "fetch", adapter, family, reason };
}

/** Due rows in the order the run should read them: never-read first, newest posted first within a reason. */
export function orderDue<T extends { row: AnnouncementCandidateRow; reason: AnnouncementFetchReason }>(due: T[]): T[] {
  return [...due].sort((a, b) => {
    const rank = REASON_RANK[a.reason] - REASON_RANK[b.reason];
    if (rank !== 0) return rank;
    const ap = a.row.posted_date ?? "";
    const bp = b.row.posted_date ?? "";
    if (ap !== bp) return ap < bp ? 1 : -1;
    return String(a.row.id).localeCompare(String(b.row.id));
  });
}

/**
 * Postgres `jsonb` cannot store U+0000 — the write fails outright with
 * "unsupported Unicode escape sequence" — and an unpaired surrogate is rejected
 * the same way. PDF text extraction produces both: on the 2026-09-09 sweep,
 * `W911NF21S0009` (an Army Research Office BAA) was the one row of 518 whose
 * update was refused for it, and because a refused write leaves
 * `guide_fetched_at` NULL the row stayed `never_fetched` — rank 0 in
 * `orderDue`, so it would have been re-read and refused at the top of the queue
 * every single night.
 *
 * Sanitising here rather than in `announcement/text.ts` is deliberate: that
 * module is shared with the NIH Guide path, and changing what it emits could
 * move an NIH notice's `guide_sections` hash. This runs on the non-NIH write
 * path only, so the NIH invariant cannot be touched by it. `\n` and `\t` are
 * kept — `text` stores one line per paragraph.
 */
export function sanitizeSections(sections: readonly NoticeSection[]): NoticeSection[] {
  const clean = (v: string): string =>
    v
      .replace(/\u0000/g, "")
      // A high surrogate not followed by a low one, or a low one not preceded by a high one.
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
      .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
  return sections.map((s) => ({ ...s, heading: clean(s.heading), text: clean(s.text) }));
}

const PAGE = 1000;

/** Open today, posted, non-forecast. Paged, because PostgREST caps a select. */
async function loadCandidates(db: SupabaseClient, today: string, opportunityNumbers?: string[]): Promise<AnnouncementCandidateRow[]> {
  const out: AnnouncementCandidateRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = db.from("funding_opportunities").select(ANNOUNCEMENT_SELECT).order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (opportunityNumbers?.length) {
      query = query.in("opportunity_number", opportunityNumbers);
    } else {
      query = query.eq("forecasted", false).or(`close_date.gte.${today},next_due.gte.${today},expiration_date.gte.${today}`);
    }
    const { data, error } = await query;
    if (error) throw new Error(`funding_opportunities read failed: ${error.message}`);
    const rows = (data ?? []) as unknown as AnnouncementCandidateRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Whether the PR 5.2 migration is on the database. Writes refuse until it is. */
async function migrationApplied(db: SupabaseClient): Promise<boolean> {
  for (const c of ["announcement_kind", "announcement_text_hash", "guide_sections", "guide_source"]) {
    const { error } = await db.from("funding_opportunities").select(c).limit(1);
    if (error) return false;
  }
  return true;
}

async function logStart(db: SupabaseClient, details: Record<string, unknown>): Promise<string | null> {
  const { data } = await db.from("sync_job_logs").insert({ job_type: "announcements", status: "started", details }).select("id").single();
  return (data as { id?: string } | null)?.id ?? null;
}

async function logFinish(db: SupabaseClient, id: string | null, status: "success" | "error", message: string, details: Record<string, unknown>): Promise<void> {
  if (!id) return;
  await db.from("sync_job_logs").update({ status, message, details, finished_at: new Date().toISOString() }).eq("id", id);
}

export async function syncAnnouncements(db: SupabaseClient, params: AnnouncementSyncParams = {}): Promise<AnnouncementSyncResult | { ok: false; error: string }> {
  const started = Date.now();
  const now = params.now ?? new Date();
  const limit = params.limit ?? 40;
  const timeBudgetMs = params.timeBudgetMs ?? 240_000;
  const dryRun = params.dryRun === true;
  const deadline = started + timeBudgetMs;

  if (params.families?.includes("nih")) {
    return { ok: false, error: "families: 'nih' is refused — NIH notices are owned by syncNihGuide (NON_NIH_PLAN.md § The NIH invariant)" };
  }
  if (!dryRun && !(await migrationApplied(db))) {
    return { ok: false, error: "supabase/migrations/20260923100000_fit_announcement_sources.sql is not applied (column probe failed); dryRun works without it" };
  }

  const planOpts: AnnouncementPlanOptions = {
    now,
    refreshAfterDays: params.refreshAfterDays,
    retryAfterDays: params.retryAfterDays,
    force: params.force,
    families: params.families,
  };

  const scannedRows = await loadCandidates(db, now.toISOString().slice(0, 10), params.opportunityNumbers);
  const nihSkipped = scannedRows.filter(isNihCorpusRow).length;
  const due = orderDue(
    scannedRows.flatMap((row) => {
      const plan = planAnnouncementFetch(row, planOpts);
      return plan.action === "fetch" ? [{ row, adapter: plan.adapter, family: plan.family, reason: plan.reason }] : [];
    }),
  );

  const logId = dryRun
    ? null
    : await logStart(db, { limit, timeBudgetMs, families: params.families ?? null, opportunityNumbers: params.opportunityNumbers ?? null, force: Boolean(params.force), scanned: scannedRows.length, due: due.length });

  const pageIntervalMs = params.minIntervalMs ?? 700;
  const limiters = new Map<string, AsyncRateLimiter>();
  const limiterFor = (host: string): AsyncRateLimiter => {
    const key = host || "(unknown)";
    let limiter = limiters.get(key);
    if (!limiter) {
      // cdmrp.health.mil gets its own, slower floor (PR 5.5): a Defense Health
      // Agency host serving ~745 KB PDFs, with no published rate policy.
      limiter = new AsyncRateLimiter(key === CDMRP_HOST ? Math.max(pageIntervalMs, CDMRP_MIN_INTERVAL_MS) : pageIntervalMs);
      limiters.set(key, limiter);
    }
    return limiter;
  };
  const deps: AnnouncementDeps = {
    limiterFor,
    simplerLimiter: new AsyncRateLimiter(Math.max(550, params.simplerMinIntervalMs ?? 550)),
    simpler: params.simplerClient === undefined ? createSimplerGrantsClient() : params.simplerClient,
    programPage: params.programPage ?? false,
  };
  const acquire = params.acquire ?? acquireAnnouncement;

  const result: AnnouncementSyncResult = {
    ok: true,
    scanned: scannedRows.length,
    nihSkipped,
    due: due.length,
    attempted: 0,
    updated: 0,
    unchanged: 0,
    notApplicable: 0,
    notFound: 0,
    errors: 0,
    remaining: due.length,
    outOfTime: false,
    byFamily: {},
    bySource: {},
    pageFetches: 0,
    simplerCalls: 0,
    dryRun,
    durationMs: 0,
  };

  try {
    for (const { row, adapter, family, reason } of due.slice(0, limit)) {
      if (Date.now() >= deadline) {
        result.outOfTime = true;
        break;
      }
      // The guard again, on the row about to be written. planAnnouncementFetch
      // already refused NIH rows; this is the assertion that a future change to
      // the planner, the ordering or the slicing cannot quietly get past.
      if (isNihCorpusRow(row)) continue;

      const acq = await acquire(adapter, row, deps);
      result.attempted += 1;
      result.remaining -= 1;
      result.pageFetches += acq.pageFetches;
      result.simplerCalls += acq.simplerCalls;
      result.byFamily[family] = (result.byFamily[family] ?? 0) + 1;
      if (acq.source) result.bySource[acq.source] = (result.bySource[acq.source] ?? 0) + 1;

      params.onNotice?.({
        id: row.id,
        number: row.opportunity_number ?? "(none)",
        family,
        adapter,
        reason,
        status: acq.status,
        url: acq.url,
        source: acq.source,
        sections: acq.status === "ok" ? acq.sections.length : 0,
        pageFetches: acq.pageFetches,
        simplerCalls: acq.simplerCalls,
        error: acq.status === "ok" || acq.status === "unchanged" ? null : acq.error,
      });

      if (acq.status === "ok") result.updated += 1;
      else if (acq.status === "unchanged") result.unchanged += 1;
      else if (acq.status === "not_applicable") result.notApplicable += 1;
      else if (acq.status === "not_found") result.notFound += 1;
      else result.errors += 1;

      if (dryRun) continue;

      const stampedAt = new Date().toISOString();
      const update: Record<string, unknown> =
        acq.status === "ok"
          ? {
              guide_sections: sanitizeSections(acq.sections),
              guide_source: acq.source,
              guide_url: acq.url,
              guide_fetched_at: stampedAt,
              guide_fetch_status: "ok",
              announcement_kind: adapter,
              announcement_text_hash: acq.textHash,
            }
          : acq.status === "unchanged"
            ? // The document is byte-identical to the stored one, so the sections
              // stay untouched and only the cadence moves — without this stamp the
              // row would be re-read every night once past the refresh window.
              { guide_fetched_at: stampedAt, guide_fetch_status: "ok", announcement_kind: adapter, announcement_text_hash: acq.textHash }
            : // A failed row is stamped with the status the adapter actually
              // reached, never collapsed to `error`, and `guide_sections` is left
              // alone so the profile builder can still fall through to the
              // synopsis. `guide_url` is only written when a route was reached —
              // nulling it would clear whatever the row already had.
              { guide_fetch_status: acq.status, guide_fetched_at: stampedAt, ...(acq.url ? { guide_url: acq.url } : {}) };

      const { error } = await db.from("funding_opportunities").update(update).eq("id", row.id);
      if (error) {
        result.errors += 1;
        console.error(`[announcements] write failed for ${row.opportunity_number}: ${error.message}`);
        // Stamp the status columns alone — no JSONB, so whatever the payload
        // could not store cannot refuse this one too. Without it the row keeps
        // a NULL guide_fetched_at, stays `never_fetched`, and `orderDue` puts
        // it back at the head of the queue every night.
        const { error: stampError } = await db
          .from("funding_opportunities")
          .update({ guide_fetch_status: "error", guide_fetched_at: stampedAt })
          .eq("id", row.id);
        if (stampError) console.error(`[announcements] status stamp also failed for ${row.opportunity_number}: ${stampError.message}`);
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    result.durationMs = Date.now() - started;
    await logFinish(db, logId, "error", `announcements error: ${message}`, { ...result, error: message }).catch(() => undefined);
    return { ok: false, error: message };
  }

  result.durationMs = Date.now() - started;
  const message =
    `announcements${dryRun ? " (dry run)" : ""}: ${result.attempted} of ${result.due} due attempted — ` +
    `${result.updated} updated, ${result.unchanged} unchanged, ${result.notApplicable} not_applicable, ${result.notFound} not_found, ${result.errors} errors; ` +
    `${result.remaining} left${result.outOfTime ? " (out of time)" : ""}; ${result.pageFetches} GETs, ${result.simplerCalls} Simpler calls; ${result.durationMs} ms`;
  await logFinish(db, logId, "success", message, result);
  return result;
}
