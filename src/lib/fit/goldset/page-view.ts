/**
 * View model for `/admin/fit-labels` — "Calibration" (plan § PR 2.4 "a
 * minimal labeling page"). Pure: the manifest's pairs, the stored gold rows,
 * the labelers' identities and the signed-in admin in; what the page renders
 * out — per pair the investigator and notice summaries, the three slots'
 * latest labels, the adjudication status (derived here, never stored),
 * whether this user may label it and what they saved before — plus progress
 * counts, the slot assignment and the one pair the focus card shows. A
 * synthetic pair (goldset/synthetic.ts) has no investigator inspector link;
 * it takes a label like any other once `fit_labels.synthetic_source` is on
 * the database (`syntheticAvailable`).
 *
 * Blind grading is enforced here, not in the client: a grader who has not
 * saved a row on a pair never receives another slot's tier for it, only the
 * fact that a row exists (`slotLabeled`). Hiding it in the browser would
 * leak it to devtools, and two independent graders are the whole point.
 */
import { csvRowFor, type CsvRow } from "@/lib/fit/goldset/csv";
import { adjudicate, assignSlots, latestByLabeler, progressOf, SLOT_LABEL, SLOTS, slotLabelsFor, type Adjudication, type GoldLabelRow, type LabelerIdentity, type Progress, type Slot, type SlotAssignment } from "@/lib/fit/goldset/labels";
import type { GoldsetManifest, LabelerConfig, ManifestPair } from "@/lib/fit/goldset/manifest";
import { TIER_LABEL_GOLD } from "@/lib/fit/goldset/reasons";
import { pairKey, STRATA, type Stratum } from "@/lib/fit/goldset/stratify";
import { axisLabel, categoryDisplay, type InspectAxis } from "@/lib/fit/inspect/labels";
import { DESIGN_IDS, feedbackReason, isFeedbackReason, MATERIALS_KIND_IDS, OBJECTIVE_IDS, PARADIGM_CATEGORY_IDS, UNIT_LEVEL_IDS } from "@/lib/fit/taxonomy";
import { parseAxisReason } from "@/lib/fit/inspect/flags";
import type { Tier } from "@/lib/fit/types";

export type LabelsFilter = "all" | "todo" | "disagreements" | "done";
export const LABELS_FILTERS: readonly LabelsFilter[] = ["all", "todo", "disagreements", "done"];

export type SlotView = {
  tier: Tier;
  tierLabel: string;
  reason: string | null;
  reasonLabel: string | null;
  axis_reason: string | null;
  /** "Paradigm · Clinical trials" */
  axisLabel: string | null;
  created_at: string;
};

export type PairView = {
  pair: ManifestPair;
  key: string;
  /** Inspector links; the investigator's is null for a synthetic pair (there is no roster row behind it). */
  hrefs: { investigator: string | null; notice: string };
  /** The slots' labels as this viewer may see them — a slot blind grading withholds is null here even though it has a row. */
  slots: Record<Slot, SlotView | null>;
  /** Whether each slot has a stored label. The only signal left for a slot `slots` withholds. */
  slotLabeled: Record<Slot, boolean>;
  /** True while blind grading withholds the other slots' labels on this pair (a grader who has not saved their own row). */
  blind: boolean;
  adjudication: Adjudication;
  /** The signed-in user's slot on this pair and what they saved (null: nothing yet). */
  mine: { slot: Slot | null; saved: SlotView | null };
  /** The page offers this user a form on this pair (has a slot; a synthetic pair only while `syntheticAvailable`). */
  canLabel: boolean;
};

export type LabelsPageView = {
  assignment: SlotAssignment;
  slotNames: Record<Slot, string>;
  /** The initials tile's letters per slot, from the same name the strip prints. */
  slotInitials: Record<Slot, string>;
  progress: Progress;
  strata: Array<{ stratum: Stratum; count: number }>;
  synthetic: number;
  /** `fit_labels.synthetic_source` is on the database, so synthetic pairs can be labeled here. */
  syntheticAvailable: boolean;
  pairs: PairView[];
  filter: LabelsFilter;
  shown: number;
  /** The pair the focus card shows — `?pair=` when the filter holds it, else the first this user has not labeled; null while the filter is empty. */
  current: PairView | null;
  /** Its index in `pairs`; -1 when there is none. */
  currentIndex: number;
  /** The user may save labels (has a slot). */
  canLabel: boolean;
  /** Why not, when they cannot. */
  cannotLabelReason: string | null;
};

export type LabelsPageInput = {
  manifest: Pick<GoldsetManifest, "pairs" | "version">;
  rows: readonly GoldLabelRow[];
  identities: readonly LabelerIdentity[];
  config: LabelerConfig;
  currentUserId: string;
  /** `?filter=`. Absent (or blank) takes the role's default: the to-do list for anyone with a slot, the whole set for an admin without one. */
  filter?: LabelsFilter | string | null;
  /** `?pair=`. A pair id outside the filtered list falls back to the default rather than erroring. */
  pair?: string | null;
  /** False while `fit_labels.synthetic_source` is missing (the loader's `synthetic_available`); default true. */
  syntheticAvailable?: boolean;
};

