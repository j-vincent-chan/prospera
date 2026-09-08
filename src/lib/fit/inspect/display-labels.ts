/**
 * The display-label map every fit surface passes an enum through (plan §
 * PR 3.2b). Pure, no I/O.
 *
 * `taxonomy.json` labels paradigm families, paradigm categories and unit
 * levels; **designs, materials kinds, objectives and units carry ids only**,
 * so `humanize()` alone turns `rct` into "Rct" and
 * `hybrid_effectiveness_implementation` into a sentence nobody reads. The
 * labels below are the reading of each id in the words a strategist uses;
 * they are display text and live here, not in the taxonomy, because the
 * engine never needs them.
 *
 * Every map is keyed by its union type, so adding an id to
 * `src/lib/fit/types.ts` (which `taxonomy.test.ts` pins to the JSON) fails
 * the build here until the id has a label. That is the guarantee behind "no
 * snake_case in human-facing text".
 *
 * `humanizeIds()` is the same map applied to free text: the engine's stored
 * `gap`, `why_not` and flag strings name ids inline
 * ("rct | early_phase_trial required, none in the evidence"), and every
 * surface that shows one of those sentences runs it through this first.
 */
import {
  DESIGN_IDS,
  MATERIALS_KIND_IDS,
  OBJECTIVE_IDS,
  UNIT_IDS,
  type CapId,
  type Component,
  type Confidence,
  type DesignGroup,
  type DesignId,
  type ExploratoryExceptionId,
  type MaterialsGroup,
  type MaterialsKind,
  type ObjectiveId,
  type Tier,
  type UnitId,
  type UnitLevel,
} from "@/lib/fit/types";
import { categoryLabel, familyLabel, isParadigmCategory, isParadigmFamily, levelLabel, PARADIGM_CATEGORY_IDS, PARADIGM_FAMILY_IDS, UNIT_LEVEL_IDS } from "@/lib/fit/taxonomy";

/** Axis C · the 38 study designs (§4 Axis C). */
export const DESIGN_LABEL: Record<DesignId, string> = {
  wet_lab_experiment: "Wet-lab experiment",
  perturbation: "Perturbation screen",
  biochemical_structural: "Biochemical or structural study",
  biospecimen_assay: "Biospecimen assay",
  animal_in_vivo: "Animal in vivo study",
  xenograft_pdx: "Xenograft or PDX model",
  animal_behavioral: "Animal behavioral study",
  bulk_omics: "Bulk omics",
  single_cell: "Single-cell profiling",
  spatial_imaging: "Spatial imaging",
  proteomics_metabolomics: "Proteomics or metabolomics",
  prospective_cohort: "Prospective cohort",
  retrospective_cohort: "Retrospective cohort",
  case_control: "Case–control study",
  cross_sectional: "Cross-sectional study",
  registry: "Registry study",
  rct: "Randomized controlled trial",
  early_phase_trial: "Early-phase trial",
  pragmatic_trial: "Pragmatic trial",
  pilot_feasibility_trial: "Pilot or feasibility trial",
  single_arm_interventional: "Single-arm interventional study",
  ehr_analysis: "EHR analysis",
  claims_analysis: "Claims analysis",
  linked_administrative: "Linked administrative data",
  surveillance_data: "Surveillance data",
  survey: "Survey",
  qualitative: "Qualitative study",
  mixed_methods: "Mixed methods",
  community_engaged: "Community-engaged research",
  causal_inference: "Causal inference",
  statistical_epi_modeling: "Statistical or epidemiologic modeling",
  population_simulation: "Population simulation",
  ml_model_development: "Machine-learning model development",
  secondary_data_analysis: "Secondary data analysis",
  gwas: "Genome-wide association study",
  hybrid_effectiveness_implementation: "Hybrid effectiveness–implementation trial",
  implementation_evaluation: "Implementation evaluation",
  dissemination_study: "Dissemination study",
};

/** Axis C · the nine design groups. */
export const DESIGN_GROUP_LABEL: Record<DesignGroup, string> = {
  laboratory_experimental: "Laboratory experimental",
  in_vivo: "In vivo",
  profiling_omics: "Profiling and omics",
  human_observational: "Human observational",
  interventional: "Interventional",
  real_world_data: "Real-world data",
  social_behavioral: "Social and behavioral",
  analytical_computational: "Analytical and computational",
  implementation: "Implementation",
};

