/**
 * Fit-engine types (plan § PR 1.1). Spec: docs/MATCHING_REDESIGN.md — §4
 * axes, §5 investigator profile, §6 opportunity profile, §7–§10 pipeline,
 * components and tiers, §16 corrections.
 *
 * Id unions come from src/lib/fit/taxonomy.json and stay in sync two ways.
 * Where the JSON keys an id as an object property (families, categories,
 * unit levels, design groups, materials groups, tiers, reliabilities, roles,
 * caps, exceptions, designations) the union is `keyof typeof` the JSON and
 * cannot drift. Where the JSON lists ids in arrays (units, designs, materials
 * kinds, objectives) TypeScript infers `string[]`, so the union is an
 * `as const` tuple here and taxonomy.test.ts asserts it equals the JSON, in
 * order — editing either side without the other fails `npm test`.
 *
 * The JSON import is type-only (erased); the tuples are the only runtime
 * values in this module. Accessors live in src/lib/fit/taxonomy.ts.
 */
import type taxonomy from "@/lib/fit/taxonomy.json";
import type { SourceState } from "@/lib/investigators/sources";

type Taxonomy = typeof taxonomy;

// ---------------------------------------------------------------------------
// Axis A · research paradigm (§4 Axis A) — the gating axis
// ---------------------------------------------------------------------------

/** The seven paradigm families, `taxonomy.paradigm.families` (§4 Axis A; D5 stores these verbatim). */
export type ParadigmFamily = keyof Taxonomy["paradigm"]["families"];

/** The 23 paradigm categories, `taxonomy.paradigm.categories` (§4 Axis A). */
export type ParadigmCategory = keyof Taxonomy["paradigm"]["categories"];

/** Families in `paradigm.family_compat.order`; cross_cutting is not in the matrix — P for it comes from axes B–D (§4, §7 stage 2). */
export type MatrixFamily = Exclude<ParadigmFamily, "cross_cutting">;

// ---------------------------------------------------------------------------
// Axis B · unit of analysis (§4 Axis B)
// ---------------------------------------------------------------------------

/** The five unit levels L1–L5, `taxonomy.unit.levels` (§4 Axis B). */
export type UnitLevel = keyof Taxonomy["unit"]["levels"];

/** The units inside `taxonomy.unit.levels[*].units`, in level order (§4 Axis B). */
export const UNIT_IDS = [
  "molecule",
  "gene_genome",
  "protein",
  "pathway",
  "cell",
  "tissue_organoid",
  "whole_animal",
  "human_biospecimen",
  "individual_patient_participant",
  "clinical_cohort",
  "population",
  "community",
  "healthcare_organization",
  "health_system",
  "policy",
] as const;

/** One unit of analysis (§4 Axis B); profiles are scored at the level, items may carry the unit. */
export type UnitId = (typeof UNIT_IDS)[number];

// ---------------------------------------------------------------------------
// Axis C · study design (§4 Axis C)
// ---------------------------------------------------------------------------

/** The nine design groups, `taxonomy.design.groups` (§4 Axis C). */
export type DesignGroup = keyof Taxonomy["design"]["groups"];

/** The designs inside `taxonomy.design.groups[*]`, in group order (§4 Axis C). */
export const DESIGN_IDS = [
  "wet_lab_experiment",
  "perturbation",
  "biochemical_structural",
  "biospecimen_assay",
  "animal_in_vivo",
  "xenograft_pdx",
  "animal_behavioral",
  "bulk_omics",
  "single_cell",
  "spatial_imaging",
  "proteomics_metabolomics",
  "prospective_cohort",
  "retrospective_cohort",
  "case_control",
  "cross_sectional",
  "registry",
  "rct",
  "early_phase_trial",
  "pragmatic_trial",
  "pilot_feasibility_trial",
  "single_arm_interventional",
  "ehr_analysis",
  "claims_analysis",
  "linked_administrative",
  "surveillance_data",
  "survey",
  "qualitative",
  "mixed_methods",
  "community_engaged",
  "causal_inference",
  "statistical_epi_modeling",
  "population_simulation",
  "ml_model_development",
  "secondary_data_analysis",
  "gwas",
  "hybrid_effectiveness_implementation",
  "implementation_evaluation",
  "dissemination_study",
] as const;

