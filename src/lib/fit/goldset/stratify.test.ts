import { describe, expect, it } from "vitest";
import { forbiddenCellPairs } from "@/lib/fit/engine/fixtures";
import { cellKey, offDiagonalCells } from "@/lib/fit/goldset/families";
import { aboveLegacyFloor, LEGACY_SHOWN_TOP_N, legacyTier } from "@/lib/fit/goldset/legacy";
import { currentBucketOf, GOLDSET_QUOTAS, mulberry32, pairKey, seededShuffle, STRATA, stratifyGoldset, SYNTHETIC_SIGNALS, type PairSignals, type StratifyInvestigator, type StratifyNotice, type SyntheticStratifyInvestigator } from "@/lib/fit/goldset/stratify";
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

/** The fixture stand-ins for the two families the roster lacks (goldset/synthetic.ts). */
const synthetic: SyntheticStratifyInvestigator[] = [
  { id: "synthetic:2_cvd_epi_vs_mito_mechanism", family: "population", source: "2_cvd_epi_vs_mito_mechanism" },
  { id: "synthetic:7a_hsr_vs_beta_cell_mechanism", family: "health_systems", source: "7a_hsr_vs_beta_cell_mechanism" },
];

/** A cheap deterministic hash in [0, 1). */
function h(s: string): number {
  let x = 2166136261;
  for (let i = 0; i < s.length; i += 1) x = Math.imul(x ^ s.charCodeAt(i), 16777619);
  return ((x >>> 0) % 10_000) / 10_000;
}

/**
 * Signals: the cosine is a hash in [0.25, 0.65); the page rank grows as the
 * cosine falls (rank 1 … 8 over the floor, none under it), so a pair over
 * the floor but behind the five shown is "not_shown"; fit-v1 is moderate on
 * a few pairs, poor on most, no row on some; a few outreach snapshots.
 */
function signals(inv: string, opp: string): PairSignals {
  const u = h(`${inv}|${opp}`);
  const similarity = 0.25 + u * 0.4;
  const rank = similarity >= SIM.exploratory ? 1 + Math.floor((1 - u) * 12) : null;
  const supporting = u > 0.7 ? 2 : u > 0.5 ? 1 : 0;
  const kinds = u > 0.8 ? 2 : supporting ? 1 : 0;
  const legacy = legacyTier(similarity, supporting, kinds, rank);
  const v = h(`${opp}|${inv}`);
  const fit_v1 = v > 0.9 ? "moderate" : v > 0.85 ? "exploratory" : v < 0.2 ? null : "poor";
  const outreach = inv === "i-clin-1" && opp === "n-clin-1" ? "strong" : inv === "i-tran-1" && opp === "n-clin-2" ? "potential" : null;
  // Pinned pairs for the dropped stratum's own-family rule: i-disc-3 has a broad notice under the floor with a higher cosine than its discovery notice.
  if (inv === "i-disc-3" && opp === "n-disc-2") return { legacy: "dropped", legacy_similarity: 0.3, legacy_rank: null, fit_v1: "poor", outreach: null };
  if (inv === "i-disc-3" && opp === "n-none-1") return { legacy: "dropped", legacy_similarity: 0.39, legacy_rank: null, fit_v1: null, outreach: null };
  return { legacy, legacy_similarity: Number(similarity.toFixed(4)), legacy_rank: rank, fit_v1, outreach };
}

