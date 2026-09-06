import { describe, expect, it } from "vitest";
import {
  buildPrompt,
  buildUserPrompt,
  classifyModelName,
  classifyWithModel,
  DEFAULT_CLASSIFY_MODEL,
  MAX_PER_AXIS,
  MAX_TEXT_CHARS,
  MAX_TOPIC_TERMS,
  SYSTEM_PROMPT,
  truncateText,
  validateModelOutput,
  type ClassifierInput,
  type ModelFn,
  type ModelRequest,
} from "@/lib/fit/classify/llm";
import { checkAxes, ITEM_CLASSIFIER_FIXTURES } from "@/lib/fit/classify/fixtures";
import { DESIGN_IDS, MATERIALS_KIND_IDS, OBJECTIVE_IDS, PARADIGM_CATEGORY_IDS, UNIT_LEVEL_IDS } from "@/lib/fit/taxonomy";

const input: ClassifierInput = {
  kind: "grant",
  title: "Epigenetic control of T cell exhaustion",
  text: "We will use the LCMV clone 13 model in C57BL/6 mice with single-cell RNA sequencing.",
  year: 2024,
  mesh_names: [],
};

/** A model stub that replies with `reply` and records what it was asked. */
function stub(reply: unknown): { fn: ModelFn; calls: ModelRequest[] } {
  const calls: ModelRequest[] = [];
  const fn: ModelFn = async (req) => {
    calls.push(req);
    return typeof reply === "string" ? reply : JSON.stringify(reply);
  };
  return { fn, calls };
}

describe("model name (D2)", () => {
  it("defaults to the small model outreach/profile.ts uses and reads FIT_MODEL_CLASSIFY", () => {
    expect(DEFAULT_CLASSIFY_MODEL).toBe("gpt-4o-mini");
    expect(classifyModelName({})).toBe("gpt-4o-mini");
    expect(classifyModelName({ FIT_MODEL_CLASSIFY: "  " })).toBe("gpt-4o-mini");
    expect(classifyModelName({ FIT_MODEL_CLASSIFY: "gpt-5-mini" })).toBe("gpt-5-mini");
  });
});