/** Pure. The axis sub-reason as the page shows it. */
export function axisReasonLabel(axisReason: string | null): string | null {
  if (!axisReason) return null;
  const { axis, category } = parseAxisReason(axisReason);
  if (!axis) return axisReason;
  return category ? `${axisLabel(axis)} · ${categoryDisplay(axis, category).label}` : axisLabel(axis);
}

/** Pure. A stored reason's label — the taxonomy's, or the raw id for a reason the taxonomy no longer knows. */
export function reasonLabel(reason: string | null): string | null {
  if (!reason) return null;
  return isFeedbackReason(reason) ? feedbackReason(reason).label : reason;
}

export function slotView(row: GoldLabelRow | null): SlotView | null {
  if (!row?.tier) return null;
  const tier = row.tier as Tier;
  return {
    tier,
    tierLabel: TIER_LABEL_GOLD[tier] ?? row.tier,
    reason: row.reason,
    reasonLabel: reasonLabel(row.reason),
    axis_reason: row.axis_reason,
    axisLabel: axisReasonLabel(row.axis_reason),
    created_at: row.created_at,
  };
}

export function parseFilter(raw: string | null | undefined): LabelsFilter {
  return (LABELS_FILTERS as readonly string[]).includes(raw ?? "") ? (raw as LabelsFilter) : "all";
}

/**
 * Pure. The initials tile's letters — the sidebar's rule (app-shell-sidebar),
 * kept here because a server component cannot call a function exported from a
 * `"use client"` module.
 */
