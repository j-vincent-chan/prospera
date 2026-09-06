/**
 * Rule classifier (plan § PR 1.2; spec §5 "Item classification" — rules
 * first; Appendix B — the mapping). Evaluates every rule in
 * src/lib/fit/signal-mapping.json against one `NormalizedItem` and merges what
 * fired into per-axis category probabilities by noisy-OR,
 * p = 1 − Π(1 − p_i). The result is what PR 1.3 merges with the model: on
 * every axis in `firedAxes` the rules override the model outright.
 *
 * Pure: the MeSH descriptor index and the two data tables come in through
 * `ctx`; nothing here reads Supabase or calls a model, and no threshold lives
 * in code — every probability is the mapping's or a table's.
 *
 * Loud failure, three ways (the PR 0.2 / 1.1 rule applied here):
 *  - a MeSH / check-tag / publication-type name in a clause that the index
 *    does not carry throws `MeshUnknownDescriptorError`;
 *  - a category id in an `assign`, `refine` or table block that the taxonomy
 *    does not carry throws `TaxonomyError`;
 *  - a clause key the evaluator does not implement throws `RuleClauseError`
 *    — a new clause kind in the mapping must not silently never fire.
 *
 * Clause semantics. `when` is a conjunction; `not` (top-level or nested in
 * `when`) is a disjunction of hard negatives. List clauses come in families
 * with a mode suffix: bare `mesh` / `check_tag` / `pubtype` / `mesh_major`
 * mean every listed name is present, `_any` means at least one, `_all` every
 * one; a numeric suffix (`mesh_any_2`) is an independent group ANDed with the
 * others. `mesh_tree_under*` matches any heading whose tree number sits under
 * a prefix; `triangle_class_any` the Weber class of the heading set. CT.gov /
 * RePORTER / directory scalars (`study_type`, `primary_purpose`,
 * `observational_model`, `allocation`, `intervention_model`,
 * `time_perspective`, `clinical_trial_designation`) compare enum-folded;
 * `*_any` list clauses (`phases_any`, `intervention_types_any`,
 * `investigator_role_any`, `activity_code_any`, `rcdc_any`,
 * `title_series_any`) match any element; `enrollment_min` is ≥;
 * `department_match` is a case-insensitive substring of department or
 * division; `intake_field` + `affirmative` reads the intake answer through
 * `isAffirmative`; `*_present` is non-null / non-empty. A `refine` block
 * overrides the rule's own assignment for the categories it names, by the
 * item's value on the refine signal (max over several matching values), before
 * the cross-rule noisy-OR. `assign_from_table` reads study-sections.json /
 * program-divisions.json (family prior spread over the family's categories);
 * an unknown key assigns nothing and is recorded in `unknownTableKeys`.
 * `assign_from_self_declared` maps the D5 record: family rating / max rating
 * → every category of the family, ticked materials → 1.0.
 * `assign_notice` rules are notice overlays (PR 1.5) and never fire on an
 * item; `matchNoticeRules` evaluates their `when` clauses for that PR.
 */
import { normalizeCsvHeader } from "@/lib/csv/normalize-csv-header";
import { resolveDescriptor, treeNumberIsUnder, triangleClass, type MeshIndex } from "@/lib/fit/classify/mesh";
import type { NormalizedItem } from "@/lib/fit/classify/normalize";
import programDivisionsJson from "@/lib/fit/program-divisions.json";
import { isAffirmative, SELF_DECLARED_RATINGS, type SelfDeclaredAxes } from "@/lib/fit/self-declared";
import signalMapping from "@/lib/fit/signal-mapping.json";
import studySectionsJson from "@/lib/fit/study-sections.json";
import { categoriesOf, isDesignId, isMaterialsKind, isObjectiveId, isParadigmCategory, isParadigmFamily, isUnitLevel, TaxonomyError } from "@/lib/fit/taxonomy";

// ---------------------------------------------------------------------------
// The contract (shared with PR 1.3)
// ---------------------------------------------------------------------------

export type Axis = "paradigm" | "unit" | "design" | "materials" | "objective";

export const AXES: readonly Axis[] = ["paradigm", "unit", "design", "materials", "objective"];

