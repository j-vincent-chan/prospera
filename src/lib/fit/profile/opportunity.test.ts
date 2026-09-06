import { describe, expect, it } from "vitest";
import fixture from "@/lib/fit/__fixtures__/mesh-descriptors-subset.json";
import { InMemoryItemProfileCache } from "@/lib/fit/classify/cache";
import type { ModelFn, ModelRequest } from "@/lib/fit/classify/llm";
import { buildMeshIndex, type MeshDescriptorRow } from "@/lib/fit/classify/mesh";
import { DEFAULT_RULE_TABLES, evaluateRules, type EvaluateContext } from "@/lib/fit/classify/rules";
import {
  aggregateExemplarAxes,
  blend,
  blendWeights,
  buildOpportunityFitProfileFrom,
  chunkSections,
  deterministicOverlays,
  emptyGroupOutput,
  exemplarPrior,
  extractionCacheKey,
  extractWithModel,
  groupSections,
  InMemoryNoticeExtractionCache,
  mergeExtractions,
  ModelBudget,
  normalizeForMatch,
  profileConfidence,
  profileDue,
  selectDue,
  validateGroupOutput,
  verifyQuote,
  type CandidateNotice,
  type ExemplarPrior,
  type ExemplarRecord,
  type ExistingProfile,
  type GroupExtraction,
  type MergeResult,
  type NoticeRecord,
  type NoticeSection,
} from "@/lib/fit/profile/opportunity";
import { checkNoticeFixture, fixtureModel, formatNoticeChecks, NOTICE_FIXTURES } from "@/lib/fit/profile/opportunity-fixtures";
import taxonomy from "@/lib/fit/taxonomy.json";
import { TAXONOMY_VERSION } from "@/lib/fit/taxonomy";
import type { ItemProfile } from "@/lib/fit/types";

const mesh = buildMeshIndex(fixture.descriptors as MeshDescriptorRow[]);
const ctx: EvaluateContext = { mesh, tables: DEFAULT_RULE_TABLES };
const rules = (item: Parameters<typeof evaluateRules>[0]) => evaluateRules(item, ctx);

const OPP = taxonomy.opportunity_profile;

const notice = (over: Partial<NoticeRecord> = {}): NoticeRecord => ({
  id: "n-1",
  opportunity_number: "RFA-XX-27-001",
  title: "Test notice (R01 Clinical Trial Required)",
  agency: "NIH",
  agency_code: "HHS-NIH11",
  activity_code: "R01",
  clinical_trial_designation: "required",
  program_division: null,
  guide_sections: null,
  guide_html_hash: "h1",
  guide_source: "grants_nih_gov",
  description: null,
  ...over,
});

const section = (heading: string, text: string, over: Partial<NoticeSection> = {}): NoticeSection => ({ part: 2, section: "I", heading, text, ...over });

const extraction = (group: 1 | 2 | 3, output: Partial<GroupExtraction["output"]>, over: Partial<GroupExtraction> = {}): GroupExtraction => ({
  group,
  chunk: 1,
  of: 1,
  model: "mock",
  raw: {},
  usable: true,
  output: { ...emptyGroupOutput(), ...output },
  dropped: [],
  ...over,
});

const noModel: ModelFn = async () => {
  throw new Error("model must not be called");
};

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------

