import { describe, expect, it } from "vitest";
import fixture from "@/lib/fit/__fixtures__/mesh-descriptors-subset.json";
import { buildMeshIndex, resolveDescriptor, type MeshDescriptorRow } from "@/lib/fit/classify/mesh";
import { normalizeGrant, normalizePublication, type NormalizedItem } from "@/lib/fit/classify/normalize";
import { formatRulesReport, summarizeRuleRuns, type RuleRun } from "@/lib/fit/classify/rules-report";
import { DEFAULT_RULE_TABLES, evaluateRules, RULE_IDS } from "@/lib/fit/classify/rules";

const index = buildMeshIndex(fixture.descriptors as MeshDescriptorRow[]);
const ctx = { mesh: index, tables: DEFAULT_RULE_TABLES };
const INV = "00000000-0000-4000-8000-000000000001";

function pub(pmid: string, names: string[]): NormalizedItem {
  return normalizePublication(
    { investigator_id: INV, pmid, mesh: names.map((n) => ({ ui: resolveDescriptor(index, n).ui, name: n, major: false, qualifiers: [] })) },
    { id: INV },
    { mesh: index }
  );
}

function run(item: NormalizedItem): RuleRun {
  return { item, result: evaluateRules(item, ctx) };
}

describe("summarizeRuleRuns", () => {
  const runs = [
    run(pub("1", ["Case-Control Studies"])),
    run(pub("2", ["Case-Control Studies", "Cross-Sectional Studies"])),
    run(pub("3", [])),
    run(normalizeGrant({ id: "g1", activity_code: "K23", study_section: "Special Emphasis Panel", study_section_code: "ZRG1", raw_json: { full_study_section: { sra_designator_code: "MJH" } } })),
    run(normalizeGrant({ id: "g2", study_section: "Special Emphasis Panel", study_section_code: "ZAI1", raw_json: { full_study_section: { sra_designator_code: "MJH" } } })),
  ];
  const s = summarizeRuleRuns(runs, [{ id: "publication:x:9", kind: "publication", error: "Unknown MeSH descriptor" }]);

  it("counts items, fired items and every rule in mapping order", () => {
    expect(s.items).toEqual({ publication: { total: 3, fired: 2 }, grant: { total: 2, fired: 1 } });
    expect(s.rules.map((r) => r.id)).toEqual([...RULE_IDS]);
    const byId = Object.fromEntries(s.rules.map((r) => [r.id, r]));
    expect(byId.mesh_case_control).toEqual({ id: "mesh_case_control", source: "pubmed", count: 2, byKind: { publication: 2 } });
    expect(byId.mesh_cross_sectional!.count).toBe(1);
    expect(byId.reporter_k23_k24).toEqual({ id: "reporter_k23_k24", source: "reporter", count: 1, byKind: { grant: 1 } });
    expect(byId.pt_rct!.count).toBe(0);
  });

  it("per-axis coverage by kind", () => {
    expect(s.axes.paradigm).toEqual({ publication: { total: 3, fired: 2 }, grant: { total: 2, fired: 1 } });
    expect(s.axes.design).toEqual({ publication: { total: 3, fired: 2 }, grant: { total: 2, fired: 0 } });
    expect(s.axes.objective).toEqual({ publication: { total: 3, fired: 0 }, grant: { total: 2, fired: 0 } });
  });

  it("dominant and assigned counts per category with the mean probability", () => {
    const paradigm = s.categories.paradigm;
    expect(paradigm[0]).toEqual({ id: "epidemiology", dominant: 2, assigned: 2, meanP: expect.closeTo((0.8 + 0.95) / 2, 10) });
    const design = Object.fromEntries(s.categories.design.map((c) => [c.id, c]));
    expect(design.case_control).toEqual({ id: "case_control", dominant: 2, assigned: 2, meanP: expect.closeTo(0.95, 10) });
    expect(design.cross_sectional).toEqual({ id: "cross_sectional", dominant: 1, assigned: 1, meanP: expect.closeTo(0.95, 10) });
  });

  it("unknown table keys are counted with an example label, failures are carried through", () => {
    expect(s.unknownTableKeys).toEqual([{ table: "study_sections", key: "MJH", count: 2, examples: ["Special Emphasis Panel [ZRG1]", "Special Emphasis Panel [ZAI1]"] }]);
    expect(s.failures).toHaveLength(1);
    expect(s.refines).toEqual([]);
  });

  it("formats as markdown with every section", () => {
    const text = formatRulesReport(s, { topCategories: 3 });
    expect(text).toContain("| publication | 3 | 2 | 66.7% |");
    expect(text).toContain("| **all** | 5 | 3 | 60.0% |");
    expect(text).toContain("| mesh_case_control | pubmed | 2 | publication 2 |");
    expect(text).toMatch(/Rules that never fired: \d+ of 70/);
    expect(text).toContain("| epidemiology | 2 | 2 | 0.88 |");
    expect(text).toContain("- study_sections · MJH: 2 — Special Emphasis Panel [ZRG1] · Special Emphasis Panel [ZAI1]");
    expect(text).toContain("- publication:x:9 (publication): Unknown MeSH descriptor");
  });
});
