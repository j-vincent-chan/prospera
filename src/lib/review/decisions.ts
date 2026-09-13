/**
 * The match record as the Review page reads it (README §"Interactions &
 * behaviour" "Decision model"): one `fit_match_decisions` row per team ×
 * notice × investigator. Pure — the reads live in `queries.ts`.
 */
import type { DecisionScope, DecisionStatus } from "@/lib/review/reasons";
import { isDecisionStatus } from "@/lib/review/reasons";

export type MatchDecision = {
  opportunityId: string;
  investigatorId: string;
  status: DecisionStatus;
  reason: string | null;
  scope: DecisionScope | null;
  /** Cleared by a notice-scoped reason or "Dismiss all", not decided by a tap on this row. */
  auto: boolean;
  /** Watch: the day the match returns to the queue; null for a watch that does not expire. */
  resurfaceOn: string | null;
  verdictLabel: string | null;
  decidedBy: string | null;
  decidedAt: string;
};

/** The key a decision map uses — the pair, in one string. */
export const matchKey = (opportunityId: string, investigatorId: string): string => `${opportunityId}:${investigatorId}`;

/** `fit_match_decisions` as PostgREST returns it. */
export type DecisionRow = {
  opportunity_id: string;
  investigator_id: string;
  status: string;
  reason: string | null;
  scope: string | null;
  auto: boolean | null;
  resurface_on: string | null;
  verdict_label: string | null;
  decided_by: string | null;
  decided_at: string;
};

export const DECISION_COLUMNS = "opportunity_id, investigator_id, status, reason, scope, auto, resurface_on, verdict_label, decided_by, decided_at";

/** Pure. A stored row → the record, or null for a status outside the vocabulary (a row this build cannot read is not a decision). */
export function fromDecisionRow(r: DecisionRow): MatchDecision | null {
  if (!isDecisionStatus(r.status)) return null;
  const scope = r.scope === "pair" || r.scope === "notice" || r.scope === "person" ? r.scope : null;
  return {
    opportunityId: r.opportunity_id,
    investigatorId: r.investigator_id,
    status: r.status,
    reason: r.reason?.trim() || null,
    scope,
    auto: Boolean(r.auto),
    resurfaceOn: r.resurface_on ?? null,
    verdictLabel: r.verdict_label ?? null,
    decidedBy: r.decided_by ?? null,
    decidedAt: r.decided_at,
  };
}

/**
 * Pure. The decision as it stands today. A Watch whose `resurfaceOn` has
 * arrived is over: the match is back in the queue as undecided, which is what
 * "resurfaces the match 30 days before the deadline" means. Every other
 * decision stands until Undo deletes it.
 */
export function effectiveDecision(d: MatchDecision | null | undefined, today: string): MatchDecision | null {
  if (!d) return null;
  if (d.status === "watch" && d.resurfaceOn && d.resurfaceOn <= today) return null;
  return d;
}
