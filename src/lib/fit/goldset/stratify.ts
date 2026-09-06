/**
 * The stratified gold set (plan § PR 2.4; spec §14 "Gold set"): 200
 * investigator–notice pairs in four strata, drawn deterministically from a
 * seed over what the two current engines say about every scoreable pair.
 *
 *   current      80   what the current engines label Strong / Potential —
 *                     the fit-v1 side (stored `fit_results` Strong / Moderate)
 *                     and the legacy side (stored `outreach_suggestions`
 *                     Strong / Potential snapshots, then the investigator
 *                     page's cosine rule over stored vectors), half each with
 *                     the shortfall of one side filled from the other; Strong
 *                     buckets before Potential / Moderate, seeded order inside
 *                     a bucket
 *   adversarial  60   constructed from real profiles as in §13: for every
 *                     off-diagonal cell of the family matrix that the roster
 *                     and the corpus can fill (investigator dominant family ×
 *                     notice required family), the pairs the legacy engine
 *                     likes most — highest document cosine first — i.e. the
 *                     same-topic, different-kind pairs the redesign must
 *                     reject; the quota is spread evenly over the coverable
 *                     cells with the remainder to the forbidden cells first
 *   random       40   a seeded sample of the pairs at or above the current
 *                     exploratory floor (`SIM.exploratory` on the document
 *                     cosine) not drawn above
 *   dropped      20   pairs both engines drop (legacy below the floor or
 *                     without a vector; fit-v1 Poor or no row), one per
 *                     investigator in order of evidence thinness (fewest
 *                     items, then lowest paradigm confidence), the notice
 *                     preferring the investigator's own family and the highest
 *                     cosine under the floor — the recall check
 *
 * Caps keep one person or one notice from dominating a stratum; a capped
 * pass is followed by an uncapped one so a thin pool still fills its quota
 * when it can. Cells the roster cannot fill (today: no population or
 * health-systems investigator on the ImmunoX roster, D1) are reported as
 * uncovered with the reason. Pure; the signals come in as a function so the
 * caller computes them lazily.
 */
import type { SuggestionTier } from "@/lib/outreach/types";
import { cellKey, isMatrixFamilySlot, offDiagonalCells, type FamilyCell, type FamilySlot } from "@/lib/fit/goldset/families";
import type { LegacyTier } from "@/lib/fit/goldset/legacy";
import { MATRIX_FAMILY_IDS } from "@/lib/fit/taxonomy";
import type { Confidence, Tier } from "@/lib/fit/types";

export type Stratum = "current" | "adversarial" | "random" | "dropped";
export const STRATA: readonly Stratum[] = ["current", "adversarial", "random", "dropped"];

export const STRATUM_LABEL: Record<Stratum, string> = {
  current: "Current engines Strong / Potential",
  adversarial: "Adversarial (off-diagonal family cell)",
  random: "Random above the exploratory floor",
  dropped: "Dropped by both engines (thin evidence)",
};

export type Quotas = Record<Stratum, number>;

/** Spec §14: 80 + 60 + 40 + 20 = 200. */
export const GOLDSET_QUOTAS: Quotas = { current: 80, adversarial: 60, random: 40, dropped: 20 };

export type StratifyInvestigator = {
  id: string;
  family: FamilySlot;
  item_count: number;
  paradigm_confidence: Confidence;
  pending_items: number;
};

export type StratifyNotice = {
  id: string;
  family: FamilySlot;
};

export type PairSignals = {
  legacy: LegacyTier;
  legacy_similarity: number | null;
  /** The stored `fit_results` tier; null = no row (not a candidate, or the table is not on the database). */
  fit_v1: Tier | null;
  /** The stored `outreach_suggestions` snapshot tier (active or added rows); null when the notice is not on an Outreach item for this person. */
  outreach: SuggestionTier | null;
};

export type StratifyInput = {
  investigators: readonly StratifyInvestigator[];
  notices: readonly StratifyNotice[];
  signals: (investigatorId: string, opportunityId: string) => PairSignals;
};

export type Caps = { per_investigator: number; per_notice: number };

