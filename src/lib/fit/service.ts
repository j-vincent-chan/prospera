/**
 * Fit-engine orchestration (plan § PR 2.2; CLAUDE.md "Orchestration lives in
 * src/lib/fit/service.ts and cron routes"). Loads the two stored profiles,
 * the notice corpus (IDF, embeddings, deadlines), the investigator's
 * evidence items (rules + the item cache, never the model), builds the
 * engine's `ScoreContext` per pair, runs stage 1 retrieval over the corpus,
 * calls the pure `scorePair` on every candidate and persists `fit_results`.
 * No model call, no embedding call: every vector is read from the tables the
 * outreach crons already fill (`evidence_embeddings`, `investigator_embeddings`,
 * `opportunity_embeddings`).
 *
 * Three entry points share one `FitStore` (the Supabase implementation, or
 * an in-memory one in tests):
 *
 *   rankForInvestigator(store, id)   candidates over the open corpus → results,
 *                                    written (upsert + stale delete) and the
 *                                    investigator stamped `fit_results_at`
 *   rankForNotice(store, id)         the mirror over the roster — read-only by
 *                                    default (a script / inspection path); with
 *                                    `write: true` it upserts and never deletes
 *   refreshFitResults(store, opts)   the nightly sweep: IDF refresh, then the
 *                                    roster in sweep order — never scored first
 *                                    (`fit_results_at` NULL), then the oldest —
 *                                    the whole roster unless `limit` narrows it,
 *                                    until the time budget stops it; what is
 *                                    left is first the next night
 *
 * (The plan names the sweep `refreshCommunityFits`; that name belongs to the
 * community cache in src/lib/communities/fits.ts, which under `fit-v1` reads
 * what this sweep writes, so the sweep is `refreshFitResults` here.)
 *
 * Context assembly (spec §8 "what ctx must carry"):
 *   now                         one instant per run (byte-identical reruns)
 *   actionability.runway_weeks  weeks to the notice's next due date (retrieval.ts
 *                               `runwayWeeks`: the stored `next_due` when still
 *                               ahead, else the receipt-cycle rule, else the
 *                               close date); in_pipeline / recently_dismissed are
 *                               false — fit_results is keyed by pair, not by
 *                               team, so the team-scoped Outreach state is
 *                               applied by the callers, not stored (plan note)
 *   topic.idf                   fit_topic_idf, computed over the corpus this run
 *                               loaded (and written by the sweep)
 *   topic.items                 one TopicItemInput per evidence item: the item's
 *                               classified paradigm and design vectors (stage 5
 *                               compatibility), the cosine of its outreach
 *                               embedding against the notice's, and its term
 *                               counts over title + abstract via the engine's
 *                               `tokenize`
 *   topic.bm25                  k1 / b (`compose.topic.bm25`, a prior), the
 *                               investigator's mean item length, and document
 *                               frequencies over the open-notice corpus — §11
 *                               rule 2's corpus, so a term every notice uses
 *                               ("cancer") weighs little and a rare one a lot
 *   infrastructure              null (no infrastructure vocabulary is extracted
 *                               yet — plan note)
 *   track                       prior_ucsf_awardees_same_code null (no UCSF
 *                               awardee count per code yet — plan note)
 *   investigator_pending_items  investigator_fit_profiles.pending_items (D20)
 *   notice_complete             opportunity_fit_profiles.sources.complete (D22)
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { itemCacheKey } from "@/lib/fit/classify";
import type { MeshIndex } from "@/lib/fit/classify/mesh";
import { loadMeshIndex } from "@/lib/fit/classify/mesh-db";
import { DEFAULT_RULE_TABLES, type EvaluateContext } from "@/lib/fit/classify/rules";
import { scorePair } from "@/lib/fit/engine";
import { tokenize } from "@/lib/fit/engine/topic";
import { classifyWithBudget, collectEvidence, MISSING_TABLE, ModelBudget, prefetchedItemProfileCache, type StoredProfileRow } from "@/lib/fit/profile/investigator";
import type { OpportunityFitProfileRow, ProfileSources } from "@/lib/fit/profile/opportunity";
import { FIT_RESULTS_MIGRATION, MISSING_TABLE as RESULTS_MISSING_TABLE, toFitResultRow, type FitResultRow } from "@/lib/fit/results";
import { MISSING_TABLE as CORRECTIONS_MISSING_TABLE, type CorrectionTargetTable } from "@/lib/fit/judge/corrections";
import { judgeFactsOf, profileVersionHash, sameVersions, type EvidenceCandidate } from "@/lib/fit/judge/inputs";
import { applyAdjudication } from "@/lib/fit/judge/reconcile";
import { JUDGE_VERSION, type Adjudication, type StoredAdjudication } from "@/lib/fit/judge/types";
import { candidatesForInvestigator, candidatesForNotice, embeddingTopN, nearMissSet, runwayWeeks, type CandidateSet, type NoticeDeadlineFacts, type NoticeForRetrieval, type RecallHit } from "@/lib/fit/retrieval";
import { bm25Params, TAXONOMY_VERSION, TIER_IDS } from "@/lib/fit/taxonomy";
import { computeIdf, refreshTopicIdf, type IdfComputation, type IdfRefreshResult } from "@/lib/fit/topic/idf";
import { buildMeshNameIndex, withNoticeMesh, type MeshNameIndex } from "@/lib/fit/topic/notice-mesh";
import type { Bm25Stats, CorrectionStatus, DesignWeights, FitResult, InvestigatorFitProfile, OpportunityFitProfile, ParadigmWeights, ScoreContext, Tier, TopicItemInput } from "@/lib/fit/types";
import { parseVector, cosine, topByCosine } from "@/lib/fit/vectors";
import { openNoticeFilter } from "@/lib/ingestion/reporter/exemplars";

export const FIT_RESULTS_JOB_TYPE = "fit_results";
/** The nightly's stop: ~1–3 s per investigator (the evidence read, rules + cache classification, ~400 pairs scored) after a ~10 s corpus load, so a full night covers ≈ 100 investigators; the rest lead the next night's order. */
export const FIT_RESULTS_CRON_TIME_BUDGET_MS = 240_000;

/**
 * PR 3.3, the ops constant behind "approve now or approve tonight". Approving
 * a correction re-scores what it touches. An investigator correction is one
 * `rankForInvestigator` and always runs in the action. A **notice** correction
 * touches every investigator ranked against that notice, and `rankForNotice`
 * pays one evidence read plus rules-and-cache classification per candidate
 * (≈ 0.2–0.5 s each) on top of the ≈ 10 s corpus load — so the action runs it
 * itself only while the candidate count is at or under this, and otherwise
 * leaves `fit_corrections.rescored_at` NULL for the nightly prelude
 * (`rescoreAppliedCorrections`), which has the cron's 240 s and the corpus
 * already in hand. At 25 the action stays inside a one-minute budget; on the
 * 2026-09 roster (144 investigators with a profile) a notice correction is
 * therefore normally the nightly's work, which is exactly what the plan's
 * acceptance asks for ("within the nightly job").
 */
export const FIT_RESCORE_SYNC_MAX_INVESTIGATORS = 25;

/** The share of the nightly's time budget the re-score prelude may spend before the roster sweep starts; what it does not reach stays unstamped and leads the next night. */
export const FIT_RESCORE_PRELUDE_SHARE = 0.5;

/** PostgREST's messages for a column the schema cache does not know (the migration not applied yet). */
const COLUMN_MISSING = /could not find the .*column|column .* does not exist|schema cache/i;

// ---------------------------------------------------------------------------
// Loaded shapes
// ---------------------------------------------------------------------------

