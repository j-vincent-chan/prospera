/**
 * What one row of a fit list says (plan § PR 3.2, follow-up "3.2b"). Pure: view models over
 * `fit_results` list rows, no Supabase.
 *
 * The engine's `rationale` is a nine-component audit trail — every score, the
 * raw taxonomy ids behind each one, MeSH codes with their tree depth, and the
 * notice's eligibility legalese quoted verbatim. It is the right text for the
 * audit view and the wrong text for a row a strategist reads seventy-six
 * times. `rationale` is never rendered in a row; this module builds the row's
 * line instead, from the two fields the engine already writes for exactly
 * this purpose:
 *
 *   - `gap` (Moderate, Exploratory) and `why_not` (Poor) — one clause per
 *     unmet floor, gate-first, so the **first** clause is the binding
 *     constraint: "Topic 0.18 is below the Exploratory floor 0.35.",
 *     "Design: rct | early_phase_trial required, none in the evidence."
 *   - `flags` — already plain language ("mechanism far above readiness;
 *     consider as project lead, not PI").
 *
 * Two sentences at most: what matched, and the largest gap — the gap first on
 * anything below Strong, because below Strong the gap is the decision. Every
 * id in either sentence goes through the display-label map first
 * (`humanizeIds`), so no row shows snake_case.
 *
 * A Strong row has no gap on file (`explain()` writes one only below Strong),
 * so it reads as one sentence; its caveats, if any, are the flags, which
 * every surface renders on their own line.
 */
import { gapReasonOf, orderedReasons } from "@/lib/fit/explain-view";
import type { FitEngine } from "@/lib/fit/flag";
import { humanizeIds, paradigmLabel } from "@/lib/fit/inspect/display-labels";
import type { FitResultListRow } from "@/lib/fit/results";
import type { Tier } from "@/lib/fit/types";
import { GAP_REASON_TITLE, type SuggestionReason, type SuggestionTier } from "@/lib/outreach/types";

/** What a row needs to say its line — the list columns, nothing from the provenance or components blobs. */
export type RowLineInput = Pick<FitResultListRow, "tier" | "gap" | "best_pair"> & {
  why_not?: string | null;
  flags?: string[] | null;
};

export type RowLine = {
  /** The binding constraint, one clause; null on a row the engine wrote no gap for (a Strong pair). */
  gap: string | null;
  /** What matched, one sentence. Never null — a row always says what it is doing here. */
  match: string;
  /** The two sentences in reading order: gap first below Strong. */
  sentences: string[];
  /** The engine's flags, deduped, ids read as labels. */
  flags: string[];
};

/** The longest a row clause may run before it is cut; a longer one belongs in "Why this suggestion". */
export const ROW_CLAUSE_MAX = 180;

const clip = (s: string, n = ROW_CLAUSE_MAX) => (s.length > n ? `${s.slice(0, n - 1).replace(/[\s;,·]+\S*$/, "")}…` : s);

/**
 * The engine appends the collaborators who could bridge a paradigm gap to
 * the clause naming it — as `collaboratorsIn` returns them, which is
 * investigator **ids**: "Collaborators in the directory who do this:
 * 0f5b1b2c-…, 7a2e…". A row is the wrong place for a UUID, so the tail is
 * dropped here and the same people are named, with links, under "Why this
 * suggestion" (`provenance.collaborators`, resolved by the surface).
 */
const COLLABORATOR_TAIL = /\s*Collaborators in the directory who do this:[^.]*\.?\s*$/;

/**
 * Pure. The first clause of a gap or "why not" paragraph — the binding one,
 * because `gapSentences` and `whyNot` both emit gate order (paradigm, unit,
 * design, topic, methods, track record, actionability, eligibility,
 * confidence).
 */
export function firstClause(text: string | null | undefined): string | null {
  const t = text?.trim().replace(COLLABORATOR_TAIL, "");
  if (!t) return null;
  return t.split(/(?<=\.)\s+(?=[A-Z])/)[0]!.replace(COLLABORATOR_TAIL, "");
}

/** Pure. The sentence naming what the pair has in common, from stage 2's best-supporting paradigm pair. */
export function matchSentence(row: Pick<RowLineInput, "best_pair">): string {
  const pair = row.best_pair;
  if (!pair) return "The notice names no paradigm requirement, so this ranks on topic, design and track record.";
  const mine = paradigmLabel(pair.investigator);
  const theirs = paradigmLabel(pair.notice);
  if (pair.investigator === pair.notice) return `Paradigm matches: ${mine} work, which is what the notice asks for.`;
  return `Closest on paradigm: ${mine} work against the notice's ${theirs}.`;
}