/** Category id → probability per axis; ids validated against the taxonomy. */
export type AxisWeights = Partial<Record<Axis, Record<string, number>>>;

/** A table key the item carried that neither data table knows — for the coverage report. */
export type TableMiss = { ruleId: string; table: "study_sections" | "program_divisions"; key: string };

export type RuleClassification = {
  /** Noisy-OR merged over fired rules. */
  axes: AxisWeights;
  fired: Array<{ ruleId: string; axes: Axis[] }>;
  /** Union — PR 1.3 overrides the model on exactly these axes. */
  firedAxes: Axis[];
  /** Refine keys that applied, as `<ruleId>.<signal>.<value>`. */
  refinedBy: string[];
  /** Study-section / division keys seen on the item that the tables do not know (always set by `evaluateRules`). */
  unknownTableKeys?: TableMiss[];
};

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/** One row of study-sections.json / program-divisions.json: family priors spread over the family's categories, optional category-level priors. */
export type FamilyPriorEntry = {
  name?: string;
  names?: string[];
  ic?: string;
  families: Record<string, number>;
  categories?: Record<string, number>;
  _source?: string;
};

export type StudySectionTable = {
  version: string;
  family_prior: number;
  /** Keyed by study_section_code (CSR srg_code) or, for Special Emphasis Panels, by raw_json.full_study_section.sra_designator_code. */
  by_code: Record<string, FamilyPriorEntry>;
  /** Keyed by the panel name, for codes an IC shares across panels; wins over by_code. */
  by_name: Record<string, FamilyPriorEntry>;
};

export type ProgramDivisionTable = {
  version: string;
  family_prior: number;
  /** Keyed by the division's abbreviation; `names` carries the spelled-out forms. */
  entries: Record<string, FamilyPriorEntry>;
};

export type RuleTables = { studySections: StudySectionTable; programDivisions: ProgramDivisionTable };

/** The committed tables. */
export const DEFAULT_RULE_TABLES: RuleTables = {
  studySections: studySectionsJson as unknown as StudySectionTable,
  programDivisions: programDivisionsJson as unknown as ProgramDivisionTable,
};

// ---------------------------------------------------------------------------
// Mapping shapes
// ---------------------------------------------------------------------------

export type AssignBlock = Partial<Record<Axis, Record<string, number>>>;

export type SignalRule = {
  id: string;
  source: string;
  when: Record<string, unknown>;
  not?: Record<string, unknown>;
  assign?: AssignBlock;
  refine?: Record<string, Record<string, AssignBlock>>;
  assign_from_table?: boolean;
  assign_notice?: string;
  assign_from_self_declared?: boolean;
  reliability?: number;
};

export type SignalMapping = { version: string; rules: SignalRule[] };

export const RULE_IDS: readonly string[] = (signalMapping.rules as SignalRule[]).map((r) => r.id);