/** One study design (§4 Axis C); notices require, allow or prohibit these. */
export type DesignId = (typeof DESIGN_IDS)[number];

// ---------------------------------------------------------------------------
// Axis D · materials and data (§4 Axes D and E)
// ---------------------------------------------------------------------------

/** The five materials groups, `taxonomy.materials.kinds` (§4 Axis D). */
export type MaterialsGroup = keyof Taxonomy["materials"]["kinds"];

/** The kinds inside `taxonomy.materials.kinds[*]`, in group order (§4 Axis D; D5 self-declared checklist). */
export const MATERIALS_KIND_IDS = [
  "cell_lines",
  "primary_cells_nonhuman",
  "organoids_ipsc",
  "animal_mouse",
  "animal_rat",
  "animal_zebrafish",
  "animal_nhp",
  "animal_other",
  "human_tissue_biopsy",
  "human_blood_fluids",
  "human_primary_cells",
  "biobank_specimens",
  "enrolled_participants",
  "patients_under_care",
  "ehr",
  "claims_administrative",
  "registries_surveillance",
  "surveys",
  "cohort_biobank_datasets",
  "genomic_datasets",
  "imaging_datasets",
  "digital_wearable",
  "published_literature",
  "simulated_data",
] as const;

/** One materials / data kind (§4 Axis D). */
export type MaterialsKind = (typeof MATERIALS_KIND_IDS)[number];

// ---------------------------------------------------------------------------
// Axis E · scientific objective (§4 Axes D and E) — scored, never gates
// ---------------------------------------------------------------------------

/** `taxonomy.objective.categories`, in order (§4 Axis E). */
export const OBJECTIVE_IDS = [
  "mechanism_discovery",
  "target_identification_validation",
  "biomarker_discovery_validation",
  "therapeutic_development",
  "treatment_evaluation_efficacy",
  "diagnostic_prognostic_prediction",
  "etiology_risk_factors",
  "prevention",
  "outcomes_quality",
  "healthcare_delivery_access",
  "implementation_dissemination",
  "methods_tool_development",
  "resource_infrastructure",
  "training_capacity",
] as const;

/** One scientific objective (§4 Axis E). */
export type ObjectiveId = (typeof OBJECTIVE_IDS)[number];

// ---------------------------------------------------------------------------
// Axis vectors
// ---------------------------------------------------------------------------

/** The five structured axes (§4); topic is separate and never gates. */
export type Axis = "paradigm" | "unit" | "design" | "materials" | "objective";

/** A weighted multi-label vector on one axis: id → weight in [0, 1]; an absent id is 0 (§4). */
export type AxisWeights<Id extends string> = Partial<Record<Id, number>>;

/** Paradigm weights by category (§4 Axis A). */
export type ParadigmWeights = AxisWeights<ParadigmCategory>;
/** Unit weights by level — profiles and notices work at the level, not the unit (§4 Axis B). */
export type UnitLevelWeights = AxisWeights<UnitLevel>;
/** Design weights (§4 Axis C). */
export type DesignWeights = AxisWeights<DesignId>;
/** Materials weights (§4 Axis D). */
export type MaterialsWeights = AxisWeights<MaterialsKind>;
/** Objective weights (§4 Axis E). */
export type ObjectiveWeights = AxisWeights<ObjectiveId>;

/** Confidence of a classification or profile axis (§5 aggregation; §6 notice confidence; §10 confidence floor). */
export type Confidence = "low" | "medium" | "high";

// ---------------------------------------------------------------------------
// Evidence items (§5)
// ---------------------------------------------------------------------------

