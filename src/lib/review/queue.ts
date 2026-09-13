/**
 * The Review queue's policy and copy (design_handoff_prospera_review_outreach
 * README §2 "Review — list mode"). Pure: rows in, words and orderings out. No
 * Supabase, no clock — every date arrives as `today`.
 *
 * **What enters the queue, and why it is a policy rather than "everything".**
 * The brief says the queue holds "notices with matches above the bar". Measured
 * on 2026-09-12 against the live `fit_results`: 3,392 surfaced rows sit on open
 * notices and 3,357 of them are Exploratory; 11 notices carry a Strong or
 * Moderate match (35 rows), and each of those carries between 7 and 86
 * Exploratory rows besides. A queue of every surfaced match would be sixty-odd
 * notices and a four-digit badge that no strategist would open. So:
 *
 *   - a notice **enters the queue** when it has at least one Strong or
 *     Moderate match (`QUEUE_TIERS`) and is not closed;
 *   - on a queued notice the page **lists** every Strong and Moderate row and
 *     the `EXPLORATORY_CAP` best Exploratory rows — the design's row for a lead
 *     "to check, not a recommendation" survives, the other eighty do not;
 *   - the nav badge counts the listed rows with no decision.
 *
 * The brief's "Not built — decided but open" names exactly this ("Exploratory
 * matches never enter the Review queue; a cap per notice") as needing product
 * agreement; this is the default taken so the page ships, and the two numbers
 * are constants so the agreement is a one-line change.
 */
import type { Tier } from "@/lib/fit/types";
import { daysBetween, fmtMonD, type RoutingRule } from "@/lib/funding-opportunities/receipt-cycles";
import type { MatchDecision } from "@/lib/review/decisions";

// ---------------------------------------------------------------------------
// Which rows are listed
// ---------------------------------------------------------------------------

/** The tiers that put a notice in the queue. */
export const QUEUE_TIERS: readonly Tier[] = ["strong", "moderate"];

/** How many Exploratory rows a queued notice lists, best first. */
export const EXPLORATORY_CAP = 3;

/** A Watch returns the match this many days before the deadline. */
export const WATCH_RETURNS_DAYS_BEFORE = 30;

export type QueuePair = { investigatorId: string; opportunityId: string; tier: Tier; score: number };

/** Pure. The notices with at least one row at a queue tier, in first-seen order. */
export function queuedNoticeIds(pairs: readonly QueuePair[]): string[] {
  const out: string[] = [];
  for (const p of pairs) if (QUEUE_TIERS.includes(p.tier) && !out.includes(p.opportunityId)) out.push(p.opportunityId);
  return out;
}

/** Best first: tier rank, then score descending, then the investigator id so the order is stable. */
const TIER_RANK: Record<Tier, number> = { strong: 0, moderate: 1, exploratory: 2, poor: 3 };
export function comparePairs(a: QueuePair, b: QueuePair): number {
  return TIER_RANK[a.tier] - TIER_RANK[b.tier] || b.score - a.score || a.investigatorId.localeCompare(b.investigatorId);
}

/**
 * Pure. The rows a queued notice lists: every Strong and Moderate row, then at
 * most `cap` Exploratory rows by score. Rows on notices that are not queued
 * are dropped; Poor rows never arrive here.
 */
export function listedPairs(pairs: readonly QueuePair[], cap: number = EXPLORATORY_CAP): QueuePair[] {
  const queued = new Set(queuedNoticeIds(pairs));
  const byNotice = new Map<string, QueuePair[]>();
  for (const p of pairs) {
    if (!queued.has(p.opportunityId) || p.tier === "poor") continue;
    byNotice.set(p.opportunityId, [...(byNotice.get(p.opportunityId) ?? []), p]);
  }
  const out: QueuePair[] = [];
  for (const rows of byNotice.values()) out.push(...capExploratory([...rows].sort(comparePairs), cap));
  return out;
}

/** Pure. A ranked list with its Exploratory tail cut to `cap`; the Strong and Moderate head is untouched. */
export function capExploratory<R extends { tier: Tier }>(ranked: readonly R[], cap: number = EXPLORATORY_CAP): R[] {
  let exploratory = 0;
  return ranked.filter((r) => (r.tier === "exploratory" ? exploratory++ < cap : r.tier !== "poor"));
}

/** Pure. How many rows `listedPairs` would keep for one notice, given its tier counts. */
export function listedCount(byTier: Partial<Record<Tier, number>>, cap: number = EXPLORATORY_CAP): number {
  return (byTier.strong ?? 0) + (byTier.moderate ?? 0) + Math.min(cap, byTier.exploratory ?? 0);
}

