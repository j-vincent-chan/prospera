/**
 * The two row mechanisms AUDIT_AND_DECISIONS §3h left open, as pure data.
 *
 * **1. The PI's per-row action (§3h).** The audit left the brief's fourth
 * question — *what should I do next?* — unanswered for an investigator, and
 * said why: Outreach is the office's internal queue and a PI cannot add
 * themselves to it, so the honest options were a real mechanism ("request a
 * consult, flag interest to the strategist who owns the community") or
 * nothing. It chose nothing rather than a button that goes nowhere, and asked
 * for the decision before the pilot. This is the mechanism: the PI tells the
 * strategist who owns their community that they want to talk about one
 * notice, and the request lands in the office's own queue with the row
 * attached.
 *
 * It is not "add me to outreach". Outreach stays the office's queue: what the
 * PI creates is a request for a conversation, which a strategist answers.
 *
 * **2. "This match is wrong" (a pair flag).** Two controls existed and
 * neither says this. `flagFitProfile` is admin-gated and flags an *axis of a
 * person's profile* ("clinical trials is weighted too high on this person").
 * `dismissSuggestionAction` removes a person *from one notice's outreach
 * queue*, which is a queue movement that happens to carry a reason. Neither
 * is reachable by the investigator, and neither means "this pairing is
 * wrong". A pair flag is keyed on both ids, carries the reason vocabulary of
 * whoever said it, and is a label — it feeds METRICS as a negative, and where
 * the reason names an axis it can hand off to the existing correction
 * proposal rather than duplicating it.
 *
 * Everything here is pure so the wording, the vocabularies and the routing
 * rule are testable without a database.
 */
import type { FitAudience } from "@/lib/fit/explain-view";
import type { VerdictLabel } from "@/lib/fit/verdicts";

// ---------------------------------------------------------------------------
// 1. The PI's action
// ---------------------------------------------------------------------------

/**
 * The labels a PI is shown at all (D7: Recommended only). The action is only
 * offered on these, so it can never appear under a verdict the PI cannot see.
 */
export const PI_ACTION_LABELS: readonly VerdictLabel[] = ["strong", "moderate"];

export const CONSULT_ACTION = { id: "ask_strategist", label: "Ask my strategist", kind: "primary" } as const;

/** Pure. The PI's row verb, or `null` where the audience or the label has none. */
export function consultActionFor(label: VerdictLabel, audience: FitAudience): typeof CONSULT_ACTION | null {
  if (audience !== "investigator") return null;
  return PI_ACTION_LABELS.includes(label) ? CONSULT_ACTION : null;
}

// ---------------------------------------------------------------------------
// Routing: who owes the answer
// ---------------------------------------------------------------------------

export type ConsultRouting = {
  /** The person who owes an answer, or `null` when the office as a whole does. */
  strategistId: string | null;
  communityId: string | null;
  /** Why it went there, for the request's own audit line and the UI's promise. */
  via: "community_strategist" | "team";
};

/**
 * Pure. §3h names "the strategist who owns the community", which is
 * `pipeline_communities.strategist_id` — the field the Communities screen
 * already collects. When the investigator is in no community, or the
 * community has no strategist on file, the request is still made: it falls to
 * the team, so a request is never silently dropped for a bookkeeping gap.
 */
export function routeConsult(input: { communityId: string | null; strategistId: string | null }): ConsultRouting {
  if (input.communityId && input.strategistId) {
    return { strategistId: input.strategistId, communityId: input.communityId, via: "community_strategist" };
  }
  return { strategistId: null, communityId: input.communityId ?? null, via: "team" };
}

/** What the PI is promised when they press the button — never a name they cannot see. */
export function consultPromise(routing: ConsultRouting, strategistName: string | null): string {
  if (routing.via === "community_strategist" && strategistName) return `${strategistName} will see this and follow up.`;
  return "Your research development team will see this and follow up.";
}

