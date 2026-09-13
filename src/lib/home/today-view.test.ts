/** Today (README §1): the page's copy, and the class-table invariant the other tables keep. */
import { describe, expect, it } from "vitest";
import * as view from "@/lib/home/today-view";
import type { MatchRow } from "@/lib/outreach/matches";
import type { QueueNotice } from "@/lib/review/queue";

const TODAY = "2026-09-13";
const NOW = new Date("2026-09-13T15:00:00Z");

const notice = (over: Partial<QueueNotice> = {}): QueueNotice => ({
  id: "n1",
  number: "RFA-AI-27-004",
  title: "Atopic Dermatitis Research Network (ADRN) (U19 Clinical Trial Optional)",
  dueDate: "2026-09-27",
  dueDays: 14,
  limited: true,
  calls: 0,
  disagreements: 0,
  counts: { suggested: 4, decided: 0, undecided: 4, confirmed: 0, rejected: 0, watching: 0, byTier: { strong: 1, moderate: 1, exploratory: 2, poor: 0 } } as QueueNotice["counts"],
  ...over,
});

const row = (over: Partial<MatchRow> & { state: MatchRow["view"]["state"]; next?: MatchRow["view"]["next"]; pillText?: string }): MatchRow => ({
  recipientId: "r1",
  itemId: "i1",
  investigatorId: "p1",
  opportunityId: "o1",
  name: "Abul K Abbas",
  dept: null,
  noticeTitle: "MIRA (R35)",
  noticeNumber: "PAR-27-112",
  dueDate: null,
  dueDays: null,
  ownerId: null,
  ownerName: "You",
  view: { state: over.state, group: "now", pill: { text: over.pillText ?? "", tone: "plain" }, next: over.next ?? { text: "", urgent: false }, actions: [] },
  thread: [],
  carried: "",
  confirmed: true,
  routingDate: null,
  composeHref: "/outreach/draft?match=r1",
  ...over,
});

describe("the header", () => {
  it("dates in the app's own format, and says what the window is", () => {
    expect(view.dateLine(NOW)).toBe("Sunday, September 13");
    expect(view.sinceLabel("2026-09-13T02:00:00Z", NOW, TODAY)).toBe("Overnight");
    expect(view.sinceLabel("2026-09-10T02:00:00Z", NOW, TODAY)).toBe("Since Sep 10");
  });
  it("the overnight line", () => {
    expect(view.overnightLine({ since: "Overnight", newNotices: 22, matched: 8, filed: 14, sent: 0 })).toBe("Overnight: 22 new notices. 8 produced matches, 14 produced none and were filed. Nothing has been sent.");
    expect(view.overnightLine({ since: "Since Sep 10", newNotices: 1, matched: 1, filed: 0, sent: 2 })).toBe("Since Sep 10: 1 new notice. 1 produced a match, 0 produced none and were filed. 2 messages went out since Sep 10, each sent by hand.");
    expect(view.overnightLine({ since: "Overnight", newNotices: 0, matched: 0, filed: 0, sent: 0 })).toBe("Overnight: no new notices. Nothing has been sent.");
  });
});

describe("Decide on new matches", () => {
  it("the sub and a row", () => {
    expect(view.decideSub({ undecided: 7, notices: 3, newNotices: 22, matched: 8, since: "Overnight" })).toBe("7 waiting across 3 notices · 22 arrived overnight, 8 produced matches");
    expect(view.decideSub({ undecided: 0, notices: 0, newNotices: 3, matched: 1, since: "Since Sep 10" })).toBe("Nothing waiting · 3 arrived since Sep 10, 1 produced a match");
    const item = view.decideItem(notice(), { activityCode: "U19", arrived: false });
    expect(item.title).toBe("Atopic Dermatitis Research Network (ADRN) — U19");
    expect(item.meta).toBe("4 suggested · 1 strong · limited submission · closes in 14 days");
    expect(item.pill).toEqual({ text: "Do this first", tone: "danger" });
    expect(item.href).toBe("/review?notice=n1");
  });
  it("New for what arrived, the due words otherwise", () => {
    expect(view.decideItem(notice({ limited: false, dueDays: 36, dueDate: "2026-10-19" }), { activityCode: null, arrived: true }).pill).toEqual({ text: "New", tone: "good" });
    expect(view.decideItem(notice({ limited: false, dueDays: 36, dueDate: "2026-10-19" }), { activityCode: null, arrived: false }).pill).toEqual({ text: "36 days", tone: "plain" });
    expect(view.decideItem(notice({ limited: false, dueDays: null, dueDate: null }), { activityCode: null, arrived: false }).pill).toBeNull();
  });
});

