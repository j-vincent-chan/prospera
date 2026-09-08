/**
 * The opportunity profile as one line of prose (fit-UX PR 3; README §"Screens
 * / views" 3) — the strip that replaces the nine-row editable facet grid at
 * the top of the recipients tab.
 */
import { describe, expect, it } from "vitest";
import { emptyFacets, profileSummaryLine, SUMMARY_TERMS } from "@/lib/outreach/profile";
import type { OpportunityProfile } from "@/lib/outreach/types";

const profile = (facets: Partial<Record<string, string[]>>): OpportunityProfile => ({
  version: 1,
  extractedAt: "2026-09-04",
  source: "llm",
  facets: { ...emptyFacets(), ...(facets as OpportunityProfile["facets"]) },
  sections: {},
  editedBy: null,
  editedAt: null,
});

describe("profileSummaryLine", () => {
  it("the README's own sentence: how many facets, then the terms", () => {
    const p = profile({ topics: ["neuroimmune signalling", "nociception", "chronic pain"], disease: ["chronic pain"], excluded: ["clinical trials"] });
    expect(profileSummaryLine(p)).toBe("Assessed against 3 facets read from the notice — neuroimmune signalling, nociception, chronic pain, chronic pain, clinical trials excluded.");
  });

  it("an excluded facet keeps its polarity in words, since the chip colour that carried it is gone", () => {
    expect(profileSummaryLine(profile({ excluded: ["clinical trials"] }))).toContain("clinical trials excluded");
  });

  it("counts the terms it does not name rather than running past the line", () => {
    const many = Array.from({ length: SUMMARY_TERMS + 4 }, (_, i) => `term ${i}`);
    const line = profileSummaryLine(profile({ topics: many }));
    expect(line).toContain("and 4 more");
    expect(line).toContain("term 0");
    expect(line).not.toContain(`term ${SUMMARY_TERMS}`);
  });

  it("one facet is singular", () => {
    expect(profileSummaryLine(profile({ topics: ["a"] }))).toBe("Assessed against 1 facet read from the notice — a.");
  });

  it("nothing extracted says what to do about it, not '0 facets'", () => {
    const line = profileSummaryLine(profile({}));
    expect(line).not.toMatch(/\b0 facets\b/);
    expect(line).toMatch(/generate suggestions|edit it by hand/i);
  });
});
