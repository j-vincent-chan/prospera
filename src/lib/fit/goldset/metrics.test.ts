import { describe, expect, it } from "vitest";
import { forbiddenCellPairs } from "@/lib/fit/engine/fixtures";
import { forbiddenCellKeys } from "@/lib/fit/goldset/families";
import { computeMetrics, confusionMatrix, engineTier, isStructuralWrongType, labeledWrongType, precisionAtK, recallCheck, renderMetricsMarkdown, strongListRatio, structuralWrongType, tierDistribution, tierPrecision, type MetricPair } from "@/lib/fit/goldset/metrics";
import type { LegacyTier } from "@/lib/fit/goldset/legacy";
import type { FamilySlot } from "@/lib/fit/goldset/families";
import type { Tier } from "@/lib/fit/types";

const forbidden = forbiddenCellKeys(forbiddenCellPairs());

type Spec = { id: string; inv: string; invFam: FamilySlot; notFam: FamilySlot; ct?: string; fit: [Tier, number] | null; legacy: [LegacyTier, number | null]; label?: [Tier, string | null]; stratum?: MetricPair["stratum"] };

function pair(s: Spec): MetricPair {
  return {
    id: s.id,
    investigator_id: s.inv,
    opportunity_id: `n-${s.id}`,
    stratum: s.stratum ?? "current",
    forbidden: forbidden.has(`${s.invFam}->${s.notFam}`),
    investigator_family: s.invFam,
    notice_family: s.notFam,
    clinical_trial: s.ct ?? "not_allowed",
    fit_v1: s.fit ? { tier: s.fit[0], score: s.fit[1], caps: [] } : null,
    legacy: { tier: s.legacy[0], similarity: s.legacy[1] },
    label: s.label ? { tier: s.label[0], status: "agreed", reason: s.label[1], axis_reason: s.label[1] === "wrong_type" ? "paradigm:epidemiology" : null } : { tier: null, status: "unlabeled", reason: null, axis_reason: null },
  };
}

/**
 * Ten pairs, hand-derived. fit-v1 tiers: strong 2, moderate 3, exploratory 2, poor 3.
 * Legacy: strong 4, potential 3, exploratory 1, dropped 2. Labels on nine (p09 unlabeled).
 */
const pairs: MetricPair[] = [
  pair({ id: "p01", inv: "A", invFam: "clinical", notFam: "clinical", ct: "required", fit: ["strong", 70], legacy: ["strong", 0.56], label: ["strong", null] }),
  pair({ id: "p02", inv: "A", invFam: "clinical", notFam: "translational", fit: ["strong", 66], legacy: ["strong", 0.55], label: ["poor", "not_relevant"] }), // fit-v1 Strong that the strategists reject
  pair({ id: "p03", inv: "A", invFam: "clinical", notFam: "population", fit: ["moderate", 40], legacy: ["potential", 0.47], label: ["moderate", null] }),
  pair({ id: "p04", inv: "B", invFam: "discovery", notFam: "population", fit: ["poor", 2], legacy: ["strong", 0.5], label: ["poor", "wrong_type"] }), // forbidden cell; legacy shows it
  pair({ id: "p05", inv: "B", invFam: "discovery", notFam: "clinical", ct: "required", fit: ["moderate", 38], legacy: ["potential", 0.46], label: ["exploratory", "wrong_type"] }), // structural wrong type, shown by both
  pair({ id: "p06", inv: "B", invFam: "discovery", notFam: "discovery", fit: ["exploratory", 20], legacy: ["strong", 0.52], label: ["strong", null] }), // a Strong label fit-v1 under-tiers
  pair({ id: "p07", inv: "C", invFam: "preclinical", notFam: "health_systems", fit: ["poor", 1], legacy: ["potential", 0.45], label: ["poor", "wrong_type"] }), // forbidden cell
  pair({ id: "p08", inv: "C", invFam: "preclinical", notFam: "none", fit: ["moderate", 33], legacy: ["exploratory", 0.41], label: ["strong", null] }),
  pair({ id: "p09", inv: "D", invFam: "translational", notFam: "discovery", fit: ["exploratory", 18], legacy: ["dropped", 0.3], stratum: "dropped" }),
  pair({ id: "p10", inv: "D", invFam: "none", notFam: "none", fit: ["poor", 0], legacy: ["dropped", null], stratum: "dropped", label: ["moderate", null] }),
];

