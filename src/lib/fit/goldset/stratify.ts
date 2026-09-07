/**
 * The stratified gold set (plan § PR 2.4; spec §14 "Gold set"): 200
 * investigator–notice pairs in four strata plus a supplementary one, drawn
 * deterministically from a seed over what the current engines say about
 * every scoreable pair.
 *
 *   current      80   what the legacy engine shows — the investigator page's
 *                     top 5 (goldset/legacy.ts: rank ≤ 5 in the window,
 *                     tiered Strong / Potential) and the stored
 *                     `outreach_suggestions` Strong / Potential snapshots —
 *                     Strong and Potential half each, the shortfall of one
 *                     half filled from the other, Outreach snapshots before
 *                     the page rule inside a half, seeded order inside a
 *                     bucket
 *   adversarial  60   constructed from real profiles as in §13: for every
 *                     off-diagonal cell of the family matrix (investigator
 *                     dominant family × notice required family), two pairs;
 *                     in a cell the roster can fill, the pairs the legacy
 *                     engine likes most — highest document cosine first —
 *                     i.e. the same-topic, different-kind pairs the redesign
 *                     must reject; in a cell no real investigator can fill
 *                     (today: population and health-systems investigators,
 *                     D1), a SYNTHETIC investigator hydrated from the
 *                     adversarial fixture (case 2 = population, case 7a =
 *                     health systems) against seeded real notices of the
 *                     target family, flagged `synthetic`; the quota is spread
 *                     evenly with the remainder to the forbidden cells first
 *   random       40   a seeded sample of the pairs at or above the current
 *                     exploratory floor (`SIM.exploratory` on the document
 *                     cosine, whatever the rank) not drawn above
 *   dropped      20   pairs both engines drop (legacy under the floor or
 *                     without a vector — a snapshot: the live page embeds a
 *                     missing investigator lazily when OPENAI_API_KEY is set —
 *                     or fit-v1 Poor or no row), one per
 *                     investigator in order of evidence thinness (fewest
 *                     items, then lowest paradigm confidence), the notice
 *                     preferring the investigator's own family and then the
 *                     HIGHEST cosine under the floor — deterministic, not
 *                     seeded: the pair each engine came closest to keeping —
 *                     the recall check
 *   fit_v1        ∞   supplementary, appended after the 200: every stored
 *                     `fit_results` Strong / Moderate pair not drawn above
 *                     (the new engine's own list, so its precision is
 *                     measured on all of it — 28 pairs today)
 *
 * Caps keep one person or one notice from dominating a stratum; a capped
 * pass is followed by an uncapped one so a thin pool still fills its quota
 * when it can. Cells neither the roster nor the synthetic investigators can
 * fill are reported as uncovered with the reason. Pure; the signals come in
 * as a function so the caller computes them lazily.
 */
import type { SuggestionTier } from "@/lib/outreach/types";
import { cellKey, isMatrixFamilySlot, offDiagonalCells, type FamilyCell, type FamilySlot } from "@/lib/fit/goldset/families";
import { aboveLegacyFloor, type LegacyTier } from "@/lib/fit/goldset/legacy";
import { MATRIX_FAMILY_IDS } from "@/lib/fit/taxonomy";
import type { Confidence, Tier } from "@/lib/fit/types";

/** The spec's four strata (§14), with quotas. */
export type SpecStratum = "current" | "adversarial" | "random" | "dropped";
export const SPEC_STRATA: readonly SpecStratum[] = ["current", "adversarial", "random", "dropped"];

/** The four plus the supplementary fit-v1 stratum. */
export type Stratum = SpecStratum | "fit_v1";
export const STRATA: readonly Stratum[] = [...SPEC_STRATA, "fit_v1"];

export const STRATUM_LABEL: Record<Stratum, string> = {
  current: "Legacy engine Strong / Potential (page-shown or Outreach snapshot)",
  adversarial: "Adversarial (off-diagonal family cell)",
  random: "Random above the exploratory floor",
  dropped: "Dropped by both engines (thin evidence)",
  fit_v1: "fit-v1 Strong / Moderate (supplementary)",
};

export type Quotas = Record<SpecStratum, number>;

/** Spec §14: 80 + 60 + 40 + 20 = 200. The fit_v1 stratum has no quota: every remaining pair. */
export const GOLDSET_QUOTAS: Quotas = { current: 80, adversarial: 60, random: 40, dropped: 20 };

