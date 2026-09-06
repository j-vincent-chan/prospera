/**
 * Rule classifier tests (plan § PR 1.2). One test per rule id — the coverage
 * test at the end pins that set to `signal-mapping.json` — with a
 * must-not-fire case wherever the rule carries a `not`; the six
 * item-classifier fixtures (docs/fit-engine/prompts/item-classifier.md) with
 * the dominant categories the rules reach where MeSH is present; noisy-OR
 * arithmetic; `refine`; both `assign_from_table` tables; and every loud
 * failure: an unknown MeSH name, an unknown category id, an unknown clause
 * kind, a bad table entry.
 */
import { describe, expect, it } from "vitest";
import fixture from "@/lib/fit/__fixtures__/mesh-descriptors-subset.json";
import { buildMeshIndex, MeshUnknownDescriptorError, resolveDescriptor, type MeshDescriptorRow } from "@/lib/fit/classify/mesh";
import {
  normalizeBiosketch,
  normalizeGrant,
  normalizeProfiles,
  normalizePublication,
  normalizeSelfDeclared,
  normalizeTrial,
  type GrantRow,
  type InvestigatorRow,
  type NormalizedItem,
  type TrialRow,
} from "@/lib/fit/classify/normalize";
import {
  DEFAULT_RULE_TABLES,
  evaluateRules,
  lookupProgramDivision,
  lookupStudySection,
  matchNoticeRules,
  noisyOr,
  RULE_IDS,
  RuleClauseError,
  studySectionKey,
  type AssignBlock,
  type Axis,
  type AxisWeights,
  type EvaluateContext,
  type RuleClassification,
  type RuleSubject,
  type RuleTables,
  type SignalMapping,
  type SignalRule,
} from "@/lib/fit/classify/rules";
import signalMapping from "@/lib/fit/signal-mapping.json";
import { TaxonomyError } from "@/lib/fit/taxonomy";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const index = buildMeshIndex(fixture.descriptors as MeshDescriptorRow[]);
const ctx: EvaluateContext = { mesh: index, tables: DEFAULT_RULE_TABLES };
const mapping = signalMapping as unknown as SignalMapping;
const INV = "00000000-0000-4000-8000-000000000001";

function heading(name: string, major = false) {
  const row = resolveDescriptor(index, name);
  return { ui: row.ui, name: row.name, major, qualifiers: [] as string[] };
}

type PubOpts = { mesh?: string[]; major?: string[]; pubtypes?: string[]; abstract?: string | null; author_position?: string; pmid?: string };

function pub(opts: PubOpts): NormalizedItem {
  return normalizePublication(
    {
      investigator_id: INV,
      pmid: opts.pmid ?? "1",
      title: "t",
      publication_date: "2024-01-01",
      mesh: [...(opts.mesh ?? []).map((n) => heading(n)), ...(opts.major ?? []).map((n) => heading(n, true))],
      publication_types: opts.pubtypes ?? [],
      abstract: opts.abstract ?? null,
      author_position: opts.author_position ?? "first",
      author_position_method: "orcid",
    },
    { id: INV },
    { mesh: index }
  );
}

function grant(opts: Partial<GrantRow>): NormalizedItem {
  return normalizeGrant({ id: "g1", investigator_id: INV, project_num: "5R01AI000001-02", fiscal_year: 2024, identity_status: "verified", ...opts });
}

function trial(opts: Partial<TrialRow>): NormalizedItem {
  return normalizeTrial({
    investigator_id: INV,
    nct_id: "NCT00000001",
    title: "t",
    start_date: "2023-01-01",
    study_type: "INTERVENTIONAL",
    phases: [],
    intervention_types: [],
    investigator_role: "PRINCIPAL_INVESTIGATOR",
    ...opts,
  });
}

function profiles(inv: Partial<InvestigatorRow>): NormalizedItem {
  return normalizeProfiles(null, { id: INV, ...inv });
}

function self(inv: Partial<InvestigatorRow>): NormalizedItem {
  return normalizeSelfDeclared({ id: INV, ...inv });
}

/** A notice-shaped subject for the `notice` rules (PR 1.5 builds the real one). */
function notice(signals: Record<string, unknown>): RuleSubject {
  return { mesh: [], publication_types: [], signals };
}

const ruleById = new Map(mapping.rules.map((r) => [r.id, r]));
function assignOf(id: string): AssignBlock {
  const rule = ruleById.get(id);
  if (!rule?.assign) throw new Error(`rule ${id} has no assign block`);
  return rule.assign;
}

function firedIds(r: RuleClassification): string[] {
  return r.fired.map((f) => f.ruleId);
}

function expectAxesClose(actual: AxisWeights, expected: AssignBlock): void {
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  for (const [axis, values] of Object.entries(expected)) {
    const got = actual[axis as Axis] ?? {};
    expect(Object.keys(got).sort()).toEqual(Object.keys(values ?? {}).sort());
    for (const [id, p] of Object.entries(values ?? {})) expect(got[id]).toBeCloseTo(p, 10);
  }
}

/** The item fires exactly this rule and nothing else; the merged axes are the rule's own block. */
function expectOnly(item: RuleSubject, id: string): RuleClassification {
  const r = evaluateRules(item as NormalizedItem, ctx);
  expect(firedIds(r)).toEqual([id]);
  expectAxesClose(r.axes, assignOf(id));
  return r;
}

function expectFires(item: RuleSubject, id: string): RuleClassification {
  const r = evaluateRules(item as NormalizedItem, ctx);
  expect(firedIds(r)).toContain(id);
  return r;
}

function expectNotFires(item: RuleSubject, id: string): RuleClassification {
  const r = evaluateRules(item as NormalizedItem, ctx);
  expect(firedIds(r)).not.toContain(id);
  return r;
}

const tested = new Set<string>();
function ruleTest(id: string, fn: () => void): void {
  if (!ruleById.has(id)) throw new Error(`no rule ${id} in signal-mapping.json`);
  tested.add(id);
  it(id, fn);
}

/** Categories at or above every other category on the axis, for the fixture expectations. */
function dominant(axes: AxisWeights, axis: Axis): string[] {
  const values = axes[axis] ?? {};
  const max = Math.max(...Object.values(values));
  return Object.entries(values)
    .filter(([, p]) => p >= max - 1e-9)
    .map(([id]) => id);
}

// ---------------------------------------------------------------------------
// PubMed rules — publication types
// ---------------------------------------------------------------------------

