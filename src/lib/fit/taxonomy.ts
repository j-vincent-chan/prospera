/**
 * Typed, side-effect-free accessors over src/lib/fit/taxonomy.json (plan
 * § PR 1.1). Spec: docs/MATCHING_REDESIGN.md §4 (axes and matrices), §5
 * (aggregation), §8 (compose), §9 (gates and exceptions), §10 (floors).
 *
 * Every threshold, weight and matrix value the engine uses is read from the
 * JSON through one of these functions; nothing here scores. An id that is
 * not in the table throws `TaxonomyError` naming the table and the id — a
 * typo in a rule or a drifted fixture must fail loudly, never come back as
 * `undefined` and quietly zero a component (the MeSH-name rule in
 * classify/mesh.ts, applied to the taxonomy).
 */
import taxonomy from "@/lib/fit/taxonomy.json";
import {
  DESIGN_IDS,
  MATERIALS_KIND_IDS,
  OBJECTIVE_IDS,
  UNIT_IDS,
  type ClinicalTrialDesignation,
  type Confidence,
  type ConfidenceCapId,
  type DesignGroup,
  type DesignId,
  type EvidenceRole,
  type EvidenceSource,
  type ExploratoryExceptionId,
  type FeedbackReasonId,
  type FloorTier,
  type MaterialsGroup,
  type MaterialsKind,
  type MatrixFamily,
  type ObjectiveId,
  type ParadigmCategory,
  type ParadigmFamily,
  type ParadigmWeights,
  type Tier,
  type TierFloors,
  type UnitId,
  type UnitLevel,
} from "@/lib/fit/types";

export { DESIGN_IDS, MATERIALS_KIND_IDS, OBJECTIVE_IDS, UNIT_IDS };

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** An id that is not in the named taxonomy table. `table` is the JSON key path. */
export class TaxonomyError extends Error {
  constructor(
    public readonly table: string,
    public readonly id: string,
    hint?: string
  ) {
    super(
      `Unknown id ${JSON.stringify(id)} in taxonomy.json › ${table}` +
        (hint ? ` — ${hint}` : "") +
        ". Ids must match src/lib/fit/taxonomy.json exactly."
    );
    this.name = "TaxonomyError";
  }
}

const hasOwn = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key);

function lookup<T>(table: Record<string, T>, id: string, path: string, hint?: string): T {
  if (hasOwn(table, id)) return table[id]!;
  throw new TaxonomyError(path, id, hint);
}