/** A clause key the evaluator does not implement, or a clause value of the wrong shape. */
export class RuleClauseError extends Error {
  constructor(
    public readonly ruleId: string,
    public readonly key: string,
    detail: string
  ) {
    super(`signal-mapping.json rule ${JSON.stringify(ruleId)}: clause ${JSON.stringify(key)} — ${detail}`);
    this.name = "RuleClauseError";
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const hasOwn = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key);

/** Noisy-OR: p = 1 − Π(1 − p_i). */
export function noisyOr(ps: readonly number[]): number {
  let miss = 1;
  for (const p of ps) miss *= 1 - p;
  return 1 - miss;
}

/** CT.gov / RePORTER enum spelling: upper-case, separators → `_`, `N/A` → `NA` (the PR 0.3 fold). */
export function foldEnum(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (!s) return null;
  return s === "N/A" ? "NA" : s;
}

/** Loose text key: lower-case, punctuation and repeated whitespace folded. */
export function foldText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stringList(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}

function signalList(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}

// ---------------------------------------------------------------------------
// Assign-block validation and family-prior spreading
// ---------------------------------------------------------------------------

const RESOLVERS: Record<Axis, (id: string) => boolean> = {
  paradigm: isParadigmCategory,
  unit: isUnitLevel,
  design: isDesignId,
  materials: isMaterialsKind,
  objective: isObjectiveId,
};

const AXIS_TABLE: Record<Axis, string> = {
  paradigm: "paradigm.categories",
  unit: "unit.levels",
  design: "design.groups[*]",
  materials: "materials.kinds[*]",
  objective: "objective.categories",
};

/** Every id in a block must resolve on its axis with a probability in [0, 1]; throws `TaxonomyError` otherwise. */
export function validateAssignBlock(block: AssignBlock, where: string): void {
  for (const [axis, values] of Object.entries(block)) {
    const resolve = RESOLVERS[axis as Axis];
    if (!resolve) throw new TaxonomyError("axes", axis, `${where}: not one of ${AXES.join(", ")}`);
    for (const [id, p] of Object.entries(values ?? {})) {
      if (!resolve(id)) throw new TaxonomyError(AXIS_TABLE[axis as Axis], id, `${where}.${axis}`);
      if (typeof p !== "number" || !(p >= 0 && p <= 1)) throw new TaxonomyError(AXIS_TABLE[axis as Axis], id, `${where}.${axis}: ${String(p)} is not a probability`);
    }
  }
}

/** A table entry's family priors spread over each family's categories (max with any explicit category priors). Empty when the entry carries no signal. */
export function familyPriorBlock(entry: FamilyPriorEntry, where: string): AssignBlock {
  const paradigm: Record<string, number> = {};
  for (const [family, p] of Object.entries(entry.families ?? {})) {
    if (!isParadigmFamily(family)) throw new TaxonomyError("paradigm.families", family, where);
    if (typeof p !== "number" || !(p >= 0 && p <= 1)) throw new TaxonomyError("paradigm.families", family, `${where}: ${String(p)} is not a probability`);
    for (const cat of categoriesOf(family)) paradigm[cat] = Math.max(paradigm[cat] ?? 0, p);
  }
  for (const [cat, p] of Object.entries(entry.categories ?? {})) {
    if (!isParadigmCategory(cat)) throw new TaxonomyError("paradigm.categories", cat, where);
    if (typeof p !== "number" || !(p >= 0 && p <= 1)) throw new TaxonomyError("paradigm.categories", cat, `${where}: ${String(p)} is not a probability`);
    paradigm[cat] = Math.max(paradigm[cat] ?? 0, p);
  }
  return Object.keys(paradigm).length ? { paradigm } : {};
}

const validatedTables = new WeakSet<object>();

function validateTables(tables: RuleTables): void {
  if (validatedTables.has(tables)) return;
  for (const [key, entry] of Object.entries(tables.studySections.by_code)) familyPriorBlock(entry, `study-sections.json › by_code.${key}`);
  for (const [key, entry] of Object.entries(tables.studySections.by_name)) familyPriorBlock(entry, `study-sections.json › by_name.${key}`);
  for (const [key, entry] of Object.entries(tables.programDivisions.entries)) familyPriorBlock(entry, `program-divisions.json › entries.${key}`);
  validatedTables.add(tables);
}

// ---------------------------------------------------------------------------
// Table lookups
// ---------------------------------------------------------------------------

/** Special Emphasis Panels carry the IC prefix as their code (`ZRG1`, `ZAI1`, …) and the topic only in the SRA designator (PR 0.4 follow-up). */
export function isSpecialEmphasisPanel(signals: Record<string, unknown>): boolean {
  const name = String(signals.study_section ?? "");
  const code = foldEnum(signals.study_section_code) ?? "";
  return /special emphasis panel/i.test(name) || /^Z[A-Z]{2}\d$/.test(code);
}

/** The key the study-section table is consulted with: the panel code, or the SRA designator for a Special Emphasis Panel; null when the row names no panel. */
export function studySectionKey(signals: Record<string, unknown>): string | null {
  if (isSpecialEmphasisPanel(signals)) return foldEnum(signals.sra_designator_code);
  return foldEnum(signals.study_section_code);
}

export type TableLookup = { entry: FamilyPriorEntry; key: string } | { entry: null; key: string | null };

/** by_name first (codes an IC shares across panels), then by_code. */
export function lookupStudySection(table: StudySectionTable, signals: Record<string, unknown>): TableLookup {
  const name = typeof signals.study_section === "string" ? signals.study_section.trim() : "";
  if (name && hasOwn(table.by_name, name)) return { entry: table.by_name[name]!, key: `name:${name}` };
  const key = studySectionKey(signals);
  if (key && hasOwn(table.by_code, key)) return { entry: table.by_code[key]!, key };
  return { entry: null, key };
}

/** The parenthesised abbreviation when the stored division has one, else the folded name against every entry's `names`. */
export function lookupProgramDivision(table: ProgramDivisionTable, division: unknown): TableLookup {
  const text = typeof division === "string" ? division.trim() : "";
  if (!text) return { entry: null, key: null };
  const abbr = /\(([A-Z][A-Z0-9-]{1,10})\)\s*$/.exec(text)?.[1] ?? null;
  if (abbr && hasOwn(table.entries, abbr)) return { entry: table.entries[abbr]!, key: abbr };
  const folded = foldText(text.replace(/\s*\([^)]*\)\s*$/, ""));
  for (const [key, entry] of Object.entries(table.entries)) {
    if ((entry.names ?? []).some((n) => foldText(n) === folded)) return { entry, key };
  }
  if (hasOwn(table.entries, text.toUpperCase())) return { entry: table.entries[text.toUpperCase()]!, key: text.toUpperCase() };
  return { entry: null, key: abbr ?? text };
}

