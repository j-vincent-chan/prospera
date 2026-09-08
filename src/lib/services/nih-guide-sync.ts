import type { SupabaseClient } from "@supabase/supabase-js";
import { guideSourceForUrl, type GuideSource } from "@/lib/ingestion/nih-guide/client";
import {
  acquireNihGuide,
  nihGuideColumns,
  NIH_GUIDE_ADAPTER_ID,
  preferredGuideUrl as adapterPreferredGuideUrl,
  type NihGuideRow,
  type SimplerClientLike,
} from "@/lib/ingestion/announcement/adapters/nih-guide";
import type { ClinicalTrialDesignation } from "@/lib/ingestion/nih-guide/parse";
import { createSimplerGrantsClient } from "@/lib/ingestion/simpler-grants/client";
import { isoToday } from "@/lib/funding-opportunities/receipt-cycles";
import { AsyncRateLimiter } from "@/lib/utils/async-rate-limiter";

/**
 * Nightly enrichment: for NIH notices, fetch the Guide page and store receipt
 * cycles, Key Dates and — since PR 0.5 — the sectioned full text, the
 * clinical-trial designation and the scientific contact's division. Runs after
 * the Simpler sync.
 *
 * Which rows are fetched (`planGuideFetch`, pure and tested):
 *   - forecasts, `-000` placeholders and numbers that are not Guide numbers
 *     are stamped `not_applicable` once and never fetched (Fix A);
 *   - a row is due when it was never fetched, when Simpler changed it after the
 *     last fetch (`source_updated_at > guide_fetched_at` — the trigger-maintained
 *     `updated_at` is never consulted, see GUIDE_DIAGNOSTICS.md), when it was
 *     `not_applicable` and is now fetchable (a forecast that posted), or on the
 *     7-day refresh / retry cadence.
 *
 * Where a page is read from (Fix B): a stored files.simpler.grants.gov URL is
 * preferred; otherwise the classic grants.nih.gov path. A 404 on either sends
 * one GET to the Simpler API (`getOpportunity`) to resolve the
 * `<number>-Full-Announcement.html` attachment, which is then fetched with the
 * same parser. `guide_html_hash` skips the re-parse of an unchanged page.
 */

export type NihGuideSyncParams = {
  /** Max notices to fetch this run (each is at least one HTTP request). */
  limit?: number;
  /** Re-fetch successful rows older than this. */
  refreshAfterDays?: number;
  /** Retry not_found / error rows older than this. */
  retryAfterDays?: number;
  /** Minimum gap between page requests (grants.nih.gov and files.simpler.grants.gov share one limiter). */
  minIntervalMs?: number;
  /** Minimum gap between Simpler API requests. */
  simplerMinIntervalMs?: number;
  /** Only these opportunity numbers (manual refresh). */
  opportunityNumbers?: string[];
  force?: boolean;
  /** Restrict candidates to these stored statuses; "never" = guide_fetch_status IS NULL. */
  statusIn?: Array<"ok" | "not_found" | "error" | "not_applicable" | "never">;
  /** Only notices open today (close_date, next_due or expiration_date on/after today). */
  openOnly?: boolean;
  /** Fetch, resolve and parse, but write nothing — not even a sync_job_logs row. */
  dryRun?: boolean;
  /** Per-notice outcome (the backfill's dry-run listing). */
  onNotice?: (outcome: NoticeOutcome) => void;
  /** Injectable Simpler client (tests); undefined = the configured client, null = no attachment resolution. */
  simplerClient?: SimplerClientLike | null;
  /**
   * false = select only the pre-PR 0.5 columns (guide_html_hash and source_updated_at read as null) so a dry run
   * can be taken before supabase/migrations/20260914100000_fit_guide_sections.sql is applied. Never for writes.
   */
  extendedColumns?: boolean;
};

export type { SimplerClientLike };

export type NoticeOutcome = {
  id: string;
  number: string;
  status: "ok" | "unchanged" | "not_found" | "error" | "not_applicable";
  reason: string | null;
  url: string | null;
  source: GuideSource | null;
  /** hit = attachment resolved and read; miss = Simpler lists none; stored = a stored Simpler URL worked without a resolve; n/a = classic page read. */
  attachment: "hit" | "miss" | "stored" | "error" | "n/a";
  pageFetches: number;
  simplerCalls: number;
  cycles: number;
  reissueOf: string | null;
  sections: number;
  sectionKeys: string[];
  designation: ClinicalTrialDesignation | null;
  division: string | null;
  hash: string | null;
  error: string | null;
};

