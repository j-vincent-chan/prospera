/**
 * Gold labels as stored in `fit_labels` (plan § PR 2.4 schema, source
 * `gold`): one row per (pair, labeler) save — the table is append-only
 * (PR 1.6 migration note: "a later row supersedes"), so "upsert on (pair,
 * labeler)" is insert-then-latest-wins and every reader takes the newest
 * row per (pair, labeler). The adjudicated row is the adjudicator's row
 * (the import writes it for every resolved pair; the page derives it).
 *
 * Slots: two labelers (A, B) and an adjudicator. When `labelers.json`
 * names them (D4), the slots are those identities, matched by email or
 * auth user id against `profiles`; while it does not, slots go by order of
 * first label — the first person to save a gold label is A, the second B,
 * the third the adjudicator — and a signed-in admin without a label yet is
 * shown the first empty slot. A fourth person has no slot and cannot save.
 *
 * Adjudicated tier per pair: the adjudicator's row when present; else A and
 * B agree → that tier; A and B disagree → unresolved; one of them → pending;
 * none → unlabeled. Pure: no Supabase.
 */
import type { LabelerConfig } from "@/lib/fit/goldset/manifest";
import { pairKey } from "@/lib/fit/goldset/stratify";
import type { Tier } from "@/lib/fit/types";

export type Slot = "a" | "b" | "adjudicator";
export const SLOTS: readonly Slot[] = ["a", "b", "adjudicator"];
export const SLOT_LABEL: Record<Slot, string> = { a: "Labeler A", b: "Labeler B", adjudicator: "Adjudicator" };

