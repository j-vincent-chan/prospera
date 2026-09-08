/**
 * The regression suite every engine change must keep green (CLAUDE.md;
 * plan § PR 2.1): the nine adversarial pairs of spec §13 from
 * src/lib/fit/__fixtures__/adversarial-cases.json, and the eight forbidden
 * family cells — once as the fixture defines them and once with both §9
 * exploratory bridges armed. One `it` per assertion so a fixture-vs-spec
 * conflict could be skipped on its own; under the D23 reading (weights
 * normalized to the dominant category; allowed designs at group level) none
 * remains.
 *
 * Reading of the fixture's `caps`: the caps a pair must carry. An empty list
 * means no cap at all (the Strong and Moderate cases). A non-empty list is a
 * lower bound — case 1 lists `paradigm_gate` alone while its U (0.10 in the
 * spec's own numbers) trips the unit gate and its required cohort designs are
 * unsupported, both of which §7 stages 3–4 also cap.
 */
import { describe, expect, it } from "vitest";
import type { Component, Tier } from "@/lib/fit/types";
import { scorePair, scorePairDetailed } from "@/lib/fit/engine";
import { FIXTURE_VERSION, forbiddenCellPairs, forbiddenCells, loadAdversarialCases, type ComponentExpectation } from "@/lib/fit/engine/fixtures";
import { noticeAllowsHumanTissue } from "@/lib/fit/engine/tier";
import { paradigmGates, TAXONOMY_VERSION } from "@/lib/fit/taxonomy";

const cases = loadAdversarialCases();
const results = new Map(cases.map((c) => [c.id, scorePairDetailed(c.investigator, c.opportunity, c.ctx)]));

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

  it("the two D23 amendments are recorded on the cases they touch", () => {
    const amended = cases.filter((c) => c.expect.notes?.some((n) => n.startsWith("amended under D23")));
    expect(amended.map((c) => c.id)).toEqual(["2_cvd_epi_vs_mito_mechanism", "6b_human_immunologist_vs_cart_trial"]);
  });

  for (const c of cases) {
    describe(`${c.id} · ${c.title}`, () => {
      const r = () => results.get(c.id)!.result;

      it(`tier is ${c.expect.tier}`, () => {
        expect(r().tier).toBe(c.expect.tier as Tier);
      });

      it(`caps ${c.expect.caps.length ? `include ${c.expect.caps.join(", ")}` : "are empty"}`, () => {
        if (!c.expect.caps.length) expect(r().caps).toEqual([]);
        for (const cap of c.expect.caps) expect(r().caps, `caps: ${r().caps.join(", ")}`).toContain(cap);
      });

      for (const [component, expectation] of Object.entries(c.expect.components ?? {})) {
        it(`${component} ${typeof expectation === "number" ? `= ${expectation}` : JSON.stringify(expectation)}`, () => {
          expectBand(r().components[component as Component], expectation, component);
        });
      }

      if (c.expect.score) {
        it(`score ${JSON.stringify(c.expect.score)}`, () => {
          expectBand(r().score, c.expect.score!, "score");
        });
      }

      if (c.expect.why_not_mentions) {
        it(`why_not mentions ${c.expect.why_not_mentions.join(", ")}`, () => {
          mentions(r().why_not, c.expect.why_not_mentions!);
        });
      }

      if (c.expect.gap_mentions) {
        it(`gap mentions ${c.expect.gap_mentions.join(", ")}`, () => {
          mentions(r().gap, c.expect.gap_mentions!);
        });
      }

      if (c.expect.collaborator_suggested) {
        it("names a collaborator in the gap and provenance, by name and never by id", () => {
          expect(r().provenance.collaborators.length).toBeGreaterThan(0);
          expect(r().gap ?? "").toContain("Collaborators in the directory who do this:");
          // provenance keeps the ids for the UI to resolve; the sentence a person reads carries the profile's name, or a count when the fixture's collaborators have none
          for (const id of r().provenance.collaborators) expect(r().gap ?? "").not.toContain(id);
        });
      }

      if (c.expect.moderate_reason) {
        it(`the one gap is ${c.expect.moderate_reason}`, () => {
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

describe("forbidden family cells with both exploratory bridges armed (§9: no collaborator makes a mechanist a cohort epidemiologist)", () => {
  const cells = Array.from(forbiddenCells({ bridged: true }));
  it("arms the bridges: translational and human_biospecimen at their minimums, a collaborator in the notice's family, the notice allows human tissue and excludes the dominant category", () => {
    expect(cells.map((c) => c.pair)).toEqual(forbiddenCellPairs());
    for (const cell of cells) {
      expect(cell.investigator.paradigm.recent.translational).toBe(0.4);
      expect(cell.investigator.paradigm.recent.human_biospecimen).toBe(0.4);
      expect(cell.investigator.collaborators.map((c) => c.dominant_family)).toEqual([cell.pair[1]]);
      expect(cell.opportunity.materials.expected).toEqual(["human_blood_fluids"]);
      expect(noticeAllowsHumanTissue(cell.opportunity)).toBe(true);
      expect(Object.keys(cell.opportunity.paradigm.excluded)).toHaveLength(1);
    }
  });
  for (const cell of cells) {
    it(`${cell.pair[0]} → ${cell.pair[1]} stays Poor under the paradigm gate; no bridge fires`, () => {
      const { result, tier } = scorePairDetailed(cell.investigator, cell.opportunity, cell.ctx);
      expect(result.tier).toBe("poor");
      expect(result.components.P).toBeLessThan(paradigmGates().poor_below);
      expect(result.caps).toContain("paradigm_gate");
      expect(result.caps.filter((c) => c.startsWith("paradigm_gate_relaxed_"))).toEqual([]);
      expect(result.provenance.P.exception).toBeNull();
      expect(tier.exception).toBeNull();
      expect(tier.aspiration_relaxed).toBe(false);
      // the collaborator is real and in the required family — it is the bridges' family lists, not a missing partner or a notice without human tissue, that keep the cell closed
      expect(tier.collaborators).toEqual([`collab-${cell.pair[1]}`]);
    });
  }
  it("control: the same bridge-armed shape, a basic scientist against a clinical notice, is lifted by the translational bridge alone (its §9 row)", () => {
    const [cell] = Array.from(forbiddenCells({ bridged: true }, [["discovery", "clinical"]], 1));
    const { result, tier } = scorePairDetailed(cell!.investigator, cell!.opportunity, cell!.ctx);
    expect(result.tier).toBe("exploratory");
    expect(result.caps).toEqual(["paradigm_gate_relaxed_translational_bridge"]);
    expect(tier.exception).toBe("translational_bridge");
  });
  it("control: the same bridge-armed shape, a clinical investigator against a discovery notice, is lifted by the biospecimen bridge alone (its §9 row)", () => {
    const [cell] = Array.from(forbiddenCells({ bridged: true }, [["clinical", "discovery"]], 1));
    expect(cell!.investigator.paradigm.recent).toMatchObject({ clinical_observational: 1, human_biospecimen: 0.4 });
    const { result, tier } = scorePairDetailed(cell!.investigator, cell!.opportunity, cell!.ctx);
    expect(result.components.P).toBeLessThan(paradigmGates().poor_below);
    expect(result.tier).toBe("exploratory");
    expect(result.caps).toEqual(["paradigm_gate_relaxed_biospecimen_bridge"]);
    expect(tier.exception).toBe("biospecimen_bridge");
  });
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