export function initialsOf(name: string | null, email: string | null): string {
  const source = (name?.trim() || email?.split("@")[0] || "?").replace(/[._-]+/g, " ");
  return source
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

/**
 * Pure. Blind grading (README "Blind grading is a server rule, not a CSS
 * one"): a grader who has not saved their own row on this pair receives no
 * other slot's label — not the peer grader's, and not the adjudicator's,
 * which would hand them the answer just as plainly — and no adjudicated tier
 * or reason for the same reason. `slotLabeled` still says a row exists, which
 * is what the footer's "hidden until you submit" needs. The adjudicator is
 * exempt: ruling on a disagreement means seeing both graders.
 */
export function redactBlind(view: PairView, mySlot: Slot | null): PairView {
  if ((mySlot !== "a" && mySlot !== "b") || view.mine.saved) return view;
  const slots: Record<Slot, SlotView | null> = { ...view.slots, adjudicator: null };
  slots[mySlot === "a" ? "b" : "a"] = null;
  return { ...view, slots, blind: true, adjudication: { ...view.adjudication, tier: null, reason: null, axis_reason: null, by: null } };
}

/** Pure. The focus card's index: `?pair=` when the filtered list holds it, else the first pair this user has not labeled, else the first; -1 while the list is empty. */
export function currentPairIndex(pairs: readonly PairView[], pairId: string | null | undefined): number {
  if (pairs.length === 0) return -1;
  if (pairId) {
    const asked = pairs.findIndex((p) => p.pair.id === pairId);
    if (asked >= 0) return asked;
  }
  const ungraded = pairs.findIndex((p) => p.mine.saved === null);
  return ungraded >= 0 ? ungraded : 0;
}

/** Why a signed-in admin has no slot. */
export function cannotLabelReason(assignment: SlotAssignment, config: LabelerConfig, labelersPath: string): string | null {
  if (assignment.current) return null;
  if (assignment.mode === "configured") return `Labelers are configured in ${labelersPath} (${SLOTS.map((s) => `${SLOT_LABEL[s]}: ${config[s] ?? "—"}`).join(", ")}); you are not one of them.`;
  return `Both labeler slots are taken by order of first label (A, then B). The adjudicator slot exists only when ${labelersPath} names it (D4): add yourself there as "adjudicator", then rebuild and redeploy.`;
}

export function labelsPageView(input: LabelsPageInput, labelersPath = "docs/fit-engine/goldset/labelers.json"): LabelsPageView {
  const gold = input.rows.filter((r) => r.source === "gold");
  const latest = latestByLabeler(gold);
  const assignment = assignSlots(input.config, input.identities, gold, input.currentUserId);
  /** `profiles.full_name`, else the email's local part (the strip prints people, not mailboxes), else a short id. */
  const nameOf = (id: string | null): string => {
    if (!id) return "unassigned";
    const i = input.identities.find((x) => x.id === id);
    return i?.name?.trim() || i?.email?.split("@")[0]?.trim() || id.slice(0, 8);
  };
  const slotNames = { a: nameOf(assignment.slots.a), b: nameOf(assignment.slots.b), adjudicator: nameOf(assignment.slots.adjudicator) } as Record<Slot, string>;
  const slotInitials = { a: initialsOf(slotNames.a, null), b: initialsOf(slotNames.b, null), adjudicator: initialsOf(slotNames.adjudicator, null) } as Record<Slot, string>;
  const keys = input.manifest.pairs.map((p) => pairKey(p.investigator_id, p.opportunity_id));
  const progress = progressOf(keys, latest, assignment.slots);
  const mySlot = assignment.current;
  // An explicit `?filter=` parses exactly as it always has (an unknown value is
  // "all"); only its absence takes the role's default.
  const requested = typeof input.filter === "string" && input.filter ? input.filter : null;
  const filter = requested ? parseFilter(requested) : mySlot ? "todo" : "all";
  const syntheticAvailable = input.syntheticAvailable ?? true;

  const all: PairView[] = input.manifest.pairs.map((pair) => {
    const key = pairKey(pair.investigator_id, pair.opportunity_id);
    const rows = slotLabelsFor(latest.get(key), assignment.slots);
    const slots = { a: slotView(rows.a), b: slotView(rows.b), adjudicator: slotView(rows.adjudicator) } as Record<Slot, SlotView | null>;
    return {
      pair,
      key,
      hrefs: { investigator: pair.synthetic ? null : `/investigators/${pair.investigator_id}/fit`, notice: `/opportunities/${pair.opportunity_id}/fit` },
      slots,
      slotLabeled: { a: slots.a !== null, b: slots.b !== null, adjudicator: slots.adjudicator !== null } as Record<Slot, boolean>,
      blind: false,
      adjudication: adjudicate(rows),
      mine: { slot: mySlot, saved: mySlot ? slots[mySlot] : null },
      canLabel: mySlot !== null && (!pair.synthetic || syntheticAvailable),
    };
  });

  // Filtered before redaction: "done" is `adjudication.tier !== null`, and
  // blind grading nulls that tier for the viewer's own ungraded pairs.
  const filtered = all.filter((v) => {
    switch (filter) {
      case "todo":
        if (!v.canLabel) return false;
        if (mySlot === "adjudicator") return v.adjudication.status === "unresolved";
        return v.mine.saved === null;
      case "disagreements":
        return v.adjudication.status === "unresolved";
      case "done":
        return v.adjudication.tier !== null;
      default:
        return true;
    }
  });

  const currentIndex = currentPairIndex(filtered, typeof input.pair === "string" ? input.pair : null);
  const pairs = filtered.map((v) => redactBlind(v, mySlot));

  return {
    assignment,
    slotNames,
    slotInitials,
    progress,
    strata: STRATA.map((stratum) => ({ stratum, count: input.manifest.pairs.filter((p) => p.stratum === stratum).length })),
    synthetic: input.manifest.pairs.filter((p) => p.synthetic).length,
    syntheticAvailable,
    pairs,
    filter,
    shown: pairs.length,
    current: currentIndex >= 0 ? pairs[currentIndex]! : null,
    currentIndex,
    canLabel: mySlot !== null,
    cannotLabelReason: cannotLabelReason(assignment, input.config, labelersPath),
  };
}

/** Pure. The CSV rows of the current labels (the page's export), in manifest order — the import script reads them back. */
export function labeledCsvRows(manifest: Pick<GoldsetManifest, "pairs">, rows: readonly GoldLabelRow[], slots: Record<Slot, string | null>): CsvRow[] {
  const latest = latestByLabeler(rows.filter((r) => r.source === "gold"));
  return manifest.pairs.map((pair) => {
    const l = slotLabelsFor(latest.get(pairKey(pair.investigator_id, pair.opportunity_id)), slots);
    const cell = (r: GoldLabelRow | null) => (r?.tier ? { tier: r.tier, reason: r.reason ?? "", axis_reason: r.axis_reason ?? "" } : undefined);
    return csvRowFor(pair, { a: cell(l.a), b: cell(l.b), adj: cell(l.adjudicator) });
  });
}

// ---------------------------------------------------------------------------
// Picker options
// ---------------------------------------------------------------------------

export type AxisCategoryOptions = Record<InspectAxis, Array<{ id: string; label: string }>>;

/** Pure. Every category per inspector axis with its display label (topic has none) — the custom axis sub-reason picker. */
export function axisCategoryOptions(): AxisCategoryOptions {
  const of = (axis: InspectAxis, ids: readonly string[]) => ids.map((id) => ({ id, label: categoryDisplay(axis, id).label }));
  return {
    paradigm: of("paradigm", PARADIGM_CATEGORY_IDS),
    unit: of("unit", UNIT_LEVEL_IDS),
    design: of("design", DESIGN_IDS),
    materials: of("materials", MATERIALS_KIND_IDS),
    objective: of("objective", OBJECTIVE_IDS),
    topic: [],
  };
}
