/**
 * Opportunity fit profile (plan § PR 1.5; spec §6). Combines, in this order:
 *
 *  1. Deterministic overlays — `deterministicOverlays(notice)`: the activity-code
 *     prior (`taxonomy.opportunity_profile.activity_code_priors`, code
 *     normalized, unlisted codes add nothing), the clinical-trial designation
 *     overlay (`…clinical_trial_designation`, incl. the D14 `required_any`
 *     sets for BESH) and the Section VII division table
 *     (src/lib/fit/program-divisions.json via PR 1.2's `lookupProgramDivision`
 *     + `familyPriorBlock`, a family prior into `allowed`). The first two are
 *     selected through signal-mapping.json's `assign_notice` rules
 *     (`matchNoticeRules`); the division rule is `assign_from_table` and is
 *     applied here directly (PR 1.2 validator note c). Within the overlays the
 *     designation beats the activity code beats the division.
 *  2. Text — `extractWithModel` (./opportunity-extract.ts): three section
 *     groups, quote-verified. `mergeExtractions` lays the groups over the
 *     overlays with this precedence, highest first:
 *       (a) overlay entries, unless a verified `prior_override` removes or
 *           changes the specific entry;
 *       (b) text `excluded` / `prohibited` (any group);
 *       (c) text `required` / `required_any` (group 1 only);
 *       (d) text `allowed` / `expected`.
 *     A category both excluded and required: excluded wins when both came from
 *     the text or the exclusion is an overlay; an overlay `required` survives a
 *     text `excluded` (the model must use `prior_overrides` to contradict a
 *     prior). Either way `needs_review` is set. `allowed` entries that collide
 *     with an exclusion are dropped silently (logged). Group 2 may add
 *     exclusions but never removes group 1's requirements; groups 2 and 3
 *     never add requirements.
 *  3. Exemplars — `exemplarPrior`: every RePORTER exemplar abstract is
 *     classified with PR 1.3's `classifyItem` (rules first; the model only
 *     within the injected budget, cached in `fit_item_profiles`), the vectors
 *     are averaged per axis and scaled to max 1. `blend(text, exemplar, n)`
 *     reads `taxonomy.opportunity_profile.exemplar_blend` (≥ 15 → 0.6
 *     exemplar / 0.4 text, 5–14 → 0.4 / 0.6, else text only): paradigm
 *     `required` and `objective` become w_t · text + w_e · exemplar over the
 *     union of categories; a list axis (unit / design `allowed`, materials
 *     `expected`) gains an exemplar category only when its exemplar mass alone
 *     reaches what a text mention is worth (w_e · share ≥ w_t — derived from
 *     the blend row, no extra threshold). Excluded / prohibited entries are
 *     never re-added by exemplars.
 *  4. Confidence — the group-1 extractor's answer over full Guide text; capped
 *     at `medium` when only a synopsis was read; `low` when no text was read.
 *
 * Everything above `buildOpportunityFitProfile` is pure apart from the
 * injected model, rules and caches; Supabase enters only through
 * `OpportunityProfileStore` (`supabaseOpportunityProfileStore`), used by
 * `buildOpportunityFitProfile(db, id)` and `runOpportunityProfiles(db, …)`,
 * the runner the nightly fit-profiles cron calls (PR 1.4 owns the route).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildItemProfile, classifyItem, itemCacheKey, modelNeeded, type ItemProfileCache, type RulesFn } from "@/lib/fit/classify";
import { supabaseItemProfileCache } from "@/lib/fit/classify/cache";
import { openaiModel, type ModelFn } from "@/lib/fit/classify/llm";
import { buildMeshIndex } from "@/lib/fit/classify/mesh";
import { normalizeGrant } from "@/lib/fit/classify/normalize";
import { DEFAULT_RULE_TABLES, familyPriorBlock, lookupProgramDivision, matchNoticeRules, type EvaluateContext, type RuleSubject, type SignalMapping } from "@/lib/fit/classify/rules";
import {
  extractModelName,
  extractWithModel,
  ModelBudget,
  openaiExtractor,
  supabaseNoticeExtractionCache,
  synopsisSections,
  GROUP_FIELDS,
  type ExtractorPriors,
  type GroupExtraction,
  type GroupRun,
  type NoticeExtractionCache,
  type NoticeHeader,
  type NoticeSection,
} from "@/lib/fit/profile/opportunity-extract";
import signalMapping from "@/lib/fit/signal-mapping.json";
import {
  activityCodePrior,
  CLINICAL_TRIAL_DESIGNATION_IDS,
  clinicalTrialOverlay,
  exemplarBlend,
  isDesignId,
  isMaterialsKind,
  isObjectiveId,
  isParadigmCategory,
  isUnitLevel,
  TAXONOMY_VERSION,
  type ClinicalTrialOverlay,
} from "@/lib/fit/taxonomy";
import type {
  Axis,
  AxisDecider,
  ClinicalTrialDesignation,
  Confidence,
  DesignId,
  ItemProfile,
  MaterialsKind,
  NoticeQuote,
  ObjectiveWeights,
  OpportunityDesign,
  OpportunityEligibility,
  OpportunityFitProfile,
  OpportunityMaterials,
  OpportunityParadigm,
  OpportunityTeam,
  OpportunityUnit,
  ParadigmWeights,
  UnitLevel,
} from "@/lib/fit/types";
import { lookupMechanismTaxonomy, normalizeActivityCode } from "@/lib/funding-opportunities/mechanism-taxonomy";
import type { ExemplarRow } from "@/lib/ingestion/reporter/exemplars";
import { NIH_LIKE_FILTER, openNoticeFilter } from "@/lib/ingestion/reporter/exemplars";

/** The Guide sync's NIH-like set: PR 0.6's filter plus the PAS- numbers PR 0.5 fetches. */
export const NIH_NOTICE_FILTER = `${NIH_LIKE_FILTER},opportunity_number.like.PAS-__-___`;

export * from "@/lib/fit/profile/opportunity-extract";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** The `funding_opportunities` columns the builder reads. */
export type NoticeRecord = {
  id: string;
  opportunity_number: string | null;
  title: string;
  agency: string | null;
  agency_code: string | null;
  activity_code: string | null;
  clinical_trial_designation: string | null;
  program_division: string | null;
  /** PR 0.5 sections; null until the Guide page is parsed. */
  guide_sections: NoticeSection[] | null;
  guide_html_hash: string | null;
  guide_source: string | null;
  /** The Simpler synopsis — the fallback text when there are no sections. */
  description: string | null;
  nih_ic_tokens?: string[] | null;
  forecasted?: boolean | null;
  posted_date?: string | null;
};

export const NOTICE_COLUMNS = "id, opportunity_number, title, agency, agency_code, activity_code, clinical_trial_designation, program_division, guide_sections, guide_html_hash, guide_source, description, nih_ic_tokens, forecasted, posted_date";

/** The `opportunity_exemplars` columns the exemplar prior reads (PR 0.6). */
export type ExemplarRecord = Pick<ExemplarRow, "opportunity_number" | "project_num" | "core_project_num" | "awarded_under" | "lineage_depth" | "fiscal_year" | "title" | "abstract" | "activity_code" | "rcdc_categories" | "study_section" | "study_section_code">;

export const EXEMPLAR_COLUMNS = "opportunity_number, project_num, core_project_num, awarded_under, lineage_depth, fiscal_year, title, abstract, activity_code, rcdc_categories, study_section, study_section_code";

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** A stored designation that has an overlay row (`unknown` and NULL have none). */
export const isClinicalTrialDesignationId = (id: string): id is ClinicalTrialDesignation => (CLINICAL_TRIAL_DESIGNATION_IDS as readonly string[]).includes(id);

// ---------------------------------------------------------------------------
// 1 · Deterministic overlays
// ---------------------------------------------------------------------------

export type OverlaySource = "designation" | "activity_code" | "division";