// ---------------------------------------------------------------------------
// Counting a notice
// ---------------------------------------------------------------------------

export type CountableRow = { tier: Tier; decision: MatchDecision | null; /** Marked do-not-contact on the profile: settled without a decision. */ doNotContact?: boolean };

export type NoticeCounts = {
  suggested: number;
  decided: number;
  undecided: number;
  confirmed: number;
  rejected: number;
  watching: number;
  byTier: Record<Tier, number>;
};

/** Pure. A do-not-contact person is settled — nothing is owed on the row — but is no one's decision, so it is neither confirmed, rejected nor watched. */
export function noticeCounts(rows: readonly CountableRow[]): NoticeCounts {
  const c: NoticeCounts = { suggested: rows.length, decided: 0, undecided: 0, confirmed: 0, rejected: 0, watching: 0, byTier: { strong: 0, moderate: 0, exploratory: 0, poor: 0 } };
  for (const r of rows) {
    c.byTier[r.tier] += 1;
    if (r.decision) {
      c.decided += 1;
      if (r.decision.status === "confirmed") c.confirmed += 1;
      else if (r.decision.status === "rejected") c.rejected += 1;
      else c.watching += 1;
    } else if (r.doNotContact) c.decided += 1;
    else c.undecided += 1;
  }
  return c;
}

/** "4 suggested · 1 decided" */
export const matchLine = (c: Pick<NoticeCounts, "suggested" | "decided">): string => `${c.suggested} suggested · ${c.decided} decided`;

/** "1 of 4 decided" */
export const decidedLine = (c: Pick<NoticeCounts, "suggested" | "decided">): string => `${c.decided} of ${c.suggested} decided`;

/** 0–100, for the 3px bar. */
export const progressPercent = (c: Pick<NoticeCounts, "suggested" | "decided">): number => (c.suggested ? Math.round((100 * c.decided) / c.suggested) : 0);

// ---------------------------------------------------------------------------
// The notice list (README §2 "Notice queue item")
// ---------------------------------------------------------------------------

export type QueueNotice = {
  id: string;
  number: string | null;
  title: string;
  /** ISO date of the next deadline, or null when the notice has none published. */
  dueDate: string | null;
  /** Days from today to `dueDate`. */
  dueDays: number | null;
  /** Limited submission (a published overlay names this notice). */
  limited: boolean;
  counts: NoticeCounts;
  /** R35: disagreements the viewer has not settled, and disagreements of any kind, among this notice's decisions. */
  calls: number;
  disagreements: number;
};

/** Pure. "14 days" · "today" · "1 day" — or "no date" when the notice has none. */
export function dueWords(days: number | null): string {
  if (days == null) return "no date";
  if (days <= 0) return days === 0 ? "today" : "passed";
  return `${days} day${days === 1 ? "" : "s"}`;
}

/** Pure. The list's red: a deadline inside 30 days — `dueDisplay`'s own boundary, not a new one. */
export const dueUrgent = (days: number | null): boolean => days != null && days <= 30;

/**
 * Pure. "Notices are ordered by what forces a decision (deadline, limited
 * submission)": a limited submission first — the institution must choose —
 * then the nearest deadline, notices with no date last, ties by number.
 */
export function orderQueue<T extends Pick<QueueNotice, "limited" | "dueDate" | "number">>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.limited !== b.limited) return a.limited ? -1 : 1;
    if ((a.dueDate ?? "") !== (b.dueDate ?? "")) {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate < b.dueDate ? -1 : 1;
    }
    return (a.number ?? "").localeCompare(b.number ?? "");
  });
}

// ---------------------------------------------------------------------------
// The notice header (README §2 "Notice header card")
// ---------------------------------------------------------------------------

/** Pure. The title without its trailing mechanism parenthetical: "… (ADRN) (U19 Clinical Trial Optional)" → "… (ADRN)". The regex is the opportunity page's own. */
export function cardTitleOf(title: string): string {
  return title.replace(/\s*\(([A-Z]{1,2}\d{2})[^)]*\)\s*$/, "").trim() || title;
}

export type PursuitVerdict = { verdict: string; tone: "good" | "caution"; line: string };

