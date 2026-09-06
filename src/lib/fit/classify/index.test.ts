import { describe, expect, it } from "vitest";
import {
  axesWithoutRule,
  buildItemProfile,
  classifyItem,
  classifyItemWithoutRules,
  evidenceSourceOf,
  InMemoryItemProfileCache,
  itemCacheKey,
  mergeAxes,
  MIN_TEXT_CHARS,
  modelNeeded,
  noRules,
  type NormalizedItem,
  type RuleClassification,
  type RulesFn,
} from "@/lib/fit/classify";
import { checkAxes, fixtureItem, formatAxisCheck, ITEM_CLASSIFIER_FIXTURES } from "@/lib/fit/classify/fixtures";
import type { LlmClassification, ModelFn, ModelRequest } from "@/lib/fit/classify/llm";
import { TAXONOMY_VERSION } from "@/lib/fit/taxonomy";
import { contentHash } from "@/lib/outreach/embeddings";

const TEXT = "We conducted a retrospective cohort study using electronic health records from an integrated health system to estimate the hazard of myocardial infarction by statin adherence.";

const item = (over: Partial<NormalizedItem> = {}): NormalizedItem => ({
  id: "PMID:1",
  kind: "publication",
  title: "Statin adherence and incident MI",
  text: TEXT,
  year: 2022,
  role: "first_last_corresponding",
  mesh: [],
  publication_types: [],
  signals: {},
  ...over,
});

const rulesOn = (axes: RuleClassification["axes"], ruleId = "test_rule"): RulesFn => {
  const fired = Object.keys(axes) as Array<keyof typeof axes>;
  return () => ({ axes, fired: [{ ruleId, axes: fired }], firedAxes: fired, refinedBy: [] });
};

/** A stub whose reply is `reply`; counts calls; throws when `reply` is undefined (the "must not be called" case). */
function stub(reply?: unknown): { fn: ModelFn; calls: ModelRequest[] } {
  const calls: ModelRequest[] = [];
  const fn: ModelFn = async (req) => {
    calls.push(req);
    if (reply === undefined) throw new Error("model must not be called");
    return JSON.stringify(reply);
  };
  return { fn, calls };
}

const MODEL_REPLY = {
  paradigm: { epidemiology: 0.85, health_services: 0.5 },
  unit: { L4: 0.9 },
  design: { retrospective_cohort: 0.9, ehr_analysis: 0.9 },
  materials: { ehr: 0.95 },
  objective: { etiology_risk_factors: 0.7 },
  topic_terms: ["statin adherence", "myocardial infarction", "proportion of days covered"],
  justification: { paradigm: "retrospective cohort", unit: "218,406 initiators", design: "EHR cohort", materials: "EHR", objective: "incident MI" },
  confidence: "high",
};

const llmFrom = (over: Partial<LlmClassification> = {}): LlmClassification => ({
  axes: { paradigm: { epidemiology: 0.85 }, unit: { L4: 0.9 }, design: { ehr_analysis: 0.9 }, materials: { ehr: 0.95 }, objective: { etiology_risk_factors: 0.7 } },
  confidence: "high",
  halved: false,
  topic_terms: ["statin adherence"],
  justification: { paradigm: "from model", unit: "from model", design: "from model", materials: "from model", objective: "from model" },
  dropped: [],
  model: "m",
  raw: {},
  ...over,
});

describe("cache key", () => {
  it("is contentHash(taxonomy version + kind + text) and changes with any of them", () => {
    const i = item();
    expect(itemCacheKey(i)).toBe(contentHash(`${TAXONOMY_VERSION}\n${i.kind}\n${TEXT}`));
    expect(itemCacheKey(i)).toBe(itemCacheKey(item({ id: "other", title: "other", year: 1999 })));
    expect(itemCacheKey(i)).not.toBe(itemCacheKey(item({ kind: "grant" })));
    expect(itemCacheKey(i)).not.toBe(itemCacheKey(item({ text: `${TEXT} ` })));
    expect(itemCacheKey(item({ text: null }))).toBe(contentHash(`${TAXONOMY_VERSION}\npublication\n`));
  });
});

