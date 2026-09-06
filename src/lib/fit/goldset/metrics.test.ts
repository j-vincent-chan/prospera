import { describe, expect, it } from "vitest";
import { forbiddenCellPairs } from "@/lib/fit/engine/fixtures";
import { forbiddenCellKeys } from "@/lib/fit/goldset/families";
import { computeMetrics, confusionMatrix, engineTier, gridStrongRatio, isStructuralWrongType, labeledWrongType, precisionAtK, recallCheck, renderMetricsMarkdown, sourceGroup, strongListRatio, structuralWrongType, tierDistribution, tierPrecision, tierPrecisionBy, type MetricPair } from "@/lib/fit/goldset/metrics";
import type { LegacyTier } from "@/lib/fit/goldset/legacy";
import type { FamilySlot } from "@/lib/fit/goldset/families";
import type { Tier } from "@/lib/fit/types";

const forbidden = forbiddenCellKeys(forbiddenCellPairs());

type Spec = { id: string; inv: string; invFam: FamilySlot; notFam: FamilySlot; ct?: string; fit: [Tier, number] | null; legacy: [LegacyTier, number | null, number | null]; label?: [Tier, string | null]; stratum?: MetricPair["stratum"]; synthetic?: boolean; source?: string };

function pair(s: Spec): MetricPair {
  return {
    id: s.id,
    investigator_id: s.inv,
    opportunity_id: `n-${s.id}`,
    stratum: s.stratum ?? "current",
    forbidden: forbidden.has(`${s.invFam}->${s.notFam}`),
    synthetic: s.synthetic ?? false,
    source: s.source ?? "legacy:strong",
    investigator_family: s.invFam,
    notice_family: s.notFam,
    clinical_trial: s.ct ?? "not_allowed",
    fit_v1: s.fit ? { tier: s.fit[0], score: s.fit[1], caps: [] } : null,
    legacy: { tier: s.legacy[0], similarity: s.legacy[1], rank: s.legacy[2] },
    label: s.label ? { tier: s.label[0], status: "agreed", reason: s.label[1], axis_reason: s.label[1] === "wrong_research_type" ? "paradigm:epidemiology" : null } : { tier: null, status: "unlabeled", reason: null, axis_reason: null },
  };
}

/**
 * Ten real pairs, hand-derived. fit-v1 tiers: strong 2, moderate 3, exploratory 2, poor 3.
 * Legacy: strong 4, potential 3, exploratory 1, dropped 2 (p09 in the window under the floor, p10 without a vector). Labels on nine (p09 unlabeled).
 * Two synthetic pairs (p11 population → discovery, forbidden; p12 health systems → clinical): fit-v1 poor and moderate, never seen by legacy.
 */