export type StratifyOptions = {
  seed: number;
  quotas?: Partial<Quotas>;
  caps?: Partial<Record<Stratum, Caps>>;
  /** Forbidden family cells (engine/fixtures.ts `forbiddenCellPairs()`), for the remainder rule and the report. */
  forbidden?: ReadonlyArray<readonly [string, string]>;
};

export const DEFAULT_CAPS: Record<Stratum, Caps> = {
  current: { per_investigator: 5, per_notice: 8 },
  adversarial: { per_investigator: 3, per_notice: 3 },
  random: { per_investigator: 2, per_notice: 2 },
  dropped: { per_investigator: 1, per_notice: 2 },
};

export type GoldPairDraft = {
  investigator_id: string;
  opportunity_id: string;
  stratum: Stratum;
  cell: { investigator: FamilySlot; notice: FamilySlot };
  forbidden: boolean;
  /** Why the pair is in its stratum: "fit_v1:moderate", "outreach:strong", "legacy:potential", "cell:discovery->population", "thin:3 items" … */
  sources: string[];
  signals: PairSignals;
};

export type CellReport = { cell: FamilyCell; key: string; forbidden: boolean; candidates: number; pairs: number };

export type StratifyResult = {
  pairs: GoldPairDraft[];
  quotas: Quotas;
  counts: Record<Stratum, number>;
  current: { pool: Record<string, number>; drawn: Record<string, number> };
  cells: { covered: CellReport[]; uncovered: Array<CellReport & { reason: string }>; forbidden_total: number; forbidden_covered: number };
  random: { pool: number };
  dropped: { investigators: Array<{ id: string; item_count: number; paradigm_confidence: Confidence; pairs: number }> };
  shortfalls: string[];
};

// ---------------------------------------------------------------------------
// Seeded randomness
// ---------------------------------------------------------------------------

/** mulberry32: a small deterministic PRNG in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates over a copy, driven by `rng`. */
export function seededShuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const pairKey = (investigatorId: string, opportunityId: string) => `${investigatorId}|${opportunityId}`;

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

/** Higher similarity first, null last, then ids. */
function bySimilarityDesc(a: GoldPairDraft, b: GoldPairDraft): number {
  const sa = a.signals.legacy_similarity;
  const sb = b.signals.legacy_similarity;
  if (sa === null && sb !== null) return 1;
  if (sb === null && sa !== null) return -1;
  if (sa !== null && sb !== null && sa !== sb) return sb - sa;
  return byId(a.investigator_id, b.investigator_id) || byId(a.opportunity_id, b.opportunity_id);
}

type Ledger = { taken: Set<string>; perInvestigator: Map<string, number>; perNotice: Map<string, number> };

const newLedger = (taken: Set<string>): Ledger => ({ taken, perInvestigator: new Map(), perNotice: new Map() });

/** Take up to `n` from `candidates` in order: a pass under `caps`, then an uncapped pass for what is left. Never a pair already taken. */
function drawWithCaps(candidates: readonly GoldPairDraft[], n: number, caps: Caps, ledger: Ledger): GoldPairDraft[] {
  const out: GoldPairDraft[] = [];
  const take = (p: GoldPairDraft) => {
    ledger.taken.add(pairKey(p.investigator_id, p.opportunity_id));
    ledger.perInvestigator.set(p.investigator_id, (ledger.perInvestigator.get(p.investigator_id) ?? 0) + 1);
    ledger.perNotice.set(p.opportunity_id, (ledger.perNotice.get(p.opportunity_id) ?? 0) + 1);
    out.push(p);
  };
  for (const capped of [true, false]) {
    for (const p of candidates) {
      if (out.length >= n) break;
      if (ledger.taken.has(pairKey(p.investigator_id, p.opportunity_id))) continue;
      if (capped && ((ledger.perInvestigator.get(p.investigator_id) ?? 0) >= caps.per_investigator || (ledger.perNotice.get(p.opportunity_id) ?? 0) >= caps.per_notice)) continue;
      take(p);
    }
  }
  return out;
}

