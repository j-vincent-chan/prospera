import { describe, expect, it } from "vitest";
import { hydrateOpportunity } from "@/lib/fit/engine/fixtures";
import { tierRank } from "@/lib/fit/engine/util";
import type { CorrectionRow, CorrectionStore } from "@/lib/fit/judge/corrections";
import { JUDGE_CALL_MAX_RETRIES, JUDGE_CALL_TIMEOUT_MS } from "@/lib/fit/judge/model";
import { DEFAULT_JUDGE_MODEL_CALLS_PER_RUN, DEFAULT_SCOUT, DEFAULT_TOP, FIT_JUDGE_CALL_MARGIN_MS, formatJudgeSummary, judgeModelCallsPerRun, judgeOrder, judgePairs, refreshFitJudge, selectPairs, stopLabel, type JudgeRosterEntry, type JudgeStore } from "@/lib/fit/judge/service";
import { CALL_A_OK, callB, EVIDENCE, reconcilerReply, SECTIONS, SKEPTIC_NONE, skepticReply, SLE_TRIAL, stubModel, TRIALIST, type Replies } from "@/lib/fit/judge/test-fixtures";
import type { StoredAdjudication } from "@/lib/fit/judge/types";
import { ModelBudget } from "@/lib/fit/profile/model-budget";
import { toFitResultRow, type FitResultRow } from "@/lib/fit/results";
import { noticeTermDf, rankForInvestigator, rankForNotice, termCounts, withLiveStatuses, type CorpusNotice, type FitCorpus, type FitStore, type InvestigatorInputs, type NoticeFacts, type RosterEntry } from "@/lib/fit/service";
import { computeIdf } from "@/lib/fit/topic/idf";
import type { FitResult } from "@/lib/fit/types";

const NOW = () => new Date("2026-09-06T12:00:00.000Z");

const facts = (id: string, over: Partial<NoticeFacts> = {}): NoticeFacts => ({ id, opportunity_number: id.toUpperCase(), title: `Notice ${id}`, agency: "NIH", close_date: "2027-01-01", next_due: "2026-12-05", expiration_date: null, activity_code: "R01", receipt_cycles: null, ...over });

const cohortRfa = hydrateOpportunity("opp-cohort", { mechanism: { activity_code: "R01", clinical_trial: "not_allowed" }, paradigm: { required: { clinical_observational: 1 } }, unit: { required: ["L4"] }, design: { required_any: ["prospective_cohort", "retrospective_cohort"] }, topic: { mesh: ["C14.280.434"], terms: ["heart failure", "natriuretic peptides"], free_text: "Cohorts of heart failure." } });
const mechRfa = hydrateOpportunity("opp-mech", { mechanism: { activity_code: "R01", clinical_trial: "not_allowed" }, paradigm: { required: { molecular_cellular_mechanistic: 1 }, excluded: { clinical_trials: 1 } }, unit: { required: ["L1"] }, design: { required_any: ["wet_lab_experiment"] }, topic: { mesh: ["C20.111.590"], terms: ["lupus", "interferon"], free_text: "Mechanisms of lupus." } });

const notice = (profile: CorpusNotice["profile"], vector: number[], over: Partial<NoticeFacts> = {}): CorpusNotice => ({ profile, complete: true, facts: facts(profile.opportunity_id, over), runway_weeks: 13, vector, computed_at: "2026-09-05T00:00:00.000Z" });

function corpusOf(notices: CorpusNotice[]): FitCorpus {
  return { notices, idf: computeIdf(notices.map((n) => ({ id: n.profile.opportunity_id, mesh: n.profile.topic.mesh, rcdc: n.profile.topic.rcdc }))), termDf: noticeTermDf(notices.map((n) => n.profile)), today: "2026-09-06", mesh_mapped: 0, with_vector: notices.length };
}

/** The SLE notice without its un-evaluable PD/PI rule (an `eligibility_unknown` cap holds a pair with one at Moderate), so the trialist can reach Strong. */
const SLE_OPEN = { ...SLE_TRIAL, eligibility: { ...SLE_TRIAL.eligibility, investigator_rules: [] } };
/** The trialist with a PI-led RCT record that clears the design floor: rct 0.9 → Strong; 0.7 → Moderate (D 0.73 under the 0.75 floor); 0.1 → Exploratory. */
const STRONG_TRIALIST = { ...TRIALIST, design: { ...TRIALIST.design, rct: 0.9 } };
const WEAK_TRIALIST = { ...TRIALIST, design: { ...TRIALIST.design, rct: 0.1 } };

/** The SLE notice is a two-IC notice on the funding_opportunities row (S4: every token reaches the judge's mask). */
const corpus = corpusOf([notice(SLE_OPEN, [1, 0, 0], { nih_ic_tokens: ["NIAMS", "NIAID"] }), notice(cohortRfa, [0, 1, 0]), notice(mechRfa, [0.9, 0.1, 0])]);

/** The trialist's inputs: the four fixture items with their judge facts, embedded near the SLE notice; the RCT paper and the R01 carry some translational work (the F11 bar for a translational correction). */
function trialistInputs(): InvestigatorInputs {
  return {
    profile: JSON.parse(JSON.stringify(TRIALIST)),
    name: "L. Trialist",
    pending_items: 0,
    computed_at: "2026-09-05T00:00:00.000Z",
    items: EVIDENCE.map((e, i) => ({ id: e.ref, paradigm: i === 0 || i === 2 ? { clinical_trials: 0.8, translational: 0.4 } : { clinical_trials: 1 }, design: { rct: 1 }, ...termCounts(`${e.title}. ${e.text}`), vector: i === 1 ? null : [1, 0, 0], judge: { id: e.id, ref: e.ref, kind: e.kind, year: e.year, role: e.role, title: e.title, text: e.text, mesh_names: e.mesh_names, topic_terms: e.topic_terms, weight: e.weight } })),
    docVector: [1, 0, 0],
    stats: { items: 4, with_vector: 3, with_text: 4, model_pending: 0 },
  };
}

type Memory = {
  store: JudgeStore;
  adjudications: StoredAdjudication[];
  results: FitResultRow[];
  corrections: CorrectionRow[];
  savedProfiles: Array<{ target: string; id: string; profile: unknown }>;
  stamps: Array<{ id: string; at: string }>;
  roster: JudgeRosterEntry[];
  persisted: Array<{ id: string; rows: FitResultRow[] }>;
  /** Every `loadInvestigator` result handed to a run, so a test can read the in-memory profile the run mutates (or must not). */
  loaded: InvestigatorInputs[];
};

