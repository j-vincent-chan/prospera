import { describe, expect, it } from "vitest";
import type { ClinicalTrialsStudyRecord } from "@/lib/community/clinicaltrials-api-client";
import {
  designCaptureFields,
  designCoverage,
  formatDesignCoverage,
  formatDesignDryRunRow,
  normalizeCtgovEnum,
  parseDesign,
  parseInvestigatorRole,
  personNameMatches,
  phasesAreInformative,
} from "@/lib/community/clinicaltrials-design";

// Fixture shapes follow real API v2 records: NCT03293030 (interventional, PI official),
// NCT04404075 (observational), NCT02929745 (phases ["NA"]) and NCT00313729 (STUDY_CHAIR
// official + responsible-party PI). Modules the parser does not read are left out.

const UCSF = "University of California, San Francisco";

/** Interventional phase 2, the investigator is the principal investigator (overallOfficials). */
const phase2WithPi: ClinicalTrialsStudyRecord = {
  protocolSection: {
    identificationModule: { nctId: "NCT03293030", briefTitle: "Dupilumab in Adults With Prurigo Nodularis" },
    sponsorCollaboratorsModule: { responsibleParty: { type: "SPONSOR" }, leadSponsor: { name: UCSF } },
    designModule: {
      studyType: "INTERVENTIONAL",
      phases: ["PHASE2"],
      designInfo: { allocation: "NA", interventionModel: "SINGLE_GROUP", primaryPurpose: "TREATMENT" },
      enrollmentInfo: { count: 17, type: "ACTUAL" },
    },
    armsInterventionsModule: { interventions: [{ type: "DRUG", name: "Dupilumab" }] },
    contactsLocationsModule: {
      overallOfficials: [{ name: "Wilson Liao, MD", affiliation: UCSF, role: "PRINCIPAL_INVESTIGATOR" }],
    },
  },
};

/** Observational cohort: no phases key, observational model and time perspective, responsible-party PI. */
const observationalCohort: ClinicalTrialsStudyRecord = {
  protocolSection: {
    identificationModule: { nctId: "NCT04404075", briefTitle: "Psoriasis Longitudinal Cohort" },
    sponsorCollaboratorsModule: {
      responsibleParty: {
        type: "PRINCIPAL_INVESTIGATOR",
        investigatorFullName: "Wilson Liao",
        investigatorTitle: "Professor of Dermatology",
        investigatorAffiliation: UCSF,
      },
      leadSponsor: { name: UCSF },
    },
    designModule: {
      studyType: "OBSERVATIONAL",
      designInfo: { observationalModel: "COHORT", timePerspective: "PROSPECTIVE" },
      enrollmentInfo: { count: 1200, type: "ESTIMATED" },
    },
    armsInterventionsModule: { interventions: [] },
    contactsLocationsModule: {
      overallOfficials: [{ name: "Someone Else, PhD", affiliation: UCSF, role: "STUDY_DIRECTOR" }],
    },
  },
};

/** Interventional phase 3 run by other people: the investigator is on the study only by the name search. */
const interventionalWithoutRole: ClinicalTrialsStudyRecord = {
  protocolSection: {
    identificationModule: { nctId: "NCT04645355", briefTitle: "A Phase 3 Study" },
    sponsorCollaboratorsModule: { responsibleParty: { type: "SPONSOR" }, leadSponsor: { name: "Regeneron Pharmaceuticals" } },
    designModule: {
      studyType: "INTERVENTIONAL",
      phases: ["PHASE3"],
      designInfo: { allocation: "RANDOMIZED", interventionModel: "PARALLEL", primaryPurpose: "TREATMENT" },
      enrollmentInfo: { count: 640, type: "ACTUAL" },
    },
    armsInterventionsModule: { interventions: [{ type: "BIOLOGICAL", name: "Dupilumab" }, { type: "OTHER", name: "Placebo" }] },
    contactsLocationsModule: {
      overallOfficials: [{ name: "Another Investigator, MD", affiliation: "Elsewhere", role: "PRINCIPAL_INVESTIGATOR" }],
    },
  },
};

