import { describe, expect, it } from "vitest";
import { aboveLegacyFloor, cosineOf, LEGACY_EVIDENCE_ITEMS, LEGACY_SHOWN_TOP_N, LEGACY_TOP_HITS, legacyRanks, legacyScorePair, legacyTier, legacyToFitTier, legacyWindow } from "@/lib/fit/goldset/legacy";
import { SIM } from "@/lib/outreach/suggest";

describe("goldset/legacy · legacyTier (rank-opportunities rule with the page's window)", () => {
  it("drops below the exploratory floor, without a vector, or outside the top 20", () => {
    expect(legacyTier(SIM.exploratory - 0.001, 5, 3, 1)).toBe("dropped");
    expect(legacyTier(null, 5, 3, 1)).toBe("dropped");
    expect(legacyTier(SIM.strong, 5, 3, null)).toBe("dropped");
    expect(legacyTier(SIM.strong, 5, 3, LEGACY_TOP_HITS + 1)).toBe("dropped");
  });
  it("is not shown behind the five the page shows, whatever the evidence says", () => {
    expect(LEGACY_SHOWN_TOP_N).toBe(5);
    expect(legacyTier(SIM.strong, 5, 3, LEGACY_SHOWN_TOP_N + 1)).toBe("not_shown");
    expect(legacyTier(SIM.strong, 5, 3, LEGACY_TOP_HITS)).toBe("not_shown");
    expect(legacyTier(SIM.strong, 5, 3, LEGACY_SHOWN_TOP_N)).toBe("strong");
  });
  it("is exploratory at the floor with no supporting item", () => {
    expect(legacyTier(SIM.exploratory, 0, 0, 1)).toBe("exploratory");
    expect(legacyTier(SIM.potential - 0.001, 0, 0, 5)).toBe("exploratory");
  });
  it("is potential at SIM.potential, or with one supporting item", () => {
    expect(legacyTier(SIM.potential, 0, 0, 1)).toBe("potential");
    expect(legacyTier(SIM.exploratory, 1, 1, 1)).toBe("potential");
    expect(legacyTier(SIM.strong, 2, 1, 1)).toBe("potential");
    expect(legacyTier(SIM.strong, 1, 1, 1)).toBe("potential");
  });
  it("is strong at SIM.strong with two supporting items of two kinds", () => {
    expect(legacyTier(SIM.strong, 2, 2, 1)).toBe("strong");
    expect(legacyTier(SIM.strong - 0.001, 2, 2, 1)).toBe("potential");
  });
  it("maps onto fit tiers: not shown and dropped are Poor (the surface would not show them)", () => {
    expect(legacyToFitTier("strong")).toBe("strong");
    expect(legacyToFitTier("potential")).toBe("moderate");
    expect(legacyToFitTier("exploratory")).toBe("exploratory");
    expect(legacyToFitTier("not_shown")).toBe("poor");
    expect(legacyToFitTier("dropped")).toBe("poor");
  });
  it("aboveLegacyFloor is the cosine floor alone", () => {
    expect(aboveLegacyFloor(SIM.exploratory)).toBe(true);
    expect(aboveLegacyFloor(SIM.exploratory - 1e-9)).toBe(false);
    expect(aboveLegacyFloor(null)).toBe(false);
  });
});

