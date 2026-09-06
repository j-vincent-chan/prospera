import { describe, expect, it } from "vitest";
import { hydrateInvestigator, hydrateOpportunity, type FixtureInvestigator, type FixtureOpportunity } from "@/lib/fit/engine/fixtures";
import { candidatesForInvestigator, candidatesForNotice, embeddingTopN, gateContext, ineligibleForNotice, isNearMiss, nearMissSet, runwayWeeks, selectCandidates, structuralGate } from "@/lib/fit/retrieval";
import { paradigmGates, retrievalParams } from "@/lib/fit/taxonomy";
import { cosine, parseVector, topByCosine } from "@/lib/fit/vectors";

const inv = (id: string, fx: FixtureInvestigator) => hydrateInvestigator(id, fx);
const opp = (id: string, fx: FixtureOpportunity) => hydrateOpportunity(id, fx);

const mechanist = inv("mechanist", { paradigm: { recent: { molecular_cellular_mechanistic: 0.9, basic_discovery: 0.3 } }, unit: { L1: 0.9 }, design: { wet_lab_experiment: 0.8, perturbation: 0.6 }, characteristics: { esi: false, career_stage: "senior", mechanisms_held: ["R01"] } });
const trialist = inv("trialist", { paradigm: { recent: { clinical_trials: 0.9, clinical_observational: 0.4 } }, unit: { L3: 0.9 }, design: { rct: 0.8 }, characteristics: { esi: false, career_stage: "senior", mechanisms_held: ["R01", "U01"] } });
const trainee = inv("trainee", { paradigm: { recent: { molecular_cellular_mechanistic: 0.9 } }, unit: { L1: 0.9 }, design: { wet_lab_experiment: 0.8 }, characteristics: { esi: null, career_stage: "trainee" } });

const mechanismRfa = opp("mech-rfa", { paradigm: { required: { molecular_cellular_mechanistic: 1 } }, unit: { required: ["L1"] }, design: { required_any: ["wet_lab_experiment", "perturbation"] }, topic: { mesh: ["C04.557.470"] } });
const trialRfa = opp("trial-rfa", { mechanism: { clinical_trial: "required" }, paradigm: { required: { clinical_trials: 1 } }, unit: { required: ["L3"] }, design: { required_any: ["rct", "pragmatic_trial"] } });
const esiOnly = opp("esi-only", { paradigm: { required: { molecular_cellular_mechanistic: 1 } }, eligibility: { esi_only: true } });
const independentOnly = opp("independent", { paradigm: { required: { molecular_cellular_mechanistic: 1 } }, eligibility: { independent_appointment_required: true } });

