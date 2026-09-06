import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import fixture from "@/lib/fit/__fixtures__/mesh-descriptors-subset.json";
import { InMemoryItemProfileCache } from "@/lib/fit/classify/cache";
import { VOCABULARY_PROMPT, type ModelFn, type ModelRequest } from "@/lib/fit/classify/llm";
import { buildMeshIndex, type MeshDescriptorRow } from "@/lib/fit/classify/mesh";
import { DEFAULT_RULE_TABLES, evaluateRules, type EvaluateContext } from "@/lib/fit/classify/rules";
import {
  aggregateExemplarAxes,
  blend,
  blendWeights,
  buildExtractorUserPrompt,
  buildOpportunityFitProfileFrom,
  chunkSections,
  deterministicOverlays,
  ELIDED_QUOTE_REASON,
  emptyGroupOutput,
  exemplarPrior,
  extractionCacheKey,
  EXTRACTOR_SYSTEM_PROMPT,
  extractWithModel,
  GROUP_SCHEMAS,
  groupSections,
  InMemoryNoticeExtractionCache,
  issuingIc,
  mergeExtractions,
  MIN_CALLS_PER_NOTICE,
  ModelBudget,
  NIH_NOTICE_FILTER,
  normalizeForMatch,
  profileConfidence,
  profileDue,
  QUOTE_REMINDER,
  runOpportunityProfiles,
  sectionLabel,
  selectDue,
  SKIPPED_BUDGET,
  SKIPPED_TIME,
  validateGroupOutput,
  verifyQuote,
  type CandidateNotice,
  type ExemplarPrior,
  type ExemplarRecord,
  type ExistingProfile,
  type GroupExtraction,
  type GroupInput,
  type MergeResult,
  type NoticeHeader,
  type NoticeRecord,
  type NoticeSection,
  type OpportunityProfileStore,
} from "@/lib/fit/profile/opportunity";
import { checkNoticeFixture, fixtureModel, formatNoticeChecks, NOTICE_FIXTURES } from "@/lib/fit/profile/opportunity-fixtures";
import taxonomy from "@/lib/fit/taxonomy.json";
import { TAXONOMY_VERSION } from "@/lib/fit/taxonomy";
import type { ItemProfile } from "@/lib/fit/types";
import { contentHash } from "@/lib/outreach/embeddings";

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

