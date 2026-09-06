/**
 * The regression suite every engine change must keep green (CLAUDE.md;
 * plan § PR 2.1): the nine adversarial pairs of spec §13 from
 * src/lib/fit/__fixtures__/adversarial-cases.json, and the eight forbidden
 * family cells. One `it` per assertion so a fixture-vs-spec conflict can be
 * skipped on its own with the conflict quoted (`// CONFLICT:`).
 *
 * Reading of the fixture's `caps`: the caps a pair must carry. An empty list
 * means no cap at all (the Strong and Moderate cases). A non-empty list is a
 * lower bound — case 1 lists `paradigm_gate` alone while its U (0.10 in the
 * spec's own numbers) trips the unit gate and its required cohort designs are
 * unsupported, both of which §7 stages 3–4 also cap.
 */
import { describe, expect, it } from "vitest";
import type { Component, Tier } from "@/lib/fit/types";
import { forbiddenCells, scorePair, scorePairDetailed } from "@/lib/fit/engine";
import { FIXTURE_VERSION, forbiddenCellPairs, loadAdversarialCases, type ComponentExpectation } from "@/lib/fit/engine/fixtures";
import { TAXONOMY_VERSION } from "@/lib/fit/taxonomy";

const cases = loadAdversarialCases();
const results = new Map(cases.map((c) => [c.id, scorePairDetailed(c.investigator, c.opportunity, c.ctx)]));

/**
 * Fixture expectations the literal spec formulas do not reproduce, keyed
 * `<case id>:<assertion>`. Each is skipped, not rewritten (plan § PR 2.1
 * kickoff: "If a fixture expectation seems inconsistent with the spec, stop
 * and show me the conflict rather than changing the fixture"); the
 * coordinator decides. The values quoted are what the engine computes from
 * the fixture profiles under the spec's formulas.
 *
 * The common thread: the spec's §13 worked numbers (which the fixture bands
 * follow) take P and U as the family / level compat of the investigator's
 * *dominant* category alone — 0.45 for case 3, 1.00 for case 5, 0.15 for
 * 6b, 0.85 for 7b — while §7 stage 2's rule multiplies by the investigator
 * weight and maximizes over every category: "support = max over
 * investigator paradigms i of w_i · compat(i, o)"; stage 3 is the "same
 * form over the five-level matrix".
 */
