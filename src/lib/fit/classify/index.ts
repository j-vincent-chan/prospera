/**
 * Item classification (plan § PR 1.3): rules → model when needed → merge with
 * rules overriding → cache. Spec: docs/MATCHING_REDESIGN.md §5 "Item
 * classification" (rules first; LLM second for items with prose but no
 * structure; where both run, rules override the model on any axis where a
 * rule fired) and the item-classifier prompt spec.
 *
 * Exact rules implemented here:
 *
 * - Model needed ⇔ the item's text (trimmed) is at least `MIN_TEXT_CHARS`
 *   long AND at least one of the five axes has no fired rule
 *   (`axis ∉ rules.firedAxes`). An item with no prose is rules-only; an item
 *   whose rules covered every axis never reaches the model.
 * - Merge: for each axis, if a rule fired on it the rule values are taken
 *   and the model's values for that axis are discarded (recorded in
 *   `discarded_model_axes`); otherwise the model's values are taken; an axis
 *   neither decided is empty and absent from `decided_by`.
 * - Cache key: `contentHash(TAXONOMY_VERSION + "\n" + kind + "\n" + text)`.
 *   The cache is read before the model call and written after it (and on
 *   first sight of an item the model was not needed for), never on a hit.
 *
 * Pure apart from the injected `rules`, `model` and `cache`; no Supabase and
 * no network are imported here beyond the types.
 */
import { AXES, noRules, type Axis, type AxisWeights, type NormalizedItem, type RuleClassification, type RulesFn } from "@/lib/fit/classify/contracts";
import { type CachedItemProfile, type ItemProfileCache } from "@/lib/fit/classify/cache";
import { classifyWithModel, type ClassifierInput, type LlmClassification, type ModelFn } from "@/lib/fit/classify/llm";
import { isDesignId, isEvidenceRole, isEvidenceSource, isMaterialsKind, isObjectiveId, isParadigmCategory, isUnitLevel, TAXONOMY_VERSION } from "@/lib/fit/taxonomy";
import type { AxisDecider, Confidence, DesignWeights, EvidenceSource, ItemProfile, ItemTopic, MaterialsWeights, ObjectiveWeights, ParadigmWeights, UnitLevelWeights } from "@/lib/fit/types";
import { contentHash } from "@/lib/outreach/embeddings";

export { InMemoryItemProfileCache, supabaseItemProfileCache, type CachedItemProfile, type ItemProfileCache } from "@/lib/fit/classify/cache";
export { AXES, noRules, type Axis, type AxisWeights, type NormalizedItem, type NormalizedItemKind, type RuleClassification, type RulesFn } from "@/lib/fit/classify/contracts";
export {
  buildPrompt,
  buildUserPrompt,
  classifyModelName,
  classifyWithModel,
  DEFAULT_CLASSIFY_MODEL,
  openaiModel,
  SYSTEM_PROMPT,
  validateModelOutput,
  type ClassifierInput,
  type LlmClassification,
  type ModelFn,
  type ModelRequest,
} from "@/lib/fit/classify/llm";

// ---------------------------------------------------------------------------
// Cache key and the "model needed" rule
// ---------------------------------------------------------------------------

/** Shorter than this (trimmed) is a title or a placeholder, not prose the model can classify. */
export const MIN_TEXT_CHARS = 40;

/** `contentHash(TAXONOMY_VERSION + kind + text)` with newline separators — the `fit_item_profiles` primary key. */
export function itemCacheKey(item: Pick<NormalizedItem, "kind" | "text">): string {
  return contentHash([TAXONOMY_VERSION, item.kind, item.text ?? ""].join("\n"));
}

/** The axes no rule assigned — what the model is asked to fill. */
export function axesWithoutRule(rules: Pick<RuleClassification, "firedAxes">): Axis[] {
  return AXES.filter((axis) => !rules.firedAxes.includes(axis));
}

export type ModelNeed = { needed: boolean; reason: string; axes_without_rule: Axis[] };

