/**
 * Investigator fit profile (plan § PR 1.4; spec §5). Three layers:
 *
 *   collectItems(db, id)            rows → NormalizedItem[] with PR 1.2's normalizers
 *   aggregate(items, now)           pure, in ./aggregate.ts (re-exported here)
 *   buildInvestigatorFitProfile     collect → classifyItem per item (cache first;
 *                                   the model only where PR 1.3 says it is needed
 *                                   and the run's model budget allows) → aggregate
 *                                   → upsert investigator_fit_profiles
 *
 * Evidence gates: publications `identity_status = 'verified'`; grants
 * `identity_status <> 'rejected'`; trials `identity_status = 'verified'`; the
 * biosketch and Profiles source rows; the self-declared record; the directory
 * row as its own item (spec §5 "Directory metadata", reliability 0.3 — the
 * `department` / `division` signals move off the Profiles item so the
 * department prior fires once, at its own reliability).
 *
 * The model budget: `deps.modelBudget` is the number of model calls this build
 * may make (default 0 — rules and the item cache only, what the request path
 * and the dry run use). A `ModelBudget` object can be shared across builds so
 * a cron run bounds its calls as a whole; `deps.deadline` (epoch ms) stops
 * new model calls once a run's time is up; `deps.modelConcurrency` calls are
 * in flight at once (default 1; the cron passes 4). Items the model was
 * needed for but could not be called on — no budget, past the deadline, or a
 * reply that could not be read — are `model_skipped`: their rule-free axes
 * stay empty and the build is partial. A partial build IS written (D20): the
 * row carries `pending_items` = skipped items + rows that failed to normalize,
 * so the profile exists from the first pass, the nightly keeps it due until
 * it converges, and the item cache keeps every usable classification.
 *
 * Aspirations (D5): each free-text direction is classified to paradigm
 * categories — by the same item classifier when its text is long enough and
 * the budget allows (top category of the reply), and always by the label
 * matcher `aspirationCategoriesByLabel` — and stored as `profile.aspirations`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildItemProfile, classifyItem, itemCacheKey, modelNeeded, supabaseItemProfileCache, type ClassifiedItem, type ItemProfileCache, type ModelFn, type NormalizedItem, type NormalizedItemKind } from "@/lib/fit/classify";
import type { CachedItemProfile } from "@/lib/fit/classify/cache";
import type { MeshIndex } from "@/lib/fit/classify/mesh";
import { loadMeshIndex } from "@/lib/fit/classify/mesh-db";
import {
  normalizeBiosketch,
  normalizeDirectory,
  normalizeGrant,
  normalizeProfiles,
  normalizePublication,
  normalizeSelfDeclared,
  normalizeTrial,
  type BiosketchSourceRow,
  type GrantRow,
  type InvestigatorRow,
  type ProfilesSourceRow,
  type PublicationRow,
  type TrialRow,
} from "@/lib/fit/classify/normalize";
import { DEFAULT_RULE_TABLES, evaluateRules, type EvaluateContext, type RuleTables } from "@/lib/fit/classify/rules";
import { aggregateWithDiagnostics, dominantParadigm, type AggregateContext, type AggregateDiagnostics } from "@/lib/fit/profile/aggregate";
import { ModelBudget } from "@/lib/fit/profile/model-budget";
import { readSelfDeclaredAxes } from "@/lib/fit/self-declared";
import { categoriesOf, categoryLabel, familyLabel, isParadigmFamily, PARADIGM_CATEGORY_IDS, PARADIGM_FAMILY_IDS, r01EquivalentCodes } from "@/lib/fit/taxonomy";
import type { AxisConfidence, Collaborator, InvestigatorCharacteristics, InvestigatorFitProfile, ItemProfile, ParadigmCategory, ParadigmFamily } from "@/lib/fit/types";
import type { SourceState } from "@/lib/investigators/sources";
import { runWorkerPool } from "@/lib/utils/async-rate-limiter";

export {
  aggregate,
  aggregateWithDiagnostics,
  confidenceAtLeast,
  confidenceFrom,
  confidenceRank,
  CONFIDENCE_ORDER,
  CURRENT_STATE_KINDS,
  distinctOrigins,
  dominantParadigm,
  itemAge,
  itemWeight,
  recencyWeight,
  roleFactor,
  ROLE_BEARING_KINDS,
  toItemProfiles,
  type AggregateContext,
  type AggregateDiagnostics,
  type AggregateInput,
  type AggregateResult,
  type AxisDiagnostics,
  type AxisView,
  type CategoryDetail,
  type DominantParadigm,
  type ItemWeight,
} from "@/lib/fit/profile/aggregate";

export const INVESTIGATOR_PROFILES_MIGRATION = "supabase/migrations/20260915100000_fit_investigator_profiles.sql";

// ---------------------------------------------------------------------------
// Row selects (the columns the normalizers read)
// ---------------------------------------------------------------------------

export const INVESTIGATOR_COLUMNS = "id, full_name, home_department, division, rank, title_series, degrees, self_declared_axes, aspirations, do_not_suggest, raw_profile_json, archived_at, updated_at";
export const PUBLICATION_COLUMNS = "investigator_id, pmid, title, publication_date, mesh, publication_types, abstract, author_position, author_position_method, identity_method, identity_status, mesh_fetch_outcome";
export const GRANT_COLUMNS = "id, investigator_id, project_num, project_title, fiscal_year, activity_code, rcdc_categories, study_section, study_section_code, is_contact_pi, abstract, phr_text, identity_status, is_active, raw_json";
export const TRIAL_COLUMNS = "investigator_id, nct_id, title, start_date, brief_summary, study_type, phases, primary_purpose, allocation, intervention_model, observational_model, time_perspective, enrollment, intervention_types, investigator_role, identity_status";
export const SOURCE_COLUMNS = "investigator_id, source, state, last_refreshed_at, document_date, personal_statement, contributions, meta";

const PAGE = 1000;

export type RosterRow = InvestigatorRow & { full_name?: string | null; archived_at?: string | null; updated_at?: string | null };

export type GrantEvidenceRow = GrantRow & { is_active?: boolean | null };

export type SourceRow = {
  investigator_id: string;
  source: string;
  state?: SourceState | null;
  last_refreshed_at?: string | null;
  document_date?: string | null;
  personal_statement?: string | null;
  contributions?: unknown;
  meta?: unknown;
};

type Query = ReturnType<ReturnType<SupabaseClient["from"]>["select"]>;

async function pageAll<T>(db: SupabaseClient, table: string, columns: string, build: (q: Query) => Query, order: string[]): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = build(db.from(table).select(columns));
    for (const col of order) q = q.order(col);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} read failed: ${error.message}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// collectItems
// ---------------------------------------------------------------------------

export type NormalizeFailure = { id: string; kind: NormalizedItemKind; error: string };

export type CollectedEvidence = {
  investigator: RosterRow;
  /** The evidence items, in a stable order: publications, grants, trials, biosketch, Profiles, self-declared, directory. */
  items: NormalizedItem[];
  /** One item per aspiration (kind `self_declared`, id `aspiration:<investigator>:<n>`) — classified apart, never aggregated. */
  aspirationItems: NormalizedItem[];
  rows: { publications: PublicationRow[]; grants: GrantEvidenceRow[]; trials: TrialRow[]; biosketch: SourceRow | null; profiles: SourceRow | null };
  /** Rows that did not normalize (an unknown MeSH UI, a corrupt heading) — listed, never swallowed; a build with failures is incomplete. */
  failures: NormalizeFailure[];
};

