/**
 * Where a notice's "open the announcement" link should go.
 *
 * `funding_opportunities.guide_url` records where the sync *read* the
 * announcement, which is not always somewhere a person can open. Since 2026
 * NIH publishes new NOFOs only as the "Full Announcement" attachment on
 * Simpler.Grants.gov — the classic grants.nih.gov/grants/guide page returns
 * 404 — so for those rows guide_url is the files.simpler.grants.gov copy
 * (which renders in a browser) and for a notice whose page was never found it
 * is the 404 URL itself. The non-NIH adapters store the Grants.gov attachment
 * endpoint, which answers with `Content-Disposition: attachment` and forces a
 * download. Meanwhile the raw payload's deep-searched "source URL" could be
 * any link that happened to appear in the synopsis text.
 *
 * This module sorts that out into three links, each of which opens as a page:
 *
 *   - `announcement` — the announcement itself: the NIH Guide page when the
 *     sync read one, else the Simpler-hosted full-announcement HTML. Never a
 *     URL that was fetched and found missing, never a forced download.
 *   - `listing` — the notice's listing on Simpler.Grants.gov or Grants.gov,
 *     from the ids the payload carries. Always a page.
 *   - `agency` — the agency's own page for the program, when the payload
 *     names one (`summary.additional_info_url`).
 *
 * `primary` is what a single "open it" button should use, in that order.
 */
import { isSimplerFilesUrl } from "@/lib/ingestion/nih-guide/client";
import { isExternalHttpUrl, resolveFundingSourceUrl } from "@/lib/funding-opportunities/source-url";

export type NoticeLinkKind = "announcement" | "listing" | "agency";

export type NoticeLink = {
  url: string;
  kind: NoticeLinkKind;
  /** Where the link goes, for the button label: "NIH Guide", "Simpler.Grants.gov", "Grants.gov", or the agency host. */
  site: string;
};

export type NoticeLinks = {
  announcement: NoticeLink | null;
  listing: NoticeLink | null;
  agency: NoticeLink | null;
  /** The one to put on the button: announcement, else listing, else agency, else the payload's best-effort source URL. */
  primary: NoticeLink | null;
};

export type NoticeLinkInput = {
  guide_url?: string | null;
  guide_fetch_status?: string | null;
  source_system?: string | null;
  source_opportunity_id?: string | null;
  raw_payload_json?: unknown;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** The Grants.gov synopsis-attachment endpoint (`/grantsws/rest/opportunity/att/download/…`), which forces a download. */
export function isGrantsGovAttachmentDownload(url: string | null | undefined): boolean {
  if (!url) return false;
  const host = hostOf(url);
  return /(^|\.)grants\.gov$/.test(host) && /\/grantsws\/rest\/opportunity\/att\/download\//i.test(url);
}

/** A Simpler-hosted attachment that a browser renders rather than saves (the NIH full-announcement HTML). */
export function isInlineSimplerAttachment(url: string | null | undefined): boolean {
  return Boolean(url) && isSimplerFilesUrl(url) && /\.html?(?:$|[?#])/i.test(url!);
}

function siteFor(url: string): string {
  const host = hostOf(url);
  if (host === "grants.nih.gov" || host.endsWith(".nih.gov") && /\/grants\/guide\//i.test(url)) return "NIH Guide";
  if (host === "simpler.grants.gov" || host.endsWith(".simpler.grants.gov")) return "Simpler.Grants.gov";
  if (/(^|\.)grants\.gov$/.test(host)) return "Grants.gov";
  return host.replace(/^www\./, "") || "agency site";
}

/** The status values under which `guide_url` was actually read. */
const READ_STATUSES = new Set(["ok", "unchanged"]);

function announcementLink(input: NoticeLinkInput): NoticeLink | null {
  const url = input.guide_url?.trim();
  if (!url || !isExternalHttpUrl(url)) return null;
  // A status of not_found / error means the URL was tried and did not answer with an announcement.
  const status = input.guide_fetch_status?.trim().toLowerCase() ?? "";
  if (status && !READ_STATUSES.has(status)) return null;
  // The Grants.gov attachment endpoint is a download, not a page; a Simpler PDF/DOCX attachment likewise.
  if (isGrantsGovAttachmentDownload(url)) return null;
  if (isSimplerFilesUrl(url) && !isInlineSimplerAttachment(url)) return null;
  return { url, kind: "announcement", site: siteFor(url) };
}

function payloadRecord(raw: unknown): Record<string, unknown> {
  return raw != null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function listingLink(input: NoticeLinkInput): NoticeLink | null {
  const raw = payloadRecord(input.raw_payload_json);
  const simplerId = [input.source_opportunity_id, raw.opportunity_id]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .find((v) => UUID_RE.test(v));
  if (simplerId) {
    return { url: `https://simpler.grants.gov/opportunity/${simplerId}`, kind: "listing", site: "Simpler.Grants.gov" };
  }
  const legacy = raw.legacy_opportunity_id;
  const legacyId = typeof legacy === "number" ? legacy : typeof legacy === "string" && /^\d+$/.test(legacy.trim()) ? parseInt(legacy, 10) : NaN;
  if (Number.isFinite(legacyId) && legacyId > 0) {
    return { url: `https://www.grants.gov/search-results-detail/${legacyId}`, kind: "listing", site: "Grants.gov" };
  }
  const id = input.source_opportunity_id?.trim();
  if (id && /^\d+$/.test(id)) {
    return { url: `https://www.grants.gov/search-results-detail/${id}`, kind: "listing", site: "Grants.gov" };
  }
  return null;
}

function agencyLink(input: NoticeLinkInput): NoticeLink | null {
  const raw = payloadRecord(input.raw_payload_json);
  const summary = raw.summary != null && typeof raw.summary === "object" ? (raw.summary as Record<string, unknown>) : {};
  const v = summary.additional_info_url;
  const url = typeof v === "string" ? v.trim() : "";
  if (!url || !isExternalHttpUrl(url)) return null;
  // The Guide URL Simpler sometimes puts here is the announcement, already covered above; skip it so the agency link is something else.
  if (/\/grants\/guide\//i.test(url) && hostOf(url).endsWith("nih.gov")) return null;
  return { url, kind: "agency", site: siteFor(url) };
}

export function resolveNoticeLinks(input: NoticeLinkInput): NoticeLinks {
  const announcement = announcementLink(input);
  const listing = listingLink(input);
  const agency = agencyLink(input);
  let primary: NoticeLink | null = announcement ?? listing ?? agency;
  if (!primary) {
    const fallback = resolveFundingSourceUrl({ raw_payload_json: input.raw_payload_json, source_system: input.source_system, source_opportunity_id: input.source_opportunity_id });
    if (fallback && !isGrantsGovAttachmentDownload(fallback)) primary = { url: fallback, kind: "agency", site: siteFor(fallback) };
  }
  return { announcement, listing, agency, primary };
}

/** "Full announcement ↗", "Simpler.Grants.gov ↗", "Agency site ↗" — what the header button says. */
export function noticeLinkLabel(link: NoticeLink): string {
  if (link.kind === "announcement") return "Full announcement";
  if (link.kind === "listing") return link.site;
  return "Agency site";
}