describe("pubmed publication-type rules", () => {
  ruleTest("pt_rct", () => {
    expectOnly(pub({ pubtypes: ["Randomized Controlled Trial"], mesh: ["Humans"] }), "pt_rct");
  });

  ruleTest("pt_phase1", () => {
    expectOnly(pub({ pubtypes: ["Clinical Trial, Phase I"] }), "pt_phase1");
  });

  ruleTest("pt_phase2_4", () => {
    expectOnly(pub({ pubtypes: ["Clinical Trial, Phase III"] }), "pt_phase2_4");
    expectFires(pub({ pubtypes: ["Clinical Trial, Phase II"] }), "pt_phase2_4");
    expectFires(pub({ pubtypes: ["Clinical Trial, Phase IV"] }), "pt_phase2_4");
  });

  ruleTest("pt_pragmatic", () => {
    expectOnly(pub({ pubtypes: ["Pragmatic Clinical Trial"] }), "pt_pragmatic");
  });

  ruleTest("pt_clinical_trial_generic", () => {
    expectOnly(pub({ pubtypes: ["Clinical Trial"] }), "pt_clinical_trial_generic");
    // `not`: a phase- or RCT-typed paper is handled by the specific rule.
    const r = expectNotFires(pub({ pubtypes: ["Clinical Trial", "Randomized Controlled Trial"] }), "pt_clinical_trial_generic");
    expect(firedIds(r)).toEqual(["pt_rct"]);
    expectNotFires(pub({ pubtypes: ["Clinical Trial", "Clinical Trial, Phase II"] }), "pt_clinical_trial_generic");
  });

  ruleTest("pt_observational_prospective", () => {
    const r = expectOnly(pub({ pubtypes: ["Observational Study"], mesh: ["Prospective Studies", "Humans"] }), "pt_observational_prospective");
    expect(firedIds(r)).not.toContain("pt_observational_generic");
    // every clause is required: no Humans check tag, no fire
    expectNotFires(pub({ pubtypes: ["Observational Study"], mesh: ["Prospective Studies"] }), "pt_observational_prospective");
  });

  ruleTest("pt_observational_generic", () => {
    expectOnly(pub({ pubtypes: ["Observational Study"], mesh: ["Humans"] }), "pt_observational_generic");
    expectNotFires(pub({ pubtypes: ["Observational Study"], mesh: ["Prospective Studies", "Humans"] }), "pt_observational_generic");
  });

  ruleTest("pt_meta_analysis", () => {
    expectOnly(pub({ pubtypes: ["Meta-Analysis"] }), "pt_meta_analysis");
    expectFires(pub({ pubtypes: ["Systematic Review"] }), "pt_meta_analysis");
  });
});

// ---------------------------------------------------------------------------
// PubMed rules — MeSH
// ---------------------------------------------------------------------------

describe("pubmed MeSH rules", () => {
  ruleTest("mesh_cohort_epi", () => {
    expectOnly(pub({ mesh: ["Cohort Studies", "Risk Factors", "Humans"] }), "mesh_cohort_epi");
    // both mesh_any groups and the check tag are ANDed
    expectNotFires(pub({ mesh: ["Cohort Studies", "Humans"] }), "mesh_cohort_epi");
    expectNotFires(pub({ mesh: ["Cohort Studies", "Incidence"] }), "mesh_cohort_epi");
  });

  ruleTest("mesh_case_control", () => {
    expectOnly(pub({ mesh: ["Case-Control Studies"] }), "mesh_case_control");
  });

  ruleTest("mesh_cross_sectional", () => {
    expectOnly(pub({ mesh: ["Cross-Sectional Studies"] }), "mesh_cross_sectional");
  });

  ruleTest("mesh_retrospective", () => {
    expectOnly(pub({ mesh: ["Retrospective Studies", "Humans"] }), "mesh_retrospective");
    expectNotFires(pub({ mesh: ["Retrospective Studies"] }), "mesh_retrospective");
  });

  ruleTest("mesh_registries", () => {
    expectOnly(pub({ mesh: ["Registries"] }), "mesh_registries");
  });

  ruleTest("mesh_gwas", () => {
    expectOnly(pub({ mesh: ["Genome-Wide Association Study"] }), "mesh_gwas");
    expectFires(pub({ mesh: ["Mendelian Randomization Analysis"] }), "mesh_gwas");
  });

  ruleTest("mesh_rwd", () => {
    expectOnly(pub({ mesh: ["Electronic Health Records"] }), "mesh_rwd");
    expectFires(pub({ mesh: ["Medicare"] }), "mesh_rwd");
  });

  ruleTest("mesh_hsr", () => {
    expectOnly(pub({ mesh: ["Health Services Research"] }), "mesh_hsr");
  });

  ruleTest("mesh_outcomes", () => {
    expectOnly(pub({ mesh: ["Patient Reported Outcome Measures"] }), "mesh_outcomes");
  });

  ruleTest("mesh_cer", () => {
    expectOnly(pub({ mesh: ["Comparative Effectiveness Research"] }), "mesh_cer");
  });

  ruleTest("mesh_implementation", () => {
    expectOnly(pub({ mesh: ["Implementation Science"] }), "mesh_implementation");
  });

  ruleTest("mesh_cbpr", () => {
    expectOnly(pub({ mesh: ["Community-Based Participatory Research"] }), "mesh_cbpr");
  });

  ruleTest("mesh_sdoh", () => {
    expectOnly(pub({ mesh: ["Social Determinants of Health"] }), "mesh_sdoh");
  });

  ruleTest("mesh_public_health", () => {
    expectOnly(pub({ mesh: ["Population Surveillance"] }), "mesh_public_health");
  });

  ruleTest("mesh_qual_survey", () => {
    expectOnly(pub({ mesh: ["Qualitative Research"] }), "mesh_qual_survey");
  });

  ruleTest("mesh_behavioral", () => {
    expectOnly(pub({ mesh: ["Health Behavior"] }), "mesh_behavioral");
  });

  ruleTest("mesh_computational", () => {
    expectOnly(pub({ mesh: ["Machine Learning"] }), "mesh_computational");
  });

  ruleTest("mesh_bioinformatics", () => {
    const r = expectFires(pub({ mesh: ["Computational Biology", "Genomics"] }), "mesh_bioinformatics");
    expect(firedIds(r)).toEqual(["mesh_computational", "mesh_bioinformatics"]);
    // `not`: bench work with a computational component is not bioinformatics
    expectNotFires(pub({ mesh: ["Computational Biology", "Genomics", "Cell Line"] }), "mesh_bioinformatics");
    // the second group is required
    expectNotFires(pub({ mesh: ["Computational Biology"] }), "mesh_bioinformatics");
  });

  ruleTest("tag_animals_only", () => {
    expectOnly(pub({ mesh: ["Animals", "Mice"] }), "tag_animals_only");
    // PR 0.2 note: Zebrafish / Primates / Macaca are B01 descriptors, matched by NAME, not by is_check_tag
    expect(resolveDescriptor(index, "Zebrafish").is_check_tag).toBe(false);
    expectOnly(pub({ mesh: ["Zebrafish"] }), "tag_animals_only");
    expectFires(pub({ mesh: ["Macaca"] }), "tag_animals_only");
    // `not`: a Humans check tag turns the paper translational instead
    const r = expectNotFires(pub({ mesh: ["Animals", "Mice", "Humans"] }), "tag_animals_only");
    expect(firedIds(r)).toEqual(["triangle_animal_human"]);
  });

  ruleTest("mesh_disease_models_animal", () => {
    expectOnly(pub({ mesh: ["Disease Models, Animal"] }), "mesh_disease_models_animal");
    expectFires(pub({ mesh: ["Mice, Knockout"] }), "mesh_disease_models_animal");
  });

  ruleTest("mesh_xenograft", () => {
    const r = expectFires(pub({ mesh: ["Xenograft Model Antitumor Assays"] }), "mesh_xenograft");
    expect(r.axes.design?.xenograft_pdx).toBeCloseTo(0.9, 10);
  });

  ruleTest("mesh_preclinical_drug", () => {
    const r = expectOnly(pub({ mesh: ["Drug Evaluation, Preclinical"] }), "mesh_preclinical_drug");
    expect(r.firedAxes).toEqual(["paradigm", "objective"]);
  });

  ruleTest("mesh_cell_culture", () => {
    expectOnly(pub({ mesh: ["Cell Line"] }), "mesh_cell_culture");
    expectFires(pub({ mesh: ["Organoids"] }), "mesh_cell_culture");
    expectNotFires(pub({ mesh: ["Cell Line"], pubtypes: ["Randomized Controlled Trial"] }), "mesh_cell_culture");
    expectNotFires(pub({ mesh: ["Cell Line"], pubtypes: ["Observational Study"] }), "mesh_cell_culture");
  });

  ruleTest("mesh_mechanism", () => {
    expectOnly(pub({ mesh: ["Signal Transduction"] }), "mesh_mechanism");
    expectFires(pub({ mesh: ["CRISPR-Cas Systems"] }), "mesh_mechanism");
  });

  ruleTest("mesh_structural", () => {
    expectOnly(pub({ mesh: ["Crystallography, X-Ray"] }), "mesh_structural");
  });

  ruleTest("mesh_omics_methods", () => {
    expectOnly(pub({ mesh: ["Proteomics"] }), "mesh_omics_methods");
  });

  ruleTest("mesh_single_cell", () => {
    const r = expectFires(pub({ mesh: ["Single-Cell Gene Expression Analysis"] }), "mesh_single_cell");
    expect(r.axes.design?.single_cell).toBeCloseTo(0.9, 10);
  });

  ruleTest("mesh_imaging", () => {
    expectOnly(pub({ mesh: ["Microscopy, Fluorescence"] }), "mesh_imaging");
  });

  ruleTest("human_biospecimen", () => {
    expectOnly(pub({ mesh: ["Humans", "Biopsy"] }), "human_biospecimen");
    expectFires(pub({ mesh: ["Humans", "Leukocytes, Mononuclear"] }), "human_biospecimen");
    // needs the Humans check tag
    expectNotFires(pub({ mesh: ["Biopsy"] }), "human_biospecimen");
    // `not`: a cohort or a trial is not a biospecimen study
    expectNotFires(pub({ mesh: ["Humans", "Biopsy", "Cohort Studies"] }), "human_biospecimen");
    expectNotFires(pub({ mesh: ["Humans", "Biomarkers"], pubtypes: ["Observational Study"] }), "human_biospecimen");
    expectNotFires(pub({ mesh: ["Humans", "Biomarkers"], pubtypes: ["Clinical Trial"] }), "human_biospecimen");
  });

  ruleTest("triangle_animal_human", () => {
    // Mice (B01) + Humans (UI D006801) → AH
    expectOnly(pub({ mesh: ["Mice", "Humans"] }), "triangle_animal_human");
    // Humans alone → H, no bridge
    expectNotFires(pub({ mesh: ["Humans"] }), "triangle_animal_human");
    // Mice alone → A
    expectNotFires(pub({ mesh: ["Mice"] }), "triangle_animal_human");
    // no MeSH at all → null class, no fire
    expectNotFires(pub({}), "triangle_animal_human");
  });

  ruleTest("mesh_treatment_outcome_human", () => {
    expectOnly(pub({ mesh: ["Humans", "Treatment Outcome"] }), "mesh_treatment_outcome_human");
    expectNotFires(pub({ mesh: ["Humans", "Treatment Outcome"], pubtypes: ["Randomized Controlled Trial"] }), "mesh_treatment_outcome_human");
    expectNotFires(pub({ mesh: ["Humans", "Treatment Outcome"], pubtypes: ["Clinical Trial"] }), "mesh_treatment_outcome_human");
  });
});

