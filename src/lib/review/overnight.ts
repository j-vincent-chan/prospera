/**
 * Discover's overnight strip (decision N2): what arrived since the viewer
 * last looked, what it produced, and that nothing went out on its own — the
 * sentence Today put under its date, now under Discover's title, with the
 * filed count linking to the notices themselves. Pure; the read is
 * `overnight-queries.ts`.
 */
import { fmtMonD } from "@/lib/funding-opportunities/receipt-cycles";

export type OvernightSegment = { text: string; href: string | null };

/** Where the filed notices are: the catalog, newest first. */
export const FILED_HREF = "/opportunities?scope=all&sort=posted_date&order=desc";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "Overnight" → "overnight", "Since Sep 10" → "since Sep 10" — mid-sentence. */
const mid = (since: string) => (since === "Overnight" ? "overnight" : since.replace(/^Since/, "since"));

const PT = "America/Los_Angeles";
const tzOffsetMs = (at: Date) => new Date(at.toLocaleString("en-US", { timeZone: PT })).getTime() - new Date(at.toLocaleString("en-US", { timeZone: "UTC" })).getTime();

/** The instant the Pacific day `today` (the app's `isoToday()`) began. */
export function dayStartPT(today: string): Date {
  const utcMidnight = new Date(`${today}T00:00:00Z`);
  return new Date(utcMidnight.getTime() - tzOffsetMs(utcMidnight));
}

/**
 * The window the strip reports on: since the last visit, floored at the start
 * of the Pacific day so the line holds all day on a page people sit on (the
 * feed runs at 08:14 UTC, inside every Pacific day), and never more than 14
 * days back.
 */
export function windowStart(lastVisitAt: string | null, now: Date, today: string): string {
  const floor = now.getTime() - 14 * 86_400_000;
  const last = lastVisitAt ? new Date(lastVisitAt).getTime() : floor;
  return new Date(Math.max(floor, Math.min(last, dayStartPT(today).getTime()))).toISOString();
}

/** "Overnight" when the window opened inside the last 36 hours, else "Since Sep 10". */
export function sinceLabel(sinceIso: string, now: Date, today: string): string {
  const hours = (now.getTime() - new Date(sinceIso).getTime()) / 3_600_000;
  return hours < 36 ? "Overnight" : `Since ${fmtMonD(sinceIso.slice(0, 10), today)}`;
}

/**
 * "Overnight: 22 new notices. 8 produced matches, [14 produced none and were
 * filed]. Nothing has been sent." — the bracketed run links to the filed
 * notices; with none filed, or no arrivals, nothing links.
 */
export function overnightLine(input: { since: string; newNotices: number; matched: number; filed: number; sent: number }): OvernightSegment[] {
  const sent = input.sent ? ` ${plural(input.sent, "message")} went out ${mid(input.since)}, each sent by hand.` : " Nothing has been sent.";
  if (!input.newNotices) return [{ text: `${input.since}: no new notices.${sent}`, href: null }];
  return [
    { text: `${input.since}: ${plural(input.newNotices, "new notice")}. ${input.matched} produced ${input.matched === 1 ? "a match" : "matches"}, `, href: null },
    { text: `${input.filed} produced none and ${input.filed === 1 ? "was" : "were"} filed`, href: input.filed ? FILED_HREF : null },
    { text: `.${sent}`, href: null },
  ];
}

/** The segments as one sentence, for tests and plain-text surfaces. */
export const overnightText = (segments: readonly OvernightSegment[]): string => segments.map((s) => s.text).join("");
