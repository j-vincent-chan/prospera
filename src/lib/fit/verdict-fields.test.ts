/**
 * The two fields the row takes from outside the fit model, and why a pair was
 * ruled out (fit-UX PR 3). Pure, so the deadline is driven through a fixed
 * `today` rather than the clock.
 */
import { describe, expect, it } from "vitest";
import { noticeDue, noticeMeta, personStatus, ruledOutReasonOf } from "@/lib/fit/verdict-fields";
import { cycleFactsFromRow, type CycleColumns } from "@/lib/funding-opportunities/receipt-cycles";

const TODAY = "2026-09-07";
const facts = (row: Partial<CycleColumns>) => cycleFactsFromRow({ close_date: null, forecasted: false, ...row } as CycleColumns);

describe("noticeMeta", () => {
  it("the prototype's four facts, in its order", () => {
    expect(noticeMeta({ agency: "NINDS", opportunity_number: "PAR-26-041", activity_code: "R01", award_ceiling: 500_000 })).toBe("NINDS · PAR-26-041 · R01 · $500k direct / yr");
  });

  it("a missing fact is one fewer clause, never a placeholder", () => {
    expect(noticeMeta({ agency: "NINDS", opportunity_number: null, activity_code: "R21", award_ceiling: null })).toBe("NINDS · R21");
    expect(noticeMeta({})).toBeNull();
    expect(noticeMeta({ agency: "  " })).toBeNull();
  });

  it("a ceiling arrives from PostgREST as a string, and a small one is not rounded to $0k", () => {
    expect(noticeMeta({ agency: "NIH", award_ceiling: "275000" })).toBe("NIH · $275k direct / yr");
    expect(noticeMeta({ agency: "NIH", award_ceiling: 750 })).toBe("NIH · $750 direct / yr");
    expect(noticeMeta({ agency: "NIH", award_ceiling: 0 })).toBe("NIH");
  });
});

describe("noticeDue", () => {
  it("the date leads, then the countdown", () => {
    expect(noticeDue(facts({ close_date: "2026-11-12" }), TODAY)).toEqual({ text: "Nov 12 · 66 days", tone: "normal" });
  });

  it("inside the app's own 30-day window it is urgent — the word `DUE_URGENT_WORD` was written for", () => {
    expect(noticeDue(facts({ close_date: "2026-10-05" }), TODAY)).toEqual({ text: "Oct 5 · 28 days", tone: "urgent" });
  });

  it("today is a day, not `0 days`", () => {
    expect(noticeDue(facts({ close_date: TODAY }), TODAY)).toEqual({ text: "Sep 7 · today", tone: "urgent" });
    expect(noticeDue(facts({ close_date: "2026-09-08" }), TODAY).text).toBe("Sep 8 · 1 day");
  });

  it("a closed, forecast or dateless notice is quiet and keeps the app's own sentence", () => {
    expect(noticeDue(facts({ close_date: "2026-01-05" }), TODAY).tone).toBe("quiet");
    expect(noticeDue(facts({ forecasted: true }), TODAY).tone).toBe("quiet");
    const none = noticeDue(facts({}), TODAY);
    expect(none.tone).toBe("quiet");
    expect(none.text).toMatch(/\S/);
  });
});

describe("personStatus — D-l's open question, answered", () => {
  it("a caller that has not looked gets no field rather than an invented 'Not contacted'", () => {
    expect(personStatus(null)).toBeNull();
    expect(personStatus(undefined)).toBeNull();
  });

  it("a caller that looked and found no recipient row says so", () => {
    expect(personStatus({})).toEqual({ text: "Not contacted", tone: "normal" });
    expect(personStatus({ status: null })).toEqual({ text: "Not contacted", tone: "normal" });
  });

  it("contacted and unanswered is the urgent case: something is owed", () => {
    expect(personStatus({ status: "contacted", line: "Contacted Sep 4 · no reply" })).toEqual({ text: "Contacted Sep 4 · no reply", tone: "urgent" });
  });

  it("a finished status is quiet, and an active one is normal", () => {
    expect(personStatus({ status: "declined", line: "Declined" })).toEqual({ text: "Declined", tone: "quiet" });
    expect(personStatus({ status: "bounced", line: "Bounced" })!.tone).toBe("quiet");
    expect(personStatus({ status: "replied_interested", line: "Interested · Sep 5" })).toEqual({ text: "Interested · Sep 5", tone: "normal" });
    expect(personStatus({ status: "selected" })).toEqual({ text: "selected", tone: "normal" });
  });
});

describe("ruledOutReasonOf — the engine's own precedence", () => {
  it("the eligibility gate first: it is a fact about the person", () => {
    expect(ruledOutReasonOf({ components: { E: 0 }, caps: ["paradigm_gate"] })).toBe("eligibility");
  });

  it("then the paradigm gate, relaxed or not", () => {
    expect(ruledOutReasonOf({ components: { E: 1 }, caps: ["paradigm_gate"] })).toBe("a different field");
    expect(ruledOutReasonOf({ components: { E: 1 }, caps: ["paradigm_gate_relaxed_translational_bridge"] })).toBe("a different field");
  });

  it("then the unit gate, then the floors", () => {
    expect(ruledOutReasonOf({ components: { E: 1 }, caps: ["unit_gate"] })).toBe("unit of analysis");
    expect(ruledOutReasonOf({ components: { E: 1 }, caps: [] })).toBe("the floors");
    expect(ruledOutReasonOf({})).toBe("the floors");
  });
});