/** One stored `fit_labels` row (the gold read's columns). */
export type GoldLabelRow = {
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

export type LabelerIdentity = { id: string; email: string | null; name: string | null };

/** Pure. The newest row per (pair, labeler) — created_at, then id, so a rerun is byte-identical. Rows without both ids or a labeler are skipped. */
export function latestByLabeler(rows: readonly GoldLabelRow[]): Map<string, Map<string, GoldLabelRow>> {
  const out = new Map<string, Map<string, GoldLabelRow>>();
  for (const r of rows) {
    if (!r.investigator_id || !r.opportunity_id || !r.labeler) continue;
    const key = pairKey(r.investigator_id, r.opportunity_id);
    const byLabeler = out.get(key) ?? out.set(key, new Map()).get(key)!;
    const cur = byLabeler.get(r.labeler);
    if (!cur || r.created_at > cur.created_at || (r.created_at === cur.created_at && r.id > cur.id)) byLabeler.set(r.labeler, r);
  }
  return out;
}

/** Pure. Distinct labelers in order of their first row (created_at, then id). */
export function labelersByFirstLabel(rows: readonly GoldLabelRow[]): string[] {
  const first = new Map<string, { at: string; id: string }>();
  for (const r of rows) {
    if (!r.labeler) continue;
    const cur = first.get(r.labeler);
    if (!cur || r.created_at < cur.at || (r.created_at === cur.at && r.id < cur.id)) first.set(r.labeler, { at: r.created_at, id: r.id });
  }
  return Array.from(first.entries())
    .sort((a, b) => a[1].at.localeCompare(b[1].at) || a[1].id.localeCompare(b[1].id))
    .map(([labeler]) => labeler);
}

/** Pure. A configured value (email or auth user id) → the profile's id, case-insensitively; null when nobody matches. */
export function resolveIdentity(value: string | null | undefined, identities: readonly LabelerIdentity[]): string | null {
  const v = (value ?? "").trim().toLowerCase();
  if (!v) return null;
  const hit = identities.find((i) => i.id.toLowerCase() === v || (i.email ?? "").toLowerCase() === v);
  return hit?.id ?? null;
}

export type SlotAssignment = {
  slots: Record<Slot, string | null>;
  /** "configured" (labelers.json) or "first_label" (order of first label). */
  mode: "configured" | "first_label";
  /** Labelers with gold rows who hold no slot (a fourth person, or someone not in the configuration). */
  unassigned: string[];
  /** The current user's slot; null when there is none for them. */
  current: Slot | null;
  /** Configured values nobody in `profiles` matched. */
  unresolved: string[];
};

/**
 * Pure. Assigns the three slots. Configured slots win; otherwise order of
 * first label, and a current user without rows takes the first empty slot
 * (so the page can show them a form before their first save).
 */
export function assignSlots(config: LabelerConfig, identities: readonly LabelerIdentity[], rows: readonly GoldLabelRow[], currentUserId: string | null = null): SlotAssignment {
  const configured = config.a || config.b || config.adjudicator;
  const slots: Record<Slot, string | null> = { a: null, b: null, adjudicator: null };
  const unresolved: string[] = [];
  const labelers = labelersByFirstLabel(rows);
  if (configured) {
    for (const s of SLOTS) {
      const v = config[s];
      if (!v) continue;
      const id = resolveIdentity(v, identities);
      if (id) slots[s] = id;
      else unresolved.push(v);
    }
  } else {
    const order = [...labelers];
    if (currentUserId && !order.includes(currentUserId)) order.push(currentUserId);
    for (const s of SLOTS) slots[s] = order.shift() ?? null;
  }
  const holders = new Set(Object.values(slots).filter((x): x is string => Boolean(x)));
  const unassigned = labelers.filter((l) => !holders.has(l));
  const current = currentUserId ? (SLOTS.find((s) => slots[s] === currentUserId) ?? null) : null;
  return { slots, mode: configured ? "configured" : "first_label", unassigned, current, unresolved };
}

export type AdjudicationStatus = "adjudicated" | "agreed" | "unresolved" | "pending" | "unlabeled";

export type Adjudication = {
  status: AdjudicationStatus;
  /** The adjudicated tier; null while unresolved, pending or unlabeled. */
  tier: Tier | null;
  reason: string | null;
  axis_reason: string | null;
  /** Which row decided it. */
  by: Slot | null;
};

export type SlotLabels = Partial<Record<Slot, Pick<GoldLabelRow, "tier" | "reason" | "axis_reason"> | null>>;

/** Pure. The adjudication rule over the three slots' latest labels. */
export function adjudicate(labels: SlotLabels): Adjudication {
  const adj = labels.adjudicator ?? null;
  const a = labels.a ?? null;
  const b = labels.b ?? null;
  if (adj?.tier) return { status: "adjudicated", tier: adj.tier as Tier, reason: adj.reason, axis_reason: adj.axis_reason, by: "adjudicator" };
  if (a?.tier && b?.tier) {
    if (a.tier === b.tier) return { status: "agreed", tier: a.tier as Tier, reason: a.reason ?? b.reason, axis_reason: a.axis_reason ?? b.axis_reason, by: "a" };
    return { status: "unresolved", tier: null, reason: null, axis_reason: null, by: null };
  }
  if (a?.tier || b?.tier) return { status: "pending", tier: null, reason: null, axis_reason: null, by: null };
  return { status: "unlabeled", tier: null, reason: null, axis_reason: null, by: null };
}

/** Pure. The three slots' latest labels for one pair, given the slot assignment. */
export function slotLabelsFor(byLabeler: ReadonlyMap<string, GoldLabelRow> | undefined, slots: Record<Slot, string | null>): Record<Slot, GoldLabelRow | null> {
  const out = { a: null, b: null, adjudicator: null } as Record<Slot, GoldLabelRow | null>;
  for (const s of SLOTS) {
    const id = slots[s];
    out[s] = id ? (byLabeler?.get(id) ?? null) : null;
  }
  return out;
}

export type Progress = {
  total: number;
  labeled: Record<Slot, number>;
  agreed: number;
  adjudicated: number;
  /** A and B disagree and no adjudicator row yet. */
  awaiting_adjudication: number;
  pending: number;
  unlabeled: number;
  /** Pairs with an adjudicated tier (agreed or adjudicated). */
  resolved: number;
};

/** Pure. Progress counts over the manifest's pairs. */
export function progressOf(pairKeys: readonly string[], latest: ReadonlyMap<string, ReadonlyMap<string, GoldLabelRow>>, slots: Record<Slot, string | null>): Progress {
  const p: Progress = { total: pairKeys.length, labeled: { a: 0, b: 0, adjudicator: 0 }, agreed: 0, adjudicated: 0, awaiting_adjudication: 0, pending: 0, unlabeled: 0, resolved: 0 };
  for (const key of pairKeys) {
    const labels = slotLabelsFor(latest.get(key), slots);
    for (const s of SLOTS) if (labels[s]?.tier) p.labeled[s] += 1;
    const adj = adjudicate(labels);
    if (adj.status === "agreed") p.agreed += 1;
    else if (adj.status === "adjudicated") p.adjudicated += 1;
    else if (adj.status === "unresolved") p.awaiting_adjudication += 1;
    else if (adj.status === "pending") p.pending += 1;
    else p.unlabeled += 1;
    if (adj.tier) p.resolved += 1;
  }
  return p;
}

/** The `fit_labels` insert for one gold label. Pure. */
export function goldLabelRow(input: { investigator_id: string; opportunity_id: string; tier: Tier; reason: string | null; axis_reason: string | null; labeler: string; engine_version: string }) {
  return {
    investigator_id: input.investigator_id,
    opportunity_id: input.opportunity_id,
    tier: input.tier,
    reason: input.reason,
    axis_reason: input.axis_reason,
    labeler: input.labeler,
    engine_version: input.engine_version,
    source: "gold" as const,
  };
}

/** Pure. True when the latest stored row for this (pair, labeler) already carries these values — an idempotent re-save writes nothing. */
export function sameLabel(existing: Pick<GoldLabelRow, "tier" | "reason" | "axis_reason"> | null | undefined, next: { tier: string; reason: string | null; axis_reason: string | null }): boolean {
  if (!existing) return false;
  return existing.tier === next.tier && (existing.reason ?? null) === (next.reason ?? null) && (existing.axis_reason ?? null) === (next.axis_reason ?? null);
}
