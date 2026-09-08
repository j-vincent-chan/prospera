/**
 * The two-sentence row line (PR 3.2b): the binding gap first below Strong,
 * what matched second, ids read as labels, and the engine's `rationale`
 * nowhere near it.
 */
import { describe, expect, it } from "vitest";
import { hasRawId } from "@/lib/fit/inspect/display-labels";
import { firstClause, gapClause, matchSentence, rowFlags, rowLine, ROW_CLAUSE_MAX, sentencesFor, snapshotLine, whyNotLine, type RowLineInput } from "@/lib/fit/row-line";
import { GAP_REASON_TITLE, type SuggestionReason } from "@/lib/outreach/types";

const row = (over: Partial<RowLineInput> = {}): RowLineInput => ({ tier: "moderate", gap: null, why_not: null, best_pair: null, flags: [], ...over });

/** A real Exploratory `gap`: `gapSentences` joined, gate order, ids inline. */
const GAP =
  "Paradigm: notice requires genetic_epidemiology, epidemiology; yours is clinical_trials (0.62, recent view) (support 0.41). Collaborators in the directory who do this: Ada Byron, Grace Hopper. " +
  "Design: rct | early_phase_trial | pragmatic_trial required, none in the evidence. " +
  "Topic 0.18 is below the Moderate floor 0.35; not in the evidence: lupus nephritis, proteinuria.";

describe("row-line · firstClause is the binding one", () => {
  it("takes the first clause and does not split on a decimal", () => {
    expect(firstClause(GAP)).toBe("Paradigm: notice requires genetic_epidemiology, epidemiology; yours is clinical_trials (0.62, recent view) (support 0.41).");
    expect(firstClause("Topic 0.18 is below the Exploratory floor 0.35.")).toBe("Topic 0.18 is below the Exploratory floor 0.35.");
    expect(firstClause(null)).toBeNull();
    expect(firstClause("   ")).toBeNull();
  });

  it("drops the collaborator tail, which the engine writes as investigator ids", () => {
    const withIds = "Paradigm: notice requires rct. Collaborators in the directory who do this: 0f5b1b2c-1111-4222-8333-444455556666, 7a2e0000-2222-4333-8444-555566667777.";
    expect(firstClause(withIds)).toBe("Paradigm: notice requires rct.");
    expect(firstClause("Design: rct required, none in the evidence. Collaborators in the directory who do this: 0f5b1b2c-1111-4222-8333-444455556666.")).toBe("Design: rct required, none in the evidence.");
  });
});

describe("row-line · matchSentence", () => {
  it("says the paradigm matched when the pair is the same category", () => {
    expect(matchSentence({ best_pair: { investigator: "clinical_trials", notice: "clinical_trials" } })).toBe("Paradigm matches: Clinical trials work, which is what the notice asks for.");
  });
  it("names both sides when they differ", () => {
    expect(matchSentence({ best_pair: { investigator: "epidemiology", notice: "clinical_trials" } })).toBe("Closest on paradigm: Epidemiology work against the notice's Clinical trials.");
  });
  it("says what carried the row when the notice requires no paradigm", () => {
    expect(matchSentence({ best_pair: null })).toBe("The notice names no paradigm requirement, so this ranks on topic, design and track record.");
  });
});