/** The exact rule: text of at least `MIN_TEXT_CHARS` chars and at least one axis without a fired rule. */
export function modelNeeded(item: Pick<NormalizedItem, "text">, rules: Pick<RuleClassification, "firedAxes">): ModelNeed {
  const axes = axesWithoutRule(rules);
  const chars = (item.text ?? "").trim().length;
  if (chars < MIN_TEXT_CHARS) {
    return { needed: false, reason: chars === 0 ? "no text" : `text too short (${chars} < ${MIN_TEXT_CHARS} chars)`, axes_without_rule: axes };
  }
  if (axes.length === 0) return { needed: false, reason: "rules fired on every axis", axes_without_rule: axes };
  return { needed: true, reason: `text present; no rule fired on ${axes.join(", ")}`, axes_without_rule: axes };
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

const AXIS_GUARD: Record<Axis, (id: string) => boolean> = {
  paradigm: isParadigmCategory,
  unit: isUnitLevel,
  design: isDesignId,
  materials: isMaterialsKind,
  objective: isObjectiveId,
};

const nonEmpty = (values: Record<string, number> | undefined): values is Record<string, number> => !!values && Object.keys(values).length > 0;

export type MergedAxes = {
  axes: Required<AxisWeights>;
  decided_by: Partial<Record<Axis, AxisDecider>>;
  /** Axes the model answered on but a rule had fired — the model's values were thrown away. */
  discarded_model_axes: Axis[];
  warnings: string[];
};

/**
 * Pure. Rules win on every axis in `rules.firedAxes`; the model fills the
 * rest. Rule values are re-checked against the vocabulary (an unknown id is
 * dropped with a warning — PR 1.2's tables are pinned to the taxonomy by
 * test, so this should never fire).
 */
export function mergeAxes(rules: RuleClassification, llm: LlmClassification | null): MergedAxes {
  const axes = { paradigm: {}, unit: {}, design: {}, materials: {}, objective: {} } as Required<AxisWeights>;
  const decided_by: Partial<Record<Axis, AxisDecider>> = {};
  const discarded_model_axes: Axis[] = [];
  const warnings: string[] = [];
  for (const axis of AXES) {
    const fromModel = llm?.axes[axis];
    if (rules.firedAxes.includes(axis)) {
      const values: Record<string, number> = {};
      for (const [id, p] of Object.entries(rules.axes[axis] ?? {})) {
        if (!AXIS_GUARD[axis](id)) {
          warnings.push(`rules.${axis}.${id}: unknown id dropped`);
          continue;
        }
        if (typeof p === "number" && Number.isFinite(p) && p > 0) values[id] = Math.min(1, p);
      }
      axes[axis] = values;
      decided_by[axis] = "rules";
      if (nonEmpty(fromModel)) discarded_model_axes.push(axis);
    } else if (nonEmpty(fromModel)) {
      axes[axis] = { ...fromModel };
      decided_by[axis] = "llm";
    }
  }
  return { axes, decided_by, discarded_model_axes, warnings };
}

// ---------------------------------------------------------------------------
// Profile assembly
// ---------------------------------------------------------------------------

/** `signals.source` when it names a reliability key, else the kind's default source (§5 Sources table). */
export function evidenceSourceOf(item: Pick<NormalizedItem, "kind" | "role" | "signals">): EvidenceSource {
  const declared = item.signals.source;
  if (typeof declared === "string" && isEvidenceSource(declared)) return declared;
  switch (item.kind) {
    case "publication":
      return "pubmed_verified";
    case "grant":
      return "reporter";
    case "trial":
      return item.role === "trial_pi" ? "ctgov_pi" : "ctgov_listed";
    case "biosketch_statement":
    case "biosketch_contribution":
      return "biosketch";
    case "profiles_narrative":
      return "profiles";
    case "self_declared":
      return "self_declared_current";
    case "directory":
      return "directory_metadata";
  }
}

function topicOf(item: NormalizedItem, llm: LlmClassification | null): ItemTopic {
  const rcdc = Array.isArray(item.signals.rcdc) ? item.signals.rcdc.filter((s): s is string => typeof s === "string" && s.trim().length > 0) : [];
  return {
    mesh: item.mesh.map((m) => m.ui).filter(Boolean),
    mesh_major: item.mesh.filter((m) => m.major).map((m) => m.ui).filter(Boolean),
    rcdc,
    terms: llm?.topic_terms ?? [],
  };
}

/** Rules alone → high; any axis from the model → the model's confidence; nothing decided → low. */
function confidenceOf(decided_by: Partial<Record<Axis, AxisDecider>>, llm: LlmClassification | null): Confidence {
  const deciders = Object.values(decided_by);
  if (deciders.length === 0) return "low";
  if (deciders.includes("llm") && llm) return llm.confidence;
  return "high";
}

export function toClassifierInput(item: NormalizedItem): ClassifierInput {
  return { kind: item.kind, title: item.title, text: item.text ?? "", year: item.year, mesh_names: item.mesh.map((m) => m.name) };
}

/** Pure. The `ItemProfile` for an item from its rule and model classifications. */
export function buildItemProfile(item: NormalizedItem, rules: RuleClassification, llm: LlmClassification | null): { profile: ItemProfile; merged: MergedAxes } {
  const merged = mergeAxes(rules, llm);
  const justification: Partial<Record<Axis, string>> = {};
  for (const axis of AXES) {
    const clause = llm?.justification[axis];
    if (merged.decided_by[axis] === "llm" && clause) justification[axis] = clause;
  }
  const profile: ItemProfile = {
    id: item.id,
    kind: item.kind,
    source: evidenceSourceOf(item),
    year: item.year,
    role: item.role && isEvidenceRole(item.role) ? item.role : null,
    taxonomy_version: TAXONOMY_VERSION,
    paradigm: merged.axes.paradigm as ParadigmWeights,
    unit: merged.axes.unit as UnitLevelWeights,
    design: merged.axes.design as DesignWeights,
    materials: merged.axes.materials as MaterialsWeights,
    objective: merged.axes.objective as ObjectiveWeights,
    topic: topicOf(item, llm),
    confidence: confidenceOf(merged.decided_by, llm),
    decided_by: merged.decided_by,
    rules_fired: rules.fired.map((f) => f.ruleId),
    justification,
  };
  return { profile, merged };
}

// ---------------------------------------------------------------------------
// classifyItem
// ---------------------------------------------------------------------------

export type ClassifyDeps = {
  /** PR 1.2's `evaluateRules` with its context applied; `noRules` before it lands. */
  rules: RulesFn;
  /** Defaults to `openaiModel()` — the only network path. Inject a stub in tests. */
  model?: ModelFn;
  /** Defaults to `classifyModelName()` (`FIT_MODEL_CLASSIFY`). */
  modelName?: string;
  /** No cache → the model is called every time. */
  cache?: ItemProfileCache;
  now?: () => Date;
};

export type ClassifiedItem = {
  profile: ItemProfile;
  rules: RuleClassification;
  /** Null when the model was not needed. */
  llm: LlmClassification | null;
  cache_key: string;
  /** `hit`: a cached row served the run without a model call; `miss`: no usable row (written after); `disabled`: no cache given. */
  cache: "hit" | "miss" | "disabled";
  model_needed: boolean;
  model_called: boolean;
  /** The "model needed" rule's verdict, in words. */
  model_reason: string;
  axes_without_rule: Axis[];
  discarded_model_axes: Axis[];
  warnings: string[];
};

/**
 * Classify one evidence item. Rules first; the model only when
 * `modelNeeded` says so and the cache holds no model output for this text;
 * rules override the model on every axis they fired on. Writes the cache
 * after a model call and on first sight of a rules-only item.
 */
export async function classifyItem(item: NormalizedItem, deps: ClassifyDeps): Promise<ClassifiedItem> {
  const rules = deps.rules(item);
  const need = modelNeeded(item, rules);
  const cache_key = itemCacheKey(item);
  const cached = deps.cache ? await deps.cache.get(cache_key) : null;

  let llm: LlmClassification | null = null;
  let model_called = false;
  if (need.needed) {
    // A cached reply that never parsed (or was truncated) is not evidence: call again.
    if (cached?.llm && cached.llm.usable !== false) {
      llm = cached.llm;
    } else {
      llm = await classifyWithModel(toClassifierInput(item), { model: deps.model, modelName: deps.modelName });
      model_called = true;
    }
  }

  const { profile, merged } = buildItemProfile(item, rules, llm);
  const cache: ClassifiedItem["cache"] = !deps.cache ? "disabled" : cached && !model_called ? "hit" : "miss";
  // Write only what is worth reusing: a fresh, parseable model reply. Rules-only
  // items are recomputed on every call (rules are cheap and change without a
  // taxonomy bump); unusable replies must be retried next time (1.3 validator).
  if (deps.cache && model_called && llm && llm.usable !== false) {
    const row: CachedItemProfile = {
      content_hash: cache_key,
      kind: item.kind,
      ref_id: item.id,
      taxonomy_version: TAXONOMY_VERSION,
      rules,
      llm,
      merged: profile,
      llm_model: llm?.model ?? null,
      created_at: (deps.now ?? (() => new Date()))().toISOString(),
    };
    await deps.cache.set(row);
  }

  return {
    profile,
    rules,
    llm,
    cache_key,
    cache,
    model_needed: need.needed,
    model_called,
    model_reason: need.reason,
    axes_without_rule: need.axes_without_rule,
    discarded_model_axes: merged.discarded_model_axes,
    warnings: merged.warnings,
  };
}

/** Convenience for callers that have no rule classifier yet (scripts before PR 1.2). */
export const classifyItemWithoutRules = (item: NormalizedItem, deps: Omit<ClassifyDeps, "rules">) => classifyItem(item, { ...deps, rules: noRules });
