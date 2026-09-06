/**
 * The evaluation metrics (plan § PR 2.4; spec §14 "Metrics", "Rollout
 * comparison"; plan "evaluation framing for the ImmunoX pilot"), pure over
 * pairs already scored by both engines and joined to their adjudicated
 * label:
 *
 *   tier precision      share of engine-Strong pairs labeled Strong or
 *                       Moderate (target ≥ 85 %); engine-Moderate labeled
 *                       Moderate or better (≥ 70 %); Exploratory and Poor
 *                       reported the same way for information
 *   wrong-type rate     the primary metric — two readings: STRUCTURAL
 *                       (needs no label: population / health-systems /
 *                       Clinical-Trial-Required notices shown at Strong or
 *                       Moderate to discovery or preclinical investigators,
 *                       as a share of everything shown at those tiers) and
 *                       LABELED (spec §14: shown pairs whose label reason is
 *                       "wrong type of research", target ≤ 5 %)
 *   precision@5         per investigator, over the labeled pairs the engine
 *                       surfaces (not Poor), ranked by the engine's score;
 *                       k = min(5, surfaced labeled pairs); mean over
 *                       investigators and the micro average
 *   confusion matrix    investigator family × notice family over the pairs
 *                       shown at Strong or Moderate, forbidden cells marked
 *                       (their mass should be zero), plus the set's own
 *                       composition over every pair
 *   recall check        share of labeled-Strong pairs the engine places in
 *                       Strong or Moderate (≥ 75 %), the rest Exploratory
 *                       not Poor; and the dropped stratum — how many of the
 *                       20 pairs each engine surfaces at Exploratory or
 *                       better, and how many of those the labels call
 *                       Strong or Moderate
 *   Strong-list ratio   fit-v1 Strong ÷ legacy Strong over the set: promote
 *                       only when the new list is not more than 30 %
 *                       shorter (ratio ≥ 0.70)
 *
 * With no labels the label-based sections say so, and the engine-vs-engine
 * tier distribution over the set stands as the pre-label baseline.
 */
import { FAMILY_SLOTS, familySlotLabel, BENCH_FAMILIES, WRONG_TYPE_NOTICE_FAMILIES, cellKey, type FamilySlot } from "@/lib/fit/goldset/families";
import type { AdjudicationStatus } from "@/lib/fit/goldset/labels";
import { legacyToFitTier, type LegacyTier } from "@/lib/fit/goldset/legacy";
import { TIER_LABEL_GOLD } from "@/lib/fit/goldset/reasons";
import { STRATA, STRATUM_LABEL, type Stratum } from "@/lib/fit/goldset/stratify";
import { TIER_IDS } from "@/lib/fit/taxonomy";
import type { Tier } from "@/lib/fit/types";

export type EngineId = "fit_v1" | "legacy";
export const ENGINES: readonly EngineId[] = ["fit_v1", "legacy"];
export const ENGINE_LABEL: Record<EngineId, string> = { fit_v1: "fit-v1", legacy: "legacy" };

/** Spec §14 targets — evaluation targets, not scoring thresholds (those live in taxonomy.json). */
export const TARGETS = { strong_precision: 0.85, moderate_precision: 0.7, wrong_type_rate: 0.05, recall_strong: 0.75, strong_list_ratio_min: 0.7, precision_k: 5 } as const;

export type MetricPair = {
  id: string;
  investigator_id: string;
  opportunity_id: string;
  stratum: Stratum | "extra";
  forbidden: boolean;
  investigator_family: FamilySlot;
  notice_family: FamilySlot;
  /** `mechanism.clinical_trial` of the notice profile. */
  clinical_trial: string;
  /** Null when the pair could not be scored (no stored profile on a side). */
  fit_v1: { tier: Tier; score: number; caps: string[] } | null;
  legacy: { tier: LegacyTier; similarity: number | null };
  label: { tier: Tier | null; status: AdjudicationStatus; reason: string | null; axis_reason: string | null };
};

