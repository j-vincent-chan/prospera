import { describe, expect, it } from "vitest";
import { tokenize } from "@/lib/fit/engine/topic";
import { hydrateInvestigator, hydrateOpportunity } from "@/lib/fit/engine/fixtures";
import type { FitResultRow } from "@/lib/fit/results";
import { retrievalParams } from "@/lib/fit/taxonomy";
import { computeIdf, type IdfComputation, type IdfRefreshResult } from "@/lib/fit/topic/idf";
import {
  BM25_B,
  BM25_K1,
  bm25StatsFor,
  buildScoreContext,
  embeddingKeyFor,
  formatRefreshSummary,
  noticeTermDf,
  rankForInvestigator,
  rankForNotice,
  recallForInvestigator,
  refreshFitResults,
  runwayWeeks,
  sweepBatch,
  termCounts,
  topicItemsFor,
  type CorpusNotice,
  type FitCorpus,
  type FitStore,
  type InvestigatorInputs,
  type NoticeFacts,
} from "@/lib/fit/service";

const NOW = new Date("2026-09-06T00:00:00.000Z");
const TODAY = "2026-09-06";

const facts = (id: string, over: Partial<NoticeFacts> = {}): NoticeFacts => ({ id, opportunity_number: id.toUpperCase(), title: `Notice ${id}`, agency: "NIH", close_date: "2027-01-01", next_due: "2026-12-05", expiration_date: null, activity_code: "R01", receipt_cycles: null, ...over });

const mechRfa = hydrateOpportunity("mech-rfa", { mechanism: { activity_code: "R01" }, paradigm: { required: { molecular_cellular_mechanistic: 1 } }, unit: { required: ["L1"] }, design: { required_any: ["wet_lab_experiment", "perturbation"] }, topic: { mesh: ["C04.557.470"], terms: ["ferroptosis", "cholangiocarcinoma"], free_text: "Mechanisms of ferroptosis in cholangiocarcinoma." } });
const trialRfa = hydrateOpportunity("trial-rfa", { mechanism: { activity_code: "R01", clinical_trial: "required" }, paradigm: { required: { clinical_trials: 1 } }, unit: { required: ["L3"] }, design: { required_any: ["rct"] }, topic: { mesh: ["C04"], terms: ["cancer"], free_text: "Trials in cancer." } });
const broadRfa = hydrateOpportunity("broad-rfa", { mechanism: { activity_code: "R21" }, paradigm: { required: { molecular_cellular_mechanistic: 0.8, basic_discovery: 0.6 } }, unit: { required: ["L1"] }, topic: { mesh: ["C04"], terms: ["cancer"], free_text: "Cancer biology broadly." }, confidence: "low" });

function corpusOf(notices: CorpusNotice[]): FitCorpus {
  return {
    notices,
    idf: computeIdf(notices.map((n) => ({ id: n.profile.opportunity_id, mesh: n.profile.topic.mesh, rcdc: n.profile.topic.rcdc }))),
    termDf: noticeTermDf(notices.map((n) => n.profile)),
    today: TODAY,
    mesh_mapped: 0,
    with_vector: notices.filter((n) => n.vector).length,
  };
}

const notice = (profile: CorpusNotice["profile"], vector: number[] | null, over: Partial<CorpusNotice> = {}): CorpusNotice => ({ profile, complete: true, facts: facts(profile.opportunity_id), runway_weeks: 13, vector, computed_at: "2026-09-05T00:00:00.000Z", ...over });

const corpus = corpusOf([notice(mechRfa, [1, 0, 0]), notice(trialRfa, [0, 1, 0]), notice(broadRfa, [0.6, 0, 0.8], { complete: false })]);

const mechanist = hydrateInvestigator("mechanist", { paradigm: { recent: { molecular_cellular_mechanistic: 0.9, basic_discovery: 0.3 } }, unit: { L1: 0.9 }, design: { wet_lab_experiment: 0.8, perturbation: 0.6 }, topic: { mesh_major: ["C04.557.470.200.025.390"] }, characteristics: { esi: false, career_stage: "senior", mechanisms_held: ["R01"], active_awards: 1 }, confidence: { paradigm: "medium", unit: "medium", design: "medium", topic: "medium", materials: "medium", objective: "medium" } });
const trialist = hydrateInvestigator("trialist", { paradigm: { recent: { clinical_trials: 0.9 } }, unit: { L3: 0.9 }, design: { rct: 0.8 }, characteristics: { esi: false, career_stage: "senior", mechanisms_held: ["R01"] } });

