import { describe, expect, it } from "vitest";
import fixture from "@/lib/fit/__fixtures__/mesh-descriptors-subset.json";
import {
  buildMeshIndex,
  formatSignalMappingValidation,
  isUnder,
  MeshUnknownDescriptorError,
  resolveDescriptor,
  treeNumberIsUnder,
  treeNumbers,
  treePrefixExists,
  triangleClass,
  validateSignalMapping,
  type MeshDescriptorRow,
} from "@/lib/fit/classify/mesh";
import {
  MESH_CHECK_TAG_NAMES,
  parseDescriptorRecord,
  parseMeshDescriptorRecords,
} from "@/lib/fit/classify/mesh-descriptor-file";

const rows = fixture.descriptors as MeshDescriptorRow[];
const index = buildMeshIndex(rows);
const ui = (name: string) => resolveDescriptor(index, name).ui;

describe("resolveDescriptor", () => {
  it("resolves by exact name and by UI", () => {
    expect(resolveDescriptor(index, "Humans")).toMatchObject({ ui: "D006801", is_check_tag: true });
    expect(resolveDescriptor(index, "D006801").name).toBe("Humans");
    expect(treeNumbers(index, "D006801")).toEqual(["B01.050.150.900.649.313.988.400.112.400.400"]);
  });

  it("fails loudly on an unknown name, with a hint when only the case differs", () => {
    expect(() => resolveDescriptor(index, "Cohort Study")).toThrow(MeshUnknownDescriptorError);
    expect(() => resolveDescriptor(index, "Cohort Study")).toThrow(/Unknown MeSH descriptor: "Cohort Study"/);
    let caught: unknown;
    try {
      resolveDescriptor(index, "humans");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(MeshUnknownDescriptorError);
    expect((caught as MeshUnknownDescriptorError).suggestion).toBe("Humans");
    expect(String(caught)).toMatch(/did you mean "Humans"/);
  });
});

describe("tree numbers", () => {
  it("prefix matching respects segment boundaries", () => {
    expect(treeNumberIsUnder("B01.050", "B01")).toBe(true);
    expect(treeNumberIsUnder("B01.050", "B01.050")).toBe(true);
    expect(treeNumberIsUnder("B01.050", "B01.05")).toBe(false);
    expect(treeNumberIsUnder("B010.050", "B01")).toBe(false);
    expect(treeNumberIsUnder("V03.175.250", "V")).toBe(true); // category letter, no dot
    expect(treeNumberIsUnder("B01.050", "V")).toBe(false);
  });

  it("isUnder / treePrefixExists", () => {
    expect(isUnder(index, ui("Mice"), "B01")).toBe(true);
    expect(isUnder(index, ui("Mice"), "B01.050.150.900.649.313.988")).toBe(false);
    expect(isUnder(index, ui("Female"), "B01")).toBe(false); // check tags carry no tree numbers
    expect(treePrefixExists(index, "G04")).toBe(true);
    expect(treePrefixExists(index, "G02.149")).toBe(false); // retired in the 2026 file
  });
});

describe("triangleClass (Weber)", () => {
  it("assigns the vertices a paper's descriptors touch", () => {
    expect(triangleClass(index, [ui("Humans")])).toBe("H");
    expect(triangleClass(index, [ui("Adult")])).toBe("H"); // M01 persons
    expect(triangleClass(index, [ui("Mice")])).toBe("A");
    expect(triangleClass(index, [ui("Animals")])).toBe("A");
    expect(triangleClass(index, [ui("Cell Line")])).toBe("C");
    expect(triangleClass(index, [ui("Escherichia coli")])).toBe("C"); // B03 bacteria
    expect(triangleClass(index, [ui("Cell Physiological Phenomena")])).toBe("C"); // G04, formerly G02.149
  });

  it("compound classes mark translational bridges", () => {
    expect(triangleClass(index, [ui("Mice"), ui("Humans")])).toBe("AH");
    expect(triangleClass(index, [ui("HeLa Cells"), ui("Humans")])).toBe("CH");
    expect(triangleClass(index, [ui("Mice"), ui("HeLa Cells"), ui("Humans"), ui("Female")])).toBe("ACH");
  });

  it("H is matched by the Humans UI, so a renumbered Humans tree cannot break it (D12)", () => {
    const renumbered = buildMeshIndex(
      rows.map((r) => (r.ui === "D006801" ? { ...r, tree_numbers: ["B01.999.999"] } : r))
    );
    expect(triangleClass(renumbered, ["D006801"])).toBe("H");
    expect(triangleClass(renumbered, ["D006801", resolveDescriptor(renumbered, "Mice").ui])).toBe("AH");
    // and Humans is never counted as an animal even though it sits under B01
    expect(triangleClass(index, [ui("Humans")])).toBe("H");
  });

  it("is null when nothing applies, and throws on a UI outside the vocabulary", () => {
    expect(triangleClass(index, [ui("Randomized Controlled Trial"), ui("Female")])).toBeNull();
    expect(triangleClass(index, [])).toBeNull();
    expect(() => triangleClass(index, ["D999999"])).toThrow(MeshUnknownDescriptorError);
  });
});

describe("validateSignalMapping", () => {
  it("every name and prefix in signal-mapping.json resolves against the fixture (regenerate the fixture when the mapping changes)", () => {
    const v = validateSignalMapping(index);
    expect(v.unmatched, formatSignalMappingValidation(v)).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.counts).toEqual({ mesh: 91, check_tag: 7, pubtype: 10, mesh_tree: 0, triangle_tree: 8, triangle_ui: 1 });
  });

  it("warns that Zebrafish, Primates and Macaca are ordinary descriptors used in a check_tag clause", () => {
    const v = validateSignalMapping(index);
    const warned = v.warnings.filter((w) => w.kind === "check_tag").map((w) => w.value).sort();
    expect(warned).toEqual(["Macaca", "Primates", "Zebrafish"]);
    expect(v.warnings.find((w) => w.value === "Zebrafish")?.rules).toEqual(["tag_animals_only"]);
  });

  it("reports a typo, a nested not-clause, a retired tree prefix and a bad triangle class with the rules that would go dark", () => {
    const broken = {
      rules: [
        { id: "typo_rule", when: { mesh_any: ["Cohort Study"] } },
        { id: "typo_rule_2", when: { mesh_any: ["Cohort Study", "Humans"] } },
        { id: "case_only", when: { check_tag: ["humans"] } },
        { id: "nested_not", when: { mesh_any: ["Humans"], not: { mesh_any: ["Mices"] } } },
        { id: "tree_rule", when: { mesh_tree_under: ["G02.149"] } },
        { id: "class_rule", when: { triangle_class_any: ["AH", "HA"] } },
      ],
      triangle_of_biomedicine: {
        _comment: "stale prefixes from before the 2026 renumbering, plus a UI that does not exist",
        human_uis: ["D006801", "D999999"],
        human_trees: ["B01.050.150.900.649.801.400.112.400.400", "M01"],
        animal_trees_except_human: ["B01"],
        cell_molecular_trees: ["A11", "G02.149"],
      },
    };
    const v = validateSignalMapping(index, broken);
    expect(v.ok).toBe(false);
    expect(v.unmatched.map((u) => [u.kind, u.value, u.rules])).toEqual([
      ["mesh", "Cohort Study", ["typo_rule", "typo_rule_2"]],
      ["check_tag", "humans", ["case_only"]],
      ["mesh", "Mices", ["nested_not"]],
      ["mesh_tree", "G02.149", ["tree_rule"]],
      ["triangle_class", "HA", ["class_rule"]],
      ["triangle_ui", "D999999", ["triangle_of_biomedicine.human_uis"]],
      ["triangle_tree", "B01.050.150.900.649.801.400.112.400.400", ["triangle_of_biomedicine.human_trees"]],
      ["triangle_tree", "G02.149", ["triangle_of_biomedicine.cell_molecular_trees"]],
    ]);
    expect(v.unmatched.find((u) => u.value === "humans")?.suggestion).toBe("Humans");
    const report = formatSignalMappingValidation(v);
    expect(report).toContain("UNMATCHED (8)");
    expect(report).toContain('did you mean "Humans"');
  });

  it("warns when a pubtype clause names a non-publication-type descriptor", () => {
    const v = validateSignalMapping(index, {
      rules: [{ id: "pt_rule", when: { pubtype: ["Humans"] } }],
      triangle_of_biomedicine: {},
    });
    expect(v.ok).toBe(true);
    expect(v.warnings.map((w) => [w.kind, w.value])).toEqual([["pubtype", "Humans"]]);
  });
});

