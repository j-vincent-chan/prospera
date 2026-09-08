/**
 * The opportunity profile as one line of prose (fit-UX PR 3; README §"Screens
 * / views" 3) — the strip that replaces the nine-row editable facet grid at
 * the top of the recipients tab.
 */
import { describe, expect, it } from "vitest";
import { emptyFacets, profileOrigin, profileSummaryLine, SUMMARY_TERMS, recipientsProvenanceLine } from "@/lib/outreach/profile";
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
    // L6: "chronic pain" is both a topic and the disease, and the line names
    // it once. The **facet** count is still 3 — two facets naming the same
    // term are still two facets the notice was assessed against.
    expect(profileSummaryLine(p)).toBe("Assessed against 3 facets read from the notice — neuroimmune signalling, nociception, chronic pain, clinical trials excluded.");
  });

  it("dedupes case-insensitively, keeps the first spelling, and counts what is left after the dedupe (L6)", () => {
    // Live, the ADRN notice read "… atopic dermatitis, chronic skin
    // inflammation, defense mechanisms of the skin, **atopic dermatitis**,
    // clinical, and 5 more" — one term twice inside a five-term window, with
    // the remainder inflated by every repeat behind it.
    const p = profile({
      topics: ["Atopic dermatitis", "chronic skin inflammation", "defense mechanisms of the skin"],
      disease: ["atopic dermatitis", "ATOPIC DERMATITIS"],
      methods: ["clinical", "skin biopsy"],
      stage: ["early phase"],
    });
    const line = profileSummaryLine(p);
    expect(line).toBe("Assessed against 4 facets read from the notice — Atopic dermatitis, chronic skin inflammation, defense mechanisms of the skin, clinical, skin biopsy, and 1 more.");
    expect(line.match(/atopic dermatitis/gi)).toHaveLength(1);
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

  it("an edited profile is not called 'read from the notice', and says which version (W9)", () => {
    // The line this strip replaced carried both — "Extracted from PAR-26-118 ·
    // v3, edited by you · 5 facets" — and the hand editor is still there behind
    // "Edit what counts as a match". Telling a strategist that a profile a
    // colleague edited came from the notice is a behaviour change, not clutter
    // removed.
    const edited = { ...profile({ topics: ["nociception"] }), version: 3, editedBy: "user-1", editedAt: "2026-09-06" };
    expect(profileSummaryLine(edited)).toBe("Assessed against 1 facet read from the notice and edited by hand · v3 — nociception.");
    expect(profileSummaryLine(edited)).not.toBe(profileSummaryLine(profile({ topics: ["nociception"] })));
  });

  it("a profile the extractor never wrote says so instead of crediting the notice", () => {
    const byHand = { ...profile({ topics: ["nociception"] }), source: "empty", version: 2, editedBy: "user-1" };
    expect(profileOrigin(byHand)).toBe("entered by hand · v2");
    expect(profileSummaryLine(byHand)).toContain("entered by hand · v2");
    expect(profileSummaryLine(byHand)).not.toContain("read from the notice");
  });

  it("the origin clause is the only thing that moves", () => {
    expect(profileOrigin(profile({}))).toBe("read from the notice");
    expect(profileOrigin({ ...profile({}), editedBy: "u" })).toContain("edited by hand");
    expect(profileOrigin({ ...profile({}), source: "empty" })).toBe("on file for this notice");
  });
});

// ---------------------------------------------------------------------------
// §3j — the tab's one provenance line (fit-UX PR 5)
// ---------------------------------------------------------------------------

describe("recipientsProvenanceLine", () => {
  it("states the corpus, the method and the freshness once, from the real count", () => {
    const line = recipientsProvenanceLine(1290);
    expect(line).toMatch(/^1,290 directory profiles assessed · eligibility rules first, then ranked against the profile · refreshed nightly\./);
    expect(recipientsProvenanceLine(1)).toMatch(/^1 directory profile assessed/);
    expect(recipientsProvenanceLine(0)).toMatch(/^0 directory profiles assessed/);
  });

  it("says each of those things exactly once — the fault §3j names, on the surface §2.7 counted it on", () => {
    const line = recipientsProvenanceLine(129);
    for (const claim of [/refreshed nightly/g, /directory/gi, /ranked against the profile/g]) {
      expect(line.match(claim) ?? []).toHaveLength(1);
    }
  });

  it("keeps what the list does and does not claim: fit not merit, verified items only, and who decides", () => {
    const line = recipientsProvenanceLine(129);
    expect(line).toMatch(/describe fit, not merit/);
    expect(line).toMatch(/cite verified items only/);
    expect(line).toMatch(/name-only matches are shown in evidence but never used in reasons or messages/);
    expect(line).toMatch(/You decide who hears from the office/);
  });
});