const mechanistInputs: InvestigatorInputs = {
  profile: mechanist,
  name: "M. Echanist",
  pending_items: 2,
  computed_at: "2026-09-05T00:00:00.000Z",
  items: [
    { id: "publication:mechanist:1", paradigm: { molecular_cellular_mechanistic: 1 }, design: { wet_lab_experiment: 1 }, ...termCounts("Ferroptosis in cholangiocarcinoma cells"), vector: [1, 0, 0] },
    { id: "publication:mechanist:2", paradigm: { molecular_cellular_mechanistic: 1 }, design: { perturbation: 1 }, ...termCounts("CRISPR screens of iron metabolism"), vector: [0.7, 0.7, 0] },
    { id: "grant:g1", paradigm: { clinical_trials: 1 }, design: { rct: 1 }, ...termCounts("A trial of cancer therapy"), vector: null },
  ],
  docVector: [1, 0, 0],
  stats: { items: 3, with_vector: 2, with_text: 3, model_pending: 1 },
};
const trialistInputs: InvestigatorInputs = { profile: trialist, name: "T. Rialist", pending_items: 0, computed_at: "2026-09-05T00:00:00.000Z", items: [], docVector: [0, 1, 0], stats: { items: 0, with_vector: 0, with_text: 0, model_pending: 0 } };

type Persisted = { kind: "investigator" | "notice"; id: string; rows: FitResultRow[] };

function memoryStore(over: Partial<FitStore> = {}, log: { persisted: Persisted[]; idf: IdfComputation[] } = { persisted: [], idf: [] }): FitStore & { log: typeof log } {
  const investigators = new Map([
    ["mechanist", mechanistInputs],
    ["trialist", trialistInputs],
  ]);
  return {
    log,
    loadCorpus: async () => corpus,
    loadRoster: async () => [
      { investigator_id: "trialist", name: "T. Rialist" },
      { investigator_id: "mechanist", name: "M. Echanist" },
      { investigator_id: "ghost", name: null },
    ],
    loadInvestigator: async (id) => investigators.get(id) ?? null,
    loadRosterProfiles: async () => [
      { profile: mechanist, pending_items: 2, docVector: [1, 0, 0] },
      { profile: trialist, pending_items: 0, docVector: [0, 1, 0] },
    ],
    persistForInvestigator: async (id, rows) => (log.persisted.push({ kind: "investigator", id, rows }), { upserted: rows.length, deleted: 1 }),
    persistForNotice: async (id, rows) => (log.persisted.push({ kind: "notice", id, rows }), { upserted: rows.length, deleted: 0 }),
    refreshIdf: async (idf): Promise<IdfRefreshResult> => (log.idf.push(idf), { n: idf.n, codes: idf.rows.length, written: idf.rows.length, deleted: 0, skipped: null }),
    resultsTableMissing: async () => false,
    ...over,
  };
}