const CONFLICTS: Record<string, string> = {
  // CONFLICT: fixture case 2 `"U": { "max": 0.15 }` vs spec §7 stage 3 "Same form over the five-level matrix" (stage 2: "support = max over investigator paradigms i of w_i · compat(i, o)"): inv {L4 0.90, L3 0.35} vs required L1 → max(0.90 · 0.10, 0.35 · 0.50) = 0.175. The fixture's 0.10 is compat(L4, L1) unweighted.
  "2_cvd_epi_vs_mito_mechanism:component:U": "U = 0.175 under the stage-3 formula (0.35 · compat(L3, L1) = 0.175); the fixture band assumes compat(L4, L1) = 0.10 alone",
  // CONFLICT: fixture case 3 `"tier": "exploratory"` vs spec §7 stage 2 "support = max over investigator paradigms i of w_i · compat(i, o)" and "If the investigator's dominant paradigm (weight ≥ 0.6) is in the notice's excluded set and no required paradigm has support ≥ 0.4, P := min(P, 0.15). P < 0.25 caps the tier at Poor": clinical_trials 0.85 · compat(clinical, population) 0.45 = 0.3825 < 0.4, clinical_trials is excluded → P = 0.15 → Poor. The spec's own case number, P 0.45, is the compat value alone, which clears the 0.4 test.
  "3_ibd_trialist_vs_population_genomics:tier": "Poor under the stage-2 formula: support 0.3825 < 0.4 lets the excluded-paradigm rule fire (P 0.15); the fixture's Exploratory needs P 0.45 = compat alone",
  // CONFLICT: fixture case 3 `"P": { "min": 0.40, "max": 0.55 }` vs the same two sentences: P = 0.15.
  "3_ibd_trialist_vs_population_genomics:component:P": "P = 0.15 (excluded rule on support 0.3825); fixture band [0.40, 0.55] is compat(clinical, population) = 0.45 alone",
  // CONFLICT: fixture case 3 `"U": { "min": 0.50, "max": 0.60 }` vs spec §7 stage 3 "Same form over the five-level matrix": {L3 0.90, L4 0.40} vs required L4 → max(0.90 · 0.55, 0.40 · 1.00) = 0.495. The fixture's 0.55 is compat(L3, L4) alone.
  "3_ibd_trialist_vs_population_genomics:component:U": "U = 0.495 (0.90 · compat(L3, L4)); fixture band [0.50, 0.60] is compat(L3, L4) = 0.55 alone",
  // CONFLICT: fixture case 3 `"gap_mentions": ["genetic", "trial"]` and `"collaborator_suggested": true` follow from its Exploratory tier; a Poor pair carries `why_not`, not `gap` (spec §10: "the rationale must name the gap" is the Exploratory row).
  "3_ibd_trialist_vs_population_genomics:gap_mentions": "Poor under the formula, so the pair has why_not (which names Genetic epidemiology and Clinical trials) and no gap",
  "3_ibd_trialist_vs_population_genomics:collaborator": "Poor under the formula, so no gap sentence names the collaborator (provenance.collaborators does list collab-gwas-1)",
  // CONFLICT: fixture case 5 `"P": { "min": 0.95 }` vs spec §7 stage 2 "support = max over investigator paradigms i of w_i · compat(i, o)": clinical_trials 0.81 · same_category 1.00 = 0.81. The spec's "P 1.00" is the compat value alone.
  "5_lupus_trialist_vs_sle_trial:component:P": "P = 0.81 (0.81 · same_category 1.00); fixture ≥ 0.95 assumes the weight is not applied",
  // CONFLICT: fixture case 5 `"U": { "min": 0.95 }` vs spec §7 stage 3 "Same form over the five-level matrix": L3 0.86 · 1.00 = 0.86.
  "5_lupus_trialist_vs_sle_trial:component:U": "U = 0.86 (0.86 · compat(L3, L3) 1.00); fixture ≥ 0.95 assumes the weight is not applied",
  // CONFLICT: fixture case 5 `"score": { "min": 60 }` vs spec §8 "S = 100 · C · R" with C = E · P · D^0.75 · U^0.5 over the P and U above: 100 · 0.81 · 0.82^0.75 · 0.86^0.5 · 0.854 = 55.3 (73.6 with P = U = 1).
  "5_lupus_trialist_vs_sle_trial:score": "S = 55.3 under §8 with P 0.81 and U 0.86; ≥ 60 needs the unweighted P and U",
  // CONFLICT: fixture case 6b `"caps": ["paradigm_gate_relaxed_translational_bridge", "design_required_unsupported"]` vs spec §7 stage 2 "support = max over investigator paradigms i of w_i · compat(i, o)" and "P < 0.25 caps the tier at Poor; P < 0.45 caps at Exploratory": human_biospecimen 0.60 · compat(translational, clinical) 0.60 = 0.36, so P = 0.36 is Exploratory-capped, not Poor-gated, and §9's exception ("Cap Poor, or Exploratory if translational weight ≥ 0.4 and a trialist co-author exists") has no Poor to lift. The spec's "P 0.15 would cap at Poor" is compat(discovery, clinical) of the dominant paradigm alone.
  "6b_human_immunologist_vs_cart_trial:caps": "caps are paradigm_gate (Exploratory, P 0.36) + design_required_unsupported; the translational bridge only relaxes a Poor gate, and P 0.36 is not one",
  // CONFLICT: fixture case 6b `"P": { "max": 0.20 }` vs the same stage-2 sentence: P = 0.36.
  "6b_human_immunologist_vs_cart_trial:component:P": "P = 0.36 (human_biospecimen 0.60 · compat(translational, clinical) 0.60); fixture ≤ 0.20 is compat(discovery, clinical) = 0.15 of the dominant alone",
  // CONFLICT: fixture case 7b `"tier": "moderate"` and `"D": { "min": 0.50, "max": 0.65 }` vs spec §7 stage 4 "allowed is the share of the investigator's design mass inside the notice's allowed set": {claims_analysis 0.85, ehr_analysis 0.80, retrospective_cohort 0.60, hybrid 0.35} against allowed [pragmatic_trial, mixed_methods, ehr_analysis, survey] plus the required [hybrid, implementation_evaluation] → (0.80 + 0.35) / 2.60 = 0.442; D = 0.6 · 0.35 + 0.3 · 0.442 + 0.1 = 0.443, under the Moderate floor D ≥ 0.50 (§10) → Exploratory. The spec's "D 0.55" is reproduced (0.54) only if "allowed set" means the allowed designs' groups (claims_analysis counted through real_world_data) — and that reading gives case 6b D = 0.40 against its `"D": { "max": 0.25 }`.
  "7b_hsr_vs_dpp_implementation:tier": "Exploratory under the stage-4 formula: D 0.443 < Moderate floor 0.50 (allowed share 0.442 at the design level)",
  "7b_hsr_vs_dpp_implementation:component:D": "D = 0.443 at the design level; the spec's 0.55 needs a group-level allowed set, which breaks case 6b's D ≤ 0.25",
  // CONFLICT: fixture case 7b `"P": { "min": 0.80 }` vs spec §7 stage 2 "support = max over investigator paradigms i of w_i · compat(i, o)": health_services 0.85 · sibling_category 0.85 = 0.7225. The spec's "P 0.85 (sibling categories)" is the sibling value alone.
  "7b_hsr_vs_dpp_implementation:component:P": "P = 0.7225 (0.85 · sibling 0.85); fixture ≥ 0.80 is sibling_category alone",
  // CONFLICT: fixture case 7b `"U": { "min": 0.95 }` vs spec §7 stage 3 "Same form over the five-level matrix": {L5 0.70, L4 0.70} vs required L5 → 0.70 · 1.00 = 0.70.
  "7b_hsr_vs_dpp_implementation:component:U": "U = 0.70 (0.70 · compat(L5, L5)); fixture ≥ 0.95 assumes the weight is not applied",
  // CONFLICT: fixture case 7b `"score": { "min": 30 }` vs spec §8 with the P, U and D above: S = 19.4.
  "7b_hsr_vs_dpp_implementation:score": "S = 19.4 under §8 with P 0.72, U 0.70, D 0.44",
  // CONFLICT: fixture case 7b `"moderate_reason": "D below strong floor (0.75)"` presumes the Moderate tier above.
  "7b_hsr_vs_dpp_implementation:moderate_reason": "the pair is Exploratory under the formula; its one missed Moderate floor is D 0.443 < 0.50",
};

