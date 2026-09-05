import { describe, expect, it } from "vitest";
import signalMapping from "@/lib/fit/signal-mapping.json";
import taxonomy from "@/lib/fit/taxonomy.json";
import {
  buildSelfDeclaredColumns,
  EMPTY_SELF_DECLARED_FORM,
  formatAspirations,
  formatDegrees,
  INTAKE_MATERIAL_RULES,
  intakeMaterials,
  isAffirmative,
  MATERIALS_GROUPS,
  MATERIALS_KINDS,
  MATERIALS_LABEL,
  mergeImportedMaterials,
  mineMaterials,
  PARADIGM_FAMILY_KEYS,
  parseAspirations,
  parseDegrees,
  readSelfDeclaredAxes,
  SELF_DECLARED_FAMILY_ROWS,
  SELF_DECLARED_RATINGS,
  selfDeclaredAxesSchema,
  selfDeclaredFormFromRow,
  selfDeclaredFormToInput,
  selfDeclaredInputSchema,
  type SelfDeclaredAxes,
} from "@/lib/fit/self-declared";

const NOW = "2026-09-05T12:00:00.000Z";
const LATER = "2026-09-06T12:00:00.000Z";

describe("taxonomy alignment", () => {
  it("the grid has one row per taxonomy paradigm family, in taxonomy order", () => {
    expect(SELF_DECLARED_FAMILY_ROWS.map((r) => r.family)).toEqual(Object.keys(taxonomy.paradigm.families));
    expect(PARADIGM_FAMILY_KEYS).toEqual(Object.keys(taxonomy.paradigm.families));
    expect(SELF_DECLARED_FAMILY_ROWS.map((r) => r.label)).toEqual([
      "Discovery/mechanistic",
      "Preclinical/animal",
      "Translational human biology",
      "Clinical (patients, trials)",
      "Population/epidemiology",
      "Health systems/implementation",
      "Computational/methods",
    ]);
  });

  it("every materials kind in taxonomy.json has a label and nothing else does", () => {
    const fromTaxonomy = Object.values(taxonomy.materials.kinds).flat();
    expect([...Object.keys(MATERIALS_LABEL)].sort()).toEqual([...fromTaxonomy].sort());
    expect(MATERIALS_KINDS).toEqual(fromTaxonomy);
    expect(MATERIALS_GROUPS.map((g) => g.key)).toEqual(Object.keys(taxonomy.materials.kinds));
  });

  it("the rating scale spans 0–3 with Not my work / Some / Core", () => {
    expect(SELF_DECLARED_RATINGS.map((r) => r.label)).toEqual(["Not my work", "Some", "Core"]);
    expect(SELF_DECLARED_RATINGS[0]!.value).toBe(0);
    expect(SELF_DECLARED_RATINGS[SELF_DECLARED_RATINGS.length - 1]!.value).toBe(3);
  });

  it("the intake rules come from signal-mapping's self_declared_* rules and assign taxonomy kinds", () => {
    const ids = (signalMapping.rules as Array<{ id: string; when: Record<string, unknown> }>).filter((r) => "intake_field" in r.when).map((r) => r.id);
    expect(INTAKE_MATERIAL_RULES.map((r) => r.id)).toEqual(ids);
    expect(INTAKE_MATERIAL_RULES.map((r) => r.field)).toEqual(["clinical_samples", "biobanks"]);
    for (const rule of INTAKE_MATERIAL_RULES) {
      expect(rule.materials.length).toBeGreaterThan(0);
      for (const k of rule.materials) expect(MATERIALS_KINDS).toContain(k);
    }
  });
});

