import { ComponentBars as FitComponentBars } from "@/components/fit/component-bars";
import { capLabel, FIT_TIER_WORD } from "@/lib/fit/inspect/display-labels";
import { componentRows, NEXT_TIER_UP } from "@/lib/fit/pair-detail";
import type { SuggestionFit } from "@/lib/outreach/queries";

/**
 * The Outreach evidence view's component bars (plan § PR 3.2): P U D T M O K A
 * from `fit_results.components`, with the caps that held the tier. One
 * renderer with the fit rows' disclosure since PR 3.2b (`components/fit/
 * component-bars.tsx`), so a component reads the same on both surfaces —
 * against the floors of the tier above, in words as well as in colour — and
 * a cap reads as its reason rather than as its id.
 */
export function ComponentBars({ fit }: { fit: SuggestionFit }) {
  const against = NEXT_TIER_UP[fit.tier];
  return (
    <>
      <FitComponentBars rows={componentRows(fit.components, against)} against={against} />
      <p className="mb-0 mt-2 text-meta leading-normal text-ink-muted">
        S {fit.score.toFixed(1)} · {FIT_TIER_WORD[fit.tier]}
        {fit.judged ? ` · ${fit.judged.label}` : ""}.{" "}
        {fit.caps.length ? `Held down by: ${fit.caps.map((c) => capLabel(c).toLowerCase()).join("; ")}.` : "No cap held the tier down."}
      </p>
    </>
  );
}
