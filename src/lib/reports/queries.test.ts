import { describe, expect, it } from "vitest";
import { periodRange } from "./queries";

describe("periodRange", () => {
  const now = new Date("2026-09-03T12:00:00Z");
  it("uses UCSF fiscal years starting Jul 1", () => {
    expect(periodRange("fy_to_date", now)).toEqual({ from: "2026-07-01", to: "2026-09-03", label: "FY27 to date (Jul 1 – Sep 3)" });
    expect(periodRange("previous_fy", now)).toEqual({ from: "2025-07-01", to: "2026-06-30", label: "FY26 (Jul 1, 2025 – Jun 30, 2026)" });
    expect(periodRange("last_quarter", now)).toEqual({ from: "2026-04-01", to: "2026-06-30", label: "Last quarter (Apr 1 – Jun 30)" });
  });
});
