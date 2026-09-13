import { describe, expect, it } from "vitest";
import { awardLineOf, leadOf, mechanismOf } from "@/lib/outreach/email-card";

describe("email card facts", () => {
  it("names the mechanism without a redundant 'Grant'", () => {
    expect(mechanismOf("R03", "Grant")).toBe("R03");
    expect(mechanismOf("U19", "Cooperative Agreement")).toBe("U19 · cooperative agreement");
    expect(mechanismOf("U01", "COOPERATIVE_AGREEMENT")).toBe("U01 · cooperative agreement");
    expect(mechanismOf(null, "Cooperative Agreement")).toBe("cooperative agreement");
    expect(mechanismOf(null, null)).toBeNull();
  });

  it("writes the award line the way the design does", () => {
    expect(awardLineOf(100_000, 2)).toBe("$100,000 direct / year · 2 years");
    expect(awardLineOf(250_000, null)).toBe("$250,000 direct / year");
    expect(awardLineOf(null, 1)).toBe("1 year");
    expect(awardLineOf(0, null)).toBeNull();
  });

  it("takes one or two sentences of purpose, never more than the cap", () => {
    expect(leadOf("First sentence. Second one here. Third is dropped.")).toBe("First sentence. Second one here.");
    expect(leadOf("   ")).toBeNull();
    const long = `${"word ".repeat(80)}end.`;
    expect(leadOf(long, 100)!.length).toBeLessThanOrEqual(100);
    expect(leadOf(long, 100)!.endsWith("…")).toBe(true);
  });
});
