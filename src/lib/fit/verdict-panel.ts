/**
 * What the row's disclosure says (fit-UX PR 3; `AUDIT_AND_DECISIONS.md` §3c,
 * `IMPLEMENTATION_DECISIONS.md` D-k). Pure: it takes the records the surface
 * already loaded and returns the three fields `verdict-row-disclosure.tsx`
 * accepts — `why`, `gaps[]`, `items[]`.
 *
 * **This is the half of §3c PR 2 could not check.** That PR made "nothing
 * disqualifying lives inside a disclosure" structural by putting the panel in
 * its own module which cannot see `FitVerdicts` at all; what no test there
 * could reach is what a *caller* puts into those three caller-supplied string
 * fields. This module is that caller, and the rule it keeps is:
 *
 *   **the panel elaborates a decision the row has already made.** Every fact
 *   that decides the outcome — a failed eligibility rule, a failed gate, an
 *   unmet required design, a missed floor — reaches the reader through
 *   `caveat` and the three chips, on the row, above the fold. The bullets here
 *   are the engine's own gap sentences and the notice's own conditions: what
 *   would have to be true, what is worth checking, what the exclusion rests
 *   on. `verdict-panel.test.ts` asserts over the adversarial fixtures that no
 *   bullet is the only place a stage-1 failure is stated.
 *
 * Three shapes of bullet, chosen by the row's label rather than by taste,
 * because the heading `gapHeading` picks is chosen the same way:
 *
 *   - **ruled out** — "Why it is ruled out": the rest of the engine's
 *     `why_not`, after the sentence the row's `reason` already shows.
 *   - **can't assess** — "Before this can be assessed": what the notice
 *     profile is missing, which is a fact about the notice and not about the
 *     person.
 *   - **everything else** — "What would have to be true" / "Worth checking
 *     before you write": the engine's `gap` sentences where it wrote them
 *     (an Exploratory row always has them), then the notice's own conditions
 *     — non-responsive topics, team requirements, the clinical-trial
 *     designation — which are things to check, not things that block.
 */
import { CLAUSE_SEPARATOR, plainClause, plainOrNull, sentencesOf, type PlainOptions } from "@/lib/fit/decision-text";
import type { RationaleView } from "@/lib/fit/explain-view";
import type { FitResultVerdictRow } from "@/lib/fit/results";
import type { InvestigatorFitProfile, OpportunityFitProfile } from "@/lib/fit/types";
import { approachSentence, plainOptionsFor, rewritableApproachClause, type FitVerdicts } from "@/lib/fit/verdicts";

/**
 * One evidence card. Structurally `VerdictRowEvidence` from
 * `components/fit/verdict-row-disclosure.tsx` — declared here rather than
 * imported so that nothing under `lib/` depends on a component module;
 * `verdict-panel.test.ts` pins the two together with a compile-time
 * assignment, so a change to either is a type error rather than a drift.
 */
export type PanelEvidence = {
  id: string;
  title: string;
  meta?: string | null;
  source?: string | null;
  href?: string | null;
};

/** Structurally `VerdictRowDisclosure`. */
export type PanelContent = {
  why: string;
  gaps: readonly string[];
  items: readonly PanelEvidence[];
};

export type PanelInput = {
  /**
   * `best_pair` joined the four in the L4 follow-up: `panelWhy` opens on the
   * engine's paradigm clause, and rewriting it is only safe against the pair
   * the row itself stores. **Optional**, like `investigator` below and for the
   * same reason — the three call sites hand over the whole verdict row, and a
   * caller without it loses the rewrite rather than getting a sentence
   * composed from a pair nobody checked.
   */
  row: Pick<FitResultVerdictRow, "rationale" | "why_not" | "gap" | "tier"> & Partial<Pick<FitResultVerdictRow, "best_pair">>;
  label: FitVerdicts["label"];
  /** The rationale with its cited ids resolved — the surface already builds this for the row's reason. */
  rationale: RationaleView;
  notice: OpportunityFitProfile | null;
  /**
   * The person's own profile, for the one clause `engine/explain.ts` writes as
   * record ids: "Collaborators in the directory who do this: <ids>".
   * `engine/tier.ts`'s `collaboratorsIn` maps `.map((c) => c.id)`, so in
   * production that bullet is a list of `investigators.id` UUIDs. Optional
   * because the three call sites all have the record and a fourth might not —
   * without it the clause is dropped rather than rendered with an id in it.
   */
  investigator?: InvestigatorFitProfile | null;
};