function draft(inv: StratifyInvestigator, notice: StratifyNotice, stratum: Stratum, signals: PairSignals, sources: string[], forbidden: Set<string>): GoldPairDraft {
  return {
    investigator_id: inv.id,
    opportunity_id: notice.id,
    stratum,
    cell: { investigator: inv.family, notice: notice.family },
    forbidden: forbidden.has(cellKey(inv.family, notice.family)),
    sources,
    signals,
  };
}

const countBy = (pairs: readonly GoldPairDraft[], key: (p: GoldPairDraft) => string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const p of pairs) out[key(p)] = (out[key(p)] ?? 0) + 1;
  return out;
};

// ---------------------------------------------------------------------------
// The draw
// ---------------------------------------------------------------------------

/** The bucket order of the "current" stratum: the fit-v1 side and the legacy side, Strong before Potential / Moderate. */
export const CURRENT_BUCKETS = { fit: ["fit_v1:strong", "fit_v1:moderate"], legacy: ["outreach:strong", "legacy:strong", "outreach:potential", "legacy:potential"] } as const;

export function currentBucketsOf(s: PairSignals): { fit: string | null; legacy: string | null } {
  const fit = s.fit_v1 === "strong" || s.fit_v1 === "moderate" ? `fit_v1:${s.fit_v1}` : null;
  let legacy: string | null = null;
  if (s.outreach === "strong") legacy = "outreach:strong";
  else if (s.legacy === "strong") legacy = "legacy:strong";
  else if (s.outreach === "potential") legacy = "outreach:potential";
  else if (s.legacy === "potential") legacy = "legacy:potential";
  return { fit, legacy };
}

