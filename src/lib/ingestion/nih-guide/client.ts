/**
 * NIH Guide for Grants and Contracts — notice pages.
 * Simpler.Grants.gov carries only the expiration for NIH PA/PAR notices; the
 * Guide page holds the receipt cycles and the rest of Key Dates.
 */

const USER_AGENT = "Prospera/1.0 (UCSF research-development tool; contact research.dev@ucsf.edu)";
const GUIDE_HOST = "grants.nih.gov";

export type GuideFetch =
  | { status: "ok"; url: string; html: string }
  | { status: "not_found"; url: string }
  | { status: "error"; url: string; error: string };

/** Best-known Guide URL: Simpler's additional_info_url when it points at the Guide, else the classic path. */
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
  if (/^RFA-/.test(num)) return `https://${GUIDE_HOST}/grants/guide/rfa-files/${num}.html`;
  if (/^PAR?-/.test(num)) return `https://${GUIDE_HOST}/grants/guide/pa-files/${num}.html`;
  if (/^NOT-/.test(num)) return `https://${GUIDE_HOST}/grants/guide/notice-files/${num}.html`;
  return null;
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