export type Overlays = {
  paradigm: OpportunityParadigm;
  unit: { required: UnitLevel[]; required_any: UnitLevel[] };
  design: { required_any: DesignId[]; prohibited: DesignId[] };
  materials: { required: MaterialsKind[]; required_any: MaterialsKind[] };
  objective: ObjectiveWeights;
  /** `career: true` in the activity-code prior (F / T / K series). */
  career: boolean;
  /** The activity code as looked up (normalized), or null. */
  activity_code: string | null;
  /** One line per overlay applied: rule id → table entry. */
  applied: string[];
  /** Normalizations, unlisted codes, unknown designations / divisions, overlay-internal conflicts. */
  notes: string[];
  /** Entry path (`paradigm.required.clinical_trials`, `unit.required.L3`, …) → which overlay set it. */
  origin: Record<string, OverlaySource>;
  /** The priors line handed to the extractor. */
  priors: ExtractorPriors;
};

export type NoticeOverlayInput = Pick<NoticeRecord, "activity_code" | "clinical_trial_designation" | "program_division">;

/** signal-mapping.json's notice rules only (no MeSH clauses), so `matchNoticeRules` needs no descriptor index. */
const NOTICE_RULE_MAPPING: SignalMapping = {
  version: (signalMapping as { version: string }).version,
  rules: (signalMapping as unknown as SignalMapping).rules.filter((r) => r.source === "notice"),
};
const EMPTY_MESH_INDEX = buildMeshIndex([]);
const NOTICE_RULE_CONTEXT: EvaluateContext = { mesh: EMPTY_MESH_INDEX, tables: DEFAULT_RULE_TABLES, mapping: NOTICE_RULE_MAPPING };

/** The overlay an `assign_notice` path names (notice-extractor spec; PR 1.2 `matchNoticeRules`). Throws on a path this PR does not know. */
export function resolveNoticeAssignment(path: string, activityCode: string | null): { overlay: ClinicalTrialOverlay; entry: string; source: "designation" } | { prior: ReturnType<typeof activityCodePrior>; entry: string; source: "activity_code" } {
  const designation = /^taxonomy\.opportunity_profile\.clinical_trial_designation\.(\w+)$/.exec(path);
  if (designation) return { overlay: clinicalTrialOverlay(designation[1]!), entry: designation[1]!, source: "designation" };
  if (path === "taxonomy.opportunity_profile.activity_code_priors[activity_code]") {
    return { prior: activityCode ? activityCodePrior(activityCode) : null, entry: activityCode ?? "(none)", source: "activity_code" };
  }
  throw new Error(`assign_notice path not understood: ${path}`);
}

/** Pure. The overlays for one notice from its stored deterministic fields. NOT- notices, forecasts and notices without sections get the same treatment — nothing here reads text. */
export function deterministicOverlays(notice: NoticeOverlayInput): Overlays {
  const out: Overlays = {
    paradigm: { required: {}, required_any: {}, allowed: {}, excluded: {} },
    unit: { required: [], required_any: [] },
    design: { required_any: [], prohibited: [] },
    materials: { required: [], required_any: [] },
    objective: {},
    career: false,
    activity_code: null,
    applied: [],
    notes: [],
    origin: {},
    priors: { paradigm_required: {}, paradigm_allowed: {}, paradigm_excluded: {}, unit_required: [], design_required_any: [], design_prohibited: [], materials_required: [] },
  };
  const origin = out.origin;
  const setWeight = (map: Record<string, number>, path: string, id: string, w: number, source: OverlaySource) => {
    map[id] = Math.max(map[id] ?? 0, w);
    origin[`${path}.${id}`] ??= source;
  };
  const addId = <T extends string>(list: T[], path: string, id: T, source: OverlaySource) => {
    if (!list.includes(id)) list.push(id);
    origin[`${path}.${id}`] ??= source;
  };

  // Normalize the activity code the way the rest of the app does ("r01 " → R01, "K99/R00" → K99).
  const rawCode = notice.activity_code;
  const code = normalizeActivityCode(rawCode);
  out.activity_code = code;
  if (rawCode && code !== rawCode) out.notes.push(`activity code ${JSON.stringify(rawCode)} normalized to ${code}`);

  const designation = notice.clinical_trial_designation;
  if (designation && !isClinicalTrialDesignationId(designation)) out.notes.push(`clinical_trial_designation ${JSON.stringify(designation)} has no overlay`);
  if (!designation) out.notes.push("clinical_trial_designation not stored: no designation overlay");

  const subject: RuleSubject = {
    mesh: [],
    publication_types: [],
    signals: { clinical_trial_designation: designation && isClinicalTrialDesignationId(designation) ? designation : null, activity_code: code },
  };
  const matches = matchNoticeRules(subject, NOTICE_RULE_CONTEXT);

  // Designation first (highest precedence inside the overlays).
  for (const m of matches) {
    const resolved = resolveNoticeAssignment(m.assign_notice, code);
    if (resolved.source !== "designation") continue;
    const o = resolved.overlay;
    out.applied.push(`${m.ruleId} → clinical_trial_designation.${resolved.entry}`);
    for (const [c, w] of Object.entries(o.paradigm_required ?? {})) setWeight(out.paradigm.required as Record<string, number>, "paradigm.required", c, w!, "designation");
    for (const [c, w] of Object.entries(o.paradigm_required_any ?? {})) setWeight(out.paradigm.required_any as Record<string, number>, "paradigm.required_any", c, w!, "designation");
    for (const [c, w] of Object.entries(o.paradigm_excluded ?? {})) setWeight(out.paradigm.excluded as Record<string, number>, "paradigm.excluded", c, w!, "designation");
    for (const l of o.unit_required ?? []) addId(out.unit.required, "unit.required", l, "designation");
    for (const l of o.unit_required_any ?? []) addId(out.unit.required_any, "unit.required_any", l, "designation");
    for (const d of o.design_required_any ?? []) addId(out.design.required_any, "design.required_any", d, "designation");
    for (const d of o.design_prohibited ?? []) addId(out.design.prohibited, "design.prohibited", d, "designation");
    for (const k of o.materials_required ?? []) addId(out.materials.required, "materials.required", k, "designation");
    for (const k of o.materials_required_any ?? []) addId(out.materials.required_any, "materials.required_any", k, "designation");
  }

  // Activity code second: a prior the designation excludes is dropped.
  const excluded = out.paradigm.excluded as Record<string, number>;
  for (const m of matches) {
    const resolved = resolveNoticeAssignment(m.assign_notice, code);
    if (resolved.source !== "activity_code") continue;
    const prior = resolved.prior;
    if (!code) continue;
    if (prior === null) {
      out.notes.push(`activity code ${code} is not in the prior table: no activity-code overlay`);
      continue;
    }
    const neutral = !prior.r && !prior.a && !prior.objective && !prior.career;
    out.applied.push(`${m.ruleId} → activity_code_priors.${code}${neutral ? " (neutral)" : ""}`);
    for (const [c, w] of Object.entries(prior.r ?? {})) {
      if (excluded[c] !== undefined) {
        out.notes.push(`overlay conflict: designation excludes ${c}; activity-code prior required ${c} ${w} dropped`);
        continue;
      }
      setWeight(out.paradigm.required as Record<string, number>, "paradigm.required", c, w!, "activity_code");
    }
    for (const [c, w] of Object.entries(prior.a ?? {})) {
      if (excluded[c] !== undefined) {
        out.notes.push(`overlay conflict: designation excludes ${c}; activity-code prior allowed ${c} ${w} dropped`);
        continue;
      }
      setWeight(out.paradigm.allowed as Record<string, number>, "paradigm.allowed", c, w!, "activity_code");
    }
    if (prior.objective) {
      if (!isObjectiveId(prior.objective)) throw new Error(`activity_code_priors.${code}.objective ${prior.objective} is not an objective id`);
      setWeight(out.objective as Record<string, number>, "objective", prior.objective, 1, "activity_code");
    }
    if (prior.career) {
      out.career = true;
      setWeight(out.objective as Record<string, number>, "objective", "training_capacity", 1, "activity_code");
    }
  }

  // Division third: a family prior into `allowed`.
  const division = notice.program_division;
  if (division) {
    const hit = lookupProgramDivision(DEFAULT_RULE_TABLES.programDivisions, division);
    if (hit.entry) {
      const block = familyPriorBlock(hit.entry, `notice_program_division ← ${hit.key}`);
      out.applied.push(`notice_program_division → program-divisions.${hit.key}`);
      for (const [c, w] of Object.entries(block.paradigm ?? {})) {
        if (excluded[c] !== undefined) {
          out.notes.push(`overlay conflict: designation excludes ${c}; division prior allowed ${c} ${w} dropped`);
          continue;
        }
        setWeight(out.paradigm.allowed as Record<string, number>, "paradigm.allowed", c, w, "division");
      }
    } else out.notes.push(`program division ${JSON.stringify(division)} is not in program-divisions.json: no division overlay`);
  }

  out.priors = {
    paradigm_required: { ...out.paradigm.required } as Record<string, number>,
    ...(Object.keys(out.paradigm.required_any).length ? { paradigm_required_any: { ...out.paradigm.required_any } as Record<string, number> } : {}),
    paradigm_allowed: { ...out.paradigm.allowed } as Record<string, number>,
    paradigm_excluded: { ...out.paradigm.excluded } as Record<string, number>,
    unit_required: [...out.unit.required],
    ...(out.unit.required_any.length ? { unit_required_any: [...out.unit.required_any] } : {}),
    design_required_any: [...out.design.required_any],
    design_prohibited: [...out.design.prohibited],
    materials_required: [...out.materials.required],
    ...(out.materials.required_any.length ? { materials_required_any: [...out.materials.required_any] } : {}),
  };
  return out;
}

