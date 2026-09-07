import { Pill } from "@/components/ui/pill";
import type { FitEngine } from "@/lib/fit/flag";
import { TIER_PILL_VARIANT, tierHelp, tierLabel } from "@/lib/fit/tier-display";
import type { SuggestionTier } from "@/lib/outreach/types";

/**
 * The tier pill the three surfaces share (plan § PR 2.3): the investigator
 * page's "Opportunities that fit", the opportunity page's "Suggested
 * recipients" and the peek's "Best fit in your directory". Label always as
 * text; the label and the tooltip follow the engine that produced the tier
 * (fit-v1: Strong match / Moderate match / Exploratory and the floors;
 * legacy: Potential match and the cosine text — PR 3.2, D33).
 */
export function TierPill({ tier, engine = "legacy", className }: { tier: SuggestionTier; engine?: FitEngine; className?: string }) {
  return (
    <Pill variant={TIER_PILL_VARIANT[tier]} title={tierHelp(tier, engine)} className={className}>
      {tierLabel(tier, engine)}
    </Pill>
  );
}