describe("modelNeeded — the exact rule", () => {
  it("needs the model when the text is long enough and at least one axis has no fired rule", () => {
    const need = modelNeeded(item(), noRules(item()));
    expect(need).toEqual({ needed: true, reason: "text present; no rule fired on paradigm, unit, design, materials, objective", axes_without_rule: ["paradigm", "unit", "design", "materials", "objective"] });
    const partial = modelNeeded(item(), { firedAxes: ["paradigm", "unit", "design", "materials"] });
    expect(partial.needed).toBe(true);
    expect(partial.axes_without_rule).toEqual(["objective"]);
  });

  it("does not need the model without text, with too little text, or when rules fired on every axis", () => {
    expect(modelNeeded(item({ text: null }), { firedAxes: [] })).toMatchObject({ needed: false, reason: "no text" });
    expect(modelNeeded(item({ text: "   " }), { firedAxes: [] })).toMatchObject({ needed: false, reason: "no text" });
    expect(modelNeeded(item({ text: "Short note." }), { firedAxes: [] })).toMatchObject({ needed: false, reason: `text too short (11 < ${MIN_TEXT_CHARS} chars)` });
    const all = modelNeeded(item(), { firedAxes: ["paradigm", "unit", "design", "materials", "objective"] });
    expect(all).toEqual({ needed: false, reason: "rules fired on every axis", axes_without_rule: [] });
    expect(axesWithoutRule({ firedAxes: ["unit", "paradigm"] })).toEqual(["design", "materials", "objective"]);
  });
});

describe("mergeAxes — rules override the model on fired axes only", () => {
  it("takes rule values where a rule fired, discarding the model's, and model values elsewhere", () => {
    const rules: RuleClassification = {
      axes: { paradigm: { clinical_trials: 0.95 }, design: { rct: 0.95 } },
      fired: [{ ruleId: "pt_rct", axes: ["paradigm", "design"] }],
      firedAxes: ["paradigm", "design"],
      refinedBy: [],
    };
    const m = mergeAxes(rules, llmFrom());
    expect(m.axes).toEqual({
      paradigm: { clinical_trials: 0.95 },
      unit: { L4: 0.9 },
      design: { rct: 0.95 },
      materials: { ehr: 0.95 },
      objective: { etiology_risk_factors: 0.7 },
    });
    expect(m.decided_by).toEqual({ paradigm: "rules", unit: "llm", design: "rules", materials: "llm", objective: "llm" });
    expect(m.discarded_model_axes).toEqual(["paradigm", "design"]);
    expect(m.warnings).toEqual([]);
  });

  it("a fired axis wins even when the rule assigned nothing on it, and the model is not consulted on it", () => {
    const rules: RuleClassification = { axes: { paradigm: {} }, fired: [{ ruleId: "r", axes: ["paradigm"] }], firedAxes: ["paradigm"], refinedBy: [] };
    const m = mergeAxes(rules, llmFrom());
    expect(m.axes.paradigm).toEqual({});
    expect(m.decided_by.paradigm).toBe("rules");
    expect(m.discarded_model_axes).toEqual(["paradigm"]);
  });

  it("leaves an axis empty and undecided when neither side spoke; no model means rules only", () => {
    const m = mergeAxes(noRules(item()), llmFrom({ axes: { unit: { L4: 0.9 } } }));
    expect(m.axes).toEqual({ paradigm: {}, unit: { L4: 0.9 }, design: {}, materials: {}, objective: {} });
    expect(m.decided_by).toEqual({ unit: "llm" });
    const none = mergeAxes(noRules(item()), null);
    expect(none.decided_by).toEqual({});
    expect(none.discarded_model_axes).toEqual([]);
  });

  it("drops a rule id outside the vocabulary with a warning rather than storing it", () => {
    const rules: RuleClassification = { axes: { paradigm: { clinical_trials: 0.9, clinical: 0.5, epidemiology: 0 } }, fired: [{ ruleId: "r", axes: ["paradigm"] }], firedAxes: ["paradigm"], refinedBy: [] };
    const m = mergeAxes(rules, null);
    expect(m.axes.paradigm).toEqual({ clinical_trials: 0.9 });
    expect(m.warnings).toEqual(["rules.paradigm.clinical: unknown id dropped"]);
  });
});

