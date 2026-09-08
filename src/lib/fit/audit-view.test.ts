/**
 * `audit-view.ts` against the regression suite (CLAUDE.md; brief §5: the
 * adversarial cases "are exactly the rows that must not read as reassuring").
 *
 * Driven the whole way a real row travels, the same as `verdicts.test.ts`:
 * `loadAdversarialCases()` → `scorePairDetailed` → `toFitResultRow` → the
 * `FIT_RESULT_VERDICT_COLUMNS` projection → the audit derivations. The
 * projection is written out rather than spread from the engine result, so a
 * field the list read does **not** carry cannot leak into the audit view by
 * accident.
 *
 * Every oracle is independent: floors are read out of `taxonomy.json` with
 * `JSON.parse`, unmet design groups come from `provenance.D.unmet_required`
 * (the engine's own output), failed and unknown eligibility rules from
 * `provenance.E`, and the state words are literal tables. Nothing here is
 * computed by importing the function under test.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  APPROACH_AXES,
  AUDIT_COMPONENTS,
  auditInternals,
  auditView,
  componentRows,
  ELIGIBILITY_STATE_TEXT,
  eligibilityTable,
  evidenceApproachRows,
  EVIDENCE_AXIS_LABEL,
  floorPairText,
  identityReviewId,
  noticeApproachRows,
  NOTICE_AXIS_LABEL,
  rationaleItemGroup,
  REQUIREMENT_STATE_TEXT,
  requirementsTable,
  type AuditInput,
} from "@/lib/fit/audit-view";
import { scorePairDetailed } from "@/lib/fit/engine";
import { loadAdversarialCases, type AdversarialCase } from "@/lib/fit/engine/fixtures";
import { toFitResultRow, type FitResultRow, type FitResultVerdictRow } from "@/lib/fit/results";
import type { FitProvenance, InvestigatorFitProfile, OpportunityFitProfile } from "@/lib/fit/types";
import { eligibility } from "@/lib/fit/engine/eligibility";
import { categoryLabel, isParadigmCategory } from "@/lib/fit/taxonomy";
import { approachVerdict, failedEligibilityRules, splitFailedRules } from "@/lib/fit/verdicts";

// ---------------------------------------------------------------------------
// Driving the fixtures
// ---------------------------------------------------------------------------

/** The `FIT_RESULT_VERDICT_COLUMNS` projection of a stored row. */
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

type Driven = { id: string; scored: ReturnType<typeof scorePairDetailed>; row: FitResultVerdictRow; input: AuditInput & { row: FitResultVerdictRow } };

function drive(c: AdversarialCase): Driven {
  const scored = scorePairDetailed(c.investigator, c.opportunity, c.ctx);
  const row = verdictRow(toFitResultRow(scored.result));
  return { id: c.id, scored, row, input: { row, notice: c.opportunity, investigator: c.investigator } };
}

const cases = loadAdversarialCases();
const driven = cases.map(drive);
const byId = new Map(driven.map((d) => [d.id, d]));

/** The taxonomy read as a file, so no assertion about a floor leans on `taxonomy.ts`. */
const TAXONOMY = JSON.parse(readFileSync(path.join(process.cwd(), "src/lib/fit/taxonomy.json"), "utf8")) as {
  tiers: Record<string, Record<string, number | string>>;
  compose: { methods: { evidence_min: number } };
  materials: { kinds: Record<string, string[]> };
};

// ---------------------------------------------------------------------------
// §3e — the split is the point
// ---------------------------------------------------------------------------

/** A notice carrying every *requirement* the audit view knows and no eligibility rule at all. */
function requirementsOnly(base: OpportunityFitProfile): OpportunityFitProfile {
  return {
    ...base,
    eligibility: { investigator_rules: [], esi_only: false, new_investigator_only: false, clinician_required: false, degree_required: null, independent_appointment_required: false, citizenship_rule: null },
    materials: { ...base.materials, human_required: true, required: ["enrolled_participants"], required_any: [] },
    design: { ...base.design, required_any: ["rct"], required_any_2: [] },
    mechanism: { ...base.mechanism, clinical_trial: "required" },
  };
}