/** The profile facts the de-numbering needs. Shared with `verdicts.ts` so the row and its panel resolve the same ids the same way. */
const plainOptions = (input: Pick<PanelInput, "investigator">): PlainOptions => plainOptionsFor({ investigator: input.investigator ?? null });

/** How many bullets a panel shows. Past this the list stops being scannable and starts being the audit view, which is PR 4's. */
export const MAX_GAPS = 4;
/** How long "Why you are seeing this" runs before it stops taking clauses. One paragraph, not the whole component list. */
export const MAX_WHY_CHARS = 340;
/** "2–3 evidence cards" (README §"Screens / views" 1). */
export const MAX_ITEMS = 3;

/** Sentence-split on `. ` before a capital — the shape `engine/explain.ts` joins its clauses in. Re-exported from `decision-text.ts`, which owns the engine's voice. */
export { sentencesOf } from "@/lib/fit/decision-text";

/**
 * Pure. Engine prose as the panel says it: split into the clauses the engine
 * joined, each made safe by `decision-text.plainClause` or dropped, the caps
 * clause dropped, and clauses taken only while the paragraph still reads at a
 * glance.
 *
 * **Found by rendering.** The first draft put `rationale.text` in whole, which
 * for an engine-written rationale is the eight component clauses with their
 * values and the cap ids — `Paradigm 0.45 — Clinical trials (yours 0.85) vs.
 * required Genetic epidemiology · Unit 0.55 — L3 vs. required L4 · … · Caps —
 * paradigm_gate (exploratory: P 0.45 < 0.45)`. That is the inspector voice
 * §2.5 takes off the decision surface, put one click behind it instead of
 * removed. The values belong to PR 4's collapsed internals block; the claims
 * belong here.
 *
 * **And found again by rendering, with the real engine** (B1). The shapes the
 * old stripper knew were three of at least six, so every scored fixture still
 * put `Objective 0.63`, `rct 0.70` and `(C20.111.590 at depth 3)` under "Why
 * you are seeing this" — both Strong pairs included. The de-numbering now
 * lives in one module, is checked rather than assumed, and drops a clause it
 * cannot say.
 */
export function plainProse(text: string | null | undefined, max: number = MAX_WHY_CHARS, opts: PlainOptions = {}): string {
  const raw = text?.trim();
  if (!raw) return "";
  const parts = raw.includes(" \u00b7 ") ? raw.split(" \u00b7 ") : sentencesOf(raw);
  const out: string[] = [];
  for (const part of parts) {
    // The caps clause is dropped by `plainClause` itself now, wherever engine
    // prose is read — it was this module's rule and it belongs to all of them.
    const clause = plainClause(part, opts);
    if (!clause) continue;
    if (out.length && out.join(" ").length + clause.length + 1 > max) break;
    out.push(clause);
  }
  return out.join(" ");
}

/**
 * Pure. The paragraph under "Why you are seeing this".
 *
 * The reasoning, where the row above shows only its first clause (§3b: one
 * sentence per slot) — so the panel earns its space by carrying the rest of
 * it, in the row's language rather than the inspector's (`plainProse`). A
 * ruled-out pair has no rationale (`toFitResultRow` nulls it) and its
 * `why_not` is the same prose from the other side, read the same way. That is
 * the progression §3c describes: the row summarises, the panel explains, and
 * the component values, floors and cap ids stay behind "All evidence and
 * components →".
 */
export function panelWhy(input: PanelInput): string {
  const rationale = input.rationale.text?.trim();
  const source = rationale && rationale !== "No rationale stored." ? rationale : (input.row.why_not?.trim() ?? "");
  // L4 reaches the disclosure too. The paragraph opens on the same paradigm
  // clause the row's reason does, so leaving it here would put "Molecular /
  // cellular mechanistic vs. required Molecular / cellular mechanistic." one
  // click behind a row that no longer says it. Only the **opening** clause is
  // rewritten; everything after it is the rest of the reasoning, which is what
  // §3c says the panel is for.
  const parts = source.includes(CLAUSE_SEPARATOR) ? source.split(CLAUSE_SEPARATOR) : [];
  const head = parts.length && rewritableApproachClause(parts[0]!, input.row) ? approachSentence({ row: input.row as FitResultVerdictRow, notice: input.notice }) : null;
  if (head) {
    const rest = plainProse(parts.slice(1).join(CLAUSE_SEPARATOR), Math.max(0, MAX_WHY_CHARS - head.length - 1), plainOptions(input));
    return rest ? `${head} ${rest}` : head;
  }
  return plainProse(source, MAX_WHY_CHARS, plainOptions(input)) || "The engine stored no reasoning for this pair. It was scored, and the assessment above is what the stored components say.";
}