describe("service · pure assembly (spec §8 ctx)", () => {
  it("runway is weeks to next_due, else the receipt-cycle rule, else the close date, else null", () => {
    expect(runwayWeeks(facts("a", { next_due: "2026-12-05" }), TODAY)).toBeCloseTo(90 / 7, 2);
    expect(runwayWeeks(facts("a", { next_due: null, close_date: "2026-09-13", receipt_cycles: null }), TODAY)).toBe(1);
    expect(runwayWeeks(facts("a", { next_due: null, close_date: "2027-01-01", receipt_cycles: [{ due: "2026-10-16", kind: "new" }, { due: "2026-06-16", kind: "new" }] as never }), TODAY)).toBeCloseTo(40 / 7, 2);
    expect(runwayWeeks(facts("a", { next_due: null, close_date: null, expiration_date: null }), TODAY)).toBeNull();
    expect(runwayWeeks(facts("a", { next_due: "2026-09-01" }), TODAY)).toBeCloseTo(-5 / 7, 2);
  });

  it("term counts come from the engine's tokenizer", () => {
    const t = termCounts("T-cell exhaustion, T cell exhaustion!");
    expect(t.length).toBe(tokenize("T-cell exhaustion, T cell exhaustion!").length);
    expect(t.tf).toEqual({ cell: 2, exhaustion: 2 });
    expect(termCounts("")).toEqual({ tf: null, length: 0 });
    expect(termCounts(null)).toEqual({ tf: null, length: 0 });
  });

  it("notice term df counts a notice once per token over terms + free text; BM25 stats mix it with the investigator's item lengths", () => {
    const df = noticeTermDf([mechRfa, trialRfa, broadRfa]);
    expect(df.cancer).toBe(2);
    expect(df.ferroptosis).toBe(1);
    expect(df.in).toBe(2);
    const stats = bm25StatsFor(mechanistInputs.items, corpus);
    // 4 + 5 + 4 tokens ("a" is under the tokenizer's minimum length)
    expect(stats).toEqual({ k1: BM25_K1, b: BM25_B, avg_doc_length: (4 + 5 + 4) / 3, doc_count: 3, doc_freq: corpus.termDf });
    expect(bm25StatsFor([{ id: "x", paradigm: {}, design: {}, tf: null, length: 0, vector: null }], corpus)).toBeNull();
  });

  it("topic items carry the cosine against the notice vector, null when either side has none", () => {
    const items = topicItemsFor(mechanistInputs.items, [1, 0, 0]);
    expect(items.map((i) => i.cosine)).toEqual([1, expect.closeTo(0.7071, 3), null]);
    expect(items[0]).toMatchObject({ id: "publication:mechanist:1", paradigm: { molecular_cellular_mechanistic: 1 }, design: { wet_lab_experiment: 1 }, length: 4 });
    expect(topicItemsFor(mechanistInputs.items, null).every((i) => i.cosine === null)).toBe(true);
  });

  it("buildScoreContext threads pending_items, notice completeness, runway and the corpus IDF", () => {
    const ctx = buildScoreContext(mechanistInputs, corpus.notices[2]!, corpus, "2026-09-06T00:00:00.000Z");
    expect(ctx.now).toBe("2026-09-06T00:00:00.000Z");
    expect(ctx.investigator_pending_items).toBe(2);
    expect(ctx.notice_complete).toBe(false);
    expect(ctx.actionability).toEqual({ runway_weeks: 13, in_pipeline: false, recently_dismissed: false });
    expect(ctx.topic.idf).toBe(corpus.idf.table);
    expect(ctx.topic.idf.weights.C04).toBeCloseTo(Math.log(4 / 4), 12);
    expect(ctx.topic.idf.weights["C04.557.470"]).toBeCloseTo(Math.log(4 / 2), 12);
    expect(ctx.topic.items).toHaveLength(3);
    expect(ctx.topic.bm25?.doc_count).toBe(3);
    expect(ctx.topic.override).toBeNull();
    expect(ctx.infrastructure).toBeNull();
    expect(ctx.track).toEqual({ prior_ucsf_awardees_same_code: null });
    expect(buildScoreContext(mechanistInputs, corpus.notices[0]!, corpus, "x").notice_complete).toBe(true);
  });

  it("the recall net is the top-N notices by the career vector, empty without one", () => {
    expect(recallForInvestigator(mechanistInputs, corpus, 2).map((h) => h.id)).toEqual(["mech-rfa", "broad-rfa"]);
    expect(recallForInvestigator({ docVector: null }, corpus)).toEqual([]);
    expect(recallForInvestigator(mechanistInputs, corpus).length).toBeLessThanOrEqual(retrievalParams().embedding_top_n);
  });

  it("embedding keys follow the outreach store's (kind, ref_id)", () => {
    const grants = new Map([["g1", "5R01AI000001-02"]]);
    expect(embeddingKeyFor("publication:inv:12345", grants)).toBe("publication:12345");
    expect(embeddingKeyFor("grant:g1", grants)).toBe("grant:5R01AI000001-02");
    expect(embeddingKeyFor("grant:g9", grants)).toBeNull();
    expect(embeddingKeyFor("biosketch:inv:statement", grants)).toBe("biosketch:biosketch");
    expect(embeddingKeyFor("biosketch:inv:contribution:2", grants)).toBeNull();
    expect(embeddingKeyFor("profiles:inv", grants)).toBe("profile:profiles");
    expect(embeddingKeyFor("directory:inv", grants)).toBe("focus:focus");
    expect(embeddingKeyFor("trial:inv:NCT1", grants)).toBeNull();
    expect(embeddingKeyFor("self_declared:inv", grants)).toBeNull();
  });

  it("sweepBatch orders by id after the cursor, narrowed to the requested ids", () => {
    const roster = [{ investigator_id: "c", name: null }, { investigator_id: "a", name: null }, { investigator_id: "b", name: null }];
    expect(sweepBatch(roster, { limit: 10 }).batch.map((r) => r.investigator_id)).toEqual(["a", "b", "c"]);
    expect(sweepBatch(roster, { cursor: "a", limit: 1 })).toEqual({ remaining: [{ investigator_id: "b", name: null }, { investigator_id: "c", name: null }], batch: [{ investigator_id: "b", name: null }] });
    expect(sweepBatch(roster, { only: ["c", "zz"], limit: 10 }).batch.map((r) => r.investigator_id)).toEqual(["c"]);
  });
});

