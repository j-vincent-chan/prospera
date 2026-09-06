/**
 * Vector helpers for the retrieval and topic inputs (plan § PR 2.2). Pure;
 * no OpenAI import (outreach/embeddings.ts carries the SDK, which the engine
 * side never needs — the vectors are read from the tables the outreach
 * crons already fill).
 */

/** pgvector's text form ("[0.1,0.2,…]") or a JSON array → numbers; null when it is neither. */
export function parseVector(raw: unknown): number[] | null {
  if (Array.isArray(raw)) return raw.every((x) => typeof x === "number") ? (raw as number[]) : null;
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s.startsWith("[") || !s.endsWith("]")) return null;
  const out: number[] = [];
  for (const part of s.slice(1, -1).split(",")) {
    const v = Number(part);
    if (!Number.isFinite(v)) return null;
    out.push(v);
  }
  return out.length ? out : null;
}

/** Cosine similarity; 0 when either vector is empty, the lengths differ, or a norm is 0. */
export function cosine(a: readonly number[], b: readonly number[]): number {
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

/** Ids of the `n` vectors nearest to `query`, best first; ties by id so a rerun is byte-identical. */
export function topByCosine(query: readonly number[], vectors: ReadonlyArray<{ id: string; vector: readonly number[] }>, n: number): Array<{ id: string; similarity: number }> {
  if (n <= 0 || !query.length) return [];
  return vectors
    .map((v) => ({ id: v.id, similarity: cosine(query, v.vector) }))
    .sort((a, b) => b.similarity - a.similarity || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, n);
}