describe("prompt (item-classifier.md)", () => {
  it("system prompt is the spec's, and its vocabulary lists every taxonomy id on each axis", () => {
    expect(SYSTEM_PROMPT.startsWith("You classify one biomedical research item for a research-development office.")).toBe(true);
    expect(SYSTEM_PROMPT).toContain("Do not infer \"clinical\" from disease words");
    expect(SYSTEM_PROMPT).toContain("Give at most 4 per axis.");
    const line = (axis: string) => SYSTEM_PROMPT.split("\n").find((l) => l.startsWith(`${axis}:`))!;
    const ids = (axis: string) => line(axis).slice(axis.length + 1).split(",").map((s) => s.trim().replace(/\s*\(.*$/, ""));
    expect(ids("paradigm")).toEqual([...PARADIGM_CATEGORY_IDS]);
    expect(ids("unit")).toEqual([...UNIT_LEVEL_IDS]);
    expect(ids("design")).toEqual([...DESIGN_IDS]);
    expect(ids("materials")).toEqual([...MATERIALS_KIND_IDS]);
    expect(ids("objective")).toEqual([...OBJECTIVE_IDS]);
  });

  it("user prompt follows the template: kind, title, year, text, then the return schema", () => {
    const user = buildUserPrompt(input);
    const lines = user.split("\n");
    expect(lines[0]).toBe("Item kind: grant");
    expect(lines[1]).toBe("Title: Epigenetic control of T cell exhaustion");
    expect(lines[2]).toBe("Year: 2024");
    expect(lines[3]).toBe("Text:");
    expect(lines[4]).toBe(input.text);
    expect(user).toContain('\n\nReturn:\n{"paradigm": {...}, "unit": {...}, "design": {...}, "materials": {...}, "objective": {...},');
    expect(user).toContain('"confidence": "high" | "medium" | "low"}');
    expect(user).not.toContain("MeSH");
  });

  it("prints placeholders for a missing title and year, and MeSH names only when present, as context", () => {
    const user = buildUserPrompt({ ...input, title: null, year: null, mesh_names: ["Mice", "T-Lymphocytes"] });
    expect(user).toContain("Title: (none)\nYear: (unknown)\nMeSH headings (context only; rules already used them): Mice; T-Lymphocytes\nText:");
  });

  it("truncates text to the spec's 6,000-character limit", () => {
    const long = "x".repeat(MAX_TEXT_CHARS + 500);
    expect(truncateText(long)).toHaveLength(MAX_TEXT_CHARS);
    expect(buildUserPrompt({ ...input, text: long })).not.toContain("x".repeat(MAX_TEXT_CHARS + 1));
    expect(buildPrompt(input)).toEqual({ system: SYSTEM_PROMPT, user: buildUserPrompt(input) });
  });
});

describe("validateModelOutput", () => {
  it("keeps only vocabulary ids on every axis and logs each rejected key", () => {
    const v = validateModelOutput({
      paradigm: { clinical_trials: 0.9, clinical: 0.5 },
      unit: { L3: 0.8, human_biospecimen: 0.7 },
      design: { rct: 0.9, "randomized trial": 0.9 },
      materials: { enrolled_participants: 0.9, patients: 0.4 },
      objective: { treatment_evaluation_efficacy: 0.8, efficacy: 0.8 },
      score: 71,
      confidence: "high",
    });
    expect(v.axes).toEqual({
      paradigm: { clinical_trials: 0.9 },
      unit: { L3: 0.8 },
      design: { rct: 0.9 },
      materials: { enrolled_participants: 0.9 },
      objective: { treatment_evaluation_efficacy: 0.8 },
    });
    expect(v.dropped).toEqual([
      "score: unknown top-level key",
      "paradigm.clinical: unknown id",
      "unit.human_biospecimen: unknown id",
      'design.randomized trial: unknown id',
      "materials.patients: unknown id",
      "objective.efficacy: unknown id",
    ]);
    expect(v.confidence).toBe("high");
    expect(v.halved).toBe(false);
  });

  it("clamps values to [0, 1], drops non-numbers and omits explicit zeros", () => {
    const v = validateModelOutput({
      paradigm: { clinical_trials: 1.4, epidemiology: -0.2, translational: "high", basic_discovery: Number.NaN, animal_model: 0 },
      confidence: "medium",
    });
    expect(v.axes).toEqual({ paradigm: { clinical_trials: 1 } });
    expect(v.dropped).toEqual([
      "paradigm.clinical_trials: clamped 1.4 to 1",
      "paradigm.epidemiology: clamped -0.2 to 0",
      'paradigm.translational: not a number ("high")',
      "paradigm.basic_discovery: not a number (NaN)",
    ]);
  });

  it("keeps the top four entries per axis by value, ties in the model's order", () => {
    const v = validateModelOutput({
      design: { rct: 0.9, prospective_cohort: 0.2, ehr_analysis: 0.6, survey: 0.4, registry: 0.4, qualitative: 0.1 },
      confidence: "high",
    });
    expect(Object.keys(v.axes.design!)).toEqual(["rct", "ehr_analysis", "survey", "registry"]);
    expect(Object.keys(v.axes.design!)).toHaveLength(MAX_PER_AXIS);
    expect(v.dropped).toEqual(["design: 6 entries, kept top 4; dropped prospective_cohort 0.2, qualitative 0.1"]);
  });

  it("halves every value when confidence is low, and defaults an invalid confidence to medium", () => {
    const low = validateModelOutput({ paradigm: { epidemiology: 0.8 }, unit: { L4: 0.6 }, confidence: "low" });
    expect(low.axes).toEqual({ paradigm: { epidemiology: 0.4 }, unit: { L4: 0.3 } });
    expect(low.halved).toBe(true);
    expect(low.confidence).toBe("low");

    const bad = validateModelOutput({ paradigm: { epidemiology: 0.8 }, confidence: "certain" });
    expect(bad.confidence).toBe("medium");
    expect(bad.halved).toBe(false);
    expect(bad.dropped).toEqual(['confidence: "certain"; treated as medium']);

    const missing = validateModelOutput({ paradigm: { epidemiology: 0.8 } });
    expect(missing.dropped).toEqual(["confidence: missing; treated as medium"]);
  });

  it("normalizes an axis the model returned as an array of {id, value} entries or [id, value] pairs, logging the shape", () => {
    const v = validateModelOutput({
      paradigm: [{ id: "epidemiology", value: 0.9 }, { category: "clinical_observational", probability: 0.6 }, "ehr", { id: "nope", value: 0.5 }],
      unit: [["L4", 0.8]],
      confidence: "high",
    });
    expect(v.axes).toEqual({ paradigm: { epidemiology: 0.9, clinical_observational: 0.6 }, unit: { L4: 0.8 } });
    expect(v.dropped).toEqual([
      "paradigm: given as an array of 4; normalized",
      'paradigm.2: array entry without an id and a value ("ehr")',
      "paradigm.nope: unknown id",
      "unit: given as an array of 1; normalized",
    ]);
  });

  it("allows empty axes — silence is not an error", () => {
    const v = validateModelOutput({ paradigm: {}, unit: { L1: 0.9 }, materials: null, confidence: "high" });
    expect(v.axes).toEqual({ unit: { L1: 0.9 } });
    expect(v.dropped).toEqual([]);
  });

  it("cleans topic_terms (strings, trimmed, deduplicated case-insensitively, at most eight) and justification (axis keys, strings)", () => {
    const v = validateModelOutput({
      topic_terms: ["SLE", " sle ", "lupus nephritis", 42, "", "a", "b", "c", "d", "e", "f", "g"],
      justification: { paradigm: " two phase II trials ", topic: "x", unit: 7, design: "" },
      confidence: "high",
    });
    expect(v.topic_terms).toEqual(["SLE", "lupus nephritis", "a", "b", "c", "d", "e", "f"]);
    expect(v.topic_terms).toHaveLength(MAX_TOPIC_TERMS);
    expect(v.justification).toEqual({ paradigm: "two phase II trials" });
    expect(v.dropped).toEqual([
      "topic_terms: dropped 42",
      'topic_terms: dropped ""',
      "topic_terms: 9 terms, kept first 8",
      "justification.topic: unknown axis",
      "justification.unit: not a string (7)",
    ]);
  });

  it("treats a non-object reply as empty with low confidence and the reason logged", () => {
    for (const raw of [null, "text", 3, ["a"]]) {
      const v = validateModelOutput(raw);
      expect(v.axes).toEqual({});
      expect(v.confidence).toBe("low");
      expect(v.dropped).toHaveLength(1);
      expect(v.dropped[0]).toMatch(/^output: not a JSON object/);
    }
    const v = validateModelOutput({ paradigm: ["clinical_trials"], confidence: "high" });
    expect(v.axes).toEqual({});
    expect(v.dropped).toEqual(["paradigm: given as an array of 1; normalized", 'paradigm.0: array entry without an id and a value ("clinical_trials")']);
  });

  it("accepts every fixture's mocked model output without dropping anything, and the outputs meet the spec's expectations", () => {
    for (const f of ITEM_CLASSIFIER_FIXTURES) {
      const v = validateModelOutput(f.model_output);
      expect(v.dropped, `fixture ${f.n}`).toEqual([]);
      const misses = checkAxes(v.axes, f.expect).filter((c) => !c.ok);
      expect(misses, `fixture ${f.n}: ${misses.map((m) => m.notes.join("; ")).join(" | ")}`).toEqual([]);
      expect(v.topic_terms.length).toBeGreaterThanOrEqual(3);
      expect(Object.keys(v.justification)).toHaveLength(5);
    }
  });
});

describe("classifyWithModel", () => {
  it("sends the spec prompt with the configured model name, JSON only, and returns the validated axes with the raw reply", async () => {
    const { fn, calls } = stub({ paradigm: { animal_model: 0.8, mouse: 0.9 }, unit: { L2: 0.7 }, confidence: "high", topic_terms: ["LCMV"] });
    const out = await classifyWithModel(input, { model: fn, modelName: "test-model" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ model: "test-model", system: SYSTEM_PROMPT, user: buildUserPrompt(input) });
    expect(out.model).toBe("test-model");
    expect(out.axes).toEqual({ paradigm: { animal_model: 0.8 }, unit: { L2: 0.7 } });
    expect(out.dropped).toEqual(["paradigm.mouse: unknown id"]);
    expect(out.raw).toEqual({ paradigm: { animal_model: 0.8, mouse: 0.9 }, unit: { L2: 0.7 }, confidence: "high", topic_terms: ["LCMV"] });
    expect(out.topic_terms).toEqual(["LCMV"]);
  });

  it("uses FIT_MODEL_CLASSIFY's default when no name is given", async () => {
    const { fn, calls } = stub({ confidence: "high" });
    const out = await classifyWithModel(input, { model: fn });
    expect(calls[0]!.model).toBe(classifyModelName());
    expect(out.axes).toEqual({});
  });

  it("marks a reply unusable — never cached — when every axis value was rejected, but not an honestly empty one", async () => {
    const wrongIds = stub({ paradigm: { foo: 1 }, unit: { bar: 0.5 }, confidence: "high" });
    const out = await classifyWithModel(input, { model: wrongIds.fn, modelName: "m" });
    expect(out.axes).toEqual({});
    expect(out.usable).toBe(false);
    expect(out.dropped.at(-1)).toBe("output: every axis value was rejected; reply not cached");

    const silent = stub({ paradigm: {}, confidence: "medium" });
    const ok = await classifyWithModel(input, { model: silent.fn, modelName: "m" });
    expect(ok.axes).toEqual({});
    expect(ok.usable).toBe(true);
    expect(ok.dropped).toEqual([]);

    const arrays = stub({ paradigm: [{ id: "epidemiology", value: 0.9 }], confidence: "high" });
    const fixed = await classifyWithModel(input, { model: arrays.fn, modelName: "m" });
    expect(fixed.axes).toEqual({ paradigm: { epidemiology: 0.9 } });
    expect(fixed.usable).toBe(true);
  });

  it("returns empty axes and logs the parse error when the reply is not JSON", async () => {
    const { fn } = stub("Sorry, I cannot classify this.");
    const out = await classifyWithModel(input, { model: fn, modelName: "m" });
    expect(out.axes).toEqual({});
    expect(out.confidence).toBe("low");
    expect(out.raw).toBe("Sorry, I cannot classify this.");
    expect(out.dropped).toHaveLength(1);
    expect(out.dropped[0]).toMatch(/^output: not valid JSON/);
  });

  it("logs a reply the API cut off at max_tokens, whether or not what came back still parses", async () => {
    const cut: ModelFn = async () => ({ content: '{"paradigm": {"epidemiology": 0.8}, "unit": {"L4": 0.', finish_reason: "length" });
    const out = await classifyWithModel(input, { model: cut, modelName: "m" });
    expect(out.axes).toEqual({});
    expect(out.dropped[0]).toBe("output: truncated by max_tokens (finish_reason length)");
    expect(out.dropped[1]).toMatch(/^output: not valid JSON/);

    const cutButValid: ModelFn = async () => ({ content: '{"paradigm": {"epidemiology": 0.8}, "confidence": "high"}', finish_reason: "length" });
    const ok = await classifyWithModel(input, { model: cutButValid, modelName: "m" });
    expect(ok.axes).toEqual({ paradigm: { epidemiology: 0.8 } });
    expect(ok.dropped).toEqual(["output: truncated by max_tokens (finish_reason length)"]);

    const whole: ModelFn = async () => ({ content: '{"unit": {"L4": 0.9}, "confidence": "high"}', finish_reason: "stop" });
    expect((await classifyWithModel(input, { model: whole, modelName: "m" })).dropped).toEqual([]);
  });

  it("propagates a model-function failure (auth, rate limit) instead of caching an empty result", async () => {
    const failing: ModelFn = async () => {
      throw new Error("401 invalid api key");
    };
    await expect(classifyWithModel(input, { model: failing, modelName: "m" })).rejects.toThrow("401 invalid api key");
  });
});
