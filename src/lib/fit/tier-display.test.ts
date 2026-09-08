import { describe, expect, it } from "vitest";
import { FIT_TIER_HELP, FIT_TIER_LABEL, TIER_PILL_VARIANT, tierHelp, tierLabel } from "@/lib/fit/tier-display";
import { compareFitRows, suggestionTierOf, TIER_RANK } from "@/lib/fit/results";
import { rowLine } from "@/lib/fit/row-line";
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

  it("PR 3.2 (D33): a fit-v1 pill reads Strong match / Moderate match / Exploratory; a legacy pill keeps Potential match", () => {
    expect(FIT_TIER_LABEL).toEqual({ strong: "Strong match", potential: "Moderate match", exploratory: "Exploratory" });
    expect(tierLabel("potential", "fit-v1")).toBe("Moderate match");
    expect(tierLabel("potential", "legacy")).toBe("Potential match");
    expect(tierLabel("strong", "legacy")).toBe(TIER_LABEL.strong);
    expect(TIER_LABEL.potential).toBe("Potential match");
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

  it("the one line under a pair is the row line, never the rationale (PR 3.2b replaced whyLineOf)", () => {
    const line = rowLine({ tier: "exploratory", gap: "Design: rct required, none in the evidence.", why_not: null, best_pair: { investigator: "clinical_trials", notice: "clinical_trials" }, flags: [] });
    expect(line.sentences.join(" ")).toBe("Design: Randomized controlled trial required, none in the evidence. Paradigm matches: Clinical trials work, which is what the notice asks for.");
  });
});
