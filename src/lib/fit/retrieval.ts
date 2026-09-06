/**
 * Stage 1 · retrieval (plan § PR 2.2; spec §7 "gates first, on structure";
 * §16 "candidate generation"). Pure selection over stored profiles.
 *
 * Candidates for an investigator = the open notices whose stored profiles
 * pass the eligibility filter (E = 1) and the paradigm gate
 * (P ≥ `paradigm.gates.poor_below`) — the "single query over structured
 * columns" of the spec — in union with the `compose.retrieval.embedding_top_n`
 * notices nearest the investigator's career vector, a recall net for the
 * pairs the structured gate would miss (a thin profile, an aspiration, a
 * bridge). Candidates for a notice mirror this over the roster. Every
 * candidate is then scored in full by `scorePair` (service.ts); a pair
 * outside the set has no `fit_results` row.
 *
 * The near-miss set — paradigm-compatible, topic-low: P ≥
 * `near_miss.p_min` and T < `near_miss.t_max` — is the stage-8 scout's input
 * (PR 3.1): pairs where latent fit may hide behind a topic vocabulary gap.
 *
 * The gate reuses the engine's own stage functions, so retrieval and
 * scoring can never disagree about E or P.
 */
import { design } from "@/lib/fit/engine/design";
import { eligibility } from "@/lib/fit/engine/eligibility";
import { paradigm } from "@/lib/fit/engine/paradigm";
import { unit } from "@/lib/fit/engine/unit";
import { paradigmGates, retrievalParams } from "@/lib/fit/taxonomy";
import type { Components, FitResult, InvestigatorFitProfile, OpportunityFitProfile, ScoreContext } from "@/lib/fit/types";

export type StructuralGate = {
  E: 0 | 1;
  P: number;
  U: number;
  D: number;
  /** Eligibility rules that failed (E = 0). */
  failed: string[];
  /** E = 1 and P ≥ `paradigm.gates.poor_below`. */
  passes: boolean;
};

/** The context stage 1 needs to decide E: the runway alone (a passed deadline fails). Everything else is empty. */
export function gateContext(runwayWeeks: number | null): ScoreContext {
  return {
    now: "",
    actionability: { runway_weeks: runwayWeeks, in_pipeline: false, recently_dismissed: false },
    topic: { idf: { weights: {}, unknown: 1 }, items: [], bm25: null, override: null },
    infrastructure: null,
    track: null,
    investigator_pending_items: 0,
    notice_complete: true,
  };
}

/** Pure. The structured gate for one pair: E from stage 1, P from stage 2 (with U and D for a cross-cutting dominant), against `paradigm.gates.poor_below`. */
export function structuralGate(inv: InvestigatorFitProfile, opp: OpportunityFitProfile, runwayWeeks: number | null): StructuralGate {
  const e = eligibility(inv, opp, gateContext(runwayWeeks));
  const u = unit(inv, opp);
  const d = design(inv, opp);
  const p = paradigm(inv, opp, { U: u.U, D: d.D });
  return { E: e.E, P: p.P, U: u.U, D: d.D, failed: e.failed, passes: e.E === 1 && p.P >= paradigmGates().poor_below };
}

export type CandidateVia = "structured" | "embedding" | "both";

export type Candidate = { id: string; via: CandidateVia; gate: StructuralGate | null; similarity: number | null };

export type CandidateSet = {
  candidates: Candidate[];
  /** Pairs considered (every profiled counterpart). */
  considered: number;
  /** Passed the structured gate. */
  structural: number;
  /** Came in through the recall net only. */
  recall_only: number;
  /** Failed E and not in the recall net (no row). */
  failed_e: number;
  /** E = 1 but P below the gate and not in the recall net (no row). */
  below_p: number;
};

export type RecallHit = { id: string; similarity: number };

/** Pure. Structured passes in input order, then recall-net ids (rank order) that have a profile and did not already pass; a recall hit that passed structurally is marked `both`. */
export function selectCandidates(gates: ReadonlyArray<{ id: string; gate: StructuralGate }>, recall: readonly RecallHit[]): CandidateSet {
  const bySim = new Map(recall.map((r) => [r.id, r.similarity]));
  const known = new Map(gates.map((g) => [g.id, g.gate]));
  const candidates: Candidate[] = [];
  for (const { id, gate } of gates) {
    if (gate.passes) candidates.push({ id, via: bySim.has(id) ? "both" : "structured", gate, similarity: bySim.get(id) ?? null });
  }
  const taken = new Set(candidates.map((c) => c.id));
  let recall_only = 0;
  for (const hit of recall) {
    if (taken.has(hit.id) || !known.has(hit.id)) continue;
    taken.add(hit.id);
    recall_only += 1;
    candidates.push({ id: hit.id, via: "embedding", gate: known.get(hit.id) ?? null, similarity: hit.similarity });
  }
  let failed_e = 0;
  let below_p = 0;
  for (const { id, gate } of gates) {
    if (gate.passes || taken.has(id)) continue;
    if (gate.E === 0) failed_e += 1;
    else below_p += 1;
  }
  return { candidates, considered: gates.length, structural: candidates.length - recall_only, recall_only, failed_e, below_p };
}

export type NoticeForRetrieval = { profile: OpportunityFitProfile; runway_weeks: number | null };

/** Pure. The open notices an investigator is scored against (spec §7 stage 1); `recall` = the embedding top-N notice ids, best first. */
export function candidatesForInvestigator(inv: InvestigatorFitProfile, notices: readonly NoticeForRetrieval[], recall: readonly RecallHit[] = []): CandidateSet {
  return selectCandidates(
    notices.map((n) => ({ id: n.profile.opportunity_id, gate: structuralGate(inv, n.profile, n.runway_weeks) })),
    recall
  );
}

/** Pure. The mirror: the roster members a notice is scored against; `recall` = the embedding top-N investigator ids. */
export function candidatesForNotice(opp: OpportunityFitProfile, runwayWeeks: number | null, investigators: readonly InvestigatorFitProfile[], recall: readonly RecallHit[] = []): CandidateSet {
  return selectCandidates(
    investigators.map((inv) => ({ id: inv.investigator_id, gate: structuralGate(inv, opp, runwayWeeks) })),
    recall
  );
}

/** The recall net's size, `compose.retrieval.embedding_top_n`. */
export function embeddingTopN(): number {
  return retrievalParams().embedding_top_n;
}

/** Pure. Paradigm-compatible, topic-low (`compose.retrieval.near_miss`). */
export function isNearMiss(components: Pick<Components, "P" | "T">): boolean {
  const { p_min, t_max } = retrievalParams().near_miss;
  return components.P >= p_min && components.T < t_max;
}

/** Pure. The near-miss subset of scored pairs, in input order. */
export function nearMissSet<T extends Pick<FitResult, "components">>(results: readonly T[]): T[] {
  return results.filter((r) => isNearMiss(r.components));
}
