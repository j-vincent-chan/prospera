import { describe, expect, it } from "vitest";
import fixture from "@/lib/fit/__fixtures__/mesh-descriptors-subset.json";
import { buildMeshIndex, resolveDescriptor, type MeshDescriptorRow } from "@/lib/fit/classify/mesh";
import {
  authorPositionMix,
  checkTagMix,
  checkTagNamesToReport,
  computeCorpusDistribution,
  formatCorpusDistribution,
  humanStudyDesignLine,
  humanStudyDesignPubTypes,
  investigatorTriangles,
  median,
  meshCoverage,
  pct,
  pubTypeMix,
  rowTriangleClass,
  ruleCheckTagNames,
  summarizeInvestigatorTriangles,
  tallyTriangle,
  topDescriptors,
  TRIANGLE_BUCKETS,
  type CorpusRow,
} from "@/lib/community/pubmed-corpus-stats";

const index = buildMeshIndex(fixture.descriptors as MeshDescriptorRow[]);

/** A heading by fixture name; `*` prefix = major topic. An unknown UI is passed through as `D…`. */
const h = (spec: string) => {
  const major = spec.startsWith("*");
  const name = major ? spec.slice(1) : spec;
  const ui = /^D\d{6,9}$/.test(name) ? name : resolveDescriptor(index, name).ui;
  return { ui, name, major, qualifiers: [] };
};

let n = 0;
const row = (over: Omit<Partial<CorpusRow>, "mesh"> & { mesh?: string[] }): CorpusRow => ({
  pmid: String(1000 + n++),
  investigator_id: "inv-a",
  identity_status: "verified",
  publication_types: ["Journal Article"],
  mesh_fetch_outcome: "indexed",
  author_position: "middle",
  author_position_method: "name",
  ...over,
  mesh: (over.mesh ?? []).map(h),
});

