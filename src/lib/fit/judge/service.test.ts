import { describe, expect, it } from "vitest";
import { hydrateOpportunity } from "@/lib/fit/engine/fixtures";
import type { CorrectionRow, CorrectionStore } from "@/lib/fit/judge/corrections";
import { DEFAULT_JUDGE_MODEL_CALLS_PER_RUN, DEFAULT_SCOUT, DEFAULT_TOP, formatJudgeSummary, judgeModelCallsPerRun, judgeOrder, judgePairs, refreshFitJudge, selectPairs, type JudgeRosterEntry, type JudgeStore } from "@/lib/fit/judge/service";
import { CALL_A_OK, callB, EVIDENCE, reconcilerReply, SECTIONS, SKEPTIC_NONE, SLE_TRIAL, stubModel, TRIALIST, type Replies } from "@/lib/fit/judge/test-fixtures";
import type { StoredAdjudication } from "@/lib/fit/judge/types";
import { ModelBudget } from "@/lib/fit/profile/model-budget";
import type { FitResultRow } from "@/lib/fit/results";
import { noticeTermDf, termCounts, type CorpusNotice, type FitCorpus, type FitStore, type InvestigatorInputs, type NoticeFacts, type RosterEntry } from "@/lib/fit/service";
import { computeIdf } from "@/lib/fit/topic/idf";
import type { FitResult } from "@/lib/fit/types";

const NOW = () => new Date("2026-09-06T12:00:00.000Z");

const facts = (id: string, over: Partial<NoticeFacts> = {}): NoticeFacts => ({ id, opportunity_number: id.toUpperCase(), title: `Notice ${id}`, agency: "NIH", close_date: "2027-01-01", next_due: "2026-12-05", expiration_date: null, activity_code: "R01", receipt_cycles: null, ...over });

const cohortRfa = hydrateOpportunity("opp-cohort", { mechanism: { activity_code: "R01", clinical_trial: "not_allowed" }, paradigm: { required: { clinical_observational: 1 } }, unit: { required: ["L4"] }, design: { required_any: ["prospective_cohort", "retrospective_cohort"] }, topic: { mesh: ["C14.280.434"], terms: ["heart failure", "natriuretic peptides"], free_text: "Cohorts of heart failure." } });
const mechRfa = hydrateOpportunity("opp-mech", { mechanism: { activity_code: "R01", clinical_trial: "not_allowed" }, paradigm: { required: { molecular_cellular_mechanistic: 1 }, excluded: { clinical_trials: 1 } }, unit: { required: ["L1"] }, design: { required_any: ["wet_lab_experiment"] }, topic: { mesh: ["C20.111.590"], terms: ["lupus", "interferon"], free_text: "Mechanisms of lupus." } });

const notice = (profile: CorpusNotice["profile"], vector: number[]): CorpusNotice => ({ profile, complete: true, facts: facts(profile.opportunity_id), runway_weeks: 13, vector, computed_at: "2026-09-05T00:00:00.000Z" });

function corpusOf(notices: CorpusNotice[]): FitCorpus {
  return { notices, idf: computeIdf(notices.map((n) => ({ id: n.profile.opportunity_id, mesh: n.profile.topic.mesh, rcdc: n.profile.topic.rcdc }))), termDf: noticeTermDf(notices.map((n) => n.profile)), today: "2026-09-06", mesh_mapped: 0, with_vector: notices.length };
}

const corpus = corpusOf([notice(SLE_TRIAL, [1, 0, 0]), notice(cohortRfa, [0, 1, 0]), notice(mechRfa, [0.9, 0.1, 0])]);