/** The notification a strategist gets. Subject and body, no markup. */
export function consultNotification(input: { investigatorName: string; noticeTitle: string; note: string | null; label: VerdictLabel }): { subject: string; text: string } {
  const trimmed = input.note?.trim() || null;
  return {
    subject: `${input.investigatorName} wants to talk about ${shortTitle(input.noticeTitle)}`,
    text: [
      `${input.investigatorName} asked about a funding opportunity from their own fit list.`,
      ``,
      `Notice: ${input.noticeTitle}`,
      `The engine reads this pair as ${input.label === "strong" ? "a strong match" : "a moderate match"}.`,
      trimmed ? `\nWhat they said:\n“${trimmed}”` : `\nThey did not add a note.`,
    ].join("\n"),
  };
}

const shortTitle = (t: string) => (t.length <= 60 ? t : `${t.slice(0, 57).trimEnd()}…`);

// ---------------------------------------------------------------------------
// 2. "This match is wrong"
// ---------------------------------------------------------------------------

/**
 * The canonical reason a pair flag records. Both audiences map onto these, so
 * METRICS counts one vocabulary rather than two, and `wrong_area` from a PI
 * and from a strategist mean the same thing to the engine.
 */
export const PAIR_FLAG_REASONS = ["wrong_area", "wrong_research_type", "not_eligible", "wrong_person", "notice_misread"] as const;
export type PairFlagReason = (typeof PAIR_FLAG_REASONS)[number];
export const isPairFlagReason = (v: unknown): v is PairFlagReason => typeof v === "string" && (PAIR_FLAG_REASONS as readonly string[]).includes(v);

export type PairFlagOption = { id: PairFlagReason; label: string };

/**
 * The same five reasons, said in the voice of whoever is reading the row. A PI
 * is not told their own profile is "wrong"; they are asked what does not fit.
 * `notice_misread` is strategist-only: it is a claim about how the engine read
 * the notice, which a PI has no way to judge.
 */
const STRATEGIST_REASONS: readonly PairFlagOption[] = [
  { id: "wrong_area", label: "Wrong research area" },
  { id: "wrong_research_type", label: "Wrong type of research" },
  { id: "not_eligible", label: "Not eligible for this" },
  { id: "wrong_person", label: "Wrong person" },
  { id: "notice_misread", label: "The notice has been misread" },
];

const INVESTIGATOR_REASONS: readonly PairFlagOption[] = [
  { id: "wrong_area", label: "Not my research area" },
  { id: "wrong_research_type", label: "Not the kind of research I do" },
  { id: "not_eligible", label: "I am not eligible for this" },
  { id: "wrong_person", label: "This is not about me" },
];

export function pairFlagReasons(audience: FitAudience): readonly PairFlagOption[] {
  return audience === "investigator" ? INVESTIGATOR_REASONS : STRATEGIST_REASONS;
}

export function pairFlagLabel(reason: PairFlagReason, audience: FitAudience): string {
  return pairFlagReasons(audience).find((r) => r.id === reason)?.label ?? STRATEGIST_REASONS.find((r) => r.id === reason)!.label;
}

/** The control's own verb, in each voice. */
export function pairFlagVerb(audience: FitAudience): string {
  return audience === "investigator" ? "Not a fit for me" : "This match is wrong";
}

/** Confirmation copy. Says what the flag does and, honestly, what it does not. */
export function pairFlagConfirmation(reason: PairFlagReason, audience: FitAudience): string {
  const noun = audience === "investigator" ? "your fit list" : "this list";
  return `Recorded: ${pairFlagLabel(reason, audience).toLowerCase()}. The pair is marked wrong and drops out of ${noun}; the engine learns from it at the next review.`;
}

/**
 * `wrong_person` is an identity claim, not a matching one — the same thing
 * `reviewIdentityAction` already handles — and `wrong_area` /
 * `wrong_research_type` are the two the correction pipeline can already turn
 * into a proposed profile edit. This says which, so a caller can hand off
 * instead of inventing a second path.
 */
export function pairFlagHandoff(reason: PairFlagReason): "identity" | "profile_correction" | null {
  if (reason === "wrong_person") return "identity";
  if (reason === "wrong_area" || reason === "wrong_research_type") return "profile_correction";
  return null;
}
