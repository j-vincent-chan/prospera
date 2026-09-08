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
import type { RationaleView } from "@/lib/fit/explain-view";
import type { FitResultVerdictRow } from "@/lib/fit/results";
import type { OpportunityFitProfile } from "@/lib/fit/types";
import { plainSentence, type FitVerdicts } from "@/lib/fit/verdicts";

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
  row: Pick<FitResultVerdictRow, "rationale" | "why_not" | "gap" | "tier">;
  label: FitVerdicts["label"];
  /** The rationale with its cited ids resolved — the surface already builds this for the row's reason. */
  rationale: RationaleView;
  notice: OpportunityFitProfile | null;
};

/** How many bullets a panel shows. Past this the list stops being scannable and starts being the audit view, which is PR 4's. */
export const MAX_GAPS = 4;
/** How long "Why you are seeing this" runs before it stops taking clauses. One paragraph, not the whole component list. */
export const MAX_WHY_CHARS = 340;
/** "2–3 evidence cards" (README §"Screens / views" 1). */
export const MAX_ITEMS = 3;

/** Sentence-split on `. ` before a capital — the shape `engine/explain.ts` joins its clauses in. */
export function sentencesOf(text: string | null | undefined): string[] {
  const raw = text?.trim();
  if (!raw) return [];
  return raw
    .split(/(?<=\.)\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter((s) => /[A-Za-z0-9]/.test(s));
}

/** The engine's own caps clause. The caveat above already names the one that binds, in words; repeating the cap ids here is §2.5 and §2.7 at once. */
const CAPS_CLAUSE = /^\s*Caps\b/i;

/**
 * Pure. Engine prose as the panel says it: split into the clauses the engine
 * joined, each de-numbered by `verdicts.plainSentence`, the caps clause
 * dropped, and clauses taken only while the paragraph still reads at a glance.
 *
 * **Found by rendering.** The first draft put `rationale.text` in whole, which
 * for an engine-written rationale is the eight component clauses with their
 * values and the cap ids — `Paradigm 0.45 — Clinical trials (yours 0.85) vs.
 * required Genetic epidemiology · Unit 0.55 — L3 vs. required L4 · … · Caps —
 * paradigm_gate (exploratory: P 0.45 < 0.45)`. That is the inspector voice
 * §2.5 takes off the decision surface, put one click behind it instead of
 * removed. The values belong to PR 4's collapsed internals block; the claims
 * belong here.
 */
export function plainProse(text: string | null | undefined, max: number = MAX_WHY_CHARS): string {
  const raw = text?.trim();
  if (!raw) return "";
  const parts = raw.includes(" \u00b7 ") ? raw.split(" \u00b7 ") : sentencesOf(raw);
  const out: string[] = [];
  for (const part of parts) {
    if (CAPS_CLAUSE.test(part)) continue;
    const clause = plainSentence(part);
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
  return plainProse(source) || "The engine stored no reasoning for this pair. It was scored, and the assessment above is what the stored components say.";
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
  // bullet reading "Methods 0.25 is below the Moderate floor 0.3" is the
  // inspector voice one click in, which is where §2.5 says it must not be.
  const said = (parts: readonly string[]) => parts.map((p) => plainSentence(p)).filter((p): p is string => Boolean(p));
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

/** Pure. One row's disclosure. */
export function verdictPanel(input: PanelInput): PanelContent {
  return { why: panelWhy(input), gaps: panelGaps(input), items: panelItems(input.rationale) };
}
