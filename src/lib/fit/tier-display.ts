/**
 * How a tier is shown on the three surfaces (plan § PR 2.3). Pure.
 *
 * One vocabulary everywhere: the Outreach snapshot's `SuggestionTier` and its
 * `TIER_LABEL` (Strong match / Potential match / Exploratory), which the
 * investigator page and the recipients tab already render — a fit-v1 Moderate
 * reaches the pill as `potential` through `suggestionTierOf`, so the same
 * pair reads identically on every surface. The tooltip differs by engine:
 * the legacy text describes cosine overlap, the fit-v1 text the floors.
 */
import type { FitEngine } from "@/lib/fit/flag";
import { TIER_HELP, type SuggestionTier } from "@/lib/outreach/types";

export type TierPillVariant = "tier-strong" | "tier-potential" | "tier-exploratory";

export const TIER_PILL_VARIANT: Record<SuggestionTier, TierPillVariant> = { strong: "tier-strong", potential: "tier-potential", exploratory: "tier-exploratory" };

/** The fit-v1 reading of each tier (spec §10). */
export const FIT_TIER_HELP: Record<SuggestionTier, string> = {
  strong: "Strong fit: every floor met — eligible, paradigm and unit compatible, required designs supported, topic aligned on a specific coded term, methods and track record in reach, runway sufficient.",
  potential: "Moderate fit: exactly one Strong floor missed, never paradigm, unit or a required design.",
  exploratory: "Exploratory: scientifically interesting with a named gap — the rationale says what it would take (a collaborator, cohort access, a new direction). A lead to check, not a recommendation.",
};

/** The tooltip for a tier pill under the given engine. */
export function tierHelp(tier: SuggestionTier, engine: FitEngine): string {
  return engine === "fit-v1" ? FIT_TIER_HELP[tier] : TIER_HELP[tier];
}
