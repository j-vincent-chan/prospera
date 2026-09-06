/**
 * Contract shared between the rule classifier (PR 1.2, `rules.ts` /
 * `normalize.ts`) and the LLM item classifier (PR 1.3, `llm.ts` / `index.ts`).
 *
 * PR 1.3 was built against this contract before PR 1.2 landed, so the shapes
 * are declared here structurally. Once PR 1.2 merges, these become
 * re-exports of the real types (one-line swap by the coordinator) — nothing
 * in `llm.ts`, `index.ts` or their tests depends on more than what is written
 * here.
 */

/** The record kinds the classifier sees (item-classifier prompt spec › Inputs). */
export type NormalizedItemKind =
  | "publication"
  | "grant"
  | "trial"
  | "biosketch_statement"
  | "biosketch_contribution"
  | "profiles_narrative"
  | "self_declared";

/** One MeSH heading on a publication, as PR 0.2 stores it. */
export type NormalizedMesh = { ui: string; name: string; major: boolean; qualifiers: string[] };

/**
 * One evidence item after PR 1.2's `normalize.ts`: the prose the model reads,
 * the structure the rules read, and the identity fields aggregation needs.
 * `signals` carries source-specific structure (CT.gov enums, activity code,
 * RCDC categories, author position …) that only the rules interpret.
 */
export type NormalizedItem = {
  id: string;
  kind: NormalizedItemKind;
  title: string | null;
  text: string | null;
  year: number | null;
  role: string | null;
  mesh: NormalizedMesh[];
  publication_types: string[];
  signals: Record<string, unknown>;
};

/** The five structured axes (spec §4); topic is separate and never gates. */
export type Axis = "paradigm" | "unit" | "design" | "materials" | "objective";

/** Per axis, category id → probability in [0, 1]; an absent axis or id is 0. */
export type AxisWeights = Partial<Record<Axis, Record<string, number>>>;

/** What the rule classifier decided for one item (PR 1.2 `evaluateRules`). */
export type RuleClassification = {
  axes: AxisWeights;
  /** Every rule that fired and the axes it assigned. */
  fired: Array<{ ruleId: string; axes: Axis[] }>;
  /** The axes at least one rule assigned — the model's values on these are discarded (§5 "rules override"). */
  firedAxes: Axis[];
  /** Ids of `refine` blocks that adjusted a fired rule's values. */
  refinedBy: string[];
};

/** PR 1.2's `evaluateRules`, partially applied with its context (MeSH index, lookup tables). */
export type RulesFn = (item: NormalizedItem) => RuleClassification;

/** The five axes in taxonomy order. */
export const AXES: readonly Axis[] = ["paradigm", "unit", "design", "materials", "objective"];

/** A `RulesFn` that never fires — for tests and for running the classifier before PR 1.2 lands. */
export const noRules: RulesFn = () => ({ axes: {}, fired: [], firedAxes: [], refinedBy: [] });
