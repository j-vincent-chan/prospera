import { describe, expect, it } from "vitest";
import { forbiddenCellPairs, hydrateInvestigator, hydrateOpportunity } from "@/lib/fit/engine/fixtures";
import { cellKey, forbiddenCellKeys, investigatorFamily, isMatrixFamilySlot, noticeFamily, offDiagonalCells, FAMILY_SLOTS } from "@/lib/fit/goldset/families";
import { thinEvidence } from "@/lib/fit/taxonomy";

describe("goldset/families · investigatorFamily", () => {
  it("takes the recent view's dominant category when the recent view is not thin", () => {
    const inv = hydrateInvestigator("i", { paradigm: { career: { molecular_cellular_mechanistic: 0.9 }, recent: { clinical_trials: 0.8, molecular_cellular_mechanistic: 0.5 } } });
    expect(investigatorFamily(inv)).toEqual({ family: "clinical", category: "clinical_trials", weight: 0.8, view: "recent" });
  });
  it("falls back to the career view when no recent category exceeds thin_evidence.cap", () => {
    const cap = thinEvidence().cap;
    const inv = hydrateInvestigator("i", { paradigm: { career: { epidemiology: 0.7 }, recent: { clinical_trials: cap } } });
    expect(investigatorFamily(inv)).toMatchObject({ family: "population", category: "epidemiology", view: "career" });
  });
  it("places a cross-cutting dominant in cross_cutting and an empty profile in none", () => {
    expect(investigatorFamily(hydrateInvestigator("i", { paradigm: { recent: { computational_data_science: 0.9, epidemiology: 0.4 } } })).family).toBe("cross_cutting");
    expect(investigatorFamily(hydrateInvestigator("i", { paradigm: { recent: {} } }))).toEqual({ family: "none", category: null, weight: 0, view: "career" });
  });
});

describe("goldset/families · noticeFamily", () => {
  it("is the family carrying the most required weight", () => {
    const opp = hydrateOpportunity("o", { paradigm: { required: { epidemiology: 0.6, population_health: 0.5, clinical_trials: 0.9 } } });
    expect(noticeFamily(opp)).toEqual({ family: "population", from: "required", category: "epidemiology" });
  });
  it("falls back to the heaviest required_any category's family (D14), else none", () => {
    expect(noticeFamily(hydrateOpportunity("o", { paradigm: { required_any: { early_phase_human_experimental: 1, human_biospecimen: 0.8 } } }))).toEqual({ family: "translational", from: "required_any", category: "early_phase_human_experimental" });
    expect(noticeFamily(hydrateOpportunity("o", { paradigm: { allowed: { epidemiology: 0.5 } } }))).toEqual({ family: "none", from: "none", category: null });
  });
});

describe("goldset/families · cells", () => {
  it("lists the 30 off-diagonal cells of the six-family matrix in taxonomy order", () => {
    const cells = offDiagonalCells();
    expect(cells).toHaveLength(30);
    expect(cells[0]).toEqual({ investigator: "discovery", notice: "preclinical" });
    expect(cells.every((c) => c.investigator !== c.notice)).toBe(true);
    expect(new Set(cells.map((c) => cellKey(c.investigator, c.notice))).size).toBe(30);
  });
  it("the fixture's eight forbidden cells are all off-diagonal keys", () => {
    const forbidden = forbiddenCellKeys(forbiddenCellPairs());
    expect(forbidden.size).toBe(8);
    const keys = new Set(offDiagonalCells().map((c) => cellKey(c.investigator, c.notice)));
    for (const k of forbidden) expect(keys.has(k)).toBe(true);
    expect(forbidden.has("discovery->population")).toBe(true);
  });
  it("matrix slots exclude cross_cutting and none", () => {
    expect(FAMILY_SLOTS).toContain("cross_cutting");
    expect(isMatrixFamilySlot("cross_cutting")).toBe(false);
    expect(isMatrixFamilySlot("none")).toBe(false);
    expect(isMatrixFamilySlot("health_systems")).toBe(true);
  });
});
