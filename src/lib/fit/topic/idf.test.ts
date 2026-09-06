import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { codedOverlap } from "@/lib/fit/engine/topic";
import { computeIdf, idfTableFromRows, idfValue, loadIdf, meshPrefixes, refreshTopicIdf, unknownIdf } from "@/lib/fit/topic/idf";

type Row = Record<string, unknown>;

/** The narrowest fake of the PostgREST builder idf.ts uses: select → order → range | lt; upsert; delete → in. A table absent answers with the missing-table message. */
function fakeDb(tables: Record<string, Row[]>, writes: Array<{ op: string; rows: Row[] }> = []): SupabaseClient {
  const builder = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let mode: "select" | "delete" = "select";
    const missing = () => (table in tables ? null : { message: `Could not find the table 'public.${table}' in the schema cache` });
    const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.order = () => q;
    q.lt = (col: string, v: string) => (filters.push((r) => String(r[col]) < v), q);
    q.in = async (col: string, vs: unknown[]) => {
      const err = missing();
      if (err) return { error: err };
      if (mode === "delete") {
        const gone = rows().filter((r) => vs.includes(r[col]));
        writes.push({ op: "delete", rows: gone });
        tables[table] = (tables[table] ?? []).filter((r) => !gone.includes(r));
      }
      return { error: null };
    };
    q.delete = () => ((mode = "delete"), q);
    q.range = async (from: number, to: number) => {
      const err = missing();
      return err ? { data: null, error: err } : { data: rows().slice(from, to + 1), error: null };
    };
    q.upsert = async (batch: Row[]) => {
      const err = missing();
      if (err) return { error: err };
      writes.push({ op: "upsert", rows: batch });
      for (const r of batch) {
        const at = (tables[table] ?? []).findIndex((x) => x.code === r.code);
        if (at >= 0) tables[table]![at] = r;
        else (tables[table] ??= []).push(r);
      }
      return { error: null };
    };
    q.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      const err = missing();
      return Promise.resolve(err ? { data: null, error: err } : { data: rows(), error: null }).then(resolve, reject);
    };
    return q;
  };
  return { from: builder } as unknown as SupabaseClient;
}

