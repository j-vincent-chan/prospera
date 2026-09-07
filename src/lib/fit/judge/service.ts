/**
 * Stage-8 orchestration (plan § PR 3.1 `judge/service.ts`; spec §7 stage 8
 * "Run only for the top ~15 candidates per investigator (or per notice),
 * with a strong model, cached by (profile versions, notice version)"; §16
 * "candidate generation": one targeted sweep over the near-miss set).
 *
 *   judgePairs(store, { investigatorId | opportunityId, top, scout, … })
 *       ranks the investigator (or the notice's roster) in memory through the
 *       PR 2.2 service, selects the top `top` pairs by score plus the first
 *       `scout` near-miss pairs (paradigm-compatible, topic-low), and for each
 *       pair not already adjudicated at the current profile versions runs
 *       the blind pass (two variants), the skeptic (on a provisional Strong
 *       or a blind Strong), the reconciler, validates and routes its
 *       corrections (auto ones patch the stored profile; provisional ones
 *       apply to this pair only and queue for a strategist), re-scores,
 *       applies the reconciliation table, and writes `fit_adjudications` and
 *       the pair's `fit_results` row (tier, caps, rationale, adjudication).
 *       A pair whose every pass came back unusable is not cached — it is
 *       judged again next time.
 *
 *   refreshFitJudge(store, params)
 *       the nightly: the roster never-judged first, then the oldest
 *       (`investigator_fit_profiles.fit_judged_at`), each investigator
 *       through judgePairs, until the run's model budget
 *       (FIT_JUDGE_MODEL_CALLS_PER_RUN, default 150) or its time budget stops
 *       it; the investigator it stopped on is the resume cursor. Skipped,
 *       logged, while `fit_adjudications` is not on the database.
 *
 * Cost per pair: blind 2 variants × 2 calls, skeptic 0–1, reconciler 1 (a
 * scout pair: the same blind calls, the reconciler only when the blind pass
 * found more than the structure did) — ≈ 5–6 calls for a top pair, ≈ 4–5
 * for a scout pair, ≈ 120 calls per investigator at the defaults (top 15,
 * scout 10, two variants); `variants: 1` roughly halves it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MeshIndex } from "@/lib/fit/classify/mesh";
import { loadMeshIndex } from "@/lib/fit/classify/mesh-db";
import { scorePair } from "@/lib/fit/engine";
import { tierRank } from "@/lib/fit/engine/util";
import { pairMask, runBlindPass } from "@/lib/fit/judge/blind";
import { alreadyDecided, applyCorrectionToProfile, CORRECTIONS_MIGRATION, MISSING_TABLE as CORRECTIONS_MISSING_TABLE, supabaseCorrectionStore, toCorrectionRow, type CorrectionContext, type CorrectionRow, type CorrectionStore, type CorrectionTargetTable } from "@/lib/fit/judge/corrections";
import { collaboratorLines, noticeTexts, profileVersionsOf, sameVersions, selectEvidence, type EvidenceCandidate } from "@/lib/fit/judge/inputs";
import type { MaskDescriptor } from "@/lib/fit/judge/mask";
import { judgeModelName, openaiJudge, type JudgeModelFn } from "@/lib/fit/judge/model";
import { finalizeResult, reconcile, runReconciler, toAdjudication } from "@/lib/fit/judge/reconcile";
import { runSkeptic } from "@/lib/fit/judge/skeptic";
import type { AppliedCorrection, JudgeInputs, ReconcilerOutput, SkepticResult, StoredAdjudication } from "@/lib/fit/judge/types";
import { ModelBudget } from "@/lib/fit/profile/model-budget";
import { noticeText } from "@/lib/fit/profile/opportunity";
import type { NoticeSection } from "@/lib/fit/profile/opportunity-extract";
import { MISSING_TABLE as RESULTS_MISSING_TABLE, toFitResultRow, type FitResultRow } from "@/lib/fit/results";
import { buildScoreContext, rankForInvestigator, rankForNotice, supabaseFitStore, type CorpusNotice, type FitCorpus, type FitStore, type InvestigatorInputs } from "@/lib/fit/service";
import { buildMeshNameIndex, mapNoticeMesh, type MeshNameIndex } from "@/lib/fit/topic/notice-mesh";
import type { FitResult, InvestigatorFitProfile, OpportunityFitProfile, Tier } from "@/lib/fit/types";
import { cosine } from "@/lib/fit/vectors";

export const FIT_JUDGE_JOB_TYPE = "fit_judge";
export const FIT_JUDGE_MIGRATION = CORRECTIONS_MIGRATION;
/** The nightly's stop, inside maxDuration 300. */
export const FIT_JUDGE_CRON_TIME_BUDGET_MS = 240_000;
/** Model calls per cron run when FIT_JUDGE_MODEL_CALLS_PER_RUN is unset. */
export const DEFAULT_JUDGE_MODEL_CALLS_PER_RUN = 150;
/** Spec §7 stage 8: "the top ~15 candidates per investigator (or per notice)". */
export const DEFAULT_TOP = 15;
/** Near-miss pairs the scout reads per investigator (the set itself is ~250 pairs on this roster; a decision in code — an operational budget, not a scoring threshold). */
export const DEFAULT_SCOUT = 10;

