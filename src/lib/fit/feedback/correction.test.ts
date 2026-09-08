/**
 * The one-click profile correction (PR 3.2): the proposed weight follows
 * spec §12's example with the step and the gate read from the taxonomy, the
 * sub-reason maps onto PR 3.1's path grammar (both paradigm views), and the
 * rows a confirmation writes have the shape PR 3.3's apply / reject read —
 * built through the same `parseCorrectionPath` / `fromMatches` / `coerceTo`
 * / `applyCorrectionToProfile` the judge's corrections go through.
 */
import { describe, expect, it } from "vitest";
import { chooseView } from "@/lib/fit/engine/paradigm";
import { axisPoorGate, buildDismissalCorrection, correctionPathLabel, correctionPathsFor, previewFor, proposedWeight, type DismissalCorrectionInput } from "@/lib/fit/feedback/correction";
import { applyCorrectionToProfile, evidenceHash, fromMatches, parseCorrectionPath, readCorrectionPath } from "@/lib/fit/judge/corrections";
import { TRIALIST } from "@/lib/fit/judge/test-fixtures";
import { correctionGateFallbackAxis, correctionStep, paradigmGates, thinEvidence, unitGates } from "@/lib/fit/taxonomy";

const DISMISSAL = { reason: "wrong_research_type", axis_reason: "paradigm:clinical_trials", suggestion_id: "sug-1", item_id: "item-1", by: "user-1", at: "2026-09-06T10:00:00.000Z" };

const input = (over: Partial<DismissalCorrectionInput> = {}): DismissalCorrectionInput => ({ investigatorId: "inv-lupus", profile: TRIALIST, axisReason: "paradigm:clinical_trials", proposedBy: "strategist", dismissal: DISMISSAL, pair: { investigator_id: "inv-lupus", opportunity_id: "opp-sle" }, ...over });

const round2 = (n: number) => Math.round(n * 100) / 100;

describe("feedback/correction · proposedWeight", () => {
  it("lowers to feedback.correction_step below the axis gate (spec §12: 0.35 → 0.15), one step lower when already under it, never below 0 — every number from the taxonomy", () => {
    const step = correctionStep();
    const gate = paradigmGates().poor_below;
    expect(step).toBeGreaterThan(0);
    expect(step).toBeLessThan(1);
    expect(proposedWeight(0.35, "paradigm")).toBe(round2(gate - step));
    expect(proposedWeight(0.9, "paradigm")).toBe(round2(gate - step));
    expect(proposedWeight(gate, "paradigm")).toBe(round2(gate - step));
    expect(proposedWeight(0.2, "paradigm")).toBe(round2(0.2 - step));
    expect(proposedWeight(step / 2, "paradigm")).toBe(0);
    // the spec's example holds for the taxonomy as shipped
    expect([gate, step, proposedWeight(0.35, "paradigm")]).toEqual([0.25, 0.1, 0.15]);
    expect(axisPoorGate("unit")).toBe(unitGates().poor_below);
    expect(proposedWeight(0.5, "unit")).toBe(round2(unitGates().poor_below - step));
    // design / materials / objective have no gate and borrow feedback.correction_gate_fallback_axis's
    const fallback = axisPoorGate(correctionGateFallbackAxis());
    expect(axisPoorGate("materials")).toBe(fallback);
    expect(axisPoorGate("design")).toBe(fallback);
    expect(axisPoorGate("objective")).toBe(fallback);
  });
});