/** Pure, deterministic in `seed`. Draws the four strata (see the module note). */
export function stratifyGoldset(input: StratifyInput, options: StratifyOptions): StratifyResult {
  const quotas: Quotas = { ...GOLDSET_QUOTAS, ...(options.quotas ?? {}) };
  const caps = { ...DEFAULT_CAPS, ...(options.caps ?? {}) } as Record<Stratum, Caps>;
  const forbidden = new Set((options.forbidden ?? []).map(([a, b]) => cellKey(a, b)));
  const rng = mulberry32(options.seed);
  const investigators = [...input.investigators].sort((a, b) => byId(a.id, b.id));
  const notices = [...input.notices].sort((a, b) => byId(a.id, b.id));
  const shortfalls: string[] = [];
  const taken = new Set<string>();
  const pairs: GoldPairDraft[] = [];

  // Every scoreable pair with its signals, id order (the grid).
  const grid: Array<{ inv: StratifyInvestigator; notice: StratifyNotice; signals: PairSignals }> = [];
  for (const inv of investigators) for (const notice of notices) grid.push({ inv, notice, signals: input.signals(inv.id, notice.id) });

  // 1 · current: the two engines' Strong / Potential.
  const buckets = new Map<string, GoldPairDraft[]>();
  for (const g of grid) {
    const b = currentBucketsOf(g.signals);
    const sources = [b.fit, b.legacy].filter((x): x is string => Boolean(x));
    if (b.fit) (buckets.get(b.fit) ?? buckets.set(b.fit, []).get(b.fit)!).push(draft(g.inv, g.notice, "current", g.signals, sources, forbidden));
    if (b.legacy) (buckets.get(b.legacy) ?? buckets.set(b.legacy, []).get(b.legacy)!).push(draft(g.inv, g.notice, "current", g.signals, sources, forbidden));
  }
  const pool: Record<string, number> = {};
  const ordered = (names: readonly string[]) => names.flatMap((n) => seededShuffle(buckets.get(n) ?? [], rng));
  for (const n of [...CURRENT_BUCKETS.fit, ...CURRENT_BUCKETS.legacy]) pool[n] = buckets.get(n)?.length ?? 0;
  const fitSide = ordered(CURRENT_BUCKETS.fit);
  const legacySide = ordered(CURRENT_BUCKETS.legacy);
  const half = Math.floor(quotas.current / 2);
  const ledgerCurrent = newLedger(taken);
  const drawnFit = drawWithCaps(fitSide, half, caps.current, ledgerCurrent);
  const drawnLegacy = drawWithCaps(legacySide, quotas.current - drawnFit.length, caps.current, ledgerCurrent);
  const drawnFitMore = drawWithCaps(fitSide, quotas.current - drawnFit.length - drawnLegacy.length, caps.current, ledgerCurrent);
  const current = [...drawnFit, ...drawnFitMore, ...drawnLegacy];
  if (current.length < quotas.current) shortfalls.push(`current: ${current.length} of ${quotas.current} — the engines label fewer Strong / Potential pairs than the quota`);
  pairs.push(...current);
  const drawn = countBy(current, (p) => {
    const b = currentBucketsOf(p.signals);
    return drawnFit.includes(p) || drawnFitMore.includes(p) ? b.fit! : b.legacy!;
  });

  // 2 · adversarial: every off-diagonal cell the roster and corpus can fill.
  const cellCandidates = new Map<string, GoldPairDraft[]>();
  for (const g of grid) {
    if (!isMatrixFamilySlot(g.inv.family) || !isMatrixFamilySlot(g.notice.family) || g.inv.family === g.notice.family) continue;
    if (taken.has(pairKey(g.inv.id, g.notice.id))) continue;
    const key = cellKey(g.inv.family, g.notice.family);
    (cellCandidates.get(key) ?? cellCandidates.set(key, []).get(key)!).push(draft(g.inv, g.notice, "adversarial", g.signals, [`cell:${key}`], forbidden));
  }
  for (const list of cellCandidates.values()) list.sort(bySimilarityDesc);
  const cells = offDiagonalCells().map((cell) => ({ cell, key: cellKey(cell.investigator, cell.notice), forbidden: forbidden.has(cellKey(cell.investigator, cell.notice)) }));
  const coverable = cells.filter((c) => (cellCandidates.get(c.key)?.length ?? 0) > 0);
  // Forbidden cells first in the allocation order so the remainder lands on them.
  const allocationOrder = [...coverable.filter((c) => c.forbidden), ...coverable.filter((c) => !c.forbidden)];
  const allocation = new Map<string, number>();
  if (coverable.length) {
    const base = Math.floor(quotas.adversarial / coverable.length);
    let extra = quotas.adversarial - base * coverable.length;
    for (const c of allocationOrder) {
      allocation.set(c.key, base + (extra > 0 ? 1 : 0));
      if (extra > 0) extra -= 1;
    }
  }
  const ledgerAdv = newLedger(taken);
  const perCell = new Map<string, GoldPairDraft[]>();
  const adversarial: GoldPairDraft[] = [];
  for (const c of allocationOrder) {
    const got = drawWithCaps(cellCandidates.get(c.key) ?? [], allocation.get(c.key) ?? 0, caps.adversarial, ledgerAdv);
    perCell.set(c.key, got);
    adversarial.push(...got);
  }
  // Cells that could not fill their share hand it to the cells with candidates left, one at a time, forbidden first.
  let remaining = quotas.adversarial - adversarial.length;
  let progress = true;
  while (remaining > 0 && progress) {
    progress = false;
    for (const c of allocationOrder) {
      if (remaining <= 0) break;
      const got = drawWithCaps(cellCandidates.get(c.key) ?? [], 1, caps.adversarial, ledgerAdv);
      if (got.length) {
        perCell.get(c.key)!.push(...got);
        adversarial.push(...got);
        remaining -= 1;
        progress = true;
      }
    }
  }
  if (adversarial.length < quotas.adversarial) shortfalls.push(`adversarial: ${adversarial.length} of ${quotas.adversarial} — the coverable cells hold too few pairs`);
  pairs.push(...adversarial);
  const familyPresent = (f: string, side: "investigator" | "notice") => (side === "investigator" ? investigators : notices).some((x) => x.family === f);
  const covered: CellReport[] = coverable.map((c) => ({ ...c, candidates: cellCandidates.get(c.key)?.length ?? 0, pairs: perCell.get(c.key)?.length ?? 0 }));
  const uncovered = cells
    .filter((c) => !coverable.includes(c))
    .map((c) => ({
      ...c,
      candidates: 0,
      pairs: 0,
      reason: !familyPresent(c.cell.investigator, "investigator")
        ? `no investigator on the roster with dominant family ${c.cell.investigator}`
        : !familyPresent(c.cell.notice, "notice")
          ? `no open notice requiring family ${c.cell.notice}`
          : "every pair in the cell was already drawn",
    }));

  // 3 · random above the current exploratory floor.
  const randomPool = grid.filter((g) => g.signals.legacy !== "dropped" && !taken.has(pairKey(g.inv.id, g.notice.id))).map((g) => draft(g.inv, g.notice, "random", g.signals, [`legacy:${g.signals.legacy}`], forbidden));
  const random = drawWithCaps(seededShuffle(randomPool, rng), quotas.random, caps.random, newLedger(taken));
  if (random.length < quotas.random) shortfalls.push(`random: ${random.length} of ${quotas.random} — too few pairs above the exploratory floor`);
  pairs.push(...random);

  // 4 · dropped by both engines, thinnest investigators first.
  const thinness = (a: StratifyInvestigator, b: StratifyInvestigator) => a.item_count - b.item_count || CONFIDENCE_RANK[a.paradigm_confidence] - CONFIDENCE_RANK[b.paradigm_confidence] || b.pending_items - a.pending_items || byId(a.id, b.id);
  const thin = [...investigators].sort(thinness);
  const droppedFor = (inv: StratifyInvestigator): GoldPairDraft[] =>
    grid
      .filter((g) => g.inv.id === inv.id && g.signals.legacy === "dropped" && (g.signals.fit_v1 === null || g.signals.fit_v1 === "poor") && !taken.has(pairKey(g.inv.id, g.notice.id)))
      .map((g) => draft(g.inv, g.notice, "dropped", g.signals, [`thin:${inv.item_count} items, paradigm ${inv.paradigm_confidence}`, `legacy:dropped`, `fit_v1:${g.signals.fit_v1 ?? "no row"}`], forbidden))
      .sort((a, b) => {
        const sameA = isMatrixFamilySlot(inv.family) && a.cell.notice === inv.family ? 0 : 1;
        const sameB = isMatrixFamilySlot(inv.family) && b.cell.notice === inv.family ? 0 : 1;
        return sameA - sameB || bySimilarityDesc(a, b);
      });
  const ledgerDropped = newLedger(taken);
  const dropped: GoldPairDraft[] = [];
  const usedInvestigators = new Map<string, number>();
  for (let round = 0; round < 3 && dropped.length < quotas.dropped; round += 1) {
    for (const inv of thin) {
      if (dropped.length >= quotas.dropped) break;
      if ((usedInvestigators.get(inv.id) ?? 0) > round) continue;
      const got = drawWithCaps(droppedFor(inv), 1, { per_investigator: Number.POSITIVE_INFINITY, per_notice: caps.dropped.per_notice }, ledgerDropped);
      if (!got.length) continue;
      usedInvestigators.set(inv.id, (usedInvestigators.get(inv.id) ?? 0) + 1);
      dropped.push(...got);
    }
  }
  if (dropped.length < quotas.dropped) shortfalls.push(`dropped: ${dropped.length} of ${quotas.dropped} — too few pairs both engines drop`);
  pairs.push(...dropped);

  const counts = { current: current.length, adversarial: adversarial.length, random: random.length, dropped: dropped.length };
  return {
    pairs,
    quotas,
    counts,
    current: { pool, drawn },
    cells: { covered, uncovered, forbidden_total: cells.filter((c) => c.forbidden).length, forbidden_covered: covered.filter((c) => c.forbidden).length },
    random: { pool: randomPool.length },
    dropped: { investigators: thin.filter((i) => usedInvestigators.has(i.id)).map((i) => ({ id: i.id, item_count: i.item_count, paradigm_confidence: i.paradigm_confidence, pairs: usedInvestigators.get(i.id) ?? 0 })) },
    shortfalls,
  };
}

/** The matrix families, for reports. */
export const FAMILY_ORDER = MATRIX_FAMILY_IDS;