describe("service · rankForInvestigator", () => {
  it("scores the structured candidates and the recall net, persists the rows and reports the gap", async () => {
    const store = memoryStore();
    const r = await rankForInvestigator(store, "mechanist", { now: () => NOW });
    expect(r).not.toBeNull();
    expect(r!.candidates.candidates.map((c) => [c.id, c.via])).toEqual([
      ["mech-rfa", "both"],
      ["broad-rfa", "both"],
      ["trial-rfa", "embedding"],
    ]);
    expect(r!.results.map((x) => x.opportunity_id)).toEqual(["mech-rfa", "broad-rfa", "trial-rfa"]);
    const mech = r!.results[0]!;
    expect(mech.components.E).toBe(1);
    expect(mech.components.P).toBeCloseTo(1, 10);
    // the coded half of T: the notice's C04.557.470 is covered exactly by the investigator's deeper code
    expect(mech.provenance.T.coded_matches).toEqual([{ code: "C04.557.470", depth: 3 }]);
    expect(mech.components.T).toBeGreaterThan(0.5);
    expect(mech.caps).toContain("low_profile_confidence");
    expect(mech.computed_at).toBe(NOW.toISOString());
    // topic items: the trial-design grant is not compatible with a wet-lab notice, the two papers are
    expect(mech.provenance.T.top_items).toEqual(["publication:mechanist:1", "publication:mechanist:2"]);
    const trial = r!.results[2]!;
    expect(trial.tier).toBe("poor");
    expect(trial.caps).toContain("paradigm_gate");
    const broad = r!.results[1]!;
    expect(broad.caps).toContain("low_notice_confidence");
    expect(r!.tiers.poor).toBeGreaterThanOrEqual(1);
    expect(r!.near_miss.every((x) => x.components.P >= retrievalParams().near_miss.p_min && x.components.T < retrievalParams().near_miss.t_max)).toBe(true);
    expect(r!.stats).toMatchObject({ items: 3, with_vector: 2, with_text: 3, model_pending: 1, notices: 3 });
    expect(r!.persisted).toEqual({ upserted: 3, deleted: 1 });
    const persisted = store.log.persisted[0]!;
    expect(persisted.kind).toBe("investigator");
    expect(persisted.rows.map((x) => x.opportunity_id)).toEqual(["mech-rfa", "broad-rfa", "trial-rfa"]);
    expect(persisted.rows[0]).toMatchObject({ investigator_id: "mechanist", engine_version: mech.taxonomy_version, tier: mech.tier, provenance: expect.objectContaining({ engine: mech.engine_version }), adjudication: null });
    expect(persisted.rows[0]!.score).toBeCloseTo(mech.score, 3);
  });

  it("write: false scores in memory only; an unknown investigator is null; a rerun is byte-identical", async () => {
    const store = memoryStore();
    const a = await rankForInvestigator(store, "mechanist", { write: false, now: () => NOW });
    const b = await rankForInvestigator(store, "mechanist", { write: false, now: () => NOW, corpus });
    expect(store.log.persisted).toEqual([]);
    expect(a!.persisted).toBeNull();
    expect(JSON.stringify(a!.results)).toBe(JSON.stringify(b!.results));
    expect(await rankForInvestigator(store, "nobody", { write: false })).toBeNull();
  });
});

describe("service · rankForNotice (the mirror)", () => {
  it("scores the roster against one notice, recall net included, and isolates a candidate that cannot be loaded", async () => {
    const store = memoryStore({
      loadRosterProfiles: async () => [
        { profile: mechanist, pending_items: 2, docVector: [1, 0, 0] },
        { profile: trialist, pending_items: 0, docVector: [0, 1, 0] },
        { profile: hydrateInvestigator("ghost", { paradigm: { recent: { molecular_cellular_mechanistic: 0.9 } }, unit: { L1: 0.9 }, design: { wet_lab_experiment: 0.8 } }), pending_items: 0, docVector: null },
      ],
    });
    const r = await rankForNotice(store, "mech-rfa", { now: () => NOW });
    expect(r).not.toBeNull();
    expect(r!.candidates.candidates.map((c) => [c.id, c.via])).toEqual([
      ["mechanist", "both"],
      ["ghost", "structured"],
      ["trialist", "embedding"],
    ]);
    expect(r!.results.map((x) => x.investigator_id)).toEqual(["mechanist", "trialist"]);
    expect(r!.errors).toEqual([{ investigator_id: "ghost", error: "no stored profile" }]);
    expect(r!.results[0]!.tier).not.toBe("poor");
    expect(r!.results[1]!.tier).toBe("poor");
    expect(store.log.persisted[0]).toMatchObject({ kind: "notice", id: "mech-rfa" });
    expect(store.log.persisted[0]!.rows.map((x) => x.investigator_id)).toEqual(["mechanist", "trialist"]);
    expect(await rankForNotice(store, "closed", { write: false })).toBeNull();
  });
});

