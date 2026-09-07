import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hydrateContext } from "@/lib/fit/engine/fixtures";
import type { CorrectionContext } from "@/lib/fit/judge/corrections";
import { JUDGE_MAX_TOKENS } from "@/lib/fit/judge/model";
import { applyAdjudication, buildReconcilerPrompt, finalizeResult, gatedPoor, impliedTier, INVESTIGATOR_PATH_LEGEND, NOTICE_PATH_LEGEND, reconcile, RECONCILER_RETURN, RECONCILER_SYSTEM_PROMPT, runReconciler, toAdjudication, validateReconciler } from "@/lib/fit/judge/reconcile";
import { blindAt, EVIDENCE, EVIDENCE_IDS, fitAt, judgeInputs, reconcilerAt, reconcilerReply, scored, SECTIONS, skepticAt, SLE_TRIAL, stubModel, TRIALIST } from "@/lib/fit/judge/test-fixtures";
import type { AppliedCorrection, StoredAdjudication, ValidatedCorrection } from "@/lib/fit/judge/types";
import { confidenceCap, paradigmGates } from "@/lib/fit/taxonomy";

const spec = readFileSync(path.join(__dirname, "../../../../docs/fit-engine/prompts/reconciler.md"), "utf8");

function blockAfter(heading: RegExp): string {
  const lines = spec.split("\n");
  const start = lines.findIndex((l) => heading.test(l));
  expect(start).toBeGreaterThanOrEqual(0);
  const open = lines.findIndex((l, i) => i > start && l.startsWith("```"));
  const close = lines.findIndex((l, i) => i > open && l.startsWith("```"));
  return lines.slice(open + 1, close).join("\n");
}

const ctx: CorrectionContext = { evidenceIds: EVIDENCE_IDS, verifiedIds: EVIDENCE_IDS, sections: SECTIONS, investigator: TRIALIST, notice: SLE_TRIAL };

const correction = (over: Partial<ValidatedCorrection> = {}): ValidatedCorrection => ({ target: "investigator", path: "design.rct", from: 0.7, to: 0.9, evidence_ids: ["NCT04000001"], quote: null, section: null, kind: "ingest_miss", confidence: "high", route: "auto", verified_section: null, ...over });
const applied = (c: ValidatedCorrection, status: AppliedCorrection["status"] = "applied"): AppliedCorrection => ({ correction: c, id: null, status });