export const RECOMMENDED: readonly Tier[] = ["strong", "moderate"];

/** The engine's fit-tier reading of a pair (legacy mapped: potential → moderate, dropped → poor); null when unscored. */
export function engineTier(p: MetricPair, engine: EngineId): Tier | null {
  return engine === "fit_v1" ? (p.fit_v1?.tier ?? null) : legacyToFitTier(p.legacy.tier);
}

/** The engine's ordering score: S for fit-v1, the document cosine for legacy. */
export function engineScore(p: MetricPair, engine: EngineId): number {
  return engine === "fit_v1" ? (p.fit_v1?.score ?? -1) : (p.legacy.similarity ?? -1);
}

const isRecommended = (t: Tier | null) => t !== null && RECOMMENDED.includes(t);
const isSurfaced = (t: Tier | null) => t !== null && t !== "poor";
const labeled = (p: MetricPair) => p.label.tier !== null;
const rate = (num: number, den: number): number | null => (den > 0 ? num / den : null);

export type TierPrecisionRow = { tier: Tier; system: number; labeled: number; agree: number; rate: number | null; target: number | null; rule: string };

const PRECISION_RULE: Record<Tier, { ok: (label: Tier) => boolean; rule: string }> = {
  strong: { ok: (l) => l === "strong" || l === "moderate", rule: "labeled Strong or Moderate" },
  moderate: { ok: (l) => l === "strong" || l === "moderate", rule: "labeled Moderate or better" },
  exploratory: { ok: (l) => l !== "poor", rule: "labeled Exploratory or better" },
  poor: { ok: (l) => l === "poor", rule: "labeled Poor" },
};

/** Pure. Tier precision per engine tier over the labeled pairs. */
export function tierPrecision(pairs: readonly MetricPair[], engine: EngineId): TierPrecisionRow[] {
  return TIER_IDS.map((tier) => {
    const system = pairs.filter((p) => engineTier(p, engine) === tier);
    const lab = system.filter(labeled);
    const agree = lab.filter((p) => PRECISION_RULE[tier].ok(p.label.tier!)).length;
    return { tier, system: system.length, labeled: lab.length, agree, rate: rate(agree, lab.length), target: tier === "strong" ? TARGETS.strong_precision : tier === "moderate" ? TARGETS.moderate_precision : null, rule: PRECISION_RULE[tier].rule };
  });
}

/** Pure. The structural "wrong type" test for one pair: a bench (discovery / preclinical) investigator against a population, health-systems or Clinical-Trial-Required notice. */
export function isStructuralWrongType(p: Pick<MetricPair, "investigator_family" | "notice_family" | "clinical_trial">): boolean {
  const bench = (BENCH_FAMILIES as readonly string[]).includes(p.investigator_family);
  const wrongNotice = (WRONG_TYPE_NOTICE_FAMILIES as readonly string[]).includes(p.notice_family) || p.clinical_trial === "required";
  return bench && wrongNotice;
}

export type WrongTypeRow = { engine: EngineId; shown: number; wrong: number; rate: number | null; target: number };

/** Pure. Structural wrong-type rate over the pairs shown at Strong / Moderate. */
export function structuralWrongType(pairs: readonly MetricPair[], engine: EngineId): WrongTypeRow {
  const shown = pairs.filter((p) => isRecommended(engineTier(p, engine)));
  const wrong = shown.filter(isStructuralWrongType).length;
  return { engine, shown: shown.length, wrong, rate: rate(wrong, shown.length), target: TARGETS.wrong_type_rate };
}

/** Pure. Labeled wrong-type rate (spec §14) over the labeled pairs shown at Strong / Moderate. */
export function labeledWrongType(pairs: readonly MetricPair[], engine: EngineId): WrongTypeRow {
  const shown = pairs.filter((p) => isRecommended(engineTier(p, engine)) && labeled(p));
  const wrong = shown.filter((p) => p.label.reason === "wrong_type").length;
  return { engine, shown: shown.length, wrong, rate: rate(wrong, shown.length), target: TARGETS.wrong_type_rate };
}

