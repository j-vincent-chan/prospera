/**
 * The legacy engine as a pure function (plan § PR 2.4 "runs both engines"),
 * with the investigator page's window.
 *
 * Under `teams.fit_engine = 'legacy'` the investigator page asks
 * `match_opportunities(document vector, max(topN * 4, 20), only_open)` for
 * the top 20 open notices by cosine among every open notice with an
 * `opportunity_embeddings` row (the candidate set), walks them best first,
 * skips the ones under `SIM.exploratory`, scores the person's evidence items
 * against each (`score_investigator_evidence`, the top 6), counts the
 * supporting items (cosine ≥ `SIM.support`) and their distinct kinds, tiers
 * the pair, and stops after `topN = 5` shown. So a pair is
 *
 *   strong       shown (rank ≤ 5 and cosine ≥ SIM.exploratory), cosine ≥ SIM.strong
 *                and ≥ 2 supporting items of ≥ 2 kinds
 *   potential    shown, cosine ≥ SIM.potential or ≥ 1 supporting item
 *   exploratory  shown, otherwise
 *   not_shown    in the top 20 and over the floor, but behind the 5 the
 *                page shows — never scored, never seen
 *   dropped      outside the top 20, under the floor, or no vector on a side
 *
 * — the rule in src/lib/outreach/rank-opportunities.ts, reproduced here
 * over stored vectors (`SIM` imported so the thresholds stay in one place).
 * The ranking here is exact; the page's `match_opportunities` RPC is
 * HNSW-approximate (ef_search 100), so ranks deep in the top 20 can differ
 * by a position from the live page (spot check: rank ≤ 5 identical; g185
 * rank 16 here vs 15 live) — a not_shown/dropped flip at the window edge
 * is possible.
 * No embedding call: every vector is read from `investigator_embeddings`,
 * `evidence_embeddings` and `opportunity_embeddings`, as Float64 on both
 * scripts so the cosine is one number. The Outreach path (`computeSuggestion`)
 * also applies facet hits and flags to a query embedding of the notice
 * profile, which needs an embedding call, so its stored `outreach_suggestions`
 * snapshots are reported beside this rule where they exist rather than
 * recomputed.
 */
import { SIM } from "@/lib/outreach/suggest";
import type { Tier } from "@/lib/fit/types";

export type LegacyTier = "strong" | "potential" | "exploratory" | "not_shown" | "dropped";

export const LEGACY_TIERS: readonly LegacyTier[] = ["strong", "potential", "exploratory", "not_shown", "dropped"];

/** rank-opportunities: `match_count: Math.max(topN * 4, 20)` with topN 5 — the window `match_opportunities` returns. */
export const LEGACY_TOP_HITS = 20;
/** rank-opportunities: `topN = 5` — the page stops after five shown. */
export const LEGACY_SHOWN_TOP_N = 5;
/** rank-opportunities: `items = (data ?? []).slice(0, 6)`. */
export const LEGACY_EVIDENCE_ITEMS = 6;

export type Vector = ArrayLike<number>;

/** Cosine over any numeric array-like (Float64Array or number[]); 0 when a length differs or a norm is 0. */
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

/** Pure. At or above the page's exploratory floor on the document cosine (null = no vector on a side). */
export const aboveLegacyFloor = (similarity: number | null): boolean => similarity !== null && Number.isFinite(similarity) && similarity >= SIM.exploratory;

/**
 * Pure. The rank-opportunities tier for a pair at `rank` in the person's
 * window (1-based, null = outside the top `LEGACY_TOP_HITS`): dropped
 * outside the window or under the floor, not_shown behind the
 * `LEGACY_SHOWN_TOP_N` the page shows, else the evidence rule.
 */
export function legacyTier(similarity: number | null, supporting: number, kinds: number, rank: number | null): LegacyTier {
  if (!aboveLegacyFloor(similarity) || rank === null || rank > LEGACY_TOP_HITS) return "dropped";
  if (rank > LEGACY_SHOWN_TOP_N) return "not_shown";
  if (similarity! >= SIM.strong && supporting >= 2 && kinds >= 2) return "strong";
  if (similarity! >= SIM.potential || supporting >= 1) return "potential";
  return "exploratory";
}

export type LegacyItem = { kind: string; ref_id: string; vector: Vector };

export type LegacyScore = {
  tier: LegacyTier;
  /** Document-vector cosine; null when either side has no vector. */
  similarity: number | null;
  /** The pair's rank in the person's window (1-based); null outside it or without a vector. */
  rank: number | null;
  /** Evidence items among the top `LEGACY_EVIDENCE_ITEMS` with cosine ≥ SIM.support (shown pairs only — the page scores nothing else). */
  supporting: number;
  /** Distinct kinds among the supporting items. */
  kinds: number;
  top_items: Array<{ kind: string; ref_id: string; similarity: number }>;
};

/** Pure. One pair under the legacy rule at `rank` in the window: the document cosine, the top-6 evidence cosines when shown, the tier. */
export function legacyScorePair(docVector: Vector | null, noticeVector: Vector | null, items: readonly LegacyItem[], rank: number | null): LegacyScore {
  if (!docVector || !noticeVector) return { tier: "dropped", similarity: null, rank: null, supporting: 0, kinds: 0, top_items: [] };
  const similarity = cosineOf(docVector, noticeVector);
  const tier = legacyTier(similarity, 0, 0, rank);
  if (tier === "dropped" || tier === "not_shown") return { tier, similarity, rank, supporting: 0, kinds: 0, top_items: [] };
  const scored = items
    .map((i) => ({ kind: i.kind, ref_id: i.ref_id, similarity: cosineOf(i.vector, noticeVector) }))
    .sort((a, b) => b.similarity - a.similarity || a.kind.localeCompare(b.kind) || a.ref_id.localeCompare(b.ref_id))
    .slice(0, LEGACY_EVIDENCE_ITEMS);
  const supporting = scored.filter((i) => i.similarity >= SIM.support);
  const kinds = new Set(supporting.map((i) => i.kind)).size;
  return { tier: legacyTier(similarity, supporting.length, kinds, rank), similarity, rank, supporting: supporting.length, kinds, top_items: scored };
}

/** The fit tier a legacy tier compares to: strong → strong, potential → moderate, exploratory → exploratory, not_shown and dropped → poor (the surface would not show it). */
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

export type WindowHit = { id: string; similarity: number; rank: number };

/**
 * Pure. The page's window for one person: the cosine of `docVector` against
 * every candidate, best first (ties by id), the top `topHits` with their
 * 1-based rank — what `match_opportunities` returns. Empty without a vector.
 */
export function legacyWindow(docVector: Vector | null, candidates: ReadonlyArray<{ id: string; vector: Vector }>, topHits: number = LEGACY_TOP_HITS): WindowHit[] {
  if (!docVector) return [];
  const scored = candidates.map((c) => ({ id: c.id, similarity: cosineOf(docVector, c.vector) }));
  scored.sort((a, b) => b.similarity - a.similarity || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return scored.slice(0, topHits).map((s, i) => ({ ...s, rank: i + 1 }));
}

/** Pure. `legacyWindow` as a lookup: notice id → rank. */
export function legacyRanks(docVector: Vector | null, candidates: ReadonlyArray<{ id: string; vector: Vector }>, topHits: number = LEGACY_TOP_HITS): Map<string, number> {
  return new Map(legacyWindow(docVector, candidates, topHits).map((h) => [h.id, h.rank]));
}