/** Interventional with phases ["NA"] — a randomized parallel behavioral study; the design lives in allocation / interventionModel. */
const naRandomizedParallel: ClinicalTrialsStudyRecord = {
  protocolSection: {
    identificationModule: { nctId: "NCT07390487", briefTitle: "Digital Support for Atopic Dermatitis" },
    sponsorCollaboratorsModule: { responsibleParty: { type: "SPONSOR" }, leadSponsor: { name: UCSF } },
    designModule: {
      studyType: "INTERVENTIONAL",
      phases: ["NA"],
      designInfo: { allocation: "RANDOMIZED", interventionModel: "PARALLEL", primaryPurpose: "SUPPORTIVE_CARE" },
      enrollmentInfo: { count: 120, type: "ESTIMATED" },
    },
    armsInterventionsModule: {
      interventions: [
        { type: "BEHAVIORAL", name: "Coaching app" },
        { type: "OTHER", name: "Usual care" },
        { type: "BEHAVIORAL", name: "Reminders" },
      ],
    },
    contactsLocationsModule: {
      overallOfficials: [{ name: "Wilson Liao, MD", affiliation: UCSF, role: "PRINCIPAL_INVESTIGATOR" }],
    },
  },
};

function withPeople(
  base: ClinicalTrialsStudyRecord,
  people: {
    officials?: Array<{ name: string; role?: string | null }>;
    party?: { type: string; investigatorFullName?: string };
  }
): ClinicalTrialsStudyRecord {
  const section = base.protocolSection ?? {};
  return {
    ...base,
    protocolSection: {
      ...section,
      sponsorCollaboratorsModule: {
        ...section.sponsorCollaboratorsModule,
        responsibleParty: people.party ?? { type: "SPONSOR" },
      },
      contactsLocationsModule: { overallOfficials: people.officials ?? [] },
    },
  };
}

describe("parseDesign", () => {
  it("interventional phase 2 with the investigator as principal investigator", () => {
    expect(parseDesign(phase2WithPi, "Wilson Liao")).toEqual({
      studyType: "INTERVENTIONAL",
      phases: ["PHASE2"],
      primaryPurpose: "TREATMENT",
      allocation: "NA",
      interventionModel: "SINGLE_GROUP",
      observationalModel: null,
      timePerspective: null,
      enrollment: 17,
      interventionTypes: ["DRUG"],
      investigatorRole: "PRINCIPAL_INVESTIGATOR",
    });
  });

  it("observational cohort: no phases, models and time perspective, responsible-party PI", () => {
    const design = parseDesign(observationalCohort, "Wilson Liao");
    expect(design).toEqual({
      studyType: "OBSERVATIONAL",
      phases: [],
      primaryPurpose: null,
      allocation: null,
      interventionModel: null,
      observationalModel: "COHORT",
      timePerspective: "PROSPECTIVE",
      enrollment: 1200,
      interventionTypes: [],
      investigatorRole: "RESPONSIBLE_PARTY_PI",
    });
    expect(phasesAreInformative(design.phases)).toBe(false);
  });

  it("interventional study run by other people: LISTED; with nobody named at all: UNKNOWN", () => {
    const design = parseDesign(interventionalWithoutRole, "Wilson Liao");
    expect(design.studyType).toBe("INTERVENTIONAL");
    expect(design.phases).toEqual(["PHASE3"]);
    expect(design.allocation).toBe("RANDOMIZED");
    expect(design.interventionTypes).toEqual(["BIOLOGICAL", "OTHER"]);
    expect(design.investigatorRole).toBe("LISTED");

    const nobody = withPeople(interventionalWithoutRole, {});
    expect(parseDesign(nobody, "Wilson Liao").investigatorRole).toBe("UNKNOWN");
  });

  it("phases [NA] is a real value and the design comes from allocation / interventionModel", () => {
    const design = parseDesign(naRandomizedParallel, "Wilson Liao");
    expect(design.studyType).toBe("INTERVENTIONAL");
    expect(design.phases).toEqual(["NA"]);
    expect(phasesAreInformative(design.phases)).toBe(false);
    expect(phasesAreInformative(["PHASE1", "PHASE2"])).toBe(true);
    expect(design.allocation).toBe("RANDOMIZED");
    expect(design.interventionModel).toBe("PARALLEL");
    expect(design.primaryPurpose).toBe("SUPPORTIVE_CARE");
    expect(design.enrollment).toBe(120);
    expect(design.interventionTypes).toEqual(["BEHAVIORAL", "OTHER"]);
    expect(design.investigatorRole).toBe("PRINCIPAL_INVESTIGATOR");
  });

  it("folds enum spelling, drops blanks and rejects a non-integer enrollment", () => {
    const study: ClinicalTrialsStudyRecord = {
      protocolSection: {
        designModule: {
          studyType: " interventional ",
          phases: ["n/a", "", "N/A"],
          designInfo: { allocation: "Non-Randomized", interventionModel: null, primaryPurpose: "  " },
          enrollmentInfo: { count: 12.5 },
        },
        armsInterventionsModule: { interventions: [{ type: "drug" }, { type: null }, { type: "Drug" }] },
      },
    };
    const design = parseDesign(study, "Wilson Liao");
    expect(design.studyType).toBe("INTERVENTIONAL");
    expect(design.phases).toEqual(["NA"]);
    expect(design.allocation).toBe("NON_RANDOMIZED");
    expect(design.interventionModel).toBeNull();
    expect(design.primaryPurpose).toBeNull();
    expect(design.enrollment).toBeNull();
    expect(design.interventionTypes).toEqual(["DRUG"]);
    expect(normalizeCtgovEnum(42)).toBeNull();
  });

  it("a record without a protocolSection yields nulls, empty lists and UNKNOWN", () => {
    expect(parseDesign({}, "Wilson Liao")).toEqual({
      studyType: null,
      phases: [],
      primaryPurpose: null,
      allocation: null,
      interventionModel: null,
      observationalModel: null,
      timePerspective: null,
      enrollment: null,
      interventionTypes: [],
      investigatorRole: "UNKNOWN",
    });
  });
});