describe("row-line · gapClause", () => {
  it("reads the ids as labels and cuts to one line", () => {
    const gap = gapClause(row({ tier: "exploratory", gap: "Design: rct | early_phase_trial | pragmatic_trial required, none in the evidence." }))!;
    expect(gap).toBe("Design: Randomized controlled trial or Early-phase trial or Pragmatic trial required, none in the evidence.");
    expect(hasRawId(gap)).toBe(false);
  });

  it("keeps a clause that fits and reads its ids", () => {
    const kept = gapClause(row({ tier: "exploratory", gap: GAP }))!;
    expect(kept).toBe("Paradigm: notice requires Genetic epidemiology, Epidemiology; yours is Clinical trials (0.62, recent view) (support 0.41).");
    expect(hasRawId(kept)).toBe(false);
  });

  it("clips a longer one on a word boundary", () => {
    const long = "Topic 0.18 is below the Moderate floor 0.35; not in the evidence: lupus nephritis, proteinuria, interferon signature, glomerulonephritis, complement activation, anti-dsDNA antibodies, renal biopsy scoring.";
    const clipped = gapClause(row({ tier: "exploratory", gap: long }))!;
    expect(clipped.length).toBeLessThanOrEqual(ROW_CLAUSE_MAX);
    expect(clipped.endsWith("…")).toBe(true);
    expect(clipped.startsWith("Topic 0.18 is below the Moderate floor 0.35")).toBe(true);
    expect(clipped).not.toMatch(/[a-z]…$/);
  });

  it("never leaves a collaborator id in the row", () => {
    const gap = gapClause(row({ tier: "exploratory", gap: "Design: rct required, none in the evidence. Collaborators in the directory who do this: 0f5b1b2c-1111-4222-8333-444455556666." }))!;
    expect(gap).toBe("Design: Randomized controlled trial required, none in the evidence.");
  });

  it("reads a Poor row's why_not and a Strong row's absence of either", () => {
    expect(gapClause(row({ tier: "poor", why_not: "Topic 0.18 is below the Exploratory floor 0.35." }))).toBe("Topic 0.18 is below the Exploratory floor 0.35.");
    expect(gapClause(row({ tier: "strong" }))).toBeNull();
  });
});

describe("row-line · the two sentences", () => {
  it("puts the gap first on anything below Strong and the match first on Strong", () => {
    expect(sentencesFor("moderate", "Gap.", "Match.")).toEqual(["Gap.", "Match."]);
    expect(sentencesFor("exploratory", "Gap.", "Match.")).toEqual(["Gap.", "Match."]);
    expect(sentencesFor("strong", "Gap.", "Match.")).toEqual(["Match.", "Gap."]);
    expect(sentencesFor("strong", null, "Match.")).toEqual(["Match."]);
  });

  it("is never more than two sentences, whatever the engine wrote", () => {
    const line = rowLine(row({ tier: "exploratory", gap: GAP, best_pair: { investigator: "clinical_trials", notice: "genetic_epidemiology" } }));
    expect(line.sentences).toHaveLength(2);
    expect(line.sentences[0]).toBe(line.gap);
    expect(line.sentences[1]).toBe("Closest on paradigm: Clinical trials work against the notice's Genetic epidemiology.");
    expect(line.sentences.join(" ").length).toBeLessThan(GAP.length);
  });

  it("a Strong row reads as one sentence", () => {
    const line = rowLine(row({ tier: "strong", best_pair: { investigator: "clinical_trials", notice: "clinical_trials" } }));
    expect(line.sentences).toEqual(["Paradigm matches: Clinical trials work, which is what the notice asks for."]);
    expect(line.gap).toBeNull();
  });
});

describe("row-line · flags", () => {
  it("dedupes, trims and reads the ids in them", () => {
    expect(
      rowFlags(["mechanism far above readiness; consider as project lead, not PI", " notice prohibits rct, which dominates the design evidence (75%) ", "mechanism far above readiness; consider as project lead, not PI"])
    ).toEqual(["mechanism far above readiness; consider as project lead, not PI", "notice prohibits Randomized controlled trial, which dominates the design evidence (75%)"]);
    expect(rowFlags(null)).toEqual([]);
  });
});

describe("row-line · whyNotLine", () => {
  it("is the binding clause with a fallback that is still a sentence", () => {
    expect(whyNotLine("Design: rct required, none in the evidence. Topic 0.10 is below the Exploratory floor 0.35.")).toBe("Design: Randomized controlled trial required, none in the evidence.");
    expect(whyNotLine(null)).toBe("Below the Exploratory floors.");
    expect(whyNotLine("  ")).toBe("Below the Exploratory floors.");
  });
});

