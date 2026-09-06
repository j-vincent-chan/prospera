import { describe, expect, it } from "vitest";
import fixture from "@/lib/fit/__fixtures__/mesh-descriptors-subset.json";
import { buildMeshIndex, MeshUnknownDescriptorError, type MeshDescriptorRow } from "@/lib/fit/classify/mesh";
import {
  INTAKE_FIELDS,
  normalizeBiosketch,
  normalizeGrant,
  normalizeProfiles,
  normalizePublication,
  normalizeSelfDeclared,
  normalizeTrial,
  sraDesignatorCode,
  TEXT_MAX_CHARS,
  truncateText,
} from "@/lib/fit/classify/normalize";

const index = buildMeshIndex(fixture.descriptors as MeshDescriptorRow[]);
const INV = "00000000-0000-4000-8000-000000000001";

describe("normalizePublication", () => {
  it("resolves every heading against the index and keeps the stored flags", () => {
    const item = normalizePublication(
      {
        investigator_id: INV,
        pmid: "12345",
        title: "A paper",
        publication_date: "2021-06-01",
        mesh: [
          { ui: "D006801", name: "Humans", major: false, qualifiers: [] },
          { ui: "D015331", major: true, qualifiers: ["epidemiology"] },
        ],
        publication_types: ["Journal Article", "Randomized Controlled Trial"],
        abstract: "  Background: text.  ",
        author_position: "last",
        author_position_method: "name",
        identity_method: "orcid",
        mesh_fetch_outcome: "indexed",
      },
      { id: INV },
      { mesh: index }
    );
    expect(item.id).toBe(`publication:${INV}:12345`);
    expect(item.kind).toBe("publication");
    expect(item.year).toBe(2021);
    expect(item.role).toBe("last");
    expect(item.text).toBe("Background: text.");
    expect(item.mesh).toEqual([
      { ui: "D006801", name: "Humans", major: false, qualifiers: [] },
      { ui: "D015331", name: "Cohort Studies", major: true, qualifiers: ["epidemiology"] },
    ]);
    expect(item.publication_types).toEqual(["Journal Article", "Randomized Controlled Trial"]);
    expect(item.signals).toMatchObject({ pmid: "12345", author_position_method: "name", identity_method: "orcid", mesh_fetch_outcome: "indexed", text_truncated: false });
  });

  it("an unknown UI fails loudly; a missing mesh column is an empty list", () => {
    expect(() => normalizePublication({ investigator_id: INV, pmid: "1", mesh: [{ ui: "D0000000", name: "x" }] }, { id: INV }, { mesh: index })).toThrow(MeshUnknownDescriptorError);
    expect(() => normalizePublication({ investigator_id: INV, pmid: "1", mesh: [{ name: "Humans" }] }, { id: INV }, { mesh: index })).toThrow(/without a ui/);
    expect(normalizePublication({ investigator_id: INV, pmid: "1", mesh: null }, { id: INV }, { mesh: index }).mesh).toEqual([]);
    expect(normalizePublication({ investigator_id: INV, pmid: "1" }, { id: INV }, { mesh: index }).publication_types).toEqual([]);
  });

  it("refuses a row that belongs to another investigator", () => {
    expect(() => normalizePublication({ investigator_id: "other", pmid: "1" }, { id: INV }, { mesh: index })).toThrow(/belongs to investigator/);
  });

  it("truncates long text at a word boundary and says so", () => {
    const long = Array.from({ length: 2000 }, (_, i) => `word${i}`).join(" ");
    const t = truncateText(long);
    expect(t.truncated).toBe(true);
    expect(t.text!.length).toBeLessThanOrEqual(TEXT_MAX_CHARS);
    expect(t.text!.endsWith("word")).toBe(false);
    expect(t.text).toMatch(/word\d+$/);
    expect(truncateText("  ").text).toBeNull();
    const item = normalizePublication({ investigator_id: INV, pmid: "1", abstract: long }, { id: INV }, { mesh: index });
    expect(item.signals.text_truncated).toBe(true);
    expect(item.signals.text_chars).toBe(long.length);
  });
});

describe("normalizeGrant", () => {
  it("keeps NULL rcdc_categories as null and [] as [], reads the SEP designator from raw_json", () => {
    const item = normalizeGrant({
      id: "g1",
      investigator_id: INV,
      project_num: "5R01AI000001-02",
      project_title: "Title column",
      fiscal_year: 2023,
      activity_code: "r01",
      rcdc_categories: null,
      study_section: "Special Emphasis Panel",
      study_section_code: "zrg1",
      is_contact_pi: false,
      abstract: "Abstract.",
      phr_text: "Relevance.",
      raw_json: { project_title: "Raw title", full_study_section: { sra_designator_code: "idm", srg_code: "ZRG1" } },
    });
    expect(item.id).toBe("grant:g1");
    expect(item.title).toBe("Title column");
    expect(item.year).toBe(2023);
    expect(item.role).toBe("mpi");
    expect(item.text).toBe("Abstract.\n\nPublic health relevance: Relevance.");
    expect(item.signals).toMatchObject({ activity_code: "R01", rcdc_categories: null, study_section_code: "ZRG1", sra_designator_code: "IDM", is_contact_pi: false });
    expect(normalizeGrant({ id: "g2", rcdc_categories: [] }).signals.rcdc_categories).toEqual([]);
    expect(normalizeGrant({ id: "g3", rcdc_categories: ["Clinical Research", " Prevention "] }).signals.rcdc_categories).toEqual(["Clinical Research", "Prevention"]);
    expect(normalizeGrant({ id: "g4", is_contact_pi: true }).role).toBe("contact_pi");
    expect(normalizeGrant({ id: "g5", is_contact_pi: null }).role).toBeNull();
    expect(normalizeGrant({ id: "g6", raw_json: { project_title: "Raw title" } }).title).toBe("Raw title");
    expect(sraDesignatorCode({ full_study_section: null })).toBeNull();
    expect(sraDesignatorCode(null)).toBeNull();
  });
});

