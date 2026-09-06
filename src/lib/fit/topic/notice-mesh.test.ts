import { describe, expect, it } from "vitest";
import { topicWeights } from "@/lib/fit/taxonomy";
import { buildMeshNameIndex, dropPossessive, foldMeshName, isSpecificDescriptor, lookupMeshName, mapNoticeMesh, pluralForms, singularForms, treeDepth, withNoticeMesh, type MeshNameEntry } from "@/lib/fit/topic/notice-mesh";

const rows: MeshNameEntry[] = [
  { ui: "D008168", name: "Lung", tree_numbers: ["A04.411"] },
  { ui: "D059350", name: "Chronic Pain", tree_numbers: ["C23.888.592.612.274", "F02.830.816.444.433", "G11.561.790.444.461"] },
  { ui: "D009369", name: "Neoplasms", tree_numbers: ["C04"] },
  { ui: "D001327", name: "Autoimmune Diseases", tree_numbers: ["C20.111"] },
  { ui: "D000544", name: "Alzheimer Disease", tree_numbers: ["C10.228.140.380.100", "F03.615.400.100"] },
  { ui: "D006678", name: "HIV", tree_numbers: ["B04.820.650.589.650.350"] },
  { ui: "D007249", name: "Inflammation", tree_numbers: ["C23.550.470"] },
  { ui: "D014780", name: "Viruses", tree_numbers: ["B04"] },
  { ui: "D013812", name: "Therapeutics", tree_numbers: ["E02"] },
  { ui: "D001939", name: "Brain Neoplasms", tree_numbers: ["C04.588.614.250", "C10.228.140.211"] },
  { ui: "D052061", name: "Machine Learning", tree_numbers: ["L01.224.050.375.530"] },
];
const names = buildMeshNameIndex({ rows });

describe("notice-mesh · folding and word forms", () => {
  it("folds case, whitespace, typographic quotes and dashes, and surrounding punctuation", () => {
    expect(foldMeshName("  Brain\tNeoplasms. ")).toBe("brain neoplasms");
    expect(foldMeshName("Alzheimer’s Disease")).toBe("alzheimer's disease");
    expect(foldMeshName("T‑cell")).toBe("t-cell");
    expect(foldMeshName("(HIV)")).toBe("hiv");
    expect(foldMeshName("   ")).toBe("");
  });

  it("drops possessives", () => {
    expect(dropPossessive("alzheimer's disease")).toBe("alzheimer disease");
    expect(dropPossessive("parkinsons disease")).toBe("parkinsons disease");
    expect(dropPossessive("crohn's")).toBe("crohn");
  });

  it("plural and singular forms follow the last word", () => {
    expect(pluralForms("brain neoplasm")).toEqual(["brain neoplasms"]);
    expect(pluralForms("virus")).toEqual(["viruses"]);
    expect(pluralForms("therapy")).toEqual(["therapies"]);
    expect(pluralForms("day")).toEqual(["days"]);
    expect(singularForms("neoplasms")).toEqual(["neoplasm"]);
    expect(singularForms("viruses")).toEqual(["virus", "viruse"]);
    expect(singularForms("therapies")).toEqual(["therapy"]);
    expect(singularForms("class")).toEqual([]);
    expect(singularForms("")).toEqual([]);
  });
});