/**
 * Pure. What the notice itself asks a strategist to check before writing —
 * conditions on the *application*, never on the person, and never the fact
 * that decided the row (that is the caveat's).
 */
export function noticeChecks(notice: OpportunityFitProfile | null): string[] {
  if (!notice) return [];
  const out: string[] = [];
  if (notice.materials?.human_required) out.push("The notice requires human participants; the application has to name where they come from.");
  if (notice.mechanism?.clinical_trial === "not_allowed") out.push("Clinical trials are not allowed under this announcement.");
  if (notice.mechanism?.clinical_trial === "required") out.push("This announcement requires a clinical trial.");
  if (notice.team?.consortium_required) out.push("A consortium is required.");
  else if (notice.team?.multi_pi_allowed) out.push("Multi-PI is allowed, so a gap can be covered by a co-investigator.");
  if (notice.non_responsive?.length) out.push(`The notice names ${notice.non_responsive.length === 1 ? "one non-responsive topic" : `${notice.non_responsive.length} non-responsive topics`}: ${notice.non_responsive.slice(0, 3).join(", ")}.`);
  if (notice.population) out.push(`Required study population: ${notice.population}.`);
  return out;
}

/** Pure. Why a notice could not be assessed — a fact about the notice's text, not about the person. */
export function assessmentGaps(notice: OpportunityFitProfile | null): string[] {
  const out: string[] = [];
  const text = notice?.sources?.text;
  if (!notice) out.push("No fit profile is on file for this notice, so nothing in it was checked against this evidence.");
  else if (text === "synopsis") out.push("Only the notice's synopsis was read; the full announcement has not been parsed.");
  else if (text === "none") out.push("No notice text was available to read.");
  else out.push("The profile build for this notice did not finish, so part of the announcement was never read.");
  out.push("Re-running the notice profile settles it; the tier above was scored against what was read.");
  return out;
}

/**
 * Pure. The bullets, in the order the heading implies. Capped at `MAX_GAPS`:
 * the panel is a step on the way to the audit view, not the audit view.
 */
export function panelGaps(input: PanelInput): string[] {
  // Every bullet is de-numbered the same way the row's own sentences are: a
  // bullet reading "Methods 0.25 is below the Moderate floor 0.3", or "Not in
  // the evidence: C12.777.419.780, Kidney Disease", is the inspector voice one
  // click in, which is where §2.5 says it must not be.
  const opts = plainOptions(input);
  const said = (parts: readonly string[]) => parts.map((p) => plainClause(p, opts)).filter((p): p is string => Boolean(p));
  if (input.label === "ruled_out") {
    // The row's reason is the first sentence of `why_not`; the rest is what
    // the panel adds. A one-sentence `why_not` leaves nothing to elaborate.
    return said(sentencesOf(input.row.why_not).slice(1)).slice(0, MAX_GAPS);
  }
  if (input.label === "cannot_assess") return assessmentGaps(input.notice).slice(0, MAX_GAPS);
  const gaps = [...said(sentencesOf(input.row.gap)), ...noticeChecks(input.notice)];
  return gaps.slice(0, MAX_GAPS);
}

/** Pure. "What this rests on": the items the rationale resolved, as cards. */
export function panelItems(rationale: RationaleView): PanelEvidence[] {
  return rationale.evidence.slice(0, MAX_ITEMS).map((e) => ({ id: e.id, title: e.title, meta: e.meta, source: e.kindLabel, href: e.href }));
}

/**
 * Pure. One row's disclosure, with the invariant enforced on the composed
 * panel (B1).
 *
 * Same rule as `fitVerdicts`'s own guard, at the other end of the same
 * progression: `why` and every bullet is checked once more after composition,
 * and a bullet that cannot be said without the engine's values is dropped
 * rather than shown. The check is here rather than at the three call sites
 * because the call sites are loaders, and a fourth one is a copy of the rule.
 */
export function verdictPanel(input: PanelInput): PanelContent {
  const opts = plainOptions(input);
  const why = plainOrNull(panelWhy(input), opts);
  return {
    why: why ?? "The stored reasoning for this pair is component values only; the assessment above is what they say.",
    gaps: panelGaps(input)
      .map((g) => plainOrNull(g, opts))
      .filter((g): g is string => Boolean(g)),
    items: panelItems(input.rationale),
  };
}