// ---------------------------------------------------------------------------
// 2 · Merge the section groups over the overlays
// ---------------------------------------------------------------------------

export type MergeResult = {
  paradigm: OpportunityParadigm;
  unit: OpportunityUnit;
  design: OpportunityDesign;
  materials: OpportunityMaterials;
  population: string | null;
  objective: ObjectiveWeights;
  topic_terms: string[];
  non_responsive: string[];
  mechanism_text: { ceiling_direct_per_year: number | null; period_years: number | null; budget_notes: string | null; clinical_trial_text: string | null };
  eligibility: OpportunityEligibility;
  team: OpportunityTeam;
  /** Field path → first verified quote, in group order. */
  provenance: Record<string, NoticeQuote>;
  /** The group-1 extractor's confidence (min over chunks; a usable reply without one counts as medium); null when group 1 produced nothing usable. */
  confidence: Confidence | null;
  needs_review: boolean;
  overrides_applied: string[];
  log: string[];
};

type EntryOrigin = OverlaySource | "text";

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
const minConfidence = (a: Confidence, b: Confidence): Confidence => (CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b);

const isNullish = (v: unknown) => v === null || v === undefined || v === false || v === 0 || v === "" || (Array.isArray(v) && v.length === 0);

/** Pure. See the module comment for the precedence. */
export function mergeExtractions(overlays: Overlays, extractions: GroupExtraction[]): MergeResult {
  const logLines: string[] = [];
  const note = (line: string) => logLines.push(line);
  const origin = new Map<string, EntryOrigin>(Object.entries(overlays.origin));
  const paradigm: Record<"required" | "required_any" | "allowed" | "excluded", Record<string, number>> = {
    required: { ...overlays.paradigm.required } as Record<string, number>,
    required_any: { ...overlays.paradigm.required_any } as Record<string, number>,
    allowed: { ...overlays.paradigm.allowed } as Record<string, number>,
    excluded: { ...overlays.paradigm.excluded } as Record<string, number>,
  };
  const unit: Record<"required" | "required_any" | "allowed", string[]> = { required: [...overlays.unit.required], required_any: [...overlays.unit.required_any], allowed: [] };
  const design: Record<"required_any" | "required_any_2" | "allowed" | "prohibited", string[]> = { required_any: [...overlays.design.required_any], required_any_2: [], allowed: [], prohibited: [...overlays.design.prohibited] };
  const materials: Record<"expected" | "required" | "required_any", string[]> = { expected: [], required: [...overlays.materials.required], required_any: [...overlays.materials.required_any] };
  const objective: Record<string, number> = { ...overlays.objective } as Record<string, number>;
  const provenance: Record<string, NoticeQuote> = {};
  const overrides_applied: string[] = [];
  let needs_review = false;
  let confidence: Confidence | null = null;

  const sorted = [...extractions].sort((a, b) => a.group - b.group || a.chunk - b.chunk);
  /** Overrides taken as text claims — their quotes join the provenance. */
  const textOverrides: Array<{ field: string; quote: string; section: string }> = [];
  const guardFor = (axis: string): ((id: string) => boolean) => (axis === "paradigm" ? isParadigmCategory : axis === "unit" ? isUnitLevel : axis === "design" ? isDesignId : axis === "materials" ? isMaterialsKind : isObjectiveId);

  // (a) Verified prior overrides edit the overlay layer, nothing else.
  const mapOf = (path: string): Record<string, number> | null => {
    const [axis, field] = path.split(".");
    if (axis === "paradigm" && field && field in paradigm) return paradigm[field as keyof typeof paradigm];
    if (axis === "objective" && !field) return objective;
    return null;
  };
  const listOf = (path: string): string[] | null => {
    const [axis, field] = path.split(".");
    if (axis === "unit" && field && field in unit) return unit[field as keyof typeof unit];
    if (axis === "design" && field && field in design) return design[field as keyof typeof design];
    if (axis === "materials" && field && field in materials) return materials[field as keyof typeof materials];
    return null;
  };
  for (const e of sorted) {
    for (const o of e.output.prior_overrides) {
      const parts = o.field.split(".");
      const entryPath = o.field;
      const fieldPath = parts.length >= 3 ? parts.slice(0, 2).join(".") : parts[0] === "objective" && parts.length === 2 ? "objective" : null;
      const id = fieldPath ? parts[parts.length - 1]! : null;
      const src = origin.get(entryPath);
      if (fieldPath && id && src && src !== "text") {
        const map = mapOf(fieldPath);
        const list = listOf(fieldPath);
        if (isNullish(o.to)) {
          if (map) delete map[id];
          if (list) {
            const i = list.indexOf(id);
            if (i >= 0) list.splice(i, 1);
          }
          origin.delete(entryPath);
          overrides_applied.push(`${entryPath}: removed (${src} prior) — "${o.quote}" [${o.section}]`);
        } else if (map && typeof o.to === "number" && Number.isFinite(o.to)) {
          map[id] = Math.min(1, Math.max(0, o.to));
          overrides_applied.push(`${entryPath}: ${src} prior ${String(o.from)} → ${map[id]} — "${o.quote}" [${o.section}]`);
        } else note(`prior_override ${entryPath}: value ${JSON.stringify(o.to)} not understood; ignored`);
        continue;
      }
      // A whole prior field replaced ("unit.required": [...]) — only when the priors set it.
      const listField = parts.length === 2 ? listOf(o.field) : null;
      const listOverlay = listField && listField.some((x) => (origin.get(`${o.field}.${x}`) ?? "text") !== "text");
      if (listField && listOverlay && (isNullish(o.to) || Array.isArray(o.to))) {
        for (const x of [...listField]) {
          if ((origin.get(`${o.field}.${x}`) ?? "text") === "text") continue;
          listField.splice(listField.indexOf(x), 1);
          origin.delete(`${o.field}.${x}`);
        }
        const guard = parts[0] === "unit" ? isUnitLevel : parts[0] === "design" ? isDesignId : isMaterialsKind;
        for (const x of Array.isArray(o.to) ? o.to : []) {
          if (typeof x !== "string" || !guard(x)) {
            note(`prior_override ${o.field}: ${JSON.stringify(x)} is not a vocabulary id; skipped`);
            continue;
          }
          if (!listField.includes(x)) listField.push(x);
          origin.set(`${o.field}.${x}`, "text");
        }
        overrides_applied.push(`${o.field}: prior list → [${listField.join(", ")}] — "${o.quote}" [${o.section}]`);
        continue;
      }
      // Not a prior: a verified quote on one of this group's own fields is still evidence — take it as a text claim.
      if (fieldPath && id && (GROUP_FIELDS[e.group] as readonly string[]).includes(fieldPath) && !src) {
        const map = mapOf(fieldPath);
        const list = listOf(fieldPath);
        if (map && typeof o.to === "number" && Number.isFinite(o.to) && o.to > 0) {
          map[id] = Math.max(map[id] ?? 0, Math.min(1, o.to));
          origin.set(entryPath, "text");
          textOverrides.push({ field: entryPath, quote: o.quote, section: o.section });
          note(`prior_override ${entryPath}: the priors did not set it; taken as a text claim (${map[id]}) with its quote`);
          continue;
        }
        if (list && typeof o.to === "boolean" && o.to) {
          if (!list.includes(id)) list.push(id);
          origin.set(entryPath, "text");
          textOverrides.push({ field: entryPath, quote: o.quote, section: o.section });
          note(`prior_override ${entryPath}: the priors did not set it; taken as a text claim with its quote`);
          continue;
        }
      }
      if (parts.length === 2 && (GROUP_FIELDS[e.group] as readonly string[]).includes(o.field) && !isNullish(o.to)) {
        const map = mapOf(o.field);
        const list = listOf(o.field);
        let taken = false;
        if (map && typeof o.to === "object" && o.to !== null && !Array.isArray(o.to)) {
          for (const [k, w] of Object.entries(o.to as Record<string, unknown>)) {
            if (typeof w !== "number" || !Number.isFinite(w) || w <= 0 || !guardFor(parts[0]!)(k)) continue;
            map[k] = Math.max(map[k] ?? 0, Math.min(1, w));
            if (!origin.has(`${o.field}.${k}`)) origin.set(`${o.field}.${k}`, "text");
            taken = true;
          }
        } else if (list && Array.isArray(o.to)) {
          for (const k of o.to) {
            if (typeof k !== "string" || !guardFor(parts[0]!)(k)) continue;
            if (!list.includes(k)) list.push(k);
            if (!origin.has(`${o.field}.${k}`)) origin.set(`${o.field}.${k}`, "text");
            taken = true;
          }
        }
        if (taken) {
          textOverrides.push({ field: o.field, quote: o.quote, section: o.section });
          note(`prior_override ${o.field}: the priors did not set it; taken as a text claim with its quote`);
          continue;
        }
      }
      note(`prior_override ${o.field}: the priors did not set it; ignored`);
    }
  }

  // (b)–(d) Text entries. Group 1 fills requirements and allowances; groups 2–3 their own fields.
  const setMax = (map: Record<string, number>, path: string, id: string, w: number) => {
    map[id] = Math.max(map[id] ?? 0, w);
    if (!origin.has(`${path}.${id}`)) origin.set(`${path}.${id}`, "text");
  };
  const addId = (list: string[], path: string, id: string) => {
    if (!list.includes(id)) list.push(id);
    if (!origin.has(`${path}.${id}`)) origin.set(`${path}.${id}`, "text");
  };
  let population: string | null = null;
  const terms: string[] = [];
  const nonResponsive: string[] = [];
  const mechanism_text: MergeResult["mechanism_text"] = { ceiling_direct_per_year: null, period_years: null, budget_notes: null, clinical_trial_text: null };
  const eligibility: OpportunityEligibility = { investigator_rules: [], esi_only: false, new_investigator_only: false, clinician_required: false, degree_required: null, independent_appointment_required: false, citizenship_rule: null };
  const team: OpportunityTeam = { multi_pi_allowed: null, consortium_required: null, required_partners: [] };
  let humanRequired: boolean | null = null;

  for (const e of sorted) {
    if (!e.usable) {
      note(`group ${e.group}${e.of > 1 ? `/${e.chunk}` : ""}: reply unusable (${e.dropped[0] ?? "no reason"}); nothing merged`);
      continue;
    }
    const o = e.output;
    if (e.group === 1) {
      confidence = confidence === null ? (o.confidence ?? "medium") : minConfidence(confidence, o.confidence ?? "medium");
      for (const [c, w] of Object.entries(o.paradigm.required)) setMax(paradigm.required, "paradigm.required", c, w);
      for (const [c, w] of Object.entries(o.paradigm.required_any)) setMax(paradigm.required_any, "paradigm.required_any", c, w);
      for (const [c, w] of Object.entries(o.paradigm.allowed)) setMax(paradigm.allowed, "paradigm.allowed", c, w);
      for (const l of o.unit.required) addId(unit.required, "unit.required", l);
      for (const l of o.unit.allowed) addId(unit.allowed, "unit.allowed", l);
      for (const d of o.design.required_any) addId(design.required_any, "design.required_any", d);
      for (const d of o.design.required_any_2) addId(design.required_any_2, "design.required_any_2", d);
      for (const d of o.design.allowed) addId(design.allowed, "design.allowed", d);
      for (const k of o.materials.expected) addId(materials.expected, "materials.expected", k);
      if (o.materials.human_required !== null && humanRequired === null) humanRequired = o.materials.human_required;
      if (o.population && !population) population = o.population;
      for (const [c, w] of Object.entries(o.objective)) setMax(objective, "objective", c, w);
      for (const t of [...o.topic.distinguishing_terms, ...o.topic.diseases, ...o.topic.biological_processes]) {
        if (!terms.some((x) => x.toLowerCase() === t.toLowerCase())) terms.push(t);
      }
    }
    // Exclusions from any group that carries them (group 1's own list and group 2's).
    for (const [c, w] of Object.entries(o.paradigm.excluded)) setMax(paradigm.excluded, "paradigm.excluded", c, w);
    for (const d of o.design.prohibited) addId(design.prohibited, "design.prohibited", d);
    if (e.group === 2) {
      for (const item of o.non_responsive) if (!nonResponsive.includes(item)) nonResponsive.push(item);
      mechanism_text.ceiling_direct_per_year ??= o.mechanism.ceiling_direct_per_year;
      mechanism_text.period_years ??= o.mechanism.period_years;
      mechanism_text.budget_notes ??= o.mechanism.budget_notes;
      mechanism_text.clinical_trial_text ??= o.clinical_trial_text;
    }
    if (e.group === 3) {
      for (const r of o.eligibility.investigator_rules) if (!eligibility.investigator_rules.includes(r)) eligibility.investigator_rules.push(r);
      eligibility.esi_only ||= o.eligibility.esi_only;
      eligibility.new_investigator_only ||= o.eligibility.new_investigator_only;
      eligibility.clinician_required ||= o.eligibility.clinician_required;
      eligibility.independent_appointment_required ||= o.eligibility.independent_appointment_required;
      eligibility.degree_required ??= o.eligibility.degree_required;
      eligibility.citizenship_rule ??= o.eligibility.citizenship_rule;
      team.multi_pi_allowed ??= o.team.multi_pi_allowed;
      team.consortium_required ??= o.team.consortium_required;
      for (const p of o.team.required_partners) if (!team.required_partners.includes(p)) team.required_partners.push(p);
    }
    for (const q of o.evidence) provenance[q.field] ??= { section: q.section, quote: q.quote };
  }
  for (const q of textOverrides) provenance[q.field] ??= { section: q.section, quote: q.quote };

  // Conflicts. An exclusion beats a text requirement; an overlay requirement beats a text exclusion.
  const isOverlay = (path: string) => (origin.get(path) ?? "text") !== "text";
  for (const c of Object.keys(paradigm.excluded)) {
    for (const field of ["required", "required_any"] as const) {
      if (paradigm[field][c] === undefined) continue;
      needs_review = true;
      if (isOverlay(`paradigm.${field}.${c}`) && !isOverlay(`paradigm.excluded.${c}`)) {
        note(`conflict: ${c} is a ${origin.get(`paradigm.${field}.${c}`)} prior in paradigm.${field} and the text excludes it; the prior stands (use prior_overrides), exclusion dropped; needs_review`);
        delete paradigm.excluded[c];
      } else {
        note(`conflict: ${c} both excluded and in paradigm.${field}; excluded wins, requirement dropped; needs_review`);
        delete paradigm[field][c];
      }
    }
    if (paradigm.excluded[c] !== undefined && paradigm.allowed[c] !== undefined) {
      note(`${c}: excluded, dropped from paradigm.allowed`);
      delete paradigm.allowed[c];
    }
  }
  for (const d of [...design.prohibited]) {
    for (const field of ["required_any", "required_any_2"] as const) {
      const i = design[field].indexOf(d);
      if (i < 0) continue;
      needs_review = true;
      if (isOverlay(`design.${field}.${d}`) && !isOverlay(`design.prohibited.${d}`)) {
        note(`conflict: ${d} is a ${origin.get(`design.${field}.${d}`)} prior in design.${field} and the text prohibits it; the prior stands, prohibition dropped; needs_review`);
        design.prohibited.splice(design.prohibited.indexOf(d), 1);
      } else {
        note(`conflict: ${d} both prohibited and in design.${field}; prohibited wins, requirement dropped; needs_review`);
        design[field].splice(i, 1);
      }
    }
    const a = design.allowed.indexOf(d);
    if (a >= 0 && design.prohibited.includes(d)) {
      note(`${d}: prohibited, dropped from design.allowed`);
      design.allowed.splice(a, 1);
    }
  }
  // A category `required` outright is not also an any-of member; allowed lists never repeat a requirement.
  for (const c of Object.keys(paradigm.required_any)) {
    if (paradigm.required[c] !== undefined) {
      note(`${c}: in paradigm.required, dropped from paradigm.required_any`);
      delete paradigm.required_any[c];
    }
  }
  for (const c of Object.keys(paradigm.allowed)) {
    if (paradigm.required[c] !== undefined || paradigm.required_any[c] !== undefined) delete paradigm.allowed[c];
  }
  unit.allowed = unit.allowed.filter((l) => !unit.required.includes(l) && !unit.required_any.includes(l));
  design.allowed = design.allowed.filter((d) => !design.required_any.includes(d) && !design.required_any_2.includes(d));
  materials.expected = materials.expected.filter((k) => !materials.required.includes(k) && !materials.required_any.includes(k));

  return {
    paradigm: paradigm as unknown as OpportunityParadigm,
    unit: unit as OpportunityUnit,
    design: design as OpportunityDesign,
    materials: { expected: materials.expected as MaterialsKind[], required: materials.required as MaterialsKind[], required_any: materials.required_any as MaterialsKind[], human_required: humanRequired },
    population,
    objective: objective as ObjectiveWeights,
    topic_terms: terms,
    non_responsive: nonResponsive,
    mechanism_text,
    eligibility,
    team,
    provenance,
    confidence,
    needs_review,
    overrides_applied,
    log: logLines,
  };
}