function memory(opts: { roster?: JudgeRosterEntry[]; tableMissing?: boolean; profile?: typeof TRIALIST } = {}): Memory {
  const adjudications: StoredAdjudication[] = [];
  const results: FitResultRow[] = [];
  const corrections: CorrectionRow[] = [];
  const savedProfiles: Memory["savedProfiles"] = [];
  const stamps: Memory["stamps"] = [];
  const persisted: Memory["persisted"] = [];
  const loaded: InvestigatorInputs[] = [];
  const roster = opts.roster ?? [{ investigator_id: "inv-lupus", name: "L. Trialist", fit_judged_at: null }];
  let profile = opts.profile ?? STRONG_TRIALIST;
  let seq = 0;
  const fit: FitStore = {
    loadCorpus: async () => corpus,
    loadRoster: async () => roster.map((r): RosterEntry => ({ investigator_id: r.investigator_id, name: r.name, fit_results_at: null })),
    loadInvestigator: async (id) => {
      if (id !== "inv-lupus") return null;
      const inv = { ...trialistInputs(), profile: JSON.parse(JSON.stringify(profile)) };
      loaded.push(inv);
      return inv;
    },
    loadRosterProfiles: async () => [{ profile, pending_items: 0, docVector: [1, 0, 0] }],
    persistForInvestigator: async (id, rows) => (persisted.push({ id, rows }), { upserted: rows.length, deleted: 0 }),
    persistForNotice: async (_id, rows) => ({ upserted: rows.length, deleted: 0 }),
    refreshIdf: async (idf) => ({ n: idf.n, codes: idf.rows.length, written: 0, deleted: 0, skipped: null }),
    resultsTableMissing: async () => false,
    loadAdjudications: async (f) => adjudications.filter((a) => (!f.investigatorId || a.investigator_id === f.investigatorId) && (!f.opportunityId || a.opportunity_id === f.opportunityId)).slice().reverse(),
    loadCorrectionStatuses: async (ids) => new Map(corrections.filter((r) => ids.includes(r.id)).map((r) => [r.id, r.status])),
  };
  const correctionStore: CorrectionStore = {
    loadCorrection: async (id) => corrections.find((r) => r.id === id) ?? null,
    listCorrections: async (f) => corrections.filter((r) => r.target === f.target && r.target_id === f.target_id && (!f.status || r.status === f.status)),
    insertCorrection: async (row) => {
      const id = `c${++seq}`;
      corrections.push({ ...row, id, created_at: NOW().toISOString() });
      return id;
    },
    updateCorrection: async (id, patch) => {
      Object.assign(corrections.find((r) => r.id === id)!, patch);
    },
    loadProfile: async (target) => (target === "investigator_profile" ? profile : SLE_OPEN),
    saveProfile: async (target, id, p) => {
      savedProfiles.push({ target, id, profile: p });
      if (target === "investigator_profile") profile = p as typeof TRIALIST;
    },
    tableMissing: async () => Boolean(opts.tableMissing),
  };
  const store: JudgeStore = {
    fit,
    corrections: correctionStore,
    loadNoticeSections: async (id) => (id === "opp-sle" ? SECTIONS : [{ part: 1, section: "synopsis", heading: "Synopsis", text: `Synopsis of ${id}.` }]),
    noticeMeshNames: async () => ["Lupus Erythematosus, Systemic"],
    meshDescriptors: async (names) => names.filter((n) => n === "Lupus Erythematosus, Systemic").map((n) => ({ name: n, tree_numbers: ["C17.300.480", "C20.111.590"], ui: "D008180" })),
    loadAdjudications: (f) => fit.loadAdjudications!(f),
    saveAdjudication: async (row) => {
      const i = adjudications.findIndex((a) => a.investigator_id === row.investigator_id && a.opportunity_id === row.opportunity_id && JSON.stringify(a.profile_versions) === JSON.stringify(row.profile_versions));
      if (i >= 0) adjudications[i] = row;
      else adjudications.push(row);
    },
    saveJudgedResult: async (row) => {
      const i = results.findIndex((r) => r.investigator_id === row.investigator_id && r.opportunity_id === row.opportunity_id);
      if (i >= 0) results[i] = row;
      else results.push(row);
    },
    stampJudged: async (id, at) => {
      stamps.push({ id, at });
      const r = roster.find((x) => x.investigator_id === id);
      if (r) r.fit_judged_at = at;
    },
    loadJudgeRoster: async () => [...roster].sort(judgeOrder),
    adjudicationsTableMissing: async () => Boolean(opts.tableMissing),
  };
  return { store, adjudications, results, corrections, savedProfiles, stamps, roster, persisted, loaded };
}

/** The last investigator object a run read — the one `judgePair` mutates when an auto correction is stored. */
const lastLoaded = (m: Memory) => m.loaded[m.loaded.length - 1]!;

const happy: Replies = { blind_a: CALL_A_OK, blind_b: callB("strong"), skeptic: SKEPTIC_NONE, reconciler: reconcilerReply() };

describe("judge/service · selection (spec §7 stage 8: the top ~15 plus the near-miss scout set)", () => {
  const r = (id: string, score: number, P = 0.9, T = 0.6): FitResult => ({ opportunity_id: id, score, components: { E: 1, P, U: 1, D: 1, T, M: 1, O: 1, K: 1, A: 1 } }) as unknown as FitResult;

  it("takes the first `top` by the ranking's order, then the first `scout` near-miss pairs not already taken", () => {
    const results = [r("a", 90), r("b", 80), r("c", 70), r("d", 60, 0.5, 0.2), r("e", 50, 0.5, 0.1), r("f", 40, 0.5, 0.3)];
    const nearMiss = [r("d", 60, 0.5, 0.2), r("e", 50, 0.5, 0.1), r("f", 40, 0.5, 0.3)];
    const picked = selectPairs(results, nearMiss, { top: 4, scout: 1 });
    expect(picked.map((p) => `${p.via}:${p.result.opportunity_id}:${p.rank}`)).toEqual(["top:a:1", "top:b:2", "top:c:3", "top:d:4", "scout:e:1"]);
    expect(selectPairs(results, nearMiss, { top: 2, scout: 0 })).toHaveLength(2);
    expect(selectPairs(results, nearMiss).length).toBeLessThanOrEqual(DEFAULT_TOP + DEFAULT_SCOUT);
    expect(DEFAULT_TOP).toBe(15);
  });

  it("the model budget reads FIT_JUDGE_MODEL_CALLS_PER_RUN, default 150; the roster order is never-judged first, then the oldest", () => {
    expect(judgeModelCallsPerRun({})).toBe(DEFAULT_JUDGE_MODEL_CALLS_PER_RUN);
    expect(DEFAULT_JUDGE_MODEL_CALLS_PER_RUN).toBe(150);
    expect(judgeModelCallsPerRun({ FIT_JUDGE_MODEL_CALLS_PER_RUN: " 12 " })).toBe(12);
    expect(judgeModelCallsPerRun({ FIT_JUDGE_MODEL_CALLS_PER_RUN: "-1" })).toBe(150);
    const list: JudgeRosterEntry[] = [{ investigator_id: "b", name: null, fit_judged_at: "2026-09-01T00:00:00Z" }, { investigator_id: "c", name: null, fit_judged_at: null }, { investigator_id: "a", name: null, fit_judged_at: "2026-08-01T00:00:00Z" }, { investigator_id: "d", name: null, fit_judged_at: null }];
    expect([...list].sort(judgeOrder).map((x) => x.investigator_id)).toEqual(["c", "d", "a", "b"]);
  });
});

