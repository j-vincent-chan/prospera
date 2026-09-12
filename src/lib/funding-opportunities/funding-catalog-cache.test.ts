import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FundingListClientState } from "./funding-list-url";

// The data cache is exercised through a fake: it records keys and replays stored answers.
const store = new Map<string, unknown>();
const revalidated: string[] = [];
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => Promise<unknown>, keyParts: string[]) => {
    return async (...args: unknown[]) => {
      const key = `${keyParts.join("|")}|${JSON.stringify(args)}`;
      if (store.has(key)) return store.get(key);
      const value = await fn(...args);
      store.set(key, value);
      return value;
    };
  },
  revalidateTag: (tag: string) => {
    revalidated.push(tag);
  },
}));

const liveCounts = vi.fn();
vi.mock("./funding-search-notification-query", () => ({
  getSavedSearchMatchStats: (...args: unknown[]) => liveCounts(...args),
}));

let serviceRole: unknown = { role: "service" };
vi.mock("@/lib/supabase/admin-service", () => ({
  createServiceRoleClient: () => serviceRole,
}));

import { loadSavedSearchMatchStats, revalidateFundingCatalogCache, savedSearchMatchStatsKey, FUNDING_CATALOG_CACHE_TAG } from "./funding-catalog-cache";

const base: FundingListClientState = {
  q: "Cancer",
  scope: "all",
  tabs: [],
  sort: "posted_date",
  order: "desc",
  page: 1,
  perPage: 50,
  departments: ["hhs"],
  departmentSubs: { hhs: ["nih"] },
  legacyAgencies: [],
  rd: { activityFamilies: [], clinicalTrialMode: null, nihIc: [], announcement: [], pathway: [], investigatorTags: [], mechanismTypes: [], collaborations: [], humanSubjects: [] },
};

const requestClient = { role: "request" } as never;

beforeEach(() => {
  store.clear();
  revalidated.length = 0;
  liveCounts.mockReset();
  serviceRole = { role: "service" };
});

describe("savedSearchMatchStatsKey", () => {
  it("ignores quick filters, sort and paging — they never change the count", () => {
    const a = savedSearchMatchStatsKey(base);
    const b = savedSearchMatchStatsKey({ ...base, tabs: ["nih"], sort: "title", order: "asc", page: 3, perPage: 100, savedSearchId: "x", closingDays: 60 });
    expect(a).toBe(b);
  });

  it("changes with every input the count reads", () => {
    const a = savedSearchMatchStatsKey(base);
    expect(savedSearchMatchStatsKey({ ...base, q: "Genomics" })).not.toBe(a);
    expect(savedSearchMatchStatsKey({ ...base, scope: "open" })).not.toBe(a);
    expect(savedSearchMatchStatsKey({ ...base, departments: [] })).not.toBe(a);
    expect(savedSearchMatchStatsKey({ ...base, departmentSubs: {} })).not.toBe(a);
    expect(savedSearchMatchStatsKey({ ...base, rd: { ...base.rd, nihIc: ["NHGRI"] } })).not.toBe(a);
    expect(savedSearchMatchStatsKey({ ...base, noDepartmentsSelected: true })).not.toBe(a);
  });

  it("does not depend on the order departments were picked in", () => {
    expect(savedSearchMatchStatsKey({ ...base, departments: ["hhs", "nsf"] })).toBe(savedSearchMatchStatsKey({ ...base, departments: ["nsf", "hhs"] }));
  });
});

describe("loadSavedSearchMatchStats", () => {
  it("counts once per key with the service-role client, then serves the cached answer", async () => {
    liveCounts.mockResolvedValue({ newResultsRecent: 3, newMatchesSinceViewed: 3, lastMatchedAt: null, totalMatches: 40 });
    const first = await loadSavedSearchMatchStats(requestClient, base, { lastViewedAt: "2026-09-01T00:00:00Z" });
    const second = await loadSavedSearchMatchStats(requestClient, { ...base, tabs: ["nih"], page: 2 }, { lastViewedAt: "2026-09-01T00:00:00Z" });
    expect(first.totalMatches).toBe(40);
    expect(second).toEqual(first);
    expect(liveCounts).toHaveBeenCalledTimes(1);
    expect(liveCounts.mock.calls[0][0]).toEqual({ role: "service" });
    expect(liveCounts.mock.calls[0][2]).toMatchObject({ lastViewedAt: "2026-09-01T00:00:00Z", includeForecasted: true, throwOnError: true });
  });

  it("opening the search (a new last-viewed stamp) is a new key, so the badge is fresh at once", async () => {
    liveCounts.mockResolvedValueOnce({ newResultsRecent: 3, newMatchesSinceViewed: 3, lastMatchedAt: null, totalMatches: 40 });
    liveCounts.mockResolvedValueOnce({ newResultsRecent: 0, newMatchesSinceViewed: 0, lastMatchedAt: null, totalMatches: 40 });
    const before = await loadSavedSearchMatchStats(requestClient, base, { lastViewedAt: "2026-09-01T00:00:00Z" });
    const after = await loadSavedSearchMatchStats(requestClient, base, { lastViewedAt: "2026-09-11T00:00:00Z" });
    expect(before.newMatchesSinceViewed).toBe(3);
    expect(after.newMatchesSinceViewed).toBe(0);
    expect(liveCounts).toHaveBeenCalledTimes(2);
  });

  it("a failed count is not stored: the request client answers instead", async () => {
    liveCounts.mockImplementationOnce(async () => {
      throw new Error("statement timeout");
    });
    liveCounts.mockResolvedValueOnce({ newResultsRecent: 0, newMatchesSinceViewed: 0, lastMatchedAt: null, totalMatches: 0 });
    const res = await loadSavedSearchMatchStats(requestClient, base, {});
    expect(res.totalMatches).toBe(0);
    expect(liveCounts).toHaveBeenCalledTimes(2);
    expect(liveCounts.mock.calls[1][0]).toBe(requestClient);
    expect(store.size).toBe(0);
  });

  it("falls back to the live query when no service key is configured", async () => {
    serviceRole = null;
    liveCounts.mockResolvedValue({ newResultsRecent: 1, newMatchesSinceViewed: 1, lastMatchedAt: null, totalMatches: 5 });
    const res = await loadSavedSearchMatchStats(requestClient, base, {});
    expect(res.totalMatches).toBe(5);
    expect(liveCounts.mock.calls[0][0]).toBe(requestClient);
  });
});

describe("revalidateFundingCatalogCache", () => {
  it("drops every catalog answer by tag", () => {
    revalidateFundingCatalogCache();
    expect(revalidated).toEqual([FUNDING_CATALOG_CACHE_TAG]);
  });
});