// ---------------------------------------------------------------------------
// 3 · Exemplar prior
// ---------------------------------------------------------------------------

export type ExemplarPriorDeps = {
  /** PR 1.2's `evaluateRules` with its context applied. */
  rules: RulesFn;
  /** The item classifier's model; absent → rules only (never the network by default). */
  model?: ModelFn;
  modelName?: string;
  cache?: ItemProfileCache;
  /** Model calls are taken from here; absent with a model → unlimited. */
  budget?: ModelBudget;
  now?: () => Date;
};

export type ExemplarItemResult = {
  id: string;
  project_num: string;
  awarded_under: string;
  fiscal_year: number | null;
  /** False when the exemplar has no abstract (nothing to classify). */
  classified: boolean;
  model_needed: boolean;
  model_called: boolean;
  cache: "hit" | "miss" | "disabled" | "n/a";
  decided_by: Partial<Record<Axis, AxisDecider>>;
  rules_fired: string[];
  profile: ItemProfile | null;
};

export type ExemplarPrior = {
  /** Exemplar rows given (D13: the stored rows, cap 60). */
  rows: number;
  /** Rows with an abstract, i.e. classified — the blend's n. */
  classified: number;
  /** Mean over classified exemplars per axis, scaled to max 1. */
  axes: Record<Axis, Record<string, number>>;
  /** Distinct RCDC categories over the rows, most frequent first. */
  rcdc: string[];
  items: ExemplarItemResult[];
  model_calls: number;
};

