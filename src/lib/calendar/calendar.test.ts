import { describe, expect, it } from "vitest";
import { buildIcs } from "./ics";
import { monthRange } from "./queries";

describe("calendar", () => {
  it("pads the month grid to full weeks", () => {
    expect(monthRange("2026-09")).toEqual({ from: "2026-09-01", to: "2026-09-30", gridFrom: "2026-08-30", gridTo: "2026-10-03" });
  });
  it("writes all-day ICS events with categories", () => {
    const ics = buildIcs({ teamName: "OCR", siteUrl: "https://prospera.test", events: [{ id: "sponsor-1-2026-09-25", date: "2026-09-25", kind: "sponsor", label: "x", title: "Immune Regulation R01 — application due", detail: "Sponsor deadline · Triage", href: "/opportunities/1", itemId: "1", manual: false }] });
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260925");
    expect(ics).toContain("DTEND;VALUE=DATE:20260926");
    expect(ics).toContain("SUMMARY:Immune Regulation R01 — application due");
    expect(ics).toContain("CATEGORIES:Sponsor deadline");
    expect(ics).toContain("URL:https://prospera.test/opportunities/1");
  });
});