// ---------------------------------------------------------------------------
// Self-declared axes → assignment (D5)
// ---------------------------------------------------------------------------

/** D5 scale (0 / 1 / 3) — the maximum lives in signal-mapping.json; it must agree with the UI's rating steps. */
const MAX_RATING = (signalMapping as { self_declared_rating_max: number }).self_declared_rating_max;
const UI_MAX_RATING = Math.max(...SELF_DECLARED_RATINGS.map((r) => r.value));
if (MAX_RATING !== UI_MAX_RATING) {
  throw new Error(`signal-mapping.json self_declared_rating_max (${MAX_RATING}) does not match the D5 rating scale (${UI_MAX_RATING})`);
}

/**
 * The D5 record as an assign block: each family rating r > 0 lands on every
 * category of the family at r / max rating (Core 3 → 1.0, Some 1 → 0.33; 0 =
 * "Not my work" assigns nothing — the aggregator reads the reliability from
 * the rule); each ticked materials kind lands at 1.0.
 */
export function selfDeclaredBlock(axes: SelfDeclaredAxes | null | undefined): AssignBlock {
  if (!axes) return {};
  const paradigm: Record<string, number> = {};
  for (const [family, rating] of Object.entries(axes.paradigm ?? {})) {
    if (typeof rating !== "number" || rating <= 0) continue;
    if (!isParadigmFamily(family)) throw new TaxonomyError("paradigm.families", family, "self_declared_axes.paradigm");
    const p = Math.min(1, rating / MAX_RATING);
    for (const cat of categoriesOf(family)) paradigm[cat] = Math.max(paradigm[cat] ?? 0, p);
  }
  const materials: Record<string, number> = {};
  for (const kind of axes.materials ?? []) {
    if (!isMaterialsKind(kind)) throw new TaxonomyError("materials.kinds[*]", kind, "self_declared_axes.materials");
    materials[kind] = 1;
  }
  const block: AssignBlock = {};
  if (Object.keys(paradigm).length) block.paradigm = paradigm;
  if (Object.keys(materials).length) block.materials = materials;
  return block;
}

function selfDeclaredAxesOf(item: RuleSubject): SelfDeclaredAxes | null {
  const v = item.signals.self_declared_axes;
  return v && typeof v === "object" ? (v as SelfDeclaredAxes) : null;
}

// ---------------------------------------------------------------------------
// Compiled mapping (names resolved against the index; ids validated) — cached per index
// ---------------------------------------------------------------------------

type ResolvedName = { ui: string; name: string };

type CompiledMapping = {
  mapping: SignalMapping;
  /** clause value (descriptor or publication-type name) → resolved row, for every mesh / check_tag / pubtype clause in the mapping. */
  names: Map<string, ResolvedName>;
};