describe("buildItemProfile", () => {
  it("carries identity, source, role, topic, provenance and only the model's justification for model-decided axes", () => {
    const i = item({
      mesh: [
        { ui: "D006801", name: "Humans", major: false, qualifiers: [] },
        { ui: "D009203", name: "Myocardial Infarction", major: true, qualifiers: ["epidemiology"] },
      ],
      signals: { rcdc: ["Cardiovascular", "Prevention", 3] },
    });
    const rules: RuleClassification = { axes: { paradigm: { epidemiology: 0.8 }, unit: { L4: 0.8 } }, fired: [{ ruleId: "mesh_cohort_epi", axes: ["paradigm", "unit"] }], firedAxes: ["paradigm", "unit"], refinedBy: [] };
    const { profile } = buildItemProfile(i, rules, llmFrom());
    expect(profile).toMatchObject({
      id: "PMID:1",
      kind: "publication",
      source: "pubmed_verified",
      year: 2022,
      role: "first_last_corresponding",
      taxonomy_version: TAXONOMY_VERSION,
      paradigm: { epidemiology: 0.8 },
      unit: { L4: 0.8 },
      design: { ehr_analysis: 0.9 },
      materials: { ehr: 0.95 },
      objective: { etiology_risk_factors: 0.7 },
      topic: { mesh: ["D006801", "D009203"], mesh_major: ["D009203"], rcdc: ["Cardiovascular", "Prevention"], terms: ["statin adherence"] },
      confidence: "high",
      decided_by: { paradigm: "rules", unit: "rules", design: "llm", materials: "llm", objective: "llm" },
      rules_fired: ["mesh_cohort_epi"],
      justification: { design: "from model", materials: "from model", objective: "from model" },
    });
  });

  it("takes confidence from the model when any axis is the model's, high when rules alone decided, low when nothing did", () => {
    const rules = rulesOn({ paradigm: { clinical_trials: 0.9 } })(item());
    expect(buildItemProfile(item(), rules, llmFrom({ confidence: "medium" })).profile.confidence).toBe("medium");
    expect(buildItemProfile(item(), rules, llmFrom({ confidence: "low", halved: true })).profile.confidence).toBe("low");
    expect(buildItemProfile(item(), rules, null).profile.confidence).toBe("high");
    expect(buildItemProfile(item(), noRules(item()), null).profile.confidence).toBe("low");
  });

  it("nulls an unknown role and maps each kind to its reliability source, honouring signals.source", () => {
    expect(buildItemProfile(item({ role: "author" }), noRules(item()), null).profile.role).toBeNull();
    expect(evidenceSourceOf({ kind: "publication", role: null, signals: {} })).toBe("pubmed_verified");
    expect(evidenceSourceOf({ kind: "grant", role: "contact_pi", signals: {} })).toBe("reporter");
    expect(evidenceSourceOf({ kind: "trial", role: "trial_pi", signals: {} })).toBe("ctgov_pi");
    expect(evidenceSourceOf({ kind: "trial", role: null, signals: {} })).toBe("ctgov_listed");
    expect(evidenceSourceOf({ kind: "biosketch_statement", role: null, signals: {} })).toBe("biosketch");
    expect(evidenceSourceOf({ kind: "biosketch_contribution", role: null, signals: {} })).toBe("biosketch");
    expect(evidenceSourceOf({ kind: "profiles_narrative", role: null, signals: {} })).toBe("profiles");
    expect(evidenceSourceOf({ kind: "self_declared", role: null, signals: {} })).toBe("self_declared_current");
    expect(evidenceSourceOf({ kind: "publication", role: null, signals: { source: "pubmed_name_only" } })).toBe("pubmed_name_only");
    expect(evidenceSourceOf({ kind: "publication", role: null, signals: { source: "wikipedia" } })).toBe("pubmed_verified");
  });
});

