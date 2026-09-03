import { describe, expect, it } from "vitest";
import {
  computeNextDue,
  dueDisplay,
  followingDueDatesLabel,
  internalRoutingDate,
  upcomingCycles,
  type CycleFacts,
} from "./receipt-cycles";

const today = "2026-09-02";

function facts(over: Partial<CycleFacts>): CycleFacts {
  return { cycles: [], cyclesSource: "nih_guide", closeDate: null, expirationDate: null, forecasted: false, isNih: true, ...over };
}

describe("dueDisplay", () => {
  it("multi-cycle NIH notice: next due, following dates, count left", () => {
    const f = facts({
      cycles: [
        { due: "2026-09-25", kind: "new" },
        { due: "2027-01-25", kind: "new" },
        { due: "2027-05-25", kind: "new" },
        { due: "2027-09-25", kind: "new" },
      ],
      expirationDate: "2028-09-26",
    });
    const d = dueDisplay(f, today);
    expect(d.primary).toBe("Due in 23 days · Sep 25");
    expect(d.secondary).toBe("then Jan 25, 2027, May 25, 2027 · 3 left");
    expect(d.tone).toBe("urgent");
    expect(followingDueDatesLabel(f, today)).toBe("Jan 25, 2027, May 25, 2027, Sep 25, 2027 · 3 cycles left");
  });

  it("single receipt date", () => {
    const d = dueDisplay(facts({ cycles: [{ due: "2026-10-12", kind: "new" }] }), today);
    expect(d.primary).toBe("Due in 40 days · Oct 12");
    expect(d.secondary).toBe("single receipt date");
    expect(d.tone).toBe("normal");
  });

  it("AIDS dates never headline and cycles stop at the expiration", () => {
    const f = facts({
      cycles: [
        { due: "2026-09-07", kind: "aids" },
        { due: "2026-10-05", kind: "new" },
        { due: "2027-02-05", kind: "new" },
        { due: "2027-06-05", kind: "new" },
      ],
      expirationDate: "2027-05-08",
    });
    expect(computeNextDue(f, today)).toBe("2026-10-05");
    const d = dueDisplay(f, today);
    expect(d.primary).toBe("Due in 33 days · Oct 5");
    expect(d.secondary).toBe("then Feb 5, 2027 · to May 2027");
  });

  it("an expired notice with cycles past its expiration reads as closed", () => {
    const f = facts({ cycles: [{ due: "2026-06-05", kind: "new" }, { due: "2026-10-05", kind: "new" }], expirationDate: "2026-05-25" });
    expect(computeNextDue(f, today)).toBe("2026-05-25");
    expect(dueDisplay(f, today).tone).toBe("closed");
  });

  it("renewal date on the same day as a new date does not double count", () => {
    const f = facts({ cycles: [{ due: "2026-11-18", kind: "new" }, { due: "2026-11-18", kind: "renewal" }, { due: "2027-07-14", kind: "new" }] });
    expect(upcomingCycles(f.cycles, today).map((c) => c.due)).toEqual(["2026-11-18", "2027-07-14"]);
    expect(dueDisplay(f, today).secondary).toBe("then Jul 14, 2027 · 1 left");
  });

  it("forecasted: opens ~date, first due", () => {
    const d = dueDisplay(facts({ forecasted: true, forecastedPostDate: "2026-11-01", cycles: [{ due: "2027-01-15", kind: "new" }] }), today);
    expect(d.primary).toBe("Opens ~Nov 1");
    expect(d.secondary).toBe("first due Jan 15, 2027");
    expect(d.tone).toBe("forecast");
  });

  it("NIH notice without Guide data shows the expiration, not a due date", () => {
    const d = dueDisplay(facts({ cyclesSource: "simpler", closeDate: "2028-07-16" }), today);
    expect(d.primary).toBe("Expires Jul 16, 2028");
    expect(d.secondary).toBe("due dates not yet published");
    expect(d.tone).toBe("muted");
  });

  it("non-NIH single close date behaves like one cycle", () => {
    const d = dueDisplay(facts({ isNih: false, cyclesSource: "simpler", closeDate: "2026-12-18", cycles: [] }), today);
    expect(computeNextDue({ cycles: [], closeDate: "2026-12-18" }, today)).toBe("2026-12-18");
    expect(d.primary).toBe("Due in 107 days · Dec 18");
    expect(d.secondary).toBe("single receipt date");
    expect(d.tone).toBe("normal");
  });

  it("overdue and closed", () => {
    const d = dueDisplay(facts({ cycles: [{ due: "2026-08-20", kind: "new" }] }), today);
    expect(d.primary).toBe("Overdue by 13 days · Aug 20");
    expect(d.tone).toBe("closed");
  });

  it("due today", () => {
    expect(dueDisplay(facts({ cycles: [{ due: today, kind: "new" }] }), today).primary).toBe("Due today · Sep 2");
  });
});

describe("internalRoutingDate", () => {
  it("5 business days before Sep 25, 2026 skipping UCSF holidays and weekends", () => {
    // Sep 25 2026 is a Friday; 5 business days back = Fri Sep 18 (Labor Day is Sep 7, outside the window).
    expect(internalRoutingDate("2026-09-25", { days: 5, dayType: "business", holidayCalendar: "ucsf" })).toBe("2026-09-18");
  });
  it("skips Thanksgiving and the Friday after", () => {
    // Dec 1 2026 (Tue) minus 5 business days: Mon Nov 30, Wed Nov 25, Tue Nov 24, Mon Nov 23, Fri Nov 20 (Nov 26-27 are holidays).
    expect(internalRoutingDate("2026-12-01", { days: 5, dayType: "business", holidayCalendar: "ucsf" })).toBe("2026-11-20");
  });
  it("calendar days ignore weekends", () => {
    expect(internalRoutingDate("2026-09-25", { days: 5, dayType: "calendar", holidayCalendar: "ucsf" })).toBe("2026-09-20");
  });
});
