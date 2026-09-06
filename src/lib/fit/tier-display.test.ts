import { describe, expect, it } from "vitest";
import { FIT_TIER_HELP, TIER_PILL_VARIANT, tierHelp } from "@/lib/fit/tier-display";
import { compareFitRows, suggestionTierOf, whyLineOf, TIER_RANK } from "@/lib/fit/results";
import { TIER_HELP, TIER_LABEL } from "@/lib/outreach/types";

describe("tier display (PR 2.3)", () => {
  it("every pill tier has a variant, a label and a help text under both engines", () => {
    for (const tier of ["strong", "potential", "exploratory"] as const) {
      expect(TIER_PILL_VARIANT[tier]).toBe(`tier-${tier}`);
      expect(TIER_LABEL[tier]).toMatch(/\S/);
      expect(tierHelp(tier, "fit-v1")).toBe(FIT_TIER_HELP[tier]);
      expect(tierHelp(tier, "legacy")).toBe(TIER_HELP[tier]);
      expect(FIT_TIER_HELP[tier]).not.toBe(TIER_HELP[tier]);
    }
    expect(FIT_TIER_HELP.potential).toMatch(/Moderate/);
  });

  it("the engine's tiers reach the pills through one map: Moderate is the 'potential' pill, Poor has none", () => {
    expect(suggestionTierOf("strong")).toBe("strong");
    expect(suggestionTierOf("moderate")).toBe("potential");
    expect(suggestionTierOf("exploratory")).toBe("exploratory");
    expect(suggestionTierOf("poor")).toBeNull();
  });

  it("compareFitRows: tier rank first, then score descending, then the id", () => {
    expect(TIER_RANK).toEqual({ strong: 0, moderate: 1, exploratory: 2, poor: 3 });
    const id = (r: { id: string }) => r.id;
    expect(compareFitRows({ id: "a", tier: "moderate", score: 99 }, { id: "b", tier: "strong", score: 10 }, id)).toBeGreaterThan(0);
    expect(compareFitRows({ id: "a", tier: "strong", score: 10 }, { id: "b", tier: "strong", score: 20 }, id)).toBeGreaterThan(0);
    expect(compareFitRows({ id: "b", tier: "strong", score: 20 }, { id: "a", tier: "strong", score: 20 }, id)).toBeGreaterThan(0);
    expect(compareFitRows({ id: "a", tier: "strong", score: 20 }, { id: "a", tier: "strong", score: 20 }, id)).toBe(0);
  });

  it("whyLineOf: the rationale, the gap appended for Exploratory only, a fallback naming tier and score", () => {
    expect(whyLineOf({ tier: "strong", score: 70, rationale: "Paradigm 1.00.", gap: "ignored" })).toBe("Paradigm 1.00.");
    expect(whyLineOf({ tier: "exploratory", score: 40, rationale: "Paradigm 0.60.", gap: "Design: a trialist collaborator." })).toBe("Paradigm 0.60. Design: a trialist collaborator.");
    expect(whyLineOf({ tier: "exploratory", score: 40, rationale: null, gap: "Only the gap." })).toBe("Only the gap.");
    expect(whyLineOf({ tier: "moderate", score: 55.6, rationale: null, gap: null })).toBe("Fit moderate · score 56.");
  });
});
