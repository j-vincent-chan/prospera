/**
 * The NIH Guide adapter (PR 5.2) — the existing path, moved behind the
 * interface with no behaviour change.
 *
 * Every rule here was already in `services/nih-guide-sync.ts`; this file is
 * where they now live, so the sync driver has nothing NIH-shaped left in it.
 * The route, unchanged:
 *
 *   1. Read the preferred URL — a stored `files.simpler.grants.gov` attachment
 *      when the row has one, else the classic `grants.nih.gov` path.
 *   2. If the classic page came back but is the plain-text template (no Key
 *      Dates rows, no headings), the styled announcement Simpler holds is
 *      strictly better: use the attachment the row already lists, with no API
 *      call.
 *   3. On a 404 — or a plain classic page with no stored attachment — spend one
 *      Simpler GET to resolve `<number>-Full-Announcement.html`, and read that.
 *   4. A stored attachment URL that is gone and not re-resolvable falls back to
 *      the classic path once before giving up.
 *
 * Step 3 is why `acquire` owns the flow rather than returning a target list:
 * the Simpler call happens only after a miss, which is what bounds it to one
 * GET per affected notice.
 */
import {
  fetchNihGuideHtml,
  guideAttachmentUrl,
  guideSourceForUrl,
  guideUrlFor,
  isSimplerFilesUrl,
  type GuideFetch,
} from "@/lib/ingestion/nih-guide/client";
import {
  guideHtmlHash,
  isPlainGuideLayout,
  parseClinicalTrialDesignation,
  parseGuideSections,
  parseNihGuide,
  parseProgramDivision,
} from "@/lib/ingestion/nih-guide/parse";
import type { SimplerAttachment, SimplerOpportunityHit } from "@/lib/ingestion/simpler-grants/types";
import { computeNextDue } from "@/lib/funding-opportunities/receipt-cycles";
import { linesToText } from "@/lib/ingestion/announcement/text";
import type { AnnouncementSource } from "@/lib/ingestion/announcement/registry";
import type { AsyncRateLimiter } from "@/lib/utils/async-rate-limiter";
import { createHash } from "node:crypto";

export type SimplerClientLike = { getOpportunity(id: string): Promise<SimplerOpportunityHit> };

/** The columns the adapter reads. */
export type NihGuideRow = {
  id: string;
  opportunity_number: string | null;
  title: string | null;
  close_date: string | null;
  source_opportunity_id: string | null;
  guide_url: string | null;
  guide_html_hash: string | null;
  raw_payload_json: { summary?: { additional_info_url?: string | null } | string | null; attachments?: unknown } | null;
};

export type NihGuideDeps = {
  /** One limiter per host; `grants.nih.gov` and `files.simpler.grants.gov` no longer share one. */
  limiterFor(host: string): AsyncRateLimiter;
  simplerLimiter: AsyncRateLimiter;
  simpler: SimplerClientLike | null;
  /** `--force`: read and re-parse even when the page hash is unchanged. */
  force: boolean;
  today: string;
};

/** How the announcement was reached, for the run's counters. */
export type AttachmentOutcome = "hit" | "miss" | "stored" | "error" | "n/a";

export type NihGuideAcquisition = {
  status: "ok" | "unchanged" | "not_found" | "error";
  url: string | null;
  source: AnnouncementSource | null;
  html: string | null;
  htmlHash: string | null;
  textHash: string | null;
  attachment: AttachmentOutcome;
  pageFetches: number;
  simplerCalls: number;
  /** The Simpler detail record's attachments, merged into `raw_payload_json` by the caller when present. */
  mergedRaw: Record<string, unknown> | null;
  error: string | null;
};

export const NIH_GUIDE_ADAPTER_ID = "nih_guide";