describe("deterministicOverlays", () => {
  it("Clinical Trial Required → the designation overlay, values from taxonomy.json", () => {
    const o = deterministicOverlays(notice({ activity_code: "R01", clinical_trial_designation: "required" }));
    const row = OPP.clinical_trial_designation.required;
    expect(o.paradigm.required).toEqual(row.paradigm_required);
    expect(o.unit.required).toEqual(row.unit_required);
    expect(o.design.required_any).toEqual(row.design_required_any);
    expect(o.materials.required).toEqual(row.materials_required);
    expect(o.paradigm.required_any).toEqual({});
    expect(o.applied).toContain("notice_ct_required → clinical_trial_designation.required");
    expect(o.origin["paradigm.required.clinical_trials"]).toBe("designation");
    expect(o.priors.paradigm_required).toEqual({ clinical_trials: 1 });
    expect(o.priors.unit_required).toEqual(["L3"]);
  });

  it("BESH → paradigm.required_any (D14), unit / materials required_any, wet-lab designs", () => {
    const o = deterministicOverlays(notice({ clinical_trial_designation: "besh_required" }));
    const row = OPP.clinical_trial_designation.besh_required;
    expect(o.paradigm.required_any).toEqual(row.paradigm_required_any);
    expect(o.paradigm.required).toEqual({});
    expect(o.unit.required_any).toEqual(row.unit_required_any);
    expect(o.design.required_any).toEqual(row.design_required_any);
    expect(o.materials.required_any).toEqual(row.materials_required_any);
    expect(o.priors.paradigm_required_any).toEqual({ early_phase_human_experimental: 1, human_biospecimen: 0.8 });
    expect(o.priors.materials_required_any).toEqual(row.materials_required_any);
  });

  it("Clinical Trial Not Allowed → excluded + prohibited; Optional and unknown → nothing", () => {
    const na = deterministicOverlays(notice({ clinical_trial_designation: "not_allowed" }));
    expect(na.paradigm.excluded).toEqual(OPP.clinical_trial_designation.not_allowed.paradigm_excluded);
    expect(na.design.prohibited).toEqual(OPP.clinical_trial_designation.not_allowed.design_prohibited);
    const opt = deterministicOverlays(notice({ clinical_trial_designation: "optional" }));
    expect(opt.paradigm).toEqual({ required: {}, required_any: {}, allowed: {}, excluded: {} });
    expect(opt.applied).toEqual(["notice_activity_code → activity_code_priors.R01 (neutral)"]);
    const unknown = deterministicOverlays(notice({ clinical_trial_designation: "unknown" }));
    expect(unknown.paradigm.required).toEqual({});
    expect(unknown.notes.some((n) => /has no overlay/.test(n))).toBe(true);
    const missing = deterministicOverlays(notice({ clinical_trial_designation: null }));
    expect(missing.notes.some((n) => /not stored/.test(n))).toBe(true);
  });

  it("activity-code priors: case normalized, unlisted code adds nothing, r → required, a → allowed", () => {
    const r18 = deterministicOverlays(notice({ activity_code: " r18 ", clinical_trial_designation: "optional" }));
    expect(r18.activity_code).toBe("R18");
    expect(r18.notes).toContain('activity code " r18 " normalized to R18');
    expect(r18.paradigm.required).toEqual(OPP.activity_code_priors.R18.r);
    expect(r18.origin["paradigm.required.implementation_science"]).toBe("activity_code");
    const k08 = deterministicOverlays(notice({ activity_code: "K08", clinical_trial_designation: "optional" }));
    expect(k08.paradigm.allowed).toEqual(OPP.activity_code_priors.K08.a);
    expect(k08.paradigm.required).toEqual({});
    const x02 = deterministicOverlays(notice({ activity_code: "X02", clinical_trial_designation: "optional" }));
    expect(x02.paradigm).toEqual({ required: {}, required_any: {}, allowed: {}, excluded: {} });
    expect(x02.notes).toContain("activity code X02 is not in the prior table: no activity-code overlay");
    const none = deterministicOverlays(notice({ activity_code: null, clinical_trial_designation: null }));
    expect(none.activity_code).toBeNull();
    expect(none.applied).toEqual([]);
  });

  it("P30 → objective resource_infrastructure; F31 → career + training_capacity", () => {
    const p30 = deterministicOverlays(notice({ activity_code: "P30", clinical_trial_designation: "optional" }));
    expect(p30.objective).toEqual({ [OPP.activity_code_priors.P30.objective]: 1 });
    expect(p30.career).toBe(false);
    const f31 = deterministicOverlays(notice({ activity_code: "F31", clinical_trial_designation: "not_allowed" }));
    expect(f31.career).toBe(true);
    expect(f31.objective).toEqual({ training_capacity: 1 });
  });

  it("designation beats the activity code inside the overlays (K23 + Not Allowed)", () => {
    const o = deterministicOverlays(notice({ activity_code: "K23", clinical_trial_designation: "not_allowed" }));
    expect(o.paradigm.excluded).toEqual({ clinical_trials: 1 });
    expect(o.paradigm.required).toEqual({ clinical_observational: OPP.activity_code_priors.K23.r.clinical_observational });
    expect(o.notes.some((n) => /overlay conflict: designation excludes clinical_trials; activity-code prior required clinical_trials/.test(n))).toBe(true);
  });

  it("program division: table hit → family prior into allowed; unknown division → nothing", () => {
    const o = deterministicOverlays(notice({ clinical_trial_designation: "optional", program_division: "Division of Cancer Control and Population Sciences (DCCPS)" }));
    expect(o.applied).toContain("notice_program_division → program-divisions.DCCPS");
    for (const c of taxonomy.paradigm.families.population.categories) expect(o.paradigm.allowed[c as keyof typeof o.paradigm.allowed]).toBe(0.5);
    for (const c of taxonomy.paradigm.families.health_systems.categories) expect(o.paradigm.allowed[c as keyof typeof o.paradigm.allowed]).toBe(0.4);
    expect(o.origin["paradigm.allowed.epidemiology"]).toBe("division");
    const unknown = deterministicOverlays(notice({ clinical_trial_designation: "optional", program_division: "Office of Unicorns" }));
    expect(unknown.paradigm.allowed).toEqual({});
    expect(unknown.notes.some((n) => /not in program-divisions.json/.test(n))).toBe(true);
  });

  it("a NOT- notice, a forecast, a notice without sections: overlays still computed, nothing thrown", () => {
    const o = deterministicOverlays({ activity_code: null, clinical_trial_designation: null, program_division: null });
    expect(o.paradigm.required).toEqual({});
    expect(o.priors).toEqual({ paradigm_required: {}, paradigm_allowed: {}, paradigm_excluded: {}, unit_required: [], design_required_any: [], design_prohibited: [], materials_required: [] });
  });
});

// ---------------------------------------------------------------------------
// Grouping, chunking, cache key
// ---------------------------------------------------------------------------

