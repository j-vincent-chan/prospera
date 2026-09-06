import { Pill } from "@/components/ui/pill";
import type { FitEngine } from "@/lib/fit/flag";
import { TIER_PILL_VARIANT, tierHelp } from "@/lib/fit/tier-display";
import { TIER_LABEL, type SuggestionTier } from "@/lib/outreach/types";

/**
 * The tier pill the three surfaces share (plan § PR 2.3): the investigator
 * page's "Opportunities that fit", the opportunity page's "Suggested
 * recipients" and the peek's "Best fit in your directory". Label always as
 * text; the tooltip explains the tier for the engine that produced it.
 */
export function TierPill({ tier, engine = "legacy", className }: { tier: SuggestionTier; engine?: FitEngine; className?: string }) {
  return (
    <Pill variant={TIER_PILL_VARIANT[tier]} title={tierHelp(tier, engine)} className={className}>
      {TIER_LABEL[tier]}
    </Pill>
  );
}
