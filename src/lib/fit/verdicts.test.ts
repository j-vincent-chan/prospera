/**
 * `verdicts.ts` against the regression suite (CLAUDE.md; brief §5 "PR 1":
 * "Unit-test against `adversarial-cases.json` — those cases are exactly the
 * rows that must not read as reassuring").
 *
 * The fixtures are engine-level (raw axis vectors), so every case is driven
 * the whole way a real row travels: `loadAdversarialCases()` →
 * `scorePairDetailed` → `toFitResultRow` → the `FIT_RESULT_VERDICT_COLUMNS`
 * projection → `fitVerdicts`. The projection is written out rather than
 * spread from the result so that a field the list read does **not** carry
 * (the stage provenance, the adjudication blob) cannot leak into a verdict
 * by accident — a Poor row's stub provenance has no `T.top_items`, and the
 * tests see exactly that.
 *
 * Every oracle here is computed from the engine's own output
 * (`provenance.E.failed`, `provenance.D.unmet_required`, `provenance.P.best_pair`)
 * or from `taxonomy.json`, or written out as a literal, never from
 * `verdicts.ts`, so an assertion cannot pass by agreeing with the code it
 * checks. Two assertions used to break that rule — one recomputed the
 * `plainSentence` regexes verbatim from the source and compared, which let a
 * mutation that deleted the strip survive; the other compared `action`
 * against the same exported map it came from. Both are now literal tables
 * (`EXPECTED_REASON`, `EXPECTED_ACTION`).
 */
import { describe, expect, it } from "vitest";
import { scorePairDetailed } from "@/lib/fit/engine";
import { loadAdversarialCases, type AdversarialCase } from "@/lib/fit/engine/fixtures";
import { EMPTY_LOOKUP } from "@/lib/fit/inspect/evidence";
import { toFitResultRow, type FitResultRow, type FitResultVerdictRow } from "@/lib/fit/results";
import { confidenceCap, designGates, familyCompat, familyOf, floors, isMatrixFamily, isParadigmCategory, paradigmGates, PARADIGM_FAMILY_IDS, thinEvidence } from "@/lib/fit/taxonomy";
import type { CapId, FitProvenance, InvestigatorFitProfile, OpportunityFitProfile, ParadigmFamily } from "@/lib/fit/types";
import {
  actionOf,
  approachFamilies,
  approachVerdict,
  caveatOf,
  eligibilityRestrictions,
  evidenceVerdict,
  fitVerdicts,
  nearestFloor,
  noticeIsComplete,
  reasonOf,
  VERDICT_ACTION,
  verdictLabelOf,
  type FitVerdicts,
  type VerdictInput,
} from "@/lib/fit/verdicts";

// ---------------------------------------------------------------------------
// Driving the fixtures the way a row really arrives
// ---------------------------------------------------------------------------

/** The `FIT_RESULT_VERDICT_COLUMNS` projection of a stored row: the list six, the slim JSON paths, and the four the verdicts need. */
function verdictRow(stored: FitResultRow): FitResultVerdictRow {
  const p = stored.provenance as Partial<FitProvenance>;
  return {
    investigator_id: stored.investigator_id,
    opportunity_id: stored.opportunity_id,
    tier: stored.tier,
    score: stored.score,
    rationale: stored.rationale,
    gap: stored.gap,
    why_not: stored.why_not,
    top_items: p.T?.top_items ?? null,
    best_pair: p.P?.best_pair ?? null,
    judged_at: null,
    judged_tier: null,
    judged_from: null,
    judged_confidence: null,
    judged_evidence: null,
    components: stored.components,
    caps: stored.caps,
    flags: stored.flags,
  };
}

type Driven = {
  id: string;
  title: string;
  scored: ReturnType<typeof scorePairDetailed>;
  row: FitResultVerdictRow;
  input: VerdictInput;
  verdicts: ReturnType<typeof fitVerdicts>;
};

function drive(c: AdversarialCase, overrides: Partial<VerdictInput> = {}): Driven {
  const scored = scorePairDetailed(c.investigator, c.opportunity, c.ctx);
  const row = verdictRow(toFitResultRow(scored.result));
  const input: VerdictInput = { row, notice: c.opportunity, investigator: c.investigator, lookup: EMPTY_LOOKUP, audience: "strategist", noticeComplete: true, ...overrides };
  return { id: c.id, title: c.title, scored, row, input, verdicts: fitVerdicts(input) };
}

/** A case's row with `caps` and `flags` replaced — the shapes stage 8 and stage 9 write that no fixture reaches. */
function withRow(d: Driven, patch: Partial<Pick<FitResultVerdictRow, "caps" | "flags" | "tier" | "rationale" | "why_not" | "judged_at" | "judged_tier" | "judged_from">>): VerdictInput {
  return { ...d.input, row: { ...d.row, ...patch } };
}

const cases = loadAdversarialCases();
const driven = cases.map((c) => drive(c));
const byId = new Map(driven.map((d) => [d.id, d]));

/**
 * Case 4 — the one Moderate row with no caps — with a second required design
 * group (`design.required_any_2`) its evidence cannot satisfy, and which the
 * notice does not also prohibit. The only fixture shape that isolates
 * `design_required_unsupported` from the paradigm gate.
 */
function designGapCase(): AdversarialCase {
  const c = cases.find((x) => x.id === "4_comp_genomics_vs_kidney_genomics")!;
  return { ...c, opportunity: { ...c.opportunity, design: { ...c.opportunity.design, required_any_2: ["survey", "qualitative"] } } };
}

// ---------------------------------------------------------------------------
// Independent oracles — taxonomy and engine output only
// ---------------------------------------------------------------------------

/**
 * The family of the **heaviest category** in a vector, computed here so the
 * assertion does not lean on `verdicts.ts` — and per category, not per family
 * sum, which is the rule: families are different sizes (`population` has six
 * categories, `discovery` two), so a sum lets a family win on breadth alone.
 */
function dominantFamily(weights: Partial<Record<string, number>> | null | undefined): ParadigmFamily | null {
  let best: ParadigmFamily | null = null;
  let bestWeight = 0;
  for (const f of PARADIGM_FAMILY_IDS) {
    for (const [category, w] of Object.entries(weights ?? {})) {
      if (typeof w !== "number" || w <= 0 || !isParadigmCategory(category) || familyOf(category) !== f) continue;
      if (w > bestWeight) {
        bestWeight = w;
        best = f;
      }
    }
  }
  return best;
}

/**
 * What each side of the pair actually is, computed straight from the stored
 * profiles. `paradigm.required` is a conjunction, so its heaviest term names
 * the notice; `required_any` is a disjunction (D14), so a notice whose
 * alternatives include the investigator's family has named that family too.
 */
function expectedFamilies(inv: InvestigatorFitProfile, opp: OpportunityFitProfile): { investigator: ParadigmFamily | null; notice: ParadigmFamily | null } {
  const investigator = dominantFamily(inv.paradigm.recent) ?? dominantFamily(inv.paradigm.career);
  const anyOfFamilies = Object.entries(opp.paradigm.required_any ?? {})
    .filter(([c, w]) => typeof w === "number" && w > 0 && isParadigmCategory(c))
    .map(([c]) => familyOf(c));
  const notice = dominantFamily(opp.paradigm.required) ?? (investigator && anyOfFamilies.includes(investigator) ? investigator : dominantFamily(opp.paradigm.required_any));
  return { investigator, notice };
}

/**
 * Label → the verb the row shows, written out here rather than read back from
 * `VERDICT_ACTION`. Comparing the returned action against the same exported
 * map it came from asserts nothing: any edit to the map moves both sides.
 */
const EXPECTED_ACTION = {
  strong: { label: "Add to outreach", kind: "primary" },
  moderate: { label: "See what's missing", kind: "secondary" },
  exploratory: { label: "Keep as a lead", kind: "secondary" },
  cannot_assess: { label: "Read the notice", kind: "secondary" },
  ruled_out: { label: "Dismiss", kind: "quiet" },
} as const;

/**
 * The nine rows, verbatim. Written by reading the engine's strings and saying
 * what the row should show, so a change to the strip, the split or the
 * excluded-note fold fails here — the regexes are not recomputed from the
 * source, which is what let a "delete the whole strip" mutation survive.
 */
const EXPECTED_REASON: Record<string, string> = {
  "1_tcell_lab_vs_survivorship_epi": "Paradigm: notice requires Epidemiology, Population health; yours is Molecular / cellular mechanistic; the notice excludes Molecular / cellular mechanistic.",
  "2_cvd_epi_vs_mito_mechanism": "Paradigm: notice requires Molecular / cellular mechanistic, Basic / fundamental discovery; yours is Epidemiology; the notice excludes Epidemiology.",
  "3_ibd_trialist_vs_population_genomics": "Clinical trials vs. required Genetic epidemiology.",
  "4_comp_genomics_vs_kidney_genomics": "Cross-cutting, from unit and design.",
  "5_lupus_trialist_vs_sle_trial": "Clinical trials vs. required Clinical trials.",
  "6a_human_immunologist_vs_besh": "Molecular / cellular mechanistic vs. required Molecular / cellular mechanistic.",
  "6b_human_immunologist_vs_cart_trial": "Human biospecimen / translational human biology vs. required Clinical trials.",
  "7a_hsr_vs_beta_cell_mechanism": "Paradigm: notice requires Molecular / cellular mechanistic, Basic / fundamental discovery; yours is Health services research; the notice excludes Health services research.",
  "7b_hsr_vs_dpp_implementation": "Health services research vs. required Implementation science.",
};