// ---------------------------------------------------------------------------
// CT.gov rules
// ---------------------------------------------------------------------------

describe("ctgov rules", () => {
  ruleTest("ctgov_interventional_pi", () => {
    const r = expectOnly(trial({ phases: ["NA"] }), "ctgov_interventional_pi");
    expect(r.refinedBy).toEqual([]);
    for (const role of ["STUDY_CHAIR", "STUDY_DIRECTOR", "RESPONSIBLE_PARTY_PI"]) expectFires(trial({ investigator_role: role }), "ctgov_interventional_pi");
    expectNotFires(trial({ investigator_role: "LISTED" }), "ctgov_interventional_pi");
    expectNotFires(trial({ study_type: "OBSERVATIONAL" }), "ctgov_interventional_pi");
  });

  ruleTest("ctgov_interventional_listed", () => {
    expectOnly(trial({ investigator_role: "LISTED" }), "ctgov_interventional_listed");
    expectFires(trial({ investigator_role: "UNKNOWN" }), "ctgov_interventional_listed");
    expectFires(trial({ investigator_role: null }), "ctgov_interventional_listed");
    expectNotFires(trial({ investigator_role: "PRINCIPAL_INVESTIGATOR" }), "ctgov_interventional_listed");
  });

  ruleTest("ctgov_hsr_purpose", () => {
    const r = expectFires(trial({ primary_purpose: "HEALTH_SERVICES_RESEARCH" }), "ctgov_hsr_purpose");
    expect(firedIds(r)).toEqual(["ctgov_interventional_pi", "ctgov_hsr_purpose"]);
    // enum folding: CT.gov spelling variants compare equal
    expectFires(trial({ primary_purpose: "Health Services Research" }), "ctgov_hsr_purpose");
  });

  ruleTest("ctgov_basic_science_purpose", () => {
    expectFires(trial({ primary_purpose: "BASIC_SCIENCE" }), "ctgov_basic_science_purpose");
    expectNotFires(trial({ study_type: "OBSERVATIONAL", primary_purpose: "BASIC_SCIENCE" }), "ctgov_basic_science_purpose");
  });

  ruleTest("ctgov_observational_cohort_large", () => {
    const r = expectOnly(trial({ study_type: "OBSERVATIONAL", observational_model: "COHORT", enrollment: 1500 }), "ctgov_observational_cohort_large");
    expect(firedIds(r)).not.toContain("ctgov_observational_other");
    expectNotFires(trial({ study_type: "OBSERVATIONAL", observational_model: "COHORT", enrollment: 999 }), "ctgov_observational_cohort_large");
    expectNotFires(trial({ study_type: "OBSERVATIONAL", observational_model: "CASE_CONTROL", enrollment: 1500 }), "ctgov_observational_cohort_large");
  });

  ruleTest("ctgov_observational_other", () => {
    expectOnly(trial({ study_type: "OBSERVATIONAL", observational_model: "CASE_ONLY", enrollment: 200 }), "ctgov_observational_other");
    // an enrollment CT.gov does not carry is "not ≥ 1000"
    expectFires(trial({ study_type: "OBSERVATIONAL", enrollment: null }), "ctgov_observational_other");
    expectNotFires(trial({ study_type: "OBSERVATIONAL", observational_model: "COHORT", enrollment: 1000 }), "ctgov_observational_other");
  });

  ruleTest("ctgov_behavioral_intervention", () => {
    const r = expectFires(trial({ intervention_types: ["DRUG", "BEHAVIORAL"] }), "ctgov_behavioral_intervention");
    expect(r.axes.paradigm?.behavioral).toBeCloseTo(0.7, 10);
    expectNotFires(trial({ intervention_types: ["DRUG"] }), "ctgov_behavioral_intervention");
    expectNotFires(trial({ intervention_types: [] }), "ctgov_behavioral_intervention");
  });

  it("refine: the phase overrides the rule's own design values, max over several phases", () => {
    const p3 = evaluateRules(trial({ phases: ["PHASE3"] }), ctx);
    expect(p3.refinedBy).toEqual(["ctgov_interventional_pi.phases_any.PHASE3"]);
    expect(p3.axes.design).toEqual({ rct: expect.closeTo(0.95, 10), early_phase_trial: expect.closeTo(0.4, 10) });

    const early = evaluateRules(trial({ phases: ["EARLY_PHASE1"] }), ctx);
    expect(early.axes.design).toEqual({ rct: expect.closeTo(0.2, 10), early_phase_trial: expect.closeTo(0.95, 10) });
    expect(early.axes.paradigm).toEqual({ clinical_trials: expect.closeTo(0.95, 10), early_phase_human_experimental: expect.closeTo(0.7, 10) });

    const p12 = evaluateRules(trial({ phases: ["PHASE1", "PHASE2"] }), ctx);
    expect(p12.refinedBy).toEqual(["ctgov_interventional_pi.phases_any.PHASE1", "ctgov_interventional_pi.phases_any.PHASE2"]);
    expect(p12.axes.design).toEqual({ rct: expect.closeTo(0.8, 10), early_phase_trial: expect.closeTo(0.9, 10) });

    const p4 = evaluateRules(trial({ phases: ["PHASE4"] }), ctx);
    expect(p4.axes.design?.pragmatic_trial).toBeCloseTo(0.5, 10);

    // PR 0.3 follow-up: phases = ["NA"] is a real value with no refine key yet — the rule keeps its default design
    const na = evaluateRules(trial({ phases: ["NA"], allocation: "RANDOMIZED", intervention_model: "PARALLEL" }), ctx);
    expect(na.refinedBy).toEqual([]);
    expect(na.axes.design?.rct).toBeCloseTo(0.7, 10);
  });
});