describe("groupSections / chunkSections", () => {
  const sections: NoticeSection[] = [
    section("Funding Opportunity Purpose", "purpose", { part: 1, section: "overview" }),
    section("Announcement Type", "New", { part: 1, section: "overview" }),
    section("Background", "bg"),
    section("Research Objectives", "objectives"),
    section("Partnerships", "team text"),
    section("Applications Not Responsive to this NOFO", "nr"),
    section("Clinical Trial?", "Required", { section: "II" }),
    section("Eligible Individuals (Program Director/Principal Investigator)", "eligible", { section: "III.1" }),
    section("3. Additional Information on Eligibility", "more", { section: "III.3" }),
    section("PHS 398 Research Plan", "plan", { section: "IV.2" }),
    section("PHS Human Subjects and Clinical Trials Information", "hs", { section: "IV.2" }),
    section("Scientific/Research Contact(s)", "contact", { section: "VII" }),
    section("Peer Review Contact(s)", "review", { section: "VII" }),
  ];

  it("routes the sections into the three groups of the spec", () => {
    const g = groupSections(sections);
    expect(g[1].map((s) => s.heading)).toEqual(["Funding Opportunity Purpose", "Background", "Research Objectives", "Partnerships"]);
    expect(g[2].map((s) => s.heading)).toEqual(["Applications Not Responsive to this NOFO", "Clinical Trial?", "PHS Human Subjects and Clinical Trials Information"]);
    expect(g[3].map((s) => s.heading)).toEqual(["Partnerships", "Eligible Individuals (Program Director/Principal Investigator)", "3. Additional Information on Eligibility", "Scientific/Research Contact(s)", "Peer Review Contact(s)"]);
  });

  it("a synopsis is group 1 only", () => {
    const g = groupSections([{ part: 1, section: "synopsis", heading: "Synopsis", text: "abstract" }]);
    expect(g[1]).toHaveLength(1);
    expect(g[2]).toEqual([]);
    expect(g[3]).toEqual([]);
  });

  it("packs sections into ≤ max-char chunks and splits an over-long section at line boundaries", () => {
    const small = [section("A", "x".repeat(10)), section("B", "y".repeat(10)), section("C", "z".repeat(10))];
    expect(chunkSections(small, 25).map((c) => c.map((s) => s.heading))).toEqual([["A", "B"], ["C"]]);
    const long = [section("L", Array.from({ length: 6 }, (_, i) => `line ${i} ${"w".repeat(8)}`).join("\n"))];
    const chunks = chunkSections(long, 40);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.every((s) => s.heading === "L" && s.text.length <= 40)).toBe(true);
    }
    expect(chunks.flat().map((s) => s.text).join("\n")).toBe(long[0]!.text);
  });

  it("the cache key covers the taxonomy version, group, chunk, priors and sections", () => {
    const priors = { paradigm_required: { clinical_trials: 1 }, paradigm_allowed: {}, paradigm_excluded: {}, unit_required: ["L3"], design_required_any: [], design_prohibited: [], materials_required: [] };
    const base = { group: 1 as const, chunk: 1, of: 1, priors, sections: [section("A", "text")] };
    const k = extractionCacheKey(base);
    expect(k).toMatch(/^[0-9a-f]{40}$/);
    expect(extractionCacheKey({ ...base, group: 2 })).not.toBe(k);
    expect(extractionCacheKey({ ...base, chunk: 2, of: 2 })).not.toBe(k);
    expect(extractionCacheKey({ ...base, priors: { ...priors, unit_required: [] } })).not.toBe(k);
    expect(extractionCacheKey({ ...base, sections: [section("A", "text ")] })).not.toBe(k);
    expect(extractionCacheKey({ ...base })).toBe(k);
  });
});

// ---------------------------------------------------------------------------
// Quote verification and validation
// ---------------------------------------------------------------------------

