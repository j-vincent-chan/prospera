import { describe, expect, it } from "vitest";
import { fromCacheable, toCacheable } from "@/lib/review/cached-queue";
import { visitBucket } from "@/lib/home/cached";
import type { ReviewQueue } from "@/lib/review/queries";

describe("the queue across the data cache", () => {
  it("round-trips its Maps and Sets through JSON", () => {
    const q = {
      engine: "fit-v1",
      available: true,
      decisionsAvailable: true,
      notices: [],
      undecided: 3,
      confirmed: 1,
      pairs: { available: true, pairs: [], notices: new Map([["o1", { id: "o1" }]]), byTier: new Map([["o1", { strong: 1, moderate: 0, exploratory: 2, poor: 0 }]]) },
      decisions: new Map([["o1:p1", { opportunityId: "o1", investigatorId: "p1", status: "confirmed", reason: null, scope: "pair", auto: false, resurfaceOn: null, verdictLabel: "strong", decidedBy: "u", decidedAt: "2026-09-13T00:00:00Z" }]]),
      doNotContact: new Set(["p9"]),
      limited: new Set(["o1"]),
      exploratoryCap: 0,
    } as unknown as ReviewQueue;
    const back = fromCacheable(JSON.parse(JSON.stringify(toCacheable(q))));
    expect(back.pairs.notices.get("o1")).toEqual({ id: "o1" });
    expect(back.pairs.byTier.get("o1")).toEqual({ strong: 1, moderate: 0, exploratory: 2, poor: 0 });
    expect(back.decisions.get("o1:p1")?.status).toBe("confirmed");
    expect(back.doNotContact.has("p9")).toBe(true);
    expect(back.limited.has("o1")).toBe(true);
    expect(back.undecided).toBe(3);
  });

  it("buckets the last visit to its day", () => {
    expect(visitBucket("2026-09-13T14:51:48.847Z")).toBe("2026-09-13T00:00:00.000Z");
    expect(visitBucket(null)).toBeNull();
  });
});