/** Pure. The gap clause a row leads with, ids read as labels and cut to one line; null when the engine wrote none. */
export function gapClause(row: Pick<RowLineInput, "tier" | "gap" | "why_not">): string | null {
  const raw = row.tier === "poor" ? row.why_not ?? row.gap : row.gap ?? row.why_not;
  const first = firstClause(raw);
  return first ? clip(humanizeIds(first)) : null;
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** How much of a flag must already appear in the sentences before it counts as said. */
const SAID_MIN = 20;

/**
 * The forms a flag may take inside a gap clause. The engine writes the same
 * fact twice in slightly different words — the flag "mechanism far above
 * readiness; consider as project lead, not PI" reaches the gap clause as
 * "… — far above readiness; consider as project lead, not PI" — so the
 * comparison drops the flag's opening word and, separately, everything before
 * its first semicolon.
 */
function saidForms(text: string): string[] {
  const full = normalize(text);
  const forms = [full, full.split(" ").slice(1).join(" "), normalize(text.split(";").slice(1).join(";"))];
  return forms.filter((f) => f.length >= SAID_MIN);
}

/**
 * Pure. The flags a row shows beside its line: deduped, ids read as labels,
 * and dropped where the sentences above already say it — a row that says the
 * same thing twice is the problem this change is fixing.
 */
export function rowFlags(flags: readonly string[] | null | undefined, saidAlready: readonly string[] = []): string[] {
  const said = normalize(saidAlready.join(" "));
  const out: string[] = [];
  for (const f of flags ?? []) {
    const text = humanizeIds(f.trim());
    if (!text || out.includes(text)) continue;
    if (saidForms(text).some((form) => said.includes(form))) continue;
    out.push(text);
  }
  return out;
}

/** Pure. Gap first on anything below Strong (§10: below Strong the gap is the decision); a Strong row leads with the match. */
export function sentencesFor(tier: Tier, gap: string | null, match: string): string[] {
  if (!gap) return [match];
  return tier === "strong" ? [match, gap] : [gap, match];
}

/** Pure. The whole line: at most two sentences and the flags. */
export function rowLine(row: RowLineInput): RowLine {
  const gap = gapClause(row);
  const match = matchSentence(row);
  const sentences = sentencesFor(row.tier, gap, match);
  return { gap, match, sentences, flags: rowFlags(row.flags, sentences) };
}

/** Pure. The one-line reason a hidden Poor pair carries under "Why not?" — the binding clause, ids read as labels. */
export function whyNotLine(whyNot: string | null | undefined): string {
  return gapClause({ tier: "poor", gap: null, why_not: whyNot ?? null }) ?? "Below the Exploratory floors.";
}

// ---------------------------------------------------------------------------
// The same two sentences over an Outreach suggestion snapshot
// ---------------------------------------------------------------------------

/**
 * The Outreach board reads stored snapshots, not `fit_results`, and the
 * runner writes the engine's whole rationale into the snapshot's first reason
 * (`suggestion-snapshot.ts`). That is the seventy-six-row reading cost, and
 * it is fixed here rather than in the stored data — a snapshot is a record of
 * what was said at the time.
 *
 * The rationale is `" · "`-joined component clauses, so its **first** clause
 * is the paradigm one: what matched. The gap reason is the same
 * `gapSentences` paragraph the fit rows read, so its first clause is the
 * binding constraint. Two sentences, same order as everywhere else.
 */
export type SnapshotLineInput = {
  tier: SuggestionTier;
  reasons: readonly SuggestionReason[];
};

/** Pure. The first component clause of the engine's rationale — the paradigm one. */
export function firstComponentClause(text: string | null | undefined): string | null {
  const t = text?.trim();
  if (!t) return null;
  const first = t.split(" · ")[0]!.trim();
  return first || null;
}

/** Pure. The two sentences an Outreach suggestion row shows under fit-v1, and its flags. */
export function snapshotLine(s: SnapshotLineInput, engine: FitEngine): RowLine {
  const tier: Tier = s.tier === "potential" ? "moderate" : s.tier;
  const ordered = orderedReasons(s, engine);
  const gapReason = gapReasonOf(s, engine);
  const rationale = ordered.find((r) => r.title !== GAP_REASON_TITLE) ?? null;
  const gap = gapReason ? clip(humanizeIds(firstClause(gapReason.text) ?? gapReason.text)) : null;
  const match = clip(humanizeIds(firstComponentClause(rationale?.text) ?? "No rationale stored."));
  return { gap, match, sentences: sentencesFor(tier, gap, match), flags: [] };
}
