/**
 * The legacy engine as a pure function (plan § PR 2.4 "runs both engines").
 *
 * Under `teams.fit_engine = 'legacy'` the investigator page ranks open
 * notices by the cosine of the person's document vector against the notice
 * vector (`match_opportunities`, top `max(topN * 4, 20)` hits), keeps the
 * hits at or above `SIM.exploratory`, scores the person's evidence items
 * against the notice (`score_investigator_evidence`, the top 6), counts the
 * supporting items (cosine ≥ `SIM.support`) and their distinct kinds, and
 * tiers the pair:
 *
 *   strong       cosine ≥ SIM.strong and ≥ 2 supporting items of ≥ 2 kinds
 *   potential    cosine ≥ SIM.potential, or ≥ 1 supporting item
 *   exploratory  otherwise (cosine ≥ SIM.exploratory)
 *   dropped      cosine < SIM.exploratory, or no vector on either side
 *
 * — the rule in src/lib/outreach/rank-opportunities.ts, reproduced here
 * over stored vectors (the file itself is on PR 2.3's diff, so the rule is
 * copied rather than exported from it; `SIM` is imported so the thresholds
 * stay in one place). No embedding call: every vector is read from
 * `investigator_embeddings`, `evidence_embeddings` and
 * `opportunity_embeddings`. The Outreach path (`computeSuggestion`) also
 * applies facet hits and flags to a query embedding of the notice profile,
 * which needs an embedding call, so its stored `outreach_suggestions`
 * snapshots are reported beside this rule where they exist rather than
 * recomputed.
 */
import { SIM } from "@/lib/outreach/suggest";
import type { Tier } from "@/lib/fit/types";

export type LegacyTier = "strong" | "potential" | "exploratory" | "dropped";

export const LEGACY_TIERS: readonly LegacyTier[] = ["strong", "potential", "exploratory", "dropped"];

/** rank-opportunities: `match_count: Math.max(topN * 4, 20)` with topN 5. */
export const LEGACY_TOP_HITS = 20;
/** rank-opportunities: `items = (data ?? []).slice(0, 6)`. */
export const LEGACY_EVIDENCE_ITEMS = 6;

export type Vector = ArrayLike<number>;

/** Cosine over any numeric array-like (Float32Array or number[]); 0 when a length differs or a norm is 0. */
export function cosineOf(a: Vector, b: Vector): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Pure. The rank-opportunities tier rule. `similarity` null = no vector on a side (dropped). */
export function legacyTier(similarity: number | null, supporting: number, kinds: number): LegacyTier {
  if (similarity === null || !Number.isFinite(similarity) || similarity < SIM.exploratory) return "dropped";
  if (similarity >= SIM.strong && supporting >= 2 && kinds >= 2) return "strong";
  if (similarity >= SIM.potential || supporting >= 1) return "potential";
  return "exploratory";
}

export type LegacyItem = { kind: string; ref_id: string; vector: Vector };

export type LegacyScore = {
  tier: LegacyTier;
  /** Document-vector cosine; null when either side has no vector. */
  similarity: number | null;
  /** Evidence items among the top `LEGACY_EVIDENCE_ITEMS` with cosine ≥ SIM.support. */
  supporting: number;
  /** Distinct kinds among the supporting items. */
  kinds: number;
  top_items: Array<{ kind: string; ref_id: string; similarity: number }>;
};

/** Pure. One pair under the legacy rule: the document cosine, the top-6 evidence cosines, the tier. */
export function legacyScorePair(docVector: Vector | null, noticeVector: Vector | null, items: readonly LegacyItem[]): LegacyScore {
  if (!docVector || !noticeVector) return { tier: "dropped", similarity: null, supporting: 0, kinds: 0, top_items: [] };
  const similarity = cosineOf(docVector, noticeVector);
  if (similarity < SIM.exploratory) return { tier: "dropped", similarity, supporting: 0, kinds: 0, top_items: [] };
  const scored = items
    .map((i) => ({ kind: i.kind, ref_id: i.ref_id, similarity: cosineOf(i.vector, noticeVector) }))
    .sort((a, b) => b.similarity - a.similarity || a.kind.localeCompare(b.kind) || a.ref_id.localeCompare(b.ref_id))
    .slice(0, LEGACY_EVIDENCE_ITEMS);
  const supporting = scored.filter((i) => i.similarity >= SIM.support);
  const kinds = new Set(supporting.map((i) => i.kind)).size;
  return { tier: legacyTier(similarity, supporting.length, kinds), similarity, supporting: supporting.length, kinds, top_items: scored };
}

/** The fit tier a legacy tier compares to: strong → strong, potential → moderate, exploratory → exploratory, dropped → poor (the surface would not show it). */
export function legacyToFitTier(tier: LegacyTier): Tier {
  switch (tier) {
    case "strong":
      return "strong";
    case "potential":
      return "moderate";
    case "exploratory":
      return "exploratory";
    default:
      return "poor";
  }
}

/** Pure. Rank of `noticeId` among `similarities` (best first, ties by id), 1-based; null when the notice is not in the list. */
export function legacyRank(noticeId: string, similarities: ReadonlyArray<{ id: string; similarity: number }>): number | null {
  const sorted = [...similarities].sort((a, b) => b.similarity - a.similarity || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const at = sorted.findIndex((s) => s.id === noticeId);
  return at < 0 ? null : at + 1;
}
