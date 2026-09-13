import { describe, expect, it } from "vitest";
import { councilFor, outcomeNext, parseMonthYear } from "@/lib/outreach/council";

const cycles = [
  { due: "2026-06-05", kind: "new" as const, review: "November 2026", council: "January 2027", start: "April 2027" },
  { due: "2026-10-05", kind: "new" as const, review: "March 2027", council: "May 2027", start: "July 2027" },
  { due: "2027-02-05", kind: "new" as const, review: "July 2027", council: "October 2027", start: "December 2027" },
];

describe("the review council behind a submission", () => {
  it("reads the Guide's month and nothing else", () => {
    expect(parseMonthYear("October 2026")).toEqual({ start: "2026-10-01", end: "2026-10-31" });
    expect(parseMonthYear("february 2028")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(parseMonthYear("TBD")).toBeNull();
    expect(parseMonthYear("2026")).toBeNull();
    expect(parseMonthYear(null)).toBeNull();
  });

  it("picks the cycle the application went in for", () => {
    expect(councilFor(cycles, "2026-09-13T20:00:00Z")).toEqual({ label: "May 2027", end: "2027-05-31", due: "2026-10-05" });
    expect(councilFor(cycles, "2026-10-05T23:00:00Z")).toEqual({ label: "May 2027", end: "2027-05-31", due: "2026-10-05" });
    expect(councilFor(cycles, "2027-03-01T00:00:00Z")!.label).toBe("October 2027");
    expect(councilFor(cycles, null)!.label).toBe("January 2027");
    expect(councilFor([], "2026-09-13")).toBeNull();
    expect(councilFor([{ due: "2026-10-05", kind: "new", council: null }], "2026-09-13")).toBeNull();
    expect(councilFor([{ due: "2026-10-05", kind: "new", council: "TBD" }], "2026-09-13")).toBeNull();
  });

  it("asks for the outcome once the council has met, and says when to expect it before", () => {
    const c = councilFor(cycles, "2026-09-13")!;
    expect(outcomeNext(c, "2027-04-01")).toEqual({ text: "Outcome after council, May 2027", urgent: false });
    expect(outcomeNext(c, "2027-05-31")).toEqual({ text: "Outcome after council, May 2027", urgent: false });
    expect(outcomeNext(c, "2027-06-01")).toEqual({ text: "Record the outcome — council met May 2027", urgent: true });
    expect(outcomeNext(null, "2027-06-01")).toEqual({ text: "Record the outcome", urgent: false });
  });
});
