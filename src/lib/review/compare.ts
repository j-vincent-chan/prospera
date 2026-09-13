/**
 * Side-by-side comparison of candidates on one notice (the brief's "Not built
 * — decided but open": "Side-by-side comparison of two or three candidates on
 * a limited-submission notice"). Pure: the Review rows in, a table out. Every
 * cell is something the row already carries — the verdict and its three
 * chips, the reason and the catch, the checklist, the cited evidence, the
 * career stage, prior contact, the decision — so the comparison cannot say
 * anything the row does not.
 */
import type { Tier } from "@/lib/fit/types";
import type { Tone, VerdictLabel } from "@/lib/fit/verdicts";
import type { ReviewRow } from "@/lib/review/queries";

export type CompareTone = "good" | "warn" | "danger" | "plain";
export type CompareCell = { text: string; tone: CompareTone };
export type CompareCriterion = { key: string; label: string; cells: CompareCell[] };
export type CompareColumn = {
  investigatorId: string;
  name: string;
  identity: string | null;
  tier: Tier;
  label: VerdictLabel;
  /** "Undecided" · "Confirmed" · "Dismissed" · "Watching" · "Do not contact" */
  decision: string;
  undecided: boolean;
};
export type CompareTable = { columns: CompareColumn[]; criteria: CompareCriterion[] };

/** How many candidates sit side by side — the brief's "two or three". */
export const COMPARE_MAX = 3;

const LABEL_WORDS: Record<VerdictLabel, string> = { strong: "Strong match", moderate: "Moderate match", exploratory: "Exploratory", cannot_assess: "Can't assess", ruled_out: "Ruled out" };
const TIER_TONE: Record<Tier, CompareTone> = { strong: "good", moderate: "plain", exploratory: "plain", poor: "danger" };
const toneOf = (t: Tone): CompareTone => (t === "ok" ? "good" : t === "caution" ? "warn" : "danger");

/** Pure. "Undecided", or the decision's word. */
export function decisionWord(row: Pick<ReviewRow, "decision" | "doNotContact">): string {
  if (row.doNotContact) return "Do not contact";
  if (!row.decision) return "Undecided";
  return row.decision.status === "confirmed" ? "Confirmed" : row.decision.status === "watch" ? "Watching" : "Dismissed";
}

/** Pure. The candidates to open with: the undecided rows in their ranked order, then decided ones to fill, up to `max`. */
export function defaultPicks(rows: readonly ReviewRow[], max: number = COMPARE_MAX): string[] {
  const open = rows.filter((r) => !r.decision && !r.doNotContact).map((r) => r.investigatorId);
  const rest = rows.filter((r) => r.decision || r.doNotContact).map((r) => r.investigatorId);
  return [...open, ...rest].slice(0, max);
}

/** Pure. Toggle a candidate in the picks, never past `max`; the new one replaces the oldest when full. */
export function togglePick(picks: readonly string[], id: string, max: number = COMPARE_MAX): string[] {
  if (picks.includes(id)) return picks.filter((p) => p !== id);
  const next = [...picks, id];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** Pure. The table for the picked rows, in the order picked. */
export function compareRows(rows: readonly ReviewRow[], picks: readonly string[]): CompareTable {
  const chosen = picks.map((id) => rows.find((r) => r.investigatorId === id)).filter((r): r is ReviewRow => Boolean(r));
  const columns: CompareColumn[] = chosen.map((r) => ({ investigatorId: r.investigatorId, name: r.name, identity: r.identity, tier: r.tier, label: r.verdicts.label, decision: decisionWord(r), undecided: !r.decision && !r.doNotContact }));
  const cell = (fn: (r: ReviewRow) => CompareCell): CompareCell[] => chosen.map(fn);
  const criteria: CompareCriterion[] = [
    { key: "verdict", label: "Prospera's verdict", cells: cell((r) => ({ text: LABEL_WORDS[r.verdicts.label], tone: r.verdicts.label === "ruled_out" || r.verdicts.label === "cannot_assess" ? "danger" : TIER_TONE[r.tier] })) },
    { key: "approach", label: "Research approach", cells: cell((r) => ({ text: r.verdicts.approach.text || "—", tone: toneOf(r.verdicts.approach.tone) })) },
    { key: "eligibility", label: "Eligibility", cells: cell((r) => ({ text: r.verdicts.eligibility.text || "—", tone: toneOf(r.verdicts.eligibility.tone) })) },
    { key: "evidence", label: "Evidence", cells: cell((r) => ({ text: r.verdicts.evidence.text || "—", tone: toneOf(r.verdicts.evidence.tone) })) },
    { key: "coverage", label: "What is on file", cells: cell((r) => ({ text: r.coverage ?? "Nothing verified on file", tone: r.coverage ? "plain" : "warn" })) },
    { key: "why", label: "Why", cells: cell((r) => ({ text: r.verdicts.reason, tone: "plain" })) },
    { key: "catch", label: "The catch", cells: cell((r) => ({ text: r.verdicts.caveat.text, tone: r.verdicts.caveat.tone === "blocking" ? "danger" : r.verdicts.caveat.tone === "caution" ? "warn" : "plain" })) },
    { key: "stage", label: "Career stage", cells: cell((r) => ({ text: r.card.stage ?? "Not on file", tone: r.card.stage ? "plain" : "warn" })) },
    { key: "checks", label: "Checklist", cells: cell((r) => checksCell(r)) },
    { key: "cited", label: "Cited evidence", cells: cell((r) => ({ text: (r.disclosure?.items ?? []).slice(0, 2).map((i) => i.title).join("; ") || "Nothing cited", tone: r.disclosure?.items?.length ? "plain" : "warn" })) },
    { key: "contact", label: "Prior contact", cells: cell((r) => ({ text: r.clash ?? r.history?.text ?? r.contact ?? "Not contacted", tone: r.clash ? "danger" : r.history?.tone === "warn" ? "warn" : "plain" })) },
    { key: "decision", label: "Decision", cells: cell((r) => ({ text: decisionWord(r), tone: r.decision?.status === "confirmed" ? "good" : r.decision || r.doNotContact ? "plain" : "warn" })) },
  ];
  return { columns, criteria };
}

/** "5 met · 1 failed · 2 open", toned by the worst mark. */
export function checksCell(row: Pick<ReviewRow, "checks">): CompareCell {
  if (!row.checks.assessed) return { text: "Not checked against this notice", tone: "warn" };
  const n = (m: "yes" | "no" | "unknown") => row.checks.rows.filter((c) => c.mark === m).length;
  const yes = n("yes");
  const no = n("no");
  const open = n("unknown");
  return { text: `${yes} met · ${no} failed · ${open} open`, tone: no ? "danger" : open ? "warn" : "good" };
}

/** The drawer's title and its line: on a limited submission, the choice is which one. */
export function compareHeading(input: { limited: boolean; cap: string | null; candidates: number }): { title: string; line: string } {
  const who = `${input.candidates} candidate${input.candidates === 1 ? "" : "s"}`;
  if (input.limited) return { title: "Compare candidates · limited submission", line: `UCSF may put forward ${input.cap ?? "a limited number"}, so the question is which one. ${who} side by side; nothing is contacted until you decide.` };
  return { title: "Compare candidates", line: `${who} side by side, on what each row already shows. Nothing is contacted until you decide.` };
}

/** The header button's label. */
export function compareButtonLabel(limited: boolean): string {
  return limited ? "Compare · limited submission" : "Compare candidates";
}
