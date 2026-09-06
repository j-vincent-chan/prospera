/**
 * Investigator profile aggregation (plan § PR 1.4; spec §5 "Aggregation" and
 * "Profile record"). Pure: item profiles in, profile out — no Supabase, no
 * fetch, no model. Every number it uses comes from
 * src/lib/fit/taxonomy.json › aggregation through the PR 1.1 accessors.
 *
 * The formulas, exactly as implemented:
 *
 *   w_item   = reliability(source) × role(item) × recency(age)
 *              reliability: aggregation.reliability[source]
 *              role:        aggregation.role[role]; an item whose source carries
 *                           no role (biosketch, Profiles, self-declared,
 *                           directory) is 1.0; a publication / grant / trial
 *                           with no role on file is aggregation.role.unknown
 *              recency:     max(floor, 0.5^(age / half_life_years)) with age =
 *                           now.year − item.year (never negative); an undated
 *                           publication / grant / trial takes the floor, an
 *                           undated current-state item (biosketch, Profiles,
 *                           self-declared, directory) is 1.0
 *   share_c  = Σ_i w_i · p(c | i) / Σ_i w_i, over the items in the view on
 *              which the axis was DECIDED (decided_by[axis] present) — an item
 *              that says nothing about an axis neither supports nor dilutes it
 *   weight_c = share_c ^ saturation_exponent
 *              capped at thin_evidence.cap when fewer than thin_evidence.min_items
 *              non-prior items (p(c|i) > 0; Profiles and directory are priors,
 *              not evidence) AND fewer than thin_evidence.min_grants grants
 *              support c
 *   views    career = every item; recent = items with age ≤ recency.recent_view_years
 *              (undated current-state items are in both)
 *   confidence per axis (career view) = high when Σ w ≥ confidence.high_min_mass
 *              and distinct sources ≥ confidence.high_min_sources; medium when
 *              ≥ medium_min_mass and ≥ medium_min_sources; else low. Topic the
 *              same over items carrying any MeSH / RCDC code or model term.
 *              The scale is low < medium < high (CONFIDENCE_ORDER).
 *   provenance = per (axis, category with weight > 0): the top
 *              PROVENANCE_TOP items by w_i · p(c | i), career view
 */
import { AXES, type Axis } from "@/lib/fit/classify/contracts";
import { confidenceThresholds, familyOf, isEvidenceRole, recency, reliability, roleWeight, saturationExponent, TAXONOMY_VERSION, thinEvidence } from "@/lib/fit/taxonomy";
import type {
  AxisConfidence,
  AxisProvenance,
  Collaborator,
  Confidence,
  EvidenceSource,
  EvidenceSummary,
  InvestigatorCharacteristics,
  InvestigatorFitProfile,
  ItemKind,
  ItemProfile,
  ParadigmCategory,
  ParadigmFamily,
  ParadigmWeights,
  ProfileTopic,
} from "@/lib/fit/types";
import type { SourceState } from "@/lib/investigators/sources";

// ---------------------------------------------------------------------------
// Constants (not thresholds — set membership and ordering the spec fixes in prose)
// ---------------------------------------------------------------------------

/** The confidence scale, ascending. Pinned here because the taxonomy stores the levels as strings with no order (1.1 validator). */
export const CONFIDENCE_ORDER: readonly Confidence[] = ["low", "medium", "high"];

export function confidenceRank(c: Confidence): number {
  return CONFIDENCE_ORDER.indexOf(c);
}

/** True when `a` is at least as confident as `b`. */
export function confidenceAtLeast(a: Confidence, b: Confidence): boolean {
  return confidenceRank(a) >= confidenceRank(b);
}

/**
 * Sources the spec calls "a prior, not evidence" (§5 Sources table: UCSF
 * Profiles, directory metadata). They weigh in the shares but never lift the
 * thin-evidence cap on their own. Proposed for taxonomy.json as
 * `aggregation.thin_evidence.prior_sources` (see the PR report).
 */