describe("parseInvestigatorRole", () => {
  it("takes the earliest role in precedence order when the record names the person more than once", () => {
    const piAndDirector = withPeople(phase2WithPi, {
      officials: [
        { name: "Wilson Liao, MD", role: "STUDY_DIRECTOR" },
        { name: "Wilson Liao, MD", role: "PRINCIPAL_INVESTIGATOR" },
      ],
    });
    expect(parseInvestigatorRole(piAndDirector, "Wilson Liao")).toBe("PRINCIPAL_INVESTIGATOR");

    const chairAndParty = withPeople(phase2WithPi, {
      officials: [{ name: "Wilson Liao, MD", role: "STUDY_CHAIR" }],
      party: { type: "SPONSOR_INVESTIGATOR", investigatorFullName: "Wilson Liao" },
    });
    expect(parseInvestigatorRole(chairAndParty, "Wilson Liao")).toBe("STUDY_CHAIR");
  });

  it("recovers the responsible-party PI when the official listing carries a middle initial (NCT00313729)", () => {
    const study = withPeople(phase2WithPi, {
      officials: [{ name: "Susan M. Chang, MD", role: "STUDY_CHAIR" }],
      party: { type: "PRINCIPAL_INVESTIGATOR", investigatorFullName: "Susan Chang" },
    });
    expect(parseInvestigatorRole(study, "Susan Chang")).toBe("RESPONSIBLE_PARTY_PI");
  });

  it("ignores a SPONSOR responsible party and treats a matched official with no recognised role as LISTED", () => {
    const sponsorNamesNobody = withPeople(phase2WithPi, {
      officials: [{ name: "Another Investigator, MD", role: "PRINCIPAL_INVESTIGATOR" }],
      party: { type: "SPONSOR", investigatorFullName: "Wilson Liao" },
    });
    expect(parseInvestigatorRole(sponsorNamesNobody, "Wilson Liao")).toBe("LISTED");

    const roleMissing = withPeople(phase2WithPi, { officials: [{ name: "Wilson Liao, MD", role: null }] });
    expect(parseInvestigatorRole(roleMissing, "Wilson Liao")).toBe("LISTED");

    const partyOnlyOther = withPeople(phase2WithPi, {
      party: { type: "PRINCIPAL_INVESTIGATOR", investigatorFullName: "Someone Else" },
    });
    expect(parseInvestigatorRole(partyOnlyOther, "Wilson Liao")).toBe("LISTED");
  });

  it("is UNKNOWN with no name to look for or nothing to match against", () => {
    expect(parseInvestigatorRole(phase2WithPi, "  ")).toBe("UNKNOWN");
    expect(parseInvestigatorRole({ protocolSection: null }, "Wilson Liao")).toBe("UNKNOWN");
    const partyTypeOnly = withPeople(phase2WithPi, { party: { type: "PRINCIPAL_INVESTIGATOR" } });
    expect(parseInvestigatorRole(partyTypeOnly, "Wilson Liao")).toBe("UNKNOWN");
  });
});