/** The `funding_opportunities` facts a pair needs beside the profile. */
export type NoticeFacts = NoticeDeadlineFacts & {
  id: string;
  opportunity_number: string | null;
  title: string | null;
  agency: string | null;
  activity_code: string | null;
  /** Every institute the notice names (the judge masks each in its blind Call A, S4); absent on a row read before the column existed. */
  nih_ic_tokens?: string[] | null;
};

export const NOTICE_FACT_COLUMNS = "id, opportunity_number, title, agency, close_date, next_due, expiration_date, activity_code, receipt_cycles, nih_ic_tokens";

export type CorpusNotice = {
  profile: OpportunityFitProfile;
  /** `sources.complete` (D22); a row without the field counts as complete. */
  complete: boolean;
  facts: NoticeFacts;
  runway_weeks: number | null;
  vector: number[] | null;
  computed_at: string;
};

export type FitCorpus = {
  /** Open notices with a fit profile, in `opportunity_id` order. */
  notices: CorpusNotice[];
  idf: IdfComputation;
  /** Term → open notices whose topic text (terms + Part 1 Purpose) contains it — BM25's document frequencies (§11 rule 2). */
  termDf: Record<string, number>;
  /** ISO date the open filter used. */
  today: string;
  /** Notices whose `topic.mesh` was filled from their terms and RCDC names at load. */
  mesh_mapped: number;
  /** Notices with an opportunity embedding. */
  with_vector: number;
};

/** The facts the stage-8 judge reads for one item (judge/inputs.ts); absent on inputs built without them (older callers, tests). */
export type JudgeItemFacts = Omit<EvidenceCandidate, "similarity">;

/** One evidence item as the topic stage needs it, before the per-notice cosine. */
export type ItemInput = {
  id: string;
  paradigm: ParadigmWeights;
  design: DesignWeights;
  tf: Record<string, number> | null;
  length: number;
  vector: number[] | null;
  judge?: JudgeItemFacts;
};

export type InvestigatorInputs = {
  profile: InvestigatorFitProfile;
  name: string | null;
  pending_items: number;
  computed_at: string;
  items: ItemInput[];
  /** The career document vector (`investigator_embeddings`), the recall net's query. */
  docVector: number[] | null;
  stats: { items: number; with_vector: number; with_text: number; model_pending: number };
};

/** One roster member: `fit_results_at` is when the sweep last wrote its rows (null: never), the sweep's order key. */
export type RosterEntry = { investigator_id: string; name: string | null; fit_results_at: string | null };

export type PersistOutcome = { upserted: number; deleted: number };

/** Everything the orchestration reads and writes; the Supabase implementation is below, tests inject an in-memory one. */
export type FitStore = {
  loadCorpus(now: Date): Promise<FitCorpus>;
  /** Investigators with a stored fit profile (non-archived), in sweep order: `fit_results_at` ascending, NULLS FIRST, then id. */
  loadRoster(): Promise<RosterEntry[]>;
  /** `now` is the run's instant — the recency weights of the judge facts are computed at it (N1). */
  loadInvestigator(id: string, now?: Date): Promise<InvestigatorInputs | null>;
  /** The stored profiles and document vectors of the roster, for the notice mirror. */
  loadRosterProfiles(): Promise<Array<{ profile: InvestigatorFitProfile; pending_items: number; docVector: number[] | null }>>;
  /** Upsert `rows`, delete the investigator's other rows (pairs no longer candidates) and stamp `investigator_fit_profiles.fit_results_at = at`. */
  persistForInvestigator(investigatorId: string, rows: FitResultRow[], at: string): Promise<PersistOutcome>;
  /** Upsert `rows` only — the mirror never deletes: each investigator's row set belongs to the sweep. */
  persistForNotice(opportunityId: string, rows: FitResultRow[]): Promise<PersistOutcome>;
  refreshIdf(idf: IdfComputation, now: Date): Promise<IdfRefreshResult>;
  /** True while `fit_results` is not on the database (the migration not applied). */
  resultsTableMissing(): Promise<boolean>;
  /** Stage 8 (PR 3.1): the stored adjudications of an investigator or a notice, newest first; empty before the migration. Optional — a store without it keeps no stage-8 tier across sweeps. */
  loadAdjudications?(filter: { investigatorId?: string; opportunityId?: string }): Promise<StoredAdjudication[]>;
  /** The live `fit_corrections.status` by row id (F4: a stored adjudication's corrections are re-applied only while still `proposed`); ids without a row are absent. Optional — without it the stored statuses stand. */
  loadCorrectionStatuses?(ids: readonly string[]): Promise<Map<string, CorrectionStatus>>;
  /** PR 3.3: applied corrections whose re-score has not run yet (`fit_corrections.rescored_at IS NULL`), oldest decision first; empty before the 3.3 migration. Optional — a store without it runs no prelude. */
  loadPendingRescores?(): Promise<PendingRescore[]>;
  /** PR 3.3: stamp `fit_corrections.rescored_at` on the rows the prelude has just re-scored. */
  markRescored?(ids: readonly string[], at: string): Promise<void>;
};

/** PR 3.3: one applied correction the nightly still owes a re-score. */
export type PendingRescore = { id: string; target: CorrectionTargetTable; target_id: string; decided_at: string | null };

// ---------------------------------------------------------------------------
// Pure assembly
// ---------------------------------------------------------------------------

/** Term counts and token length of an item's text through the engine's tokenizer; null / 0 for an item without text. */
export function termCounts(text: string | null | undefined): { tf: Record<string, number> | null; length: number } {
  const tokens = tokenize(text ?? "");
  if (!tokens.length) return { tf: null, length: 0 };
  const tf: Record<string, number> = {};
  for (const t of tokens) tf[t] = (tf[t] ?? 0) + 1;
  return { tf, length: tokens.length };
}

/** Document frequencies of every token over the notices' topic text (terms + free text), one count per notice. */
export function noticeTermDf(notices: ReadonlyArray<Pick<OpportunityFitProfile, "topic">>): Record<string, number> {
  const df: Record<string, number> = {};
  for (const n of notices) {
    const tokens = new Set(tokenize([...n.topic.terms, n.topic.free_text ?? ""].join(" ")));
    for (const t of tokens) df[t] = (df[t] ?? 0) + 1;
  }
  return df;
}

/** BM25 statistics for one investigator's items against the notice corpus (see the module note); k1 and b from `compose.topic.bm25`. */
export function bm25StatsFor(items: readonly ItemInput[], corpus: Pick<FitCorpus, "termDf" | "notices">): Bm25Stats | null {
  const withText = items.filter((i) => i.tf !== null);
  if (!withText.length || !corpus.notices.length) return null;
  const { k1, b } = bm25Params();
  return {
    k1,
    b,
    avg_doc_length: withText.reduce((s, i) => s + i.length, 0) / withText.length,
    doc_count: corpus.notices.length,
    doc_freq: corpus.termDf,
  };
}

/** The topic inputs for one pair: every item with its cosine against this notice's vector (null when either side has none). */
export function topicItemsFor(items: readonly ItemInput[], noticeVector: readonly number[] | null): TopicItemInput[] {
  return items.map((i) => ({
    id: i.id,
    paradigm: i.paradigm,
    design: i.design,
    cosine: noticeVector && i.vector ? cosine(noticeVector, i.vector) : null,
    tf: i.tf,
    length: i.length,
  }));
}

