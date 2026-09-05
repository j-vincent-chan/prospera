/**
 * NIH Guide for Grants and Contracts — notice pages.
 * Simpler.Grants.gov carries only the expiration for NIH PA/PAR notices; the
 * Guide page holds the receipt cycles and the rest of Key Dates.
 *
 * Two hosts serve the same markup (GUIDE_DIAGNOSTICS.md, PR 0.5a): the classic
 * grants.nih.gov/grants/guide/… page, and — for most NOFOs posted since
 * November 2025 — a `<number>-Full-Announcement.html` attachment on
 * files.simpler.grants.gov that the Simpler detail record lists under
 * `attachments[]`. `fetchNihGuideHtml` reads either.
 */

import type { SimplerAttachment } from "@/lib/ingestion/simpler-grants/types";

const USER_AGENT = "Prospera/1.0 (UCSF research-development tool; contact research.dev@ucsf.edu)";
const GUIDE_HOST = "grants.nih.gov";
const SIMPLER_FILES_HOST = "simpler.grants.gov";

export type GuideFetch =
  | { status: "ok"; url: string; html: string }
  | { status: "not_found"; url: string }
  | { status: "error"; url: string; error: string };

/** Where a Guide page was read from; stored in funding_opportunities.guide_source. */
export type GuideSource = "grants_nih_gov" | "simpler_attachment";

/**
 * The shape of a number that can have a Guide page: RFA-IC-YY-NNN, PA-YY-NNN,
 * PAR-YY-NNN, PAS-YY-NNN. Zero of the 313 `ok` rows on 2026-09-05 fail it;
 * the rows that do (HHS-OPHS `PA-FPH-27-001`, `PA-EAA-26-001`, …) have no
 * Guide page. `-000` numbers are CDC umbrella placeholders (`RFA-IP-18-000`),
 * also without a page.
 */
export const GUIDE_NUMBER_RE = /^(RFA-[A-Z]{2}-\d{2}-\d{3}|PA[RS]?-\d{2}-\d{3})$/;

export function isGuideNumber(opportunityNumber: string | null | undefined): boolean {
  const num = (opportunityNumber ?? "").trim().toUpperCase();
  return GUIDE_NUMBER_RE.test(num) && !/-000$/.test(num);
}

/**
 * Best-known classic Guide URL: Simpler's additional_info_url when it points at
 * the Guide, else the classic path for a well-formed Guide number (`PAS-` lives
 * under `pa-files/` like `PA-` and `PAR-`). `NOT-` notices keep their branch.
 * Returns null for forecasts' placeholder numbers, `-000` umbrellas and
 * non-Guide numbers — the sync stamps those `not_applicable`.
 */
export function guideUrlFor(opportunityNumber: string, additionalInfoUrl?: string | null): string | null {
  const fromSimpler = (additionalInfoUrl ?? "").trim();
  if (fromSimpler) {
    try {
      const u = new URL(fromSimpler);
      if (u.hostname.endsWith(GUIDE_HOST) && /\/grants\/guide\//i.test(u.pathname)) {
        u.protocol = "https:";
        return u.toString();
      }
    } catch {
      /* fall through to the classic path */
    }
  }
  const num = opportunityNumber.trim().toUpperCase();
  if (/^NOT-/.test(num)) return `https://${GUIDE_HOST}/grants/guide/notice-files/${num}.html`;
  if (!isGuideNumber(num)) return null;
  if (/^RFA-/.test(num)) return `https://${GUIDE_HOST}/grants/guide/rfa-files/${num}.html`;
  if (/^PA[RS]?-/.test(num)) return `https://${GUIDE_HOST}/grants/guide/pa-files/${num}.html`;
  return null;
}

/** True for a URL on files.simpler.grants.gov (or any *.simpler.grants.gov host). */
export function isSimplerFilesUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === SIMPLER_FILES_HOST || h.endsWith(`.${SIMPLER_FILES_HOST}`);
  } catch {
    return false;
  }
}

export function guideSourceForUrl(url: string): GuideSource {
  return isSimplerFilesUrl(url) ? "simpler_attachment" : "grants_nih_gov";
}

/**
 * The Simpler attachment that holds the full announcement for `opportunityNumber`:
 * file name `<number>-Full-Announcement.html` or, once NIH has revised the
 * notice, `<number>-Revised-Full-Announcement.html` (case-insensitive; the
 * revised file wins when both are listed), HTML mime type (Simpler sends
 * "text/html;charset=ISO-8859-1" / "…UTF-8"), https download path on a
 * simpler.grants.gov host. Returns the download URL or null.
 */
export function guideAttachmentUrl(attachments: SimplerAttachment[] | null | undefined, opportunityNumber: string): string | null {
  if (!Array.isArray(attachments) || attachments.length === 0) return null;
  const num = opportunityNumber.trim().toUpperCase();
  if (!num) return null;
  const wanted = new RegExp(`^${num.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(Revised-)?Full-Announcement\\.html?$`, "i");
  let plain: string | null = null;
  for (const a of attachments) {
    if (!a || typeof a !== "object") continue;
    const name = typeof a.file_name === "string" ? a.file_name.trim() : "";
    const url = typeof a.download_path === "string" ? a.download_path.trim() : "";
    const mime = typeof a.mime_type === "string" ? a.mime_type.trim().toLowerCase() : "";
    const m = name.match(wanted);
    if (!m || !url) continue;
    if (mime && !mime.startsWith("text/html")) continue;
    if (!/^https:\/\//i.test(url) || !isSimplerFilesUrl(url)) continue;
    if (m[1]) return url;
    plain ??= url;
  }
  return plain;
}

export async function fetchNihGuideHtml(url: string, timeoutMs = 20_000): Promise<GuideFetch> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
    });
    if (res.status === 404 || res.status === 410) return { status: "not_found", url };
    if (!res.ok) return { status: "error", url, error: `HTTP ${res.status}` };
    const html = await res.text();
    // The Guide serves a styled 404 page with a 200 for some paths; treat those as missing.
    if (!/Key Dates|Application Due Date/i.test(html)) return { status: "not_found", url };
    return { status: "ok", url, html };
  } catch (e) {
    return { status: "error", url, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}