describe("mesh-descriptor-file", () => {
  const record = (ui: string, name: string, trees: string[], cls = 1) =>
    `<DescriptorRecord DescriptorClass = "${cls}">\n <DescriptorUI>${ui}</DescriptorUI>\n <DescriptorName>\n  <String>${name}</String>\n </DescriptorName>\n` +
    ` <TreeNumberList>${trees.map((t) => `<TreeNumber>${t}</TreeNumber>`).join("")}</TreeNumberList>\n</DescriptorRecord>`;

  it("parses UI, name, tree numbers and class from one record", () => {
    expect(parseDescriptorRecord(record("D016449", "Randomized Controlled Trial", ["V03.175.250.500.500"], 2))).toEqual({
      ui: "D016449",
      name: "Randomized Controlled Trial",
      treeNumbers: ["V03.175.250.500.500"],
      descriptorClass: 2,
    });
    expect(parseDescriptorRecord(record("D005260", "Female", [], 3))).toMatchObject({ treeNumbers: [], descriptorClass: 3 });
    expect(parseDescriptorRecord(record("D000001", "Purchasing &amp; Supply", ["N04"]))?.name).toBe("Purchasing & Supply");
    expect(parseDescriptorRecord("<DescriptorRecord DescriptorClass = \"1\"></DescriptorRecord>")).toBeNull();
  });

  it("streams records across chunk boundaries and skips the DescriptorRecordSet wrapper", async () => {
    const xml =
      `<?xml version="1.0"?>\n<DescriptorRecordSet LanguageCode = "eng">\n` +
      record("D000001", "Calcimycin", ["D03.633.100.221.173"]) +
      "\n" +
      record("D006801", "Humans", ["B01.050.150.900.649.313.988.400.112.400.400"]) +
      "\n</DescriptorRecordSet>\n";
    // Split inside the first record's UI and inside the second record's opening tag.
    const cut1 = xml.indexOf("D000001") + 3;
    const cut2 = xml.lastIndexOf("<DescriptorRecord ") + 8;
    const chunks = [xml.slice(0, cut1), xml.slice(cut1, cut2), xml.slice(cut2)];
    const out = [];
    for await (const r of parseMeshDescriptorRecords(chunks)) out.push(r);
    expect(out.map((r) => [r.ui, r.name, r.treeNumbers.length])).toEqual([
      ["D000001", "Calcimycin", 1],
      ["D006801", "Humans", 1],
    ]);
  });

  it("every check-tag name in the explicit list exists in the fixture and is flagged", () => {
    for (const name of MESH_CHECK_TAG_NAMES) {
      expect(resolveDescriptor(index, name).is_check_tag, name).toBe(true);
    }
    expect(resolveDescriptor(index, "Zebrafish").is_check_tag).toBe(false);
  });
});