/** `FIT_JUDGE_MODEL_CALLS_PER_RUN` as a non-negative integer, else the default. */
export function judgeModelCallsPerRun(env: Record<string, string | undefined> = process.env): number {
  const raw = env.FIT_JUDGE_MODEL_CALLS_PER_RUN?.trim();
  if (!raw) return DEFAULT_JUDGE_MODEL_CALLS_PER_RUN;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_JUDGE_MODEL_CALLS_PER_RUN;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export type JudgeRosterEntry = { investigator_id: string; name: string | null; fit_judged_at: string | null };

export type JudgeStore = {
  fit: FitStore;
  corrections: CorrectionStore;
  /** The notice's sectioned Guide text (synopsis fallback), for the judge's notice block and quote verification. */
  loadNoticeSections(opportunityId: string): Promise<NoticeSection[]>;
  /** Descriptor names of the notice's mapped MeSH codes (the corpus maps them at load). */
  noticeMeshNames(profile: Pick<OpportunityFitProfile, "topic">): Promise<string[]>;
  /** MeSH descriptors for names, so the mask reads their trees; unknown names are left out. */
  meshDescriptors(names: readonly string[]): Promise<MaskDescriptor[]>;
  loadAdjudications(filter: { investigatorId?: string; opportunityId?: string }): Promise<StoredAdjudication[]>;
  saveAdjudication(row: StoredAdjudication): Promise<void>;
  saveJudgedResult(row: FitResultRow): Promise<void>;
  stampJudged(investigatorId: string, at: string): Promise<void>;
  /** Investigators with a stored profile, never judged first, then the oldest. */
  loadJudgeRoster(): Promise<JudgeRosterEntry[]>;
  /** True while `fit_adjudications` is not on the database. */
  adjudicationsTableMissing(): Promise<boolean>;
};

// ---------------------------------------------------------------------------
// Selection (pure)
// ---------------------------------------------------------------------------

export type SelectedPair = { result: FitResult; via: "top" | "scout"; rank: number };

/** Pure. The top `top` pairs by score (the ranking's order), then the first `scout` near-miss pairs not among them, by score. */
export function selectPairs(results: readonly FitResult[], nearMiss: readonly FitResult[], opts: { top?: number; scout?: number } = {}): SelectedPair[] {
  const top = Math.max(0, opts.top ?? DEFAULT_TOP);
  const scout = Math.max(0, opts.scout ?? DEFAULT_SCOUT);
  const out: SelectedPair[] = results.slice(0, top).map((result, i) => ({ result, via: "top", rank: i + 1 }));
  const taken = new Set(out.map((p) => p.result.opportunity_id));
  const scouts = nearMiss.filter((r) => !taken.has(r.opportunity_id)).slice(0, scout);
  scouts.forEach((result, i) => out.push({ result, via: "scout", rank: i + 1 }));
  return out;
}

/** Ids of the verified items (publications, grants, trials, biosketch) — the paradigm correction bar excludes priors. */
const VERIFIED_KINDS = new Set(["publication", "grant", "trial", "biosketch_statement", "biosketch_contribution"]);

/** Pure. The judge inputs for one pair from the loaded investigator and the corpus notice. */
export function buildJudgeInputs(inv: InvestigatorInputs, notice: CorpusNotice, sections: NoticeSection[], meshNames: string[]): JudgeInputs {
  const candidates: EvidenceCandidate[] = inv.items.filter((i) => i.judge).map((i) => ({ ...i.judge!, similarity: notice.vector && i.vector ? cosine(notice.vector, i.vector) : null }));
  const texts = noticeTexts(sections, notice.profile);
  return {
    evidence: selectEvidence(candidates, { clinical_trial: notice.profile.mechanism.clinical_trial }),
    collaborators: collaboratorLines(inv.profile),
    notice: {
      opportunity_id: notice.profile.opportunity_id,
      number: notice.profile.number ?? notice.facts.opportunity_number ?? notice.profile.opportunity_id,
      title: notice.facts.title ?? "",
      activity_code: notice.profile.mechanism.activity_code ?? notice.facts.activity_code,
      clinical_trial_designation: notice.profile.mechanism.clinical_trial,
      ...texts,
      topic_terms: [...notice.profile.topic.terms],
      mesh_names: meshNames,
      rcdc: [...notice.profile.topic.rcdc],
      sections,
    },
    characteristics: inv.profile.characteristics,
  };
}

// ---------------------------------------------------------------------------
// One pair
// ---------------------------------------------------------------------------

export type JudgeDeps = {
  model: JudgeModelFn;
  modelName: string;
  budget: ModelBudget;
  deadline?: number | null;
  variants?: 1 | 2;
  dryRun?: boolean;
  now: () => Date;
  log?: (line: string) => void;
};

export type PairOutcome = {
  opportunity_id: string;
  number: string;
  via: "top" | "scout";
  status: "judged" | "cached" | "unusable" | "budget" | "error";
  tier_before: Tier;
  tier_after: Tier | null;
  row: string | null;
  confidence: string | null;
  blind: string | null;
  skeptic: string | null;
  corrections: { auto: number; provisional: number; dropped: number };
  calls: number;
  error?: string;
  /** Written for the dry run's `--no-model` printout and the fixture runner. */
  inputs?: JudgeInputs;
  line: string;
};

type PairContext = { inv: InvestigatorInputs; notice: CorpusNotice; corpus: FitCorpus; sections: NoticeSection[]; meshNames: string[]; descriptors: MaskDescriptor[]; existingCorrections: Map<string, CorrectionRow[]> };

const tierLabel = (t: Tier | null) => t ?? "absent";

/**
 * Judge one pair. Mutates `ctx.inv.profile` when an auto correction is
 * applied (the run's later pairs see the corrected profile, as the stored
 * one now is) and records the pair at the profile versions after that.
 */
export async function judgePair(store: JudgeStore, pair: SelectedPair, ctx: PairContext, deps: JudgeDeps): Promise<PairOutcome> {
  const { inv, notice } = ctx;
  const number = notice.profile.number ?? notice.facts.opportunity_number ?? notice.profile.opportunity_id;
  const base = { opportunity_id: notice.profile.opportunity_id, number, via: pair.via, tier_before: pair.result.tier, corrections: { auto: 0, provisional: 0, dropped: 0 } };
  const scoreCtx = buildScoreContext(inv, notice, ctx.corpus, deps.now().toISOString());
  const engine = pair.result;
  const inputs = buildJudgeInputs(inv, notice, ctx.sections, ctx.meshNames);
  if (deps.budget.exhausted || (deps.deadline != null && Date.now() >= deps.deadline)) {
    return { ...base, status: "budget", tier_after: null, row: null, confidence: null, blind: null, skeptic: null, calls: 0, inputs, line: `${number}: not judged — model budget spent or past the deadline` };
  }
  const takeCall = () => deps.budget.take();
  const mask = pairMask(inputs, ctx.descriptors);
  const scout = pair.via === "scout";
  const blind = await runBlindPass(inputs, { model: deps.model, modelName: deps.modelName, variants: deps.variants ?? 2, scout, takeCall, deadline: deps.deadline, mask, log: deps.log });
  let calls = blind.calls;
  const blindStrong = blind.variants.some((v) => v.usable && v.verdict === "strong");
  let skeptic: SkepticResult | null = null;
  if (engine.tier === "strong" || blindStrong) {
    skeptic = await runSkeptic(inputs, { model: deps.model, modelName: deps.modelName, takeCall, deadline: deps.deadline, log: deps.log });
    calls += skeptic?.calls ?? 0;
  }
  // The scout reads the reconciler only when the blind pass saw more than the structure did.
  const blindHigher = blind.verdict !== null && tierRank(blind.verdict) < tierRank(engine.tier);
  const wantReconciler = !scout || Boolean(blind.latent_fit?.found) || blindHigher;
  let reconciler: ReconcilerOutput | null = null;
  const evidenceIds = inputs.evidence.map((e) => e.id);
  const correctionCtx: CorrectionContext = { evidenceIds, verifiedIds: inputs.evidence.filter((e) => VERIFIED_KINDS.has(e.kind)).map((e) => e.id), sections: ctx.sections, investigator: inv.profile, notice: notice.profile };
  if (wantReconciler) {
    reconciler = await runReconciler({ inputs, engine, blind, skeptic, investigator: inv.profile, notice: notice.profile }, correctionCtx, { model: deps.model, modelName: deps.modelName, takeCall, deadline: deps.deadline, log: deps.log });
    calls += reconciler?.calls ?? 0;
  }
  const anyUsable = blind.variants.some((v) => v.usable) || Boolean(skeptic?.usable) || Boolean(reconciler?.usable);
  if (!anyUsable) {
    const line = `${number}: ${calls ? "unusable replies — not cached" : "not judged — model budget spent"}`;
    return { ...base, status: calls ? "unusable" : "budget", tier_after: null, row: null, confidence: null, blind: null, skeptic: null, calls, inputs, line };
  }

  // Corrections: auto ones patch the investigator profile (stored, and for the rest of this run); provisional ones apply to this pair only.
  const applied: AppliedCorrection[] = [];
  /** The investigator profile with the auto corrections only — what is stored and what later pairs read. */
  let invStored: InvestigatorFitProfile = inv.profile;
  /** The two profiles with every kept correction — what this pair is re-scored on. */
  let invPatched: InvestigatorFitProfile = inv.profile;
  let oppPatched: OpportunityFitProfile = notice.profile;
  let dropped = reconciler?.dropped.filter((d) => d.startsWith("corrections")).length ?? 0;
  const pairKey = { investigator_id: inv.profile.investigator_id, opportunity_id: notice.profile.opportunity_id };
  for (const c of reconciler?.corrections ?? []) {
    const status = c.route === "auto" ? "applied" : "proposed";
    const row = toCorrectionRow(c, pairKey, status, { decidedAt: deps.now().toISOString() });
    const existing = await existingCorrectionsFor(store, ctx.existingCorrections, row.target, row.target_id);
    const prior = alreadyDecided(row, existing);
    if (prior?.status === "rejected") {
      dropped += 1;
      deps.log?.(`correction ${row.target}.${row.path} → ${JSON.stringify(row.to_value)} was rejected before on the same evidence; not re-proposed`);
      continue;
    }
    if (c.target === "investigator") {
      invPatched = applyCorrectionToProfile(invPatched, c);
      if (c.route === "auto") invStored = applyCorrectionToProfile(invStored, c);
    } else oppPatched = applyCorrectionToProfile(oppPatched, c);
    let id: string | null = prior?.id ?? null;
    if (!prior && !deps.dryRun) {
      id = await store.corrections.insertCorrection(row);
      existing.push({ ...row, id, created_at: deps.now().toISOString() });
    }
    applied.push({ correction: c, id, status: prior?.status ?? status });
    if (c.route === "auto") base.corrections.auto += 1;
    else base.corrections.provisional += 1;
  }
  base.corrections.dropped = dropped;
  if (base.corrections.auto) {
    // The stored profile takes the auto corrections; the run's later pairs and the version hash read the same corrected profile.
    if (!deps.dryRun) await store.corrections.saveProfile("investigator_profile", inv.profile.investigator_id, invStored);
    inv.profile = invStored;
  }
  const rescored = applied.length ? scorePair(invPatched, oppPatched, scoreCtx) : engine;
  const reconciliation = reconcile(engine, blind, skeptic, { rescored, corrections: applied, reconciler });
  const final = finalizeResult(rescored, reconciliation);
  const judged_at = deps.now().toISOString();
  const profile_versions = profileVersionsOf(inv.profile, notice.profile);
  const evidence = inputs.evidence.map((e) => ({ id: e.id, ref: e.ref }));
  const adjudication = toAdjudication({ judged_at, model: deps.modelName, profile_versions, blind, skeptic, reconciliation, evidence });
  const stored: StoredAdjudication = { investigator_id: pairKey.investigator_id, opportunity_id: pairKey.opportunity_id, profile_versions, blind, skeptic, reconciliation: { reconciler, result: reconciliation, evidence, engine: { tier: engine.tier, score: engine.score, caps: engine.caps } }, model: deps.modelName, created_at: judged_at };
  if (!deps.dryRun) {
    await store.saveAdjudication(stored);
    await store.saveJudgedResult(toFitResultRow(final, adjudication));
  }
  const line = `${number} (${pair.via} ${pair.rank}): ${engine.tier} → ${final.tier} [${reconciliation.row}, ${reconciliation.confidence}]; blind ${tierLabel(blind.verdict)}${blind.self_consistent ? "" : " (void)"}; skeptic ${skeptic ? (skeptic.objection ? `${skeptic.objection_kind}${skeptic.grounded ? "" : " (ungrounded)"}` : "none") : "not run"}; corrections auto ${base.corrections.auto}, provisional ${base.corrections.provisional}, dropped ${dropped}; ${calls} calls`;
  deps.log?.(line);
  return { ...base, status: "judged", tier_after: final.tier, row: reconciliation.row, confidence: reconciliation.confidence, blind: tierLabel(blind.verdict), skeptic: skeptic ? (skeptic.objection_kind ?? "none") : null, calls, inputs, line };
}

async function existingCorrectionsFor(store: JudgeStore, cache: Map<string, CorrectionRow[]>, target: CorrectionTargetTable, targetId: string): Promise<CorrectionRow[]> {
  const key = `${target}:${targetId}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const rows = await store.corrections.listCorrections({ target, target_id: targetId });
  cache.set(key, rows);
  return rows;
}

// ---------------------------------------------------------------------------
// judgePairs
// ---------------------------------------------------------------------------

export type JudgePairsOptions = {
  investigatorId?: string;
  opportunityId?: string;
  top?: number;
  /** true = DEFAULT_SCOUT near-miss pairs; a number = that many; false / 0 = none. */
  scout?: boolean | number;
  variants?: 1 | 2;
  budget: ModelBudget;
  deadline?: number | null;
  dryRun?: boolean;
  /** Re-judge pairs already adjudicated at the current profile versions. */
  force?: boolean;
  /** Run no pass: select the pairs and build their inputs only (the dry run's `--no-model`). */
  noModel?: boolean;
  model?: JudgeModelFn;
  modelName?: string;
  corpus?: FitCorpus;
  now?: () => Date;
  log?: (line: string) => void;
};

export type JudgePairsResult = {
  subject: { investigator_id: string | null; opportunity_id: string | null; name: string | null };
  selected: number;
  judged: number;
  cached: number;
  unusable: number;
  budget_stopped: number;
  errors: number;
  calls: number;
  corrections: { auto: number; provisional: number; dropped: number };
  changes: Array<{ opportunity_id: string; investigator_id: string; number: string; before: Tier; after: Tier; row: string }>;
  pairs: PairOutcome[];
  budgetExhausted: boolean;
  durationMs: number;
};

/** Stage 8 for one investigator (or one notice). See the module note. */
export async function judgePairs(store: JudgeStore, opts: JudgePairsOptions): Promise<JudgePairsResult> {
  const started = Date.now();
  const now = opts.now ?? (() => new Date());
  const corpus = opts.corpus ?? (await store.fit.loadCorpus(now()));
  const scout = opts.scout === false ? 0 : typeof opts.scout === "number" ? opts.scout : DEFAULT_SCOUT;
  const deps: JudgeDeps = { model: opts.model ?? openaiJudge(), modelName: opts.modelName ?? judgeModelName(), budget: opts.budget, deadline: opts.deadline ?? null, variants: opts.variants, dryRun: opts.dryRun, now, log: opts.log };
  const byId = new Map(corpus.notices.map((n) => [n.profile.opportunity_id, n]));
  const sectionsCache = new Map<string, Promise<NoticeSection[]>>();
  const sectionsOf = (id: string) => {
    let p = sectionsCache.get(id);
    if (!p) {
      p = store.loadNoticeSections(id);
      sectionsCache.set(id, p);
    }
    return p;
  };
  const existingCorrections = new Map<string, CorrectionRow[]>();
  const result: JudgePairsResult = { subject: { investigator_id: opts.investigatorId ?? null, opportunity_id: opts.opportunityId ?? null, name: null }, selected: 0, judged: 0, cached: 0, unusable: 0, budget_stopped: 0, errors: 0, calls: 0, corrections: { auto: 0, provisional: 0, dropped: 0 }, changes: [], pairs: [], budgetExhausted: false, durationMs: 0 };

  type Work = { inv: InvestigatorInputs; pair: SelectedPair };
  const work: Work[] = [];
  if (opts.investigatorId) {
    const ranked = await rankForInvestigator(store.fit, opts.investigatorId, { corpus, write: false, now });
    if (!ranked) throw new Error(`investigator ${opts.investigatorId} has no stored fit profile`);
    result.subject.name = ranked.name;
    const inv = await store.fit.loadInvestigator(opts.investigatorId);
    if (!inv) throw new Error(`investigator ${opts.investigatorId} has no stored fit profile`);
    for (const pair of selectPairs(ranked.results, ranked.near_miss, { top: opts.top, scout })) work.push({ inv, pair });
  } else if (opts.opportunityId) {
    const ranked = await rankForNotice(store.fit, opts.opportunityId, { corpus, write: false, now });
    if (!ranked) throw new Error(`notice ${opts.opportunityId} is not in the open corpus with a fit profile`);
    result.subject.name = ranked.number ?? ranked.title;
    const invs = new Map<string, InvestigatorInputs>();
    for (const pair of selectPairs(ranked.results, ranked.near_miss, { top: opts.top, scout })) {
      let inv = invs.get(pair.result.investigator_id);
      if (!inv) {
        const loaded = await store.fit.loadInvestigator(pair.result.investigator_id);
        if (!loaded) continue;
        inv = loaded;
        invs.set(pair.result.investigator_id, inv);
      }
      work.push({ inv, pair });
    }
  } else throw new Error("judgePairs needs an investigatorId or an opportunityId");
  result.selected = work.length;

  const adjudicated = new Map<string, StoredAdjudication[]>();
  const storedFor = async (investigatorId: string) => {
    let rows = adjudicated.get(investigatorId);
    if (!rows) {
      rows = await store.loadAdjudications(opts.investigatorId ? { investigatorId } : { investigatorId, opportunityId: opts.opportunityId });
      adjudicated.set(investigatorId, rows);
    }
    return rows;
  };

  for (const { inv, pair } of work) {
    const notice = byId.get(pair.result.opportunity_id);
    if (!notice) continue;
    const number = notice.profile.number ?? notice.facts.opportunity_number ?? notice.profile.opportunity_id;
    try {
      const versions = profileVersionsOf(inv.profile, notice.profile);
      const cached = (await storedFor(inv.profile.investigator_id)).find((a) => a.opportunity_id === notice.profile.opportunity_id && sameVersions(a.profile_versions, versions));
      if (cached && !opts.force) {
        result.cached += 1;
        result.pairs.push({ opportunity_id: notice.profile.opportunity_id, number, via: pair.via, status: "cached", tier_before: pair.result.tier, tier_after: cached.reconciliation.result.tier, row: cached.reconciliation.result.row, confidence: cached.reconciliation.result.confidence, blind: tierLabel(cached.blind?.verdict ?? null), skeptic: cached.skeptic?.objection_kind ?? null, corrections: { auto: 0, provisional: 0, dropped: 0 }, calls: 0, line: `${number} (${pair.via} ${pair.rank}): cached at these profile versions — ${cached.reconciliation.result.tier} [${cached.reconciliation.result.row}]` });
        continue;
      }
      const sections = await sectionsOf(notice.profile.opportunity_id);
      const meshNames = await store.noticeMeshNames(notice.profile);
      const names = new Set<string>([...meshNames, ...inv.items.flatMap((i) => i.judge?.mesh_names ?? [])]);
      const descriptors = await store.meshDescriptors(Array.from(names));
      if (opts.noModel) {
        const inputs = buildJudgeInputs(inv, notice, sections, meshNames);
        result.pairs.push({ opportunity_id: notice.profile.opportunity_id, number, via: pair.via, status: "budget", tier_before: pair.result.tier, tier_after: null, row: null, confidence: null, blind: null, skeptic: null, corrections: { auto: 0, provisional: 0, dropped: 0 }, calls: 0, inputs, line: `${number} (${pair.via} ${pair.rank}): ${pair.result.tier} ${pair.result.score.toFixed(1)} — selected; no model` });
        continue;
      }
      const outcome = await judgePair(store, pair, { inv, notice, corpus, sections, meshNames, descriptors, existingCorrections }, deps);
      result.pairs.push(outcome);
      result.calls += outcome.calls;
      result.corrections.auto += outcome.corrections.auto;
      result.corrections.provisional += outcome.corrections.provisional;
      result.corrections.dropped += outcome.corrections.dropped;
      if (outcome.status === "judged") {
        result.judged += 1;
        if (outcome.tier_after && outcome.tier_after !== outcome.tier_before) result.changes.push({ opportunity_id: outcome.opportunity_id, investigator_id: inv.profile.investigator_id, number, before: outcome.tier_before, after: outcome.tier_after, row: outcome.row ?? "" });
      } else if (outcome.status === "unusable") result.unusable += 1;
      else if (outcome.status === "budget") {
        result.budget_stopped += 1;
        result.budgetExhausted = true;
        break;
      }
    } catch (e) {
      result.errors += 1;
      const message = e instanceof Error ? e.message : String(e);
      opts.log?.(`${number}: ERROR ${message}`);
      result.pairs.push({ opportunity_id: notice.profile.opportunity_id, number, via: pair.via, status: "error", tier_before: pair.result.tier, tier_after: null, row: null, confidence: null, blind: null, skeptic: null, corrections: { auto: 0, provisional: 0, dropped: 0 }, calls: 0, error: message, line: `${number}: error — ${message}` });
    }
  }
  result.durationMs = Date.now() - started;
  return result;
}

// ---------------------------------------------------------------------------
// The nightly
// ---------------------------------------------------------------------------

export type RefreshFitJudgeParams = {
  limit?: number;
  cursor?: string | null;
  investigatorIds?: string[];
  maxModelCalls?: number;
  timeBudgetMs?: number;
  top?: number;
  scout?: boolean | number;
  variants?: 1 | 2;
  dryRun?: boolean;
  force?: boolean;
  model?: JudgeModelFn;
  modelName?: string;
  now?: () => Date;
  log?: (line: string) => void;
};

export type JudgeSweepLine = { investigator_id: string; name: string | null; status: "judged" | "dry_run" | "error"; selected: number; judged: number; cached: number; unusable: number; calls: number; changes: number; corrections: { auto: number; provisional: number; dropped: number }; durationMs: number; error?: string; line: string };

export type RefreshFitJudgeResult = {
  ok: true;
  dryRun: boolean;
  outcome: "success" | "partial" | "error" | "skipped";
  roster: number;
  remaining: number;
  taken: number;
  judged_pairs: number;
  cached_pairs: number;
  unusable_pairs: number;
  errors: number;
  calls: number;
  budget: number;
  corrections: { auto: number; provisional: number; dropped: number };
  tier_changes: Array<{ investigator_id: string; opportunity_id: string; number: string; before: Tier; after: Tier; row: string }>;
  budgetExhausted: boolean;
  next_cursor: string | null;
  durationMs: number;
  investigators: JudgeSweepLine[];
  skipped: string | null;
};

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Pure. Never judged first, then the oldest stamp, ties by id. */
export function judgeOrder(a: JudgeRosterEntry, b: JudgeRosterEntry): number {
  if (a.fit_judged_at === null || b.fit_judged_at === null) {
    if (a.fit_judged_at === b.fit_judged_at) return byId(a.investigator_id, b.investigator_id);
    return a.fit_judged_at === null ? -1 : 1;
  }
  return byId(a.fit_judged_at, b.fit_judged_at) || byId(a.investigator_id, b.investigator_id);
}

export function formatJudgeSummary(r: RefreshFitJudgeResult): string {
  if (r.skipped) return `${FIT_JUDGE_JOB_TYPE} skipped: ${r.skipped}`;
  const budget = r.budgetExhausted ? `; budget exhausted, next cursor ${r.next_cursor}` : r.next_cursor ? `; next cursor ${r.next_cursor}` : "";
  return `${FIT_JUDGE_JOB_TYPE}${r.dryRun ? " (dry run)" : ""} ${r.outcome}: ${r.taken} of ${r.remaining} investigators (${r.roster} with a profile) — ${r.judged_pairs} pairs judged, ${r.cached_pairs} cached, ${r.unusable_pairs} unusable, ${r.errors} errors; ${r.calls} of ${r.budget} model calls; corrections auto ${r.corrections.auto}, provisional ${r.corrections.provisional}, dropped ${r.corrections.dropped}; ${r.tier_changes.length} tier changes; ${r.durationMs} ms${budget}`;
}

/** The nightly. Never throws for one investigator's failure; a corpus read failure does. */
export async function refreshFitJudge(store: JudgeStore, params: RefreshFitJudgeParams = {}): Promise<RefreshFitJudgeResult> {
  const started = Date.now();
  const now = params.now ?? (() => new Date());
  const dryRun = Boolean(params.dryRun);
  const deadline = started + (params.timeBudgetMs ?? FIT_JUDGE_CRON_TIME_BUDGET_MS);
  const log = params.log ?? (() => {});
  const budgetN = params.maxModelCalls ?? judgeModelCallsPerRun();
  const budget = new ModelBudget(budgetN);
  const base = { ok: true as const, dryRun, roster: 0, remaining: 0, taken: 0, judged_pairs: 0, cached_pairs: 0, unusable_pairs: 0, errors: 0, calls: 0, budget: budgetN, corrections: { auto: 0, provisional: 0, dropped: 0 }, tier_changes: [], budgetExhausted: false, next_cursor: null, investigators: [], skipped: null };

  if (!dryRun && (await store.adjudicationsTableMissing())) {
    const skipped = `fit_adjudications is not on the database — apply ${FIT_JUDGE_MIGRATION}`;
    log(`${FIT_JUDGE_JOB_TYPE}: ${skipped}`);
    return { ...base, outcome: "skipped", durationMs: Date.now() - started, skipped };
  }
  const model = params.model ?? openaiJudge();
  const modelName = params.modelName ?? judgeModelName();
  const corpus = await store.fit.loadCorpus(now());
  log(`${FIT_JUDGE_JOB_TYPE}: corpus ${corpus.notices.length} open notices with a profile; model ${modelName}; budget ${budgetN} calls${dryRun ? "; DRY RUN" : ""}`);
  const roster = await store.loadJudgeRoster();
  const only = params.investigatorIds?.length ? new Set(params.investigatorIds) : null;
  const ordered = roster.filter((r) => !only || only.has(r.investigator_id)).sort(judgeOrder);
  const at = params.cursor ? ordered.findIndex((r) => r.investigator_id === params.cursor) : -1;
  const remaining = ordered.slice(at + 1);
  const batch = remaining.slice(0, Math.max(1, params.limit ?? remaining.length));
  log(`${FIT_JUDGE_JOB_TYPE}: ${roster.length} investigators with a profile (${roster.filter((r) => r.fit_judged_at === null).length} never judged), ${remaining.length} after cursor, taking up to ${batch.length} within ${Math.round((deadline - started) / 1000)} s`);

  const lines: JudgeSweepLine[] = [];
  const tier_changes: RefreshFitJudgeResult["tier_changes"] = [];
  let budgetExhausted = false;
  let lastId: string | null = null;
  const totals = { judged: 0, cached: 0, unusable: 0, calls: 0, auto: 0, provisional: 0, dropped: 0 };
  for (const entry of batch) {
    if (Date.now() > deadline || budget.exhausted) {
      budgetExhausted = true;
      break;
    }
    lastId = entry.investigator_id;
    try {
      const r = await judgePairs(store, { investigatorId: entry.investigator_id, top: params.top, scout: params.scout, variants: params.variants, budget, deadline, dryRun, force: params.force, model, modelName, corpus, now, log });
      totals.judged += r.judged;
      totals.cached += r.cached;
      totals.unusable += r.unusable;
      totals.calls += r.calls;
      totals.auto += r.corrections.auto;
      totals.provisional += r.corrections.provisional;
      totals.dropped += r.corrections.dropped;
      tier_changes.push(...r.changes.map((c) => ({ investigator_id: c.investigator_id, opportunity_id: c.opportunity_id, number: c.number, before: c.before, after: c.after, row: c.row })));
      const status: JudgeSweepLine["status"] = dryRun ? "dry_run" : "judged";
      const line = `${entry.name ?? entry.investigator_id}: ${status === "dry_run" ? "dry run" : "judged"} — ${r.selected} selected, ${r.judged} judged, ${r.cached} cached, ${r.unusable} unusable, ${r.errors} errors; ${r.calls} calls; ${r.changes.length} tier changes; corrections auto ${r.corrections.auto}, provisional ${r.corrections.provisional}, dropped ${r.corrections.dropped}; ${r.durationMs} ms`;
      log(line);
      lines.push({ investigator_id: entry.investigator_id, name: entry.name, status, selected: r.selected, judged: r.judged, cached: r.cached, unusable: r.unusable, calls: r.calls, changes: r.changes.length, corrections: r.corrections, durationMs: r.durationMs, line });
      if (r.budgetExhausted) {
        budgetExhausted = true;
        if (!dryRun) await store.stampJudged(entry.investigator_id, now().toISOString());
        break;
      }
      if (!dryRun) await store.stampJudged(entry.investigator_id, now().toISOString());
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log(`${entry.investigator_id}: ERROR ${message}`);
      lines.push({ investigator_id: entry.investigator_id, name: entry.name, status: "error", selected: 0, judged: 0, cached: 0, unusable: 0, calls: 0, changes: 0, corrections: { auto: 0, provisional: 0, dropped: 0 }, durationMs: 0, error: message, line: `${entry.name ?? entry.investigator_id}: error — ${message}` });
    }
  }
  const finishedList = !budgetExhausted && remaining.length <= batch.length;
  const errors = lines.filter((l) => l.status === "error").length;
  const outcome: RefreshFitJudgeResult["outcome"] = errors > 0 && lines.length === errors && !dryRun ? "error" : budgetExhausted || errors > 0 ? "partial" : "success";
  const result: RefreshFitJudgeResult = {
    ...base,
    outcome,
    roster: roster.length,
    remaining: remaining.length,
    taken: lines.length,
    judged_pairs: totals.judged,
    cached_pairs: totals.cached,
    unusable_pairs: totals.unusable,
    errors,
    calls: totals.calls,
    corrections: { auto: totals.auto, provisional: totals.provisional, dropped: totals.dropped },
    tier_changes,
    budgetExhausted,
    next_cursor: finishedList ? null : (lastId ?? params.cursor ?? null),
    durationMs: Date.now() - started,
    investigators: lines,
  };
  log(formatJudgeSummary(result));
  return result;
}

// ---------------------------------------------------------------------------
// Supabase store
// ---------------------------------------------------------------------------

const COLUMN_MISSING = /could not find the .*column|column .* does not exist|schema cache/i;

export type SupabaseJudgeStoreDeps = { mesh?: MeshIndex; log?: (line: string) => void };

export function supabaseJudgeStore(db: SupabaseClient, deps: SupabaseJudgeStoreDeps = {}): JudgeStore {
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
  // One descriptor index for both stores.
  const fit = supabaseFitStore(db, { mesh: deps.mesh, log: deps.log });
  const corrections = supabaseCorrectionStore(db);
  const missing = (message: string) => RESULTS_MISSING_TABLE.test(message) || CORRECTIONS_MISSING_TABLE.test(message);

  return {
    fit,
    corrections,
    async loadNoticeSections(opportunityId) {
      const { data, error } = await db.from("funding_opportunities").select("guide_sections, description").eq("id", opportunityId).maybeSingle();
      if (error) throw new Error(`funding_opportunities read failed: ${error.message}`);
      const row = (data as { guide_sections?: unknown; description?: string | null } | null) ?? null;
      if (!row) return [];
      return noticeText({ guide_sections: Array.isArray(row.guide_sections) ? (row.guide_sections as NoticeSection[]) : null, description: row.description ?? null } as Parameters<typeof noticeText>[0]).sections;
    },
    async noticeMeshNames(profile) {
      const { names } = await mesh();
      return Array.from(new Set(mapNoticeMesh(profile.topic, names).matches.map((m) => m.name)));
    },
    async meshDescriptors(namesIn) {
      const { index } = await mesh();
      const out: MaskDescriptor[] = [];
      for (const name of namesIn) {
        const row = index.byName.get(name) ?? (index.byFoldedName.get(name.toLowerCase()) ? index.byName.get(index.byFoldedName.get(name.toLowerCase())!) : undefined);
        if (row) out.push({ name: row.name, tree_numbers: row.tree_numbers, ui: row.ui });
      }
      return out;
    },
    async loadAdjudications(filter) {
      return fit.loadAdjudications ? fit.loadAdjudications(filter) : [];
    },
    async saveAdjudication(row) {
      const { error } = await db.from("fit_adjudications").upsert(row, { onConflict: "investigator_id,opportunity_id,profile_versions" });
      if (error) throw new Error(`fit_adjudications write failed: ${error.message}`);
    },
    async saveJudgedResult(row) {
      const { error } = await db.from("fit_results").upsert(row, { onConflict: "investigator_id,opportunity_id" });
      if (error) throw new Error(`fit_results write failed: ${error.message}`);
    },
    async stampJudged(investigatorId, at) {
      const { error } = await db.from("investigator_fit_profiles").update({ fit_judged_at: at }).eq("investigator_id", investigatorId);
      if (error && !COLUMN_MISSING.test(error.message)) throw new Error(`investigator_fit_profiles stamp failed: ${error.message}`);
    },
    async loadJudgeRoster() {
      type Row = { investigator_id: string; fit_judged_at?: string | null; investigators: { full_name: string | null; archived_at: string | null } | Array<{ full_name: string | null; archived_at: string | null }> | null };
      const read = async (columns: string) => {
        const rows: Row[] = [];
        for (let from = 0; ; from += 500) {
          const { data, error } = await db.from("investigator_fit_profiles").select(columns).is("investigators.archived_at", null).order("investigator_id").range(from, from + 499);
          if (error) throw new Error(`investigator_fit_profiles read failed: ${error.message}`);
          rows.push(...((data ?? []) as unknown as Row[]));
          if (!data || data.length < 500) break;
        }
        return rows;
      };
      let rows: Row[];
      try {
        rows = await read("investigator_id, fit_judged_at, investigators!inner(full_name, archived_at)");
      } catch (e) {
        if (!(e instanceof Error && COLUMN_MISSING.test(e.message))) throw e;
        rows = await read("investigator_id, investigators!inner(full_name, archived_at)");
      }
      return rows
        .map((r) => {
          const inv = Array.isArray(r.investigators) ? r.investigators[0] : r.investigators;
          return { investigator_id: r.investigator_id, name: inv?.full_name ?? null, fit_judged_at: r.fit_judged_at ?? null };
        })
        .sort(judgeOrder);
    },
    async adjudicationsTableMissing() {
      const { error } = await db.from("fit_adjudications").select("investigator_id").limit(1);
      if (!error) return false;
      if (missing(error.message)) return true;
      throw new Error(`fit_adjudications read failed: ${error.message}`);
    },
  };
}