/** Axis D · the 24 materials and data kinds. */
export const MATERIALS_LABEL: Record<MaterialsKind, string> = {
  cell_lines: "Cell lines",
  primary_cells_nonhuman: "Primary cells (non-human)",
  organoids_ipsc: "Organoids and iPSC",
  animal_mouse: "Mouse",
  animal_rat: "Rat",
  animal_zebrafish: "Zebrafish",
  animal_nhp: "Non-human primate",
  animal_other: "Other animal model",
  human_tissue_biopsy: "Human tissue and biopsy",
  human_blood_fluids: "Human blood and body fluids",
  human_primary_cells: "Human primary cells",
  biobank_specimens: "Biobank specimens",
  enrolled_participants: "Enrolled participants",
  patients_under_care: "Patients under care",
  ehr: "Electronic health records",
  claims_administrative: "Claims and administrative data",
  registries_surveillance: "Registries and surveillance data",
  surveys: "Survey data",
  cohort_biobank_datasets: "Cohort and biobank datasets",
  genomic_datasets: "Genomic datasets",
  imaging_datasets: "Imaging datasets",
  digital_wearable: "Digital and wearable data",
  published_literature: "Published literature",
  simulated_data: "Simulated data",
};

/** Axis D · the five materials groups. */
export const MATERIALS_GROUP_LABEL: Record<MaterialsGroup, string> = {
  non_human: "Non-human materials",
  human_biological: "Human biological materials",
  human_participants: "Human participants",
  human_data: "Human data",
  other: "Other materials",
};

/** Axis E · the 14 scientific objectives. */
export const OBJECTIVE_LABEL: Record<ObjectiveId, string> = {
  mechanism_discovery: "Mechanism discovery",
  target_identification_validation: "Target identification and validation",
  biomarker_discovery_validation: "Biomarker discovery and validation",
  therapeutic_development: "Therapeutic development",
  treatment_evaluation_efficacy: "Treatment evaluation and efficacy",
  diagnostic_prognostic_prediction: "Diagnosis, prognosis and prediction",
  etiology_risk_factors: "Etiology and risk factors",
  prevention: "Prevention",
  outcomes_quality: "Outcomes and quality",
  healthcare_delivery_access: "Health-care delivery and access",
  implementation_dissemination: "Implementation and dissemination",
  methods_tool_development: "Methods and tool development",
  resource_infrastructure: "Resources and infrastructure",
  training_capacity: "Training and capacity",
};

/** Axis B · the 15 units of analysis (the levels carry their own taxonomy labels). */
export const UNIT_LABEL: Record<UnitId, string> = {
  molecule: "Molecule",
  gene_genome: "Gene or genome",
  protein: "Protein",
  pathway: "Pathway",
  cell: "Cell",
  tissue_organoid: "Tissue or organoid",
  whole_animal: "Whole animal",
  human_biospecimen: "Human biospecimen",
  individual_patient_participant: "Individual patient or participant",
  clinical_cohort: "Clinical cohort",
  population: "Population",
  community: "Community",
  healthcare_organization: "Health-care organization",
  health_system: "Health system",
  policy: "Policy",
};

/** The nine component scores as a person reads them (§8). */
export const COMPONENT_LABEL: Record<Component, string> = {
  E: "Eligibility",
  P: "Paradigm",
  U: "Unit of analysis",
  D: "Study design",
  T: "Topic",
  M: "Methods",
  O: "Objective",
  K: "Track record",
  A: "Actionability",
};

/** What each component is, in one clause — the tooltip beside its bar. */
export const COMPONENT_HELP: Record<Component, string> = {
  E: "The notice's hard eligibility rules; a fail means no row at all.",
  P: "How the work asks its questions, against what the notice requires — the gating axis.",
  U: "The level of organization studied, against the notice's.",
  D: "Study designs in the evidence, against the designs the notice requires.",
  T: "Coded topic overlap — MeSH and RCDC by depth — plus the text similarity of the items.",
  M: "Required methods and capabilities the evidence shows.",
  O: "Scientific objective alignment; scored, never a gate.",
  K: "NIH mechanisms held against this notice's activity code.",
  A: "Runway to the deadline, whether the pair is already in the pipeline, and current load.",
};