function additionalInfoUrl(row: NihGuideRow): string | null {
  const summary = row.raw_payload_json?.summary;
  if (!summary || typeof summary !== "object") return null;
  const v = summary.additional_info_url;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** The URL the sync reads: a stored Simpler attachment URL first, else the classic Guide path. */
export function preferredGuideUrl(row: Pick<NihGuideRow, "guide_url" | "opportunity_number" | "raw_payload_json">): string | null {
  if (isSimplerFilesUrl(row.guide_url)) return row.guide_url;
  const number = row.opportunity_number?.trim();
  return number ? guideUrlFor(number, additionalInfoUrl(row as NihGuideRow)) : null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** SHA-256 of the sectioned text — the source-agnostic re-parse signal (PR 5.2). */
export function announcementTextHash(sections: ReadonlyArray<{ heading: string; text: string }>): string {
  const body = linesToText(sections.flatMap((s) => [s.heading, s.text]));
  return createHash("sha256").update(body).digest("hex");
}

/**
 * Read one notice's announcement. `plannedUrl` and `plannedSource` come from the
 * driver's plan, which is unchanged.
 */
export async function acquireNihGuide(row: NihGuideRow, plannedUrl: string, deps: NihGuideDeps): Promise<NihGuideAcquisition> {
  const number = (row.opportunity_number ?? "").trim();
  let url = plannedUrl;
  let source: AnnouncementSource = guideSourceForUrl(url);
  const plannedSource = source;
  let attachment: AttachmentOutcome = source === "simpler_attachment" ? "stored" : "n/a";
  let pageFetches = 0;
  let simplerCalls = 0;
  let mergedRaw: Record<string, unknown> | null = null;
  let error: string | null = null;

  const get = async (target: string): Promise<GuideFetch> => {
    pageFetches += 1;
    return deps.limiterFor(hostOf(target)).schedule(() => fetchNihGuideHtml(target));
  };

  let result = await get(url);

  // The classic page exists but is the plain text template: the styled
  // announcement Simpler holds is strictly better. Use it when the row already
  // stores the attachment list (no API call), else resolve it below like a 404.
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

  const needsResolve = result.status === "not_found" || (plainClassic && source === "grants_nih_gov");
  if (needsResolve && deps.simpler && row.source_opportunity_id) {
    const before = result;
    simplerCalls += 1;
    try {
      const detail = await deps.simplerLimiter.schedule(() => deps.simpler!.getOpportunity(row.source_opportunity_id!));
      const attachments = Array.isArray(detail.attachments) ? detail.attachments : [];
      mergedRaw = { ...(row.raw_payload_json as Record<string, unknown> | null), attachments };
      const resolvedUrl = guideAttachmentUrl(attachments, number);
      if (resolvedUrl && resolvedUrl !== url) {
        const better = await get(resolvedUrl);
        if (better.status === "ok" || before.status !== "ok") {
          result = better;
          url = resolvedUrl;
          source = "simpler_attachment";
        }
        attachment = better.status === "ok" ? "hit" : "miss";
      } else {
        attachment = "miss";
      }
    } catch (e) {
      attachment = "error";
      error = e instanceof Error ? e.message : String(e);
    }
    // A stored attachment URL that is gone and not re-resolvable: try the
    // classic path once before giving up.
    if (result.status === "not_found" && plannedSource === "simpler_attachment") {
      const classic = guideUrlFor(number, additionalInfoUrl(row));
      if (classic && classic !== url) {
        result = await get(classic);
        url = classic;
        source = "grants_nih_gov";
      }
    }
  }

  if (result.status !== "ok") {
    return {
      status: result.status,
      url,
      source: null,
      html: null,
      htmlHash: null,
      textHash: null,
      attachment,
      pageFetches,
      simplerCalls,
      mergedRaw,
      error: result.status === "error" ? result.error : error,
    };
  }

  const htmlHash = guideHtmlHash(result.html);
  if (!deps.force && htmlHash === row.guide_html_hash) {
    return { status: "unchanged", url, source, html: null, htmlHash, textHash: null, attachment, pageFetches, simplerCalls, mergedRaw, error };
  }
  return { status: "ok", url, source, html: result.html, htmlHash, textHash: null, attachment, pageFetches, simplerCalls, mergedRaw, error };
}

/** The columns an `ok` acquisition writes, exactly as the Guide sync always wrote them. */
export function nihGuideColumns(row: NihGuideRow, acq: NihGuideAcquisition & { html: string }, today: string) {
  const parsed = parseNihGuide(acq.html);
  const sections = parseGuideSections(acq.html);
  const designation = parseClinicalTrialDesignation(parsed.title ?? row.title, acq.html);
  const division = parseProgramDivision(sections.filter((s) => s.section === "VII").map((s) => `${s.heading}\n${s.text}`).join("\n"));
  const nextDue = computeNextDue({ cycles: parsed.cycles, closeDate: row.close_date, expirationDate: parsed.expirationDate }, today);
  return {
    parsed,
    sections,
    designation,
    division,
    textHash: announcementTextHash(sections),
    columns: {
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
      guide_html_hash: acq.htmlHash,
      guide_last_change: parsed.lastChangeNote,
    },
  };
}
