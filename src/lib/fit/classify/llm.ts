/**
 * LLM item classifier (plan § PR 1.3). Prompt, output schema and validation
 * follow docs/fit-engine/prompts/item-classifier.md exactly; the spec
 * (docs/MATCHING_REDESIGN.md §5 "Item classification", §16 "Division of
 * labor") puts the model second, after the rules, for items that have prose
 * but not enough structure for a rule to decide.
 *
 * Rules (CLAUDE.md): constrained JSON output, `temperature: 0`, model name
 * from `FIT_MODEL_CLASSIFY` (D2 default: the small model `outreach/profile.ts`
 * already uses), never in a page render path, and only the OpenAI-compatible
 * endpoint already in use (D3). The model call is an injectable `ModelFn` so
 * tests never touch the network; `openaiModel()` is the runtime one.
 *
 * Validation keeps only vocabulary ids (the PR 1.1 type guards), clamps
 * values to [0, 1], keeps at most four entries per axis, halves everything
 * when the model says its confidence is low, and records every removal or
 * change in `dropped` so the stored `llm` JSON is an audit trail. This
 * classifier cites no evidence ids (it reads one item); its justification
 * quotes the text instead.
 */
import OpenAI from "openai";
import { AXES, type Axis, type AxisWeights, type NormalizedItemKind } from "@/lib/fit/classify/contracts";
import { isConfidence, isDesignId, isMaterialsKind, isObjectiveId, isParadigmCategory, isUnitLevel } from "@/lib/fit/taxonomy";
import type { Confidence } from "@/lib/fit/types";

// ---------------------------------------------------------------------------
// Model selection (D2, D3)
// ---------------------------------------------------------------------------

/** D2 default: the model `src/lib/outreach/profile.ts` already calls (`MODEL` there). */
export const DEFAULT_CLASSIFY_MODEL = "gpt-4o-mini";

/** `FIT_MODEL_CLASSIFY`, else the D2 default. */
export function classifyModelName(env: Record<string, string | undefined> = process.env): string {
  const name = env.FIT_MODEL_CLASSIFY?.trim();
  return name ? name : DEFAULT_CLASSIFY_MODEL;
}

// ---------------------------------------------------------------------------
// Prompt (item-classifier.md › System prompt, User template)
// ---------------------------------------------------------------------------

/** Prompt-spec input limit for `text`. */
export const MAX_TEXT_CHARS = 6_000;
/** "Give at most 4 per axis." */
export const MAX_PER_AXIS = 4;
/** "3–8 specific scientific terms". */
export const MAX_TOPIC_TERMS = 8;

export const SYSTEM_PROMPT = `You classify one biomedical research item for a research-development office. You do not judge quality or relevance to any funding notice. You describe HOW the research was done, on WHAT, and toward WHAT END, using a fixed vocabulary.

Output JSON only, matching the schema exactly. Every non-zero value must be supported by something in the text; when the text is silent on an axis, leave that axis empty. Do not infer "clinical" from disease words: a paper about lupus pathways in mice is not clinical research. Do not infer "human" from words like "patients" in a background sentence; only the work actually performed counts.

Vocabulary (use only these keys):
paradigm: basic_discovery, molecular_cellular_mechanistic, preclinical, animal_model, translational, human_biospecimen, early_phase_human_experimental, clinical_observational, interventional_clinical, clinical_trials, epidemiology, genetic_epidemiology, population_health, public_health, community_based, behavioral, comparative_effectiveness, health_services, outcomes_research, implementation_science, computational_data_science, bioinformatics, methods_technology_development
unit: L1 (molecule/gene/protein/pathway/cell/tissue/organoid), L2 (whole animal), L3 (human biospecimen / individual participant or patient), L4 (clinical cohort / population / community), L5 (healthcare organization / health system / policy)
design: wet_lab_experiment, perturbation, biochemical_structural, biospecimen_assay, animal_in_vivo, xenograft_pdx, animal_behavioral, bulk_omics, single_cell, spatial_imaging, proteomics_metabolomics, prospective_cohort, retrospective_cohort, case_control, cross_sectional, registry, rct, early_phase_trial, pragmatic_trial, pilot_feasibility_trial, single_arm_interventional, ehr_analysis, claims_analysis, linked_administrative, surveillance_data, survey, qualitative, mixed_methods, community_engaged, causal_inference, statistical_epi_modeling, population_simulation, ml_model_development, secondary_data_analysis, gwas, hybrid_effectiveness_implementation, implementation_evaluation, dissemination_study
materials: cell_lines, primary_cells_nonhuman, organoids_ipsc, animal_mouse, animal_rat, animal_zebrafish, animal_nhp, animal_other, human_tissue_biopsy, human_blood_fluids, human_primary_cells, biobank_specimens, enrolled_participants, patients_under_care, ehr, claims_administrative, registries_surveillance, surveys, cohort_biobank_datasets, genomic_datasets, imaging_datasets, digital_wearable, published_literature, simulated_data
objective: mechanism_discovery, target_identification_validation, biomarker_discovery_validation, therapeutic_development, treatment_evaluation_efficacy, diagnostic_prognostic_prediction, etiology_risk_factors, prevention, outcomes_quality, healthcare_delivery_access, implementation_dissemination, methods_tool_development, resource_infrastructure, training_capacity

Values are probabilities in [0,1] that the item belongs to that category. Multiple categories may be non-zero. Give at most 4 per axis.`;

