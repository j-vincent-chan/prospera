/**
 * Hydration of the adversarial fixture (src/lib/fit/__fixtures__/
 * adversarial-cases.json, spec §13) into the stored profile shapes the
 * engine consumes, plus the minimal profiles behind `forbiddenCells()`.
 * Shared by engine.adversarial.test.ts and PR 2.4's metrics script.
 */
import adversarial from "@/lib/fit/__fixtures__/adversarial-cases.json";
import { categoriesOf, exploratoryException, TAXONOMY_VERSION } from "@/lib/fit/taxonomy";
import type {
  ActionabilityInputs,
  AxisConfidence,
  Confidence,
  DesignWeights,
  EvidenceSummary,
  InvestigatorCharacteristics,
  InvestigatorFitProfile,
  MaterialsWeights,
  ObjectiveWeights,
  OpportunityDesign,
  OpportunityEligibility,
  OpportunityFitProfile,
  OpportunityMaterials,
  OpportunityMechanism,
  OpportunityParadigm,
  OpportunitySources,
  OpportunityTeam,
  OpportunityTopic,
  OpportunityUnit,
  ParadigmCategory,
  ParadigmFamily,
  ParadigmWeights,
  ScoreContext,
  UnitLevelWeights,
} from "@/lib/fit/types";

export const FIXTURE_NOW = "2026-09-05T00:00:00.000Z";

export type FixtureCharacteristics = Partial<InvestigatorCharacteristics> & Partial<ActionabilityInputs>;

export type FixtureInvestigator = {
  paradigm: { recent: ParadigmWeights; career?: ParadigmWeights };
  unit?: UnitLevelWeights;
  design?: DesignWeights;
  materials?: MaterialsWeights;
  objective?: ObjectiveWeights;
  topic?: { mesh_major?: string[]; rcdc?: string[]; free_text?: string | null };
  characteristics?: FixtureCharacteristics;
  confidence?: Partial<AxisConfidence>;
  aspirations?: ParadigmCategory[];
  do_not_suggest?: ParadigmFamily[];
  collaborators?: Array<{ id: string; name?: string | null; dominant_family: ParadigmFamily; categories: ParadigmCategory[] }>;
  evidence_summary?: Partial<EvidenceSummary>;
};

export type FixtureOpportunity = {
  mechanism?: Partial<OpportunityMechanism>;
  paradigm?: Partial<OpportunityParadigm>;
  unit?: Partial<OpportunityUnit>;
  design?: Partial<OpportunityDesign>;
  materials?: Partial<OpportunityMaterials>;
  objective?: ObjectiveWeights;
  topic?: Partial<OpportunityTopic>;
  eligibility?: Partial<OpportunityEligibility>;
  team?: Partial<OpportunityTeam>;
  confidence?: Confidence;
  non_responsive?: string[];
  needs_review?: boolean;
  sources?: Partial<OpportunitySources>;
  population?: string | null;
};

export type FixtureDefaults = {
  characteristics?: FixtureCharacteristics;
  confidence?: Partial<AxisConfidence>;
  notice_eligibility?: Partial<OpportunityEligibility>;
};

/** A component expectation: an exact value or a tolerance band. */
export type ComponentExpectation = number | { min?: number; max?: number };

export type AdversarialExpect = {
  tier: string;
  caps: string[];
  components?: Record<string, ComponentExpectation>;
  score?: { min?: number; max?: number };
  why_not_mentions?: string[];
  gap_mentions?: string[];
  collaborator_suggested?: boolean;
  moderate_reason?: string;
  note?: string;
  /** Amendment records ("amended under D23: …"). */
  notes?: string[];
};

type FixtureCase = {
  id: string;
  title: string;
  investigator: FixtureInvestigator | string;
  opportunity: FixtureOpportunity;
  topic_score_override?: number;
  expect: AdversarialExpect;
  legacy_estimate?: { cosine_band: number[]; tier: string };
};

type FixtureFile = {
  version: string;
  defaults: FixtureDefaults;
  cases: FixtureCase[];
  forbidden_family_cells: { pairs: Array<[string, string]> };
};

const FILE = adversarial as unknown as FixtureFile;

