/**
 * Receipt cycles and the date grammar from the README:
 *   "Due in N days · Mon D" / "Overdue by N days · Mon D" / "Opens ~Mon D"
 *   secondary: "then Jan 25, May 25 · 3 left" / "single receipt date" /
 *              "first due Jan 15, 2027" / "due dates not yet published"
 * NIH deadlines are 5:00 PM applicant-local; UCSF renders "5:00 PM PT".
 * Internal routing dates follow the team's rule (N business/calendar days
 * before the next due date, skipping the chosen holiday calendar).
 */

export type CycleKind = "new" | "renewal" | "aids";

export type ReceiptCycle = {
  /** ISO date (YYYY-MM-DD). */
  due: string;
  kind: CycleKind;
  /** "July 2026" etc., as printed in the NIH Guide. */
  review?: string | null;
  council?: string | null;
  start?: string | null;
};

export type CycleFacts = {
  cycles: ReceiptCycle[];
  cyclesSource: "simpler" | "nih_guide";
  standardDatesApply?: boolean;
  closeDate: string | null;
  expirationDate: string | null;
  forecasted: boolean;
  /** Simpler's forecasted_post_date, when the notice is a forecast. */
  forecastedPostDate?: string | null;
  isNih: boolean;
  status?: string | null;
};

export type DueTone = "urgent" | "normal" | "muted" | "closed" | "forecast";

export type DueDisplay = {
  /** e.g. "Due in 23 days · Sep 25" */
  primary: string;
  /** e.g. "then Jan 25, May 25 · 3 left" */
  secondary: string;
  tone: DueTone;
  /** ISO date behind `primary`, when there is one. */
  date: string | null;
};

const MS_DAY = 86_400_000;

export function isoToday(now: Date = new Date()): string {
  // Calendar day in Pacific time: deadlines are applicant-local and UCSF is PT.
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(now);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / MS_DAY);
}

const MON_D = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const MON_D_Y = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const MON_Y = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

