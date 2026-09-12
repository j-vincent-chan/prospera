import { describe, expect, it } from "vitest";
import { fetchFundingListRows } from "./fetch-funding-list-rows";

/**
 * A PostgREST stand-in: `total` rows exist, the planner "estimates"
 * `estimate` of them, and every request is logged with its range and the
 * moment it started, so the test can see which pages were in flight together.
 */
function fakeCatalog(total: number, estimate: number | null) {
  const log: Array<{ from: number; to: number; count: string | undefined; startedAt: number }> = [];
  let clock = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const builder = (count: string | undefined) => {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const m of ["or", "order", "in", "not", "eq", "neq", "gte", "lte", "contains", "overlaps", "is", "filter"]) chain[m] = self;
    chain.range = (from: number, to: number) => {
      const startedAt = clock;
      log.push({ from, to, count, startedAt });
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise((resolve) =>
        setTimeout(() => {
          inFlight -= 1;
          clock += 1;
          const data = Array.from({ length: Math.max(0, Math.min(total, to + 1) - from) }, (_, i) => ({ id: `row-${from + i}` }));
          resolve({ data, error: null, count: count === "planned" ? estimate : null });
        }, 1),
      );
    };
    return chain;
  };
  const supabase = { from: () => ({ select: (_cols: string, opts?: { count?: string }) => builder(opts?.count) }) };
  return { supabase: supabase as never, log, maxInFlight: () => maxInFlight };
}

const opts = {
  agencySelection: { departments: [], departmentSubs: {}, legacyAgencies: [] },
  qParam: "",
  rdFilterState: { activityFamilies: [], clinicalTrialMode: null, nihIc: [], announcement: [], pathway: [], investigatorTags: [], mechanismTypes: [], collaborations: [], humanSubjects: [] },
  sortKey: "next_due" as const,
  sortDir: "asc" as const,
  clientSortOnly: false,
};

describe("fetchFundingListRows paging", () => {
  it("a short first page is the whole list: one request", async () => {
    const c = fakeCatalog(706, 700);
    const res = await fetchFundingListRows(c.supabase, opts);
    expect(res.rows).toHaveLength(706);
    expect(c.log).toHaveLength(1);
    expect(c.log[0].count).toBe("planned");
  });

  it("requests the pages after the first together when the planner expects them", async () => {
    const c = fakeCatalog(1783, 1800);
    const res = await fetchFundingListRows(c.supabase, opts);
    expect(res.rows).toHaveLength(1783);
    expect(res.rows.map((r) => r.id).slice(998, 1002)).toEqual(["row-998", "row-999", "row-1000", "row-1001"]);
    expect(c.log.map((l) => l.from)).toEqual([0, 1000]);
    expect(res.truncated).toBe(false);
  });

  it("three pages: the second and third are in flight at the same time", async () => {
    const c = fakeCatalog(2500, 2500);
    const res = await fetchFundingListRows(c.supabase, opts);
    expect(res.rows).toHaveLength(2500);
    expect(c.log.map((l) => l.from)).toEqual([0, 1000, 2000]);
    expect(c.log[1].startedAt).toBe(c.log[2].startedAt);
    expect(c.maxInFlight()).toBe(2);
  });

  it("an estimate that is too low still fetches every row, one page at a time after the batch", async () => {
    const c = fakeCatalog(3335, 900);
    const res = await fetchFundingListRows(c.supabase, opts);
    expect(res.rows).toHaveLength(3335);
    expect(res.rows[3334].id).toBe("row-3334");
    expect(c.log.map((l) => l.from)).toEqual([0, 1000, 2000, 3000]);
    expect(c.maxInFlight()).toBe(1);
  });

  it("an estimate that is too high costs empty pages, never duplicate or missing rows", async () => {
    const c = fakeCatalog(1200, 4000);
    const res = await fetchFundingListRows(c.supabase, opts);
    expect(res.rows).toHaveLength(1200);
    expect(new Set(res.rows.map((r) => r.id)).size).toBe(1200);
    expect(c.log.map((l) => l.from)).toEqual([0, 1000, 2000, 3000]);
  });

  it("a wild estimate fans out to at most four extra pages", async () => {
    const c = fakeCatalog(1000, 60_000);
    const res = await fetchFundingListRows(c.supabase, opts);
    expect(res.rows).toHaveLength(1000);
    expect(c.log.filter((l) => l.startedAt === c.log[1].startedAt)).toHaveLength(4);
  });

  it("no estimate at all behaves like the sequential fetch", async () => {
    const c = fakeCatalog(1500, null);
    const res = await fetchFundingListRows(c.supabase, opts);
    expect(res.rows).toHaveLength(1500);
    expect(c.log.map((l) => l.from)).toEqual([0, 1000]);
  });
});