const header = (over: Partial<NoticeHeader> = {}): NoticeHeader => ({ number: "X", title: "T", agency: null, activity_code: null, activity_title: null, clinical_trial_designation: null, issuing_ic: null, program_division: null, ...over });

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

  it("the cache key is the hash of the taxonomy version and the exact prompt (S4): header, group, chunk, priors, sections, reminder and schema all change it", () => {
    const priors = { paradigm_required: { clinical_trials: 1 }, paradigm_allowed: {}, paradigm_excluded: {}, unit_required: ["L3"], design_required_any: [], design_prohibited: [], materials_required: [] };
    const base: GroupInput = { header: header(), group: 1, chunk: 1, of: 1, priors, sections: [section("A", "text")] };
    const k = extractionCacheKey(base);
    expect(k).toMatch(/^[0-9a-f]{40}$/);
    expect(k).toBe(contentHash([TAXONOMY_VERSION, EXTRACTOR_SYSTEM_PROMPT, buildExtractorUserPrompt(base)].join("\n")));
    // The prompt embeds the reminder and the group schema, so editing either edits the key.
    expect(buildExtractorUserPrompt(base)).toContain(QUOTE_REMINDER);
    expect(buildExtractorUserPrompt(base)).toContain(GROUP_SCHEMAS[1]);
    expect(buildExtractorUserPrompt({ ...base, group: 2 })).toContain(GROUP_SCHEMAS[2]);
    expect(extractionCacheKey({ ...base, header: header({ clinical_trial_designation: "required" }) })).not.toBe(k);
    expect(extractionCacheKey({ ...base, header: header({ title: "Other title" }) })).not.toBe(k);
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
    expect(verifyQuote("Applications must propose a randomized clinical trial", "Part 2 · Section I · Research Objectives", sections)).toEqual({ ok: true, section: "Part 2 · Section I · Research Objectives", corrected: false });
    expect(verifyQuote("randomized   clinical trial of a digital\n health intervention", "Research Objectives", sections)).toMatchObject({ ok: true, corrected: false });
    expect(verifyQuote("Applications must propose a mouse study", "Research Objectives", sections)).toMatchObject({ ok: false });
    expect(verifyQuote("", "Research Objectives", sections)).toMatchObject({ ok: false, reason: "empty quote" });
  });

  it("a quote found in another section verifies with the section corrected", () => {
    const r = verifyQuote("Studies limited to animal models", "Part 2 · Section I · Research Objectives", sections);
    expect(r).toEqual({ ok: true, section: "Part 2 · Section I · Non-Responsive Applications", corrected: true });
  });

  it("an elided quote (text on both sides of \"...\" or …) is rejected outright (S1, D22); a marker at either end is decoration; a bare marker is empty", () => {
    expect(verifyQuote("Applications must propose ... digital health intervention", "Research Objectives", sections)).toEqual({ ok: false, reason: ELIDED_QUOTE_REASON });
    expect(verifyQuote("Applications must propose … digital health intervention", "Research Objectives", sections)).toEqual({ ok: false, reason: ELIDED_QUOTE_REASON });
    // Even when both fragments are verbatim and in order — the hidden words could reverse the claim.
    expect(verifyQuote("Applications must propose a randomized . . . intervention.", "Research Objectives", sections)).toEqual({ ok: false, reason: ELIDED_QUOTE_REASON });
    // Trivial fragments are elided quotes too.
    expect(verifyQuote("a ... the", "Research Objectives", sections)).toEqual({ ok: false, reason: ELIDED_QUOTE_REASON });
    // One verbatim fragment with a marker at an end still verifies (the marker is stripped, nothing is hidden inside).
    expect(verifyQuote("Applications must propose a randomized...", "Research Objectives", sections)).toMatchObject({ ok: true });
    expect(verifyQuote("…a randomized clinical trial…", "Research Objectives", sections)).toMatchObject({ ok: true });
    expect(verifyQuote("...", "Research Objectives", sections)).toMatchObject({ ok: false, reason: "empty quote" });
    expect(verifyQuote("… …", "Research Objectives", sections)).toMatchObject({ ok: false, reason: "empty quote" });
  });

  it("an elided evidence quote drops its claim in validateGroupOutput", () => {
    const raw = {
      paradigm: { required: { clinical_trials: 0.9 }, required_any: {}, allowed: {}, excluded: {} },
      evidence: [{ field: "paradigm.required.clinical_trials", quote: "Applications must propose ... intervention.", section: "Research Objectives" }],
      confidence: "high",
    };
    const { output, dropped } = validateGroupOutput(raw, 1, sections);
    expect(output.paradigm.required).toEqual({});
    expect(dropped).toContain(`evidence paradigm.required.clinical_trials: quote "Applications must propose ... intervention." ${ELIDED_QUOTE_REASON}; claim dropped`);
    expect(dropped).toContain("paradigm.required.clinical_trials: no verified quote (evidence quote failed)");
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
    // The log says whether an evidence entry existed for the field (its quote failed) or none did.
    expect(dropped).toContain("paradigm.required.epidemiology: no verified quote (evidence quote failed)");
    expect(dropped).toContain("paradigm.allowed.behavioral: no verified quote (no evidence entry)");
    expect(output.paradigm.allowed).toEqual({});
    expect(output.unit).toEqual({ required: ["L3"], allowed: [] });
    expect(dropped).toContain("unit.allowed.L9: unknown id");
    expect(dropped.some((d) => /evidence unit: section corrected from "Wrong Section"/.test(d))).toBe(true);
    expect(output.design.required_any).toEqual(["rct"]);
    expect(output.materials).toEqual({ expected: [], human_required: null });
    expect(dropped).toContain("materials.expected.enrolled_participants: no verified quote (no evidence entry)");
    expect(dropped).toContain("materials.human_required: no verified quote (no evidence entry)");
    expect(output.population).toBeNull();
    expect(dropped).toContain("population: no verified quote (no evidence entry)");
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
    expect(dropped).toContain("mechanism.ceiling_direct_per_year: no verified quote (no evidence entry)");
  });

  it("group 3 has no contacts field (N2): a reply's contacts are ignored like any other stray key", () => {
    const raw = { eligibility: { investigator_rules: [] }, team: {}, contacts: [{ name: "Program Officer" }], evidence: [], confidence: "high" };
    const { dropped } = validateGroupOutput(raw, 3, sections);
    expect(dropped).toContain("contacts: ignored (group 3 does not fill it)");
    expect(GROUP_SCHEMAS[3]).not.toMatch(/contacts/);
  });

  it("a reply that is not JSON or was cut off is unusable and never cached", async () => {
    const cache = new InMemoryNoticeExtractionCache();
    let n = 0;
    const model: ModelFn = async () => {
      n += 1;
      return n === 1 ? "not json" : { content: JSON.stringify({ paradigm: {}, confidence: "high" }), finish_reason: "length" };
    };
    const priors = deterministicOverlays(notice({ clinical_trial_designation: "optional", activity_code: null })).priors;
    const runs = await extractWithModel([sections[0]!, sections[1]!], header(), priors, { model, modelName: "mock", cache });
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
    const priors = deterministicOverlays(notice({ clinical_trial_designation: "optional", activity_code: null })).priors;
    const budget = new ModelBudget(1);
    expect(budget.remaining).toBe(1);
    expect(budget.exhausted).toBe(false);
    const first = await extractWithModel(sections, header(), priors, { model, modelName: "mock", cache, budget });
    expect(first.map((r) => [r.group, r.cache, r.model_called, r.skipped])).toEqual([
      [1, "miss", true, null],
      [2, "miss", false, SKIPPED_BUDGET],
    ]);
    expect(budget.remaining).toBe(0);
    expect(budget.exhausted).toBe(true);
    expect(budget.take()).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.model).toBe("mock");
    expect(calls[0]!.user).toMatch(/^Section group: 1$/m);
    const second = await extractWithModel(sections, header(), priors, { model, modelName: "mock", cache, budget: new ModelBudget(5) });
    expect(second.map((r) => [r.group, r.cache, r.model_called])).toEqual([
      [1, "hit", false],
      [2, "miss", true],
    ]);
    expect(calls).toHaveLength(2);
    expect(cache.rows.size).toBe(2);
  });

  it("extractWithModel: past the deadline a chunk is skipped for time; a cache hit is still served (S5)", async () => {
    const cache = new InMemoryNoticeExtractionCache();
    let calls = 0;
    const model: ModelFn = async () => {
      calls += 1;
      return JSON.stringify({ paradigm: {}, confidence: "high" });
    };
    const priors = deterministicOverlays(notice({ clinical_trial_designation: "optional", activity_code: null })).priors;
    // Only group 1 gets cached (budget 1), then the deadline is already past.
    await extractWithModel(sections, header(), priors, { model, modelName: "mock", cache, budget: new ModelBudget(1) });
    const runs = await extractWithModel(sections, header(), priors, { model, modelName: "mock", cache, deadline: Date.now() - 1 });
    expect(runs.map((r) => [r.group, r.cache, r.model_called, r.skipped])).toEqual([
      [1, "hit", false, null],
      [2, "miss", false, SKIPPED_TIME],
    ]);
    expect(calls).toBe(1);
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

  it("only a designation requirement survives a text exclusion (S3, D22): a K23 under an unknown designation loses clinical_trials to \"clinical trials are not responsive\"", () => {
    const o = deterministicOverlays(notice({ activity_code: "K23", clinical_trial_designation: "unknown" }));
    expect(o.origin["paradigm.required.clinical_trials"]).toBe("activity_code");
    expect(o.paradigm.required).toEqual(OPP.activity_code_priors.K23.r);
    const m = mergeExtractions(o, [
      extraction(2, {
        paradigm: { required: {}, required_any: {}, allowed: {}, excluded: { clinical_trials: 1 } },
        non_responsive: ["Applications proposing clinical trials are not responsive."],
        evidence: [{ field: "paradigm.excluded.clinical_trials", quote: "clinical trials are not responsive", section: "s" }],
      }),
    ]);
    expect(m.paradigm.excluded).toEqual({ clinical_trials: 1 });
    expect(m.paradigm.required).toEqual({ clinical_observational: OPP.activity_code_priors.K23.r.clinical_observational });
    expect(m.needs_review).toBe(true);
    expect(m.log).toContain("conflict: clinical_trials both excluded and in paradigm.required (activity_code prior); excluded wins, requirement dropped; needs_review");
    expect(m.origin["paradigm.required.clinical_observational"]).toBe("activity_code");
    expect(m.overlay_required).toEqual(OPP.activity_code_priors.K23.r);
    // A division prior yields the same way.
    const d = deterministicOverlays(notice({ activity_code: "R01", clinical_trial_designation: "optional", program_division: "Division of Cancer Control and Population Sciences (DCCPS)" }));
    const md = mergeExtractions(d, [extraction(1, { paradigm: { required: { epidemiology: 0.8 }, required_any: {}, allowed: {}, excluded: { epidemiology: 0.9 } } })]);
    expect(md.paradigm.required).toEqual({});
    expect(md.paradigm.allowed.epidemiology).toBeUndefined();
    expect(md.needs_review).toBe(true);
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
  it("classifies each abstract with the rules, skips rows without an abstract, never calls a model that was not injected; the prior is the plain mean (D21)", async () => {
    const prior = await exemplarPrior([exemplar(1), exemplar(2, { rcdc_categories: ["Clinical Trials and Supportive Activities"] }), exemplar(3, { abstract: null })], { rules });
    expect(prior.rows).toBe(3);
    expect(prior.classified).toBe(2);
    expect(prior.informative).toBe(2);
    expect(prior.budget_skipped).toBe(0);
    expect(prior.items.map((i) => [i.classified, i.model_needed, i.model_called, i.budget_skipped, i.cache])).toEqual([
      [true, true, false, false, "n/a"],
      [true, true, false, false, "n/a"],
      [false, false, false, false, "n/a"],
    ]);
    expect(prior.items[0]!.rules_fired).toEqual(expect.arrayContaining(["reporter_rcdc_hsr", "reporter_rcdc_behavioral"]));
    expect(prior.items[1]!.rules_fired).toContain("reporter_rcdc_clinical_trials");
    // Plain mean over the 2 classified: health_services .7 / 2, clinical_trials .7 / 2, behavioral .6 / 2 — no rescaling.
    expect(prior.axes.paradigm).toEqual({ clinical_trials: 0.35, health_services: 0.35, behavioral: 0.3 });
    expect(prior.axes.design).toEqual({});
    expect(prior.rcdc).toEqual(["Behavioral and Social Science", "Health Services", "Clinical Trials and Supportive Activities"]);
    expect(prior.model_calls).toBe(0);
  });

  it("with a model and a budget: one call, cached, the same text is a hit; the third exemplar the budget cannot pay for is budget_skipped (B1)", async () => {
    const cache = new InMemoryItemProfileCache();
    let calls = 0;
    const model: ModelFn = async () => {
      calls += 1;
      return JSON.stringify({ paradigm: { implementation_science: 0.9 }, design: { hybrid_effectiveness_implementation: 0.8 }, unit: { L5: 0.8 }, confidence: "high" });
    };
    const budget = new ModelBudget(1);
    const prior = await exemplarPrior([exemplar(1), exemplar(2), exemplar(3, { abstract: "A different abstract about mouse models of colitis and epithelial repair." })], { rules, model, cache, budget });
    expect(calls).toBe(1);
    expect(budget.remaining).toBe(0);
    expect(prior.items.map((i) => [i.model_called, i.cache, i.budget_skipped, i.skipped])).toEqual([
      [true, "miss", false, null],
      [false, "hit", false, null],
      [false, "n/a", true, SKIPPED_BUDGET],
    ]);
    expect(prior.budget_skipped).toBe(1);
    // Rules override the model on paradigm (RCDC fired); the model fills design and unit.
    expect(prior.items[0]!.decided_by).toEqual({ paradigm: "rules", unit: "llm", design: "llm" });
    // Mean over 3 classified: 0.8 · 2 / 3 — the rules-only third exemplar carries no design.
    expect(prior.axes.design).toEqual({ hybrid_effectiveness_implementation: 0.533 });
    expect(prior.axes.paradigm).toEqual({ health_services: 0.7, behavioral: 0.6 });
    expect(prior.informative).toBe(3);
    expect(prior.model_calls).toBe(1);
  });

  it("past the deadline an exemplar the model is needed for is budget_skipped for time; a cached one is still a hit (S5)", async () => {
    const cache = new InMemoryItemProfileCache();
    let calls = 0;
    const model: ModelFn = async () => {
      calls += 1;
      return JSON.stringify({ design: { hybrid_effectiveness_implementation: 0.8 }, confidence: "high" });
    };
    await exemplarPrior([exemplar(1)], { rules, model, cache });
    const prior = await exemplarPrior([exemplar(1), exemplar(2, { abstract: "A different abstract about mouse models of colitis and epithelial repair." })], { rules, model, cache, deadline: Date.now() - 1 });
    expect(calls).toBe(1);
    expect(prior.items.map((i) => [i.cache, i.budget_skipped, i.skipped])).toEqual([
      ["hit", false, null],
      ["n/a", true, SKIPPED_TIME],
    ]);
  });

  it("aggregateExemplarAxes: plain mean, sum / number of profiles (D21)", () => {
    const p = (paradigm: Record<string, number>): ItemProfile =>
      ({ id: "x", kind: "grant", source: "reporter", year: null, role: null, taxonomy_version: TAXONOMY_VERSION, paradigm, unit: {}, design: {}, materials: {}, objective: {}, topic: { mesh: [], mesh_major: [], rcdc: [], terms: [] }, confidence: "high", decided_by: {}, rules_fired: [], justification: {} }) as ItemProfile;
    const axes = aggregateExemplarAxes([p({ animal_model: 1 }), p({ animal_model: 0.5, translational: 0.5 }), p({})]);
    expect(axes.paradigm).toEqual({ animal_model: 0.5, translational: 0.167 });
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
  const ex = (paradigm: Record<string, number>, unit: Record<string, number> = {}, n = 20): ExemplarPrior => ({ rows: n, classified: n, informative: n, budget_skipped: 0, axes: { paradigm, unit, design: {}, materials: {}, objective: { therapeutic_development: 1 } }, rcdc: [], items: [], model_calls: 0 });

  it("reads the weights and list_min_share from taxonomy.opportunity_profile.exemplar_blend", () => {
    const rows = OPP.exemplar_blend;
    const high = rows.find((r) => r.min_exemplars === 15)!;
    const mid = rows.find((r) => r.min_exemplars === 5)!;
    expect(blendWeights(20)).toMatchObject({ exemplar: high.exemplar_weight, text: 1 - high.exemplar_weight, list_min_share: high.list_min_share });
    expect(blendWeights(15)).toMatchObject({ exemplar: high.exemplar_weight });
    expect(blendWeights(14)).toMatchObject({ exemplar: mid.exemplar_weight, text: 1 - mid.exemplar_weight, list_min_share: mid.list_min_share });
    expect(blendWeights(5)).toMatchObject({ exemplar: mid.exemplar_weight });
    expect(blendWeights(4)).toMatchObject({ exemplar: 0, text: 1, list_min_share: 0 });
    expect(blendWeights(0)).toMatchObject({ exemplar: 0, text: 1 });
  });

  it("≥ 15 exemplars (D21): a required category is 0.4 · text + 0.6 · share; an exemplar-only category enters allowed at 0.6 · share; excluded ones never re-enter; list axes need share ≥ list_min_share", () => {
    const b = blend(text(), ex({ animal_model: 1, molecular_cellular_mechanistic: 0.5, clinical_trials: 0.4 }, { L2: 1, L1: 0.4 }), 20);
    expect(b.weights).toMatchObject({ n: 20, exemplar: 0.6, text: 0.4, list_min_share: 0.5 });
    // molecular_cellular_mechanistic: 0.4 · 0.9 + 0.6 · 0.5 = 0.66; animal_model is not required by the text → allowed, never required.
    expect(b.paradigm_required).toEqual({ molecular_cellular_mechanistic: 0.66 });
    expect(b.paradigm_allowed).toEqual({ preclinical: 0.7, animal_model: 0.6 });
    expect(b.log).toContain("paradigm.allowed += animal_model 0.6 (exemplar share 1)");
    expect(b.objective).toEqual({ therapeutic_development: 0.6, mechanism_discovery: 0.32 });
    expect(b.log).toContain("exemplars carry clinical_trials 0.4 but the text excludes it; not blended");
    // A list axis gains an exemplar category when share ≥ list_min_share (0.5): L2 (1) yes, L1 (0.4) no.
    expect(b.unit_allowed).toEqual(["L2"]);
    expect(b.log).toContain("unit.allowed += L2 (exemplar share 1)");
  });

  it("5–14 informative exemplars: 0.6 text / 0.4 exemplar; fewer than 5, or none informative: text only", () => {
    const mid = blend(text(), ex({ animal_model: 1 }, {}, 7), 7);
    expect(mid.weights).toMatchObject({ n: 7, exemplar: 0.4, text: 0.6 });
    expect(mid.paradigm_required).toEqual({ molecular_cellular_mechanistic: 0.54 });
    expect(mid.paradigm_allowed).toEqual({ preclinical: 0.7, animal_model: 0.4 });
    expect(mid.unit_allowed).toEqual([]);
    const low = blend(text(), ex({ animal_model: 1 }, {}, 3), 3);
    expect(low.weights.exemplar).toBe(0);
    expect(low.paradigm_required).toEqual({ molecular_cellular_mechanistic: 0.9 });
    expect(low.paradigm_allowed).toEqual({ preclinical: 0.7 });
    expect(blend(text(), null, 0).paradigm_required).toEqual({ molecular_cellular_mechanistic: 0.9 });
    // Twenty classified rows none of which carries a paradigm vector: text only.
    const blank = blend(text(), { ...ex({}, {}, 20), informative: 0 }, 0);
    expect(blank.weights.exemplar).toBe(0);
    expect(blank.paradigm_required).toEqual({ molecular_cellular_mechanistic: 0.9 });
  });

  it("a designation requirement is never below its overlay weight; an activity-code prior blends like text (D21)", () => {
    // Clinical Trial Required: clinical_trials 1 from the designation; exemplars carry it at 0.2 → 0.4 · 1 + 0.6 · 0.2 = 0.52 < 1 → 1 kept.
    const ct = mergeExtractions(deterministicOverlays(notice({ clinical_trial_designation: "required", activity_code: "R01" })), []);
    const b = blend(ct, ex({ clinical_trials: 0.2, health_services: 0.5 }), 20);
    expect(b.paradigm_required).toEqual({ clinical_trials: 1 });
    expect(b.log).toContain("paradigm.required.clinical_trials: designation prior 1 kept over the blend 0.52 (exemplar share 0.2)");
    expect(b.paradigm_allowed).toEqual({ health_services: 0.3 });
    // After a verified override lowered the prior to 0.8, the floor is 0.8.
    const lowered = mergeExtractions(deterministicOverlays(notice({ clinical_trial_designation: "required", activity_code: "R01" })), [
      extraction(1, { prior_overrides: [{ field: "paradigm.required.clinical_trials", from: 1, to: 0.8, quote: "q", section: "s" }] }),
    ]);
    expect(lowered.overlay_required).toEqual({ clinical_trials: 0.8 });
    expect(blend(lowered, ex({ clinical_trials: 0.2 }), 20).paradigm_required).toEqual({ clinical_trials: 0.8 });
    // K23 (activity-code prior clinical_observational 0.7, clinical_trials 0.6) under an unknown designation: 0.4 · 0.7 + 0.6 · 0 = 0.28, no floor.
    const k23 = mergeExtractions(deterministicOverlays(notice({ clinical_trial_designation: "unknown", activity_code: "K23" })), []);
    const bk = blend(k23, ex({ health_services: 1 }), 20);
    expect(bk.paradigm_required).toEqual({ clinical_observational: 0.28, clinical_trials: 0.24 });
    expect(bk.paradigm_allowed).toEqual({ health_services: 0.6 });
    // A required_any member the exemplars carry is neither blended nor moved to allowed.
    const besh = mergeExtractions(deterministicOverlays(notice({ clinical_trial_designation: "besh_required", activity_code: "R01" })), []);
    const bb = blend(besh, ex({ human_biospecimen: 0.5 }), 20);
    expect(bb.paradigm_allowed).toEqual({});
    expect(bb.log).toContain("exemplars carry human_biospecimen 0.5; already in paradigm.required_any, not added to allowed");
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

  it("due when there is no profile, the hash changed, the taxonomy moved, or the stored build is incomplete (B1); not otherwise; onlyChanged false → always", () => {
    const c: CandidateNotice = { id: "a", opportunity_number: "PAR-1", guide_html_hash: "h2", posted_date: "2026-09-01" };
    const same: ExistingProfile = { opportunity_id: "a", taxonomy_version: TAXONOMY_VERSION, guide_html_hash: "h2", computed_at: "t", sources: { complete: true, incomplete: [] } };
    expect(profileDue(c, undefined, { onlyChanged: true })).toEqual({ due: true, reason: "no profile" });
    expect(profileDue(c, same, { onlyChanged: true })).toEqual({ due: false, reason: "up to date" });
    // Rows written before the fix pass carry no sources.complete: treated as complete.
    expect(profileDue(c, { ...same, sources: undefined }, { onlyChanged: true })).toEqual({ due: false, reason: "up to date" });
    expect(profileDue(c, { ...same, sources: null }, { onlyChanged: true })).toEqual({ due: false, reason: "up to date" });
    expect(profileDue(c, { ...same, sources: { complete: false, incomplete: ["group 2: skipped (model budget spent)"] } }, { onlyChanged: true })).toEqual({ due: true, reason: "incomplete build" });
    expect(profileDue(c, { ...same, guide_html_hash: "h1" }, { onlyChanged: true })).toEqual({ due: true, reason: "guide_html_hash changed" });
    expect(profileDue(c, { ...same, taxonomy_version: "fit-v0" }, { onlyChanged: true })).toEqual({ due: true, reason: `taxonomy fit-v0 → ${TAXONOMY_VERSION}` });
    expect(profileDue(c, same, { onlyChanged: false })).toEqual({ due: true, reason: "rebuild requested" });
  });

  it("selectDue: never-profiled first in the given order, incomplete builds second, then changed, capped at limit", () => {
    const cs: CandidateNotice[] = ["a", "b", "c", "d", "e"].map((id) => ({ id, opportunity_number: id, guide_html_hash: "h", posted_date: null }));
    const existing = new Map<string, ExistingProfile>([
      ["a", { opportunity_id: "a", taxonomy_version: TAXONOMY_VERSION, guide_html_hash: "old", computed_at: "t" }],
      ["c", { opportunity_id: "c", taxonomy_version: TAXONOMY_VERSION, guide_html_hash: "h", computed_at: "t" }],
      ["e", { opportunity_id: "e", taxonomy_version: TAXONOMY_VERSION, guide_html_hash: "h", computed_at: "t", sources: { complete: false, incomplete: ["group 3: skipped (time budget)"] } }],
    ]);
    expect(selectDue(cs, existing, { onlyChanged: true, limit: 10 }).map((c) => `${c.id}:${c.reason}`)).toEqual(["b:no profile", "d:no profile", "e:incomplete build", "a:guide_html_hash changed"]);
    expect(selectDue(cs, existing, { onlyChanged: true, limit: 2 }).map((c) => c.id)).toEqual(["b", "d"]);
  });

  it("issuingIc (N1): the single nih_ic_tokens entry first, the RFA two-letter code as the fallback", () => {
    expect(issuingIc({ opportunity_number: "RFA-DK-26-315", nih_ic_tokens: ["NIDDK"] })).toBe("NIDDK");
    expect(issuingIc({ opportunity_number: "RFA-DK-26-315", nih_ic_tokens: [] })).toBe("DK");
    expect(issuingIc({ opportunity_number: "rfa-da-26-055", nih_ic_tokens: null })).toBe("DA");
    expect(issuingIc({ opportunity_number: "PAR-25-172", nih_ic_tokens: ["NCI", "NIA"] })).toBeNull();
    expect(issuingIc({ opportunity_number: "PAR-25-172", nih_ic_tokens: [" NCI "] })).toBe("NCI");
    expect(issuingIc({ opportunity_number: null, nih_ic_tokens: undefined })).toBeNull();
  });

  it("NIH_NOTICE_FILTER is the Guide sync's set: PR 0.6's NIH-like filter plus PAS-__-___", () => {
    expect(NIH_NOTICE_FILTER.split(",")).toEqual(["agency_code.like.HHS-NIH%", "opportunity_number.like.PA-%", "opportunity_number.like.PAR-%", "opportunity_number.like.RFA-%", "opportunity_number.like.PAS-__-___"]);
  });
});

// ---------------------------------------------------------------------------
// Incomplete builds, the runner (B1, S5, S6)
// ---------------------------------------------------------------------------

describe("incomplete builds and the runner", () => {
  const f1 = NOTICE_FIXTURES[0]!;

  it("a build with a budget-skipped chunk is stored with sources.complete false and the reasons; a full build is complete", async () => {
    const { fn } = fixtureModel(f1);
    const short = await buildOpportunityFitProfileFrom({ notice: f1.notice, exemplars: [] }, { rules, extractor: fn, extractModel: "mock", classifier: null, budget: new ModelBudget(1) });
    expect(short.row.sources.complete).toBe(false);
    expect(short.row.sources.incomplete).toEqual([`group 2: skipped (${SKIPPED_BUDGET})`, `group 3: skipped (${SKIPPED_BUDGET})`]);
    const full = await buildOpportunityFitProfileFrom({ notice: f1.notice, exemplars: [] }, { rules, extractor: fn, extractModel: "mock", classifier: null, budget: new ModelBudget(3) });
    expect(full.row.sources.complete).toBe(true);
    expect(full.row.sources.incomplete).toEqual([]);
    // An unusable reply is incomplete too.
    const bad = await buildOpportunityFitProfileFrom({ notice: f1.notice, exemplars: [] }, { rules, extractor: async () => "not json", extractModel: "mock", classifier: null });
    expect(bad.row.sources.complete).toBe(false);
    expect(bad.row.sources.incomplete[0]).toMatch(/^group 1: unusable reply \(output: not valid JSON/);
  });

  it("past the deadline every uncached chunk is skipped for time and every model-needing exemplar is budget-skipped: incomplete (S5)", async () => {
    const f3 = NOTICE_FIXTURES.find((x) => x.n === 3)!;
    const { fn } = fixtureModel(f3);
    const classifier: ModelFn = async () => JSON.stringify({ design: { prospective_cohort: 0.8 }, confidence: "high" });
    const build = await buildOpportunityFitProfileFrom({ notice: f3.notice, exemplars: f3.exemplars }, { rules, extractor: fn, extractModel: "mock", classifier, budget: new ModelBudget(50), deadline: Date.now() - 1 });
    expect(build.runs.map((r) => r.skipped)).toEqual([SKIPPED_TIME, SKIPPED_TIME, SKIPPED_TIME]);
    expect(build.exemplar.budget_skipped).toBe(5);
    expect(build.row.sources.complete).toBe(false);
    expect(build.row.sources.incomplete).toEqual([`group 1: skipped (${SKIPPED_TIME})`, `group 2: skipped (${SKIPPED_TIME})`, `group 3: skipped (${SKIPPED_TIME})`, `exemplars: 5 of 5 classified without the model (${SKIPPED_TIME})`]);
    expect(build.profile.confidence).toBe("low");
  });

  const store = (): OpportunityProfileStore & { upserts: string[] } => {
    const s = {
      upserts: [] as string[],
      async loadNotice(id: string) {
        return NOTICE_FIXTURES.find((f) => f.notice.id === id)?.notice ?? null;
      },
      async loadExemplars() {
        return [];
      },
      async loadCandidates(): Promise<CandidateNotice[]> {
        return NOTICE_FIXTURES.filter((f) => f.notice.guide_sections).map((f) => ({ id: f.notice.id, opportunity_number: f.notice.opportunity_number, guide_html_hash: f.notice.guide_html_hash, posted_date: null }));
      },
      async loadExistingProfiles() {
        return new Map<string, ExistingProfile>();
      },
      async upsertProfile(row: { opportunity_id: string }) {
        s.upserts.push(row.opportunity_id);
      },
    };
    return s;
  };
  const db = {} as SupabaseClient;
  const anyFixture: ModelFn = async (req) => {
    for (const f of NOTICE_FIXTURES) {
      if (req.user.includes(`Notice ${f.notice.opportunity_number} ·`)) return fixtureModel(f).fn(req);
    }
    throw new Error("no fixture for this prompt");
  };

  it("the runner defers every notice when fewer than MIN_CALLS_PER_NOTICE calls remain (B1)", async () => {
    const s = store();
    const summary = await runOpportunityProfiles(db, { modelBudget: MIN_CALLS_PER_NOTICE - 1, log: () => undefined }, { store: s, rules, extractor: noModel, classifier: null, extractionCache: new InMemoryNoticeExtractionCache(), itemCache: new InMemoryItemProfileCache() });
    expect(summary).toMatchObject({ candidates: 5, due: 5, attempted: 0, built: 0, deferred: 5, model_calls: 0, model_budget: MIN_CALLS_PER_NOTICE - 1 });
    expect(s.upserts).toEqual([]);
  });

  it("the runner builds within the budget, then defers once it can no longer afford a notice; the deadline defers the rest (S5)", async () => {
    const s = store();
    const summary = await runOpportunityProfiles(db, { modelBudget: 5, log: () => undefined }, { store: s, rules, extractor: anyFixture, extractModel: "mock", classifier: null, extractionCache: new InMemoryNoticeExtractionCache(), itemCache: new InMemoryItemProfileCache() });
    // 5 calls: one full notice (3 calls) leaves 2 < 3 → the other four are deferred; the first is complete and written.
    expect(summary).toMatchObject({ candidates: 5, due: 5, attempted: 1, built: 1, incomplete: 0, deferred: 4, model_calls: 3, model_budget: 5, errors: [] });
    expect(s.upserts).toEqual([f1.notice.id]);
    const timed = await runOpportunityProfiles(db, { modelBudget: 50, timeBudgetMs: -1, log: () => undefined }, { store: store(), rules, extractor: noModel, classifier: null, extractionCache: new InMemoryNoticeExtractionCache(), itemCache: new InMemoryItemProfileCache() });
    expect(timed).toMatchObject({ attempted: 0, deferred: 5, model_calls: 0 });
    // A dry run writes nothing.
    const dry = store();
    const dryRun = await runOpportunityProfiles(db, { modelBudget: 50, limit: 1, dryRun: true, log: () => undefined }, { store: dry, rules, extractor: anyFixture, extractModel: "mock", classifier: null, extractionCache: new InMemoryNoticeExtractionCache(), itemCache: new InMemoryItemProfileCache() });
    expect(dryRun).toMatchObject({ attempted: 1, built: 1, dry_run: true });
    expect(dry.upserts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Byte identity with docs/fit-engine/prompts/notice-extractor.md
// ---------------------------------------------------------------------------

describe("notice-extractor.md carries the identical prompt (byte identity)", () => {
  const spec = readFileSync(path.join(__dirname, "../../../../docs/fit-engine/prompts/notice-extractor.md"), "utf8");
  /** The first fenced block after the line matching `heading`. */
  const blockAfter = (heading: RegExp): string => {
    const lines = spec.split("\n");
    const start = lines.findIndex((l) => heading.test(l));
    expect(start, `heading ${heading} in the spec`).toBeGreaterThanOrEqual(0);
    const open = lines.findIndex((l, i) => i > start && l.startsWith("```"));
    const close = lines.findIndex((l, i) => i > open && l.startsWith("```"));
    expect(open).toBeGreaterThan(start);
    expect(close).toBeGreaterThan(open);
    return lines.slice(open + 1, close).join("\n");
  };

  it("the system prompt, with VOCABULARY_PROMPT substituted for its placeholder line", () => {
    const block = blockAfter(/^## System prompt/);
    expect(block).toContain("[VOCABULARY_PROMPT from item-classifier.md, verbatim]");
    expect(block.replace("[VOCABULARY_PROMPT from item-classifier.md, verbatim]", VOCABULARY_PROMPT)).toBe(EXTRACTOR_SYSTEM_PROMPT);
  });

  it("the user template skeleton (group 1) with its placeholders substituted", () => {
    const priors = { paradigm_required: { clinical_trials: 1 }, paradigm_allowed: {}, paradigm_excluded: {}, unit_required: ["L3"], design_required_any: [], design_prohibited: [], materials_required: [] };
    const s = section("{heading}", "{text}");
    const input: GroupInput = {
      header: { number: "{number}", title: "{title}", agency: "{agency}", activity_code: "{activity_code}", activity_title: "{activity_title}", clinical_trial_designation: "{clinical_trial_designation}", issuing_ic: "{issuing_ic}", program_division: "{program_division}" },
      priors,
      group: 1,
      chunk: 1,
      of: 1,
      sections: [s],
    };
    const expected = blockAfter(/^## User template/)
      .replace("{priors as JSON}", JSON.stringify(priors))
      .replace("Section group: {n}", "Section group: 1")
      .replace("## {section label}", `## ${sectionLabel(s)}`);
    expect(buildExtractorUserPrompt(input)).toBe(expected);
  });

  it("the group-2 and group-3 return blocks are GROUP_SCHEMAS verbatim", () => {
    expect(blockAfter(/^Group 2 replaces the `Return JSON:` block with:/)).toBe(GROUP_SCHEMAS[2]);
    expect(blockAfter(/^Group 3 replaces it with:/)).toBe(GROUP_SCHEMAS[3]);
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
      // No claim was dropped for a failed quote — every fixture evidence quote is verbatim (fixture 1's unverified override is the one intended drop).
      const dropped = build.runs.flatMap((r) => r.extraction?.dropped ?? []).filter((d) => /claim dropped|no verified quote|not found in/.test(d));
      expect(dropped).toEqual(f.n === 1 ? [expect.stringMatching(/^prior_override unit.required: quote "Studies must enroll cohorts of participants across sites" not found in .*; override dropped$/)] : []);
      expect(build.row.sources.complete).toBe(true);
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
    expect(build.row.sources.complete).toBe(true);
  });

  it("fixture 1 prior_overrides end to end: the verified one lowers the designation prior to 0.9, the unverified one changes nothing", async () => {
    const f = NOTICE_FIXTURES[0]!;
    const { fn } = fixtureModel(f);
    const build = await buildOpportunityFitProfileFrom({ notice: f.notice, exemplars: [] }, { rules, extractor: fn, extractModel: "mock", classifier: null });
    expect(build.merged.overrides_applied).toEqual([
      'paradigm.required.clinical_trials: designation prior 1 → 0.9 — "Early-phase trials establishing feasibility and preliminary efficacy of a novel device are also within scope." [Part 2 · Section I · Research Objectives]',
    ]);
    expect(build.merged.overlay_required).toEqual({ clinical_trials: 0.9 });
    expect(build.profile.paradigm.required.clinical_trials).toBe(0.9);
    expect(build.profile.unit.required).toEqual(["L3"]);
    expect(build.runs[0]!.extraction!.output.prior_overrides).toHaveLength(1);
    expect(build.runs[0]!.extraction!.dropped.some((d) => /prior_override unit.required: .* override dropped/.test(d))).toBe(true);
    // fixture 3's blend numbers are the D21 arithmetic the fixture file states.
    const f3 = NOTICE_FIXTURES.find((x) => x.n === 3)!;
    const b3 = await buildOpportunityFitProfileFrom({ notice: f3.notice, exemplars: f3.exemplars }, { rules, extractor: fixtureModel(f3).fn, extractModel: "mock", classifier: null });
    expect(b3.exemplar).toMatchObject({ rows: 6, classified: 5, informative: 5 });
    expect(b3.exemplar.axes.paradigm.health_services).toBe(0.42);
    expect(b3.blend.weights).toMatchObject({ n: 5, exemplar: 0.4, text: 0.6 });
    expect(b3.profile.paradigm.required.health_services).toBe(0.588);
    expect(b3.profile.paradigm.required.epidemiology).toBe(0.48);
    expect(b3.profile.paradigm.allowed.clinical_trials).toBe(0.104);
    expect(b3.blend.log).toContain("paradigm.allowed += clinical_trials 0.104 (exemplar share 0.26)");
  });
});
