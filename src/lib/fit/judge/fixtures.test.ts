import { describe, expect, it } from "vitest";
import { buildCallAPrompt, callALeaks, pairMask } from "@/lib/fit/judge/blind";
import { fixtureInputs, loadBlindPassFixtures, runBlindPassFixture, withinOneTier } from "@/lib/fit/judge/fixtures";
import { CALL_A_OK, callB, stubModel } from "@/lib/fit/judge/test-fixtures";
import type { Tier } from "@/lib/fit/types";

const SPEC_EXPECTATIONS: Record<string, Tier[]> = {
  "1_tcell_lab_vs_survivorship_epi": ["poor"],
  "2_cvd_epi_vs_mito_mechanism": ["poor"],
  "3_ibd_trialist_vs_population_genomics": ["exploratory"],
  "4_comp_genomics_vs_kidney_genomics": ["moderate"],
  "5_lupus_trialist_vs_sle_trial": ["strong"],
  "6a_human_immunologist_vs_besh": ["strong"],
  "6b_human_immunologist_vs_cart_trial": ["exploratory", "poor"],
  "7a_hsr_vs_beta_cell_mechanism": ["poor"],
  "7b_hsr_vs_dpp_implementation": ["moderate"],
};

describe("judge/fixtures · the nine §13 pairs as the blind pass reads them (blind-pass.md › Fixtures)", () => {
  const cases = loadBlindPassFixtures();

  it("carries the spec's expected verdicts: 1 poor · 2 poor · 3 exploratory · 4 moderate · 5 strong · 6a strong · 6b exploratory-or-poor · 7a poor · 7b moderate", () => {
    expect(Object.fromEntries(cases.map((c) => [c.id, c.expect]))).toEqual(SPEC_EXPECTATIONS);
  });

  it("every case builds valid judge inputs: ≤ 8 evidence items with unique ids and text, the four notice texts, the collaborators", () => {
    for (const c of cases) {
      const inputs = fixtureInputs(c);
      expect(inputs.evidence.length, c.id).toBeGreaterThanOrEqual(4);
      expect(inputs.evidence.length, c.id).toBeLessThanOrEqual(8);
      expect(new Set(inputs.evidence.map((e) => e.id)).size).toBe(inputs.evidence.length);
      expect(inputs.evidence.every((e) => e.text.length > 100 && e.text.length <= 1200)).toBe(true);
      expect(inputs.evidence.some((e) => e.kind === "biosketch_statement"), c.id).toBe(true);
      if (c.notice.clinical_trial_designation === "required" && c.evidence.some((e) => e.kind === "trial")) expect(inputs.evidence.some((e) => e.kind === "trial")).toBe(true);
      expect(inputs.notice.section_I_text).toContain("Funding Opportunity Purpose");
      expect(inputs.notice.non_responsive_text).toContain("will not be reviewed");
      expect(inputs.notice.eligibility_text).toContain("PD/PI");
      expect(inputs.characteristics.mechanisms_held.length).toBeGreaterThan(0);
    }
  });

  it("the masked Call A of every case leaks none of its topic terms or descriptor names, names no institute (F6), and keeps the paradigm words", () => {
    for (const c of cases) {
      const inputs = fixtureInputs(c);
      const mask = pairMask(inputs);
      const prompt = buildCallAPrompt(inputs, mask);
      expect(callALeaks(inputs, mask), c.id).toEqual([]);
      for (const term of c.notice.topic_terms) expect(prompt.toLowerCase(), `${c.id}: ${term}`).not.toContain(term.toLowerCase());
      // the notice number and the project numbers carry no IC letters; the prose names no institute
      expect(prompt, c.id).not.toMatch(/\b(RFA|PAR|PA|NOT)-[A-Z]{2}-\d{2}-\d{3}/);
      expect(prompt, c.id).not.toMatch(/\b\d?[A-Z]\d{2}[A-Z]{2}\d{6}\b/);
      expect(prompt, c.id).not.toMatch(/\b(NCI|NHGRI|NIDDK|NIAMS|NIAID|NHLBI|NIEHS|NINDS|NIMH|NIA)\b/);
      for (const e of c.evidence) if (e.kind === "grant") expect(prompt, `${c.id}: ${e.id}`).toContain(`[${e.id.replace(/^(\d?[A-Z]\d{2})[A-Z]{2}/, "$1··")}]`);
    }
    const trialist = fixtureInputs(cases.find((c) => c.id === "5_lupus_trialist_vs_sle_trial")!);
    const prompt = buildCallAPrompt(trialist, pairMask(trialist));
    expect(prompt).toMatch(/randomized/i);
    expect(prompt).toMatch(/principal investigator/i);
    expect(prompt).toMatch(/clinical trial/i);
    const lab = fixtureInputs(cases.find((c) => c.id === "1_tcell_lab_vs_survivorship_epi")!);
    const labPrompt = buildCallAPrompt(lab, pairMask(lab));
    expect(labPrompt).toMatch(/mice/i);
    expect(labPrompt).toMatch(/single-cell RNA-seq/i);
    expect(labPrompt).toMatch(/registries/i);
  });

  it("withinOneTier reads the spec's tolerance; a mocked model returning the expectation passes every case with two calls per variant", async () => {
    expect(withinOneTier(["poor"], "exploratory")).toBe(true);
    expect(withinOneTier(["poor"], "moderate")).toBe(false);
    expect(withinOneTier(["exploratory", "poor"], "moderate")).toBe(true);
    expect(withinOneTier(["strong"], null)).toBe(false);
    for (const c of cases) {
      const ids = c.evidence.map((e) => e.id);
      const { fn, calls } = stubModel({ blind_a: { ...CALL_A_OK, investigator_paradigm: { ...CALL_A_OK.investigator_paradigm, evidence_ids: ids.slice(0, 2) }, design: { ...CALL_A_OK.design, evidence_ids: ids.slice(0, 1) } }, blind_b: callB(c.expect[0]!, { topic_evidence_ids: ids.slice(0, 1), rationale: `See ${ids[0]}.` }) });
      const run = await runBlindPassFixture(c, { model: fn, modelName: "m", variants: 1 });
      expect(run.within, c.id).toBe(true);
      expect(run.exact).toBe(true);
      expect(run.calls).toBe(2);
      expect(calls).toHaveLength(2);
    }
  });
});
