/**
 * PostgREST puts `.in(...)` filters in the query string, and the Supabase
 * gateway rejects requests whose URL is longer than ~24KB with a plain-text
 * "Bad Request" before PostgREST ever sees them. A UUID costs ~39 characters
 * once encoded, so 100 ids per request keeps the URL near 4KB.
 */
export const SUPABASE_ID_FILTER_CHUNK_SIZE = 100;

/** Split ids into `.in()`-sized batches (empty input yields no batches). */
export function chunkIdsForInFilter<T>(
  ids: readonly T[],
  chunkSize: number = SUPABASE_ID_FILTER_CHUNK_SIZE
): T[][] {
  const size = Math.max(1, Math.floor(chunkSize));
  const chunks: T[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size) as T[]);
  }
  return chunks;
}
