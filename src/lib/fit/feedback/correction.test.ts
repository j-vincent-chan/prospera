/**
 * The one-click profile correction (PR 3.2): the proposed weight follows
 * spec §12's example, the sub-reason maps onto PR 3.1's path grammar, and the
 * row a confirmation writes has the shape PR 3.3's apply / reject read —
 * built through the same `parseCorrectionPath` / `fromMatches` / `coerceTo`
 * / `applyCorrectionToProfile` the judge's corrections go through.
 */
import { describe, expect, it } from "vitest";
import { axisPoorGate, buildDismissalCorrection, correctionPathFor, correctionPathLabel, PROPOSED_WEIGHT_STEP, proposedWeight, type DismissalCorrectionInput } from "@/lib/fit/feedback/correction";
import { applyCorrectionToProfile, fromMatches, parseCorrectionPath, readCorrectionPath } from "@/lib/fit/judge/corrections";
import { TRIALIST } from "@/lib/fit/judge/test-fixtures";
import { paradigmGates, unitGates } from "@/lib/fit/taxonomy";

const DISMISSAL = { reason: "wrong_research_type", axis_reason: "paradigm:clinical_trials", suggestion_id: "sug-1", item_id: "item-1", by: "user-1", at: "2026-09-06T10:00:00.000Z" };

const input = (over: Partial<DismissalCorrectionInput> = {}): DismissalCorrectionInput => ({ investigatorId: "inv-lupus", profile: TRIALIST, axisReason: "paradigm:clinical_trials", proposedBy: "strategist", dismissal: DISMISSAL, pair: { investigator_id: "inv-lupus", opportunity_id: "opp-sle" }, ...over });

describe("feedback/correction · proposedWeight", () => {
  it("lowers to one step below the axis gate (spec §12: 0.35 → 0.15), one step lower when already under it, never below 0", () => {
    expect(paradigmGates().poor_below).toBe(0.25);
    expect(PROPOSED_WEIGHT_STEP).toBe(0.1);
    expect(proposedWeight(0.35, "paradigm")).toBe(0.15);
    expect(proposedWeight(0.9, "paradigm")).toBe(0.15);
    expect(proposedWeight(0.25, "paradigm")).toBe(0.15);
    expect(proposedWeight(0.2, "paradigm")).toBe(0.1);
    expect(proposedWeight(0.05, "paradigm")).toBe(0);
    expect(axisPoorGate("unit")).toBe(unitGates().poor_below);
    expect(proposedWeight(0.5, "unit")).toBe(Math.round((unitGates().poor_below - 0.1) * 100) / 100);
    expect(axisPoorGate("materials")).toBe(paradigmGates().poor_below);
  });
});

describe("feedback/correction · correctionPathFor", () => {
  it("maps a sub-reason that names a category onto PR 3.1's grammar; an axis-only or topic sub-reason maps to nothing", () => {
    expect(correctionPathFor("paradigm:clinical_trials")).toMatchObject({ parsed: { path: "paradigm.recent.clinical_trials", keys: ["paradigm", "recent", "clinical_trials"], value: "weight" }, axis: "paradigm", category: "clinical_trials" });
    expect(correctionPathFor("materials:animal_mouse")).toMatchObject({ parsed: { path: "materials.animal_mouse" }, axis: "materials" });
    expect(correctionPathFor("unit:L3")).toMatchObject({ parsed: { path: "unit.L3" } });
    expect(correctionPathFor("design:rct")).toMatchObject({ parsed: { path: "design.rct" } });
    expect(correctionPathFor("materials")).toBeNull();
    expect(correctionPathFor("topic")).toBeNull();
    expect(correctionPathFor("paradigm:nope")).toBeNull();
    expect(correctionPathFor(null)).toBeNull();
  });
});

