/**
 * Investigator profile view model for `/investigators/[id]/fit` (plan § PR
 * 1.6). Pure: takes the stored `investigator_fit_profiles` row and the
 * evidence lookups, returns what the page renders. No Supabase, no fetch.
 *
 * What a reviewer needs to see (spec §5): per axis the categories by weight
 * with display labels, career beside recent for the paradigm, the confidence
 * per axis, the top evidence behind each category (provenance top-3, career
 * view), the evidence summary, characteristics, aspirations, do_not_suggest,
 * collaborators, and whether the profile is partial (`pending_items`, D20).
 */
import { AXES, type Axis } from "@/lib/fit/classify/contracts";
import type { StoredProfileRow } from "@/lib/fit/profile/investigator";
import { thinEvidence } from "@/lib/fit/taxonomy";
import type { AxisConfidence, AxisProvenance, Confidence, InvestigatorFitProfile } from "@/lib/fit/types";
import { countByKind, EMPTY_LOOKUP, resolveEvidenceId, type EvidenceLookup, type EvidenceRef } from "@/lib/fit/inspect/evidence";
import { axisDescription, axisLabel, categoryDisplay, dominantSafe, familyLabelSafe, sortedWeights, type InspectAxis } from "@/lib/fit/inspect/labels";

export type CategoryRowView = {
  id: string;
  label: string;
  group: string | null;
  known: boolean;
  /** Career-view weight (every axis); the paradigm axis also carries `recent`. */
  weight: number;
  recent: number | null;
  /** Provenance top items, career view, resolved. Empty when the row stored none for this category. */
  evidence: EvidenceRef[];
  /** Fewer than `thin_evidence.min_items` non-prior provenance ids behind the category (the report's approximation). */
  thin: boolean;
};

export type AxisSectionView = {
  axis: Axis;
  label: string;
  description: string;
  confidence: Confidence;
  rows: CategoryRowView[];
  /** Every category id present on the axis, for the axis-level flag form. */
  categories: Array<{ id: string; label: string }>;
};

export type PartialBanner = {
  pending_items: number;
  message: string;
};

export type InvestigatorProfileView = {
  investigator_id: string;
  taxonomy_version: string;
  computed_at: string;
  item_count: number;
  pending_items: number;
  partial: PartialBanner | null;
  confidence: AxisConfidence;
  confidenceRows: Array<{ axis: InspectAxis; label: string; confidence: Confidence }>;
  dominant: { career: { id: string; label: string; family: string; weight: number } | null; recent: { id: string; label: string; family: string; weight: number } | null };
  axes: AxisSectionView[];
  topic: { mesh_major: string[]; rcdc: string[]; free_text: string | null; confidence: Confidence };
  evidence: {
    summary: Array<{ label: string; value: string }>;
    /** Provenance ids by evidence kind (distinct ids). */
    byKind: Array<{ kind: string; label: string; count: number }>;
    distinctIds: number;
  };
  characteristics: Array<{ label: string; value: string }>;
  aspirations: Array<{ id: string; label: string }>;
  do_not_suggest: Array<{ id: string; label: string }>;
  collaborators: Array<{ id: string; name: string; family: string; categories: string[] }>;
};

const fmt = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.map(String).join(", ") : "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
};

function provenanceIndex(provenance: AxisProvenance[] | undefined): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const p of provenance ?? []) {
    if (!p || typeof p !== "object" || !Array.isArray(p.top_items)) continue;
    index.set(`${p.axis}:${p.category}`, p.top_items.filter((id): id is string => typeof id === "string"));
  }
  return index;
}

function axisWeights(profile: InvestigatorFitProfile, axis: Axis): { career: Record<string, number | undefined>; recent: Record<string, number | undefined> | null } {
  if (axis === "paradigm") {
    const p = profile.paradigm ?? { career: {}, recent: {} };
    return { career: (p.career ?? {}) as Record<string, number | undefined>, recent: (p.recent ?? {}) as Record<string, number | undefined> };
  }
  return { career: (profile[axis] ?? {}) as Record<string, number | undefined>, recent: null };
}