export type CollectDeps = { mesh?: MeshIndex };

/** The evidence rows for one investigator, normalized. Read-only. */
export async function collectEvidence(db: SupabaseClient, investigatorId: string, deps: CollectDeps = {}): Promise<CollectedEvidence> {
  const mesh = deps.mesh ?? (await loadMeshIndex(db));
  const { data: inv, error } = await db.from("investigators").select(INVESTIGATOR_COLUMNS).eq("id", investigatorId).maybeSingle();
  if (error) throw new Error(`investigators read failed: ${error.message}`);
  if (!inv) throw new Error(`investigator ${investigatorId} not found`);
  const investigator = inv as unknown as RosterRow;

  const [publications, grants, trials, sources] = await Promise.all([
    pageAll<PublicationRow>(db, "investigator_publications", PUBLICATION_COLUMNS, (q) => q.eq("investigator_id", investigatorId).eq("identity_status", "verified"), ["pmid"]),
    pageAll<GrantEvidenceRow>(db, "investigator_nih_grants", GRANT_COLUMNS, (q) => q.eq("investigator_id", investigatorId).neq("identity_status", "rejected"), ["fiscal_year", "id"]),
    pageAll<TrialRow>(db, "investigator_clinical_trials", TRIAL_COLUMNS, (q) => q.eq("investigator_id", investigatorId).eq("identity_status", "verified"), ["nct_id"]),
    pageAll<SourceRow>(db, "investigator_sources", SOURCE_COLUMNS, (q) => q.eq("investigator_id", investigatorId).in("source", ["biosketch", "profiles"]), ["source"]),
  ]);
  const biosketch = sources.find((s) => s.source === "biosketch") ?? null;
  const profiles = sources.find((s) => s.source === "profiles") ?? null;

  const items: NormalizedItem[] = [];
  const failures: NormalizeFailure[] = [];
  const attempt = (id: string, kind: NormalizedItemKind, build: () => NormalizedItem | NormalizedItem[]) => {
    try {
      const built = build();
      items.push(...(Array.isArray(built) ? built : [built]));
    } catch (e) {
      failures.push({ id, kind, error: e instanceof Error ? e.message : String(e) });
    }
  };
  for (const row of publications) attempt(`publication:${investigatorId}:${row.pmid}`, "publication", () => normalizePublication(row, { id: investigatorId }, { mesh }));
  for (const row of grants) attempt(`grant:${row.id}`, "grant", () => normalizeGrant(row));
  for (const row of trials) attempt(`trial:${investigatorId}:${row.nct_id}`, "trial", () => normalizeTrial(row));
  if (biosketch) attempt(`biosketch:${investigatorId}`, "biosketch_statement", () => normalizeBiosketch(biosketch as BiosketchSourceRow));
  attempt(`profiles:${investigatorId}`, "profiles_narrative", () => splitDirectorySignals(normalizeProfiles(profiles as ProfilesSourceRow | null, investigator)));
  attempt(`self_declared:${investigatorId}`, "self_declared", () => normalizeSelfDeclared(investigator));
  attempt(`directory:${investigatorId}`, "directory", () => normalizeDirectory(investigator));

  const aspirationItems = aspirationItemsOf(investigator);
  return { investigator, items, aspirationItems, rows: { publications, grants, trials, biosketch, profiles }, failures };
}