const ACTIONABILITY_KEYS: ReadonlyArray<keyof ActionabilityInputs> = ["runway_weeks", "in_pipeline", "recently_dismissed"];

function splitCharacteristics(fx: FixtureCharacteristics | undefined): { characteristics: Partial<InvestigatorCharacteristics>; actionability: Partial<ActionabilityInputs> } {
  const characteristics: Record<string, unknown> = {};
  const actionability: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fx ?? {})) {
    if ((ACTIONABILITY_KEYS as readonly string[]).includes(k)) actionability[k] = v;
    else characteristics[k] = v;
  }
  return { characteristics: characteristics as Partial<InvestigatorCharacteristics>, actionability: actionability as Partial<ActionabilityInputs> };
}

const AXES: ReadonlyArray<keyof AxisConfidence> = ["paradigm", "unit", "design", "materials", "objective", "topic"];

export function hydrateInvestigator(id: string, fx: FixtureInvestigator, defaults: FixtureDefaults = {}): InvestigatorFitProfile {
  const chars = { ...splitCharacteristics(defaults.characteristics).characteristics, ...splitCharacteristics(fx.characteristics).characteristics };
  const confidence = {} as AxisConfidence;
  for (const axis of AXES) confidence[axis] = fx.confidence?.[axis] ?? defaults.confidence?.[axis] ?? "high";
  const mechanisms_held = chars.mechanisms_held ?? [];
  const trial_pi_count = chars.trial_pi_count ?? 0;
  return {
    investigator_id: id,
    taxonomy_version: TAXONOMY_VERSION,
    computed_at: FIXTURE_NOW,
    confidence,
    paradigm: { career: fx.paradigm.career ?? { ...fx.paradigm.recent }, recent: { ...fx.paradigm.recent } },
    unit: { ...(fx.unit ?? {}) },
    design: { ...(fx.design ?? {}) },
    materials: { ...(fx.materials ?? {}) },
    objective: { ...(fx.objective ?? {}) },
    topic: { mesh_major: [...(fx.topic?.mesh_major ?? [])], rcdc: [...(fx.topic?.rcdc ?? [])], free_text: fx.topic?.free_text ?? null },
    characteristics: {
      career_stage: chars.career_stage ?? null,
      esi: chars.esi ?? null,
      esi_eligible_until: chars.esi_eligible_until ?? null,
      mechanisms_held: [...mechanisms_held],
      active_awards: chars.active_awards ?? 0,
      clinical_role: chars.clinical_role ?? null,
      trial_pi_count,
      degrees: [...(chars.degrees ?? [])],
      title_series: chars.title_series ?? null,
    },
    aspirations: [...(fx.aspirations ?? [])],
    do_not_suggest: [...(fx.do_not_suggest ?? [])],
    evidence_summary: {
      publications_verified: fx.evidence_summary?.publications_verified ?? 0,
      grants: fx.evidence_summary?.grants ?? mechanisms_held.length,
      trials: fx.evidence_summary?.trials ?? trial_pi_count,
      trials_as_pi: fx.evidence_summary?.trials_as_pi ?? trial_pi_count,
      biosketch: fx.evidence_summary?.biosketch ?? "not_requested",
      self_declared: fx.evidence_summary?.self_declared ?? false,
    },
    provenance: [],
    collaborators: (fx.collaborators ?? []).map((c) => ({ id: c.id, name: c.name ?? null, dominant_family: c.dominant_family, categories: [...c.categories] })),
  };
}