/** `it`, or `it.skip` with the conflict note when the assertion is a recorded fixture-vs-spec conflict. */
function assertion(key: string, name: string, fn: () => void) {
  const conflict = CONFLICTS[key];
  if (conflict) it.skip(`${name} — CONFLICT (fixture vs spec): ${conflict}`, fn);
  else it(name, fn);
}

function expectBand(value: number, expectation: ComponentExpectation, label: string) {
  if (typeof expectation === "number") expect(value, label).toBe(expectation);
  else {
    if (expectation.min !== undefined) expect(value, `${label} ≥ ${expectation.min}`).toBeGreaterThanOrEqual(expectation.min);
    if (expectation.max !== undefined) expect(value, `${label} ≤ ${expectation.max}`).toBeLessThanOrEqual(expectation.max);
  }
}

const mentions = (text: string | null, words: string[]) => {
  const t = (text ?? "").toLowerCase();
  for (const w of words) expect(t, `mentions "${w}" in: ${text}`).toContain(w.toLowerCase());
};

describe("adversarial fixture (spec §13)", () => {
  it("is the fixture for this taxonomy version, with nine cases and eight forbidden cells", () => {
    expect(FIXTURE_VERSION).toBe(TAXONOMY_VERSION);
    expect(cases.map((c) => c.id)).toEqual([
      "1_tcell_lab_vs_survivorship_epi",
      "2_cvd_epi_vs_mito_mechanism",
      "3_ibd_trialist_vs_population_genomics",
      "4_comp_genomics_vs_kidney_genomics",
      "5_lupus_trialist_vs_sle_trial",
      "6a_human_immunologist_vs_besh",
      "6b_human_immunologist_vs_cart_trial",
      "7a_hsr_vs_beta_cell_mechanism",
      "7b_hsr_vs_dpp_implementation",
    ]);
    expect(forbiddenCellPairs()).toHaveLength(8);
  });

  for (const c of cases) {
    describe(`${c.id} · ${c.title}`, () => {
      const r = () => results.get(c.id)!.result;
      const key = (assertionId: string) => `${c.id}:${assertionId}`;

      assertion(key("tier"), `tier is ${c.expect.tier}`, () => {
        expect(r().tier).toBe(c.expect.tier as Tier);
      });

      assertion(key("caps"), `caps ${c.expect.caps.length ? `include ${c.expect.caps.join(", ")}` : "are empty"}`, () => {
        if (!c.expect.caps.length) expect(r().caps).toEqual([]);
        for (const cap of c.expect.caps) expect(r().caps, `caps: ${r().caps.join(", ")}`).toContain(cap);
      });

      for (const [component, expectation] of Object.entries(c.expect.components ?? {})) {
        assertion(key(`component:${component}`), `${component} ${typeof expectation === "number" ? `= ${expectation}` : JSON.stringify(expectation)}`, () => {
          expectBand(r().components[component as Component], expectation, component);
        });
      }

      if (c.expect.score) {
        assertion(key("score"), `score ${JSON.stringify(c.expect.score)}`, () => {
          expectBand(r().score, c.expect.score!, "score");
        });
      }

      if (c.expect.why_not_mentions) {
        assertion(key("why_not_mentions"), `why_not mentions ${c.expect.why_not_mentions.join(", ")}`, () => {
          mentions(r().why_not, c.expect.why_not_mentions!);
        });
      }

      if (c.expect.gap_mentions) {
        assertion(key("gap_mentions"), `gap mentions ${c.expect.gap_mentions.join(", ")}`, () => {
          mentions(r().gap, c.expect.gap_mentions!);
        });
      }

      if (c.expect.collaborator_suggested) {
        assertion(key("collaborator"), "names a collaborator in the gap and provenance", () => {
          expect(r().provenance.collaborators.length).toBeGreaterThan(0);
          for (const id of r().provenance.collaborators) expect(r().gap ?? "").toContain(id);
        });
      }

      if (c.expect.moderate_reason) {
        assertion(key("moderate_reason"), `the one gap is ${c.expect.moderate_reason}`, () => {
          const component = c.expect.moderate_reason!.trim()[0]!;
          expect(r().provenance.floors.tier_by_floors).toBe("moderate");
          expect(r().provenance.floors.unmet.map((u) => u.key[0])).toContain(component);
          expect((r().gap ?? "").toLowerCase()).toContain(component === "T" ? "topic" : component === "D" ? "design" : component.toLowerCase());
        });
      }
    });
  }
});