describe("retrieval · structural gate (spec §7 stage 1–2)", () => {
  it("passes E and P ≥ poor_below from the stored profiles alone", () => {
    const g = structuralGate(mechanist, mechanismRfa, 12);
    expect(g.E).toBe(1);
    expect(g.P).toBeCloseTo(1, 10);
    expect(g.passes).toBe(true);
    expect(g.failed).toEqual([]);
  });

  it("fails the paradigm gate for the forbidden cell (mechanist → trial RFA), and E for a failed rule", () => {
    const cell = structuralGate(mechanist, trialRfa, 12);
    expect(cell.E).toBe(1);
    expect(cell.P).toBeLessThan(paradigmGates().poor_below);
    expect(cell.passes).toBe(false);

    const esi = structuralGate(mechanist, esiOnly, 12);
    expect(esi.E).toBe(0);
    expect(esi.failed[0]).toMatch(/ESI-only/);
    expect(esi.passes).toBe(false);

    const passed = structuralGate(mechanist, mechanismRfa, -1);
    expect(passed.E).toBe(0);
    expect(passed.failed).toEqual(["deadline has passed"]);

    expect(structuralGate(trainee, independentOnly, 8).E).toBe(0);
  });

  it("an unknown eligibility rule is not a fail at retrieval (it caps later)", () => {
    const g = structuralGate(trainee, esiOnly, 8);
    expect(g.E).toBe(1);
    expect(g.passes).toBe(true);
  });

  it("gateContext carries the runway and nothing else", () => {
    expect(gateContext(3).actionability).toEqual({ runway_weeks: 3, in_pipeline: false, recently_dismissed: false });
    expect(gateContext(null).topic.items).toEqual([]);
  });

  it("runway is weeks to next_due when it is still ahead, else the receipt-cycle rule, else the close date, else null", () => {
    const TODAY = "2026-09-06";
    const facts = (over: Partial<Parameters<typeof runwayWeeks>[0]>) => ({ close_date: "2027-01-01", next_due: "2026-12-05", expiration_date: null, receipt_cycles: null, ...over });
    expect(runwayWeeks(facts({}), TODAY)).toBeCloseTo(90 / 7, 2);
    expect(runwayWeeks(facts({ next_due: TODAY }), TODAY)).toBe(0);
    expect(runwayWeeks(facts({ next_due: null, close_date: "2026-09-13" }), TODAY)).toBe(1);
    expect(runwayWeeks(facts({ next_due: null, receipt_cycles: [{ due: "2026-10-16", kind: "new" }, { due: "2026-06-16", kind: "new" }] }), TODAY)).toBeCloseTo(40 / 7, 2);
    expect(runwayWeeks(facts({ next_due: null, close_date: null }), TODAY)).toBeNull();
    // a stale next_due (the Guide sync stamped a cycle that has since passed) is ignored when a later cycle is on file
    expect(runwayWeeks(facts({ next_due: "2026-09-01", receipt_cycles: [{ due: "2026-09-01", kind: "new" }, { due: "2026-10-16", kind: "new" }] }), TODAY)).toBeCloseTo(40 / 7, 2);
    // …and falls to the close date when no cycle is ahead
    expect(runwayWeeks(facts({ next_due: "2026-09-01" }), TODAY)).toBeCloseTo(117 / 7, 2);
    // every date behind and the notice open only by its expiration: the negative runway stands (E = 0)
    expect(runwayWeeks(facts({ next_due: "2026-09-01", close_date: "2026-09-01", expiration_date: "2027-09-01", receipt_cycles: [{ due: "2026-09-01", kind: "new" }] }), TODAY)).toBeCloseTo(-5 / 7, 2);
    expect(runwayWeeks(facts({ next_due: "2026-09-01", close_date: "2026-09-01", expiration_date: "2027-09-01" }), TODAY)).toBeCloseTo(-5 / 7, 2);
  });
});