/** Where an item came from — the keys of `taxonomy.aggregation.reliability` (§5 Sources table). */
export type EvidenceSource = keyof Taxonomy["aggregation"]["reliability"];

/** The investigator's role on an item — the keys of `taxonomy.aggregation.role` (§5 aggregation). */
export type EvidenceRole = keyof Taxonomy["aggregation"]["role"];

/** What kind of record an item is (item-classifier prompt spec; PR 1.4 `collectItems` adds `directory`). */
export type ItemKind =
  | "publication"
  | "grant"
  | "trial"
  | "biosketch_statement"
  | "biosketch_contribution"
  | "profiles_narrative"
  | "self_declared"
  | "directory";

/** Coded topic of one item: MeSH descriptor UIs (D12: match by UI), RCDC categories, and the model's specific terms (§4 topic; §11). */
export type ItemTopic = {
  /** Every MeSH descriptor UI on the item. */
  mesh: string[];
  /** The UIs flagged major topic. */
  mesh_major: string[];
  /** RCDC category names as RePORTER spells them (D9). */
  rcdc: string[];
  /** 3–8 specific terms from the classifier; no generic words. */
  terms: string[];
};

/** Which classifier decided an axis: rules override the model where they fired (§5 item classification). */
export type AxisDecider = "rules" | "llm";

/**
 * The axis vector for one publication / grant / trial / statement, plus the
 * identity and weighting fields aggregation needs (§5 item classification and
 * aggregation). Cached by content hash; re-run when `taxonomy_version` changes.
 */
export type ItemProfile = {
  /** Stable evidence id a rationale can cite: PMID, project number, NCT id, `biosketch:statement`, … (§16 guardrail 2). */
  id: string;
  kind: ItemKind;
  source: EvidenceSource;
  /** Publication / award / registration year; null when unknown (recency weight uses `taxonomy.aggregation.recency`). */
  year: number | null;
  /** Author or PI role; null when the source carries none (weights in `taxonomy.aggregation.role`). */
  role: EvidenceRole | null;
  taxonomy_version: string;
  paradigm: ParadigmWeights;
  unit: UnitLevelWeights;
  design: DesignWeights;
  materials: MaterialsWeights;
  objective: ObjectiveWeights;
  topic: ItemTopic;
  confidence: Confidence;
  /** Per axis, who decided it; an absent axis means no rule fired and the model was silent. */
  decided_by: Partial<Record<Axis, AxisDecider>>;
  /** Ids of the `signal-mapping.json` rules that fired. */
  rules_fired: string[];
  /** One clause per non-empty axis from the model; empty when rules alone decided. */
  justification: Partial<Record<Axis, string>>;
};

// ---------------------------------------------------------------------------
// Investigator fit profile (§5 profile record)
// ---------------------------------------------------------------------------

/** Confidence per axis and for topic, from evidence mass and distinct sources (§5 aggregation; `taxonomy.aggregation.confidence`). */
export type AxisConfidence = Record<Axis | "topic", Confidence>;

/** Coded topic of a profile: MeSH tree numbers (depth-weighted, §11), RCDC categories, and a free-text summary (§5 profile record). */
export type ProfileTopic = {
  /** Major-topic MeSH tree numbers across the evidence, resolved from UIs via the descriptor index. */
  mesh_major: string[];
  rcdc: string[];
  free_text: string | null;
};

/** Investigator characteristics used by eligibility, track record and rationales (§5 "Investigator characteristics"). */
export type InvestigatorCharacteristics = {
  /** Career stage label; vocabulary set by PR 1.4 from rank, title series and first R01-equivalent. */
  career_stage: string | null;
  /** Early-stage-investigator estimate; null when not inferable (stage 1 ESI-only rule). */
  esi: boolean | null;
  /** ISO date until which ESI status is estimated to hold, when inferable. */
  esi_eligible_until: string | null;
  /** Activity codes ever held as PI (stage 7 readiness ladder). */
  mechanisms_held: string[];
  /** Active awards as PI (stage 7 load heuristic). */
  active_awards: number;
  /** "Sees patients" vs "studies patients"; vocabulary set by PR 1.4 from title series, degrees and trials. */
  clinical_role: string | null;
  /** Registered trials with a PI-class role (§5 CT.gov row). */
  trial_pi_count: number;
  degrees: string[];
  title_series: string | null;
};