export const PRIOR_SOURCES: readonly EvidenceSource[] = ["profiles", "directory_metadata"];

/** Kinds whose item describes the person's current state rather than a dated work: undated → treated as current, in both views. */
export const CURRENT_STATE_KINDS: readonly ItemKind[] = ["biosketch_statement", "biosketch_contribution", "profiles_narrative", "self_declared", "directory"];

/** Kinds whose source carries a role (author position, PI role, trial role); a missing role there is `unknown`, elsewhere the role factor is 1. */
export const ROLE_BEARING_KINDS: readonly ItemKind[] = ["publication", "grant", "trial"];

/** Evidence ids kept per (axis, category) in `provenance` (§5 profile record: top_items). */
export const PROVENANCE_TOP = 3;

/** Weights are stored to this many decimals so a rerun over the same evidence is byte-identical. */
const DECIMALS = 4;
const round = (x: number) => Math.round(x * 10 ** DECIMALS) / 10 ** DECIMALS;

// ---------------------------------------------------------------------------
// Item weight
// ---------------------------------------------------------------------------

export type ItemWeight = {
  id: string;
  kind: ItemKind;
  source: EvidenceSource;
  reliability: number;
  role: number;
  recency: number;
  /** reliability × role × recency. */
  weight: number;
  /** Whole years since the item's year; null when undated. */
  age: number | null;
  /** In the recent view. */
  recent: boolean;
};

/** Age in whole years, never negative; null when the item has no year. */
export function itemAge(item: Pick<ItemProfile, "year">, now: Date): number | null {
  if (item.year == null || !Number.isFinite(item.year)) return null;
  return Math.max(0, now.getUTCFullYear() - item.year);
}

/** `max(floor, 0.5^(age / half_life))` from `aggregation.recency`; undated dated-kind items sit at the floor, undated current-state items at 1. */
export function recencyWeight(age: number | null, kind: ItemKind): number {
  const r = recency();
  if (age == null) return CURRENT_STATE_KINDS.includes(kind) ? 1 : r.floor;
  return Math.max(r.floor, Math.pow(0.5, age / r.half_life_years));
}

/** `aggregation.role[role]`; 1 for kinds without a role concept; `unknown` for a role-bearing kind with none on file. */
export function roleFactor(item: Pick<ItemProfile, "kind" | "role">): number {
  if (item.role && isEvidenceRole(item.role)) return roleWeight(item.role);
  return ROLE_BEARING_KINDS.includes(item.kind) ? roleWeight("unknown") : 1;
}

export function itemWeight(item: ItemProfile, now: Date): ItemWeight {
  const age = itemAge(item, now);
  const rel = reliability(item.source);
  const role = roleFactor(item);
  const rec = recencyWeight(age, item.kind);
  const recent = age == null ? CURRENT_STATE_KINDS.includes(item.kind) : age <= recency().recent_view_years;
  return { id: item.id, kind: item.kind, source: item.source, reliability: rel, role, recency: rec, weight: rel * role * rec, age, recent };
}

// ---------------------------------------------------------------------------
// Per-axis aggregation
// ---------------------------------------------------------------------------

export type CategoryDetail = {
  /** Σ w · p over the view's decided items. */
  mass: number;
  /** mass / the view's total decided mass. */
  share: number;
  /** share ^ saturation, after the thin-evidence cap. */
  weight: number;
  /** The cap applied. */
  capped: boolean;
  /** Non-prior items with p(c) > 0. */
  supporting_items: number;
  /** Grants with p(c) > 0. */
  supporting_grants: number;
  /** Item ids by w · p, descending, at most PROVENANCE_TOP. */
  top_items: string[];
};

export type AxisView = {
  /** Σ w over the items on which the axis was decided. */
  mass: number;
  /** Items on which the axis was decided. */
  items: number;
  /** Distinct sources among them. */
  sources: EvidenceSource[];
  categories: Record<string, CategoryDetail>;
};

export type AxisDiagnostics = { career: AxisView; recent: AxisView; confidence: Confidence };

