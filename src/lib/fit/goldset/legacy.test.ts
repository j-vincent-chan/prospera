import { describe, expect, it } from "vitest";
import { cosineOf, legacyRank, legacyScorePair, legacyTier, legacyToFitTier, LEGACY_EVIDENCE_ITEMS } from "@/lib/fit/goldset/legacy";
import { SIM } from "@/lib/outreach/suggest";

describe("goldset/legacy · legacyTier (rank-opportunities rule)", () => {
  it("drops below the exploratory floor or without a vector", () => {
    expect(legacyTier(SIM.exploratory - 0.001, 5, 3)).toBe("dropped");
    expect(legacyTier(null, 5, 3)).toBe("dropped");
  });
  it("is exploratory at the floor with no supporting item", () => {
    expect(legacyTier(SIM.exploratory, 0, 0)).toBe("exploratory");
    expect(legacyTier(SIM.potential - 0.001, 0, 0)).toBe("exploratory");
  });
  it("is potential at SIM.potential, or with one supporting item", () => {
    expect(legacyTier(SIM.potential, 0, 0)).toBe("potential");
    expect(legacyTier(SIM.exploratory, 1, 1)).toBe("potential");
    expect(legacyTier(SIM.strong, 2, 1)).toBe("potential");
    expect(legacyTier(SIM.strong, 1, 1)).toBe("potential");
  });
  it("is strong at SIM.strong with two supporting items of two kinds", () => {
    expect(legacyTier(SIM.strong, 2, 2)).toBe("strong");
    expect(legacyTier(SIM.strong - 0.001, 2, 2)).toBe("potential");
  });
  it("maps onto fit tiers", () => {
    expect(legacyToFitTier("strong")).toBe("strong");
    expect(legacyToFitTier("potential")).toBe("moderate");
    expect(legacyToFitTier("exploratory")).toBe("exploratory");
    expect(legacyToFitTier("dropped")).toBe("poor");
  });
});

describe("goldset/legacy · legacyScorePair", () => {
  const notice = Float32Array.from([1, 0, 0]);
  const near = (x: number) => Float32Array.from([1, x, 0]);
  it("is dropped without a vector on either side", () => {
    expect(legacyScorePair(null, notice, [])).toMatchObject({ tier: "dropped", similarity: null });
    expect(legacyScorePair(near(0), null, [])).toMatchObject({ tier: "dropped", similarity: null });
  });
  it("counts supporting items among the top six only, with distinct kinds", () => {
    const items = [
      ...Array.from({ length: 7 }, (_, i) => ({ kind: "publication", ref_id: `p${i}`, vector: near(0.1) })), // cosine ≈ 0.995
      { kind: "grant", ref_id: "g", vector: near(0.05) }, // ≈ 0.999, first of the top six
      { kind: "biosketch", ref_id: "b", vector: Float32Array.from([0, 1, 0]) }, // 0, never supporting
    ];
    const r = legacyScorePair(near(0), notice, items);
    expect(r.similarity).toBeCloseTo(1, 6);
    expect(r.top_items).toHaveLength(LEGACY_EVIDENCE_ITEMS);
    expect(r.supporting).toBe(6);
    expect(r.kinds).toBe(2);
    expect(r.tier).toBe("strong");
  });
  it("one kind of support caps at potential; nothing supporting at the floor is exploratory", () => {
    const doc = Float32Array.from([1, 1.2, 0]); // cosine with notice ≈ 0.64
    const one = legacyScorePair(doc, notice, [{ kind: "publication", ref_id: "a", vector: near(0) }, { kind: "publication", ref_id: "b", vector: near(0) }]);
    expect(one.tier).toBe("potential");
    const floor = Float32Array.from([1, 2.2, 0]); // cosine ≈ 0.414
    expect(legacyScorePair(floor, notice, [{ kind: "publication", ref_id: "a", vector: Float32Array.from([0, 1, 0]) }])).toMatchObject({ tier: "exploratory", supporting: 0 });
  });
  it("cosineOf is 0 for mismatched lengths and legacyRank orders best first", () => {
    expect(cosineOf([1, 0], [1, 0, 0])).toBe(0);
    expect(legacyRank("b", [{ id: "a", similarity: 0.5 }, { id: "b", similarity: 0.7 }, { id: "c", similarity: 0.7 }])).toBe(1);
    expect(legacyRank("c", [{ id: "a", similarity: 0.5 }, { id: "b", similarity: 0.7 }, { id: "c", similarity: 0.7 }])).toBe(2);
    expect(legacyRank("z", [{ id: "a", similarity: 0.5 }])).toBeNull();
  });
});
