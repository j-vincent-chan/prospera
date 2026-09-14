/**
 * Today (design_handoff_prospera_review_outreach README §1) — the Home page's
 * copy and class table, as pure functions of the day's records. Three queues,
 * each with one button that starts it; an aside of what was filed without a
 * match; the office's other business under it.
 *
 * `today-view.test.ts` keeps the invariant the other tables keep: `cn` joins,
 * so no string names one utility group twice, and the design's measurements
 * (14px 18px card headers, 11px 18px rows, 30px CTAs, 28px "See all") are
 * values here rather than choices at the call site.
 */
import { cardTitleOf, dueWords, type QueueNotice } from "@/lib/review/queue";
import { fmtMonD } from "@/lib/funding-opportunities/receipt-cycles";
import type { MatchRow } from "@/lib/outreach/matches";

export type TodayPillTone = "danger" | "good" | "warn" | "plain";
export type TodayPill = { text: string; tone: TodayPillTone };

export type TodayItem = { key: string; title: string; meta: string; pill: TodayPill | null; href: string };

export type TodayCard = {
  key: "decide" | "answer" | "follow";
  title: string;
  sub: string;
  cta: { label: string; href: string; kind: "primary" | "secondary" };
  items: TodayItem[];
  /** What the card says with no items. */
  empty: string;
};

export type FiledKind = "none" | "exploratory" | "unscored" | "not_open" | "engine_off";

export type FiledNotice = { id: string; title: string; reason: string; href: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "Overnight" → "overnight", "Since Sep 10" → "since Sep 10" — mid-sentence. */
const mid = (since: string) => (since === "Overnight" ? "overnight" : since.replace(/^Since/, "since"));

// ---------------------------------------------------------------------------
// The header
// ---------------------------------------------------------------------------

/** "Saturday, September 13" — the app's own en-US date, not the brief's "Monday, 10 September". */
export function dateLine(now: Date): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Los_Angeles" }).format(now);
}

/** "Overnight" when the window opened inside the last 36 hours, else "Since Sep 10". */
export function sinceLabel(sinceIso: string, now: Date, today: string): string {
  const hours = (now.getTime() - new Date(sinceIso).getTime()) / 3_600_000;
  return hours < 36 ? "Overnight" : `Since ${fmtMonD(sinceIso.slice(0, 10), today)}`;
}

/** The sentence under the date: what arrived, what it produced, and that nothing went out on its own. */
export function overnightLine(input: { since: string; newNotices: number; matched: number; filed: number; sent: number }): string {
  const arrived = input.newNotices ? `${plural(input.newNotices, "new notice")}. ${input.matched} produced ${input.matched === 1 ? "a match" : "matches"}, ${input.filed} produced none and ${input.filed === 1 ? "was" : "were"} filed.` : "no new notices.";
  const sent = input.sent ? `${plural(input.sent, "message")} went out ${mid(input.since)}, each sent by hand.` : "Nothing has been sent.";
  return `${input.since}: ${arrived} ${sent}`;
}

// ---------------------------------------------------------------------------
// Decide on new matches
// ---------------------------------------------------------------------------

/** "7 waiting across 3 notices · 22 arrived overnight, 8 produced matches" */
export function decideSub(input: { undecided: number; notices: number; newNotices: number; matched: number; since: string }): string {
  const waiting = input.undecided ? `${input.undecided} waiting across ${plural(input.notices, "notice")}` : "Nothing waiting";
  const arrivedWord = `arrived ${mid(input.since)}`;
  return `${waiting} · ${input.newNotices} ${arrivedWord}, ${input.matched} produced ${input.matched === 1 ? "a match" : "matches"}`;
}

/** Pure. One queued notice as a row: what is waiting on it, what forces the decision, and the tag. */
export function decideItem(n: QueueNotice, extra: { activityCode: string | null; arrived: boolean }): TodayItem {
  const c = n.counts;
  const strength = c.byTier.strong ? `${c.byTier.strong} strong` : c.byTier.moderate ? `${c.byTier.moderate} moderate` : null;
  const closes = n.dueDays == null ? null : n.dueDays === 0 ? "closes today" : n.dueDays < 0 ? "closed" : `closes in ${dueWords(n.dueDays)}`;
  const meta = [`${c.suggested} suggested`, strength, n.limited ? "limited submission" : null, closes].filter(Boolean).join(" · ");
  const pill: TodayPill | null = n.limited || (n.dueDays != null && n.dueDays <= 14) ? { text: "Do this first", tone: "danger" } : extra.arrived ? { text: "New", tone: "good" } : n.dueDays != null ? { text: dueWords(n.dueDays), tone: "plain" } : null;
  return { key: `decide-${n.id}`, title: `${cardTitleOf(n.title)}${extra.activityCode ? ` — ${extra.activityCode}` : ""}`, meta, pill, href: `/review?notice=${n.id}` };
}

