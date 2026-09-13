/** Outreach re-based on matches (`lib/outreach/matches.ts`). Pure; dates through a fixed `today`. */
import { describe, expect, it } from "vitest";
import { actionsFor, carriedLine, draftLabel, filterLabel, groupSub, headerLine, matchesFilter, matchView, sortRows, type MatchInput, type MatchRow } from "@/lib/outreach/matches";

const TODAY = "2026-09-13";
const base: MatchInput = { status: "selected", contactedAt: null, pursuitStage: null, nextStep: null, nextStepDate: null, itemStage: "triage", routingDate: null, confirmed: true, replyWindowDays: 7, today: TODAY };

describe("matchView", () => {
  it("a confirmed match with no message is Ready to send, at the top of Needs you today", () => {
    const v = matchView(base)!;
    expect(v.state).toBe("ready");
    expect(v.group).toBe("now");
    expect(v.pill).toEqual({ text: "Ready to send", tone: "new" });
    expect(v.next).toEqual({ text: "Draft the message", urgent: true });
    expect(v.actions.map((a) => a.label)).toEqual(["Draft the message", "Unconfirm"]);
    expect(matchView({ ...base, confirmed: false })!.actions[1]!.label).toBe("Remove from outreach");
  });

  it("a send inside the reply window waits; outside it is a nudge that is due", () => {
    const inside = matchView({ ...base, status: "contacted", contactedAt: "2026-09-11T10:00:00Z" })!;
    expect(inside).toMatchObject({ state: "sent_waiting", group: "waiting", pill: { text: "Sent · 2 days", tone: "plain" }, next: { text: "Nudge on Sep 18", urgent: false } });
    const outside = matchView({ ...base, status: "contacted", contactedAt: "2026-09-01T10:00:00Z" })!;
    expect(outside).toMatchObject({ state: "sent_no_reply", group: "now", pill: { text: "Sent · no reply", tone: "warn" }, next: { text: "Nudge — 12 days", urgent: true } });
    expect(matchView({ ...base, status: "contacted", contactedAt: `${TODAY}T08:00:00Z` })!.pill.text).toBe("Sent · today");
    expect(matchView({ ...base, status: "contacted", contactedAt: "2026-09-06T10:00:00Z", replyWindowDays: 7 })!.state).toBe("sent_no_reply");
    expect(matchView({ ...base, status: "contacted", contactedAt: "2026-09-06T10:00:00Z", replyWindowDays: 10 })!.state).toBe("sent_waiting");
  });

  it("replies need the strategist today, each with its own next step", () => {
    expect(matchView({ ...base, status: "replied_interested" })).toMatchObject({ group: "now", pill: { text: "Replied · interested", tone: "good" }, next: { text: "Book scoping call", urgent: true } });
    expect(matchView({ ...base, status: "replied_maybe" })).toMatchObject({ group: "now", pill: { text: "Replied · maybe", tone: "plain" } });
    expect(matchView({ ...base, status: "replied_not_now" })).toMatchObject({ group: "now", pill: { text: "Replied · not now", tone: "plain" }, next: { text: "Close the loop", urgent: false } });
    expect(matchView({ ...base, status: "bounced" })).toMatchObject({ group: "now", pill: { text: "Bounced", tone: "danger" } });
  });

  it("a pursuit is In progress, whatever the reply was", () => {
    const p = matchView({ ...base, status: "replied_interested", pursuitStage: "pursuing", routingDate: "2026-09-17" })!;
    expect(p).toMatchObject({ state: "pursuing", group: "progress", pill: { text: "Pursuing", tone: "good" }, next: { text: "OSR routing Sep 17", urgent: true } });
    expect(matchView({ ...base, status: "replied_interested", pursuitStage: "pursuing", routingDate: "2026-10-29" })!.next).toEqual({ text: "OSR routing Oct 29", urgent: false });
    expect(matchView({ ...base, status: "replied_interested", pursuitStage: "pursuing" })!.next).toEqual({ text: "Log the next step", urgent: false });
    expect(matchView({ ...base, status: "replied_interested", pursuitStage: "submitted" })).toMatchObject({ state: "submitted", pill: { text: "Submitted", tone: "good" }, next: { text: "Record the outcome", urgent: false } });
  });

  it("the strategist's own next step replaces the composed one, urgent once its day has come", () => {
    expect(matchView({ ...base, status: "replied_interested", nextStep: "Scoping call", nextStepDate: "2026-09-20" })!.next).toEqual({ text: "Scoping call Sep 20", urgent: false });
    expect(matchView({ ...base, status: "replied_interested", nextStep: "Scoping call", nextStepDate: "2026-09-13" })!.next).toEqual({ text: "Scoping call Sep 13", urgent: true });
    expect(matchView({ ...base, status: "replied_interested", nextStep: "Scoping call" })!.next).toEqual({ text: "Scoping call", urgent: false });
  });

  it("not a row: declined, a parked notice, a parked or closed match, an outcome recorded", () => {
    expect(matchView({ ...base, status: "declined" })).toBeNull();
    expect(matchView({ ...base, itemStage: "parked" })).toBeNull();
    expect(matchView({ ...base, pursuitStage: "parked" })).toBeNull();
    expect(matchView({ ...base, pursuitStage: "closed" })).toBeNull();
    expect(matchView({ ...base, pursuitStage: "outcome" })).toBeNull();
  });
});