export type PrecisionAtK = { engine: EngineId; k: number; investigators: number; skipped: number; mean: number | null; micro: { hits: number; slots: number; rate: number | null } };

/** Pure. Precision@k per investigator over labeled, surfaced pairs ranked by the engine's score. */
export function precisionAtK(pairs: readonly MetricPair[], engine: EngineId, k: number = TARGETS.precision_k): PrecisionAtK {
  const byInv = new Map<string, MetricPair[]>();
  for (const p of pairs) (byInv.get(p.investigator_id) ?? byInv.set(p.investigator_id, []).get(p.investigator_id)!).push(p);
  let investigators = 0;
  let skipped = 0;
  let sum = 0;
  let hits = 0;
  let slots = 0;
  for (const list of byInv.values()) {
    const ranked = list
      .filter((p) => labeled(p) && isSurfaced(engineTier(p, engine)))
      .sort((a, b) => engineScore(b, engine) - engineScore(a, engine) || (a.opportunity_id < b.opportunity_id ? -1 : 1))
      .slice(0, k);
    if (!ranked.length) {
      skipped += 1;
      continue;
    }
    const h = ranked.filter((p) => isRecommended(p.label.tier)).length;
    investigators += 1;
    sum += h / ranked.length;
    hits += h;
    slots += ranked.length;
  }
  return { engine, k, investigators, skipped, mean: investigators ? sum / investigators : null, micro: { hits, slots, rate: rate(hits, slots) } };
}

export type ConfusionMatrix = {
  engine: EngineId | "set";
  rows: FamilySlot[];
  cols: FamilySlot[];
  counts: number[][];
  total: number;
  forbidden_mass: number;
  forbidden_cells: string[];
};

/** Pure. Investigator family × notice family over `pairs` (the caller filters to the pairs shown). */
export function confusionMatrix(pairs: readonly MetricPair[], engine: EngineId | "set", forbidden: ReadonlySet<string>): ConfusionMatrix {
  const rows = [...FAMILY_SLOTS];
  const cols = [...FAMILY_SLOTS];
  const counts = rows.map(() => cols.map(() => 0));
  let forbidden_mass = 0;
  for (const p of pairs) {
    const r = rows.indexOf(p.investigator_family);
    const c = cols.indexOf(p.notice_family);
    if (r < 0 || c < 0) continue;
    counts[r]![c]! += 1;
    if (forbidden.has(cellKey(p.investigator_family, p.notice_family))) forbidden_mass += 1;
  }
  return { engine, rows, cols, counts, total: pairs.length, forbidden_mass, forbidden_cells: Array.from(forbidden).sort() };
}

export type RecallCheck = {
  engine: EngineId;
  labeled_strong: { pairs: number; recommended: number; exploratory: number; poor: number; rate: number | null; target: number };
  dropped: { pairs: number; surfaced: number; recommended: number; labeled: number; labeled_recommended: number };
};

/** Pure. Spec §14 recall over labeled-Strong pairs, and the dropped stratum's fate. */
export function recallCheck(pairs: readonly MetricPair[], engine: EngineId): RecallCheck {
  const strong = pairs.filter((p) => p.label.tier === "strong");
  const rec = strong.filter((p) => isRecommended(engineTier(p, engine))).length;
  const exp = strong.filter((p) => engineTier(p, engine) === "exploratory").length;
  const poor = strong.filter((p) => engineTier(p, engine) === "poor" || engineTier(p, engine) === null).length;
  const dropped = pairs.filter((p) => p.stratum === "dropped");
  return {
    engine,
    labeled_strong: { pairs: strong.length, recommended: rec, exploratory: exp, poor, rate: rate(rec, strong.length), target: TARGETS.recall_strong },
    dropped: {
      pairs: dropped.length,
      surfaced: dropped.filter((p) => isSurfaced(engineTier(p, engine))).length,
      recommended: dropped.filter((p) => isRecommended(engineTier(p, engine))).length,
      labeled: dropped.filter(labeled).length,
      labeled_recommended: dropped.filter((p) => isRecommended(p.label.tier)).length,
    },
  };
}