/** Pure. The stored row → the page's view. Missing optional fields render as empty, never throw. */
export function investigatorProfileView(row: StoredProfileRow, lookup: EvidenceLookup = EMPTY_LOOKUP): InvestigatorProfileView {
  const profile = row.profile;
  const confidence = (row.confidence ?? profile.confidence ?? {}) as AxisConfidence;
  const conf = (axis: InspectAxis): Confidence => confidence[axis] ?? "low";
  const provenance = provenanceIndex(profile.provenance);
  const minItems = thinEvidence().min_items;

  const axes: AxisSectionView[] = AXES.map((axis) => {
    const { career, recent } = axisWeights(profile, axis);
    const careerSorted = sortedWeights(career);
    const ids = new Set(careerSorted.map((e) => e.id));
    const recentSorted = recent ? sortedWeights(recent) : [];
    for (const e of recentSorted) ids.add(e.id);
    const rows: CategoryRowView[] = Array.from(ids)
      .map((id) => {
        const d = categoryDisplay(axis, id);
        const evidenceIds = provenance.get(`${axis}:${id}`) ?? [];
        const evidence = evidenceIds.map((eid) => resolveEvidenceId(eid, lookup));
        return {
          id,
          label: d.label,
          group: d.group,
          known: d.known,
          weight: typeof career[id] === "number" ? career[id]! : 0,
          recent: recent ? (typeof recent[id] === "number" ? recent[id]! : 0) : null,
          evidence,
          thin: evidence.filter((e) => !e.prior).length < minItems,
        };
      })
      .sort((a, b) => b.weight - a.weight || (b.recent ?? 0) - (a.recent ?? 0) || a.id.localeCompare(b.id));
    return {
      axis,
      label: axisLabel(axis),
      description: axisDescription(axis),
      confidence: conf(axis),
      rows,
      categories: rows.map((r) => ({ id: r.id, label: r.label })),
    };
  });

  const dom = (weights: Record<string, number | undefined>) => {
    const d = dominantSafe(weights);
    return d ? { id: d.id, label: d.label, family: d.family, weight: d.weight } : null;
  };
  const paradigm = profile.paradigm ?? { career: {}, recent: {} };

  const allIds = new Set<string>();
  for (const ids of provenance.values()) for (const id of ids) allIds.add(id);
  const e = profile.evidence_summary ?? ({} as InvestigatorFitProfile["evidence_summary"]);
  const c = profile.characteristics ?? ({} as InvestigatorFitProfile["characteristics"]);
  const pending = typeof row.pending_items === "number" ? row.pending_items : 0;

  return {
    investigator_id: row.investigator_id,
    taxonomy_version: row.taxonomy_version,
    computed_at: row.computed_at,
    item_count: row.item_count,
    pending_items: pending,
    partial:
      pending > 0
        ? {
            pending_items: pending,
            message: `${pending} of ${row.item_count} evidence item${pending === 1 ? "" : "s"} ${pending === 1 ? "is" : "are"} still waiting for the classifier or failed to normalize. The weights below are a lower bound from the rules and the cache; the row stays due until the nightly run classifies the rest (D20).`,
          }
        : null,
    confidence,
    confidenceRows: ([...AXES, "topic"] as InspectAxis[]).map((axis) => ({ axis, label: axisLabel(axis), confidence: conf(axis) })),
    dominant: { career: dom((paradigm.career ?? {}) as Record<string, number | undefined>), recent: dom((paradigm.recent ?? {}) as Record<string, number | undefined>) },
    axes,
    topic: {
      mesh_major: Array.isArray(profile.topic?.mesh_major) ? profile.topic.mesh_major : [],
      rcdc: Array.isArray(profile.topic?.rcdc) ? profile.topic.rcdc : [],
      free_text: profile.topic?.free_text ?? null,
      confidence: conf("topic"),
    },
    evidence: {
      summary: [
        { label: "Verified publications", value: fmt(e.publications_verified ?? 0) },
        { label: "NIH grants (not rejected)", value: fmt(e.grants ?? 0) },
        { label: "Clinical trials", value: `${fmt(e.trials ?? 0)}${e.trials_as_pi ? ` (${e.trials_as_pi} as PI)` : ""}` },
        { label: "Biosketch", value: fmt(e.biosketch ?? "not_requested").replaceAll("_", " ") },
        { label: "Self-declared axes", value: fmt(Boolean(e.self_declared)) },
        { label: "Items aggregated", value: fmt(row.item_count) },
      ],
      byKind: countByKind(allIds),
      distinctIds: allIds.size,
    },
    characteristics: [
      { label: "Career stage", value: fmt(c.career_stage) },
      { label: "Clinical role", value: fmt(c.clinical_role).replaceAll("_", " ") },
      { label: "ESI", value: c.esi === null || c.esi === undefined ? "not inferable" : c.esi ? "yes" : "no" },
      { label: "ESI eligible until", value: fmt(c.esi_eligible_until) },
      { label: "Mechanisms held", value: fmt(c.mechanisms_held) },
      { label: "Active awards", value: fmt(c.active_awards ?? 0) },
      { label: "Trials as PI", value: fmt(c.trial_pi_count ?? 0) },
      { label: "Degrees", value: fmt(c.degrees) },
      { label: "Title series", value: fmt(c.title_series) },
    ],
    aspirations: (Array.isArray(profile.aspirations) ? profile.aspirations : []).map((id) => ({ id, label: categoryDisplay("paradigm", id).label })),
    do_not_suggest: (Array.isArray(profile.do_not_suggest) ? profile.do_not_suggest : []).map((id) => ({ id, label: familyLabelSafe(id) })),
    collaborators: (Array.isArray(profile.collaborators) ? profile.collaborators : []).map((co) => ({
      id: co.id,
      name: co.name ?? co.id,
      family: familyLabelSafe(co.dominant_family),
      categories: (co.categories ?? []).map((cat) => categoryDisplay("paradigm", cat).label),
    })),
  };
}