/**
 * The Profiles item without the `department` / `division` signals: the
 * directory item carries them (spec §5, reliability 0.3), so the
 * `department_match` prior fires once. Pure.
 */
export function splitDirectorySignals(profilesItem: NormalizedItem): NormalizedItem {
  const signals = { ...profilesItem.signals };
  delete signals.department;
  delete signals.division;
  return { ...profilesItem, signals };
}

/** One self-declared-kind item per aspiration line; the text is the direction itself. Pure. */
export function aspirationItemsOf(investigator: Pick<InvestigatorRow, "id" | "aspirations">): NormalizedItem[] {
  const list = Array.isArray(investigator.aspirations) ? investigator.aspirations.filter((a): a is string => typeof a === "string" && a.trim() !== "") : [];
  return list.map((text, i) => ({
    id: `aspiration:${investigator.id}:${i + 1}`,
    kind: "self_declared",
    title: null,
    text: text.trim(),
    year: null,
    role: null,
    mesh: [],
    publication_types: [],
    signals: { source: "self_declared_current", aspiration: true, text_truncated: false, text_chars: text.trim().length },
  }));
}

/** The plan's signature: the normalized evidence items for one investigator. */
export async function collectItems(db: SupabaseClient, investigatorId: string, deps: CollectDeps = {}): Promise<NormalizedItem[]> {
  const { items, failures } = await collectEvidence(db, investigatorId, deps);
  if (failures.length) throw new Error(`${failures.length} row(s) failed to normalize: ${failures.map((f) => `${f.id} — ${f.error}`).join("; ")}`);
  return items;
}

// ---------------------------------------------------------------------------
// Characteristics (spec §5 "Investigator characteristics") — pure
// ---------------------------------------------------------------------------

/** `career_stage` vocabulary from the rank string. */
export type CareerStage = "trainee" | "early" | "mid" | "senior";

export function careerStageOf(rank: string | null | undefined): CareerStage | null {
  const r = String(rank ?? "").toLowerCase();
  if (!r.trim()) return null;
  if (/\bassistant\b/.test(r)) return "early";
  if (/\bassociate\b/.test(r)) return "mid";
  if (/\bprofessor\b|\bchief\b|\bchair\b|\bdirector\b|\bdean\b/.test(r)) return "senior";
  if (/\bpostdoc|\bfellow\b|\bresident\b|\binstructor\b|\bstudent\b|\bscholar\b|\btrainee\b/.test(r)) return "trainee";
  return null;
}

/** `clinical_role` vocabulary: degrees × clinical title series × trial-PI evidence (spec §5 "sees patients vs studies patients"). */
export type ClinicalRole = "md_clinician_investigator" | "md_investigator" | "phd_investigator" | "other";

const MD_DEGREE = /^(md|do|mbbs|mbchb|mbbch|dmd|dds|pharmd|dvm)$/;
const DOCTORAL_DEGREE = /^(phd|scd|drph|dphil|dsc|edd)$/;

const degreeToken = (d: string) => d.toLowerCase().replace(/[^a-z]/g, "");

export function clinicalRoleOf(input: { degrees: string[]; title_series: string | null; trial_pi_count: number }): ClinicalRole | null {
  const tokens = input.degrees.map(degreeToken).filter(Boolean);
  if (!tokens.length) return null;
  const md = tokens.some((t) => MD_DEGREE.test(t));
  const clinicalSeries = /clinical/i.test(input.title_series ?? "");
  if (md) return clinicalSeries || input.trial_pi_count > 0 ? "md_clinician_investigator" : "md_investigator";
  if (tokens.some((t) => DOCTORAL_DEGREE.test(t))) return "phd_investigator";
  return "other";
}

