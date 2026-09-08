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
 * or from `taxonomy.json`, never from `verdicts.ts`, so an assertion cannot
 * pass by agreeing with the code it checks.
 */
import { describe, expect, it } from "vitest";
import { scorePairDetailed } from "@/lib/fit/engine";
import { loadAdversarialCases, type AdversarialCase } from "@/lib/fit/engine/fixtures";
import { EMPTY_LOOKUP } from "@/lib/fit/inspect/evidence";
import { toFitResultRow, type FitResultRow, type FitResultVerdictRow } from "@/lib/fit/results";
import { confidenceCap, designGates, familyOf, floors, isMatrixFamily, isParadigmCategory, PARADIGM_FAMILY_IDS, thinEvidence } from "@/lib/fit/taxonomy";
import type { FitProvenance, InvestigatorFitProfile, OpportunityFitProfile, ParadigmFamily } from "@/lib/fit/types";
import { actionOf, approachFamilies, caveatOf, eligibilityRestrictions, evidenceVerdict, fitVerdicts, nearestFloor, reasonOf, VERDICT_ACTION, verdictLabelOf, type VerdictInput } from "@/lib/fit/verdicts";

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
  const input: VerdictInput = { row, notice: c.opportunity, investigator: c.investigator, lookup: EMPTY_LOOKUP, audience: "strategist", ...overrides };
  return { id: c.id, title: c.title, scored, row, input, verdicts: fitVerdicts(input) };
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

/** The family carrying the most weight in a category-keyed vector, computed here so the assertion does not lean on `verdicts.ts`. */
function dominantFamily(weights: Partial<Record<string, number>> | null | undefined): ParadigmFamily | null {
  const byFamily = new Map<ParadigmFamily, number>();
  for (const [category, w] of Object.entries(weights ?? {})) {
    if (typeof w !== "number" || w <= 0 || !isParadigmCategory(category)) continue;
    const f = familyOf(category);
    byFamily.set(f, (byFamily.get(f) ?? 0) + w);
  }
  let best: ParadigmFamily | null = null;
  let bestWeight = 0;
  for (const f of PARADIGM_FAMILY_IDS) {
    const w = byFamily.get(f) ?? 0;
    if (w > bestWeight) {
      bestWeight = w;
      best = f;
    }
  }
  return best;
}

/** What each side of the pair actually is, computed straight from the stored profiles. */
function expectedFamilies(inv: InvestigatorFitProfile, opp: OpportunityFitProfile): { investigator: ParadigmFamily | null; notice: ParadigmFamily | null } {
  return {
    investigator: dominantFamily(inv.paradigm.recent) ?? dominantFamily(inv.paradigm.career),
    notice: dominantFamily(opp.paradigm.required) ?? dominantFamily(opp.paradigm.required_any),
  };
}

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
        expect(d.verdicts.action).toEqual(VERDICT_ACTION[d.verdicts.label]);
        expect(drive(c, { audience: "investigator" }).verdicts.action).toBeNull();
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
    expect(d.verdicts.approach.text).toBe("Different approach · Preclinical vs Population");
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

  it("thin when the counts fall under taxonomy.aggregation.thin_evidence, with the reason named", () => {
    const t = thinEvidence();
    const d = base();
    const investigator: InvestigatorFitProfile = { ...d.input.investigator!, evidence_summary: { ...d.input.investigator!.evidence_summary, publications_verified: 14, grants: 0, trials: 0 } };
    const v = evidenceVerdict({ row: d.row, investigator });
    expect(14).toBeGreaterThanOrEqual(t.min_items);
    expect(0).toBeLessThan(t.min_grants);
    expect(v).toEqual({ text: "Thin · 14 papers, RePORTER not linked", tone: "caution" });
  });

  it("well evidenced when both counts clear the same two numbers", () => {
    const d = base();
    const investigator: InvestigatorFitProfile = { ...d.input.investigator!, evidence_summary: { ...d.input.investigator!.evidence_summary, publications_verified: 48, grants: 2, trials: 4 } };
    expect(evidenceVerdict({ row: d.row, investigator })).toEqual({ text: "Well evidenced · 48 papers, 2 awards, 4 trials", tone: "ok" });
  });

  it("what there is comes before what is missing, so a well-evidenced row never opens on a gap", () => {
    const d = base();
    const investigator: InvestigatorFitProfile = { ...d.input.investigator!, evidence_summary: { ...d.input.investigator!.evidence_summary, publications_verified: 0, grants: 2, trials: 4 } };
    expect(evidenceVerdict({ row: d.row, investigator })).toEqual({ text: "Well evidenced · 2 awards, 4 trials, no publications on file", tone: "ok" });
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
  it("is the first clause of the rationale, one sentence, with the engine's numbers taken out", () => {
    for (const d of driven) {
      const rationale = d.row.rationale;
      if (!rationale) continue;
      const first = rationale.split(" · ")[0]!;
      expect(d.verdicts.reason.split(" · "), d.id).toHaveLength(1);
      // the claim survives; the axis-and-value prefix and the parenthetical values do not.
      // "Paradigm 0.45 — Clinical trials (yours 0.85) vs. required Genetic epidemiology"
      // reaches the row as "Clinical trials vs. required Genetic epidemiology."
      expect(d.verdicts.reason, d.id).not.toMatch(/\d+\.\d+/);
      const claim = first.replace(/^\s*[A-Z][A-Za-z ]*\s\d+(?:\.\d+)?\s*[—–-]\s*/, "").replace(/\s*\([^()]*\d+\.\d+[^()]*\)/g, "");
      expect(d.verdicts.reason, d.id).toBe(`${claim[0]!.toUpperCase()}${claim.slice(1)}.`);
    }
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

  it("only a row with neither rationale nor why_not falls all the way through", () => {
    const d = byId.get("1_tcell_lab_vs_survivorship_epi")!;
    expect(reasonOf({ row: { ...d.row, rationale: null, why_not: null }, investigator: null, lookup: EMPTY_LOOKUP })).toBe("No rationale stored.");
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
    expect(d.verdicts.caveat.text).toMatch(/^Different kind of research\. The notice funds .+; this profile's work is .+\./);
    expect(d.verdicts.caveat.text).toContain("Shared disease terms do not close this.");
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
      expect(actionOf(label, "strategist")).toEqual(VERDICT_ACTION[label]);
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