describe("goldset/metrics · engine reading", () => {
  it("maps legacy tiers onto fit tiers and reads unscored fit-v1 as null", () => {
    expect(engineTier(pairs[3]!, "legacy")).toBe("strong");
    expect(engineTier(pairs[2]!, "legacy")).toBe("moderate");
    expect(engineTier(pairs[8]!, "legacy")).toBe("poor");
    expect(engineTier({ ...pairs[0]!, fit_v1: null }, "fit_v1")).toBeNull();
  });

  it("tier distribution and crosstab", () => {
    const d = tierDistribution(pairs);
    expect(d.fit_v1).toEqual({ strong: 2, moderate: 3, exploratory: 2, poor: 3, unscored: 0 });
    expect(d.legacy).toEqual({ strong: 4, moderate: 3, exploratory: 1, poor: 2 });
    expect(d.legacy_raw).toEqual({ strong: 4, potential: 3, exploratory: 1, dropped: 2 });
    expect(d.crosstab.strong).toEqual({ strong: 2, moderate: 0, exploratory: 0, poor: 0 });
    expect(d.crosstab.poor).toEqual({ strong: 1, moderate: 1, exploratory: 0, poor: 1 });
  });
});

describe("goldset/metrics · tier precision", () => {
  it("fit-v1: Strong 1 of 2 labeled Strong/Moderate; Moderate 2 of 3 at Moderate or better", () => {
    const rows = tierPrecision(pairs, "fit_v1");
    expect(rows.find((r) => r.tier === "strong")).toMatchObject({ system: 2, labeled: 2, agree: 1, rate: 0.5, target: 0.85 });
    expect(rows.find((r) => r.tier === "moderate")).toMatchObject({ system: 3, labeled: 3, agree: 2, rate: 2 / 3, target: 0.7 });
    // Exploratory: p06 (strong label) counts as "Exploratory or better"; p09 unlabeled.
    expect(rows.find((r) => r.tier === "exploratory")).toMatchObject({ system: 2, labeled: 1, agree: 1, rate: 1 });
    expect(rows.find((r) => r.tier === "poor")).toMatchObject({ system: 3, labeled: 3, agree: 2, rate: 2 / 3 });
  });
  it("legacy: Strong 2 of 4; Potential 1 of 3; an unlabeled tier has a null rate", () => {
    const rows = tierPrecision(pairs, "legacy");
    expect(rows.find((r) => r.tier === "strong")).toMatchObject({ system: 4, labeled: 4, agree: 2, rate: 0.5 });
    expect(rows.find((r) => r.tier === "moderate")).toMatchObject({ system: 3, labeled: 3, agree: 1, rate: 1 / 3 });
    expect(tierPrecision(pairs.filter((p) => !p.label.tier), "legacy").find((r) => r.tier === "poor")).toMatchObject({ system: 1, labeled: 0, rate: null });
  });
});

describe("goldset/metrics · wrong-type rate", () => {
  it("structural: bench investigator × population / health-systems / trial-required notice", () => {
    expect(isStructuralWrongType({ investigator_family: "discovery", notice_family: "population", clinical_trial: "not_allowed" })).toBe(true);
    expect(isStructuralWrongType({ investigator_family: "preclinical", notice_family: "discovery", clinical_trial: "required" })).toBe(true);
    expect(isStructuralWrongType({ investigator_family: "clinical", notice_family: "population", clinical_trial: "not_allowed" })).toBe(false);
    expect(isStructuralWrongType({ investigator_family: "discovery", notice_family: "clinical", clinical_trial: "optional" })).toBe(false);
    // fit-v1 shows 5 (p01 p02 p03 p05 p08); wrong: p05. legacy shows 7 (p01 p02 p03 p04 p05 p06 p07); wrong: p04 p05 p07.
    expect(structuralWrongType(pairs, "fit_v1")).toMatchObject({ shown: 5, wrong: 1, rate: 0.2 });
    expect(structuralWrongType(pairs, "legacy")).toMatchObject({ shown: 7, wrong: 3, rate: 3 / 7 });
  });
  it("labeled: shown-and-labeled pairs whose reason is wrong_type", () => {
    expect(labeledWrongType(pairs, "fit_v1")).toMatchObject({ shown: 5, wrong: 1, rate: 0.2 });
    expect(labeledWrongType(pairs, "legacy")).toMatchObject({ shown: 7, wrong: 3, rate: 3 / 7 });
    expect(labeledWrongType(pairs.map((p) => ({ ...p, label: { ...p.label, tier: null } })), "legacy")).toMatchObject({ shown: 0, wrong: 0, rate: null });
  });
});