const compiledByIndex = new WeakMap<MeshIndex, CompiledMapping[]>();

const MESH_NAME_FAMILIES = new Set(["mesh", "mesh_major", "check_tag", "pubtype"]);

type ClauseKey = { family: string; mode: "bare" | "any" | "all" | "present"; group: number };

/** `mesh_any_2` → mesh / any / group 2; `activity_code_present` → activity_code / present; `mesh_tree_under` → mesh_tree_under / bare. */
export function parseClauseKey(key: string): ClauseKey {
  const m = /^(.*?)(?:_(any|all|present))?(?:_(\d+))?$/.exec(key)!;
  return { family: m[1]!, mode: (m[2] as ClauseKey["mode"] | undefined) ?? "bare", group: m[3] ? Number(m[3]) : 0 };
}

function* clauseEntries(rule: SignalRule): Generator<{ key: string; value: unknown; negated: boolean }> {
  for (const [key, value] of Object.entries(rule.when ?? {})) {
    if (key === "not") {
      for (const [k, v] of Object.entries((value ?? {}) as Record<string, unknown>)) yield { key: k, value: v, negated: true };
      continue;
    }
    yield { key, value, negated: false };
  }
  for (const [k, v] of Object.entries(rule.not ?? {})) yield { key: k, value: v, negated: true };
}

function compileMapping(index: MeshIndex, mapping: SignalMapping): CompiledMapping {
  const cached = compiledByIndex.get(index)?.find((c) => c.mapping === mapping);
  if (cached) return cached;
  const names = new Map<string, ResolvedName>();
  for (const rule of mapping.rules) {
    for (const { key, value } of clauseEntries(rule)) {
      const { family } = parseClauseKey(key);
      if (!MESH_NAME_FAMILIES.has(family)) continue;
      for (const name of stringList(value)) {
        if (names.has(name)) continue;
        const row = resolveDescriptor(index, name); // throws MeshUnknownDescriptorError
        names.set(name, { ui: row.ui, name: row.name });
      }
    }
    if (rule.assign) validateAssignBlock(rule.assign, rule.id);
    for (const [signal, byValue] of Object.entries(rule.refine ?? {})) {
      for (const [value, block] of Object.entries(byValue)) validateAssignBlock(block, `${rule.id}.refine.${signal}.${value}`);
    }
  }
  const compiled = { mapping, names };
  const list = compiledByIndex.get(index) ?? [];
  list.push(compiled);
  compiledByIndex.set(index, list);
  return compiled;
}

// ---------------------------------------------------------------------------
// Clause evaluation
// ---------------------------------------------------------------------------

/** What the clauses read: an item, or a notice-shaped record with the same three fields (`matchNoticeRules`). */
export type RuleSubject = Pick<NormalizedItem, "mesh" | "publication_types" | "signals">;

type Env = {
  item: RuleSubject;
  index: MeshIndex;
  compiled: CompiledMapping;
  tables: RuleTables;
  ruleId: string;
  /** Lazily computed Weber class of the item's headings. */
  triangle?: string | null;
  /** Table lookups performed while evaluating the rule's clauses, so `assign_from_table` reuses them. */
  tableHits: Map<string, TableLookup>;
  misses: TableMiss[];
};

function headingMatches(item: RuleSubject, resolved: ResolvedName, major: boolean): boolean {
  return item.mesh.some((h) => (h.ui === resolved.ui || h.name === resolved.name) && (!major || h.major));
}

function listMatch(mode: ClauseKey["mode"], values: string[], test: (v: string) => boolean): boolean {
  if (!values.length) return false;
  return mode === "any" ? values.some(test) : values.every(test);
}

function resolvedName(env: Env, key: string, name: string): ResolvedName {
  const r = env.compiled.names.get(name);
  if (!r) throw new RuleClauseError(env.ruleId, key, `name ${JSON.stringify(name)} was not compiled`);
  return r;
}

function requireList(env: Env, key: string, value: unknown): string[] {
  const list = stringList(value);
  if (!list.length) throw new RuleClauseError(env.ruleId, key, "expected a non-empty list of strings");
  return list;
}

