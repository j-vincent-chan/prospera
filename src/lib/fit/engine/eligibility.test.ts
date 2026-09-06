import { describe, expect, it } from "vitest";
import { degreeTokens, eligibility, noticeFamilies } from "@/lib/fit/engine/eligibility";
import { hydrateContext, hydrateInvestigator, hydrateOpportunity, type FixtureInvestigator, type FixtureOpportunity } from "@/lib/fit/engine/fixtures";
import signalMapping from "@/lib/fit/signal-mapping.json";
import { eligibilityVocabulary, parseEligibilityVocabulary, SignalMappingError } from "@/lib/fit/signal-mapping";

const inv = (fx: Partial<FixtureInvestigator> = {}) => hydrateInvestigator("i", { paradigm: { recent: { clinical_trials: 0.9 } }, ...fx });
const opp = (fx: FixtureOpportunity = {}) => hydrateOpportunity("o", { paradigm: { required: { clinical_trials: 1 } }, ...fx });
const ctx = (runway: number | null = 10) => hydrateContext({ paradigm: { recent: {} }, characteristics: { runway_weeks: runway } });
const run = (i: FixtureInvestigator | Partial<FixtureInvestigator>, o: FixtureOpportunity = {}, runway: number | null = 10) => eligibility(inv(i), opp(o), ctx(runway));