const quotas = { current: 8, adversarial: 30, random: 6, dropped: 4 };
const forbidden = forbiddenCellPairs();
const run = (seed: number, q = quotas) => stratifyGoldset({ investigators, notices, signals, synthetic }, { seed, quotas: q, forbidden });

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
  const spec = quotas.current + quotas.adversarial + quotas.random + quotas.dropped;

  it("fills every spec stratum to its quota, appends the fit-v1 stratum, with no duplicate pair (the spec quotas are 80 / 60 / 40 / 20)", () => {
    expect(GOLDSET_QUOTAS).toEqual({ current: 80, adversarial: 60, random: 40, dropped: 20 });
    expect(STRATA).toEqual(["current", "adversarial", "random", "dropped", "fit_v1"]);
    expect(r.counts).toMatchObject(quotas);
    expect(r.counts.fit_v1).toBeGreaterThan(0);
    expect(r.pairs).toHaveLength(spec + r.counts.fit_v1);
    expect(new Set(r.pairs.map((p) => pairKey(p.investigator_id, p.opportunity_id))).size).toBe(r.pairs.length);
    expect(r.shortfalls).toEqual([]);
    expect(r.pairs.map((p) => p.stratum)).toEqual([...Array(quotas.current).fill("current"), ...Array(quotas.adversarial).fill("adversarial"), ...Array(quotas.random).fill("random"), ...Array(quotas.dropped).fill("dropped"), ...Array(r.counts.fit_v1).fill("fit_v1")]);
  });

  it("is deterministic in the seed and moves with it", () => {
    const again = run(1);
    expect(again.pairs.map((p) => [p.investigator_id, p.opportunity_id, p.stratum])).toEqual(r.pairs.map((p) => [p.investigator_id, p.opportunity_id, p.stratum]));
    const other = run(2);
    expect(other.pairs.map((p) => pairKey(p.investigator_id, p.opportunity_id))).not.toEqual(r.pairs.map((p) => pairKey(p.investigator_id, p.opportunity_id)));
    expect(other.counts).toMatchObject(quotas);
  });

  it("current: only pairs the legacy engine shows (rank ≤ 5, Strong / Potential) or Outreach snapshots — Strong and Potential half each, nothing from fit-v1", () => {
    const current = r.pairs.filter((p) => p.stratum === "current");
    for (const p of current) {
      expect(currentBucketOf(p.signals)).toBe(p.source);
      expect(p.signals.outreach !== null || (p.signals.legacy_rank !== null && p.signals.legacy_rank <= LEGACY_SHOWN_TOP_N && (p.signals.legacy === "strong" || p.signals.legacy === "potential"))).toBe(true);
      expect(p.sources[0]).toBe(p.source);
    }
    const drawn = r.current.drawn;
    const strongSide = (drawn["outreach:strong"] ?? 0) + (drawn["legacy:strong"] ?? 0);
    const potentialSide = (drawn["outreach:potential"] ?? 0) + (drawn["legacy:potential"] ?? 0);
    expect(strongSide + potentialSide).toBe(quotas.current);
    expect(strongSide).toBe(quotas.current / 2);
    expect(Object.keys(drawn).some((k) => k.startsWith("fit_v1"))).toBe(false);
    expect(Object.keys(r.current.pool).sort()).toEqual(["legacy:potential", "legacy:strong", "outreach:potential", "outreach:strong"]);
    // Outreach snapshots come before the page rule inside a half.
    expect(drawn["outreach:strong"]).toBe(1);
    expect(drawn["outreach:potential"]).toBe(1);
  });

  it("current: a pair over the floor but behind the five shown is never Strong / Potential, so it cannot be drawn", () => {
    const behind = investigators.flatMap((i) => notices.map((n) => signals(i.id, n.id))).filter((s) => s.legacy_rank !== null && s.legacy_rank > LEGACY_SHOWN_TOP_N);
    expect(behind.length).toBeGreaterThan(0);
    for (const s of behind) {
      expect(s.legacy).toBe("not_shown");
      // …unless an Outreach snapshot shows it: the snapshot is its own surface.
      expect(currentBucketOf(s)).toBe(s.outreach ? `outreach:${s.outreach}` : null);
    }
    expect(behind.some((s) => s.outreach === null)).toBe(true);
  });

  it("current: the Strong half is filled from the Potential half when the legacy engine shows too few Strong pairs", () => {
    const few = stratifyGoldset({ investigators, notices, synthetic, signals: (i, o) => ({ ...signals(i, o), legacy: signals(i, o).legacy === "strong" ? "potential" : signals(i, o).legacy }) }, { seed: 1, quotas, forbidden });
    expect(few.current.drawn["outreach:strong"]).toBe(1);
    expect(few.current.drawn["legacy:strong"] ?? 0).toBe(0);
    expect(few.counts.current).toBe(quotas.current);
  });

  it("adversarial: every off-diagonal cell gets its share — real pairs where the roster can, synthetic pairs from the fixture where it cannot", () => {
    const adversarial = r.pairs.filter((p) => p.stratum === "adversarial");
    expect(adversarial.every((p) => p.cell.investigator !== p.cell.notice && p.cell.investigator !== "none" && p.cell.notice !== "none" && p.cell.investigator !== "cross_cutting")).toBe(true);
    expect(r.cells.covered).toHaveLength(30);
    expect(r.cells.uncovered).toEqual([]);
    expect(r.cells.synthetic).toBe(10);
    expect(r.cells.forbidden_total).toBe(8);
    expect(r.cells.forbidden_covered).toBe(8);
    for (const c of r.cells.covered) expect(c.pairs).toBe(1); // 30 pairs over 30 cells
    const real = adversarial.filter((p) => !p.synthetic);
    const syn = adversarial.filter((p) => p.synthetic);
    expect(real).toHaveLength(20);
    expect(syn).toHaveLength(10);
    const realCells = offDiagonalCells().filter((c) => investigators.some((i) => i.family === c.investigator) && notices.some((n) => n.family === c.notice));
    expect(r.cells.covered.filter((c) => !c.synthetic).map((c) => c.key).sort()).toEqual(realCells.map((c) => cellKey(c.investigator, c.notice)).sort());
    expect(r.cells.covered.filter((c) => c.synthetic).map((c) => c.key).sort()).toEqual(["health_systems->clinical", "health_systems->discovery", "health_systems->population", "health_systems->preclinical", "health_systems->translational", "population->clinical", "population->discovery", "population->health_systems", "population->preclinical", "population->translational"]);
    for (const p of syn) {
      expect(p.investigator_id.startsWith("synthetic:")).toBe(true);
      expect(p.synthetic_source).toBe(p.investigator_id.slice("synthetic:".length));
      expect(p.source).toBe(`synthetic:${p.synthetic_source}`);
      expect(p.sources).toEqual([`cell:${cellKey(p.cell.investigator, p.cell.notice)}`, p.source]);
      expect(p.signals).toEqual(SYNTHETIC_SIGNALS);
      expect(["population", "health_systems"]).toContain(p.cell.investigator);
    }
    expect(adversarial.filter((p) => p.forbidden)).toHaveLength(8);
    for (const p of real) expect(p.source).toBe(`cell:${cellKey(p.cell.investigator, p.cell.notice)}`);
    // A synthetic cell's candidates are the notices of the target family.
    expect(r.cells.covered.find((c) => c.key === "population->discovery")).toMatchObject({ synthetic: true, candidates: 2, forbidden: true });
  });

  it("adversarial: without synthetic investigators the ten cells stay uncovered and say why", () => {
    const none = stratifyGoldset({ investigators, notices, signals }, { seed: 1, quotas, forbidden });
    expect(none.cells.covered).toHaveLength(20);
    expect(none.cells.uncovered).toHaveLength(10);
    expect(none.cells.synthetic).toBe(0);
    for (const u of none.cells.uncovered) expect(u.reason).toMatch(/no investigator on the roster with dominant family (population|health_systems) and no synthetic investigator of that family/);
    expect(none.counts.adversarial).toBe(quotas.adversarial); // the real cells absorb the share (30 pairs over 20 cells)
    expect(none.pairs.filter((p) => p.synthetic)).toHaveLength(0);
  });

  it("adversarial: the remainder goes to the forbidden cells first", () => {
    const twelve = run(1, { ...quotas, adversarial: 12 });
    const withPair = twelve.cells.covered.filter((c) => c.pairs > 0);
    expect(withPair).toHaveLength(12);
    for (const c of twelve.cells.covered.filter((c) => c.forbidden)) expect(c.pairs).toBe(1);
    expect(twelve.pairs.filter((p) => p.stratum === "adversarial" && p.forbidden)).toHaveLength(8);
  });

  it("adversarial: within a real cell the highest legacy cosine comes first (the most confusable pair) — caps aside", () => {
    const uncapped = { per_investigator: Number.POSITIVE_INFINITY, per_notice: Number.POSITIVE_INFINITY };
    const big = stratifyGoldset({ investigators, notices, signals, synthetic }, { seed: 1, quotas: { ...quotas, adversarial: 60 }, forbidden, caps: { adversarial: uncapped } });
    const byCell = new Map<string, number[]>();
    for (const p of big.pairs.filter((p) => p.stratum === "adversarial" && !p.synthetic)) (byCell.get(cellKey(p.cell.investigator, p.cell.notice)) ?? byCell.set(cellKey(p.cell.investigator, p.cell.notice), []).get(cellKey(p.cell.investigator, p.cell.notice))!).push(p.signals.legacy_similarity ?? -1);
    let checked = 0;
    for (const sims of byCell.values()) {
      if (sims.length < 2) continue;
      checked += 1;
      expect(sims).toEqual([...sims].sort((a, b) => b - a));
    }
    expect(checked).toBeGreaterThan(0);
    expect(big.counts.adversarial).toBe(60);
  });

  it("random: pairs at or above the exploratory floor whatever their rank, not already drawn, at most two per investigator when the pool allows", () => {
    const random = r.pairs.filter((p) => p.stratum === "random");
    expect(random).toHaveLength(quotas.random);
    for (const p of random) {
      expect(aboveLegacyFloor(p.signals.legacy_similarity)).toBe(true);
      expect(p.source).toBe("random");
    }
    const per = new Map<string, number>();
    for (const p of random) per.set(p.investigator_id, (per.get(p.investigator_id) ?? 0) + 1);
    expect(Math.max(...per.values())).toBeLessThanOrEqual(2);
    expect(r.random.pool).toBeGreaterThan(quotas.random);
    // The pool includes pairs behind the five shown (over the floor, "not_shown").
    const pool = investigators.flatMap((i) => notices.map((n) => signals(i.id, n.id))).filter((s) => aboveLegacyFloor(s.legacy_similarity));
    expect(pool.some((s) => s.legacy === "not_shown")).toBe(true);
  });

  it("dropped: one pair per investigator from the thinnest up, under the floor and fit-v1 Poor or no row, the own-family notice first then the highest cosine under the floor", () => {
    const dropped = r.pairs.filter((p) => p.stratum === "dropped");
    expect(dropped).toHaveLength(quotas.dropped);
    for (const p of dropped) {
      expect(aboveLegacyFloor(p.signals.legacy_similarity)).toBe(false);
      expect(p.signals.legacy).toBe("dropped");
      expect(p.signals.fit_v1 === null || p.signals.fit_v1 === "poor").toBe(true);
      expect(p.source).toBe("thin");
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

  it("fit_v1: every stored Strong / Moderate pair not drawn above, appended after the spec strata, Strong first then id order", () => {
    const fit = r.pairs.filter((p) => p.stratum === "fit_v1");
    const all = investigators.flatMap((i) => notices.map((n) => ({ i: i.id, n: n.id, s: signals(i.id, n.id) }))).filter((x) => x.s.fit_v1 === "strong" || x.s.fit_v1 === "moderate");
    expect(r.fit_v1.pool).toEqual({ "fit_v1:strong": 0, "fit_v1:moderate": all.length });
    expect(r.fit_v1.drawn_elsewhere + r.fit_v1.supplementary).toBe(all.length);
    expect(fit).toHaveLength(r.fit_v1.supplementary);
    const drawnBefore = new Set(r.pairs.filter((p) => p.stratum !== "fit_v1").map((p) => pairKey(p.investigator_id, p.opportunity_id)));
    expect(all.filter((x) => !drawnBefore.has(pairKey(x.i, x.n))).map((x) => pairKey(x.i, x.n))).toEqual(fit.map((p) => pairKey(p.investigator_id, p.opportunity_id)));
    for (const p of fit) {
      expect(p.source).toBe(`fit_v1:${p.signals.fit_v1}`);
      expect(p.sources[0]).toBe(p.source);
    }
    // A fit-v1 Moderate pair the legacy engine also shows is drawn into "current" and not appended again.
    const overlap = stratifyGoldset({ investigators, notices, synthetic, signals: (i, o) => ({ ...signals(i, o), fit_v1: i === "i-clin-1" && o === "n-clin-1" ? "moderate" : signals(i, o).fit_v1 }) }, { seed: 1, quotas, forbidden });
    expect(overlap.fit_v1.drawn_elsewhere).toBe(r.fit_v1.drawn_elsewhere + 1);
    expect(overlap.pairs.filter((p) => p.investigator_id === "i-clin-1" && p.opportunity_id === "n-clin-1").map((p) => [p.stratum, p.sources])).toEqual([["current", ["outreach:strong", "fit_v1:moderate"]]]);
  });

  it("reports a shortfall instead of throwing when a pool is too small", () => {
    const short = run(1, { ...quotas, current: 500 });
    expect(short.counts.current).toBeLessThan(500);
    expect(short.shortfalls[0]).toMatch(/^current: \d+ of 500 — the legacy engine shows fewer/);
    expect(short.counts.adversarial + short.counts.random + short.counts.dropped).toBeGreaterThan(0);
  });
});