const pairs: MetricPair[] = [
  pair({ id: "p01", inv: "A", invFam: "clinical", notFam: "clinical", ct: "required", fit: ["strong", 70], legacy: ["strong", 0.56, 1], label: ["strong", null] }),
  pair({ id: "p02", inv: "A", invFam: "clinical", notFam: "translational", fit: ["strong", 66], legacy: ["strong", 0.55, 2], label: ["poor", "not_relevant"] }), // fit-v1 Strong that the strategists reject
  pair({ id: "p03", inv: "A", invFam: "clinical", notFam: "population", fit: ["moderate", 40], legacy: ["potential", 0.47, 3], label: ["moderate", null] }),
  pair({ id: "p04", inv: "B", invFam: "discovery", notFam: "population", fit: ["poor", 2], legacy: ["strong", 0.5, 1], label: ["poor", "wrong_research_type"], source: "cell:discovery->population", stratum: "adversarial" }), // forbidden cell; legacy shows it
  pair({ id: "p05", inv: "B", invFam: "discovery", notFam: "clinical", ct: "required", fit: ["moderate", 38], legacy: ["potential", 0.46, 2], label: ["exploratory", "wrong_research_type"] }), // structural wrong type, shown by both
  pair({ id: "p06", inv: "B", invFam: "discovery", notFam: "discovery", fit: ["exploratory", 20], legacy: ["strong", 0.52, 3], label: ["strong", null] }), // a Strong label fit-v1 under-tiers
  pair({ id: "p07", inv: "C", invFam: "preclinical", notFam: "health_systems", fit: ["poor", 1], legacy: ["potential", 0.45, 1], label: ["poor", "wrong_research_type"], source: "cell:preclinical->health_systems", stratum: "adversarial" }), // forbidden cell
  pair({ id: "p08", inv: "C", invFam: "preclinical", notFam: "none", fit: ["moderate", 33], legacy: ["exploratory", 0.41, 2], label: ["strong", null], source: "random", stratum: "random" }),
  pair({ id: "p09", inv: "D", invFam: "translational", notFam: "discovery", fit: ["exploratory", 18], legacy: ["dropped", 0.3, 4], stratum: "dropped", source: "thin" }),
  pair({ id: "p10", inv: "D", invFam: "none", notFam: "none", fit: ["poor", 0], legacy: ["dropped", null, null], stratum: "dropped", source: "thin", label: ["moderate", null] }),
  pair({ id: "p11", inv: "synthetic:2_cvd_epi_vs_mito_mechanism", invFam: "population", notFam: "discovery", fit: ["poor", 3], legacy: ["dropped", null, null], label: ["poor", "wrong_research_type"], synthetic: true, source: "synthetic:2_cvd_epi_vs_mito_mechanism", stratum: "adversarial" }),
  pair({ id: "p12", inv: "synthetic:7a_hsr_vs_beta_cell_mechanism", invFam: "health_systems", notFam: "clinical", fit: ["moderate", 35], legacy: ["dropped", null, null], label: ["moderate", null], synthetic: true, source: "synthetic:7a_hsr_vs_beta_cell_mechanism", stratum: "adversarial" }),
];

describe("goldset/metrics · engine reading", () => {
  it("maps legacy tiers onto fit tiers (not shown and dropped are Poor) and reads unscored fit-v1 as null", () => {
    expect(engineTier(pairs[3]!, "legacy")).toBe("strong");
    expect(engineTier(pairs[2]!, "legacy")).toBe("moderate");
    expect(engineTier(pairs[8]!, "legacy")).toBe("poor");
    expect(engineTier({ ...pairs[0]!, legacy: { tier: "not_shown", similarity: 0.6, rank: 7 } }, "legacy")).toBe("poor");
    expect(engineTier({ ...pairs[0]!, fit_v1: null }, "fit_v1")).toBeNull();
  });

  it("tier distribution and crosstab over the real pairs, the synthetic pairs on their own row", () => {
    const d = tierDistribution(pairs);
    expect(d.fit_v1).toEqual({ strong: 2, moderate: 3, exploratory: 2, poor: 3, unscored: 0 });
    expect(d.legacy).toEqual({ strong: 4, moderate: 3, exploratory: 1, poor: 2 });
    expect(d.legacy_raw).toEqual({ strong: 4, potential: 3, exploratory: 1, not_shown: 0, dropped: 2 });
    expect(d.crosstab.strong).toEqual({ strong: 2, moderate: 0, exploratory: 0, poor: 0 });
    expect(d.crosstab.poor).toEqual({ strong: 1, moderate: 1, exploratory: 0, poor: 1 });
    expect(d.synthetic).toEqual({ strong: 0, moderate: 1, exploratory: 0, poor: 1, unscored: 0 });
  });

  it("groups draw sources", () => {
    expect(sourceGroup("cell:discovery->population")).toBe("cell");
    expect(sourceGroup("synthetic:2_cvd_epi_vs_mito_mechanism")).toBe("synthetic");
    expect(sourceGroup("legacy:strong")).toBe("legacy:strong");
  });
});

