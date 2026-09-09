/**
 * View model for `/admin/fit-labels` (plan § PR 2.4 "a minimal labeling
 * page"). Pure: the manifest's pairs, the stored gold rows, the labelers'
 * identities and the signed-in admin in; the rows the page renders out —
 * per pair the investigator and notice summaries, the three slots' latest
 * labels, the adjudication status (derived here, never stored), whether
 * this user may label it and what they saved before — plus progress counts
 * and the slot assignment. A synthetic pair (goldset/synthetic.ts) has no
 * investigator inspector link; it takes a label like any other once
 * `fit_labels.synthetic_source` is on the database (`syntheticAvailable`).
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
  /**
   * Where a row's two subjects open. `investigator` and `notice` are the
   * pages a strategist already reads — the research profile and the notice
   * itself — because that is what "would I send this?" is answered from;
   * `investigatorFit` and `noticeFit` are the engine inspectors beside them,
   * for an adjudicator asking why the system scored it that way. The
   * investigator pair is null for a synthetic pair: there is no roster row
   * behind it.
   */
  hrefs: { investigator: string | null; notice: string; investigatorFit: string | null; noticeFit: string };
  slots: Record<Slot, SlotView | null>;
  adjudication: Adjudication;
  /** The signed-in user's slot on this pair and what they saved (null: nothing yet). */
  mine: { slot: Slot | null; saved: SlotView | null };
  /** The page offers this user a form on this pair (has a slot; a synthetic pair only while `syntheticAvailable`). */
  canLabel: boolean;
};

export type LabelsPageView = {
  assignment: SlotAssignment;
  slotNames: Record<Slot, string>;
  progress: Progress;
  strata: Array<{ stratum: Stratum; count: number }>;
  synthetic: number;
  /** `fit_labels.synthetic_source` is on the database, so synthetic pairs can be labeled here. */
  syntheticAvailable: boolean;
  pairs: PairView[];
  filter: LabelsFilter;
  shown: number;
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
  filter?: LabelsFilter | string | null;
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
  const nameOf = (id: string | null): string => {
    if (!id) return "unassigned";
    const i = input.identities.find((x) => x.id === id);
    return i?.name?.trim() || i?.email || id.slice(0, 8);
  };
  const slotNames = { a: nameOf(assignment.slots.a), b: nameOf(assignment.slots.b), adjudicator: nameOf(assignment.slots.adjudicator) } as Record<Slot, string>;
  const keys = input.manifest.pairs.map((p) => pairKey(p.investigator_id, p.opportunity_id));
  const progress = progressOf(keys, latest, assignment.slots);
  const filter = parseFilter(typeof input.filter === "string" ? input.filter : null);
  const mySlot = assignment.current;
  const syntheticAvailable = input.syntheticAvailable ?? true;

  const all: PairView[] = input.manifest.pairs.map((pair) => {
    const key = pairKey(pair.investigator_id, pair.opportunity_id);
    const rows = slotLabelsFor(latest.get(key), assignment.slots);
    const slots = { a: slotView(rows.a), b: slotView(rows.b), adjudicator: slotView(rows.adjudicator) } as Record<Slot, SlotView | null>;
    return {
      pair,
      key,
      hrefs: {
        investigator: pair.synthetic ? null : `/investigators/${pair.investigator_id}`,
        notice: `/opportunities/${pair.opportunity_id}`,
        investigatorFit: pair.synthetic ? null : `/investigators/${pair.investigator_id}/fit`,
        noticeFit: `/opportunities/${pair.opportunity_id}/fit`,
      },
      slots,
      adjudication: adjudicate(rows),
      mine: { slot: mySlot, saved: mySlot ? slots[mySlot] : null },
      canLabel: mySlot !== null && (!pair.synthetic || syntheticAvailable),
    };
  });

  const pairs = all.filter((v) => {
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

  return {
    assignment,
    slotNames,
    progress,
    strata: STRATA.map((stratum) => ({ stratum, count: input.manifest.pairs.filter((p) => p.stratum === stratum).length })),
    synthetic: input.manifest.pairs.filter((p) => p.synthetic).length,
    syntheticAvailable,
    pairs,
    filter,
    shown: pairs.length,
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
