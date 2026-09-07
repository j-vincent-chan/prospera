/**
 * `fit_results` reads (PR 2.2 / 3.2) on the fake PostgREST builder: the
 * evidence view's component read chunks its `in()` list and filters no tier.
 */
import { describe, expect, it } from "vitest";
import { fakeDb, type Row } from "@/lib/fit/__fixtures__/fake-db";
import { FIT_RESULT_COMPONENT_COLUMNS, loadFitComponentsForNotice } from "@/lib/fit/results";

/** The builder with every filter call recorded — the fake logs a read's columns only. */
function spyDb(tables: Parameters<typeof fakeDb>[0]) {
  const db = fakeDb(tables);
  const filters: Array<{ op: string; col: string; n: number }> = [];
  const from = db.from.bind(db);
  (db as unknown as { from: (t: string) => unknown }).from = (t: string) => {
    const q = from(t) as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const op of ["in", "eq"] as const) {
      const orig = q[op]!;
      q[op] = (col: unknown, v: unknown) => {
        filters.push({ op, col: String(col), n: Array.isArray(v) ? v.length : 1 });
        return orig(col, v);
      };
    }
    return q;
  };
  return { db, filters };
}

describe("results · loadFitComponentsForNotice", () => {
  const ids = Array.from({ length: 201 }, (_, i) => `inv-${String(i).padStart(3, "0")}`);
  const row = (investigator_id: string, tier: string): Row => ({ investigator_id, opportunity_id: "opp-1", tier, score: "50", components: { P: 0.5 }, caps: [], judged_at: null, judged_tier: null, judged_from: null, judged_confidence: null });

  it("201 ids → two reads of 200 + 1 ids, no tier filter, rows merged (a Poor row is read too)", async () => {
    const { db, filters } = spyDb({ fit_results: [row("inv-000", "strong"), row("inv-199", "poor"), row("inv-200", "exploratory"), row("inv-100", "moderate"), { ...row("inv-000", "strong"), opportunity_id: "opp-2" }, row("someone-else", "strong")] });
    const r = await loadFitComponentsForNotice(db, "opp-1", ids);
    expect(r.available).toBe(true);
    expect(r.error).toBeNull();
    expect(db.log.reads).toEqual([`fit_results:${FIT_RESULT_COMPONENT_COLUMNS}`, `fit_results:${FIT_RESULT_COMPONENT_COLUMNS}`]);
    expect(filters.filter((f) => f.op === "in" && f.col === "investigator_id").map((f) => f.n)).toEqual([200, 1]);
    expect(filters.filter((f) => f.col === "tier")).toEqual([]);
    expect(filters.filter((f) => f.op === "eq" && f.col === "opportunity_id")).toHaveLength(2);
    expect(r.rows.map((x) => [x.investigator_id, x.tier, x.score])).toEqual([
      ["inv-000", "strong", 50],
      ["inv-100", "moderate", 50],
      ["inv-199", "poor", 50],
      ["inv-200", "exploratory", 50],
    ]);
  });

  it("no ids → no read; the missing table is 'unavailable'", async () => {
    const { db, filters } = spyDb({ fit_results: [] });
    expect(await loadFitComponentsForNotice(db, "opp-1", [])).toEqual({ rows: [], available: true, error: null });
    expect(db.log.reads).toEqual([]);
    expect(filters).toEqual([]);
    expect(await loadFitComponentsForNotice(fakeDb({ fit_results: null }), "opp-1", ["inv-1"])).toEqual({ rows: [], available: false, error: null });
  });
});
