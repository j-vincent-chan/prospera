/**
 * The Review queue's policy and copy (`lib/review/queue.ts`). Pure, so the
 * dates are driven through a fixed `today`.
 */
import { describe, expect, it } from "vitest";
import type { Tier } from "@/lib/fit/types";
import { internalRoutingDate } from "@/lib/funding-opportunities/receipt-cycles";
import type { MatchDecision } from "@/lib/review/decisions";
import {
  bulkNoteText,
  capExploratory,
  cardTitleOf,
  decidedLine,
  dismissAllLabel,
  dueUrgent,
  dueWords,
  EXPLORATORY_CAP,
  exploratoryCapFor,
  firstUndecided,
  footerLine,
  keyStats,
  listedCount,
  listedPairs,
  matchLine,
  money,
  academicRank,
  nextUndecided,
  noticeCounts,
  noticeMetaLine,
  noticeVerdictPill,
  orderQueue,
  progressPercent,
  pursuitVerdict,
  queuedLine,
  queuedNoticeIds,
  routingOf,
  stepCursor,
  watchResurfaceOn,
  type QueuePair,
} from "@/lib/review/queue";

const TODAY = "2026-09-12";
const pair = (opportunityId: string, investigatorId: string, tier: Tier, score = 50): QueuePair => ({ opportunityId, investigatorId, tier, score });
const decision = (status: MatchDecision["status"], extra: Partial<MatchDecision> = {}): MatchDecision => ({ opportunityId: "n1", investigatorId: "p", status, reason: null, scope: "pair", auto: false, resurfaceOn: null, verdictLabel: null, decidedBy: "u", decidedAt: "2026-09-12T00:00:00Z", ...extra });
const shiftIso = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

describe("what enters the queue", () => {
  it("a notice is queued by a Strong or Moderate row; Exploratory alone never queues it", () => {
    expect(queuedNoticeIds([pair("a", "p1", "exploratory"), pair("b", "p2", "moderate"), pair("c", "p3", "strong"), pair("b", "p4", "exploratory")])).toEqual(["b", "c"]);
  });

  it("lists every Strong and Moderate row and the best three Exploratory rows, best first", () => {
    const pairs = [pair("n", "e1", "exploratory", 30), pair("n", "m1", "moderate", 40), pair("n", "e2", "exploratory", 60), pair("n", "s1", "strong", 55), pair("n", "e3", "exploratory", 45), pair("n", "e4", "exploratory", 50), pair("n", "e5", "exploratory", 10), pair("x", "e9", "exploratory", 99)];
    expect(listedPairs(pairs, EXPLORATORY_CAP).map((p) => p.investigatorId)).toEqual(["s1", "m1", "e2", "e4", "e3"]);
    expect(listedPairs(pairs, exploratoryCapFor(false)).map((p) => p.investigatorId)).toEqual(["s1", "m1"]);
    expect(exploratoryCapFor(true)).toBe(EXPLORATORY_CAP);
    expect(listedCount({ strong: 1, moderate: 1, exploratory: 5 }, EXPLORATORY_CAP)).toBe(2 + EXPLORATORY_CAP);
    expect(listedCount({ strong: 1, moderate: 1, exploratory: 5 }, 0)).toBe(2);
    expect(listedCount({ moderate: 4, exploratory: 1 }, EXPLORATORY_CAP)).toBe(5);
  });

  it("capExploratory cuts only the Exploratory tail and drops Poor", () => {
    const ranked = [{ tier: "strong" as Tier }, { tier: "exploratory" as Tier }, { tier: "exploratory" as Tier }, { tier: "poor" as Tier }];
    expect(capExploratory(ranked, 1).map((r) => r.tier)).toEqual(["strong", "exploratory"]);
    expect(capExploratory(ranked, 0).map((r) => r.tier)).toEqual(["strong"]);
  });
});