describe("Answer a PI", () => {
  it("the sub and a row", () => {
    expect(view.answerSub({ replies: 2, dated: 2, since: "Since Sep 10" })).toBe("2 replies since Sep 10");
    expect(view.answerSub({ replies: 3, dated: 0, since: "Overnight" })).toBe("3 replies waiting");
    expect(view.answerSub({ replies: 0, dated: 0, since: "Overnight" })).toBe("No replies waiting");
    const r = row({ state: "replied_interested", thread: [{ when: "2026-09-10T10:00:00Z", kind: "reply", head: "Sep 10 · Abul replied interested", body: "asked what the effort commitment looks like" }] });
    const item = view.answerItem(r, TODAY);
    expect(item.title).toBe("Abul K Abbas — interested in MIRA (R35)");
    expect(item.meta).toBe("Replied Sep 10 · asked what the effort commitment looks like");
    expect(item.pill).toEqual({ text: "3 days waiting", tone: "warn" });
  });
  it("not this cycle closes the loop; an undated reply waits", () => {
    expect(view.answerItem(row({ state: "replied_not_now" }), TODAY).pill).toEqual({ text: "Close the loop", tone: "plain" });
    const undated = view.answerItem(row({ state: "replied_interested", thread: [{ when: "2026-04-20T00:00:00Z", kind: "reply", head: "Abul replied interested · day not recorded", body: null }] }), TODAY);
    expect(undated.meta).toBe("Reply day not recorded");
    expect(undated.pill).toEqual({ text: "Waiting", tone: "warn" });
  });
});

describe("Follow up", () => {
  it("the sub", () => {
    expect(view.followSub({ overdue: 1, scheduled: 1 })).toBe("1 overdue, 1 scheduled");
    expect(view.followSub({ overdue: 0, scheduled: 0 })).toBe("Nothing to follow up");
  });
  it("no reply is a nudge; a send inside the window is scheduled on its day", () => {
    const overdue = view.followItem(row({ state: "sent_no_reply", pillText: "Sent · no reply", next: { text: "Nudge — 7 days", urgent: true }, routingDate: "2026-10-09", name: "Arun P Wiita", noticeTitle: "Understudied Proteins R03", noticeNumber: null }), TODAY)!;
    expect(overdue.kind).toBe("overdue");
    expect(overdue.item.title).toBe("Arun P Wiita — no reply after 7 days");
    expect(overdue.item.meta).toBe("Understudied Proteins R03 · internal routing is Oct 9");
    expect(overdue.item.pill).toEqual({ text: "Nudge", tone: "danger" });
    const scheduled = view.followItem(row({ state: "sent_waiting", pillText: "Sent · 5 days", next: { text: "Nudge on Sep 17", urgent: false }, name: "Brian B Graham", noticeTitle: "Genomic Variants R01", noticeNumber: null, thread: [{ when: "2026-09-08T10:00:00Z", kind: "sent", head: "Sep 8 · D. Reyes sent", body: "Funding opportunity: …" }] }), TODAY)!;
    expect(scheduled.kind).toBe("scheduled");
    expect(scheduled.item.title).toBe("Brian B Graham — nudge due Sep 17");
    expect(scheduled.item.meta).toBe("Genomic Variants R01 · sent Sep 8 by D. Reyes");
    expect(scheduled.item.pill).toEqual({ text: "Sep 17", tone: "plain" });
  });
  it("a due next step on a pursuit; nothing for a ready or replied row", () => {
    expect(view.followItem(row({ state: "pursuing", next: { text: "OSR routing Sep 17", urgent: true } }), TODAY)!.item.pill).toEqual({ text: "Due", tone: "warn" });
    expect(view.followItem(row({ state: "ready" }), TODAY)).toBeNull();
    expect(view.followItem(row({ state: "replied_interested" }), TODAY)).toBeNull();
  });
});