/** The trialist's inputs: the four fixture items with their judge facts, embedded near the SLE notice. */
function trialistInputs(): InvestigatorInputs {
  return {
    profile: JSON.parse(JSON.stringify(TRIALIST)),
    name: "L. Trialist",
    pending_items: 0,
    computed_at: "2026-09-05T00:00:00.000Z",
    items: EVIDENCE.map((e, i) => ({ id: e.ref, paradigm: { clinical_trials: 1 }, design: { rct: 1 }, ...termCounts(`${e.title}. ${e.text}`), vector: i === 1 ? null : [1, 0, 0], judge: { id: e.id, ref: e.ref, kind: e.kind, year: e.year, role: e.role, title: e.title, text: e.text, mesh_names: e.mesh_names, topic_terms: e.topic_terms, weight: e.weight } })),
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
};

function memory(opts: { roster?: JudgeRosterEntry[]; tableMissing?: boolean; profile?: typeof TRIALIST } = {}): Memory {
  const adjudications: StoredAdjudication[] = [];
  const results: FitResultRow[] = [];
  const corrections: CorrectionRow[] = [];
  const savedProfiles: Memory["savedProfiles"] = [];
  const stamps: Memory["stamps"] = [];
  const persisted: Memory["persisted"] = [];
  const roster = opts.roster ?? [{ investigator_id: "inv-lupus", name: "L. Trialist", fit_judged_at: null }];
  let profile = opts.profile ?? TRIALIST;
  let seq = 0;
  const fit: FitStore = {
    loadCorpus: async () => corpus,
    loadRoster: async () => roster.map((r): RosterEntry => ({ investigator_id: r.investigator_id, name: r.name, fit_results_at: null })),
    loadInvestigator: async (id) => (id === "inv-lupus" ? { ...trialistInputs(), profile: JSON.parse(JSON.stringify(profile)) } : null),
    loadRosterProfiles: async () => [{ profile, pending_items: 0, docVector: [1, 0, 0] }],
    persistForInvestigator: async (id, rows) => (persisted.push({ id, rows }), { upserted: rows.length, deleted: 0 }),
    persistForNotice: async (_id, rows) => ({ upserted: rows.length, deleted: 0 }),
    refreshIdf: async (idf) => ({ n: idf.n, codes: idf.rows.length, written: 0, deleted: 0, skipped: null }),
    resultsTableMissing: async () => false,
    loadAdjudications: async (f) => adjudications.filter((a) => (!f.investigatorId || a.investigator_id === f.investigatorId) && (!f.opportunityId || a.opportunity_id === f.opportunityId)).slice().reverse(),
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
    loadProfile: async (target) => (target === "investigator_profile" ? profile : SLE_TRIAL),
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
  return { store, adjudications, results, corrections, savedProfiles, stamps, roster, persisted };
}

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

  it("the model budget stops the run: a variant not made is recorded, a pair with no call left is `budget` and ends the loop", async () => {
    const m = memory();
    const { fn, calls } = stubModel(happy);
    const r = await judgePairs(m.store, { investigatorId: "inv-lupus", top: 3, scout: 0, budget: new ModelBudget(3), model: fn, modelName: "m", now: NOW });
    expect(calls).toHaveLength(3);
    expect(r.pairs[0]).toMatchObject({ status: "judged", calls: 3 });
    expect(m.adjudications[0]!.blind!.variants[1]).toMatchObject({ usable: false, calls: 1, dropped: expect.arrayContaining(["call B: not made (model budget spent or past the deadline)"]) });
    expect(r.budgetExhausted).toBe(true);
    expect(r.pairs[1]).toMatchObject({ status: "budget", calls: 0 });
    expect(r.pairs).toHaveLength(2);
    const past = stubModel(happy);
    const late = await judgePairs(m.store, { investigatorId: "inv-lupus", top: 1, scout: 0, budget: new ModelBudget(100), deadline: Date.now() - 1, model: past.fn, modelName: "m", now: NOW, force: true });
    expect(late.pairs[0]!.status).toBe("budget");
    expect(past.calls).toHaveLength(0);
  });

  it("`noModel` selects the pairs and builds their inputs without a call; a notice subject judges the roster's top pairs", async () => {
    const m = memory();
    const { fn, calls } = stubModel(happy);
    const dry = await judgePairs(m.store, { investigatorId: "inv-lupus", top: 2, scout: 1, budget: new ModelBudget(100), model: fn, modelName: "m", now: NOW, noModel: true });
    expect(calls).toHaveLength(0);
    expect(dry.pairs.every((p) => p.inputs && p.inputs.evidence.length > 0)).toBe(true);
    expect(dry.pairs[0]!.inputs!.notice.sections).toBe(SECTIONS);
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
    const after = await refreshFitJudge(m.store, { model: stubModel(happy).fn, modelName: "m", now: NOW, cursor: "inv-lupus", maxModelCalls: 0 });
    expect(after.remaining).toBe(1);
    expect(after.taken).toBe(0);
    expect(after.budgetExhausted).toBe(true);
  });
});