function utc(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

/** "Sep 25" — or "Sep 25, 2027" when the date is in a different year than `today`. */
export function fmtMonD(iso: string, today: string = isoToday()): string {
  const d = utc(iso);
  return d.getUTCFullYear() === utc(today).getUTCFullYear() ? MON_D.format(d) : MON_D_Y.format(d);
}

export function fmtMonDY(iso: string): string {
  return MON_D_Y.format(utc(iso));
}

export function fmtMonY(iso: string): string {
  return MON_Y.format(utc(iso));
}

/**
 * Receipt dates that apply to a general applicant, on or after `today`,
 * soonest first. Regular ("new") dates lead; renewal-only dates are used when
 * a notice has no new dates; AIDS dates are never the headline (they apply
 * only to AIDS-related applications). Dates after the expiration are dropped.
 */
export function upcomingCycles(cycles: ReceiptCycle[], today: string = isoToday(), expirationDate: string | null = null): ReceiptCycle[] {
  const live = cycles.filter((c) => c.due >= today && (!expirationDate || c.due <= expirationDate));
  const pick = (kind: CycleKind) => live.filter((c) => c.kind === kind);
  const chosen = pick("new").length ? pick("new") : pick("renewal").length ? pick("renewal") : pick("aids");
  const byDate = new Map<string, ReceiptCycle>();
  for (const c of chosen) if (!byDate.has(c.due)) byDate.set(c.due, c);
  return [...byDate.values()].sort((a, b) => a.due.localeCompare(b.due));
}

/** All general-applicant dates (past and future), clipped to the expiration. */
export function applicableCycles(cycles: ReceiptCycle[], expirationDate: string | null = null): ReceiptCycle[] {
  const live = cycles.filter((c) => !expirationDate || c.due <= expirationDate);
  const pick = (kind: CycleKind) => live.filter((c) => c.kind === kind);
  const chosen = pick("new").length ? pick("new") : pick("renewal").length ? pick("renewal") : pick("aids");
  return [...chosen].sort((a, b) => a.due.localeCompare(b.due));
}

/** Next receipt date used for sorting and "Next due": next applicable cycle, else the last one, else close date. */
export function computeNextDue(facts: Pick<CycleFacts, "cycles" | "closeDate"> & { expirationDate?: string | null }, today: string = isoToday()): string | null {
  const exp = facts.expirationDate ?? null;
  const next = upcomingCycles(facts.cycles, today, exp)[0];
  if (next) return next.due;
  const all = applicableCycles(facts.cycles, exp);
  if (all.length > 0) return all[all.length - 1]!.due;
  // Every listed date falls after the expiration: the notice closed when it expired.
  if (facts.cycles.length > 0 && exp) return exp;
  return facts.closeDate;
}

function listDates(cycles: ReceiptCycle[], today: string): string {
  return cycles.map((c) => fmtMonD(c.due, today)).join(", ");
}

/** The two-line "Next due" cell / header line. */
export function dueDisplay(facts: CycleFacts, today: string = isoToday()): DueDisplay {
  // A notice with no parsed cycles but a close date is a single-receipt notice.
  const applicable = applicableCycles(facts.cycles, facts.expirationDate);
  const cycles: ReceiptCycle[] =
    applicable.length > 0
      ? applicable
      : facts.cycles.length > 0 && facts.expirationDate
        ? [{ due: facts.expirationDate, kind: "new" }]
        : facts.closeDate
          ? [{ due: facts.closeDate, kind: "new" }]
          : [];
  const upcoming = upcomingCycles(cycles, today, facts.expirationDate);

  if (facts.forecasted) {
    const opens = facts.forecastedPostDate;
    const first = upcoming[0]?.due ?? (facts.closeDate && facts.closeDate >= today ? facts.closeDate : null);
    // `date` is the first receipt date (what routing and "Next due" key off), never the open date.
    return {
      primary: opens ? `Opens ~${fmtMonD(opens, today)}` : "Forecasted",
      secondary: first ? `first due ${fmtMonDY(first)}` : "dates to be announced",
      tone: "forecast",
      date: first,
    };
  }

  // NIH notice without Guide data: Simpler's close date is the expiration, not a receipt date.
  if (facts.isNih && facts.cyclesSource === "simpler") {
    if (facts.closeDate && facts.closeDate < today) {
      return { primary: `Expired ${fmtMonDY(facts.closeDate)}`, secondary: "", tone: "closed", date: facts.closeDate };
    }
    return {
      primary: facts.closeDate ? `Expires ${fmtMonDY(facts.closeDate)}` : "No expiration listed",
      secondary: facts.standardDatesApply ? "standard NIH due dates" : "due dates not yet published",
      tone: "muted",
      date: facts.closeDate,
    };
  }

  const next = upcoming[0];
  if (!next) {
    const last = cycles.length ? cycles[cycles.length - 1]!.due : null;
    if (!last) return { primary: "No deadline listed", secondary: "", tone: "muted", date: null };
    const overdue = daysBetween(last, today);
    return {
      primary: overdue > 0 ? `Overdue by ${overdue} day${overdue === 1 ? "" : "s"} · ${fmtMonD(last, today)}` : `Closed ${fmtMonD(last, today)}`,
      secondary: facts.expirationDate && facts.expirationDate > last ? `expires ${fmtMonDY(facts.expirationDate)}` : "",
      tone: "closed",
      date: last,
    };
  }

  const days = daysBetween(today, next.due);
  const primary = days === 0 ? `Due today · ${fmtMonD(next.due, today)}` : `Due in ${days} day${days === 1 ? "" : "s"} · ${fmtMonD(next.due, today)}`;
  const rest = upcoming.slice(1);
  let secondary: string;
  if (rest.length === 0) {
    secondary = cycles.length > 1 ? "last receipt date" : "single receipt date";
  } else {
    const shown = rest.slice(0, 2);
    const left = rest.length;
    secondary = `then ${listDates(shown, today)} · ${left} left`;
    if (rest.length <= 2 && facts.expirationDate) secondary = `then ${listDates(shown, today)} · to ${fmtMonY(facts.expirationDate)}`;
  }
  return { primary, secondary, tone: days <= 30 ? "urgent" : "normal", date: next.due };
}

/** "Sep 25, 2026 · 5:00 PM PT" for NIH; plain date otherwise. */
export function dueWithTime(iso: string, isNih: boolean): string {
  return isNih ? `${fmtMonDY(iso)} · 5:00 PM PT` : fmtMonDY(iso);
}

/** "Jan 25, May 25, Sep 25 (2027) · 3 cycles left" for the Key dates panel. */
export function followingDueDatesLabel(facts: CycleFacts, today: string = isoToday()): string | null {
  const rest = upcomingCycles(facts.cycles, today, facts.expirationDate).slice(1);
  if (rest.length === 0) return null;
  const shown = rest.slice(0, 3).map((c) => fmtMonD(c.due, today));
  const lastYear = utc(rest[Math.min(2, rest.length - 1)]!.due).getUTCFullYear();
  const thisYear = utc(today).getUTCFullYear();
  const yearNote = lastYear !== thisYear && !shown.some((s) => /\d{4}/.test(s)) ? ` (${lastYear})` : "";
  return `${shown.join(", ")}${yearNote} · ${rest.length} cycle${rest.length === 1 ? "" : "s"} left`;
}

// ---------------------------------------------------------------------------
// Internal routing date
// ---------------------------------------------------------------------------

export type RoutingRule = {
  days: number;
  dayType: "business" | "calendar";
  holidayCalendar: "ucsf" | "us_federal" | "none";
};

/** UC / UCSF observed holidays. Maintain yearly from the UCSF HR calendar. */
export const UCSF_HOLIDAYS: string[] = [
  // 2026
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-03-27", "2026-05-25", "2026-06-19", "2026-07-03",
  "2026-09-07", "2026-11-11", "2026-11-26", "2026-11-27", "2026-12-24", "2026-12-25", "2026-12-31",
  // 2027
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05",
  "2027-09-06", "2027-11-11", "2027-11-25", "2027-11-26", "2027-12-24", "2027-12-27", "2027-12-31",
];

/** US federal holidays (observed). Maintain yearly from OPM. */
export const US_FEDERAL_HOLIDAYS: string[] = [
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07",
  "2026-10-12", "2026-11-11", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06",
  "2027-10-11", "2027-11-11", "2027-11-25", "2027-12-24",
];

function shiftIso(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * MS_DAY).toISOString().slice(0, 10);
}

