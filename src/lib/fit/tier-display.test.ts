import { describe, expect, it } from "vitest";
import { FIT_TIER_LABEL, TIER_PILL_VARIANT, tierHelp, tierLabel } from "@/lib/fit/tier-display";
import { compareFitRows, suggestionTierOf, TIER_RANK } from "@/lib/fit/results";
import { plainWhyLine, VALUES_ONLY } from "@/lib/fit/verdicts";
import { TIER_HELP, TIER_LABEL } from "@/lib/outreach/types";

describe("tier display (PR 2.3)", () => {
  it("every pill tier has a variant and a label; only the legacy pill has a tooltip", () => {
    for (const tier of ["strong", "potential", "exploratory"] as const) {
      expect(TIER_PILL_VARIANT[tier]).toBe(`tier-${tier}`);
      expect(TIER_LABEL[tier]).toMatch(/\S/);
      expect(tierHelp(tier, "legacy")).toBe(TIER_HELP[tier]);
    }
  });

  it("fit-UX PR 5: a fit-v1 pill carries no tooltip — the model is not explained on a decision surface (§3a)", () => {
    for (const tier of ["strong", "potential", "exploratory"] as const) {
      expect(tierHelp(tier, "fit-v1")).toBeUndefined();
    }
    // The floors vocabulary is gone from every fit-v1 string this module owns.
    for (const engine of ["fit-v1", "legacy"] as const) {
      for (const tier of ["strong", "potential", "exploratory"] as const) {
        expect(tierLabel(tier, engine)).not.toMatch(/floor/i);
      }
    }
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

  it("plainWhyLine: one sentence, the resolved text over the stored rationale, the gap only when the rationale said nothing, and never a number", () => {
    // B3: **one** sentence. PR 5's commit claimed this and the code did not do
    // it — `plainSentence` was applied to the whole `gap` paragraph and
    // `sentence()` only punctuates, so an Exploratory row rendered the
    // rationale's first clause plus every gap sentence the engine wrote (291
    // characters at 11px on fixture 3). The gap is now a fallback, not an
    // appendix.
    expect(plainWhyLine({ tier: "strong", rationale: "Paradigm 1.00 — same approach.", gap: "ignored" })).toBe("Same approach.");
    expect(plainWhyLine({ tier: "exploratory", rationale: "Paradigm 0.60 — shared unit.", gap: "Design: a trialist collaborator." })).toBe("Shared unit.");
    expect(plainWhyLine({ tier: "exploratory", rationale: null, gap: "Only the gap. And a second sentence." })).toBe("Only the gap.");
    expect(plainWhyLine({ tier: "strong", rationale: "x", gap: null }, "Overlaps the microglia work (yours 0.85).")).toBe("Overlaps the microglia work.");
    // A rationale that was values from end to end is not "no rationale stored".
    expect(plainWhyLine({ tier: "strong", rationale: "Paradigm 1.00.", gap: null })).toBe(VALUES_ONLY);
  });

  it("fit-UX PR 5: plainWhyLine de-numbers the engine's voice and never falls back to a score", () => {
    // The three shapes `plainSentence` exists for, on the path the peek renders.
    expect(plainWhyLine({ tier: "moderate", rationale: "Paradigm 0.45 — Clinical trials (yours 0.85) vs. required Genetic epidemiology.", gap: null })).not.toMatch(/\d/);
    expect(plainWhyLine({ tier: "exploratory", rationale: "Unit 0.40 — tissue and cell.", gap: "Topic 0.30 is below the Exploratory floor 0.35." })).not.toMatch(/0\.\d/);
    // The fallback `whyLineOf` had was `Fit: Moderate match · score 56.`
    for (const tier of ["strong", "moderate", "exploratory", "poor"] as const) {
      const line = plainWhyLine({ tier, rationale: null, gap: null });
      expect(line).toBe("No rationale stored.");
      expect(line).not.toMatch(/score|\d/i);
    }
  });
});