type WeightedItem = { item: ItemProfile; w: ItemWeight };

function axisValues(item: ItemProfile, axis: Axis): Record<string, number> {
  return (item[axis] ?? {}) as Record<string, number>;
}

/** Whether the item says anything on the axis: it was decided by rules or the model (an empty decided axis still counts as evidence of "nothing here"). */
function decidedOn(item: ItemProfile, axis: Axis): boolean {
  return item.decided_by?.[axis] !== undefined;
}

function aggregateAxisView(entries: WeightedItem[], axis: Axis): AxisView {
  const decided = entries.filter(({ item }) => decidedOn(item, axis));
  const mass = decided.reduce((s, e) => s + e.w.weight, 0);
  const sources = Array.from(new Set(decided.map((e) => e.w.source)));
  const categories: Record<string, CategoryDetail> = {};
  if (mass <= 0) return { mass: 0, items: decided.length, sources, categories };

  const sat = saturationExponent();
  const thin = thinEvidence();
  const perCategory = new Map<string, { mass: number; items: number; grants: number; top: Array<{ id: string; v: number }> }>();
  for (const { item, w } of decided) {
    for (const [cat, p] of Object.entries(axisValues(item, axis))) {
      if (typeof p !== "number" || !Number.isFinite(p) || p <= 0) continue;
      const c = perCategory.get(cat) ?? { mass: 0, items: 0, grants: 0, top: [] };
      c.mass += w.weight * p;
      if (!PRIOR_SOURCES.includes(w.source)) c.items += 1;
      if (item.kind === "grant") c.grants += 1;
      c.top.push({ id: item.id, v: w.weight * p });
      perCategory.set(cat, c);
    }
  }
  for (const [cat, c] of perCategory) {
    const share = c.mass / mass;
    let weight = Math.pow(share, sat);
    const capped = c.items < thin.min_items && c.grants < thin.min_grants;
    if (capped) weight = Math.min(weight, thin.cap);
    c.top.sort((a, b) => b.v - a.v || a.id.localeCompare(b.id));
    categories[cat] = {
      mass: round(c.mass),
      share: round(share),
      weight: round(weight),
      capped,
      supporting_items: c.items,
      supporting_grants: c.grants,
      top_items: c.top.slice(0, PROVENANCE_TOP).map((t) => t.id),
    };
  }
  return { mass: round(mass), items: decided.length, sources, categories };
}

/** `aggregation.confidence`: mass and distinct sources → low / medium / high. */
export function confidenceFrom(mass: number, sources: number): Confidence {
  const t = confidenceThresholds();
  if (mass >= t.high_min_mass && sources >= t.high_min_sources) return "high";
  if (mass >= t.medium_min_mass && sources >= t.medium_min_sources) return "medium";
  return "low";
}

