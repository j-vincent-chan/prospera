import { describe, expect, it } from "vitest";
import { tokenize } from "@/lib/fit/engine/topic";
import { hydrateInvestigator, hydrateOpportunity } from "@/lib/fit/engine/fixtures";
import type { FitResultRow } from "@/lib/fit/results";
import { bm25Params, retrievalParams } from "@/lib/fit/taxonomy";
import { computeIdf, type IdfComputation, type IdfRefreshResult } from "@/lib/fit/topic/idf";
import {
  bm25StatsFor,
  buildScoreContext,
  embeddingKeyFor,
  formatRefreshSummary,
  noticeTermDf,
  rankForInvestigator,
  rankForNotice,
  recallForInvestigator,
  refreshFitResults,
  rescoreAppliedCorrections,
  rescoreSubjects,
  sweepBatch,
  sweepOrder,
  termCounts,
  topicItemsFor,
  type CorpusNotice,
  type FitCorpus,
  type FitStore,
  type InvestigatorInputs,
  type NoticeFacts,
  type PendingRescore,
  type RosterEntry,
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

type Persisted = { kind: "investigator" | "notice"; id: string; rows: FitResultRow[]; at: string | null };

const entry = (investigator_id: string, name: string | null, fit_results_at: string | null = null): RosterEntry => ({ investigator_id, name, fit_results_at });

/** The roster the store starts with: nobody scored yet. `persistForInvestigator` stamps `fit_results_at`, as the Supabase store does. */
function memoryStore(over: Partial<FitStore> = {}, opts: { roster?: RosterEntry[]; log?: { persisted: Persisted[]; idf: IdfComputation[] } } = {}): FitStore & { log: { persisted: Persisted[]; idf: IdfComputation[] }; roster: RosterEntry[] } {
  const log = opts.log ?? { persisted: [], idf: [] };
  const roster = opts.roster ?? [entry("trialist", "T. Rialist"), entry("mechanist", "M. Echanist"), entry("ghost", null)];
  const investigators = new Map([
    ["mechanist", mechanistInputs],
    ["trialist", trialistInputs],
  ]);
  return {
    log,
    roster,
    loadCorpus: async () => corpus,
    loadRoster: async () => [...roster].sort(sweepOrder),
    loadInvestigator: async (id) => investigators.get(id) ?? null,
    loadRosterProfiles: async () => [
      { profile: mechanist, pending_items: 2, docVector: [1, 0, 0] },
      { profile: trialist, pending_items: 0, docVector: [0, 1, 0] },
    ],
    persistForInvestigator: async (id, rows, at) => {
      log.persisted.push({ kind: "investigator", id, rows, at });
      const r = roster.find((x) => x.investigator_id === id);
      if (r) r.fit_results_at = at;
      return { upserted: rows.length, deleted: 1 };
    },
    persistForNotice: async (id, rows) => (log.persisted.push({ kind: "notice", id, rows, at: null }), { upserted: rows.length, deleted: 0 }),
    refreshIdf: async (idf): Promise<IdfRefreshResult> => (log.idf.push(idf), { n: idf.n, codes: idf.rows.length, written: idf.rows.length, deleted: 0, skipped: null }),
    resultsTableMissing: async () => false,
    ...over,
  };
}

describe("service · pure assembly (spec §8 ctx)", () => {
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
    // 4 + 5 + 4 tokens ("a" is under the tokenizer's minimum length); k1 / b from compose.topic.bm25
    expect(bm25Params()).toMatchObject({ k1: 1.2, b: 0.75 });
    expect(stats).toEqual({ k1: bm25Params().k1, b: bm25Params().b, avg_doc_length: (4 + 5 + 4) / 3, doc_count: 3, doc_freq: corpus.termDf });
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

  it("sweepBatch takes the roster never-scored first, then the oldest stamp, ties by id; the cursor resumes after its position; ids narrow", () => {
    const roster = [entry("c", null, "2026-09-05T00:00:00Z"), entry("a", null), entry("d", null, "2026-09-01T00:00:00Z"), entry("b", null)];
    const ids = (xs: RosterEntry[]) => xs.map((r) => r.investigator_id);
    expect(ids(sweepBatch(roster, {}).batch)).toEqual(["a", "b", "d", "c"]);
    expect(ids(sweepBatch(roster, { limit: 2 }).batch)).toEqual(["a", "b"]);
    expect(sweepBatch(roster, { cursor: "b", limit: 1 })).toEqual({ remaining: [entry("d", null, "2026-09-01T00:00:00Z"), entry("c", null, "2026-09-05T00:00:00Z")], batch: [entry("d", null, "2026-09-01T00:00:00Z")] });
    // a cursor not in the list: from the front
    expect(ids(sweepBatch(roster, { cursor: "zz" }).batch)).toEqual(["a", "b", "d", "c"]);
    expect(ids(sweepBatch(roster, { only: ["c", "d", "zz"] }).batch)).toEqual(["d", "c"]);
    expect(ids(sweepBatch(roster, { only: ["c", "d"], cursor: "d" }).batch)).toEqual(["c"]);
    expect(ids([entry("b", null), entry("a", null)].sort(sweepOrder))).toEqual(["a", "b"]);
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
    expect(persisted.at).toBe(NOW.toISOString());
    expect(store.roster.find((x) => x.investigator_id === "mechanist")!.fit_results_at).toBe(NOW.toISOString());
    expect(persisted.rows.map((x) => x.opportunity_id)).toEqual(["mech-rfa", "broad-rfa", "trial-rfa"]);
    expect(persisted.rows[0]).toMatchObject({ investigator_id: "mechanist", engine_version: mech.taxonomy_version, tier: mech.tier, provenance: expect.objectContaining({ engine: mech.engine_version, T: mech.provenance.T }), rationale: mech.rationale, adjudication: null });
    expect(persisted.rows[0]!.score).toBeCloseTo(mech.score, 3);
    // the Poor row is trimmed: the provenance stub and no rationale; components, caps, why_not, flags and gap kept
    const poorRow = persisted.rows[2]!;
    expect(poorRow.tier).toBe("poor");
    expect(poorRow.provenance).toEqual({ engine: trial.engine_version, E: trial.provenance.E, P: trial.provenance.P });
    expect(poorRow.rationale).toBeNull();
    expect(poorRow).toMatchObject({ components: trial.components, caps: trial.caps, why_not: trial.why_not, flags: trial.flags, gap: trial.gap });
    expect(JSON.stringify(poorRow).length).toBeLessThan(JSON.stringify({ ...poorRow, provenance: trial.provenance, rationale: trial.rationale }).length);
  });

  it("a recall-net hit that fails eligibility is not a candidate and has no row", async () => {
    const store = memoryStore({
      loadCorpus: async () => corpusOf([notice(mechRfa, [1, 0, 0]), notice(trialRfa, [0, 1, 0], { runway_weeks: -1 }), notice(broadRfa, [0.6, 0, 0.8], { complete: false })]),
    });
    const r = await rankForInvestigator(store, "mechanist", { now: () => NOW });
    expect(r!.candidates.candidates.map((c) => c.id)).toEqual(["mech-rfa", "broad-rfa"]);
    expect(r!.candidates.failed_e).toBe(1);
    expect(r!.results.every((x) => x.components.E === 1)).toBe(true);
    expect(store.log.persisted[0]!.rows.map((x) => x.opportunity_id)).toEqual(["mech-rfa", "broad-rfa"]);
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
  it("scores the roster against one notice, recall net included, isolates a candidate that cannot be loaded, and is read-only unless asked to write", async () => {
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
    // read-only by default: nothing persisted, nobody stamped
    expect(r!.persisted).toBeNull();
    expect(store.log.persisted).toEqual([]);
    expect(store.roster.every((x) => x.fit_results_at === null)).toBe(true);
    const written = await rankForNotice(store, "mech-rfa", { now: () => NOW, write: true });
    expect(written!.persisted).toEqual({ upserted: 2, deleted: 0 });
    expect(store.log.persisted[0]).toMatchObject({ kind: "notice", id: "mech-rfa" });
    expect(store.log.persisted[0]!.rows.map((x) => x.investigator_id)).toEqual(["mechanist", "trialist"]);
    expect(await rankForNotice(store, "closed", { write: false })).toBeNull();
  });
});

describe("service · refreshFitResults (the nightly sweep)", () => {
  it("refreshes the IDF, sweeps the whole roster (nobody scored yet: id order) and persists per investigator, stamping each", async () => {
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
    expect(store.roster.map((x) => [x.investigator_id, x.fit_results_at])).toEqual([
      ["trialist", NOW.toISOString()],
      ["mechanist", NOW.toISOString()],
      ["ghost", null],
    ]);
    expect(r.corpus).toEqual({ notices: 3, with_vector: 3, mesh_mapped: 0, idf_codes: corpus.idf.rows.length, idf_n: 3 });
    expect(formatRefreshSummary(r)).toContain("fit_results partial: 3 of 3 investigators (3 with a profile) — 2 written, 1 errors");
    expect(lines.some((l) => l.startsWith("M. Echanist: written"))).toBe(true);
    expect(lines[2]).toMatch(/3 investigators with a profile \(3 never scored\), 3 after cursor, taking up to 3 within/);
  });

  it("the roster is swept never-scored first, then the oldest-scored; a run the time budget stops leaves the rest for the next night, which takes them first", async () => {
    const LATER = new Date("2026-09-07T00:00:00.000Z");
    const store = memoryStore(
      { loadInvestigator: async (id) => (await new Promise((resolve) => setTimeout(resolve, 80)), id === "mechanist" ? mechanistInputs : id === "trialist" ? trialistInputs : null) },
      { roster: [entry("ghost", null, "2026-09-03T00:00:00.000Z"), entry("trialist", "T. Rialist", "2026-09-01T00:00:00.000Z"), entry("mechanist", "M. Echanist")] }
    );
    // never scored first (mechanist), then the oldest stamp (trialist), then ghost; the budget trips after the first
    const night1 = await refreshFitResults(store, { timeBudgetMs: 40, now: () => NOW });
    expect(night1.investigators.map((i) => [i.investigator_id, i.status])).toEqual([["mechanist", "written"]]);
    expect(night1.budgetExhausted).toBe(true);
    expect(night1.outcome).toBe("partial");
    expect(night1.next_cursor).toBe("mechanist");
    expect(night1.remaining).toBe(3);
    expect(store.roster.find((x) => x.investigator_id === "mechanist")!.fit_results_at).toBe(NOW.toISOString());
    // the next night needs no cursor: the untaken lead the order, the one just written is last
    const night2 = await refreshFitResults(store, { now: () => LATER });
    expect(night2.investigators.map((i) => i.investigator_id)).toEqual(["trialist", "ghost", "mechanist"]);
    expect(night2.investigators.map((i) => i.status)).toEqual(["written", "error", "written"]);
    expect(night2.next_cursor).toBeNull();
    // ghost errored and was not restamped (its old stamp stands), so it leads the night after; the two written tonight tie on the stamp and follow by id
    expect((await store.loadRoster()).map((x) => [x.investigator_id, x.fit_results_at])).toEqual([
      ["ghost", "2026-09-03T00:00:00.000Z"],
      ["mechanist", LATER.toISOString()],
      ["trialist", LATER.toISOString()],
    ]);
  });

  it("limit and cursor page a dry run (nothing stamped) in sweep order; the cursor skips the investigator it names, even an errored one", async () => {
    const store = memoryStore();
    const first = await refreshFitResults(store, { limit: 1, dryRun: true, now: () => NOW });
    expect(first.taken).toBe(1);
    expect(first.investigators[0]).toMatchObject({ investigator_id: "ghost", status: "error" });
    expect(first.next_cursor).toBe("ghost");
    expect(first.budgetExhausted).toBe(false);
    const second = await refreshFitResults(store, { limit: 1, dryRun: true, cursor: "ghost", now: () => NOW });
    expect(second.investigators[0]!.investigator_id).toBe("mechanist");
    expect(second.next_cursor).toBe("mechanist");
    const third = await refreshFitResults(store, { limit: 5, dryRun: true, cursor: "mechanist", now: () => NOW });
    expect(third.taken).toBe(1);
    expect(third.investigators[0]!.investigator_id).toBe("trialist");
    expect(third.next_cursor).toBeNull();
    expect(third.outcome).toBe("success");
    expect(store.roster.every((x) => x.fit_results_at === null)).toBe(true);
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

// ---------------------------------------------------------------------------
// PR 3.3: the re-score prelude
// ---------------------------------------------------------------------------

describe("service · the applied-correction re-score prelude (PR 3.3)", () => {
  const pending = (over: Partial<PendingRescore> = {}): PendingRescore => ({ id: "c-1", target: "opportunity_profile", target_id: "trial-rfa", decided_at: "2026-09-06T09:00:00.000Z", ...over });

  /** A store that owes re-scores; `stamped` records what `markRescored` was told. */
  function owing(rows: PendingRescore[], over: Partial<FitStore> = {}) {
    const stamped: Array<{ ids: string[]; at: string }> = [];
    const store = memoryStore({ loadPendingRescores: async () => rows, markRescored: async (ids, at) => void stamped.push({ ids: [...ids], at }), ...over });
    return { store, stamped };
  }

  it("groups the pending corrections into one subject per profile, least tried and oldest decision first", () => {
    const subjects = rescoreSubjects([pending({ id: "c-3", target_id: "broad-rfa", decided_at: "2026-09-06T11:00:00.000Z" }), pending({ id: "c-1" }), pending({ id: "c-2", decided_at: "2026-09-06T10:00:00.000Z" }), pending({ id: "c-4", target: "investigator_profile", target_id: "mechanist", decided_at: "2026-09-06T08:00:00.000Z" })]);
    expect(subjects).toEqual([
      { target: "investigator_profile", target_id: "mechanist", ids: ["c-4"], decided_at: "2026-09-06T08:00:00.000Z", attempts: 0 },
      // The notice's two corrections are one re-score, keyed on the older decision.
      { target: "opportunity_profile", target_id: "trial-rfa", ids: ["c-1", "c-2"], decided_at: "2026-09-06T09:00:00.000Z", attempts: 0 },
      { target: "opportunity_profile", target_id: "broad-rfa", ids: ["c-3"], decided_at: "2026-09-06T11:00:00.000Z", attempts: 0 },
    ]);
  });

  it("a subject whose re-score keeps failing sinks behind the untried ones instead of leading the order every night", () => {
    // The oldest decision has failed before; a subject decided later but never tried goes first.
    const subjects = rescoreSubjects([pending({ id: "c-1", target_id: "broken-rfa", decided_at: "2026-09-01T09:00:00.000Z", rescore_attempts: 2 }), pending({ id: "c-2", target_id: "broken-rfa", decided_at: "2026-09-01T10:00:00.000Z", rescore_attempts: 1 }), pending({ id: "c-3", target_id: "fresh-rfa", decided_at: "2026-09-06T09:00:00.000Z" })]);
    expect(subjects.map((s) => [s.target_id, s.attempts])).toEqual([
      ["fresh-rfa", 0],
      // The subject's count is the highest of its rows: one failed pass takes them all.
      ["broken-rfa", 2],
    ]);
  });

  it("re-scores every investigator against a notice with an applied correction, then stamps every row of that subject", async () => {
    const { store, stamped } = owing([pending(), pending({ id: "c-2" })]);
    const r = await rescoreAppliedCorrections(store, { corpus, at: NOW });
    expect(r).toMatchObject({ pending: 2, subjects: 1, taken: 1, rescored: 1, stamped: 2, deferred: 0, errors: 0 });
    // The notice mirror wrote the roster's rows against that notice.
    expect(store.log.persisted.map((p) => `${p.kind}:${p.id}`)).toEqual(["notice:trial-rfa"]);
    expect(store.log.persisted[0]!.rows.length).toBeGreaterThan(0);
    // Every row the re-score wrote is the engine's again: the stored adjudication was keyed on the profile the correction changed.
    expect(store.log.persisted[0]!.rows.every((row) => row.adjudication === null)).toBe(true);
    expect(stamped).toEqual([{ ids: ["c-1", "c-2"], at: NOW.toISOString() }]);
  });

  it("an investigator correction re-scores that one investigator", async () => {
    const { store } = owing([pending({ target: "investigator_profile", target_id: "mechanist" })]);
    const r = await rescoreAppliedCorrections(store, { corpus, at: NOW });
    expect(r).toMatchObject({ rescored: 1, stamped: 1 });
    expect(store.log.persisted.map((p) => `${p.kind}:${p.id}`)).toEqual(["investigator:mechanist"]);
  });

  it("stamps a subject whose profile is gone — nothing is owed on it any more", async () => {
    const { store, stamped } = owing([pending({ target: "investigator_profile", target_id: "ghost" })]);
    const r = await rescoreAppliedCorrections(store, { corpus, at: NOW });
    expect(r).toMatchObject({ taken: 1, rescored: 0, stamped: 1, errors: 0 });
    expect(r.lines[0]).toMatchObject({ status: "gone" });
    expect(stamped).toEqual([{ ids: ["c-1"], at: NOW.toISOString() }]);
  });

  it("stops at its own deadline and leaves the rest unstamped for the next night; a dry run writes and stamps nothing", async () => {
    const { store, stamped } = owing([pending({ id: "c-1", target_id: "trial-rfa" }), pending({ id: "c-2", target_id: "mech-rfa", decided_at: "2026-09-06T10:00:00.000Z" })]);
    const past = await rescoreAppliedCorrections(store, { corpus, at: NOW, deadline: Date.now() - 1 });
    expect(past).toMatchObject({ subjects: 2, taken: 0, deferred: 2, stamped: 0 });
    expect(stamped).toEqual([]);

    const dry = owing([pending()]);
    const r = await rescoreAppliedCorrections(dry.store, { corpus, at: NOW, dryRun: true });
    expect(r).toMatchObject({ taken: 1, rescored: 1, stamped: 0 });
    expect(dry.store.log.persisted).toEqual([]);
    expect(dry.stamped).toEqual([]);
  });

  it("an error on one subject is recorded, its attempt counted, and the sweep goes on", async () => {
    const attempted: Array<{ ids: string[]; attempts: number }> = [];
    const { store, stamped } = owing([pending({ id: "c-1", target_id: "trial-rfa" }), pending({ id: "c-2", target: "investigator_profile", target_id: "mechanist", decided_at: "2026-09-06T10:00:00.000Z" })], {
      loadRosterProfiles: async () => {
        throw new Error("roster read failed");
      },
      markRescoreAttempt: async (ids, attempts) => void attempted.push({ ids: [...ids], attempts }),
    });
    const r = await rescoreAppliedCorrections(store, { corpus, at: NOW });
    expect(r).toMatchObject({ taken: 2, rescored: 1, errors: 1 });
    expect(r.lines[0]).toMatchObject({ status: "error", error: "roster read failed", attempts: 1 });
    expect(r.lines[1]).toMatchObject({ status: "rescored", target: "investigator_profile" });
    // The failed subject keeps its NULL stamp — the re-score is still owed — but is demoted for the next night.
    expect(attempted).toEqual([{ ids: ["c-1"], attempts: 1 }]);
    expect(stamped).toEqual([{ ids: ["c-2"], at: NOW.toISOString() }]);

    // A store that keeps no counter still runs: the demotion is best-effort, never a reason to end the prelude.
    const plain = owing([pending({ id: "c-1", target_id: "trial-rfa", rescore_attempts: 3 })], {
      loadRosterProfiles: async () => {
        throw new Error("roster read failed");
      },
    });
    const again = await rescoreAppliedCorrections(plain.store, { corpus, at: NOW });
    expect(again).toMatchObject({ errors: 1, stamped: 0 });
    expect(again.lines[0]).toMatchObject({ status: "error", attempts: 4 });
  });

  it("a store that keeps no pending list runs no prelude", async () => {
    const r = await rescoreAppliedCorrections(memoryStore(), { corpus, at: NOW });
    expect(r).toMatchObject({ skipped: "the store keeps no pending re-scores", subjects: 0, taken: 0 });
  });

  it("the nightly runs the prelude before the roster order and reports it in the summary", async () => {
    const { store, stamped } = owing([pending()]);
    const r = await refreshFitResults(store, { now: () => NOW });
    expect(r.rescore).toMatchObject({ pending: 1, subjects: 1, rescored: 1, stamped: 1 });
    // The notice mirror ran first, before any investigator of the roster sweep.
    expect(store.log.persisted[0]).toMatchObject({ kind: "notice", id: "trial-rfa" });
    expect(store.log.persisted.slice(1).every((p) => p.kind === "investigator")).toBe(true);
    expect(stamped).toHaveLength(1);
    expect(formatRefreshSummary(r)).toContain("re-score prelude 1 of 1 profile(s) for 1 applied correction(s)");
    // And it can be turned off for a narrowed manual run.
    const off = owing([pending()]);
    const skipped = await refreshFitResults(off.store, { now: () => NOW, rescorePrelude: false });
    expect(skipped.rescore).toMatchObject({ skipped: "prelude disabled for this run", taken: 0 });
    expect(off.stamped).toEqual([]);
  });
});