const RETURN_SCHEMA = `Return:
{"paradigm": {...}, "unit": {...}, "design": {...}, "materials": {...}, "objective": {...},
 "topic_terms": string[],            // 3–8 specific scientific terms (diseases, pathways, molecules, populations); no generic words
 "justification": {"paradigm": string, "unit": string, "design": string, "materials": string, "objective": string},  // one short clause each, quoting the text where possible
 "confidence": "high" | "medium" | "low"}`;

/** What the model is given (item-classifier.md › Inputs). */
export type ClassifierInput = {
  kind: NormalizedItemKind;
  title: string | null;
  /** Abstract, statement or narrative; truncated to `MAX_TEXT_CHARS`. */
  text: string;
  year: number | null;
  /** For context only — the rules already used them. Omitted from the prompt when empty. */
  mesh_names: string[];
};

/** `text` cut to the prompt-spec limit. */
export function truncateText(text: string): string {
  return text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
}

/**
 * The user message, from the spec's template. The spec lists `mesh_names`
 * among the inputs "for context only" but its template has no line for
 * them; they are added after `Year:` only when present, labelled as context.
 */
export function buildUserPrompt(input: ClassifierInput): string {
  const lines = [`Item kind: ${input.kind}`, `Title: ${input.title?.trim() || "(none)"}`, `Year: ${input.year ?? "(unknown)"}`];
  const mesh = input.mesh_names.map((m) => m.trim()).filter(Boolean);
  if (mesh.length) lines.push(`MeSH headings (context only; rules already used them): ${mesh.join("; ")}`);
  lines.push("Text:", truncateText(input.text), "", RETURN_SCHEMA);
  return lines.join("\n");
}

export type Prompt = { system: string; user: string };

export function buildPrompt(input: ClassifierInput): Prompt {
  return { system: SYSTEM_PROMPT, user: buildUserPrompt(input) };
}

// ---------------------------------------------------------------------------
// Model function — injectable; the OpenAI one is the only network path
// ---------------------------------------------------------------------------

export type ModelRequest = Prompt & { model: string };

/** The raw reply (a JSON document), optionally with the API's finish reason so a truncated reply is logged as such. */
export type ModelReply = string | { content: string; finish_reason?: string | null };

/** Calls the model once. Tests inject one; runtime uses `openaiModel()`. */
export type ModelFn = (req: ModelRequest) => Promise<ModelReply>;

/**
 * Output ceiling. The schema needs ~300 tokens, but gpt-4o-mini sometimes
 * pretty-prints the whole vocabulary with zeros (~1,500 tokens) — at 900 the
 * reply was cut mid-string and lost (fixture 5, 2026-09-05).
 */
export const DEFAULT_MAX_TOKENS = 2_500;

/**
 * The configured OpenAI-compatible endpoint, exactly as `outreach/profile.ts`
 * calls it: JSON mode, temperature 0. The client is built on first use so
 * importing this module never reads the environment.
 */