function isWeekend(iso: string): boolean {
  const d = utc(iso).getUTCDay();
  return d === 0 || d === 6;
}

/** The date routing paperwork is due, per the team's rule. */
export function internalRoutingDate(dueIso: string, rule: RoutingRule): string {
  if (rule.dayType === "calendar") return shiftIso(dueIso, -rule.days);
  const holidays = new Set(rule.holidayCalendar === "ucsf" ? UCSF_HOLIDAYS : rule.holidayCalendar === "us_federal" ? US_FEDERAL_HOLIDAYS : []);
  let cursor = dueIso;
  let remaining = rule.days;
  while (remaining > 0) {
    cursor = shiftIso(cursor, -1);
    if (!isWeekend(cursor) && !holidays.has(cursor)) remaining -= 1;
  }
  return cursor;
}

export function describeRoutingRule(rule: RoutingRule): string {
  const cal = rule.holidayCalendar === "ucsf" ? "UCSF holidays skipped" : rule.holidayCalendar === "us_federal" ? "US federal holidays skipped" : "no holidays skipped";
  return `${rule.days} ${rule.dayType} day${rule.days === 1 ? "" : "s"} before the next due date, ${cal}`;
}

// ---------------------------------------------------------------------------
// Row → facts
// ---------------------------------------------------------------------------

export type CycleColumns = {
  receipt_cycles?: unknown;
  cycles_source?: string | null;
  standard_dates_apply?: boolean | null;
  close_date: string | null;
  expiration_date?: string | null;
  forecasted: boolean | null;
  status?: string | null;
  agency_code?: string | null;
  opportunity_number?: string | null;
  raw_payload_json?: unknown;
};

export function isNihNotice(row: { agency_code?: string | null; opportunity_number?: string | null }): boolean {
  if ((row.agency_code ?? "").toUpperCase().startsWith("HHS-NIH")) return true;
  return /^(PA|PAR|RFA)-[A-Z]{2}-\d{2}-\d{3}/i.test((row.opportunity_number ?? "").trim());
}

export function parseCycles(value: unknown): ReceiptCycle[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((c): c is ReceiptCycle => Boolean(c) && typeof c === "object" && typeof (c as ReceiptCycle).due === "string")
    .map((c): ReceiptCycle => ({ due: c.due, kind: c.kind === "renewal" || c.kind === "aids" ? c.kind : "new", review: c.review ?? null, council: c.council ?? null, start: c.start ?? null }))
    .sort((a, b) => a.due.localeCompare(b.due));
}

export function cycleFactsFromRow(row: CycleColumns): CycleFacts {
  const raw = (row.raw_payload_json ?? {}) as { summary?: { forecasted_post_date?: string | null } };
  return {
    cycles: parseCycles(row.receipt_cycles),
    cyclesSource: row.cycles_source === "nih_guide" ? "nih_guide" : "simpler",
    standardDatesApply: Boolean(row.standard_dates_apply),
    closeDate: row.close_date,
    expirationDate: row.expiration_date ?? null,
    forecasted: Boolean(row.forecasted),
    forecastedPostDate: raw.summary?.forecasted_post_date ?? null,
    isNih: isNihNotice(row),
    status: row.status ?? null,
  };
}
