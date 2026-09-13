/**
 * Outreach re-based on matches (design_handoff_prospera_review_outreach README
 * §5). Pure: a match's stored facts in, the row the board draws out — which
 * group it sits in, its state pill, its next step and the verbs it offers.
 *
 * The board's unit is the match: one investigator on one notice, which is an
 * `outreach_recipients` row. The notice's own `outreach_items.stage` still
 * exists for the surfaces that read it; here it matters only as "parked",
 * which takes every match on the notice off the board.
 *
 * Three groups, by what the match needs from the strategist:
 *
 *   - **Needs you today** — a reply to answer, a nudge that is due (a send
 *     older than the team's reply window with no reply), a bounce, or a
 *     confirmed match with no message yet ("Ready to send").
 *   - **Waiting on a PI** — sent, inside the reply window.
 *   - **In progress** — the PI said yes; the match is pursuing or submitted.
 *
 * Declined matches, and matches parked, closed or with an outcome recorded,
 * are not rows: nothing is owed on them.
 */
import { daysBetween, fmtMonD } from "@/lib/funding-opportunities/receipt-cycles";
import type { Outcome, OutreachStage, RecipientStatus } from "@/lib/outreach/types";
import { OUTCOME_LABEL } from "@/lib/outreach/types";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export type PursuitStage = "pursuing" | "submitted" | "outcome" | "parked" | "closed";
export const PURSUIT_STAGES: readonly PursuitStage[] = ["pursuing", "submitted", "outcome", "parked", "closed"];
export const isPursuitStage = (v: unknown): v is PursuitStage => typeof v === "string" && (PURSUIT_STAGES as readonly string[]).includes(v);

export type MatchGroup = "now" | "waiting" | "progress";
export const GROUP_ORDER: readonly MatchGroup[] = ["now", "waiting", "progress"];
export const GROUP_TITLE: Record<MatchGroup, string> = { now: "Needs you today", waiting: "Waiting on a PI", progress: "In progress" };

/** The group header's one-line explanation. */
export function groupSub(group: MatchGroup, replyWindowDays: number): string {
  switch (group) {
    case "now":
      return "a reply to answer, a nudge that is due, or a confirmed match with no message yet";
    case "waiting":
      return `sent, inside the ${replyWindowDays}-day reply window`;
    default:
      return "the PI said yes — Prospera only records what happens next";
  }
}

export type MatchState = "ready" | "sent_no_reply" | "sent_waiting" | "replied_interested" | "replied_maybe" | "replied_not_now" | "bounced" | "pursuing" | "submitted";

export type PillTone = "good" | "warn" | "plain" | "new" | "danger";

export type MatchActionId = "draft" | "nudge" | "log_reply" | "log_no_reply" | "mark_pursuing" | "log_call" | "hand_to_osr" | "record_submitted" | "record_outcome" | "park" | "close" | "unconfirm";

export type MatchAction = { id: MatchActionId; label: string; kind: "primary" | "secondary" };

export type MatchView = {
  state: MatchState;
  group: MatchGroup;
  pill: { text: string; tone: PillTone };
  next: { text: string; urgent: boolean };
  actions: MatchAction[];
};

// ---------------------------------------------------------------------------
// One match
// ---------------------------------------------------------------------------

export type MatchInput = {
  status: RecipientStatus;
  /** ISO timestamp of the last send. */
  contactedAt: string | null;
  pursuitStage: PursuitStage | null;
  /** The strategist's own next step, when set; the board composes one otherwise. */
  nextStep: string | null;
  nextStepDate: string | null;
  itemStage: OutreachStage;
  /** Internal routing date for the notice, from the team's rule. */
  routingDate: string | null;
  /** A Review confirmation stands on this pair — "Unconfirm" rather than "Remove". */
  confirmed: boolean;
  replyWindowDays: number;
  today: string;
};

const LABEL: Record<MatchActionId, string> = {
  draft: "Draft the message",
  nudge: "Send a nudge",
  log_reply: "Log a reply",
  log_no_reply: "Log no reply",
  mark_pursuing: "Mark pursuing",
  log_call: "Log a call",
  hand_to_osr: "Hand to OSR",
  record_submitted: "Record submitted",
  record_outcome: "Record outcome",
  park: "Park",
  close: "Close · not this cycle",
  unconfirm: "Unconfirm",
};

const act = (ids: MatchActionId[], confirmed: boolean): MatchAction[] =>
  ids.map((id, i) => ({ id, label: id === "unconfirm" && !confirmed ? "Remove from outreach" : LABEL[id], kind: i === 0 ? "primary" : "secondary" }));