describe("verifyQuote / validateGroupOutput", () => {
  const sections: NoticeSection[] = [
    section("Research Objectives", "Applications must propose a randomized   clinical\ntrial of a digital health intervention.\nStudies may use existing cohort data."),
    section("Non-Responsive Applications", "Studies limited to animal models are not responsive."),
  ];

  it("a verbatim quote passes; whitespace-normalized passes; a quote not in the section is dropped", () => {
    expect(verifyQuote("Applications must propose a randomized clinical trial", "Part 2 · Section I · Research Objectives", sections)).toEqual({ ok: true, section: "Part 2 · Section I · Research Objectives", corrected: false, fragments: 1 });
    expect(verifyQuote("randomized   clinical trial of a digital\n health intervention", "Research Objectives", sections)).toMatchObject({ ok: true, corrected: false });
    expect(verifyQuote("Applications must propose a mouse study", "Research Objectives", sections)).toMatchObject({ ok: false });
    expect(verifyQuote("", "Research Objectives", sections)).toMatchObject({ ok: false, reason: "empty quote" });
  });

  it("a quote found in another section verifies with the section corrected", () => {
    const r = verifyQuote("Studies limited to animal models", "Part 2 · Section I · Research Objectives", sections);
    expect(r).toEqual({ ok: true, section: "Part 2 · Section I · Non-Responsive Applications", corrected: true, fragments: 1 });
  });

  it("an elided quote (\"...\" or …) verifies when every fragment appears in order in one section", () => {
    expect(verifyQuote("Applications must propose a randomized...", "Research Objectives", sections)).toMatchObject({ ok: true, fragments: 1 });
    expect(verifyQuote("Applications must propose ... digital health intervention", "Research Objectives", sections)).toMatchObject({ ok: true, fragments: 2 });
    expect(verifyQuote("…a randomized clinical trial…", "Research Objectives", sections)).toMatchObject({ ok: true, fragments: 1 });
    // Fragments out of order, or spread over two sections, do not verify.
    expect(verifyQuote("digital health intervention ... Applications must propose", "Research Objectives", sections)).toMatchObject({ ok: false });
    expect(verifyQuote("randomized clinical trial ... animal models", "Research Objectives", sections)).toMatchObject({ ok: false });
    expect(verifyQuote("...", "Research Objectives", sections)).toMatchObject({ ok: false, reason: "empty quote" });
  });

  it("typographic quotes and dashes fold before matching", () => {
    expect(normalizeForMatch("it’s  “quoted” — here")).toBe(`it's "quoted" - here`);
  });

  it("drops claims whose quote does not verify, keeps the rest, and requires a quote for every non-empty field", () => {
    const raw = {
      paradigm: { required: { clinical_trials: 0.9, epidemiology: 0.8 }, allowed: { behavioral: 0.5 }, required_any: {}, excluded: {} },
      unit: { required: ["L3"], allowed: ["L9"] },
      design: { required_any: ["rct"], required_any_2: null, allowed: [], prohibited: [] },
      materials: { expected: ["enrolled_participants"], human_required: true },
      population: "adults",
      objective: { treatment_evaluation_efficacy: 1.4 },
      topic: { distinguishing_terms: ["digital health intervention", "Digital Health Intervention"], diseases: [], biological_processes: [] },
      non_responsive: ["not this group"],
      evidence: [
        { field: "paradigm.required.clinical_trials", quote: "Applications must propose a randomized clinical trial", section: "Research Objectives" },
        { field: "paradigm.required.epidemiology", quote: "Applications must propose a cohort study", section: "Research Objectives" },
        { field: "unit", quote: "Studies may use existing cohort data.", section: "Wrong Section" },
        { field: "design", quote: "randomized clinical trial", section: "Research Objectives" },
        { field: "objective", quote: "digital health intervention", section: "Research Objectives" },
      ],
      prior_overrides: [{ field: "unit.required", from: ["L3"], to: [], quote: "no such sentence", section: "Research Objectives" }],
      confidence: "very high",
      extra: 1,
    };
    const { output, dropped } = validateGroupOutput(raw, 1, sections);
    expect(output.paradigm.required).toEqual({ clinical_trials: 0.9 });
    expect(dropped).toContain('evidence paradigm.required.epidemiology: quote "Applications must propose a cohort study" not found in "Research Objectives" or any other provided section; claim dropped');
    expect(dropped).toContain("paradigm.required.epidemiology: no verified quote");
    expect(dropped).toContain("paradigm.allowed.behavioral: no verified quote");
    expect(output.paradigm.allowed).toEqual({});
    expect(output.unit).toEqual({ required: ["L3"], allowed: [] });
    expect(dropped).toContain("unit.allowed.L9: unknown id");
    expect(dropped.some((d) => /evidence unit: section corrected from "Wrong Section"/.test(d))).toBe(true);
    expect(output.design.required_any).toEqual(["rct"]);
    expect(output.materials).toEqual({ expected: [], human_required: null });
    expect(dropped).toContain("materials.expected.enrolled_participants: no verified quote");
    expect(dropped).toContain("materials.human_required: no verified quote");
    expect(output.population).toBeNull();
    expect(dropped).toContain("population: no verified quote");
    expect(output.objective).toEqual({ treatment_evaluation_efficacy: 1 });
    expect(dropped).toContain("objective.treatment_evaluation_efficacy: clamped 1.4 to 1");
    expect(output.topic.distinguishing_terms).toEqual(["digital health intervention"]);
    expect(output.non_responsive).toEqual([]);
    expect(dropped).toContain("non_responsive: ignored (group 1 does not fill it)");
    expect(dropped).toContain("extra: ignored (group 1 does not fill it)");
    expect(output.prior_overrides).toEqual([]);
    expect(dropped.some((d) => /prior_override unit.required: quote "no such sentence" not found/.test(d))).toBe(true);
    expect(output.confidence).toBe("medium");
    expect(dropped).toContain('confidence: "very high"; treated as medium');
    expect(output.evidence.map((e) => e.field)).toEqual(["paradigm.required.clinical_trials", "unit", "design", "objective"]);
  });

  it("group 2 verifies verbatim lists item by item and ignores requirement fields", () => {
    const raw = {
      paradigm: { excluded: { animal_model: 0.9 }, required: { clinical_trials: 1 } },
      design: { prohibited: ["animal_in_vivo"] },
      non_responsive: ["Studies limited to animal models are not responsive.", "Applications from Mars are not responsive."],
      clinical_trial_text: "Studies limited to animal models",
      mechanism: { ceiling_direct_per_year: 500000, period_years: null, budget_notes: null },
      evidence: [{ field: "paradigm.excluded", quote: "Studies limited to animal models are not responsive.", section: "Non-Responsive Applications" }, { field: "design.prohibited", quote: "animal models", section: "Non-Responsive Applications" }],
      confidence: "high",
    };
    const { output, dropped } = validateGroupOutput(raw, 2, sections);
    expect(output.paradigm.excluded).toEqual({ animal_model: 0.9 });
    expect(output.paradigm.required).toEqual({});
    expect(dropped).toContain("paradigm.required: ignored (group 2 does not fill it)");
    expect(output.design.prohibited).toEqual(["animal_in_vivo"]);
    expect(output.non_responsive).toEqual(["Studies limited to animal models are not responsive."]);
    expect(dropped.some((d) => /non_responsive: "Applications from Mars are not responsive." not found/.test(d))).toBe(true);
    expect(output.clinical_trial_text).toBe("Studies limited to animal models");
    expect(output.mechanism.ceiling_direct_per_year).toBeNull();
    expect(dropped).toContain("mechanism.ceiling_direct_per_year: no verified quote");
  });

  it("a reply that is not JSON or was cut off is unusable and never cached", async () => {
    const cache = new InMemoryNoticeExtractionCache();
    let n = 0;
    const model: ModelFn = async () => {
      n += 1;
      return n === 1 ? "not json" : { content: JSON.stringify({ paradigm: {}, confidence: "high" }), finish_reason: "length" };
    };
    const header = { number: "X", title: "T", agency: null, activity_code: null, activity_title: null, clinical_trial_designation: null, issuing_ic: null, program_division: null };
    const priors = deterministicOverlays(notice({ clinical_trial_designation: "optional", activity_code: null })).priors;
    const runs = await extractWithModel([sections[0]!, sections[1]!], header, priors, { model, modelName: "mock", cache });
    expect(runs.map((r) => [r.group, r.cache, r.extraction?.usable])).toEqual([
      [1, "miss", false],
      [2, "miss", false],
    ]);
    expect(cache.writes).toBe(0);
    expect(runs[0]!.extraction!.dropped[0]).toMatch(/not valid JSON/);
    expect(runs[1]!.extraction!.dropped[0]).toMatch(/truncated by max_tokens/);
  });

  it("extractWithModel: cache hit skips the model; the budget stops calls", async () => {
    const cache = new InMemoryNoticeExtractionCache();
    const calls: ModelRequest[] = [];
    const model: ModelFn = async (req) => {
      calls.push(req);
      return JSON.stringify({ paradigm: { required: {} }, confidence: "high" });
    };
    const header = { number: "X", title: "T", agency: null, activity_code: null, activity_title: null, clinical_trial_designation: null, issuing_ic: null, program_division: null };
    const priors = deterministicOverlays(notice({ clinical_trial_designation: "optional", activity_code: null })).priors;
    const first = await extractWithModel(sections, header, priors, { model, modelName: "mock", cache, budget: new ModelBudget(1) });
    expect(first.map((r) => [r.group, r.cache, r.model_called, r.skipped])).toEqual([
      [1, "miss", true, null],
      [2, "miss", false, "model budget spent (1)"],
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.model).toBe("mock");
    expect(calls[0]!.user).toMatch(/^Section group: 1$/m);
    const second = await extractWithModel(sections, header, priors, { model, modelName: "mock", cache, budget: new ModelBudget(5) });
    expect(second.map((r) => [r.group, r.cache, r.model_called])).toEqual([
      [1, "hit", false],
      [2, "miss", true],
    ]);
    expect(calls).toHaveLength(2);
    expect(cache.rows.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

describe("mergeExtractions", () => {
  const optional = () => deterministicOverlays(notice({ clinical_trial_designation: "optional", activity_code: "R01" }));

  it("excluded beats required across groups (text vs text) and flags needs_review", () => {
    const m = mergeExtractions(optional(), [
      extraction(1, { paradigm: { required: { clinical_trials: 0.9, epidemiology: 0.8 }, required_any: {}, allowed: { behavioral: 0.5 }, excluded: {} } }),
      extraction(2, { paradigm: { required: {}, required_any: {}, allowed: {}, excluded: { clinical_trials: 1, behavioral: 0.7 } } }),
    ]);
    expect(m.paradigm.required).toEqual({ epidemiology: 0.8 });
    expect(m.paradigm.excluded).toEqual({ clinical_trials: 1, behavioral: 0.7 });
    expect(m.paradigm.allowed).toEqual({});
    expect(m.needs_review).toBe(true);
    expect(m.log).toContain("conflict: clinical_trials both excluded and in paradigm.required; excluded wins, requirement dropped; needs_review");
    expect(m.log).toContain("behavioral: excluded, dropped from paradigm.allowed");
  });

  it("an overlay requirement survives a text exclusion (prior_overrides is the way to contradict a prior)", () => {
    const o = deterministicOverlays(notice({ clinical_trial_designation: "required" }));
    const m = mergeExtractions(o, [extraction(2, { paradigm: { required: {}, required_any: {}, allowed: {}, excluded: { clinical_trials: 0.9 } }, design: { required_any: [], required_any_2: [], allowed: [], prohibited: ["rct"] } })]);
    expect(m.paradigm.required).toEqual({ clinical_trials: 1 });
    expect(m.paradigm.excluded).toEqual({});
    expect(m.design.required_any).toEqual(OPP.clinical_trial_designation.required.design_required_any);
    expect(m.design.prohibited).toEqual([]);
    expect(m.needs_review).toBe(true);
    expect(m.log.some((l) => /clinical_trials is a designation prior in paradigm.required and the text excludes it; the prior stands/.test(l))).toBe(true);
  });

  it("a category the overlay requires outright is dropped from a text required_any", () => {
    const o = deterministicOverlays(notice({ clinical_trial_designation: "required" }));
    const m = mergeExtractions(o, [extraction(1, { paradigm: { required: {}, required_any: { clinical_trials: 1, implementation_science: 0.8 }, allowed: {}, excluded: {} } })]);
    expect(m.paradigm.required).toEqual({ clinical_trials: 1 });
    expect(m.paradigm.required_any).toEqual({ implementation_science: 0.8 });
    expect(m.log).toContain("clinical_trials: in paradigm.required, dropped from paradigm.required_any");
    expect(m.needs_review).toBe(false);
  });

  it("an overlay exclusion beats a text requirement", () => {
    const o = deterministicOverlays(notice({ clinical_trial_designation: "not_allowed" }));
    const m = mergeExtractions(o, [extraction(1, { paradigm: { required: { clinical_trials: 0.8 }, required_any: {}, allowed: {}, excluded: {} }, design: { required_any: ["rct"], required_any_2: [], allowed: [], prohibited: [] } })]);
    expect(m.paradigm.required).toEqual({});
    expect(m.design.required_any).toEqual([]);
    expect(m.needs_review).toBe(true);
  });

  it("a verified prior_override removes or changes an overlay entry; afterwards the text stands", () => {
    const o = deterministicOverlays(notice({ clinical_trial_designation: "required" }));
    const m = mergeExtractions(o, [
      extraction(1, {
        paradigm: { required: {}, required_any: {}, allowed: {}, excluded: {} },
        prior_overrides: [
          { field: "paradigm.required.clinical_trials", from: 1, to: 0.5, quote: "q1", section: "s" },
          { field: "unit.required", from: ["L3"], to: ["L4"], quote: "q2", section: "s" },
          { field: "materials.required.enrolled_participants", from: true, to: null, quote: "q3", section: "s" },
          { field: "paradigm.required.epidemiology", from: null, to: 0.9, quote: "q4", section: "s" },
        ],
      }),
      extraction(2, { paradigm: { required: {}, required_any: {}, allowed: {}, excluded: { clinical_trials: 0.9 } } }),
    ]);
    expect(m.overrides_applied).toHaveLength(3);
    expect(m.unit.required).toEqual(["L4"]);
    expect(m.materials.required).toEqual([]);
    // An override on a field the priors did not set is a quoted text claim on a group-1 field.
    expect(m.log).toContain("prior_override paradigm.required.epidemiology: the priors did not set it; taken as a text claim (0.9) with its quote");
    expect(m.provenance["paradigm.required.epidemiology"]).toEqual({ section: "s", quote: "q4" });
    // After the override lowered the prior to 0.5 it is still an overlay entry, so the text exclusion loses.
    expect(m.paradigm.required).toEqual({ clinical_trials: 0.5, epidemiology: 0.9 });
    expect(m.paradigm.excluded).toEqual({});
  });

  it("a verified override on a field the priors did not set becomes a text claim on the group's own fields only", () => {
    const m = mergeExtractions(optional(), [
      extraction(2, { prior_overrides: [{ field: "paradigm.excluded", from: {}, to: { molecular_cellular_mechanistic: 1, bogus: 1 }, quote: "Mechanistic studies are not responsive", section: "s" }] }),
      extraction(2, { prior_overrides: [{ field: "paradigm.required.clinical_trials", from: null, to: 0.9, quote: "q", section: "s" }] }, { chunk: 2, of: 2 }),
      extraction(3, { prior_overrides: [{ field: "design.prohibited.rct", from: false, to: true, quote: "q", section: "s" }] }),
    ]);
    expect(m.paradigm.excluded).toEqual({ molecular_cellular_mechanistic: 1 });
    expect(m.provenance["paradigm.excluded"]).toEqual({ section: "s", quote: "Mechanistic studies are not responsive" });
    expect(m.paradigm.required).toEqual({});
    expect(m.design.prohibited).toEqual([]);
    expect(m.log).toContain("prior_override paradigm.excluded: the priors did not set it; taken as a text claim with its quote");
    expect(m.log).toContain("prior_override paradigm.required.clinical_trials: the priors did not set it; ignored");
    expect(m.log).toContain("prior_override design.prohibited.rct: the priors did not set it; ignored");
  });

  it("group precedence: group 2 never adds requirements, group 3 fills eligibility and team only; provenance keeps the first quote per field", () => {
    const m = mergeExtractions(optional(), [
      extraction(1, { paradigm: { required: { epidemiology: 0.8 }, required_any: {}, allowed: {}, excluded: {} }, evidence: [{ field: "paradigm.required", quote: "q-a", section: "s1" }], confidence: "high" }),
      extraction(2, { paradigm: { required: { clinical_trials: 0.9 }, required_any: {}, allowed: {}, excluded: {} }, non_responsive: ["item"], evidence: [{ field: "paradigm.required", quote: "q-b", section: "s2" }, { field: "non_responsive", quote: "item", section: "s2" }] }),
      extraction(3, { eligibility: { investigator_rules: ["rule"], esi_only: true, new_investigator_only: false, clinician_required: false, degree_required: null, independent_appointment_required: false, citizenship_rule: null }, team: { multi_pi_allowed: true, consortium_required: null, required_partners: ["a health system"] } }),
    ]);
    expect(m.paradigm.required).toEqual({ epidemiology: 0.8 });
    expect(m.non_responsive).toEqual(["item"]);
    expect(m.eligibility.esi_only).toBe(true);
    expect(m.eligibility.investigator_rules).toEqual(["rule"]);
    expect(m.team).toEqual({ multi_pi_allowed: true, consortium_required: null, required_partners: ["a health system"] });
    expect(m.provenance["paradigm.required"]).toEqual({ section: "s1", quote: "q-a" });
    expect(m.provenance["non_responsive"]).toEqual({ section: "s2", quote: "item" });
    expect(m.confidence).toBe("high");
    expect(m.needs_review).toBe(false);
  });

  it("a prohibited design beats a text required_any; allowed lists never repeat requirements", () => {
    const m = mergeExtractions(optional(), [
      extraction(1, { design: { required_any: ["rct", "pragmatic_trial"], required_any_2: [], allowed: ["rct", "survey"], prohibited: [] }, unit: { required: ["L4"], allowed: ["L4", "L5"] } }),
      extraction(2, { design: { required_any: [], required_any_2: [], allowed: [], prohibited: ["pragmatic_trial", "survey"] } }),
    ]);
    expect(m.design.required_any).toEqual(["rct"]);
    expect(m.design.prohibited).toEqual(["pragmatic_trial", "survey"]);
    expect(m.design.allowed).toEqual([]);
    expect(m.unit.allowed).toEqual(["L5"]);
    expect(m.needs_review).toBe(true);
  });

  it("confidence is the minimum over group-1 chunks; an unusable reply merges nothing; no group 1 → null", () => {
    const m = mergeExtractions(optional(), [extraction(1, { confidence: "high" }), extraction(1, { confidence: "low" }, { chunk: 2, of: 2 }), extraction(2, { paradigm: { required: {}, required_any: {}, allowed: {}, excluded: { animal_model: 1 } } }, { usable: false, dropped: ["output: not valid JSON"] })]);
    expect(m.confidence).toBe("low");
    expect(m.paradigm.excluded).toEqual({});
    expect(m.log).toContain("group 2: reply unusable (output: not valid JSON); nothing merged");
    expect(mergeExtractions(optional(), [extraction(3, {})]).confidence).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Exemplar prior and blend
// ---------------------------------------------------------------------------

const exemplar = (n: number, over: Partial<ExemplarRecord> = {}): ExemplarRecord => ({
  opportunity_number: "PAR-25-122",
  project_num: `5R01XX00000${n}-01`,
  core_project_num: `R01XX00000${n}`,
  awarded_under: "PAR-25-122",
  lineage_depth: 0,
  fiscal_year: 2025,
  title: `Exemplar ${n}`,
  abstract: "This project tests a multilevel intervention to increase tobacco cessation treatment in community health centers using a stepped-wedge design.",
  activity_code: "R01",
  rcdc_categories: ["Health Services", "Behavioral and Social Science"],
  study_section: null,
  study_section_code: null,
  ...over,
});

describe("exemplarPrior", () => {
  it("classifies each abstract with the rules, skips rows without an abstract, never calls a model that was not injected", async () => {
    const prior = await exemplarPrior([exemplar(1), exemplar(2, { rcdc_categories: ["Clinical Trials and Supportive Activities"] }), exemplar(3, { abstract: null })], { rules });
    expect(prior.rows).toBe(3);
    expect(prior.classified).toBe(2);
    expect(prior.items.map((i) => [i.classified, i.model_needed, i.model_called, i.cache])).toEqual([
      [true, true, false, "n/a"],
      [true, true, false, "n/a"],
      [false, false, false, "n/a"],
    ]);
    expect(prior.items[0]!.rules_fired).toEqual(expect.arrayContaining(["reporter_rcdc_hsr", "reporter_rcdc_behavioral"]));
    expect(prior.items[1]!.rules_fired).toContain("reporter_rcdc_clinical_trials");
    // health_services .7 and clinical_trials .7 tie at the top → both 1; behavioral .6 → 0.857.
    expect(prior.axes.paradigm).toEqual({ health_services: 1, clinical_trials: 1, behavioral: 0.857 });
    expect(prior.axes.design).toEqual({});
    expect(prior.rcdc).toEqual(["Behavioral and Social Science", "Health Services", "Clinical Trials and Supportive Activities"]);
    expect(prior.model_calls).toBe(0);
  });

  it("with a model and a budget: one call, cached, the second exemplar with the same text is a hit and costs nothing", async () => {
    const cache = new InMemoryItemProfileCache();
    let calls = 0;
    const model: ModelFn = async () => {
      calls += 1;
      return JSON.stringify({ paradigm: { implementation_science: 0.9 }, design: { hybrid_effectiveness_implementation: 0.8 }, unit: { L5: 0.8 }, confidence: "high" });
    };
    const budget = new ModelBudget(1);
    const prior = await exemplarPrior([exemplar(1), exemplar(2), exemplar(3, { abstract: "A different abstract about mouse models of colitis and epithelial repair." })], { rules, model, cache, budget });
    expect(calls).toBe(1);
    expect(budget.used).toBe(1);
    expect(prior.items.map((i) => [i.model_called, i.cache])).toEqual([
      [true, "miss"],
      [false, "hit"],
      [false, "n/a"],
    ]);
    // Rules override the model on paradigm (RCDC fired); the model fills design and unit.
    expect(prior.items[0]!.decided_by).toEqual({ paradigm: "rules", unit: "llm", design: "llm" });
    expect(prior.axes.design).toEqual({ hybrid_effectiveness_implementation: 1 });
    expect(prior.model_calls).toBe(1);
  });

  it("aggregateExemplarAxes: mean scaled to max 1", () => {
    const p = (paradigm: Record<string, number>): ItemProfile =>
      ({ id: "x", kind: "grant", source: "reporter", year: null, role: null, taxonomy_version: TAXONOMY_VERSION, paradigm, unit: {}, design: {}, materials: {}, objective: {}, topic: { mesh: [], mesh_major: [], rcdc: [], terms: [] }, confidence: "high", decided_by: {}, rules_fired: [], justification: {} }) as ItemProfile;
    const axes = aggregateExemplarAxes([p({ animal_model: 1 }), p({ animal_model: 0.5, translational: 0.5 }), p({})]);
    expect(axes.paradigm).toEqual({ animal_model: 1, translational: 0.333 });
    expect(aggregateExemplarAxes([]).paradigm).toEqual({});
  });
});

describe("blend", () => {
  const text = (over: Partial<MergeResult> = {}): MergeResult => ({
    ...mergeExtractions(deterministicOverlays(notice({ clinical_trial_designation: "optional", activity_code: "R01" })), []),
    paradigm: { required: { molecular_cellular_mechanistic: 0.9 }, required_any: {}, allowed: { preclinical: 0.7 }, excluded: { clinical_trials: 1 } },
    objective: { mechanism_discovery: 0.8 },
    ...over,
  });
  const ex = (paradigm: Record<string, number>, unit: Record<string, number> = {}): ExemplarPrior => ({ rows: 0, classified: 0, axes: { paradigm, unit, design: {}, materials: {}, objective: { therapeutic_development: 1 } }, rcdc: [], items: [], model_calls: 0 });

  it("reads the weights from taxonomy.opportunity_profile.exemplar_blend", () => {
    const rows = OPP.exemplar_blend;
    const high = rows.find((r) => r.min_exemplars === 15)!;
    const mid = rows.find((r) => r.min_exemplars === 5)!;
    expect(blendWeights(20)).toMatchObject({ exemplar: high.exemplar_weight, text: 1 - high.exemplar_weight });
    expect(blendWeights(15)).toMatchObject({ exemplar: high.exemplar_weight });
    expect(blendWeights(14)).toMatchObject({ exemplar: mid.exemplar_weight, text: 1 - mid.exemplar_weight });
    expect(blendWeights(5)).toMatchObject({ exemplar: mid.exemplar_weight });
    expect(blendWeights(4)).toMatchObject({ exemplar: 0, text: 1 });
    expect(blendWeights(0)).toMatchObject({ exemplar: 0, text: 1 });
  });

  it("≥ 15 exemplars: 0.6 exemplar / 0.4 text over the union; excluded categories never re-enter", () => {
    const b = blend(text(), { ...ex({ animal_model: 1, molecular_cellular_mechanistic: 0.5, clinical_trials: 0.4 }, { L2: 1, L1: 0.5 }), classified: 20 }, 20);
    expect(b.weights).toMatchObject({ n: 20, exemplar: 0.6, text: 0.4 });
    expect(b.paradigm_required).toEqual({ animal_model: 0.6, molecular_cellular_mechanistic: 0.66 });
    expect(b.objective).toEqual({ therapeutic_development: 0.6, mechanism_discovery: 0.32 });
    expect(b.log).toContain("exemplars carry clinical_trials 0.4 but the text excludes it; not blended");
    // A list axis gains an exemplar category when w_e · share ≥ w_t: L2 (0.6 ≥ 0.4) yes, L1 (0.3) no.
    expect(b.unit_allowed).toEqual(["L2"]);
  });

  it("5–14 exemplars: 0.4 / 0.6; fewer than 5: text only", () => {
    const mid = blend(text(), { ...ex({ animal_model: 1 }), classified: 7 }, 7);
    expect(mid.paradigm_required).toEqual({ molecular_cellular_mechanistic: 0.54, animal_model: 0.4 });
    expect(mid.unit_allowed).toEqual([]);
    const low = blend(text(), { ...ex({ animal_model: 1 }), classified: 3 }, 3);
    expect(low.weights.exemplar).toBe(0);
    expect(low.paradigm_required).toEqual({ molecular_cellular_mechanistic: 0.9 });
    expect(blend(text(), null, 0).paradigm_required).toEqual({ molecular_cellular_mechanistic: 0.9 });
  });
});

// ---------------------------------------------------------------------------
// Confidence, selection predicate
// ---------------------------------------------------------------------------

describe("profileConfidence / profileDue / selectDue", () => {
  it("full text as returned; synopsis capped at medium; no text → low", () => {
    expect(profileConfidence("high", "full_text")).toBe("high");
    expect(profileConfidence(null, "full_text")).toBe("low");
    expect(profileConfidence("high", "synopsis")).toBe("medium");
    expect(profileConfidence("low", "synopsis")).toBe("low");
    expect(profileConfidence("high", "none")).toBe("low");
  });

  it("due when there is no profile, the hash changed, or the taxonomy moved; not otherwise; onlyChanged false → always", () => {
    const c: CandidateNotice = { id: "a", opportunity_number: "PAR-1", guide_html_hash: "h2", posted_date: "2026-09-01" };
    const same: ExistingProfile = { opportunity_id: "a", taxonomy_version: TAXONOMY_VERSION, guide_html_hash: "h2", computed_at: "t" };
    expect(profileDue(c, undefined, { onlyChanged: true })).toEqual({ due: true, reason: "no profile" });
    expect(profileDue(c, same, { onlyChanged: true })).toEqual({ due: false, reason: "up to date" });
    expect(profileDue(c, { ...same, guide_html_hash: "h1" }, { onlyChanged: true })).toEqual({ due: true, reason: "guide_html_hash changed" });
    expect(profileDue(c, { ...same, taxonomy_version: "fit-v0" }, { onlyChanged: true })).toEqual({ due: true, reason: `taxonomy fit-v0 → ${TAXONOMY_VERSION}` });
    expect(profileDue(c, same, { onlyChanged: false })).toEqual({ due: true, reason: "rebuild requested" });
  });

  it("selectDue: never-profiled first in the given order, then changed, capped at limit", () => {
    const cs: CandidateNotice[] = ["a", "b", "c", "d"].map((id) => ({ id, opportunity_number: id, guide_html_hash: "h", posted_date: null }));
    const existing = new Map<string, ExistingProfile>([
      ["a", { opportunity_id: "a", taxonomy_version: TAXONOMY_VERSION, guide_html_hash: "old", computed_at: "t" }],
      ["c", { opportunity_id: "c", taxonomy_version: TAXONOMY_VERSION, guide_html_hash: "h", computed_at: "t" }],
    ]);
    expect(selectDue(cs, existing, { onlyChanged: true, limit: 10 }).map((c) => `${c.id}:${c.reason}`)).toEqual(["b:no profile", "d:no profile", "a:guide_html_hash changed"]);
    expect(selectDue(cs, existing, { onlyChanged: true, limit: 2 }).map((c) => c.id)).toEqual(["b", "d"]);
  });
});

// ---------------------------------------------------------------------------
// The six fixture notices with the mocked model
// ---------------------------------------------------------------------------

describe("the six notice-extractor fixtures (mocked model)", () => {
  for (const f of NOTICE_FIXTURES) {
    it(`fixture ${f.n} · ${f.label} (${f.notice.opportunity_number})`, async () => {
      const { fn, calls } = fixtureModel(f);
      const extractionCache = new InMemoryNoticeExtractionCache();
      const build = await buildOpportunityFitProfileFrom(
        { notice: f.notice, exemplars: f.exemplars },
        { rules, extractor: fn, extractModel: "mock", classifier: null, extractionCache, now: () => new Date("2026-09-05T00:00:00Z") }
      );
      const checks = checkNoticeFixture(build, f.expect);
      const misses = checks.filter((c) => !c.ok);
      expect(misses.map((m) => m.note), formatNoticeChecks(checks).join("\n")).toEqual([]);
      // No claim was dropped for a failed quote — every fixture quote is verbatim.
      const dropped = build.runs.flatMap((r) => r.extraction?.dropped ?? []).filter((d) => /claim dropped|no verified quote|not found in/.test(d));
      expect(dropped).toEqual([]);
      expect(build.profile.taxonomy_version).toBe(TAXONOMY_VERSION);
      expect(build.row.opportunity_id).toBe(f.notice.id);
      expect(calls.length).toBe(Object.keys(f.model_output).length);
      expect(extractionCache.writes).toBe(calls.length);
      // Every provenance quote verifies against the sections the model saw.
      for (const q of Object.values(build.profile.provenance)) {
        expect(verifyQuote(q.quote, q.section, build.text.sections).ok).toBe(true);
      }
    });
  }

  it("fixture 6 (synopsis only) reads one group, caps confidence at medium and stores no guide hash; a notice with no text at all is low", async () => {
    const f = NOTICE_FIXTURES.find((x) => x.n === 6)!;
    const { fn, calls } = fixtureModel(f);
    const build = await buildOpportunityFitProfileFrom({ notice: f.notice, exemplars: [] }, { rules, extractor: fn, extractModel: "mock", classifier: null });
    expect(calls).toHaveLength(1);
    expect(build.runs.map((r) => r.group)).toEqual([1]);
    expect(build.merged.confidence).toBe("high");
    expect(build.profile.confidence).toBe("medium");
    expect(build.row.guide_html_hash).toBeNull();
    expect(build.row.sources.text).toBe("synopsis");
    const none = await buildOpportunityFitProfileFrom({ notice: { ...f.notice, description: null }, exemplars: [] }, { rules, extractor: noModel, classifier: null });
    expect(none.profile.confidence).toBe("low");
    expect(none.profile.sources.text).toBe("none");
    expect(none.runs).toEqual([]);
  });

  it("fixture 1 without an extractor: overlays and exemplars only, confidence low, nothing quoted", async () => {
    const f = NOTICE_FIXTURES[0]!;
    const build = await buildOpportunityFitProfileFrom({ notice: f.notice, exemplars: [] }, { rules, extractor: null, classifier: null });
    expect(build.runs).toEqual([]);
    expect(build.profile.paradigm.required).toEqual({ clinical_trials: 1 });
    expect(build.profile.confidence).toBe("low");
    expect(build.profile.provenance).toEqual({});
    expect(build.row.sources.extract_model).toBeNull();
  });
});
