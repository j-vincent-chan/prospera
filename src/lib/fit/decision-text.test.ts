/**
 * The invariant itself (fit-UX final round, B1), and the three levels
 * `plainClause` applies: rewrite, prune, drop.
 *
 * The strings quoted here are the ones the validator read off a rendered page,
 * not shapes invented in this file — every `leaked` case below is a substring
 * of what the real engine wrote for one of the nine adversarial fixtures.
 */
import { describe, expect, it } from "vitest";
import { isEngineValueText, plainClause, plainClauses, plainOrNull, sentencesOf } from "@/lib/fit/decision-text";
import type { Collaborator } from "@/lib/fit/types";

describe("isEngineValueText — the invariant", () => {
  const leaked = [
    "Objective 0.63",
    "Rct | early_phase_trial required, rct 0.70",
    "4 coded matches (C20.111.590 at depth 3), score supplied",
    "3 coded matches (D12.776.543.750.705.816.824 at depth 7)",
    "Not in the evidence: C12.777.419.780, C12.777.419.780.750, Kidney Disease.",
    "; prospective_cohort prohibited (80% of design mass)",
    "Topic 0.30 is below the Exploratory floor 0.35",
    "Track record 0.10: no NIH mechanism held against R21",
    "yours is Molecular / cellular mechanistic (0.85, recent view) (support 0.05)",
    "Collaborators in the directory who do this: 3f1a2b4c-55d6-4e7f-8a9b-0c1d2e3f4a5b.",
    "Descriptor D008180 is not in the evidence",
  ];
  for (const text of leaked) {
    it(`refuses ${JSON.stringify(text.slice(0, 48))}`, () => {
      expect(isEngineValueText(text)).toBe(true);
    });
  }

  const kept = [
    "Well evidenced · 48 papers, 2 awards",
    "3 of 3",
    "11 weeks to the deadline",
    "K23, R01, U01 held vs. R01",
    "No R21 or equivalent in the recent record",
    "The notice works at L3 (human individual); the evidence is at L1 (molecular–cellular)",
    "Two completed trials (2019-2024) in this population",
    "Trial leadership in SLE (PMID:123) matches the notice's design",
    "3 of 4; missing enrolled_participants",
  ];
  for (const text of kept) {
    it(`allows ${JSON.stringify(text.slice(0, 48))}`, () => {
      expect(isEngineValueText(text)).toBe(false);
    });
  }

  it("an activity code is not an ontology code", () => {
    // The narrow half of the rule: `R01`, `K23`, `U01`, `R18`, `R21` are facts
    // the row names on purpose; a MeSH tree number is dotted and a descriptor
    // id is six digits.
    for (const code of ["R01", "K23", "U01", "R18", "R21", "P30", "T32"]) expect(isEngineValueText(`Held ${code} as PI`), code).toBe(false);
    for (const code of ["C20.111.590", "G12.425.400", "D008180"]) expect(isEngineValueText(`Coded ${code}`), code).toBe(true);
  });
});

describe("plainClause — rewrite", () => {
  it("takes the axis label and its value off the head, however the engine punctuated the join", () => {
    expect(plainClause("Paradigm 0.45 — Clinical trials vs. required Genetic epidemiology")).toBe("Clinical trials vs. required Genetic epidemiology.");
    expect(plainClause("Track record 0.10: no NIH mechanism held against R21")).toBe("No NIH mechanism held against R21.");
    expect(plainClause("Topic 0.30 is no coded match at depth ≥ 3")).toBe("No coded match at depth ≥ 3.");
  });

  it("drops a parenthetical that is a value and keeps one that is not", () => {
    expect(plainClause("Yours is Molecular / cellular mechanistic (0.85, recent view) (support 0.05)")).toBe("Yours is Molecular / cellular mechanistic.");
    expect(plainClause("Unit: notice works at L4 (human aggregate); yours is L1 (molecular–cellular) (0.10).")).toBe("Unit: notice works at L4 (human aggregate); yours is L1 (molecular–cellular).");
    expect(plainClause("4 coded matches (C20.111.590 at depth 3), score supplied")).toBe("4 coded matches, score supplied.");
  });

  it("says a design group's support in words, and does not sentence-case the taxonomy's own ids", () => {
    // `taxonomy.json` gives designs no display label, so the id is what the
    // engine writes — and "Rct | early_phase_trial" is a word nobody wrote.
    expect(plainClause("rct | early_phase_trial required, rct 0.70")).toBe("rct | early_phase_trial required, rct in the evidence.");
    expect(plainClause("rct | early_phase_trial required, none in the evidence")).toBe("rct | early_phase_trial required, none in the evidence.");
    expect(plainClause("hybrid_effectiveness_implementation | implementation_evaluation required, none in the evidence")).toBe(
      "hybrid_effectiveness_implementation | implementation_evaluation required, none in the evidence."
    );
    // …but an ordinary clause is still a sentence
    expect(plainClause("missing gwas | secondary_data_analysis, ehr")).toBe("Missing gwas | secondary_data_analysis, ehr.");
  });

  it("drops the one percentage the engine writes, in both places it writes it", () => {
    expect(plainClause("Design 0.30 — cohort required, cohort 0.20; prospective_cohort prohibited (80% of design mass)")).toBe("Cohort required, cohort in the evidence; prospective_cohort prohibited.");
    expect(plainClause("The notice prohibits prospective_cohort, 80% of the design evidence; the application, not the person, is constrained.")).toBe(
      "The notice prohibits prospective_cohort; the application, not the person, is constrained."
    );
  });

  it("matches a floor comparison only at the start of its own clause, so it cannot eat a sentence boundary", () => {
    // The `.;` bug: the old unanchored pattern started on the space after
    // `"evidence."` and took the space with it.
    expect(plainClause("Methods 0.25 is below the Moderate floor 0.3; missing gwas, ehr")).toBe("Missing gwas, ehr.");
    expect(plainClauses("Design: rct required, none in the evidence. Methods 0.25 is below the Moderate floor 0.3; missing ehr.").join(" ")).toBe(
      "Design: rct required, none in the evidence. Missing ehr."
    );
  });
});

