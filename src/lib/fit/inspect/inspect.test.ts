import { describe, expect, it } from "vitest";
import { countByKind, EMPTY_LOOKUP, evidenceKeys, parseEvidenceId, resolveEvidenceId, type EvidenceLookup } from "@/lib/fit/inspect/evidence";
import { axisReasonOf, FLAG_REASON_MAX, flagRow, flagView, parseAxisReason, parseFlagInput, sortFlags, type FitLabelRow } from "@/lib/fit/inspect/flags";
import { confidenceSummary, flagCounts, investigatorIndexRows, opportunityIndexRows } from "@/lib/fit/inspect/index-view";
import { investigatorProfileView } from "@/lib/fit/inspect/investigator-view";
import { axisLabel, categoryDisplay, dominantSafe, familyLabelSafe, humanize, INSPECT_AXES, isCategoryOf, sortedWeights } from "@/lib/fit/inspect/labels";
import { allQuotes, entryMarker, exemplarAdded, opportunityProfileView, overlayLabel, overlayOrigins, quoteFor } from "@/lib/fit/inspect/opportunity-view";
import type { StoredProfileRow } from "@/lib/fit/profile/investigator";
import type { OpportunityFitProfileRow, ProfileSources } from "@/lib/fit/profile/opportunity";
import { TAXONOMY_VERSION, thinEvidence } from "@/lib/fit/taxonomy";
import type { InvestigatorFitProfile, OpportunityFitProfile } from "@/lib/fit/types";

const INV = "04e59cf5-600a-462c-91bc-b2b97f122c3d";
const GRANT = "a6a236fa-fe28-4d65-ad64-fa9e6a64aeb0";
const OPP = "710a95dc-223f-4dd4-a76a-4bd686f2463f";

// A realistic stored profile: the shape the 1.4 builder writes (weights to 4 decimals, provenance top-3 career view).
function investigatorProfile(overrides: Partial<InvestigatorFitProfile> = {}): InvestigatorFitProfile {
  return {
    investigator_id: INV,
    taxonomy_version: TAXONOMY_VERSION,
    computed_at: "2026-09-06T03:24:28.931+00:00",
    confidence: { paradigm: "medium", unit: "medium", design: "low", materials: "low", objective: "low", topic: "medium" },
    paradigm: {
      career: { molecular_cellular_mechanistic: 0.7016, translational: 0.6937, preclinical: 0.3937, animal_model: 0.368, basic_discovery: 0.339, clinical_trials: 0.0364 },
      recent: { translational: 0.7412, molecular_cellular_mechanistic: 0.6, preclinical: 0.4126, human_biospecimen: 0.2 },
    },
    unit: { L1: 0.8645, L2: 0.4961, L3: 0.3416 },
    design: { wet_lab_experiment: 0.8099, perturbation: 0.6963, animal_in_vivo: 0.4352, xenograft_pdx: 0.2697 },
    materials: { animal_mouse: 0.567, cell_lines: 0.5627, human_primary_cells: 0.3362 },
    objective: { mechanism_discovery: 0.6979, therapeutic_development: 0.6169 },
    topic: { mesh_major: ["C20.111.590"], rcdc: ["Cancer", "Immunotherapy"], free_text: null },
    characteristics: { career_stage: null, esi: false, esi_eligible_until: null, mechanisms_held: ["DP2", "R01", "U54"], active_awards: 3, clinical_role: null, trial_pi_count: 0, degrees: [], title_series: null },
    aspirations: ["implementation_science"],
    do_not_suggest: ["population"],
    evidence_summary: { publications_verified: 52, grants: 5, trials: 0, trials_as_pi: 0, biosketch: "not_requested", self_declared: false },
    provenance: [
      { axis: "paradigm", category: "molecular_cellular_mechanistic", top_items: [`publication:${INV}:41648153`, `publication:${INV}:39542025`, `grant:${GRANT}`] },
      { axis: "paradigm", category: "translational", top_items: [`publication:${INV}:41648153`, `profiles:${INV}`] },
      { axis: "paradigm", category: "clinical_trials", top_items: [`trial:${INV}:NCT01234567`] },
      { axis: "unit", category: "L1", top_items: [`publication:${INV}:41648153`, `publication:${INV}:39542025`, `publication:${INV}:38326614`] },
      { axis: "design", category: "wet_lab_experiment", top_items: [`publication:${INV}:39542025`] },
      { axis: "materials", category: "animal_mouse", top_items: [`grant:${GRANT}`, `directory:${INV}`] },
      { axis: "objective", category: "mechanism_discovery", top_items: [`biosketch:${INV}:statement`, `self_declared:${INV}`] },
    ],
    collaborators: [{ id: "11111111-1111-4111-8111-111111111111", name: "A. Colleague", dominant_family: "clinical", categories: ["clinical_trials"] }],
    ...overrides,
  };
}

function storedRow(profile = investigatorProfile(), extra: Partial<StoredProfileRow> = {}): StoredProfileRow {
  return { investigator_id: profile.investigator_id, taxonomy_version: profile.taxonomy_version, profile, confidence: profile.confidence, item_count: 60, pending_items: 0, computed_at: profile.computed_at, ...extra };
}

const lookup: EvidenceLookup = {
  publications: new Map([
    ["41648153", { pmid: "41648153", title: "Synthetic Hybrid Receptors for Safer and Programmable T Cell Therapy.", journal: "bioRxiv", publication_date: "2026-01-23" }],
    ["39542025", { pmid: "39542025", title: "Engineered receptors for soluble cellular communication and disease sensing.", journal: "Nature", publication_date: "2025-02-01" }],
  ]),
  grants: new Map([[GRANT, { id: GRANT, project_num: "5R01AI123456-03", project_title: "Receptor engineering", fiscal_year: 2025, activity_code: "R01" }]]),
  trials: new Map([["NCT01234567", { nct_id: "NCT01234567", title: "A phase 1 trial", start_date: "2024-05-01" }]]),
};

describe("labels", () => {
  it("names every inspector axis and knows the six", () => {
    expect(INSPECT_AXES).toEqual(["paradigm", "unit", "design", "materials", "objective", "topic"]);
    expect(axisLabel("paradigm")).toBe("Paradigm");
    expect(axisLabel("topic")).toBe("Topic");
    expect(axisLabel("bogus")).toBe("bogus");
  });

  it("labels paradigm categories through the taxonomy with their family", () => {
    const d = categoryDisplay("paradigm", "molecular_cellular_mechanistic");
    expect(d.known).toBe(true);
    expect(d.label).not.toBe("molecular_cellular_mechanistic");
    expect(d.group).toBe("Discovery");
  });

  it("labels unit levels with the level label and designs / materials with their group", () => {
    expect(categoryDisplay("unit", "L1")).toMatchObject({ known: true, label: "L1 · molecular–cellular" });
    expect(categoryDisplay("design", "hybrid_effectiveness_implementation")).toMatchObject({ known: true, label: "Hybrid effectiveness–implementation trial" });
    expect(categoryDisplay("design", "rct").group).toBeTruthy();
    expect(categoryDisplay("materials", "enrolled_participants")).toMatchObject({ known: true, label: "Enrolled participants" });
    expect(categoryDisplay("materials", "animal_mouse")).toMatchObject({ known: true, label: "Mouse", group: "Non-human materials" });
    expect(categoryDisplay("objective", "mechanism_discovery")).toMatchObject({ known: true, label: "Mechanism discovery", group: null });
  });

  it("never throws on an unknown id or axis — it humanizes and marks known: false", () => {
    expect(categoryDisplay("paradigm", "not_a_category")).toEqual({ id: "not_a_category", label: "Not a category", group: null, known: false });
    expect(categoryDisplay("unit", "rct").known).toBe(false);
    expect(categoryDisplay("topic", "anything").known).toBe(false);
    expect(isCategoryOf("design", "rct")).toBe(true);
    expect(isCategoryOf("design", "clinical_trials")).toBe(false);
    expect(familyLabelSafe("clinical")).toBe("Clinical");
    expect(familyLabelSafe("weird_family")).toBe("Weird family");
    expect(humanize("")).toBe("");
  });

  it("dominantSafe on a stale id: familyId null, family —, never a throw", () => {
    expect(dominantSafe({ retired: 0.5 })).toEqual({ id: "retired", label: "Retired", familyId: null, family: "—", weight: 0.5 });
    expect(dominantSafe({ clinical_trials: 0.4, retired: 0.5 })!.familyId).toBeNull();
    expect(dominantSafe({ clinical_trials: 0.4 })).toMatchObject({ familyId: "clinical", family: "Clinical" });
    expect(dominantSafe({})).toBeNull();
    expect(dominantSafe(undefined)).toBeNull();
  });

  it("sorts weights largest first, ties by id, dropping zeros and junk", () => {
    expect(sortedWeights({ b: 0.5, a: 0.5, c: 0.9, z: 0, n: Number.NaN, s: "x" as unknown as number })).toEqual([
      { id: "c", weight: 0.9 },
      { id: "a", weight: 0.5 },
      { id: "b", weight: 0.5 },
    ]);
    expect(sortedWeights(null)).toEqual([]);
  });
});

