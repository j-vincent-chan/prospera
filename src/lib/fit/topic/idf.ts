/**
 * Topic-code IDF over the open-notice corpus (plan § PR 2.2; spec §11 rule
 * 2: "every term and code is weighted by how many open notices contain it").
 *
 *   df(code) = open notices (with a fit profile) whose MeSH tree numbers lie
 *              at or under the prefix, or that carry the RCDC category —
 *              a notice counts once per code
 *   idf(code) = ln((n + 1) / (df + 1))
 *
 * Every ancestor prefix of every tree number is a code of its own (C04,
 * C04.557, C04.557.470 …), because stage 5 credits the deepest common
 * ancestor of a notice code and an investigator code and looks that
 * ancestor up (engine/topic.ts `codedOverlap`); an ancestor's df is at least
 * its descendants', so idf never grows with depth and the per-code ratio
 * stays ≤ 1. A code the table does not know — a notice profiled after the
 * refresh, an investigator code no notice carries — takes `unknown`, the
 * df = 1 weight (the rarest a code in the corpus can be), which is the
 * engine's contract (`IdfTable.unknown`). An empty table is the neutral
 * table: every weight 1.
 *
 * `computeIdf` is pure; `refreshTopicIdf` writes `fit_topic_idf` (upsert,
 * then delete the rows this refresh did not touch); `loadIdf` reads it back.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { meshTreeNumber } from "@/lib/fit/engine/topic";
import { foldName, uniq } from "@/lib/fit/engine/util";
import type { IdfTable } from "@/lib/fit/types";

export const TOPIC_IDF_MIGRATION = "supabase/migrations/20260917100000_fit_results_and_engine_flag.sql";

/** The codes one notice carries: MeSH tree numbers (any depth) and RCDC category names as stored. */
export type NoticeCodes = { id: string; mesh: readonly string[]; rcdc: readonly string[] };

export type IdfRow = { code: string; kind: "mesh" | "rcdc"; df: number; n: number; idf: number };

export type IdfComputation = { n: number; rows: IdfRow[]; table: IdfTable };

/** Every ancestor prefix of a tree number, shallowest first: C04.557.470 → [C04, C04.557, C04.557.470]. Non-tree input → []. */
export function meshPrefixes(code: string): string[] {
  const tree = meshTreeNumber(code);
  if (!tree) return [];
  const parts = tree.split(".");
  return parts.map((_, i) => parts.slice(0, i + 1).join("."));
}

/** ln((n + 1) / (df + 1)), never negative. */
export function idfValue(df: number, n: number): number {
  return Math.max(0, Math.log((n + 1) / (df + 1)));
}

/** The weight of a code the corpus does not know: the df = 1 value; 1 when the corpus is empty. */
export function unknownIdf(n: number): number {
  return n > 0 ? idfValue(1, n) : 1;
}

/** Pure. df, n and idf per MeSH prefix and RCDC name over the notices' codes; rows sorted by kind then code. */
export function computeIdf(notices: readonly NoticeCodes[]): IdfComputation {
  const n = notices.length;
  const df = new Map<string, { kind: "mesh" | "rcdc"; df: number }>();
  const bump = (code: string, kind: "mesh" | "rcdc") => {
    const cur = df.get(code);
    if (cur) cur.df += 1;
    else df.set(code, { kind, df: 1 });
  };
  for (const notice of notices) {
    const codes = new Set<string>();
    for (const raw of notice.mesh) for (const prefix of meshPrefixes(raw)) codes.add(`mesh:${prefix}`);
    for (const raw of uniq(notice.rcdc.map((r) => r.trim()).filter(Boolean))) codes.add(`rcdc:${raw}`);
    for (const key of codes) {
      const [kind, ...rest] = key.split(":");
      bump(rest.join(":"), kind as "mesh" | "rcdc");
    }
  }
  const rows: IdfRow[] = Array.from(df.entries())
    .map(([code, v]) => ({ code, kind: v.kind, df: v.df, n, idf: idfValue(v.df, n) }))
    .sort((a, b) => (a.kind === b.kind ? (a.code < b.code ? -1 : a.code > b.code ? 1 : 0) : a.kind === "mesh" ? -1 : 1));
  const weights: Record<string, number> = {};
  for (const r of rows) weights[r.code] = r.idf;
  return { n, rows, table: { weights, unknown: unknownIdf(n) } };
}