describe("plainClause — prune, then drop", () => {
  it("a list keeps its safe members", () => {
    expect(plainClause("not in the evidence: C12.777.419.780, C12.777.419.780.750, Kidney Disease")).toBe("Not in the evidence: Kidney Disease.");
  });

  it("drops the engine's caps clause: a cap id is not a value, and naming one is still the inspector's voice", () => {
    expect(plainClause("Caps — paradigm_gate (exploratory: P 0.45 < 0.45); design_required_unsupported (exploratory: required design unsupported: rct)")).toBeNull();
    expect(plainOrNull("Clinical trials vs. required Genetic epidemiology · Caps — paradigm_gate (exploratory: P 0.45 < 0.45)")).toBe("Clinical trials vs. required Genetic epidemiology.");
  });

  it("and is dropped when nothing readable survives", () => {
    expect(plainClause("not in the evidence: C12.777.419.780, C12.777.419.780.750")).toBeNull();
  });

  it("a clause whose whole content was a value is dropped, not shipped as its label", () => {
    expect(plainClause("Objective 0.63")).toBeNull();
    expect(plainClause("Paradigm 1.00")).toBeNull();
  });

  it("and so is anything else the rewrites cannot make safe", () => {
    expect(plainClause("S 62.4 orders this pair inside its tier")).toBeNull();
  });
});

describe("plainClause — the collaborator clause is names or nothing", () => {
  const collaborators = (over: Partial<Collaborator>[] = []): Collaborator[] =>
    over.map((c, i) => ({ id: `id-${i}`, name: null, dominant_family: "clinical", categories: [], ...c }) as Collaborator);

  it("renders names when the profile has them", () => {
    expect(
      plainClause("Collaborators in the directory who do this: id-0, id-1.", {
        collaborators: collaborators([{ name: "Ada One" }, { name: "Ben Two" }]),
      })
    ).toBe("Collaborators in the directory who do this: Ada One, Ben Two.");
  });

  it("drops the clause when even one id has no name — an id is not something a strategist can act on", () => {
    expect(plainClause("Collaborators in the directory who do this: id-0, id-1.", { collaborators: collaborators([{ name: "Ada One" }, {}]) })).toBeNull();
    expect(plainClause("Collaborators in the directory who do this: id-0.", {})).toBeNull();
  });
});

describe("plainClauses and plainOrNull", () => {
  it("splits on the engine's own clause separator and caps the paragraph", () => {
    const long = Array.from({ length: 12 }, (_, i) => `Axis ${i} 0.50 — a clause about component number ${i} and what it says`).join(" · ");
    expect(plainClauses(long, { max: 200 }).join(" ").length).toBeLessThanOrEqual(200);
  });

  it("limit takes the first n safe clauses", () => {
    expect(plainClauses("Paradigm: a vs b. Unit: c vs d. Topic: e vs f.", { limit: 1 })).toEqual(["Paradigm: a vs b."]);
  });

  it("plainOrNull returns a safe string untouched", () => {
    expect(plainOrNull("Well evidenced · 48 papers, 2 awards")).toBe("Well evidenced · 48 papers, 2 awards");
    expect(plainOrNull("")).toBeNull();
    expect(plainOrNull(null)).toBeNull();
  });

  it("and re-reads an unsafe one clause by clause, losing only what it must", () => {
    expect(plainOrNull("Same approach. Objective 0.63. Multi-PI allowed.")).toBe("Same approach. Multi-PI allowed.");
    expect(plainOrNull("Objective 0.63")).toBeNull();
  });
});

describe("sentencesOf", () => {
  it("splits the shape `engine/explain.ts` joins its gap sentences in", () => {
    expect(sentencesOf("Paradigm: a vs b. Unit: notice works at L5. Topic 0.30 is below the floor.")).toEqual(["Paradigm: a vs b.", "Unit: notice works at L5.", "Topic 0.30 is below the floor."]);
  });

  it("nothing in, nothing out; punctuation alone is nothing; a decimal is not a sentence end", () => {
    expect(sentencesOf(null)).toEqual([]);
    expect(sentencesOf("  ")).toEqual([]);
    expect(sentencesOf(".")).toEqual([]);
    expect(sentencesOf("Topic 0.30 is below the Exploratory floor 0.35.")).toEqual(["Topic 0.30 is below the Exploratory floor 0.35."]);
  });
});