/** Pure. The engine's context for one pair. */
export function buildScoreContext(inv: InvestigatorInputs, notice: CorpusNotice, corpus: Pick<FitCorpus, "idf" | "termDf" | "notices">, now: string): ScoreContext {
  return {
    now,
    actionability: { runway_weeks: notice.runway_weeks, in_pipeline: false, recently_dismissed: false },
    topic: { idf: corpus.idf.table, items: topicItemsFor(inv.items, notice.vector), bm25: bm25StatsFor(inv.items, corpus), override: null },
    infrastructure: null,
    track: { prior_ucsf_awardees_same_code: null },
    investigator_pending_items: inv.pending_items,
    notice_complete: notice.complete,
  };
}

/** The recall net for an investigator: the top-N open notices by the career vector; empty without one. */
export function recallForInvestigator(inv: Pick<InvestigatorInputs, "docVector">, corpus: Pick<FitCorpus, "notices">, n = embeddingTopN()): RecallHit[] {
  if (!inv.docVector) return [];
  return topByCosine(
    inv.docVector,
    corpus.notices.filter((x) => x.vector).map((x) => ({ id: x.profile.opportunity_id, vector: x.vector! })),
    n
  );
}

const emptyTiers = (): Record<Tier, number> => Object.fromEntries(TIER_IDS.map((t) => [t, 0])) as Record<Tier, number>;

export function tierCounts(results: readonly Pick<FitResult, "tier">[]): Record<Tier, number> {
  const out = emptyTiers();
  for (const r of results) out[r.tier] += 1;
  return out;
}

// ---------------------------------------------------------------------------
// rankForInvestigator / rankForNotice
// ---------------------------------------------------------------------------

export type RankOptions = {
  /** A corpus loaded once for many investigators (the sweep). */
  corpus?: FitCorpus;
  /** rankForInvestigator: upsert the rows, delete stale ones and stamp the investigator (default true). rankForNotice: upsert only (default false — the mirror is read-only unless asked). */
  write?: boolean;
  now?: () => Date;
};

export type RankForInvestigatorResult = {
  investigator_id: string;
  name: string | null;
  profile: InvestigatorFitProfile;
  candidates: CandidateSet;
  results: FitResult[];
  near_miss: FitResult[];
  tiers: Record<Tier, number>;
  stats: InvestigatorInputs["stats"] & { notices: number; recall_n: number };
  persisted: PersistOutcome | null;
  /** Pairs whose stored stage-8 adjudication still matched the profiles and was re-applied (PR 3.1). */
  adjudicated: number;
  adjudications: Map<string, Adjudication>;
  durationMs: number;
};

/** Rank one investigator against the open corpus; null when no stored profile exists. Results best first (score desc, then opportunity id). */
export async function rankForInvestigator(store: FitStore, investigatorId: string, opts: RankOptions = {}): Promise<RankForInvestigatorResult | null> {
  const started = Date.now();
  const at = (opts.now ?? (() => new Date()))();
  const corpus = opts.corpus ?? (await store.loadCorpus(at));
  const inv = await store.loadInvestigator(investigatorId, at);
  if (!inv) return null;
  const now = at.toISOString();
  const recall = recallForInvestigator(inv, corpus);
  const byId = new Map(corpus.notices.map((n) => [n.profile.opportunity_id, n]));
  const forRetrieval: NoticeForRetrieval[] = corpus.notices.map((n) => ({ profile: n.profile, runway_weeks: n.runway_weeks }));
  const candidates = candidatesForInvestigator(inv.profile, forRetrieval, recall);
  const lookup = await loadAdjudicationLookup(store, { investigatorId }, (a) => a.opportunity_id);
  const invVersion = profileVersionHash(inv.profile);
  const adjudications = new Map<string, Adjudication>();
  const results: FitResult[] = [];
  for (const c of candidates.candidates) {
    const notice = byId.get(c.id);
    if (!notice) continue;
    const ctx = buildScoreContext(inv, notice, corpus, now);
    const kept = lookup ? reapplyAdjudication(lookup, c.id, inv, notice, ctx, invVersion, profileVersionHash(notice.profile)) : null;
    if (kept) adjudications.set(c.id, kept.adjudication);
    results.push(kept ? kept.result : scorePair(inv.profile, notice.profile, ctx));
  }
  results.sort((a, b) => b.score - a.score || (a.opportunity_id < b.opportunity_id ? -1 : a.opportunity_id > b.opportunity_id ? 1 : 0));
  const persisted = opts.write === false ? null : await store.persistForInvestigator(investigatorId, results.map((r) => toFitResultRow(r, adjudications.get(r.opportunity_id) ?? null)), now);
  return {
    investigator_id: investigatorId,
    name: inv.name,
    profile: inv.profile,
    candidates,
    results,
    near_miss: nearMissSet(results),
    tiers: tierCounts(results),
    stats: { ...inv.stats, notices: corpus.notices.length, recall_n: recall.length },
    persisted,
    adjudicated: adjudications.size,
    adjudications,
    durationMs: Date.now() - started,
  };
}

/**
 * Stage 8's cache (PR 3.1): a pair whose newest stored adjudication was made
 * on the profiles as they stand now — the same content hashes, taxonomy and
 * judge versions — keeps its adjudicated tier: the row is re-derived by the
 * pure `applyAdjudication` (the stored profile is S0, the open provisional
 * corrections re-applied, the pair re-scored, the reconciliation table
 * re-run) and replaces the engine's result. The corrections' live
 * `fit_corrections.status` is joined by the stored row ids first (F4): a
 * `rejected` one is skipped, an `applied` one already lives in the profile.
 * A pair whose profiles changed falls back to the engine's result and is
 * due for the judge again. Both rankings use it — the investigator's over
 * its notices, the notice mirror over its investigators (F9).
 */
type AdjudicationLookup = { newest: Map<string, StoredAdjudication>; statuses: Map<string, CorrectionStatus> };

/** The newest stored adjudication per `keyOf` (the other side of the pair) and the live status of every correction they cite; null when the store keeps none. */
async function loadAdjudicationLookup(store: FitStore, filter: { investigatorId?: string; opportunityId?: string }, keyOf: (a: StoredAdjudication) => string): Promise<AdjudicationLookup | null> {
  if (!store.loadAdjudications) return null;
  const stored = await store.loadAdjudications(filter);
  if (!stored.length) return null;
  const newest = new Map<string, StoredAdjudication>();
  for (const a of stored) {
    const k = keyOf(a);
    if (!newest.has(k)) newest.set(k, a);
  }
  const ids = Array.from(new Set(Array.from(newest.values()).flatMap((a) => (a.reconciliation?.result?.corrections ?? []).map((c) => c.id)).filter((id): id is string => typeof id === "string")));
  const statuses = ids.length && store.loadCorrectionStatuses ? await store.loadCorrectionStatuses(ids) : new Map<string, CorrectionStatus>();
  return { newest, statuses };
}

/** Pure. The stored adjudication with each correction's live status joined by id (a correction without a live row keeps its stored status). */
export function withLiveStatuses(a: StoredAdjudication, statuses: ReadonlyMap<string, CorrectionStatus>): StoredAdjudication {
  const corrections = a.reconciliation.result.corrections;
  if (!corrections.some((c) => c.id !== null && statuses.has(c.id))) return a;
  return { ...a, reconciliation: { ...a.reconciliation, result: { ...a.reconciliation.result, corrections: corrections.map((c) => (c.id !== null && statuses.has(c.id) ? { ...c, status: statuses.get(c.id)! } : c)) } } };
}