describe("helpers", () => {
  it("pct and median", () => {
    expect(pct(1, 3)).toBe("33.3%");
    expect(pct(0, 0)).toBe("—");
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("reads the 10 human study-design publication types and the rule check tags from signal-mapping.json", () => {
    expect(humanStudyDesignPubTypes()).toEqual([
      "Clinical Trial",
      "Clinical Trial, Phase I",
      "Clinical Trial, Phase II",
      "Clinical Trial, Phase III",
      "Clinical Trial, Phase IV",
      "Meta-Analysis",
      "Observational Study",
      "Pragmatic Clinical Trial",
      "Randomized Controlled Trial",
      "Systematic Review",
    ]);
    expect(ruleCheckTagNames()).toEqual(["Animals", "Humans", "Macaca", "Mice", "Primates", "Rats", "Zebrafish"]);
    // The six core tags first, then the rule-only species.
    expect(checkTagNamesToReport()).toEqual(["Humans", "Animals", "Mice", "Rats", "Female", "Male", "Macaca", "Primates", "Zebrafish"]);
  });
});

describe("meshCoverage", () => {
  it("counts stamped rows and rows with any MeSH", () => {
    const rows = [
      row({ mesh: ["Mice"] }),
      row({ mesh: [], mesh_fetch_outcome: "no_mesh" }),
      row({ mesh: [], mesh_fetch_outcome: "pending" }),
      row({ mesh: ["Humans"], identity_status: "unverified" }),
    ];
    expect(meshCoverage(rows)).toEqual({ rows: 4, stamped: 3, withMesh: 2 });
  });
});

describe("triangle tally", () => {
  it("classifies a row and skips unknown UIs instead of throwing", () => {
    expect(rowTriangleClass(index, [h("Mice").ui])).toEqual({ cls: "A", unknownUis: [], persons: false });
    expect(rowTriangleClass(index, [h("Female").ui])).toEqual({ cls: "none", unknownUis: [], persons: false });
    expect(rowTriangleClass(index, ["D999999", h("Mice").ui, "D888888"])).toEqual({ cls: "A", unknownUis: ["D999999", "D888888"], persons: false });
    // Humans alone is H without a persons descriptor; Adult (M01) is H with one.
    expect(rowTriangleClass(index, [h("Humans").ui])).toMatchObject({ cls: "H", persons: false });
    expect(rowTriangleClass(index, [h("Humans").ui, h("Adult").ui])).toMatchObject({ cls: "H", persons: true });
  });

  it("tallies every bucket, H-touching rows and distinct unknown UIs", () => {
    const rows = [
      row({ mesh: ["Mice"] }),
      row({ mesh: ["Humans"] }),
      row({ mesh: ["Mice", "Humans"] }),
      row({ mesh: ["HeLa Cells", "Humans"] }),
      row({ mesh: ["Mice", "HeLa Cells", "Humans", "Female", "Adult"] }),
      row({ mesh: ["Cell Line"] }),
      row({ mesh: ["Mice", "Cell Line"] }),
      row({ mesh: ["Female"] }),
      row({ mesh: ["D999999", "Mice"] }),
      row({ mesh: ["D999999", "D777777"] }),
    ];
    const t = tallyTriangle(index, rows);
    expect(t.rows).toBe(10);
    expect(t.counts).toEqual({ A: 2, C: 1, H: 1, AC: 1, AH: 1, CH: 1, ACH: 1, none: 2 });
    expect(t.hTouching).toBe(4);
    expect(t.hViaPersons).toBe(1);
    expect(t.unknownUiOccurrences).toBe(3);
    expect(t.unknownUis).toEqual(["D777777", "D999999"]);
    expect(TRIANGLE_BUCKETS).toEqual(["A", "C", "H", "AC", "AH", "CH", "ACH", "none"]);
  });

  it("per investigator: modal class, tie to the earlier class, H-touching share, then a summary by modal class", () => {
    const rows = [
      row({ investigator_id: "b", mesh: ["Mice"] }),
      row({ investigator_id: "b", mesh: ["Mice"] }),
      row({ investigator_id: "b", mesh: ["Humans"] }),
      row({ investigator_id: "a", mesh: ["Mice", "Humans"] }),
      row({ investigator_id: "a", mesh: ["Humans"] }), // 1 AH, 1 H → tie → H (earlier in order)
      row({ investigator_id: "c", mesh: ["Female"] }),
    ];
    const list = investigatorTriangles(index, rows);
    expect(list.map((i) => i.investigator_id)).toEqual(["a", "b", "c"]);
    expect(list[0]).toMatchObject({ rows: 2, modal: "H", hTouchingShare: 1 });
    expect(list[1]).toMatchObject({ rows: 3, modal: "A", hTouchingShare: 1 / 3 });
    expect(list[2]).toMatchObject({ rows: 1, modal: "none", hTouchingShare: 0 });

    const s = summarizeInvestigatorTriangles(list);
    expect(s.investigators).toBe(3);
    expect(s.byModalClass.find((m) => m.modal === "A")).toEqual({ modal: "A", investigators: 1, medianRows: 3, medianHTouchingShare: 1 / 3 });
    expect(s.byModalClass.find((m) => m.modal === "H")).toEqual({ modal: "H", investigators: 1, medianRows: 2, medianHTouchingShare: 1 });
    expect(s.byModalClass.find((m) => m.modal === "AC")).toEqual({ modal: "AC", investigators: 0, medianRows: null, medianHTouchingShare: null });
    expect(s.medianHTouchingShare).toBe(1 / 3);
    expect(s.hTouchingBands).toEqual([
      { label: "< 10%", investigators: 1 },
      { label: "10–33%", investigators: 0 },
      { label: "33–67%", investigators: 1 },
      { label: "≥ 67%", investigators: 1 },
    ]);
  });
});

describe("topDescriptors", () => {
  it("counts each descriptor once per row, sorts by rows then name, honours majorOnly and n", () => {
    const rows = [
      row({ mesh: ["*Mice", "Humans", "Cell Line"] }),
      row({ mesh: ["Mice", "*Humans"] }),
      row({ mesh: ["*Cell Line", "Animals"] }),
    ];
    rows[0].mesh.push(h("Mice")); // duplicate heading inside one row
    const top = topDescriptors(rows, 3);
    expect(top.map((d) => [d.name, d.rows])).toEqual([
      ["Cell Line", 2],
      ["Humans", 2],
      ["Mice", 2],
    ]);
    expect(top[0]).toEqual({ ui: "D002460", name: "Cell Line", rows: 2, share: 2 / 3 });
    expect(topDescriptors(rows, 10).map((d) => d.name)).toEqual(["Cell Line", "Humans", "Mice", "Animals"]);
    expect(topDescriptors(rows, 10, { majorOnly: true }).map((d) => [d.name, d.rows])).toEqual([
      ["Cell Line", 1],
      ["Humans", 1],
      ["Mice", 1],
    ]);
    expect(topDescriptors([], 5)).toEqual([]);
  });
});

describe("checkTagMix", () => {
  it("counts named tags and splits Humans / Animals", () => {
    const rows = [
      row({ mesh: ["Humans", "Female"] }),
      row({ mesh: ["Animals", "Mice", "Male"] }),
      row({ mesh: ["Humans", "Animals", "Rats"] }),
      row({ mesh: ["Cell Line"] }),
      row({ mesh: ["Zebrafish", "Animals"] }),
    ];
    const c = checkTagMix(rows);
    expect(c.rows).toBe(5);
    expect(Object.fromEntries(c.byName.map((x) => [x.name, x.rows]))).toEqual({
      Humans: 2,
      Animals: 3,
      Mice: 1,
      Rats: 1,
      Female: 1,
      Male: 1,
      Macaca: 0,
      Primates: 0,
      Zebrafish: 1,
    });
    expect(c.split).toEqual({ humansOnly: 1, animalsOnly: 2, both: 1, neither: 1 });
  });
});

describe("publication types", () => {
  it("mixes every type by rows, ties by name; the human study-design line counts rows and investigators", () => {
    const rows = [
      row({ investigator_id: "a", publication_types: ["Journal Article", "Randomized Controlled Trial", "Randomized Controlled Trial"] }),
      row({ investigator_id: "a", publication_types: ["Journal Article", "Review"] }),
      row({ investigator_id: "b", publication_types: ["Journal Article", "Meta-Analysis"] }),
      row({ investigator_id: "c", publication_types: ["Journal Article", "Comment"] }),
      row({ investigator_id: "c", publication_types: [] }),
    ];
    expect(pubTypeMix(rows)).toEqual([
      { type: "Journal Article", rows: 4, share: 0.8 },
      { type: "Comment", rows: 1, share: 0.2 },
      { type: "Meta-Analysis", rows: 1, share: 0.2 },
      { type: "Randomized Controlled Trial", rows: 1, share: 0.2 },
      { type: "Review", rows: 1, share: 0.2 },
    ]);
    const line = humanStudyDesignLine(rows);
    expect(line.types.length).toBe(10);
    expect(line).toMatchObject({ rows: 2, share: 0.4, investigators: 2 });
    expect(humanStudyDesignLine(rows, ["Review"])).toMatchObject({ rows: 1, investigators: 1 });
  });
});

describe("authorPositionMix", () => {
  it("cross-tabs position by method with (null) columns and marginals", () => {
    const rows = [
      row({ author_position: "first", author_position_method: "orcid" }),
      row({ author_position: "first", author_position_method: "name" }),
      row({ author_position: "last", author_position_method: "name" }),
      row({ author_position: "unknown", author_position_method: "absent" }),
      row({ author_position: null, author_position_method: null }),
    ];
    const a = authorPositionMix(rows);
    expect(a.rows).toBe(5);
    const line = (p: string) => a.positions.find((x) => x.position === p)!;
    expect(line("first")).toEqual({ position: "first", byMethod: { orcid: 1, name: 1, absent: 0, "(null)": 0 }, total: 2 });
    expect(line("last").total).toBe(1);
    expect(line("corresponding").total).toBe(0);
    expect(line("(null)")).toEqual({ position: "(null)", byMethod: { orcid: 0, name: 0, absent: 0, "(null)": 1 }, total: 1 });
    expect(a.methods).toEqual({ orcid: 1, name: 2, absent: 1, "(null)": 1 });
  });
});

describe("computeCorpusDistribution + formatCorpusDistribution", () => {
  it("restricts to verified rows, then to rows with MeSH / stamped rows per figure, and renders every sub-section", () => {
    const rows = [
      row({ investigator_id: "a", mesh: ["Mice", "Animals"], publication_types: ["Journal Article"] }),
      row({ investigator_id: "a", mesh: ["Humans", "*Cell Line"], publication_types: ["Journal Article", "Clinical Trial"], author_position: "first", author_position_method: "orcid" }),
      row({ investigator_id: "b", mesh: [], mesh_fetch_outcome: "no_mesh", publication_types: ["Journal Article"] }),
      row({ investigator_id: "b", mesh: [], mesh_fetch_outcome: "pending", publication_types: [] }),
      row({ investigator_id: "z", identity_status: "unverified", mesh: ["Humans"], publication_types: ["Randomized Controlled Trial"] }),
    ];
    const d = computeCorpusDistribution(index, rows, 5);
    expect(d.all).toEqual({ rows: 5, stamped: 4, withMesh: 3 });
    expect(d.verified).toEqual({ rows: 4, stamped: 3, withMesh: 2 });
    expect(d.verifiedInvestigators).toBe(2);
    expect(d.descriptorsInIndex).toBe(fixture.descriptors.length);
    expect(d.triangle.rows).toBe(2);
    expect(d.triangle.counts).toMatchObject({ A: 1, CH: 1 });
    expect(d.investigatorTriangle.investigators).toBe(1);
    expect(d.topDescriptors.map((x) => x.name)).toEqual(["Animals", "Cell Line", "Humans", "Mice"]);
    expect(d.topMajorDescriptors.map((x) => x.name)).toEqual(["Cell Line"]);
    expect(d.checkTags.split).toEqual({ humansOnly: 1, animalsOnly: 1, both: 0, neither: 0 });
    expect(d.pubTypes[0]).toEqual({ type: "Journal Article", rows: 3, share: 0.75 });
    expect(d.humanStudyDesign).toMatchObject({ rows: 1, share: 0.25, investigators: 1 });
    expect(d.authorPosition.rows).toBe(3);

    const md = formatCorpusDistribution(d);
    for (const heading of ["### 11a.", "### 11b.", "### 11c.", "### 11d.", "### 11e.", "### 11f.", "### 11g.", "### 11h."]) expect(md).toContain(heading);
    expect(md).toContain("| verified rows | 4 | 3 | 2 | 50.0% | 66.7% |");
    expect(md).toContain("| A | 1 | 50.0% |");
    expect(md).toContain("| 1 | Animals | D000818 | 1 | 50.0% |");
    expect(md).toContain("Humans only 1 (50.0%) · Animals only 1 (50.0%) · both 0 (0.0%) · neither 0 (0.0%)");
    expect(md).toContain("1 rows with any of them (25.0% of verified rows); 1 of 2 investigators with ≥ 1");
    expect(md).toContain("| first | 1 | 0 | 0 | 0 | 1 |");
    expect(md).toContain("| (all) | 1 | 2 | 0 | 0 | 3 |");
  });
});
