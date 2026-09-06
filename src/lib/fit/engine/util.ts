/**
 * Small pure helpers shared by the engine modules (plan § PR 2.1). Nothing
 * here scores or reads a threshold; the stage modules do that through the
 * taxonomy accessors.
 */
import { TIER_IDS } from "@/lib/fit/taxonomy";
import type { AxisWeights, Tier } from "@/lib/fit/types";

const hasOwn = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key);

/** `weights[id]`, 0 when absent or not a finite number. Own properties only, so `constructor` and friends never leak in. */
export function weightOf<Id extends string>(weights: AxisWeights<Id> | null | undefined, id: string): number {
  if (!weights || !hasOwn(weights, id)) return 0;
  const w = (weights as Record<string, unknown>)[id];
  return typeof w === "number" && Number.isFinite(w) ? w : 0;
}

/** A number from a string-keyed table, `fallback` when the key is not an own property or not finite. */
export function lookupNumber(table: Record<string, number> | null | undefined, key: string, fallback: number): number {
  if (!table || !hasOwn(table, key)) return fallback;
  const v = table[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** The [id, weight] pairs with a finite numeric weight, in the object's own order. */
export function weightEntries<Id extends string>(weights: AxisWeights<Id> | null | undefined): Array<[Id, number]> {
  if (!weights) return [];
  return (Object.entries(weights) as Array<[Id, unknown]>).filter((e): e is [Id, number] => typeof e[1] === "number" && Number.isFinite(e[1]));
}

/** Σ weights (the "mass" of an axis vector, §7 stage 4). */
export function mass<Id extends string>(weights: AxisWeights<Id> | null | undefined): number {
  return weightEntries(weights).reduce((s, [, w]) => s + w, 0);
}

/**
 * The heaviest id. Ties go to the earliest in `order` (taxonomy order), so a
 * rerun over the same profile is byte-identical. Null when nothing has weight.
 */
export function heaviest<Id extends string>(weights: AxisWeights<Id> | null | undefined, order: readonly Id[]): { id: Id; weight: number } | null {
  let best: { id: Id; weight: number } | null = null;
  for (const [id, w] of weightEntries(weights)) {
    if (w <= 0) continue;
    if (!best || w > best.weight || (w === best.weight && order.indexOf(id) < order.indexOf(best.id))) best = { id, weight: w };
  }
  return best;
}

export const clamp01 = (x: number): number => (Number.isFinite(x) ? (x < 0 ? 0 : x > 1 ? 1 : x) : 0);

/** Position in `taxonomy.tiers` order, best first (strong 0 … poor 3). */
export function tierRank(tier: Tier): number {
  return TIER_IDS.indexOf(tier);
}

/** The worse of two tiers. */
export function worseTier(a: Tier, b: Tier): Tier {
  return tierRank(a) >= tierRank(b) ? a : b;
}

export function uniq<T>(xs: Iterable<T>): T[] {
  return Array.from(new Set(xs));
}

/** Case-folded, whitespace-collapsed key for comparing free-text names (RCDC categories, infrastructure). */
export function foldName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Two decimals for rationales. */
export const fmt = (n: number): string => n.toFixed(2);