/** The nine caveats, verbatim: the binding constraint, in words, with its tone. */
const EXPECTED_CAVEAT: Record<string, { text: string; tone: string }> = {
  "1_tcell_lab_vs_survivorship_epi": {
    text: "Different kind of research: the notice funds epidemiology and population health; this profile's work is molecular / cellular mechanistic and animal-model research. Shared disease terms do not close this.",
    tone: "blocking",
  },
  "2_cvd_epi_vs_mito_mechanism": {
    text: "Different kind of research: the notice funds molecular / cellular mechanistic and basic / fundamental discovery; this profile's work is epidemiology and population health. Shared disease terms do not close this.",
    tone: "blocking",
  },
  "3_ibd_trialist_vs_population_genomics": {
    text: "Different kind of research: the notice funds genetic epidemiology and epidemiology; this profile's work is clinical trials and clinical observational. It holds the pair at Exploratory until that changes.",
    tone: "caution",
  },
  "4_comp_genomics_vs_kidney_genomics": { text: "The topic overlap is broad rather than specific — nothing coded at the depth Strong asks for.", tone: "caution" },
  "5_lupus_trialist_vs_sle_trial": { text: "No blocking constraint.", tone: "quiet" },
  "6a_human_immunologist_vs_besh": { text: "No blocking constraint.", tone: "quiet" },
  "6b_human_immunologist_vs_cart_trial": {
    text: "Different kind of research: the notice funds clinical trials; this profile's work is molecular / cellular mechanistic and human biospecimen / translational human biology. It holds the pair at Exploratory until that changes.",
    tone: "caution",
  },
  "7a_hsr_vs_beta_cell_mechanism": {
    text: "Different kind of research: the notice funds molecular / cellular mechanistic and basic / fundamental discovery; this profile's work is health services research and outcomes research. Shared disease terms do not close this.",
    tone: "blocking",
  },
  "7b_hsr_vs_dpp_implementation": { text: "The designs the notice expects are only partly evidenced — short of Strong, though none of them is a required design.", tone: "caution" },
};

// ---------------------------------------------------------------------------
// Every adversarial case
// ---------------------------------------------------------------------------

