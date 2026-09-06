/**
 * Gold-set label vocabulary (plan § PR 2.4; spec §14 "Gold set"): the tier a
 * strategist assigns to an investigator–notice pair and, for Exploratory or
 * Poor, a reason from the feedback taxonomy — "wrong type of research" with
 * its axis sub-reason (`<axis>:<category>`, the `fit_labels.axis_reason`
 * shape the inspector's flags already use).
 *
 * PROPOSAL — `src/lib/fit/taxonomy.json` carries no feedback / reasons block
 * yet (spec §12 lists the dismissal reasons in prose only), so the reason
 * list lives here as a small in-code list marked as a proposal. When the
 * taxonomy gains a `feedback.reasons` block, read it through an accessor and
 * delete `FEEDBACK_REASONS`; the ids below are meant to be the block's ids.
 *
 * Pure: no Supabase, no fetch.
 */
import { isCategoryOf, isInspectAxis, type InspectAxis } from "@/lib/fit/inspect/labels";
import { parseAxisReason } from "@/lib/fit/inspect/flags";
import { isTier, TIER_IDS } from "@/lib/fit/taxonomy";
import type { Tier } from "@/lib/fit/types";

export const GOLD_SOURCE = "gold" as const;

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

export type FeedbackReasonId = "wrong_type" | "not_relevant" | "not_eligible" | "wrong_mechanism" | "thin_evidence" | "wrong_person" | "other";

export type FeedbackReason = {
  id: FeedbackReasonId;
  label: string;
  /** What the labeler means by it (the picker's hint). */
  description: string;
  /** Needs an axis sub-reason (`<axis>:<category>`). */
  needs_axis: boolean;
  /** Spec §12 signal the reason corresponds to. */
  spec: string;
};

/**
 * PROPOSAL (spec §12 feedback taxonomy, gold-set reading). The dismissal
 * reasons Prospera already records — not relevant, wrong area, wrong person,
 * already aware, do not contact — plus §12's two new ones: "wrong type of
 * research" with an axis sub-reason, and "wrong career stage / not eligible".
 * "Already aware" and "do not contact" are outreach states, not fit
 * judgements, so they are not label reasons; "wrong area" is `not_relevant`
 * (topic). Two gold-set-only reasons: `wrong_mechanism` (the notice is the
 * wrong scale or readiness for the person — spec §7 stage 7 K) and
 * `thin_evidence` (the profile is too thin to judge — the recall stratum).
 */
export const FEEDBACK_REASONS: readonly FeedbackReason[] = [
  { id: "wrong_type", label: "Wrong type of research", description: "The notice asks for a different kind of research (paradigm, unit, design, materials or objective) — name the axis.", needs_axis: true, spec: "Dismiss — wrong type of research (new, with sub-reason)" },
  { id: "not_relevant", label: "Not relevant (topic)", description: "Same kind of research, different scientific question, disease or system.", needs_axis: false, spec: "Dismiss — not relevant / wrong area" },
  { id: "not_eligible", label: "Wrong career stage or not eligible", description: "ESI, degree, appointment, citizenship or another eligibility rule rules the person out.", needs_axis: false, spec: "Dismiss — wrong career stage / not eligible (new)" },
  { id: "wrong_mechanism", label: "Wrong mechanism or readiness", description: "Right science, wrong scale: the mechanism is too large or small for the person’s track record, or the deadline is unrealistic.", needs_axis: false, spec: "§7 stage 7 track record / actionability" },
  { id: "thin_evidence", label: "Too little evidence to judge", description: "The profile carries too few items to say; the pair is neither right nor wrong.", needs_axis: false, spec: "§14 recall stratum" },
  { id: "wrong_person", label: "Profile is wrong", description: "The evidence behind the profile is not this person’s, or the profile misreads it.", needs_axis: false, spec: "Dismiss — wrong person" },
  { id: "other", label: "Other", description: "Anything else — say what in the notes.", needs_axis: false, spec: "—" },
];

export const FEEDBACK_REASON_IDS: readonly FeedbackReasonId[] = FEEDBACK_REASONS.map((r) => r.id);