describe("retrieval · candidate selection", () => {
  const notices = [
    { profile: mechanismRfa, runway_weeks: 12 },
    { profile: trialRfa, runway_weeks: 12 },
    { profile: esiOnly, runway_weeks: 12 },
    { profile: independentOnly, runway_weeks: 12 },
  ];

  it("candidates for an investigator = structured passes ∪ the recall net, counted apart; a recall hit that fails E is dropped", () => {
    const set = candidatesForInvestigator(mechanist, notices, [
      { id: "trial-rfa", similarity: 0.61 },
      { id: "esi-only", similarity: 0.6 },
      { id: "mech-rfa", similarity: 0.58 },
      { id: "not-profiled", similarity: 0.5 },
    ]);
    expect(set.considered).toBe(4);
    expect(set.candidates.map((c) => [c.id, c.via])).toEqual([
      ["mech-rfa", "both"],
      ["independent", "structured"],
      ["trial-rfa", "embedding"],
    ]);
    expect(set.structural).toBe(2);
    expect(set.recall_only).toBe(1);
    expect(set.failed_e).toBe(1);
    expect(set.below_p).toBe(0);
    expect(set.candidates[2]!.gate.P).toBeLessThan(paradigmGates().poor_below);
    expect(set.candidates[2]!.similarity).toBe(0.61);
    expect(set.candidates[1]!.similarity).toBeNull();
  });

  it("without a recall net only the structured passes remain; a below-gate pair is counted", () => {
    const set = candidatesForInvestigator(mechanist, notices);
    expect(set.candidates.map((c) => c.id)).toEqual(["mech-rfa", "independent"]);
    expect(set.below_p).toBe(1);
    expect(set.recall_only).toBe(0);
  });

  it("candidates for a notice mirror it over the roster", () => {
    const set = candidatesForNotice(trialRfa, 12, [mechanist, trialist, trainee], [{ id: "mechanist", similarity: 0.55 }]);
    expect(set.candidates.map((c) => [c.id, c.via])).toEqual([
      ["trialist", "structured"],
      ["mechanist", "embedding"],
    ]);
    expect(set.below_p).toBe(1);
    const esi = candidatesForNotice(esiOnly, 12, [mechanist, trialist, trainee]);
    expect(esi.candidates.map((c) => c.id)).toEqual(["trainee"]);
    expect(esi.failed_e).toBe(2);
  });

  it("selectCandidates keeps order, ignores unknown recall ids and never lets the recall net in an E = 0 pair", () => {
    const gate = (passes: boolean, E: 0 | 1 = 1) => ({ E, P: passes ? 1 : 0, U: 1, D: 1, failed: [], passes });
    const set = selectCandidates(
      [
        { id: "a", gate: gate(true) },
        { id: "b", gate: gate(false) },
        { id: "c", gate: gate(false, 0) },
      ],
      [{ id: "c", similarity: 0.95 }, { id: "b", similarity: 0.5 }, { id: "zz", similarity: 0.9 }, { id: "a", similarity: 0.4 }]
    );
    expect(set.candidates.map((c) => `${c.id}:${c.via}`)).toEqual(["a:both", "b:embedding"]);
    expect(set.candidates.every((c) => c.gate.E === 1)).toBe(true);
    // c failed E: no row, even at the top of the recall net
    expect(set.failed_e).toBe(1);
    expect(set.recall_only).toBe(1);
    // b failed P but the recall net brought it in, so it is not counted as left out
    expect(set.below_p).toBe(0);
  });

  it("ineligibleForNotice lists every roster member the notice's rules exclude, with the failed rules", () => {
    expect(ineligibleForNotice(esiOnly, 12, [mechanist, trialist, trainee])).toEqual([
      { investigator_id: "mechanist", failed: ["ESI-only notice; investigator has held an R01-equivalent award"] },
      { investigator_id: "trialist", failed: ["ESI-only notice; investigator has held an R01-equivalent award"] },
    ]);
    expect(ineligibleForNotice(mechanismRfa, 12, [mechanist, trialist, trainee])).toEqual([]);
    expect(ineligibleForNotice(mechanismRfa, -1, [mechanist]).map((x) => x.failed)).toEqual([["deadline has passed"]]);
  });

  it("the recall net's size comes from the taxonomy", () => {
    expect(embeddingTopN()).toBe(retrievalParams().embedding_top_n);
    expect(embeddingTopN()).toBeGreaterThan(0);
  });
});

describe("retrieval · near-miss set (spec §16 scout)", () => {
  const { p_min, t_max } = retrievalParams().near_miss;
  const r = (id: string, P: number, T: number) => ({ id, components: { E: 1, P, U: 1, D: 1, T, M: 1, O: 1, K: 1, A: 1 } });

  it("P ≥ p_min and T < t_max, boundaries included on P and excluded on T", () => {
    expect(isNearMiss({ P: p_min, T: t_max - 0.01 })).toBe(true);
    expect(isNearMiss({ P: p_min - 0.01, T: 0 })).toBe(false);
    expect(isNearMiss({ P: 1, T: t_max })).toBe(false);
    expect(nearMissSet([r("a", 0.9, 0.1), r("b", 0.2, 0.1), r("c", 0.9, 0.9), r("d", p_min, 0)]).map((x) => x.id)).toEqual(["a", "d"]);
  });
});

describe("vectors", () => {
  it("parses pgvector text and arrays, and computes cosine", () => {
    expect(parseVector("[1,0,0]")).toEqual([1, 0, 0]);
    expect(parseVector([0.5, 0.5])).toEqual([0.5, 0.5]);
    expect(parseVector("nope")).toBeNull();
    expect(parseVector("[1,x]")).toBeNull();
    expect(parseVector(null)).toBeNull();
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1, 12);
    expect(cosine([1, 0], [0, 1])).toBe(0);
    expect(cosine([1, 0], [1])).toBe(0);
    expect(cosine([], [])).toBe(0);
  });

  it("topByCosine ranks best first with ties by id", () => {
    const vs = [
      { id: "b", vector: [1, 0] },
      { id: "a", vector: [1, 0] },
      { id: "c", vector: [0, 1] },
    ];
    expect(topByCosine([1, 0], vs, 2).map((x) => x.id)).toEqual(["a", "b"]);
    expect(topByCosine([1, 0], vs, 0)).toEqual([]);
    expect(topByCosine([], vs, 2)).toEqual([]);
  });
});