export type StrongRatio = {
  fit_v1_strong: number;
  legacy_strong: number;
  ratio: number | null;
  /** Null when legacy has no Strong pair (the rule cannot be applied). */
  passes: boolean | null;
  recommended: { fit_v1: number; legacy: number; ratio: number | null };
};

/** Pure. The 30 % rule over the set. */
export function strongListRatio(pairs: readonly MetricPair[]): StrongRatio {
  const f = pairs.filter((p) => engineTier(p, "fit_v1") === "strong").length;
  const l = pairs.filter((p) => engineTier(p, "legacy") === "strong").length;
  const fr = pairs.filter((p) => isRecommended(engineTier(p, "fit_v1"))).length;
  const lr = pairs.filter((p) => isRecommended(engineTier(p, "legacy"))).length;
  const ratio = rate(f, l);
  return { fit_v1_strong: f, legacy_strong: l, ratio, passes: ratio === null ? null : ratio >= TARGETS.strong_list_ratio_min, recommended: { fit_v1: fr, legacy: lr, ratio: rate(fr, lr) } };
}

export type Distribution = { fit_v1: Record<Tier | "unscored", number>; legacy: Record<Tier, number>; legacy_raw: Record<LegacyTier, number>; crosstab: Record<Tier | "unscored", Record<Tier, number>> };

const emptyTiers = <T extends string>(keys: readonly T[]): Record<T, number> => Object.fromEntries(keys.map((k) => [k, 0])) as Record<T, number>;

/** Pure. Tier counts per engine over the set and the fit-v1 × legacy crosstab. */
export function tierDistribution(pairs: readonly MetricPair[]): Distribution {
  const fit = emptyTiers<Tier | "unscored">([...TIER_IDS, "unscored"]);
  const leg = emptyTiers<Tier>(TIER_IDS);
  const raw = emptyTiers<LegacyTier>(["strong", "potential", "exploratory", "dropped"]);
  const crosstab = Object.fromEntries([...TIER_IDS, "unscored"].map((t) => [t, emptyTiers<Tier>(TIER_IDS)])) as Distribution["crosstab"];
  for (const p of pairs) {
    const f = engineTier(p, "fit_v1") ?? "unscored";
    const l = engineTier(p, "legacy")!;
    fit[f] += 1;
    leg[l] += 1;
    raw[p.legacy.tier] += 1;
    crosstab[f][l] += 1;
  }
  return { fit_v1: fit, legacy: leg, legacy_raw: raw, crosstab };
}

export type MetricsReport = {
  generated_at: string;
  goldset_version: string;
  seed: number | null;
  taxonomy_version: string;
  engine_version: string;
  source: "goldset" | "all_labels";
  pairs: number;
  scored: { fit_v1: number; legacy: number };
  labels: { labeled: number; agreed: number; adjudicated: number; unresolved: number; pending: number; unlabeled: number };
  strata: Record<string, number>;
  distribution: Distribution;
  strong_ratio: StrongRatio;
  tier_precision: Record<EngineId, TierPrecisionRow[]>;
  wrong_type: { structural: Record<EngineId, WrongTypeRow>; labeled: Record<EngineId, WrongTypeRow> };
  precision_at_k: Record<EngineId, PrecisionAtK>;
  confusion: { recommended: Record<EngineId, ConfusionMatrix>; set: ConfusionMatrix };
  recall: Record<EngineId, RecallCheck>;
  notes: string[];
};