/** Why a tier was held down (`FitResult.caps`, §9) — the reason, not the id. */
export const CAP_LABEL: Record<CapId, string> = {
  paradigm_gate: "Paradigm gate — the kind of research the notice wants is not what the evidence shows",
  paradigm_gate_relaxed_aspiration: "Paradigm gate relaxed by a stated aspiration — opened to Exploratory, never Strong",
  paradigm_gate_relaxed_translational_bridge: "Paradigm gate relaxed by the translational bridge — opened to Exploratory",
  paradigm_gate_relaxed_biospecimen_bridge: "Paradigm gate relaxed by the biospecimen bridge — opened to Exploratory",
  unit_gate: "Unit gate — the notice works at a level this profile does not",
  design_required_unsupported: "A required study design has no support in the evidence",
  low_profile_confidence: "The investigator profile is not confident enough for a higher tier",
  low_notice_confidence: "The notice profile is not confident enough for a higher tier",
  eligibility_unknown: "An eligibility rule could not be checked",
  readiness_far: "The mechanism is far above the track record on file",
  runway_short: "Too little runway to the deadline",
  stage8_verdict: "Lowered to the blind reader's verdict in review",
  stage8_objection: "Lowered by a grounded objection in review",
  stage8_pending_confirmation: "Raised in review, held one tier until a strategist confirms the correction",
};

/** The tier a stored row carries (`fit_results.tier`, §10) — including Poor, which the pills never show. */
export const FIT_TIER_WORD: Record<Tier, string> = { strong: "Strong", moderate: "Moderate", exploratory: "Exploratory", poor: "Poor" };

export const CONFIDENCE_WORD: Record<Confidence, string> = { low: "low", medium: "medium", high: "high" };

/** The ways a paradigm-gated pair may still surface as Exploratory (§9). */
export const EXCEPTION_LABEL: Record<ExploratoryExceptionId, string> = {
  translational_bridge: "translational bridge",
  biospecimen_bridge: "biospecimen bridge",
};

/**
 * Vocabulary the engine writes into eligibility and characteristic strings
 * that belongs to no axis (`clinical_role`, `career_stage`). Stage 1 quotes
 * these ids verbatim — "clinical role on file: phd_investigator" — so the
 * text pass needs them too.
 */
const CHARACTERISTIC_LABEL: Record<string, string> = {
  phd_investigator: "PhD investigator",
  md_clinician: "MD clinician",
  md_phd: "MD–PhD",
  sees_patients: "sees patients",
  studies_patients: "studies patients",
  trainee: "trainee",
  early_career: "early career",
  mid_career: "mid career",
  senior: "senior",
};

/** `L3` → "L3 · human individual". */
export const unitLevelLabel = (level: UnitLevel | string): string => (UNIT_LEVEL_IDS as readonly string[]).includes(level) ? `${level} · ${levelLabel(level)}` : level;

/** Words the engine writes as ids that belong to no axis at all. */
const ENGINE_TERM_LABEL: Record<string, string> = { needs_review: "needs review", not_evaluated: "not evaluated" };

const ALL: ReadonlyArray<Readonly<Record<string, string>>> = [DESIGN_LABEL, DESIGN_GROUP_LABEL, MATERIALS_LABEL, MATERIALS_GROUP_LABEL, OBJECTIVE_LABEL, UNIT_LABEL, CAP_LABEL, CHARACTERISTIC_LABEL, EXCEPTION_LABEL, ENGINE_TERM_LABEL];

/** id → label over every map above, plus the taxonomy's own paradigm and unit-level labels. Built once. */
const BY_ID: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const map of ALL) for (const [id, label] of Object.entries(map)) if (!m.has(id)) m.set(id, label);
  for (const f of PARADIGM_FAMILY_IDS) m.set(f, familyLabel(f));
  for (const c of PARADIGM_CATEGORY_IDS) m.set(c, categoryLabel(c));
  for (const l of UNIT_LEVEL_IDS) m.set(l, unitLevelLabel(l));
  return m;
})();

/** Pure. The label for any taxonomy or engine id, or null when this map does not know it. */
export function knownLabel(id: string): string | null {
  return BY_ID.get(id) ?? null;
}

