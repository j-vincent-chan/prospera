/**
 * Dismissal reasons (PR 3.2): the accepted set is the migration's CHECK, the
 * parser validates reasons and the "wrong type of research" sub-reason
 * against the taxonomy, the menu differs by engine, the labels read right.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DISMISS_REASONS, dismissReasonLabel, dismissReasonOptions, isDismissReason, LEGACY_DISMISS_REASONS, parseDismissal, reasonNeedsAxis, subreasonOf, WRONG_RESEARCH_TYPE } from "@/lib/fit/feedback/dismissal";
import { feedbackReasons, wrongResearchTypeSubreasons } from "@/lib/fit/taxonomy";

const MIGRATION = "supabase/migrations/20260920100000_outreach_dismissal_reasons.sql";

describe("feedback/dismissal · the accepted set", () => {
  it("is the taxonomy's dismissal reasons plus the legacy ids, and matches the migration's CHECK exactly", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const m = sql.match(/dismissed_reason IN \(([^)]+)\)/);
    expect(m, "the migration lists the reasons in a CHECK").toBeTruthy();
    const inSql = Array.from(m![1]!.matchAll(/'([a-z_]+)'/g)).map((x) => x[1]!).sort();
    expect([...DISMISS_REASONS].sort()).toEqual(inSql);
    for (const r of feedbackReasons("dismissal")) expect(DISMISS_REASONS).toContain(r.id);
    for (const r of LEGACY_DISMISS_REASONS) expect(DISMISS_REASONS).toContain(r);
    expect(DISMISS_REASONS).toContain("wrong_research_type");
    expect(DISMISS_REASONS).toContain("not_eligible");
    // gold-only reasons never become dismissal reasons
    expect(DISMISS_REASONS).not.toContain("thin_evidence");
    expect(DISMISS_REASONS).not.toContain("wrong_mechanism");
    expect(isDismissReason("wrong_area")).toBe(true);
    expect(isDismissReason("nope")).toBe(false);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS axis_reason TEXT/);
  });

  it("only 'wrong type of research' needs an axis", () => {
    expect(reasonNeedsAxis(WRONG_RESEARCH_TYPE)).toBe(true);
    for (const r of DISMISS_REASONS.filter((x) => x !== WRONG_RESEARCH_TYPE)) expect(reasonNeedsAxis(r)).toBe(false);
  });
});

describe("feedback/dismissal · parseDismissal", () => {
  it("no reason is a plain dismissal; an unknown reason is refused", () => {
    expect(parseDismissal({})).toEqual({ ok: true, value: { reason: null, axis_reason: null, axis: null } });
    expect(parseDismissal({ reason: "" })).toEqual({ ok: true, value: { reason: null, axis_reason: null, axis: null } });
    expect(parseDismissal({ reason: "spam" })).toMatchObject({ ok: false, error: expect.stringMatching(/not a dismissal reason/) });
    expect(parseDismissal({ reason: "thin_evidence" })).toMatchObject({ ok: false });
  });

  it("a legacy or taxonomy reason without a sub-reason passes; a sub-reason without a reason, or with a reason that names no axis, is refused", () => {
    expect(parseDismissal({ reason: "wrong_area" })).toEqual({ ok: true, value: { reason: "wrong_area", axis_reason: null, axis: null } });
    expect(parseDismissal({ reason: "not_eligible" })).toEqual({ ok: true, value: { reason: "not_eligible", axis_reason: null, axis: null } });
    expect(parseDismissal({ axisReason: "paradigm:clinical_trials" })).toMatchObject({ ok: false, error: expect.stringMatching(/needs a reason/) });
    expect(parseDismissal({ reason: "not_relevant", axisReason: "paradigm:clinical_trials" })).toMatchObject({ ok: false, error: expect.stringMatching(/goes with/) });
  });

  it("'wrong type of research' needs a sub-reason in <axis> or <axis>:<category> form, checked against the taxonomy", () => {
    expect(parseDismissal({ reason: WRONG_RESEARCH_TYPE })).toMatchObject({ ok: false, error: expect.stringMatching(/needs a sub-reason/) });
    expect(parseDismissal({ reason: WRONG_RESEARCH_TYPE, axisReason: " paradigm:clinical_trials " })).toEqual({ ok: true, value: { reason: WRONG_RESEARCH_TYPE, axis_reason: "paradigm:clinical_trials", axis: { axis: "paradigm", category: "clinical_trials", axis_reason: "paradigm:clinical_trials" } } });
    expect(parseDismissal({ reason: WRONG_RESEARCH_TYPE, axisReason: "materials" })).toMatchObject({ ok: true, value: { axis_reason: "materials", axis: { axis: "materials", category: null } } });
    expect(parseDismissal({ reason: WRONG_RESEARCH_TYPE, axisReason: "materials:animal_mouse" })).toMatchObject({ ok: true, value: { axis_reason: "materials:animal_mouse" } });
    expect(parseDismissal({ reason: WRONG_RESEARCH_TYPE, axisReason: "paradigm:nope" })).toMatchObject({ ok: false, error: expect.stringMatching(/not a paradigm category/) });
    expect(parseDismissal({ reason: WRONG_RESEARCH_TYPE, axisReason: "flavor:sweet" })).toMatchObject({ ok: false, error: expect.stringMatching(/Unknown axis/) });
    expect(parseDismissal({ reason: WRONG_RESEARCH_TYPE, axisReason: "topic:cancer" })).toMatchObject({ ok: false, error: expect.stringMatching(/Topic has no categories/) });
    // every §12 preset parses
    for (const p of wrongResearchTypeSubreasons()) expect(parseDismissal({ reason: WRONG_RESEARCH_TYPE, axisReason: p.axis_reason })).toMatchObject({ ok: true, value: { axis_reason: p.axis_reason } });
  });
});

describe("feedback/dismissal · menus and labels", () => {
  it("a legacy team keeps its five reasons and labels; a fit-v1 team gets the taxonomy's, 'wrong type of research' first with the sub-reason marker, do-not-contact last and destructive", () => {
    const legacy = dismissReasonOptions("legacy");
    expect(legacy.map((o) => o.id)).toEqual([...LEGACY_DISMISS_REASONS]);
    expect(legacy.map((o) => o.label)).toEqual(["Not relevant to this notice", "Wrong research area", "Wrong person (fixes the profile)", "Already aware", "Do not contact (all opportunities)"]);
    expect(legacy.every((o) => !o.axis)).toBe(true);
    expect(legacy.find((o) => o.destructive)?.id).toBe("do_not_contact");

    const fit = dismissReasonOptions("fit-v1");
    expect(fit.map((o) => o.id)).toEqual(feedbackReasons("dismissal").map((r) => r.id));
    expect(fit[0]).toMatchObject({ id: WRONG_RESEARCH_TYPE, axis: true, label: "Wrong type of research…" });
    expect(fit.filter((o) => o.axis).map((o) => o.id)).toEqual([WRONG_RESEARCH_TYPE]);
    expect(fit.filter((o) => o.destructive).map((o) => o.id)).toEqual(["do_not_contact"]);
    expect(fit.map((o) => o.id)).not.toContain("wrong_area");
  });

  it("labels: a legacy id reads as before; a sub-reason names the preset, or the category under an axis-only preset", () => {
    expect(dismissReasonLabel("wrong_area")).toBe("wrong research area");
    expect(dismissReasonLabel("not_eligible")).toMatch(/^not eligible/);
    expect(dismissReasonLabel(WRONG_RESEARCH_TYPE)).toBe("wrong type of research");
    expect(dismissReasonLabel(WRONG_RESEARCH_TYPE, "paradigm:clinical_trials")).toBe("wrong type of research · I don't run trials");
    expect(dismissReasonLabel(WRONG_RESEARCH_TYPE, "materials:animal_mouse")).toMatch(/^wrong type of research · .+ · mouse$/);
    expect(dismissReasonLabel(WRONG_RESEARCH_TYPE, "materials")).toMatch(/^wrong type of research · /);
    expect(dismissReasonLabel(WRONG_RESEARCH_TYPE, "unit:L2")).toMatch(/^wrong type of research · /);
    expect(subreasonOf("paradigm:clinical_trials")).toMatchObject({ preset: { id: "no_trials" }, axis: "paradigm", category: "clinical_trials" });
    expect(subreasonOf("materials:ehr")).toMatchObject({ preset: { axis_reason: "materials" }, axis: "materials", category: "ehr" });
    expect(subreasonOf(null)).toEqual({ preset: null, axis: null, category: null });
  });
});
