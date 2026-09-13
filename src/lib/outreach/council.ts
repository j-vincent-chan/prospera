/**
 * The review council behind a submitted application (the brief's "Not built
 * — decided but open": "Prospera should ask once, timed to the review-council
 * date, instead of waiting to be told"). Pure.
 *
 * An NIH notice's receipt cycles carry the Guide's own "Advisory Council"
 * month per due date ("October 2026"). An application submitted on a day
 * went in for the first due date on or after that day; its outcome is
 * known once that cycle's council has met. So the prompt to record the
 * outcome is timed to the end of the council month — before it, the board
 * says when to expect news; after it, the match asks for the outcome, and
 * keeps asking until one is recorded.
 */
import type { ReceiptCycle } from "@/lib/funding-opportunities/receipt-cycles";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "October 2026" → the month's first and last day; null for anything else ("TBD", a bare year, a typo). */
export function parseMonthYear(text: string | null | undefined): { start: string; end: string } | null {
  const m = text?.trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1]!.toLowerCase());
  if (month < 0) return null;
  const year = Number(m[2]);
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const mm = String(month + 1).padStart(2, "0");
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(last).padStart(2, "0")}` };
}

export type Council = {
  /** "October 2026", as the Guide prints it. */
  label: string;
  /** The last day of the council month — the outcome is asked for after it. */
  end: string;
  /** The due date the application went in for. */
  due: string;
};

/**
 * Pure. The council behind a submission: the first cycle whose due date is on
 * or after the submission day, else the last cycle (a late submission still
 * went into some cycle). Null when no cycle names a council month Prospera
 * can read.
 */
export function councilFor(cycles: readonly ReceiptCycle[], submittedAt: string | null | undefined): Council | null {
  if (!cycles.length) return null;
  const day = submittedAt ? submittedAt.slice(0, 10) : null;
  const sorted = [...cycles].sort((a, b) => a.due.localeCompare(b.due));
  const cycle = (day ? sorted.find((c) => c.due >= day) : sorted[0]) ?? sorted[sorted.length - 1]!;
  const month = parseMonthYear(cycle.council);
  if (!month || !cycle.council) return null;
  return { label: cycle.council.trim(), end: month.end, due: cycle.due };
}

/** Pure. The match's next step once submitted: what to expect, or the ask, and when it became due. */
export function outcomeNext(council: Council | null, today: string): { text: string; urgent: boolean } {
  if (!council) return { text: "Record the outcome", urgent: false };
  if (today > council.end) return { text: `Record the outcome — council met ${council.label}`, urgent: true };
  return { text: `Outcome after council, ${council.label}`, urgent: false };
}
