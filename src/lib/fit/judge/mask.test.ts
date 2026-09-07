import { describe, expect, it } from "vitest";
import { buildMask, IC_MASK, maskIcInId, maskIcInText, maskLeaks, maskText, naturalOrder, placeholderForDescriptor, placeholderForTreeNumber, PROTECTED_TERMS, termVariants, variantRegex, type MaskTerm } from "@/lib/fit/judge/mask";

const descriptor = (name: string, tree_numbers: string[], ui?: string) => ({ name, tree_numbers, ui });

describe("judge/mask · placeholders by tree (spec §16 guardrail 3; §11 rule 3)", () => {
  it("diseases → [DISEASE], chemicals and processes → [PATHWAY], persons and population characteristics → [POPULATION], anatomy → [TOPIC]", () => {
    expect(placeholderForTreeNumber("C04.557.470")).toBe("[DISEASE]");
    expect(placeholderForTreeNumber("F03.600.300")).toBe("[DISEASE]");
    expect(placeholderForTreeNumber("F01.145")).toBe("[TOPIC]");
    expect(placeholderForTreeNumber("D12.776.124")).toBe("[PATHWAY]");
    expect(placeholderForTreeNumber("G12.425.400")).toBe("[PATHWAY]");
    expect(placeholderForTreeNumber("M01.060.116")).toBe("[POPULATION]");
    expect(placeholderForTreeNumber("N01.224.425")).toBe("[POPULATION]");
    expect(placeholderForTreeNumber("I01.880")).toBe("[POPULATION]");
    expect(placeholderForTreeNumber("A04.411")).toBe("[TOPIC]");
  });

  it("organisms, techniques and designs, health services, public-health methods and publication types are never masked", () => {
    for (const t of ["B01.050.150.900.649", "E05.318.760.500", "E05.337", "N05.715.360.775.175", "N06.850.520", "V03.400", "H02.403", "L01.224", "Z01.107"]) expect(placeholderForTreeNumber(t), t).toBeNull();
  });

  it("a descriptor takes the highest-priority placeholder any tree asks for; a check tag never masks", () => {
    expect(placeholderForDescriptor(descriptor("Neoplasms", ["C04"]))).toBe("[DISEASE]");
    expect(placeholderForDescriptor(descriptor("Amyloid", ["D05.500.062", "C10.574.500"]))).toBe("[DISEASE]");
    expect(placeholderForDescriptor(descriptor("Cohort Studies", ["E05.318.760.500", "N05.715.360.775.175"]))).toBeNull();
    expect(placeholderForDescriptor(descriptor("Humans", ["B01.050.150.900.649.313.988.400.112.400.400"], "D006801"))).toBeNull();
    expect(placeholderForDescriptor(descriptor("Aged", ["M01.060.116.100"]))).toBe("[POPULATION]");
  });
});

describe("judge/mask · variants", () => {
  it("inverted MeSH names read in natural order; possessives, plurals and singulars are added; protected and short forms are dropped", () => {
    expect(naturalOrder("Colitis, Ulcerative")).toBe("ulcerative colitis");
    expect(naturalOrder("Diabetes Mellitus, Type 2")).toBe("type 2 diabetes mellitus");
    expect(termVariants("Colitis, Ulcerative")).toEqual(expect.arrayContaining(["colitis, ulcerative", "ulcerative colitis", "ulcerative colitises"]));
    expect(termVariants("Crohn's disease")).toEqual(expect.arrayContaining(["crohn's disease", "crohn disease", "crohn's diseases", "crohn diseases"]));
    expect(termVariants("Neoplasms")).toEqual(expect.arrayContaining(["neoplasms", "neoplasm"]));
    expect(termVariants("Humans")).toEqual([]);
    expect(termVariants("clinical trial")).toEqual([]);
    expect(termVariants("TB")).toEqual([]);
    expect(PROTECTED_TERMS.has("cohort")).toBe(true);
    // F12: materials / design nouns a notice's topic terms coincide with
    for (const w of ["materials", "specimens", "samples", "biospecimen", "biospecimens", "methods"]) {
      expect(PROTECTED_TERMS.has(w), w).toBe(true);
      expect(termVariants(w), w).toEqual([]);
    }
    expect(termVariants("Biospecimen")).toEqual([]);
    expect(termVariants("specimen banking")).not.toEqual([]);
  });

  it("F6 · maskIcInId hides the institute letters of a notice number or a project number and leaves every other id alone", () => {
    expect(IC_MASK).toBe("··");
    expect(maskIcInId("RFA-DK-27-136")).toBe("RFA-··-27-136");
    expect(maskIcInId("RFA-AR-27-001")).toBe("RFA-··-27-001");
    expect(maskIcInId("PAR-27-702")).toBe("PAR-27-702");
    expect(maskIcInId("NOT-OD-26-010")).toBe("NOT-··-26-010");
    expect(maskIcInId("5R01DK120003")).toBe("5R01··120003");
    expect(maskIcInId("1U01AR070005-01A1")).toBe("1U01··070005-01A1");
    expect(maskIcInId("R01AI160006")).toBe("R01··160006");
    expect(maskIcInId("5UM1AI148574")).toBe("5UM1··148574");
    expect(maskIcInId("5K23HL150002")).toBe("5K23··150002");
    for (const id of ["PMID:31000001", "NCT04000001", "biosketch:statement", "biosketch:contribution:2", "profiles:narrative", "grant:row-1", "aspiration:1"]) expect(maskIcInId(id), id).toBe(id);
  });

  it("S4 · maskIcInText hides the IC letters of every notice and project number in prose — a companion FOA, a cited award — and leaves parent announcements, PMIDs and NCT ids alone", () => {
    const prose = "See the companion RFA-AI-27-002 and PAR-DK-26-100; the parent PA-27-100 and NOT-OD-26-010; awards 5R01DK120003-01A1, R01AI160006 and 5UM1AI148574; NCT04000001, PMID:31000001, K23HL150002.";
    expect(maskIcInText(prose)).toBe("See the companion RFA-··-27-002 and PAR-··-26-100; the parent PA-27-100 and NOT-··-26-010; awards 5R01··120003-01A1, R01··160006 and 5UM1··148574; NCT04000001, PMID:31000001, K23··150002.");
    expect(maskIcInText("no ids here; RFA-27-001 is not a notice number")).toBe("no ids here; RFA-27-001 is not a notice number");
  });

  it("the regex matches whole words, any case, with hyphen or space between tokens", () => {
    const re = variantRegex("t-cell exhaustion");
    expect("T cell exhaustion in tumors".replace(re, "X")).toBe("X in tumors");
    expect("T-CELL EXHAUSTION".replace(re, "X")).toBe("X");
    expect("proT-cell exhaustion".replace(re, "X")).toBe("proT-cell exhaustion");
    expect("ferroptosis".replace(variantRegex("ferroptosis"), "X")).toBe("X");
    expect("ferroptosis-like".replace(variantRegex("ferroptosis"), "X")).toBe("X-like");
    expect("antiferroptosis".replace(variantRegex("ferroptosis"), "X")).toBe("antiferroptosis");
  });
});