export const isFeedbackReason = (id: string): id is FeedbackReasonId => (FEEDBACK_REASON_IDS as readonly string[]).includes(id);

export function feedbackReason(id: FeedbackReasonId | string): FeedbackReason | null {
  return FEEDBACK_REASONS.find((r) => r.id === id) ?? null;
}

/** Pure. A reason id from a labeler's text: trimmed, case-insensitive, spaces to underscores; labels accepted too. */
export function parseReason(raw: string | null | undefined): FeedbackReasonId | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  const id = s.replace(/[\s-]+/g, "_").replace(/[^a-z_]/g, "");
  if (isFeedbackReason(id)) return id;
  if (id === "wrong_type_of_research" || id === "wrong_type_research") return "wrong_type";
  if (id === "wrong_area" || id === "not_relevant_topic") return "not_relevant";
  const byLabel = FEEDBACK_REASONS.find((r) => r.label.toLowerCase() === s);
  return byLabel?.id ?? null;
}

/** Spec §12's six "wrong type of research" sub-reasons, each mapped to the axis and category it names — the picker's quick picks. Any valid `<axis>:<category>` is accepted beside them. */
export const WRONG_TYPE_PRESETS: ReadonlyArray<{ id: string; label: string; axis_reason: string }> = [
  { id: "i_dont_run_trials", label: "I don’t run trials", axis_reason: "paradigm:clinical_trials" },
  { id: "this_is_lab_work", label: "This is lab work", axis_reason: "paradigm:molecular_cellular_mechanistic" },
  { id: "this_is_population_research", label: "This is population research", axis_reason: "paradigm:epidemiology" },
  { id: "this_is_health_systems_research", label: "This is health-systems research", axis_reason: "paradigm:health_services" },
  { id: "wrong_model_system", label: "Wrong model system", axis_reason: "materials:animal_mouse" },
  { id: "i_dont_do_implementation", label: "I don’t do implementation", axis_reason: "paradigm:implementation_science" },
  { id: "wrong_data_type", label: "Wrong data type", axis_reason: "materials:claims_administrative" },
  { id: "wrong_unit", label: "Wrong level of analysis", axis_reason: "unit:L4" },
];

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

/** Tiers whose label needs a reason from the feedback taxonomy (spec §14: "where the tier is Exploratory or Poor"). */
export const REASON_REQUIRED_TIERS: readonly Tier[] = ["exploratory", "poor"];

/**
 * Pure. One gold label: a valid tier; a reason from the list, required for
 * Exploratory and Poor (optional otherwise); an axis sub-reason required by
 * `wrong_type` and validated against the taxonomy whenever given.
 */
export function parseGoldLabel(input: GoldLabelInput): ParseGoldLabelResult {
  const tier = parseTier(input.tier);
  if (!tier) return { ok: false, error: `Tier "${(input.tier ?? "").trim()}" is not one of ${TIER_IDS.join(", ")}.` };
  const reasonRaw = (input.reason ?? "").trim();
  const reason = reasonRaw ? parseReason(reasonRaw) : null;
  if (reasonRaw && !reason) return { ok: false, error: `Reason "${reasonRaw}" is not in the feedback taxonomy (${FEEDBACK_REASON_IDS.join(", ")}).` };
  if (!reason && REASON_REQUIRED_TIERS.includes(tier)) return { ok: false, error: `${TIER_LABEL_GOLD[tier]} labels need a reason (${FEEDBACK_REASON_IDS.join(", ")}).` };
  const axisRaw = (input.axis_reason ?? "").trim();
  let axis_reason: string | null = null;
  if (axisRaw) {
    const parsed = parseAxisSubReason(axisRaw);
    if (!parsed.ok) return parsed;
    axis_reason = parsed.value.axis_reason;
  }
  if (reason === "wrong_type" && !axis_reason) return { ok: false, error: "\"Wrong type of research\" needs an axis sub-reason (<axis>:<category>, e.g. paradigm:clinical_trials)." };
  if (axis_reason && reason !== "wrong_type") return { ok: false, error: "An axis sub-reason goes with the reason \"wrong_type\"." };
  return { ok: true, value: { tier, reason, axis_reason } };
}