describe("topic IDF (§11 rule 2)", () => {
  it("expands a tree number into every ancestor prefix", () => {
    expect(meshPrefixes("C04.557.470")).toEqual(["C04", "C04.557", "C04.557.470"]);
    expect(meshPrefixes("C04")).toEqual(["C04"]);
    expect(meshPrefixes("C04.557.470 Bile Duct Neoplasms")).toEqual(["C04", "C04.557", "C04.557.470"]);
    expect(meshPrefixes("Neoplasms")).toEqual([]);
  });

  it("counts a notice once per code, ancestors included, and weights by ln((n + 1) / (df + 1))", () => {
    const c = computeIdf([
      { id: "a", mesh: ["C04.557.470", "C04.557.470", "C04.588"], rcdc: ["Cancer", "Cancer"] },
      { id: "b", mesh: ["C04.557"], rcdc: ["Cancer"] },
      { id: "c", mesh: ["C06"], rcdc: ["Digestive Diseases"] },
      { id: "d", mesh: [], rcdc: [] },
    ]);
    expect(c.n).toBe(4);
    const by = new Map(c.rows.map((r) => [`${r.kind}:${r.code}`, r]));
    expect(by.get("mesh:C04")?.df).toBe(2);
    expect(by.get("mesh:C04.557")?.df).toBe(2);
    expect(by.get("mesh:C04.557.470")?.df).toBe(1);
    expect(by.get("mesh:C04.588")?.df).toBe(1);
    expect(by.get("mesh:C06")?.df).toBe(1);
    expect(by.get("rcdc:Cancer")?.df).toBe(2);
    expect(by.get("rcdc:Digestive Diseases")?.df).toBe(1);
    expect(by.get("mesh:C04")?.idf).toBeCloseTo(Math.log(5 / 3), 12);
    expect(by.get("mesh:C04.557.470")?.idf).toBeCloseTo(Math.log(5 / 2), 12);
    // an ancestor is never rarer than its descendant
    expect(by.get("mesh:C04")!.idf).toBeLessThanOrEqual(by.get("mesh:C04.557")!.idf);
    expect(by.get("mesh:C04.557")!.idf).toBeLessThanOrEqual(by.get("mesh:C04.557.470")!.idf);
    // rows ordered mesh first, then code
    expect(c.rows.map((r) => r.code)).toEqual(["C04", "C04.557", "C04.557.470", "C04.588", "C06", "Cancer", "Digestive Diseases"]);
    expect(c.table.weights.C06).toBeCloseTo(Math.log(5 / 2), 12);
    expect(c.table.unknown).toBeCloseTo(Math.log(5 / 2), 12);
  });

  it("a code in every notice weighs 0; the unknown weight is the df = 1 value, 1 for an empty corpus", () => {
    const c = computeIdf([
      { id: "a", mesh: ["C04"], rcdc: [] },
      { id: "b", mesh: ["C04"], rcdc: [] },
    ]);
    expect(c.table.weights.C04).toBe(0);
    expect(idfValue(2, 2)).toBe(0);
    expect(unknownIdf(2)).toBeCloseTo(Math.log(3 / 2), 12);
    expect(unknownIdf(0)).toBe(1);
    expect(computeIdf([]).table).toEqual({ weights: {}, unknown: 1 });
  });

  it("feeds the engine's coded overlap: an unknown code takes the fallback and a shallow common code is worth little", () => {
    const { table } = computeIdf([
      { id: "a", mesh: ["C04.557.470"], rcdc: [] },
      { id: "b", mesh: ["C04.588"], rcdc: [] },
      { id: "c", mesh: ["C04.588"], rcdc: [] },
      { id: "d", mesh: ["C06.130"], rcdc: [] },
    ]);
    // C04 is in three of four notices (idf ln(5/4)); C04.557.470 in one (ln(5/2)); an investigator on C04.588 only shares C04 with notice a
    const shallow = codedOverlap({ mesh_major: ["C04.588"], rcdc: [], free_text: null }, { mesh: ["C04.557.470"], rcdc: [], terms: [], free_text: null }, table);
    expect(shallow.score).toBeCloseTo((1 * Math.log(5 / 4)) / (3 * Math.log(5 / 2)), 10);
    const exact = codedOverlap({ mesh_major: ["C04.557.470.200"], rcdc: [], free_text: null }, { mesh: ["C04.557.470"], rcdc: [], terms: [], free_text: null }, table);
    expect(exact.score).toBeCloseTo(1, 10);
    // a notice code the table never saw takes `unknown` (ln(5/2)) in the denominator
    const unknown = codedOverlap({ mesh_major: [], rcdc: [], free_text: null }, { mesh: ["C10.228"], rcdc: [], terms: [], free_text: null }, table);
    expect(unknown.score).toBe(0);
    expect(unknown.unmatched).toEqual(["C10.228"]);
  });

  it("idfTableFromRows also answers the folded RCDC spelling", () => {
    const t = idfTableFromRows([
      { code: "C04", kind: "mesh", idf: 0.5, n: 10 },
      { code: "Autoimmune Disease", kind: "rcdc", idf: 1.2, n: 10 },
    ]);
    expect(t.weights["Autoimmune Disease"]).toBe(1.2);
    expect(t.weights["autoimmune disease"]).toBe(1.2);
    expect(t.unknown).toBeCloseTo(Math.log(11 / 2), 12);
  });

  it("refreshTopicIdf upserts every row and deletes what an earlier refresh left; loadIdf reads it back", async () => {
    const tables: Record<string, Row[]> = { fit_topic_idf: [{ code: "OLD", kind: "mesh", df: 1, n: 1, idf: 0.1, computed_at: "2026-01-01T00:00:00.000Z" }] };
    const writes: Array<{ op: string; rows: Row[] }> = [];
    const db = fakeDb(tables, writes);
    const c = computeIdf([{ id: "a", mesh: ["C04.557"], rcdc: ["Cancer"] }]);
    const r = await refreshTopicIdf(db, c, new Date("2026-09-06T00:00:00.000Z"));
    expect(r).toEqual({ n: 1, codes: 3, written: 3, deleted: 1, skipped: null });
    expect(writes.map((w) => w.op)).toEqual(["upsert", "delete"]);
    expect(tables.fit_topic_idf!.map((x) => x.code).sort()).toEqual(["C04", "C04.557", "Cancer"]);
    const loaded = await loadIdf(db);
    expect(loaded.available).toBe(true);
    expect(loaded.rows).toBe(3);
    expect(loaded.n).toBe(1);
    expect(loaded.table.weights["C04.557"]).toBeCloseTo(Math.log(2 / 2), 12);
    expect(loaded.table.unknown).toBeCloseTo(unknownIdf(1), 12);
  });

  it("before the migration the refresh is skipped and the load is the neutral table", async () => {
    const db = fakeDb({});
    const r = await refreshTopicIdf(db, computeIdf([{ id: "a", mesh: ["C04"], rcdc: [] }]));
    expect(r.written).toBe(0);
    expect(r.skipped).toMatch(/fit_topic_idf is not on the database/);
    const loaded = await loadIdf(db);
    expect(loaded).toEqual({ table: { weights: {}, unknown: 1 }, rows: 0, n: 0, available: false });
    expect(await loadIdf(fakeDb({ fit_topic_idf: [] }))).toEqual({ table: { weights: {}, unknown: 1 }, rows: 0, n: 0, available: false });
  });
});