describe("counting a notice", () => {
  it("decided, undecided, and a do-not-contact person settled without a decision", () => {
    const c = noticeCounts([
      { tier: "strong", decision: decision("confirmed") },
      { tier: "moderate", decision: decision("rejected") },
      { tier: "moderate", decision: decision("watch") },
      { tier: "exploratory", decision: null },
      { tier: "exploratory", decision: null, doNotContact: true },
    ]);
    expect(c).toMatchObject({ suggested: 5, decided: 4, undecided: 1, confirmed: 1, rejected: 1, watching: 1 });
    expect(c.byTier).toEqual({ strong: 1, moderate: 2, exploratory: 2, poor: 0 });
    expect(matchLine(c)).toBe("5 suggested · 4 decided");
    expect(decidedLine(c)).toBe("4 of 5 decided");
    expect(progressPercent(c)).toBe(80);
    expect(progressPercent({ suggested: 0, decided: 0 })).toBe(0);
  });

  it("the verdict pill: pursuing while anything is confirmed, not pursuing once every row is dismissed, nothing before", () => {
    expect(noticeVerdictPill({ confirmed: 1, rejected: 0, undecided: 3, watching: 0 })).toEqual({ text: "Pursuing · 1 confirmed", tone: "good" });
    expect(noticeVerdictPill({ confirmed: 0, rejected: 4, undecided: 0, watching: 0 })).toEqual({ text: "Not pursuing", tone: "plain" });
    expect(noticeVerdictPill({ confirmed: 0, rejected: 2, undecided: 2, watching: 0 })).toBeNull();
    expect(noticeVerdictPill({ confirmed: 0, rejected: 2, undecided: 0, watching: 1 })).toBeNull();
  });
});

describe("the notice list", () => {
  it("due words and the 30-day red", () => {
    expect(dueWords(14)).toBe("14 days");
    expect(dueWords(1)).toBe("1 day");
    expect(dueWords(0)).toBe("today");
    expect(dueWords(-2)).toBe("passed");
    expect(dueWords(null)).toBe("no date");
    expect(dueUrgent(30)).toBe(true);
    expect(dueUrgent(31)).toBe(false);
    expect(dueUrgent(null)).toBe(false);
  });

  it("limited submissions first, then the nearest deadline, undated last", () => {
    const items = [
      { id: "far", limited: false, dueDate: "2027-01-27", number: "PAR-24-325" },
      { id: "none", limited: false, dueDate: null, number: "PAR-27-999" },
      { id: "near", limited: false, dueDate: "2026-10-05", number: "PAR-25-069" },
      { id: "limited", limited: true, dueDate: "2026-11-01", number: "RFA-AI-27-004" },
      { id: "near2", limited: false, dueDate: "2026-10-05", number: "PAR-25-001" },
    ];
    expect(orderQueue(items).map((i) => i.id)).toEqual(["limited", "near2", "near", "far", "none"]);
  });
});