describe("notice-mesh · lookup and mapping", () => {
  it("matches exactly by folded name", () => {
    expect(lookupMeshName("neoplasms", names)).toEqual({ entry: expect.objectContaining({ ui: "D009369" }), via: "exact" });
    expect(lookupMeshName("HIV", names)?.entry.ui).toBe("D006678");
    expect(lookupMeshName("machine learning", names)?.via).toBe("exact");
  });

  it("matches the plural and singular forms", () => {
    expect(lookupMeshName("autoimmune disease", names)).toEqual({ entry: expect.objectContaining({ ui: "D001327" }), via: "plural" });
    expect(lookupMeshName("brain neoplasm", names)?.via).toBe("plural");
    expect(lookupMeshName("inflammations", names)).toEqual({ entry: expect.objectContaining({ ui: "D007249" }), via: "singular" });
    expect(lookupMeshName("virus", names)?.entry.name).toBe("Viruses");
  });

  it("matches with a possessive dropped, and never fuzzily", () => {
    expect(lookupMeshName("Alzheimer’s disease", names)).toEqual({ entry: expect.objectContaining({ ui: "D000544" }), via: "possessive" });
    expect(lookupMeshName("Alzheimer’s diseases", names)?.via).toBe("possessive");
    expect(lookupMeshName("cancer", names)).toBeNull();
    expect(lookupMeshName("neoplasm of the brain", names)).toBeNull();
    expect(lookupMeshName("", names)).toBeNull();
  });

  it("maps terms and RCDC names to distinct tree numbers, listing every match and every miss with its reason", () => {
    const r = mapNoticeMesh({ terms: ["cancer", "Alzheimer's disease", "HIV", "hiv", "inflammation"], rcdc: ["Autoimmune Disease", "Brain Neoplasms", "Neuroscience"] }, names);
    expect(r.mesh).toEqual(["C10.228.140.380.100", "F03.615.400.100", "B04.820.650.589.650.350", "C23.550.470", "C04.588.614.250", "C10.228.140.211"]);
    expect(r.matches.map((m) => [m.term, m.source, m.via, m.ui])).toEqual([
      ["Alzheimer's disease", "term", "possessive", "D000544"],
      ["HIV", "term", "exact", "D006678"],
      ["inflammation", "term", "exact", "D007249"],
      ["Brain Neoplasms", "rcdc", "exact", "D001939"],
    ]);
    expect(r.unmapped).toEqual([
      { term: "cancer", source: "term", reason: "unknown" },
      { term: "Autoimmune Disease", source: "rcdc", reason: "shallow" },
      { term: "Neuroscience", source: "rcdc", reason: "unknown" },
    ]);
  });

  it("the depth guard keeps a descriptor only at the specific depth: 'lung' (A04.411) is dropped as shallow, 'chronic pain' (C23.888.592.612.274) is kept", () => {
    const min = topicWeights().min_specific_depth_for_strong;
    expect(min).toBe(3);
    expect(treeDepth("A04.411")).toBe(2);
    expect(isSpecificDescriptor({ tree_numbers: ["A04.411"] })).toBe(false);
    expect(isSpecificDescriptor({ tree_numbers: ["C04", "C23.888.592.612.274"] })).toBe(true);
    expect(isSpecificDescriptor({ tree_numbers: [] })).toBe(false);
    // the name lookup itself still finds the descriptor; the guard applies at mapping
    expect(lookupMeshName("lung", names)?.entry.ui).toBe("D008168");
    const r = mapNoticeMesh({ terms: ["lung", "chronic pain", "Neoplasms", "Viruses"], rcdc: [] }, names);
    expect(r.matches.map((m) => [m.term, m.ui])).toEqual([["chronic pain", "D059350"]]);
    expect(r.mesh).toEqual(["C23.888.592.612.274", "F02.830.816.444.433", "G11.561.790.444.461"]);
    expect(r.unmapped).toEqual([
      { term: "lung", source: "term", reason: "shallow" },
      { term: "Neoplasms", source: "term", reason: "shallow" },
      { term: "Viruses", source: "term", reason: "shallow" },
    ]);
  });

  it("withNoticeMesh fills an empty topic.mesh and leaves a coded row alone", () => {
    const empty = { topic: { mesh: [], rcdc: ["Brain Neoplasms"], terms: ["HIV"], free_text: null } };
    const filled = withNoticeMesh(empty, names);
    expect(filled.topic.mesh).toEqual(["B04.820.650.589.650.350", "C04.588.614.250", "C10.228.140.211"]);
    expect(empty.topic.mesh).toEqual([]);
    const coded = { topic: { mesh: ["C04"], rcdc: [], terms: ["HIV"], free_text: null } };
    expect(withNoticeMesh(coded, names)).toBe(coded);
    const nothing = { topic: { mesh: [], rcdc: [], terms: ["cancer", "lung"], free_text: null } };
    expect(withNoticeMesh(nothing, names)).toBe(nothing);
  });

  it("builds the index from a PR 1.4 MeshIndex too, first descriptor per folded name", () => {
    const byName = new Map(rows.map((r) => [r.name, { ...r, is_check_tag: false }]));
    const idx = buildMeshNameIndex({ byName });
    expect(idx.get("neoplasms")?.ui).toBe("D009369");
    expect(idx.size).toBe(rows.length);
  });
});