const AXES: readonly Axis[] = ["paradigm", "unit", "design", "materials", "objective"];

/** Pure. Mean of each axis vector over the profiles, scaled so the top category is 1 (share of the portfolio). */
export function aggregateExemplarAxes(profiles: ItemProfile[]): Record<Axis, Record<string, number>> {
  const out = { paradigm: {}, unit: {}, design: {}, materials: {}, objective: {} } as Record<Axis, Record<string, number>>;
  if (!profiles.length) return out;
  for (const axis of AXES) {
    const sums: Record<string, number> = {};
    for (const p of profiles) {
      for (const [id, w] of Object.entries(p[axis] as Record<string, number>)) sums[id] = (sums[id] ?? 0) + w;
    }
    const max = Math.max(0, ...Object.values(sums));
    if (max <= 0) continue;
    const scaled: Record<string, number> = {};
    for (const [id, s] of Object.entries(sums).sort((a, b) => b[1] - a[1])) scaled[id] = round3(s / max);
    out[axis] = scaled;
  }
  return out;
}

/** Classify every exemplar abstract (rules → cache → model within the budget) and aggregate. */
export async function exemplarPrior(exemplars: ExemplarRecord[], deps: ExemplarPriorDeps): Promise<ExemplarPrior> {
  const items: ExemplarItemResult[] = [];
  const profiles: ItemProfile[] = [];
  let model_calls = 0;
  const rcdcCounts = new Map<string, number>();
  for (const ex of exemplars) {
    for (const c of ex.rcdc_categories ?? []) rcdcCounts.set(c, (rcdcCounts.get(c) ?? 0) + 1);
    const item = normalizeGrant({
      id: ex.project_num,
      project_num: ex.project_num,
      project_title: ex.title,
      fiscal_year: ex.fiscal_year,
      activity_code: ex.activity_code,
      rcdc_categories: ex.rcdc_categories,
      study_section: ex.study_section,
      study_section_code: ex.study_section_code,
      is_contact_pi: null,
      abstract: ex.abstract,
      raw_json: null,
    });
    const base = { id: item.id, project_num: ex.project_num, awarded_under: ex.awarded_under, fiscal_year: ex.fiscal_year };
    if (!item.text?.trim()) {
      items.push({ ...base, classified: false, model_needed: false, model_called: false, cache: "n/a", decided_by: {}, rules_fired: [], profile: null });
      continue;
    }
    const rules = deps.rules(item);
    const need = modelNeeded(item, rules);
    let profile: ItemProfile;
    let cache: ExemplarItemResult["cache"] = "n/a";
    let model_called = false;
    let useModel = false;
    if (need.needed) {
      const cached = deps.cache ? await deps.cache.get(itemCacheKey(item)) : null;
      const cachedUsable = Boolean(cached?.llm && cached.llm.usable !== false);
      useModel = cachedUsable || (Boolean(deps.model) && (!deps.budget || deps.budget.take()));
    }
    if (useModel) {
      const out = await classifyItem(item, { rules: () => rules, model: deps.model, modelName: deps.modelName, cache: deps.cache, now: deps.now });
      profile = out.profile;
      cache = out.cache;
      model_called = out.model_called;
      if (model_called) model_calls += 1;
    } else profile = buildItemProfile(item, rules, null).profile;
    profiles.push(profile);
    items.push({ ...base, classified: true, model_needed: need.needed, model_called, cache, decided_by: profile.decided_by, rules_fired: profile.rules_fired, profile });
  }
  return {
    rows: exemplars.length,
    classified: profiles.length,
    axes: aggregateExemplarAxes(profiles),
    rcdc: [...rcdcCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c),
    items,
    model_calls,
  };
}

