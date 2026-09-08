/**
 * Display labels for the profile inspector (plan § PR 1.6). Pure.
 *
 * The taxonomy carries labels for paradigm families and categories and for
 * unit levels; design ids, materials kinds and objectives have none, so those
 * read through `display-labels.ts` — the written label per id, with their
 * design / materials group where the taxonomy has one. Every taxonomy lookup
 * goes through src/lib/fit/taxonomy.ts; every enum a person reads goes
 * through `displayLabel`.
 */
import { AXES, type Axis } from "@/lib/fit/classify/contracts";
import { designLabel, DESIGN_GROUP_LABEL, MATERIALS_GROUP_LABEL, materialsLabel, objectiveLabel, spellOut } from "@/lib/fit/inspect/display-labels";
import {
  categoryLabel,
  designGroupOf,
  familyLabel,
  familyOf,
  isDesignId,
  isMaterialsKind,
  isObjectiveId,
  isParadigmCategory,
  isParadigmFamily,
  isUnitLevel,
  levelLabel,
  materialsGroupOf,
} from "@/lib/fit/taxonomy";

/** The six inspector axes — the five structured axes plus topic (the plan's "axis in the six"). */
export type InspectAxis = Axis | "topic";
export const INSPECT_AXES: readonly InspectAxis[] = [...AXES, "topic"];
export const isInspectAxis = (id: string): id is InspectAxis => (INSPECT_AXES as readonly string[]).includes(id);

const AXIS_LABELS: Record<InspectAxis, string> = {
  paradigm: "Paradigm",
  unit: "Unit of analysis",
  design: "Study design",
  materials: "Materials and data",
  objective: "Scientific objective",
  topic: "Topic",
};

const AXIS_DESCRIPTIONS: Record<InspectAxis, string> = {
  paradigm: "Axis A — how the work asks its questions (the gating axis; 23 categories in 7 families).",
  unit: "Axis B — the level of biological or social organization studied (L1 molecular–cellular … L5 system).",
  design: "Axis C — the study designs the evidence uses.",
  materials: "Axis D — the materials and data the work handles.",
  objective: "Axis E — what the work is for; scored, never gates.",
  topic: "What the work is about — MeSH major topics, RCDC categories, terms. Never gates.",
};

export function axisLabel(axis: InspectAxis | string): string {
  return isInspectAxis(axis) ? AXIS_LABELS[axis] : axis;
}

export function axisDescription(axis: InspectAxis | string): string {
  return isInspectAxis(axis) ? AXIS_DESCRIPTIONS[axis] : "";
}

/** `hybrid_effectiveness_implementation` → "Hybrid effectiveness implementation"; `L3` stays `L3`. The last resort — prefer `displayLabel`, which knows the written labels. */
export const humanize = spellOut;

/** A category as the page shows it: the label, the raw id, and the family / level / group it belongs to. */
export type CategoryDisplay = {
  id: string;
  label: string;
  /** Family label (paradigm), level label (unit), group name (design, materials); null for objective and unknown ids. */
  group: string | null;
  /** True when the taxonomy knows the id on that axis. */
  known: boolean;
};

/** Pure. Unknown ids (a taxonomy edit since the row was written) are shown humanized and marked `known: false`, never thrown. */
export function categoryDisplay(axis: InspectAxis | string, id: string): CategoryDisplay {
  switch (axis) {
    case "paradigm":
      if (isParadigmCategory(id)) return { id, label: categoryLabel(id), group: familyLabel(familyOf(id)), known: true };
      break;
    case "unit":
      if (isUnitLevel(id)) return { id, label: `${id} · ${levelLabel(id)}`, group: null, known: true };
      break;
    case "design":
      if (isDesignId(id)) return { id, label: designLabel(id), group: DESIGN_GROUP_LABEL[designGroupOf(id)], known: true };
      break;
    case "materials":
      if (isMaterialsKind(id)) return { id, label: materialsLabel(id), group: MATERIALS_GROUP_LABEL[materialsGroupOf(id)], known: true };
      break;
    case "objective":
      if (isObjectiveId(id)) return { id, label: objectiveLabel(id), group: null, known: true };
      break;
    default:
      break;
  }
  return { id, label: humanize(id), group: null, known: false };
}

/** Family label, or the id humanized when the taxonomy does not know it. Pure, never throws. */
export function familyLabelSafe(family: string): string {
  return isParadigmFamily(family) ? familyLabel(family) : humanize(family);
}

/** Whether `id` is a category of `axis` in the taxonomy (topic has no categories). */
export function isCategoryOf(axis: InspectAxis | string, id: string): boolean {
  return categoryDisplay(axis, id).known;
}

export const CONFIDENCE_LABEL: Record<"low" | "medium" | "high", string> = { low: "Low", medium: "Medium", high: "High" };

/** The heaviest paradigm category with its labels; `familyId` null when the taxonomy no longer knows the id. Pure, never throws (unlike `dominantParadigm`). */
export function dominantSafe(weights: Record<string, number | undefined> | null | undefined): { id: string; label: string; familyId: string | null; family: string; weight: number } | null {
  const top = sortedWeights(weights)[0];
  if (!top) return null;
  const d = categoryDisplay("paradigm", top.id);
  const familyId = isParadigmCategory(top.id) ? familyOf(top.id) : null;
  return { id: top.id, label: d.label, familyId, family: d.group ?? "—", weight: top.weight };
}

/** Sort weights largest first, ties by id, zeros and non-numbers dropped. Pure. */
export function sortedWeights(weights: Record<string, number | undefined> | null | undefined): Array<{ id: string; weight: number }> {
  if (!weights || typeof weights !== "object") return [];
  return Object.entries(weights)
    .filter((e): e is [string, number] => typeof e[1] === "number" && Number.isFinite(e[1]) && e[1] > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id, weight]) => ({ id, weight }));
}