export function openaiModel(opts: { apiKey?: string; client?: OpenAI; maxTokens?: number } = {}): ModelFn {
  let client: OpenAI | null = opts.client ?? null;
  return async (req) => {
    if (!client) {
      const apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY?.trim();
      if (!apiKey) throw new Error("OPENAI_API_KEY is not set; the item classifier cannot call the model");
      client = new OpenAI({ apiKey });
    }
    const completion = await client.chat.completions.create({
      model: req.model,
      temperature: 0,
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
    });
    const choice = completion.choices[0];
    return { content: choice?.message?.content?.trim() ?? "{}", finish_reason: choice?.finish_reason ?? null };
  };
}

// ---------------------------------------------------------------------------
// Validation (item-classifier.md › Validation)
// ---------------------------------------------------------------------------

const AXIS_GUARD: Record<Axis, (id: string) => boolean> = {
  paradigm: isParadigmCategory,
  unit: isUnitLevel,
  design: isDesignId,
  materials: isMaterialsKind,
  objective: isObjectiveId,
};

const TOP_LEVEL_KEYS = new Set<string>([...AXES, "topic_terms", "justification", "confidence"]);
const MAX_JUSTIFICATION_CHARS = 400;

export type ValidatedModelOutput = {
  /** Only vocabulary ids, values in (0, 1], at most `MAX_PER_AXIS` per axis; halved when confidence is low. */
  axes: AxisWeights;
  /** The model's confidence; `medium` when missing or not in the vocabulary (logged). */
  confidence: Confidence;
  /** True when confidence was `low` and every value was halved before merging. */
  halved: boolean;
  topic_terms: string[];
  justification: Partial<Record<Axis, string>>;
  /** One line per removed or altered entry — the audit trail stored with the profile. */
  dropped: string[];
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const fmt = (v: unknown) => {
  const s = typeof v === "number" || v === undefined ? String(v) : (JSON.stringify(v) ?? String(v));
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
};

function validateAxis(axis: Axis, value: unknown, dropped: string[]): Record<string, number> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) {
    dropped.push(`${axis}: not an object (${fmt(value)})`);
    return {};
  }
  const kept: Array<[string, number]> = [];
  for (const [id, v] of Object.entries(value)) {
    if (!AXIS_GUARD[axis](id)) {
      dropped.push(`${axis}.${id}: unknown id`);
      continue;
    }
    if (typeof v !== "number" || !Number.isFinite(v)) {
      dropped.push(`${axis}.${id}: not a number (${fmt(v)})`);
      continue;
    }
    let p = v;
    if (p > 1) {
      dropped.push(`${axis}.${id}: clamped ${v} to 1`);
      p = 1;
    } else if (p < 0) {
      dropped.push(`${axis}.${id}: clamped ${v} to 0`);
      p = 0;
    }
    if (p === 0) continue; // an explicit zero is the same as absent
    kept.push([id, p]);
  }
  if (kept.length > MAX_PER_AXIS) {
    const sorted = [...kept].sort((a, b) => b[1] - a[1]); // stable: ties keep the model's order
    const cut = sorted.slice(MAX_PER_AXIS);
    dropped.push(`${axis}: ${kept.length} entries, kept top ${MAX_PER_AXIS}; dropped ${cut.map(([id, p]) => `${id} ${p}`).join(", ")}`);
    const keep = new Set(sorted.slice(0, MAX_PER_AXIS).map(([id]) => id));
    return Object.fromEntries(kept.filter(([id]) => keep.has(id)));
  }
  return Object.fromEntries(kept);
}

function validateTopicTerms(value: unknown, dropped: string[]): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    dropped.push(`topic_terms: not an array (${fmt(value)})`);
    return [];
  }
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const t of value) {
    if (typeof t !== "string" || !t.trim()) {
      dropped.push(`topic_terms: dropped ${fmt(t)}`);
      continue;
    }
    const term = t.trim();
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
  }
  if (terms.length > MAX_TOPIC_TERMS) {
    dropped.push(`topic_terms: ${terms.length} terms, kept first ${MAX_TOPIC_TERMS}`);
    return terms.slice(0, MAX_TOPIC_TERMS);
  }
  return terms;
}

