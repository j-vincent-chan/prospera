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
 * bridge). The recall net never overrides eligibility: a hit with E = 0 is
 * dropped and counted with the structured failures, so no stored pair is
 * ineligible (the surfaces list ineligible people from a pure `eligibility`
 * pass over the stored profiles instead). Candidates for a notice mirror
 * this over the roster. Every candidate is then scored in full by
 * `scorePair` (service.ts); a pair outside the set has no `fit_results` row.
 *
 * `runwayWeeks` lives here because the runway is the one context the gate
 * needs (a passed deadline fails E): the stored `next_due` when it is still
 * ahead, else the receipt-cycle rule over the stored cycles
 * (`computeNextDue`: the next cycle, else the last, else the close date).
 * A stale `next_due` — the Guide sync stamps it, and a cycle can pass
 * before the next fetch — is ignored, so a notice with a future cycle keeps
 * a positive runway; when the stored date and every cycle are behind and
 * the notice is open only by `expiration_date`, the negative runway stands
 * and E = 0.
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
import { computeNextDue, type ReceiptCycle } from "@/lib/funding-opportunities/receipt-cycles";

/** The `funding_opportunities` deadline facts the runway is computed from. */
export type NoticeDeadlineFacts = {
  close_date: string | null;
  next_due: string | null;
  expiration_date: string | null;
  receipt_cycles: ReceiptCycle[] | null;
};

/** Weeks from `today` to the notice's next due date: the stored `next_due` when it is today or later, else the receipt-cycle rule over the stored cycles (then the close date); null when nothing is on file. A negative value means every date on file has passed. */
export function runwayWeeks(facts: NoticeDeadlineFacts, today: string): number | null {
  const stored = facts.next_due && facts.next_due.slice(0, 10) >= today ? facts.next_due : null;
  const due = stored ?? computeNextDue({ cycles: facts.receipt_cycles ?? [], closeDate: facts.close_date, expirationDate: facts.expiration_date }, today);
  if (!due) return null;
  const ms = Date.parse(`${due.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return Math.round((ms / 604_800_000) * 100) / 100;
}

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

export type Candidate = { id: string; via: CandidateVia; gate: StructuralGate; similarity: number | null };

export type CandidateSet = {
  candidates: Candidate[];
  /** Pairs considered (every profiled counterpart). */
  considered: number;
  /** Passed the structured gate. */
  structural: number;
  /** Came in through the recall net only. */
  recall_only: number;
  /** Failed E (no row, in the recall net or not). */
  failed_e: number;
  /** E = 1 but P below the gate and not in the recall net (no row). */
  below_p: number;
};

export type RecallHit = { id: string; similarity: number };

/** Pure. Structured passes in input order, then recall-net ids (rank order) that have a profile, passed eligibility and did not already pass; a recall hit that passed structurally is marked `both`; a recall hit with E = 0 is dropped (counted in `failed_e`). */
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
    const gate = known.get(hit.id);
    if (taken.has(hit.id) || !gate || gate.E === 0) continue;
    taken.add(hit.id);
    recall_only += 1;
    candidates.push({ id: hit.id, via: "embedding", gate, similarity: hit.similarity });
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

/** Pure. The roster members a notice excludes on eligibility (E = 0), each with the failed rules — what `runSuggestions` lists as excluded under fit-v1, since an ineligible pair has no `fit_results` row. Input order. */
export function ineligibleForNotice(opp: OpportunityFitProfile, runwayWeeks: number | null, investigators: readonly InvestigatorFitProfile[]): Array<{ investigator_id: string; failed: string[] }> {
  const ctx = gateContext(runwayWeeks);
  const out: Array<{ investigator_id: string; failed: string[] }> = [];
  for (const inv of investigators) {
    const e = eligibility(inv, opp, ctx);
    if (e.E === 0) out.push({ investigator_id: inv.investigator_id, failed: e.failed });
  }
  return out;
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