describe("classifyItem", () => {
  it("calls the model once: the second call for the same text is a cache hit with an identical profile", async () => {
    const cache = new InMemoryItemProfileCache();
    const { fn, calls } = stub(MODEL_REPLY);
    const now = () => new Date("2026-09-05T12:00:00Z");

    const first = await classifyItem(item(), { rules: noRules, model: fn, modelName: "m", cache, now });
    expect(calls).toHaveLength(1);
    expect(first.cache).toBe("miss");
    expect(first.model_needed).toBe(true);
    expect(first.model_called).toBe(true);
    expect(first.llm?.model).toBe("m");
    expect(first.profile.paradigm).toEqual({ epidemiology: 0.85, health_services: 0.5 });
    expect(first.profile.decided_by).toEqual({ paradigm: "llm", unit: "llm", design: "llm", materials: "llm", objective: "llm" });
    expect(cache.writes).toBe(1);
    expect(cache.rows.get(first.cache_key)).toMatchObject({ content_hash: first.cache_key, kind: "publication", ref_id: "PMID:1", taxonomy_version: TAXONOMY_VERSION, llm_model: "m", created_at: "2026-09-05T12:00:00.000Z" });
    expect(cache.rows.get(first.cache_key)!.merged).toEqual(first.profile);

    const second = await classifyItem(item({ id: "PMID:1-again" }), { rules: noRules, model: fn, modelName: "m", cache, now });
    expect(calls).toHaveLength(1);
    expect(second.cache).toBe("hit");
    expect(second.model_called).toBe(false);
    expect(second.llm).toEqual(first.llm);
    expect(second.profile).toEqual({ ...first.profile, id: "PMID:1-again" });
    expect(cache.writes).toBe(1);
    expect(cache.reads).toBe(2);
  });

  it("does not call the model when rules fired on every axis, stores the rules-only row once, and serves it from cache after", async () => {
    const cache = new InMemoryItemProfileCache();
    const { fn, calls } = stub(); // throws if called
    const rules = rulesOn({ paradigm: { clinical_trials: 0.95 }, unit: { L3: 0.9 }, design: { rct: 0.95 }, materials: { enrolled_participants: 0.9 }, objective: { treatment_evaluation_efficacy: 0.8 } }, "pt_rct");

    const out = await classifyItem(item(), { rules, model: fn, cache });
    expect(calls).toHaveLength(0);
    expect(out.model_needed).toBe(false);
    expect(out.model_reason).toBe("rules fired on every axis");
    expect(out.llm).toBeNull();
    expect(out.profile.confidence).toBe("high");
    expect(out.profile.decided_by).toEqual({ paradigm: "rules", unit: "rules", design: "rules", materials: "rules", objective: "rules" });
    expect(out.profile.rules_fired).toEqual(["pt_rct"]);
    expect(out.profile.justification).toEqual({});
    expect(out.profile.topic.terms).toEqual([]);
    expect(out.cache).toBe("miss");
    expect(cache.writes).toBe(1);
    expect(cache.rows.get(out.cache_key)!.llm).toBeNull();

    const again = await classifyItem(item(), { rules, model: fn, cache });
    expect(again.cache).toBe("hit");
    expect(cache.writes).toBe(1);
  });

  it("does not call the model for an item without prose even when no rule fired", async () => {
    const { fn, calls } = stub();
    const out = await classifyItem(item({ text: null }), { rules: noRules, model: fn });
    expect(calls).toHaveLength(0);
    expect(out.model_reason).toBe("no text");
    expect(out.cache).toBe("disabled");
    expect(out.profile.confidence).toBe("low");
    expect(out.profile.decided_by).toEqual({});
  });

  it("with rules on some axes: rules win there, the model fills the rest, and the model's overridden values are recorded as discarded", async () => {
    const { fn } = stub(MODEL_REPLY);
    const rules = rulesOn({ paradigm: { clinical_observational: 0.7 }, unit: { L3: 0.8 } }, "mesh_retrospective");
    const out = await classifyItem(item(), { rules, model: fn, modelName: "m" });
    expect(out.model_needed).toBe(true);
    expect(out.axes_without_rule).toEqual(["design", "materials", "objective"]);
    expect(out.profile.paradigm).toEqual({ clinical_observational: 0.7 });
    expect(out.profile.unit).toEqual({ L3: 0.8 });
    expect(out.profile.design).toEqual({ retrospective_cohort: 0.9, ehr_analysis: 0.9 });
    expect(out.profile.materials).toEqual({ ehr: 0.95 });
    expect(out.profile.objective).toEqual({ etiology_risk_factors: 0.7 });
    expect(out.discarded_model_axes).toEqual(["paradigm", "unit"]);
    expect(out.profile.decided_by).toEqual({ paradigm: "rules", unit: "rules", design: "llm", materials: "llm", objective: "llm" });
    expect(out.profile.justification).toEqual({ design: "EHR cohort", materials: "EHR", objective: "incident MI" });
    expect(out.llm?.axes.paradigm).toEqual({ epidemiology: 0.85, health_services: 0.5 }); // kept raw for audit
  });

  it("re-runs the model when a cached row has no model output but the model is now needed, and rewrites the row", async () => {
    const cache = new InMemoryItemProfileCache();
    const allAxes = rulesOn({ paradigm: { clinical_trials: 0.95 }, unit: { L3: 0.9 }, design: { rct: 0.95 }, materials: { enrolled_participants: 0.9 }, objective: { treatment_evaluation_efficacy: 0.8 } });
    await classifyItem(item(), { rules: allAxes, model: stub().fn, cache });
    expect(cache.rows.size).toBe(1);

    const { fn, calls } = stub(MODEL_REPLY);
    const fewer = rulesOn({ paradigm: { clinical_trials: 0.95 } });
    const out = await classifyItem(item(), { rules: fewer, model: fn, modelName: "m", cache });
    expect(calls).toHaveLength(1);
    expect(out.cache).toBe("miss");
    expect(out.model_called).toBe(true);
    expect(cache.writes).toBe(2);
    expect(cache.rows.get(out.cache_key)!.llm?.model).toBe("m");
  });

  it("without a cache the model is called on every run", async () => {
    const { fn, calls } = stub(MODEL_REPLY);
    await classifyItem(item(), { rules: noRules, model: fn, modelName: "m" });
    await classifyItem(item(), { rules: noRules, model: fn, modelName: "m" });
    expect(calls).toHaveLength(2);
  });

  it("halves the model's values when it reports low confidence, and the profile carries that confidence", async () => {
    const { fn } = stub({ ...MODEL_REPLY, confidence: "low" });
    const out = await classifyItem(item(), { rules: noRules, model: fn, modelName: "m" });
    expect(out.profile.paradigm).toEqual({ epidemiology: 0.425, health_services: 0.25 });
    expect(out.profile.confidence).toBe("low");
    expect(out.llm?.halved).toBe(true);
  });
});