/** A co-author or community peer with a known paradigm, for "would need a collaborator" rationales (§5 collaborative reach; `exploratory_exceptions.translational_bridge`). */
export type Collaborator = {
  /** Investigator id. */
  id: string;
  name: string | null;
  dominant_family: ParadigmFamily;
  categories: ParadigmCategory[];
};

/** Counts behind the profile, for the inspector and thin-evidence caps (§5 profile record `evidence_summary`). */
export type EvidenceSummary = {
  publications_verified: number;
  grants: number;
  trials: number;
  trials_as_pi: number;
  biosketch: SourceState;
  self_declared: boolean;
};

/** Top evidence ids per non-zero category, one entry per (axis, category) (§5 profile record `provenance`). */
export type AxisProvenance =
  | { axis: "paradigm"; category: ParadigmCategory; top_items: string[] }
  | { axis: "unit"; category: UnitLevel; top_items: string[] }
  | { axis: "design"; category: DesignId; top_items: string[] }
  | { axis: "materials"; category: MaterialsKind; top_items: string[] }
  | { axis: "objective"; category: ObjectiveId; top_items: string[] };

/**
 * The aggregated investigator record: a weighted mixture of demonstrated work
 * with a separate recent view, characteristics, aspirations and provenance
 * (§5 profile record). Stored in `investigator_fit_profiles` (PR 1.4).
 */
export type InvestigatorFitProfile = {
  investigator_id: string;
  taxonomy_version: string;
  /** ISO timestamp. */
  computed_at: string;
  confidence: AxisConfidence;
  /** Career view over all items; recent view over items within `aggregation.recency.recent_view_years` (§5 two views). */
  paradigm: { career: ParadigmWeights; recent: ParadigmWeights };
  unit: UnitLevelWeights;
  design: DesignWeights;
  materials: MaterialsWeights;
  objective: ObjectiveWeights;
  topic: ProfileTopic;
  characteristics: InvestigatorCharacteristics;
  /** Self-declared directions, classified to categories by PR 1.4 (D5); open Exploratory, never Strong (§5 aspirations). */
  aspirations: ParadigmCategory[];
  /** Paradigm families the investigator asked never to be suggested (D5; §9 exclude). */
  do_not_suggest: ParadigmFamily[];
  evidence_summary: EvidenceSummary;
  provenance: AxisProvenance[];
  collaborators: Collaborator[];
};

// ---------------------------------------------------------------------------
// Opportunity fit profile (§6 opportunity record)
// ---------------------------------------------------------------------------

/** Clinical-trial designation with an overlay in `taxonomy.opportunity_profile.clinical_trial_designation` (§6 deterministic fields). */
export type ClinicalTrialDesignation = keyof Taxonomy["opportunity_profile"]["clinical_trial_designation"];

/** Deterministic notice fields (§6 "Deterministic notice fields"; PR 0.5 columns). */
export type OpportunityMechanism = {
  activity_code: string | null;
  /** `unknown` when the title and Section II say nothing (PR 0.5 CHECK). */
  clinical_trial: ClinicalTrialDesignation | "unknown";
  /** Basic Experimental Studies with Humans. */
  besh: boolean;
  ceiling_direct_per_year: number | null;
  period_years: number | null;
  issuing_ic: string | null;
  program_division: string | null;
};

