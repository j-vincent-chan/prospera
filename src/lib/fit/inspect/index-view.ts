/**
 * Rows for the spot-check index `/admin/fit` (plan § PR 1.6 checkpoint:
 * strategists spot-check 30 investigators and 20 notices). Pure: takes the
 * slim rows the page selects (JSON-path columns, not whole profiles) and the
 * flag counts, returns the two tables sorted by name / number.
 */
import { AXES, type Axis } from "@/lib/fit/classify/contracts";
import type { AxisConfidence, Confidence, OpportunityParadigm, ParadigmWeights } from "@/lib/fit/types";
import { categoryDisplay, dominantSafe, sortedWeights, type InspectAxis } from "@/lib/fit/inspect/labels";

const CONF_SHORT: Record<Confidence, string> = { low: "L", medium: "M", high: "H" };

/** "P:M U:L D:L M:L O:L T:M" — one letter per axis, the CLI report's shorthand. Pure. */
export function confidenceSummary(confidence: Partial<AxisConfidence> | null | undefined): string {
  return ([...AXES, "topic"] as InspectAxis[])
    .map((axis) => `${axis[0]!.toUpperCase()}:${CONF_SHORT[confidence?.[axis] ?? "low"]}`)
    .join(" ");
}

export type InvestigatorIndexInput = {
  investigator_id: string;
  confidence: Partial<AxisConfidence> | null;
  item_count: number | null;
  pending_items: number | null;
  computed_at: string;
  taxonomy_version: string | null;
  /** `profile->paradigm` — { career, recent }. */
  paradigm: { career?: ParadigmWeights; recent?: ParadigmWeights } | null;
};

export type InvestigatorIndexRow = {
  investigator_id: string;
  name: string;
  career: { label: string; family: string; weight: number } | null;
  recent: { label: string; family: string; weight: number } | null;
  /** Career and recent dominant families differ. */
  moved: boolean;
  confidence: string;
  /** The weakest axis confidence, for a quick sort by the eye. */
  lowest: Confidence;
  item_count: number;
  pending_items: number;
  flags: number;
  computed_at: string;
  taxonomy_version: string | null;
  href: string;
};

function dominantView(weights: ParadigmWeights | undefined | null): { label: string; family: string; weight: number; familyId: string | null } | null {
  const d = dominantSafe(weights as Record<string, number | undefined> | undefined);
  return d ? { label: d.label, family: d.family, familyId: d.familyId, weight: d.weight } : null;
}

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
function lowestConfidence(confidence: Partial<AxisConfidence> | null | undefined): Confidence {
  let lowest: Confidence = "high";
  for (const axis of AXES as readonly Axis[]) {
    const c = confidence?.[axis] ?? "low";
    if (RANK[c] < RANK[lowest]) lowest = c;
  }
  return lowest;
}

/** Pure. Investigator rows sorted by name (then id). */
export function investigatorIndexRows(rows: InvestigatorIndexInput[], names: ReadonlyMap<string, string | null>, flags: ReadonlyMap<string, number>): InvestigatorIndexRow[] {
  return rows
    .map((r) => {
      const career = dominantView(r.paradigm?.career);
      const recent = dominantView(r.paradigm?.recent);
      return {
        investigator_id: r.investigator_id,
        name: names.get(r.investigator_id)?.trim() || r.investigator_id,
        career: career ? { label: career.label, family: career.family, weight: career.weight } : null,
        recent: recent ? { label: recent.label, family: recent.family, weight: recent.weight } : null,
        moved: Boolean(career && recent && career.familyId !== recent.familyId),
        confidence: confidenceSummary(r.confidence),
        lowest: lowestConfidence(r.confidence),
        item_count: r.item_count ?? 0,
        pending_items: r.pending_items ?? 0,
        flags: flags.get(r.investigator_id) ?? 0,
        computed_at: r.computed_at,
        taxonomy_version: r.taxonomy_version,
        href: `/investigators/${r.investigator_id}/fit`,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.investigator_id.localeCompare(b.investigator_id));
}

export type OpportunityIndexInput = {
  opportunity_id: string;
  confidence: Confidence | null;
  computed_at: string;
  taxonomy_version: string | null;
  /** `profile->>number`. */
  number: string | null;
  /** `profile->paradigm`. */
  paradigm: Partial<OpportunityParadigm> | null;
  /** `profile->needs_review`. */
  needs_review: boolean | null;
  /** `sources->complete`; null on rows written before the fix pass (treated as complete). */
  complete: boolean | null;
  /** `sources->>text`. */
  text: string | null;
};

export type OpportunityNoticeInfo = { opportunity_number: string | null; title: string | null; clinical_trial_designation: string | null };

export type OpportunityIndexRow = {
  opportunity_id: string;
  number: string;
  title: string;
  designation: string;
  /** Top `paradigm.required` (or, failing that, `required_any`) category with its weight. */
  required: { label: string; weight: number; any: boolean } | null;
  excluded: number;
  confidence: Confidence;
  complete: boolean;
  text: string;
  needs_review: boolean;
  flags: number;
  computed_at: string;
  taxonomy_version: string | null;
  href: string;
};

/** Pure. Opportunity rows sorted by number (then id). */
export function opportunityIndexRows(rows: OpportunityIndexInput[], notices: ReadonlyMap<string, OpportunityNoticeInfo>, flags: ReadonlyMap<string, number>): OpportunityIndexRow[] {
  return rows
    .map((r) => {
      const notice = notices.get(r.opportunity_id);
      const req = sortedWeights(r.paradigm?.required as Record<string, number> | undefined)[0];
      const any = req ? null : sortedWeights(r.paradigm?.required_any as Record<string, number> | undefined)[0];
      const top = req ?? any;
      return {
        opportunity_id: r.opportunity_id,
        number: r.number || notice?.opportunity_number || "—",
        title: notice?.title?.trim() || "(title not on file)",
        designation: (notice?.clinical_trial_designation ?? "unknown").replaceAll("_", " "),
        required: top ? { label: categoryDisplay("paradigm", top.id).label, weight: top.weight, any: !req } : null,
        excluded: sortedWeights(r.paradigm?.excluded as Record<string, number> | undefined).length,
        confidence: r.confidence ?? "low",
        complete: r.complete !== false,
        text: (r.text ?? "none").replaceAll("_", " "),
        needs_review: Boolean(r.needs_review),
        flags: flags.get(r.opportunity_id) ?? 0,
        computed_at: r.computed_at,
        taxonomy_version: r.taxonomy_version,
        href: `/opportunities/${r.opportunity_id}/fit`,
      };
    })
    .sort((a, b) => a.number.localeCompare(b.number) || a.opportunity_id.localeCompare(b.opportunity_id));
}

/** Pure. Flags per subject from the `fit_labels` rows (source profile_flag). */
export function flagCounts(rows: Array<{ investigator_id: string | null; opportunity_id: string | null }>): { investigators: Map<string, number>; opportunities: Map<string, number> } {
  const investigators = new Map<string, number>();
  const opportunities = new Map<string, number>();
  for (const r of rows) {
    if (r.investigator_id) investigators.set(r.investigator_id, (investigators.get(r.investigator_id) ?? 0) + 1);
    if (r.opportunity_id) opportunities.set(r.opportunity_id, (opportunities.get(r.opportunity_id) ?? 0) + 1);
  }
  return { investigators, opportunities };
}