/** Pure. The verbs a state offers, the first of them primary. Every one is a mechanism that exists. */
export function actionsFor(state: MatchState, confirmed: boolean): MatchAction[] {
  switch (state) {
    case "ready":
      return act(["draft", "unconfirm"], confirmed);
    case "sent_no_reply":
      return act(["nudge", "log_reply", "log_no_reply", "park"], confirmed);
    case "sent_waiting":
      return act(["log_reply", "nudge", "park"], confirmed);
    case "replied_interested":
      return act(["mark_pursuing", "log_call", "hand_to_osr", "close"], confirmed);
    case "replied_maybe":
      return act(["log_call", "mark_pursuing", "close"], confirmed);
    case "replied_not_now":
      return act(["close", "log_call", "park"], confirmed);
    case "bounced":
      return act(["log_reply", "close"], confirmed);
    case "pursuing":
      return act(["record_submitted", "log_call", "hand_to_osr", "park"], confirmed);
    case "submitted":
      return act(["record_outcome", "log_call"], confirmed);
  }
}

const dayOf = (iso: string): string => iso.slice(0, 10);
const shift = (iso: string, days: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Pure. The row for one match, or null when the match is not on the board:
 * declined, on a parked notice, or itself parked, closed or with an outcome
 * recorded.
 */
export function matchView(m: MatchInput): MatchView | null {
  if (m.itemStage === "parked") return null;
  if (m.pursuitStage === "parked" || m.pursuitStage === "closed" || m.pursuitStage === "outcome") return null;
  if (m.status === "declined") return null;

  const own = m.nextStep?.trim() ? { text: m.nextStepDate ? `${m.nextStep.trim()} ${fmtMonD(m.nextStepDate, m.today)}` : m.nextStep.trim(), urgent: Boolean(m.nextStepDate && m.nextStepDate <= m.today) } : null;

  if (m.pursuitStage === "pursuing") {
    const next = own ?? (m.routingDate ? { text: `OSR routing ${fmtMonD(m.routingDate, m.today)}`, urgent: daysBetween(m.today, m.routingDate) <= 7 } : { text: "Log the next step", urgent: false });
    return { state: "pursuing", group: "progress", pill: { text: "Pursuing", tone: "good" }, next, actions: actionsFor("pursuing", m.confirmed) };
  }
  if (m.pursuitStage === "submitted") {
    return { state: "submitted", group: "progress", pill: { text: "Submitted", tone: "good" }, next: own ?? { text: "Record the outcome", urgent: false }, actions: actionsFor("submitted", m.confirmed) };
  }

  switch (m.status) {
    case "selected":
      return { state: "ready", group: "now", pill: { text: "Ready to send", tone: "new" }, next: own ?? { text: "Draft the message", urgent: true }, actions: actionsFor("ready", m.confirmed) };
    case "contacted": {
      const sentDay = m.contactedAt ? dayOf(m.contactedAt) : m.today;
      const days = Math.max(0, daysBetween(sentDay, m.today));
      if (days >= m.replyWindowDays) {
        return { state: "sent_no_reply", group: "now", pill: { text: "Sent · no reply", tone: "warn" }, next: own ?? { text: `Nudge — ${days} day${days === 1 ? "" : "s"}`, urgent: true }, actions: actionsFor("sent_no_reply", m.confirmed) };
      }
      return { state: "sent_waiting", group: "waiting", pill: { text: days === 0 ? "Sent · today" : `Sent · ${days} day${days === 1 ? "" : "s"}`, tone: "plain" }, next: own ?? { text: `Nudge on ${fmtMonD(shift(sentDay, m.replyWindowDays), m.today)}`, urgent: false }, actions: actionsFor("sent_waiting", m.confirmed) };
    }
    case "replied_interested":
      return { state: "replied_interested", group: "now", pill: { text: "Replied · interested", tone: "good" }, next: own ?? { text: "Book scoping call", urgent: true }, actions: actionsFor("replied_interested", m.confirmed) };
    case "replied_maybe":
      return { state: "replied_maybe", group: "now", pill: { text: "Replied · maybe", tone: "plain" }, next: own ?? { text: "Answer their question", urgent: true }, actions: actionsFor("replied_maybe", m.confirmed) };
    case "replied_not_now":
      return { state: "replied_not_now", group: "now", pill: { text: "Replied · not now", tone: "plain" }, next: own ?? { text: "Close the loop", urgent: false }, actions: actionsFor("replied_not_now", m.confirmed) };
    case "bounced":
      return { state: "bounced", group: "now", pill: { text: "Bounced", tone: "danger" }, next: own ?? { text: "Find a working address", urgent: true }, actions: actionsFor("bounced", m.confirmed) };
    default:
      return null;
  }
}

/** The order rows take inside a group: what needs a decision first. */
const STATE_ORDER: Record<MatchState, number> = { ready: 0, replied_interested: 1, replied_maybe: 2, bounced: 3, sent_no_reply: 4, replied_not_now: 5, sent_waiting: 6, pursuing: 7, submitted: 8 };

export type MatchRow = {
  recipientId: string;
  itemId: string;
  investigatorId: string;
  opportunityId: string;
  name: string;
  /** "Pathology · ImmunoX" */
  dept: string | null;
  noticeTitle: string;
  noticeNumber: string | null;
  dueDate: string | null;
  dueDays: number | null;
  ownerId: string | null;
  ownerName: string;
  view: MatchView;
  thread: ThreadEntry[];
  /** "Confirmed Sep 2 as a Strong match · science is right. Internal routing Sep 17." */
  carried: string;
  confirmed: boolean;
  routingDate: string | null;
  /** The notice's compose tab — "Draft the message" and "Send a nudge" open it. */
  composeHref: string;
};

/** One line of a match's thread: `head` is who did what and when ("Sep 2 · you sent"), `body` the subject, note or reply text. */
export type ThreadEntry = { when: string; kind: "sent" | "reply" | "note"; head: string; body: string | null };

/** Pure. Rows in a group, most pressing first: state order, then the nearer deadline, then the name. */
export function sortRows(rows: readonly MatchRow[]): MatchRow[] {
  return [...rows].sort((a, b) => STATE_ORDER[a.view.state] - STATE_ORDER[b.view.state] || (a.dueDate ?? "9999") .localeCompare(b.dueDate ?? "9999") || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Filters (README §5: Everything · Mine · Deadline inside 30 days · No reply in N days)
// ---------------------------------------------------------------------------

export type MatchFilter = "all" | "mine" | "deadline30" | "noreply";
export const FILTER_ORDER: readonly MatchFilter[] = ["all", "mine", "deadline30", "noreply"];

export function filterLabel(filter: MatchFilter, replyWindowDays: number): string {
  switch (filter) {
    case "all":
      return "Everything";
    case "mine":
      return "Mine";
    case "deadline30":
      return "Deadline inside 30 days";
    default:
      return `No reply in ${replyWindowDays} days`;
  }
}

export function matchesFilter(row: Pick<MatchRow, "ownerId" | "dueDays" | "view">, filter: MatchFilter, viewerId: string): boolean {
  switch (filter) {
    case "all":
      return true;
    case "mine":
      return row.ownerId === viewerId;
    case "deadline30":
      return row.dueDays != null && row.dueDays >= 0 && row.dueDays <= 30;
    default:
      return row.view.state === "sent_no_reply";
  }
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

/** "3 need you today · 1 waiting on a reply · 2 in progress" */
export function headerLine(c: Record<MatchGroup, number>): string {
  return `${c.now} need${c.now === 1 ? "s" : ""} you today · ${c.waiting} waiting on a reply · ${c.progress} in progress`;
}

/** "3 matches" */
export const groupCount = (n: number): string => `${n} ${n === 1 ? "match" : "matches"}`;

/** "Draft outreach", or "Draft 2 messages" while confirmations are queued. */
export const draftLabel = (ready: number): string => (ready > 0 ? `Draft ${ready} ${ready === 1 ? "message" : "messages"}` : "Draft outreach");

/** The tier label as the carried line says it. */
const TIER_WORDS: Record<string, string> = { strong: "Strong match", moderate: "Moderate match", exploratory: "Exploratory", cannot_assess: "Can't assess", ruled_out: "Ruled out" };
const TAG_WORDS: Record<string, string> = { science_right: "science is right", timing_right: "timing is right", needs_money: "needs the money" };

/** Pure. "Carried from the match": the confirmation as Review recorded it, and the routing date. */
export function carriedLine(input: { confirmedAt: string | null; verdictLabel: string | null; tag: string | null; addedAt: string; origin: "you" | "suggested"; routingDate: string | null; today: string }): string {
  const parts: string[] = [];
  if (input.confirmedAt) {
    const tier = input.verdictLabel ? TIER_WORDS[input.verdictLabel] ?? input.verdictLabel : null;
    parts.push(`Confirmed ${fmtMonD(dayOf(input.confirmedAt), input.today)}${tier ? ` as a ${tier}` : ""}${input.tag && TAG_WORDS[input.tag] ? ` · ${TAG_WORDS[input.tag]}` : ""}.`);
  } else {
    parts.push(`${input.origin === "suggested" ? "Added from a suggestion" : "Added by hand"} ${fmtMonD(dayOf(input.addedAt), input.today)}.`);
  }
  if (input.routingDate) parts.push(`Internal routing ${fmtMonD(input.routingDate, input.today)}.`);
  return parts.join(" ");
}

/** Pure. The outcome's own words for the record. */
export const outcomeWords = (o: Outcome): string => OUTCOME_LABEL[o];