describe("goldset/legacy · legacyScorePair", () => {
  const notice = Float64Array.from([1, 0, 0]);
  const near = (x: number) => Float64Array.from([1, x, 0]);
  it("is dropped without a vector on either side", () => {
    expect(legacyScorePair(null, notice, [], 1)).toMatchObject({ tier: "dropped", similarity: null, rank: null });
    expect(legacyScorePair(near(0), null, [], 1)).toMatchObject({ tier: "dropped", similarity: null });
  });
  it("counts supporting items among the top six only, with distinct kinds", () => {
    const items = [
      ...Array.from({ length: 7 }, (_, i) => ({ kind: "publication", ref_id: `p${i}`, vector: near(0.1) })), // cosine ≈ 0.995
      { kind: "grant", ref_id: "g", vector: near(0.05) }, // ≈ 0.999, first of the top six
      { kind: "biosketch", ref_id: "b", vector: Float64Array.from([0, 1, 0]) }, // 0, never supporting
    ];
    const r = legacyScorePair(near(0), notice, items, 2);
    expect(r.similarity).toBeCloseTo(1, 6);
    expect(r.rank).toBe(2);
    expect(r.top_items).toHaveLength(LEGACY_EVIDENCE_ITEMS);
    expect(r.supporting).toBe(6);
    expect(r.kinds).toBe(2);
    expect(r.tier).toBe("strong");
  });
  it("behind the five shown the pair is not_shown and no evidence is scored; outside the top 20 it is dropped, the cosine kept", () => {
    const items = [{ kind: "grant", ref_id: "g", vector: near(0.05) }, { kind: "publication", ref_id: "p", vector: near(0.05) }];
    const behind = legacyScorePair(near(0), notice, items, LEGACY_SHOWN_TOP_N + 1);
    expect(behind).toMatchObject({ tier: "not_shown", rank: LEGACY_SHOWN_TOP_N + 1, supporting: 0, kinds: 0, top_items: [] });
    expect(behind.similarity).toBeCloseTo(1, 6);
    const outside = legacyScorePair(near(0), notice, items, null);
    expect(outside).toMatchObject({ tier: "dropped", rank: null, supporting: 0 });
    expect(outside.similarity).toBeCloseTo(1, 6);
  });
  it("one kind of support caps at potential; nothing supporting at the floor is exploratory", () => {
    const doc = Float64Array.from([1, 1.2, 0]); // cosine with notice ≈ 0.64
    const one = legacyScorePair(doc, notice, [{ kind: "publication", ref_id: "a", vector: near(0) }, { kind: "publication", ref_id: "b", vector: near(0) }], 1);
    expect(one.tier).toBe("potential");
    const floor = Float64Array.from([1, 2.2, 0]); // cosine ≈ 0.414
    expect(legacyScorePair(floor, notice, [{ kind: "publication", ref_id: "a", vector: Float64Array.from([0, 1, 0]) }], 3)).toMatchObject({ tier: "exploratory", supporting: 0 });
  });
  it("cosineOf is 0 for mismatched lengths and takes number[] and Float64Array alike", () => {
    expect(cosineOf([1, 0], [1, 0, 0])).toBe(0);
    expect(cosineOf([1, 0, 0], Float64Array.from([1, 0, 0]))).toBe(1);
  });
});

describe("goldset/legacy · the window (match_opportunities top hits)", () => {
  const doc = Float64Array.from([1, 0, 0]);
  const candidates = Array.from({ length: 30 }, (_, i) => ({ id: `n${String(i).padStart(2, "0")}`, vector: Float64Array.from([1, i * 0.1, 0]) })); // n00 is the closest, n29 the farthest
  it("ranks the candidates best first and keeps the top 20", () => {
    const w = legacyWindow(doc, candidates);
    expect(w).toHaveLength(LEGACY_TOP_HITS);
    expect(w[0]).toMatchObject({ id: "n00", rank: 1 });
    expect(w[0]!.similarity).toBeCloseTo(1, 9);
    expect(w[19]).toMatchObject({ id: "n19", rank: 20 });
    expect(w.map((h) => h.similarity)).toEqual([...w.map((h) => h.similarity)].sort((a, b) => b - a));
    const ranks = legacyRanks(doc, candidates);
    expect(ranks.get("n04")).toBe(5);
    expect(ranks.get("n05")).toBe(6);
    expect(ranks.has("n20")).toBe(false);
  });
  it("breaks ties by id and is empty without a document vector", () => {
    const tied = [{ id: "b", vector: doc }, { id: "a", vector: doc }, { id: "c", vector: Float64Array.from([0, 1, 0]) }];
    expect(legacyWindow(doc, tied).map((h) => h.id)).toEqual(["a", "b", "c"]);
    expect(legacyWindow(null, tied)).toEqual([]);
  });
  it("a pair at rank 6 with a Strong-grade cosine and evidence is not shown; the same pair at rank 5 is Strong", () => {
    const items = [{ kind: "grant", ref_id: "g", vector: doc }, { kind: "publication", ref_id: "p", vector: doc }];
    const ranks = legacyRanks(doc, candidates);
    expect(legacyScorePair(doc, candidates[5]!.vector, items, ranks.get("n05") ?? null).tier).toBe("not_shown");
    expect(legacyScorePair(doc, candidates[4]!.vector, items, ranks.get("n04") ?? null).tier).toBe("strong");
    expect(legacyScorePair(doc, candidates[25]!.vector, items, ranks.get("n25") ?? null).tier).toBe("dropped");
  });
});