export function hydrateOpportunity(id: string, fx: FixtureOpportunity, defaults: FixtureDefaults = {}): OpportunityFitProfile {
  const m = fx.mechanism ?? {};
  const clinical_trial = m.clinical_trial ?? "unknown";
  return {
    opportunity_id: id,
    number: id,
    taxonomy_version: TAXONOMY_VERSION,
    computed_at: FIXTURE_NOW,
    confidence: fx.confidence ?? "high",
    mechanism: {
      activity_code: m.activity_code ?? null,
      clinical_trial,
      besh: m.besh ?? clinical_trial === "besh_required",
      ceiling_direct_per_year: m.ceiling_direct_per_year ?? null,
      period_years: m.period_years ?? null,
      issuing_ic: m.issuing_ic ?? null,
      program_division: m.program_division ?? null,
    },
    paradigm: { required: { ...(fx.paradigm?.required ?? {}) }, allowed: { ...(fx.paradigm?.allowed ?? {}) }, excluded: { ...(fx.paradigm?.excluded ?? {}) }, required_any: { ...(fx.paradigm?.required_any ?? {}) } },
    unit: { required: [...(fx.unit?.required ?? [])], required_any: [...(fx.unit?.required_any ?? [])], allowed: [...(fx.unit?.allowed ?? [])] },
    design: { required_any: [...(fx.design?.required_any ?? [])], required_any_2: [...(fx.design?.required_any_2 ?? [])], allowed: [...(fx.design?.allowed ?? [])], prohibited: [...(fx.design?.prohibited ?? [])] },
    materials: { expected: [...(fx.materials?.expected ?? [])], required: [...(fx.materials?.required ?? [])], required_any: [...(fx.materials?.required_any ?? [])], human_required: fx.materials?.human_required ?? null },
    population: fx.population ?? null,
    objective: { ...(fx.objective ?? {}) },
    topic: { mesh: [...(fx.topic?.mesh ?? [])], rcdc: [...(fx.topic?.rcdc ?? [])], terms: [...(fx.topic?.terms ?? [])], free_text: fx.topic?.free_text ?? null },
    eligibility: {
      investigator_rules: [...(fx.eligibility?.investigator_rules ?? defaults.notice_eligibility?.investigator_rules ?? [])],
      esi_only: fx.eligibility?.esi_only ?? defaults.notice_eligibility?.esi_only ?? false,
      new_investigator_only: fx.eligibility?.new_investigator_only ?? defaults.notice_eligibility?.new_investigator_only ?? false,
      clinician_required: fx.eligibility?.clinician_required ?? defaults.notice_eligibility?.clinician_required ?? false,
      degree_required: fx.eligibility?.degree_required ?? defaults.notice_eligibility?.degree_required ?? null,
      independent_appointment_required: fx.eligibility?.independent_appointment_required ?? defaults.notice_eligibility?.independent_appointment_required ?? false,
      citizenship_rule: fx.eligibility?.citizenship_rule ?? defaults.notice_eligibility?.citizenship_rule ?? null,
    },
    team: { multi_pi_allowed: fx.team?.multi_pi_allowed ?? null, consortium_required: fx.team?.consortium_required ?? null, required_partners: [...(fx.team?.required_partners ?? [])] },
    non_responsive: [...(fx.non_responsive ?? [])],
    provenance: {},
    sources: { text: fx.sources?.text ?? "full_text", exemplar_count: fx.sources?.exemplar_count ?? 0 },
    needs_review: fx.needs_review ?? false,
  };
}

/** A context with no corpus inputs: the topic score comes from `override` (or is coded overlap alone). */
export function hydrateContext(fx: FixtureInvestigator, defaults: FixtureDefaults = {}, override: number | null = null): ScoreContext {
  const a = { ...splitCharacteristics(defaults.characteristics).actionability, ...splitCharacteristics(fx.characteristics).actionability };
  return {
    now: FIXTURE_NOW,
    actionability: { runway_weeks: a.runway_weeks ?? null, in_pipeline: a.in_pipeline ?? false, recently_dismissed: a.recently_dismissed ?? false },
    topic: { idf: { weights: {}, unknown: 1 }, items: [], bm25: null, override },
    infrastructure: null,
    track: null,
    investigator_pending_items: 0,
    notice_complete: true,
  };
}

export type AdversarialCase = {
  id: string;
  title: string;
  investigator: InvestigatorFitProfile;
  opportunity: OpportunityFitProfile;
  ctx: ScoreContext;
  expect: AdversarialExpect;
  legacy_estimate: { cosine_band: number[]; tier: string } | null;
};

export const FIXTURE_VERSION: string = FILE.version;

