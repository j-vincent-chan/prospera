/**
 * The Review page's decision vocabulary (design_handoff_prospera_review_outreach
 * README §2 "Rows" and §"Interactions & behaviour" "Decision model"). Pure.
 *
 * One record per match: `{ status: confirmed | rejected | watch, reason?,
 * auto? }`. What this module fixes is the **words** — the eight dismiss
 * reasons with their scope, the three strength tags a confirmation may carry,
 * the reasons a Watch and a reaffirmed rule-out record, and the status text a
 * decided row shows — so the row component, the server action and the badge
 * count all read one list.
 *
 * Scope is the part that does work. A reason about the **notice** ("wrong type
 * of research", "opportunity too broad") clears every other undecided match on
 * the notice too, and the chip says so ("clears all 4"). A reason about the
 * **person** ("do not contact") is also written to the investigator profile.
 * Everything else is about the **pair**.
 *
 * `trainsEngine` says which reasons are a judgment the fit engine should learn
 * from. "Already aware", "already funded here" and "do not contact" are true
 * facts about the person that say nothing about whether the science fits, so
 * they are recorded as decisions and never as `fit_labels` rows — a label that
 * said "poor fit" about a well-matched investigator who happens to be funded
 * already would mis-train the next calibration.
 */
import type { VerdictLabel } from "@/lib/fit/verdicts";
import { fmtMonD, isoToday } from "@/lib/funding-opportunities/receipt-cycles";

export type DecisionStatus = "confirmed" | "rejected" | "watch";
export type DecisionScope = "pair" | "notice" | "person";

export const DECISION_STATUSES: readonly DecisionStatus[] = ["confirmed", "rejected", "watch"];
export const isDecisionStatus = (v: unknown): v is DecisionStatus => typeof v === "string" && (DECISION_STATUSES as readonly string[]).includes(v);

// ---------------------------------------------------------------------------
// The eight dismiss reasons (README §2 "Dismiss reasons panel")
// ---------------------------------------------------------------------------

export type ReviewReasonId = "wrong_research_type" | "too_broad" | "wrong_area" | "not_eligible" | "wrong_person" | "already_aware" | "already_funded" | "do_not_contact";

export type ReviewReason = {
  id: ReviewReasonId;
  /** The chip's label, and the status text after "Dismissed ·" in lower case. */
  label: string;
  scope: DecisionScope;
  /** The chip's hint suffix — the scope, said in words. `n` is the number of undecided matches on the notice, this one included. */
  hint: ((n: number) => string) | null;
  /** Whether the dismissal is written to `fit_labels` as a judgment about the pair's fit. */
  trainsEngine: boolean;
};

const clearsAll = (n: number) => (n <= 1 ? "clears this one" : `clears all ${n}`);

/** In the prototype's order. The two notice-scoped reasons lead: they are the ones that do the most work. */
export const REVIEW_REASONS: readonly ReviewReason[] = [
  { id: "wrong_research_type", label: "Wrong type of research", scope: "notice", hint: clearsAll, trainsEngine: true },
  { id: "too_broad", label: "Opportunity too broad", scope: "notice", hint: clearsAll, trainsEngine: true },
  { id: "wrong_area", label: "Wrong disease area", scope: "pair", hint: null, trainsEngine: true },
  { id: "not_eligible", label: "Not eligible", scope: "pair", hint: null, trainsEngine: true },
  { id: "wrong_person", label: "Wrong person", scope: "pair", hint: null, trainsEngine: true },
  { id: "already_aware", label: "Already aware", scope: "pair", hint: null, trainsEngine: false },
  { id: "already_funded", label: "Already funded here", scope: "pair", hint: null, trainsEngine: false },
  { id: "do_not_contact", label: "Do not contact", scope: "person", hint: () => "saved to the profile", trainsEngine: false },
];

const REASON_BY_ID = new Map(REVIEW_REASONS.map((r) => [r.id, r]));

export const isReviewReasonId = (v: unknown): v is ReviewReasonId => typeof v === "string" && REASON_BY_ID.has(v as ReviewReasonId);

export function reviewReason(id: ReviewReasonId): ReviewReason {
  return REASON_BY_ID.get(id)!;
}

// ---------------------------------------------------------------------------
// The reasons no chip writes
// ---------------------------------------------------------------------------

/** "Dismiss all N matches": every undecided match on the notice, rejected with this reason and `auto`. */
export const NOTICE_DISMISSED = "notice_not_worth_pursuing" as const;
/** "Keep it ruled out" on a row a human already ruled out. */
export const RULED_OUT_REAFFIRMED = "wrong_research_type_reaffirmed" as const;
/** "Request a biosketch" on a Can't-assess row: a Watch that says why. */
export const BIOSKETCH_REQUESTED = "biosketch_requested" as const;

/** The three optional tags a confirmation may carry — "optional — tags the confirmation for calibration". */
export const STRENGTH_TAGS = [
  { id: "science_right", label: "Science is right" },
  { id: "timing_right", label: "Timing is right" },
  { id: "needs_money", label: "Needs the money" },
] as const;
export type StrengthTagId = (typeof STRENGTH_TAGS)[number]["id"];
export const isStrengthTagId = (v: unknown): v is StrengthTagId => typeof v === "string" && STRENGTH_TAGS.some((t) => t.id === v);

