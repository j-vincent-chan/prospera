import { describe, expect, it } from "vitest";
import { forbiddenCellPairs } from "@/lib/fit/engine/fixtures";
import { cellKey, offDiagonalCells } from "@/lib/fit/goldset/families";
import { currentBucketsOf, GOLDSET_QUOTAS, mulberry32, pairKey, seededShuffle, stratifyGoldset, type PairSignals, type StratifyInvestigator, type StratifyNotice } from "@/lib/fit/goldset/stratify";
import { SIM } from "@/lib/outreach/suggest";

/**
 * A small roster and corpus shaped like the real ones (no population or
 * health-systems investigator; notices of every family plus broad ones),
 * with signals that are a deterministic function of the pair so the draw
 * is reproducible and every stratum has a pool.
 */
const investigators: StratifyInvestigator[] = [
  { id: "i-disc-1", family: "discovery", item_count: 120, paradigm_confidence: "high", pending_items: 0 },
  { id: "i-disc-2", family: "discovery", item_count: 40, paradigm_confidence: "medium", pending_items: 0 },
  { id: "i-disc-3", family: "discovery", item_count: 3, paradigm_confidence: "low", pending_items: 0 },
  { id: "i-prec-1", family: "preclinical", item_count: 60, paradigm_confidence: "medium", pending_items: 0 },
  { id: "i-prec-2", family: "preclinical", item_count: 5, paradigm_confidence: "low", pending_items: 2 },
  { id: "i-tran-1", family: "translational", item_count: 90, paradigm_confidence: "medium", pending_items: 0 },
  { id: "i-clin-1", family: "clinical", item_count: 30, paradigm_confidence: "medium", pending_items: 0 },
  { id: "i-cross-1", family: "cross_cutting", item_count: 25, paradigm_confidence: "medium", pending_items: 0 },
  { id: "i-none-1", family: "none", item_count: 2, paradigm_confidence: "low", pending_items: 0 },
];

const notices: StratifyNotice[] = [
  { id: "n-disc-1", family: "discovery" },
  { id: "n-disc-2", family: "discovery" },
  { id: "n-prec-1", family: "preclinical" },
  { id: "n-tran-1", family: "translational" },
  { id: "n-clin-1", family: "clinical" },
  { id: "n-clin-2", family: "clinical" },
  { id: "n-pop-1", family: "population" },
  { id: "n-pop-2", family: "population" },
  { id: "n-sys-1", family: "health_systems" },
  { id: "n-none-1", family: "none" },
  { id: "n-none-2", family: "none" },
  { id: "n-cross-1", family: "cross_cutting" },
];

/** A cheap deterministic hash in [0, 1). */
function h(s: string): number {
  let x = 2166136261;
  for (let i = 0; i < s.length; i += 1) x = Math.imul(x ^ s.charCodeAt(i), 16777619);
  return ((x >>> 0) % 10_000) / 10_000;
}

/** Signals: the cosine is a hash in [0.25, 0.65); fit-v1 is moderate on a few pairs, poor on most, no row on some; a few outreach snapshots. */
function signals(inv: string, opp: string): PairSignals {
  const u = h(`${inv}|${opp}`);
  const similarity = 0.25 + u * 0.4;
  const supporting = u > 0.7 ? 2 : u > 0.5 ? 1 : 0;
  const kinds = u > 0.8 ? 2 : supporting ? 1 : 0;
  const legacy = similarity < SIM.exploratory ? "dropped" : similarity >= SIM.strong && supporting >= 2 && kinds >= 2 ? "strong" : similarity >= SIM.potential || supporting >= 1 ? "potential" : "exploratory";
  const v = h(`${opp}|${inv}`);
  const fit_v1 = v > 0.9 ? "moderate" : v > 0.85 ? "exploratory" : v < 0.2 ? null : "poor";
  const outreach = inv === "i-clin-1" && opp === "n-clin-1" ? "strong" : inv === "i-tran-1" && opp === "n-clin-2" ? "potential" : null;
  // Pinned pairs for the dropped stratum's own-family rule: i-disc-3 has a broad notice under the floor with a higher cosine than its discovery notice.
  if (inv === "i-disc-3" && opp === "n-disc-2") return { legacy: "dropped", legacy_similarity: 0.3, fit_v1: "poor", outreach: null };
  if (inv === "i-disc-3" && opp === "n-none-1") return { legacy: "dropped", legacy_similarity: 0.39, fit_v1: null, outreach: null };
  return { legacy, legacy_similarity: Number(similarity.toFixed(4)), fit_v1, outreach };
}

