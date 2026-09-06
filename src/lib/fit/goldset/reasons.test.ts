import { describe, expect, it } from "vitest";
import { goldReasons, parseAxisSubReason, parseGoldLabel, parseReason, parseTier, WRONG_RESEARCH_TYPE } from "@/lib/fit/goldset/reasons";
import { FEEDBACK_REASON_IDS, feedbackReason, feedbackReasons, isFeedbackReason, reasonRequiredTiers, TaxonomyError, TIER_IDS, wrongResearchTypeSubreasons } from "@/lib/fit/taxonomy";

describe("taxonomy › feedback accessors", () => {
  it("reads the reasons, the required tiers and the sub-reasons from taxonomy.json", () => {
    expect(FEEDBACK_REASON_IDS).toContain("wrong_research_type");
    expect(feedbackReason("wrong_research_type")).toMatchObject({ id: "wrong_research_type", label: "Wrong type of research", axis_required: true, gold: true, dismissal: true });
    expect(feedbackReasons("gold").every((r) => r.gold)).toBe(true);
    expect(feedbackReasons("gold").map((r) => r.id)).not.toContain("already_aware");
    expect(feedbackReasons("dismissal").map((r) => r.id)).toContain("do_not_contact");
    expect(feedbackReasons("dismissal").map((r) => r.id)).not.toContain("thin_evidence");
    expect(reasonRequiredTiers()).toEqual(["exploratory", "poor"]);
    expect(wrongResearchTypeSubreasons().map((s) => s.id)).toEqual(["no_trials", "lab_work", "population_research", "wrong_model_system", "no_implementation", "wrong_data_type"]);
    expect(isFeedbackReason("wrong_type")).toBe(false);
    expect(() => feedbackReason("wrong_type")).toThrow(TaxonomyError);
  });
});

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
  it("accepts every taxonomy id, its label, the spec's phrasing and the pre-taxonomy alias", () => {
    for (const r of feedbackReasons()) {
      expect(parseReason(r.id)).toBe(r.id);
      expect(parseReason(r.label)).toBe(r.id);
    }
    expect(parseReason("Wrong type of research")).toBe("wrong_research_type");
    expect(parseReason("wrong_type")).toBe("wrong_research_type");
    expect(parseReason("wrong area")).toBe("not_relevant");
    expect(WRONG_RESEARCH_TYPE).toBe("wrong_research_type");
  });
  it("rejects unknown reasons", () => {
    expect(parseReason("meh")).toBeNull();
    expect(goldReasons().map((r) => r.id)).toEqual(["wrong_research_type", "not_relevant", "not_eligible", "wrong_person", "wrong_mechanism", "thin_evidence", "other"]);
  });
});

describe("goldset/reasons · parseAxisSubReason", () => {
  it("validates <axis> or <axis>:<category> against the taxonomy", () => {
    expect(parseAxisSubReason("paradigm:clinical_trials")).toEqual({ ok: true, value: { axis: "paradigm", category: "clinical_trials", axis_reason: "paradigm:clinical_trials" } });
    expect(parseAxisSubReason(" unit:L4 ")).toMatchObject({ ok: true, value: { axis: "unit", category: "L4" } });
    expect(parseAxisSubReason("materials:claims_administrative")).toMatchObject({ ok: true });
    expect(parseAxisSubReason("design")).toMatchObject({ ok: true, value: { axis: "design", category: null, axis_reason: "design" } });
    expect(parseAxisSubReason("materials")).toMatchObject({ ok: true, value: { axis: "materials", category: null, axis_reason: "materials" } });
  });
  it("names what is wrong: unknown axis, unknown category, a category on topic, empty", () => {
    expect(parseAxisSubReason("flavour:x")).toMatchObject({ ok: false, error: expect.stringMatching(/Unknown axis "flavour"/) });
    expect(parseAxisSubReason("paradigm:trials")).toMatchObject({ ok: false, error: expect.stringMatching(/"trials" is not a paradigm category/) });
    expect(parseAxisSubReason("topic:cancer")).toMatchObject({ ok: false, error: expect.stringMatching(/Topic has no categories/) });
    expect(parseAxisSubReason("")).toMatchObject({ ok: false });
  });
  it("every §12 sub-reason in the taxonomy is a valid sub-reason, and the axis-only ones name an axis alone (D34)", () => {
    for (const p of wrongResearchTypeSubreasons()) expect(parseAxisSubReason(p.axis_reason).ok).toBe(true);
    expect(wrongResearchTypeSubreasons().filter((p) => !p.axis_reason.includes(":")).map((p) => p.id)).toEqual(["wrong_model_system", "wrong_data_type"]);
  });
});

describe("goldset/reasons · parseGoldLabel", () => {
  it("Strong and Moderate need no reason; a reason is still validated when given", () => {
    expect(parseGoldLabel({ tier: "strong" })).toEqual({ ok: true, value: { tier: "strong", reason: null, axis_reason: null } });
    expect(parseGoldLabel({ tier: "moderate", reason: "not_relevant" })).toEqual({ ok: true, value: { tier: "moderate", reason: "not_relevant", axis_reason: null } });
    expect(parseGoldLabel({ tier: "moderate", reason: "nope" })).toMatchObject({ ok: false, error: expect.stringMatching(/not in the feedback taxonomy/) });
  });
  it("Exploratory and Poor need a gold reason from the taxonomy; a dismissal-only reason is refused", () => {
    expect(parseGoldLabel({ tier: "exploratory" })).toMatchObject({ ok: false, error: expect.stringMatching(/Exploratory labels need a reason/) });
    expect(parseGoldLabel({ tier: "poor", reason: "thin_evidence" })).toMatchObject({ ok: true, value: { tier: "poor", reason: "thin_evidence" } });
    expect(parseGoldLabel({ tier: "poor", reason: "already_aware" })).toMatchObject({ ok: false, error: expect.stringMatching(/dismissal reason, not a gold-label reason/) });
  });
  it("wrong_research_type needs an axis sub-reason (an axis alone is enough), and an axis sub-reason needs it", () => {
    expect(parseGoldLabel({ tier: "poor", reason: "wrong_research_type" })).toMatchObject({ ok: false, error: expect.stringMatching(/needs an axis sub-reason/) });
    expect(parseGoldLabel({ tier: "poor", reason: "wrong_type", axis_reason: "paradigm:epidemiology" })).toEqual({ ok: true, value: { tier: "poor", reason: "wrong_research_type", axis_reason: "paradigm:epidemiology" } });
    expect(parseGoldLabel({ tier: "poor", reason: "wrong_research_type", axis_reason: "materials" })).toEqual({ ok: true, value: { tier: "poor", reason: "wrong_research_type", axis_reason: "materials" } });
    expect(parseGoldLabel({ tier: "poor", reason: "wrong_research_type", axis_reason: "paradigm:nope" })).toMatchObject({ ok: false, error: expect.stringMatching(/not a paradigm category/) });
    expect(parseGoldLabel({ tier: "exploratory", reason: "not_relevant", axis_reason: "paradigm:epidemiology" })).toMatchObject({ ok: false, error: expect.stringMatching(/goes with a reason that names an axis \(wrong_research_type\)/) });
  });
  it("rejects a bad tier first", () => {
    expect(parseGoldLabel({ tier: "great", reason: "wrong_research_type" })).toMatchObject({ ok: false, error: expect.stringMatching(/Tier "great"/) });
  });
});
