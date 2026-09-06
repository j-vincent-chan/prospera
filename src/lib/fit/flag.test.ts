import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { cronFitEngine, isFitEngine, loadCronFitEngine, loadTeamFitEngine } from "@/lib/fit/flag";

type Row = Record<string, unknown>;

/** select → eq | is → maybeSingle | limit; a table absent answers with PostgREST's missing-table message, a column absent with its missing-column message. */
function fakeDb(rows: Row[] | null, opts: { missingColumn?: boolean; reads?: string[] } = {}): SupabaseClient {
  const builder = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    const error = () => {
      if (rows === null) return { message: `Could not find the table 'public.${table}' in the schema cache` };
      if (opts.missingColumn) return { message: "column teams.fit_engine does not exist" };
      return null;
    };
    const q: Record<string, unknown> = {};
    q.select = (cols: string) => (opts.reads?.push(`${table}:${cols}`), q);
    q.eq = (col: string, v: unknown) => (filters.push((r) => r[col] === v), q);
    q.is = (col: string, v: unknown) => (filters.push((r) => (r[col] ?? null) === v), q);
    q.maybeSingle = async () => {
      const err = error();
      return err ? { data: null, error: err } : { data: (rows ?? []).filter((r) => filters.every((f) => f(r)))[0] ?? null, error: null };
    };
    q.limit = async () => {
      const err = error();
      return err ? { data: null, error: err } : { data: (rows ?? []).filter((r) => filters.every((f) => f(r))), error: null };
    };
    return q;
  };
  return { from: builder } as unknown as SupabaseClient;
}

describe("teams.fit_engine (PR 2.2 flag)", () => {
  it("vocabulary guard", () => {
    expect(isFitEngine("legacy")).toBe(true);
    expect(isFitEngine("fit-v1")).toBe(true);
    expect(isFitEngine("fit-v2")).toBe(false);
    expect(isFitEngine(null)).toBe(false);
  });

  it("reads the acting team's value; anything it cannot read is legacy", async () => {
    const reads: string[] = [];
    const db = fakeDb([{ id: "t1", fit_engine: "fit-v1" }, { id: "t2", fit_engine: "legacy" }, { id: "t3", fit_engine: "weird" }], { reads });
    expect(await loadTeamFitEngine(db, "t1")).toBe("fit-v1");
    expect(await loadTeamFitEngine(db, "t2")).toBe("legacy");
    expect(await loadTeamFitEngine(db, "t3")).toBe("legacy");
    expect(await loadTeamFitEngine(db, "missing")).toBe("legacy");
    expect(await loadTeamFitEngine(db, null)).toBe("legacy");
    expect(await loadTeamFitEngine(db, undefined)).toBe("legacy");
    expect(reads).toEqual(["teams:fit_engine", "teams:fit_engine", "teams:fit_engine", "teams:fit_engine"]);
  });

  it("before the migration (column or table missing) every team is legacy", async () => {
    expect(await loadTeamFitEngine(fakeDb([{ id: "t1" }], { missingColumn: true }), "t1")).toBe("legacy");
    expect(await loadTeamFitEngine(fakeDb(null), "t1")).toBe("legacy");
    expect(await loadCronFitEngine(fakeDb(null))).toBe("legacy");
  });

  it("a run for no team is fit-v1 only when every live team is: an archived team does not count", async () => {
    expect(cronFitEngine([])).toBe("legacy");
    expect(cronFitEngine(["fit-v1"])).toBe("fit-v1");
    expect(cronFitEngine(["fit-v1", "legacy"])).toBe("legacy");
    expect(cronFitEngine(["fit-v1", undefined])).toBe("legacy");
    expect(await loadCronFitEngine(fakeDb([{ fit_engine: "fit-v1" }, { fit_engine: "fit-v1" }]))).toBe("fit-v1");
    expect(await loadCronFitEngine(fakeDb([{ fit_engine: "fit-v1" }, { fit_engine: "legacy" }]))).toBe("legacy");
    expect(await loadCronFitEngine(fakeDb([]))).toBe("legacy");
    expect(await loadCronFitEngine(fakeDb([{ fit_engine: "fit-v1" }, { fit_engine: "legacy", archived_at: "2026-01-01T00:00:00Z" }]))).toBe("fit-v1");
    expect(await loadCronFitEngine(fakeDb([{ fit_engine: "fit-v1", archived_at: "2026-01-01T00:00:00Z" }]))).toBe("legacy");
  });
});