/** The category → weight map a profile stores, largest first, zeros dropped. */
function weightsOf(view: AxisView): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [cat, d] of Object.entries(view.categories).sort((a, b) => b[1].weight - a[1].weight || a[0].localeCompare(b[0]))) {
    if (d.weight > 0) out[cat] = d.weight;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dominant paradigm — shared by the report, collaborators and PR 2.1's excluded-set rule
// ---------------------------------------------------------------------------

export type DominantParadigm = { category: ParadigmCategory; family: ParadigmFamily; weight: number };

/** The heaviest paradigm category (ties: first in stored order, which is weight-descending then id). Null when the view is empty. */
export function dominantParadigm(weights: ParadigmWeights): DominantParadigm | null {
  let best: DominantParadigm | null = null;
  for (const [cat, w] of Object.entries(weights)) {
    if (typeof w !== "number") continue;
    if (!best || w > best.weight) best = { category: cat as ParadigmCategory, family: familyOf(cat), weight: w };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Topic
// ---------------------------------------------------------------------------

type TopicDiagnostics = { mass: number; items: number; sources: EvidenceSource[]; confidence: Confidence };

function hasTopic(item: ItemProfile): boolean {
  const t = item.topic;
  return Boolean(t && ((t.mesh?.length ?? 0) > 0 || (t.rcdc?.length ?? 0) > 0 || (t.terms?.length ?? 0) > 0));
}

function aggregateTopic(entries: WeightedItem[], resolveTrees: AggregateContext["meshTreeNumbers"]): { topic: ProfileTopic; diagnostics: TopicDiagnostics } {
  const withTopic = entries.filter((e) => hasTopic(e.item));
  const mass = withTopic.reduce((s, e) => s + e.w.weight, 0);
  const sources = Array.from(new Set(withTopic.map((e) => e.w.source)));
  const trees = new Map<string, number>();
  const rcdc = new Map<string, number>();
  for (const { item, w } of withTopic) {
    for (const ui of item.topic.mesh_major ?? []) {
      const resolved = resolveTrees ? resolveTrees(ui) : null;
      for (const tree of resolved ?? []) trees.set(tree, (trees.get(tree) ?? 0) + w.weight);
    }
    for (const name of item.topic.rcdc ?? []) rcdc.set(name, (rcdc.get(name) ?? 0) + w.weight);
  }
  const byMass = (m: Map<string, number>) => Array.from(m.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
  return {
    topic: { mesh_major: byMass(trees), rcdc: byMass(rcdc), free_text: null },
    diagnostics: { mass: round(mass), items: withTopic.length, sources, confidence: confidenceFrom(mass, sources.length) },
  };
}

// ---------------------------------------------------------------------------
// aggregate
// ---------------------------------------------------------------------------

/** What the builder knows that the items do not: identity, the D5 record, characteristics from the rows, source states, co-authors, and the descriptor index. All optional so tests can pass items alone. */
export type AggregateContext = {
  investigator_id?: string;
  /** Aspirations already classified to categories (D5; PR 1.4 `classifyAspirations`). */
  aspirations?: ParadigmCategory[];
  do_not_suggest?: ParadigmFamily[];
  characteristics?: Partial<InvestigatorCharacteristics>;
  /** `investigator_sources.state` for the biosketch row; defaults from the items (on_file when any biosketch item, else not_requested). */
  biosketch?: SourceState;
  /** Whether the D5 record is answered; defaults to the self-declared item having a decided axis. */
  self_declared?: boolean;
  collaborators?: Collaborator[];
  /** Major-topic UIs → tree numbers (the descriptor index). Without it `topic.mesh_major` is empty. */
  meshTreeNumbers?: (ui: string) => string[] | null;
};

export type AggregateDiagnostics = {
  now: string;
  item_count: number;
  recent_items: number;
  weights: ItemWeight[];
  axes: Record<Axis, AxisDiagnostics>;
  topic: TopicDiagnostics;
  /** Items whose `taxonomy_version` differs from the current one (aggregated anyway; the builder re-classifies on a bump). */
  stale_items: string[];
};

export type AggregateResult = { profile: InvestigatorFitProfile; diagnostics: AggregateDiagnostics };

/** Accepts `ItemProfile`s or PR 1.3 `ClassifiedItem`s (anything carrying `profile`). */
export type AggregateInput = ItemProfile | { profile: ItemProfile };

export function toItemProfiles(items: readonly AggregateInput[]): ItemProfile[] {
  return items.map((x) => ("profile" in x && x.profile ? x.profile : (x as ItemProfile)));
}

const EMPTY_CHARACTERISTICS: InvestigatorCharacteristics = {
  career_stage: null,
  esi: null,
  esi_eligible_until: null,
  mechanisms_held: [],
  active_awards: 0,
  clinical_role: null,
  trial_pi_count: 0,
  degrees: [],
  title_series: null,
};

function evidenceSummary(items: ItemProfile[], ctx: AggregateContext): EvidenceSummary {
  const count = (kind: ItemKind) => items.filter((i) => i.kind === kind).length;
  const selfItem = items.find((i) => i.kind === "self_declared");
  return {
    publications_verified: count("publication"),
    grants: count("grant"),
    trials: count("trial"),
    trials_as_pi: items.filter((i) => i.kind === "trial" && i.role === "trial_pi").length,
    biosketch: ctx.biosketch ?? (items.some((i) => i.kind === "biosketch_statement" || i.kind === "biosketch_contribution") ? "on_file" : "not_requested"),
    self_declared: ctx.self_declared ?? Boolean(selfItem && Object.keys(selfItem.decided_by ?? {}).length > 0),
  };
}

function provenanceOf(axes: Record<Axis, AxisDiagnostics>): AxisProvenance[] {
  const out: AxisProvenance[] = [];
  for (const axis of AXES) {
    const view = axes[axis].career;
    for (const [category, d] of Object.entries(view.categories).sort((a, b) => b[1].weight - a[1].weight || a[0].localeCompare(b[0]))) {
      if (d.weight <= 0) continue;
      out.push({ axis, category, top_items: d.top_items } as AxisProvenance);
    }
  }
  return out;
}

/**
 * The aggregate with everything the inspector and the report need beside the
 * stored profile: per-item weights, per-view category details (share, cap,
 * support counts), masses and sources behind each confidence.
 */
export function aggregateWithDiagnostics(input: readonly AggregateInput[], now: Date, ctx: AggregateContext = {}): AggregateResult {
  const items = toItemProfiles(input);
  const entries: WeightedItem[] = items.map((item) => ({ item, w: itemWeight(item, now) }));
  const recentEntries = entries.filter((e) => e.w.recent);

  const axes = {} as Record<Axis, AxisDiagnostics>;
  for (const axis of AXES) {
    const career = aggregateAxisView(entries, axis);
    const recent = aggregateAxisView(recentEntries, axis);
    axes[axis] = { career, recent, confidence: confidenceFrom(career.mass, career.sources.length) };
  }
  const { topic, diagnostics: topicDiag } = aggregateTopic(entries, ctx.meshTreeNumbers);

  const confidence: AxisConfidence = {
    paradigm: axes.paradigm.confidence,
    unit: axes.unit.confidence,
    design: axes.design.confidence,
    materials: axes.materials.confidence,
    objective: axes.objective.confidence,
    topic: topicDiag.confidence,
  };

  const profile: InvestigatorFitProfile = {
    investigator_id: ctx.investigator_id ?? "",
    taxonomy_version: TAXONOMY_VERSION,
    computed_at: now.toISOString(),
    confidence,
    paradigm: { career: weightsOf(axes.paradigm.career) as ParadigmWeights, recent: weightsOf(axes.paradigm.recent) as ParadigmWeights },
    unit: weightsOf(axes.unit.career),
    design: weightsOf(axes.design.career),
    materials: weightsOf(axes.materials.career),
    objective: weightsOf(axes.objective.career),
    topic,
    characteristics: { ...EMPTY_CHARACTERISTICS, ...(ctx.characteristics ?? {}) },
    aspirations: Array.from(new Set(ctx.aspirations ?? [])),
    do_not_suggest: Array.from(new Set(ctx.do_not_suggest ?? [])),
    evidence_summary: evidenceSummary(items, ctx),
    provenance: provenanceOf(axes),
    collaborators: ctx.collaborators ?? [],
  };

  const diagnostics: AggregateDiagnostics = {
    now: now.toISOString(),
    item_count: items.length,
    recent_items: recentEntries.length,
    weights: entries.map((e) => e.w),
    axes,
    topic: topicDiag,
    stale_items: items.filter((i) => i.taxonomy_version !== TAXONOMY_VERSION).map((i) => i.id),
  };
  return { profile, diagnostics };
}

/** Pure. Item profiles (or PR 1.3 classified items) → the investigator fit profile (spec §5). */
export function aggregate(input: readonly AggregateInput[], now: Date, ctx: AggregateContext = {}): InvestigatorFitProfile {
  return aggregateWithDiagnostics(input, now, ctx).profile;
}