describe("evidence ids", () => {
  it("parses every id shape collectEvidence produces", () => {
    expect(parseEvidenceId(`publication:${INV}:41648153`)).toEqual({ kind: "publication", investigatorId: INV, pmid: "41648153" });
    expect(parseEvidenceId(`grant:${GRANT}`)).toEqual({ kind: "grant", rowId: GRANT });
    expect(parseEvidenceId(`trial:${INV}:NCT01234567`)).toEqual({ kind: "trial", investigatorId: INV, nctId: "NCT01234567" });
    expect(parseEvidenceId(`biosketch:${INV}:contribution:2`)).toEqual({ kind: "biosketch", investigatorId: INV, part: "contribution:2" });
    expect(parseEvidenceId(`biosketch:${INV}`)).toEqual({ kind: "biosketch", investigatorId: INV, part: null });
    expect(parseEvidenceId(`profiles:${INV}`)).toEqual({ kind: "profiles", investigatorId: INV });
    expect(parseEvidenceId(`directory:${INV}`)).toEqual({ kind: "directory", investigatorId: INV });
    expect(parseEvidenceId(`self_declared:${INV}`)).toEqual({ kind: "self_declared", investigatorId: INV });
    expect(parseEvidenceId(`aspiration:${INV}:1`)).toEqual({ kind: "aspiration", investigatorId: INV, n: "1" });
    expect(parseEvidenceId("publication:only-two")).toEqual({ kind: "unknown" });
    expect(parseEvidenceId("")).toEqual({ kind: "unknown" });
  });

  it("resolves publications, grants and trials to titles with links, and keeps the identifier when the row is missing", () => {
    const pub = resolveEvidenceId(`publication:${INV}:39542025`, lookup);
    expect(pub).toMatchObject({ kind: "publication", title: "Engineered receptors for soluble cellular communication and disease sensing.", meta: "Nature · 2025", href: "https://pubmed.ncbi.nlm.nih.gov/39542025/", resolved: true, prior: false });
    const missing = resolveEvidenceId(`publication:${INV}:99999999`, lookup);
    expect(missing).toMatchObject({ title: "PMID 99999999", resolved: false, href: "https://pubmed.ncbi.nlm.nih.gov/99999999/" });
    const grant = resolveEvidenceId(`grant:${GRANT}`, lookup);
    expect(grant).toMatchObject({ kind: "grant", title: "Receptor engineering", meta: "5R01AI123456-03 · FY2025 · R01", href: null, resolved: true });
    expect(resolveEvidenceId("grant:nope", lookup)).toMatchObject({ title: "Grant nope", resolved: false });
    const trial = resolveEvidenceId(`trial:${INV}:NCT01234567`, lookup);
    expect(trial).toMatchObject({ kind: "trial", title: "A phase 1 trial", meta: "NCT01234567 · started 2024", href: "https://clinicaltrials.gov/study/NCT01234567", resolved: true });
    expect(resolveEvidenceId(`trial:${INV}:NCT0`, EMPTY_LOOKUP)).toMatchObject({ title: "NCT0", resolved: false });
  });

  it("names biosketch, Profiles, self-declared and directory items by kind and marks the priors", () => {
    expect(resolveEvidenceId(`biosketch:${INV}:statement`, EMPTY_LOOKUP)).toMatchObject({ kind: "biosketch", title: "Biosketch personal statement", prior: false });
    expect(resolveEvidenceId(`biosketch:${INV}:contribution:3`, EMPTY_LOOKUP).title).toBe("Biosketch contribution 3");
    expect(resolveEvidenceId(`profiles:${INV}`, EMPTY_LOOKUP)).toMatchObject({ kind: "profiles", prior: true });
    expect(resolveEvidenceId(`directory:${INV}`, EMPTY_LOOKUP)).toMatchObject({ kind: "directory", prior: true });
    expect(resolveEvidenceId(`self_declared:${INV}`, EMPTY_LOOKUP)).toMatchObject({ kind: "self_declared", prior: false, title: "Self-declared research axes" });
    expect(resolveEvidenceId(`aspiration:${INV}:2`, EMPTY_LOOKUP).title).toBe("Aspiration line 2");
    expect(resolveEvidenceId("mystery", EMPTY_LOOKUP)).toMatchObject({ kind: "unknown", title: "mystery", resolved: false });
  });

  it("collects the keys a page has to look up and counts ids by kind", () => {
    const ids = [`publication:${INV}:1`, `publication:${INV}:1`, `publication:${INV}:2`, `grant:${GRANT}`, `trial:${INV}:NCT1`, `profiles:${INV}`];
    expect(evidenceKeys(ids)).toEqual({ pmids: ["1", "2"], grantIds: [GRANT], nctIds: ["NCT1"] });
    expect(countByKind(new Set(ids))).toEqual([
      { kind: "publication", label: "Publication", count: 2 },
      { kind: "grant", label: "NIH grant", count: 1 },
      { kind: "profiles", label: "UCSF Profiles", count: 1 },
      { kind: "trial", label: "Clinical trial", count: 1 },
    ]);
  });
});