describe("the notice header", () => {
  it("strips the trailing mechanism parenthetical and keeps the rest", () => {
    expect(cardTitleOf("Atopic Dermatitis Research Network (ADRN) (U19 Clinical Trial Optional)")).toBe("Atopic Dermatitis Research Network (ADRN)");
    expect(cardTitleOf("Pilot Projects (R03 Clinical Trial Not Allowed)")).toBe("Pilot Projects");
    expect(cardTitleOf("A title with no mechanism")).toBe("A title with no mechanism");
    expect(cardTitleOf("(R01)")).toBe("(R01)");
  });

  it("the pursuit line is the tiers and the dates in words, never an opinion the data does not hold", () => {
    const strong = pursuitVerdict({ byTier: { strong: 1, moderate: 9, exploratory: 20, poor: 0 }, dueDays: 34, routingDays: 27, limited: true, cap: 1 });
    expect(strong.verdict).toBe("Worth pursuing");
    expect(strong.tone).toBe("good");
    expect(strong.line).toBe("1 strong match and 9 moderate matches in the directory, plus 20 exploratory leads. Deadline in 34 days; internal routing in 27 days. Limited submission — 1 per institution.");
    const moderate = pursuitVerdict({ byTier: { strong: 0, moderate: 1, exploratory: 0, poor: 0 }, dueDays: null, routingDays: null, limited: false, cap: null });
    expect(moderate.verdict).toBe("Worth a look");
    expect(moderate.tone).toBe("caution");
    expect(moderate.line).toBe("1 moderate match in the directory. No deadline is published yet.");
    expect(pursuitVerdict({ byTier: { strong: 0, moderate: 2, exploratory: 0, poor: 0 }, dueDays: 0, routingDays: -3, limited: true, cap: null }).line).toBe("2 moderate matches in the directory. Deadline is today. Limited submission.");
  });

  it("key stats: dates in the prototype's shape, red inside 30 days, the award with its total", () => {
    const [deadline, routing, award] = keyStats({ dueDate: "2026-09-24", dueDays: 12, routingDate: "2026-09-17", routingDays: 5, ceilingPerYear: 2_500_000, periodYears: 5, today: TODAY });
    expect(deadline).toEqual({ value: "Sep 24", label: "deadline · 12 days", urgent: true });
    expect(routing).toEqual({ value: "Sep 17", label: "internal routing · 5 days", urgent: true });
    expect(award).toEqual({ value: "$2.5M / yr", label: "5 years · $12.5M total", urgent: false });
    const [none, noRouting, noAward] = keyStats({ dueDate: null, dueDays: null, routingDate: null, routingDays: null, ceilingPerYear: null, periodYears: null, today: TODAY });
    expect(none).toEqual({ value: "—", label: "deadline · not published", urgent: false });
    expect(noRouting.value).toBe("—");
    expect(noAward).toEqual({ value: "Not stated", label: "award ceiling", urgent: false });
    expect(keyStats({ dueDate: "2027-01-27", dueDays: 137, routingDate: null, routingDays: null, ceilingPerYear: 275_000, periodYears: null, today: TODAY })[2]).toEqual({ value: "$275k / yr", label: "award ceiling · per year", urgent: false });
  });

  it("money", () => {
    expect(money(2_500_000)).toBe("$2.5M");
    expect(money(12_500_000)).toBe("$12.5M");
    expect(money(275_000)).toBe("$275k");
    expect(money(750)).toBe("$750");
    expect(money(0)).toBeNull();
    expect(money(null)).toBeNull();
  });

  it("the meta line: mechanism, the letter of intent, the submission rule", () => {
    expect(noticeMetaLine({ activityCode: "U19", instrument: "COOPERATIVE_AGREEMENT", loiDue: "2026-09-03", loiNote: null, limited: true, cap: 1, today: TODAY })).toBe("U19 cooperative agreement · letter of intent passed Sep 3 · 1 per institution");
    expect(noticeMetaLine({ activityCode: "R03", instrument: "grant", loiDue: "2026-10-01", loiNote: null, limited: false, cap: null, today: TODAY })).toBe("R03 grant · letter of intent due Oct 1");
    expect(noticeMetaLine({ activityCode: null, instrument: null, loiDue: null, loiNote: "Not applicable", limited: true, cap: null, today: TODAY })).toBe("letter of intent · not applicable · limited submission");
    expect(noticeMetaLine({ activityCode: "K76", instrument: null, loiDue: null, loiNote: null, limited: false, cap: null, today: TODAY })).toBe("K76 · no letter of intent");
  });

  it("routing and the watch's return day come from the notice's deadline", () => {
    const rule = { days: 5, dayType: "calendar", holidayCalendar: "none" } as const;
    expect(routingOf("2026-09-24", rule, TODAY, internalRoutingDate)).toEqual({ date: "2026-09-19", days: 7 });
    expect(routingOf(null, rule, TODAY, internalRoutingDate)).toEqual({ date: null, days: null });
    expect(watchResurfaceOn("2026-11-01", TODAY, shiftIso)).toBe("2026-10-02");
    // Inside 30 days already: the watch does not expire rather than expiring at once.
    expect(watchResurfaceOn("2026-09-24", TODAY, shiftIso)).toBeNull();
    expect(watchResurfaceOn(null, TODAY, shiftIso)).toBeNull();
  });
});