describe("feedback/correction · correctionPathsFor", () => {
  it("maps a sub-reason that names a category onto PR 3.1's grammar — both views for paradigm, one path elsewhere; an axis-only or topic sub-reason maps to nothing", () => {
    const paradigm = correctionPathsFor("paradigm:clinical_trials");
    expect(paradigm).toMatchObject({ axis: "paradigm", category: "clinical_trials" });
    expect(paradigm!.paths.map((p) => [p.path, p.value])).toEqual([
      ["paradigm.recent.clinical_trials", "weight"],
      ["paradigm.career.clinical_trials", "weight"],
    ]);
    expect(correctionPathsFor("materials:animal_mouse")!.paths.map((p) => p.path)).toEqual(["materials.animal_mouse"]);
    expect(correctionPathsFor("unit:L3")!.paths.map((p) => p.path)).toEqual(["unit.L3"]);
    expect(correctionPathsFor("design:rct")!.paths.map((p) => p.path)).toEqual(["design.rct"]);
    expect(correctionPathsFor("materials")).toBeNull();
    expect(correctionPathsFor("topic")).toBeNull();
    expect(correctionPathsFor("paradigm:nope")).toBeNull();
    expect(correctionPathsFor(null)).toBeNull();
  });
});

describe("feedback/correction · buildDismissalCorrection", () => {
  it("writes the rows PR 3.3 approves: investigator_profile, one row per paradigm view, the stored weight, the lowered weight, profile_weight, proposed, the dismissal as evidence", () => {
    const r = buildDismissalCorrection(input());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const common = {
      target: "investigator_profile",
      target_id: "inv-lupus",
      to_value: 0.15,
      evidence: { ids: [], quote: null, section: null, confidence: "high", pair: { investigator_id: "inv-lupus", opportunity_id: "opp-sle" }, via: "dismissal", dismissal: DISMISSAL },
      kind: "profile_weight",
      proposed_by: "strategist",
      status: "proposed",
      decided_by: null,
      decided_at: null,
      // PR 3.3: a confirmation carries the digest of what it rests on, so a rejection of this argument blocks it wherever it is raised again.
      evidence_hash: evidenceHash({ ids: [], quote: null, section: null, confidence: "high", pair: { investigator_id: "inv-lupus", opportunity_id: "opp-sle" }, via: "dismissal", dismissal: DISMISSAL }),
    };
    expect(r.rows).toEqual([
      { ...common, path: "paradigm.recent.clinical_trials", from_value: 0.81 },
      { ...common, path: "paradigm.career.clinical_trials", from_value: 0.7 },
    ]);
    expect(r.preview).toMatchObject({ path: "paradigm.recent.clinical_trials", paths: ["paradigm.recent.clinical_trials", "paradigm.career.clinical_trials"], axis: "paradigm", category: "clinical_trials", label: "Paradigm · Clinical trials", from: 0.81, to: 0.15 });
    expect(r.preview.edits).toEqual([
      { path: "paradigm.recent.clinical_trials", view: "recent", from: 0.81, to: 0.15 },
      { path: "paradigm.career.clinical_trials", view: "career", from: 0.7, to: 0.15 },
    ]);
    expect(r.preview.sentence).toBe("Lower Clinical trials (paradigm) from 0.81 to 0.15 in the recent view and from 0.70 to 0.15 in the career view on the fit profile?");
    // every row goes through 3.1's grammar and value checks, and the set applies with 3.1's patch
    let patched = TRIALIST;
    for (const row of r.rows) {
      const p = parseCorrectionPath("investigator", row.path)!;
      expect(p).toBeTruthy();
      expect(fromMatches(p, row.from_value, readCorrectionPath(TRIALIST, p))).toBe(true);
      expect(readCorrectionPath(r.patched, p)).toBe(0.15);
      patched = applyCorrectionToProfile(patched, { target: "investigator", path: row.path, to: row.to_value });
    }
    expect(patched).toEqual(r.patched);
    expect(TRIALIST.paradigm.recent.clinical_trials).toBe(0.81);
    expect(TRIALIST.paradigm.career.clinical_trials).toBe(0.7);
  });

  it("F1: lowering both views leaves the category below the Poor gate in whichever view chooseView picks; the recent row alone would not", () => {
    const profile = { ...TRIALIST, paradigm: { recent: { clinical_trials: 0.81, translational: 0.19 }, career: { clinical_trials: 0.7, clinical_observational: 0.6, translational: 0.3 } } };
    const gate = paradigmGates().poor_below;
    expect(chooseView(profile)).toBe("recent");
    const r = buildDismissalCorrection(input({ profile }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows.map((row) => [row.path, row.from_value, row.to_value])).toEqual([
      ["paradigm.recent.clinical_trials", 0.81, 0.15],
      ["paradigm.career.clinical_trials", 0.7, 0.15],
    ]);
    // after both rows: recent tops out at translational 0.19 ≤ thin_evidence.cap 0.30, so the engine scores the career view — where clinical_trials is now 0.15 < 0.25
    const view = chooseView(r.patched);
    expect(view).toBe("career");
    expect(thinEvidence().cap).toBe(0.3);
    expect(r.patched.paradigm[view].clinical_trials).toBe(0.15);
    expect(r.patched.paradigm[view].clinical_trials!).toBeLessThan(gate);
    // the recent row alone (the pre-F1 proposal) re-opens the gate through the career view: 0.70 ≥ 0.25
    const recentOnly = applyCorrectionToProfile(profile, { target: "investigator", path: "paradigm.recent.clinical_trials", to: 0.15 });
    expect(chooseView(recentOnly)).toBe("career");
    expect(recentOnly.paradigm.career.clinical_trials).toBe(0.7);
    expect(recentOnly.paradigm.career.clinical_trials!).toBeGreaterThanOrEqual(gate);
  });

  it("a paradigm category the career view does not carry proposes the recent row alone, with the one-view sentence; one carried only in the career view proposes that row", () => {
    const recentOnly = buildDismissalCorrection(input({ profile: { ...TRIALIST, paradigm: { recent: { clinical_trials: 0.81 }, career: { clinical_observational: 0.6 } } } }));
    expect(recentOnly.ok && recentOnly.rows.map((r) => r.path)).toEqual(["paradigm.recent.clinical_trials"]);
    expect(recentOnly.ok && recentOnly.preview.sentence).toBe("Lower Clinical trials (paradigm, recent view) from 0.81 to 0.15 on the fit profile?");
    const careerOnly = buildDismissalCorrection(input({ profile: { ...TRIALIST, paradigm: { recent: { translational: 0.2 }, career: { clinical_trials: 0.5 } } } }));
    expect(careerOnly.ok && careerOnly.rows.map((r) => [r.path, r.from_value, r.to_value])).toEqual([["paradigm.career.clinical_trials", 0.5, 0.15]]);
    expect(careerOnly.ok && careerOnly.preview.sentence).toBe("Lower Clinical trials (paradigm, career view) from 0.50 to 0.15 on the fit profile?");
  });

  it("carries who confirmed: investigator on their own page, strategist elsewhere; the pair may be unknown", () => {
    const pi = buildDismissalCorrection(input({ proposedBy: "investigator", pair: null }));
    expect(pi.ok && pi.rows.map((r) => r.proposed_by)).toEqual(["investigator", "investigator"]);
    expect(pi.ok && pi.rows.map((r) => r.evidence.pair)).toEqual([null, null]);
  });

  it("other axes: one row; a materials kind lowers to below the fallback gate; a unit level to below the unit gate; a weight of 0 after the step removes the key", () => {
    const mat = buildDismissalCorrection(input({ axisReason: "materials:enrolled_participants" }));
    expect(mat.ok && mat.rows.map((r) => [r.path, r.from_value, r.to_value])).toEqual([["materials.enrolled_participants", 0.9, 0.15]]);
    expect(mat.ok && mat.preview.sentence).toBe("Lower Enrolled participants (materials and data) from 0.90 to 0.15 on the fit profile?");
    const unit = buildDismissalCorrection(input({ axisReason: "unit:L4" }));
    expect(unit.ok && unit.rows.map((r) => [r.path, r.from_value, r.to_value])).toEqual([["unit.L4", 0.4, 0.1]]);
    const low = buildDismissalCorrection(input({ profile: { ...TRIALIST, design: { rct: 0.05 } }, axisReason: "design:rct" }));
    expect(low.ok && low.rows.map((r) => [r.from_value, r.to_value])).toEqual([[0.05, 0]]);
    expect(low.ok && (low.patched.design as Record<string, number>).rct).toBeUndefined();
  });

  it("proposes nothing for a category the profile carries in no view, an axis-only sub-reason, the topic axis, or an unknown id — with the reason", () => {
    expect(buildDismissalCorrection(input({ axisReason: "paradigm:epidemiology" }))).toMatchObject({ ok: false, reason: expect.stringMatching(/does not carry Paradigm · Epidemiology \(weight 0 in both views\)/) });
    expect(buildDismissalCorrection(input({ axisReason: "materials:animal_mouse" }))).toMatchObject({ ok: false, reason: expect.stringMatching(/does not carry Materials and data · Mouse \(weight 0\); there is nothing to lower/) });
    expect(buildDismissalCorrection(input({ axisReason: "materials" }))).toMatchObject({ ok: false, reason: expect.stringMatching(/names an axis but no category/) });
    expect(buildDismissalCorrection(input({ axisReason: "topic" }))).toMatchObject({ ok: false, reason: expect.stringMatching(/Topic never gates/) });
    expect(buildDismissalCorrection(input({ axisReason: "paradigm:nope" }))).toMatchObject({ ok: false, reason: expect.stringMatching(/not a paradigm category/) });
  });
});

describe("feedback/correction · previewFor", () => {
  it("names each paradigm view in one sentence; a one-view axis reads as before; the first edit is the toast's line", () => {
    const two = previewFor("paradigm", "clinical_trials", [
      { path: "paradigm.recent.clinical_trials", view: "recent", from: 0.81, to: 0.15 },
      { path: "paradigm.career.clinical_trials", view: "career", from: 0.7, to: 0.15 },
    ]);
    expect(two).toMatchObject({ path: "paradigm.recent.clinical_trials", paths: ["paradigm.recent.clinical_trials", "paradigm.career.clinical_trials"], from: 0.81, to: 0.15, label: "Paradigm · Clinical trials" });
    expect(two.sentence).toMatch(/^Lower Clinical trials \(paradigm\) from 0\.81 to 0\.15 in the recent view and from 0\.70 to 0\.15 in the career view on the fit profile\?$/);
    const one = previewFor("paradigm", "clinical_trials", [{ path: "paradigm.career.clinical_trials", view: "career", from: 0.7, to: 0.15 }]);
    expect(one.sentence).toBe("Lower Clinical trials (paradigm, career view) from 0.70 to 0.15 on the fit profile?");
    expect(() => previewFor("paradigm", "clinical_trials", [])).toThrow(/at least one edit/);
  });
});

describe("feedback/correction · correctionPathLabel", () => {
  it("reads a stored path back as the inspector's labels; an unknown path is shown as is", () => {
    expect(correctionPathLabel("investigator_profile", "paradigm.recent.clinical_trials")).toBe("Paradigm · Clinical trials");
    expect(correctionPathLabel("investigator_profile", "paradigm.career.translational")).toBe("Paradigm · Translational (career view)");
    expect(correctionPathLabel("investigator_profile", "design.rct")).toMatch(/^Study design · /);
    expect(correctionPathLabel("investigator_profile", "characteristics.trial_pi_count")).toBe("Characteristics · trial pi count");
    expect(correctionPathLabel("opportunity_profile", "paradigm.required.human_biospecimen")).toMatch(/^Notice paradigm required · /);
    expect(correctionPathLabel("opportunity_profile", "design.required_any")).toBe("Notice study design · required any");
    expect(correctionPathLabel("investigator_profile", "topic.terms")).toBe("topic.terms");
  });
});