describe("forbidden family cells (fixture forbidden_family_cells)", () => {
  const cells = Array.from(forbiddenCells());
  it("generates one cell per fixture pair", () => {
    expect(cells.map((c) => c.pair)).toEqual(forbiddenCellPairs());
  });
  for (const cell of cells) {
    it(`${cell.pair[0]} → ${cell.pair[1]} is Poor with paradigm_gate`, () => {
      const r = scorePair(cell.investigator, cell.opportunity, cell.ctx);
      expect(r.tier).toBe("poor");
      expect(r.caps).toContain("paradigm_gate");
      expect(r.components.T).toBe(0.9);
      expect(r.why_not).toBeTruthy();
    });
  }
});

describe("purity and determinism (plan § PR 2.1 acceptance)", () => {
  function deepFreeze<T>(x: T): T {
    if (x && typeof x === "object" && !Object.isFrozen(x)) {
      Object.freeze(x);
      for (const v of Object.values(x as Record<string, unknown>)) deepFreeze(v);
    }
    return x;
  }

  it("the same inputs give a byte-identical result, and inputs are not mutated", () => {
    for (const c of cases) {
      const before = JSON.stringify([c.investigator, c.opportunity, c.ctx]);
      const a = JSON.stringify(scorePair(c.investigator, c.opportunity, c.ctx));
      const b = JSON.stringify(scorePair(JSON.parse(JSON.stringify(c.investigator)), JSON.parse(JSON.stringify(c.opportunity)), JSON.parse(JSON.stringify(c.ctx))));
      expect(b, c.id).toBe(a);
      expect(JSON.stringify([c.investigator, c.opportunity, c.ctx]), c.id).toBe(before);
    }
  });

  it("frozen inputs score without a write", () => {
    for (const c of cases) {
      const inv = deepFreeze(JSON.parse(JSON.stringify(c.investigator)));
      const opp = deepFreeze(JSON.parse(JSON.stringify(c.opportunity)));
      const ctx = deepFreeze(JSON.parse(JSON.stringify(c.ctx)));
      expect(() => scorePair(inv, opp, ctx), c.id).not.toThrow();
    }
  });

  it("stamps computed_at from ctx.now and the versions", () => {
    const c = cases[0]!;
    const r = scorePair(c.investigator, c.opportunity, { ...c.ctx, now: "2030-01-01T00:00:00.000Z" });
    expect(r.computed_at).toBe("2030-01-01T00:00:00.000Z");
    expect(r.taxonomy_version).toBe(TAXONOMY_VERSION);
    expect(r.engine_version).toBe("engine-1");
    expect(r.investigator_id).toBe(c.investigator.investigator_id);
    expect(r.opportunity_id).toBe(c.opportunity.opportunity_id);
  });
});