// ---------------------------------------------------------------------------
// Answer a PI
// ---------------------------------------------------------------------------

/** "2 replies since Fri" — or "2 replies waiting" when no reply carries a day. */
export function answerSub(input: { replies: number; dated: number; since: string }): string {
  if (!input.replies) return "No replies waiting";
  const word = plural(input.replies, "reply", "replies");
  return input.dated ? `${word} ${mid(input.since)}` : `${word} waiting`;
}

const REPLY_WORD: Record<string, string> = { replied_interested: "interested in", replied_maybe: "maybe on", replied_not_now: "not this cycle on" };

/** Pure. A reply as a row: who said what about which notice, when, and how long it has waited. */
export function answerItem(row: MatchRow, today: string): TodayItem {
  const reply = row.thread.find((t) => t.kind === "reply") ?? null;
  const dated = reply && !/day not recorded/.test(reply.head) ? reply.when.slice(0, 10) : null;
  const days = dated ? Math.max(0, Math.round((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${dated}T00:00:00Z`).getTime()) / 86_400_000)) : null;
  const meta = `${dated ? `Replied ${fmtMonD(dated, today)}` : "Reply day not recorded"}${reply?.body ? ` · ${reply.body}` : ""}`;
  const pill: TodayPill = row.view.state === "replied_not_now" ? { text: "Close the loop", tone: "plain" } : days == null ? { text: "Waiting", tone: "warn" } : days === 0 ? { text: "Replied today", tone: "good" } : { text: `${plural(days, "day")} waiting`, tone: "warn" };
  return { key: `answer-${row.recipientId}`, title: `${row.name} — ${REPLY_WORD[row.view.state] ?? "replied on"} ${row.noticeTitle}`, meta, pill, href: "/outreach" };
}

// ---------------------------------------------------------------------------
// Follow up
// ---------------------------------------------------------------------------

/** "1 overdue, 1 scheduled" */
export function followSub(input: { overdue: number; scheduled: number }): string {
  if (!input.overdue && !input.scheduled) return "Nothing to follow up";
  return `${input.overdue} overdue, ${input.scheduled} scheduled`;
}

/** Pure. A sent message with no reply, a nudge that is due on a day, or a next step that has come due. Null for a row that is none of those. */
export function followItem(row: MatchRow, today: string): { item: TodayItem; kind: "overdue" | "scheduled" } | null {
  const sent = row.thread.find((t) => t.kind === "sent") ?? null;
  const sentLine = sent ? `sent ${sent.head.replace(/ · (.+) sent$/, (_m, who: string) => ` by ${who}`)}` : null;
  const notice = row.noticeNumber ? `${row.noticeNumber} · ${row.noticeTitle}` : row.noticeTitle;
  if (row.view.state === "sent_no_reply") {
    const days = row.view.pill.text.match(/(\d+) days?/)?.[1] ?? row.view.next.text.match(/(\d+) days?/)?.[1] ?? null;
    return { kind: "overdue", item: { key: `follow-${row.recipientId}`, title: `${row.name} — no reply${days ? ` after ${plural(Number(days), "day")}` : ""}`, meta: `${notice}${row.routingDate ? ` · internal routing is ${fmtMonD(row.routingDate, today)}` : ""}`, pill: { text: "Nudge", tone: "danger" }, href: "/outreach" } };
  }
  if (row.view.state === "sent_waiting") {
    const day = row.view.next.text.replace(/^Nudge on /, "");
    return { kind: "scheduled", item: { key: `follow-${row.recipientId}`, title: `${row.name} — nudge due ${day}`, meta: `${notice}${sentLine ? ` · ${sentLine}` : ""}`, pill: { text: day, tone: "plain" }, href: "/outreach" } };
  }
  if ((row.view.state === "pursuing" || row.view.state === "submitted") && row.view.next.urgent) {
    return { kind: "overdue", item: { key: `follow-${row.recipientId}`, title: `${row.name} — ${row.view.next.text}`, meta: notice, pill: { text: "Due", tone: "warn" }, href: "/outreach" } };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Filed without a match
// ---------------------------------------------------------------------------

/** "14 notices produced no match above the bar. They stay searchable on the Notice Board; they do not enter the queue." */
export function filedLine(input: { filed: number; newNotices: number; since: string }): string {
  if (!input.newNotices) return `No new notices ${mid(input.since)}.`;
  if (!input.filed) return "Every new notice produced a match above the bar.";
  return `${plural(input.filed, "notice")} produced no match above the bar. ${input.filed === 1 ? "It stays" : "They stay"} searchable on the Notice Board; ${input.filed === 1 ? "it does" : "they do"} not enter the queue.`;
}

const FILED_REASON: Record<FiledKind, string> = {
  none: "no one above the bar",
  exploratory: "exploratory leads only, below the bar",
  unscored: "not assessed yet",
  not_open: "not open for applications",
  engine_off: "assessment is off for this team",
};

/** "USDA Forest Service · no one above the bar" */
export function filedReason(kind: FiledKind, agency: string | null): string {
  return [agency, FILED_REASON[kind]].filter(Boolean).join(" · ");
}

export function seeAllLabel(n: number): string {
  return `See all ${n}`;
}

export const FILED_HREF = "/opportunities?scope=all&sort=posted_date&order=desc";

// ---------------------------------------------------------------------------
// Class table
// ---------------------------------------------------------------------------

export const PAGE = "mx-auto w-full max-w-[1720px]";
export const H1 = "m-0 text-h1 font-semibold tracking-[-0.02em] text-ink";
export const SUB = "mb-0 mt-1.5 text-body text-ink-muted";
export const STALE = "mt-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-danger-border bg-danger-tint px-4 py-3 text-dense leading-normal text-danger-dark";
export const STALE_LINK = "whitespace-nowrap font-medium text-danger-dark";
export const LAYOUT = "mt-[18px] flex flex-nowrap items-start gap-[clamp(12px,1.4vw,20px)]";
export const MAIN = "flex min-w-[min(320px,100%)] flex-1 flex-col gap-3.5";
export const ASIDE = "sticky top-[60px] flex w-[clamp(200px,19vw,340px)] shrink-0 flex-col gap-3.5 self-start";

export const CARD = "overflow-hidden rounded-card border border-line bg-card";
export const CARD_HEAD = "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-[18px] py-3.5";
export const CARD_TITLE = "m-0 flex flex-wrap items-baseline gap-x-2.5 text-[15px] font-semibold text-ink";
export const CARD_SUB = "text-meta font-normal text-ink-muted";
export const CTA = { primary: "inline-flex h-[30px] shrink-0 items-center whitespace-nowrap rounded-control border border-navy bg-navy px-3 text-dense font-medium text-white hover:bg-navy-hover", secondary: "inline-flex h-[30px] shrink-0 items-center whitespace-nowrap rounded-control border border-line-control bg-card px-3 text-dense font-medium text-ink hover:bg-canvas" } as const;
export const ROW = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3.5 border-t border-line-row px-[18px] py-[11px]";
export const ROW_BODY = "min-w-0";
export const ROW_TITLE = "block truncate text-dense font-medium text-ink hover:text-teal";
export const ROW_META = "mb-0 mt-0.5 truncate text-meta text-ink-muted";
export const EMPTY = "m-0 border-t border-line-row px-[18px] py-4 text-dense text-ink-muted";

export const ASIDE_CARD = "rounded-card border border-line bg-card px-[18px] py-4";
export const EYEBROW = "m-0 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted";
export const ASIDE_LINE = "mb-0 mt-2.5 text-dense leading-normal text-ink-body";
export const FILED_ITEM = "border-t border-line-row py-2.5 first:border-t-0";
export const FILED_TITLE = "block text-meta font-medium leading-[1.4] text-ink hover:text-teal";
export const FILED_REASON_LINE = "mb-0 mt-0.5 text-micro leading-[1.4] text-ink-muted";
export const FILED_LIST = "mt-2.5";
export const SEE_ALL = "mt-2 inline-flex h-7 items-center rounded-control border border-line-control bg-card px-2.5 text-dense font-medium text-ink hover:bg-canvas";
export const ALSO_ITEM = "flex items-start justify-between gap-3 border-t border-line-row py-2.5 first:border-t-0";
export const ALSO_TITLE = "block text-meta font-medium leading-[1.4] text-ink hover:text-teal";
export const ALSO_META = "mb-0 mt-0.5 text-micro leading-[1.4] text-ink-muted";
export const ALSO_WHEN = "shrink-0 whitespace-nowrap text-micro font-medium";
export const ALSO_WHEN_TONE = { danger: "text-danger", warning: "text-warning", teal: "text-teal", neutral: "text-ink-muted" } as const;
