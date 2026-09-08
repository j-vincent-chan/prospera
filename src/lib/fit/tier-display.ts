/**
 * How a tier is shown on the three surfaces (plan § PR 2.3, § PR 3.2). Pure.
 *
 * One pill everywhere: the Outreach snapshot's `SuggestionTier` — a fit-v1
 * Moderate reaches the pill as `potential` through `suggestionTierOf`, so the
 * same pair reads identically on every surface. The label and the tooltip
 * differ by engine (D33, settled here): a fit-v1 pill uses the spec's §10
 * vocabulary — Strong match / **Moderate match** / Exploratory — and the
 * floors text; a legacy pill keeps `TIER_LABEL` (Potential match) and the
 * cosine text unchanged, so a legacy team sees no change.
 */
import type { FitEngine } from "@/lib/fit/flag";
import { TIER_HELP, TIER_LABEL, type SuggestionTier } from "@/lib/outreach/types";

export type TierPillVariant = "tier-strong" | "tier-potential" | "tier-exploratory";

export const TIER_PILL_VARIANT: Record<SuggestionTier, TierPillVariant> = { strong: "tier-strong", potential: "tier-potential", exploratory: "tier-exploratory" };

/** The fit-v1 pill labels (spec §10's tiers; PR 3.2 decided "Moderate", D33). */
export const FIT_TIER_LABEL: Record<SuggestionTier, string> = { strong: "Strong match", potential: "Moderate match", exploratory: "Exploratory" };

/** The pill's label under the given engine. */
export function tierLabel(tier: SuggestionTier, engine: FitEngine): string {
  return engine === "fit-v1" ? FIT_TIER_LABEL[tier] : TIER_LABEL[tier];
}

/**
 * The tooltip for a tier pill under the given engine — and **under fit-v1
 * there is none** (fit-UX PR 5's sweep).
 *
 * `FIT_TIER_HELP` used to live here: three sentences explaining the model on
 * hover ("every floor met — eligible, paradigm and unit compatible, required
 * designs supported…", "exactly one Strong floor missed, never paradigm, unit
 * or a required design"). That is §2.2's complaint in its purest form — the
 * interface explaining the model instead of the decision — and the redesign
 * bans it in as many words: *no score, no tier tooltip, no component numbers
 * on the decision surface* (§3a), outside the collapsed internals block and
 * the two admin `/fit` inspectors, neither of which draws a `TierPill`.
 *
 * It was still reaching users. `TierPill` passes this to `Pill`'s `title`, and
 * the opportunity **peek** draws a fit-v1 `TierPill` for every row of "Best fit
 * in your directory" — a decision surface a strategist opens from the
 * opportunities list, and the same path that was showing the engine's numbers
 * in its one line (see `verdicts.plainWhyLine`). The redesigned surfaces say
 * what a tier means in words, beside it, in the three verdicts and the caveat;
 * the pill needs no gloss, and where there are no verdicts there is nothing to
 * gloss it with.
 *
 * `TierPill` and `Pill` are untouched: `title` is already optional on both, so
 * a fit-v1 pill simply renders without one. Legacy keeps `TIER_HELP`, which is
 * about cosine similarity and is the legacy path's own explanation of itself.
 */
export function tierHelp(tier: SuggestionTier, engine: FitEngine): string | undefined {
  return engine === "fit-v1" ? undefined : TIER_HELP[tier];
}
