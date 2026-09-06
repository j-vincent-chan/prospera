/**
 * Gold-set label vocabulary (plan § PR 2.4; spec §14 "Gold set"): the tier a
 * strategist assigns to an investigator–notice pair and, for the tiers
 * `taxonomy.json › feedback.reason_required_tiers` names (Exploratory and
 * Poor), a reason from `feedback.reasons` — "wrong type of research"
 * (`wrong_research_type`) with its axis sub-reason (`<axis>` or
 * `<axis>:<category>`, the `fit_labels.axis_reason` shape the inspector's
 * flags already use). Every reason, sub-reason and required tier is read
 * through the taxonomy.ts accessors; nothing here lists one. Pure: no
 * Supabase, no fetch.
 */
import { isCategoryOf, isInspectAxis, type InspectAxis } from "@/lib/fit/inspect/labels";
import { parseAxisReason } from "@/lib/fit/inspect/flags";
import { feedbackReason, feedbackReasons, isFeedbackReason, isTier, reasonRequiredTiers, TIER_IDS, type FeedbackReason } from "@/lib/fit/taxonomy";
import type { FeedbackReasonId, Tier } from "@/lib/fit/types";

export const GOLD_SOURCE = "gold" as const;

/** The reason whose label names an axis (spec §12 "wrong type of research, with sub-reason"). */
export const WRONG_RESEARCH_TYPE: FeedbackReasonId = "wrong_research_type";

/** Tier aliases a labeler may type in the CSV: the D33 pill says "Potential match" for a fit-v1 Moderate. */
const TIER_ALIASES: Record<string, Tier> = { potential: "moderate", strong_match: "strong", potential_match: "moderate", weak: "poor", none: "poor", hidden: "poor" };

/** Pure. A tier from a labeler's text: trimmed, case-insensitive, the D33 aliases accepted; null when it is none of the four. */
export function parseTier(raw: string | null | undefined): Tier | null {
  const s = (raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!s) return null;
  if (isTier(s)) return s;
  return TIER_ALIASES[s] ?? null;
}

export const TIER_LABEL_GOLD: Record<Tier, string> = { strong: "Strong", moderate: "Moderate", exploratory: "Exploratory", poor: "Poor" };

/** The reasons a gold label may carry (`feedback.reasons` rows with `gold: true`), taxonomy order. */
export function goldReasons(): readonly FeedbackReason[] {
  return feedbackReasons("gold");
}

/** Spellings accepted beside the taxonomy ids: the pre-taxonomy `wrong_type`, the spec's phrases. */
const REASON_ALIASES: Record<string, FeedbackReasonId> = {
  wrong_type: "wrong_research_type",
  wrong_type_of_research: "wrong_research_type",
  wrong_type_research: "wrong_research_type",
  wrong_area: "not_relevant",
  not_relevant_topic: "not_relevant",
};

/** Pure. A reason id from a labeler's text: trimmed, case-insensitive, spaces to underscores; the taxonomy labels and the aliases accepted too. */
export function parseReason(raw: string | null | undefined): FeedbackReasonId | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  const id = s.replace(/[\s-]+/g, "_").replace(/[^a-z_]/g, "");
  if (isFeedbackReason(id)) return id;
  if (REASON_ALIASES[id]) return REASON_ALIASES[id]!;
  const byLabel = feedbackReasons().find((r) => r.label.toLowerCase() === s);
  return byLabel?.id ?? null;
}

export type ParsedAxisReason = { axis: InspectAxis; category: string | null; axis_reason: string };

/** Pure. `<axis>` or `<axis>:<category>` validated against the taxonomy (topic takes no category); the error names what is wrong. */
export function parseAxisSubReason(raw: string | null | undefined): { ok: true; value: ParsedAxisReason } | { ok: false; error: string } {
  const s = (raw ?? "").trim();
  if (!s) return { ok: false, error: "Axis sub-reason is empty." };
  const { axis, category } = parseAxisReason(s);
  if (!axis || !isInspectAxis(axis)) return { ok: false, error: `Unknown axis "${axis ?? s}"; expected paradigm, unit, design, materials, objective or topic.` };
  if (category !== null) {
    if (axis === "topic") return { ok: false, error: "Topic has no categories; use \"topic\" alone." };
    if (!isCategoryOf(axis, category)) return { ok: false, error: `"${category}" is not a ${axis} category in the taxonomy.` };
  }
  return { ok: true, value: { axis, category, axis_reason: category ? `${axis}:${category}` : axis } };
}

export type GoldLabelInput = { tier?: string | null; reason?: string | null; axis_reason?: string | null };

export type GoldLabelValue = { tier: Tier; reason: FeedbackReasonId | null; axis_reason: string | null };

export type ParseGoldLabelResult = { ok: true; value: GoldLabelValue } | { ok: false; error: string };

/**
 * Pure. One gold label: a valid tier; a gold reason from the taxonomy,
 * required for the tiers `feedback.reason_required_tiers` names (optional
 * otherwise); an axis sub-reason required by a reason with `axis_required`
 * and validated against the taxonomy whenever given.
 */
export function parseGoldLabel(input: GoldLabelInput): ParseGoldLabelResult {
  const tier = parseTier(input.tier);
  if (!tier) return { ok: false, error: `Tier "${(input.tier ?? "").trim()}" is not one of ${TIER_IDS.join(", ")}.` };
  const goldIds = goldReasons().map((r) => r.id);
  const reasonRaw = (input.reason ?? "").trim();
  const reason = reasonRaw ? parseReason(reasonRaw) : null;
  if (reasonRaw && !reason) return { ok: false, error: `Reason "${reasonRaw}" is not in the feedback taxonomy (${goldIds.join(", ")}).` };
  if (reason && !feedbackReason(reason).gold) return { ok: false, error: `Reason "${reason}" is a dismissal reason, not a gold-label reason (${goldIds.join(", ")}).` };
  if (!reason && reasonRequiredTiers().includes(tier)) return { ok: false, error: `${TIER_LABEL_GOLD[tier]} labels need a reason (${goldIds.join(", ")}).` };
  const axisRaw = (input.axis_reason ?? "").trim();
  let axis_reason: string | null = null;
  if (axisRaw) {
    const parsed = parseAxisSubReason(axisRaw);
    if (!parsed.ok) return parsed;
    axis_reason = parsed.value.axis_reason;
  }
  const axisRequired = reason ? feedbackReason(reason).axis_required : false;
  if (axisRequired && !axis_reason) return { ok: false, error: `"${feedbackReason(reason!).label}" needs an axis sub-reason (<axis> or <axis>:<category>, e.g. paradigm:clinical_trials).` };
  if (axis_reason && !axisRequired) return { ok: false, error: `An axis sub-reason goes with a reason that names an axis (${goldReasons().filter((r) => r.axis_required).map((r) => r.id).join(", ")}).` };
  return { ok: true, value: { tier, reason, axis_reason } };
}
