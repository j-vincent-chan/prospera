/**
 * The labeled-CSV import plan (plan § PR 2.4 `scripts/fit-goldset-import.ts`):
 * pure — reads the parsed CSV rows, the manifest's pairs, the three
 * resolved labeler ids and the gold rows already stored, and returns what
 * the script would write: one row per (pair, labeler) whose CSV label
 * differs from the latest stored one, plus one adjudicated row per resolved
 * pair with the adjudicator as labeler (agreement → that tier; disagreement
 * → the adjudicator's own column; else the pair is flagged unresolved).
 * Every label goes through `parseGoldLabel` (tier in the taxonomy's four,
 * reason from the feedback list and required for Exploratory / Poor, axis
 * sub-reason `<axis>:<category>` valid against the taxonomy). A re-import
 * of the same CSV plans nothing.
 */
import { LABEL_SLOTS, type CsvRow, type LabelSlotKey } from "@/lib/fit/goldset/csv";
import { adjudicate, latestByLabeler, sameLabel, type GoldLabelRow, type Slot } from "@/lib/fit/goldset/labels";
import type { ManifestPair } from "@/lib/fit/goldset/manifest";
import { parseGoldLabel } from "@/lib/fit/goldset/reasons";
import { pairKey } from "@/lib/fit/goldset/stratify";
import type { Tier } from "@/lib/fit/types";

export type ImportLabelers = Record<Slot, string>;

const SLOT_OF: Record<LabelSlotKey, Slot> = { a: "a", b: "b", adj: "adjudicator" };

export type PlannedRow = {
  pair_id: string;
  investigator_id: string;
  opportunity_id: string;
  slot: Slot;
  /** "label" = the labeler's own column; "adjudicated" = the derived row written under the adjudicator. */
  kind: "label" | "adjudicated";
  labeler: string;
  tier: Tier;
  reason: string | null;
  axis_reason: string | null;
  action: "insert" | "unchanged";
};

export type ImportError = { pair_id: string; slot: Slot | null; message: string };

export type ImportPlan = {
  rows: PlannedRow[];
  inserts: number;
  unchanged: number;
  per_slot: Record<Slot, { labeled: number; inserts: number; unchanged: number }>;
  adjudication: { agreed: number; by_adjudicator: number; unresolved: string[]; pending: string[]; unlabeled: number };
  errors: ImportError[];
  unknown_pairs: string[];
};

export type ImportInput = {
  rows: readonly CsvRow[];
  pairsById: ReadonlyMap<string, ManifestPair>;
  labelers: ImportLabelers;
  existing: readonly GoldLabelRow[];
  engine_version: string;
};

/** Pure. See the module note. */
export function planImport(input: ImportInput): ImportPlan {
  const latest = latestByLabeler(input.existing);
  const rows: PlannedRow[] = [];
  const errors: ImportError[] = [];
  const unknown: string[] = [];
  const per_slot: ImportPlan["per_slot"] = { a: { labeled: 0, inserts: 0, unchanged: 0 }, b: { labeled: 0, inserts: 0, unchanged: 0 }, adjudicator: { labeled: 0, inserts: 0, unchanged: 0 } };
  const adjudication: ImportPlan["adjudication"] = { agreed: 0, by_adjudicator: 0, unresolved: [], pending: [], unlabeled: 0 };
  const seen = new Set<string>();

  const plan = (pair: ManifestPair, slot: Slot, kind: PlannedRow["kind"], value: { tier: Tier; reason: string | null; axis_reason: string | null }) => {
    const labeler = input.labelers[slot];
    const stored = latest.get(pairKey(pair.investigator_id, pair.opportunity_id))?.get(labeler) ?? null;
    const action: PlannedRow["action"] = sameLabel(stored, value) ? "unchanged" : "insert";
    rows.push({ pair_id: pair.id, investigator_id: pair.investigator_id, opportunity_id: pair.opportunity_id, slot, kind, labeler, ...value, action });
    if (kind === "label") {
      per_slot[slot].labeled += 1;
      per_slot[slot][action === "insert" ? "inserts" : "unchanged"] += 1;
    }
  };

  for (const row of input.rows) {
    const id = row.pair_id.trim();
    if (!id) continue;
    const pair = input.pairsById.get(id);
    if (!pair) {
      unknown.push(id);
      errors.push({ pair_id: id, slot: null, message: `pair ${id} is not in the manifest` });
      continue;
    }
    if (seen.has(id)) {
      errors.push({ pair_id: id, slot: null, message: `pair ${id} appears more than once; the first row is used` });
      continue;
    }
    seen.add(id);
    if ((row.investigator_id && row.investigator_id !== pair.investigator_id) || (row.opportunity_id && row.opportunity_id !== pair.opportunity_id)) {
      errors.push({ pair_id: id, slot: null, message: `pair ${id}: the row's ids do not match the manifest (${pair.investigator_id} / ${pair.opportunity_id})` });
      continue;
    }
    const labels: Partial<Record<Slot, { tier: Tier; reason: string | null; axis_reason: string | null }>> = {};
    let rowOk = true;
    for (const k of LABEL_SLOTS) {
      const slot = SLOT_OF[k];
      const tier = row[`tier_${k}`];
      const reason = row[`reason_${k}`];
      const axis = row[`axis_reason_${k}`];
      if (!tier) {
        if (reason || axis) {
          errors.push({ pair_id: id, slot, message: `pair ${id} ${slot}: a reason without a tier` });
          rowOk = false;
        }
        continue;
      }
      const parsed = parseGoldLabel({ tier, reason, axis_reason: axis });
      if (!parsed.ok) {
        errors.push({ pair_id: id, slot, message: `pair ${id} ${slot}: ${parsed.error}` });
        rowOk = false;
        continue;
      }
      labels[slot] = parsed.value;
    }
    if (!rowOk) continue;
    for (const slot of ["a", "b", "adjudicator"] as const) if (labels[slot]) plan(pair, slot, "label", labels[slot]!);
    const adj = adjudicate({ a: labels.a ?? null, b: labels.b ?? null, adjudicator: labels.adjudicator ?? null });
    if (adj.status === "adjudicated") adjudication.by_adjudicator += 1;
    else if (adj.status === "agreed") {
      adjudication.agreed += 1;
      plan(pair, "adjudicator", "adjudicated", { tier: adj.tier!, reason: adj.reason, axis_reason: adj.axis_reason });
    } else if (adj.status === "unresolved") adjudication.unresolved.push(id);
    else if (adj.status === "pending") adjudication.pending.push(id);
    else adjudication.unlabeled += 1;
  }

  return {
    rows,
    inserts: rows.filter((r) => r.action === "insert").length,
    unchanged: rows.filter((r) => r.action === "unchanged").length,
    per_slot,
    adjudication,
    errors,
    unknown_pairs: unknown,
  };
}

/** One line per planned row, for the dry run. */
export function formatPlannedRow(r: PlannedRow): string {
  return `${r.pair_id} ${r.slot.padEnd(11)} ${r.kind === "adjudicated" ? "adjudicated" : "label      "} ${r.tier.padEnd(11)} ${(r.reason ?? "—").padEnd(16)} ${(r.axis_reason ?? "").padEnd(36)} ${r.action}`;
}