/** What the notice requires, allows and excludes on the paradigm axis (§6 record; §7 stage 2). */
export type OpportunityParadigm = {
  required: ParadigmWeights;
  allowed: ParadigmWeights;
  excluded: ParadigmWeights;
  /**
   * Any-of set (D14): the notice is satisfied by any one of these categories — stage-2 support
   * is the max over the set (BESH: early_phase_human_experimental | human_biospecimen | …).
   * PR 2.1 defines how it combines with `required`; PR 1.5's clinical-trial overlay writes it.
   */
  required_any: ParadigmWeights;
};

/** Unit levels the notice requires (all of `required`, any of `required_any`) and allows (§6 record; §7 stage 3). */
export type OpportunityUnit = {
  required: UnitLevel[];
  required_any: UnitLevel[];
  allowed: UnitLevel[];
};

/** Design requirements: each `required_any*` set is any-of within, all-of across; prohibited designs penalize when dominant (§4 Axis C; §7 stage 4). */
export type OpportunityDesign = {
  required_any: DesignId[];
  /** A second required group, when the notice has one (notice-extractor prompt). */
  required_any_2: DesignId[];
  allowed: DesignId[];
  prohibited: DesignId[];
};

/** Materials the notice expects or requires (§6 record; `clinical_trial_designation` overlays). */
export type OpportunityMaterials = {
  expected: MaterialsKind[];
  required: MaterialsKind[];
  required_any: MaterialsKind[];
  human_required: boolean | null;
};

/** Coded and distinguishing topic of the notice (§6 record; §11 specificity). */
export type OpportunityTopic = {
  /** MeSH tree numbers. */
  mesh: string[];
  rcdc: string[];
  /** Terms that would separate a responsive from a non-responsive application. */
  terms: string[];
  free_text: string | null;
};

/** Investigator-level eligibility rules from Section III.3 (§7 stage 1; notice-extractor group 3). */
export type OpportunityEligibility = {
  /** Verbatim rules Prospera cannot evaluate structurally; each becomes an "unknown" flag. */
  investigator_rules: string[];
  esi_only: boolean;
  new_investigator_only: boolean;
  clinician_required: boolean;
  degree_required: string | null;
  independent_appointment_required: boolean;
  citizenship_rule: string | null;
};

/** Team expectations (§6 record; notice-extractor group 3). */
export type OpportunityTeam = {
  multi_pi_allowed: boolean | null;
  consortium_required: boolean | null;
  required_partners: string[];
};

/** A verbatim quote and the Guide section it came from, keyed by field path such as `paradigm.required` (§6 record `provenance`). */
export type NoticeQuote = { section: string; quote: string };

/** How much text and how many funded exemplars the profile rests on (§6 extraction sources; blend in `taxonomy.opportunity_profile.exemplar_blend`). */
export type OpportunitySources = {
  /** Full sectioned Guide text, a synopsis only, or nothing (notice-extractor validation: synopsis caps confidence at medium). */
  text: "full_text" | "synopsis" | "none";
  exemplar_count: number;
};

/**
 * The structured notice record: what the program wants, allows and excludes,
 * with a quote behind every non-empty field (§6 opportunity record). Stored
 * in `opportunity_fit_profiles` (PR 1.5).
 */
export type OpportunityFitProfile = {
  opportunity_id: string;
  /** Opportunity number, e.g. `RFA-DK-27-012`. */
  number: string;
  taxonomy_version: string;
  /** ISO timestamp. */
  computed_at: string;
  confidence: Confidence;
  mechanism: OpportunityMechanism;
  paradigm: OpportunityParadigm;
  unit: OpportunityUnit;
  design: OpportunityDesign;
  materials: OpportunityMaterials;
  /** Required study population in the notice's words, if any. */
  population: string | null;
  objective: ObjectiveWeights;
  topic: OpportunityTopic;
  eligibility: OpportunityEligibility;
  team: OpportunityTeam;
  /** Verbatim non-responsive items. */
  non_responsive: string[];
  provenance: Record<string, NoticeQuote>;
  sources: OpportunitySources;
  /** A category was both required and excluded across section groups; excluded won (notice-extractor validation). */
  needs_review: boolean;
};