describe("schemas", () => {
  it("accepts a partial paradigm record and rejects unknown families, ratings and kinds", () => {
    expect(selfDeclaredAxesSchema.safeParse({ paradigm: { clinical: 3 }, materials: ["ehr"], capabilities: [], updated_at: NOW }).success).toBe(true);
    expect(selfDeclaredAxesSchema.safeParse({ paradigm: { wet_lab: 3 }, materials: [], capabilities: [], updated_at: NOW }).success).toBe(false);
    expect(selfDeclaredAxesSchema.safeParse({ paradigm: { clinical: 4 }, materials: [], capabilities: [], updated_at: NOW }).success).toBe(false);
    expect(selfDeclaredAxesSchema.safeParse({ paradigm: { clinical: 1.5 }, materials: [], capabilities: [], updated_at: NOW }).success).toBe(false);
    expect(selfDeclaredAxesSchema.safeParse({ paradigm: {}, materials: ["plasma"], capabilities: [], updated_at: NOW }).success).toBe(false);
    expect(selfDeclaredAxesSchema.safeParse({ paradigm: {}, materials: [], capabilities: [], updated_at: "yesterday" }).success).toBe(false);
  });

  it("the input schema defaults every list and rejects a do-not-suggest value that is not a family", () => {
    expect(selfDeclaredInputSchema.parse({})).toEqual({ paradigm: {}, materials: [], aspirations: [], do_not_suggest: [] });
    expect(selfDeclaredInputSchema.safeParse({ do_not_suggest: ["clinical_trials"] }).success).toBe(false);
    expect(selfDeclaredInputSchema.safeParse({ do_not_suggest: ["clinical"] }).success).toBe(true);
    expect(selfDeclaredInputSchema.safeParse({ aspirations: [""] }).success).toBe(false);
  });

  it("readSelfDeclaredAxes never throws on a bad column value", () => {
    expect(readSelfDeclaredAxes(null)).toBeNull();
    expect(readSelfDeclaredAxes(undefined)).toBeNull();
    expect(readSelfDeclaredAxes("garbage")).toBeNull();
    expect(readSelfDeclaredAxes({ paradigm: { nope: 1 } })).toBeNull();
    expect(readSelfDeclaredAxes({ paradigm: { discovery: 3 }, materials: [], capabilities: [], updated_at: NOW })).toEqual({ paradigm: { discovery: 3 }, materials: [], capabilities: [], updated_at: NOW });
  });
});

describe("buildSelfDeclaredColumns", () => {
  it("stores NULL when nothing was declared", () => {
    const cols = buildSelfDeclaredColumns(selfDeclaredInputSchema.parse({}), null, NOW);
    expect(cols).toEqual({ self_declared_axes: null, aspirations: [], do_not_suggest: [] });
  });

  it("orders families and materials by taxonomy and stamps updated_at", () => {
    const cols = buildSelfDeclaredColumns(
      selfDeclaredInputSchema.parse({
        paradigm: { population: 1, discovery: 3 },
        materials: ["ehr", "animal_mouse", "human_blood_fluids"],
        aspirations: ["implementation science", "Implementation Science", "trials"],
        do_not_suggest: ["health_systems", "preclinical"],
      }),
      null,
      NOW,
    );
    expect(Object.keys(cols.self_declared_axes!.paradigm)).toEqual(["discovery", "population"]);
    expect(cols.self_declared_axes!.materials).toEqual(["animal_mouse", "human_blood_fluids", "ehr"]);
    expect(cols.self_declared_axes!.capabilities).toEqual([]);
    expect(cols.self_declared_axes!.updated_at).toBe(NOW);
    expect(cols.aspirations).toEqual(["implementation science", "trials"]);
    expect(cols.do_not_suggest).toEqual(["preclinical", "health_systems"]);
  });

  it("keeps the previous object (and its updated_at) when ratings and materials are unchanged, and carries capabilities", () => {
    const previous: SelfDeclaredAxes = { paradigm: { clinical: 3 }, materials: ["ehr"], capabilities: ["clinical_trials_pi"], updated_at: NOW };
    const same = buildSelfDeclaredColumns(selfDeclaredInputSchema.parse({ paradigm: { clinical: 3 }, materials: ["ehr"], aspirations: ["new direction"] }), previous, LATER);
    expect(same.self_declared_axes).toBe(previous);
    expect(same.aspirations).toEqual(["new direction"]);

    const changed = buildSelfDeclaredColumns(selfDeclaredInputSchema.parse({ paradigm: { clinical: 1 }, materials: ["ehr"] }), previous, LATER);
    expect(changed.self_declared_axes).toEqual({ paradigm: { clinical: 1 }, materials: ["ehr"], capabilities: ["clinical_trials_pi"], updated_at: LATER });

    const cleared = buildSelfDeclaredColumns(selfDeclaredInputSchema.parse({}), previous, LATER);
    expect(cleared.self_declared_axes).toEqual({ paradigm: {}, materials: [], capabilities: ["clinical_trials_pi"], updated_at: LATER });
    expect(buildSelfDeclaredColumns(selfDeclaredInputSchema.parse({}), { ...previous, capabilities: [] }, LATER).self_declared_axes).toBeNull();
  });
});