describe("investigatorProfileView", () => {
  it("orders every axis by career weight with display labels and puts recent beside career on the paradigm", () => {
    const v = investigatorProfileView(storedRow(), lookup);
    const paradigm = v.axes.find((a) => a.axis === "paradigm")!;
    expect(paradigm.rows.map((r) => r.id)).toEqual(["molecular_cellular_mechanistic", "translational", "preclinical", "animal_model", "basic_discovery", "clinical_trials", "human_biospecimen"]);
    expect(paradigm.rows[0]).toMatchObject({ weight: 0.7016, recent: 0.6, group: "Discovery" });
    expect(paradigm.rows[0]!.label).not.toBe("molecular_cellular_mechanistic");
    // A recent-only category is listed with career 0.
    expect(paradigm.rows.find((r) => r.id === "human_biospecimen")).toMatchObject({ weight: 0, recent: 0.2 });
    const unit = v.axes.find((a) => a.axis === "unit")!;
    expect(unit.rows.map((r) => r.id)).toEqual(["L1", "L2", "L3"]);
    expect(unit.rows[0]!.recent).toBeNull();
    expect(unit.rows[0]!.label).toBe("L1 · molecular–cellular");
    expect(v.axes.map((a) => a.axis)).toEqual(["paradigm", "unit", "design", "materials", "objective"]);
    expect(v.dominant.career).toMatchObject({ id: "molecular_cellular_mechanistic", family: "Discovery", weight: 0.7016, known: true });
    expect(v.dominant.recent).toMatchObject({ id: "translational", weight: 0.7412, known: true });
  });

  it("carries the confidence badge per axis and the header facts", () => {
    const v = investigatorProfileView(storedRow(), lookup);
    expect(v.confidenceRows).toEqual([
      { axis: "paradigm", label: "Paradigm", confidence: "medium" },
      { axis: "unit", label: "Unit of analysis", confidence: "medium" },
      { axis: "design", label: "Study design", confidence: "low" },
      { axis: "materials", label: "Materials and data", confidence: "low" },
      { axis: "objective", label: "Scientific objective", confidence: "low" },
      { axis: "topic", label: "Topic", confidence: "medium" },
    ]);
    expect(v.axes.find((a) => a.axis === "design")!.confidence).toBe("low");
    expect(v).toMatchObject({ item_count: 60, pending_items: 0, partial: null, taxonomy_version: TAXONOMY_VERSION, computed_at: "2026-09-06T03:24:28.931+00:00" });
    expect(v.topic).toEqual({ mesh_major: ["C20.111.590"], rcdc: ["Cancer", "Immunotherapy"], free_text: null, confidence: "medium" });
  });

  it("resolves the per-category top evidence from provenance and flags thin categories", () => {
    const v = investigatorProfileView(storedRow(), lookup);
    const paradigm = v.axes.find((a) => a.axis === "paradigm")!;
    const mcm = paradigm.rows.find((r) => r.id === "molecular_cellular_mechanistic")!;
    expect(mcm.evidence.map((e) => e.title)).toEqual([
      "Synthetic Hybrid Receptors for Safer and Programmable T Cell Therapy.",
      "Engineered receptors for soluble cellular communication and disease sensing.",
      "Receptor engineering",
    ]);
    expect(mcm.thin).toBe(thinEvidence().min_items > 3);
    const translational = paradigm.rows.find((r) => r.id === "translational")!;
    expect(translational.evidence.map((e) => e.prior)).toEqual([false, true]);
    expect(translational.thin).toBe(1 < thinEvidence().min_items);
    const ct = paradigm.rows.find((r) => r.id === "clinical_trials")!;
    expect(ct.evidence[0]).toMatchObject({ kind: "trial", title: "A phase 1 trial" });
    // A category with no provenance entry renders with an empty list, not a crash.
    expect(paradigm.rows.find((r) => r.id === "preclinical")!.evidence).toEqual([]);
    const objective = v.axes.find((a) => a.axis === "objective")!;
    expect(objective.rows[0]!.evidence.map((e) => e.kind)).toEqual(["biosketch", "self_declared"]);
  });

  it("shows the partial-profile banner with the pending count when pending_items > 0", () => {
    const v = investigatorProfileView(storedRow(investigatorProfile(), { pending_items: 4, item_count: 179 }), lookup);
    expect(v.pending_items).toBe(4);
    expect(v.partial).not.toBeNull();
    expect(v.partial!.pending_items).toBe(4);
    expect(v.partial!.message).toContain("4 evidence items pending (179 aggregated)");
    expect(v.partial!.message).toContain("lower bound");
    const one = investigatorProfileView(storedRow(investigatorProfile(), { pending_items: 1 }), lookup);
    expect(one.partial!.message).toContain("1 evidence item pending (60 aggregated)");
    expect(investigatorProfileView(storedRow(), lookup).partial).toBeNull();
  });

  it("summarizes evidence by source and lists characteristics, aspirations, do_not_suggest and collaborators with labels", () => {
    const v = investigatorProfileView(storedRow(), lookup);
    expect(v.evidence.summary).toEqual([
      { label: "Verified publications", value: "52" },
      { label: "NIH grants (not rejected)", value: "5" },
      { label: "Clinical trials", value: "0" },
      { label: "Biosketch", value: "not requested" },
      { label: "Self-declared axes", value: "no" },
      { label: "Items aggregated", value: "60" },
    ]);
    expect(v.evidence.byKind.map((b) => [b.kind, b.count])).toEqual([
      ["publication", 3],
      ["biosketch", 1],
      ["directory", 1],
      ["grant", 1],
      ["profiles", 1],
      ["self_declared", 1],
      ["trial", 1],
    ]);
    expect(v.evidence.distinctIds).toBe(9);
    expect(v.characteristics.find((c) => c.label === "Mechanisms held")!.value).toBe("DP2, R01, U54");
    expect(v.characteristics.find((c) => c.label === "ESI")!.value).toBe("no");
    expect(v.characteristics.find((c) => c.label === "Career stage")!.value).toBe("—");
    expect(v.aspirations).toEqual([{ id: "implementation_science", label: categoryDisplay("paradigm", "implementation_science").label }]);
    expect(v.do_not_suggest).toEqual([{ id: "population", label: "Population" }]);
    expect(v.collaborators[0]).toMatchObject({ name: "A. Colleague", family: "Clinical", categories: [categoryDisplay("paradigm", "clinical_trials").label] });
  });

  it("is robust to a sparse row: missing optional fields and an unknown category id", () => {
    const sparse = {
      investigator_id: INV,
      taxonomy_version: "fit-v0",
      profile: { investigator_id: INV, taxonomy_version: "fit-v0", computed_at: "2026-01-01T00:00:00Z", paradigm: { career: { retired_category: 0.5 }, recent: {} } } as unknown as InvestigatorFitProfile,
      confidence: {} as InvestigatorFitProfile["confidence"],
      item_count: 0,
      pending_items: 0,
      computed_at: "2026-01-01T00:00:00Z",
    } satisfies StoredProfileRow;
    const v = investigatorProfileView(sparse);
    expect(v.axes.find((a) => a.axis === "paradigm")!.rows[0]).toMatchObject({ id: "retired_category", label: "Retired category", known: false, evidence: [] });
    expect(v.confidenceRows.every((r) => r.confidence === "low")).toBe(true);
    expect(v.dominant.career).toEqual({ id: "retired_category", label: "Retired category", family: "—", weight: 0.5, known: false });
    expect(v.dominant.recent).toBeNull();
    expect(v.evidence.summary[0]!.value).toBe("0");
    expect(v.aspirations).toEqual([]);
    expect(v.collaborators).toEqual([]);
    expect(v.topic.rcdc).toEqual([]);
  });
});