export type MetricsOptions = {
  forbidden: ReadonlySet<string>;
  generated_at: string;
  goldset_version: string;
  seed: number | null;
  taxonomy_version: string;
  engine_version: string;
  source: MetricsReport["source"];
  notes?: string[];
};

/** Pure. Every metric over the scored, labeled pairs. */
export function computeMetrics(pairs: readonly MetricPair[], opts: MetricsOptions): MetricsReport {
  const strata: Record<string, number> = {};
  for (const s of [...STRATA, "extra"]) strata[s] = pairs.filter((p) => p.stratum === s).length;
  const status = (s: AdjudicationStatus) => pairs.filter((p) => p.label.status === s).length;
  const per = <T,>(f: (e: EngineId) => T): Record<EngineId, T> => ({ fit_v1: f("fit_v1"), legacy: f("legacy") });
  const recommended = (e: EngineId) => pairs.filter((p) => isRecommended(engineTier(p, e)));
  return {
    generated_at: opts.generated_at,
    goldset_version: opts.goldset_version,
    seed: opts.seed,
    taxonomy_version: opts.taxonomy_version,
    engine_version: opts.engine_version,
    source: opts.source,
    pairs: pairs.length,
    scored: { fit_v1: pairs.filter((p) => p.fit_v1).length, legacy: pairs.filter((p) => p.legacy.similarity !== null).length },
    labels: { labeled: pairs.filter(labeled).length, agreed: status("agreed"), adjudicated: status("adjudicated"), unresolved: status("unresolved"), pending: status("pending"), unlabeled: status("unlabeled") },
    strata,
    distribution: tierDistribution(pairs),
    strong_ratio: strongListRatio(pairs),
    tier_precision: per((e) => tierPrecision(pairs, e)),
    wrong_type: { structural: per((e) => structuralWrongType(pairs, e)), labeled: per((e) => labeledWrongType(pairs, e)) },
    precision_at_k: per((e) => precisionAtK(pairs, e)),
    confusion: { recommended: per((e) => confusionMatrix(recommended(e), e, opts.forbidden)), set: confusionMatrix(pairs, "set", opts.forbidden) },
    recall: per((e) => recallCheck(pairs, e)),
    notes: opts.notes ?? [],
  };
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

const pct = (r: number | null): string => (r === null ? "—" : `${(r * 100).toFixed(1)} %`);
const num = (n: number): string => new Intl.NumberFormat("en-US").format(n);
const NO_LABELS = "_No gold labels yet — this section fills in once labels are imported (`npm run fit:goldset-import`) or saved on `/admin/fit-labels`._";

function table(header: string[], rows: string[][]): string {
  return [`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
}

function matrixTable(m: ConfusionMatrix, forbidden: ReadonlySet<string>): string {
  const header = ["investigator ↓ · notice →", ...m.cols.map(familySlotLabel)];
  const rows = m.rows.map((r, i) => [familySlotLabel(r), ...m.cols.map((c, j) => `${m.counts[i]![j]}${forbidden.has(cellKey(r, c)) ? " \\*" : ""}`)]);
  return table(header, rows);
}

/** Pure. METRICS.md. */
export function renderMetricsMarkdown(r: MetricsReport): string {
  const hasLabels = r.labels.labeled > 0;
  const forbidden = new Set(r.confusion.set.forbidden_cells);
  const lines: string[] = [];
  lines.push(`# Fit engine — metrics`);
  lines.push("");
  lines.push(`Generated ${r.generated_at} by \`scripts/fit-metrics.ts\` over ${r.source === "goldset" ? `the gold set ${r.goldset_version}${r.seed !== null ? ` (seed ${r.seed})` : ""}` : "every labeled pair in `fit_labels`"} — ${num(r.pairs)} pairs; taxonomy \`${r.taxonomy_version}\`, engine \`${r.engine_version}\`; both engines re-run at generation time (fit-v1 through \`scorePair\` with the service's context, legacy through the investigator page's cosine rule over stored vectors — no model or embedding call, no write). Spec §14 defines the metrics and targets; plan § PR 2.4 makes the wrong-type rate the primary one.`);
  lines.push("");
  lines.push(`Labels: ${num(r.labels.labeled)} of ${num(r.pairs)} pairs carry an adjudicated tier (${r.labels.agreed} agreed, ${r.labels.adjudicated} adjudicated, ${r.labels.unresolved} awaiting adjudication, ${r.labels.pending} with one label, ${r.labels.unlabeled} unlabeled). Scored: fit-v1 ${r.scored.fit_v1}, legacy ${r.scored.legacy} (a pair without a document vector on a side is legacy "dropped").`);
  lines.push("");
  lines.push(`Strata: ${Object.entries(r.strata).filter(([, n]) => n > 0).map(([s, n]) => `${(STRATUM_LABEL as Record<string, string>)[s] ?? s} ${n}`).join(" · ")}.`);
  for (const n of r.notes) lines.push(`\n> ${n}`);

  lines.push("", `## Pre-label baseline — tier distribution over the set`, "");
  const d = r.distribution;
  lines.push(table(["engine", ...TIER_IDS.map((t) => TIER_LABEL_GOLD[t]), "unscored"], [
    ["fit-v1", ...TIER_IDS.map((t) => String(d.fit_v1[t])), String(d.fit_v1.unscored)],
    ["legacy (mapped: potential → Moderate, dropped → Poor)", ...TIER_IDS.map((t) => String(d.legacy[t])), "0"],
  ]));
  lines.push("", `Legacy raw: strong ${d.legacy_raw.strong} · potential ${d.legacy_raw.potential} · exploratory ${d.legacy_raw.exploratory} · dropped ${d.legacy_raw.dropped}.`, "");
  lines.push(`fit-v1 (rows) × legacy (columns):`, "");
  lines.push(table(["fit-v1 ↓ · legacy →", ...TIER_IDS.map((t) => TIER_LABEL_GOLD[t])], [...TIER_IDS, "unscored" as const].map((f) => [f === "unscored" ? "unscored" : TIER_LABEL_GOLD[f], ...TIER_IDS.map((l) => String(d.crosstab[f][l]))])));

  lines.push("", `## Strong-list length (the 30 % rule)`, "");
  const s = r.strong_ratio;
  lines.push(table(["", "fit-v1", "legacy", "ratio", "rule (≥ 0.70)"], [
    ["Strong", String(s.fit_v1_strong), String(s.legacy_strong), s.ratio === null ? "—" : s.ratio.toFixed(2), s.passes === null ? "not applicable (legacy has no Strong pair)" : s.passes ? "passes" : "fails — the floors may be too tight (§12 recalibration)"],
    ["Strong + Moderate / Potential", String(s.recommended.fit_v1), String(s.recommended.legacy), s.recommended.ratio === null ? "—" : s.recommended.ratio.toFixed(2), "for information"],
  ]));

  lines.push("", `## Wrong-type rate (primary)`, "");
  lines.push(`Structural reading — no label needed: population / health-systems / Clinical-Trial-Required notices shown at Strong or Moderate to discovery or preclinical investigators, as a share of every pair shown at those tiers. Target ≤ ${pct(TARGETS.wrong_type_rate)}.`, "");
  lines.push(table(["engine", "shown (Strong + Moderate)", "wrong type", "rate"], ENGINES.map((e) => [ENGINE_LABEL[e], String(r.wrong_type.structural[e].shown), String(r.wrong_type.structural[e].wrong), pct(r.wrong_type.structural[e].rate)])));
  lines.push("", `Labeled reading (spec §14): shown pairs whose adjudicated reason is "wrong type of research".`, "");
  if (hasLabels) lines.push(table(["engine", "shown and labeled", "labeled wrong type", "rate"], ENGINES.map((e) => [ENGINE_LABEL[e], String(r.wrong_type.labeled[e].shown), String(r.wrong_type.labeled[e].wrong), pct(r.wrong_type.labeled[e].rate)])));
  else lines.push(NO_LABELS);

  lines.push("", `## Tier precision`, "");
  if (hasLabels) {
    for (const e of ENGINES) {
      lines.push(`**${ENGINE_LABEL[e]}**`, "");
      lines.push(table(["engine tier", "pairs", "labeled", "agree", "rate", "target", "rule"], r.tier_precision[e].map((row) => [TIER_LABEL_GOLD[row.tier], String(row.system), String(row.labeled), String(row.agree), pct(row.rate), row.target === null ? "—" : `≥ ${pct(row.target)}`, row.rule])));
      lines.push("");
    }
  } else lines.push(NO_LABELS);

  lines.push("", `## Precision@${TARGETS.precision_k} per investigator`, "");
  if (hasLabels) lines.push(table(["engine", "investigators", "skipped (nothing surfaced and labeled)", "mean precision@k", "micro (hits / slots)"], ENGINES.map((e) => { const p = r.precision_at_k[e]; return [ENGINE_LABEL[e], String(p.investigators), String(p.skipped), pct(p.mean), `${pct(p.micro.rate)} (${p.micro.hits} / ${p.micro.slots})`]; })));
  else lines.push(NO_LABELS);

  lines.push("", `## Family confusion matrix`, "");
  lines.push(`Investigator dominant family (the view the engine scores) × notice required family, over the pairs each engine shows at Strong or Moderate. \\* marks a forbidden cell (${r.confusion.set.forbidden_cells.join(", ")}); their mass should be zero.`, "");
  for (const e of ENGINES) {
    const m = r.confusion.recommended[e];
    lines.push(`**${ENGINE_LABEL[e]}** — ${m.total} shown, forbidden-cell mass ${m.forbidden_mass}`, "");
    lines.push(matrixTable(m, forbidden), "");
  }
  lines.push(`**Set composition** — every pair, ${r.confusion.set.total} pairs, ${r.confusion.set.forbidden_mass} in forbidden cells`, "");
  lines.push(matrixTable(r.confusion.set, forbidden));

  lines.push("", `## Recall check`, "");
  lines.push(`Spec §14: share of labeled-Strong pairs the engine places in Strong or Moderate (target ≥ ${pct(TARGETS.recall_strong)}); the remainder should be Exploratory, not Poor.`, "");
  if (hasLabels) lines.push(table(["engine", "labeled Strong", "in Strong / Moderate", "in Exploratory", "in Poor", "rate"], ENGINES.map((e) => { const c = r.recall[e].labeled_strong; return [ENGINE_LABEL[e], String(c.pairs), String(c.recommended), String(c.exploratory), String(c.poor), pct(c.rate)]; })));
  else lines.push(NO_LABELS);
  lines.push("", `The dropped stratum (pairs both engines dropped at export time, from the thinnest profiles): how many each engine surfaces at Exploratory or better when re-run, and what the labels say.`, "");
  lines.push(table(["engine", "pairs", "surfaced (≥ Exploratory)", "Strong / Moderate", "labeled", "labeled Strong / Moderate"], ENGINES.map((e) => { const c = r.recall[e].dropped; return [ENGINE_LABEL[e], String(c.pairs), String(c.surfaced), String(c.recommended), String(c.labeled), String(c.labeled_recommended)]; })));

  lines.push("", `## Reading the checkpoint`, "");
  lines.push(`Promote (flip \`teams.fit_engine\` for the pilot team) when fit-v1 beats legacy on tier precision and on the wrong-type rate and its Strong list is not more than 30 % shorter; if the list is shorter than that, the floors are too tight and §12's recalibration runs first.`);
  lines.push("");
  return lines.join("\n");
}
