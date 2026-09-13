/**
 * "Needs your call" / "Disagreements" (the brief's "Not built — decided but
 * open": filters for a second reviewer's conflicting decisions). Pure.
 *
 * A **disagreement** on a pair is one of two things:
 *   - *with Prospera*: the decision runs against the verdict it was made on —
 *     a Strong or Moderate match dismissed, or an Exploratory, can't-assess or
 *     ruled-out row confirmed. A notice-wide dismissal is not a per-row
 *     disagreement, so auto decisions never count.
 *   - *between reviewers*: the decision replaced a different teammate's
 *     different decision — kept on the row as `previous` (R35).
 *
 * **Needs your call** is the subset the viewer has not settled: a teammate
 * overwrote *your* decision, or — for an owner or admin, who adjudicates as
 * in calibration — any disagreement decided by someone else. Deciding the
 * row yourself settles it.
 */
import type { MatchDecision } from "@/lib/review/decisions";
import type { DecisionStatus } from "@/lib/review/reasons";

export type CallKind = "with_prospera" | "between_reviewers";
export type ReviewFilter = "all" | "calls" | "disagreements";
export type Viewer = { id: string; isAdmin: boolean };

const AGAINST_DISMISSAL = new Set(["strong", "moderate"]);
const AGAINST_CONFIRMATION = new Set(["exploratory", "cannot_assess", "ruled_out"]);

/** Pure. Why the pair is a disagreement, or null. Between reviewers outranks with Prospera when both hold. */
export function disagreement(d: MatchDecision | null | undefined): CallKind | null {
  if (!d) return null;
  if (d.previous && d.previous.by && d.previous.by !== d.decidedBy && d.previous.status !== d.status) return "between_reviewers";
  if (d.auto || !d.verdictLabel) return null;
  if (d.status === "rejected" && AGAINST_DISMISSAL.has(d.verdictLabel)) return "with_prospera";
  if (d.status === "confirmed" && AGAINST_CONFIRMATION.has(d.verdictLabel)) return "with_prospera";
  return null;
}

/** Pure. A disagreement the viewer has not settled. */
export function needsYourCall(d: MatchDecision | null | undefined, viewer: Viewer): boolean {
  const kind = disagreement(d);
  if (!kind || !d || d.decidedBy === viewer.id) return false;
  if (d.previous?.by === viewer.id) return true;
  return viewer.isAdmin;
}

export function isReviewFilter(v: unknown): v is ReviewFilter {
  return v === "all" || v === "calls" || v === "disagreements";
}

/** Pure. Whether a row shows under a filter. */
export function passesFilter(d: MatchDecision | null | undefined, filter: ReviewFilter, viewer: Viewer): boolean {
  if (filter === "all") return true;
  if (filter === "disagreements") return disagreement(d) !== null;
  return needsYourCall(d, viewer);
}

/** Pure. The counts a notice carries for the two filters. */
export function callCounts(decisions: ReadonlyArray<MatchDecision | null | undefined>, viewer: Viewer): { calls: number; disagreements: number } {
  let calls = 0;
  let disagreements = 0;
  for (const d of decisions) {
    if (disagreement(d)) disagreements += 1;
    if (needsYourCall(d, viewer)) calls += 1;
  }
  return { calls, disagreements };
}

/** "Needs your call · 2", "Disagreements · 5", "Everything" */
export function filterLabel(filter: ReviewFilter, n: number): string {
  if (filter === "all") return "Everything";
  return `${filter === "calls" ? "Needs your call" : "Disagreements"} · ${n}`;
}

const STATUS_WORD: Record<DecisionStatus, string> = { confirmed: "confirmed", rejected: "dismissed", watch: "watched" };
const LABEL_WORD: Record<string, string> = { strong: "a Strong match", moderate: "a Moderate match", exploratory: "an Exploratory lead", cannot_assess: "a can't-assess row", ruled_out: "a ruled-out row" };

/**
 * Pure. The row's line for a disagreement: who did what against what.
 * `names` maps user ids to short names; the viewer reads as "you".
 */
export function callLine(d: MatchDecision, viewer: Viewer, names: ReadonlyMap<string, string | null>): string | null {
  const kind = disagreement(d);
  if (!kind) return null;
  const who = (id: string | null) => (id === viewer.id ? "you" : id ? names.get(id) || "a teammate" : "someone");
  if (kind === "between_reviewers" && d.previous) {
    const now = who(d.decidedBy);
    const then = who(d.previous.by);
    const yours = d.previous.by === viewer.id;
    return `${cap(now)} ${STATUS_WORD[d.status]} this over ${yours ? "your" : `${then}'s`} “${STATUS_WORD[d.previous.status]}”${needsYourCall(d, viewer) ? " — your call" : ""}.`;
  }
  const label = LABEL_WORD[d.verdictLabel ?? ""] ?? "the verdict";
  return `${cap(who(d.decidedBy))} ${STATUS_WORD[d.status]} ${label} — against Prospera's verdict${needsYourCall(d, viewer) ? " — your call" : ""}.`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
