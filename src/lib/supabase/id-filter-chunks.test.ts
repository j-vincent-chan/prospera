import { describe, expect, it } from "vitest";
import {
  SUPABASE_ID_FILTER_CHUNK_SIZE,
  chunkIdsForInFilter,
} from "@/lib/supabase/id-filter-chunks";

describe("chunkIdsForInFilter", () => {
  it("returns no batches for an empty list", () => {
    expect(chunkIdsForInFilter([])).toEqual([]);
  });

  it("keeps a short list in one batch", () => {
    expect(chunkIdsForInFilter(["a", "b", "c"])).toEqual([["a", "b", "c"]]);
  });

  it("splits long lists at the default chunk size", () => {
    const ids = Array.from({ length: 716 }, (_, i) => `id-${i}`);
    const chunks = chunkIdsForInFilter(ids);
    expect(chunks).toHaveLength(8);
    expect(chunks.every((c) => c.length <= SUPABASE_ID_FILTER_CHUNK_SIZE)).toBe(true);
    expect(chunks.flat()).toEqual(ids);
  });

  it("keeps every batch URL well under the ~24KB gateway limit", () => {
    const uuid = "4f0f46cd-5087-479e-b7e4-16271d1613b0";
    const ids = Array.from({ length: 5000 }, () => uuid);
    for (const chunk of chunkIdsForInFilter(ids)) {
      const url = `https://example.supabase.co/rest/v1/community_source_items?id=in.${encodeURIComponent(`(${chunk.join(",")})`)}`;
      expect(url.length).toBeLessThan(10_000);
    }
  });

  it("honours an explicit chunk size and never produces empty batches", () => {
    expect(chunkIdsForInFilter(["a", "b", "c"], 2)).toEqual([["a", "b"], ["c"]]);
    expect(chunkIdsForInFilter(["a", "b"], 0)).toEqual([["a"], ["b"]]);
  });
});
