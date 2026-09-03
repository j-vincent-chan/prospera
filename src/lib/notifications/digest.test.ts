import { describe, expect, it } from "vitest";
import { ptParts } from "./digest";

describe("ptParts", () => {
  it("reads the Pacific hour, weekday and date", () => {
    // 14:35 UTC on Thu Sep 3 2026 is 07:35 PDT.
    expect(ptParts(new Date("2026-09-03T14:35:00Z"))).toEqual({ hour: 7, weekday: 4, dateKey: "2026-09-03" });
    // 03:10 UTC Sunday is Saturday evening in Pacific time.
    expect(ptParts(new Date("2026-09-06T03:10:00Z"))).toEqual({ hour: 20, weekday: 6, dateKey: "2026-09-05" });
  });
});