export type NihGuideSyncResult = {
  ok: true;
  scanned: number;
  due: number;
  fetched: number;
  updated: number;
  unchanged: number;
  notFound: number;
  notApplicable: number;
  errors: number;
  skippedUnknownUrl: number;
  /** Simpler API GETs made to resolve attachments, and how many yielded a readable announcement. */
  attachmentResolves: number;
  attachmentHits: number;
  bySource: Record<GuideSource, number>;
  dryRun: boolean;
  durationMs: number;
};

export type GuideCandidateRow = {
  opportunity_number: string | null;
  forecasted: boolean | null;
  guide_fetched_at: string | null;
  guide_fetch_status: string | null;
  source_updated_at: string | null;
  guide_url: string | null;
  raw_payload_json: { summary?: { additional_info_url?: string | null } | string | null; attachments?: unknown } | null;
};

type Row = GuideCandidateRow & {
  id: string;
  title: string | null;
  close_date: string | null;
  agency_code: string | null;
  source_opportunity_id: string | null;
  guide_html_hash: string | null;
};

const BASE_SELECT = "id, opportunity_number, title, close_date, forecasted, agency_code, source_opportunity_id, guide_url, guide_fetched_at, guide_fetch_status, raw_payload_json";
const SELECT = `${BASE_SELECT}, guide_html_hash, source_updated_at`;

export type FetchReason = "force" | "never_fetched" | "was_not_applicable" | "source_updated" | "refresh" | "retry";

export type GuidePlan =
  | { action: "fetch"; url: string; source: GuideSource; reason: FetchReason }
  | { action: "not_applicable"; reason: "forecast" | "no_number" | "not_guide_number"; stamp: boolean }
  | { action: "skip"; reason: "not_due" };

export type GuidePlanOptions = { now?: Date; refreshAfterDays?: number; retryAfterDays?: number; force?: boolean };

/** The URL the sync will read: a stored Simpler attachment URL first, else the classic Guide path. Owned by the adapter (PR 5.2); re-exported because the tests and the backfill import it from here. */
export function preferredGuideUrl(row: GuideCandidateRow): string | null {
  return adapterPreferredGuideUrl(row as unknown as NihGuideRow);
}

/**
 * The re-queue predicate. `updated_at` is deliberately absent: the
 * set_updated_at trigger stamps the Guide sync's own write, so it can never
 * mean "Simpler changed this". `source_updated_at` is Simpler's own timestamp.
 */
export function isGuideFetchDue(row: GuideCandidateRow, opts: GuidePlanOptions = {}): FetchReason | null {
  if (opts.force) return "force";
  if (!row.guide_fetched_at) return "never_fetched";
  if (row.guide_fetch_status === "not_applicable") return "was_not_applicable";
  if (row.source_updated_at && row.source_updated_at > row.guide_fetched_at) return "source_updated";
  const now = (opts.now ?? new Date()).getTime();
  const refreshAfter = new Date(now - (opts.refreshAfterDays ?? 7) * 86_400_000).toISOString();
  const retryAfter = new Date(now - (opts.retryAfterDays ?? 7) * 86_400_000).toISOString();
  if (row.guide_fetch_status === "ok") return row.guide_fetched_at < refreshAfter ? "refresh" : null;
  return row.guide_fetched_at < retryAfter ? "retry" : null;
}

/** Decide what the sync does with one candidate row. Pure. */
export function planGuideFetch(row: GuideCandidateRow, opts: GuidePlanOptions = {}): GuidePlan {
  const number = row.opportunity_number?.trim() ?? "";
  const stamp = row.guide_fetch_status !== "not_applicable";
  if (row.forecasted) return { action: "not_applicable", reason: "forecast", stamp };
  if (!number) return { action: "not_applicable", reason: "no_number", stamp };
  const url = preferredGuideUrl(row);
  if (!url) return { action: "not_applicable", reason: "not_guide_number", stamp };
  const reason = isGuideFetchDue(row, opts);
  if (!reason) return { action: "skip", reason: "not_due" };
  return { action: "fetch", url, source: guideSourceForUrl(url), reason };
}

async function logStart(supabase: SupabaseClient, details: Record<string, unknown>): Promise<string | null> {
  const { data } = await supabase
    .from("sync_job_logs")
    .insert({ job_type: "nih_guide", status: "started", details })
    .select("id")
    .single();
  return (data as { id?: string } | null)?.id ?? null;
}