/** The re-derived row for one pair when its newest adjudication still matches both profile versions; null otherwise (the engine's result stands). */
function reapplyAdjudication(lookup: AdjudicationLookup, key: string, inv: InvestigatorInputs, notice: CorpusNotice, ctx: ScoreContext, invVersion: string, oppVersion: string): { result: FitResult; adjudication: Adjudication } | null {
  const a = lookup.newest.get(key);
  if (!a || !sameVersions(a.profile_versions, { investigator: invVersion, opportunity: oppVersion, taxonomy: TAXONOMY_VERSION, judge: JUDGE_VERSION })) return null;
  return applyAdjudication(inv.profile, notice.profile, ctx, withLiveStatuses(a, lookup.statuses));
}

export type RankForNoticeResult = {
  opportunity_id: string;
  number: string | null;
  title: string | null;
  candidates: CandidateSet;
  results: FitResult[];
  near_miss: FitResult[];
  tiers: Record<Tier, number>;
  /** Candidates whose evidence could not be loaded (no profile row any more, a read failure). */
  errors: Array<{ investigator_id: string; error: string }>;
  persisted: PersistOutcome | null;
  /** Pairs whose stored stage-8 adjudication still matched the profiles and was re-applied (F9). */
  adjudicated: number;
  adjudications: Map<string, Adjudication>;
  durationMs: number;
};