describe("the verbs", () => {
  it("every state's first verb is primary and each verb is a mechanism the board wires", () => {
    for (const s of ["ready", "sent_no_reply", "sent_waiting", "replied_interested", "replied_maybe", "replied_not_now", "bounced", "pursuing", "submitted"] as const) {
      const a = actionsFor(s, true);
      expect(a.length).toBeGreaterThan(0);
      expect(a[0]!.kind).toBe("primary");
      expect(a.slice(1).every((x) => x.kind === "secondary")).toBe(true);
    }
    expect(actionsFor("replied_interested", true).map((a) => a.id)).toEqual(["mark_pursuing", "log_call", "hand_to_osr", "close"]);
    expect(actionsFor("submitted", true).map((a) => a.id)).toEqual(["record_outcome", "log_call"]);
  });
});

describe("filters, order and copy", () => {
  const row = (over: Partial<MatchRow> & { state: MatchRow["view"]["state"] }): MatchRow => ({
    recipientId: "r",
    itemId: "i",
    investigatorId: "p",
    opportunityId: "o",
    name: "A",
    dept: null,
    noticeTitle: "T",
    noticeNumber: null,
    dueDate: null,
    dueDays: null,
    ownerId: null,
    ownerName: "You",
    view: { state: over.state, group: "now", pill: { text: "", tone: "plain" }, next: { text: "", urgent: false }, actions: [] },
    thread: [],
    carried: "",
    confirmed: false,
    routingDate: null,
    composeHref: "/outreach",
    ...over,
  });

  it("filters", () => {
    expect(matchesFilter(row({ state: "ready", ownerId: "me" }), "mine", "me")).toBe(true);
    expect(matchesFilter(row({ state: "ready", ownerId: "them" }), "mine", "me")).toBe(false);
    expect(matchesFilter(row({ state: "ready", dueDays: 30 }), "deadline30", "me")).toBe(true);
    expect(matchesFilter(row({ state: "ready", dueDays: 31 }), "deadline30", "me")).toBe(false);
    expect(matchesFilter(row({ state: "sent_no_reply" }), "noreply", "me")).toBe(true);
    expect(matchesFilter(row({ state: "sent_waiting" }), "noreply", "me")).toBe(false);
    expect(filterLabel("noreply", 10)).toBe("No reply in 10 days");
    expect(filterLabel("deadline30", 7)).toBe("Deadline inside 30 days");
  });

  it("ready first, then replies, then the nearer deadline", () => {
    const rows = [row({ state: "sent_no_reply", name: "C" }), row({ state: "ready", name: "B", dueDate: "2026-10-16" }), row({ state: "ready", name: "A", dueDate: "2026-10-05" }), row({ state: "replied_interested", name: "D" })];
    expect(sortRows(rows).map((r) => r.name)).toEqual(["A", "B", "D", "C"]);
  });

  it("copy", () => {
    expect(headerLine({ now: 3, waiting: 1, progress: 2 })).toBe("3 need you today · 1 waiting on a reply · 2 in progress");
    expect(headerLine({ now: 1, waiting: 0, progress: 0 })).toBe("1 needs you today · 0 waiting on a reply · 0 in progress");
    expect(groupSub("waiting", 7)).toBe("sent, inside the 7-day reply window");
    expect(draftLabel(0)).toBe("Draft outreach");
    expect(draftLabel(2)).toBe("Draft 2 messages");
    expect(draftLabel(1)).toBe("Draft 1 message");
    expect(carriedLine({ confirmedAt: "2026-09-02T10:00:00Z", verdictLabel: "strong", tag: "science_right", addedAt: "2026-09-02T10:00:00Z", origin: "suggested", routingDate: "2026-09-17", today: TODAY })).toBe("Confirmed Sep 2 as a Strong match · science is right. Internal routing Sep 17.");
    expect(carriedLine({ confirmedAt: null, verdictLabel: null, tag: null, addedAt: "2026-08-20T10:00:00Z", origin: "you", routingDate: null, today: TODAY })).toBe("Added by hand Aug 20.");
  });
});