describe("Filed without a match", () => {
  it("the line and the reasons", () => {
    expect(view.filedLine({ filed: 14, newNotices: 22, since: "Overnight" })).toBe("14 notices produced no match above the bar. They stay searchable on the Notice Board; they do not enter the queue.");
    expect(view.filedLine({ filed: 1, newNotices: 1, since: "Overnight" })).toBe("1 notice produced no match above the bar. It stays searchable on the Notice Board; it does not enter the queue.");
    expect(view.filedLine({ filed: 0, newNotices: 2, since: "Overnight" })).toBe("Every new notice produced a match above the bar.");
    expect(view.filedLine({ filed: 0, newNotices: 0, since: "Since Sep 10" })).toBe("No new notices since Sep 10.");
    expect(view.filedReason("none", "USDA Forest Service")).toBe("USDA Forest Service · no one above the bar");
    expect(view.filedReason("unscored", null)).toBe("not assessed yet");
    expect(view.seeAllLabel(14)).toBe("See all 14");
  });
});

/** Every class string the module exports, including the ones inside records. */
function allStrings(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [name, value] of Object.entries(view)) {
    if (typeof value === "string" && /^[a-z[-]/.test(value) && value.includes(" ")) out.push([name, value]);
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) if (typeof v === "string") out.push([`${name}.${k}`, v]);
  }
  return out;
}

/** The same model `review-view.test.ts` uses. */
function utilityGroup(cls: string): string | null {
  const SIZES = ["h1", "title", "body", "dense", "meta", "micro", "section", "label", "stat", "stat-lg"];
  const WEIGHTS = ["thin", "extralight", "light", "normal", "medium", "semibold", "bold", "extrabold", "black"];
  if (cls.includes(":")) return null;
  if (cls.startsWith("text-")) {
    const rest = cls.slice(5);
    if (SIZES.includes(rest) || /^\[[\d.]+(?:px|rem|em)\]$/.test(rest)) return "font-size";
    if (["left", "center", "right", "justify", "start", "end", "balance", "pretty"].includes(rest)) return "text-align";
    return "color";
  }
  if (cls.startsWith("font-")) return WEIGHTS.includes(cls.slice(5)) ? "font-weight" : "font-family";
  if (cls === "border" || /^border-(?:[0-8]|\[[^\]]+\])$/.test(cls)) return "border-width";
  if (/^border-[trblxy](?:-|$)/.test(cls)) return `border-${cls.slice(7, 8)}`;
  if (cls.startsWith("border-")) return "border-color";
  if (cls.startsWith("bg-")) return "background";
  if (cls.startsWith("shadow")) return "shadow";
  if (cls.startsWith("rounded-")) {
    const m = cls.match(/^rounded-([trbl]|[tb][lr])(?:-|$)/);
    return m ? `rounded-${m[1]}` : "rounded";
  }
  for (const p of ["gap-x", "gap-y", "gap", "px", "py", "pt", "pr", "pb", "pl", "p", "mx", "my", "mt", "mr", "mb", "ml", "m", "grid-cols", "min-w", "max-w", "w", "h", "rounded", "leading", "tracking", "top", "line-clamp"]) {
    if (cls === p || cls.startsWith(`${p}-`)) return p;
  }
  return null;
}

describe("no class string names one utility group twice", () => {
  const strings = allStrings();
  it("sees the class table", () => {
    expect(strings.length).toBeGreaterThan(20);
  });
  for (const [name, value] of strings) {
    it(name, () => {
      const seen = new Map<string, string>();
      for (const cls of value.split(/\s+/).filter(Boolean)) {
        const g = utilityGroup(cls);
        if (!g) continue;
        expect(seen.has(g), `${name}: "${cls}" repeats group "${g}" after "${seen.get(g)}"`).toBe(false);
        seen.set(g, cls);
      }
    });
  }
});
