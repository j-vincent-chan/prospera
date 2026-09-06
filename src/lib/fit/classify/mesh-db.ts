/**
 * The MeSH descriptor index from the database (plan § PR 1.4; PR 1.5 keeps
 * the same file for the same purpose). `mesh_descriptors` holds ~30,000 rows
 * and changes once a year, so the index is read once per process and shared
 * by every build, script and cron run: a count, then 1,000-row ranges fetched
 * `PARALLEL_RANGES` at a time (~2 s instead of the ~9 s a serial page walk
 * took). Read-only.
 *
 * Throws when the table is empty — the rules read descriptor names and tree
 * numbers through it, so a build must not run on an empty index (run
 * `npm run fit:load-mesh-descriptors`). A failed load is not memoized, so the
 * next caller retries.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildMeshIndex, type MeshDescriptorRow, type MeshIndex } from "@/lib/fit/classify/mesh";

export const MESH_DESCRIPTOR_COLUMNS = "ui, name, tree_numbers, is_check_tag";
/** Rows per range request — PostgREST's default max-rows. */
export const MESH_RANGE = 1_000;
/** Range requests in flight at once. */
export const PARALLEL_RANGES = 8;

/** The message a caller can match to skip quietly (the refresh hook, the backfill's exit 3). */
export const MESH_EMPTY_MESSAGE = "mesh_descriptors is empty — run `npm run fit:load-mesh-descriptors` first";
export const MESH_EMPTY = /mesh_descriptors is empty/i;

let meshIndexPromise: Promise<MeshIndex> | null = null;

async function fetchRange(db: SupabaseClient, from: number): Promise<MeshDescriptorRow[]> {
  const { data, error } = await db.from("mesh_descriptors").select(MESH_DESCRIPTOR_COLUMNS).order("ui").range(from, from + MESH_RANGE - 1);
  if (error) throw new Error(`mesh_descriptors read failed: ${error.message}`);
  return (data ?? []) as MeshDescriptorRow[];
}

/** Every `mesh_descriptors` row, in `ui` order: count first, then the ranges in parallel batches. */
export async function fetchMeshDescriptorRows(db: SupabaseClient): Promise<MeshDescriptorRow[]> {
  const { count, error } = await db.from("mesh_descriptors").select("ui", { count: "exact", head: true });
  if (error) throw new Error(`mesh_descriptors count failed: ${error.message}`);
  const total = count ?? 0;
  if (total === 0) throw new Error(MESH_EMPTY_MESSAGE);
  const starts: number[] = [];
  for (let from = 0; from < total; from += MESH_RANGE) starts.push(from);
  const rows: MeshDescriptorRow[] = [];
  for (let i = 0; i < starts.length; i += PARALLEL_RANGES) {
    const pages = await Promise.all(starts.slice(i, i + PARALLEL_RANGES).map((from) => fetchRange(db, from)));
    for (const page of pages) rows.push(...page);
  }
  if (!rows.length) throw new Error(MESH_EMPTY_MESSAGE);
  return rows;
}

/** `mesh_descriptors` → `MeshIndex`, read once per process (memoized; a failed load is retried on the next call). */
export function loadMeshIndex(db: SupabaseClient): Promise<MeshIndex> {
  if (meshIndexPromise) return meshIndexPromise;
  const p = fetchMeshDescriptorRows(db).then(buildMeshIndex);
  meshIndexPromise = p;
  p.catch(() => {
    if (meshIndexPromise === p) meshIndexPromise = null;
  });
  return p;
}

/** Forget the memoized index (tests; a script that reloads the table). */
export function resetMeshIndexCache(): void {
  meshIndexPromise = null;
}