// ---------------------------------------------------------------------------
// 4 · Blend (taxonomy.opportunity_profile.exemplar_blend)
// ---------------------------------------------------------------------------

export type BlendWeights = { n: number; exemplar: number; text: number; rule: { min_exemplars: number; exemplar_weight: number } };

/** The blend row for n exemplars: the highest `min_exemplars` at or below n. Read from the JSON. */
export function blendWeights(n: number): BlendWeights {
  const rows = [...exemplarBlend()].sort((a, b) => b.min_exemplars - a.min_exemplars);
  const rule = rows.find((r) => n >= r.min_exemplars) ?? rows[rows.length - 1]!;
  return { n, exemplar: rule.exemplar_weight, text: round3(1 - rule.exemplar_weight), rule };
}

export type BlendResult = {
  weights: BlendWeights;
  paradigm_required: ParadigmWeights;
  objective: ObjectiveWeights;
  unit_allowed: UnitLevel[];
  design_allowed: DesignId[];
  materials_expected: MaterialsKind[];
  /** Categories the exemplars carry that the text excludes / prohibits (never re-added). */
  log: string[];
};

function blendMap(text: Record<string, number>, ex: Record<string, number>, w: BlendWeights): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of new Set([...Object.keys(text), ...Object.keys(ex)])) {
    const v = round3(w.text * (text[id] ?? 0) + w.exemplar * (ex[id] ?? 0));
    if (v > 0) out[id] = v;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

/**
 * Pure. Text only when w_e = 0; otherwise paradigm `required` and `objective`
 * are w_t · text + w_e · exemplar, and a list axis gains an exemplar category
 * when w_e · share ≥ w_t.
 */
export function blend(text: MergeResult, exemplar: ExemplarPrior | null, n: number): BlendResult {
  const weights = blendWeights(n);
  const log: string[] = [];
  const base: BlendResult = {
    weights,
    paradigm_required: text.paradigm.required,
    objective: text.objective,
    unit_allowed: [...text.unit.allowed],
    design_allowed: [...text.design.allowed],
    materials_expected: [...text.materials.expected],
    log,
  };
  if (!exemplar || weights.exemplar <= 0 || exemplar.classified === 0) return base;

  const exParadigm = { ...exemplar.axes.paradigm };
  for (const c of Object.keys(exParadigm)) {
    if ((text.paradigm.excluded as Record<string, number>)[c] !== undefined) {
      log.push(`exemplars carry ${c} ${exParadigm[c]} but the text excludes it; not blended`);
      delete exParadigm[c];
    }
  }
  const paradigm_required = blendMap(text.paradigm.required as Record<string, number>, exParadigm, weights) as ParadigmWeights;
  const objective = blendMap(text.objective as Record<string, number>, exemplar.axes.objective, weights) as ObjectiveWeights;

  const listGain = (ex: Record<string, number>, present: string[], blocked: string[], path: string): string[] => {
    const added: string[] = [];
    for (const [id, share] of Object.entries(ex)) {
      if (present.includes(id) || weights.exemplar * share < weights.text - 1e-9) continue;
      if (blocked.includes(id)) {
        log.push(`exemplars carry ${path} ${id} ${share} but the text prohibits or requires it; not added`);
        continue;
      }
      added.push(id);
    }
    return added;
  };
  const unitGain = listGain(exemplar.axes.unit, text.unit.allowed, [...text.unit.required, ...text.unit.required_any], "unit");
  const designGain = listGain(exemplar.axes.design, text.design.allowed, [...text.design.prohibited, ...text.design.required_any, ...text.design.required_any_2], "design");
  const materialsGain = listGain(exemplar.axes.materials, text.materials.expected, [...text.materials.required, ...text.materials.required_any], "materials");
  for (const id of unitGain) log.push(`unit.allowed += ${id} (exemplar share ${exemplar.axes.unit[id]})`);
  for (const id of designGain) log.push(`design.allowed += ${id} (exemplar share ${exemplar.axes.design[id]})`);
  for (const id of materialsGain) log.push(`materials.expected += ${id} (exemplar share ${exemplar.axes.materials[id]})`);

  return {
    weights,
    paradigm_required,
    objective,
    unit_allowed: [...text.unit.allowed, ...(unitGain as UnitLevel[])],
    design_allowed: [...text.design.allowed, ...(designGain as DesignId[])],
    materials_expected: [...text.materials.expected, ...(materialsGain as MaterialsKind[])],
    log,
  };
}

// ---------------------------------------------------------------------------
// 5 · Assemble
// ---------------------------------------------------------------------------

export type TextSource = "full_text" | "synopsis" | "none";

/** `opportunity_fit_profiles.sources`. */
export type ProfileSources = {
  text: TextSource;
  guide_source: string | null;
  sections: number;
  chars: number;
  exemplar_count: number;
  exemplars_classified: number;
  exemplar_model_calls: number;
  blend: { exemplar: number; text: number };
  extract_model: string | null;
  groups: Array<{ group: number; chunk: number; of: number; chars: number; cache: string; model_called: boolean; skipped: string | null; usable: boolean | null; dropped: string[] }>;
  overlays_applied: string[];
  overlay_notes: string[];
  overrides_applied: string[];
  merge_log: string[];
  blend_log: string[];
};

/** One row of `opportunity_fit_profiles`. */
export type OpportunityFitProfileRow = {
  opportunity_id: string;
  taxonomy_version: string;
  profile: OpportunityFitProfile;
  confidence: Confidence;
  sources: ProfileSources;
  guide_html_hash: string | null;
  computed_at: string;
};

/** The IC the notice is issued by: the RFA's IC code (`RFA-DK-…` → DK), else the single Simpler IC token, else null. */
export function issuingIc(notice: Pick<NoticeRecord, "opportunity_number" | "nih_ic_tokens">): string | null {
  const rfa = /^RFA-([A-Z]{2})-/i.exec(notice.opportunity_number ?? "");
  if (rfa) return rfa[1]!.toUpperCase();
  const tokens = (notice.nih_ic_tokens ?? []).filter((t) => typeof t === "string" && t.trim());
  return tokens.length === 1 ? tokens[0]!.trim() : null;
}

/** A label for the prompt's `activity_title` from the app's mechanism taxonomy ("research project · individual"). */
export function activityTitle(code: string | null): string | null {
  const entry = lookupMechanismTaxonomy(code);
  return entry ? `${entry.family.replace(/_/g, " ")} · ${entry.scale.replace(/_/g, " ")}` : null;
}

export function noticeHeader(notice: NoticeRecord, overlays: Overlays): NoticeHeader {
  return {
    number: notice.opportunity_number,
    title: notice.title,
    agency: notice.agency ?? notice.agency_code,
    activity_code: overlays.activity_code,
    activity_title: activityTitle(overlays.activity_code),
    clinical_trial_designation: notice.clinical_trial_designation,
    issuing_ic: issuingIc(notice),
    program_division: notice.program_division,
  };
}

/** The sections the extractor reads and where they came from: Guide sections, else the synopsis, else nothing. */
export function noticeText(notice: NoticeRecord): { sections: NoticeSection[]; source: TextSource } {
  const sections = Array.isArray(notice.guide_sections) ? notice.guide_sections.filter((s) => s && typeof s.text === "string" && s.text.trim()) : [];
  if (sections.length) return { sections, source: "full_text" };
  const synopsis = synopsisSections(notice.description);
  return { sections: synopsis, source: synopsis.length ? "synopsis" : "none" };
}

/** Full text → as returned (low when nothing usable came back); synopsis → at most medium; no text → low. */
export function profileConfidence(textConfidence: Confidence | null, source: TextSource): Confidence {
  if (source === "none") return "low";
  const c = textConfidence ?? "low";
  return source === "synopsis" ? minConfidence(c, "medium") : c;
}

export type ProfileBuildInput = { notice: NoticeRecord; exemplars: ExemplarRecord[] };

export type OpportunityProfileDeps = {
  rules: RulesFn;
  /** The extractor model; `null` → no text extraction (overlays + exemplars only); absent → `openaiExtractor()`. */
  extractor?: ModelFn | null;
  extractModel?: string;
  /** The exemplar item classifier; `null` → rules only; absent → `openaiModel()`. */
  classifier?: ModelFn | null;
  classifyModel?: string;
  extractionCache?: NoticeExtractionCache;
  itemCache?: ItemProfileCache;
  /** Shared by the extractor and the classifier; absent → unlimited. */
  budget?: ModelBudget;
  now?: () => Date;
};

export type ProfileBuild = {
  profile: OpportunityFitProfile;
  row: OpportunityFitProfileRow;
  overlays: Overlays;
  text: { sections: NoticeSection[]; source: TextSource };
  runs: GroupRun[];
  merged: MergeResult;
  exemplar: ExemplarPrior;
  blend: BlendResult;
};

/** Build one profile from loaded rows. No Supabase; models and caches only through `deps`. */
export async function buildOpportunityFitProfileFrom(input: ProfileBuildInput, deps: OpportunityProfileDeps): Promise<ProfileBuild> {
  const { notice, exemplars } = input;
  const now = deps.now ?? (() => new Date());
  const overlays = deterministicOverlays(notice);
  const text = noticeText(notice);
  const extractor = deps.extractor === undefined ? openaiExtractor() : deps.extractor;
  const runs =
    extractor && text.sections.length
      ? await extractWithModel(text.sections, noticeHeader(notice, overlays), overlays.priors, {
          model: extractor,
          modelName: deps.extractModel,
          cache: deps.extractionCache,
          budget: deps.budget,
          opportunityId: notice.id,
          now,
        })
      : [];
  const extractions = runs.map((r) => r.extraction).filter((e): e is GroupExtraction => e !== null);
  const merged = mergeExtractions(overlays, extractions);
  const classifier = deps.classifier === undefined ? openaiModel() : deps.classifier;
  const exemplar = await exemplarPrior(exemplars, { rules: deps.rules, model: classifier ?? undefined, modelName: deps.classifyModel, cache: deps.itemCache, budget: deps.budget, now });
  const blended = blend(merged, exemplar, exemplar.classified);
  const confidence = profileConfidence(merged.confidence, text.source);
  const designation = notice.clinical_trial_designation;
  const purpose = text.sections.find((s) => /Funding Opportunity Purpose/i.test(s.heading) || s.section === "synopsis");

  const profile: OpportunityFitProfile = {
    opportunity_id: notice.id,
    number: notice.opportunity_number ?? "",
    taxonomy_version: TAXONOMY_VERSION,
    computed_at: now().toISOString(),
    confidence,
    mechanism: {
      activity_code: overlays.activity_code,
      clinical_trial: designation && isClinicalTrialDesignationId(designation) ? designation : "unknown",
      besh: designation === "besh_required",
      ceiling_direct_per_year: merged.mechanism_text.ceiling_direct_per_year,
      period_years: merged.mechanism_text.period_years,
      issuing_ic: issuingIc(notice),
      program_division: notice.program_division,
    },
    paradigm: {
      required: blended.paradigm_required,
      required_any: merged.paradigm.required_any,
      allowed: Object.fromEntries(Object.entries(merged.paradigm.allowed).filter(([c]) => !(c in blended.paradigm_required) && !(c in merged.paradigm.required_any))) as ParadigmWeights,
      excluded: merged.paradigm.excluded,
    },
    unit: { required: merged.unit.required, required_any: merged.unit.required_any, allowed: blended.unit_allowed },
    design: { required_any: merged.design.required_any, required_any_2: merged.design.required_any_2, allowed: blended.design_allowed, prohibited: merged.design.prohibited },
    materials: { expected: blended.materials_expected, required: merged.materials.required, required_any: merged.materials.required_any, human_required: merged.materials.human_required },
    population: merged.population,
    objective: blended.objective,
    topic: { mesh: [], rcdc: exemplar.rcdc, terms: merged.topic_terms, free_text: purpose?.text ?? null },
    eligibility: merged.eligibility,
    team: merged.team,
    non_responsive: merged.non_responsive,
    provenance: merged.provenance,
    sources: { text: text.source, exemplar_count: exemplar.rows },
    needs_review: merged.needs_review,
  };
  const sources: ProfileSources = {
    text: text.source,
    guide_source: notice.guide_source,
    sections: text.sections.length,
    chars: text.sections.reduce((a, s) => a + s.text.length, 0),
    exemplar_count: exemplar.rows,
    exemplars_classified: exemplar.classified,
    exemplar_model_calls: exemplar.model_calls,
    blend: { exemplar: blended.weights.exemplar, text: blended.weights.text },
    extract_model: extractor ? (deps.extractModel ?? extractModelName()) : null,
    groups: runs.map((r) => ({ group: r.group, chunk: r.chunk, of: r.of, chars: r.chars, cache: r.cache, model_called: r.model_called, skipped: r.skipped, usable: r.extraction?.usable ?? null, dropped: r.extraction?.dropped ?? [] })),
    overlays_applied: overlays.applied,
    overlay_notes: overlays.notes,
    overrides_applied: merged.overrides_applied,
    merge_log: merged.log,
    blend_log: blended.log,
  };
  const row: OpportunityFitProfileRow = {
    opportunity_id: notice.id,
    taxonomy_version: TAXONOMY_VERSION,
    profile,
    confidence,
    sources,
    guide_html_hash: text.source === "full_text" ? notice.guide_html_hash : null,
    computed_at: profile.computed_at,
  };
  return { profile, row, overlays, text, runs, merged, exemplar, blend: blended };
}

// ---------------------------------------------------------------------------
// 6 · Store and build
// ---------------------------------------------------------------------------

export type ExistingProfile = { opportunity_id: string; taxonomy_version: string; guide_html_hash: string | null; computed_at: string };
export type CandidateNotice = Pick<NoticeRecord, "id" | "opportunity_number" | "guide_html_hash" | "posted_date">;

export type OpportunityProfileStore = {
  loadNotice(id: string): Promise<NoticeRecord | null>;
  loadExemplars(opportunityNumber: string): Promise<ExemplarRecord[]>;
  /** Open NIH-like notices with Guide sections and a page hash, newest posted first. */
  loadCandidates(now: Date): Promise<CandidateNotice[]>;
  loadExistingProfiles(ids: string[]): Promise<Map<string, ExistingProfile>>;
  upsertProfile(row: OpportunityFitProfileRow): Promise<void>;
};

const PAGE = 500;

export function supabaseOpportunityProfileStore(db: SupabaseClient): OpportunityProfileStore {
  return {
    async loadNotice(id) {
      const { data, error } = await db.from("funding_opportunities").select(NOTICE_COLUMNS).eq("id", id).maybeSingle();
      if (error) throw new Error(`funding_opportunities read failed: ${error.message}`);
      return (data as NoticeRecord | null) ?? null;
    },
    async loadExemplars(opportunityNumber) {
      const { data, error } = await db.from("opportunity_exemplars").select(EXEMPLAR_COLUMNS).eq("opportunity_number", opportunityNumber).order("fiscal_year", { ascending: false }).order("project_num");
      if (error) throw new Error(`opportunity_exemplars read failed: ${error.message}`);
      return (data ?? []) as ExemplarRecord[];
    },
    async loadCandidates(now) {
      const today = now.toISOString().slice(0, 10);
      const rows: CandidateNotice[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await db
          .from("funding_opportunities")
          .select("id, opportunity_number, guide_html_hash, posted_date")
          .or(openNoticeFilter(today))
          .or(NIH_NOTICE_FILTER)
          .not("guide_sections", "is", null)
          .not("guide_html_hash", "is", null)
          .order("posted_date", { ascending: false, nullsFirst: false })
          .order("id")
          .range(from, from + PAGE - 1);
        if (error) throw new Error(`funding_opportunities read failed: ${error.message}`);
        rows.push(...((data ?? []) as CandidateNotice[]));
        if (!data || data.length < PAGE) break;
      }
      return rows;
    },
    async loadExistingProfiles(ids) {
      const out = new Map<string, ExistingProfile>();
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await db.from("opportunity_fit_profiles").select("opportunity_id, taxonomy_version, guide_html_hash, computed_at").in("opportunity_id", ids.slice(i, i + 200));
        if (error) throw new Error(`opportunity_fit_profiles read failed: ${error.message}`);
        for (const r of (data ?? []) as ExistingProfile[]) out.set(r.opportunity_id, r);
      }
      return out;
    },
    async upsertProfile(row) {
      const { error } = await db.from("opportunity_fit_profiles").upsert(row, { onConflict: "opportunity_id" });
      if (error) throw new Error(`opportunity_fit_profiles write failed: ${error.message}`);
    },
  };
}