describe("normalizeTrial", () => {
  it("stores phases literally and says whether they are informative (PR 0.3)", () => {
    const na = normalizeTrial({ investigator_id: INV, nct_id: "NCT1", phases: ["NA"], allocation: "RANDOMIZED", intervention_model: "PARALLEL", investigator_role: "PRINCIPAL_INVESTIGATOR", start_date: "2020-03-01", enrollment: 40 });
    expect(na.id).toBe(`trial:${INV}:NCT1`);
    expect(na.year).toBe(2020);
    expect(na.role).toBe("PRINCIPAL_INVESTIGATOR");
    expect(na.signals).toMatchObject({ phases: ["NA"], phases_informative: false, allocation: "RANDOMIZED", intervention_model: "PARALLEL", enrollment: 40 });
    expect(normalizeTrial({ investigator_id: INV, nct_id: "NCT2", phases: [] }).signals.phases_informative).toBe(false);
    expect(normalizeTrial({ investigator_id: INV, nct_id: "NCT3", phases: null }).signals.phases).toEqual([]);
    expect(normalizeTrial({ investigator_id: INV, nct_id: "NCT4", phases: ["PHASE2", "PHASE3"] }).signals.phases_informative).toBe(true);
    expect(normalizeTrial({ investigator_id: INV, nct_id: "NCT5" }).signals.enrollment).toBeNull();
  });
});

describe("normalizeBiosketch", () => {
  it("yields the statement and one item per contribution, in stored order", () => {
    const items = normalizeBiosketch({
      investigator_id: INV,
      document_date: "2025-02-01",
      personal_statement: "I study lupus.",
      contributions: [
        { title: "First line", summary: "We showed X." },
        { title: "Empty", summary: "   " },
        { title: "Third", summary: "We showed Y." },
      ],
    });
    expect(items.map((i) => [i.id, i.kind, i.title, i.text])).toEqual([
      [`biosketch:${INV}:statement`, "biosketch_statement", null, "I study lupus."],
      [`biosketch:${INV}:contribution:1`, "biosketch_contribution", "First line", "We showed X."],
      [`biosketch:${INV}:contribution:3`, "biosketch_contribution", "Third", "We showed Y."],
    ]);
    expect(items[0]!.year).toBe(2025);
    expect(items[2]!.signals.contribution_index).toBe(3);
    expect(normalizeBiosketch({ investigator_id: INV })).toEqual([]);
  });
});

describe("normalizeProfiles", () => {
  it("reads the narrative from meta and the directory priors from the investigator row", () => {
    const item = normalizeProfiles(
      { investigator_id: INV, last_refreshed_at: "2026-08-01T00:00:00Z", meta: { narrative: "My lab studies …", title: "Professor", department: "Medicine", titles: ["Professor of Medicine"], keywords: ["Lupus"] } },
      { id: INV, title_series: "In Residence", home_department: "Medicine", division: "Rheumatology", rank: "Professor", degrees: ["MD", "PhD"] }
    );
    expect(item.id).toBe(`profiles:${INV}`);
    expect(item.kind).toBe("profiles_narrative");
    expect(item.text).toBe("My lab studies …");
    expect(item.year).toBe(2026);
    expect(item.signals).toMatchObject({ title_series: "In Residence", department: "Medicine", division: "Rheumatology", degrees: ["MD", "PhD"], profiles_department: "Medicine", keywords: ["Lupus"] });
    const none = normalizeProfiles(null, { id: INV, home_department: "Epidemiology & Biostatistics" });
    expect(none.text).toBeNull();
    expect(none.signals.department).toBe("Epidemiology & Biostatistics");
  });
});

describe("normalizeSelfDeclared", () => {
  it("carries the D5 record, the intake answers by normalized field, and aspirations in signals only", () => {
    expect(INTAKE_FIELDS).toEqual(["clinical_samples", "biobanks"]);
    const axes = { paradigm: { discovery: 3 }, materials: ["human_blood_fluids"], capabilities: [], updated_at: "2026-09-01T00:00:00.000Z" };
    const item = normalizeSelfDeclared({
      id: INV,
      self_declared_axes: axes,
      aspirations: ["move into implementation science"],
      do_not_suggest: ["preclinical"],
      raw_profile_json: { clinical_samples: "Yes, PBMCs", Biobanks: "no", primary_research_area: "T cell biology" },
    });
    expect(item.id).toBe(`self_declared:${INV}`);
    expect(item.kind).toBe("self_declared");
    expect(item.text).toBe("T cell biology");
    expect(item.year).toBe(2026);
    expect(item.signals.self_declared_axes).toEqual(axes);
    expect(item.signals.intake).toEqual({ clinical_samples: "Yes, PBMCs", biobanks: "no" });
    expect(item.signals.aspirations).toEqual(["move into implementation science"]);
    expect(item.signals.do_not_suggest).toEqual(["preclinical"]);
    expect(item.text).not.toContain("implementation");
  });

  it("an unparseable record is null, a missing sheet is all nulls", () => {
    const item = normalizeSelfDeclared({ id: INV, self_declared_axes: { paradigm: { nope: 1 } } });
    expect(item.signals.self_declared_axes).toBeNull();
    expect(item.signals.intake).toEqual({ clinical_samples: null, biobanks: null });
    expect(item.text).toBeNull();
    expect(item.year).toBeNull();
  });
});