describe("verdicts · every adversarial case (spec §13)", () => {
  it("drives all nine cases end to end", () => {
    expect(driven.map((d) => d.id)).toEqual([
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
  });

  for (const c of cases) {
    const d = byId.get(c.id)!;
    describe(`${c.id} · ${c.title}`, () => {
      it("every slot is filled — no empty verdict, reason or caveat", () => {
        const v = d.verdicts;
        expect(["strong", "moderate", "exploratory", "cannot_assess", "ruled_out"]).toContain(v.label);
        for (const [slot, text] of [
          ["approach", v.approach.text],
          ["eligibility", v.eligibility.text],
          ["evidence", v.evidence.text],
          ["reason", v.reason],
        ] as const) {
          expect(text.trim(), `${slot} of ${c.id}`).not.toBe("");
        }
      });

      // the assertion the brief asks for by name
      it("caveat.text is non-empty", () => {
        expect(d.verdicts.caveat.text.trim(), `caveat of ${c.id}`).not.toBe("");
        expect(["quiet", "caution", "blocking"]).toContain(d.verdicts.caveat.tone);
      });

      it("a pair whose paradigm families differ never reads as the same approach", () => {
        const fam = expectedFamilies(c.investigator, c.opportunity);
        expect(fam.investigator, `${c.id} has no investigator family`).not.toBeNull();
        expect(fam.notice, `${c.id} has no notice family`).not.toBeNull();
        if (fam.investigator !== fam.notice) {
          expect(d.verdicts.approach.tone, `${c.id}: ${d.verdicts.approach.text}`).not.toBe("ok");
          expect(d.verdicts.approach.text).toContain("Different approach");
        }
        // and the converse: "ok" is only ever said about one family
        if (d.verdicts.approach.tone === "ok") expect(fam.investigator).toBe(fam.notice);
      });

      it("no Strong or Moderate row carries a blocking approach chip", () => {
        if (d.verdicts.label === "strong" || d.verdicts.label === "moderate") expect(d.verdicts.approach.tone, `${c.id}: ${d.verdicts.approach.text}`).not.toBe("blocking");
      });

      it("a pair that fails a gate is labelled ruled_out", () => {
        const r = d.scored.result;
        if (r.provenance.E.failed.length > 0 || r.tier === "poor") expect(d.verdicts.label, `${c.id}: tier ${r.tier}, E failed ${r.provenance.E.failed.length}`).toBe("ruled_out");
      });

      // §4.1 — `tiers.moderate.gap_not_in` includes "D_required", so a missed required
      // design group can never be the one allowed gap. The row must not read as "nearly there".
      it("a pair missing a required design group is never labelled moderate", () => {
        if (d.scored.result.provenance.D.unmet_required.length > 0) {
          expect(d.verdicts.label, `${c.id}: unmet ${JSON.stringify(d.scored.result.provenance.D.unmet_required)}`).not.toBe("moderate");
        }
      });

      it("eligibility says only who may apply — never a requirement", () => {
        const text = d.verdicts.eligibility.text.toLowerCase();
        for (const word of ["human subject", "human participant", "study design", "clinical trial required", "required design"]) {
          expect(text, `${c.id} eligibility leaked a requirement: ${d.verdicts.eligibility.text}`).not.toContain(word);
        }
      });

      it("the action is the label's verb for a strategist and nothing for the PI", () => {
        // written out, not read back from the map the code returns
        expect(d.verdicts.action).toEqual(EXPECTED_ACTION[d.verdicts.label]);
        expect(drive(c, { audience: "investigator" }).verdicts.action).toBeNull();
      });

      // §5: "those cases are exactly the rows that must not read as reassuring"
      it("a ruled-out row reads as ruled out in every slot", () => {
        if (d.verdicts.label !== "ruled_out") return;
        expect(d.verdicts.caveat.tone, d.id).toBe("blocking");
        for (const [slot, v] of [
          ["approach", d.verdicts.approach],
          ["eligibility", d.verdicts.eligibility],
          ["evidence", d.verdicts.evidence],
        ] as const) {
          expect(v.tone, `${c.id} ${slot}: ${v.text}`).not.toBe("ok");
        }
      });
    });
  }
});

// ---------------------------------------------------------------------------
// The four cases the assertions above are aimed at, named
// ---------------------------------------------------------------------------

describe("verdicts · §4.1 the required-design gap that makes Moderate unreachable", () => {
  const withUnmet = driven.filter((d) => d.scored.result.provenance.D.unmet_required.length > 0);

  it("five of the nine cases miss a required design group", () => {
    expect(withUnmet.map((d) => d.id)).toEqual([
      "1_tcell_lab_vs_survivorship_epi",
      "2_cvd_epi_vs_mito_mechanism",
      "3_ibd_trialist_vs_population_genomics",
      "6b_human_immunologist_vs_cart_trial",
      "7a_hsr_vs_beta_cell_mechanism",
    ]);
    expect(floors("moderate").gap_not_in).toContain("D_required");
  });

  it("none of them is Moderate, and none of them reads as a near miss", () => {
    for (const d of withUnmet) {
      expect(d.verdicts.label, d.id).not.toBe("moderate");
      expect(d.verdicts.caveat.tone, d.id).not.toBe("quiet");
    }
  });

  it("in all five, a gate or the requirement itself is the caveat — never a floor margin", () => {
    for (const d of withUnmet) expect(d.verdicts.caveat.text, d.id).toMatch(/^(Not eligible|The notice requires|Different kind of research)/);
  });

  it("the design requirement is the caveat when no gate outranks it, and it names the ceiling from taxonomy.json", () => {
    // every fixture that misses a required group is also paradigm-gated, and a gate outranks a
    // requirement, so the case is built: the one Moderate row with no caps, given a second
    // required design group its evidence cannot satisfy.
    const d = drive(designGapCase());
    expect(d.row.caps).toEqual(["design_required_unsupported"]);
    expect(d.verdicts.caveat.tone).toBe("caution");
    expect(d.verdicts.caveat.text).toContain("survey or qualitative");
    const ceiling = designGates().required_unsupported_cap_tier;
    expect(d.verdicts.caveat.text).toContain(`${ceiling[0]!.toUpperCase()}${ceiling.slice(1)} at best`);
    expect(d.verdicts.label).not.toBe("moderate");
  });
});

describe("verdicts · topic never gates (CLAUDE.md Terms)", () => {
  it("case 1 shares Cancer and MeSH C04 with the notice and still reads as a different approach", () => {
    const d = byId.get("1_tcell_lab_vs_survivorship_epi")!;
    const c = cases.find((x) => x.id === d.id)!;
    // the shared topic is real on both sides
    expect(c.investigator.topic.rcdc).toContain("Cancer");
    expect(c.opportunity.topic.rcdc).toContain("Cancer");
    expect(c.investigator.topic.mesh_major).toContain("C04");
    expect(c.opportunity.topic.mesh).toContain("C04");
    // and it buys the row nothing
    expect(d.verdicts.approach.tone).toBe("blocking");
    expect(d.verdicts.approach.text).toBe("Different approach · Discovery vs Population");
  });

  it("case 7a shares Diabetes and still reads as a different approach", () => {
    const d = byId.get("7a_hsr_vs_beta_cell_mechanism")!;
    expect(d.verdicts.approach.text).toBe("Different approach · Health systems vs Discovery");
    expect(d.verdicts.label).toBe("ruled_out");
  });

  it("only the three same-family pairs say 'Same approach', and every Strong row is one of them", () => {
    const same = driven.filter((d) => d.verdicts.approach.tone === "ok");
    expect(same.map((d) => d.id)).toEqual(["5_lupus_trialist_vs_sle_trial", "6a_human_immunologist_vs_besh", "7b_hsr_vs_dpp_implementation"]);
    for (const d of driven) if (d.verdicts.label === "strong") expect(d.verdicts.approach.tone, d.id).toBe("ok");
  });

  it("a cross-cutting side is a caution, not a block — the taxonomy takes that family out of the matrix", () => {
    const d = byId.get("4_comp_genomics_vs_kidney_genomics")!;
    const fam = expectedFamilies(cases.find((x) => x.id === d.id)!.investigator, cases.find((x) => x.id === d.id)!.opportunity);
    expect(fam.investigator).toBe("cross_cutting");
    expect(isMatrixFamily("cross_cutting")).toBe(false);
    expect(d.verdicts.approach).toEqual({ text: "Different approach · Cross-cutting vs Population, judged on unit and design", tone: "caution" });
    expect(d.verdicts.label).toBe("moderate");
  });

  it("the chip names what each side is, not the category that best supported the other", () => {
    const d = byId.get("2_cvd_epi_vs_mito_mechanism")!;
    // stage 2 stores the most charitable pair: clinical_observational 0.45, not the epidemiology 0.90 the person actually does
    expect(d.row.best_pair).toEqual({ investigator: "clinical_observational", notice: "molecular_cellular_mechanistic" });
    expect(familyOf("clinical_observational")).toBe("clinical");
    expect(d.verdicts.approach.text).toBe("Different approach · Population vs Discovery");
  });
});

// ---------------------------------------------------------------------------
// label
// ---------------------------------------------------------------------------

describe("verdicts · label", () => {
  it("the three surfaced tiers pass through", () => {
    expect(byId.get("5_lupus_trialist_vs_sle_trial")!.verdicts.label).toBe("strong");
    expect(byId.get("4_comp_genomics_vs_kidney_genomics")!.verdicts.label).toBe("moderate");
    expect(byId.get("3_ibd_trialist_vs_population_genomics")!.verdicts.label).toBe("exploratory");
  });

  it("a Poor row is ruled_out — the engine excluded it by a gate", () => {
    const poor = driven.filter((d) => d.scored.result.tier === "poor");
    expect(poor.map((d) => d.id)).toEqual(["1_tcell_lab_vs_survivorship_epi", "2_cvd_epi_vs_mito_mechanism", "7a_hsr_vs_beta_cell_mechanism"]);
    for (const d of poor) expect(d.verdicts.label, d.id).toBe("ruled_out");
  });

  it("a failed eligibility rule rules out a pair that would otherwise be Strong", () => {
    const c = cases.find((x) => x.id === "5_lupus_trialist_vs_sle_trial")!;
    // the fixture's investigator has held an R01 (defaults: esi false); an ESI-only notice excludes them
    const opportunity: OpportunityFitProfile = { ...c.opportunity, eligibility: { ...c.opportunity.eligibility, esi_only: true } };
    const d = drive({ ...c, opportunity });
    expect(d.scored.result.components.E).toBe(0);
    expect(d.scored.result.provenance.E.failed.length).toBeGreaterThan(0);
    expect(d.verdicts.label).toBe("ruled_out");
    expect(d.verdicts.eligibility.tone).toBe("blocking");
    expect(d.verdicts.eligibility.text).toContain("Not eligible · ESI-only notice");
    expect(d.verdicts.caveat.tone).toBe("blocking");
    expect(d.verdicts.caveat.text).toContain("Not eligible: ESI-only notice");
    expect(d.verdicts.action).toEqual({ label: "Dismiss", kind: "quiet" });
  });

  it("an incomplete notice profile is cannot_assess whatever the tier says", () => {
    const c = cases.find((x) => x.id === "5_lupus_trialist_vs_sle_trial")!;
    const d = drive(c, { noticeComplete: false });
    expect(d.scored.result.tier).toBe("strong");
    expect(d.verdicts.label).toBe("cannot_assess");
    expect(d.verdicts.action).toEqual({ label: "Read the notice", kind: "secondary" });
    expect(d.verdicts.caveat.text).toContain("incomplete");
    expect(d.verdicts.caveat.text).toContain(`${confidenceCap("low_notice_confidence")[0]!.toUpperCase()}${confidenceCap("low_notice_confidence").slice(1)} at best`);
  });

  it("the profile record's own sources.complete is read when the caller has no column value", () => {
    const c = cases.find((x) => x.id === "5_lupus_trialist_vs_sle_trial")!;
    const opportunity: OpportunityFitProfile = { ...c.opportunity, sources: { ...c.opportunity.sources, complete: false } };
    expect(drive({ ...c, opportunity }).verdicts.label).toBe("cannot_assess");
    // absent everywhere, a row counts as complete (D22, and both existing readers)
    expect(verdictLabelOf({ tier: "strong", components: byId.get("5_lupus_trialist_vs_sle_trial")!.row.components }, true)).toBe("strong");
  });

  it("an excluded pair stays ruled_out even when the notice is also incomplete", () => {
    const c = cases.find((x) => x.id === "5_lupus_trialist_vs_sle_trial")!;
    const opportunity: OpportunityFitProfile = { ...c.opportunity, eligibility: { ...c.opportunity.eligibility, esi_only: true } };
    expect(drive({ ...c, opportunity }, { noticeComplete: false }).verdicts.label).toBe("ruled_out");
  });
});

// ---------------------------------------------------------------------------
// eligibility
// ---------------------------------------------------------------------------

describe("verdicts · eligibility is who may apply", () => {
  it("a notice with no investigator rules says so", () => {
    const d = byId.get("5_lupus_trialist_vs_sle_trial")!;
    expect(d.verdicts.eligibility.text).toBe("Eligible · the notice names no investigator restrictions");
    expect(d.verdicts.eligibility.tone).toBe("ok");
  });

  it("the restrictions are the seven OpportunityEligibility fields and nothing else", () => {
    expect(
      eligibilityRestrictions({
        investigator_rules: ["Applicants must hold a faculty appointment."],
        esi_only: true,
        new_investigator_only: true,
        clinician_required: true,
        degree_required: "M.D.",
        independent_appointment_required: true,
        citizenship_rule: "US citizens and permanent residents",
      }),
    ).toEqual(["early-stage investigators only", "new investigators only", "clinician required", "M.D. required", "independent appointment required", "a citizenship rule applies", "1 further rule in the notice"]);
    expect(eligibilityRestrictions(null)).toEqual([]);
  });

  it("a rule stage 1 could not evaluate reads as unverified, never as a fail", () => {
    const c = cases.find((x) => x.id === "5_lupus_trialist_vs_sle_trial")!;
    const opportunity: OpportunityFitProfile = { ...c.opportunity, eligibility: { ...c.opportunity.eligibility, citizenship_rule: "US citizens and permanent residents" } };
    const d = drive({ ...c, opportunity });
    expect(d.scored.result.components.E).toBe(1);
    expect(d.row.caps).toContain("eligibility_unknown");
    expect(d.verdicts.eligibility.tone).toBe("caution");
    expect(d.verdicts.eligibility.text).toContain("Eligibility unverified · citizenship rule not evaluated");
    // an unknown is not a fail, but Strong's E floor is `pass_no_unknowns`, so the row lands at the cap's ceiling
    expect(floors("strong").E).toBe("pass_no_unknowns");
    expect(d.verdicts.label).toBe(confidenceCap("eligibility_unknown"));
    // and stage 7's "deadline not on file" flag is never mistaken for an eligibility unknown
    expect(d.verdicts.eligibility.text).not.toContain("deadline");
  });

  it("with no notice profile, eligibility is unverified rather than claimed either way", () => {
    const d = byId.get("5_lupus_trialist_vs_sle_trial")!;
    const v = fitVerdicts({ ...d.input, notice: null });
    expect(v.eligibility).toEqual({ text: "Eligibility unverified · no notice profile on file", tone: "caution" });
  });
});

// ---------------------------------------------------------------------------
// evidence
// ---------------------------------------------------------------------------

describe("verdicts · evidence in words", () => {
  const base = () => byId.get("5_lupus_trialist_vs_sle_trial")!;
  const withCounts = (publications_verified: number, grants: number, trials: number, caps: CapId[] = []) => {
    const d = base();
    const investigator: InvestigatorFitProfile = { ...d.input.investigator!, evidence_summary: { ...d.input.investigator!.evidence_summary, publications_verified, grants, trials } };
    return evidenceVerdict({ row: { ...d.row, caps: [...d.row.caps, ...caps] }, investigator });
  };

  it("thin is the engine's own AND — few items and no award — not either one alone", () => {
    const t = thinEvidence();
    // the shape `profile/aggregate.ts` calls thin: under both numbers
    expect(1).toBeLessThan(t.min_items);
    expect(0).toBeLessThan(t.min_grants);
    expect(withCounts(1, 0, 0)).toEqual({ text: "Thin · 1 paper; RePORTER not linked", tone: "caution" });
    expect(withCounts(0, 0, 0)).toEqual({ text: "Thin · no publications on file, RePORTER not linked", tone: "caution" });
    // and the shapes it does not: one award is enough on its own, and so are items
    expect(2).toBeGreaterThanOrEqual(t.min_items);
    expect(1).toBeGreaterThanOrEqual(t.min_grants);
    expect(withCounts(0, 1, 0).text.startsWith("Well evidenced · 1 award")).toBe(true);
    expect(withCounts(2, 0, 0).text.startsWith("Well evidenced · 2 papers")).toBe(true);
  });

  it("a record with no RePORTER link is not thin — it is well evidenced with a gap named", () => {
    // the design's own example is "Thin · 14 papers, RePORTER not linked"; 14 papers
    // is not a thin record, and calling it one is what makes the word useless
    expect(withCounts(14, 0, 0)).toEqual({ text: "Well evidenced · 14 papers; RePORTER not linked", tone: "caution" });
    expect(withCounts(48, 0, 6)).toEqual({ text: "Well evidenced · 48 papers, 6 trials; RePORTER not linked", tone: "caution" });
  });

  it("well evidenced and nothing missing is the only 'ok' the chip ever says", () => {
    expect(withCounts(48, 2, 4)).toEqual({ text: "Well evidenced · 48 papers, 2 awards, 4 trials", tone: "ok" });
  });

  it("what there is comes before what is missing, so a well-evidenced row never opens on a gap", () => {
    expect(withCounts(0, 2, 4)).toEqual({ text: "Well evidenced · 2 awards, 4 trials; no publications on file", tone: "caution" });
  });

  it("a low-confidence profile is thin however many items it lists", () => {
    const d = base();
    const row = { ...d.row, caps: [...d.row.caps, "low_profile_confidence" as const] };
    const investigator: InvestigatorFitProfile = { ...d.input.investigator!, evidence_summary: { ...d.input.investigator!.evidence_summary, publications_verified: 48, grants: 2, trials: 0 } };
    const v = evidenceVerdict({ row, investigator });
    expect(v.text.startsWith("Thin · ")).toBe(true);
    expect(v.tone).toBe("caution");
  });

  it("a thin notice is named on the evidence chip too", () => {
    const d = base();
    const row = { ...d.row, caps: [...d.row.caps, "low_notice_confidence" as const] };
    expect(evidenceVerdict({ row, investigator: d.input.investigator }).text).toContain("notice read from limited text");
  });

  it("with no investigator profile it says the assessment was not made", () => {
    const d = base();
    expect(evidenceVerdict({ row: d.row, investigator: null })).toEqual({ text: "Evidence not assessed · no fit profile on file", tone: "caution" });
  });
});

// ---------------------------------------------------------------------------
// reason and caveat
// ---------------------------------------------------------------------------

describe("verdicts · reason", () => {
  it("is one sentence of the rationale, verbatim, with the engine's numbers taken out", () => {
    for (const d of driven) expect(d.verdicts.reason, d.id).toBe(EXPECTED_REASON[d.id]);
  });

  it("carries no component value, no floor and no second clause", () => {
    for (const d of driven) {
      expect(d.verdicts.reason.split(" · "), d.id).toHaveLength(1);
      expect(d.verdicts.reason, d.id).not.toMatch(/\d+\.\d+/);
      expect(d.verdicts.reason.split(/(?<=\.)\s+(?=[A-Z])/), d.id).toHaveLength(1);
    }
  });

  it("the strip takes out exactly the engine's numeric voice and nothing else", () => {
    // The three shapes `engine/explain.ts` writes, each on a row with no
    // rationale of its own so the input is entirely this string. Deleting any
    // one of the three patterns fails here; so does widening the parenthetical
    // rule, which used to eat any bracket containing a decimal.
    const d = byId.get("5_lupus_trialist_vs_sle_trial")!;
    const reason = (rationale: string) => fitVerdicts(withRow(d, { rationale })).reason;
    expect(reason("Paradigm 0.45 — Clinical trials vs. required Genetic epidemiology")).toBe("Clinical trials vs. required Genetic epidemiology.");
    expect(reason("Yours is Molecular / cellular mechanistic (0.85, recent view) (support 0.05)")).toBe("Yours is Molecular / cellular mechanistic.");
    expect(reason("Clinical trials (yours 0.85) vs. required Clinical trials")).toBe("Clinical trials vs. required Clinical trials.");
    expect(reason("Topic 0.30 is below the Exploratory floor 0.35, and nothing else binds")).toBe("And nothing else binds.");
    // a citation, a year range, and a reconciler's own parenthetical all survive
    expect(reason("Trial leadership in SLE (PMID:123) matches the notice's design")).toBe("Trial leadership in SLE (PMID:123) matches the notice's design.");
    expect(reason("Two completed trials (2019-2024) in this population")).toBe("Two completed trials (2019-2024) in this population.");
    expect(reason("The cohort reports a survival benefit (HR 0.62) over five years")).toBe("The cohort reports a survival benefit (HR 0.62) over five years.");
    expect(reason("Enrolment closed with 412 participants (mean follow-up 4.5 years)")).toBe("Enrolment closed with 412 participants (mean follow-up 4.5 years).");
  });

  it("keeps the excluded-paradigm note the ` · ` split would drop", () => {
    // `engine/explain.ts` appends it *inside* the Paradigm clause with the same
    // separator the clauses are joined by, so a plain split discards the single
    // most decisive paradigm fact on the row.
    const d = byId.get("5_lupus_trialist_vs_sle_trial")!;
    const rationale = "Paradigm 0.12 — Clinical trials (yours 0.85) vs. required Genetic epidemiology · Epidemiology excluded · Unit 0.60 — patient vs. required patient";
    expect(fitVerdicts(withRow(d, { rationale })).reason).toBe("Clinical trials vs. required Genetic epidemiology — the notice excludes Epidemiology.");
    // and an ordinary second clause is still dropped
    const plain = "Paradigm 0.42 — Clinical trials vs. required Clinical trials · Unit 0.60 — patient vs. required patient";
    expect(fitVerdicts(withRow(d, { rationale: plain })).reason).toBe("Clinical trials vs. required Clinical trials.");
  });

  it("a judged row's paragraph reaches the row as its first sentence", () => {
    // the reconciler writes prose with no ` · ` in it, so the split returns the
    // whole paragraph — §2.2's 50–90 words, in the slot meant to hold one line
    const d = byId.get("5_lupus_trialist_vs_sle_trial")!;
    const paragraph =
      "Trial leadership in SLE matches the notice's required design. The skeptic objected that the two most recent trials are industry-sponsored, which the reconciler accepted in part. The pair stands at Moderate with the correction applied.";
    const row: FitResultVerdictRow = { ...d.row, rationale: paragraph, judged_at: "2026-09-01T00:00:00.000Z" };
    expect(fitVerdicts({ ...d.input, row }).reason).toBe("Trial leadership in SLE matches the notice's required design.");
  });

  it("a rationale that carries no numbers is passed through untouched", () => {
    // the reconciler writes prose, so a judged row must not be reshaped by the strip
    const d = byId.get("5_lupus_trialist_vs_sle_trial")!;
    const prose = "Trial leadership in SLE matches the notice's required design";
    expect(fitVerdicts({ ...d.input, row: { ...d.row, rationale: prose } }).reason).toBe(`${prose}.`);
  });

  it("a ruled-out row reads its why_not, so §3f's shown exclusions are inspectable", () => {
    const d = byId.get("1_tcell_lab_vs_survivorship_epi")!;
    // a Poor row is stored with rationale null (results.ts `toFitResultRow`); `why_not`
    // is the one sentence it does carry, and without it every ruled-out row on the
    // surface would read "No rationale stored." — which defeats catching a wrong exclusion.
    expect(d.row.rationale).toBeNull();
    expect(d.row.why_not).toBeTruthy();
    expect(d.verdicts.reason).not.toBe("No rationale stored.");
    // one sentence out of the engine's several, and none of its numbers
    expect(d.verdicts.reason.split(/(?<=\.)\s+(?=[A-Z])/)).toHaveLength(1);
    expect(d.verdicts.reason).not.toMatch(/\d+\.\d+/);
    expect(d.verdicts.reason).toContain("Epidemiology");
    expect(d.row.why_not!).toMatch(/\d+\.\d+/); // the source really does carry them
  });

  it("only a row with neither rationale, why_not nor a missed floor falls all the way through", () => {
    const d = byId.get("1_tcell_lab_vs_survivorship_epi")!;
    const components = { E: 1, P: 1, U: 1, D: 1, T: 1, M: 1, O: 1, K: 1, A: 1 };
    expect(reasonOf({ row: { ...d.row, rationale: null, why_not: null, components }, notice: null, investigator: null, lookup: EMPTY_LOOKUP })).toBe("No rationale stored.");
  });

  it("a judged row's citations are resolved by explain-view, not re-implemented here", () => {
    const d = byId.get("5_lupus_trialist_vs_sle_trial")!;
    const row: FitResultVerdictRow = {
      ...d.row,
      rationale: "Trial leadership in SLE (PMID:123) matches the notice's required design.",
      judged_at: "2026-09-01T00:00:00.000Z",
      judged_evidence: [{ id: "PMID:123", ref: "publication:inv-1:123" }],
    };
    expect(fitVerdicts({ ...d.input, row }).reason).toBe("Trial leadership in SLE (PMID:123) matches the notice's required design.");
  });
});

describe("verdicts · caveat precedence", () => {
  it("a failed gate outranks the design requirement below it", () => {
    const c = designGapCase();
    expect(drive(c).verdicts.caveat.text).toContain("The notice requires");
    const opportunity: OpportunityFitProfile = { ...c.opportunity, eligibility: { ...c.opportunity.eligibility, esi_only: true } };
    expect(drive({ ...c, opportunity }).verdicts.caveat.text.startsWith("Not eligible:")).toBe(true);
  });

  it("the design requirement outranks the confidence caps below it", () => {
    const c = designGapCase();
    const d = drive(c, { noticeComplete: false });
    expect(d.verdicts.label).toBe("cannot_assess");
    expect(d.verdicts.caveat.text).toContain("The notice requires");
  });

  it("the paradigm gate outranks the unmet design requirement", () => {
    const d = byId.get("2_cvd_epi_vs_mito_mechanism")!;
    expect(d.row.caps).toEqual(expect.arrayContaining(["paradigm_gate", "design_required_unsupported"]));
    expect(d.verdicts.caveat.tone).toBe("blocking");
    // the chip above the caveat already says "Different approach · Population vs Discovery",
    // so the caveat earns its slot by naming categories the chip does not (§2.7)
    expect(d.verdicts.approach.text).toBe("Different approach · Population vs Discovery");
    expect(d.verdicts.caveat.text).toMatch(/^Different kind of research: the notice funds .+; this profile's work is .+\./);
    expect(d.verdicts.caveat.text).toContain("Shared disease terms do not close this.");
  });

  it("every fixture's caveat is the one it should be, verbatim", () => {
    for (const d of driven) expect({ text: d.verdicts.caveat.text, tone: d.verdicts.caveat.tone }, d.id).toEqual(EXPECTED_CAVEAT[d.id]);
  });

  it("no caveat on any fixture carries a component value or a floor (§2.5, §3a)", () => {
    // The redesign's whole move is that the decision surface stops speaking in the
    // inspector's numbers: "Topic 0.55 is below the Strong floor 0.6" is what the row
    // must never say. Every component value and every floor in taxonomy.json is checked
    // against each of the four rendered strings, in both raw and 2-dp forms.
    //
    // Only the fractional ones: components and floors live in [0, 1], while the counts
    // the evidence chip is *supposed* to carry are whole numbers ("48 papers, 2 awards",
    // and taxonomy's own integer keys `T_specific_depth` and `gaps_allowed`).
    const fractional = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && !Number.isInteger(v);
    const forbidden = new Set<string>();
    for (const tier of ["strong", "moderate", "exploratory"] as const) {
      for (const v of Object.values(floors(tier))) {
        if (fractional(v)) {
          forbidden.add(String(v));
          forbidden.add(v.toFixed(2));
        }
      }
    }
    for (const d of driven) {
      for (const v of Object.values(d.row.components)) {
        if (fractional(v)) forbidden.add(v.toFixed(2));
      }
      const surface = [d.verdicts.caveat.text, d.verdicts.approach.text, d.verdicts.eligibility.text, d.verdicts.evidence.text, d.verdicts.reason];
      for (const text of surface) {
        for (const n of forbidden) {
          expect(text.includes(n), `${d.id}: "${text}" leaks ${n}`).toBe(false);
        }
      }
    }
  });

  it("nothing binding says so plainly, and never reaches for the nearest floor", () => {
    const d = byId.get("5_lupus_trialist_vs_sle_trial")!;
    expect(d.row.caps).toEqual([]);
    const near = nearestFloor(d.row.components, d.row.tier)!;
    expect(near.margin).toBeGreaterThanOrEqual(0);
    expect(d.verdicts.caveat.tone).toBe("quiet");
    expect(d.verdicts.caveat.text.startsWith("No blocking constraint.")).toBe(true);
    // the value and the floor that `nearestFloor` computes stay off the decision surface (§2.5, §3a)
    expect(d.verdicts.caveat.text).not.toContain(String(near.floor));
    expect(d.verdicts.caveat.text).not.toContain(near.value.toFixed(2));
  });

  it("a Moderate row's caveat is measured against the Strong floors from taxonomy.json", () => {
    const d = byId.get("4_comp_genomics_vs_kidney_genomics")!;
    const near = nearestFloor(d.row.components, "moderate")!;
    expect(near.tier).toBe("strong");
    expect(near.component).toBe("T");
    expect(near.floor).toBe(floors("strong").T);
    expect(near.margin).toBeLessThan(0);
    // the floor it is measured against is Strong's, from taxonomy.json — but the row says
    // what is absent, not the arithmetic (§2.5: the inspector voice comes off this surface)
    expect(d.verdicts.caveat.tone).toBe("caution");
    expect(d.verdicts.caveat.text).toContain("Strong");
    expect(d.verdicts.caveat.text).toContain("broad rather than specific");
    expect(d.verdicts.caveat.text).not.toContain(String(floors("strong").T));
    expect(d.verdicts.caveat.text).not.toContain(d.row.components.T.toFixed(2));
  });

  it("nearestFloor is null without components, and the caveat then says so plainly", () => {
    const d = byId.get("5_lupus_trialist_vs_sle_trial")!;
    expect(nearestFloor(null, "strong")).toBeNull();
    const row = { ...d.row, components: null as unknown as FitResultVerdictRow["components"] };
    expect(caveatOf({ ...d.input, row })).toEqual({ text: "No blocking constraint.", tone: "quiet" });
  });
});

// ---------------------------------------------------------------------------
// action (§3h)
// ---------------------------------------------------------------------------

describe("verdicts · action (§3h)", () => {
  it("one verb per label", () => {
    expect(VERDICT_ACTION).toEqual({
      strong: { label: "Add to outreach", kind: "primary" },
      moderate: { label: "See what's missing", kind: "secondary" },
      exploratory: { label: "Keep as a lead", kind: "secondary" },
      cannot_assess: { label: "Read the notice", kind: "secondary" },
      ruled_out: { label: "Dismiss", kind: "quiet" },
    });
  });

  it("the PI audience has no per-row action at all", () => {
    for (const label of ["strong", "moderate", "exploratory", "cannot_assess", "ruled_out"] as const) {
      expect(actionOf(label, "investigator")).toBeNull();
      expect(actionOf(label, "strategist")).toEqual(EXPECTED_ACTION[label]);
    }
  });
});

// ---------------------------------------------------------------------------
// Purity (CLAUDE.md: everything under lib/fit that scores is pure)
// ---------------------------------------------------------------------------

describe("verdicts · purity", () => {
  it("the same input gives a byte-identical result and mutates nothing", () => {
    for (const c of cases) {
      const d = drive(c);
      const before = JSON.stringify([d.row, c.investigator, c.opportunity]);
      const a = JSON.stringify(fitVerdicts(d.input));
      const b = JSON.stringify(fitVerdicts(d.input));
      expect(b, c.id).toBe(a);
      expect(JSON.stringify([d.row, c.investigator, c.opportunity]), c.id).toBe(before);
    }
  });

  it("frozen inputs render without a write", () => {
    for (const c of cases) {
      const d = drive(c);
      const frozen: VerdictInput = { ...d.input, row: Object.freeze(d.row), notice: Object.freeze(c.opportunity), investigator: Object.freeze(c.investigator) };
      expect(() => fitVerdicts(frozen), c.id).not.toThrow();
    }
  });

  it("approachFamilies reads no topic field", () => {
    const d = byId.get("1_tcell_lab_vs_survivorship_epi")!;
    const c = cases.find((x) => x.id === d.id)!;
    const stripped: VerdictInput = {
      ...d.input,
      notice: { ...c.opportunity, topic: { mesh: [], rcdc: [], terms: [], free_text: null } },
      investigator: { ...c.investigator, topic: { mesh_major: [], rcdc: [], free_text: null } },
    };
    expect(approachFamilies(stripped)).toEqual(approachFamilies(d.input));
  });
});

// ---------------------------------------------------------------------------
// The fourteen findings the validator raised, each with the input that showed it
// ---------------------------------------------------------------------------

const strong = () => byId.get("5_lupus_trialist_vs_sle_trial")!;
const strongCase = () => cases.find((x) => x.id === "5_lupus_trialist_vs_sle_trial")!;

/** Fixture 5 with the topic score supplied low: right methods, wrong disease — Poor on the Topic floor alone, with no cap and no gate. */
function topicOnlyPoorCase(): AdversarialCase {
  const c = strongCase();
  return { ...c, ctx: { ...c.ctx, topic: { ...c.ctx.topic, override: 0.3 } } };
}

describe("verdicts · F1/F2 a pair ruled out on a floor alone", () => {
  const d = drive(topicOnlyPoorCase());

  it("is Poor with nothing but the Topic floor behind it — no cap, no gate, no failed rule", () => {
    expect(d.scored.result.tier).toBe("poor");
    expect(d.row.caps).toEqual([]);
    expect(d.row.flags).toEqual([]);
    expect(d.row.rationale).toBeNull();
    expect(d.row.why_not).toBe(`Topic ${d.row.components.T.toFixed(2)} is below the Exploratory floor ${floors("exploratory").T}.`);
  });

  it("does not render its reason as a bare full stop", () => {
    // the strip removes the whole sentence; `sentence()` returns "." and "." is truthy,
    // so the fallback never fired and the row showed a single character
    expect(d.verdicts.reason).not.toBe(".");
    expect(d.verdicts.reason.replace(/[^A-Za-z0-9]/g, "").length).toBeGreaterThan(20);
  });

  it("says the missed floor in words instead — the caveat's words, not the engine's numbers", () => {
    expect(d.verdicts.reason).toBe("The topic overlap is broad rather than specific — nothing coded at the depth Exploratory asks for.");
    expect(d.verdicts.reason).not.toMatch(/\d/);
  });

  it("reads as ruled out in every slot, not reassuring in all four", () => {
    expect(d.verdicts.label).toBe("ruled_out");
    expect(d.verdicts.caveat.tone).toBe("blocking");
    expect(d.verdicts.caveat.text).toBe("Ruled out: the topic overlap is broad rather than specific — nothing coded at the depth Exploratory asks for.");
    expect(d.verdicts.approach.tone).toBe("caution"); // "Same approach · Clinical" is true, and not green on a ruled-out row
    expect(d.verdicts.approach.text).toBe("Same approach · Clinical");
    expect(d.verdicts.eligibility.tone).not.toBe("ok");
    expect(d.verdicts.evidence.tone).not.toBe("ok");
  });

  it("and the caveat does not simply repeat the reason", () => {
    expect(d.verdicts.caveat.text).not.toBe(d.verdicts.reason);
  });
});

describe("verdicts · F2 label and tone cohere over generated rows", () => {
  // Nine fixtures × the shapes stage 1, 8 and 9 write, driven through `fitVerdicts`
  // rather than reasoned about: the invariant is a property of the row, so it is
  // asserted over inputs, not over the four cases someone thought of.
  const CAP_SETS: CapId[][] = [[], ["paradigm_gate"], ["unit_gate"], ["design_required_unsupported"], ["eligibility_unknown"], ["low_profile_confidence"], ["low_notice_confidence"], ["readiness_far"], ["runway_short"], ["stage8_verdict"], ["stage8_objection"], ["stage8_pending_confirmation"], ["paradigm_gate_relaxed_aspiration"], ["paradigm_gate_relaxed_translational_bridge"]];
  const FLAG_SETS: string[][] = [[], ["already in the Outreach pipeline"], ["dismissed by this investigator within the suppression window"], ["deadline not on file"], ["excluded: ESI-only notice; investigator has held an R01-equivalent award"], ["excluded: deadline has passed"], ["excluded: self-declared do-not-suggest: clinical"], ["citizenship rule not evaluated: \"US citizens\""]];
  const TIERS = ["strong", "moderate", "exploratory", "poor"] as const;

  function* generated(): Generator<{ what: string; input: VerdictInput; verdicts: FitVerdicts }> {
    for (const d of driven) {
      for (const tier of TIERS) {
        for (const caps of CAP_SETS) {
          for (const flags of FLAG_SETS) {
            for (const notice of [d.input.notice, null]) {
              for (const complete of [true, false]) {
                const input: VerdictInput = { ...d.input, notice, noticeComplete: complete, row: { ...d.row, tier, caps, flags } };
                yield { what: `${d.id} tier=${tier} caps=${JSON.stringify(caps)} flags=${JSON.stringify(flags)} notice=${notice ? "loaded" : "null"} complete=${complete}`, input, verdicts: fitVerdicts(input) };
              }
            }
          }
        }
      }
    }
  }

  it("covers every combination without throwing, and fills every slot", () => {
    let n = 0;
    for (const g of generated()) {
      n += 1;
      expect(g.verdicts.reason.trim(), g.what).not.toBe("");
      expect(g.verdicts.caveat.text.trim(), g.what).not.toBe("");
      expect(g.verdicts.caveat.text.trim(), g.what).not.toBe(".");
      for (const v of [g.verdicts.approach, g.verdicts.eligibility, g.verdicts.evidence]) expect(v.text.trim(), g.what).not.toBe("");
    }
    expect(n).toBe(driven.length * TIERS.length * CAP_SETS.length * FLAG_SETS.length * 2 * 2);
  });

  it("a ruled-out row never carries an 'ok' chip and always carries a blocking caveat", () => {
    for (const g of generated()) {
      if (g.verdicts.label !== "ruled_out") continue;
      expect(g.verdicts.caveat.tone, `${g.what}: ${g.verdicts.caveat.text}`).toBe("blocking");
      for (const [slot, v] of [
        ["approach", g.verdicts.approach],
        ["eligibility", g.verdicts.eligibility],
        ["evidence", g.verdicts.evidence],
      ] as const) {
        expect(v.tone, `${g.what} ${slot}: ${v.text}`).not.toBe("ok");
      }
    }
  });

  it("and the quiet 'nothing binds' caveat is only ever said on a row nothing binds", () => {
    // the flags that bind: stage 1's exclusions and the three behind Strong's `A` floor.
    // An eligibility unknown binds through its cap, so the flag alone is not one.
    const binding = ["already in the Outreach pipeline", "dismissed by this investigator within the suppression window", "deadline not on file"];
    for (const g of generated()) {
      if (g.verdicts.caveat.tone !== "quiet") continue;
      expect(g.verdicts.label, g.what).not.toBe("ruled_out");
      expect(g.input.row.caps, g.what).toEqual([]);
      expect(g.input.notice, g.what).not.toBeNull();
      expect(g.input.noticeComplete, g.what).toBe(true);
      for (const f of g.input.row.flags ?? []) expect(binding.includes(f) || f.startsWith("excluded: "), `${g.what}: ${f}`).toBe(false);
    }
  });
});

describe("verdicts · F3 the stage-8 caps", () => {
  const judged = { judged_at: "2026-09-02T00:00:00.000Z", judged_from: "strong" as const, judged_tier: "moderate" as const };

  it("no stage-8 cap is a gate, a confidence cap or a component with a floor", () => {
    // why the row fell through to "No blocking constraint.": nothing else could see them
    const d = strong();
    for (const cap of ["stage8_verdict", "stage8_objection", "stage8_pending_confirmation"] as const) {
      expect(nearestFloor(d.row.components, "strong")!.margin).toBeGreaterThanOrEqual(0);
      expect(Object.keys(floors("strong"))).not.toContain(cap);
    }
  });

  it("names what stage 8 did, and never says nothing binds", () => {
    const d = strong();
    expect(caveatOf(withRow(d, { caps: ["stage8_objection"] }))).toEqual({ text: "A grounded objection from the skeptic pass lowered this pair.", tone: "caution" });
    expect(caveatOf(withRow(d, { caps: ["stage8_verdict"] })).text).toBe("The blind pass read this pair lower than the structured score, and it is held at the judged tier.");
    expect(caveatOf(withRow(d, { caps: ["stage8_pending_confirmation"] })).text).toContain("until a strategist confirms the correction");
  });

  it("names the move when the row carries stage 8's own tiers", () => {
    const d = strong();
    expect(caveatOf(withRow(d, { caps: ["stage8_objection"], ...judged })).text).toBe("A grounded objection from the skeptic pass lowered this pair, Strong to Moderate.");
  });

  it("but a gate, a requirement and a confidence cap all outrank it", () => {
    const d = strong();
    expect(caveatOf(withRow(d, { caps: ["stage8_objection", "low_notice_confidence"] })).text).toContain("limited text");
    const gated = byId.get("2_cvd_epi_vs_mito_mechanism")!;
    expect(caveatOf(withRow(gated, { caps: [...gated.row.caps, "stage8_objection"] })).text).toMatch(/^Different kind of research/);
  });
});

describe("verdicts · F4 Strong's A floor, which leaves a flag and no cap", () => {
  const inPipeline = (patch: Partial<AdversarialCase["ctx"]["actionability"]>): AdversarialCase => {
    const c = strongCase();
    return { ...c, ctx: { ...c.ctx, actionability: { ...c.ctx.actionability, ...patch } } };
  };

  it("the engine writes the flag and no cap — which is why nothing reached the caveat", () => {
    const d = drive(inPipeline({ in_pipeline: true }));
    expect(d.row.caps).toEqual([]);
    expect(d.row.flags).toEqual(["already in the Outreach pipeline"]);
    expect(floors("strong").A).toBe("runway_ok_not_in_pipeline");
    expect(d.scored.result.tier).not.toBe("strong"); // the floor really is what moved it
  });

  it("says the pair is already in the queue, and does not send the strategist looking for a gap", () => {
    const d = drive(inPipeline({ in_pipeline: true }));
    expect(d.verdicts.caveat).toEqual({ text: "Already in the Outreach pipeline.", tone: "caution" });
    expect(d.verdicts.action).not.toEqual(EXPECTED_ACTION.moderate);
    expect(d.verdicts.action).toEqual({ label: "Open in Outreach", kind: "quiet" });
    expect(drive(inPipeline({ in_pipeline: true }), { audience: "investigator" }).verdicts.action).toBeNull();
  });

  it("a recent dismissal and a missing deadline are the other two, and each says itself", () => {
    expect(drive(inPipeline({ recently_dismissed: true })).verdicts.caveat.text).toBe("Dismissed by this investigator recently enough to still be suppressed.");
    expect(drive(inPipeline({ runway_weeks: null })).verdicts.caveat.text).toBe("The notice has no deadline on file, so there is no runway to check.");
  });

  it("but a cap still outranks all three", () => {
    const d = drive(inPipeline({ in_pipeline: true }), { noticeComplete: false });
    expect(d.verdicts.caveat.text).toContain("incomplete");
  });
});

describe("verdicts · F6 how red a difference of approach is comes from the matrix", () => {
  const base = () => strong();
  const approachFor = (investigatorCategory: string, noticeCategory: string) => {
    const d = base();
    return approachVerdict({
      row: { ...d.row, best_pair: null },
      investigator: { ...d.input.investigator!, paradigm: { recent: { [investigatorCategory]: 0.9 }, career: {} } } as InvestigatorFitProfile,
      notice: { ...d.input.notice!, paradigm: { ...d.input.notice!.paradigm, required: { [noticeCategory]: 0.9 }, required_any: {} } } as OpportunityFitProfile,
    });
  };

  it("the graded pair the translational bridge exists for is not the same chip as the far pair", () => {
    expect(familyCompat("translational", "clinical")).toBeGreaterThanOrEqual(paradigmGates().poor_below);
    expect(familyCompat("health_systems", "discovery")).toBeLessThan(paradigmGates().poor_below);
    expect(approachFor("translational", "clinical_trials")).toEqual({ text: "Different approach · Translational human biology vs Clinical", tone: "caution" });
    expect(approachFor("health_services", "basic_discovery")).toEqual({ text: "Different approach · Health systems vs Discovery", tone: "blocking" });
  });

  it("every matrix pair is blocking exactly when its compatibility is under the gate that makes a pair Poor", () => {
    const CATEGORY: Record<string, string> = {
      discovery: "basic_discovery",
      preclinical: "animal_model",
      translational: "translational",
      clinical: "clinical_trials",
      population: "epidemiology",
      health_systems: "health_services",
    };
    for (const [a, ca] of Object.entries(CATEGORY)) {
      for (const [b, cb] of Object.entries(CATEGORY)) {
        const v = approachFor(ca, cb);
        if (a === b) {
          expect(v.tone, `${a}/${b}`).toBe("ok");
          continue;
        }
        const expected = familyCompat(a, b) < paradigmGates().poor_below ? "blocking" : "caution";
        expect(v.tone, `${a}/${b} compat ${familyCompat(a, b)}: ${v.text}`).toBe(expected);
      }
    }
  });

  it("cross-cutting stays outside the matrix, and says so rather than being scored by it", () => {
    expect(() => familyCompat("cross_cutting", "population")).toThrow();
    expect(approachFor("computational_data_science", "epidemiology")).toEqual({ text: "Different approach · Cross-cutting vs Population, judged on unit and design", tone: "caution" });
  });
});

describe("verdicts · F7 the dominant family is the heaviest category, not the biggest family", () => {
  it("a discovery profile with five small population side lines is Discovery", () => {
    // `population` has six categories and `discovery` two, so a sum lets breadth win
    const d = strong();
    const recent = { basic_discovery: 0.9, epidemiology: 0.2, population_health: 0.2, public_health: 0.2, community_based: 0.2, behavioral: 0.2 };
    const sums = { discovery: 0.9, population: 1.0 };
    expect(sums.population).toBeGreaterThan(sums.discovery); // the sum reading really does flip
    const investigator = { ...d.input.investigator!, paradigm: { recent, career: {} } } as InvestigatorFitProfile;
    expect(approachFamilies({ ...d.input, investigator }).investigator).toBe("discovery");
  });

  it("and the fixture the change was made for still reads as itself", () => {
    // fixture 2: `best_pair.investigator` is clinical_observational (0.45); the person is an epidemiologist (0.90)
    const d = byId.get("2_cvd_epi_vs_mito_mechanism")!;
    expect(d.row.best_pair).toEqual({ investigator: "clinical_observational", notice: "molecular_cellular_mechanistic" });
    expect(d.verdicts.approach.text).toBe("Different approach · Population vs Discovery");
  });

  it("the recent view is preferred over the career view", () => {
    // no fixture carries both views, so the preference had no coverage at all
    const d = strong();
    const investigator = { ...d.input.investigator!, paradigm: { recent: { epidemiology: 0.9 }, career: { clinical_trials: 0.9 } } } as InvestigatorFitProfile;
    expect(approachFamilies({ ...d.input, investigator }).investigator).toBe("population");
    const careerOnly = { ...investigator, paradigm: { recent: {}, career: { clinical_trials: 0.9 } } } as InvestigatorFitProfile;
    expect(approachFamilies({ ...d.input, investigator: careerOnly }).investigator).toBe("clinical");
  });
});

describe("verdicts · F8 the notice's any-of set is a disjunction (D14)", () => {
  it("fixture 6a is Strong, and its chip says so", () => {
    const d = byId.get("6a_human_immunologist_vs_besh")!;
    expect(d.verdicts.label).toBe("strong");
    expect(d.verdicts.approach).toEqual({ text: "Same approach · Discovery", tone: "ok" });
  });

  it("and its `best_pair` is the same category on both sides — the fault it shows is a misnamed family, not a contradicted tier", () => {
    const d = byId.get("6a_human_immunologist_vs_besh")!;
    expect(d.row.best_pair).toEqual({ investigator: "molecular_cellular_mechanistic", notice: "molecular_cellular_mechanistic" });
    expect(familyOf("molecular_cellular_mechanistic")).toBe("discovery");
  });
});

describe("verdicts · F9 two stage-1 failures that are not eligibility facts (§3e)", () => {
  const failing = (patch: Partial<AdversarialCase>) => drive({ ...strongCase(), ...patch });

  it("a passed deadline is actionability, and is never called ineligibility", () => {
    const c = strongCase();
    const d = failing({ ctx: { ...c.ctx, actionability: { ...c.ctx.actionability, runway_weeks: -3 } } });
    expect(d.scored.result.provenance.E.failed).toContain("deadline has passed");
    expect(d.verdicts.label).toBe("ruled_out");
    expect(d.verdicts.eligibility.text).not.toContain("Not eligible");
    expect(d.verdicts.caveat).toEqual({ text: "The deadline has passed.", tone: "blocking" });
  });

  it("a self-declared do-not-suggest family is the investigator's own preference, said as one", () => {
    const c = strongCase();
    const d = failing({ investigator: { ...c.investigator, do_not_suggest: ["clinical"] } });
    expect(d.scored.result.provenance.E.failed).toEqual(["self-declared do-not-suggest: clinical"]);
    expect(d.verdicts.label).toBe("ruled_out");
    expect(d.verdicts.eligibility.text).toBe("Not suggested · this profile asks not to be shown Clinical notices");
    expect(d.verdicts.eligibility.text).not.toContain("Not eligible");
    expect(d.verdicts.caveat).toEqual({ text: "This profile asks not to be shown Clinical notices, which is what this one funds.", tone: "blocking" });
  });

  it("a real investigator rule still fails as one, and outranks both", () => {
    const c = strongCase();
    const opportunity: OpportunityFitProfile = { ...c.opportunity, eligibility: { ...c.opportunity.eligibility, esi_only: true } };
    const d = failing({ opportunity, investigator: { ...c.investigator, do_not_suggest: ["clinical"] }, ctx: { ...c.ctx, actionability: { ...c.ctx.actionability, runway_weeks: -3 } } });
    expect(d.verdicts.eligibility.text).toContain("Not eligible · ESI-only notice");
    expect(d.verdicts.caveat.text.startsWith("Not eligible: ESI-only notice")).toBe(true);
  });
});

describe("verdicts · F10 a missing notice profile", () => {
  it("noticeComplete is required, and the record's own false is still believed", () => {
    const d = strong();
    // @ts-expect-error — the field a caller must not be able to forget (D22, §4.2)
    const missing: VerdictInput = { row: d.row, notice: d.input.notice, investigator: d.input.investigator, lookup: EMPTY_LOOKUP, audience: "strategist" };
    expect(missing).toBeTruthy();
    expect(noticeIsComplete({ notice: d.input.notice, noticeComplete: true })).toBe(true);
    expect(noticeIsComplete({ notice: d.input.notice, noticeComplete: false })).toBe(false);
    const incompleteRecord = { ...d.input.notice!, sources: { ...d.input.notice!.sources, complete: false } };
    expect(noticeIsComplete({ notice: incompleteRecord, noticeComplete: true })).toBe(false);
  });

  it("degrades honestly rather than rendering a confident Strong row", () => {
    const d = strong();
    const v = fitVerdicts({ ...d.input, notice: null });
    // the assessment did happen, with the profile, at scoring time — the tier stands
    expect(v.label).toBe("strong");
    expect(v.approach).toEqual({ text: "Approach not established · no notice profile on file", tone: "caution" });
    expect(v.eligibility).toEqual({ text: "Eligibility unverified · no notice profile on file", tone: "caution" });
    expect(v.caveat).toEqual({ text: "The notice profile is not on file, so nothing in the notice was checked against this evidence.", tone: "caution" });
  });

  it("even though `best_pair` would have let the chip name a family anyway", () => {
    const d = strong();
    expect(d.row.best_pair?.notice).toBe("clinical_trials");
    expect(approachFamilies({ ...d.input, notice: null }).notice).toBe("clinical");
    expect(fitVerdicts({ ...d.input, notice: null }).approach.text).not.toContain("Same approach");
  });

  it("and a real constraint still outranks the missing profile", () => {
    const d = byId.get("2_cvd_epi_vs_mito_mechanism")!;
    expect(fitVerdicts({ ...d.input, notice: null }).caveat.text).toMatch(/^Different kind of research/);
  });
});

describe("verdicts · F11 a constraint outranks an encouragement", () => {
  const withTeam = (mechanism: Partial<OpportunityFitProfile["mechanism"]>, team: Partial<OpportunityFitProfile["team"]>) => {
    const d = strong();
    const notice: OpportunityFitProfile = { ...d.input.notice!, mechanism: { ...d.input.notice!.mechanism, ...mechanism }, team: { ...d.input.notice!.team, ...team } };
    return caveatOf({ ...d.input, notice });
  };

  it("a clinical trialist is told trials are not allowed, not that multi-PI is", () => {
    const both = withTeam({ clinical_trial: "not_allowed" }, { multi_pi_allowed: true, consortium_required: true });
    expect(both.text).toBe("No blocking constraint. Clinical trials are not allowed.");
    expect(both.text).not.toContain("Multi-PI");
  });

  it("a required consortium outranks multi-PI too, and multi-PI is still said when it is all there is", () => {
    expect(withTeam({ clinical_trial: "optional" }, { multi_pi_allowed: true, consortium_required: true }).text).toBe("No blocking constraint. A consortium is required.");
    expect(withTeam({ clinical_trial: "optional" }, { multi_pi_allowed: true, consortium_required: false }).text).toBe("No blocking constraint. Multi-PI allowed.");
  });

  it("and the adjacent fact really is part of the caveat, not decoration a mutation could drop", () => {
    expect(withTeam({ clinical_trial: "optional" }, { multi_pi_allowed: false, consortium_required: false }).text).toBe("No blocking constraint.");
  });
});

describe("verdicts · F12 the aspiration relaxation names no collaborator", () => {
  /** Case 1, whose paradigm gate would make it Poor, with an aspiration naming what the notice requires (§10 Exploratory row). */
  function aspirationCase(): AdversarialCase {
    const c = cases.find((x) => x.id === "1_tcell_lab_vs_survivorship_epi")!;
    return { ...c, investigator: { ...c.investigator, aspirations: ["epidemiology"] } };
  }

  it("the engine really does relax the gate on the aspiration alone", () => {
    const d = drive(aspirationCase());
    expect(d.row.caps).toContain("paradigm_gate_relaxed_aspiration");
    expect(d.row.caps).not.toContain("paradigm_gate");
    expect(d.scored.result.provenance.P.exception).toBeNull(); // no bridge fired, so no collaborator is involved
    expect(floors("exploratory").P_with_aspiration).toBeDefined();
  });

  it("and the caveat says what actually opened it", () => {
    const d = drive(aspirationCase());
    expect(d.verdicts.caveat.text).toContain("A stated aspiration in this direction, not the record, is what opens it.");
    expect(d.verdicts.caveat.text).not.toContain("collabora");
    // the relaxation itself is a caution; this row is still Poor on the *unit* gate,
    // so `coherent()` paints its caveat blocking — the words are the relaxation's either way
    expect(caveatOf(d.input).tone).toBe("caution");
    expect(d.row.caps).toContain("unit_gate");
    expect(d.verdicts.caveat.tone).toBe("blocking");
  });

  it("each bridge names its own opening, and only one of them is a collaborator", () => {
    const d = byId.get("1_tcell_lab_vs_survivorship_epi")!;
    expect(caveatOf(withRow(d, { caps: ["paradigm_gate_relaxed_translational_bridge"] })).text).toContain("A collaborator in the field the notice funds is what opens it.");
    expect(caveatOf(withRow(d, { caps: ["paradigm_gate_relaxed_biospecimen_bridge"] })).text).toContain("Human-biospecimen work and a notice that allows human tissue open it.");
    expect(caveatOf(withRow(d, { caps: ["paradigm_gate_relaxed_biospecimen_bridge"] })).text).not.toContain("collaborator");
  });
});

describe("verdicts · F13 every slot is one sentence", () => {
  /** A notice with four rules stage 1 cannot evaluate — the shape that produced a 330-character chip. */
  function unevaluableCase(): AdversarialCase {
    const c = strongCase();
    return {
      ...c,
      opportunity: {
        ...c.opportunity,
        eligibility: {
          ...c.opportunity.eligibility,
          citizenship_rule: "US citizens and permanent residents at the time of award, documented by the institution before the award is issued",
          investigator_rules: ["Applicants must hold a faculty appointment at the time of application.", "Program directors must devote at least 3 person-months.", "Only one application per institution."],
        },
      },
    };
  }

  it("the unevaluable rules are two and a count, not the whole list twice", () => {
    const d = drive(unevaluableCase());
    expect(d.scored.result.provenance.E.unknown).toHaveLength(4);
    expect(d.verdicts.eligibility.text).toContain(", and 2 more the notice does not settle");
    expect(d.verdicts.eligibility.text.length).toBeLessThan(260);
    // and the caveat counts rather than repeating the chip's 200 characters (§2.7)
    expect(d.verdicts.caveat.text).toBe(`Eligibility could not be confirmed: 4 rules in the notice are not settled — ${confidenceCap("eligibility_unknown")[0]!.toUpperCase()}${confidenceCap("eligibility_unknown").slice(1)} at best.`);
  });

  it("one unevaluable rule is named rather than counted", () => {
    const c = strongCase();
    const opportunity: OpportunityFitProfile = { ...c.opportunity, eligibility: { ...c.opportunity.eligibility, citizenship_rule: "US citizens" } };
    const d = drive({ ...c, opportunity });
    expect(d.verdicts.caveat.text).toContain('Eligibility could not be confirmed: citizenship rule not evaluated: "US citizens"');
  });

  it("no rendered slot on any fixture runs past a line", () => {
    for (const d of driven) {
      expect(d.verdicts.reason.length, `${d.id} reason`).toBeLessThanOrEqual(240);
      expect(d.verdicts.caveat.text.length, `${d.id} caveat`).toBeLessThanOrEqual(240);
      for (const [slot, v] of [
        ["approach", d.verdicts.approach],
        ["eligibility", d.verdicts.eligibility],
        ["evidence", d.verdicts.evidence],
      ] as const) {
        expect(v.text.length, `${d.id} ${slot}: ${v.text}`).toBeLessThanOrEqual(240);
      }
    }
  });

  it("the paradigm-gate caveat keeps its 'what would change it' clause, and drops it before running long", () => {
    const d = byId.get("6b_human_immunologist_vs_cart_trial")!;
    expect(d.verdicts.caveat.text).toContain("It holds the pair at Exploratory until that changes.");
    // the same row with long category names on both sides keeps the fact and loses the coda
    const wordy = cases.find((x) => x.id === "6b_human_immunologist_vs_cart_trial")!;
    const notice: OpportunityFitProfile = { ...wordy.opportunity, paradigm: { ...wordy.opportunity.paradigm, required: { early_phase_human_experimental: 0.9, comparative_effectiveness: 0.8 } } };
    const long = fitVerdicts({ ...d.input, notice });
    expect(long.caveat.text.length).toBeLessThanOrEqual(240);
    expect(long.caveat.text).not.toContain("It holds the pair at Exploratory");
  });
});