async function logFinish(supabase: SupabaseClient, id: string | null, status: "success" | "error", message: string, details: Record<string, unknown>) {
  if (!id) return;
  await supabase.from("sync_job_logs").update({ status, message, details, finished_at: new Date().toISOString() }).eq("id", id);
}

export async function syncNihGuide(supabase: SupabaseClient, params: NihGuideSyncParams = {}): Promise<NihGuideSyncResult | { ok: false; error: string }> {
  const started = Date.now();
  const limit = params.limit ?? 400;
  const dryRun = params.dryRun === true;
  const planOpts: GuidePlanOptions = { now: new Date(), refreshAfterDays: params.refreshAfterDays, retryAfterDays: params.retryAfterDays, force: params.force };
  // PR 5.2: one limiter per host. grants.nih.gov and files.simpler.grants.gov
  // used to share the 700 ms one, which paced two unrelated services against
  // each other; a generalised sync reading several funders cannot do that.
  const pageIntervalMs = params.minIntervalMs ?? 700;
  const pageLimiters = new Map<string, AsyncRateLimiter>();
  const limiterFor = (host: string): AsyncRateLimiter => {
    const key = host || "(unknown)";
    let limiter = pageLimiters.get(key);
    if (!limiter) {
      limiter = new AsyncRateLimiter(pageIntervalMs);
      pageLimiters.set(key, limiter);
    }
    return limiter;
  };
  const simplerLimiter = new AsyncRateLimiter(params.simplerMinIntervalMs ?? 550);
  const simpler: SimplerClientLike | null = params.simplerClient === undefined ? createSimplerGrantsClient() : params.simplerClient;
  if (params.extendedColumns === false && !dryRun) return { ok: false, error: "extendedColumns: false is only valid with dryRun: true" };
  const logId = dryRun ? null : await logStart(supabase, { limit, opportunityNumbers: params.opportunityNumbers ?? null, statusIn: params.statusIn ?? null, openOnly: params.openOnly ?? false });

  // Candidates: NIH notices by agency code or number pattern.
  let query = supabase
    .from("funding_opportunities")
    .select(params.extendedColumns === false ? BASE_SELECT : SELECT)
    .or("agency_code.like.HHS-NIH%,opportunity_number.like.PA-%,opportunity_number.like.PAR-%,opportunity_number.like.PAS-__-___,opportunity_number.like.RFA-%")
    .order("posted_date", { ascending: false, nullsFirst: false })
    .limit(params.opportunityNumbers?.length ? 1000 : 5000);
  if (params.opportunityNumbers?.length) query = query.in("opportunity_number", params.opportunityNumbers);
  if (params.statusIn?.length) {
    const named = params.statusIn.filter((s) => s !== "never");
    if (params.statusIn.includes("never")) {
      query = query.or(named.length ? `guide_fetch_status.is.null,guide_fetch_status.in.(${named.join(",")})` : "guide_fetch_status.is.null");
    } else {
      query = query.in("guide_fetch_status", named);
    }
  }
  const today = isoToday();
  if (params.openOnly) query = query.or(`close_date.gte.${today},next_due.gte.${today},expiration_date.gte.${today}`);

  const { data, error } = await query;
  if (error) {
    await logFinish(supabase, logId, "error", error.message, {});
    return { ok: false, error: error.message };
  }

  const rows = ((data ?? []) as unknown as Row[]).map((r) => ({ ...r, guide_html_hash: r.guide_html_hash ?? null, source_updated_at: r.source_updated_at ?? null }));
  const plans = rows.map((row) => ({ row, plan: planGuideFetch(row, planOpts) }));
  const due = plans.filter((p): p is { row: Row; plan: Extract<GuidePlan, { action: "fetch" }> } => p.plan.action === "fetch");
  const toStamp = plans.filter((p): p is { row: Row; plan: Extract<GuidePlan, { action: "not_applicable" }> } => p.plan.action === "not_applicable" && p.plan.stamp);

  let fetched = 0;
  let updated = 0;
  let unchanged = 0;
  let notFound = 0;
  let notApplicable = 0;
  let errors = 0;
  let skippedUnknownUrl = 0;
  let attachmentResolves = 0;
  let attachmentHits = 0;
  const bySource: Record<GuideSource, number> = { grants_nih_gov: 0, simpler_attachment: 0 };
  const now = () => new Date().toISOString();

  // Fix A: stamp rows that cannot have a Guide page, once (bounded; not counted against `limit`).
  for (const { row, plan } of toStamp.slice(0, 1000)) {
    notApplicable += 1;
    skippedUnknownUrl += plan.reason === "forecast" ? 0 : 1;
    params.onNotice?.({
      id: row.id, number: row.opportunity_number ?? "", status: "not_applicable", reason: plan.reason, url: null, source: null, attachment: "n/a",
      pageFetches: 0, simplerCalls: 0, cycles: 0, reissueOf: null, sections: 0, sectionKeys: [], designation: null, division: null, hash: null, error: null,
    });
    if (dryRun) continue;
    const { error: stampErr } = await supabase
      .from("funding_opportunities")
      .update({ guide_fetch_status: "not_applicable", guide_fetched_at: now(), guide_url: null, guide_source: null })
      .eq("id", row.id);
    if (stampErr) errors += 1;
  }

  for (const { row, plan } of due.slice(0, limit)) {
    const number = row.opportunity_number!.trim();
    const acq = await acquireNihGuide(row, plan.url, { limiterFor, simplerLimiter, simpler, force: params.force === true, today });
    fetched += 1;
    const mergedRaw = acq.mergedRaw;

    const base: NoticeOutcome = {
      id: row.id, number, status: "error", reason: plan.reason, url: acq.url, source: null, attachment: acq.attachment,
      pageFetches: acq.pageFetches, simplerCalls: acq.simplerCalls, cycles: 0, reissueOf: null, sections: 0, sectionKeys: [],
      designation: null, division: null, hash: null, error: acq.error,
    };
    attachmentResolves += acq.simplerCalls;
    if (acq.attachment === "hit") attachmentHits += 1;

    if (acq.status === "not_found" || acq.status === "error") {
      if (acq.status === "not_found") notFound += 1;
      else errors += 1;
      params.onNotice?.({ ...base, status: acq.status, error: acq.error });
      if (dryRun) continue;
      await supabase
        .from("funding_opportunities")
        .update({ guide_url: acq.url, guide_fetched_at: now(), guide_fetch_status: acq.status, guide_source: null, ...(mergedRaw ? { raw_payload_json: mergedRaw } : {}) })
        .eq("id", row.id);
      continue;
    }

    const source = acq.source as GuideSource;
    bySource[source] += 1;

    if (acq.status === "unchanged") {
      unchanged += 1;
      params.onNotice?.({ ...base, status: "unchanged", source, hash: acq.htmlHash });
      if (dryRun) continue;
      const { error: touchErr } = await supabase
        .from("funding_opportunities")
        .update({ guide_url: acq.url, guide_source: source, guide_fetched_at: now(), guide_fetch_status: "ok", announcement_kind: NIH_GUIDE_ADAPTER_ID, ...(mergedRaw ? { raw_payload_json: mergedRaw } : {}) })
        .eq("id", row.id);
      if (touchErr) errors += 1;
      continue;
    }

    const built = nihGuideColumns(row, acq as typeof acq & { html: string }, today);
    params.onNotice?.({
      ...base, status: "ok", source, cycles: built.parsed.cycles.length, reissueOf: built.parsed.reissueOf,
      sections: built.sections.length, sectionKeys: [...new Set(built.sections.map((x) => x.section))],
      designation: built.designation, division: built.division, hash: acq.htmlHash,
    });
    if (dryRun) continue;
    const { error: updErr } = await supabase
      .from("funding_opportunities")
      .update({
        ...built.columns,
        guide_url: acq.url,
        guide_source: source,
        guide_fetched_at: now(),
        guide_fetch_status: "ok",
        announcement_kind: NIH_GUIDE_ADAPTER_ID,
        announcement_text_hash: built.textHash,
        ...(mergedRaw ? { raw_payload_json: mergedRaw } : {}),
      })
      .eq("id", row.id);
    if (updErr) errors += 1;
    else updated += 1;
  }

  // Everything still on Simpler dates follows close_date.
  if (!dryRun) await supabase.rpc("refresh_simpler_next_due");

  const summary = {
    scanned: rows.length, due: due.length, fetched, updated, unchanged, notFound, notApplicable, errors, skippedUnknownUrl,
    attachmentResolves, attachmentHits, bySource, dryRun, durationMs: Date.now() - started,
  };
  await logFinish(
    supabase,
    logId,
    errors > 0 && updated === 0 && unchanged === 0 ? "error" : "success",
    `Fetched ${fetched} Guide pages · ${updated} updated · ${unchanged} unchanged · ${notFound} not on the Guide · ${notApplicable} not applicable`,
    summary,
  );
  return { ok: true, ...summary };
}
