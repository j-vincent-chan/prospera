/**
 * **What the ranking could not read** (adopted from PR 3.2b's
 * `profile-state.ts` in the fit-UX merge). Pure: a view model over the stored
 * investigator fit profile's own fields, no Supabase.
 *
 * #61 made a fair point the fit-UX branch's provenance line does not: before
 * trusting a list, a strategist needs three facts — what the ranking read,
 * when it ran, and what it could not read — and **the third is the one that
 * changes a decision.** A profile with no biosketch and no self-declared axes
 * is ranking on publications alone, so a thin Exploratory list is a fact about
 * the profile, not about the person, and the fix is a link away.
 *
 * Only that third fact survives here, and it goes into the footer the card
 * already has rather than into a second provenance surface above the groups
 * (§3j: **one provenance statement per card**). The other two were already
 * said, and said better, elsewhere on this branch:
 *
 *   - *what the ranking read* — the evidence verdict says it in the row's own
 *     voice ("Well evidenced · 118 papers, 9 awards"), and `FOOTER_EVIDENCE`
 *     already lifts it into the footer on exactly the surface where it is a
 *     fact about the card rather than about the row (L5). #61's
 *     `evidenceSources` was that sentence a second time, three lines above it.
 *   - *when it ran* — `provenanceLine` states the corpus and the refresh, and
 *     `results.newestComputedAt` carries the newest `computed_at` for the one
 *     thing a timestamp decides on a decision surface: §3i's "the notice
 *     changed **after** these were assessed". A second timestamp in the footer
 *     is a number with nothing to compare it against.
 *
 * So `profileState`, `evidenceSources` and #61's own `newestComputedAt` (a
 * duplicate of `results.newestComputedAt`) are gone; `profileGaps` is what was
 * worth taking.
 */
import { CONFIDENCE_WORD } from "@/lib/fit/inspect/display-labels";
import { axisLabel, type InspectAxis } from "@/lib/fit/inspect/labels";
import type { AxisConfidence, Confidence, EvidenceSummary } from "@/lib/fit/types";

/**
 * What the gaps are read off: the stored profile record, plus the sibling
 * `investigator_fit_profiles.pending_items` column when the caller selected
 * it. Structural, so an `InvestigatorFitProfile` **is** one of these; every
 * field is `Partial` or optional because either JSON column may be missing a
 * key on a row written by an older aggregation.
 */
export type ProfileStateRow = {
  /** Items classified but not yet folded into the profile; omitted by a caller that did not read the column. */
  pending_items?: number | null;
  confidence: Partial<AxisConfidence> | null;
  evidence_summary: Partial<EvidenceSummary> | null;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A biosketch counts as usable only once it is actually on file. */
const BIOSKETCH_ON_FILE = new Set(["on_file", "available"]);

/** The five structured axes plus topic, in the order the inspector lists them. */
const AXES: readonly InspectAxis[] = ["paradigm", "unit", "design", "materials", "objective", "topic"];

/**
 * Pure. What the ranking could not use — the sources with nothing on file, the
 * axes it could not read confidently, and the items still queued.
 *
 * Every entry is a whole item count or a word, never a component value, so the
 * footer line built from these clears `decision-text.isEngineValueText` by
 * construction rather than by a strip.
 */
export function profileGaps(row: ProfileStateRow): string[] {
  const gaps: string[] = [];
  const s = row.evidence_summary ?? {};
  if (!BIOSKETCH_ON_FILE.has(String(s.biosketch ?? ""))) gaps.push("no biosketch on file");
  if (!s.self_declared) gaps.push("no self-declared research axes");
  if (Number(s.publications_verified ?? 0) === 0) gaps.push("no verified publications");
  if (Number(s.grants ?? 0) === 0) gaps.push("no NIH awards on file");
  const low = AXES.filter((a) => (row.confidence?.[a] as Confidence | undefined) === "low");
  if (low.length) gaps.push(`${low.map((a) => axisLabel(a).toLowerCase()).join(", ")} read at ${CONFIDENCE_WORD.low} confidence`);
  const pending = Number(row.pending_items ?? 0);
  if (pending > 0) gaps.push(`${plural(pending, "item")} still waiting to be classified`);
  return gaps;
}