export type StratifyInvestigator = {
  id: string;
  family: FamilySlot;
  item_count: number;
  paradigm_confidence: Confidence;
  pending_items: number;
};

/** A synthetic investigator (goldset/synthetic.ts): fills the adversarial cells no real investigator can; `source` is the fixture case. */
export type SyntheticStratifyInvestigator = { id: string; family: FamilySlot; source: string };

export type StratifyNotice = {
  id: string;
  family: FamilySlot;
};

export type PairSignals = {
  legacy: LegacyTier;
  legacy_similarity: number | null;
  /** The pair's rank in the investigator page's window (1-based); null outside the top hits or without a vector. */
  legacy_rank: number | null;
  /** The stored `fit_results` tier; null = no row (not a candidate, or the table is not on the database). */
  fit_v1: Tier | null;
  /** The stored `outreach_suggestions` snapshot tier (active or added rows); null when the notice is not on an Outreach item for this person. */
  outreach: SuggestionTier | null;
};

/** What a synthetic pair carries: no vector, no stored row. */
export const SYNTHETIC_SIGNALS: PairSignals = { legacy: "dropped", legacy_similarity: null, legacy_rank: null, fit_v1: null, outreach: null };

export type StratifyInput = {
  investigators: readonly StratifyInvestigator[];
  notices: readonly StratifyNotice[];
  signals: (investigatorId: string, opportunityId: string) => PairSignals;
  synthetic?: readonly SyntheticStratifyInvestigator[];
};

export type Caps = { per_investigator: number; per_notice: number };

export type StratifyOptions = {
  seed: number;
  quotas?: Partial<Quotas>;
  caps?: Partial<Record<SpecStratum, Caps>>;
  /** Forbidden family cells (engine/fixtures.ts `forbiddenCellPairs()`), for the remainder rule and the report. */
  forbidden?: ReadonlyArray<readonly [string, string]>;
};

export const DEFAULT_CAPS: Record<SpecStratum, Caps> = {
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
  /** Built from the adversarial fixture, not the roster. */
  synthetic: boolean;
  /** The fixture case behind a synthetic pair; null otherwise. */
  synthetic_source: string | null;
  /** The bucket the pair was drawn from: "outreach:strong", "legacy:potential", "cell:discovery->population", "synthetic:<case>", "random", "thin", "fit_v1:moderate". */
  source: string;
  /** Why the pair is in its stratum, for information: the draw bucket plus what the other engine said ("fit_v1:moderate", "legacy:strong", "thin:3 items" …). */
  sources: string[];
  signals: PairSignals;
};

export type CellReport = { cell: FamilyCell; key: string; forbidden: boolean; synthetic: boolean; candidates: number; pairs: number };

export type StratifyResult = {
  pairs: GoldPairDraft[];
  quotas: Quotas;
  counts: Record<Stratum, number>;
  current: { pool: Record<string, number>; drawn: Record<string, number> };
  cells: { covered: CellReport[]; uncovered: Array<CellReport & { reason: string }>; forbidden_total: number; forbidden_covered: number; synthetic: number };
  random: { pool: number };
  dropped: { investigators: Array<{ id: string; item_count: number; paradigm_confidence: Confidence; pairs: number }> };
  fit_v1: { pool: Record<string, number>; drawn_elsewhere: number; supplementary: number };
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

/** Synthetic investigator ids: `synthetic:<fixture case id>` — never a roster UUID; a `fit_labels` row for such a pair keeps the case id in `synthetic_source`. */
export const SYNTHETIC_PREFIX = "synthetic:";
export const isSyntheticId = (id: string): boolean => id.startsWith(SYNTHETIC_PREFIX);
export const syntheticSourceOf = (id: string): string | null => (isSyntheticId(id) ? id.slice(SYNTHETIC_PREFIX.length) : null);

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

const UNCAPPED = Number.POSITIVE_INFINITY;

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

type DraftArgs = { inv: { id: string; family: FamilySlot }; notice: StratifyNotice; stratum: Stratum; signals: PairSignals; source: string; sources: string[]; forbidden: Set<string>; synthetic_source?: string | null };

function draft(a: DraftArgs): GoldPairDraft {
  return {
    investigator_id: a.inv.id,
    opportunity_id: a.notice.id,
    stratum: a.stratum,
    cell: { investigator: a.inv.family, notice: a.notice.family },
    forbidden: a.forbidden.has(cellKey(a.inv.family, a.notice.family)),
    synthetic: Boolean(a.synthetic_source),
    synthetic_source: a.synthetic_source ?? null,
    source: a.source,
    sources: a.sources,
    signals: a.signals,
  };
}

const countBy = (pairs: readonly GoldPairDraft[], key: (p: GoldPairDraft) => string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const p of pairs) out[key(p)] = (out[key(p)] ?? 0) + 1;
  return out;
};