function requireString(env: Env, key: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new RuleClauseError(env.ruleId, key, "expected a string");
  return value;
}

function enumSignalMatches(env: Env, key: string, mode: ClauseKey["mode"], signal: unknown, value: unknown): boolean {
  const have = new Set(signalList(signal).map(foldEnum));
  if (mode === "present") return have.size > 0;
  const want = mode === "bare" && typeof value === "string" ? [value] : requireList(env, key, value);
  const test = (v: string) => have.has(foldEnum(v));
  return mode === "any" ? want.some(test) : want.every(test);
}

/** Signal-name families whose value is compared as a CT.gov / RePORTER enum. */
const ENUM_SIGNALS: Record<string, string> = {
  study_type: "study_type",
  phases: "phases",
  primary_purpose: "primary_purpose",
  allocation: "allocation",
  intervention_model: "intervention_model",
  observational_model: "observational_model",
  time_perspective: "time_perspective",
  intervention_types: "intervention_types",
  investigator_role: "investigator_role",
  activity_code: "activity_code",
  clinical_trial_designation: "clinical_trial_designation",
};

function evalClause(env: Env, key: string, value: unknown): boolean {
  const { item } = env;
  const { family, mode } = parseClauseKey(key);
  switch (family) {
    case "mesh":
    case "mesh_major":
    case "check_tag": {
      const names = requireList(env, key, value);
      return listMatch(mode, names, (n) => headingMatches(item, resolvedName(env, key, n), family === "mesh_major"));
    }
    case "pubtype": {
      const names = requireList(env, key, value);
      const have = new Set(item.publication_types);
      return listMatch(mode, names, (n) => have.has(resolvedName(env, key, n).name) || have.has(n));
    }
    case "mesh_tree_under": {
      const prefixes = requireList(env, key, value);
      const trees = item.mesh.flatMap((h) => resolveDescriptor(env.index, h.ui).tree_numbers);
      return listMatch(mode === "bare" ? "any" : mode, prefixes, (p) => trees.some((t) => treeNumberIsUnder(t, p)));
    }
    case "triangle_class": {
      const classes = requireList(env, key, value);
      if (env.triangle === undefined) env.triangle = item.mesh.length ? triangleClass(env.index, item.mesh.map((h) => h.ui)) : null;
      return env.triangle != null && classes.includes(env.triangle);
    }
    case "enrollment_min": {
      if (typeof value !== "number") throw new RuleClauseError(env.ruleId, key, "expected a number");
      const n = item.signals.enrollment;
      return typeof n === "number" && n >= value;
    }
    case "rcdc": {
      // NULL (RePORTER has no categories) and [] alike: nothing to match.
      const have = new Set(signalList(item.signals.rcdc_categories).map((s) => foldText(s)));
      if (mode === "present") return have.size > 0;
      const want = mode === "bare" && typeof value === "string" ? [value] : requireList(env, key, value);
      return listMatch(mode === "bare" ? "all" : mode, want, (v) => have.has(foldText(v)));
    }
    case "title_series": {
      const have = foldText(item.signals.title_series);
      if (mode === "present") return have.length > 0;
      const want = mode === "bare" && typeof value === "string" ? [value] : requireList(env, key, value);
      return have.length > 0 && listMatch(mode === "bare" ? "all" : mode, want, (v) => ` ${have} `.includes(` ${foldText(v)} `));
    }
    case "department_match": {
      const needle = foldText(requireString(env, key, value));
      return [item.signals.department, item.signals.division].some((d) => typeof d === "string" && foldText(d).includes(needle));
    }
    case "intake_field": {
      const field = normalizeCsvHeader(requireString(env, key, value));
      const intake = (item.signals.intake ?? {}) as Record<string, unknown>;
      const answer = intake[field];
      const affirmative = (env.compiled.mapping.rules.find((r) => r.id === env.ruleId)?.when?.affirmative ?? true) !== false;
      return typeof answer === "string" && answer.trim() !== "" && (!affirmative || isAffirmative(answer));
    }
    case "affirmative":
      // A modifier on intake_field, consumed there.
      return true;
    case "self_declared": {
      if (mode !== "present") throw new RuleClauseError(env.ruleId, key, "only self_declared_present is defined");
      const axes = selfDeclaredAxesOf(item);
      const present = Boolean(axes && (Object.values(axes.paradigm ?? {}).some((r) => typeof r === "number") || (axes.materials ?? []).length > 0));
      return value === false ? !present : present;
    }
    case "study_section_family_table": {
      requireString(env, key, value);
      const hit = lookupStudySection(env.tables.studySections, item.signals);
      env.tableHits.set(key, hit);
      if (!hit.entry && hit.key) env.misses.push({ ruleId: env.ruleId, table: "study_sections", key: hit.key });
      return hit.entry != null;
    }
    case "program_division_table": {
      requireString(env, key, value);
      const hit = lookupProgramDivision(env.tables.programDivisions, item.signals.program_division);
      env.tableHits.set(key, hit);
      if (!hit.entry && hit.key) env.misses.push({ ruleId: env.ruleId, table: "program_divisions", key: hit.key });
      return hit.entry != null;
    }
    default: {
      const signal = ENUM_SIGNALS[family];
      if (signal) return enumSignalMatches(env, key, mode, item.signals[signal], value);
      throw new RuleClauseError(env.ruleId, key, "no evaluator implements this clause kind (add it to rules.ts and a test)");
    }
  }
}