// A realistic stored opportunity row: PA-24-181's shape from the first real build.
function opportunityProfile(overrides: Partial<OpportunityFitProfile> = {}): OpportunityFitProfile {
  return {
    opportunity_id: OPP,
    number: "PA-24-181",
    taxonomy_version: TAXONOMY_VERSION,
    computed_at: "2026-09-06T03:26:17.516+00:00",
    confidence: "high",
    mechanism: { activity_code: "K08", clinical_trial: "required", besh: false, ceiling_direct_per_year: null, period_years: 5, issuing_ic: null, program_division: null },
    paradigm: {
      required: { clinical_trials: 1 },
      required_any: { early_phase_human_experimental: 0.9, human_biospecimen: 0.8 },
      allowed: { translational: 0.6, molecular_cellular_mechanistic: 0.6, behavioral: 0.027 },
      excluded: { epidemiology: 0.9 },
    },
    unit: { required: ["L3"], required_any: [], allowed: ["L1"] },
    design: { required_any: ["rct", "early_phase_trial", "pragmatic_trial"], required_any_2: [], allowed: ["wet_lab_experiment"], prohibited: ["ehr_analysis"] },
    materials: { expected: ["digital_wearable"], required: ["enrolled_participants"], required_any: [], human_required: true },
    population: "adults with type 2 diabetes",
    objective: { implementation_dissemination: 0.133, outcomes_quality: 0.111 },
    topic: { mesh: [], rcdc: ["Clinical Research", "Pediatric"], terms: ["hybrid trial", "beta cell"], free_text: "Purpose text." },
    eligibility: { investigator_rules: ["Candidates for the K08 award must have a clinical doctoral degree."], esi_only: false, new_investigator_only: false, clinician_required: true, degree_required: "MD", independent_appointment_required: false, citizenship_rule: "US citizen or permanent resident" },
    team: { multi_pi_allowed: null, consortium_required: false, required_partners: [] },
    non_responsive: ["Mechanistic studies, including mechanistic clinical trials are not responsive"],
    provenance: {
      "paradigm.required": { section: "Part 2 · Section I · Research Objectives", quote: "Applications must propose a clinical trial." },
      "paradigm.required_any": { section: "Part 2 · Section I · Research Objectives", quote: "Either early-phase experimental studies or biospecimen studies." },
      "paradigm.excluded.epidemiology": { section: "Part 2 · Section I · Non-Responsive", quote: "Epidemiologic studies are not responsive." },
      "design.required_any": { section: "Part 2 · Section IV · Clinical Trial", quote: "A randomized or early-phase design is required." },
      "materials.required": { section: "Part 2 · Section I", quote: "Enrolled participants." },
      "eligibility.clinician_required": { section: "Part 2 · Section III · Eligible Individuals", quote: "must have a clinical doctoral degree" },
      clinical_trial_text: { section: "Part 2 · Section II · Clinical Trial?", quote: "Required: Only accepting applications that propose clinical trial(s)." },
      "mechanism.period_years": { section: "Part 2 · Section II · Award Project Period", quote: "up to 5 years" },
    },
    sources: { text: "full_text", exemplar_count: 9 },
    needs_review: true,
    ...overrides,
  };
}

function sources(overrides: Partial<ProfileSources> = {}): ProfileSources {
  return {
    text: "full_text",
    guide_source: "grants_nih_gov",
    sections: 22,
    chars: 18493,
    exemplar_count: 9,
    exemplars_classified: 9,
    exemplars_informative: 9,
    exemplar_model_calls: 0,
    blend: { exemplar: 0.4, text: 0.6, n: 9 },
    extract_model: "gpt-4o",
    complete: true,
    incomplete: [],
    groups: [
      { group: 1, chunk: 1, of: 1, chars: 5870, cache: "miss", model_called: true, skipped: null, usable: true, dropped: ["paradigm.allowed.molecular_cellular_mechanistic: no verified quote"] },
      { group: 2, chunk: 1, of: 1, chars: 2400, cache: "hit", model_called: false, skipped: null, usable: true, dropped: [] },
      { group: 3, chunk: 1, of: 2, chars: 30000, cache: "miss", model_called: false, skipped: "time budget", usable: null, dropped: [] },
    ],
    overlays_applied: ["notice_ct_required → clinical_trial_designation.required", "notice_activity_code → activity_code_priors.K08"],
    overlay_notes: [],
    overrides_applied: [],
    merge_log: ["clinical_trials: in paradigm.required, dropped from paradigm.required_any"],
    blend_log: [],
    ...overrides,
  };
}

function opportunityRow(profile = opportunityProfile(), src = sources(), extra: Partial<OpportunityFitProfileRow> = {}): OpportunityFitProfileRow {
  return { opportunity_id: profile.opportunity_id, taxonomy_version: profile.taxonomy_version, profile, confidence: profile.confidence, sources: src, guide_html_hash: "0687f31f0000", computed_at: profile.computed_at, ...extra };
}

