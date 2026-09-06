import { describe, expect, it } from "vitest";
import { FEEDBACK_REASON_IDS, FEEDBACK_REASONS, parseAxisSubReason, parseGoldLabel, parseReason, parseTier, WRONG_TYPE_PRESETS } from "@/lib/fit/goldset/reasons";
import { TIER_IDS } from "@/lib/fit/taxonomy";

describe("goldset/reasons · parseTier", () => {
  it("accepts the taxonomy's four tiers, case-insensitively and trimmed", () => {
    for (const t of TIER_IDS) expect(parseTier(` ${t.toUpperCase()} `)).toBe(t);
  });
  it("maps the D33 pill vocabulary: Potential → moderate, Strong match → strong", () => {
    expect(parseTier("Potential")).toBe("moderate");
    expect(parseTier("potential match")).toBe("moderate");
    expect(parseTier("Strong match")).toBe("strong");
  });
  it("rejects anything else", () => {
    expect(parseTier("")).toBeNull();
    expect(parseTier("great")).toBeNull();
    expect(parseTier(null)).toBeNull();
  });
});

describe("goldset/reasons · parseReason", () => {
  it("accepts every id, its label, and the spec's phrasing", () => {
    for (const r of FEEDBACK_REASONS) {
      expect(parseReason(r.id)).toBe(r.id);
      expect(parseReason(r.label)).toBe(r.id);
    }
    expect(parseReason("Wrong type of research")).toBe("wrong_type");
    expect(parseReason("wrong area")).toBe("not_relevant");
  });
  it("rejects unknown reasons", () => {
    expect(parseReason("meh")).toBeNull();
    expect(FEEDBACK_REASON_IDS).toContain("wrong_type");
  });
});

describe("goldset/reasons · parseAxisSubReason", () => {
  it("validates <axis>:<category> against the taxonomy", () => {
    expect(parseAxisSubReason("paradigm:clinical_trials")).toEqual({ ok: true, value: { axis: "paradigm", category: "clinical_trials", axis_reason: "paradigm:clinical_trials" } });
    expect(parseAxisSubReason(" unit:L4 ")).toMatchObject({ ok: true, value: { axis: "unit", category: "L4" } });
    expect(parseAxisSubReason("materials:claims_administrative")).toMatchObject({ ok: true });
    expect(parseAxisSubReason("design")).toMatchObject({ ok: true, value: { axis: "design", category: null, axis_reason: "design" } });
  });
  it("names what is wrong: unknown axis, unknown category, a category on topic, empty", () => {
    expect(parseAxisSubReason("flavour:x")).toMatchObject({ ok: false, error: expect.stringMatching(/Unknown axis "flavour"/) });
    expect(parseAxisSubReason("paradigm:trials")).toMatchObject({ ok: false, error: expect.stringMatching(/"trials" is not a paradigm category/) });
    expect(parseAxisSubReason("topic:cancer")).toMatchObject({ ok: false, error: expect.stringMatching(/Topic has no categories/) });
    expect(parseAxisSubReason("")).toMatchObject({ ok: false });
  });
  it("every §12 preset is a valid sub-reason", () => {
    for (const p of WRONG_TYPE_PRESETS) expect(parseAxisSubReason(p.axis_reason).ok).toBe(true);
  });
});

describe("goldset/reasons · parseGoldLabel", () => {
  it("Strong and Moderate need no reason; a reason is still validated when given", () => {
    expect(parseGoldLabel({ tier: "strong" })).toEqual({ ok: true, value: { tier: "strong", reason: null, axis_reason: null } });
    expect(parseGoldLabel({ tier: "moderate", reason: "not_relevant" })).toEqual({ ok: true, value: { tier: "moderate", reason: "not_relevant", axis_reason: null } });
    expect(parseGoldLabel({ tier: "moderate", reason: "nope" })).toMatchObject({ ok: false, error: expect.stringMatching(/not in the feedback taxonomy/) });
  });
  it("Exploratory and Poor need a reason from the list", () => {
    expect(parseGoldLabel({ tier: "exploratory" })).toMatchObject({ ok: false, error: expect.stringMatching(/Exploratory labels need a reason/) });
    expect(parseGoldLabel({ tier: "poor", reason: "thin_evidence" })).toMatchObject({ ok: true, value: { tier: "poor", reason: "thin_evidence" } });
  });
  it("wrong_type needs an axis sub-reason, and an axis sub-reason needs wrong_type", () => {
    expect(parseGoldLabel({ tier: "poor", reason: "wrong_type" })).toMatchObject({ ok: false, error: expect.stringMatching(/needs an axis sub-reason/) });
    expect(parseGoldLabel({ tier: "poor", reason: "wrong_type", axis_reason: "paradigm:epidemiology" })).toEqual({ ok: true, value: { tier: "poor", reason: "wrong_type", axis_reason: "paradigm:epidemiology" } });
    expect(parseGoldLabel({ tier: "poor", reason: "wrong_type", axis_reason: "paradigm:nope" })).toMatchObject({ ok: false, error: expect.stringMatching(/not a paradigm category/) });
    expect(parseGoldLabel({ tier: "exploratory", reason: "not_relevant", axis_reason: "paradigm:epidemiology" })).toMatchObject({ ok: false, error: expect.stringMatching(/goes with the reason "wrong_type"/) });
  });
  it("rejects a bad tier first", () => {
    expect(parseGoldLabel({ tier: "great", reason: "wrong_type" })).toMatchObject({ ok: false, error: expect.stringMatching(/Tier "great"/) });
  });
});