describe("the six prompt-spec fixtures through classifyItem (mocked model)", () => {
  for (const f of ITEM_CLASSIFIER_FIXTURES) {
    it(`fixture ${f.n} (${f.kind}) meets the spec's expectations with no rule fired`, async () => {
      const cache = new InMemoryItemProfileCache();
      const { fn, calls } = stub(f.model_output);
      const out = await classifyItemWithoutRules(fixtureItem(f), { model: fn, modelName: "mock", cache });
      expect(calls).toHaveLength(1);
      expect(calls[0]!.user).toContain(`Item kind: ${f.kind}\nTitle: ${f.title}\nYear: ${f.year}\nText:\n${f.text}`);
      expect(out.llm?.dropped).toEqual([]);
      const checks = checkAxes({ paradigm: out.profile.paradigm, unit: out.profile.unit, design: out.profile.design, materials: out.profile.materials, objective: out.profile.objective }, f.expect);
      const misses = checks.filter((c) => !c.ok);
      expect(misses.map(formatAxisCheck), `fixture ${f.n}`).toEqual([]);
      expect(out.profile.topic.terms.length).toBeGreaterThanOrEqual(3);
      expect(out.profile.confidence).toBe("high");
      expect(out.profile.decided_by).toEqual({ paradigm: "llm", unit: "llm", design: "llm", materials: "llm", objective: "llm" });

      const again = await classifyItemWithoutRules(fixtureItem(f), { model: fn, modelName: "mock", cache });
      expect(calls).toHaveLength(1);
      expect(again.cache).toBe("hit");
    });
  }

  it("fixture 1 with a rule firing on paradigm keeps the rule's paradigm and the model's other axes", async () => {
    const f = ITEM_CLASSIFIER_FIXTURES[0]!;
    const { fn } = stub(f.model_output);
    const rules = rulesOn({ paradigm: { animal_model: 0.85, preclinical: 0.4 } }, "tag_animals_only");
    const out = await classifyItem(fixtureItem(f), { rules, model: fn, modelName: "mock" });
    expect(out.profile.paradigm).toEqual({ animal_model: 0.85, preclinical: 0.4 });
    expect(out.profile.design).toEqual(f.model_output.design);
    expect(out.discarded_model_axes).toEqual(["paradigm"]);
    expect(out.profile.decided_by.paradigm).toBe("rules");
    expect(out.profile.rules_fired).toEqual(["tag_animals_only"]);
  });
});