// ---------------------------------------------------------------------------
// RePORTER rules
// ---------------------------------------------------------------------------

describe("reporter rules", () => {
  ruleTest("reporter_k23_k24", () => {
    expectOnly(grant({ activity_code: "K23" }), "reporter_k23_k24");
    expectFires(grant({ activity_code: "k24" }), "reporter_k23_k24");
    expectNotFires(grant({ activity_code: "R01" }), "reporter_k23_k24");
  });

  ruleTest("reporter_k08", () => {
    expectOnly(grant({ activity_code: "K08" }), "reporter_k08");
  });

  ruleTest("reporter_trial_mechanisms", () => {
    expectOnly(grant({ activity_code: "UG3" }), "reporter_trial_mechanisms");
    for (const code of ["UH3", "UM1", "R34", "U10", "UG1"]) expectFires(grant({ activity_code: code }), "reporter_trial_mechanisms");
  });

  ruleTest("reporter_r18", () => {
    expectOnly(grant({ activity_code: "R18" }), "reporter_r18");
  });

  ruleTest("reporter_rcdc_clinical_trials", () => {
    expectOnly(grant({ rcdc_categories: ["Clinical Trials and Supportive Activities"] }), "reporter_rcdc_clinical_trials");
    expectFires(grant({ rcdc_categories: ["Gene Therapy Clinical Trials"] }), "reporter_rcdc_clinical_trials");
    // D9: "Clinical Trials" is not an RCDC value
    expectNotFires(grant({ rcdc_categories: ["Clinical Trials"] }), "reporter_rcdc_clinical_trials");
  });

  ruleTest("reporter_rcdc_clinical_research", () => {
    expectOnly(grant({ rcdc_categories: ["Clinical Research", "Lupus"] }), "reporter_rcdc_clinical_research");
  });

  ruleTest("reporter_rcdc_hsr", () => {
    expectOnly(grant({ rcdc_categories: ["Health Services"] }), "reporter_rcdc_hsr");
  });

  ruleTest("reporter_rcdc_cer", () => {
    expectOnly(grant({ rcdc_categories: ["Comparative Effectiveness Research"] }), "reporter_rcdc_cer");
  });

  ruleTest("reporter_rcdc_prevention", () => {
    const r = expectOnly(grant({ rcdc_categories: ["Prevention"] }), "reporter_rcdc_prevention");
    expect(r.firedAxes).toEqual(["objective"]);
  });

  ruleTest("reporter_rcdc_behavioral", () => {
    expectOnly(grant({ rcdc_categories: ["Basic Behavioral and Social Science"] }), "reporter_rcdc_behavioral");
    expectFires(grant({ rcdc_categories: ["Behavioral and Social Science"] }), "reporter_rcdc_behavioral");
  });

  ruleTest("reporter_rcdc_di", () => {
    expectOnly(grant({ rcdc_categories: ["Dissemination and Implementation Research"] }), "reporter_rcdc_di");
  });

  ruleTest("reporter_rcdc_translational", () => {
    expectOnly(grant({ rcdc_categories: ["Translational Research"] }), "reporter_rcdc_translational");
  });

  it("rcdc_any treats NULL (RePORTER has no categories) and [] alike", () => {
    expect(grant({ rcdc_categories: null }).signals.rcdc_categories).toBeNull();
    expect(grant({ rcdc_categories: [] }).signals.rcdc_categories).toEqual([]);
    for (const rcdc of [null, []]) {
      const r = evaluateRules(grant({ rcdc_categories: rcdc }), ctx);
      expect(firedIds(r).filter((id) => id.startsWith("reporter_rcdc"))).toEqual([]);
    }
  });

  ruleTest("reporter_study_section_family", () => {
    // CSR panel by srg_code → discovery .6 over both discovery categories, translational .3 over its three
    const hai = expectFires(grant({ study_section: "Hypersensitivity, Autoimmune, and Immune-mediated Diseases Study Section", study_section_code: "HAI" }), "reporter_study_section_family");
    expect(firedIds(hai)).toEqual(["reporter_study_section_family"]);
    expect(hai.axes).toEqual({
      paradigm: {
        basic_discovery: expect.closeTo(0.6, 10),
        molecular_cellular_mechanistic: expect.closeTo(0.6, 10),
        translational: expect.closeTo(0.3, 10),
        human_biospecimen: expect.closeTo(0.3, 10),
        early_phase_human_experimental: expect.closeTo(0.3, 10),
      },
    });
    expect(hai.unknownTableKeys).toEqual([]);

    // Special Emphasis Panel: the code is only the IC prefix; the topic is raw_json.full_study_section.sra_designator_code (PR 0.4 follow-up)
    const sep = grant({ study_section: "Special Emphasis Panel", study_section_code: "ZAI1", raw_json: { full_study_section: { sra_designator_code: "IDM" } } });
    expect(sep.signals.sra_designator_code).toBe("IDM");
    expect(studySectionKey(sep.signals)).toBe("IDM");
    expect(evaluateRules(sep, ctx).axes.paradigm?.basic_discovery).toBeCloseTo(0.6, 10);

    // SEP whose designator is the SRO's initials: unknown, assigns nothing, reported
    const sro = evaluateRules(grant({ study_section: "Special Emphasis Panel", study_section_code: "ZRG1", raw_json: { full_study_section: { sra_designator_code: "MJH" } } }), ctx);
    expect(firedIds(sro)).toEqual([]);
    expect(sro.unknownTableKeys).toEqual([{ ruleId: "reporter_study_section_family", table: "study_sections", key: "MJH" }]);

    // unknown srg_code: same
    const unknown = evaluateRules(grant({ study_section: "Some New Panel", study_section_code: "XYZ9" }), ctx);
    expect(firedIds(unknown)).toEqual([]);
    expect(unknown.unknownTableKeys).toEqual([{ ruleId: "reporter_study_section_family", table: "study_sections", key: "XYZ9" }]);

    // known panel with no paradigm signal (`families: {}`): matched, nothing assigned, not reported
    const ams = evaluateRules(grant({ study_section: "Arthritis and Musculoskeletal and Skin Diseases Special Grants Study Section", study_section_code: "AMS" }), ctx);
    expect(firedIds(ams)).toEqual([]);
    expect(ams.unknownTableKeys).toEqual([]);

    // by_name wins over a code an IC shares across panels
    const pedsItem = grant({ study_section: "Pediatrics Study Section", study_section_code: "CHHD" });
    const peds = evaluateRules(pedsItem, ctx);
    expect(peds.axes.paradigm?.clinical_observational).toBeCloseTo(0.5, 10);
    expect(peds.axes.paradigm?.epidemiology).toBeCloseTo(0.3, 10);
    expect(lookupStudySection(DEFAULT_RULE_TABLES.studySections, pedsItem.signals).key).toBe("name:Pediatrics Study Section");
    // the shared code alone (a panel name the table does not list) is a known code with no signal: nothing, not reported
    const chhd = evaluateRules(grant({ study_section: "Some Other NICHD Panel", study_section_code: "CHHD" }), ctx);
    expect(firedIds(chhd)).toEqual([]);
    expect(chhd.unknownTableKeys).toEqual([]);

    // no panel at all: nothing, and nothing to report
    const none = evaluateRules(grant({ study_section: null, study_section_code: null }), ctx);
    expect(none.unknownTableKeys).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Notice rules (assign_notice + program division table)
// ---------------------------------------------------------------------------

describe("notice rules", () => {
  ruleTest("notice_ct_required", () => {
    expect(matchNoticeRules(notice({ clinical_trial_designation: "required" }), ctx)).toEqual([
      { ruleId: "notice_ct_required", assign_notice: "taxonomy.opportunity_profile.clinical_trial_designation.required" },
    ]);
  });

  ruleTest("notice_besh_required", () => {
    expect(matchNoticeRules(notice({ clinical_trial_designation: "besh_required" }), ctx)).toEqual([
      { ruleId: "notice_besh_required", assign_notice: "taxonomy.opportunity_profile.clinical_trial_designation.besh_required" },
    ]);
  });

  ruleTest("notice_ct_not_allowed", () => {
    expect(matchNoticeRules(notice({ clinical_trial_designation: "not_allowed" }), ctx)).toEqual([
      { ruleId: "notice_ct_not_allowed", assign_notice: "taxonomy.opportunity_profile.clinical_trial_designation.not_allowed" },
    ]);
    expect(matchNoticeRules(notice({ clinical_trial_designation: "optional" }), ctx)).toEqual([]);
    expect(matchNoticeRules(notice({}), ctx)).toEqual([]);
  });

  ruleTest("notice_activity_code", () => {
    expect(matchNoticeRules(notice({ activity_code: "R01" }), ctx)).toEqual([
      { ruleId: "notice_activity_code", assign_notice: "taxonomy.opportunity_profile.activity_code_priors[activity_code]" },
    ]);
    expect(matchNoticeRules(notice({ activity_code: null }), ctx)).toEqual([]);
  });

  it("assign_notice rules never fire in evaluateRules", () => {
    const r = evaluateRules({ ...notice({ clinical_trial_designation: "required", activity_code: "R01" }), id: "n", kind: "grant", title: null, text: null, year: null, role: null }, ctx);
    expect(firedIds(r)).toEqual([]);
  });

  ruleTest("notice_program_division", () => {
    const dccps = evaluateRules({ ...notice({ program_division: "Division of Cancer Control and Population Sciences (DCCPS)" }), id: "n", kind: "grant", title: null, text: null, year: null, role: null }, ctx);
    expect(firedIds(dccps)).toEqual(["notice_program_division"]);
    expect(dccps.axes.paradigm?.epidemiology).toBeCloseTo(0.5, 10);
    expect(dccps.axes.paradigm?.behavioral).toBeCloseTo(0.5, 10);
    expect(dccps.axes.paradigm?.health_services).toBeCloseTo(0.4, 10);
    expect(dccps.axes.paradigm?.basic_discovery).toBeUndefined();

    // name-only form folds punctuation and case
    expect(lookupProgramDivision(DEFAULT_RULE_TABLES.programDivisions, "epidemiology branch").key).toBe("EPIDEMIOLOGY_BRANCH");
    expect(lookupProgramDivision(DEFAULT_RULE_TABLES.programDivisions, "Division of Diabetes, Endocrinology and Metabolic Diseases").key).toBe("DEM");
    expect(lookupProgramDivision(DEFAULT_RULE_TABLES.programDivisions, "DEM").key).toBe("DEM");

    const unknown = evaluateRules({ ...notice({ program_division: "Division of Nothing in Particular (DNIP)" }), id: "n", kind: "grant", title: null, text: null, year: null, role: null }, ctx);
    expect(firedIds(unknown)).toEqual([]);
    expect(unknown.unknownTableKeys).toEqual([{ ruleId: "notice_program_division", table: "program_divisions", key: "DNIP" }]);

    const absent = evaluateRules({ ...notice({ program_division: null }), id: "n", kind: "grant", title: null, text: null, year: null, role: null }, ctx);
    expect(absent.unknownTableKeys).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Profiles / directory / self-declared rules
// ---------------------------------------------------------------------------

describe("profiles, directory and self-declared rules", () => {
  ruleTest("profiles_clinical_series", () => {
    expectOnly(profiles({ title_series: "Health Sciences Clinical" }), "profiles_clinical_series");
    expectFires(profiles({ title_series: "Clinical X" }), "profiles_clinical_series");
    expectNotFires(profiles({ title_series: "In Residence" }), "profiles_clinical_series");
    expectNotFires(profiles({ title_series: null }), "profiles_clinical_series");
  });

  ruleTest("directory_epi_dept", () => {
    expectOnly(profiles({ home_department: "Epidemiology & Biostatistics" }), "directory_epi_dept");
    expectFires(profiles({ home_department: "Medicine", division: "Clinical Epidemiology" }), "directory_epi_dept");
    expectNotFires(profiles({ home_department: "Medicine", division: "Rheumatology" }), "directory_epi_dept");
  });

  const AXES_ROW = {
    paradigm: { discovery: 3, clinical: 1, population: 0 },
    materials: ["human_blood_fluids"],
    capabilities: [],
    updated_at: "2026-09-01T00:00:00.000Z",
  };

  ruleTest("self_declared_axes", () => {
    const r = expectFires(self({ self_declared_axes: AXES_ROW }), "self_declared_axes");
    expect(firedIds(r)).toEqual(["self_declared_axes"]);
    // Core (3) → 1.0 on every category of the family; Some (1) → 1/3; Not my work (0) → nothing
    expect(r.axes.paradigm).toEqual({
      basic_discovery: 1,
      molecular_cellular_mechanistic: 1,
      clinical_observational: expect.closeTo(1 / 3, 10),
      interventional_clinical: expect.closeTo(1 / 3, 10),
      clinical_trials: expect.closeTo(1 / 3, 10),
    });
    expect(r.axes.materials).toEqual({ human_blood_fluids: 1 });
    expect(r.firedAxes).toEqual(["paradigm", "materials"]);

    // import-derived record: materials only, paradigm {} (D5)
    const m = expectFires(self({ self_declared_axes: { ...AXES_ROW, paradigm: {} } }), "self_declared_axes");
    expect(firedIds(m)).toEqual(["self_declared_axes"]);
    expect(m.firedAxes).toEqual(["materials"]);
    expect(m.axes).toEqual({ materials: { human_blood_fluids: 1 } });

    // never answered / unparseable → not present
    expectNotFires(self({ self_declared_axes: null }), "self_declared_axes");
    expectNotFires(self({ self_declared_axes: { paradigm: { nope: 3 } } }), "self_declared_axes");
  });

  ruleTest("self_declared_clinical_samples", () => {
    expectOnly(self({ raw_profile_json: { clinical_samples: "Yes — PBMCs and plasma from our lupus cohort" } }), "self_declared_clinical_samples");
    // the import stores normalized headers; the raw header form is accepted too
    expectFires(self({ raw_profile_json: { "Clinical Samples": "yes" } }), "self_declared_clinical_samples");
    expectNotFires(self({ raw_profile_json: { clinical_samples: "No" } }), "self_declared_clinical_samples");
    expectNotFires(self({ raw_profile_json: { clinical_samples: "Hoping to get access to biopsies" } }), "self_declared_clinical_samples");
    expectNotFires(self({}), "self_declared_clinical_samples");
    // D5: once the stored record carries the materials, the intake text is not counted twice
    const both = evaluateRules(self({ self_declared_axes: AXES_ROW, raw_profile_json: { clinical_samples: "yes" } }), ctx);
    expect(firedIds(both)).toEqual(["self_declared_axes"]);
  });

  ruleTest("self_declared_biobank", () => {
    expectOnly(self({ raw_profile_json: { biobanks: "Yes, a lung tissue bank" } }), "self_declared_biobank");
    expectNotFires(self({ raw_profile_json: { biobanks: "N/A" } }), "self_declared_biobank");
    expectNotFires(self({ raw_profile_json: { biobanks: "" } }), "self_declared_biobank");
  });
});

// ---------------------------------------------------------------------------
// Merge arithmetic
// ---------------------------------------------------------------------------

describe("noisy-OR merge", () => {
  it("noisyOr", () => {
    expect(noisyOr([])).toBe(0);
    expect(noisyOr([0.6])).toBeCloseTo(0.6, 10);
    expect(noisyOr([0.6, 0.5])).toBeCloseTo(0.8, 10);
    expect(noisyOr([0.95, 0.95])).toBeCloseTo(0.9975, 10);
    expect(noisyOr([1, 0.3])).toBe(1);
  });

  it("two rules on the same category combine as 1 − Π(1 − p)", () => {
    const r = evaluateRules(pub({ mesh: ["Case-Control Studies", "Cross-Sectional Studies"] }), ctx);
    expect(firedIds(r)).toEqual(["mesh_case_control", "mesh_cross_sectional"]);
    expect(r.axes.paradigm?.epidemiology).toBeCloseTo(1 - 0.2 * 0.25, 10);
    expect(r.axes.paradigm?.clinical_observational).toBeCloseTo(1 - 0.6 * 0.6, 10);
    expect(r.axes.unit?.L4).toBeCloseTo(1 - 0.2 * 0.2, 10);
    expect(r.axes.design).toEqual({ case_control: expect.closeTo(0.95, 10), cross_sectional: expect.closeTo(0.95, 10) });
    expect(r.firedAxes).toEqual(["paradigm", "unit", "design"]);
  });

  it("an item with nothing structured fires nothing", () => {
    const r = evaluateRules(pub({ abstract: "We describe a method." }), ctx);
    expect(r).toEqual({ axes: {}, fired: [], firedAxes: [], refinedBy: [], unknownTableKeys: [] });
    const b = normalizeBiosketch({ investigator_id: INV, personal_statement: "I lead trials." })[0]!;
    expect(evaluateRules(b, ctx).fired).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Loud failure
// ---------------------------------------------------------------------------

describe("loud failure", () => {
  const base: SignalRule = { id: "x", source: "pubmed", when: { mesh_any: ["Cohort Studies"] }, assign: { paradigm: { epidemiology: 0.5 } } };
  const withRule = (rule: Partial<SignalRule>): SignalMapping => ({ version: "test", rules: [{ ...base, ...rule }] });
  const item = pub({ mesh: ["Cohort Studies"] });

  it("an unknown MeSH name in the mapping throws MeshUnknownDescriptorError", () => {
    expect(() => evaluateRules(item, { ...ctx, mapping: withRule({ when: { mesh_any: ["Cohort Study"] } }) })).toThrow(MeshUnknownDescriptorError);
    expect(() => evaluateRules(item, { ...ctx, mapping: withRule({ when: { check_tag: ["Human"] } }) })).toThrow(MeshUnknownDescriptorError);
    expect(() => evaluateRules(item, { ...ctx, mapping: withRule({ when: { check_tag: ["humans"] } }) })).toThrow(/did you mean "Humans"/);
    expect(() => evaluateRules(item, { ...ctx, mapping: withRule({ when: { pubtype: ["Randomised Controlled Trial"] } }) })).toThrow(MeshUnknownDescriptorError);
    // in a `not`, nested or top-level, just the same
    expect(() => evaluateRules(item, { ...ctx, mapping: withRule({ when: { mesh_any: ["Cohort Studies"], not: { mesh_any: ["Humen"] } } }) })).toThrow(MeshUnknownDescriptorError);
    expect(() => evaluateRules(item, { ...ctx, mapping: withRule({ not: { check_tag: ["Humen"] } }) })).toThrow(MeshUnknownDescriptorError);
  });

  it("an unknown MeSH UI on a stored row throws MeshUnknownDescriptorError", () => {
    expect(() =>
      normalizePublication({ investigator_id: INV, pmid: "1", mesh: [{ ui: "D9999999", name: "Retired Heading", major: false, qualifiers: [] }] }, { id: INV }, { mesh: index })
    ).toThrow(MeshUnknownDescriptorError);
  });

  it("an unresolvable category id in assign / refine / a table throws TaxonomyError", () => {
    expect(() => evaluateRules(item, { ...ctx, mapping: withRule({ assign: { paradigm: { epidemiologie: 0.5 } } }) })).toThrow(TaxonomyError);
    expect(() => evaluateRules(item, { ...ctx, mapping: withRule({ assign: { design: { L4: 0.5 } } }) })).toThrow(TaxonomyError);
    expect(() => evaluateRules(item, { ...ctx, mapping: withRule({ assign: { paradigm: { epidemiology: 1.5 } } }) })).toThrow(TaxonomyError);
    expect(() => evaluateRules(item, { ...ctx, mapping: withRule({ refine: { phases_any: { PHASE1: { design: { rct_ish: 0.5 } } } } }) })).toThrow(TaxonomyError);
    const tables: RuleTables = {
      ...DEFAULT_RULE_TABLES,
      studySections: { version: "t", family_prior: 0.6, by_code: { HAI: { families: { discovry: 0.6 } } }, by_name: {} },
    };
    expect(() => evaluateRules(item, { ...ctx, tables })).toThrow(TaxonomyError);
  });

  it("a clause kind the evaluator does not implement throws RuleClauseError", () => {
    expect(() => evaluateRules(item, { ...ctx, mapping: withRule({ when: { mesh_flavour: ["Cohort Studies"] } }) })).toThrow(RuleClauseError);
    expect(() => evaluateRules(item, { ...ctx, mapping: withRule({ when: { enrollment_min: "1000" } }) })).toThrow(RuleClauseError);
    expect(() => evaluateRules(item, { ...ctx, mapping: withRule({ when: { mesh_any: [] } }) })).toThrow(RuleClauseError);
  });

  it("`not` is honored at the top level and nested in `when`", () => {
    const nested = withRule({ when: { mesh_any: ["Cohort Studies"], not: { check_tag: ["Humans"] } } });
    const top = withRule({ when: { mesh_any: ["Cohort Studies"] }, not: { check_tag: ["Humans"] } });
    for (const m of [nested, top]) {
      expect(evaluateRules(pub({ mesh: ["Cohort Studies"] }), { ...ctx, mapping: m }).fired).toHaveLength(1);
      expect(evaluateRules(pub({ mesh: ["Cohort Studies", "Humans"] }), { ...ctx, mapping: m }).fired).toHaveLength(0);
    }
  });

  it("mesh_tree_under matches any heading under a tree prefix (no rule uses it yet)", () => {
    const m = withRule({ when: { mesh_tree_under: ["B01"] } });
    expect(evaluateRules(pub({ mesh: ["Mice"] }), { ...ctx, mapping: m }).fired).toHaveLength(1);
    expect(evaluateRules(pub({ mesh: ["Cohort Studies"] }), { ...ctx, mapping: m }).fired).toHaveLength(0);
    const major = withRule({ when: { mesh_major_any: ["Cohort Studies"] } });
    expect(evaluateRules(pub({ mesh: ["Cohort Studies"] }), { ...ctx, mapping: major }).fired).toHaveLength(0);
    expect(evaluateRules(pub({ major: ["Cohort Studies"] }), { ...ctx, mapping: major }).fired).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The six item-classifier fixtures (docs/fit-engine/prompts/item-classifier.md)
// ---------------------------------------------------------------------------

describe("item-classifier fixtures", () => {
  it("1 · RePORTER abstract, mouse T-cell exhaustion, scRNA-seq — no MeSH; the panel prior says discovery, nothing clinical", () => {
    const item = grant({
      project_title: "Transcriptional control of T cell exhaustion",
      abstract: "We use single-cell RNA sequencing of exhausted CD8 T cells in chronically infected mice …",
      study_section: "Cellular and Molecular Immunology - A Study Section",
      study_section_code: "CMIA",
      rcdc_categories: null,
    });
    const r = evaluateRules(item, ctx);
    expect(firedIds(r)).toEqual(["reporter_study_section_family"]);
    expect(dominant(r.axes, "paradigm").sort()).toEqual(["basic_discovery", "molecular_cellular_mechanistic"]);
    expect(r.axes.paradigm?.clinical_trials).toBeUndefined();
    expect(r.axes.paradigm?.clinical_observational).toBeUndefined();
    expect(r.axes.unit).toBeUndefined(); // no L3 from rules; unit, design and materials are the model's
    expect(r.firedAxes).toEqual(["paradigm"]);
  });

  it("2 · biosketch contribution, two phase II SLE trials — prose only: nothing fires, every axis is the model's", () => {
    const [item] = normalizeBiosketch({
      investigator_id: INV,
      contributions: [{ title: "Clinical trials in lupus", summary: "I led two multicenter phase II randomized trials of anifrolumab in SLE." }],
    });
    const r = evaluateRules(item!, ctx);
    expect(r.fired).toEqual([]);
    expect(r.firedAxes).toEqual([]);
  });

  it("3 · EHR-based retrospective cohort of statin adherence and MI incidence", () => {
    const item = pub({
      mesh: ["Humans", "Retrospective Studies", "Electronic Health Records", "Cohort Studies", "Incidence", "Risk Factors", "Middle Aged"],
      pubtypes: [],
    });
    const r = evaluateRules(item, ctx);
    expect(firedIds(r)).toEqual(["mesh_cohort_epi", "mesh_retrospective", "mesh_rwd"]);
    expect(dominant(r.axes, "paradigm")).toEqual(["epidemiology"]);
    expect(r.axes.paradigm?.epidemiology).toBeCloseTo(1 - 0.15 * 0.6 * 0.5, 10);
    expect(r.axes.paradigm?.health_services).toBeCloseTo(0.7, 10);
    expect(r.axes.paradigm?.clinical_trials).toBeUndefined();
    expect(dominant(r.axes, "unit")).toEqual(["L4"]);
    expect(dominant(r.axes, "design")).toEqual(["retrospective_cohort"]);
    expect(r.axes.design?.ehr_analysis).toBeCloseTo(0.8, 10);
    expect(dominant(r.axes, "materials").sort()).toEqual(["cohort_biobank_datasets", "ehr"]);
  });

  it("4 · hybrid type 2 effectiveness-implementation trial of a DPP in FQHCs", () => {
    const item = pub({
      mesh: ["Humans", "Implementation Science", "Delivery of Health Care", "Health Promotion"],
      pubtypes: ["Randomized Controlled Trial", "Pragmatic Clinical Trial"],
    });
    const r = evaluateRules(item, ctx);
    expect(firedIds(r)).toEqual(["pt_rct", "pt_pragmatic", "mesh_hsr", "mesh_implementation", "mesh_behavioral"]);
    expect(r.axes.paradigm?.implementation_science).toBeCloseTo(1 - 0.6 * 0.05, 10);
    expect(r.axes.paradigm?.implementation_science).toBeGreaterThanOrEqual(0.7);
    // L5 from pragmatic + HSR + implementation (.98); L3 rides in beside it from the RCT / pragmatic publication types and Health Promotion (.984)
    expect(r.axes.unit?.L5).toBeCloseTo(1 - 0.5 * 0.2 * 0.2, 10);
    expect(r.axes.unit?.L3).toBeCloseTo(1 - 0.1 * 0.4 * 0.4, 10);
    expect(r.axes.unit?.L4).toBeUndefined();
    expect(r.axes.design?.hybrid_effectiveness_implementation).toBeCloseTo(0.5, 10);
    expect(r.axes.design?.pragmatic_trial).toBeCloseTo(0.95, 10);
    expect(r.axes.design?.implementation_evaluation).toBeCloseTo(0.8, 10);
  });

  it("5 · polygenic risk methods evaluated in UK Biobank, no disease focus", () => {
    const item = pub({
      mesh: ["Humans", "Genome-Wide Association Study", "Polymorphism, Single Nucleotide", "Models, Statistical", "Biological Specimen Banks", "Cohort Studies"],
    });
    const r = evaluateRules(item, ctx);
    // Cohort Studies keeps human_biospecimen (Biological Specimen Banks) out via its `not`
    expect(firedIds(r)).toEqual(["mesh_gwas", "mesh_computational"]);
    expect(dominant(r.axes, "paradigm")).toEqual(["genetic_epidemiology"]);
    expect(r.axes.paradigm?.computational_data_science).toBeCloseTo(0.8, 10);
    expect(dominant(r.axes, "unit")).toEqual(["L4"]);
    expect(dominant(r.axes, "design")).toEqual(["gwas"]);
    expect(dominant(r.axes, "materials")).toEqual(["genomic_datasets"]);
    expect(r.axes.paradigm?.human_biospecimen).toBeUndefined();
  });

  it("6 · TCR signaling in primary human T cells from healthy donors with CRISPR", () => {
    const item = pub({ mesh: ["Humans", "CRISPR-Cas Systems", "Signal Transduction", "Primary Cell Culture", "Gene Knockdown Techniques"] });
    const r = evaluateRules(item, ctx);
    expect(firedIds(r)).toEqual(["mesh_mechanism", "human_biospecimen", "mesh_primary_human_cells", "triangle_animal_human"]);
    // mechanistic .85; translational ties it at .85 = 1 − .5 (biospecimen) × .3 (Signal Transduction is G04 → class CH, the cell–human bridge)
    expect(dominant(r.axes, "paradigm").sort()).toEqual(["molecular_cellular_mechanistic", "translational"]);
    expect(r.axes.paradigm?.molecular_cellular_mechanistic).toBeCloseTo(0.85, 10);
    expect(r.axes.paradigm?.translational).toBeCloseTo(1 - 0.5 * 0.3, 10);
    expect(r.axes.paradigm?.human_biospecimen).toBeGreaterThanOrEqual(0.4);
    expect(r.axes.unit?.L1).toBeGreaterThanOrEqual(0.8);
    expect(dominant(r.axes, "unit")).toEqual(["L1"]);
    expect(r.axes.design?.perturbation).toBeCloseTo(0.7, 10);
    expect(r.axes.paradigm?.clinical_trials).toBeUndefined();
    expect(r.axes.unit?.L4).toBeUndefined();
    // D18: mesh_primary_human_cells (Humans + Primary Cell Culture) supplies human_primary_cells; human_biospecimen still adds tissue / blood
    expect(r.axes.materials?.human_primary_cells).toBeCloseTo(0.8, 10);
  });
});

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

describe("mesh_primary_human_cells (D18)", () => {
  ruleTest("mesh_primary_human_cells", () => {
    const item = pub({ mesh: ["Humans", "Primary Cell Culture", "Signal Transduction"] });
    const r = evaluateRules(item, ctx);
    expect(firedIds(r)).toContain("mesh_primary_human_cells");
    expect(r.axes.materials?.human_primary_cells).toBeCloseTo(0.8, 5);
    expect(r.axes.unit?.L1).toBeGreaterThanOrEqual(0.8);
    const animal = pub({ mesh: ["Mice", "Primary Cell Culture"] });
    expect(firedIds(evaluateRules(animal, ctx))).not.toContain("mesh_primary_human_cells");
  });
});

describe("coverage", () => {
  it("every rule id in signal-mapping.json has a test above", () => {
    expect([...tested].sort()).toEqual([...RULE_IDS].sort());
    expect(RULE_IDS).toHaveLength(70);
  });

  it("every rule id is unique and assigns in exactly one way", () => {
    expect(new Set(RULE_IDS).size).toBe(RULE_IDS.length);
    for (const rule of mapping.rules) {
      const ways = [rule.assign, rule.assign_from_table, rule.assign_notice, rule.assign_from_self_declared].filter(Boolean);
      expect(ways, rule.id).toHaveLength(1);
    }
  });
});