/** What fit-v1 says, for the information list: "fit_v1:moderate" or null. */
const fitNote = (s: PairSignals): string | null => (s.fit_v1 === "strong" || s.fit_v1 === "moderate" ? `fit_v1:${s.fit_v1}` : null);

// ---------------------------------------------------------------------------
// The draw
// ---------------------------------------------------------------------------

/** The bucket order of the "current" stratum: the Strong half and the Potential half, Outreach snapshots before the page rule. */
export const CURRENT_BUCKETS = { strong: ["outreach:strong", "legacy:strong"], potential: ["outreach:potential", "legacy:potential"] } as const;

/** Pure. The legacy bucket a pair falls in (the best one that applies), or null when the legacy engine shows it nowhere. */
export function currentBucketOf(s: PairSignals): string | null {
  if (s.outreach === "strong") return "outreach:strong";
  if (s.legacy === "strong") return "legacy:strong";
  if (s.outreach === "potential") return "outreach:potential";
  if (s.legacy === "potential") return "legacy:potential";
  return null;
}

/** Pure, deterministic in `seed`. Draws the strata (see the module note). */
export function stratifyGoldset(input: StratifyInput, options: StratifyOptions): StratifyResult {
  const quotas: Quotas = { ...GOLDSET_QUOTAS, ...(options.quotas ?? {}) };
  const caps = { ...DEFAULT_CAPS, ...(options.caps ?? {}) } as Record<SpecStratum, Caps>;
  const forbidden = new Set((options.forbidden ?? []).map(([a, b]) => cellKey(a, b)));
  const rng = mulberry32(options.seed);
  const investigators = [...input.investigators].sort((a, b) => byId(a.id, b.id));
  const notices = [...input.notices].sort((a, b) => byId(a.id, b.id));
  const synthetic = [...(input.synthetic ?? [])].sort((a, b) => byId(a.id, b.id));
  const shortfalls: string[] = [];
  const taken = new Set<string>();
  const pairs: GoldPairDraft[] = [];

  // Every scoreable pair with its signals, id order (the grid).
  const grid: Array<{ inv: StratifyInvestigator; notice: StratifyNotice; signals: PairSignals }> = [];
  for (const inv of investigators) for (const notice of notices) grid.push({ inv, notice, signals: input.signals(inv.id, notice.id) });

  // 1 · current: what the legacy engine shows, Strong and Potential half each.
  const buckets = new Map<string, GoldPairDraft[]>();
  for (const g of grid) {
    const b = currentBucketOf(g.signals);
    if (!b) continue;
    const sources = [b, fitNote(g.signals)].filter((x): x is string => Boolean(x));
    (buckets.get(b) ?? buckets.set(b, []).get(b)!).push(draft({ inv: g.inv, notice: g.notice, stratum: "current", signals: g.signals, source: b, sources, forbidden }));
  }
  const pool: Record<string, number> = {};
  const ordered = (names: readonly string[]) => names.flatMap((n) => seededShuffle(buckets.get(n) ?? [], rng));
  for (const n of [...CURRENT_BUCKETS.strong, ...CURRENT_BUCKETS.potential]) pool[n] = buckets.get(n)?.length ?? 0;
  const strongSide = ordered(CURRENT_BUCKETS.strong);
  const potentialSide = ordered(CURRENT_BUCKETS.potential);
  const half = Math.floor(quotas.current / 2);
  const ledgerCurrent = newLedger(taken);
  const drawnStrong = drawWithCaps(strongSide, half, caps.current, ledgerCurrent);
  const drawnPotential = drawWithCaps(potentialSide, quotas.current - drawnStrong.length, caps.current, ledgerCurrent);
  const drawnStrongMore = drawWithCaps(strongSide, quotas.current - drawnStrong.length - drawnPotential.length, caps.current, ledgerCurrent);
  const current = [...drawnStrong, ...drawnStrongMore, ...drawnPotential];
  if (current.length < quotas.current) shortfalls.push(`current: ${current.length} of ${quotas.current} — the legacy engine shows fewer Strong / Potential pairs than the quota`);
  pairs.push(...current);
  const drawn = countBy(current, (p) => p.source);

  // 2 · adversarial: every off-diagonal cell, real pairs where the roster can, synthetic where it cannot.
  const cellCandidates = new Map<string, GoldPairDraft[]>();
  for (const g of grid) {
    if (!isMatrixFamilySlot(g.inv.family) || !isMatrixFamilySlot(g.notice.family) || g.inv.family === g.notice.family) continue;
    if (taken.has(pairKey(g.inv.id, g.notice.id))) continue;
    const key = cellKey(g.inv.family, g.notice.family);
    const sources = [`cell:${key}`, `legacy:${g.signals.legacy}`, fitNote(g.signals)].filter((x): x is string => Boolean(x));
    (cellCandidates.get(key) ?? cellCandidates.set(key, []).get(key)!).push(draft({ inv: g.inv, notice: g.notice, stratum: "adversarial", signals: g.signals, source: `cell:${key}`, sources, forbidden }));
  }
  for (const list of cellCandidates.values()) list.sort(bySimilarityDesc);
  const syntheticByFamily = new Map<string, SyntheticStratifyInvestigator>();
  for (const s of synthetic) if (!syntheticByFamily.has(s.family)) syntheticByFamily.set(s.family, s);
  const syntheticCandidates = new Map<string, GoldPairDraft[]>();
  const cells = offDiagonalCells().map((cell) => ({ cell, key: cellKey(cell.investigator, cell.notice), forbidden: forbidden.has(cellKey(cell.investigator, cell.notice)) }));
  for (const c of cells) {
    if ((cellCandidates.get(c.key)?.length ?? 0) > 0) continue;
    const s = syntheticByFamily.get(c.cell.investigator);
    if (!s) continue;
    const targets = notices.filter((n) => n.family === c.cell.notice);
    if (!targets.length) continue;
    syntheticCandidates.set(
      c.key,
      seededShuffle(targets, rng).map((notice) => draft({ inv: { id: s.id, family: s.family }, notice, stratum: "adversarial", signals: SYNTHETIC_SIGNALS, source: `synthetic:${s.source}`, sources: [`cell:${c.key}`, `synthetic:${s.source}`], forbidden, synthetic_source: s.source }))
    );
  }
  const candidatesOf = (key: string) => cellCandidates.get(key) ?? syntheticCandidates.get(key) ?? [];
  const coverable = cells.filter((c) => candidatesOf(c.key).length > 0);
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
  // A synthetic investigator fills every cell of its family: no per-investigator cap, the per-notice cap shared with the real draws.
  const capsFor = (key: string): Caps => (cellCandidates.has(key) ? caps.adversarial : { per_investigator: UNCAPPED, per_notice: caps.adversarial.per_notice });
  const perCell = new Map<string, GoldPairDraft[]>();
  const adversarial: GoldPairDraft[] = [];
  for (const c of allocationOrder) {
    const got = drawWithCaps(candidatesOf(c.key), allocation.get(c.key) ?? 0, capsFor(c.key), ledgerAdv);
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
      const got = drawWithCaps(candidatesOf(c.key), 1, capsFor(c.key), ledgerAdv);
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
  const covered: CellReport[] = coverable.map((c) => ({ ...c, synthetic: !cellCandidates.has(c.key), candidates: candidatesOf(c.key).length, pairs: perCell.get(c.key)?.length ?? 0 }));
  const uncovered = cells
    .filter((c) => !coverable.includes(c))
    .map((c) => ({
      ...c,
      synthetic: false,
      candidates: 0,
      pairs: 0,
      reason: !familyPresent(c.cell.investigator, "investigator")
        ? `no investigator on the roster with dominant family ${c.cell.investigator}${syntheticByFamily.has(c.cell.investigator) ? "" : " and no synthetic investigator of that family"}`
        : !familyPresent(c.cell.notice, "notice")
          ? `no open notice requiring family ${c.cell.notice}`
          : "every pair in the cell was already drawn",
    }));

  // 3 · random at or above the current exploratory floor (whatever the rank).
  const randomPool = grid
    .filter((g) => aboveLegacyFloor(g.signals.legacy_similarity) && !taken.has(pairKey(g.inv.id, g.notice.id)))
    .map((g) => draft({ inv: g.inv, notice: g.notice, stratum: "random", signals: g.signals, source: "random", sources: [`legacy:${g.signals.legacy}`, fitNote(g.signals)].filter((x): x is string => Boolean(x)), forbidden }));
  const random = drawWithCaps(seededShuffle(randomPool, rng), quotas.random, caps.random, newLedger(taken));
  if (random.length < quotas.random) shortfalls.push(`random: ${random.length} of ${quotas.random} — too few pairs above the exploratory floor`);
  pairs.push(...random);

  // 4 · dropped by both engines, thinnest investigators first; own family, then the highest cosine under the floor (deterministic).
  const thinness = (a: StratifyInvestigator, b: StratifyInvestigator) => a.item_count - b.item_count || CONFIDENCE_RANK[a.paradigm_confidence] - CONFIDENCE_RANK[b.paradigm_confidence] || b.pending_items - a.pending_items || byId(a.id, b.id);
  const thin = [...investigators].sort(thinness);
  const droppedFor = (inv: StratifyInvestigator): GoldPairDraft[] =>
    grid
      .filter((g) => g.inv.id === inv.id && !aboveLegacyFloor(g.signals.legacy_similarity) && (g.signals.fit_v1 === null || g.signals.fit_v1 === "poor") && !taken.has(pairKey(g.inv.id, g.notice.id)))
      .map((g) => draft({ inv: g.inv, notice: g.notice, stratum: "dropped", signals: g.signals, source: "thin", sources: [`thin:${inv.item_count} items, paradigm ${inv.paradigm_confidence}`, `legacy:${g.signals.legacy}`, `fit_v1:${g.signals.fit_v1 ?? "no row"}`], forbidden }))
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
      const got = drawWithCaps(droppedFor(inv), 1, { per_investigator: UNCAPPED, per_notice: caps.dropped.per_notice }, ledgerDropped);
      if (!got.length) continue;
      usedInvestigators.set(inv.id, (usedInvestigators.get(inv.id) ?? 0) + 1);
      dropped.push(...got);
    }
  }
  if (dropped.length < quotas.dropped) shortfalls.push(`dropped: ${dropped.length} of ${quotas.dropped} — too few pairs both engines drop`);
  pairs.push(...dropped);

  // 5 · fit_v1 (supplementary): every stored Strong / Moderate pair not drawn above, Strong first, id order.
  const fitPool: Record<string, number> = { "fit_v1:strong": 0, "fit_v1:moderate": 0 };
  const fitRest: GoldPairDraft[] = [];
  for (const g of grid) {
    const note = fitNote(g.signals);
    if (!note) continue;
    fitPool[note] = (fitPool[note] ?? 0) + 1;
    if (taken.has(pairKey(g.inv.id, g.notice.id))) continue;
    fitRest.push(draft({ inv: g.inv, notice: g.notice, stratum: "fit_v1", signals: g.signals, source: note, sources: [note, `legacy:${g.signals.legacy}`], forbidden }));
  }
  fitRest.sort((a, b) => (a.signals.fit_v1 === b.signals.fit_v1 ? 0 : a.signals.fit_v1 === "strong" ? -1 : 1) || byId(a.investigator_id, b.investigator_id) || byId(a.opportunity_id, b.opportunity_id));
  const fitV1 = drawWithCaps(fitRest, fitRest.length, { per_investigator: UNCAPPED, per_notice: UNCAPPED }, newLedger(taken));
  pairs.push(...fitV1);
  const fitTotal = Object.values(fitPool).reduce((s, n) => s + n, 0);

  const counts: Record<Stratum, number> = { current: current.length, adversarial: adversarial.length, random: random.length, dropped: dropped.length, fit_v1: fitV1.length };
  return {
    pairs,
    quotas,
    counts,
    current: { pool, drawn },
    cells: { covered, uncovered, forbidden_total: cells.filter((c) => c.forbidden).length, forbidden_covered: covered.filter((c) => c.forbidden).length, synthetic: covered.filter((c) => c.synthetic).length },
    random: { pool: randomPool.length },
    dropped: { investigators: thin.filter((i) => usedInvestigators.has(i.id)).map((i) => ({ id: i.id, item_count: i.item_count, paradigm_confidence: i.paradigm_confidence, pairs: usedInvestigators.get(i.id) ?? 0 })) },
    fit_v1: { pool: fitPool, drawn_elsewhere: fitTotal - fitV1.length, supplementary: fitV1.length },
    shortfalls,
  };
}

/** The matrix families, for reports. */
export const FAMILY_ORDER = MATRIX_FAMILY_IDS;