describe("goldset/metrics · tier precision", () => {
  it("fit-v1 counts synthetic pairs: Strong 1 of 2; Moderate 3 of 4 (p12 synthetic agrees); Poor 3 of 4 (p11 synthetic agrees)", () => {
    const rows = tierPrecision(pairs, "fit_v1");
    expect(rows.find((r) => r.tier === "strong")).toMatchObject({ system: 2, labeled: 2, agree: 1, rate: 0.5, target: 0.85 });
    expect(rows.find((r) => r.tier === "moderate")).toMatchObject({ system: 4, labeled: 4, agree: 3, rate: 0.75, target: 0.7 });
    // Exploratory: p06 (strong label) counts as "Exploratory or better"; p09 unlabeled.
    expect(rows.find((r) => r.tier === "exploratory")).toMatchObject({ system: 2, labeled: 1, agree: 1, rate: 1 });
    expect(rows.find((r) => r.tier === "poor")).toMatchObject({ system: 4, labeled: 4, agree: 3, rate: 0.75 });
  });
  it("legacy never sees a synthetic pair: Strong 2 of 4; Potential 1 of 3; an unlabeled tier has a null rate", () => {
    const rows = tierPrecision(pairs, "legacy");
    expect(rows.find((r) => r.tier === "strong")).toMatchObject({ system: 4, labeled: 4, agree: 2, rate: 0.5 });
    expect(rows.find((r) => r.tier === "moderate")).toMatchObject({ system: 3, labeled: 3, agree: 1, rate: 1 / 3 });
    expect(rows.find((r) => r.tier === "poor")).toMatchObject({ system: 2, labeled: 1 });
    expect(tierPrecision(pairs.filter((p) => !p.label.tier), "legacy").find((r) => r.tier === "poor")).toMatchObject({ system: 1, labeled: 0, rate: null });
  });
  it("per stratum and per draw source", () => {
    const byStratum = tierPrecisionBy(pairs, (p) => p.stratum, ["current", "adversarial", "random", "dropped", "fit_v1", "extra"]);
    expect(byStratum.map((g) => [g.key, g.pairs])).toEqual([["current", 5], ["adversarial", 4], ["random", 1], ["dropped", 2]]);
    expect(byStratum[1]!.engines.fit_v1.find((r) => r.tier === "poor")).toMatchObject({ system: 3, labeled: 3, agree: 3 });
    expect(byStratum[1]!.engines.legacy.find((r) => r.tier === "strong")).toMatchObject({ system: 1, labeled: 1, agree: 0 });
    const bySource = tierPrecisionBy(pairs, (p) => sourceGroup(p.source), []);
    expect(bySource.map((g) => [g.key, g.pairs])).toEqual([["legacy:strong", 5], ["cell", 2], ["random", 1], ["thin", 2], ["synthetic", 2]]);
  });
});

describe("goldset/metrics · wrong-type rate", () => {
  it("structural: bench investigator × population / health-systems / trial-required notice", () => {
    expect(isStructuralWrongType({ investigator_family: "discovery", notice_family: "population", clinical_trial: "not_allowed" })).toBe(true);
    expect(isStructuralWrongType({ investigator_family: "preclinical", notice_family: "discovery", clinical_trial: "required" })).toBe(true);
    expect(isStructuralWrongType({ investigator_family: "clinical", notice_family: "population", clinical_trial: "not_allowed" })).toBe(false);
    expect(isStructuralWrongType({ investigator_family: "discovery", notice_family: "clinical", clinical_trial: "optional" })).toBe(false);
    // fit-v1 shows 6 (p01 p02 p03 p05 p08 and the synthetic p12); wrong: p05. legacy shows 7 (p01 p02 p03 p04 p05 p06 p07); wrong: p04 p05 p07.
    expect(structuralWrongType(pairs, "fit_v1")).toMatchObject({ shown: 6, wrong: 1, rate: 1 / 6 });
    expect(structuralWrongType(pairs, "legacy")).toMatchObject({ shown: 7, wrong: 3, rate: 3 / 7 });
  });
  it("labeled: shown-and-labeled pairs whose reason is wrong_research_type, synthetic pairs counted for fit-v1", () => {
    expect(labeledWrongType(pairs, "fit_v1")).toMatchObject({ shown: 6, wrong: 1, rate: 1 / 6 });
    expect(labeledWrongType(pairs, "legacy")).toMatchObject({ shown: 7, wrong: 3, rate: 3 / 7 });
    expect(labeledWrongType(pairs.map((p) => ({ ...p, label: { ...p.label, tier: null } })), "legacy")).toMatchObject({ shown: 0, wrong: 0, rate: null });
  });
});