/** Rank the roster against one notice (the mirror); null when the notice is not in the open corpus. Read-only unless `write: true`, which upserts the rows and deletes nothing. Keeps the stored adjudications the way `rankForInvestigator` does (F9). */
export async function rankForNotice(store: FitStore, opportunityId: string, opts: RankOptions = {}): Promise<RankForNoticeResult | null> {
  const started = Date.now();
  const at = (opts.now ?? (() => new Date()))();
  const corpus = opts.corpus ?? (await store.loadCorpus(at));
  const notice = corpus.notices.find((n) => n.profile.opportunity_id === opportunityId);
  if (!notice) return null;
  const now = at.toISOString();
  const roster = await store.loadRosterProfiles();
  const recall: RecallHit[] = notice.vector ? topByCosine(notice.vector, roster.filter((r) => r.docVector).map((r) => ({ id: r.profile.investigator_id, vector: r.docVector! })), embeddingTopN()) : [];
  const candidates = candidatesForNotice(
    notice.profile,
    notice.runway_weeks,
    roster.map((r) => r.profile),
    recall
  );
  const lookup = await loadAdjudicationLookup(store, { opportunityId }, (a) => a.investigator_id);
  const oppVersion = lookup ? profileVersionHash(notice.profile) : "";
  const adjudications = new Map<string, Adjudication>();
  const results: FitResult[] = [];
  const errors: RankForNoticeResult["errors"] = [];
  for (const c of candidates.candidates) {
    try {
      const inv = await store.loadInvestigator(c.id, at);
      if (!inv) {
        errors.push({ investigator_id: c.id, error: "no stored profile" });
        continue;
      }
      const ctx = buildScoreContext(inv, notice, corpus, now);
      const kept = lookup ? reapplyAdjudication(lookup, c.id, inv, notice, ctx, profileVersionHash(inv.profile), oppVersion) : null;
      if (kept) adjudications.set(c.id, kept.adjudication);
      results.push(kept ? kept.result : scorePair(inv.profile, notice.profile, ctx));
    } catch (e) {
      errors.push({ investigator_id: c.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  results.sort((a, b) => b.score - a.score || (a.investigator_id < b.investigator_id ? -1 : a.investigator_id > b.investigator_id ? 1 : 0));
  const persisted = opts.write === true ? await store.persistForNotice(opportunityId, results.map((r) => toFitResultRow(r, adjudications.get(r.investigator_id) ?? null))) : null;
  return {
    opportunity_id: opportunityId,
    number: notice.profile.number ?? notice.facts.opportunity_number,
    title: notice.facts.title,
    candidates,
    results,
    near_miss: nearMissSet(results),
    tiers: tierCounts(results),
    errors,
    persisted,
    adjudicated: adjudications.size,
    adjudications,
    durationMs: Date.now() - started,
  };
}

// ---------------------------------------------------------------------------
// The nightly's re-score prelude (PR 3.3)
// ---------------------------------------------------------------------------

/** One subject the prelude re-scores, with the correction rows that are waiting on it. */
export type RescoreSubject = { target: CorrectionTargetTable; target_id: string; ids: string[]; decided_at: string | null };

/**
 * Pure. The pending corrections grouped into one subject per profile, oldest
 * decision first (a notice with three applied corrections is re-scored once,
 * and all three are stamped together).
 */
export function rescoreSubjects(pending: readonly PendingRescore[]): RescoreSubject[] {
  const by = new Map<string, RescoreSubject>();
  for (const p of pending) {
    const key = `${p.target}:${p.target_id}`;
    const found = by.get(key);
    if (found) {
      found.ids.push(p.id);
      if (p.decided_at && (!found.decided_at || p.decided_at < found.decided_at)) found.decided_at = p.decided_at;
    } else by.set(key, { target: p.target, target_id: p.target_id, ids: [p.id], decided_at: p.decided_at ?? null });
  }
  return Array.from(by.values()).sort((a, b) => byId(a.decided_at ?? "", b.decided_at ?? "") || byId(a.target_id, b.target_id));
}

export type RescoreSubjectLine = { target: CorrectionTargetTable; target_id: string; corrections: number; status: "rescored" | "gone" | "error"; pairs: number; upserted: number; durationMs: number; error?: string; line: string };

export type RescorePreludeResult = {
  /** Applied corrections still owed a re-score when the prelude started. */
  pending: number;
  subjects: number;
  taken: number;
  rescored: number;
  stamped: number;
  errors: number;
  /** Subjects the prelude's own deadline left for the next night. */
  deferred: number;
  pairs: number;
  upserted: number;
  lines: RescoreSubjectLine[];
  durationMs: number;
  /** Set when the store keeps no pending list (before the 3.3 migration, or an in-memory store without it): nothing was swept. */
  skipped: string | null;
};

export const emptyRescorePrelude = (skipped: string | null = null): RescorePreludeResult => ({ pending: 0, subjects: 0, taken: 0, rescored: 0, stamped: 0, errors: 0, deferred: 0, pairs: 0, upserted: 0, lines: [], durationMs: 0, skipped });

/**
 * PR 3.3's acceptance — "approving a notice correction re-scores every
 * investigator against that notice within the nightly job". The approve
 * action re-scores what it can afford itself (an investigator always, a
 * notice while its candidate slice is at or under
 * `FIT_RESCORE_SYNC_MAX_INVESTIGATORS`) and stamps
 * `fit_corrections.rescored_at`; everything else stays unstamped, and this
 * prelude — which the nightly runs *before* the roster order, with the corpus
 * already loaded — takes it: `rankForNotice(write: true)` over the notice's
 * whole candidate set, or `rankForInvestigator` for an investigator
 * correction, then the stamp. Neither re-score keeps a stage-8 adjudication:
 * the patched profile hashes differently, so every judged pair of that
 * subject falls back to the engine's tier with `adjudication: null` and is
 * due for the judge again (the approve action already put `fit_judged_at`
 * back to NULL, so the nightly judge takes it first).
 *
 * A subject whose profile is gone (a notice that closed, an investigator
 * archived) is stamped anyway — nothing is owed on it any more. The prelude
 * stops at its own deadline; what it did not reach stays unstamped and leads
 * the next night.
 */
export async function rescoreAppliedCorrections(
  store: FitStore,
  opts: { corpus?: FitCorpus; at?: Date; deadline?: number | null; dryRun?: boolean; log?: (line: string) => void }
): Promise<RescorePreludeResult> {
  const started = Date.now();
  const log = opts.log ?? (() => {});
  if (!store.loadPendingRescores) return emptyRescorePrelude("the store keeps no pending re-scores");
  const pending = await store.loadPendingRescores();
  const subjects = rescoreSubjects(pending);
  const out = { ...emptyRescorePrelude(), pending: pending.length, subjects: subjects.length };
  if (!subjects.length) {
    out.durationMs = Date.now() - started;
    return out;
  }
  const at = opts.at ?? new Date();
  const now = () => at;
  const corpus = opts.corpus ?? (await store.loadCorpus(at));
  log(`${FIT_RESULTS_JOB_TYPE}: re-score prelude — ${pending.length} applied correction(s) awaiting a re-score over ${subjects.length} profile(s)`);
  for (const s of subjects) {
    if (opts.deadline != null && Date.now() > opts.deadline) {
      out.deferred += 1;
      continue;
    }
    out.taken += 1;
    const t0 = Date.now();
    try {
      const ranked = s.target === "opportunity_profile" ? await rankForNotice(store, s.target_id, { corpus, write: !opts.dryRun, now }) : await rankForInvestigator(store, s.target_id, { corpus, write: !opts.dryRun, now });
      const pairs = ranked?.results.length ?? 0;
      const upserted = ranked?.persisted?.upserted ?? 0;
      const status: RescoreSubjectLine["status"] = ranked ? "rescored" : "gone";
      if (ranked) out.rescored += 1;
      out.pairs += pairs;
      out.upserted += upserted;
      // A subject that is gone owes nothing any more; stamping it keeps the queue from re-taking it every night.
      if (!opts.dryRun && store.markRescored) {
        await store.markRescored(s.ids, at.toISOString());
        out.stamped += s.ids.length;
      }
      const line = `re-score ${s.target} ${s.target_id}: ${status} — ${s.ids.length} correction(s), ${pairs} pairs, ${upserted} rows; ${Date.now() - t0} ms`;
      log(line);
      out.lines.push({ target: s.target, target_id: s.target_id, corrections: s.ids.length, status, pairs, upserted, durationMs: Date.now() - t0, line });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      out.errors += 1;
      const line = `re-score ${s.target} ${s.target_id}: error — ${message}`;
      log(line);
      out.lines.push({ target: s.target, target_id: s.target_id, corrections: s.ids.length, status: "error", pairs: 0, upserted: 0, durationMs: Date.now() - t0, error: message, line });
    }
  }
  out.durationMs = Date.now() - started;
  return out;
}

// ---------------------------------------------------------------------------
// The nightly sweep
// ---------------------------------------------------------------------------

export type RefreshFitResultsParams = {
  /** Investigators to take on this run (default: the whole roster — the time budget is the stop). */
  limit?: number;
  /**
   * Resume after this investigator's position in the sweep order — for a dry run or an `investigatorIds` run that stopped early
   * (after a written run the stamps already put the untaken investigators first, so a plain rerun continues). The investigator
   * named — the last one taken, whether written or errored — is skipped.
   */
  cursor?: string | null;
  /** Only these investigators (still in sweep order; the cursor and limit apply). */
  investigatorIds?: string[];
  timeBudgetMs?: number;
  /** Score in memory; write no result row and no IDF row. */
  dryRun?: boolean;
  /** Write `fit_topic_idf` from the loaded corpus before the sweep (default true; never in a dry run). */
  refreshIdf?: boolean;
  /** PR 3.3: run the applied-correction re-score prelude before the roster order (default true). */
  rescorePrelude?: boolean;
  now?: () => Date;
  log?: (line: string) => void;
  /** Receives every investigator's ranking (the report script keeps them). */
  onRanked?: (r: RankForInvestigatorResult) => void;
};

export type InvestigatorSweepLine = {
  investigator_id: string;
  name: string | null;
  status: "written" | "dry_run" | "error";
  candidates: number;
  structural: number;
  recall_only: number;
  tiers: Record<Tier, number>;
  near_miss: number;
  upserted: number;
  deleted: number;
  durationMs: number;
  error?: string;
  line: string;
};

export type RefreshOutcome = "success" | "partial" | "error" | "skipped";

export type RefreshFitResultsResult = {
  ok: true;
  dryRun: boolean;
  outcome: RefreshOutcome;
  /** Investigators with a stored profile (after `investigatorIds`). */
  roster: number;
  /** After the cursor. */
  remaining: number;
  taken: number;
  written: number;
  errors: number;
  pairs: number;
  upserted: number;
  deleted: number;
  near_miss: number;
  tiers: Record<Tier, number>;
  corpus: { notices: number; with_vector: number; mesh_mapped: number; idf_codes: number; idf_n: number };
  idf: IdfRefreshResult | null;
  /** PR 3.3: the re-score prelude, run before the roster order. */
  rescore: RescorePreludeResult;
  budgetExhausted: boolean;
  /** The last investigator taken (written or errored — a resume skips it) when the budget stopped the run or the list was longer than `limit`; null when the sweep finished its list. */
  next_cursor: string | null;
  durationMs: number;
  investigators: InvestigatorSweepLine[];
  /** Set when `fit_results` is not on the database: nothing was scored. */
  skipped: string | null;
};

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Pure. The sweep order: never scored first (`fit_results_at` null), then the oldest stamp, ties by id. */
export function sweepOrder(a: RosterEntry, b: RosterEntry): number {
  if (a.fit_results_at === null || b.fit_results_at === null) {
    if (a.fit_results_at === b.fit_results_at) return byId(a.investigator_id, b.investigator_id);
    return a.fit_results_at === null ? -1 : 1;
  }
  return byId(a.fit_results_at, b.fit_results_at) || byId(a.investigator_id, b.investigator_id);
}

/** Pure. The roster in sweep order, narrowed to `only` when given, after the cursor's position (from the front when the cursor is not in the list); `batch` = the first `limit` (default: all). */
export function sweepBatch(roster: readonly RosterEntry[], opts: { cursor?: string | null; only?: readonly string[]; limit?: number }): { remaining: RosterEntry[]; batch: RosterEntry[] } {
  const only = opts.only?.length ? new Set(opts.only) : null;
  const ordered = roster.filter((r) => !only || only.has(r.investigator_id)).sort(sweepOrder);
  const at = opts.cursor ? ordered.findIndex((r) => r.investigator_id === opts.cursor) : -1;
  const remaining = ordered.slice(at + 1);
  return { remaining, batch: remaining.slice(0, Math.max(1, opts.limit ?? remaining.length)) };
}

export function formatSweepLine(r: RankForInvestigatorResult, status: InvestigatorSweepLine["status"]): string {
  const t = r.tiers;
  return `${r.name ?? r.investigator_id}: ${status === "error" ? "error" : status === "dry_run" ? "dry run" : "written"} — ${r.candidates.candidates.length} candidates (${r.candidates.structural} structured, ${r.candidates.recall_only} recall) of ${r.stats.notices} notices; strong ${t.strong}, moderate ${t.moderate}, exploratory ${t.exploratory}, poor ${t.poor}; near-miss ${r.near_miss.length}; items ${r.stats.items} (${r.stats.with_vector} embedded, ${r.stats.with_text} with text${r.stats.model_pending ? `, ${r.stats.model_pending} pending the classifier` : ""}); ${r.durationMs} ms`;
}

export function formatRefreshSummary(r: RefreshFitResultsResult): string {
  if (r.skipped) return `${FIT_RESULTS_JOB_TYPE} skipped: ${r.skipped}`;
  const budget = r.budgetExhausted ? `; time budget exhausted, next cursor ${r.next_cursor}` : r.next_cursor ? `; next cursor ${r.next_cursor}` : "";
  const rescore = r.rescore.pending ? `; re-score prelude ${r.rescore.rescored} of ${r.rescore.subjects} profile(s) for ${r.rescore.pending} applied correction(s)${r.rescore.deferred ? `, ${r.rescore.deferred} deferred` : ""}${r.rescore.errors ? `, ${r.rescore.errors} errors` : ""}` : "";
  return `${FIT_RESULTS_JOB_TYPE}${r.dryRun ? " (dry run)" : ""} ${r.outcome}: ${r.taken} of ${r.remaining} investigators (${r.roster} with a profile) — ${r.written} written, ${r.errors} errors; ${r.pairs} pairs scored (strong ${r.tiers.strong}, moderate ${r.tiers.moderate}, exploratory ${r.tiers.exploratory}, poor ${r.tiers.poor}; near-miss ${r.near_miss}); ${r.upserted} rows upserted, ${r.deleted} deleted; corpus ${r.corpus.notices} open notices (${r.corpus.with_vector} embedded, ${r.corpus.mesh_mapped} MeSH-mapped), IDF ${r.corpus.idf_codes} codes over ${r.corpus.idf_n}${r.idf ? ` (${r.idf.written} written, ${r.idf.deleted} deleted${r.idf.skipped ? `; ${r.idf.skipped}` : ""})` : ""}${rescore}; ${r.durationMs} ms${budget}`;
}

/** The nightly sweep. Never throws for one investigator's failure; a corpus read failure does. */
export async function refreshFitResults(store: FitStore, params: RefreshFitResultsParams = {}): Promise<RefreshFitResultsResult> {
  const started = Date.now();
  const now = params.now ?? (() => new Date());
  const at = now();
  const dryRun = Boolean(params.dryRun);
  const deadline = started + (params.timeBudgetMs ?? FIT_RESULTS_CRON_TIME_BUDGET_MS);
  const log = params.log ?? (() => {});
  const tiers = emptyTiers();
  const base = { ok: true as const, dryRun, roster: 0, remaining: 0, taken: 0, written: 0, errors: 0, pairs: 0, upserted: 0, deleted: 0, near_miss: 0, tiers, idf: null, rescore: emptyRescorePrelude(), budgetExhausted: false, next_cursor: null, investigators: [], skipped: null };

  if (!dryRun && (await store.resultsTableMissing())) {
    const skipped = `fit_results is not on the database — apply ${FIT_RESULTS_MIGRATION}`;
    log(`${FIT_RESULTS_JOB_TYPE}: ${skipped}`);
    return { ...base, outcome: "skipped", corpus: { notices: 0, with_vector: 0, mesh_mapped: 0, idf_codes: 0, idf_n: 0 }, durationMs: Date.now() - started, skipped };
  }

  const corpus = await store.loadCorpus(at);
  const corpusInfo = { notices: corpus.notices.length, with_vector: corpus.with_vector, mesh_mapped: corpus.mesh_mapped, idf_codes: corpus.idf.rows.length, idf_n: corpus.idf.n };
  log(`${FIT_RESULTS_JOB_TYPE}: corpus ${corpusInfo.notices} open notices with a profile (${corpusInfo.with_vector} embedded, ${corpusInfo.mesh_mapped} MeSH-mapped), IDF ${corpusInfo.idf_codes} codes${dryRun ? "; DRY RUN" : ""}`);
  let idf: IdfRefreshResult | null = null;
  if (!dryRun && params.refreshIdf !== false) {
    idf = await store.refreshIdf(corpus.idf, at);
    log(`${FIT_RESULTS_JOB_TYPE}: fit_topic_idf ${idf.skipped ? `skipped — ${idf.skipped}` : `${idf.written} rows written, ${idf.deleted} stale deleted (n = ${idf.n})`}`);
  }

  // PR 3.3: before the roster order, the profiles whose applied corrections still owe a re-score (a notice correction the approve action was too big to run itself).
  const rescore = params.rescorePrelude === false ? emptyRescorePrelude("prelude disabled for this run") : await rescoreAppliedCorrections(store, { corpus, at, deadline: Math.min(deadline, started + (params.timeBudgetMs ?? FIT_RESULTS_CRON_TIME_BUDGET_MS) * FIT_RESCORE_PRELUDE_SHARE), dryRun, log });

  const roster = await store.loadRoster();
  const { remaining, batch } = sweepBatch(roster, { cursor: params.cursor, only: params.investigatorIds, limit: params.limit });
  log(`${FIT_RESULTS_JOB_TYPE}: ${roster.length} investigators with a profile (${roster.filter((r) => r.fit_results_at === null).length} never scored), ${remaining.length} after cursor${params.cursor ? ` ${params.cursor}` : ""}, taking up to ${batch.length}${params.limit ? ` (limit ${params.limit})` : ""} within ${Math.round((deadline - started) / 1000)} s`);

  const lines: InvestigatorSweepLine[] = [];
  let budgetExhausted = false;
  let lastId: string | null = null;
  let pairs = 0;
  let upserted = 0;
  let deleted = 0;
  let near_miss = 0;
  for (const entry of batch) {
    if (Date.now() > deadline) {
      budgetExhausted = true;
      break;
    }
    lastId = entry.investigator_id;
    try {
      const r = await rankForInvestigator(store, entry.investigator_id, { corpus, write: !dryRun, now: () => at });
      if (!r) {
        lines.push({ investigator_id: entry.investigator_id, name: entry.name, status: "error", candidates: 0, structural: 0, recall_only: 0, tiers: emptyTiers(), near_miss: 0, upserted: 0, deleted: 0, durationMs: 0, error: "no stored profile", line: `${entry.name ?? entry.investigator_id}: error — no stored profile` });
        continue;
      }
      params.onRanked?.(r);
      const status: InvestigatorSweepLine["status"] = dryRun ? "dry_run" : "written";
      for (const t of TIER_IDS) tiers[t] += r.tiers[t];
      pairs += r.results.length;
      near_miss += r.near_miss.length;
      upserted += r.persisted?.upserted ?? 0;
      deleted += r.persisted?.deleted ?? 0;
      const line = formatSweepLine(r, status);
      log(line);
      lines.push({ investigator_id: r.investigator_id, name: r.name, status, candidates: r.candidates.candidates.length, structural: r.candidates.structural, recall_only: r.candidates.recall_only, tiers: r.tiers, near_miss: r.near_miss.length, upserted: r.persisted?.upserted ?? 0, deleted: r.persisted?.deleted ?? 0, durationMs: r.durationMs, line });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log(`${entry.investigator_id}: ERROR ${message}`);
      lines.push({ investigator_id: entry.investigator_id, name: entry.name, status: "error", candidates: 0, structural: 0, recall_only: 0, tiers: emptyTiers(), near_miss: 0, upserted: 0, deleted: 0, durationMs: 0, error: message, line: `${entry.name ?? entry.investigator_id}: error — ${message}` });
    }
  }

  const finishedList = !budgetExhausted && remaining.length <= batch.length;
  const written = lines.filter((l) => l.status === "written").length;
  const errors = lines.filter((l) => l.status === "error").length;
  const outcome: RefreshOutcome = errors > 0 && written === 0 && !dryRun ? "error" : budgetExhausted || errors > 0 ? "partial" : "success";
  const result: RefreshFitResultsResult = {
    ...base,
    outcome,
    roster: roster.length,
    remaining: remaining.length,
    taken: lines.length,
    written,
    errors,
    pairs,
    upserted,
    deleted,
    near_miss,
    tiers,
    corpus: corpusInfo,
    idf,
    rescore,
    budgetExhausted,
    next_cursor: finishedList ? null : (lastId ?? params.cursor ?? null),
    durationMs: Date.now() - started,
    investigators: lines,
  };
  log(formatRefreshSummary(result));
  return result;
}

// ---------------------------------------------------------------------------
// Supabase store
// ---------------------------------------------------------------------------

export type SupabaseFitStoreDeps = {
  mesh?: MeshIndex;
  log?: (line: string) => void;
};

const PAGE = 500;
const IN_CHUNK = 50;

type ProfileRowRead = Pick<OpportunityFitProfileRow, "opportunity_id" | "taxonomy_version" | "profile" | "confidence" | "computed_at"> & { sources: Partial<Pick<ProfileSources, "complete">> | null };

type EmbeddingRow = { kind: string; ref_id: string; embedding: unknown };

/** Item id → the outreach embedding row for it: publications by PMID, grants by project number, the biosketch, Profiles and directory rows by their fixed ref ids. */
export function embeddingKeyFor(itemId: string, grantProjectNumbers: ReadonlyMap<string, string>): string | null {
  const [kind, ...rest] = itemId.split(":");
  switch (kind) {
    case "publication":
      return rest.length >= 2 ? `publication:${rest[rest.length - 1]}` : null;
    case "grant": {
      const pn = grantProjectNumbers.get(rest.join(":"));
      return pn ? `grant:${pn}` : null;
    }
    case "biosketch":
      return rest[rest.length - 1] === "statement" || rest.length === 1 ? "biosketch:biosketch" : null;
    case "profiles":
      return "profile:profiles";
    case "directory":
      return "focus:focus";
    default:
      return null;
  }
}

export function supabaseFitStore(db: SupabaseClient, deps: SupabaseFitStoreDeps = {}): FitStore {
  let meshPromise: Promise<{ index: MeshIndex; names: MeshNameIndex }> | null = null;
  const mesh = () => {
    if (!meshPromise) {
      meshPromise = (deps.mesh ? Promise.resolve(deps.mesh) : loadMeshIndex(db)).then((index) => ({ index, names: buildMeshNameIndex(index) }));
      meshPromise.catch(() => {
        meshPromise = null;
      });
    }
    return meshPromise;
  };

  type Builder = ReturnType<ReturnType<SupabaseClient["from"]>["select"]>;

  async function pageAll<T>(table: string, columns: string, build: (q: Builder) => Builder, order: (q: Builder) => Builder): Promise<T[]> {
    const rows: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await order(build(db.from(table).select(columns))).range(from, from + PAGE - 1);
      if (error) throw new Error(`${table} read failed: ${error.message}`);
      rows.push(...((data ?? []) as T[]));
      if (!data || data.length < PAGE) break;
    }
    return rows;
  }

  /** Delete the investigator's rows for notices not in `keep` (pairs no longer candidates). */
  async function deleteStale(investigatorId: string, keep: Set<string>): Promise<number> {
    const { data, error } = await db.from("fit_results").select("opportunity_id").eq("investigator_id", investigatorId);
    if (error) throw new Error(`fit_results read failed: ${error.message}`);
    const stale = ((data ?? []) as Array<{ opportunity_id: string }>).map((r) => r.opportunity_id).filter((x) => !keep.has(x));
    for (let i = 0; i < stale.length; i += 100) {
      const { error: delErr } = await db.from("fit_results").delete().eq("investigator_id", investigatorId).in("opportunity_id", stale.slice(i, i + 100));
      if (delErr) throw new Error(`fit_results delete failed: ${delErr.message}`);
    }
    return stale.length;
  }

  async function upsertRows(rows: FitResultRow[]): Promise<number> {
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await db.from("fit_results").upsert(rows.slice(i, i + 100), { onConflict: "investigator_id,opportunity_id" });
      if (error) throw new Error(`fit_results write failed: ${error.message}`);
    }
    return rows.length;
  }

  return {
    async loadCorpus(now) {
      const today = now.toISOString().slice(0, 10);
      const { names } = await mesh();
      const facts = await pageAll<NoticeFacts>("funding_opportunities", NOTICE_FACT_COLUMNS, (q) => q.or(openNoticeFilter(today)), (q) => q.order("id"));
      const factById = new Map(facts.map((f) => [f.id, f]));
      const profiles = await pageAll<ProfileRowRead>("opportunity_fit_profiles", "opportunity_id, taxonomy_version, profile, confidence, sources, computed_at", (q) => q, (q) => q.order("opportunity_id"));
      const open = profiles.filter((p) => factById.has(p.opportunity_id) && p.profile);
      const vectors = new Map<string, number[]>();
      const ids = open.map((p) => p.opportunity_id);
      for (let i = 0; i < ids.length; i += IN_CHUNK) {
        const { data, error } = await db.from("opportunity_embeddings").select("opportunity_id, embedding").in("opportunity_id", ids.slice(i, i + IN_CHUNK));
        if (error) throw new Error(`opportunity_embeddings read failed: ${error.message}`);
        for (const r of (data ?? []) as Array<{ opportunity_id: string; embedding: unknown }>) {
          const v = parseVector(r.embedding);
          if (v) vectors.set(r.opportunity_id, v);
        }
      }
      let mesh_mapped = 0;
      const notices: CorpusNotice[] = open.map((p) => {
        const profile = withNoticeMesh(p.profile, names);
        if (profile !== p.profile) mesh_mapped += 1;
        const f = factById.get(p.opportunity_id)!;
        return {
          profile,
          complete: p.sources?.complete !== false,
          facts: f,
          runway_weeks: runwayWeeks(f, today),
          vector: vectors.get(p.opportunity_id) ?? null,
          computed_at: p.computed_at,
        };
      });
      const idf = computeIdf(notices.map((n) => ({ id: n.profile.opportunity_id, mesh: n.profile.topic.mesh, rcdc: n.profile.topic.rcdc })));
      return { notices, idf, termDf: noticeTermDf(notices.map((n) => n.profile)), today, mesh_mapped, with_vector: vectors.size };
    },

    async loadRoster() {
      type Row = { investigator_id: string; fit_results_at?: string | null; investigators: { full_name: string | null; archived_at: string | null } | Array<{ full_name: string | null; archived_at: string | null }> | null };
      const notArchived = (q: Builder) => q.is("investigators.archived_at", null);
      let rows: Row[];
      try {
        rows = await pageAll<Row>("investigator_fit_profiles", "investigator_id, fit_results_at, investigators!inner(full_name, archived_at)", notArchived, (q) => q.order("fit_results_at", { ascending: true, nullsFirst: true }).order("investigator_id"));
      } catch (e) {
        // Before the PR 2.2 migration the column is not there: id order, nobody scored (a dry run's roster; the sweep itself is skipped on the missing table).
        if (!(e instanceof Error && COLUMN_MISSING.test(e.message))) throw e;
        rows = await pageAll<Row>("investigator_fit_profiles", "investigator_id, investigators!inner(full_name, archived_at)", notArchived, (q) => q.order("investigator_id"));
      }
      return rows.map((r) => {
        const inv = Array.isArray(r.investigators) ? r.investigators[0] : r.investigators;
        return { investigator_id: r.investigator_id, name: inv?.full_name ?? null, fit_results_at: r.fit_results_at ?? null };
      });
    },

    async loadRosterProfiles() {
      const rows = await pageAll<Pick<StoredProfileRow, "investigator_id" | "profile" | "pending_items"> & { investigators: unknown }>("investigator_fit_profiles", "investigator_id, profile, pending_items, investigators!inner(archived_at)", (q) => q.is("investigators.archived_at", null), (q) => q.order("investigator_id"));
      const vectors = new Map<string, number[]>();
      const ids = rows.map((r) => r.investigator_id);
      for (let i = 0; i < ids.length; i += IN_CHUNK) {
        const { data, error } = await db.from("investigator_embeddings").select("investigator_id, embedding").in("investigator_id", ids.slice(i, i + IN_CHUNK));
        if (error) throw new Error(`investigator_embeddings read failed: ${error.message}`);
        for (const r of (data ?? []) as Array<{ investigator_id: string; embedding: unknown }>) {
          const v = parseVector(r.embedding);
          if (v) vectors.set(r.investigator_id, v);
        }
      }
      return rows.map((r) => ({ profile: r.profile, pending_items: r.pending_items ?? 0, docVector: vectors.get(r.investigator_id) ?? null }));
    },

    async loadInvestigator(id, now) {
      const { data: row, error } = await db.from("investigator_fit_profiles").select("investigator_id, taxonomy_version, profile, confidence, item_count, pending_items, computed_at").eq("investigator_id", id).maybeSingle();
      if (error) throw new Error(`investigator_fit_profiles read failed: ${error.message}`);
      const stored = (row as StoredProfileRow | null) ?? null;
      if (!stored) return null;
      const { index } = await mesh();
      const evidence = await collectEvidence(db, id, { mesh: index });
      const rulesCtx: EvaluateContext = { mesh: index, tables: DEFAULT_RULE_TABLES };
      // Rules + the item cache only (modelBudget 0): the request path's rule, and the cron's — the classifier runs in fit-profiles.
      const prefetched = await prefetchedItemProfileCache(db, evidence.items.map(itemCacheKey));
      const budget = new ModelBudget(0);
      const [{ data: vecRows, error: vecErr }, { data: docRow, error: docErr }] = await Promise.all([
        db.from("evidence_embeddings").select("kind, ref_id, embedding").eq("investigator_id", id),
        db.from("investigator_embeddings").select("embedding").eq("investigator_id", id).maybeSingle(),
      ]);
      if (vecErr) throw new Error(`evidence_embeddings read failed: ${vecErr.message}`);
      if (docErr) throw new Error(`investigator_embeddings read failed: ${docErr.message}`);
      const vectors = new Map<string, number[]>();
      for (const r of (vecRows ?? []) as EmbeddingRow[]) {
        const v = parseVector(r.embedding);
        if (v) vectors.set(`${r.kind}:${r.ref_id}`, v);
      }
      const grantProjectNumbers = new Map<string, string>();
      for (const g of evidence.rows.grants) if (g.project_num) grantProjectNumbers.set(g.id, g.project_num);
      const items: ItemInput[] = [];
      let modelPending = 0;
      // N1: the run's instant, so the judge facts' recency weights are byte-identical across a rerun.
      const loadedAt = now ?? new Date();
      for (const item of evidence.items) {
        const c = await classifyWithBudget(item, { rulesCtx, cache: prefetched, budget });
        if (c.model_skipped) modelPending += 1;
        const key = embeddingKeyFor(item.id, grantProjectNumbers);
        const { tf, length } = termCounts([item.title, item.text].filter(Boolean).join(". "));
        items.push({ id: item.id, paradigm: c.profile.paradigm, design: c.profile.design, tf, length, vector: key ? vectors.get(key) ?? null : null, judge: judgeFactsOf(item, c.profile, grantProjectNumbers, loadedAt) });
      }
      const docVector = parseVector((docRow as { embedding?: unknown } | null)?.embedding);
      return {
        profile: stored.profile,
        name: evidence.investigator.full_name ?? null,
        pending_items: stored.pending_items ?? 0,
        computed_at: stored.computed_at,
        items,
        docVector,
        stats: { items: items.length, with_vector: items.filter((i) => i.vector).length, with_text: items.filter((i) => i.tf).length, model_pending: modelPending },
      };
    },

    async persistForInvestigator(investigatorId, rows, at) {
      const upserted = await upsertRows(rows);
      const deleted = await deleteStale(investigatorId, new Set(rows.map((r) => r.opportunity_id)));
      const { error } = await db.from("investigator_fit_profiles").update({ fit_results_at: at }).eq("investigator_id", investigatorId);
      if (error) throw new Error(`investigator_fit_profiles stamp failed: ${error.message}`);
      return { upserted, deleted };
    },

    async persistForNotice(_opportunityId, rows) {
      return { upserted: await upsertRows(rows), deleted: 0 };
    },

    async refreshIdf(idf, now) {
      return refreshTopicIdf(db, idf, now);
    },

    async resultsTableMissing() {
      const { error } = await db.from("fit_results").select("investigator_id").limit(1);
      if (!error) return false;
      if (RESULTS_MISSING_TABLE.test(error.message) || MISSING_TABLE.test(error.message)) return true;
      throw new Error(`fit_results read failed: ${error.message}`);
    },

    async loadAdjudications(filter) {
      let q = db.from("fit_adjudications").select("investigator_id, opportunity_id, profile_versions, blind, skeptic, reconciliation, model, created_at");
      if (filter.investigatorId) q = q.eq("investigator_id", filter.investigatorId);
      if (filter.opportunityId) q = q.eq("opportunity_id", filter.opportunityId);
      const { data, error } = await q.order("created_at", { ascending: false }).limit(2000);
      if (error) {
        // Before the PR 3.1 migration: no adjudications, no stage-8 tiers to keep.
        if (RESULTS_MISSING_TABLE.test(error.message) || MISSING_TABLE.test(error.message)) return [];
        throw new Error(`fit_adjudications read failed: ${error.message}`);
      }
      return (data ?? []) as StoredAdjudication[];
    },

    async loadPendingRescores() {
      const { data, error } = await db.from("fit_corrections").select("id, target, target_id, decided_at").eq("status", "applied").is("rescored_at", null).order("decided_at", { ascending: true }).limit(500);
      if (error) {
        // Before the 3.1 or the 3.3 migration: no corrections table, or no `rescored_at` — nothing is owed.
        if (RESULTS_MISSING_TABLE.test(error.message) || CORRECTIONS_MISSING_TABLE.test(error.message) || COLUMN_MISSING.test(error.message)) return [];
        throw new Error(`fit_corrections read failed: ${error.message}`);
      }
      return (data ?? []) as PendingRescore[];
    },

    async markRescored(ids, at) {
      if (!ids.length) return;
      for (let i = 0; i < ids.length; i += IN_CHUNK) {
        const { error } = await db.from("fit_corrections").update({ rescored_at: at }).in("id", ids.slice(i, i + IN_CHUNK));
        if (error) {
          if (RESULTS_MISSING_TABLE.test(error.message) || CORRECTIONS_MISSING_TABLE.test(error.message) || COLUMN_MISSING.test(error.message)) return;
          throw new Error(`fit_corrections update failed: ${error.message}`);
        }
      }
    },

    async loadCorrectionStatuses(ids) {
      const out = new Map<string, CorrectionStatus>();
      for (let i = 0; i < ids.length; i += IN_CHUNK) {
        const { data, error } = await db.from("fit_corrections").select("id, status").in("id", ids.slice(i, i + IN_CHUNK));
        if (error) {
          // Before the PR 3.1 migration: no rows, the stored statuses stand.
          if (RESULTS_MISSING_TABLE.test(error.message) || MISSING_TABLE.test(error.message)) return out;
          throw new Error(`fit_corrections read failed: ${error.message}`);
        }
        for (const r of (data ?? []) as Array<{ id: string; status: CorrectionStatus }>) out.set(r.id, r.status);
      }
      return out;
    },
  };
}