export type BuildOptions = OpportunityProfileDeps & {
  store?: OpportunityProfileStore;
  /** Build and return; write nothing. */
  dryRun?: boolean;
};

/** Load the notice and its exemplars, build, upsert (unless `dryRun`). Caches default to the Supabase tables. */
export async function buildOpportunityFitProfile(db: SupabaseClient, id: string, deps: BuildOptions): Promise<ProfileBuild> {
  const store = deps.store ?? supabaseOpportunityProfileStore(db);
  const notice = await store.loadNotice(id);
  if (!notice) throw new Error(`funding_opportunities ${id} not found`);
  const exemplars = notice.opportunity_number ? await store.loadExemplars(notice.opportunity_number) : [];
  const build = await buildOpportunityFitProfileFrom(
    { notice, exemplars },
    {
      ...deps,
      extractionCache: deps.extractionCache ?? (deps.dryRun ? undefined : supabaseNoticeExtractionCache(db)),
      itemCache: deps.itemCache ?? (deps.dryRun ? undefined : supabaseItemProfileCache(db)),
    }
  );
  if (!deps.dryRun) await store.upsertProfile(build.row);
  return build;
}

// ---------------------------------------------------------------------------
// 7 · The nightly runner (called by the fit-profiles cron, PR 1.4)
// ---------------------------------------------------------------------------