describe("goldset/metrics · precision@k", () => {
  it("per investigator: ranks each investigator's labeled, surfaced pairs by the engine's score and counts Strong / Moderate labels; synthetic pairs excluded", () => {
    // fit-v1 — A: p01 (70, strong ✓), p02 (66, poor ✗), p03 (40, moderate ✓) → 2/3; B: p05 (38, exploratory ✗), p06 (20, strong ✓) → 1/2 (p04 is Poor, not surfaced);
    // C: p08 (33, strong ✓) → 1/1 (p07 Poor); D: p09 unlabeled, p10 Poor → skipped. mean = (2/3 + 1/2 + 1) / 3; micro 4 / 6.
    const f = precisionAtK(pairs, "fit_v1", 5);
    expect(f).toMatchObject({ by: "investigator_id", k: 5, groups: 3, skipped: 1, micro: { hits: 4, slots: 6, rate: 4 / 6 } });
    expect(f.mean).toBeCloseTo((2 / 3 + 1 / 2 + 1) / 3, 10);
    // k = 2: A → p01, p02 → 1/2; B → p05, p06 → 1/2; C → 1/1.
    const k2 = precisionAtK(pairs, "fit_v1", 2);
    expect(k2.micro).toEqual({ hits: 3, slots: 5, rate: 3 / 5 });
    // legacy — A: p01 ✓ p02 ✗ p03 ✓; B: p06 (0.52 ✓), p04 (0.5 ✗), p05 (0.46 ✗); C: p07 ✗ (0.45), p08 ✓ (0.41); D: p10 dropped → skipped.
    expect(precisionAtK(pairs, "legacy", 5)).toMatchObject({ groups: 3, skipped: 1, micro: { hits: 4, slots: 8, rate: 0.5 } });
  });
  it("per notice (the Outreach reading): grouped by opportunity_id — one pair per notice here, so each group is a hit or a miss", () => {
    // fit-v1 surfaced and labeled: p01 ✓ p02 ✗ p03 ✓ p05 ✗ p06 ✓ p08 ✓ → 6 groups, 4 hits; p04, p07 (Poor), p09 (unlabeled), p10 (Poor) skipped.
    const f = precisionAtK(pairs, "fit_v1", 10, "opportunity_id");
    expect(f).toMatchObject({ by: "opportunity_id", k: 10, groups: 6, skipped: 4, micro: { hits: 4, slots: 6, rate: 4 / 6 } });
    expect(f.mean).toBeCloseTo(4 / 6, 10);
  });
});

