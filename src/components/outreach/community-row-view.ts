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
 *
 * **Every string this module hands the row goes through `decision-text.ts`**
 * (fit-UX follow-up, L1). The evaluation's `reason` and `alignment` are not
 * this module's prose: `outreach/suggest.ts` writes them from the members'
 * *checklist rows*, and a checklist value is the inspector's voice — the
 * Communities block was rendering `0.33 · missing human_primary_cells` as a
 * green alignment chip on the Outreach workspace, which is exactly the
 * component value on a decision surface that the invariant exists to prevent
 * (§2.5, §3a). The community path was the one decision surface the guard was
 * never applied to, because the row is not `fitVerdicts` and so was not on
 * `decision-surface.test.ts`'s list. It is now.
 */
import type { PillVariant } from "@/components/ui/pill";
import { CLAUSE_SEPARATOR, hasWords, isEngineValueText, plainOrNull } from "@/lib/fit/decision-text";
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
 * Pure. The reason line, as a decision surface may render it (L1).
 *
 * The stored `reason` is `runSuggestions`' own sentence today, but it is a
 * column an older run — or a future writer — can have filled with anything,
 * and this row draws it at 14px ink beside four fit-v1 rows whose every
 * sentence is guarded. When the guard takes the whole thing, the row falls
 * back to the two facts the evaluation carries as *numbers* rather than
 * printing nothing: a member count is not the engine's voice.
 */
export function communityReason(c: CommunityRowInput): string {
  const said = plainOrNull(c.reason);
  if (said) return said;
  if (c.memberTotal > 0) return c.memberTotal === 1 ? "1 of 1 member matches what this notice funds." : `${c.memberMatches} of ${c.memberTotal} members match what this notice funds.`;
  return "This community has not been evaluated against this notice.";
}

/**
 * Pure. The one thing that qualifies the row, from the evaluation itself, or
 * null when the evaluation says nothing beyond its reason.
 */
export function communityCaveat(c: CommunityRowInput): CommunityCaveat | null {
  const said = (text: string, tone: Tone): CommunityCaveat | null => {
    const out = plainOrNull(text);
    return out ? { text: out, tone } : null;
  };
  if (c.tier === "cant_evaluate") return said("The community profile is not complete enough to assess against this notice.", "caution");
  if (c.tier === "inactive") return said("Not on the monitored list, so it was not assessed.", "caution");
  if (c.memberTotal > 0 && c.memberMatches === 0) return said(`No one of the ${c.memberTotal} members works on what this notice funds.`, "caution");
  return null;
}

/**
 * Pure. One alignment term as a chip, or null when nothing on it can be shown.
 *
 * **A chip is a term, not a sentence**, so this is not `plainOrNull`: that
 * function punctuates and sentence-cases what it keeps, which turns a chip
 * into "Missing human_primary_cells.". The terms come from
 * `suggest.ts`'s community pass, which slices a member's *checklist value*
 * on `", "` — so a term arrives as `0.33 · missing human_primary_cells`, the
 * head of a checklist row with its component value still on it. The value
 * half is dropped and the readable half kept, the same prune-then-drop the
 * central guard does for a clause.
 *
 * Two further terms are dropped rather than shown: an **absence**
 * (`missing …`), because these chips are drawn in teal under "what it aligns
 * on" and a green chip naming something the members do *not* have says the
 * opposite of the slot it sits in; and anything the invariant still rejects.
 * Ids keep the taxonomy's words with their underscores opened out, which is
 * the same reading `verdicts.designWords` gives a design id.
 */
export function alignmentChip(term: string): string | null {
  const raw = term.trim();
  if (!raw || !hasWords(raw)) return null;
  const kept = (isEngineValueText(raw) ? raw.split(CLAUSE_SEPARATOR) : [raw])
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && hasWords(part) && !isEngineValueText(part));
  const text = kept.join(" ").replace(/_/g, " ").replace(/\s{2,}/g, " ").trim();
  if (!text || /^missing\b/i.test(text) || isEngineValueText(text)) return null;
  return text;
}

/** Pure. The row's chips: what it aligns on, then when it was judged. */
export function communityChips(c: CommunityRowInput, max = 3): Array<{ text: string; tone: Tone }> {
  const seen = new Set<string>();
  const chips: Array<{ text: string; tone: Tone }> = [];
  for (const term of c.alignment) {
    if (chips.length >= max) break;
    const text = alignmentChip(term);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    chips.push({ text, tone: "ok" });
  }
  if (c.memberTotal > 0) chips.push({ text: `${c.memberMatches} of ${c.memberTotal} members`, tone: c.memberMatches > 0 ? "ok" : "caution" });
  return chips;
}
