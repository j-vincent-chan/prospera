/**
 * "Flag as wrong" (plan § PR 1.6): the pure half of the server action —
 * input validation and the `fit_labels` row it produces — and the view of
 * stored flags the pages list. No Supabase here; the action in
 * src/app/actions/fit-inspector-actions.ts checks the admin role, calls
 * `parseFlagInput`, inserts the row and revalidates.
 *
 * axis_reason: "<axis>" (the axis is wrong), "<axis>:<category>" (one
 * category is wrong) or null (the whole profile); axis is one of the six
 * inspector axes and category a taxonomy id on that axis (topic has none).
 */
import { z } from "zod";
import { axisLabel, categoryDisplay, INSPECT_AXES, isCategoryOf, isInspectAxis, type InspectAxis } from "@/lib/fit/inspect/labels";

export const FLAG_REASON_MAX = 1_000;
export const FLAG_SOURCE = "profile_flag" as const;

export type FlagTarget = { investigatorId: string; opportunityId?: undefined } | { opportunityId: string; investigatorId?: undefined };

export type FlagInput = {
  investigatorId?: string | null;
  opportunityId?: string | null;
  /** "" or null = the whole profile; "<axis>" or "<axis>:<category>" otherwise. */
  axisReason?: string | null;
  reason?: string | null;
};

export type ParsedFlag = {
  investigator_id: string | null;
  opportunity_id: string | null;
  axis: InspectAxis | null;
  category: string | null;
  /** The stored `axis_reason`. */
  axis_reason: string | null;
  reason: string | null;
};

export type ParseFlagResult = { ok: true; value: ParsedFlag } | { ok: false; error: string };

const uuid = z.string().uuid();

/** Pure. Composes the stored `axis_reason` from its parts. */
export function axisReasonOf(axis: InspectAxis | string | null | undefined, category?: string | null): string | null {
  if (!axis) return null;
  return category ? `${axis}:${category}` : axis;
}

/** Pure. Splits a stored `axis_reason` back into axis and category; unknown values are kept as text for display. */
export function parseAxisReason(axisReason: string | null | undefined): { axis: string | null; category: string | null } {
  if (!axisReason) return { axis: null, category: null };
  const i = axisReason.indexOf(":");
  if (i < 0) return { axis: axisReason, category: null };
  return { axis: axisReason.slice(0, i), category: axisReason.slice(i + 1) || null };
}

/**
 * Pure. Validates the action input: exactly one subject id (a UUID), the axis
 * one of the six, the category a taxonomy id on that axis when given (topic
 * takes none), the reason ≤ FLAG_REASON_MAX characters and required when the
 * flag names no axis (a bare "this profile is wrong" with no words is noise).
 */
export function parseFlagInput(input: FlagInput): ParseFlagResult {
  const investigatorId = typeof input.investigatorId === "string" && input.investigatorId.trim() ? input.investigatorId.trim() : null;
  const opportunityId = typeof input.opportunityId === "string" && input.opportunityId.trim() ? input.opportunityId.trim() : null;
  if (investigatorId && opportunityId) return { ok: false, error: "Flag one profile at a time: an investigator or an opportunity, not both." };
  if (!investigatorId && !opportunityId) return { ok: false, error: "Nothing to flag: no investigator or opportunity id." };
  if (investigatorId && !uuid.safeParse(investigatorId).success) return { ok: false, error: "Invalid investigator id." };
  if (opportunityId && !uuid.safeParse(opportunityId).success) return { ok: false, error: "Invalid opportunity id." };

  const raw = typeof input.axisReason === "string" ? input.axisReason.trim() : "";
  let axis: InspectAxis | null = null;
  let category: string | null = null;
  if (raw) {
    const parts = parseAxisReason(raw);
    if (!parts.axis || !isInspectAxis(parts.axis)) return { ok: false, error: `Unknown axis "${parts.axis ?? raw}"; expected one of ${INSPECT_AXES.join(", ")}.` };
    axis = parts.axis;
    if (parts.category !== null) {
      if (axis === "topic") return { ok: false, error: "Topic has no categories; flag the topic axis as a whole." };
      if (!isCategoryOf(axis, parts.category)) return { ok: false, error: `"${parts.category}" is not a ${axisLabel(axis).toLowerCase()} category in the taxonomy.` };
      category = parts.category;
    }
  }

  const reasonText = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reasonText.length > FLAG_REASON_MAX) return { ok: false, error: `Reason is too long (${reasonText.length} characters; the limit is ${FLAG_REASON_MAX}).` };
  if (!axis && !reasonText) return { ok: false, error: "Say what is wrong: pick an axis or write a reason." };

  return {
    ok: true,
    value: {
      investigator_id: investigatorId,
      opportunity_id: opportunityId,
      axis,
      category,
      axis_reason: axisReasonOf(axis, category),
      reason: reasonText || null,
    },
  };
}

/** The `fit_labels` insert for a parsed flag. Pure. */
export function flagRow(parsed: ParsedFlag, labeler: string, engineVersion: string): {
  investigator_id: string | null;
  opportunity_id: string | null;
  tier: null;
  reason: string | null;
  axis_reason: string | null;
  labeler: string;
  engine_version: string;
  source: typeof FLAG_SOURCE;
} {
  return {
    investigator_id: parsed.investigator_id,
    opportunity_id: parsed.opportunity_id,
    tier: null,
    reason: parsed.reason,
    axis_reason: parsed.axis_reason,
    labeler,
    engine_version: engineVersion,
    source: FLAG_SOURCE,
  };
}

/** One stored `fit_labels` row as the pages read it. */
export type FitLabelRow = {
  id: string;
  investigator_id: string | null;
  opportunity_id: string | null;
  tier: string | null;
  reason: string | null;
  axis_reason: string | null;
  labeler: string | null;
  engine_version: string | null;
  source: string;
  created_at: string;
};

export type FlagView = {
  id: string;
  created_at: string;
  /** The labeler's name or email when the profiles row was found, else a short id. */
  who: string;
  axis: string | null;
  axisLabel: string | null;
  category: string | null;
  categoryLabel: string | null;
  /** "Whole profile", "Paradigm", "Paradigm · Clinical trials" … */
  scope: string;
  reason: string | null;
  engine_version: string | null;
  source: string;
};

/** Pure. A stored flag → the list row, newest first when sorted by the caller. */
export function flagView(row: FitLabelRow, labelerName: string | null | undefined): FlagView {
  const { axis, category } = parseAxisReason(row.axis_reason);
  const axisText = axis ? axisLabel(axis) : null;
  const categoryText = axis && category ? categoryDisplay(axis, category).label : null;
  return {
    id: row.id,
    created_at: row.created_at,
    who: labelerName?.trim() || (row.labeler ? row.labeler.slice(0, 8) : "unknown"),
    axis,
    axisLabel: axisText,
    category,
    categoryLabel: categoryText,
    scope: axisText ? (categoryText ? `${axisText} · ${categoryText}` : axisText) : "Whole profile",
    reason: row.reason,
    engine_version: row.engine_version,
    source: row.source,
  };
}

/** Pure. Flags newest first. */
export function sortFlags<T extends { created_at: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
}