/** RCDC names are matched by folded name in stage 5 but looked up by the notice's raw spelling; both spellings resolve here. */
export function idfTableFromRows(rows: readonly Pick<IdfRow, "code" | "kind" | "idf" | "n">[]): IdfTable {
  const weights: Record<string, number> = {};
  let n = 0;
  for (const r of rows) {
    weights[r.code] = r.idf;
    if (r.kind === "rcdc") {
      const folded = foldName(r.code);
      if (!(folded in weights)) weights[folded] = r.idf;
    }
    n = Math.max(n, r.n);
  }
  return { weights, unknown: unknownIdf(n) };
}

/** PostgREST's message for a table the schema cache does not know (the migration not applied yet). */
export const MISSING_TABLE = /could not find the table|relation .* does not exist|schema cache/i;

const WRITE_CHUNK = 500;
const PAGE = 1000;

export type IdfRefreshResult = { n: number; codes: number; written: number; deleted: number; skipped: string | null };

/** Upsert every row of `computation`, then delete the rows an earlier refresh wrote that this one did not; a missing table is reported, never thrown. */
export async function refreshTopicIdf(db: SupabaseClient, computation: IdfComputation, now: Date = new Date()): Promise<IdfRefreshResult> {
  const stamp = now.toISOString();
  const rows = computation.rows.map((r) => ({ ...r, computed_at: stamp }));
  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    const { error } = await db.from("fit_topic_idf").upsert(rows.slice(i, i + WRITE_CHUNK), { onConflict: "code" });
    if (error) {
      if (MISSING_TABLE.test(error.message)) return { n: computation.n, codes: rows.length, written: 0, deleted: 0, skipped: `fit_topic_idf is not on the database — apply ${TOPIC_IDF_MIGRATION}` };
      throw new Error(`fit_topic_idf write failed: ${error.message}`);
    }
  }
  const { data: stale, error: staleErr } = await db.from("fit_topic_idf").select("code").lt("computed_at", stamp);
  if (staleErr) throw new Error(`fit_topic_idf read failed: ${staleErr.message}`);
  const staleCodes = ((stale ?? []) as Array<{ code: string }>).map((r) => r.code);
  for (let i = 0; i < staleCodes.length; i += 200) {
    const { error } = await db.from("fit_topic_idf").delete().in("code", staleCodes.slice(i, i + 200));
    if (error) throw new Error(`fit_topic_idf delete failed: ${error.message}`);
  }
  return { n: computation.n, codes: rows.length, written: rows.length, deleted: staleCodes.length, skipped: null };
}

export type LoadedIdf = { table: IdfTable; rows: number; n: number; available: boolean };

/** The stored table as the engine's IdfTable. A missing table (migration not applied) or an empty one is the neutral table with `available: false`. */
export async function loadIdf(db: SupabaseClient): Promise<LoadedIdf> {
  const rows: Array<Pick<IdfRow, "code" | "kind" | "idf" | "n">> = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from("fit_topic_idf").select("code, kind, idf, n").order("code").range(from, from + PAGE - 1);
    if (error) {
      if (MISSING_TABLE.test(error.message)) return { table: { weights: {}, unknown: 1 }, rows: 0, n: 0, available: false };
      throw new Error(`fit_topic_idf read failed: ${error.message}`);
    }
    for (const r of (data ?? []) as Array<{ code: string; kind: "mesh" | "rcdc"; idf: number | string; n: number }>) rows.push({ code: r.code, kind: r.kind, idf: Number(r.idf), n: r.n });
    if (!data || data.length < PAGE) break;
  }
  if (!rows.length) return { table: { weights: {}, unknown: 1 }, rows: 0, n: 0, available: false };
  const table = idfTableFromRows(rows);
  return { table, rows: rows.length, n: rows.reduce((m, r) => Math.max(m, r.n), 0), available: true };
}