describe("judge/service · judgePairs", () => {
  it("judges the selected pairs with the stub model, writes fit_adjudications and the fit_results rows with the adjudication, and counts the calls", async () => {
    const m = memory();
    const { fn, calls } = stubModel(happy);
    const r = await judgePairs(m.store, { investigatorId: "inv-lupus", top: 2, scout: 1, budget: new ModelBudget(100), model: fn, modelName: "test-model", now: NOW });
    expect(r.subject).toEqual({ investigator_id: "inv-lupus", opportunity_id: null, name: "L. Trialist" });
    expect(r.selected).toBeGreaterThanOrEqual(2);
    expect(r.judged).toBe(r.selected);
    expect(r.cached).toBe(0);
    expect(r.calls).toBe(calls.length);
    expect(calls.every((c) => c.model === "test-model")).toBe(true);
    expect(m.adjudications).toHaveLength(r.selected);
    expect(m.results).toHaveLength(r.selected);
    const sle = m.results.find((x) => x.opportunity_id === "opp-sle")!;
    expect(sle.adjudication).toMatchObject({ version: "judge-1", model: "test-model", judged_at: NOW().toISOString(), blind: { verdict: "strong", self_consistent: true }, reconciliation: { tier: sle.tier } });
    expect(sle.adjudication!.evidence.map((e) => e.id)).toEqual(expect.arrayContaining(["PMID:31000001", "NCT04000001", "biosketch:statement"]));
    const stored = m.adjudications.find((a) => a.opportunity_id === "opp-sle")!;
    expect(stored.profile_versions).toEqual(sle.adjudication!.profile_versions);
    expect(stored.reconciliation.result.row).toBe(sle.adjudication!.reconciliation.row);
    expect(stored.blind!.variants).toHaveLength(2);
    expect(r.pairs.every((p) => p.status === "judged")).toBe(true);
    // the skeptic ran on every pair the blind pass called Strong; the reconciler on every top pair
    const skeptics = calls.filter((c) => c.purpose === "skeptic").length;
    expect(skeptics).toBe(r.selected);
    const scoutPairs = r.pairs.filter((p) => p.via === "scout");
    for (const p of scoutPairs) expect(p.line).toContain("(scout 1)");
  });

  it("a second run at the same profile versions is served from the cache with no model call; `force` re-judges", async () => {
    const m = memory();
    const first = stubModel(happy);
    const r1 = await judgePairs(m.store, { investigatorId: "inv-lupus", top: 2, scout: 0, budget: new ModelBudget(100), model: first.fn, modelName: "m", now: NOW });
    expect(r1.judged).toBe(2);
    const second = stubModel(happy);
    const r2 = await judgePairs(m.store, { investigatorId: "inv-lupus", top: 2, scout: 0, budget: new ModelBudget(100), model: second.fn, modelName: "m", now: NOW });
    expect(r2).toMatchObject({ judged: 0, cached: 2, calls: 0 });
    expect(second.calls).toHaveLength(0);
    expect(r2.pairs[0]!.line).toContain("cached at these profile versions");
    const third = stubModel(happy);
    const r3 = await judgePairs(m.store, { investigatorId: "inv-lupus", top: 2, scout: 0, budget: new ModelBudget(100), model: third.fn, modelName: "m", now: NOW, force: true });
    expect(r3.judged).toBe(2);
    expect(m.adjudications).toHaveLength(2);
  });

  it("unusable replies are never cached: no adjudication row, no result row, the pair is due again", async () => {
    const m = memory();
    const { fn } = stubModel({ blind_a: "not json", blind_b: "not json", skeptic: "{", reconciler: "[]" });
    const r = await judgePairs(m.store, { investigatorId: "inv-lupus", top: 1, scout: 0, budget: new ModelBudget(100), model: fn, modelName: "m", now: NOW });
    expect(r).toMatchObject({ judged: 0, unusable: 1 });
    expect(r.calls).toBeGreaterThan(0);
    expect(m.adjudications).toHaveLength(0);
    expect(m.results).toHaveLength(0);
    expect(r.pairs[0]!.line).toContain("unusable replies — not cached");
  });

  it("F1 · a pair any of whose calls was refused — budget or deadline, in any pass — is `budget`: nothing persisted, the pair due again, the loop ended", async () => {
    const m = memory();
    const { fn, calls } = stubModel(happy);
    const r = await judgePairs(m.store, { investigatorId: "inv-lupus", top: 3, scout: 0, budget: new ModelBudget(3), model: fn, modelName: "m", now: NOW });
    // A1, B1, A2 made; B2 refused — the skeptic and the reconciler are not even tried
    expect(calls.map((c) => `${c.purpose}${c.variant ?? ""}`)).toEqual(["blind_a1", "blind_b1", "blind_a2"]);
    expect(r.pairs[0]).toMatchObject({ status: "budget", stopped_by: "budget", calls: 3 });
    expect(r.pairs[0]!.line).toContain("model budget spent after 3 call(s); nothing kept, due again");
    expect(r).toMatchObject({ judged: 0, budget_stopped: 1, errors: 0, budgetExhausted: true, stopped_by: "budget", stop_error: null, calls: 3 });
    expect(r.pairs).toHaveLength(1);
    expect(m.adjudications).toHaveLength(0);
    expect(m.results).toHaveLength(0);
    expect(m.corrections).toHaveLength(0);
    // a refusal in the skeptic or the reconciler is the same: five calls make both blind variants and the skeptic, the reconciler is refused
    const five = stubModel(happy);
    const r5 = await judgePairs(m.store, { investigatorId: "inv-lupus", top: 1, scout: 0, budget: new ModelBudget(5), model: five.fn, modelName: "m", now: NOW });
    expect(five.calls.map((c) => c.purpose)).toEqual(["blind_a", "blind_b", "blind_a", "blind_b", "skeptic"]);
    expect(r5.pairs[0]).toMatchObject({ status: "budget", stopped_by: "budget", calls: 5 });
    expect(m.adjudications).toHaveLength(0);
    // the deadline is read through `now` (N1); no call starts within FIT_JUDGE_CALL_MARGIN_MS of it (F8)
    const past = stubModel(happy);
    const late = await judgePairs(m.store, { investigatorId: "inv-lupus", top: 1, scout: 0, budget: new ModelBudget(100), deadline: NOW().getTime() - 1, model: past.fn, modelName: "m", now: NOW });
    expect(late.pairs[0]).toMatchObject({ status: "budget", stopped_by: "deadline", calls: 0 });
    expect(late.pairs[0]!.line).toContain("past the deadline after 0 call(s)");
    expect(late).toMatchObject({ stopped_by: "deadline", budgetExhausted: true });
    expect(past.calls).toHaveLength(0);
    // S2: the deadline is checked before the budget, so a run past both is stopped by the deadline
    const both = await judgePairs(m.store, { investigatorId: "inv-lupus", top: 1, scout: 0, budget: new ModelBudget(0), deadline: NOW().getTime() - 1, model: stubModel(happy).fn, modelName: "m", now: NOW });
    expect(both.stopped_by).toBe("deadline");
    // S1: the arithmetic closes — the margin equals the client's timeout and the client makes no retry, so a call started at deadline − margin ends by the deadline
    expect(FIT_JUDGE_CALL_MARGIN_MS).toBe(90_000);
    expect(FIT_JUDGE_CALL_MARGIN_MS).toBe(JUDGE_CALL_TIMEOUT_MS);
    expect(JUDGE_CALL_MAX_RETRIES).toBe(0);
    const margin = stubModel(happy);
    const within = await judgePairs(m.store, { investigatorId: "inv-lupus", top: 1, scout: 0, budget: new ModelBudget(100), deadline: NOW().getTime() + FIT_JUDGE_CALL_MARGIN_MS - 1, model: margin.fn, modelName: "m", now: NOW });
    expect(within.pairs[0]).toMatchObject({ status: "budget", stopped_by: "deadline" });
    expect(margin.calls).toHaveLength(0);
    const clear = stubModel(happy);
    const ok = await judgePairs(m.store, { investigatorId: "inv-lupus", top: 1, scout: 0, budget: new ModelBudget(100), deadline: NOW().getTime() + FIT_JUDGE_CALL_MARGIN_MS + 1, model: clear.fn, modelName: "m", now: NOW });
    expect(ok.pairs[0]).toMatchObject({ status: "judged", stopped_by: null });
    expect(ok.stopped_by).toBeNull();
    expect(m.adjudications).toHaveLength(1);
  });

  it("S5 · a refused skeptic leaves nothing behind: budget 4 on a Strong engine (the first skeptic refused), and the F2 setup at budget = calls − 1 (the late skeptic refused) — no correction row, no saveProfile, the in-memory profile untouched", async () => {
    // budget 4: both blind variants are made, the skeptic the Strong engine asks for is refused
    const strong = memory();
    const four = stubModel(happy);
    const r4 = await judgePairs(strong.store, { investigatorId: "inv-lupus", top: 1, scout: 0, budget: new ModelBudget(4), model: four.fn, modelName: "m", now: NOW });
    expect(four.calls.map((c) => `${c.purpose}${c.variant ?? ""}`)).toEqual(["blind_a1", "blind_b1", "blind_a2", "blind_b2"]);
    expect(r4.pairs[0]).toMatchObject({ status: "budget", stopped_by: "budget", calls: 4, corrections: { auto: 0, provisional: 0, dropped: 0 } });
    expect(strong.corrections).toHaveLength(0);
    expect(strong.savedProfiles).toHaveLength(0);
    expect(strong.adjudications).toHaveLength(0);
    expect(lastLoaded(strong).profile).toEqual(STRONG_TRIALIST);
    // the F2 setup: a Moderate blind verdict, an auto correction that makes S0 Strong, so the skeptic is asked for late — count the calls of a full run, then refuse the last one
    const reply = reconcilerReply({ corrections: [{ target: "investigator", path: "design.rct", from: 0.1, to: 0.9, evidence_ids: ["NCT04000001"], quote: null, section: null, kind: "ingest_miss", confidence: "high" }] });
    const replies: Replies = { ...happy, blind_b: callB("moderate"), skeptic: skepticReply("scale_role", { gate_level: false, evidence_ids: ["NCT04000001"] }), reconciler: reply };
    const full = stubModel(replies);
    const whole = await judgePairs(memory({ profile: WEAK_TRIALIST }).store, { investigatorId: "inv-lupus", top: 1, scout: 0, budget: new ModelBudget(100), model: full.fn, modelName: "m", now: NOW });
    expect(whole.pairs[0]).toMatchObject({ status: "judged", corrections: { auto: 1 } });
    expect(full.calls[full.calls.length - 1]!.purpose).toBe("skeptic");
    const weak = memory({ profile: WEAK_TRIALIST });
    const short = stubModel(replies);
    const r = await judgePairs(weak.store, { investigatorId: "inv-lupus", top: 1, scout: 0, budget: new ModelBudget(full.calls.length - 1), model: short.fn, modelName: "m", now: NOW });
    expect(short.calls.map((c) => c.purpose)).toEqual(full.calls.slice(0, -1).map((c) => c.purpose));
    expect(r.pairs[0]).toMatchObject({ status: "budget", stopped_by: "budget", calls: full.calls.length - 1, corrections: { auto: 0, provisional: 0, dropped: 0 } });
    expect(r).toMatchObject({ judged: 0, budget_stopped: 1, budgetExhausted: true, stopped_by: "budget" });
    expect(weak.corrections).toHaveLength(0);
    expect(weak.savedProfiles).toHaveLength(0);
    expect(weak.adjudications).toHaveLength(0);
    expect(weak.results).toHaveLength(0);
    expect(lastLoaded(weak).profile.design.rct).toBe(0.1);
  });

  it("S3 · a thrown model call is a refusal: the pair is `error` with the message, nothing is persisted, the profile is untouched, and the run stops with `stopped_by: error`", async () => {
    const m = memory();
    const boom = async () => {
      throw new Error("401 invalid api key");
    };
    const r = await judgePairs(m.store, { investigatorId: "inv-lupus", top: 3, scout: 0, budget: new ModelBudget(100), model: boom, modelName: "m", now: NOW });
    expect(r.pairs).toHaveLength(1);
    expect(r.pairs[0]).toMatchObject({ status: "error", stopped_by: "error", error: "401 invalid api key", calls: 1 });
    expect(r.pairs[0]!.line).toContain("model call failed (401 invalid api key) after 1 call(s); nothing kept, due again");
    expect(r).toMatchObject({ judged: 0, errors: 1, budget_stopped: 0, calls: 1, budgetExhausted: true, stopped_by: "error", stop_error: "401 invalid api key" });
    expect(m.adjudications).toHaveLength(0);
    expect(m.results).toHaveLength(0);
    // the late skeptic (the F2 setup) throwing after the reconciler decided an auto correction: no correction row, no saveProfile, the in-memory profile untouched
    const weak = memory({ profile: WEAK_TRIALIST });
    const reply = reconcilerReply({ corrections: [{ target: "investigator", path: "design.rct", from: 0.1, to: 0.9, evidence_ids: ["NCT04000001"], quote: null, section: null, kind: "ingest_miss", confidence: "high" }] });
    const timeout = stubModel({
      ...happy,
      blind_b: callB("moderate"),
      reconciler: reply,
      skeptic: () => {
        throw new Error("Request timed out.");
      },
    });
    const late = await judgePairs(weak.store, { investigatorId: "inv-lupus", top: 1, scout: 0, budget: new ModelBudget(100), model: timeout.fn, modelName: "m", now: NOW });
    expect(timeout.calls.map((c) => c.purpose)).toEqual(["blind_a", "blind_b", "blind_a", "blind_b", "reconciler", "skeptic"]);
    expect(late.pairs[0]).toMatchObject({ status: "error", stopped_by: "error", error: "Request timed out.", calls: 6, corrections: { auto: 0, provisional: 0, dropped: 0 } });
    expect(weak.corrections).toHaveLength(0);
    expect(weak.savedProfiles).toHaveLength(0);
    expect(weak.adjudications).toHaveLength(0);
    expect(lastLoaded(weak).profile.design.rct).toBe(0.1);
  });

  it("a dry run stores nothing and leaves the in-memory profile alone, so its later pairs stay cache hits; the stored value is untouched", async () => {
    const m = memory({ profile: WEAK_TRIALIST });
    // the two other notices judged for real at the stored (uncorrected) profile — cache entries the dry run must still hit
    for (const opportunityId of ["opp-cohort", "opp-mech"]) await judgePairs(m.store, { opportunityId, top: 5, scout: 0, budget: new ModelBudget(100), model: stubModel(happy).fn, modelName: "m", now: NOW });
    expect(m.adjudications.map((a) => a.opportunity_id).sort()).toEqual(["opp-cohort", "opp-mech"]);
    const reply = reconcilerReply({ corrections: [{ target: "investigator", path: "design.rct", from: 0.1, to: 0.9, evidence_ids: ["NCT04000001"], quote: null, section: null, kind: "ingest_miss", confidence: "high" }] });
    const { fn, calls } = stubModel({ ...happy, blind_b: callB("moderate"), skeptic: skepticReply("scale_role", { gate_level: false, evidence_ids: ["NCT04000001"] }), reconciler: reply });
    const dry = await judgePairs(m.store, { investigatorId: "inv-lupus", top: 3, scout: 0, budget: new ModelBudget(100), model: fn, modelName: "m", now: NOW, dryRun: true });
    expect(dry.pairs.map((p) => `${p.opportunity_id}:${p.status}`)[0]).toBe("opp-sle:judged");
    expect(dry).toMatchObject({ judged: 1, cached: 2, corrections: { auto: 1 } });
    expect(calls.length).toBe(dry.calls);
    expect(m.corrections).toHaveLength(0);
    expect(m.savedProfiles).toHaveLength(0);
    expect(m.adjudications).toHaveLength(2);
    expect(lastLoaded(m).profile.design.rct).toBe(0.1);
  });

  it("an auto correction whose value a still-open row already proposes marks that row applied with the profile patch, instead of inserting a second one", async () => {
    const m = memory({ profile: { ...TRIALIST, design: { ...TRIALIST.design, rct: 0.1 } } });
    // a strategist's own open proposal of the same value
    m.corrections.push({ id: "c-strategist", target: "investigator_profile", target_id: "inv-lupus", path: "design.rct", from_value: 0.1, to_value: 0.7, evidence: { ids: [], quote: null, section: null, confidence: "medium", pair: null }, kind: "profile_weight", proposed_by: "strategist", status: "proposed", decided_by: null, created_at: "2026-09-01T00:00:00.000Z", decided_at: null });
    const reply = reconcilerReply({ corrections: [{ target: "investigator", path: "design.rct", from: 0.1, to: 0.7, evidence_ids: ["NCT04000001"], quote: null, section: null, kind: "ingest_miss", confidence: "high" }] });
    const r = await judgePairs(m.store, { investigatorId: "inv-lupus", top: 1, scout: 0, budget: new ModelBudget(100), model: stubModel({ ...happy, reconciler: reply }).fn, modelName: "m", now: NOW });
    expect(r.corrections).toEqual({ auto: 1, provisional: 0, dropped: 0 });
    expect(m.corrections).toHaveLength(1);
    expect(m.corrections[0]).toMatchObject({ id: "c-strategist", status: "applied", decided_at: NOW().toISOString() });
    expect(m.savedProfiles).toHaveLength(1);
    expect((m.savedProfiles[0]!.profile as typeof TRIALIST).design.rct).toBe(0.7);
    expect(m.adjudications[0]!.reconciliation.result.corrections.map((c) => `${c.correction.path}:${c.correction.route}:${c.status}:${c.id}`)).toEqual(["design.rct:auto:applied:c-strategist"]);
  });

  it("F2 · the engine is scored fresh, S0 is the stored profile after the auto corrections, the sweep re-derives the identical row, and a forced re-judge never stacks stage-8 caps", async () => {
    const m = memory({ profile: WEAK_TRIALIST });
    const reply = reconcilerReply({ corrections: [{ target: "investigator", path: "design.rct", from: 0.1, to: 0.9, evidence_ids: ["NCT04000001"], quote: null, section: null, kind: "ingest_miss", confidence: "high" }] });
    // blind Moderate with a grounded scale_role objection: R2 lowers a Strong S0 to Moderate with stage8_objection
    const replies: Replies = { ...happy, blind_b: callB("moderate"), skeptic: skepticReply("scale_role", { gate_level: false, evidence_ids: ["NCT04000001"] }), reconciler: reply };
    const r1 = await judgePairs(m.store, { investigatorId: "inv-lupus", top: 1, scout: 0, budget: new ModelBudget(100), model: stubModel(replies).fn, modelName: "m", now: NOW });
    const first = m.results.find((x) => x.opportunity_id === "opp-sle")!;
    const adj1 = m.adjudications[0]!;
    expect(r1.corrections.auto).toBe(1);
    // the pre-correction engine is kept for audit; S0 is the pair on the corrected profile
    expect(adj1.reconciliation.engine.tier).toBe(r1.pairs[0]!.tier_before);
    expect(tierRank(adj1.reconciliation.engine.tier)).toBeGreaterThan(tierRank("strong"));
    expect(adj1.reconciliation.result).toMatchObject({ tier_structured: "strong", tier_rescored: "strong", tier: "moderate", row: "R2_strong_blind_moderate", caps_added: ["stage8_objection"] });
    expect(first.caps.filter((c) => c.startsWith("stage8"))).toEqual(["stage8_objection"]);
    // the sweep's re-derivation is the identical row
    const ranked = await rankForInvestigator(m.store.fit, "inv-lupus", { corpus, write: false, now: NOW });
    expect(ranked!.adjudicated).toBe(1);
    const sle = ranked!.results.find((x) => x.opportunity_id === "opp-sle")!;
    expect(toFitResultRow(sle, ranked!.adjudications.get("opp-sle")!)).toEqual(first);
    // a forced re-judge reads the engine fresh from the stored profile — not the ranking's adjudicated row — so the same caps, once
    const r2 = await judgePairs(m.store, { investigatorId: "inv-lupus", top: 1, scout: 0, budget: new ModelBudget(100), model: stubModel(replies).fn, modelName: "m", now: NOW, force: true });
    const second = m.results.find((x) => x.opportunity_id === "opp-sle")!;
    expect(r2.pairs[0]!.tier_before).toBe("strong");
    // the reconciler's correction no longer matches the stored value (0.9 now), so it is dropped, not re-applied
    expect(r2.corrections).toMatchObject({ auto: 0, dropped: 1 });
    expect(second.caps.filter((c) => c.startsWith("stage8"))).toEqual(["stage8_objection"]);
    expect(second.adjudication!.reconciliation).toMatchObject({ tier_structured: "strong", tier: "moderate", row: "R2_strong_blind_moderate", caps_added: ["stage8_objection"] });
    const sansCorrections = (row: FitResultRow) => ({ ...row, adjudication: { ...row.adjudication!, reconciliation: { ...row.adjudication!.reconciliation, corrections: [] } } });
    expect(sansCorrections(second)).toEqual(sansCorrections(first));
    expect(m.adjudications).toHaveLength(1);
    expect(m.adjudications[0]!.reconciliation.engine.tier).toBe("strong");
  });

  it("F4 · the sweep joins the live correction status: a proposed provisional correction is re-applied, a rejected one skipped, an applied one never re-applied", async () => {
    const m = memory({ profile: WEAK_TRIALIST });
    // profile_weight → provisional: applied to this pair only, the stored profile untouched; Exploratory re-scores Strong, held one step to Moderate
    const reply = reconcilerReply({ corrections: [{ target: "investigator", path: "design.rct", from: 0.1, to: 0.9, evidence_ids: ["NCT04000001"], quote: null, section: null, kind: "profile_weight", confidence: "high" }] });
    await judgePairs(m.store, { investigatorId: "inv-lupus", top: 1, scout: 0, budget: new ModelBudget(100), model: stubModel({ ...happy, reconciler: reply }).fn, modelName: "m", now: NOW });
    const judged = m.results[0]!;
    const rec = judged.adjudication!.reconciliation;
    expect(rec).toMatchObject({ row: "R5_raise_by_correction", tier_structured: "exploratory", tier_rescored: "strong", tier: "moderate", caps_added: ["stage8_pending_confirmation"], review: { kind: "pending_confirmation" } });
    expect(tierRank(rec.tier)).toBeLessThan(tierRank(rec.tier_structured));
    expect(m.corrections[0]).toMatchObject({ path: "design.rct", status: "proposed" });
    expect(m.savedProfiles).toHaveLength(0);
    const rank = () => rankForInvestigator(m.store.fit, "inv-lupus", { corpus, write: false, now: NOW });
    const kept = await rank();
    expect(toFitResultRow(kept!.results.find((x) => x.opportunity_id === "opp-sle")!, kept!.adjudications.get("opp-sle")!)).toEqual(judged);
    // rejected: skipped — the tier falls back to S0; the pair reads as blind Strong with no live correction
    m.corrections[0]!.status = "rejected";
    const rejected = (await rank())!.adjudications.get("opp-sle")!.reconciliation;
    expect(rejected).toMatchObject({ tier: rec.tier_structured, tier_rescored: rec.tier_structured, row: "R6_ai_flagged_lead" });
    expect(rejected.corrections[0]!.status).toBe("rejected");
    // applied: already in the profile, never re-applied on top (the strategist's apply also re-keys the profile, so in practice the pair is re-judged)
    m.corrections[0]!.status = "applied";
    const appliedRow = (await rank())!.adjudications.get("opp-sle")!.reconciliation;
    expect(appliedRow).toMatchObject({ tier: rec.tier_structured, tier_rescored: rec.tier_structured, row: "R5_raise_by_correction", review: null });
    // the pure join
    const stored = m.adjudications[0]!;
    expect(withLiveStatuses(stored, new Map()).reconciliation.result.corrections[0]!.status).toBe("proposed");
    expect(withLiveStatuses(stored, new Map([["c1", "rejected"]])).reconciliation.result.corrections[0]!.status).toBe("rejected");
    expect(stored.reconciliation.result.corrections[0]!.status).toBe("proposed");
  });

  it("F9 · rankForNotice keeps the stored adjudications the way rankForInvestigator does", async () => {
    const m = memory();
    const { fn } = stubModel({ ...happy, blind_b: callB("moderate"), skeptic: skepticReply("scale_role", { gate_level: false, evidence_ids: ["NCT04000001"] }) });
    await judgePairs(m.store, { investigatorId: "inv-lupus", top: 1, scout: 0, budget: new ModelBudget(100), model: fn, modelName: "m", now: NOW });
    const judged = m.results[0]!;
    expect(judged.adjudication!.reconciliation.row).toBe("R2_strong_blind_moderate");
    const mirror = await rankForNotice(m.store.fit, "opp-sle", { corpus, write: false, now: NOW });
    expect(mirror!.adjudicated).toBe(1);
    const row = mirror!.results.find((x) => x.investigator_id === "inv-lupus")!;
    expect(toFitResultRow(row, mirror!.adjudications.get("inv-lupus")!)).toEqual(judged);
    const other = await rankForNotice(m.store.fit, "opp-cohort", { corpus, write: false, now: NOW });
    expect(other!.adjudicated).toBe(0);
    expect(other!.adjudications.size).toBe(0);
  });

  it("N3 · the skeptic reads a raw blind Strong that the counter-case rule lowered", async () => {
    const m = memory({ profile: WEAK_TRIALIST });
    const { fn, calls } = stubModel({ ...happy, blind_b: callB("strong", { counter_case_is_gate_level: true }) });
    const r = await judgePairs(m.store, { investigatorId: "inv-lupus", top: 1, scout: 0, budget: new ModelBudget(100), model: fn, modelName: "m", now: NOW });
    expect(r.pairs[0]!.tier_before).not.toBe("strong");
    expect(r.pairs[0]!.blind).toBe("moderate");
    expect(calls.map((c) => c.purpose)).toContain("skeptic");
  });

  it("`noModel` selects the pairs and builds their inputs without a call; a notice subject judges the roster's top pairs", async () => {
    const m = memory();
    const { fn, calls } = stubModel(happy);
    const dry = await judgePairs(m.store, { investigatorId: "inv-lupus", top: 2, scout: 1, budget: new ModelBudget(100), model: fn, modelName: "m", now: NOW, noModel: true });
    expect(calls).toHaveLength(0);
    expect(dry.pairs.every((p) => p.inputs && p.inputs.evidence.length > 0)).toBe(true);
    expect(dry.pairs[0]!.inputs!.notice.sections).toBe(SECTIONS);
    // S4: every institute token on the funding_opportunities row reaches the judge's notice
    expect(dry.pairs[0]!.inputs!.notice).toMatchObject({ opportunity_id: "opp-sle", issuing_ic: "NIAMS", nih_ic_tokens: ["NIAMS", "NIAID"] });
    const byNotice = await judgePairs(m.store, { opportunityId: "opp-sle", top: 5, scout: 0, budget: new ModelBudget(100), model: fn, modelName: "m", now: NOW });
    expect(byNotice.subject).toMatchObject({ investigator_id: null, opportunity_id: "opp-sle" });
    expect(byNotice.judged).toBe(1);
    expect(m.results[0]).toMatchObject({ investigator_id: "inv-lupus", opportunity_id: "opp-sle" });
    await expect(judgePairs(m.store, { investigatorId: "ghost", budget: new ModelBudget(1), model: fn, modelName: "m" })).rejects.toThrow(/no stored fit profile/);
    await expect(judgePairs(m.store, { budget: new ModelBudget(1), model: fn, modelName: "m" })).rejects.toThrow(/needs an investigatorId or an opportunityId/);
  });

  it("corrections: an auto one patches the stored profile and is recorded applied; a provisional one is proposed and applied to the pair only; a rejected one is not re-proposed", async () => {
    const m = memory({ profile: { ...TRIALIST, design: { ...TRIALIST.design, rct: 0.1 } } });
    const reply = reconcilerReply({
      corrections: [
        { target: "investigator", path: "design.rct", from: 0.1, to: 0.7, evidence_ids: ["NCT04000001"], quote: null, section: null, kind: "ingest_miss", confidence: "high" },
        { target: "investigator", path: "paradigm.recent.translational", from: 0.29, to: 0.5, evidence_ids: ["PMID:31000001", "5R01AR070001"], quote: null, section: null, kind: "profile_weight", confidence: "medium" },
        { target: "notice", path: "paradigm.required.human_biospecimen", from: null, to: 0.5, evidence_ids: [], quote: "not in the notice at all", section: "Research Objectives", kind: "misread_requirement", confidence: "high" },
      ],
    });
    const { fn } = stubModel({ ...happy, reconciler: reply });
    const r = await judgePairs(m.store, { investigatorId: "inv-lupus", top: 1, scout: 0, budget: new ModelBudget(100), model: fn, modelName: "m", now: NOW });
    expect(r.corrections).toEqual({ auto: 1, provisional: 1, dropped: 1 });
    expect(m.corrections.map((c) => `${c.path}:${c.status}`)).toEqual(["design.rct:applied", "paradigm.recent.translational:proposed"]);
    expect(m.corrections[0]).toMatchObject({ target: "investigator_profile", target_id: "inv-lupus", proposed_by: "judge", evidence: { ids: ["NCT04000001"], pair: { investigator_id: "inv-lupus", opportunity_id: "opp-sle" } }, decided_at: NOW().toISOString() });
    expect(m.savedProfiles).toHaveLength(1);
    expect((m.savedProfiles[0]!.profile as typeof TRIALIST).design.rct).toBe(0.7);
    expect((m.savedProfiles[0]!.profile as typeof TRIALIST).paradigm.recent.translational).toBe(0.29); // the provisional one never reaches the stored profile
    const adj = m.adjudications[0]!;
    expect(adj.reconciliation.result.corrections.map((c) => `${c.correction.path}:${c.correction.route}:${c.status}:${c.id}`)).toEqual(["design.rct:auto:applied:c1", "paradigm.recent.translational:provisional:proposed:c2"]);
    expect(adj.reconciliation.reconciler!.corrections).toHaveLength(2);
    expect(adj.reconciliation.reconciler!.dropped.join(" ")).toContain("quote not verbatim");
    // the adjudication is keyed on the corrected (stored) profile, so the next run is a cache hit
    const again = stubModel({ ...happy, reconciler: reply });
    const r2 = await judgePairs(m.store, { investigatorId: "inv-lupus", top: 1, scout: 0, budget: new ModelBudget(100), model: again.fn, modelName: "m", now: NOW });
    expect(r2).toMatchObject({ cached: 1, calls: 0 });
    // reject the provisional one; a forced re-judge does not re-propose it on the same evidence
    m.corrections[1]!.status = "rejected";
    const r3 = await judgePairs(m.store, { investigatorId: "inv-lupus", top: 1, scout: 0, budget: new ModelBudget(100), model: again.fn, modelName: "m", now: NOW, force: true });
    expect(r3.corrections).toMatchObject({ provisional: 0 });
    expect(m.corrections.filter((c) => c.path === "paradigm.recent.translational")).toHaveLength(1);
  });
});