/** Every reason a decision may carry, for the server action's validation. */
export const DECISION_REASONS: readonly string[] = [...REVIEW_REASONS.map((r) => r.id), NOTICE_DISMISSED, RULED_OUT_REAFFIRMED, BIOSKETCH_REQUESTED, ...STRENGTH_TAGS.map((t) => t.id)];
export const isDecisionReason = (v: unknown): v is string => typeof v === "string" && DECISION_REASONS.includes(v);

/** Pure. A reason id as it reads in a sentence: "wrong disease area", "the notice is not worth pursuing". */
export function reasonWords(reason: string | null | undefined): string | null {
  if (!reason) return null;
  if (isReviewReasonId(reason)) return reviewReason(reason).label.toLowerCase();
  if (reason === NOTICE_DISMISSED) return "the notice is not worth pursuing";
  if (reason === RULED_OUT_REAFFIRMED) return "wrong type of research · reaffirmed";
  if (reason === BIOSKETCH_REQUESTED) return "biosketch requested";
  const tag = STRENGTH_TAGS.find((t) => t.id === reason);
  if (tag) return tag.label.toLowerCase();
  return reason.replace(/_/g, " ");
}

/** Pure. The scope a reason implies; a reason no chip offers is about the pair. */
export function scopeOfReason(reason: string | null | undefined): DecisionScope {
  if (reason && isReviewReasonId(reason)) return reviewReason(reason).scope;
  if (reason === NOTICE_DISMISSED) return "notice";
  return "pair";
}

/** Pure. Whether a rejection with this reason is a fit judgment worth a `fit_labels` row. */
export function reasonTrainsEngine(reason: string | null | undefined): boolean {
  if (!reason) return false;
  if (isReviewReasonId(reason)) return reviewReason(reason).trainsEngine;
  return reason === RULED_OUT_REAFFIRMED;
}

// ---------------------------------------------------------------------------
// The row's verbs (README §2 "Action row")
// ---------------------------------------------------------------------------

export type RowVerb = { label: string; status: DecisionStatus; reason: string | null };

/**
 * Pure. The primary and secondary buttons for a label. The primary depends
 * on the tier: "Confirm match"; "Request a biosketch" on Can't assess, which
 * records a Watch with its reason; "Keep it ruled out" on a row already
 * ruled out, which reaffirms the earlier correction. The secondary is
 * "Dismiss match" — a `null` status, because it opens the reasons panel
 * rather than deciding — or "Reinstate" on a ruled-out row.
 */
export function rowVerbs(label: VerdictLabel): { primary: RowVerb; secondary: RowVerb | { label: string; status: null; reason: null } } {
  if (label === "cannot_assess") return { primary: { label: "Request a biosketch", status: "watch", reason: BIOSKETCH_REQUESTED }, secondary: { label: "Dismiss match", status: null, reason: null } };
  if (label === "ruled_out") return { primary: { label: "Keep it ruled out", status: "rejected", reason: RULED_OUT_REAFFIRMED }, secondary: { label: "Reinstate", status: "confirmed", reason: null } };
  return { primary: { label: "Confirm match", status: "confirmed", reason: null }, secondary: { label: "Dismiss match", status: null, reason: null } };
}

// ---------------------------------------------------------------------------
// Status text (README §2 "Line 1")
// ---------------------------------------------------------------------------

/** How the status text is set: 400 muted for a fact, 600 in the decision's colour for a decision. */
export type StatusTone = "muted" | "confirmed" | "watching" | "dismissed" | "teammate";

export type StatusText = { text: string; tone: StatusTone };

export type StatusInput = {
  decision: { status: DecisionStatus; reason: string | null; /** Watch: the day it returns, or null for one that stands until Undo. */ resurfaceOn?: string | null } | null;
  /** The person is marked do-not-contact on the profile (by any decision, on any notice). */
  doNotContact: boolean;
  /** A teammate is mid-conversation with this person on another notice. */
  teammateActive: boolean;
  /** The Outreach status on this notice — "Not contacted", "Contacted Sep 4 · no reply" — when the surface looked. */
  contact: string | null;
};

/**
 * Pure. The text beside the tier pill. A decision wins over everything; a
 * profile-level do-not-contact wins over the contact facts; a teammate's
 * live conversation is said before the plain contact state, because it is
 * the thing that changes what the strategist should do next.
 *
 * A Watch names the day it returns ("Watching · returns Oct 2"). The
 * prototype's "returns at 30 days out" was written for a notice months away;
 * on one due inside 30 days — most of today's queue — there is no such day,
 * the watch stands until Undo, and the row says only "Watching".
 */
export function statusText(input: StatusInput, today: string = isoToday()): StatusText {
  const d = input.decision;
  if (d) {
    if (d.status === "confirmed") return { text: "Confirmed", tone: "confirmed" };
    if (d.status === "watch") {
      if (d.reason === BIOSKETCH_REQUESTED) return { text: "Watching · biosketch requested", tone: "watching" };
      return { text: d.resurfaceOn ? `Watching · returns ${fmtMonD(d.resurfaceOn, today)}` : "Watching", tone: "watching" };
    }
    const words = reasonWords(d.reason);
    return { text: words ? `Dismissed · ${words}` : "Dismissed", tone: "dismissed" };
  }
  if (input.doNotContact) return { text: "Do not contact · on the profile", tone: "dismissed" };
  if (input.teammateActive) return { text: "Teammate active", tone: "teammate" };
  return { text: input.contact ?? "Not contacted", tone: "muted" };
}