describe("goldset/metrics · precision@k", () => {
  it("ranks each investigator's labeled, surfaced pairs by the engine's score and counts Strong / Moderate labels", () => {
    // fit-v1 — A: p01 (70, strong ✓), p02 (66, poor ✗), p03 (40, moderate ✓) → 2/3; B: p05 (38, exploratory ✗), p06 (20, strong ✓) → 1/2 (p04 is Poor, not surfaced);
    // C: p08 (33, strong ✓) → 1/1 (p07 Poor); D: p09 unlabeled, p10 Poor → skipped. mean = (2/3 + 1/2 + 1) / 3; micro 4 / 6.
    const f = precisionAtK(pairs, "fit_v1", 5);
    expect(f).toMatchObject({ investigators: 3, skipped: 1, micro: { hits: 4, slots: 6, rate: 4 / 6 } });
    expect(f.mean).toBeCloseTo((2 / 3 + 1 / 2 + 1) / 3, 10);
    // k = 2: A → p01, p02 → 1/2; B → p05, p06 → 1/2; C → 1/1.
    const k2 = precisionAtK(pairs, "fit_v1", 2);
    expect(k2.micro).toEqual({ hits: 3, slots: 5, rate: 3 / 5 });
    // legacy — A: p01 ✓ p02 ✗ p03 ✓; B: p06 (0.52 ✓), p04 (0.5 ✗), p05 (0.46 ✗); C: p07 ✗ (0.45), p08 ✓ (0.41); D: p10 dropped → skipped.
    expect(precisionAtK(pairs, "legacy", 5)).toMatchObject({ investigators: 3, skipped: 1, micro: { hits: 4, slots: 8, rate: 0.5 } });
  });
});

describe("goldset/metrics · confusion matrix, recall, Strong ratio", () => {
  it("counts shown pairs per family cell and the forbidden mass", () => {
    const shown = (e: "fit_v1" | "legacy") => pairs.filter((p) => ["strong", "moderate"].includes(engineTier(p, e) ?? ""));
    const f = confusionMatrix(shown("fit_v1"), "fit_v1", forbidden);
    expect(f.total).toBe(5);
    expect(f.forbidden_mass).toBe(0);
    expect(f.counts[f.rows.indexOf("clinical")]![f.cols.indexOf("population")]).toBe(1);
    const l = confusionMatrix(shown("legacy"), "legacy", forbidden);
    expect(l.total).toBe(7);
    expect(l.forbidden_mass).toBe(2); // p04 discovery→population, p07 preclinical→health_systems
    const set = confusionMatrix(pairs, "set", forbidden);
    expect(set.total).toBe(10);
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

  it("the 30 % rule: 2 fit-v1 Strong over 4 legacy Strong is 0.5 and fails; no legacy Strong → not applicable", () => {
    expect(strongListRatio(pairs)).toEqual({ fit_v1_strong: 2, legacy_strong: 4, ratio: 0.5, passes: false, recommended: { fit_v1: 5, legacy: 7, ratio: 5 / 7 } });
    expect(strongListRatio(pairs.slice(0, 1)).passes).toBe(true);
    expect(strongListRatio(pairs.filter((p) => p.legacy.tier !== "strong")).passes).toBeNull();
  });
});

describe("goldset/metrics · report and markdown", () => {
  const opts = { forbidden, generated_at: "2026-09-10T00:00:00.000Z", goldset_version: "v1", seed: 1, taxonomy_version: "fit-v1", engine_version: "engine-1", source: "goldset" as const };

  it("with labels every section carries a table", () => {
    const report = computeMetrics(pairs, opts);
    expect(report.labels).toMatchObject({ labeled: 9, agreed: 9, unlabeled: 1 });
    expect(report.strata).toMatchObject({ current: 8, dropped: 2, extra: 0 });
    const md = renderMetricsMarkdown(report);
    expect(md).toContain("# Fit engine — metrics");
    expect(md).not.toContain("No gold labels yet");
    expect(md).toContain("| fit-v1 | 5 | 1 | 20.0 % |");
    expect(md).toContain("forbidden-cell mass 2");
    expect(md).toContain("| Strong | 2 | 4 | 0.50 | fails");
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
  });
});