/** The nine cases, hydrated; a case whose `investigator` names another case reuses that profile. */
export function loadAdversarialCases(): AdversarialCase[] {
  const byId = new Map(FILE.cases.map((c) => [c.id, c]));
  const resolve = (c: FixtureCase, depth = 0): FixtureInvestigator => {
    if (typeof c.investigator !== "string") return c.investigator;
    const ref = byId.get(c.investigator);
    if (!ref || depth > 5) throw new Error(`adversarial-cases.json: case ${c.id} refers to unknown investigator "${c.investigator}"`);
    return resolve(ref, depth + 1);
  };
  return FILE.cases.map((c) => {
    const fx = resolve(c);
    return {
      id: c.id,
      title: c.title,
      investigator: hydrateInvestigator(c.id, fx, FILE.defaults),
      opportunity: hydrateOpportunity(c.id, c.opportunity, FILE.defaults),
      ctx: hydrateContext(fx, FILE.defaults, c.topic_score_override ?? null),
      expect: c.expect,
      legacy_estimate: c.legacy_estimate ?? null,
    };
  });
}

/** `forbidden_family_cells.pairs` from the fixture, as [investigator family, notice family]. */
export function forbiddenCellPairs(): Array<[ParadigmFamily, ParadigmFamily]> {
  return FILE.forbidden_family_cells.pairs.map(([a, b]) => [a as ParadigmFamily, b as ParadigmFamily]);
}

export type ForbiddenCell = { pair: [ParadigmFamily, ParadigmFamily]; investigator: InvestigatorFitProfile; opportunity: OpportunityFitProfile; ctx: ScoreContext };

/**
 * `bridged`: arm both exploratory bridges (§9) on the cell — the investigator
 * also carries `translational` and `human_biospecimen` at the bridges'
 * minimum weights and a collaborator whose dominant family is the notice's;
 * the notice also excludes the investigator's dominant category (as the §13
 * forbidden-pair notices do), so the excluded rule puts P under the Poor
 * gate in every cell and only a bridge could lift it. Every cell must stay
 * Poor: the bridges are written for other notice families.
 */
export type ForbiddenCellOptions = { bridged?: boolean };

/**
 * The minimal fixture behind one forbidden cell: a dominant-family
 * investigator (first category of the family at `weight`) against a notice
 * requiring the other family's first category at `weight`, topic supplied.
 */
export function forbiddenCell(pair: [ParadigmFamily, ParadigmFamily], weight: number, topic: number, options: ForbiddenCellOptions = {}): ForbiddenCell {
  const [invFamily, noticeFamily] = pair;
  const invCategory = categoriesOf(invFamily)[0];
  const noticeCategory = categoriesOf(noticeFamily)[0];
  const id = `forbidden:${invFamily}->${noticeFamily}${options.bridged ? ":bridged" : ""}`;
  const fx: FixtureInvestigator = { paradigm: { recent: { [invCategory]: weight } } };
  const opp: FixtureOpportunity = { paradigm: { required: { [noticeCategory]: weight } } };
  if (options.bridged) {
    fx.paradigm.recent = { ...fx.paradigm.recent, translational: exploratoryException("translational_bridge").investigator_translational_min, human_biospecimen: exploratoryException("biospecimen_bridge").investigator_human_biospecimen_min };
    fx.collaborators = [{ id: `collab-${noticeFamily}`, dominant_family: noticeFamily, categories: [noticeCategory] }];
    opp.paradigm = { ...opp.paradigm, excluded: { [invCategory]: weight } };
  }
  return {
    pair,
    investigator: hydrateInvestigator(id, fx, FILE.defaults),
    opportunity: hydrateOpportunity(id, opp, FILE.defaults),
    ctx: hydrateContext(fx, FILE.defaults, topic),
  };
}

/**
 * The forbidden family cells (fixture `forbidden_family_cells`): for each
 * [investigator family, notice family] pair a dominant-family investigator
 * at `weight` against a notice requiring the other family at `weight`, with
 * the topic score supplied at `topic`. Every cell must score Poor with
 * `paradigm_gate` — bridged (see `ForbiddenCellOptions`) or not.
 */
export function* forbiddenCells(options: ForbiddenCellOptions = {}, pairs: ReadonlyArray<[ParadigmFamily, ParadigmFamily]> = forbiddenCellPairs(), weight = 0.9, topic = 0.9): Generator<ForbiddenCell> {
  for (const pair of pairs) yield forbiddenCell(pair, weight, topic, options);
}