describe("judge/mask · buildMask and maskText", () => {
  const mask = buildMask({
    terms: ["T-cell exhaustion", "PD-1", "cholangiocarcinoma", "cohort", "Cancer"],
    descriptors: [descriptor("Neoplasms", ["C04"]), descriptor("Colitis, Ulcerative", ["C06.405.205.731.500"]), descriptor("Mice", ["B01.050.150.900.649.313.992.635.505.500.400"], "D051379"), descriptor("Programmed Cell Death 1 Receptor", ["D12.776.543.550.500"]), descriptor("Aged", ["M01.060.116.100"])],
  });

  it("orders longest first, assigns placeholders by descriptor tree and [TOPIC] to a free term, and never includes organisms or protected words", () => {
    expect(mask[0]!.term.length).toBeGreaterThanOrEqual(mask[mask.length - 1]!.term.length);
    const by = new Map(mask.map((m) => [m.term, m.placeholder]));
    expect(by.get("neoplasms")).toBe("[DISEASE]");
    expect(by.get("ulcerative colitis")).toBe("[DISEASE]");
    expect(by.get("programmed cell death 1 receptor")).toBe("[PATHWAY]");
    expect(by.get("aged")).toBe("[POPULATION]");
    expect(by.get("t-cell exhaustion")).toBe("[TOPIC]");
    expect(by.get("pd-1")).toBe("[TOPIC]");
    expect(by.get("cancer")).toBe("[TOPIC]");
    expect(by.has("mice")).toBe(false);
    expect(by.has("cohort")).toBe(false);
  });

  it("masks every term, case and plural included, and leaves non-topic words untouched — nothing masked leaks", () => {
    const text = "We studied T cell exhaustion and PD-1 blockade in mice bearing cholangiocarcinomas and other neoplasms; aged patients with Ulcerative Colitis were enrolled in a prospective cohort with single-cell RNA-seq.";
    const { text: out, masked } = maskText(text, mask);
    expect(out).toBe("We studied [TOPIC] and [TOPIC] blockade in mice bearing [TOPIC] and other [DISEASE]; [POPULATION] patients with [DISEASE] were enrolled in a prospective cohort with single-cell RNA-seq.");
    expect(masked).toEqual(expect.arrayContaining(["t-cell exhaustion", "pd-1", "cholangiocarcinomas", "neoplasms", "ulcerative colitis", "aged"]));
    expect(maskLeaks(out, mask)).toEqual([]);
    for (const word of ["mice", "patients", "prospective cohort", "single-cell RNA-seq", "enrolled"]) expect(out).toContain(word);
  });

  it("a free term that is also a never-mask descriptor stays; the same term at two placeholders keeps the higher-priority one; repeats collapse", () => {
    const m = buildMask({ terms: ["Cohort Studies", "amyloid"], descriptors: [descriptor("Cohort Studies", ["E05.318.760.500"]), descriptor("Amyloid", ["D05.500.062", "C10.574.500"])] });
    expect(m.map((x) => x.term)).not.toContain("cohort studies");
    expect(m.find((x) => x.term === "amyloid")!.placeholder).toBe("[DISEASE]");
    expect(maskText("amyloid, amyloid and Amyloid deposits", m).text).toBe("[DISEASE] and [DISEASE] deposits");
  });

  it("an empty mask changes nothing; the leak check reports the terms still present", () => {
    expect(maskText("anything at all", []).text).toBe("anything at all");
    const leaky: MaskTerm[] = [{ term: "lupus", placeholder: "[DISEASE]" }];
    expect(maskLeaks("Lupus nephritis", leaky)).toEqual(["lupus"]);
    expect(maskLeaks("[DISEASE] nephritis", leaky)).toEqual([]);
  });
});
