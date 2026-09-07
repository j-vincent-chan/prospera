/**
 * Dismissal reasons (plan § PR 3.2; spec §12 "Feedback loop"). Pure.
 *
 * The accepted `outreach_suggestions.dismissed_reason` set is the legacy
 * Outreach vocabulary plus the `taxonomy.json › feedback.reasons` rows marked
 * `dismissal: true` — exactly the list the migration
 * `20260920100000_outreach_dismissal_reasons.sql` puts in the CHECK (a test
 * reads the SQL and compares). A `wrong_research_type` dismissal carries a
 * sub-reason, `axis_reason`, in the inspector's flag shape (`<axis>` or
 * `<axis>:<category>`), validated against the taxonomy through the gold set's
 * `parseAxisSubReason`; the §12 quick picks come from
 * `feedback.wrong_research_type_subreasons`.
 *
 * What the menu offers depends on the acting team's engine: a legacy team
 * keeps its five reasons and labels unchanged; a fit-v1 team sees the
 * taxonomy's dismissal reasons, "wrong type of research" first.
 */
import type { FitEngine } from "@/lib/fit/flag";
import { parseAxisReason } from "@/lib/fit/inspect/flags";
import { axisLabel, categoryDisplay } from "@/lib/fit/inspect/labels";
import { parseAxisSubReason, type ParsedAxisReason } from "@/lib/fit/goldset/reasons";
import { feedbackReason, feedbackReasons, isFeedbackReason, wrongResearchTypeSubreasons, type WrongResearchTypeSubreason } from "@/lib/fit/taxonomy";
import { DISMISS_REASON_LABEL, type DismissReason } from "@/lib/outreach/types";

/** The Outreach vocabulary before PR 3.2 (`DismissReason` minus the two taxonomy additions); kept so a legacy team's menu and stored rows read as before. */
export const LEGACY_DISMISS_REASONS = ["not_relevant", "wrong_area", "wrong_person", "already_aware", "do_not_contact"] as const;

/** The reason whose sub-reason names an axis (spec §12). */
export const WRONG_RESEARCH_TYPE = "wrong_research_type" as const;

/** Every accepted `dismissed_reason`: the taxonomy's dismissal reasons in taxonomy order, then the legacy-only ids. */
export const DISMISS_REASONS: readonly string[] = Array.from(new Set<string>([...feedbackReasons("dismissal").map((r) => r.id), ...LEGACY_DISMISS_REASONS]));

export const isDismissReason = (id: string): id is Exclude<DismissReason, ""> => DISMISS_REASONS.includes(id);

/** A reason that needs an axis sub-reason (`feedback.reasons.<id>.axis_required`); a legacy-only id never does. */
export function reasonNeedsAxis(reason: string): boolean {
  return isFeedbackReason(reason) && feedbackReason(reason).axis_required;
}

export type DismissalInput = { reason?: string | null; axisReason?: string | null };

export type DismissalValue = { reason: Exclude<DismissReason, ""> | null; axis_reason: string | null; axis: ParsedAxisReason | null };

export type ParseDismissalResult = { ok: true; value: DismissalValue } | { ok: false; error: string };

/**
 * Pure. Validates a dismissal: no reason is a plain dismissal; a reason must
 * be in `DISMISS_REASONS`; a reason with `axis_required` needs a sub-reason
 * (`<axis>` or `<axis>:<category>`, taxonomy-checked); a sub-reason with any
 * other reason is refused, so `axis_reason` only ever qualifies "wrong type
 * of research".
 */
export function parseDismissal(input: DismissalInput): ParseDismissalResult {
  const reason = (input.reason ?? "").trim();
  const axisRaw = (input.axisReason ?? "").trim();
  if (!reason) {
    if (axisRaw) return { ok: false, error: "A sub-reason needs a reason (wrong type of research)." };
    return { ok: true, value: { reason: null, axis_reason: null, axis: null } };
  }
  if (!isDismissReason(reason)) return { ok: false, error: `"${reason}" is not a dismissal reason (${DISMISS_REASONS.join(", ")}).` };
  const needsAxis = reasonNeedsAxis(reason);
  if (!axisRaw) {
    if (needsAxis) return { ok: false, error: `"${feedbackReason(reason).label}" needs a sub-reason: which axis is wrong (${wrongResearchTypeSubreasons().map((s) => s.axis_reason).join(", ")}, or <axis>:<category>).` };
    return { ok: true, value: { reason, axis_reason: null, axis: null } };
  }
  if (!needsAxis) return { ok: false, error: `A sub-reason goes with "wrong type of research", not "${dismissReasonLabel(reason)}".` };
  const parsed = parseAxisSubReason(axisRaw);
  if (!parsed.ok) return parsed;
  return { ok: true, value: { reason, axis_reason: parsed.value.axis_reason, axis: parsed.value } };
}

export type DismissReasonOption = { id: Exclude<DismissReason, "">; label: string; /** Opens the sub-reason dialog. */ axis: boolean; /** The destructive item, separated at the end of the menu. */ destructive: boolean };

/** The reasons a team's Dismiss menu offers: legacy keeps its five with their labels; fit-v1 the taxonomy's dismissal reasons in taxonomy order. */
export function dismissReasonOptions(engine: FitEngine): DismissReasonOption[] {
  if (engine !== "fit-v1") {
    const legacyLabel: Record<(typeof LEGACY_DISMISS_REASONS)[number], string> = { not_relevant: "Not relevant to this notice", wrong_area: "Wrong research area", wrong_person: "Wrong person (fixes the profile)", already_aware: "Already aware", do_not_contact: "Do not contact (all opportunities)" };
    return LEGACY_DISMISS_REASONS.map((id) => ({ id, label: legacyLabel[id], axis: false, destructive: id === "do_not_contact" }));
  }
  return feedbackReasons("dismissal").map((r) => ({ id: r.id as Exclude<DismissReason, "">, label: r.id === "do_not_contact" ? `${r.label} (all opportunities)` : r.id === "wrong_person" ? `${r.label} (fixes the profile)` : r.axis_required ? `${r.label}…` : r.label, axis: r.axis_required, destructive: r.id === "do_not_contact" }));
}

/** The preset a stored sub-reason came from (exact match, or the axis-only preset the category refines), with the axis and category split. */
export function subreasonOf(axisReason: string | null | undefined): { preset: WrongResearchTypeSubreason | null; axis: string | null; category: string | null } {
  if (!axisReason) return { preset: null, axis: null, category: null };
  const { axis, category } = parseAxisReason(axisReason);
  const presets = wrongResearchTypeSubreasons();
  const preset = presets.find((p) => p.axis_reason === axisReason) ?? presets.find((p) => p.axis_reason === axis) ?? null;
  return { preset, axis, category };
}

/** The short text after "dismissed ·": the legacy label for a legacy id, the taxonomy label otherwise, with the sub-reason ("wrong type of research · I don't run trials"). */
export function dismissReasonLabel(reason: string, axisReason?: string | null): string {
  const base = (DISMISS_REASON_LABEL as Record<string, string | undefined>)[reason] ?? (isFeedbackReason(reason) ? feedbackReason(reason).label.toLowerCase() : reason);
  if (!axisReason) return base;
  const { preset, axis, category } = subreasonOf(axisReason);
  const detail = preset && preset.axis_reason === axisReason ? preset.label : category && axis ? `${preset ? `${preset.label} · ` : ""}${categoryDisplay(axis, category).label.toLowerCase()}` : axis ? axisLabel(axis).toLowerCase() : axisReason;
  return `${base} · ${detail}`;
}