// ---------------------------------------------------------------------------
// Components, tiers, caps (§8, §9, §10)
// ---------------------------------------------------------------------------

/** The nine component scores: E P U D multiplicative, T M O K A additive (§8). */
export type Component = "E" | "P" | "U" | "D" | "T" | "M" | "O" | "K" | "A";

/** One value in [0, 1] per component; E is 0 or 1 (§8). */
export type Components = Record<Component, number>;

/** Tier ids, `taxonomy.tiers` (§10). Poor is hidden but explainable. */
export type Tier = Exclude<keyof Taxonomy["tiers"], "_comment">;

/** The tiers that carry floors (§10 table). */
export type FloorTier = Exclude<Tier, "poor">;

/** Components with a numeric floor in at least one tier (§10 table). */
export type FloorComponent = "P" | "U" | "D" | "T" | "M" | "K";

/** Every numeric floor key in `taxonomy.tiers[*]` (§10 table). */
export type NumericFloorKey = FloorComponent | "D_required_group_min" | "T_specific_depth" | "P_with_aspiration";

/** Eligibility floor: Strong needs a pass with no unknown flags (§10 table, E row). */
export type EligibilityFloor = "pass" | "pass_no_unknowns";

/** The floors one tier requires, as stored in `taxonomy.tiers` (§10). Absent keys mean "any". */
export type TierFloors = {
  E: EligibilityFloor;
  P: number;
  U: number;
  T: number;
  D?: number;
  /** Every required design group must be supported at least this much. */
  D_required_group_min?: number;
  M?: number;
  K?: number;
  /** At least one coded topic match at this tree depth (§11). */
  T_specific_depth?: number;
  /** The P floor when an aspiration names the required paradigm (§5 aspirations). */
  P_with_aspiration?: number;
  A?: "runway_ok_not_in_pipeline";
  /** Both profiles must be at least this confident. */
  confidence_min?: Confidence;
  stage8?: "confirm";
  /** Strong floors that may be missed and still land here. */
  gaps_allowed?: number;
  /** Floors that may never be the allowed gap. */
  gap_not_in?: Array<"P" | "U" | "D_required">;
};

/** Ids of `taxonomy.exploratory_exceptions` — ways a paradigm-gated Poor may surface as Exploratory (§9). */
export type ExploratoryExceptionId = Exclude<keyof Taxonomy["exploratory_exceptions"], "_comment">;

type StripMaxTier<K> = K extends `${infer Id}_max_tier` ? Id : never;

/** Ids of `taxonomy.confidence_caps` without the `_max_tier` suffix (§7 stages 1, 7 and 9). */
export type ConfidenceCapId = StripMaxTier<keyof Taxonomy["confidence_caps"]>;

/** Caps from the gates (§7 stages 2–4; §9), including the paradigm gate relaxed to Exploratory by an aspiration that names the required paradigm (§10 Exploratory row). */
export type GateCapId = "paradigm_gate" | "paradigm_gate_relaxed_aspiration" | "unit_gate" | "design_required_unsupported";

/** Every reason a tier was capped, as recorded in `FitResult.caps` (§9; fixture `expect.caps`). */
export type CapId = GateCapId | ConfidenceCapId | `paradigm_gate_relaxed_${ExploratoryExceptionId}`;

// ---------------------------------------------------------------------------
// Fit result (§7 stage outputs; §8; §10; PR 2.1 `scorePair`)
// ---------------------------------------------------------------------------

/** Pair-level actionability inputs (§7 stage 7; `taxonomy.compose.actionability`). */
export type ActionabilityInputs = {
  runway_weeks: number | null;
  in_pipeline: boolean;
  recently_dismissed: boolean;
};