describe("stage 1 · eligibility (§7 stage 1; §9 exclude rows)", () => {
  it("passes with no rules and no flags", () => {
    expect(run({})).toEqual({ E: 1, failed: [], unknown: [] });
  });

  it("ESI-only: fails once an R01-equivalent was held, is unknown when ESI is not inferable, passes when ESI", () => {
    expect(run({ characteristics: { esi: false } }, { eligibility: { esi_only: true } })).toMatchObject({ E: 0, failed: [expect.stringContaining("ESI-only")] });
    expect(run({ characteristics: { esi: null } }, { eligibility: { esi_only: true } })).toEqual({ E: 1, failed: [], unknown: ["ESI status not on file"] });
    expect(run({ characteristics: { esi: true } }, { eligibility: { esi_only: true } })).toEqual({ E: 1, failed: [], unknown: [] });
  });

  it("new-investigator-only follows the same evidence", () => {
    expect(run({ characteristics: { esi: false } }, { eligibility: { new_investigator_only: true } }).E).toBe(0);
    expect(run({ characteristics: { esi: null } }, { eligibility: { new_investigator_only: true } }).unknown).toEqual(["new-investigator status not on file"]);
  });

  it("clinician required: a clinical degree or an md_ clinical role passes; PhD-only fails; nothing on file is unknown", () => {
    const rule: FixtureOpportunity = { eligibility: { clinician_required: true } };
    expect(run({ characteristics: { degrees: ["MD", "PhD"] } }, rule).E).toBe(1);
    expect(run({ characteristics: { degrees: ["M.D."] } }, rule).E).toBe(1);
    expect(run({ characteristics: { clinical_role: "md_clinician_investigator" } }, rule).E).toBe(1);
    expect(run({ characteristics: { degrees: ["PhD"] } }, rule)).toMatchObject({ E: 0, failed: ["MD/DO required; degrees on file: PhD"] });
    expect(run({ characteristics: { clinical_role: "phd_investigator" } }, rule).E).toBe(0);
    expect(run({}, rule)).toEqual({ E: 1, failed: [], unknown: ["clinical degree not on file"] });
  });

  it("degree required: evaluated only on a recognizable degree, never on open-ended wording", () => {
    expect(run({ characteristics: { degrees: ["Ph.D."] } }, { eligibility: { degree_required: "MD or PhD" } }).E).toBe(1);
    expect(run({ characteristics: { degrees: ["PhD"] } }, { eligibility: { degree_required: "MD" } })).toMatchObject({ E: 0, failed: ["MD required; degrees on file: PhD"] });
    expect(run({ characteristics: { degrees: ["PhD"] } }, { eligibility: { degree_required: "MD or equivalent doctoral degree" } }).unknown).toEqual([expect.stringContaining("degree rule not evaluated")]);
    expect(run({ characteristics: { degrees: ["PhD"] } }, { eligibility: { degree_required: "a health-professional doctorate" } }).unknown).toEqual([expect.stringContaining("degree rule not evaluated")]);
    expect(run({}, { eligibility: { degree_required: "MD" } }).unknown).toEqual(["degree not on file (MD required)"]);
  });

  it("independent appointment: a trainee fails, an unknown rank is a flag, faculty passes", () => {
    const rule: FixtureOpportunity = { eligibility: { independent_appointment_required: true } };
    expect(run({ characteristics: { career_stage: "trainee" } }, rule).E).toBe(0);
    expect(run({ characteristics: { career_stage: null } }, rule).unknown).toEqual(["rank not on file (independent appointment required)"]);
    expect(run({ characteristics: { career_stage: "early" } }, rule)).toEqual({ E: 1, failed: [], unknown: [] });
  });

  it("citizenship rules and verbatim investigator rules are unknowns, never fails", () => {
    const r = run({}, { eligibility: { citizenship_rule: "U.S. citizens only", investigator_rules: ["Must hold a K award", "Must be within 10 years of terminal degree"] } });
    expect(r.E).toBe(1);
    expect(r.unknown).toEqual(['citizenship rule not evaluated: "U.S. citizens only"', 'not evaluated: "Must hold a K award"', 'not evaluated: "Must be within 10 years of terminal degree"']);
  });

  it("a passed deadline fails; a deadline today or an unknown one does not", () => {
    expect(run({}, {}, -1)).toMatchObject({ E: 0, failed: ["deadline has passed"] });
    expect(run({}, {}, 0).E).toBe(1);
    expect(run({}, {}, null).E).toBe(1);
  });

  it("self-declared do-not-suggest excludes the notice's dominant required family", () => {
    const population: FixtureOpportunity = { paradigm: { required: { epidemiology: 0.9, population_health: 0.7 }, allowed: { health_services: 0.5 } } };
    expect(run({ do_not_suggest: ["population"] }, population)).toMatchObject({ E: 0, failed: ["self-declared do-not-suggest: population"] });
    expect(run({ do_not_suggest: ["health_systems"] }, population).E).toBe(1);
    const anyOf: FixtureOpportunity = { paradigm: { required: {}, required_any: { clinical_trials: 1, human_biospecimen: 0.8 } } };
    expect(run({ do_not_suggest: ["clinical"] }, anyOf).E).toBe(1);
    expect(run({ do_not_suggest: ["clinical", "translational"] }, anyOf).E).toBe(0);
  });

  it("noticeFamilies sums required weight per family and lists every required family in taxonomy order", () => {
    const f = noticeFamilies(opp({ paradigm: { required: { epidemiology: 0.5, health_services: 0.6, population_health: 0.2 }, required_any: { computational_data_science: 0.7 } } }));
    expect(f.dominant).toBe("population");
    expect(f.all).toEqual(["population", "health_systems", "cross_cutting"]);
    expect(noticeFamilies(opp({ paradigm: { required: {} } }))).toEqual({ dominant: null, all: [] });
  });

  it("degreeTokens normalizes punctuation and conjunctions", () => {
    expect(degreeTokens("M.D., Ph.D.")).toEqual(["md", "phd"]);
    expect(degreeTokens("MD or DO")).toEqual(["md", "do"]);
    expect(degreeTokens(null)).toEqual([]);
  });

  it("the degree vocabularies come from signal-mapping.json › eligibility through eligibilityVocabulary()", () => {
    const v = eligibilityVocabulary();
    const raw = signalMapping.eligibility;
    expect([...v.clinical_degrees]).toEqual(raw.clinical_degrees);
    expect([...v.known_degrees]).toEqual(raw.known_degrees);
    for (const d of raw.clinical_degrees) expect(v.known_degrees.has(d), d).toBe(true);
    expect(v.known_degrees.has("phd")).toBe(true);
    expect(v.clinical_degrees.has("phd")).toBe(false);
    for (const w of raw.open_ended_degree_words) expect(v.open_ended_degree_rule.test(`MD or ${w} degree`), w).toBe(true);
    expect(v.open_ended_degree_rule.test("MD or PhD")).toBe(false);
    expect(eligibilityVocabulary()).toBe(v);
    // every token is what degreeTokens() produces, so a listed degree can actually match
    for (const d of raw.known_degrees) expect(degreeTokens(d)).toEqual([d]);
    // a DVM satisfies the clinician rule only because the vocabulary says so
    expect(run({ characteristics: { degrees: ["DVM"] } }, { eligibility: { clinician_required: true } }).E).toBe(1);
  });

  it("parseEligibilityVocabulary fails loudly on a malformed block", () => {
    expect(() => parseEligibilityVocabulary(undefined)).toThrow(SignalMappingError);
    expect(() => parseEligibilityVocabulary({ clinical_degrees: ["md"], known_degrees: ["phd"], open_ended_degree_words: ["equivalent"] })).toThrow(/known_degrees.*must include every clinical degree/);
    expect(() => parseEligibilityVocabulary({ clinical_degrees: ["M.D."], known_degrees: ["md"], open_ended_degree_words: ["equivalent"] })).toThrow(/not a lower-case letters-only token/);
    expect(() => parseEligibilityVocabulary({ clinical_degrees: ["md"], known_degrees: ["md"], open_ended_degree_words: [] })).toThrow(/open_ended_degree_words.*non-empty/);
    const ok = parseEligibilityVocabulary({ clinical_degrees: ["md"], known_degrees: ["md", "phd"], open_ended_degree_words: ["equivalent"] });
    expect([...ok.known_degrees]).toEqual(["md", "phd"]);
  });
});