describe("goldset/metrics · confusion matrix, recall, Strong ratio", () => {
  it("counts shown pairs per family cell and the forbidden mass; synthetic pairs count in the set", () => {
    const shown = (e: "fit_v1" | "legacy") => pairs.filter((p) => (e === "fit_v1" || !p.synthetic) && ["strong", "moderate"].includes(engineTier(p, e) ?? ""));
    const f = confusionMatrix(shown("fit_v1"), "fit_v1", forbidden);
    expect(f.total).toBe(6);
    expect(f.forbidden_mass).toBe(0);
    expect(f.counts[f.rows.indexOf("clinical")]![f.cols.indexOf("population")]).toBe(1);
    expect(f.counts[f.rows.indexOf("health_systems")]![f.cols.indexOf("clinical")]).toBe(1);
    const l = confusionMatrix(shown("legacy"), "legacy", forbidden);
    expect(l.total).toBe(7);
    expect(l.forbidden_mass).toBe(2); // p04 discovery→population, p07 preclinical→health_systems
    const set = confusionMatrix(pairs, "set", forbidden);
    expect(set.total).toBe(12);
    expect(set.forbidden_mass).toBe(3); // + p11 population→discovery
    expect(set.counts[set.rows.indexOf("none")]![set.cols.indexOf("none")]).toBe(1);
  });

  it("recall over labeled-Strong pairs and the dropped stratum", () => {
    // Labeled Strong: p01, p06, p08. fit-v1: p01 strong ✓, p06 exploratory, p08 moderate ✓ → 2/3, exploratory 1, poor 0.
    expect(recallCheck(pairs, "fit_v1").labeled_strong).toEqual({ pairs: 3, recommended: 2, exploratory: 1, poor: 0, rate: 2 / 3, target: 0.75 });
    // legacy: p01 strong ✓, p06 strong ✓, p08 exploratory → 2/3.
    expect(recallCheck(pairs, "legacy").labeled_strong).toMatchObject({ recommended: 2, exploratory: 1, poor: 0 });
    // Dropped stratum: p09, p10. fit-v1 surfaces p09 (exploratory); legacy neither. p10 labeled moderate.
    expect(recallCheck(pairs, "fit_v1").dropped).toEqual({ pairs: 2, surfaced: 1, recommended: 0, labeled: 1, labeled_recommended: 1 });
    expect(recallCheck(pairs, "legacy").dropped).toEqual({ pairs: 2, surfaced: 0, recommended: 0, labeled: 1, labeled_recommended: 1 });
  });

  it("the 30 % rule over the set (real pairs): 2 fit-v1 Strong over 4 legacy Strong is 0.5 and fails; no legacy Strong → not applicable", () => {
    expect(strongListRatio(pairs)).toEqual({ fit_v1_strong: 2, legacy_strong: 4, ratio: 0.5, passes: false, recommended: { fit_v1: 5, legacy: 7, ratio: 5 / 7 } });
    expect(strongListRatio(pairs.slice(0, 1)).passes).toBe(true);
    expect(strongListRatio(pairs.filter((p) => p.legacy.tier !== "strong")).passes).toBeNull();
  });

  it("the 30 % rule over the grid (the primary reading) reads the manifest's tallies", () => {
    const grid = {
      legacy: { investigators: 141, candidates: 900, pairs: 126_900, strong: 100, potential: 200, exploratory: 50, not_shown: 2115, dropped: 124_435, shown_outside_corpus: 30 },
      fit_results: { investigators: 144, notices: 436, pairs: 62_784, strong: 60, moderate: 100, exploratory: 500, poor: 40_000, none: 22_124 },
    };
    expect(gridStrongRatio(grid)).toEqual({ fit_v1_strong: 60, legacy_strong: 100, ratio: 0.6, passes: false, recommended: { fit_v1: 160, legacy: 300, ratio: 160 / 300 } });
    expect(gridStrongRatio({ ...grid, fit_results: { ...grid.fit_results, strong: 70 } }).passes).toBe(true);
  });
});