/** id → parent for the array-valued tables (units in levels, designs in groups, kinds in groups). */
function invert<Parent extends string>(groups: Record<Parent, readonly string[]>): Map<string, Parent> {
  const out = new Map<string, Parent>();
  for (const parent of Object.keys(groups) as Parent[]) {
    for (const id of groups[parent]) out.set(id, parent);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Version and id lists (taxonomy order)
// ---------------------------------------------------------------------------

/** `taxonomy.version`; stored on every profile and item so a taxonomy change re-classifies (§5). */
export const TAXONOMY_VERSION: string = taxonomy.version;

export const PARADIGM_FAMILY_IDS = Object.keys(taxonomy.paradigm.families) as readonly ParadigmFamily[];
export const PARADIGM_CATEGORY_IDS = Object.keys(taxonomy.paradigm.categories) as readonly ParadigmCategory[];
/** `paradigm.family_compat.order` — the families with a row in the matrix. */
export const MATRIX_FAMILY_IDS = taxonomy.paradigm.family_compat.order as readonly MatrixFamily[];
export const UNIT_LEVEL_IDS = Object.keys(taxonomy.unit.levels) as readonly UnitLevel[];
export const DESIGN_GROUP_IDS = Object.keys(taxonomy.design.groups) as readonly DesignGroup[];
export const MATERIALS_GROUP_IDS = Object.keys(taxonomy.materials.kinds) as readonly MaterialsGroup[];
/** `taxonomy.tiers` keys, best first. */
export const TIER_IDS = Object.keys(taxonomy.tiers).filter((k) => !k.startsWith("_")) as readonly Tier[];
export const EVIDENCE_SOURCE_IDS = Object.keys(taxonomy.aggregation.reliability) as readonly EvidenceSource[];
export const EVIDENCE_ROLE_IDS = Object.keys(taxonomy.aggregation.role) as readonly EvidenceRole[];
export const EXPLORATORY_EXCEPTION_IDS = Object.keys(taxonomy.exploratory_exceptions).filter((k) => !k.startsWith("_")) as readonly ExploratoryExceptionId[];
export const CONFIDENCE_CAP_IDS = Object.keys(taxonomy.confidence_caps).map((k) => k.replace(/_max_tier$/, "")) as readonly ConfidenceCapId[];
export const CLINICAL_TRIAL_DESIGNATION_IDS = Object.keys(taxonomy.opportunity_profile.clinical_trial_designation) as readonly ClinicalTrialDesignation[];

const CONFIDENCE_LEVELS: readonly Confidence[] = ["low", "medium", "high"];

// ---------------------------------------------------------------------------
// Type guards — for validating ids that arrive as strings (rule tables, model output, stored JSON)
// ---------------------------------------------------------------------------

export const isParadigmFamily = (id: string): id is ParadigmFamily => hasOwn(taxonomy.paradigm.families, id);
export const isParadigmCategory = (id: string): id is ParadigmCategory => hasOwn(taxonomy.paradigm.categories, id);
export const isMatrixFamily = (id: string): id is MatrixFamily => (MATRIX_FAMILY_IDS as readonly string[]).includes(id);
export const isUnitLevel = (id: string): id is UnitLevel => hasOwn(taxonomy.unit.levels, id);
export const isUnitId = (id: string): id is UnitId => (UNIT_IDS as readonly string[]).includes(id);
export const isDesignGroup = (id: string): id is DesignGroup => hasOwn(taxonomy.design.groups, id);
export const isDesignId = (id: string): id is DesignId => (DESIGN_IDS as readonly string[]).includes(id);
export const isMaterialsGroup = (id: string): id is MaterialsGroup => hasOwn(taxonomy.materials.kinds, id);
export const isMaterialsKind = (id: string): id is MaterialsKind => (MATERIALS_KIND_IDS as readonly string[]).includes(id);
export const isObjectiveId = (id: string): id is ObjectiveId => (OBJECTIVE_IDS as readonly string[]).includes(id);
export const isTier = (id: string): id is Tier => (TIER_IDS as readonly string[]).includes(id);
export const isConfidence = (id: string): id is Confidence => (CONFIDENCE_LEVELS as readonly string[]).includes(id);
export const isEvidenceSource = (id: string): id is EvidenceSource => hasOwn(taxonomy.aggregation.reliability, id);
export const isEvidenceRole = (id: string): id is EvidenceRole => hasOwn(taxonomy.aggregation.role, id);

// ---------------------------------------------------------------------------
// Axis A · paradigm (§4 Axis A)
// ---------------------------------------------------------------------------

type CategoryRow = { family: string; label: string };
type FamilyRow = { label: string; categories: string[] };

const CATEGORIES = taxonomy.paradigm.categories as Record<string, CategoryRow>;
const FAMILIES = taxonomy.paradigm.families as Record<string, FamilyRow>;

/** The family a category belongs to. */
export function familyOf(category: ParadigmCategory | string): ParadigmFamily {
  return lookup(CATEGORIES, category, "paradigm.categories").family as ParadigmFamily;
}

/** The categories in a family, in taxonomy order. */
export function categoriesOf(family: ParadigmFamily | string): readonly ParadigmCategory[] {
  return lookup(FAMILIES, family, "paradigm.families").categories as readonly ParadigmCategory[];
}

export function familyLabel(family: ParadigmFamily | string): string {
  return lookup(FAMILIES, family, "paradigm.families").label;
}

export function categoryLabel(category: ParadigmCategory | string): string {
  return lookup(CATEGORIES, category, "paradigm.categories").label;
}

const CROSS_CUTTING_HINT = "not in paradigm.family_compat.order; cross-cutting paradigms do not gate on their own — P for them comes from the unit and design axes (§4, §7 stage 2). Check isMatrixFamily() first";

function matrixIndex(family: string): number {
  const i = (MATRIX_FAMILY_IDS as readonly string[]).indexOf(family);
  if (i < 0) throw new TaxonomyError("paradigm.family_compat.order", family, isParadigmFamily(family) ? CROSS_CUTTING_HINT : undefined);
  return i;
}

/**
 * compat(fam_i, fam_o) from the family matrix (§4 "Family compatibility
 * matrix"). Symmetric. Throws for a family outside the matrix (cross_cutting).
 */
export function familyCompat(a: MatrixFamily | string, b: MatrixFamily | string): number {
  return taxonomy.paradigm.family_compat.matrix[matrixIndex(a)]![matrixIndex(b)]!;
}

/**
 * compat(cat_i, cat_o): same category `within_family.same_category`, sibling
 * category `within_family.sibling_category`, otherwise the family matrix
 * (§4). There is no category-level matrix in the JSON; this is the spec's
 * "computed at the family level first, then refined within a family".
 */
export function categoryCompat(a: ParadigmCategory | string, b: ParadigmCategory | string): number {
  const fa = familyOf(a);
  const fb = familyOf(b);
  if (a === b) return taxonomy.paradigm.within_family.same_category;
  if (fa === fb) return taxonomy.paradigm.within_family.sibling_category;
  return familyCompat(fa, fb);
}

/** `paradigm.within_family` — same-category and sibling-category values (§4). */
export function withinFamily(): Readonly<typeof taxonomy.paradigm.within_family> {
  return taxonomy.paradigm.within_family;
}

/** `paradigm.gates` — the P thresholds for Poor and Exploratory and the excluded-paradigm rule (§7 stage 2; §9). */
export function paradigmGates(): Readonly<typeof taxonomy.paradigm.gates> {
  return taxonomy.paradigm.gates;
}

// ---------------------------------------------------------------------------
// Axis B · unit of analysis (§4 Axis B)
// ---------------------------------------------------------------------------

type LevelRow = { label: string; units: string[] };
const LEVELS = taxonomy.unit.levels as Record<string, LevelRow>;
const UNIT_TO_LEVEL = invert(Object.fromEntries(Object.entries(LEVELS).map(([k, v]) => [k, v.units])) as Record<UnitLevel, string[]>);

/** The level a unit sits at. */
export function levelOf(unit: UnitId | string): UnitLevel {
  const level = UNIT_TO_LEVEL.get(unit);
  if (!level) throw new TaxonomyError("unit.levels[*].units", unit, isUnitLevel(unit) ? "that is a level id, not a unit" : undefined);
  return level;
}

/** The units at a level, in taxonomy order. */
export function unitsOf(level: UnitLevel | string): readonly UnitId[] {
  return lookup(LEVELS, level, "unit.levels").units as readonly UnitId[];
}

export function levelLabel(level: UnitLevel | string): string {
  return lookup(LEVELS, level, "unit.levels").label;
}

function levelIndex(level: string): number {
  const i = taxonomy.unit.level_compat.order.indexOf(level);
  if (i < 0) throw new TaxonomyError("unit.level_compat.order", level);
  return i;
}

/** compat(L_i, L_o) from the level matrix (§4 Axis B). Symmetric. */
export function levelCompat(a: UnitLevel | string, b: UnitLevel | string): number {
  return taxonomy.unit.level_compat.matrix[levelIndex(a)]![levelIndex(b)]!;
}

/** `unit.gates` — the U threshold for Poor (§7 stage 3). */
export function unitGates(): Readonly<typeof taxonomy.unit.gates> {
  return taxonomy.unit.gates;
}

// ---------------------------------------------------------------------------
// Axis C · study design (§4 Axis C)
// ---------------------------------------------------------------------------

const DESIGN_GROUPS = taxonomy.design.groups as Record<string, string[]>;
const DESIGN_TO_GROUP = invert(DESIGN_GROUPS as Record<DesignGroup, string[]>);

/** The group a design belongs to. */
export function designGroupOf(design: DesignId | string): DesignGroup {
  const group = DESIGN_TO_GROUP.get(design);
  if (!group) throw new TaxonomyError("design.groups[*]", design, isDesignGroup(design) ? "that is a group id, not a design" : undefined);
  return group;
}

/** The designs in a group, in taxonomy order. */
export function designsOf(group: DesignGroup | string): readonly DesignId[] {
  return lookup(DESIGN_GROUPS, group, "design.groups") as readonly DesignId[];
}

/** `design.score` — the required / allowed / not-prohibited weights of D (§7 stage 4). */
export function designScoreWeights(): Readonly<typeof taxonomy.design.score> {
  return taxonomy.design.score;
}

/** `design.gates` — unsupported-required-group cap and prohibited-dominant penalty (§7 stage 4; §9). */
export function designGates(): Readonly<{
  required_group_unsupported_below: number;
  required_unsupported_cap_tier: Tier;
  prohibited_dominant_share: number;
  prohibited_penalty_factor: number;
}> {
  const g = taxonomy.design.gates;
  if (!isTier(g.required_unsupported_cap_tier)) throw new TaxonomyError("tiers", g.required_unsupported_cap_tier, "design.gates.required_unsupported_cap_tier must name a tier");
  return { ...g, required_unsupported_cap_tier: g.required_unsupported_cap_tier };
}

// ---------------------------------------------------------------------------
// Axis D · materials and data (§4 Axis D)
// ---------------------------------------------------------------------------

const MATERIALS_GROUPS = taxonomy.materials.kinds as Record<string, string[]>;
const KIND_TO_GROUP = invert(MATERIALS_GROUPS as Record<MaterialsGroup, string[]>);

/** The group a materials kind belongs to. */
export function materialsGroupOf(kind: MaterialsKind | string): MaterialsGroup {
  const group = KIND_TO_GROUP.get(kind);
  if (!group) throw new TaxonomyError("materials.kinds[*]", kind, isMaterialsGroup(kind) ? "that is a group id, not a kind" : undefined);
  return group;
}

/** The kinds in a group, in taxonomy order. */
export function materialsOf(group: MaterialsGroup | string): readonly MaterialsKind[] {
  return lookup(MATERIALS_GROUPS, group, "materials.kinds") as readonly MaterialsKind[];
}

// ---------------------------------------------------------------------------
// Aggregation (§5)
// ---------------------------------------------------------------------------

/** `aggregation.reliability[source]` — source reliability weight (§5 Sources table). */
export function reliability(source: EvidenceSource | string): number {
  return lookup(taxonomy.aggregation.reliability as Record<string, number>, source, "aggregation.reliability");
}

/** `aggregation.role[role]` — author / PI role weight (§5 aggregation). */
export function roleWeight(role: EvidenceRole | string): number {
  return lookup(taxonomy.aggregation.role as Record<string, number>, role, "aggregation.role");
}

/** `aggregation.recency` — half-life, floor and the recent-view window (§5 aggregation). */
export function recency(): Readonly<typeof taxonomy.aggregation.recency> {
  return taxonomy.aggregation.recency;
}

/** `aggregation.saturation_exponent` — share^exponent (§5 aggregation). */
export function saturationExponent(): number {
  return taxonomy.aggregation.saturation_exponent;
}

/** `aggregation.thin_evidence` — the cap when fewer than `min_items` items (or `min_grants` grants) support a category (§5). */
export function thinEvidence(): Readonly<typeof taxonomy.aggregation.thin_evidence> {
  return taxonomy.aggregation.thin_evidence;
}

/** `aggregation.confidence` — evidence-mass and distinct-source thresholds for medium and high (§5). */
export function confidenceThresholds(): Readonly<typeof taxonomy.aggregation.confidence> {
  return taxonomy.aggregation.confidence;
}

/**
 * `aggregation.thin_evidence.prior_sources` — the sources the spec calls "a
 * prior, not evidence" (§5 Sources table: UCSF Profiles, directory metadata).
 * They weigh in the shares but never lift the thin-evidence cap and never
 * count as a distinct source for confidence (D20). Every entry must be a
 * reliability key.
 */
export function priorSources(): readonly EvidenceSource[] {
  const list = taxonomy.aggregation.thin_evidence.prior_sources as readonly string[];
  for (const s of list) if (!isEvidenceSource(s)) throw new TaxonomyError("aggregation.reliability", s, "aggregation.thin_evidence.prior_sources must name reliability keys");
  return list as readonly EvidenceSource[];
}

/** True when `source` is in `aggregation.thin_evidence.prior_sources`. */
export function isPriorSource(source: EvidenceSource | string): boolean {
  return (priorSources() as readonly string[]).includes(source);
}

/**
 * `aggregation.source_origin[source]` — the origin a source belongs to for
 * distinct-source counting (both ClinicalTrials.gov roles are one registry;
 * D20). The `_comment` key is not a source and throws like an unknown id.
 */
export function sourceOrigin(source: EvidenceSource | string): string {
  if (source.startsWith("_")) throw new TaxonomyError("aggregation.source_origin", source);
  return lookup(taxonomy.aggregation.source_origin as Record<string, string>, source, "aggregation.source_origin");
}

/** `aggregation.provenance_top` — evidence ids kept per (axis, category) in a profile's `provenance` (§5 profile record: top_items). */
export function provenanceTop(): number {
  return taxonomy.aggregation.provenance_top;
}

// ---------------------------------------------------------------------------
// Characteristics (§5 "Investigator characteristics")
// ---------------------------------------------------------------------------

/** `characteristics.r01_equivalent_codes` — activity codes whose award ends ESI status (NIH's list; PR 1.4 `characteristicsFrom`). */
export function r01EquivalentCodes(): readonly string[] {
  return taxonomy.characteristics.r01_equivalent_codes;
}

// ---------------------------------------------------------------------------
// Compose (§8)
// ---------------------------------------------------------------------------

/** `compose.exponents` — P, D and U exponents of the compatibility factor (§8). */
export function composeExponents(): Readonly<typeof taxonomy.compose.exponents> {
  return taxonomy.compose.exponents;
}

/** `compose.relevance_weights` — T M O K A weights of the additive term (§8). */
export function relevanceWeights(): Readonly<typeof taxonomy.compose.relevance_weights> {
  return taxonomy.compose.relevance_weights;
}

/** `compose.topic` — coded / embedding / BM25 weights, the embedding rescale band, top-k, and the Strong depth (§7 stage 5; §11). */
export function topicWeights(): Readonly<typeof taxonomy.compose.topic> {
  return taxonomy.compose.topic;
}

/** `compose.topic.bm25` — BM25's k1 and b for the term half of T (§11 rule 2; a PR 2.2 prior). */
export function bm25Params(): Readonly<{ k1: number; b: number }> {
  return taxonomy.compose.topic.bm25;
}

/** `compose.retrieval` — the embedding recall net's top-N and the near-miss (paradigm-compatible, topic-low) band (§7 stage 1; §16 candidate generation; PR 2.2). */
export function retrievalParams(): Readonly<{ embedding_top_n: number; near_miss: { p_min: number; t_max: number } }> {
  return taxonomy.compose.retrieval;
}

/** `compose.actionability` — runway weeks (and the ladder rows that need the shorter one), load penalty and dismissal suppression (§7 stage 7). */
export function actionabilityParams(): Readonly<typeof taxonomy.compose.actionability> {
  return taxonomy.compose.actionability;
}

/** `compose.methods` — the evidence weight a required capability needs to count as met, and the credit for infrastructure UCSF has institutionally (§7 stage 6). */
export function methodsParams(): Readonly<typeof taxonomy.compose.methods> {
  return taxonomy.compose.methods;
}

/** `compose.track` — the readiness ladder, readiness values, the row-based `far_above` rule, term weights and saturations of K (§7 stage 7; §9 "mechanism far above readiness"). */
export function trackParams(): Readonly<typeof taxonomy.compose.track> {
  return taxonomy.compose.track;
}

/**
 * The rung of an activity code on `compose.track.readiness_ladder` (0 = career
 * awards, rows ascending: K → R21/R03 → R01 → U01/P01). The ladder is a list of
 * priors, not a registry of codes, so a code on no row returns null ("unknown
 * readiness") rather than throwing. Case-insensitive; surrounding whitespace ignored.
 */
export function readinessRung(code: string | null | undefined): number | null {
  if (!code) return null;
  const c = code.trim().toUpperCase();
  const i = taxonomy.compose.track.readiness_ladder.findIndex((row) => row.includes(c));
  return i < 0 ? null : i;
}

// ---------------------------------------------------------------------------
// Tiers (§10)
// ---------------------------------------------------------------------------

const TIERS = taxonomy.tiers as unknown as Record<string, Record<string, unknown>>;

/**
 * The conjunctive floors of a tier (§10 table). Absent keys mean "any".
 * `poor` has no floors and throws — it is what is left when Exploratory's
 * floors are not met.
 */
export function floors(tier: FloorTier | string): Readonly<TierFloors> {
  if (!isTier(tier)) throw new TaxonomyError("tiers", tier);
  const row = lookup(TIERS, tier, "tiers");
  if (!("P" in row)) throw new TaxonomyError("tiers", tier, "this tier carries no floors");
  return row as TierFloors;
}

/** `tiers.poor` — hidden by default, explained on request (§10). */
export function poorTier(): Readonly<typeof taxonomy.tiers.poor> {
  return taxonomy.tiers.poor;
}

// ---------------------------------------------------------------------------
// Exceptions and caps (§9; §7 stage 9)
// ---------------------------------------------------------------------------

/** `exploratory_exceptions[id]` — when a paradigm-gated Poor may surface as Exploratory (§9). */
export function exploratoryException<Id extends ExploratoryExceptionId>(id: Id): Readonly<(typeof taxonomy.exploratory_exceptions)[Id]>;
export function exploratoryException(id: string): Readonly<Record<string, number | boolean | string[]>>;
export function exploratoryException(id: string) {
  if (id.startsWith("_")) throw new TaxonomyError("exploratory_exceptions", id);
  return lookup(taxonomy.exploratory_exceptions as unknown as Record<string, Record<string, number | boolean | string[]>>, id, "exploratory_exceptions");
}

/** `exploratory_exceptions[id][key]` as a validated list of family ids. */
function exceptionFamilies(id: ExploratoryExceptionId | string, key: "investigator_families" | "notice_families"): readonly ParadigmFamily[] {
  const list = exploratoryException(id)[key];
  if (!Array.isArray(list)) throw new TaxonomyError("exploratory_exceptions", id, `${key} must be a list of paradigm families`);
  for (const f of list) if (!isParadigmFamily(f)) throw new TaxonomyError("paradigm.families", f, `exploratory_exceptions.${id}.${key} must name families`);
  return list as readonly ParadigmFamily[];
}

/**
 * `exploratory_exceptions[id].investigator_families` — the paradigm families
 * of the investigator a bridge was written for (§9 rows: the basic scientist
 * of the translational bridge, the clinical investigator of the biospecimen
 * bridge). A bridge fires only when the dominant paradigm's family is listed,
 * so no bridge reopens a forbidden family cell from the investigator's side.
 * Every entry must be a family id.
 */
export function exceptionInvestigatorFamilies(id: ExploratoryExceptionId | string): readonly ParadigmFamily[] {
  return exceptionFamilies(id, "investigator_families");
}

/**
 * `exploratory_exceptions[id].notice_families` — the paradigm families a
 * bridge was written for (§9 rows). A bridge fires only when every family the
 * notice requires is listed, so no bridge reopens a forbidden family cell.
 * Every entry must be a family id.
 */
export function exceptionNoticeFamilies(id: ExploratoryExceptionId | string): readonly ParadigmFamily[] {
  return exceptionFamilies(id, "notice_families");
}

/** `confidence_caps[id + "_max_tier"]` — the highest tier allowed under a cap (§7 stages 1, 7, 9). */
export function confidenceCap(id: ConfidenceCapId | string): Tier {
  const tier = lookup(taxonomy.confidence_caps as Record<string, string>, `${id}_max_tier`, "confidence_caps");
  if (!isTier(tier)) throw new TaxonomyError("tiers", tier, `confidence_caps.${id}_max_tier must name a tier`);
  return tier;
}

// ---------------------------------------------------------------------------
// Opportunity profile tables (§6)
// ---------------------------------------------------------------------------

/**
 * `opportunity_profile.exemplar_blend` — exemplar weight by informative
 * exemplar count, highest threshold first (§6 "Funded exemplars"), with
 * `list_min_share`, the exemplar share a category needs to enter a list axis
 * (unit.allowed, design.allowed, materials.expected); 0 = never (D21).
 */
export function exemplarBlend(): ReadonlyArray<{ min_exemplars: number; exemplar_weight: number; list_min_share: number }> {
  return taxonomy.opportunity_profile.exemplar_blend;
}

// ---------------------------------------------------------------------------
// Feedback (§12; PR 2.4 gold labels, PR 3.2 dismissals)
// ---------------------------------------------------------------------------

type FeedbackReasonRow = { label: string; strength: string; axis_required: boolean; gold: boolean; dismissal: boolean; model_use: string };

const FEEDBACK_REASONS = taxonomy.feedback.reasons as Record<string, FeedbackReasonRow>;

/** One `feedback.reasons` row with its id. `axis_required`: the label carries `axis_reason` (`<axis>` or `<axis>:<category>`); `gold` / `dismissal`: where the reason may be used. */
export type FeedbackReason = FeedbackReasonRow & { id: FeedbackReasonId };

export type FeedbackUse = "gold" | "dismissal";

/** A §12 "wrong type of research" quick pick; an `axis_reason` naming only an axis leaves the category to the labeler (D34). */
export type WrongResearchTypeSubreason = { id: string; label: string; axis_reason: string };

/** `feedback.reasons` keys, taxonomy order. */
export const FEEDBACK_REASON_IDS = Object.keys(taxonomy.feedback.reasons) as readonly FeedbackReasonId[];

export const isFeedbackReason = (id: string): id is FeedbackReasonId => hasOwn(taxonomy.feedback.reasons, id);

/** The feedback reasons in taxonomy order; `use` keeps only those allowed on a gold label or on a dismissal. */
export function feedbackReasons(use?: FeedbackUse): readonly FeedbackReason[] {
  return FEEDBACK_REASON_IDS.map((id) => ({ id, ...FEEDBACK_REASONS[id]! })).filter((r) => !use || r[use]);
}

/** One feedback reason; an unknown id throws. */
export function feedbackReason(id: FeedbackReasonId | string): FeedbackReason {
  return { id: id as FeedbackReasonId, ...lookup(FEEDBACK_REASONS, id, "feedback.reasons") };
}

/** `feedback.wrong_research_type_subreasons` — the §12 quick picks under "wrong type of research". */
export function wrongResearchTypeSubreasons(): readonly WrongResearchTypeSubreason[] {
  return taxonomy.feedback.wrong_research_type_subreasons;
}

/** `feedback.reason_required_tiers` — a gold label at these tiers needs a reason (spec §14 "where the tier is Exploratory or Poor"). */
export function reasonRequiredTiers(): readonly Tier[] {
  return taxonomy.feedback.reason_required_tiers as readonly Tier[];
}

/** An activity-code prior: paradigm weights added to `required` (r) or `allowed` (a), an objective, or a career flag (§6 deterministic fields). */
export type ActivityCodePrior = {
  r?: ParadigmWeights;
  a?: ParadigmWeights;
  objective?: ObjectiveId;
  career?: boolean;
};

const ACTIVITY_CODE_PRIORS = taxonomy.opportunity_profile.activity_code_priors as Record<string, ActivityCodePrior | { _comment: string }>;

/**
 * `opportunity_profile.activity_code_priors[code]`. The table is a list of
 * priors, not a registry of activity codes, so a code it does not mention
 * returns null ("no prior") rather than throwing; a listed code with an
 * empty object also carries no prior and returns `{}`.
 */
export function activityCodePrior(code: string): Readonly<ActivityCodePrior> | null {
  if (code.startsWith("_") || !hasOwn(ACTIVITY_CODE_PRIORS, code)) return null;
  return ACTIVITY_CODE_PRIORS[code] as ActivityCodePrior;
}

/** The activity codes the prior table mentions. */
export const ACTIVITY_CODES_WITH_PRIORS = Object.keys(ACTIVITY_CODE_PRIORS).filter((k) => !k.startsWith("_")) as readonly string[];

/** The overlay a clinical-trial designation adds to a notice profile (§6 deterministic fields; PR 1.5 `deterministicOverlays`). */
export type ClinicalTrialOverlay = {
  paradigm_required?: ParadigmWeights;
  paradigm_required_any?: ParadigmWeights;
  paradigm_excluded?: ParadigmWeights;
  unit_required?: UnitLevel[];
  unit_required_any?: UnitLevel[];
  design_required_any?: DesignId[];
  design_prohibited?: DesignId[];
  materials_required?: MaterialsKind[];
  materials_required_any?: MaterialsKind[];
};

/** `opportunity_profile.clinical_trial_designation[designation]`; `optional` is an empty overlay. `unknown` is not a designation here and throws. */
export function clinicalTrialOverlay(designation: ClinicalTrialDesignation | string): Readonly<ClinicalTrialOverlay> {
  return lookup(taxonomy.opportunity_profile.clinical_trial_designation as Record<string, ClinicalTrialOverlay>, designation, "opportunity_profile.clinical_trial_designation");
}