describe("reconciler.md carries the identical prompt (byte identity)", () => {
  it("the system prompt, the Return block and the user template's labels", () => {
    expect(blockAfter(/^## System prompt/)).toBe(RECONCILER_SYSTEM_PROMPT);
    const block = blockAfter(/^## User template/);
    expect(block).toContain(RECONCILER_RETURN);
    const prompt = buildReconcilerPrompt({ inputs: judgeInputs(), engine: scored(), blind: blindAt("strong"), skeptic: skepticAt(null), investigator: TRIALIST, notice: SLE_TRIAL });
    for (const label of ["STRUCTURED: ", "BLIND PASS: ", "SKEPTIC: ", "INVESTIGATOR PROFILE (structured, with evidence ids): ", "NOTICE PROFILE (structured, with quotes): ", "EVIDENCE:"]) {
      expect(block).toContain(label);
      expect(prompt).toContain(label);
    }
    expect(prompt.endsWith(RECONCILER_RETURN)).toBe(true);
    expect(prompt).toContain(INVESTIGATOR_PATH_LEGEND);
    expect(prompt).toContain(NOTICE_PATH_LEGEND);
    expect(prompt).toContain(`"provisional_tier":"${scored().tier}"`);
    expect(prompt).not.toContain('"score"');
    const absent = buildReconcilerPrompt({ inputs: judgeInputs(), engine: scored(), blind: null, skeptic: null, investigator: TRIALIST, notice: SLE_TRIAL });
    expect(absent).toContain("BLIND PASS: not available");
    expect(absent).toContain("SKEPTIC: not run");
  });
});

describe("reconciler · validation", () => {
  it("keeps the agreement, validates the corrections, drops a rationale that cites no existing id, and marks an empty reply unusable", () => {
    const v = validateReconciler(reconcilerReply({ corrections: [{ target: "investigator", path: "design.rct", from: 0.7, to: 0.9, evidence_ids: ["NCT04000001"], quote: null, section: null, kind: "ingest_miss", confidence: "high" }, { target: "investigator", path: "topic.terms", from: [], to: ["x"], evidence_ids: [], quote: null, section: null, kind: "ingest_miss", confidence: "high" }] }), ctx);
    expect(v.usable).toBe(true);
    expect(v.corrections.map((c) => c.path)).toEqual(["design.rct"]);
    expect(v.dropped).toEqual([expect.stringContaining("corrections[1]: path not known")]);
    const noIds = validateReconciler(reconcilerReply({ rationale: "A fine fit, trust me." }), ctx);
    expect(noIds.rationale).toBeNull();
    expect(noIds.dropped).toContain("rationale cites no evidence id that exists; the engine's rationale is kept instead");
    expect(validateReconciler({ corrections: [] }, ctx).usable).toBe(false);
    expect(validateReconciler(null, ctx).usable).toBe(false);
  });

  it("runReconciler makes one call at the spec's ceiling, none when the budget is spent; an unusable reply is returned as such", async () => {
    const { fn, calls } = stubModel({ reconciler: reconcilerReply() });
    const x = { inputs: judgeInputs(), engine: scored(), blind: blindAt("strong"), skeptic: null, investigator: TRIALIST, notice: SLE_TRIAL };
    const r = await runReconciler(x, ctx, { model: fn, modelName: "m" });
    expect(calls[0]).toMatchObject({ purpose: "reconciler", system: RECONCILER_SYSTEM_PROMPT, maxTokens: JUDGE_MAX_TOKENS.reconciler });
    expect(r).toMatchObject({ agreement: "agree", usable: true, calls: 1 });
    expect(await runReconciler(x, ctx, { model: fn, modelName: "m", takeCall: () => false })).toBeNull();
    const bad = stubModel({ reconciler: "{" });
    expect(await runReconciler(x, ctx, { model: bad.fn, modelName: "m" })).toMatchObject({ usable: false, calls: 1 });
  });
});

// ---------------------------------------------------------------------------
// The reconciliation table (spec §16) — one test per row
// ---------------------------------------------------------------------------

describe("reconcile · the §16 table", () => {
  const strong = fitAt("strong");
  const moderate = fitAt("moderate");
  const exploratory = fitAt("exploratory");
  const poorGated = fitAt("poor", { caps: ["paradigm_gate"], components: { P: paradigmGates().poor_below - 0.05 } });
  const poorFloors = fitAt("poor", { components: { P: 0.6, U: 0.7, T: 0.2 } });

  it("R1 · Strong / Strong / no gate-level objection → Strong, high", () => {
    const r = reconcile(strong, blindAt("strong"), skepticAt(null));
    expect(r).toMatchObject({ row: "R1_strong_agree", tier: "strong", confidence: "high", caps_added: [], review: null, structured_miss: false });
    const ungrounded = reconcile(strong, blindAt("strong"), skepticAt("paradigm", { grounded: false, evidence_ids: [] }));
    expect(ungrounded).toMatchObject({ row: "R1_strong_agree", tier: "strong", confidence: "high" });
    expect(ungrounded.reasons[0]).toContain("ungrounded paradigm objection");
  });

  it("R2 · Strong / Moderate / emphasis-level objection → Strong at medium, or Moderate when the objection is grounded in a cited item", () => {
    const stands = reconcile(strong, blindAt("moderate"), skepticAt(null));
    expect(stands).toMatchObject({ row: "R2_strong_blind_moderate", tier: "strong", confidence: "medium", caps_added: [] });
    const grounded = reconcile(strong, blindAt("moderate"), skepticAt("scale_role"));
    expect(grounded).toMatchObject({ row: "R2_strong_blind_moderate", tier: "moderate", confidence: "medium", caps_added: ["stage8_objection"] });
    expect(grounded.reasons[0]).toContain("A scale_role problem.");
    const topic = reconcile(strong, blindAt("moderate"), skepticAt("topic"));
    expect(topic.tier).toBe("moderate"); // a topic objection lowers by one step at most
    const ungrounded = reconcile(strong, blindAt("moderate"), skepticAt("scale_role", { grounded: false, evidence_ids: [] }));
    expect(ungrounded.tier).toBe("strong");
  });

  it("R3 · Strong / Exploratory or Poor / grounded gate-level objection → lower to the blind verdict; structured miss logged", () => {
    const r = reconcile(strong, blindAt("poor"), skepticAt("design"));
    expect(r).toMatchObject({ row: "R3_strong_gate_objection", tier: "poor", caps_added: ["stage8_verdict"], structured_miss: true, confidence: "review", review: { kind: "structured_miss" } });
    expect(r.caps).toEqual(expect.arrayContaining(["stage8_verdict"]));
    expect(reconcile(strong, blindAt("exploratory"), skepticAt("paradigm")).tier).toBe("exploratory");
    expect(r.why_not).toBe(strong.why_not ?? null);
  });

  it("R4 · Strong / Exploratory or Poor / objection not grounded → Strong stands, low, queued as AI dissent, unsupported", () => {
    const r = reconcile(strong, blindAt("exploratory"), skepticAt("paradigm", { grounded: false, evidence_ids: [] }));
    expect(r).toMatchObject({ row: "R4_strong_unsupported_dissent", tier: "strong", confidence: "low", caps_added: [], review: { kind: "ungrounded_dissent" } });
    expect(r.reasons[0]).toContain("AI dissent, unsupported");
    expect(reconcile(strong, blindAt("poor"), skepticAt(null))).toMatchObject({ row: "R4_strong_unsupported_dissent", tier: "strong", confidence: "low" });
    expect(reconcile(strong, blindAt("poor"), null)).toMatchObject({ row: "R4_strong_unsupported_dissent", tier: "strong" });
  });

  it("R5 · Moderate or Exploratory / Strong with a correction the reconciler can state → apply, re-score, the floors decide; never more than one tier per cycle", () => {
    const up = reconcile(moderate, blindAt("strong"), skepticAt(null), { rescored: strong, corrections: [applied(correction({ route: "provisional", kind: "profile_weight" }), "proposed")] });
    expect(up).toMatchObject({ row: "R5_raise_by_correction", tier: "strong", tier_structured: "moderate", tier_rescored: "strong", confidence: "medium", caps_added: [], review: { kind: "pending_confirmation" } });
    const twoSteps = reconcile(exploratory, blindAt("strong"), skepticAt(null), { rescored: strong, corrections: [applied(correction())] });
    expect(twoSteps).toMatchObject({ row: "R5_raise_by_correction", tier: "moderate", tier_rescored: "strong", caps_added: ["stage8_pending_confirmation"], confidence: "medium", review: null });
    expect(twoSteps.reasons[0]).toContain("never more than one tier per cycle");
    const noLift = reconcile(exploratory, blindAt("strong"), skepticAt(null), { rescored: exploratory, corrections: [applied(correction())] });
    expect(noLift).toMatchObject({ row: "R5_raise_by_correction", tier: "exploratory", confidence: "medium" });
    const raisedThenObjected = reconcile(moderate, blindAt("strong"), skepticAt("design"), { rescored: strong, corrections: [applied(correction())] });
    expect(raisedThenObjected.tier).toBe("exploratory");
    expect(raisedThenObjected.caps_added).toEqual(["stage8_objection"]);
  });

  it("R6 · Moderate or Exploratory / Strong with no expressible correction → the tier stands (never below Exploratory) with the model's rationale; AI-flagged lead", () => {
    const r = reconcile(exploratory, blindAt("strong"), null, { reconciler: reconcilerAt({ inexpressible_insight: "Runs the only banked aging cohort with specimens." }) });
    expect(r).toMatchObject({ row: "R6_ai_flagged_lead", tier: "exploratory", confidence: "review", review: { kind: "ai_flagged_lead", note: "Runs the only banked aging cohort with specimens." }, rationale: "Runs the only banked aging cohort with specimens." });
    const mod = reconcile(moderate, blindAt("strong"), skepticAt(null), { reconciler: reconcilerAt() });
    expect(mod).toMatchObject({ row: "R6_ai_flagged_lead", tier: "moderate", confidence: "review", review: { kind: "ai_flagged_lead" } });
    expect(mod.rationale).toBe("Reconciler rationale citing NCT04000001.");
  });

  it("R7 · Poor (gated) / Strong or Moderate → the gate stands unless a specific gate input was corrected and the re-score lifts it; a topical argument never reopens a gate", () => {
    const stands = reconcile(poorGated, blindAt("strong"), null, { reconciler: reconcilerAt({ inexpressible_insight: "The topics overlap a lot." }) });
    expect(stands).toMatchObject({ row: "R7_gate_stands", tier: "poor", confidence: "review", review: { kind: "ai_flagged_lead" } });
    expect(stands.reasons[0]).toContain("a topical argument never reopens a gate");
    const nonGate = reconcile(poorGated, blindAt("moderate"), null, { rescored: exploratory, corrections: [applied(correction({ path: "materials.human_blood_fluids", from: 0.5, to: 0.9 }))] });
    expect(nonGate).toMatchObject({ row: "R7_gate_stands", tier: "poor" });
    const gateFixed = reconcile(poorGated, blindAt("moderate"), null, { rescored: exploratory, corrections: [applied(correction({ path: "paradigm.recent.translational", from: 0.29, to: 0.6, kind: "profile_weight", route: "provisional" }), "proposed")] });
    expect(gateFixed).toMatchObject({ row: "R7_gate_corrected", tier: "exploratory", tier_rescored: "exploratory", confidence: "medium", review: { kind: "pending_confirmation" } });
    const gateFixedTwoSteps = reconcile(poorGated, blindAt("strong"), skepticAt(null), { rescored: moderate, corrections: [applied(correction({ target: "notice", path: "paradigm.required.human_biospecimen", from: null, to: 0.8, kind: "misread_requirement", route: "provisional", quote: "q", verified_section: "s" }), "proposed")] });
    expect(gateFixedTwoSteps).toMatchObject({ row: "R7_gate_corrected", tier: "exploratory", caps_added: ["stage8_pending_confirmation"] });
    expect(gatedPoor(poorGated)).toBe(true);
    expect(gatedPoor(poorFloors)).toBe(false);
  });

  it("R8 · the blind pass disagrees with itself by two tiers → the blind verdict is absent; structured only", () => {
    const void8 = blindAt(null, { variants_at: ["strong", "poor"], self_consistent: false });
    expect(reconcile(strong, void8, skepticAt(null))).toMatchObject({ row: "R8_blind_void", tier: "strong", confidence: "structured_only" });
    expect(reconcile(moderate, void8, null)).toMatchObject({ row: "R8_blind_void", tier: "moderate", confidence: "structured_only" });
    expect(reconcile(poorFloors, void8, null)).toMatchObject({ row: "R8_blind_void", tier: "poor", confidence: "structured_only" });
    const withObjection = reconcile(strong, void8, skepticAt("paradigm"));
    expect(withObjection).toMatchObject({ row: "objection_lowers", tier: "poor", caps_added: ["stage8_objection"], structured_miss: true });
  });

  it("post-rule 5 · a grounded gate-level objection lowers to the objection's implied tier even when the blind verdict is high", () => {
    expect(reconcile(strong, blindAt("strong"), skepticAt("design"))).toMatchObject({ row: "objection_lowers", tier: "exploratory", caps_added: ["stage8_objection"], structured_miss: true, review: { kind: "structured_miss" } });
    expect(reconcile(strong, blindAt("strong"), skepticAt("paradigm")).tier).toBe("poor");
    expect(reconcile(strong, blindAt("strong"), skepticAt("unit_materials")).tier).toBe("poor");
    expect(reconcile(strong, blindAt("strong"), skepticAt("eligibility")).tier).toBe(confidenceCap("eligibility_unknown"));
    expect(reconcile(moderate, blindAt("strong"), skepticAt("design"))).toMatchObject({ row: "objection_lowers", tier: "exploratory" });
    expect(reconcile(exploratory, blindAt("strong"), skepticAt("design"))).toMatchObject({ row: "confirmed", tier: "exploratory" });
    expect(impliedTier("topic", "moderate")).toBe("exploratory");
    expect(impliedTier("scale_role", "strong")).toBe("moderate");
    expect(impliedTier(null, "strong")).toBe("strong");
  });

  it("post-rule 6 and the scout · an inexpressible insight or a latent fit lifts a floor-Poor to Exploratory with it as the rationale; a gated Poor stays", () => {
    const insight = reconcile(poorFloors, blindAt("exploratory"), null, { reconciler: reconcilerAt({ inexpressible_insight: "Built adaptive platform trials in oncology." }) });
    expect(insight).toMatchObject({ row: "R6_ai_flagged_lead", tier: "exploratory", confidence: "review", rationale: "Built adaptive platform trials in oncology.", review: { kind: "ai_flagged_lead" } });
    const latent = { found: true, shape: "asset_ownership" as const, explanation: "Runs the banked cohort the notice needs.", evidence_ids: ["NCT04000001", "5R01AR070001"] };
    const scout = reconcile(poorFloors, blindAt("moderate", { scout: true, latent_fit: latent }), null);
    expect(scout).toMatchObject({ row: "R6_ai_flagged_lead", tier: "exploratory", rationale: latent.explanation });
    const scoutNoVerdict = reconcile(poorFloors, blindAt(null, { variants_at: [null, null], scout: true, latent_fit: latent }), null);
    expect(scoutNoVerdict).toMatchObject({ row: "R6_ai_flagged_lead", tier: "exploratory" });
    expect(reconcile(poorGated, blindAt("moderate", { scout: true, latent_fit: latent }), null)).toMatchObject({ row: "R7_gate_stands", tier: "poor" });
    expect(reconcile(poorFloors, blindAt("exploratory"), null)).toMatchObject({ row: "confirmed", tier: "poor", confidence: "medium" });
    expect(reconcile(poorFloors, blindAt("strong"), null)).toMatchObject({ row: "R6_ai_flagged_lead", tier: "poor", review: { kind: "ai_flagged_lead" } });
  });

  it("agreement and dissent below Strong · confirmed at high; a lower blind verdict stands at low with a review item; no blind verdict is structured only", () => {
    expect(reconcile(moderate, blindAt("moderate"), null)).toMatchObject({ row: "confirmed", tier: "moderate", confidence: "high", review: null });
    expect(reconcile(exploratory, blindAt("exploratory"), null)).toMatchObject({ row: "confirmed", tier: "exploratory", confidence: "high" });
    expect(reconcile(poorFloors, blindAt("poor"), null)).toMatchObject({ row: "confirmed", tier: "poor", confidence: "high" });
    expect(reconcile(moderate, blindAt("poor"), null)).toMatchObject({ row: "dissent_stands", tier: "moderate", confidence: "low", review: { kind: "ungrounded_dissent" } });
    expect(reconcile(exploratory, blindAt("moderate"), null)).toMatchObject({ row: "confirmed", tier: "exploratory", confidence: "medium" });
    expect(reconcile(moderate, null, null)).toMatchObject({ row: "structured_only", tier: "moderate", confidence: "structured_only" });
    expect(reconcile(strong, blindAt(null, { variants_at: [null, null] }), null)).toMatchObject({ row: "structured_only", tier: "strong" });
  });

  it("the rationale is the reconciler's when it cites evidence, else the engine's; caps are the re-scored engine's plus the stage-8 caps", () => {
    const r = reconcile(strong, blindAt("moderate"), skepticAt("scale_role"), { reconciler: reconcilerAt({ rationale: "Cites NCT04000001." }) });
    expect(r.rationale).toBe("Cites NCT04000001.");
    expect(reconcile(strong, blindAt("strong"), null).rationale).toBe(strong.rationale);
    const capped = fitAt("strong", { caps: ["runway_short"] });
    expect(reconcile(capped, blindAt("moderate"), skepticAt("scale_role")).caps).toEqual(["runway_short", "stage8_objection"]);
  });
});

describe("reconcile · finalizeResult, toAdjudication and applyAdjudication (the sweep's re-derivation)", () => {
  it("finalizeResult carries the tier, caps and text onto the result; toAdjudication is the compact summary", () => {
    const strong = fitAt("strong");
    const rec = reconcile(strong, blindAt("poor"), skepticAt("design"));
    const final = finalizeResult(strong, rec);
    expect(final).toMatchObject({ tier: "poor", caps: ["stage8_verdict"], why_not: strong.why_not ?? null });
    const adj = toAdjudication({ judged_at: "2026-09-06T00:00:00.000Z", model: "m", profile_versions: { investigator: "a", opportunity: "b", taxonomy: "t", judge: "j" }, blind: blindAt("poor"), skeptic: skepticAt("design"), reconciliation: rec, evidence: EVIDENCE.map((e) => ({ id: e.id, ref: e.ref })) });
    expect(adj).toMatchObject({ version: "judge-1", blind: { verdict: "poor", self_consistent: true, variants: [{ variant: 1, verdict: "poor" }, { variant: 2, verdict: "poor" }] }, skeptic: { objection_kind: "design", gate_level: true, grounded: true }, reconciliation: { row: "R3_strong_gate_objection", tier: "poor" } });
    expect(adj.evidence[0]).toEqual({ id: "PMID:31000001", ref: "publication:inv-lupus:31000001" });
  });

  it("applyAdjudication re-applies a provisional correction, re-scores and re-runs the table from the stored passes", () => {
    const ctx = hydrateContext({ paradigm: { recent: {} }, characteristics: { runway_weeks: 11 } }, {}, 0.85);
    const engine = scored();
    const weaker = { ...TRIALIST, design: { ...TRIALIST.design, rct: 0.1 } };
    const before = scored(weaker, SLE_TRIAL, 0.85);
    expect(before.tier).not.toBe("strong");
    const c = correction({ from: 0.1, to: 0.7, kind: "profile_weight", route: "provisional" });
    const rec = reconcile(before, blindAt("strong"), skepticAt(null), { rescored: engine, corrections: [applied(c, "proposed")] });
    const stored: StoredAdjudication = { investigator_id: "inv-lupus", opportunity_id: "opp-sle", profile_versions: { investigator: "x", opportunity: "y", taxonomy: "t", judge: "j" }, blind: blindAt("strong"), skeptic: skepticAt(null), reconciliation: { reconciler: reconcilerAt(), result: rec, evidence: [], engine: { tier: before.tier, score: before.score, caps: before.caps } }, model: "m", created_at: "2026-09-06T00:00:00.000Z" };
    const again = applyAdjudication(weaker, SLE_TRIAL, ctx, stored);
    expect(again.result.tier).toBe(rec.tier);
    expect(again.adjudication.reconciliation.row).toBe(rec.row);
    expect(again.adjudication.reconciliation.tier_structured).toBe(before.tier);
    expect(again.adjudication.judged_at).toBe("2026-09-06T00:00:00.000Z");
    const rejected: StoredAdjudication = { ...stored, reconciliation: { ...stored.reconciliation, result: { ...rec, corrections: [applied(c, "rejected")] } } };
    const without = applyAdjudication(weaker, SLE_TRIAL, ctx, rejected);
    expect(without.adjudication.reconciliation.tier_rescored).toBe(before.tier);
  });
});