describe("the identity line's rank", () => {
  it("prints an academic rank and not a roster role", () => {
    expect(academicRank("Associate Professor")).toBe("Associate Professor");
    expect(academicRank("Professor Emeritus")).toBe("Professor Emeritus");
    expect(academicRank("member")).toBeNull();
    expect(academicRank("leadership_committee")).toBeNull();
    expect(academicRank("associate")).toBeNull();
    expect(academicRank(null)).toBeNull();
  });
});

describe("the rows card's chrome", () => {
  it("bulk notes, the dismiss-all label, the footer and the queued bar", () => {
    expect(bulkNoteText({ n: 3, whole: false })).toBe("That reason is about the notice, not the person, so 3 other matches here were cleared too.");
    expect(bulkNoteText({ n: 1, whole: false })).toBe("That reason is about the notice, not the person, so 1 other match here was cleared too.");
    expect(bulkNoteText({ n: 4, whole: true })).toBe("Notice dismissed — 4 suggested people cleared with it.");
    expect(bulkNoteText({ n: 1, whole: true })).toBe("Notice dismissed — 1 suggested person cleared with it.");
    expect(dismissAllLabel(4)).toBe("Dismiss all 4 matches");
    expect(dismissAllLabel(1)).toBe("Dismiss all 1 match");
    expect(footerLine({ ruledOutEligibility: 2, belowFloors: 105, hiddenExploratory: 30, leadsShown: true })).toBe("2 people ruled out on eligibility · 105 below the bar · 30 more exploratory leads not listed.");
    expect(footerLine({ ruledOutEligibility: 1, belowFloors: 0, hiddenExploratory: 1, leadsShown: true })).toBe("1 person ruled out on eligibility · 1 more exploratory lead not listed.");
    expect(footerLine({ ruledOutEligibility: 0, belowFloors: 0, hiddenExploratory: 0, leadsShown: true })).toBeNull();
    // R32: with the viewer's switch off, the footer says where the leads went.
    expect(footerLine({ ruledOutEligibility: 0, belowFloors: 0, hiddenExploratory: 12, leadsShown: false })).toBe("12 exploratory leads switched off — turn them on above.");
    expect(footerLine({ ruledOutEligibility: 0, belowFloors: 0, hiddenExploratory: 1, leadsShown: false })).toBe("1 exploratory lead switched off — turn them on above.");
    expect(queuedLine(2)).toBe("2 matches confirmed and queued for outreach. Nothing has been sent.");
    expect(queuedLine(1)).toBe("1 match confirmed and queued for outreach. Nothing has been sent.");
  });
});

describe("the cursor", () => {
  const rows = (flags: boolean[]) => flags.map((undecided) => ({ undecided }));

  it("advances to the next undecided row, wrapping, and returns to the row itself last", () => {
    expect(nextUndecided(rows([false, true, false, true]), 1)).toBe(3);
    expect(nextUndecided(rows([false, true, false, true]), 3)).toBe(1);
    expect(nextUndecided(rows([true, false, false]), 0)).toBe(0);
    expect(nextUndecided(rows([false, false]), 0)).toBeNull();
    expect(nextUndecided([], 0)).toBeNull();
  });

  it("starts at the first undecided row, or the top", () => {
    expect(firstUndecided(rows([false, false, true]))).toBe(2);
    expect(firstUndecided(rows([false, false]))).toBe(0);
  });

  it("J / K step and clamp", () => {
    expect(stepCursor(0, -1, 4)).toBe(0);
    expect(stepCursor(3, 1, 4)).toBe(3);
    expect(stepCursor(1, 1, 4)).toBe(2);
    expect(stepCursor(5, 1, 0)).toBe(0);
  });
});