describe("service · refreshFitResults (the nightly sweep)", () => {
  it("refreshes the IDF, sweeps the roster in id order and persists per investigator", async () => {
    const store = memoryStore();
    const lines: string[] = [];
    const r = await refreshFitResults(store, { now: () => NOW, log: (l) => lines.push(l) });
    expect(r.outcome).toBe("partial");
    expect(r.roster).toBe(3);
    expect(r.taken).toBe(3);
    expect(r.written).toBe(2);
    expect(r.errors).toBe(1);
    expect(r.investigators.map((i) => [i.investigator_id, i.status])).toEqual([
      ["ghost", "error"],
      ["mechanist", "written"],
      ["trialist", "written"],
    ]);
    expect(r.investigators[0]!.error).toBe("no stored profile");
    // the mechanist's three candidates plus the trialist's three (all through the recall net: no structured pass)
    expect(r.pairs).toBe(3 + 3);
    expect(r.next_cursor).toBeNull();
    expect(r.idf).toEqual({ n: 3, codes: corpus.idf.rows.length, written: corpus.idf.rows.length, deleted: 0, skipped: null });
    expect(store.log.idf).toHaveLength(1);
    expect(store.log.persisted.map((p) => p.id)).toEqual(["mechanist", "trialist"]);
    expect(r.corpus).toEqual({ notices: 3, with_vector: 3, mesh_mapped: 0, idf_codes: corpus.idf.rows.length, idf_n: 3 });
    expect(formatRefreshSummary(r)).toContain("fit_results partial: 3 of 3 investigators (3 with a profile) — 2 written, 1 errors");
    expect(lines.some((l) => l.startsWith("M. Echanist: written"))).toBe(true);
  });

  it("limit and cursor page the roster; the time budget stops the run with a resume cursor", async () => {
    const store = memoryStore();
    const first = await refreshFitResults(store, { limit: 1, now: () => NOW });
    expect(first.taken).toBe(1);
    expect(first.investigators[0]!.investigator_id).toBe("ghost");
    expect(first.next_cursor).toBe("ghost");
    expect(first.budgetExhausted).toBe(false);
    const second = await refreshFitResults(store, { limit: 1, cursor: "ghost", now: () => NOW });
    expect(second.investigators[0]!.investigator_id).toBe("mechanist");
    expect(second.next_cursor).toBe("mechanist");
    const third = await refreshFitResults(store, { limit: 5, cursor: "mechanist", now: () => NOW });
    expect(third.taken).toBe(1);
    expect(third.next_cursor).toBeNull();
    expect(third.outcome).toBe("success");
    const out = await refreshFitResults(store, { timeBudgetMs: -1, cursor: "ghost", now: () => NOW });
    expect(out.taken).toBe(0);
    expect(out.budgetExhausted).toBe(true);
    expect(out.next_cursor).toBe("ghost");
    expect(out.outcome).toBe("partial");
  });

  it("a dry run writes neither results nor IDF; explicit ids narrow the sweep", async () => {
    const store = memoryStore();
    const r = await refreshFitResults(store, { dryRun: true, investigatorIds: ["mechanist"], now: () => NOW });
    expect(r.dryRun).toBe(true);
    expect(r.taken).toBe(1);
    expect(r.investigators[0]).toMatchObject({ investigator_id: "mechanist", status: "dry_run", upserted: 0, deleted: 0 });
    expect(r.idf).toBeNull();
    expect(store.log.persisted).toEqual([]);
    expect(store.log.idf).toEqual([]);
    expect(r.outcome).toBe("success");
  });

  it("before the migration the sweep is skipped, not failed", async () => {
    const store = memoryStore({ resultsTableMissing: async () => true });
    const r = await refreshFitResults(store, { now: () => NOW });
    expect(r.outcome).toBe("skipped");
    expect(r.skipped).toMatch(/fit_results is not on the database/);
    expect(r.taken).toBe(0);
    expect(store.log.persisted).toEqual([]);
    expect(formatRefreshSummary(r)).toMatch(/^fit_results skipped/);
  });
});