describe("feedback/correction · buildDismissalCorrection", () => {
  it("writes the row PR 3.3 approves: investigator_profile, the axis path, the stored weight, the lowered weight, profile_weight, proposed, the dismissal as evidence", () => {
    const r = buildDismissalCorrection(input());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row).toEqual({
      target: "investigator_profile",
      target_id: "inv-lupus",
      path: "paradigm.recent.clinical_trials",
      from_value: 0.81,
      to_value: 0.15,
      evidence: { ids: [], quote: null, section: null, confidence: "high", pair: { investigator_id: "inv-lupus", opportunity_id: "opp-sle" }, via: "dismissal", dismissal: DISMISSAL },
      kind: "profile_weight",
      proposed_by: "strategist",
      status: "proposed",
      decided_by: null,
      decided_at: null,
    });
    expect(r.preview).toMatchObject({ path: "paradigm.recent.clinical_trials", axis: "paradigm", category: "clinical_trials", label: "Paradigm · Clinical trials", from: 0.81, to: 0.15 });
    expect(r.preview.sentence).toBe("Lower Clinical trials (paradigm, recent view) from 0.81 to 0.15 on the fit profile?");
    // the row goes through 3.1's grammar and value checks, and applies with 3.1's patch
    const p = parseCorrectionPath("investigator", r.row.path)!;
    expect(p).toBeTruthy();
    expect(fromMatches(p, r.row.from_value, readCorrectionPath(TRIALIST, p))).toBe(true);
    expect(readCorrectionPath(r.patched, p)).toBe(0.15);
    expect(applyCorrectionToProfile(TRIALIST, { target: "investigator", path: r.row.path, to: r.row.to_value })).toEqual(r.patched);
    expect(TRIALIST.paradigm.recent.clinical_trials).toBe(0.81);
  });

  it("carries who confirmed: investigator on their own page, strategist elsewhere; the pair may be unknown", () => {
    const pi = buildDismissalCorrection(input({ proposedBy: "investigator", pair: null }));
    expect(pi.ok && pi.row.proposed_by).toBe("investigator");
    expect(pi.ok && pi.row.evidence.pair).toBeNull();
  });

  it("other axes: a materials kind lowers to below the paradigm gate; a unit level to below the unit gate; a weight of 0 after the step removes the key", () => {
    const mat = buildDismissalCorrection(input({ axisReason: "materials:enrolled_participants" }));
    expect(mat.ok && [mat.row.path, mat.row.from_value, mat.row.to_value]).toEqual(["materials.enrolled_participants", 0.9, 0.15]);
    const unit = buildDismissalCorrection(input({ axisReason: "unit:L4" }));
    expect(unit.ok && [unit.row.path, unit.row.from_value, unit.row.to_value]).toEqual(["unit.L4", 0.4, 0.1]);
    const low = buildDismissalCorrection(input({ profile: { ...TRIALIST, design: { rct: 0.05 } }, axisReason: "design:rct" }));
    expect(low.ok && [low.row.from_value, low.row.to_value]).toEqual([0.05, 0]);
    expect(low.ok && (low.patched.design as Record<string, number>).rct).toBeUndefined();
  });

  it("proposes nothing for a category the profile does not carry, an axis-only sub-reason, the topic axis, or an unknown id — with the reason", () => {
    expect(buildDismissalCorrection(input({ axisReason: "paradigm:epidemiology" }))).toMatchObject({ ok: false, reason: expect.stringMatching(/does not carry Paradigm · Epidemiology/) });
    expect(buildDismissalCorrection(input({ axisReason: "materials" }))).toMatchObject({ ok: false, reason: expect.stringMatching(/names an axis but no category/) });
    expect(buildDismissalCorrection(input({ axisReason: "topic" }))).toMatchObject({ ok: false, reason: expect.stringMatching(/Topic never gates/) });
    expect(buildDismissalCorrection(input({ axisReason: "paradigm:nope" }))).toMatchObject({ ok: false, reason: expect.stringMatching(/not a paradigm category/) });
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