describe("mergeImportedMaterials", () => {
  it("adds only what is new and leaves ratings alone", () => {
    expect(mergeImportedMaterials(null, [], NOW)).toBeNull();
    expect(mergeImportedMaterials(null, ["biobank_specimens", "human_tissue_biopsy"], NOW)).toEqual({ paradigm: {}, materials: ["human_tissue_biopsy", "biobank_specimens"], capabilities: [], updated_at: NOW });
    const previous: SelfDeclaredAxes = { paradigm: { translational: 3 }, materials: ["human_tissue_biopsy"], capabilities: [], updated_at: NOW };
    expect(mergeImportedMaterials(previous, ["human_tissue_biopsy"], LATER)).toBe(previous);
    expect(mergeImportedMaterials(previous, ["human_blood_fluids"], LATER)).toEqual({ paradigm: { translational: 3 }, materials: ["human_tissue_biopsy", "human_blood_fluids"], capabilities: [], updated_at: LATER });
  });
});

describe("aspirations text", () => {
  it("splits on lines and semicolons, trims, dedupes and round-trips", () => {
    expect(parseAspirations("implementation science\n\n  trials in IBD ; Trials in IBD\r\nmicrobiome")).toEqual(["implementation science", "trials in IBD", "microbiome"]);
    expect(parseAspirations("")).toEqual([]);
    expect(parseAspirations(null)).toEqual([]);
    expect(formatAspirations(["a", "b"])).toBe("a\nb");
    expect(parseAspirations(formatAspirations(["a", "b"]))).toEqual(["a", "b"]);
  });
});

// Answers below are from the ImmunoX intake sheet ("Clinical Samples" / "Biobanks").
describe("isAffirmative", () => {
  it("is true for yes-leading and material-naming answers", () => {
    for (const a of [
      "yes",
      "Yes, plasma and CSF samples",
      "Yes (indirectly); work with derived data through collaborations",
      "Yes, we use blood (PBMC) and airway samples. No, we do not have all the samples we need.",
      "Human tissues (neruonal and enteric tissues)",
      "we have our own liver bio-repository",
      "human tumor tissue",
      "skin",
      "Lung samples of any kind",
      "CSF, serum from neurodegenerative patients",
      "Nina Ireland Lung",
      "divisional biobanks",
      "surgical specimens",
      "affiliated with Wilson/Pleasure biobank",
      "Well-annotated clinical samples are essential for many studies",
      "currently sparse use of clinical samples, but will ramp up soon to cancer patient PBMCs",
      "We are gearing up to test a new way to culture small chunks of human tissues.",
    ]) {
      expect(isAffirmative(a), a).toBe(true);
    }
  });

  it("is false for no / N/A / not-now answers, wishes and plans, and negations", () => {
    for (const a of [
      "",
      "no",
      "No.",
      "N/A",
      "NA",
      "n/a",
      "none",
      "--",
      "Not at this time.",
      "Not at the present time.",
      "Not of pressing need",
      "I wish, but no.",
      "No, I do not.",
      "No, but I am the founder and director of the UCSF VITAL Core.",
      "no. but i request from brain tumor bank.",
      "not managing, but affiliated with the SCOPE cohort",
      "Not biobanking but have whole genome repositories for human cDNAs, CRISPR reagents, etc",
      "Clinical samples are not central",
      "possibly",
      "planned work on ovarian cancer samples to support research by a heme-onc fellow in the lab.",
      "I am hoping to get access to clinical samples but colleagues in ImmunoX have already been helpful.",
      "I would like to be able to access some of the biopsies of patients with immune-related adverse events",
      "We are looking to expand our research into more human cellular systems and access to primary samples such as PBMCs",
      "I am interested in freshly obtained live cancer tissue specimens from biopsies or surgical resections.",
      "At present, I do not have a way to obtain human cardiac tissues, so assistance would be appreciated.",
      "We wanted to compare primary human neutrophils with mouse neutrophils but we were completely unable to obtain fresh human blood",
      "Work with Jay Gardner",
      "Bacterial isolates from the clinical microbiology labs.",
    ]) {
      expect(isAffirmative(a), a || "(blank)").toBe(false);
    }
  });
});

describe("mineMaterials", () => {
  it("names the kinds the text mentions, in taxonomy order", () => {
    expect(mineMaterials("Yes, plasma and CSF samples")).toEqual(["human_blood_fluids"]);
    expect(mineMaterials("we have our own liver bio-repository")).toEqual(["human_tissue_biopsy", "biobank_specimens"]);
    expect(mineMaterials("Primary Human T-cells and B-cells from healthy donors; Human Serum/Plasma; Tissue-Infiltrating Lymphocytes.")).toEqual([
      "human_tissue_biopsy",
      "human_blood_fluids",
      "human_primary_cells",
    ]);
    expect(mineMaterials("We are obtaining primary alveolar macrophages from human lung lobes")).toEqual(["human_tissue_biopsy", "human_primary_cells"]);
    expect(mineMaterials("yes")).toEqual([]);
    expect(mineMaterials("")).toEqual([]);
  });
});