/** RePORTER caches every project as active; the project end date (or, failing that, the fiscal year) says whether it has ended — the directory's `grantIsActive` rule. */
export function grantActive(row: GrantEvidenceRow, now: Date): boolean {
  const raw = row.raw_json && typeof row.raw_json === "object" ? (row.raw_json as { project_end_date?: string | null }) : null;
  const end = raw?.project_end_date?.slice(0, 10) ?? null;
  if (end) return end >= now.toISOString().slice(0, 10);
  if (typeof row.fiscal_year === "number") return row.fiscal_year >= now.getUTCFullYear() - 1;
  return row.is_active !== false;
}

/** `5R01AI123456-05` → `R01AI123456` (the core project, so one award over several fiscal years counts once). */
export function coreProjectNumber(projectNum: string | null | undefined): string | null {
  const s = String(projectNum ?? "").trim().toUpperCase();
  if (!s) return null;
  return s.replace(/^\d/, "").replace(/-.*$/, "");
}

/**
 * RePORTER also serves CDC, AHRQ, FDA and VA awards, and activity codes and ESI are NIH concepts,
 * so only a literal `agency_code` of NIH establishes them. A missing or malformed value stays
 * unknown — it never grandfathers in as NIH — while the award still counts as an active award.
 */
export function isNihGrant(row: GrantEvidenceRow): boolean {
  const raw = row.raw_json && typeof row.raw_json === "object" ? (row.raw_json as { agency_code?: unknown }) : null;
  return typeof raw?.agency_code === "string" && raw.agency_code.trim().toUpperCase() === "NIH";
}

/** Whole-study PI roles. A chair or director keeps its scientific leadership weight but does not lead the study. */
const TRIAL_PI_ROLES = new Set(["PRINCIPAL_INVESTIGATOR", "RESPONSIBLE_PARTY_PI"]);

/** Pure. The characteristics block from the directory row and the non-rejected grants and verified trials. */
export function characteristicsFrom(input: { investigator: RosterRow; grants: GrantEvidenceRow[]; trials: TrialRow[]; now: Date }): InvestigatorCharacteristics {
  const { investigator, grants, trials, now } = input;
  const codes = new Set<string>();
  const activeCores = new Set<string>();
  for (const g of grants) {
    const code = (g.activity_code ?? "").trim().toUpperCase();
    if (code && isNihGrant(g)) codes.add(code);
    if (grantActive(g, now)) activeCores.add(coreProjectNumber(g.project_num) ?? g.id);
  }
  const mechanisms_held = Array.from(codes).sort();
  const trialPiNctIds = new Set(
    trials.filter((t) => TRIAL_PI_ROLES.has(String(t.investigator_role ?? "").toUpperCase())).map((t) => t.nct_id)
  );
  const trial_pi_count = trialPiNctIds.size;
  const degrees = Array.isArray(investigator.degrees) ? investigator.degrees.filter((d): d is string => typeof d === "string" && d.trim() !== "") : [];
  const title_series = investigator.title_series?.trim() || null;
  // taxonomy characteristics.r01_equivalent_codes — NIH's list of codes whose award ends ESI status.
  const r01Equivalent = r01EquivalentCodes();
  const heldR01Equivalent = mechanisms_held.some((c) => r01Equivalent.includes(c));
  return {
    career_stage: careerStageOf(investigator.rank),
    esi: heldR01Equivalent ? false : null,
    esi_eligible_until: null,
    mechanisms_held,
    active_awards: activeCores.size,
    clinical_role: clinicalRoleOf({ degrees, title_series, trial_pi_count }),
    trial_pi_count,
    degrees,
    title_series,
  };
}

// ---------------------------------------------------------------------------
// Aspirations (D5) — label matcher, pure
// ---------------------------------------------------------------------------

/**
 * Words that name a paradigm category beside its taxonomy label and id. A
 * vocabulary aid for two-word aspirations the model never sees (shorter than
 * PR 1.3's MIN_TEXT_CHARS); proposed for taxonomy.json as
 * `paradigm.categories[*].aliases` (PR report).
 */