describe("opportunityProfileView", () => {
  it("renders required / required_any / allowed / excluded per axis with labels, weights and the quote on the path or its ancestor", () => {
    const v = opportunityProfileView(opportunityRow());
    const paradigm = v.axes.find((a) => a.axis === "paradigm")!;
    expect(paradigm.lists.map((l) => l.label)).toEqual(["Required", "Required — any of", "Allowed", "Excluded"]);
    const [required, requiredAny, allowed, excluded] = paradigm.lists;
    expect(required!.entries).toHaveLength(1);
    expect(required!.entries[0]).toMatchObject({ id: "clinical_trials", weight: 1, group: "Clinical", quote: { field: "paradigm.required", quote: "Applications must propose a clinical trial." } });
    // required_any: weights sorted, the set-level quote attached to each member.
    expect(requiredAny!.entries.map((e) => [e.id, e.weight])).toEqual([
      ["early_phase_human_experimental", 0.9],
      ["human_biospecimen", 0.8],
    ]);
    expect(requiredAny!.entries.every((e) => e.quote?.field === "paradigm.required_any")).toBe(true);
    expect(requiredAny!.semantics).toContain("max");
    expect(allowed!.entries.map((e) => e.id)).toEqual(["molecular_cellular_mechanistic", "translational", "behavioral"]);
    expect(allowed!.entries[0]!.quote).toBeNull();
    expect(excluded!.entries[0]).toMatchObject({ id: "epidemiology", quote: { field: "paradigm.excluded.epidemiology" } });
    expect(paradigm.categories.map((c) => c.id)).toEqual(["clinical_trials", "early_phase_human_experimental", "human_biospecimen", "molecular_cellular_mechanistic", "translational", "behavioral", "epidemiology"]);
  });

  it("renders the list axes — unit, design prohibited, materials expected and human_required — and the objective weights", () => {
    const v = opportunityProfileView(opportunityRow());
    const unit = v.axes.find((a) => a.axis === "unit")!;
    expect(unit.lists.map((l) => [l.label, l.entries.map((e) => e.label)])).toEqual([
      ["Required (all of)", ["L3 · human individual"]],
      ["Required — any of", []],
      ["Allowed", ["L1 · molecular–cellular"]],
    ]);
    const design = v.axes.find((a) => a.axis === "design")!;
    const requiredAny = design.lists.find((l) => l.path === "design.required_any")!;
    expect(requiredAny.entries.map((e) => e.label)).toEqual(["Randomized controlled trial", "Early-phase trial", "Pragmatic trial"]);
    expect(requiredAny.entries[0]!.quote?.field).toBe("design.required_any");
    expect(design.lists.find((l) => l.path === "design.prohibited")!.entries[0]).toMatchObject({ id: "ehr_analysis", weight: null });
    const materials = v.axes.find((a) => a.axis === "materials")!;
    expect(materials.human_required).toBe(true);
    expect(materials.lists.find((l) => l.path === "materials.expected")!.entries[0]!.id).toBe("digital_wearable");
    expect(materials.lists.find((l) => l.path === "materials.required")!.entries[0]!.quote?.quote).toBe("Enrolled participants.");
    const objective = v.axes.find((a) => a.axis === "objective")!;
    expect(objective.lists[0]!.entries.map((e) => [e.id, e.weight])).toEqual([
      ["implementation_dissemination", 0.133],
      ["outcomes_quality", 0.111],
    ]);
  });

  it("carries mechanism, eligibility, team, population, topic, non-responsive items, needs_review and every quote with its section", () => {
    const v = opportunityProfileView(opportunityRow());
    expect(v).toMatchObject({ number: "PA-24-181", confidence: "high", needs_review: true, population: "adults with type 2 diabetes", partial: null });
    expect(v.mechanism.find((f) => f.label === "Clinical trial designation")).toMatchObject({ value: "required", quote: { field: "clinical_trial_text" } });
    expect(v.mechanism.find((f) => f.label === "Period (years)")).toMatchObject({ value: "5", quote: { quote: "up to 5 years" } });
    expect(v.mechanism.find((f) => f.label === "Ceiling (direct, per year)")!.value).toBe("—");
    expect(v.eligibility.find((f) => f.label === "Clinician required")).toMatchObject({ value: "yes", quote: { section: "Part 2 · Section III · Eligible Individuals" } });
    expect(v.eligibility.find((f) => f.label === "Investigator rules (verbatim)")!.value).toContain("clinical doctoral degree");
    expect(v.team.find((f) => f.label === "Multi-PI allowed")!.value).toBe("not stated");
    expect(v.team.find((f) => f.label === "Consortium required")!.value).toBe("no");
    expect(v.topic).toEqual({ terms: ["hybrid trial", "beta cell"], rcdc: ["Clinical Research", "Pediatric"], mesh: [], free_text: "Purpose text." });
    expect(v.non_responsive).toHaveLength(1);
    expect(v.quotes.map((q) => q.field)).toEqual(["clinical_trial_text", "design.required_any", "eligibility.clinician_required", "materials.required", "mechanism.period_years", "paradigm.excluded.epidemiology", "paradigm.required", "paradigm.required_any"]);
    expect(v.quotes.find((q) => q.field === "design.required_any")!.section).toBe("Part 2 · Section IV · Clinical Trial");
  });

  it("shows the sources: text, exemplar counts, blend weights, extractor model, the per-group log, overlays and merge log", () => {
    const v = opportunityProfileView(opportunityRow());
    expect(v.sources.facts).toEqual([
      { label: "Text read", value: "full text" },
      { label: "Guide source", value: "grants_nih_gov" },
      { label: "Sections · characters", value: "22 · 18,493" },
      { label: "Exemplars (rows · classified · informative)", value: "9 · 9 · 9" },
      { label: "Blend (text · exemplar, n)", value: "0.6 · 0.4 (n = 9)" },
      { label: "Extractor model", value: "gpt-4o" },
      { label: "Exemplar model calls", value: "0" },
      { label: "Guide page hash", value: "0687f31f0000" },
    ]);
    expect(v.sources.complete).toBe(true);
    expect(v.sources.groups.map((g) => g.label)).toEqual(["Group 1", "Group 2", "Group 3 · chunk 1 of 2"]);
    expect(v.sources.groups[2]).toMatchObject({ skipped: "time budget", usable: null, model_called: false });
    expect(v.sources.groups[0]!.dropped).toEqual(["paradigm.allowed.molecular_cellular_mechanistic: no verified quote"]);
    expect(v.sources.overlays_applied).toHaveLength(2);
    expect(v.sources.merge_log[0]).toContain("dropped from paradigm.required_any");
  });

  it("shows the partial banner with the reasons when sources.complete is false", () => {
    const v = opportunityProfileView(opportunityRow(opportunityProfile(), sources({ complete: false, incomplete: ["group 3: skipped (time budget)", "exemplars: 2 of 9 classified without the model (budget)"] })));
    expect(v.partial).not.toBeNull();
    expect(v.partial!.reasons).toHaveLength(2);
    expect(v.partial!.message).toContain("group 3: skipped (time budget)");
    expect(v.partial!.message).toContain("re-queues");
    expect(v.sources.complete).toBe(false);
    // A row written before the fix pass has no `complete`: treated as complete.
    const legacy = opportunityProfileView(opportunityRow(opportunityProfile(), { text: "full_text" } as unknown as ProfileSources));
    expect(legacy.partial).toBeNull();
    expect(legacy.sources.facts.find((f) => f.label === "Blend (text · exemplar, n)")!.value).toBe("—");
  });

  it("is robust to a sparse row: overlays-only profile, no provenance, no Guide hash, unknown ids", () => {
    const sparse = opportunityRow(
      { opportunity_id: OPP, number: "", taxonomy_version: TAXONOMY_VERSION, computed_at: "2026-01-01T00:00:00Z", confidence: "low", paradigm: { required: { gone_category: 0.5 }, required_any: {}, allowed: {}, excluded: {} } } as unknown as OpportunityFitProfile,
      {} as ProfileSources,
      { guide_html_hash: null, confidence: "low" },
    );
    const v = opportunityProfileView(sparse);
    expect(v.number).toBe("");
    expect(v.confidence).toBe("low");
    expect(v.axes.find((a) => a.axis === "paradigm")!.lists[0]!.entries[0]).toMatchObject({ id: "gone_category", label: "Gone category", known: false, quote: null });
    expect(v.axes.find((a) => a.axis === "materials")!.human_required).toBeNull();
    expect(v.mechanism.find((f) => f.label === "Activity code")!.value).toBe("—");
    expect(v.eligibility.find((f) => f.label === "ESI only")!.value).toBe("no");
    expect(v.quotes).toEqual([]);
    expect(v.sources.facts.find((f) => f.label === "Guide page hash")!.value).toContain("built without Guide text");
    expect(v.sources.groups).toEqual([]);
    expect(v.partial).toBeNull();
  });

  it("marks every entry's origin: own-path quote, inherited list quote, overlay (designation / activity code), or unquoted", () => {
    const v = opportunityProfileView(opportunityRow());
    const paradigm = v.axes.find((a) => a.axis === "paradigm")!;
    const [required, requiredAny, allowed, excluded] = paradigm.lists;
    // clinical_trials: the designation overlay set it; the text's list-level quote is carried, marked inherited.
    expect(required!.entries[0]).toMatchObject({ id: "clinical_trials", origin: "overlay", overlay: { source: "designation", detail: "required" }, quote: { field: "paradigm.required", inherited: true }, marker: "overlay: clinical-trial designation required" });
    // the any-of members have only the set-level quote.
    expect(requiredAny!.entries.map((e) => [e.origin, e.quote?.inherited, e.marker])).toEqual([
      ["text", true, "quote is for the whole list"],
      ["text", true, "quote is for the whole list"],
    ]);
    // K08 prior → allowed translational / mcm; behavioral has nothing behind it.
    expect(allowed!.entries.find((e) => e.id === "translational")).toMatchObject({ origin: "overlay", overlay: { source: "activity_code", detail: "K08" }, quote: null, marker: "overlay: activity code K08" });
    expect(allowed!.entries.find((e) => e.id === "behavioral")).toMatchObject({ origin: "unquoted", overlay: null, quote: null, marker: "no verified quote" });
    // An own-path quote is text, not inherited.
    expect(excluded!.entries[0]).toMatchObject({ id: "epidemiology", origin: "text", quote: { field: "paradigm.excluded.epidemiology", inherited: false }, marker: "verified quote" });
    // The designation's list-axis entries are overlay too, carrying the list quote when there is one.
    const design = v.axes.find((a) => a.axis === "design")!.lists.find((l) => l.path === "design.required_any")!;
    expect(design.entries.map((e) => e.origin)).toEqual(["overlay", "overlay", "overlay"]);
    expect(design.entries[0]!.quote).toMatchObject({ field: "design.required_any", inherited: true });
    const unit = v.axes.find((a) => a.axis === "unit")!.lists.find((l) => l.path === "unit.required")!;
    expect(unit.entries[0]).toMatchObject({ id: "L3", origin: "overlay", quote: null });
    expect(v.axes.find((a) => a.axis === "materials")!.lists.find((l) => l.path === "materials.required")!.entries[0]).toMatchObject({ id: "enrolled_participants", origin: "overlay", quote: { inherited: true } });
    // Nothing on the page carries an inherited quote unmarked.
    for (const axis of v.axes) for (const list of axis.lists) for (const e of list.entries) if (e.quote && e.quote.field !== `${list.path}.${e.id}`) expect(e.quote.inherited).toBe(true);
  });

  it("(a) an exemplar-added entry has no quote even when the list is quoted; its text sibling inherits the list quote", () => {
    const profile = opportunityProfile({
      paradigm: { required: {}, required_any: {}, allowed: { behavioral: 0.4, computational_data_science: 0.3, translational: 0.6 }, excluded: {} },
      provenance: { "paradigm.allowed": { section: "Part 2 · Section I", quote: "Behavioral and translational studies are welcome." } },
    });
    const src = sources({ overlays_applied: [], merge_log: [], blend_log: ["paradigm.allowed += computational_data_science 0.3 (exemplar share 0.5)", "paradigm.allowed.translational: 0.5 → 0.6 (exemplar share 1)", "unit.allowed += L1 (exemplar share 0.6)"] });
    const v = opportunityProfileView(opportunityRow(profile, src));
    const allowed = v.axes.find((a) => a.axis === "paradigm")!.lists.find((l) => l.path === "paradigm.allowed")!;
    expect(allowed.listQuote).toMatchObject({ field: "paradigm.allowed", quote: "Behavioral and translational studies are welcome." });
    expect(allowed.entries.find((e) => e.id === "computational_data_science")).toMatchObject({ quote: null, origin: "exemplar", overlay: null, marker: "exemplar prior (D21), no Guide quote" });
    expect(allowed.entries.find((e) => e.id === "behavioral")).toMatchObject({ origin: "text", quote: { field: "paradigm.allowed", inherited: true } });
    // A raised entry (`a → b`) is not an add: it keeps the text origin.
    expect(allowed.entries.find((e) => e.id === "translational")).toMatchObject({ origin: "text", quote: { inherited: true } });
    // The list-axis gain is an exemplar entry too.
    expect(v.axes.find((a) => a.axis === "unit")!.lists.find((l) => l.path === "unit.allowed")!.entries[0]).toMatchObject({ id: "L1", origin: "exemplar", quote: null });
    expect(exemplarAdded(src.blend_log)).toEqual(new Set(["paradigm.allowed.computational_data_science", "unit.allowed.L1"]));
  });

  it("marks objective entries the blend added silently as exemplar when the blend ran, unquoted when it did not", () => {
    // Fixture: no objective quote, blend 0.6 / 0.4 over 9 informative exemplars → the exemplars' (blendMap logs nothing).
    const blended = opportunityProfileView(opportunityRow());
    const objective = blended.axes.find((a) => a.axis === "objective")!.lists[0]!;
    expect(objective.entries.map((e) => [e.id, e.origin, e.quote])).toEqual([
      ["implementation_dissemination", "exemplar", null],
      ["outcomes_quality", "exemplar", null],
    ]);
    expect(objective.semantics).toContain("logs no objective adds");
    // Blend off (n < 5 → exemplar weight 0): the same entries are unquoted.
    const off = opportunityProfileView(opportunityRow(opportunityProfile(), sources({ blend: { exemplar: 0, text: 1, n: 2 }, exemplars_informative: 2 })));
    expect(off.axes.find((a) => a.axis === "objective")!.lists[0]!.entries.map((e) => e.origin)).toEqual(["unquoted", "unquoted"]);
    // A list-level objective quote: text (inherited) — the two cannot be told apart; an own-path quote: text; the K01 career prior: overlay.
    const quoted = opportunityProfileView(
      opportunityRow(
        opportunityProfile({ objective: { training_capacity: 1, implementation_dissemination: 0.4, outcomes_quality: 0.1 }, provenance: { objective: { section: "S", quote: "Implementation is the goal." }, "objective.outcomes_quality": { section: "S", quote: "outcomes" } } }),
        sources({ overlays_applied: ["notice_activity_code → activity_code_priors.K01"] }),
      ),
    );
    expect(quoted.axes.find((a) => a.axis === "objective")!.lists[0]!.entries.map((e) => [e.id, e.origin, e.quote?.inherited ?? null])).toEqual([
      ["training_capacity", "overlay", true],
      ["implementation_dissemination", "text", true],
      ["outcomes_quality", "text", false],
    ]);
    expect(quoted.axes.find((a) => a.axis === "objective")!.lists[0]!.entries[0]!.overlay).toEqual({ source: "activity_code", detail: "K01" });
  });

  it("(b) an overlay entry with no quote anywhere is origin overlay, and the blend's designation-prior line marks one too", () => {
    const profile = opportunityProfile({ paradigm: { required: { clinical_trials: 1 }, required_any: {}, allowed: {}, excluded: {} }, provenance: {} });
    const v = opportunityProfileView(opportunityRow(profile, sources({ overlays_applied: ["notice_ct_required → clinical_trial_designation.required"], merge_log: [], blend_log: [] })));
    const required = v.axes.find((a) => a.axis === "paradigm")!.lists[0]!;
    expect(required.listQuote).toBeNull();
    expect(required.entries[0]).toMatchObject({ id: "clinical_trials", origin: "overlay", quote: null, overlay: { source: "designation", detail: "required" } });
    // Recomputed sets, line formats as opportunity.ts writes them.
    const origins = overlayOrigins({ overlays_applied: ["notice_ct_not_allowed → clinical_trial_designation.not_allowed", "notice_activity_code → activity_code_priors.K23", "notice_activity_code → activity_code_priors.R01 (neutral)", "notice_activity_code → activity_code_priors.NOPE"], blend_log: [], overrides_applied: [] });
    expect(origins.get("paradigm.excluded.clinical_trials")).toEqual({ source: "designation", detail: "not_allowed" });
    expect(origins.get("design.prohibited.rct")).toEqual({ source: "designation", detail: "not_allowed" });
    expect(origins.get("paradigm.required.clinical_observational")).toEqual({ source: "activity_code", detail: "K23" });
    expect(origins.get("paradigm.required.clinical_trials")).toEqual({ source: "activity_code", detail: "K23" });
    expect(origins.has("paradigm.required.nope")).toBe(false);
    // The blend's floor line alone marks the entry; a verified override that removed a prior takes it out.
    expect(overlayOrigins({ blend_log: ["paradigm.required.clinical_trials: designation prior 1 kept over the blend 0.6 (exemplar share 0.2)"] }).get("paradigm.required.clinical_trials")).toEqual({ source: "designation", detail: "required" });
    const removed = overlayOrigins({ overlays_applied: ["notice_ct_required → clinical_trial_designation.required"], overrides_applied: ['unit.required.L3: removed (designation prior) — "any level" [Section I]', 'design.required_any: prior list → [rct] — "RCTs only" [Section I]'] });
    expect(removed.has("unit.required.L3")).toBe(false);
    expect(removed.has("design.required_any.rct")).toBe(false);
    expect(removed.get("paradigm.required.clinical_trials")).toBeTruthy();
    expect(overlayOrigins(undefined).size).toBe(0);
    expect(overlayOrigins({ overlays_applied: ["notice_ct_weird → clinical_trial_designation.unknown"] }).size).toBe(0);
    expect(overlayLabel({ source: "designation", detail: "not_allowed" })).toBe("clinical-trial designation not allowed");
    expect(overlayLabel({ source: "division", detail: "DEM" })).toBe("program division DEM");
    expect(entryMarker({ origin: "text", overlay: { source: "activity_code", detail: "K08" }, quote: { field: "paradigm.allowed.translational", section: "", quote: "q", inherited: false } })).toBe("verified quote · also overlay: activity code K08");
  });

  it("(c) an empty list keeps its list quote and the merge lines that folded it", () => {
    const v = opportunityProfileView(opportunityRow());
    const requiredAny = v.axes.find((a) => a.axis === "paradigm")!.lists.find((l) => l.path === "paradigm.required_any")!;
    expect(requiredAny.entries).toHaveLength(2);
    const folded = opportunityProfileView(opportunityRow(opportunityProfile({ paradigm: { required: { clinical_trials: 1 }, required_any: {}, allowed: {}, excluded: {} } })));
    const list = folded.axes.find((a) => a.axis === "paradigm")!.lists.find((l) => l.path === "paradigm.required_any")!;
    expect(list.entries).toEqual([]);
    expect(list.listQuote).toMatchObject({ field: "paradigm.required_any", quote: "Either early-phase experimental studies or biospecimen studies." });
    expect(list.mergeNotes).toEqual(["clinical_trials: in paradigm.required, dropped from paradigm.required_any"]);
    // `dropped from paradigm.required` must not match the required_any line.
    expect(folded.axes.find((a) => a.axis === "paradigm")!.lists[0]!.mergeNotes).toEqual([]);
    expect(folded.axes.find((a) => a.axis === "paradigm")!.lists[2]!.listQuote).toBeNull();
  });

  it("quoteFor walks up the path and allQuotes sorts by field", () => {
    const prov = { paradigm: { section: "S", quote: "axis" }, "paradigm.required": { section: "S", quote: "list" } };
    expect(quoteFor(prov, "paradigm.required.clinical_trials")!.field).toBe("paradigm.required");
    expect(quoteFor(prov, "paradigm.allowed.x")!.field).toBe("paradigm");
    expect(quoteFor(prov, "design.allowed")).toBeNull();
    expect(quoteFor(null, "x")).toBeNull();
    expect(allQuotes({ b: { section: "", quote: "2" }, a: { section: "", quote: "1" }, broken: null as unknown as { section: string; quote: string } }).map((q) => q.field)).toEqual(["a", "b"]);
  });
});