function validateJustification(value: unknown, dropped: string[]): Partial<Record<Axis, string>> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) {
    dropped.push(`justification: not an object (${fmt(value)})`);
    return {};
  }
  const out: Partial<Record<Axis, string>> = {};
  for (const [key, v] of Object.entries(value)) {
    if (!(AXES as readonly string[]).includes(key)) {
      dropped.push(`justification.${key}: unknown axis`);
      continue;
    }
    if (typeof v !== "string") {
      dropped.push(`justification.${key}: not a string (${fmt(v)})`);
      continue;
    }
    const s = v.trim();
    if (!s) continue;
    out[key as Axis] = s.length > MAX_JUSTIFICATION_CHARS ? `${s.slice(0, MAX_JUSTIFICATION_CHARS - 1)}…` : s;
  }
  return out;
}

/**
 * Pure. Applies the spec's validation to a parsed model reply: unknown keys
 * rejected, values clamped to [0, 1], at most four per axis (top four by
 * value), low confidence halves every value. Empty axes are allowed — the
 * text was silent. Nothing here throws; a reply that is not an object yields
 * empty axes with the reason in `dropped`.
 */
export function validateModelOutput(raw: unknown): ValidatedModelOutput {
  const dropped: string[] = [];
  if (!isRecord(raw)) {
    dropped.push(`output: not a JSON object (${fmt(raw)})`);
    return { axes: {}, confidence: "low", halved: false, topic_terms: [], justification: {}, dropped };
  }
  for (const key of Object.keys(raw)) {
    if (!TOP_LEVEL_KEYS.has(key)) dropped.push(`${key}: unknown top-level key`);
  }
  const axes: AxisWeights = {};
  for (const axis of AXES) {
    const values = validateAxis(axis, raw[axis], dropped);
    if (Object.keys(values).length) axes[axis] = values;
  }

  let confidence: Confidence = "medium";
  const c = raw.confidence;
  if (typeof c === "string" && isConfidence(c)) confidence = c;
  else dropped.push(`confidence: ${c === undefined ? "missing" : fmt(c)}; treated as medium`);

  const halved = confidence === "low";
  if (halved) {
    for (const axis of AXES) {
      const values = axes[axis];
      if (!values) continue;
      for (const id of Object.keys(values)) values[id] = values[id]! / 2;
    }
  }

  return {
    axes,
    confidence,
    halved,
    topic_terms: validateTopicTerms(raw.topic_terms, dropped),
    justification: validateJustification(raw.justification, dropped),
    dropped,
  };
}

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

/** What the model contributed to one item — stored verbatim in `fit_item_profiles.llm`. */
export type LlmClassification = ValidatedModelOutput & {
  /** The model name the call was made with. */
  model: string;
  /** The parsed reply (or the unparseable string), for audit. */
  raw: unknown;
  /**
   * False when the reply did not parse as JSON or was cut off at max_tokens. Such a
   * classification is returned (empty axes, reasons in `dropped`) but must never be
   * cached or reused — the next run has to call the model again (1.3 validator).
   * Absent (rows written before the flag existed) means usable.
   */
  usable?: boolean;
};

export type ClassifyWithModelOptions = {
  /** Defaults to `openaiModel()`. */
  model?: ModelFn;
  /** Defaults to `classifyModelName()`. */
  modelName?: string;
};

/**
 * Build the prompt, call the model once, parse and validate. Network only
 * through `opts.model` — pass a stub in tests. Throws only when the model
 * function itself throws (auth, rate limit); a malformed or truncated reply is
 * returned with empty axes, the reason in `dropped`, and `usable: false`.
 */
export async function classifyWithModel(input: ClassifierInput, opts: ClassifyWithModelOptions = {}): Promise<LlmClassification> {
  const model = opts.modelName ?? classifyModelName();
  const call = opts.model ?? openaiModel();
  const reply = await call({ ...buildPrompt(input), model });
  const content = typeof reply === "string" ? reply : reply.content;
  const truncated = typeof reply !== "string" && reply.finish_reason === "length" ? "output: truncated by max_tokens (finish_reason length)" : null;
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (e) {
    const validated = validateModelOutput(undefined);
    validated.dropped = [...(truncated ? [truncated] : []), `output: not valid JSON (${e instanceof Error ? e.message : String(e)})`];
    return { ...validated, model, raw: content, usable: false };
  }
  const validated = validateModelOutput(raw);
  if (truncated) validated.dropped.unshift(truncated);
  return { ...validated, model, raw, usable: !truncated };
}
