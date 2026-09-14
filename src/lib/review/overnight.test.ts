/** Discover's overnight strip (decision N2): the window and the line, as pure functions. */
import { describe, expect, it } from "vitest";
import { FILED_HREF, dayStartPT, overnightLine, overnightText, sinceLabel, windowStart } from "@/lib/review/overnight";

const TODAY = "2026-09-13";
const NOW = new Date("2026-09-13T15:00:00Z"); // 8:00 PDT

describe("the window", () => {
  it("opens at the last visit, floored at the Pacific day so the strip holds all day, and never more than 14 days back", () => {
    expect(dayStartPT(TODAY).toISOString()).toBe("2026-09-13T07:00:00.000Z");
    expect(dayStartPT("2026-01-13").toISOString()).toBe("2026-01-13T08:00:00.000Z");
    expect(windowStart("2026-09-13T14:00:00Z", NOW, TODAY)).toBe("2026-09-13T07:00:00.000Z");
    expect(windowStart("2026-09-10T02:00:00Z", NOW, TODAY)).toBe("2026-09-10T02:00:00.000Z");
    expect(windowStart("2026-08-01T00:00:00Z", NOW, TODAY)).toBe("2026-08-30T15:00:00.000Z");
    expect(windowStart(null, NOW, TODAY)).toBe("2026-08-30T15:00:00.000Z");
  });
  it("says what the window is", () => {
    expect(sinceLabel("2026-09-13T02:00:00Z", NOW, TODAY)).toBe("Overnight");
    expect(sinceLabel("2026-09-10T02:00:00Z", NOW, TODAY)).toBe("Since Sep 10");
  });
});

describe("the line", () => {
  it("reads as Today's sentence, with the filed count linking to the notices", () => {
    const segments = overnightLine({ since: "Overnight", newNotices: 22, matched: 8, filed: 14, sent: 0 });
    expect(overnightText(segments)).toBe("Overnight: 22 new notices. 8 produced matches, 14 produced none and were filed. Nothing has been sent.");
    expect(segments.find((s) => s.href)).toEqual({ text: "14 produced none and were filed", href: FILED_HREF });
    const one = overnightLine({ since: "Since Sep 10", newNotices: 1, matched: 1, filed: 0, sent: 2 });
    expect(overnightText(one)).toBe("Since Sep 10: 1 new notice. 1 produced a match, 0 produced none and were filed. 2 messages went out since Sep 10, each sent by hand.");
    expect(one.every((s) => s.href === null)).toBe(true);
    expect(overnightLine({ since: "Overnight", newNotices: 0, matched: 0, filed: 0, sent: 0 })).toEqual([{ text: "Overnight: no new notices. Nothing has been sent.", href: null }]);
  });
});