describe("judge/service · refreshFitJudge (the nightly)", () => {
  it("is skipped, logged, while fit_adjudications is not on the database", async () => {
    const m = memory({ tableMissing: true });
    const lines: string[] = [];
    const r = await refreshFitJudge(m.store, { model: stubModel(happy).fn, modelName: "m", now: NOW, log: (l) => lines.push(l) });
    expect(r).toMatchObject({ outcome: "skipped", skipped: expect.stringContaining("fit_adjudications is not on the database — apply supabase/migrations/20260919100000_fit_adjudications_corrections.sql") });
    expect(formatJudgeSummary(r)).toMatch(/^fit_judge skipped/);
    expect(m.adjudications).toHaveLength(0);
  });

  it("takes the roster never-judged first within the budget, stamps each investigator, and reports the calls, tier changes and next cursor", async () => {
    const m = memory({ roster: [{ investigator_id: "inv-lupus", name: "L. Trialist", fit_judged_at: null }, { investigator_id: "ghost", name: "G", fit_judged_at: "2026-09-01T00:00:00.000Z" }] });
    const { fn } = stubModel(happy);
    const r = await refreshFitJudge(m.store, { model: fn, modelName: "m", now: NOW, maxModelCalls: 100, top: 2, scout: 0 });
    expect(r.taken).toBe(2);
    expect(r.investigators.map((i) => `${i.investigator_id}:${i.status}`)).toEqual(["inv-lupus:judged", "ghost:error"]);
    expect(r.judged_pairs).toBe(2);
    expect(r.calls).toBeGreaterThan(0);
    expect(r.budget).toBe(100);
    expect(r.outcome).toBe("partial"); // the ghost errored
    expect(m.stamps.map((s) => s.id)).toEqual(["inv-lupus"]);
    expect(formatJudgeSummary(r)).toContain("2 pairs judged");
    expect(r.next_cursor).toBeNull();
  });

  it("a dry run writes nothing and stamps nobody; the budget stop names the next cursor; limit and cursor narrow the batch", async () => {
    const m = memory({ roster: [{ investigator_id: "inv-lupus", name: "L", fit_judged_at: null }, { investigator_id: "inv-lupus", name: "L again", fit_judged_at: null }] });
    const dry = await refreshFitJudge(m.store, { model: stubModel(happy).fn, modelName: "m", now: NOW, dryRun: true, top: 1, scout: 0, limit: 1 });
    expect(dry.dryRun).toBe(true);
    expect(dry.investigators[0]!.status).toBe("dry_run");
    expect(m.adjudications).toHaveLength(0);
    expect(m.results).toHaveLength(0);
    expect(m.stamps).toHaveLength(0);
    expect(dry.next_cursor).toBe("inv-lupus");
    const tight = await refreshFitJudge(m.store, { model: stubModel(happy).fn, modelName: "m", now: NOW, maxModelCalls: 2, top: 2, scout: 0 });
    expect(tight.budgetExhausted).toBe(true);
    expect(tight.outcome).toBe("partial");
    expect(tight.next_cursor).toBe("inv-lupus");
    expect(tight.calls).toBe(2);
    // S2: the stop is named, in the result, the investigator line and the summary the log row carries
    expect(tight).toMatchObject({ stopped_by: "budget", stop_error: null, pair_errors: 0 });
    expect(tight.investigators[0]!.line).toContain("budget exhausted after 2 calls");
    expect(formatJudgeSummary(tight)).toContain("budget exhausted after 2 calls, next cursor inv-lupus");
    // F3: the investigator the stop interrupted is not stamped (the next run returns to it first); nothing of the interrupted pair was kept
    expect(m.stamps).toHaveLength(0);
    expect(m.roster.every((r) => r.fit_judged_at === null)).toBe(true);
    expect(m.adjudications).toHaveLength(0);
    const after = await refreshFitJudge(m.store, { model: stubModel(happy).fn, modelName: "m", now: NOW, cursor: "inv-lupus", maxModelCalls: 0 });
    expect(after.remaining).toBe(1);
    expect(after.taken).toBe(0);
    expect(after.budgetExhausted).toBe(true);
    expect(after.stopped_by).toBe("budget");
  });

  it("S2 · a run the deadline stops says so: no call starts after deadline − margin, the interrupted investigator is not stamped, and the message reads `stopped by deadline after N calls`", async () => {
    const m = memory();
    // a clock the model advances by 100 s per call: with a 240 s budget calls may start until 150 s — the third is refused
    let t = NOW().getTime();
    const clock = () => new Date(t);
    const { fn, calls } = stubModel(happy);
    const slow = async (req: Parameters<typeof fn>[0]) => {
      const reply = await fn(req);
      t += 100_000;
      return reply;
    };
    const r = await refreshFitJudge(m.store, { model: slow, modelName: "m", now: clock, maxModelCalls: 100, top: 1, scout: 0 });
    expect(calls).toHaveLength(2);
    expect(r).toMatchObject({ outcome: "partial", taken: 1, calls: 2, judged_pairs: 0, budgetExhausted: true, stopped_by: "deadline", stop_error: null, next_cursor: "inv-lupus" });
    expect(r.investigators[0]!.line).toContain("stopped by deadline after 2 calls");
    expect(formatJudgeSummary(r)).toContain("stopped by deadline after 2 calls, next cursor inv-lupus");
    expect(m.stamps).toHaveLength(0);
    expect(m.adjudications).toHaveLength(0);
    // the pre-check before an investigator is the same test: past deadline − margin nothing starts, and the deadline is named before the budget
    const none = await refreshFitJudge(m.store, { model: fn, modelName: "m", now: NOW, timeBudgetMs: FIT_JUDGE_CALL_MARGIN_MS - 1, maxModelCalls: 0 });
    expect(none).toMatchObject({ taken: 0, calls: 0, stopped_by: "deadline", budgetExhausted: true });
    expect(stopLabel("deadline")).toBe("stopped by deadline");
    expect(stopLabel("budget")).toBe("budget exhausted");
    expect(stopLabel("error", "boom")).toBe("stopped by error (boom)");
  });

  it("S3 · a throwing model stops the nightly: no stamp, no rows, outcome partial with the error in the result and the message", async () => {
    const m = memory({ roster: [{ investigator_id: "inv-lupus", name: "L. Trialist", fit_judged_at: null }, { investigator_id: "inv-lupus", name: "L again", fit_judged_at: null }] });
    const boom = async () => {
      throw new Error("Connection error.");
    };
    const r = await refreshFitJudge(m.store, { model: boom, modelName: "m", now: NOW, maxModelCalls: 100, top: 2, scout: 0 });
    expect(r).toMatchObject({ outcome: "partial", taken: 1, judged_pairs: 0, errors: 0, pair_errors: 1, calls: 1, budgetExhausted: true, stopped_by: "error", stop_error: "Connection error.", next_cursor: "inv-lupus" });
    expect(r.investigators[0]).toMatchObject({ status: "judged", calls: 1 });
    expect(r.investigators[0]!.line).toContain("stopped by error (Connection error.) after 1 calls");
    expect(formatJudgeSummary(r)).toContain("1 pair errors, 0 investigator errors");
    expect(formatJudgeSummary(r)).toContain("stopped by error (Connection error.) after 1 calls, next cursor inv-lupus");
    expect(m.stamps).toHaveLength(0);
    expect(m.adjudications).toHaveLength(0);
    expect(m.results).toHaveLength(0);
    expect(m.corrections).toHaveLength(0);
  });
});