describe("personNameMatches", () => {
  it("matches the ingest's way: equal after folding, or one name contains the other", () => {
    expect(personNameMatches("Wilson Liao, MD", "Wilson Liao")).toBe(true);
    expect(personNameMatches("wilson   liao", "Wilson Liao")).toBe(true);
    expect(personNameMatches("Liao", "Wilson Liao")).toBe(true);
    expect(personNameMatches("Susan M. Chang, MD", "Susan Chang")).toBe(false);
    expect(personNameMatches("", "Wilson Liao")).toBe(false);
    expect(personNameMatches("Wilson Liao", "")).toBe(false);
  });
});

describe("designCaptureFields", () => {
  it("maps the parsed design onto the investigator_clinical_trials columns", () => {
    const fields = designCaptureFields(parseDesign(naRandomizedParallel, "Wilson Liao"), "2026-09-05T00:00:00.000Z");
    expect(fields).toEqual({
      study_type: "INTERVENTIONAL",
      phases: ["NA"],
      primary_purpose: "SUPPORTIVE_CARE",
      allocation: "RANDOMIZED",
      intervention_model: "PARALLEL",
      observational_model: null,
      time_perspective: null,
      enrollment: 120,
      intervention_types: ["BEHAVIORAL", "OTHER"],
      investigator_role: "PRINCIPAL_INVESTIGATOR",
      design_parsed_at: "2026-09-05T00:00:00.000Z",
    });
  });
});

describe("designCoverage", () => {
  const items = [phase2WithPi, observationalCohort, interventionalWithoutRole, naRandomizedParallel, {}].map((study) => ({
    study,
    design: parseDesign(study, "Wilson Liao"),
  }));

  it("counts rows with a protocolSection, study_type among them, and roles", () => {
    expect(designCoverage(items)).toEqual({
      rows: 5,
      withProtocolSection: 4,
      withStudyType: 4,
      roles: {
        PRINCIPAL_INVESTIGATOR: 2,
        STUDY_CHAIR: 0,
        STUDY_DIRECTOR: 0,
        RESPONSIBLE_PARTY_PI: 1,
        LISTED: 1,
        UNKNOWN: 1,
      },
    });
  });

  it("formats the summary and one dry-run row", () => {
    expect(formatDesignCoverage(designCoverage(items))).toBe(
      "5 rows; 4 with a protocolSection (80%); study_type filled on 4 of 4 with a protocolSection (100%); " +
        "roles — PRINCIPAL_INVESTIGATOR 2, RESPONSIBLE_PARTY_PI 1, LISTED 1, UNKNOWN 1"
    );
    expect(formatDesignCoverage(designCoverage([]))).toBe(
      "0 rows; 0 with a protocolSection (n/a); study_type filled on 0 of 0 with a protocolSection (n/a); roles — none"
    );
    const fields = designCaptureFields(parseDesign(observationalCohort, "Wilson Liao"), "2026-09-05T00:00:00.000Z");
    expect(formatDesignDryRunRow("NCT04404075", "Wilson Liao", observationalCohort, fields)).toBe(
      "NCT04404075  Wilson Liao  protocolSection: yes\n" +
        "  study_type OBSERVATIONAL · phases [] · primary_purpose — · allocation — · intervention_model — · " +
        "observational_model COHORT · time_perspective PROSPECTIVE · enrollment 1200 · intervention_types [] · investigator_role RESPONSIBLE_PARTY_PI"
    );
  });
});