describe("flag validation (the server action's pure half)", () => {
  it("accepts an axis, an axis:category and a whole-profile flag with a reason", () => {
    expect(parseFlagInput({ investigatorId: INV, axisReason: "paradigm:clinical_trials", reason: "  She runs no trials. " })).toEqual({
      ok: true,
      value: { investigator_id: INV, opportunity_id: null, axis: "paradigm", category: "clinical_trials", axis_reason: "paradigm:clinical_trials", reason: "She runs no trials." },
    });
    expect(parseFlagInput({ opportunityId: OPP, axisReason: "design" })).toEqual({
      ok: true,
      value: { investigator_id: null, opportunity_id: OPP, axis: "design", category: null, axis_reason: "design", reason: null },
    });
    expect(parseFlagInput({ opportunityId: OPP, axisReason: "", reason: "Whole thing is off." })).toMatchObject({ ok: true, value: { axis: null, category: null, axis_reason: null, reason: "Whole thing is off." } });
    expect(parseFlagInput({ investigatorId: INV, axisReason: "topic", reason: null })).toMatchObject({ ok: true, value: { axis: "topic", axis_reason: "topic" } });
    for (const axis of ["unit:L2", "design:rct", "materials:enrolled_participants", "objective:prevention"]) {
      expect(parseFlagInput({ investigatorId: INV, axisReason: axis }).ok).toBe(true);
    }
  });

  it("rejects bad ids, two ids, no id", () => {
    expect(parseFlagInput({ investigatorId: "not-a-uuid", axisReason: "paradigm" })).toEqual({ ok: false, error: "Invalid investigator id." });
    expect(parseFlagInput({ opportunityId: "123", axisReason: "paradigm" })).toEqual({ ok: false, error: "Invalid opportunity id." });
    expect(parseFlagInput({ investigatorId: INV, opportunityId: OPP, axisReason: "paradigm" }).ok).toBe(false);
    expect(parseFlagInput({ axisReason: "paradigm" }).ok).toBe(false);
    expect(parseFlagInput({ investigatorId: "  ", axisReason: "paradigm" }).ok).toBe(false);
  });

  it("rejects an axis outside the six, a category off its axis, a category on topic", () => {
    const bad = parseFlagInput({ investigatorId: INV, axisReason: "vibes" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("paradigm, unit, design, materials, objective, topic");
    const off = parseFlagInput({ investigatorId: INV, axisReason: "paradigm:rct" });
    expect(off.ok).toBe(false);
    if (!off.ok) expect(off.error).toContain("not a paradigm category");
    expect(parseFlagInput({ investigatorId: INV, axisReason: "unit:molecule" }).ok).toBe(false); // a unit, not a level
    expect(parseFlagInput({ investigatorId: INV, axisReason: "topic:anything" })).toEqual({ ok: false, error: "Topic has no categories; flag the topic axis as a whole." });
    expect(parseFlagInput({ investigatorId: INV, axisReason: "paradigm:" })).toMatchObject({ ok: true, value: { axis: "paradigm", category: null } });
  });

  it("caps the reason at 1,000 characters and requires one for a whole-profile flag", () => {
    expect(parseFlagInput({ investigatorId: INV, axisReason: "paradigm", reason: "x".repeat(FLAG_REASON_MAX) }).ok).toBe(true);
    const long = parseFlagInput({ investigatorId: INV, axisReason: "paradigm", reason: "x".repeat(FLAG_REASON_MAX + 1) });
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.error).toContain("1001");
    expect(parseFlagInput({ investigatorId: INV })).toEqual({ ok: false, error: "Say what is wrong: pick an axis or write a reason." });
    expect(parseFlagInput({ investigatorId: INV, reason: "   " }).ok).toBe(false);
  });

  it("builds the fit_labels row with source profile_flag, the labeler and the engine version", () => {
    const parsed = parseFlagInput({ investigatorId: INV, axisReason: "materials:ehr", reason: "No EHR work." });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(flagRow(parsed.value, "22222222-2222-4222-8222-222222222222", TAXONOMY_VERSION)).toEqual({
      investigator_id: INV,
      opportunity_id: null,
      tier: null,
      reason: "No EHR work.",
      axis_reason: "materials:ehr",
      labeler: "22222222-2222-4222-8222-222222222222",
      engine_version: TAXONOMY_VERSION,
      source: "profile_flag",
    });
    expect(axisReasonOf(null)).toBeNull();
    expect(axisReasonOf("unit", "L1")).toBe("unit:L1");
    expect(parseAxisReason("design:rct")).toEqual({ axis: "design", category: "rct" });
    expect(parseAxisReason("design:")).toEqual({ axis: "design", category: null });
  });

  it("(d) flagView on a stored axis_reason outside the six renders the text and never throws", () => {
    const row: FitLabelRow = { id: "f9", investigator_id: INV, opportunity_id: null, tier: null, reason: null, axis_reason: "vibes:x", labeler: null, engine_version: "fit-v0", source: "profile_flag", created_at: "2026-09-06T10:00:00Z" };
    const v = flagView(row, null);
    expect(v).toMatchObject({ axis: "vibes", axisLabel: "vibes", category: "x", categoryLabel: "X", scope: "vibes · X", who: "unknown" });
    expect(flagView({ ...row, axis_reason: "paradigm:gone_category" }, "V").scope).toBe("Paradigm · Gone category");
  });

  it("lists stored flags with who, when, scope and reason, newest first", () => {
    const rows: FitLabelRow[] = [
      { id: "f1", investigator_id: INV, opportunity_id: null, tier: null, reason: "Wrong family", axis_reason: "paradigm:clinical_trials", labeler: "33333333-3333-4333-8333-333333333333", engine_version: "fit-v1", source: "profile_flag", created_at: "2026-09-06T10:00:00Z" },
      { id: "f2", investigator_id: INV, opportunity_id: null, tier: null, reason: null, axis_reason: "unit", labeler: null, engine_version: "fit-v1", source: "profile_flag", created_at: "2026-09-06T11:00:00Z" },
      { id: "f3", investigator_id: INV, opportunity_id: null, tier: null, reason: "All of it", axis_reason: null, labeler: "33333333-3333-4333-8333-333333333333", engine_version: "fit-v1", source: "profile_flag", created_at: "2026-09-05T11:00:00Z" },
    ];
    const views = sortFlags(rows).map((r) => flagView(r, r.labeler === "33333333-3333-4333-8333-333333333333" ? "Vincent Chan" : null));
    expect(views.map((v) => v.id)).toEqual(["f2", "f1", "f3"]);
    expect(views[1]).toMatchObject({ who: "Vincent Chan", scope: `Paradigm · ${categoryDisplay("paradigm", "clinical_trials").label}`, axis: "paradigm", category: "clinical_trials", reason: "Wrong family" });
    expect(views[0]).toMatchObject({ who: "unknown", scope: "Unit of analysis", categoryLabel: null });
    expect(views[2]).toMatchObject({ scope: "Whole profile", axisLabel: null });
  });
});

describe("spot-check index rows", () => {
  it("summarizes confidence per axis in the report's shorthand", () => {
    expect(confidenceSummary({ paradigm: "high", unit: "medium", design: "low", materials: "low", objective: "medium", topic: "high" })).toBe("P:H U:M D:L M:L O:M T:H");
    expect(confidenceSummary(null)).toBe("P:L U:L D:L M:L O:L T:L");
  });

  it("builds investigator rows sorted by name with dominant career / recent paradigm, pending and flags", () => {
    const rows = investigatorIndexRows(
      [
        { investigator_id: "b", confidence: { paradigm: "medium", unit: "low", design: "low", materials: "low", objective: "low", topic: "medium" }, item_count: 60, pending_items: 1, computed_at: "2026-09-06T00:00:00Z", taxonomy_version: "fit-v1", paradigm: { career: { translational: 0.69, molecular_cellular_mechanistic: 0.7 }, recent: { translational: 0.74 } } },
        { investigator_id: "a", confidence: null, item_count: null, pending_items: null, computed_at: "2026-09-06T00:00:00Z", taxonomy_version: null, paradigm: null },
      ],
      new Map([
        ["a", "Zed Last"],
        ["b", "Ann First"],
      ]),
      new Map([["b", 2]]),
    );
    expect(rows.map((r) => r.name)).toEqual(["Ann First", "Zed Last"]);
    expect(rows[0]).toMatchObject({ career: { label: categoryDisplay("paradigm", "molecular_cellular_mechanistic").label, family: "Discovery", weight: 0.7 }, recent: { family: "Translational human biology", weight: 0.74 }, moved: true, confidence: "P:M U:L D:L M:L O:L T:M", lowest: "low", pending_items: 1, flags: 2, href: "/investigators/b/fit" });
    expect(rows[1]).toMatchObject({ career: null, recent: null, moved: false, item_count: 0, pending_items: 0, flags: 0, lowest: "low" });
    expect(rows[0]!.career).toMatchObject({ known: true });
  });

  it("(e) a stale dominant id is marked and never counts as a family move", () => {
    const rows = investigatorIndexRows(
      [
        { investigator_id: "s1", confidence: null, item_count: 1, pending_items: 0, computed_at: "2026-09-06T00:00:00Z", taxonomy_version: "fit-v0", paradigm: { career: { retired: 0.5 } as never, recent: { clinical_trials: 0.6 } } },
        { investigator_id: "s2", confidence: null, item_count: 1, pending_items: 0, computed_at: "2026-09-06T00:00:00Z", taxonomy_version: "fit-v0", paradigm: { career: { retired: 0.5 } as never, recent: { gone: 0.6 } as never } },
        { investigator_id: "s3", confidence: null, item_count: 1, pending_items: 0, computed_at: "2026-09-06T00:00:00Z", taxonomy_version: "fit-v0", paradigm: { career: { clinical_trials: 0.5 }, recent: { translational: 0.6 } } },
      ],
      new Map(),
      new Map(),
    );
    expect(rows[0]).toMatchObject({ career: { label: "Retired", family: "—", known: false }, recent: { known: true }, moved: false });
    expect(rows[1]).toMatchObject({ career: { known: false }, recent: { label: "Gone", known: false }, moved: false });
    expect(rows[2]).toMatchObject({ career: { known: true }, recent: { known: true }, moved: true });
  });

  it("builds opportunity rows sorted by number with the top required paradigm (falling back to required_any), confidence and completeness", () => {
    const rows = opportunityIndexRows(
      [
        { opportunity_id: "o2", confidence: "high", computed_at: "2026-09-06T00:00:00Z", taxonomy_version: "fit-v1", number: "PA-24-181", paradigm: { required: { clinical_trials: 1 }, required_any: {}, allowed: {}, excluded: { epidemiology: 0.9 } }, needs_review: false, complete: true, text: "full_text" },
        { opportunity_id: "o1", confidence: null, computed_at: "2026-09-06T00:00:00Z", taxonomy_version: null, number: null, paradigm: { required: {}, required_any: { early_phase_human_experimental: 0.9, human_biospecimen: 0.95 } }, needs_review: true, complete: false, text: null },
        { opportunity_id: "o3", confidence: "low", computed_at: "2026-09-06T00:00:00Z", taxonomy_version: "fit-v1", number: "PA-23-317", paradigm: null, needs_review: null, complete: null, text: "synopsis" },
      ],
      new Map([
        ["o1", { opportunity_number: "PA-22-001", title: "  Older notice ", clinical_trial_designation: "not_allowed" }],
        ["o2", { opportunity_number: "PA-24-181", title: "K08 CT required", clinical_trial_designation: "required" }],
      ]),
      new Map([["o2", 1]]),
    );
    expect(rows.map((r) => r.number)).toEqual(["PA-22-001", "PA-23-317", "PA-24-181"]);
    expect(rows[0]).toMatchObject({ title: "Older notice", designation: "not allowed", required: { label: categoryDisplay("paradigm", "human_biospecimen").label, weight: 0.95, any: true }, confidence: "low", complete: false, text: "none", needs_review: true, flags: 0 });
    expect(rows[1]).toMatchObject({ title: "(title not on file)", designation: "unknown", required: null, complete: true, text: "synopsis" });
    expect(rows[2]).toMatchObject({ required: { label: categoryDisplay("paradigm", "clinical_trials").label, weight: 1, any: false }, excluded: 1, complete: true, flags: 1, href: "/opportunities/o2/fit" });
  });

  it("counts flags per subject", () => {
    const c = flagCounts([
      { investigator_id: "a", opportunity_id: null },
      { investigator_id: "a", opportunity_id: null },
      { investigator_id: null, opportunity_id: "o" },
      { investigator_id: null, opportunity_id: null },
    ]);
    expect(Array.from(c.investigators.entries())).toEqual([["a", 2]]);
    expect(Array.from(c.opportunities.entries())).toEqual([["o", 1]]);
  });
});
