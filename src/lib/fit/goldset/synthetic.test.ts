import { describe, expect, it } from "vitest";
import { loadAdversarialCases } from "@/lib/fit/engine/fixtures";
import { isSyntheticId, SYNTHETIC_PREFIX, syntheticSourceOf } from "@/lib/fit/goldset/stratify";
import { SYNTHETIC_CASES, syntheticInvestigators, syntheticNarrative, syntheticScoreContext, syntheticStratifyInvestigators } from "@/lib/fit/goldset/synthetic";

describe("goldset/synthetic", () => {
  const list = syntheticInvestigators();

  it("hydrates case 2 as the population investigator and case 7a as the health-systems one", () => {
    expect(SYNTHETIC_CASES.map((c) => c.case)).toEqual(["2_cvd_epi_vs_mito_mechanism", "7a_hsr_vs_beta_cell_mechanism"]);
    expect(list.map((s) => [s.id, s.family, s.name])).toEqual([
      ["synthetic:2_cvd_epi_vs_mito_mechanism", "population", "Cardiovascular epidemiologist"],
      ["synthetic:7a_hsr_vs_beta_cell_mechanism", "health_systems", "Health services researcher"],
    ]);
    expect(list[0]!.profile.paradigm.recent.epidemiology).toBe(0.9);
    expect(list[1]!.profile.paradigm.recent.health_services).toBe(0.85);
    expect(syntheticStratifyInvestigators(list)).toEqual([
      { id: "synthetic:2_cvd_epi_vs_mito_mechanism", family: "population", source: "2_cvd_epi_vs_mito_mechanism" },
      { id: "synthetic:7a_hsr_vs_beta_cell_mechanism", family: "health_systems", source: "7a_hsr_vs_beta_cell_mechanism" },
    ]);
  });

  it("synthetic ids are never roster UUIDs and carry their fixture case", () => {
    expect(isSyntheticId(`${SYNTHETIC_PREFIX}x`)).toBe(true);
    expect(isSyntheticId("04e59cf5-600a-462c-91bc-b2b97f122c3d")).toBe(false);
    expect(syntheticSourceOf(list[0]!.id)).toBe("2_cvd_epi_vs_mito_mechanism");
    expect(syntheticSourceOf("04e59cf5-600a-462c-91bc-b2b97f122c3d")).toBeNull();
  });

  it("the narrative reads the profile's axes in words, heaviest first", () => {
    const n = syntheticNarrative(list[0]!.profile);
    expect(n[0]).toMatch(/^Paradigm \(recent\): Epidemiology 0\.90, Population health 0\.60, Clinical observational 0\.45$/);
    expect(n.find((l) => l.startsWith("Unit of analysis:"))).toMatch(/L4/);
    expect(n.find((l) => l.startsWith("Study designs:"))).toMatch(/Prospective cohort 0\.85/);
    expect(n.find((l) => l.startsWith("Materials and data:"))).toBeTruthy();
    expect(n.find((l) => l.startsWith("Topic:"))).toMatch(/Cardiovascular, Heart Disease/);
    expect(list[0]!.narrative).toEqual(n);
  });

  it("the score context keeps the fixture's topic override and takes the notice's runway and completeness", () => {
    const c = loadAdversarialCases().find((x) => x.id === "7a_hsr_vs_beta_cell_mechanism")!;
    const ctx = syntheticScoreContext(c.ctx, { runway_weeks: 3, complete: false }, "2026-09-10T00:00:00.000Z");
    expect(ctx.topic.override).toBe(0.4);
    expect(ctx.actionability).toEqual({ runway_weeks: 3, in_pipeline: false, recently_dismissed: false });
    expect(ctx.notice_complete).toBe(false);
    expect(ctx.now).toBe("2026-09-10T00:00:00.000Z");
    expect(c.ctx.actionability.runway_weeks).toBe(10); // the base is untouched
  });
});