const n = (count: number, one: string, many: string = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/**
 * Pure. The notice-level line under the title. The prototype's sample data
 * carried a hand-written verdict; the product has no notice-level judge, so
 * this says only what the engine's tiers and the notice's dates establish: a
 * Strong match makes the notice "Worth pursuing", Moderate alone makes it
 * "Worth a look", and the line beneath is the counts and the dates in words.
 * Nothing here is an opinion the data does not hold.
 */
export function pursuitVerdict(input: { byTier: Record<Tier, number>; dueDays: number | null; routingDays: number | null; limited: boolean; cap: number | null }): PursuitVerdict {
  const { byTier } = input;
  const good = byTier.strong > 0;
  const parts: string[] = [];
  const matches = [byTier.strong ? n(byTier.strong, "strong match", "strong matches") : null, byTier.moderate ? n(byTier.moderate, "moderate match", "moderate matches") : null].filter(Boolean);
  let first = matches.length ? `${matches.join(" and ")} in the directory` : "No match above the bar in the directory";
  if (byTier.exploratory) first += `, plus ${n(byTier.exploratory, "exploratory lead")}`;
  parts.push(`${first}.`);
  if (input.dueDays != null) {
    const due = input.dueDays > 0 ? `Deadline in ${dueWords(input.dueDays)}` : input.dueDays === 0 ? "Deadline is today" : "The deadline has passed";
    const routing = input.routingDays != null && input.routingDays > 0 ? `; internal routing in ${dueWords(input.routingDays)}` : "";
    parts.push(`${due}${routing}.`);
  } else parts.push("No deadline is published yet.");
  if (input.limited) parts.push(input.cap ? `Limited submission — ${input.cap} per institution.` : "Limited submission.");
  return { verdict: good ? "Worth pursuing" : "Worth a look", tone: good ? "good" : "caution", line: parts.join(" ") };
}

/** Pure. The pill beside the number once the notice is decided: "Pursuing · 1 confirmed" while anything is confirmed; "Not pursuing" once every row is dismissed; nothing before. */
export function noticeVerdictPill(c: Pick<NoticeCounts, "confirmed" | "rejected" | "undecided" | "watching">): { text: string; tone: "good" | "plain" } | null {
  if (c.confirmed > 0) return { text: `Pursuing · ${c.confirmed} confirmed`, tone: "good" };
  if (c.undecided === 0 && c.watching === 0 && c.rejected > 0) return { text: "Not pursuing", tone: "plain" };
  return null;
}

export type KeyStat = { value: string; label: string; urgent: boolean };

/** "$2.5M", "$275k", "$750". */
export function money(amount: number | null | undefined): string | null {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return null;
  if (amount >= 1_000_000) return `$${trim(amount / 1_000_000)}M`;
  if (amount >= 1_000) return `$${trim(amount / 1_000)}k`;
  return `$${Math.round(amount)}`;
}
const trim = (x: number): string => (Number.isInteger(x) ? String(x) : x.toFixed(1).replace(/\.0$/, ""));

/** Pure. The three key-date stats: deadline, internal routing, award. */
export function keyStats(input: { dueDate: string | null; dueDays: number | null; routingDate: string | null; routingDays: number | null; ceilingPerYear: number | null; periodYears: number | null; today: string }): KeyStat[] {
  const deadline: KeyStat = input.dueDate ? { value: fmtMonD(input.dueDate, input.today), label: `deadline · ${dueWords(input.dueDays)}`, urgent: dueUrgent(input.dueDays) } : { value: "—", label: "deadline · not published", urgent: false };
  const routing: KeyStat = input.routingDate ? { value: fmtMonD(input.routingDate, input.today), label: `internal routing · ${dueWords(input.routingDays)}`, urgent: dueUrgent(input.routingDays) } : { value: "—", label: "internal routing", urgent: false };
  const ceiling = money(input.ceilingPerYear);
  const award: KeyStat = ceiling
    ? { value: `${ceiling} / yr`, label: input.periodYears ? `${n(input.periodYears, "year")} · ${money((input.ceilingPerYear ?? 0) * input.periodYears)} total` : "award ceiling · per year", urgent: false }
    : { value: "Not stated", label: "award ceiling", urgent: false };
  return [deadline, routing, award];
}

/** Pure. "U19 cooperative agreement · letter of intent passed Sep 3 · 1 per institution". */
export function noticeMetaLine(input: { activityCode: string | null; instrument: string | null; loiDue: string | null; loiNote: string | null; limited: boolean; cap: number | null; today: string }): string {
  const mechanism = [input.activityCode?.trim() || null, input.instrument?.trim().replace(/_/g, " ").toLowerCase() || null].filter(Boolean).join(" ");
  const loi = input.loiDue ? `letter of intent ${input.loiDue < input.today ? "passed" : "due"} ${fmtMonD(input.loiDue, input.today)}` : input.loiNote?.trim() ? `letter of intent · ${input.loiNote.trim().toLowerCase()}` : "no letter of intent";
  const submissions = input.limited ? (input.cap ? `${input.cap} per institution` : "limited submission") : null;
  return [mechanism || null, loi, submissions].filter(Boolean).join(" · ");
}

/** Pure. The internal routing date and its distance, from the team's rule; none without a deadline. */
export function routingOf(dueDate: string | null, rule: RoutingRule | null, today: string, internalRoutingDate: (dueIso: string, rule: RoutingRule) => string): { date: string | null; days: number | null } {
  if (!dueDate || !rule) return { date: null, days: null };
  const date = internalRoutingDate(dueDate, rule);
  return { date, days: daysBetween(today, date) };
}

/** Pure. The day a Watch returns the match: 30 days before the deadline, or never when that day is already here or the notice has no date. */
export function watchResurfaceOn(dueDate: string | null, today: string, shiftIso: (iso: string, days: number) => string): string | null {
  if (!dueDate) return null;
  const on = shiftIso(dueDate, -WATCH_RETURNS_DAYS_BEFORE);
  return on > today ? on : null;
}

/**
 * Pure. The rank as the identity line may print it. The directory's `rank`
 * column holds whatever the import mapped there — for the ImmunoX roster that
 * is a membership role (`member`, `leadership_committee`), which is not a rank
 * and would read as one. Only a string that names an academic rank survives.
 */
export function academicRank(rank: string | null | undefined): string | null {
  const r = rank?.trim() ?? "";
  if (!r || r.includes("_")) return null;
  return /\b(professor|instructor|lecturer|fellow|scientist|investigator|director|chair|dean|emerit)/i.test(r) ? r : null;
}

// ---------------------------------------------------------------------------
// The rows card's chrome
// ---------------------------------------------------------------------------

/** Pure. The bulk banner's sentence. */
export function bulkNoteText(note: { n: number; whole: boolean }): string {
  if (note.whole) return `Notice dismissed — ${n(note.n, "suggested person", "suggested people")} cleared with it.`;
  return `That reason is about the notice, not the person, so ${n(note.n, "other match", "other matches")} here ${note.n === 1 ? "was" : "were"} cleared too.`;
}

/** "Dismiss all 4 matches" — over the undecided rows; "Undo" once there is nothing left to dismiss and a bulk clear stands. */
export function dismissAllLabel(undecided: number): string {
  return `Dismiss all ${undecided} ${undecided === 1 ? "match" : "matches"}`;
}

/**
 * Pure. The footer's left-hand line. The prototype's "2 ruled out on
 * eligibility" is one of three facts the loader has: how many pairs the engine
 * ruled out on eligibility, how many fell below the floors, and how many
 * Exploratory rows the cap left unlisted. Each is said only when non-zero.
 */
export function footerLine(input: { ruledOutEligibility: number; belowFloors: number; hiddenExploratory: number }): string | null {
  const parts: string[] = [];
  if (input.ruledOutEligibility) parts.push(`${n(input.ruledOutEligibility, "person", "people")} ruled out on eligibility`);
  if (input.belowFloors) parts.push(`${input.belowFloors} below the bar`);
  if (input.hiddenExploratory) parts.push(`${n(input.hiddenExploratory, "more exploratory lead")} not listed`);
  return parts.length ? `${parts.join(" · ")}.` : null;
}

/** Pure. The queued bar's sentence — and the copy rule: "Nothing has been sent." */
export function queuedLine(confirmed: number): string {
  return `${n(confirmed, "match", "matches")} confirmed and queued for outreach. Nothing has been sent.`;
}

// ---------------------------------------------------------------------------
// The cursor (README §"Interactions & behaviour" `decide`)
// ---------------------------------------------------------------------------

/** Pure. The index of the next undecided row after `from`, wrapping; `from` itself is a candidate last; null when every row is decided. */
export function nextUndecided(rows: ReadonlyArray<{ undecided: boolean }>, from: number): number | null {
  const len = rows.length;
  if (!len) return null;
  for (let step = 1; step <= len; step++) {
    const i = (from + step) % len;
    if (rows[i]!.undecided) return i;
  }
  return null;
}

/** Pure. The first undecided row, or 0. */
export function firstUndecided(rows: ReadonlyArray<{ undecided: boolean }>): number {
  const i = rows.findIndex((r) => r.undecided);
  return i < 0 ? 0 : i;
}

/** Pure. J / K: one step, clamped — the list does not wrap on a key. */
export function stepCursor(cursor: number, delta: 1 | -1, length: number): number {
  if (!length) return 0;
  return Math.min(length - 1, Math.max(0, cursor + delta));
}