describe("goldset/metrics · report and markdown", () => {
  const opts = { forbidden, generated_at: "2026-09-10T00:00:00.000Z", goldset_version: "v1", seed: 1, taxonomy_version: "fit-v1", engine_version: "engine-1", source: "goldset" as const };

  it("with labels every section carries a table; without grid tallies the set ratio is the primary row", () => {
    const report = computeMetrics(pairs, opts);
    expect(report.labels).toMatchObject({ labeled: 11, agreed: 11, unlabeled: 1 });
    expect(report.strata).toMatchObject({ current: 5, adversarial: 4, random: 1, dropped: 2, fit_v1: 0, extra: 0 });
    expect(report.synthetic).toBe(2);
    expect(report.strong_ratio_grid).toBeNull();
    expect(report.precision_at_k_notice.fit_v1.k).toBe(10);
    const md = renderMetricsMarkdown(report);
    expect(md).toContain("# Fit engine — metrics");
    expect(md).not.toContain("No gold labels yet");
    expect(md).toContain("| fit-v1 | 6 | 1 | 16.7 % |");
    expect(md).toContain("forbidden-cell mass 2");
    expect(md).toContain("| Strong — the set (no grid tallies in this run) | 2 | 4 | 0.50 | fails — spec §14");
    expect(md).toContain("§12's recalibration");
    expect(md).toContain("k = min(5, the investigator's labeled pairs");
    expect(md).toContain("| per notice, k = 10 | fit-v1 | 6 | 4 | 66.7 % | 66.7 % (4 / 6) |");
    expect(md).toContain("**Per stratum**");
    expect(md).toContain("**Per draw source**");
    expect(md).toContain("| Adversarial (off-diagonal family cell) | 4 | fit-v1 | 0 | 1 / 1 (100.0 %) | 0 | 3 / 3 (100.0 %) |");
    expect(md).toContain("| synthetic pairs, fit-v1 only (outside the baseline) | 0 | 1 | 0 | 1 | 0 |");
    expect(md).toContain("not shown 0");
  });

  it("with grid tallies the grid ratio is the primary row and the set ratio is for information", () => {
    const grid = {
      legacy: { investigators: 141, candidates: 900, pairs: 126_900, strong: 100, potential: 200, exploratory: 50, not_shown: 2115, dropped: 124_435, shown_outside_corpus: 30 },
      fit_results: { investigators: 144, notices: 436, pairs: 62_784, strong: 80, moderate: 100, exploratory: 500, poor: 40_000, none: 22_104 },
    };
    const report = computeMetrics(pairs, { ...opts, grid });
    expect(report.strong_ratio_grid).toMatchObject({ fit_v1_strong: 80, legacy_strong: 100, ratio: 0.8, passes: true });
    const md = renderMetricsMarkdown(report);
    expect(md).toContain("| Strong — grid (62,784 fit_results rows vs 141 investigators × top 5) | 80 | 100 | 0.80 | passes |");
    expect(md).toContain("| Strong — the set | 2 | 4 | 0.50 | for information |");
  });

  it("with no labels the label sections say so and the baseline still renders", () => {
    const unlabeled = pairs.map((p) => ({ ...p, label: { tier: null, status: "unlabeled" as const, reason: null, axis_reason: null } }));
    const report = computeMetrics(unlabeled, opts);
    expect(report.labels.labeled).toBe(0);
    expect(report.tier_precision.fit_v1.every((r) => r.rate === null)).toBe(true);
    expect(report.wrong_type.structural.legacy).toMatchObject({ shown: 7, wrong: 3 });
    const md = renderMetricsMarkdown(report);
    expect((md.match(/No gold labels yet/g) ?? []).length).toBe(4);
    expect(md).toContain("| fit-v1 | 2 | 3 | 2 | 3 | 0 |");
    expect(md).toContain("| legacy | 7 | 3 | 42.9 % |");
    // The per-stratum and per-source tables still render: engine-tier counts until labeled (current: p01 p02 strong, p03 p05 moderate, p06 exploratory).
    expect(md).toContain("| Legacy engine Strong / Potential (page-shown or Outreach snapshot) | 5 | fit-v1 | 2 | 2 | 1 | 0 |");
    expect(md).toContain("| synthetic | 2 | fit-v1 | 0 | 1 | 0 | 1 |");
  });
});