/**
 * One evidence item as stage 5 sees it: the paradigm and design vectors that
 * decide whether it is compatible with the notice, and the text signals the
 * caller precomputed — a per-item cosine against the notice's topic text and
 * term counts for BM25 (§7 stage 5; §11 rule 4). The engine never embeds or
 * tokenizes; PR 2.2 loads these from `fit_item_profiles` and the embeddings.
 */
export type TopicItemInput = {
  /** The item id a rationale can cite (`ItemProfile.id`). */
  id: string;
  paradigm: ParadigmWeights;
  design: DesignWeights;
  /** Cosine between the notice's topic text and this item's embedding; null when either side has no embedding. */
  cosine: number | null;
  /** Term → count over the item's text (tokenized with `tokenize` in engine/topic.ts); null when the item has no text. */
  tf: Record<string, number> | null;
  /** Token count of the item's text; 0 when `tf` is null. */
  length: number;
};

/** Inverse document frequency over the open-notice corpus for MeSH tree numbers (every prefix) and RCDC categories (§11 rule 2; PR 2.2 refreshes it nightly). */
export type IdfTable = {
  weights: Record<string, number>;
  /** The weight of a code the table does not know (a code in no notice). */
  unknown: number;
};

/** BM25 corpus statistics and parameters, precomputed by the caller over the item collection it ranks against (§7 stage 5). */
export type Bm25Stats = {
  k1: number;
  b: number;
  avg_doc_length: number;
  doc_count: number;
  /** Term → number of documents containing it. */
  doc_freq: Record<string, number>;
};

/** Precomputed topic inputs for one pair (§7 stage 5). */
export type TopicContext = {
  idf: IdfTable;
  items: TopicItemInput[];
  /** Null when no BM25 statistics exist; the BM25 term is then 0. */
  bm25: Bm25Stats | null;
  /** Use this T instead of computing it (the adversarial fixture's `topic_score_override`); coded matches are still computed from the profiles' codes. */
  override: number | null;
};

/** Infrastructure the notice names, what the investigator has, and what UCSF has institutionally (§7 stage 6). Names are free text compared case-insensitively. */
export type InfrastructureContext = {
  named: string[];
  investigator: string[];
  institutional: string[];
};

/** Pair-level track-record inputs the profiles do not carry (§7 stage 7). */
export type TrackContext = {
  /** Prior UCSF awardees under the notice's activity code; null when unknown. */
  prior_ucsf_awardees_same_code: number | null;
};

/**
 * Everything `scorePair` needs beyond the two profiles. Plain data: the
 * engine reads no clock and does no I/O, so the same context and profiles
 * give a byte-identical `FitResult` (PR 2.1).
 */
export type ScoreContext = {
  /** ISO timestamp stamped on the result as `computed_at`. */
  now: string;
  actionability: ActionabilityInputs;
  topic: TopicContext;
  infrastructure: InfrastructureContext | null;
  track: TrackContext | null;
  /** `investigator_fit_profiles.pending_items` — > 0 marks a partial profile, capped like a low-confidence one (D20). */
  investigator_pending_items: number;
  /** `opportunity_fit_profiles.sources.complete` — false marks a partial notice profile, capped like a low-confidence one (D22). A row without the field counts as complete. */
  notice_complete: boolean;
};

/** A coded topic match with its tree depth (§11 rule 1). */
export type CodedTopicMatch = { code: string; depth: number };

/** A missed floor: the component's value against the tier's floor (§10). */
export type UnmetFloor = { key: NumericFloorKey; value: number; floor: number };