export const OPPORTUNITY_PROFILES_LIMIT = 40;
export const OPPORTUNITY_PROFILES_TIME_BUDGET_MS = 240_000;
export const OPPORTUNITY_PROFILES_MODEL_BUDGET = 150;

/** Pure. A notice is due when it has no profile, its Guide page changed (`guide_html_hash`), or the taxonomy moved on; `onlyChanged: false` makes every candidate due. */
export function profileDue(notice: CandidateNotice, existing: ExistingProfile | undefined, opts: { onlyChanged: boolean; taxonomyVersion?: string }): { due: boolean; reason: string } {
  if (!existing) return { due: true, reason: "no profile" };
  if (!opts.onlyChanged) return { due: true, reason: "rebuild requested" };
  const version = opts.taxonomyVersion ?? TAXONOMY_VERSION;
  if (existing.taxonomy_version !== version) return { due: true, reason: `taxonomy ${existing.taxonomy_version} → ${version}` };
  if (existing.guide_html_hash !== notice.guide_html_hash) return { due: true, reason: "guide_html_hash changed" };
  return { due: false, reason: "up to date" };
}

/** Pure. The due candidates, never-profiled first (newest posted first within each group), capped at `limit`. */
export function selectDue(candidates: CandidateNotice[], existing: Map<string, ExistingProfile>, opts: { onlyChanged: boolean; limit: number; taxonomyVersion?: string }): Array<CandidateNotice & { reason: string }> {
  const due = candidates.map((c) => ({ ...c, ...profileDue(c, existing.get(c.id), opts) })).filter((c) => c.due);
  const rank = (c: { reason: string }) => (c.reason === "no profile" ? 0 : 1);
  return due
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .slice(0, opts.limit)
    .map(({ c }) => ({ id: c.id, opportunity_number: c.opportunity_number, guide_html_hash: c.guide_html_hash, posted_date: c.posted_date, reason: c.reason }));
}

export type RunOpportunityProfilesParams = {
  limit?: number;
  timeBudgetMs?: number;
  /** Model calls (extractor + exemplar classifier) for the whole run. */
  modelBudget?: number;
  /** Default true: only notices with no profile or a new / changed `guide_html_hash` (or taxonomy). */
  onlyChanged?: boolean;
  dryRun?: boolean;
  now?: Date;
  log?: (line: string) => void;
};

export type OpportunityProfilesRunSummary = {
  candidates: number;
  due: number;
  attempted: number;
  built: number;
  /** Notices left for the next run: time budget reached before they were started. */
  deferred: number;
  errors: Array<{ opportunity_id: string; number: string | null; error: string }>;
  model_calls: number;
  model_budget: number;
  elapsed_ms: number;
  dry_run: boolean;
  lines: string[];
};

/**
 * Open NIH notices with Guide sections whose profile is missing or stale →
 * build → upsert, within the limits. Every model call of the run — the
 * extractor's and the exemplar classifier's — comes out of `modelBudget`.
 */
export async function runOpportunityProfiles(db: SupabaseClient, params: RunOpportunityProfilesParams, deps: BuildOptions): Promise<OpportunityProfilesRunSummary> {
  const started = Date.now();
  const now = params.now ?? new Date();
  const limit = params.limit ?? OPPORTUNITY_PROFILES_LIMIT;
  const timeBudget = params.timeBudgetMs ?? OPPORTUNITY_PROFILES_TIME_BUDGET_MS;
  const budget = deps.budget ?? new ModelBudget(params.modelBudget ?? OPPORTUNITY_PROFILES_MODEL_BUDGET);
  const lines: string[] = [];
  const log = (line: string) => {
    lines.push(line);
    params.log?.(line);
  };
  const store = deps.store ?? supabaseOpportunityProfileStore(db);
  const candidates = await store.loadCandidates(now);
  const existing = await store.loadExistingProfiles(candidates.map((c) => c.id));
  const due = selectDue(candidates, existing, { onlyChanged: params.onlyChanged ?? true, limit: Number.MAX_SAFE_INTEGER });
  const batch = due.slice(0, limit);
  log(`fit-profiles · opportunities: ${candidates.length} candidates, ${due.length} due, ${batch.length} this run (limit ${limit}, model budget ${budget.limit}, ${params.dryRun ? "dry run" : "writing"})`);

  const summary: OpportunityProfilesRunSummary = { candidates: candidates.length, due: due.length, attempted: 0, built: 0, deferred: 0, errors: [], model_calls: 0, model_budget: budget.limit, elapsed_ms: 0, dry_run: Boolean(params.dryRun), lines };
  for (const c of batch) {
    if (Date.now() - started > timeBudget) {
      summary.deferred += 1;
      continue;
    }
    summary.attempted += 1;
    try {
      const build = await buildOpportunityFitProfile(db, c.id, { ...deps, store, budget, dryRun: params.dryRun, now: () => now });
      summary.built += 1;
      const p = build.profile;
      const req = Object.entries(p.paradigm.required)
        .slice(0, 3)
        .map(([k, v]) => `${k} ${v}`)
        .join(", ");
      log(`${c.opportunity_number ?? c.id}: ${c.reason}; ${build.text.source}; groups ${build.runs.map((r) => `${r.group}${r.of > 1 ? `/${r.chunk}` : ""}:${r.cache}${r.skipped ? "(skipped)" : ""}`).join(" ")}; exemplars ${build.exemplar.classified}/${build.exemplar.rows} (w_e ${build.blend.weights.exemplar}); confidence ${p.confidence}${p.needs_review ? "; needs_review" : ""}; required ${req || "(none)"}`);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      summary.errors.push({ opportunity_id: c.id, number: c.opportunity_number, error });
      log(`${c.opportunity_number ?? c.id}: ERROR ${error}`);
    }
  }
  summary.model_calls = budget.used;
  summary.elapsed_ms = Date.now() - started;
  log(`done: built ${summary.built}/${summary.attempted}, deferred ${summary.deferred}, errors ${summary.errors.length}, model calls ${summary.model_calls}/${budget.limit}, ${summary.elapsed_ms} ms`);
  return summary;
}