const quotas = { current: 8, adversarial: 12, random: 6, dropped: 4 };
const forbidden = forbiddenCellPairs();
const run = (seed: number, q = quotas) => stratifyGoldset({ investigators, notices, signals }, { seed, quotas: q, forbidden });

describe("goldset/stratify · seeded randomness", () => {
  it("mulberry32 and seededShuffle are deterministic in the seed", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(seededShuffle([1, 2, 3, 4, 5, 6], mulberry32(3))).toEqual(seededShuffle([1, 2, 3, 4, 5, 6], mulberry32(3)));
    expect(seededShuffle([1, 2, 3, 4, 5, 6], mulberry32(3))).not.toEqual(seededShuffle([1, 2, 3, 4, 5, 6], mulberry32(4)));
    expect([...seededShuffle([1, 2, 3, 4, 5, 6], mulberry32(3))].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("goldset/stratify · the draw", () => {
  const r = run(1);

  it("fills every stratum to its quota with no duplicate pair (the spec quotas are 80 / 60 / 40 / 20)", () => {
    expect(GOLDSET_QUOTAS).toEqual({ current: 80, adversarial: 60, random: 40, dropped: 20 });
    expect(r.counts).toEqual(quotas);
    expect(r.pairs).toHaveLength(30);
    expect(new Set(r.pairs.map((p) => pairKey(p.investigator_id, p.opportunity_id))).size).toBe(30);
    expect(r.shortfalls).toEqual([]);
  });

  it("is deterministic in the seed and moves with it", () => {
    const again = run(1);
    expect(again.pairs.map((p) => [p.investigator_id, p.opportunity_id, p.stratum])).toEqual(r.pairs.map((p) => [p.investigator_id, p.opportunity_id, p.stratum]));
    const other = run(2);
    expect(other.pairs.map((p) => pairKey(p.investigator_id, p.opportunity_id))).not.toEqual(r.pairs.map((p) => pairKey(p.investigator_id, p.opportunity_id)));
    expect(other.counts).toEqual(quotas);
  });

  it("current: only pairs an engine labels Strong / Potential / Moderate, half from each side when both sides can fill it", () => {
    const current = r.pairs.filter((p) => p.stratum === "current");
    for (const p of current) {
      const b = currentBucketsOf(p.signals);
      expect(b.fit || b.legacy).toBeTruthy();
    }
    const drawn = r.current.drawn;
    const fitSide = (drawn["fit_v1:strong"] ?? 0) + (drawn["fit_v1:moderate"] ?? 0);
    const legacySide = (drawn["outreach:strong"] ?? 0) + (drawn["legacy:strong"] ?? 0) + (drawn["outreach:potential"] ?? 0) + (drawn["legacy:potential"] ?? 0);
    expect(fitSide + legacySide).toBe(quotas.current);
    expect(fitSide).toBe(Math.floor(quotas.current / 2));
    // Strong before Potential inside the legacy side: no potential drawn while a strong candidate was left.
    const pool = r.current.pool;
    if ((drawn["legacy:potential"] ?? 0) > 0) expect(drawn["legacy:strong"] ?? 0).toBe(pool["legacy:strong"]);
  });

  it("current: the fit side is filled from the legacy side when fit-v1 has too few Strong / Moderate pairs", () => {
    const few = stratifyGoldset({ investigators, notices, signals: (i, o) => ({ ...signals(i, o), fit_v1: i === "i-disc-1" && o === "n-disc-1" ? "moderate" : "poor" }) }, { seed: 1, quotas, forbidden });
    expect(few.current.drawn["fit_v1:moderate"]).toBe(1);
    expect(few.counts.current).toBe(quotas.current);
  });

  it("adversarial: every coverable off-diagonal cell gets a pair, the uncovered ones name the missing family, forbidden cells take the remainder", () => {
    const adversarial = r.pairs.filter((p) => p.stratum === "adversarial");
    expect(adversarial.every((p) => p.cell.investigator !== p.cell.notice && p.cell.investigator !== "none" && p.cell.notice !== "none" && p.cell.investigator !== "cross_cutting")).toBe(true);
    const coverable = offDiagonalCells().filter((c) => investigators.some((i) => i.family === c.investigator) && notices.some((n) => n.family === c.notice));
    expect(coverable).toHaveLength(4 * 5); // four investigator families × five other notice families
    expect(r.cells.covered.map((c) => c.key).sort()).toEqual(coverable.map((c) => cellKey(c.investigator, c.notice)).sort());
    expect(r.cells.uncovered).toHaveLength(10);
    for (const u of r.cells.uncovered) expect(u.reason).toMatch(/no investigator on the roster with dominant family (population|health_systems)/);
    expect(r.cells.forbidden_total).toBe(8);
    expect(r.cells.forbidden_covered).toBe(4);
    // 12 pairs over 20 coverable cells: the remainder goes to the four coverable forbidden cells first, then the rest.
    const withPair = r.cells.covered.filter((c) => c.pairs > 0);
    expect(withPair.length).toBe(quotas.adversarial);
    for (const c of r.cells.covered.filter((c) => c.forbidden)) expect(c.pairs).toBe(1);
    expect(adversarial.filter((p) => p.forbidden)).toHaveLength(4);
    expect(adversarial.map((p) => p.sources[0])).toEqual(adversarial.map((p) => `cell:${cellKey(p.cell.investigator, p.cell.notice)}`));
  });

  it("adversarial: within a cell the highest legacy cosine comes first (the most confusable pair) — caps aside", () => {
    const uncapped = { per_investigator: Number.POSITIVE_INFINITY, per_notice: Number.POSITIVE_INFINITY };
    const big = stratifyGoldset({ investigators, notices, signals }, { seed: 1, quotas: { ...quotas, adversarial: 40 }, forbidden, caps: { adversarial: uncapped } });
    const byCell = new Map<string, number[]>();
    for (const p of big.pairs.filter((p) => p.stratum === "adversarial")) (byCell.get(cellKey(p.cell.investigator, p.cell.notice)) ?? byCell.set(cellKey(p.cell.investigator, p.cell.notice), []).get(cellKey(p.cell.investigator, p.cell.notice))!).push(p.signals.legacy_similarity ?? -1);
    let checked = 0;
    for (const sims of byCell.values()) {
      if (sims.length < 2) continue;
      checked += 1;
      expect(sims).toEqual([...sims].sort((a, b) => b - a));
    }
    expect(checked).toBeGreaterThan(0);
    expect(big.counts.adversarial).toBe(40);
  });

  it("random: pairs at or above the current exploratory floor, not already drawn, at most two per investigator when the pool allows", () => {
    const random = r.pairs.filter((p) => p.stratum === "random");
    expect(random).toHaveLength(quotas.random);
    for (const p of random) expect(p.signals.legacy).not.toBe("dropped");
    const per = new Map<string, number>();
    for (const p of random) per.set(p.investigator_id, (per.get(p.investigator_id) ?? 0) + 1);
    expect(Math.max(...per.values())).toBeLessThanOrEqual(2);
    expect(r.random.pool).toBeGreaterThan(quotas.random);
  });

  it("dropped: one pair per investigator from the thinnest up, both engines dropping it, the own-family notice first", () => {
    const dropped = r.pairs.filter((p) => p.stratum === "dropped");
    expect(dropped).toHaveLength(quotas.dropped);
    for (const p of dropped) {
      expect(p.signals.legacy).toBe("dropped");
      expect(p.signals.fit_v1 === null || p.signals.fit_v1 === "poor").toBe(true);
    }
    // Thinness order: i-none-1 (2 items), i-disc-3 (3), i-prec-2 (5), then the next thinnest with a dropped pair.
    const used = r.dropped.investigators.map((d) => d.id);
    expect(used.slice(0, 3)).toEqual(["i-none-1", "i-disc-3", "i-prec-2"]);
    expect(r.dropped.investigators.map((d) => d.item_count)).toEqual([...r.dropped.investigators.map((d) => d.item_count)].sort((a, b) => a - b));
    expect(new Set(dropped.map((p) => p.investigator_id)).size).toBe(quotas.dropped);
    const disc3 = dropped.find((p) => p.investigator_id === "i-disc-3")!;
    expect(disc3.opportunity_id).toBe("n-disc-2"); // own family first, ahead of the broad notice with the higher cosine
    expect(disc3.cell.notice).toBe("discovery");
    expect(disc3.sources).toEqual(expect.arrayContaining(["thin:3 items, paradigm low", "legacy:dropped"]));
  });

  it("dropped: a second pair per investigator only when the thin list runs out", () => {
    const many = run(1, { ...quotas, dropped: 12 });
    expect(many.counts.dropped).toBe(12);
    const per = new Map<string, number>();
    for (const p of many.pairs.filter((p) => p.stratum === "dropped")) per.set(p.investigator_id, (per.get(p.investigator_id) ?? 0) + 1);
    expect(per.size).toBe(9);
    expect(Math.max(...per.values())).toBe(2);
  });

  it("reports a shortfall instead of throwing when a pool is too small", () => {
    const short = run(1, { ...quotas, current: 500 });
    expect(short.counts.current).toBeLessThan(500);
    expect(short.shortfalls[0]).toMatch(/^current: \d+ of 500/);
    expect(short.counts.adversarial + short.counts.random + short.counts.dropped).toBeGreaterThan(0);
  });
});