/** A notice carrying every *eligibility* rule the audit view knows and no requirement at all. */
function eligibilityOnly(base: OpportunityFitProfile): OpportunityFitProfile {
  return {
    ...base,
    eligibility: {
      investigator_rules: ["Applicants must hold a faculty appointment."],
      esi_only: true,
      new_investigator_only: true,
      clinician_required: true,
      degree_required: "PhD",
      independent_appointment_required: true,
      citizenship_rule: "US citizens and permanent residents only.",
    },
    materials: { ...base.materials, human_required: false, required: [], required_any: [] },
    design: { ...base.design, required_any: [], required_any_2: [] },
    mechanism: { ...base.mechanism, clinical_trial: "optional" },
  };
}

describe("the two rule tables are different tables (§3e)", () => {
  const base = cases[0]!;

  it("a notice with only requirements produces no eligibility row", () => {
    const d = drive({ ...base, opportunity: requirementsOnly(base.opportunity) });
    expect(eligibilityTable(d.input)).toEqual([]);
    expect(requirementsTable(d.input).length).toBeGreaterThan(0);
  });

  it("a notice with only eligibility rules produces no requirement row", () => {
    const d = drive({ ...base, opportunity: eligibilityOnly(base.opportunity) });
    expect(requirementsTable(d.input)).toEqual([]);
    expect(eligibilityTable(d.input).length).toBeGreaterThan(0);
  });

  it("no eligibility row is ever about human subjects, a study design or a clinical trial", () => {
    for (const d of driven) {
      for (const r of eligibilityTable(d.input)) {
        expect(`${d.id}: ${r.rule}`).not.toMatch(/human participants|study design|clinical trial/i);
      }
    }
  });

  it("no requirement row is ever about who may apply", () => {
    for (const d of driven) {
      for (const r of requirementsTable(d.input)) {
        expect(`${d.id}: ${r.rule}`).not.toMatch(/investigator|career stage|citizenship|appointment|clinician/i);
      }
    }
  });

  it("the two stage-1 failures that are not eligibility facts never reach the eligibility table", () => {
    // Both are written verbatim by `engine/eligibility.ts` and both arrive in
    // `flags` beside real eligibility rules. Neither is a fact about who may
    // apply, and labelling either one "an investigator rule in the notice" is
    // exactly the merge §3e forbids, read backwards.
    const d = byId.get("1_tcell_lab_vs_survivorship_epi")!;
    for (const rule of ["deadline has passed", "self-declared do-not-suggest: population"]) {
      const rows = eligibilityTable({ ...d.input, row: { ...d.row, components: { ...d.row.components, E: 0 }, flags: [`excluded: ${rule}`] } });
      expect(rows.filter((r) => r.state === "fails")).toEqual([]);
    }
  });

  it("a pair excluded with no rule text still says it was excluded", () => {
    const d = byId.get("1_tcell_lab_vs_survivorship_epi")!;
    const rows = eligibilityTable({ ...d.input, row: { ...d.row, components: { ...d.row.components, E: 0 }, flags: [] } });
    expect(rows.some((r) => r.state === "fails")).toBe(true);
  });

  it("a real investigator rule that failed is a Fails row", () => {
    const d = byId.get("1_tcell_lab_vs_survivorship_epi")!;
    const notice: OpportunityFitProfile = { ...d.input.notice!, eligibility: { ...d.input.notice!.eligibility, esi_only: true } };
    const rows = eligibilityTable({
      ...d.input,
      notice,
      row: { ...d.row, components: { ...d.row.components, E: 0 }, flags: ["excluded: ESI-only notice; investigator has held an R01-equivalent award"] },
    });
    expect(rows.find((r) => r.key === "esi_only")?.state).toBe("fails");
    // and the failure is claimed by that field rather than duplicated as a loose row
    expect(rows.filter((r) => r.state === "fails")).toHaveLength(1);
  });

  it("a rule the engine could not evaluate is Unknown, not Met", () => {
    const d = byId.get("1_tcell_lab_vs_survivorship_epi")!;
    const notice: OpportunityFitProfile = { ...d.input.notice!, eligibility: { ...d.input.notice!.eligibility, esi_only: true } };
    const rows = eligibilityTable({ ...d.input, notice, row: { ...d.row, caps: [...d.row.caps, "eligibility_unknown"], flags: ["ESI status not on file"] } });
    expect(rows.find((r) => r.key === "esi_only")?.state).toBe("unknown");
  });

  it("a citizenship rule and a verbatim investigator rule are Unknown by construction", () => {
    const d = byId.get("1_tcell_lab_vs_survivorship_epi")!;
    const notice = eligibilityOnly(d.input.notice!);
    const rows = eligibilityTable({ ...d.input, notice, row: { ...d.row, flags: [] } });
    expect(rows.find((r) => r.key === "citizenship_rule")?.state).toBe("unknown");
    expect(rows.find((r) => r.key === "investigator_rule_0")?.state).toBe("unknown");
  });

  it("a row whose flags column was never loaded answers Unknown, never Met", () => {
    const d = byId.get("1_tcell_lab_vs_survivorship_epi")!;
    const notice = eligibilityOnly(d.input.notice!);
    const loaded = eligibilityTable({ ...d.input, notice });
    const unloaded = eligibilityTable({ ...d.input, notice, row: { ...d.row, flags: null as unknown as string[] } });
    expect(loaded.some((r) => r.state === "met")).toBe(true);
    expect(unloaded.every((r) => r.state === "unknown")).toBe(true);
  });

  it("each rule carries the notice's own verified quote", () => {
    const d = byId.get("1_tcell_lab_vs_survivorship_epi")!;
    const notice: OpportunityFitProfile = {
      ...eligibilityOnly(d.input.notice!),
      provenance: { "eligibility.esi_only": { section: "Section III", quote: "Only ESIs may apply." } },
    };
    const rows = eligibilityTable({ ...d.input, notice });
    expect(rows.find((r) => r.key === "esi_only")?.quote).toEqual({ field: "eligibility.esi_only", section: "Section III", quote: "Only ESIs may apply." });
    expect(rows.find((r) => r.key === "clinician_required")?.quote).toBeNull();
  });

  it("the state words are the brief's, and they differ between the tables", () => {
    expect(ELIGIBILITY_STATE_TEXT).toEqual({ met: "Met", fails: "Fails", unknown: "Unknown" });
    expect(REQUIREMENT_STATE_TEXT).toEqual({ met: "Met by the evidence", not_met: "Not met by the evidence", unknown: "Unknown" });
  });
});