describe("row-line · snapshotLine (the Outreach board's stored snapshots)", () => {
  const rationale = (text: string): SuggestionReason => ({ text, source: "Fit engine · paradigm, design, topic", title: "Exploratory fit", evidenceIds: [] });
  const gap = (text: string): SuggestionReason => ({ text, source: "Fit engine · gap", title: GAP_REASON_TITLE, evidenceIds: [] });
  const track: SuggestionReason = { text: "Has held K23 as PI; this notice is an R01.", source: "RePORTER · mechanisms held", title: "Track record", evidenceIds: [] };
  const DUMP =
    "Paradigm 0.62 — Clinical observational (yours 0.85) vs. required clinical_trials · Unit 0.80 — L3 vs. required L3 · Design 0.10 — rct | early_phase_trial required, none in the evidence · " +
    "Topic 0.18 — 1 coded match (C20.111.197 at depth 3) · Methods 0.50 — 1 of 2 · Objective 0.40 · Track record 0.20 — K23 held vs. R01 · Actionability 0.90 — 12 weeks to the deadline · Caps — readiness_far (moderate: K23 vs R01)";

  it("takes the paradigm clause as what matched and the binding gap clause, gap first below Strong", () => {
    const line = snapshotLine({ tier: "exploratory", reasons: [rationale(DUMP), gap("Design: rct | early_phase_trial required, none in the evidence. Topic 0.18 is below the Moderate floor 0.35."), track] }, "fit-v1");
    expect(line.sentences).toEqual([
      "Design: Randomized controlled trial or Early-phase trial required, none in the evidence.",
      "Paradigm 0.62 — Clinical observational (yours 0.85) vs. required Clinical trials",
    ]);
    expect(line.sentences.join(" ").length).toBeLessThan(DUMP.length / 2);
    expect(line.sentences.join(" ")).not.toContain("Actionability");
    expect(hasRawId(line.sentences.join(" "))).toBe(false);
  });

  it("a Strong snapshot is one sentence, and a snapshot with no rationale still says something", () => {
    expect(snapshotLine({ tier: "strong", reasons: [rationale("Paradigm 1.00 — Clinical trials vs. required Clinical trials · Topic 0.70 — 3 coded matches")] }, "fit-v1").sentences).toEqual([
      "Paradigm 1.00 — Clinical trials vs. required Clinical trials",
    ]);
    expect(snapshotLine({ tier: "strong", reasons: [] }, "fit-v1").sentences).toEqual(["No rationale stored."]);
  });

  it("a legacy team keeps its own first reason: nothing is rewritten under the old engine", () => {
    const legacy: SuggestionReason = { text: "Direct overlap with “Anifrolumab in SLE” (2024) and 3 more items (PubMed, RePORTER). Evidence: strong.", source: "PubMed", title: "Strong fit", evidenceIds: [] };
    expect(snapshotLine({ tier: "strong", reasons: [legacy] }, "legacy").sentences).toEqual([legacy.text]);
  });
});

describe("row-line · a row never says the same thing twice", () => {
  it("drops a flag the sentences above already carry, and keeps the ones they do not", () => {
    const line = rowLine({
      tier: "moderate",
      gap: "Track record 0.20: K23 held against an R01 — far above readiness; consider as project lead, not PI.",
      why_not: null,
      best_pair: { investigator: "clinical_trials", notice: "clinical_trials" },
      flags: ["mechanism far above readiness; consider as project lead, not PI", "deadline runway short; show the next cycle if the notice has one"],
    });
    expect(line.flags).toEqual(["deadline runway short; show the next cycle if the notice has one"]);
    expect(rowFlags(["already in the Outreach pipeline"], ["Nothing about pipelines here."])).toEqual(["already in the Outreach pipeline"]);
  });
});