/** `when` as a conjunction with its `not` (and the rule's top-level `not`) as hard negatives. */
function ruleMatches(env: Env, rule: SignalRule): boolean {
  for (const { key, value, negated } of clauseEntries(rule)) {
    const hit = evalClause(env, key, value);
    if (negated ? hit : !hit) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Assignment for one fired rule
// ---------------------------------------------------------------------------

function cloneBlock(block: AssignBlock): AssignBlock {
  const out: AssignBlock = {};
  for (const [axis, values] of Object.entries(block)) out[axis as Axis] = { ...(values ?? {}) };
  return out;
}

/** The rule's own block after its `refine` overrides (max over every matching refine value per category). */
function refinedBlock(env: Env, rule: SignalRule): { block: AssignBlock; refinedBy: string[] } {
  const block = cloneBlock(rule.assign ?? {});
  const refinedBy: string[] = [];
  const overrides: AssignBlock = {};
  for (const [refineKey, byValue] of Object.entries(rule.refine ?? {})) {
    const { family } = parseClauseKey(refineKey);
    const signal = ENUM_SIGNALS[family] ?? family;
    const have = signalList(env.item.signals[signal]).map(foldEnum);
    for (const [value, override] of Object.entries(byValue)) {
      if (!have.includes(foldEnum(value))) continue;
      refinedBy.push(`${rule.id}.${refineKey}.${value}`);
      for (const [axis, values] of Object.entries(override)) {
        const target = (overrides[axis as Axis] ??= {});
        for (const [id, p] of Object.entries(values ?? {})) target[id] = Math.max(target[id] ?? 0, p);
      }
    }
  }
  for (const [axis, values] of Object.entries(overrides)) {
    const target = (block[axis as Axis] ??= {});
    for (const [id, p] of Object.entries(values ?? {})) target[id] = p;
  }
  return { block, refinedBy };
}

function tableBlock(env: Env, rule: SignalRule): AssignBlock {
  const hit = env.tableHits.get("study_section_family_table") ?? env.tableHits.get("program_division_table");
  if (!hit?.entry) return {};
  return familyPriorBlock(hit.entry, `${rule.id} ← ${hit.key}`);
}

function assignedAxes(block: AssignBlock): Axis[] {
  return AXES.filter((axis) => Object.keys(block[axis] ?? {}).length > 0);
}

/**
 * D5: the import wizard unions the intake-derived materials into
 * `self_declared_axes.materials`, so an `intake_field` rule and
 * `assign_from_self_declared` would otherwise count one answer twice. The
 * stored record wins; the intake text is the fallback for rows imported
 * before PR 0.7 or whose checklist was cleared.
 */
function intakeRuleSuperseded(item: RuleSubject, rule: SignalRule): boolean {
  if (typeof rule.when?.intake_field !== "string") return false;
  const stored = new Set(selfDeclaredAxesOf(item)?.materials ?? []);
  return Object.keys(rule.assign?.materials ?? {}).some((kind) => stored.has(kind as never));
}

// ---------------------------------------------------------------------------
// evaluateRules
// ---------------------------------------------------------------------------

export type EvaluateContext = {
  mesh: MeshIndex;
  tables: RuleTables;
  /** Test hook: evaluate a different mapping (a typo must throw). Defaults to signal-mapping.json. */
  mapping?: SignalMapping;
};

/** Every rule in the mapping against one item; see the module comment for the semantics. */
export function evaluateRules(item: NormalizedItem, ctx: EvaluateContext): RuleClassification {
  const mapping = ctx.mapping ?? (signalMapping as unknown as SignalMapping);
  const compiled = compileMapping(ctx.mesh, mapping);
  validateTables(ctx.tables);

  const contributions: Partial<Record<Axis, Record<string, number[]>>> = {};
  const fired: RuleClassification["fired"] = [];
  const refinedBy: string[] = [];
  const misses: TableMiss[] = [];

  for (const rule of mapping.rules) {
    if (rule.assign_notice) continue; // notice overlays — PR 1.5, see matchNoticeRules
    const env: Env = { item, index: ctx.mesh, compiled, tables: ctx.tables, ruleId: rule.id, tableHits: new Map(), misses };
    if (!ruleMatches(env, rule)) continue;
    if (intakeRuleSuperseded(item, rule)) continue;

    let block: AssignBlock;
    if (rule.assign_from_table) block = tableBlock(env, rule);
    else if (rule.assign_from_self_declared) block = selfDeclaredBlock(selfDeclaredAxesOf(item));
    else {
      const r = refinedBlock(env, rule);
      block = r.block;
      refinedBy.push(...r.refinedBy);
    }

    const axes = assignedAxes(block);
    if (!axes.length) continue; // matched, nothing to assign (a known panel with no prior, an empty self-report)
    fired.push({ ruleId: rule.id, axes });
    for (const axis of axes) {
      const target = (contributions[axis] ??= {});
      for (const [id, p] of Object.entries(block[axis] ?? {})) (target[id] ??= []).push(p);
    }
  }

  const axes: AxisWeights = {};
  for (const axis of AXES) {
    const cats = contributions[axis];
    if (!cats) continue;
    const merged: Record<string, number> = {};
    for (const [id, ps] of Object.entries(cats)) merged[id] = noisyOr(ps);
    axes[axis] = merged;
  }

  return {
    axes,
    fired,
    firedAxes: AXES.filter((axis) => fired.some((f) => f.axes.includes(axis))),
    refinedBy,
    unknownTableKeys: dedupeMisses(misses),
  };
}

function dedupeMisses(misses: TableMiss[]): TableMiss[] {
  const seen = new Set<string>();
  return misses.filter((m) => {
    const k = `${m.ruleId}|${m.table}|${m.key}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Notice rules (assign_notice) — clause evaluation only; PR 1.5 applies the overlays
// ---------------------------------------------------------------------------

export type NoticeRuleMatch = { ruleId: string; assign_notice: string };

/**
 * The `assign_notice` rules whose `when` matches a notice-shaped record
 * (`signals.clinical_trial_designation`, `signals.activity_code`, …; `mesh`
 * and `publication_types` empty). They never contribute to `evaluateRules`;
 * PR 1.5's `deterministicOverlays` resolves each `assign_notice` path against
 * taxonomy.opportunity_profile.
 */
export function matchNoticeRules(item: RuleSubject, ctx: EvaluateContext): NoticeRuleMatch[] {
  const mapping = ctx.mapping ?? (signalMapping as unknown as SignalMapping);
  const compiled = compileMapping(ctx.mesh, mapping);
  const out: NoticeRuleMatch[] = [];
  for (const rule of mapping.rules) {
    if (!rule.assign_notice) continue;
    const env: Env = { item, index: ctx.mesh, compiled, tables: ctx.tables, ruleId: rule.id, tableHits: new Map(), misses: [] };
    if (ruleMatches(env, rule)) out.push({ ruleId: rule.id, assign_notice: rule.assign_notice });
  }
  return out;
}
