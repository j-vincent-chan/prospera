import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchNihGuideHtml, guideUrlFor } from "@/lib/ingestion/nih-guide/client";
import { parseNihGuide } from "@/lib/ingestion/nih-guide/parse";
import { computeNextDue, isoToday } from "@/lib/funding-opportunities/receipt-cycles";
import { AsyncRateLimiter } from "@/lib/utils/async-rate-limiter";

/**
 * Nightly enrichment: for NIH notices, fetch the Guide page and store receipt
 * cycles + Key Dates. Runs after the Simpler sync. Rows are re-fetched when
 * Simpler updated them, when the last fetch is older than `refreshAfterDays`,
 * or when a previous attempt failed (not_found is retried weekly — new notices
 * can take a while to appear on the Guide).
 */

export type NihGuideSyncParams = {
  /** Max notices to fetch this run (each is one HTTP request). */
  limit?: number;
  /** Re-fetch successful rows older than this. */
  refreshAfterDays?: number;
  /** Retry not_found / error rows older than this. */
  retryAfterDays?: number;
  /** Minimum gap between requests to grants.nih.gov. */
  minIntervalMs?: number;
  /** Only these opportunity numbers (manual refresh). */
  opportunityNumbers?: string[];
  force?: boolean;
};

export type NihGuideSyncResult = {
  ok: true;
  scanned: number;
  fetched: number;
  updated: number;
  notFound: number;
  errors: number;
  skippedUnknownUrl: number;
  durationMs: number;
};

type Row = {
  id: string;
  opportunity_number: string | null;
  close_date: string | null;
  updated_at: string | null;
  guide_fetched_at: string | null;
  guide_fetch_status: string | null;
  raw_payload_json: { summary?: { additional_info_url?: string | null } } | null;
};

const SELECT = "id, opportunity_number, close_date, updated_at, guide_fetched_at, guide_fetch_status, raw_payload_json";

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
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
  const refreshAfter = daysAgoIso(params.refreshAfterDays ?? 7);
  const retryAfter = daysAgoIso(params.retryAfterDays ?? 7);
  const limiter = new AsyncRateLimiter(params.minIntervalMs ?? 700);
  const logId = await logStart(supabase, { limit, opportunityNumbers: params.opportunityNumbers ?? null });

  // Candidates: NIH notices by agency code or number pattern.
  let query = supabase
    .from("funding_opportunities")
    .select(SELECT)
    .or("agency_code.like.HHS-NIH%,opportunity_number.like.PA-%,opportunity_number.like.PAR-%,opportunity_number.like.RFA-%")
    .order("posted_date", { ascending: false, nullsFirst: false })
    .limit(params.opportunityNumbers?.length ? 1000 : 5000);
  if (params.opportunityNumbers?.length) query = query.in("opportunity_number", params.opportunityNumbers);

  const { data, error } = await query;
  if (error) {
    await logFinish(supabase, logId, "error", error.message, {});
    return { ok: false, error: error.message };
  }

  const rows = (data ?? []) as Row[];
  const due = rows.filter((r) => {
    if (params.force) return true;
    if (!r.guide_fetched_at) return true;
    if (r.updated_at && r.updated_at > r.guide_fetched_at) return true;
    if (r.guide_fetch_status === "ok") return r.guide_fetched_at < refreshAfter;
    return r.guide_fetched_at < retryAfter;
  });

  let fetched = 0;
  let updated = 0;
  let notFound = 0;
  let errors = 0;
  let skippedUnknownUrl = 0;
  const today = isoToday();

  for (const row of due.slice(0, limit)) {
    const number = row.opportunity_number?.trim();
    if (!number) {
      skippedUnknownUrl += 1;
      continue;
    }
    const url = guideUrlFor(number, row.raw_payload_json?.summary?.additional_info_url ?? null);
    if (!url) {
      skippedUnknownUrl += 1;
      continue;
    }

    const result = await limiter.schedule(() => fetchNihGuideHtml(url));
    fetched += 1;
    const now = new Date().toISOString();

    if (result.status !== "ok") {
      if (result.status === "not_found") notFound += 1;
      else errors += 1;
      await supabase
        .from("funding_opportunities")
        .update({ guide_url: url, guide_fetched_at: now, guide_fetch_status: result.status })
        .eq("id", row.id);
      continue;
    }

    const parsed = parseNihGuide(result.html);
    const nextDue = computeNextDue({ cycles: parsed.cycles, closeDate: row.close_date, expirationDate: parsed.expirationDate }, today);
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
        guide_url: url,
        guide_fetched_at: now,
        guide_fetch_status: "ok",
        guide_last_change: parsed.lastChangeNote,
      })
      .eq("id", row.id);
    if (updErr) errors += 1;
    else updated += 1;
  }

  // Everything still on Simpler dates follows close_date.
  await supabase.rpc("refresh_simpler_next_due");

  const summary = { scanned: rows.length, due: due.length, fetched, updated, notFound, errors, skippedUnknownUrl, durationMs: Date.now() - started };
  await logFinish(supabase, logId, errors > 0 && updated === 0 ? "error" : "success", `Fetched ${fetched} Guide pages · ${updated} updated · ${notFound} not on the Guide`, summary);
  return { ok: true, scanned: rows.length, fetched, updated, notFound, errors, skippedUnknownUrl, durationMs: summary.durationMs };
}