export const ASPIRATION_ALIASES: Partial<Record<ParadigmCategory, string[]>> = {
  basic_discovery: ["basic science", "fundamental discovery", "discovery science"],
  molecular_cellular_mechanistic: ["mechanistic", "mechanism", "mechanisms"],
  preclinical: ["preclinical", "pre-clinical"],
  animal_model: ["animal models", "mouse models", "in vivo models"],
  translational: ["translational"],
  human_biospecimen: ["biospecimen", "biospecimens", "human samples", "human tissue", "patient samples"],
  early_phase_human_experimental: ["first-in-human", "phase 1", "phase i", "experimental medicine"],
  clinical_observational: ["observational", "cohort", "cohorts"],
  interventional_clinical: ["interventional"],
  clinical_trials: ["trial", "trials"],
  epidemiology: ["epidemiologic", "epidemiological"],
  genetic_epidemiology: ["gwas", "genetic epi"],
  population_health: ["population health", "population science"],
  public_health: ["public health"],
  community_based: ["community-based", "community based", "community-engaged", "community engaged"],
  behavioral: ["behavioral", "behavioural"],
  comparative_effectiveness: ["comparative effectiveness"],
  health_services: ["health services"],
  outcomes_research: ["outcomes research", "patient outcomes"],
  implementation_science: ["implementation"],
  computational_data_science: ["computational", "machine learning", "data science", "artificial intelligence"],
  bioinformatics: ["bioinformatic"],
  methods_technology_development: ["technology development", "assay development", "tool development", "methods development"],
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const phraseRe = (phrase: string) => new RegExp(`(^|[^a-z0-9])${escapeRe(phrase.toLowerCase())}(?=$|[^a-z0-9])`, "i");
const stripParenthetical = (s: string) => s.replace(/\s*\(.*?\)\s*/g, " ").trim();

/**
 * Pure. The paradigm categories a free-text direction names: a category's
 * label (parenthetical removed), its id as words, or an alias, matched as a
 * whole phrase; when none matches, a family label maps to every category of
 * the family. Order follows the taxonomy.
 */
export function aspirationCategoriesByLabel(text: string): ParadigmCategory[] {
  const t = ` ${String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim()} `;
  if (!t.trim()) return [];
  const out: ParadigmCategory[] = [];
  for (const cat of PARADIGM_CATEGORY_IDS) {
    const phrases = [stripParenthetical(categoryLabel(cat)), cat.replace(/_/g, " "), ...(ASPIRATION_ALIASES[cat] ?? [])].filter(Boolean);
    if (phrases.some((p) => phraseRe(p).test(t))) out.push(cat);
  }
  if (out.length) return out;
  for (const family of PARADIGM_FAMILY_IDS) {
    const label = stripParenthetical(familyLabel(family));
    if (label && phraseRe(label).test(t)) out.push(...categoriesOf(family));
  }
  return Array.from(new Set(out));
}

/** The top paradigm category of a classified aspiration item (ties keep every tied id). */
export function aspirationCategoriesFromProfile(profile: Pick<ItemProfile, "paradigm">): ParadigmCategory[] {
  const entries = Object.entries(profile.paradigm ?? {}).filter((e): e is [string, number] => typeof e[1] === "number" && e[1] > 0);
  if (!entries.length) return [];
  const max = Math.max(...entries.map((e) => e[1]));
  return entries.filter((e) => e[1] === max).map((e) => e[0] as ParadigmCategory);
}

// ---------------------------------------------------------------------------
// Model budget
// ---------------------------------------------------------------------------

/** A count of model calls a build (or a whole cron run, when shared) may still make — one class shared with the opportunity profile (./model-budget.ts). */
export { ModelBudget };

// ---------------------------------------------------------------------------
// Item cache prefetch — one read per build instead of one per item
// ---------------------------------------------------------------------------

/** Keys per `in (...)` read: 100 sixty-four-character hashes keep the request URL under the usual 8 KB proxy limit. */
export const PREFETCH_CHUNK = 100;

/**
 * `fit_item_profiles` rows for `keys`, read in chunks of `PREFETCH_CHUNK`,
 * served from memory; writes go through to the table and the map. Keys not
 * prefetched read as misses, so every key a build will ask for must be in
 * `keys`. Safe under in-build concurrency: the map is filled before any
 * classification starts and `set` is a single upsert.
 */
export async function prefetchedItemProfileCache(db: SupabaseClient, keys: string[], chunk = PREFETCH_CHUNK): Promise<ItemProfileCache & { rows: Map<string, CachedItemProfile> }> {
  const base = supabaseItemProfileCache(db);
  const rows = new Map<string, CachedItemProfile>();
  const wanted = Array.from(new Set(keys));
  for (let i = 0; i < wanted.length; i += chunk) {
    const slice = wanted.slice(i, i + chunk);
    const { data, error } = await db.from("fit_item_profiles").select("content_hash, kind, ref_id, taxonomy_version, rules, llm, merged, llm_model, created_at").in("content_hash", slice);
    if (error) throw new Error(`fit_item_profiles read failed: ${error.message}`);
    for (const row of (data ?? []) as CachedItemProfile[]) rows.set(row.content_hash, row);
  }
  return {
    rows,
    async get(contentHash) {
      return rows.get(contentHash) ?? null;
    },
    async set(row) {
      await base.set(row);
      rows.set(row.content_hash, row);
    },
  };
}

// ---------------------------------------------------------------------------
// Budgeted classification
// ---------------------------------------------------------------------------

export type ClassifyDepsForBuild = {
  rulesCtx: EvaluateContext;
  cache: ItemProfileCache;
  budget: ModelBudget;
  model?: ModelFn;
  modelName?: string;
  /** Epoch ms after which no new model call starts (the run's time budget); cache-served items still classify. */
  deadline?: number;
  now?: () => Date;
};

export type BudgetedClassification = {
  profile: ItemProfile;
  model_needed: boolean;
  model_called: boolean;
  /**
   * The model was needed and its output is not in the profile: nothing usable
   * was cached and the budget was out or the deadline had passed, or the call
   * was made and the reply could not be read (`llm.usable === false`, never
   * cached). Pending — a later run with budget finishes it.
   */
  model_skipped: boolean;
  /** The call was made and the reply was unusable (not JSON, cut off, every value rejected). */
  model_unusable: boolean;
  cache: ClassifiedItem["cache"];
  model_reason: string;
  /** The call was taken from the budget and threw (SDK error after its retries, a cache write failure); the item stays pending. */
  model_error?: string;
};

/**
 * PR 1.3's `classifyItem` when the budget allows a call before the deadline;
 * otherwise the same rules → cache-first → merge path with the model step
 * left out (`buildItemProfile(item, rules, cachedLlm ?? null)`), so a
 * request-path caller never constructs a model client.
 */
export async function classifyWithBudget(item: NormalizedItem, deps: ClassifyDepsForBuild): Promise<BudgetedClassification> {
  const rules = evaluateRules(item, deps.rulesCtx);
  const need = modelNeeded(item, rules);
  if (!need.needed) {
    const { profile } = buildItemProfile(item, rules, null);
    return { profile, model_needed: false, model_called: false, model_skipped: false, model_unusable: false, cache: "disabled", model_reason: need.reason };
  }
  const cached = await deps.cache.get(itemCacheKey(item));
  const usable = cached?.llm && cached.llm.usable !== false ? cached.llm : null;
  if (usable) {
    const { profile } = buildItemProfile(item, rules, usable);
    return { profile, model_needed: true, model_called: false, model_skipped: false, model_unusable: false, cache: "hit", model_reason: need.reason };
  }
  const pastDeadline = deps.deadline != null && Date.now() >= deps.deadline;
  if (pastDeadline || !deps.budget.take()) {
    const { profile } = buildItemProfile(item, rules, null);
    return { profile, model_needed: true, model_called: false, model_skipped: true, model_unusable: false, cache: "miss", model_reason: pastDeadline ? `${need.reason}; deadline passed` : need.reason };
  }
  let r: ClassifiedItem;
  try {
    r = await classifyItem(item, { rules: () => rules, model: deps.model, modelName: deps.modelName, cache: deps.cache, now: deps.now });
  } catch (e) {
    // The build goes on: the item is pending like a budget skip, the error is counted on the build, never thrown
    // (a single 429 must not lose the rules + cache work of the other items or leak the pool's workers).
    const { profile } = buildItemProfile(item, rules, null);
    const message = e instanceof Error ? e.message : String(e);
    return { profile, model_needed: true, model_called: true, model_skipped: true, model_unusable: false, cache: "miss", model_reason: `${need.reason}; model call failed`, model_error: message };
  }
  // A reply that could not be read is not in the profile and was not cached: the item stays pending.
  const unusable = r.model_called && r.llm?.usable === false;
  return { profile: r.profile, model_needed: r.model_needed, model_called: r.model_called, model_skipped: unusable, model_unusable: unusable, cache: r.cache, model_reason: r.model_reason };
}

// ---------------------------------------------------------------------------
// buildInvestigatorFitProfile
// ---------------------------------------------------------------------------

export type BuildDeps = {
  mesh?: MeshIndex;
  tables?: RuleTables;
  /** Defaults to a prefetched `fit_item_profiles` cache. Inject `InMemoryItemProfileCache` in tests. */
  cache?: ItemProfileCache;
  /** Model calls this build may make; a shared `ModelBudget` bounds a whole run. Default 0: rules and cache only. */
  modelBudget?: number | ModelBudget;
  model?: ModelFn;
  modelName?: string;
  /** Epoch ms after which no new model call starts (a cron run's time budget). */
  deadline?: number;
  /** Items classified at once — model calls in flight (default 1; the cron passes `FIT_PROFILES_MODEL_CONCURRENCY`). Results keep item order. */
  modelConcurrency?: number;
  /** Upsert `investigator_fit_profiles` (default true). A partial build is written too, with `pending_items` > 0 (D20). */
  write?: boolean;
  /** Fill `collaborators` from `investigator_relationships` and the co-authors' stored profiles (default true; two reads). */
  collaborators?: boolean;
  now?: () => Date;
  log?: (line: string) => void;
};

export type AspirationOutcome = { text: string; categories: ParadigmCategory[]; via: "model" | "cache" | "label" | "none" };

export type BuildResult = {
  investigator_id: string;
  name: string | null;
  profile: InvestigatorFitProfile;
  diagnostics: AggregateDiagnostics;
  items: BudgetedClassification[];
  item_count: number;
  model_needed: number;
  model_called: number;
  /** Items the model was needed for and is not in the profile (budget, deadline, unusable reply). */
  model_skipped: number;
  /** Calls whose reply could not be read (counted in `model_called` and `model_skipped`). */
  model_unusable: number;
  /** Calls that threw (counted in `model_called` and `model_skipped`); the messages are on the items' `model_error`. */
  model_errors: number;
  cache_hits: number;
  failures: NormalizeFailure[];
  aspirations: AspirationOutcome[];
  /** `model_skipped + failures.length` — what the stored row carries; 0 means the profile is complete. */
  pending_items: number;
  /** `pending_items > 0`: the profile is partial (written all the same). */
  incomplete: boolean;
  written: boolean;
  durationMs: number;
};

export type StoredProfileRow = {
  investigator_id: string;
  taxonomy_version: string;
  profile: InvestigatorFitProfile;
  confidence: AxisConfidence;
  item_count: number;
  /** Items the model still has to classify plus rows that failed to normalize; > 0 keeps the row due (D20). */
  pending_items: number;
  computed_at: string;
};

/** The row `investigator_fit_profiles` stores for a profile. Pure. */
export function profileRow(profile: InvestigatorFitProfile, itemCount: number, pendingItems = 0): StoredProfileRow {
  return {
    investigator_id: profile.investigator_id,
    taxonomy_version: profile.taxonomy_version,
    profile,
    confidence: profile.confidence,
    item_count: itemCount,
    pending_items: pendingItems,
    computed_at: profile.computed_at,
  };
}

/** PostgREST's message for a table the schema cache does not know (the migration not applied yet). */
export const MISSING_TABLE = /could not find the table|relation .* does not exist|schema cache/i;

/** Co-authors (investigator_relationships) whose stored profile has a dominant paradigm, for "would need a collaborator" rationales. Read-only. */
export async function loadCollaborators(db: SupabaseClient, investigatorId: string): Promise<Collaborator[]> {
  const { data: rel, error } = await db
    .from("investigator_relationships")
    .select("investigator_a_id, investigator_b_id, strength_score")
    .or(`investigator_a_id.eq.${investigatorId},investigator_b_id.eq.${investigatorId}`)
    .order("strength_score", { ascending: false })
    .limit(200);
  if (error) throw new Error(`investigator_relationships read failed: ${error.message}`);
  const others = Array.from(new Set((rel ?? []).map((r) => (r.investigator_a_id === investigatorId ? r.investigator_b_id : r.investigator_a_id) as string)));
  if (!others.length) return [];
  const [{ data: profiles, error: pErr }, { data: names, error: nErr }] = await Promise.all([
    db.from("investigator_fit_profiles").select("investigator_id, profile").in("investigator_id", others),
    db.from("investigators").select("id, full_name").in("id", others),
  ]);
  // Before the migration is applied (dry runs) there are no stored profiles to read.
  if (pErr && MISSING_TABLE.test(pErr.message)) return [];
  if (pErr) throw new Error(`investigator_fit_profiles read failed: ${pErr.message}`);
  if (nErr) throw new Error(`investigators read failed: ${nErr.message}`);
  const nameOf = new Map((names ?? []).map((n) => [n.id as string, (n.full_name as string | null) ?? null]));
  const out: Collaborator[] = [];
  for (const row of profiles ?? []) {
    const p = row.profile as InvestigatorFitProfile | null;
    const dominant = p ? dominantParadigm(p.paradigm?.career ?? {}) : null;
    if (!dominant) continue;
    const categories = Object.keys(p!.paradigm.career).filter((c) => categoriesOf(dominant.family).includes(c as ParadigmCategory)) as ParadigmCategory[];
    out.push({ id: row.investigator_id as string, name: nameOf.get(row.investigator_id as string) ?? null, dominant_family: dominant.family, categories });
  }
  return out.sort((a, b) => others.indexOf(a.id) - others.indexOf(b.id));
}

/** Cap on `modelConcurrency` — beyond this the endpoint's rate limit, not the build, is the bound. */
export const MAX_MODEL_CONCURRENCY = 16;

/**
 * collect → classify each item (cache first; the model only where PR 1.3 says
 * it is needed and the budget allows before the deadline; `modelConcurrency`
 * items at once, results in item order) → aggregate → upsert (partial builds
 * included, with `pending_items`). Returns everything the cron, the report
 * and the inspector need beside the profile.
 */
export async function buildInvestigatorFitProfile(db: SupabaseClient, investigatorId: string, deps: BuildDeps = {}): Promise<BuildResult> {
  const started = Date.now();
  const now = deps.now ?? (() => new Date());
  const mesh = deps.mesh ?? (await loadMeshIndex(db));
  const rulesCtx: EvaluateContext = { mesh, tables: deps.tables ?? DEFAULT_RULE_TABLES };
  const budget = deps.modelBudget instanceof ModelBudget ? deps.modelBudget : new ModelBudget(deps.modelBudget ?? 0);
  const concurrency = Math.max(1, Math.min(MAX_MODEL_CONCURRENCY, Math.floor(deps.modelConcurrency ?? 1)));

  const evidence = await collectEvidence(db, investigatorId, { mesh });
  const allItems = [...evidence.items, ...evidence.aspirationItems];
  const cache = deps.cache ?? (await prefetchedItemProfileCache(db, allItems.map(itemCacheKey)));
  const classifyDeps: ClassifyDepsForBuild = { rulesCtx, cache, budget, model: deps.model, modelName: deps.modelName, deadline: deps.deadline, now };

  // Evidence items and aspiration items through one order-preserving pool.
  const classified: BudgetedClassification[] = new Array(allItems.length);
  await runWorkerPool(allItems, concurrency, async (item, i) => {
    classified[i] = await classifyWithBudget(item, classifyDeps);
  });
  const items = classified.slice(0, evidence.items.length);

  const aspirations: AspirationOutcome[] = evidence.aspirationItems.map((item, i) => {
    const text = item.text ?? "";
    const byLabel = aspirationCategoriesByLabel(text);
    const c = classified[evidence.items.length + i]!;
    const byModel = c.model_needed && !c.model_skipped ? aspirationCategoriesFromProfile(c.profile) : [];
    const categories = Array.from(new Set([...byModel, ...byLabel]));
    const via: AspirationOutcome["via"] = byModel.length ? (c.model_called ? "model" : "cache") : byLabel.length ? "label" : "none";
    return { text, categories, via };
  });

  const at = now();
  const selfAxes = readSelfDeclaredAxes(evidence.investigator.self_declared_axes);
  const ctx: AggregateContext = {
    investigator_id: investigatorId,
    aspirations: aspirations.flatMap((a) => a.categories),
    do_not_suggest: (Array.isArray(evidence.investigator.do_not_suggest) ? evidence.investigator.do_not_suggest : []).filter((f): f is ParadigmFamily => typeof f === "string" && isParadigmFamily(f)),
    characteristics: characteristicsFrom({ investigator: evidence.investigator, grants: evidence.rows.grants, trials: evidence.rows.trials, now: at }),
    biosketch: evidence.rows.biosketch?.state ?? "not_requested",
    self_declared: Boolean(selfAxes && (Object.keys(selfAxes.paradigm ?? {}).length > 0 || (selfAxes.materials ?? []).length > 0)),
    collaborators: deps.collaborators === false ? [] : await loadCollaborators(db, investigatorId),
    meshTreeNumbers: (ui) => mesh.byUi.get(ui)?.tree_numbers ?? null,
  };
  const { profile, diagnostics } = aggregateWithDiagnostics(
    items.map((i) => i.profile),
    at,
    ctx
  );

  const model_skipped = items.filter((i) => i.model_skipped).length;
  const pending_items = model_skipped + evidence.failures.length;
  const incomplete = pending_items > 0;
  let written = false;
  if (deps.write !== false) {
    const { error } = await db.from("investigator_fit_profiles").upsert(profileRow(profile, items.length, pending_items), { onConflict: "investigator_id" });
    if (error) throw new Error(`investigator_fit_profiles write failed: ${error.message}`);
    written = true;
  }

  const result: BuildResult = {
    investigator_id: investigatorId,
    name: evidence.investigator.full_name ?? null,
    profile,
    diagnostics,
    items,
    item_count: items.length,
    model_needed: items.filter((i) => i.model_needed).length,
    model_called: classified.filter((i) => i.model_called).length,
    model_skipped,
    model_unusable: classified.filter((i) => i.model_unusable).length,
    model_errors: classified.filter((i) => i.model_error).length,
    cache_hits: items.filter((i) => i.cache === "hit").length,
    failures: evidence.failures,
    aspirations,
    pending_items,
    incomplete,
    written,
    durationMs: Date.now() - started,
  };
  deps.log?.(formatBuildLine(result));
  return result;
}

/** One line per build for logs and the cron response. */
export function formatBuildLine(r: BuildResult): string {
  const dom = dominantParadigm(r.profile.paradigm.career);
  const recent = dominantParadigm(r.profile.paradigm.recent);
  const parts = [
    `${r.name ?? r.investigator_id}`,
    `${r.item_count} items`,
    dom ? `career ${dom.category} ${dom.weight.toFixed(2)}` : "career —",
    recent ? `recent ${recent.category} ${recent.weight.toFixed(2)}` : "recent —",
    `model needed ${r.model_needed} · called ${r.model_called} · cached ${r.cache_hits} · skipped ${r.model_skipped}${r.model_unusable ? ` (${r.model_unusable} unusable)` : ""}`,
    r.failures.length ? `${r.failures.length} row(s) failed to normalize` : null,
    r.pending_items ? `PENDING ${r.pending_items}` : null,
    r.written ? "written" : "not written",
    `${r.durationMs} ms`,
  ].filter(Boolean);
  return parts.join(" · ");
}