/** What each stage leaves behind for the rationale (§7 "every stage leaves a component score behind for the explanation"). */
export type FitProvenance = {
  /** Stage 1: rules that failed (E = 0) and rules that could not be evaluated (flags). */
  E: { failed: string[]; unknown: string[] };
  /** Stage 2: which view was scored, the best-supporting pair, the excluded-paradigm hit, and any exploratory exception applied. */
  P: {
    view: "recent" | "career";
    best_pair: { investigator: ParadigmCategory; notice: ParadigmCategory } | null;
    excluded_hit: ParadigmCategory | null;
    exception: ExploratoryExceptionId | null;
  };
  /** Stage 3: best-supporting level pair. */
  U: { best_pair: { investigator: UnitLevel; notice: UnitLevel } | null };
  /** Stage 4: required groups left unsupported, and the prohibited design that dominates, if any. */
  D: { unmet_required: DesignId[][]; dominant_prohibited: DesignId | null };
  /** Stage 5: the compatible items that carried the topic score and the coded matches. */
  T: { top_items: string[]; coded_matches: CodedTopicMatch[] };
  /** Stage 6: required methods and capabilities met and missing. */
  M: { met: string[]; missing: string[] };
  /** Stage 7: mechanisms held against the notice's activity code. */
  K: { mechanisms_held: string[]; activity_code: string | null };
  A: ActionabilityInputs;
  /** Stage 9: the tier the floors alone gave, and which floors of the next tier up were missed. */
  floors: { tier_by_floors: Tier; unmet: UnmetFloor[] };
  /** Collaborator ids named to fill a gap (§10 Exploratory). */
  collaborators: string[];
};

/**
 * The output of the pure engine for one investigator–notice pair: components,
 * caps, ordering score, tier and provenance (§7 stage 9; §8; §10; PR 2.1
 * `scorePair`). Stored in `fit_results` (PR 2.2); stage 8 adds adjudication.
 */
export type FitResult = {
  investigator_id: string;
  opportunity_id: string;
  engine_version: string;
  taxonomy_version: string;
  /** ISO timestamp. */
  computed_at: string;
  components: Components;
  caps: CapId[];
  /** S = 100 · E · P · D^d · U^u · R — orders, never labels (§8). */
  score: number;
  tier: Tier;
  provenance: FitProvenance;
  /** Human-readable flags for the rationale ("ESI status not on file", "notice prohibits the dominant design"). */
  flags: string[];
  /** The gap sentence shown first on an Exploratory item, naming the fix where possible (§10). */
  gap: string | null;
  /** The one-line "Why not?" explanation for Poor (§10). */
  why_not: string | null;
  /** Rationale from component provenance; stage 8 may replace it (§7 stage 9; §16). */
  rationale: string | null;
};

// ---------------------------------------------------------------------------
// Corrections (§16 — the model never emits a score; it proposes corrections)
// ---------------------------------------------------------------------------

/** Which profile a correction edits (§16 reconciliation; reconciler prompt spec). */
export type CorrectionTarget = "investigator" | "notice";

/** What kind of input was wrong (reconciler prompt spec; post-rules 2–4 route each kind differently). */
export type CorrectionKind = "ingest_miss" | "misread_requirement" | "profile_weight" | "characteristic";

/** Who proposed a correction (PR 3.1 `fit_corrections.proposed_by`; PR 3.2 one-click confirmation). */
export type CorrectionAuthor = "llm" | "investigator" | "strategist";

/** Lifecycle of a stored correction (PR 3.1 `fit_corrections.status`). */
export type CorrectionStatus = "proposed" | "applied" | "rejected";

/**
 * A specific, checkable correction to one input field, with the evidence
 * that supports it (§16 "Informed reconciliation"; reconciler prompt spec).
 * Ids must exist in the provided evidence and quotes must verify, else the
 * correction is dropped.
 */
export type Correction = {
  target: CorrectionTarget;
  /** Dotted field path within the target profile, e.g. `design.rct`, `paradigm.required.human_biospecimen`, `characteristics.trial_pi_count`. */
  path: string;
  from: unknown;
  to: unknown;
  evidence_ids: string[];
  /** Verbatim notice quote, for notice corrections. */
  quote: string | null;
  section: string | null;
  kind: CorrectionKind;
  confidence: "high" | "medium";
};