// ---------------------------------------------------------------------------
// The `excluded:` flag round-trips through stage 1's own strings
//
// Found by rendering this view: six of `engine/eligibility.ts`'s eight failure
// sentences contain a `"; "`, and `tier.ts` joins the list with the same
// separator, so the old plain split turned one rule into two. The oracle here
// is the engine's `failed` array — never a string written in this file.
// ---------------------------------------------------------------------------

describe("stage 1's failed rules survive the flag encoding", () => {
  const base = cases[0]!;

  /** A pair that fails four rules at once, every one of them a sentence with a `"; "` inside it. */
  function fourFailures() {
    const opportunity: OpportunityFitProfile = {
      ...base.opportunity,
      eligibility: { investigator_rules: [], esi_only: true, new_investigator_only: true, clinician_required: true, degree_required: "MD", independent_appointment_required: true, citizenship_rule: null },
    };
    const investigator: InvestigatorFitProfile = {
      ...base.investigator,
      characteristics: { ...base.investigator.characteristics, esi: false, degrees: ["PhD"], clinical_role: "phd_investigator", career_stage: "trainee" },
    };
    return { opportunity, investigator };
  }

  it("every rule the engine failed comes back whole", () => {
    const { opportunity, investigator } = fourFailures();
    const result = eligibility(investigator, opportunity, base.ctx);
    expect(result.failed.length).toBeGreaterThan(2);
    expect(result.failed.some((r) => r.includes("; ")), "the fixture must exercise the ambiguous encoding").toBe(true);
    expect(splitFailedRules(result.failed.join("; "))).toEqual(result.failed);
    expect(failedEligibilityRules({ flags: [`excluded: ${result.failed.join("; ")}`] })).toEqual(result.failed);
  });

  it("and the eligibility table names one row per rule, not one per fragment", () => {
    const { opportunity, investigator } = fourFailures();
    const result = eligibility(investigator, opportunity, base.ctx);
    const d = drive(base);
    const rows = eligibilityTable({
      row: { ...d.row, components: { ...d.row.components, E: 0 }, flags: [`excluded: ${result.failed.join("; ")}`] },
      notice: opportunity,
      investigator,
    });
    // Each failure is claimed by the field the engine wrote it for, so every
    // Fails row is named after an `OpportunityEligibility` field and none is
    // left over as an unattributed `failed_*` fragment.
    expect(rows.filter((r) => r.state === "fails")).toHaveLength(result.failed.length);
    expect(rows.filter((r) => r.state === "fails").map((r) => r.key).sort()).toEqual(["clinician_required", "degree_required", "esi_only", "independent_appointment_required", "new_investigator_only"]);
    expect(rows.some((r) => r.key.startsWith("failed_"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Requirements — assessed against the evidence
// ---------------------------------------------------------------------------

describe("notice requirements are assessed against the evidence", () => {
  const base = cases[0]!;

  it("an unmet required design group is the engine's own unmet group", () => {
    for (const d of driven) {
      const unmet = (d.scored.result.provenance as FitProvenance).D.unmet_required;
      const groups = requirementsTable(d.input).filter((r) => r.key.startsWith("design_group_"));
      const notMet = groups.filter((r) => r.state === "not_met");
      expect(`${d.id}: ${notMet.length}`).toBe(`${d.id}: ${unmet.length}`);
    }
  });

  it("human participants: met when the profile carries a human-participant kind at the taxonomy's own evidence_min", () => {
    const kinds = TAXONOMY.materials.kinds.human_participants!;
    const min = TAXONOMY.compose.methods.evidence_min;
    const notice: OpportunityFitProfile = { ...base.opportunity, materials: { ...base.opportunity.materials, human_required: true, required: [], required_any: [] } };
    const withHumans: InvestigatorFitProfile = { ...base.investigator, materials: { ...base.investigator.materials, [kinds[0]!]: min } };
    const without: InvestigatorFitProfile = { ...base.investigator, materials: Object.fromEntries(kinds.map((k) => [k, 0])) };
    const row = drive(base).row;
    expect(requirementsTable({ row, notice, investigator: withHumans }).find((r) => r.key === "human_required")?.state).toBe("met");
    expect(requirementsTable({ row, notice, investigator: without }).find((r) => r.key === "human_required")?.state).toBe("not_met");
    expect(requirementsTable({ row, notice, investigator: null }).find((r) => r.key === "human_required")?.state).toBe("unknown");
  });

  it("a notice that forbids clinical trials is assessed on the prohibited design that dominates", () => {
    const d = drive(base);
    const notice: OpportunityFitProfile = {
      ...base.opportunity,
      mechanism: { ...base.opportunity.mechanism, clinical_trial: "not_allowed" },
      design: { ...base.opportunity.design, required_any: [], required_any_2: [], prohibited: ["rct"] },
    };
    const trialist: InvestigatorFitProfile = { ...base.investigator, design: { rct: 1 } };
    expect(requirementsTable({ ...d.input, notice, investigator: trialist }).find((r) => r.key === "clinical_trial")?.state).toBe("not_met");
    expect(requirementsTable({ ...d.input, notice, investigator: { ...base.investigator, design: {} } }).find((r) => r.key === "clinical_trial")?.state).toBe("met");
  });

  it("every requirement carries the notice's own verified quote", () => {
    // Survivor of the first mutation round: the eligibility table's quotes
    // were asserted and the requirements table's were not, so each of these
    // three `quoteFor` calls could be replaced by `null` unnoticed — and a
    // requirement without its quote is a claim about the notice with nothing
    // behind it, which is the one thing §3 keeps from today's UI ("evidence
    // quoting with verified-source links").
    const d = drive(base);
    const notice: OpportunityFitProfile = {
      ...requirementsOnly(base.opportunity),
      provenance: {
        "materials.human_required": { section: "Section II.1", quote: "Studies must include human participants." },
        "materials.required": { section: "Section II.1", quote: "Participants must be enrolled prospectively." },
        "design.required_any": { section: "Section II.2", quote: "A randomized trial is required." },
        "mechanism.clinical_trial": { section: "Section II", quote: "This announcement requires a clinical trial." },
      },
    };
    const byKey = new Map(requirementsTable({ ...d.input, notice }).map((r) => [r.key, r]));
    expect(byKey.get("human_required")?.quote).toEqual({ field: "materials.human_required", section: "Section II.1", quote: "Studies must include human participants." });
    expect(byKey.get("materials_required_0")?.quote).toEqual({ field: "materials.required", section: "Section II.1", quote: "Participants must be enrolled prospectively." });
    expect(byKey.get("design_group_0")?.quote).toEqual({ field: "design.required_any", section: "Section II.2", quote: "A randomized trial is required." });
    expect(byKey.get("clinical_trial")?.quote).toEqual({ field: "mechanism.clinical_trial", section: "Section II", quote: "This announcement requires a clinical trial." });
    // and a field the notice quoted nothing for says nothing rather than inventing one
    expect(requirementsTable({ ...d.input, notice: { ...notice, provenance: {} } }).every((r) => r.quote === null)).toBe(true);
  });

  it("no notice profile means no requirements table at all", () => {
    const d = drive(base);
    expect(requirementsTable({ ...d.input, notice: null })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Approach, side by side (§3d)
// ---------------------------------------------------------------------------

describe("approach, side by side", () => {
  it("both panels are four rows, in the brief's axis order, with the brief's labels", () => {
    for (const d of driven) {
      const notice = noticeApproachRows(d.input);
      const evidence = evidenceApproachRows(d.input);
      expect(notice.map((r) => r.axis)).toEqual([...APPROACH_AXES]);
      expect(evidence.map((r) => r.axis)).toEqual([...APPROACH_AXES]);
      expect(notice.map((r) => r.label)).toEqual(APPROACH_AXES.map((a) => NOTICE_AXIS_LABEL[a]));
      expect(evidence.map((r) => r.label)).toEqual(APPROACH_AXES.map((a) => EVIDENCE_AXIS_LABEL[a]));
      for (const r of [...notice, ...evidence]) expect(r.value.length, `${d.id}/${r.axis}: empty value`).toBeGreaterThan(0);
    }
  });

  it("a divergence is a property of the pair: the two panels tone each axis the same", () => {
    for (const d of driven) {
      const notice = noticeApproachRows(d.input);
      const evidence = evidenceApproachRows(d.input);
      expect(notice.map((r) => r.tone), d.id).toEqual(evidence.map((r) => r.tone));
    }
  });

  it("the paradigm row is coloured by the same judgment as the row's chip", () => {
    for (const d of driven) {
      const chip = approachVerdict({ row: d.row, notice: d.input.notice, investigator: d.input.investigator });
      expect(noticeApproachRows(d.input)[0]!.tone, d.id).toBe(chip.tone);
    }
  });

  it("topic never gates: the topic row is never blocking, on any fixture at any tier", () => {
    for (const d of driven) {
      for (const tier of ["strong", "moderate", "exploratory", "poor"] as const) {
        const rows = noticeApproachRows({ ...d.input, row: { ...d.row, tier } });
        expect(rows[3]!.tone, `${d.id}/${tier}`).not.toBe("blocking");
      }
    }
  });

  it("the unit row is coloured by the engine's own unit gate, and by set membership without it", () => {
    // Survivor of the first mutation round: no adversarial fixture carries
    // `unit_gate`, so the whole branch could be deleted and every test stayed
    // green. The gate is what makes a unit divergence *blocking* rather than a
    // caution, and it is the only thing that does.
    const d = byId.get("1_tcell_lab_vs_survivorship_epi")!;
    const gated = (tier: "poor" | "exploratory") => noticeApproachRows({ ...d.input, row: { ...d.row, tier, caps: [...d.row.caps, "unit_gate"] } })[1]!.tone;
    expect(gated("poor")).toBe("blocking");
    expect(gated("exploratory")).toBe("caution");

    // Without the cap the row is a caution when the evidence sits outside the
    // set the notice requires, and plain when it sits inside it.
    const ungated = { ...d.input, row: { ...d.row, tier: "moderate" as const, caps: [] } };
    const notice: OpportunityFitProfile = { ...d.input.notice!, unit: { ...d.input.notice!.unit, required: ["L4"], required_any: [] } };
    const inside: InvestigatorFitProfile = { ...d.input.investigator!, unit: { L4: 0.9, L1: 0.1 } };
    const outside: InvestigatorFitProfile = { ...d.input.investigator!, unit: { L1: 0.9 } };
    expect(noticeApproachRows({ ...ungated, notice, investigator: inside })[1]!.tone).toBe("ok");
    expect(noticeApproachRows({ ...ungated, notice, investigator: outside })[1]!.tone).toBe("caution");
    // and both panels still say what each side is
    expect(noticeApproachRows({ ...ungated, notice, investigator: inside })[1]!.value).toContain("L4");
    expect(evidenceApproachRows({ ...ungated, notice, investigator: outside })[1]!.value).toContain("L1");
  });

  it("a missing record says so on its own side, and leaves the other side alone", () => {
    const d = driven[0]!;
    const noNotice = noticeApproachRows({ ...d.input, notice: null });
    expect(noNotice.every((r) => r.value === "Not on file")).toBe(true);
    expect(evidenceApproachRows({ ...d.input, notice: null }).every((r) => r.value !== "Not on file")).toBe(true);

    const noInvestigator = evidenceApproachRows({ ...d.input, investigator: null });
    expect(noInvestigator.every((r) => r.value === "Not on file")).toBe(true);
    expect(noticeApproachRows({ ...d.input, investigator: null }).every((r) => r.value !== "Not on file")).toBe(true);
  });

  it("each panel names its own side's categories, computed from its own record", () => {
    // Survivor of the first mutation round: the evidence panel could be fed
    // the *notice's* paradigm vector and every other assertion stayed green —
    // which is §2.8 exactly, a comparison that shows one side twice.
    const heaviest = (weights: Record<string, number>) =>
      Object.entries(weights ?? {})
        .filter(([id, w]) => typeof w === "number" && w > 0 && isParadigmCategory(id))
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 2)
        .map(([id]) => categoryLabel(id).toLowerCase());
    for (const d of driven) {
      const inv = d.input.investigator!;
      const notice = d.input.notice!;
      const theirs = heaviest((Object.keys(inv.paradigm.recent).length ? inv.paradigm.recent : inv.paradigm.career) as Record<string, number>);
      const its = heaviest((Object.keys(notice.paradigm.required).length ? notice.paradigm.required : notice.paradigm.required_any) as Record<string, number>);
      const evidenceValue = evidenceApproachRows(d.input)[0]!.value;
      const noticeValue = noticeApproachRows(d.input)[0]!.value;
      for (const c of theirs) expect(evidenceValue, `${d.id}: the evidence panel drops its own ${c}`).toContain(c);
      for (const c of its) expect(noticeValue, `${d.id}: the notice panel drops its own ${c}`).toContain(c);
    }
  });

  it("the fixture the brief cares most about reads as a difference of approach, not a match", () => {
    // 7a — a health-services researcher against a beta-cell mechanism notice.
    // Shared disease keywords, opposite ends of the paradigm axis.
    const d = byId.get("7a_hsr_vs_beta_cell_mechanism")!;
    const notice = noticeApproachRows(d.input);
    const evidence = evidenceApproachRows(d.input);
    expect(notice[0]!.tone).not.toBe("ok");
    expect(notice[0]!.value).not.toBe(evidence[0]!.value);
  });
});

// ---------------------------------------------------------------------------
// Engine internals — the floors are the taxonomy's
// ---------------------------------------------------------------------------

describe("engine internals", () => {
  it("prints the eight components in the spec's order", () => {
    expect(AUDIT_COMPONENTS.map((c) => c.key)).toEqual(["P", "U", "D", "T", "M", "O", "K", "A"]);
    for (const d of driven) expect(componentRows(d.row).map((c) => c.key)).toEqual(["P", "U", "D", "T", "M", "O", "K", "A"]);
  });

  it("every floor is the one taxonomy.json states, read from the file", () => {
    const strong = TAXONOMY.tiers.strong!;
    const moderate = TAXONOMY.tiers.moderate!;
    for (const row of componentRows(driven[0]!.row)) {
      expect(row.strong, `strong floor of ${row.key}`).toBe(typeof strong[row.key] === "number" ? strong[row.key] : null);
      expect(row.moderate, `moderate floor of ${row.key}`).toBe(typeof moderate[row.key] === "number" ? moderate[row.key] : null);
    }
  });

  it("the floor pair reads as the brief writes it, and a component with no floor says so", () => {
    const rows = componentRows(driven[0]!.row);
    const byKey = new Map(rows.map((r) => [r.key, r]));
    expect(floorPairText(byKey.get("P")!)).toBe("Strong 0.75 · Moderate 0.50");
    expect(floorPairText(byKey.get("O")!)).toBe("no floor");
    expect(floorPairText(byKey.get("A")!)).toBe("no floor");
  });

  it("values are the row's, clamped to the bar's range", () => {
    for (const d of driven) {
      for (const row of componentRows(d.row)) {
        expect(row.value, `${d.id}/${row.key}`).toBeCloseTo(Math.max(0, Math.min(1, d.row.components[row.key])), 10);
      }
    }
  });

  it("S, the caps and the stage-8 marker", () => {
    const d = driven[0]!;
    expect(auditInternals(d.row).score).toBe(`S ${Number(d.row.score).toFixed(1)}`);
    expect(auditInternals({ ...d.row, caps: [] }).caps).toBe("no cap");
    expect(auditInternals({ ...d.row, caps: ["paradigm_gate", "low_notice_confidence"] }).caps).toBe("caps: paradigm gate, low notice confidence");
    expect(auditInternals(d.row).judged).toBeNull();
    const judged = auditInternals({ ...d.row, judged_at: "2026-09-05T00:00:00Z", judged_tier: "exploratory", judged_from: "moderate", judged_confidence: "high" });
    expect(judged.judged?.changed).toBe(true);
    expect(judged.judged?.label).toBe("judged · high");
  });

  it("a row with no component vector is marked unscored rather than drawn as eight zeroes", () => {
    const d = driven[0]!;
    expect(auditView(d.input).scored).toBe(true);
    expect(auditView({ ...d.input, row: { ...d.row, components: null as unknown as FitResultRow["components"] } }).scored).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C4 — "Not this person" on publications only
// ---------------------------------------------------------------------------

describe("identityReviewId (C4)", () => {
  it("offers the control on a publication that carries the id the action needs", () => {
    expect(identityReviewId({ id: "publication:31000001", publicationId: "pub-1" })).toBe("pub-1");
    expect(identityReviewId({ id: "publication:inv-1:31000001", publicationId: "pub-1" })).toBe("pub-1");
  });

  it("never offers it on a grant or a trial, whatever id is on the item", () => {
    // `reviewIdentityAction` would accept `kind: "grant"` and `kind: "trial"`
    // (`KIND_TABLE`), so this is the decision holding, not the mechanism.
    expect(identityReviewId({ id: "grant:5R01AR070001-03", publicationId: "pub-1" })).toBeNull();
    expect(identityReviewId({ id: "trial:NCT01234567", publicationId: "pub-1" })).toBeNull();
    expect(identityReviewId({ id: "biosketch:inv-1", publicationId: "pub-1" })).toBeNull();
  });

  it("never offers it without the row id it would write to", () => {
    expect(identityReviewId({ id: "publication:31000001", publicationId: null })).toBeNull();
    expect(identityReviewId({ id: "publication:31000001" })).toBeNull();
  });

  it("the items a rationale resolves carry no publication id, so that surface draws no control", () => {
    const group = rationaleItemGroup({
      evidence: [{ id: "publication:inv-1:31000001", kind: "publication", kindLabel: "PubMed", title: "A paper", meta: "Nature · 2024", href: "https://pubmed.ncbi.nlm.nih.gov/31000001/", resolved: true, prior: false }],
    });
    expect(group.items[0]!.publicationId).toBeUndefined();
    expect(identityReviewId(group.items[0]!)).toBeNull();
    expect(group.items[0]!.link).toEqual({ label: "PubMed ↗", href: "https://pubmed.ncbi.nlm.nih.gov/31000001/" });
  });
});

// ---------------------------------------------------------------------------
// The whole audit
// ---------------------------------------------------------------------------

describe("auditView", () => {
  it("assembles the same tables the parts produce, for every adversarial case", () => {
    for (const d of driven) {
      const v = auditView(d.input);
      expect(v.notice, d.id).toEqual(noticeApproachRows(d.input));
      expect(v.evidence, d.id).toEqual(evidenceApproachRows(d.input));
      expect(v.eligibility, d.id).toEqual(eligibilityTable(d.input));
      expect(v.requirements, d.id).toEqual(requirementsTable(d.input));
      expect(v.components, d.id).toEqual(componentRows(d.row));
    }
  });

  it("never throws on a stale record the taxonomy no longer knows", () => {
    const d = driven[0]!;
    const stale = {
      ...d.input,
      investigator: { ...d.input.investigator!, design: { not_a_design: 1 } as never, unit: { L9: 1 } as never, paradigm: { recent: { not_a_category: 1 }, career: {} } as never },
    };
    expect(() => auditView(stale)).not.toThrow();
  });
});
