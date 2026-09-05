import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchNihGuideHtml,
  guideAttachmentUrl,
  guideSourceForUrl,
  guideUrlFor,
  isSimplerFilesUrl,
  type GuideFetch,
  type GuideSource,
} from "@/lib/ingestion/nih-guide/client";
import {
  guideHtmlHash,
  isPlainGuideLayout,
  parseClinicalTrialDesignation,
  parseGuideSections,
  parseNihGuide,
  parseProgramDivision,
  type ClinicalTrialDesignation,
} from "@/lib/ingestion/nih-guide/parse";
import { createSimplerGrantsClient } from "@/lib/ingestion/simpler-grants/client";
import type { SimplerAttachment, SimplerOpportunityHit } from "@/lib/ingestion/simpler-grants/types";
import { computeNextDue, isoToday } from "@/lib/funding-opportunities/receipt-cycles";
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

export type SimplerClientLike = { getOpportunity(id: string): Promise<SimplerOpportunityHit> };

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

function additionalInfoUrl(row: GuideCandidateRow): string | null {
  const summary = row.raw_payload_json?.summary;
  if (!summary || typeof summary !== "object") return null;
  const v = summary.additional_info_url;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** The URL the sync will read: a stored Simpler attachment URL first, else the classic Guide path. */
export function preferredGuideUrl(row: GuideCandidateRow): string | null {
  if (isSimplerFilesUrl(row.guide_url)) return row.guide_url;
  const number = row.opportunity_number?.trim();
  return number ? guideUrlFor(number, additionalInfoUrl(row)) : null;
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

type Resolved = { attachments: SimplerAttachment[] | null; url: string | null; error: string | null };

/** One Simpler GET: the detail record's attachments and the announcement URL among them. */
async function resolveAttachment(client: SimplerClientLike, limiter: AsyncRateLimiter, sourceOpportunityId: string, number: string): Promise<Resolved> {
  try {
    const detail = await limiter.schedule(() => client.getOpportunity(sourceOpportunityId));
    const attachments = Array.isArray(detail.attachments) ? detail.attachments : [];
    return { attachments, url: guideAttachmentUrl(attachments, number), error: null };
  } catch (e) {
    return { attachments: null, url: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function syncNihGuide(supabase: SupabaseClient, params: NihGuideSyncParams = {}): Promise<NihGuideSyncResult | { ok: false; error: string }> {
  const started = Date.now();
  const limit = params.limit ?? 400;
  const dryRun = params.dryRun === true;
  const planOpts: GuidePlanOptions = { now: new Date(), refreshAfterDays: params.refreshAfterDays, retryAfterDays: params.retryAfterDays, force: params.force };
  const pageLimiter = new AsyncRateLimiter(params.minIntervalMs ?? 700);
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
    let url = plan.url;
    let source = plan.source;
    let attachment: NoticeOutcome["attachment"] = source === "simpler_attachment" ? "stored" : "n/a";
    let pageFetches = 0;
    let simplerCalls = 0;
    let mergedRaw: Record<string, unknown> | null = null;
    let resolveError: string | null = null;

    const get = async (target: string): Promise<GuideFetch> => {
      pageFetches += 1;
      return pageLimiter.schedule(() => fetchNihGuideHtml(target));
    };

    let result = await get(url);

    // The classic page exists but is the plain text template (no Key Dates rows, no headings): the styled
    // announcement Simpler holds is strictly better. Use it when the row already stores the attachment list
    // (no API call), else resolve it below like a 404.
    const plainClassic = result.status === "ok" && source === "grants_nih_gov" && isPlainGuideLayout(result.html);
    if (plainClassic) {
      const stored = guideAttachmentUrl((row.raw_payload_json as { attachments?: SimplerAttachment[] } | null)?.attachments, number);
      if (stored) {
        const better = await get(stored);
        if (better.status === "ok") {
          result = better;
          url = stored;
          source = "simpler_attachment";
          attachment = "stored";
        }
      }
    }

    // Fix B: a 404 on the classic path (or on a stale stored attachment URL) → resolve the Simpler attachment, once.
    const needsResolve = result.status === "not_found" || (plainClassic && source === "grants_nih_gov");
    if (needsResolve && simpler && row.source_opportunity_id) {
      const before = result;
      simplerCalls += 1;
      attachmentResolves += 1;
      const resolved = await resolveAttachment(simpler, simplerLimiter, row.source_opportunity_id, number);
      if (resolved.attachments) mergedRaw = { ...(row.raw_payload_json as Record<string, unknown> | null), attachments: resolved.attachments };
      if (resolved.error) {
        attachment = "error";
        resolveError = resolved.error;
      } else if (resolved.url && resolved.url !== url) {
        const better = await get(resolved.url);
        if (better.status === "ok" || before.status !== "ok") {
          result = better;
          url = resolved.url;
          source = "simpler_attachment";
        }
        attachment = better.status === "ok" ? "hit" : "miss";
      } else {
        attachment = "miss";
      }
      if (attachment === "hit") attachmentHits += 1;
      // A stored attachment URL that is gone and not re-resolvable: try the classic path once before giving up.
      if (result.status === "not_found" && plan.source === "simpler_attachment") {
        const classic = guideUrlFor(number, additionalInfoUrl(row));
        if (classic && classic !== url) {
          result = await get(classic);
          // Whatever the answer, the dead attachment URL is not worth keeping: the next run starts from the classic path.
          url = classic;
          source = "grants_nih_gov";
        }
      }
    }
    fetched += 1;

    const base: NoticeOutcome = {
      id: row.id, number, status: "error", reason: plan.reason, url, source: null, attachment, pageFetches, simplerCalls,
      cycles: 0, reissueOf: null, sections: 0, sectionKeys: [], designation: null, division: null, hash: null, error: resolveError,
    };

    if (result.status !== "ok") {
      if (result.status === "not_found") notFound += 1;
      else errors += 1;
      params.onNotice?.({ ...base, status: result.status, error: result.status === "error" ? result.error : resolveError });
      if (dryRun) continue;
      await supabase
        .from("funding_opportunities")
        .update({ guide_url: url, guide_fetched_at: now(), guide_fetch_status: result.status, guide_source: null, ...(mergedRaw ? { raw_payload_json: mergedRaw } : {}) })
        .eq("id", row.id);
      continue;
    }

    bySource[source] += 1;
    const hash = guideHtmlHash(result.html);
    if (!params.force && hash === row.guide_html_hash) {
      unchanged += 1;
      params.onNotice?.({ ...base, status: "unchanged", source, hash });
      if (dryRun) continue;
      const { error: touchErr } = await supabase
        .from("funding_opportunities")
        .update({ guide_url: url, guide_source: source, guide_fetched_at: now(), guide_fetch_status: "ok", ...(mergedRaw ? { raw_payload_json: mergedRaw } : {}) })
        .eq("id", row.id);
      if (touchErr) errors += 1;
      continue;
    }

    const parsed = parseNihGuide(result.html);
    const sections = parseGuideSections(result.html);
    const designation = parseClinicalTrialDesignation(parsed.title ?? row.title, result.html);
    const division = parseProgramDivision(sections.filter((s) => s.section === "VII").map((s) => `${s.heading}\n${s.text}`).join("\n"));
    const nextDue = computeNextDue({ cycles: parsed.cycles, closeDate: row.close_date, expirationDate: parsed.expirationDate }, today);
    params.onNotice?.({
      ...base, status: "ok", source, cycles: parsed.cycles.length, reissueOf: parsed.reissueOf, sections: sections.length,
      sectionKeys: [...new Set(sections.map((s) => s.section))], designation, division, hash,
    });
    if (dryRun) continue;
    const { error: updErr } = await supabase
      .from("funding_opportunities")
      .update({
        receipt_cycles: parsed.cycles,
        cycles_source: parsed.cycles.length > 0 ? "nih_guide" : "simpler",
        standard_dates_apply: parsed.standardDatesApply,
        next_due: nextDue,
        open_date: parsed.openDate,
        loi_due: parsed.loiDue,
        loi_note: parsed.loiNote,
        expiration_date: parsed.expirationDate,
        earliest_start: parsed.earliestStart,
        activity_code: parsed.activityCode,
        activity_title: parsed.activityTitle,
        reissue_of: parsed.reissueOf,
        companion_of: parsed.companionOf,
        related_notices: parsed.relatedNotices,
        clinical_trial_note: parsed.clinicalTrialNote,
        clinical_trial_designation: designation,
        program_division: division,
        guide_sections: sections,
        guide_html_hash: hash,
        guide_url: url,
        guide_source: source,
        guide_fetched_at: now(),
        guide_fetch_status: "ok",
        guide_last_change: parsed.lastChangeNote,
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
