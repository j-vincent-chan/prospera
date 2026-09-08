/**
 * A monitored community on the same row grammar as a person (fit-UX PR 3;
 * README §"Screens / views" 3: "Communities move onto the same grammar as
 * people: name + tier label, reason line, caveat line, verdict chips, one
 * action"). Pure: label → words and variant, evaluation → caveat and chips.
 *
 * **A community is not scored by the fit engine**, so this is not
 * `fitVerdicts` and does not pretend to be: there are no approach, eligibility
 * or evidence verdicts to compute, and inventing three would be the §3a
 * mistake in reverse — three separately-worded judgments where the model made
 * one. What the community evaluation actually has is a tier, a sentence, the
 * axes it aligns on and a member count, and each of those maps onto a slot the
 * row already has. The chips carry the alignment terms and the evaluation
 * date, which is what the prototype's community row shows.
 *
 * The **caveat is only written when there is a fact to write**. A community
 * whose evaluation says nothing beyond its reason gets no caveat line, rather
 * than a line of filler in the slot where every other row carries the one
 * thing that binds.
 */
import type { PillVariant } from "@/components/ui/pill";
import type { Tone } from "@/lib/fit/verdicts";
import type { CommunityTier } from "@/lib/outreach/types";

export type CommunityRowInput = {
  tier: CommunityTier;
  reason: string;
  alignment: readonly string[];
  memberMatches: number;
  memberTotal: number;
  tagged: boolean;
  dismissed: boolean;
  evaluatedAt: string | null;
};

/** The label's words, in the row's own tier vocabulary. */
export const COMMUNITY_LABEL_TEXT: Record<CommunityTier, string> = {
  strong: "Strong match",
  potential: "Moderate match",
  not_suggested: "Not a match",
  cant_evaluate: "Can't assess",
  inactive: "Not monitored",
};

/** The square `Pill` variant for each, the same five the verdict row uses. */
export const COMMUNITY_LABEL_PILL: Record<CommunityTier, PillVariant> = {
  strong: "tier-strong-square",
  potential: "tier-moderate-square",
  not_suggested: "tier-exploratory-square",
  cant_evaluate: "tier-cannot-assess-square",
  inactive: "tier-ruled-out-square",
};

/** Whether the community is one the run put forward (the two tiers that produce a Tag action). */
export const isSuggested = (c: Pick<CommunityRowInput, "tier">): boolean => c.tier === "strong" || c.tier === "potential";

/** Whether the community is one of the "non-matching monitored" ones §"Screens / views" 3 collapses to a single line. */
export const isCollapsed = (c: Pick<CommunityRowInput, "tier" | "tagged" | "dismissed">): boolean => !c.tagged && (c.dismissed || !isSuggested(c));

/** The state a person put it in, beside the tier label; null when nobody has. */
export function communityState(c: Pick<CommunityRowInput, "tagged" | "dismissed" | "tier">): string | null {
  if (c.tagged) return isSuggested(c) ? "Tagged · also suggested" : "Tagged by you";
  if (c.dismissed) return "Dismissed by you";
  return null;
}

export type CommunityCaveat = { text: string; tone: Tone };

/**
 * Pure. The one thing that qualifies the row, from the evaluation itself, or
 * null when the evaluation says nothing beyond its reason.
 */
export function communityCaveat(c: CommunityRowInput): CommunityCaveat | null {
  if (c.tier === "cant_evaluate") return { text: "The community profile is not complete enough to assess against this notice.", tone: "caution" };
  if (c.tier === "inactive") return { text: "Not on the monitored list, so it was not assessed.", tone: "caution" };
  if (c.memberTotal > 0 && c.memberMatches === 0) return { text: `No one of the ${c.memberTotal} members works on what this notice funds.`, tone: "caution" };
  return null;
}

/** Pure. The row's chips: what it aligns on, then when it was judged. */
export function communityChips(c: CommunityRowInput, max = 3): Array<{ text: string; tone: Tone }> {
  const chips: Array<{ text: string; tone: Tone }> = c.alignment.slice(0, max).map((a) => ({ text: a, tone: "ok" as const }));
  if (c.memberTotal > 0) chips.push({ text: `${c.memberMatches} of ${c.memberTotal} members`, tone: c.memberMatches > 0 ? "ok" : "caution" });
  return chips;
}