/** `hybrid_effectiveness_implementation` → "Hybrid effectiveness implementation"; the last resort, never the raw id. */
export function spellOut(id: string): string {
  const words = id.replace(/[_-]+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : id;
}

/** Pure. The label for an id, falling back to the id spelled out in words — never the raw id. */
export function displayLabel(id: string): string {
  return BY_ID.get(id) ?? spellOut(id);
}

export const designLabel = (id: DesignId | string): string => ((DESIGN_IDS as readonly string[]).includes(id) ? DESIGN_LABEL[id as DesignId] : displayLabel(id));
export const materialsLabel = (id: MaterialsKind | string): string => ((MATERIALS_KIND_IDS as readonly string[]).includes(id) ? MATERIALS_LABEL[id as MaterialsKind] : displayLabel(id));
export const objectiveLabel = (id: ObjectiveId | string): string => ((OBJECTIVE_IDS as readonly string[]).includes(id) ? OBJECTIVE_LABEL[id as ObjectiveId] : displayLabel(id));
export const unitLabel = (id: UnitId | string): string => ((UNIT_IDS as readonly string[]).includes(id) ? UNIT_LABEL[id as UnitId] : displayLabel(id));
export const paradigmLabel = (id: string): string => (isParadigmCategory(id) ? categoryLabel(id) : isParadigmFamily(id) ? familyLabel(id) : displayLabel(id));
export const capLabel = (id: CapId | string): string => CAP_LABEL[id as CapId] ?? displayLabel(id);

// ---------------------------------------------------------------------------
// The same map applied to the engine's stored sentences
// ---------------------------------------------------------------------------

/**
 * Only ids that carry an underscore are rewritten wholesale: snake_case is
 * what requirement "no snake_case in human-facing text" names, and a bare
 * word (`clinical`, `population`, `prevention`, `survey`) cannot be told
 * apart from ordinary prose — the engine quotes notice legalese verbatim
 * inside these same sentences ("citizenship rule not evaluated: \"…\""), and
 * rewriting a word inside a quote would falsify it.
 */
const SNAKE_IDS: readonly string[] = Array.from(BY_ID.keys())
  .filter((id) => id.includes("_"))
  .sort((a, b) => b.length - a.length);

/** Not preceded by a word character, `:` or `-` (an evidence id or a notice number), and not followed by one. */
const SNAKE_RE = new RegExp(`(?<![A-Za-z0-9_:-])(${SNAKE_IDS.join("|")})(?![A-Za-z0-9_-])`, "g");

/** The bare design ids — no underscore, so only rewritten inside a design clause (below). */
const BARE_DESIGNS: readonly string[] = (DESIGN_IDS as readonly string[]).filter((id) => !id.includes("_")).sort((a, b) => b.length - a.length);
const DESIGN_ALT = (DESIGN_IDS as readonly string[]).slice().sort((a, b) => b.length - a.length).join("|");

/**
 * The three shapes `engine/explain.ts` prints a design id in:
 * `a | b | c required`, `required, <id> 0.30`, `<id> prohibited`. Anchored,
 * so a bare id is only ever read as a design where the engine wrote one.
 */
const DESIGN_RUN_RE = new RegExp(`(?<![A-Za-z0-9_:-])((?:${DESIGN_ALT})(?:\\s\\|\\s(?:${DESIGN_ALT}))*)(?=\\s(?:required|prohibited|\\d))`, "g");
const DESIGN_SUPPORT_RE = new RegExp(`(?<=required,\\s)(${DESIGN_ALT})(?=\\s\\d)`, "g");

/**
 * A bare id read as vocabulary only where a verb makes it one: "the notice
 * excludes epidemiology", "notice prohibits rct", "aspiration names
 * translational". Everywhere else a lone lowercase word is prose.
 */
const ANY_ID_ALT = Array.from(BY_ID.keys()).sort((a, b) => b.length - a.length).join("|");
const VERB_ID_RE = new RegExp(`(?<=\\b(?:prohibits|excludes|requires|allows|names)\\s)((?:${ANY_ID_ALT})(?:,\\s(?:${ANY_ID_ALT}))*)(?![A-Za-z0-9_-])`, "g");

/**
 * A quoted value whose whole content is one snake_case token. `eligibility.
 * degree_required` and `citizenship_rule` are free-text fields the notice
 * extractor is asked to fill with the notice's own words, and it usually
 * does — but on some notices the model returns a slug instead
 * (`"US_citizen_or_permanent_resident"`, `"clinical_or_research_doctorate"`),
 * and stage 1 quotes whatever is there into a flag.
 *
 * Real notice legalese is never a single underscored token, so this is safe
 * to read as the machine value it is. It is the one exception to leaving
 * quoted text alone: nothing here is the notice's wording to falsify. Case is
 * kept (`US` stays `US`) — only the underscores go.
 */
const QUOTED_SLUG_RE = /"([A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+)"/g;

/** `self-declared do-not-suggest: health_systems, clinical` — a comma-separated family list the engine prints raw. */
const DO_NOT_SUGGEST_RE = /(?<=do-not-suggest:\s)([a-z_]+(?:,\s[a-z_]+)*)/g;

/**
 * Pure. The engine's stored `gap`, `why_not` and flag sentences with their
 * inline ids read as labels — "rct | early_phase_trial required, none in the
 * evidence" becomes "Randomized controlled trial | Early-phase trial
 * required, none in the evidence". Idempotent on text that carries no id.
 */
export function humanizeIds(text: string): string;
export function humanizeIds(text: string | null | undefined): string | null;
export function humanizeIds(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  if (!text) return text;
  // `a | b | c` is the engine's "any of these"; once the ids are phrases, "or" is how that reads.
  let out = text.replace(DESIGN_RUN_RE, (run) => run.split(" | ").map((id) => designLabel(id)).join(" or "));
  out = out.replace(DESIGN_SUPPORT_RE, (id) => designLabel(id));
  out = out.replace(VERB_ID_RE, (run) => run.split(", ").map((id) => displayLabel(id)).join(", "));
  out = out.replace(DO_NOT_SUGGEST_RE, (list) => list.split(", ").map((id) => paradigmLabel(id)).join(", "));
  out = out.replace(SNAKE_RE, (_m, id: string) => BY_ID.get(id) ?? id);
  out = out.replace(QUOTED_SLUG_RE, (_m, slug: string) => `"${slug.replace(/_/g, " ")}"`);
  return out;
}

/**
 * The evidence-id kinds `collectEvidence` mints (explain-view.ts's
 * `EVIDENCE_ID_RE`), so `publication:…:31000001` is stripped before the scan
 * and an ordinary `Design: rct` is not. The prefix is anchored to those kinds
 * on purpose: a looser `\\w*:` swallowed any colon followed by word
 * characters, so `Design:rct` hid the very id this is meant to catch.
 */
const EVIDENCE_ID_RE = /\b(?:publication|grant|trial|biosketch|profiles|directory|self_declared|aspiration):[A-Za-z0-9][A-Za-z0-9_:-]*/g;

/** Any snake_case token — `wet_lab_experiment`, `animal_rat`, `frobnicated_widget` alike. */
const SNAKE_TOKEN_RE = /(?<![A-Za-z0-9_-])[a-z][a-z0-9]*(?:_[a-z0-9]+)+(?![A-Za-z0-9_-])/g;
// No `:` in the lookbehind: evidence ids are already stripped above, so a colon left in front of a
// design id means the engine wrote one (`Design:rct`), which is precisely what this should catch.
const BARE_DESIGN_TEST_RE = new RegExp(`(?<![A-Za-z0-9_-])(${BARE_DESIGNS.join("|")})\\s(?:required|prohibited|\\d)`);

/**
 * Pure. Every raw id still showing in `text`, in order of appearance —
 * snake_case whether or not this map knows it, plus a bare design id in the
 * shapes `engine/explain.ts` writes one.
 *
 * Scanning for *any* snake_case rather than for the map's own keys is the
 * point. A guard built from `BY_ID.keys()` is close to a tautology after
 * `humanizeIds` — it can only fire on ids `humanizeIds` would already have
 * rewritten — and stays silent on exactly the case that matters: an id the
 * map has never heard of, which is what a taxonomy addition produces and what
 * no rewrite can fix. `knownLabel(id)` says which kind each hit is.
 */
export function rawIdsIn(text: string | null | undefined): string[] {
  if (!text) return [];
  const stripped = text.replace(EVIDENCE_ID_RE, " ");
  const out: string[] = [];
  for (const m of stripped.matchAll(SNAKE_TOKEN_RE)) if (!out.includes(m[0])) out.push(m[0]);
  for (const m of stripped.matchAll(new RegExp(BARE_DESIGN_TEST_RE.source, "g"))) if (!out.includes(m[1]!)) out.push(m[1]!);
  return out;
}

/** Pure. True when `text` still shows a raw id — the guard the surface tests assert on. */
export function hasRawId(text: string | null | undefined): boolean {
  return rawIdsIn(text).length > 0;
}