describe("intakeMaterials", () => {
  it("applies the rule's kinds for a bare yes and only the named kinds otherwise", () => {
    expect(intakeMaterials({ clinical_samples: "yes" })).toEqual(["human_tissue_biopsy", "human_blood_fluids"]);
    expect(intakeMaterials({ clinical_samples: "Yes, plasma and CSF samples" })).toEqual(["human_blood_fluids"]);
    expect(intakeMaterials({ clinical_samples: "Yes, human lung" })).toEqual(["human_tissue_biopsy"]);
    expect(intakeMaterials({ clinical_samples: "we have our own liver bio-repository" })).toEqual(["human_tissue_biopsy", "biobank_specimens"]);
  });

  it("adds biobank specimens for an affirmative biobank answer, plus whatever it names", () => {
    expect(intakeMaterials({ biobanks: "Yes, as previously discussed." })).toEqual(["biobank_specimens"]);
    expect(intakeMaterials({ biobanks: "Nina Ireland Lung" })).toEqual(["human_tissue_biopsy", "biobank_specimens"]);
    expect(intakeMaterials({ biobanks: "Yes- we have a large perinatal biobank with plasma, PBMC, and placental tissue." })).toEqual(["human_tissue_biopsy", "human_blood_fluids", "biobank_specimens"]);
  });

  it("ignores negative answers, missing fields and unknown fields", () => {
    expect(intakeMaterials({ clinical_samples: "no", biobanks: "No, but I am the founder and director of the UCSF VITAL Core." })).toEqual([]);
    expect(intakeMaterials({ clinical_samples: "no", biobanks: "Yes, as previously discussed." })).toEqual(["biobank_specimens"]);
    expect(intakeMaterials({})).toEqual([]);
    expect(intakeMaterials({ technological_expertise: "yes, PBMC" })).toEqual([]);
  });
});

describe("degrees text", () => {
  it("splits on commas, semicolons and slashes, trims trailing dots, dedupes and round-trips", () => {
    expect(parseDegrees("MD, PhD")).toEqual(["MD", "PhD"]);
    expect(parseDegrees("M.D.; Ph.D. / MPH, mph")).toEqual(["M.D", "Ph.D", "MPH"]);
    expect(parseDegrees("")).toEqual([]);
    expect(parseDegrees(null)).toEqual([]);
    expect(formatDegrees(["MD", "PhD"])).toBe("MD, PhD");
    expect(parseDegrees(formatDegrees(["MD", "PhD"]))).toEqual(["MD", "PhD"]);
  });
});

describe("form value", () => {
  it("reads the row's columns and tolerates missing or malformed ones", () => {
    expect(selfDeclaredFormFromRow({})).toEqual(EMPTY_SELF_DECLARED_FORM);
    expect(selfDeclaredFormFromRow({ self_declared_axes: "garbage", aspirations: "not a list", do_not_suggest: ["clinical", "nope", 3] })).toEqual({
      ...EMPTY_SELF_DECLARED_FORM,
      do_not_suggest: ["clinical"],
    });
    expect(
      selfDeclaredFormFromRow({
        self_declared_axes: { paradigm: { clinical: 3, translational: 1 }, materials: ["ehr", "human_blood_fluids"], capabilities: [], updated_at: NOW },
        aspirations: ["implementation science", "trials"],
        do_not_suggest: ["discovery"],
      }),
    ).toEqual({ paradigm: { clinical: 3, translational: 1 }, materials: ["ehr", "human_blood_fluids"], aspirations: "implementation science\ntrials", do_not_suggest: ["discovery"] });
  });

  it("turns the form into the action input, parsing the aspirations text", () => {
    const input = selfDeclaredFormToInput({ paradigm: { population: 1 }, materials: ["surveys"], aspirations: "a\n\nb; A", do_not_suggest: ["preclinical"] });
    expect(input).toEqual({ paradigm: { population: 1 }, materials: ["surveys"], aspirations: ["a", "b"], do_not_suggest: ["preclinical"] });
    expect(selfDeclaredInputSchema.safeParse(input).success).toBe(true);
  });
});
