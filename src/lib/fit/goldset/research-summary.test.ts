import { describe, expect, it } from "vitest";
import { clampProse, looksLikeResearchNarrative, pickGrantSummary, researchSummaryOf, type GrantSummaryRow } from "@/lib/fit/goldset/research-summary";

/** The narrative that sent us here: real text from a real gold-set investigator's Profiles page. */
const CLINIC_NARRATIVE =
  "Please call UCSF Dermatology at 415 353 7800 for clinical care inquiries or appointments. The telephone number listed here is not monitored.";

const RESEARCH_NARRATIVE =
  "My laboratory studies the immune mechanisms of allergic skin inflammation, with a focus on the cellular sources of IL-31 and how neurogenic signalling shapes the cutaneous type 2 response in atopic dermatitis.";

const grant = (over: Partial<GrantSummaryRow> = {}): GrantSummaryRow => ({
  activity_code: "R03",
  fiscal_year: 2023,
  abstract: null,
  phr_text: null,
  is_contact_pi: true,
  ...over,
});

describe("looksLikeResearchNarrative", () => {
  it("rejects the clinic-contact narrative that motivated this module", () => {
    expect(looksLikeResearchNarrative(CLINIC_NARRATIVE)).toBe(false);
  });

  it("accepts a genuine research narrative", () => {
    expect(looksLikeResearchNarrative(RESEARCH_NARRATIVE)).toBe(true);
  });

  it("rejects a phone number even without the boilerplate wording", () => {
    expect(looksLikeResearchNarrative(`${RESEARCH_NARRATIVE} Reach the lab on (415) 555-0134.`)).toBe(false);
  });

  it("rejects a directory blurb too short to be a summary, and empty input", () => {
    expect(looksLikeResearchNarrative("Dermatologist and immunologist.")).toBe(false);
    expect(looksLikeResearchNarrative(null)).toBe(false);
    expect(looksLikeResearchNarrative("   ")).toBe(false);
  });
});

describe("clampProse", () => {
  it("leaves prose within the limit untouched", () => {
    expect(clampProse("Short enough.", 100)).toBe("Short enough.");
  });

  it("cuts on a sentence boundary when one is near the limit", () => {
    const text = "First sentence runs on for a while here. Second sentence continues well past the limit we set.";
    expect(clampProse(text, 60)).toBe("First sentence runs on for a while here.");
  });

  it("falls back to a word boundary with an ellipsis when no sentence ends near the cut", () => {
    const out = clampProse(`${"antidisestablishmentarianism ".repeat(10)}end`, 50);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(51);
    expect(out).not.toContain("  ");
  });
});

describe("pickGrantSummary", () => {
  it("prefers the relevance statement over the abstract", () => {
    const out = pickGrantSummary([grant({ phr_text: "A".repeat(60), abstract: "B".repeat(60) })]);
    expect(out?.text).toBe("A".repeat(60));
  });

  it("prefers the contact-PI award, then the newest fiscal year", () => {
    const rows = [
      grant({ fiscal_year: 2025, is_contact_pi: false, phr_text: "supporting role".padEnd(60, ".") }),
      grant({ fiscal_year: 2019, is_contact_pi: true, phr_text: "own programme".padEnd(60, ".") }),
      grant({ fiscal_year: 2023, is_contact_pi: true, phr_text: "own newer programme".padEnd(60, ".") }),
    ];
    expect(pickGrantSummary(rows)?.text).toMatch(/^own newer programme/);
  });

  it("falls back to an abstract only when no award carries a statement, and clamps it", () => {
    const out = pickGrantSummary([grant({ abstract: "word ".repeat(400) })], 120);
    expect(out?.text.length).toBeLessThanOrEqual(121);
    expect(out?.source).toBe("NIH RePORTER · R03 FY2023");
  });

  it("ignores stub text too short to be a summary", () => {
    expect(pickGrantSummary([grant({ phr_text: "n/a", abstract: "  " })])).toBeNull();
  });

  it("degrades the source label when the award's fields are missing", () => {
    const out = pickGrantSummary([grant({ activity_code: null, fiscal_year: null, phr_text: "X".repeat(60) })]);
    expect(out?.source).toBe("NIH RePORTER");
  });

  it("returns null for an investigator with no grants", () => {
    expect(pickGrantSummary([])).toBeNull();
  });
});

describe("researchSummaryOf", () => {
  it("takes the grant statement over any narrative", () => {
    const out = researchSummaryOf([grant({ phr_text: "P".repeat(60) })], RESEARCH_NARRATIVE);
    expect(out).toEqual({ text: "P".repeat(60), source: "NIH RePORTER · R03 FY2023" });
  });

  it("uses a research narrative when there is no grant text", () => {
    expect(researchSummaryOf([], RESEARCH_NARRATIVE)?.source).toBe("UCSF Profiles");
  });

  it("shows nothing rather than the clinic narrative", () => {
    expect(researchSummaryOf([], CLINIC_NARRATIVE)).toBeNull();
    expect(researchSummaryOf([], null)).toBeNull();
  });
});
