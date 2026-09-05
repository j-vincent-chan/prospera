import { describe, expect, it } from "vitest";
import {
  grantCode,
  normalizeReporterText,
  parseActivityCode,
  parseContactPi,
  parseRcdcCategories,
  parseReporterRow,
  parseStudySection,
  pickProjectNum,
  rawActivityCode,
} from "@/lib/community/reporter-fields";

// Two fixture rows with the shape of real investigator_nih_grants.raw_json
// (projects API v2, 45 keys — only the ones the parser reads are kept), names
// and ids changed. A: a 1987 R01, one PI, no RCDC (pre-FY2008), a study
// section with the code in brackets, hard-wrapped abstract, no PHR. B: a 2023
// DP2 (a code grantCode cannot read) with two PIs, RCDC categories, a Special
// Emphasis Panel and a PHR.

const rowA: Record<string, unknown> = {
  project_num: "1R01AI024349-01",
  core_project_num: "R01AI024349",
  project_num_split: { ic_code: "AI", serial_num: "024349", suffix_code: "", support_year: "01", activity_code: "R01", appl_type_code: "1", full_support_year: "01" },
  activity_code: "R01",
  fiscal_year: 1987,
  project_title: "ANTIGENS OF INFECTED ERYTHROCYTES",
  spending_categories_desc: null,
  spending_categories: null,
  full_study_section: { name: "Tropical Medicine and Parasitology Study Section[TMP]", srg_code: "TMP", srg_flex: null, group_code: null, sra_flex_code: null, sra_designator_code: null },
  principal_investigators: [{ title: "", full_name: "JANE  DOE", last_name: "DOE", first_name: "JANE", profile_id: 1000001, middle_name: "", is_contact_pi: true }],
  contact_pi_name: "DOE, JANE ",
  abstract_text:
    "New antigens appear on the surface of infected\nerythrocytes (IEs).  The new antigens may mediate essential functions in\nthe parasite's life cycle.      \n   \nWe will map them.   ",
  phr_text: null,
};

const rowB: Record<string, unknown> = {
  project_num: "1DP2AI177915-01",
  core_project_num: "DP2AI177915",
  project_num_split: { ic_code: "AI", serial_num: "177915", suffix_code: "", support_year: "01", activity_code: "DP2", appl_type_code: "1", full_support_year: "01" },
  activity_code: "DP2",
  fiscal_year: 2023,
  project_title: "Tissue-resident memory in the lung",
  spending_categories_desc: "Cancer; Immunization; Immunotherapy; Vaccine  Related; Cancer; Clinical Research",
  spending_categories: [132, 331, 3999, 877, 3979],
  full_study_section: { name: "Special Emphasis Panel[ZRG1 MOSS-C (56)]", srg_code: "ZRG1", srg_flex: null, group_code: "56", sra_flex_code: "C", sra_designator_code: "MOSS" },
  principal_investigators: [
    { title: "", full_name: "RICHARD  ROE", last_name: "ROE", first_name: "RICHARD", profile_id: 2000002, middle_name: "", is_contact_pi: false },
    { title: "", full_name: "PAULA  POE", last_name: "POE", first_name: "PAULA", profile_id: 2000003, middle_name: "", is_contact_pi: true },
  ],
  contact_pi_name: "POE, PAULA ",
  abstract_text: "PROJECT SUMMARY\nWhile the advent of therapy has reduced morbidity,\nviral eradication is not achievable.\n\nWe propose three aims.",
  phr_text: "  This proposal will apply novel imaging to define the first hours\nafter arrival of metastatic cells. ",
};

const AT = "2026-09-05T12:00:00.000Z";

describe("grantCode (moved from suggest.ts, unchanged)", () => {
  it("reads letter(s) + two digits after the application-type digit", () => {
    expect(grantCode("1R01AI024349-01")).toBe("R01");
    expect(grantCode("5K23HL123456-03")).toBe("K23");
    expect(grantCode("R01AI024349")).toBe("R01");
  });
  it("misses letter-digit-letter codes — the shapes parseActivityCode exists for", () => {
    expect(grantCode("1DP2AI177915-01")).toBeNull();
    expect(grantCode("1UG3AI150000-01")).toBeNull();
    expect(grantCode("1RM1HG011000-01")).toBeNull();
    expect(grantCode("unknown")).toBeNull();
  });
});

describe("parseActivityCode", () => {
  it("reads every NIH activity-code shape in front of the IC code", () => {
    expect(parseActivityCode("1R01AI024349-01")).toBe("R01");
    expect(parseActivityCode("1DP2AI177915-01")).toBe("DP2");
    expect(parseActivityCode("1UG3AI150000-01")).toBe("UG3");
    expect(parseActivityCode("1RM1HG011000-01")).toBe("RM1");
    expect(parseActivityCode("1OT2HL156812-01")).toBe("OT2");
    expect(parseActivityCode("1ZIAAI000123-05")).toBe("ZIA");
    expect(parseActivityCode("1I01BX001234-01A1")).toBe("I01");
  });
  it("tolerates a missing type digit, spaces and lower case", () => {
    expect(parseActivityCode("R01AI024349")).toBe("R01");
    expect(parseActivityCode("1 U01 DK099999 01")).toBe("U01");
    expect(parseActivityCode("1r01ai024349-01")).toBe("R01");
  });
  it("falls back to grantCode for a number without IC / serial, else null", () => {
    expect(parseActivityCode("1R01AI")).toBe("R01");
    expect(parseActivityCode("unknown")).toBeNull();
    expect(parseActivityCode("")).toBeNull();
    expect(parseActivityCode(null)).toBeNull();
    expect(parseActivityCode(undefined)).toBeNull();
  });
});

describe("rawActivityCode / pickProjectNum", () => {
  it("prefers activity_code, then project_num_split.activity_code", () => {
    expect(rawActivityCode({ activity_code: "r01" })).toBe("R01");
    expect(rawActivityCode({ activity_code: null, project_num_split: { activity_code: "DP2" } })).toBe("DP2");
    expect(rawActivityCode({ project_num_split: {} })).toBeNull();
    expect(rawActivityCode({})).toBeNull();
  });
  it("picks project_num, then its alias, then the core number, else unknown", () => {
    expect(pickProjectNum({ project_num: " 1R01AI024349-01 " })).toBe("1R01AI024349-01");
    expect(pickProjectNum({ project_num_alias: "1R01AI024349-01A1" })).toBe("1R01AI024349-01A1");
    expect(pickProjectNum({ core_project_num: "R01AI024349" })).toBe("R01AI024349");
    expect(pickProjectNum({})).toBe("unknown");
  });
});

describe("parseRcdcCategories", () => {
  it("splits on ';', trims, collapses inner whitespace and deduplicates in order", () => {
    expect(parseRcdcCategories("Cancer; Immunization; Immunotherapy; Vaccine  Related; Cancer; Clinical Research")).toEqual([
      "Cancer",
      "Immunization",
      "Immunotherapy",
      "Vaccine Related",
      "Clinical Research",
    ]);
    expect(parseRcdcCategories("HIV/AIDS; Infectious Diseases")).toEqual(["HIV/AIDS", "Infectious Diseases"]);
  });
  it("is null — not [] — when RePORTER has no categories", () => {
    expect(parseRcdcCategories(null)).toBeNull();
    expect(parseRcdcCategories(undefined)).toBeNull();
    expect(parseRcdcCategories("")).toBeNull();
    expect(parseRcdcCategories(" ; ;")).toBeNull();
    expect(parseRcdcCategories(42)).toBeNull();
  });
  it("accepts an array of names too", () => {
    expect(parseRcdcCategories(["Cancer", " Lung ", "Cancer", 7])).toEqual(["Cancer", "Lung"]);
  });
});

describe("parseStudySection", () => {
  it("drops the bracketed code from the name and takes srg_code", () => {
    expect(parseStudySection(rowA.full_study_section)).toEqual({ name: "Tropical Medicine and Parasitology Study Section", code: "TMP" });
    expect(parseStudySection({ name: "Career Development Study Section (J)[NCI-J]", srg_code: "NCI" })).toEqual({ name: "Career Development Study Section (J)", code: "NCI" });
  });
  it("a Special Emphasis Panel keeps its srg_code; the designator stays in raw_json", () => {
    expect(parseStudySection(rowB.full_study_section)).toEqual({ name: "Special Emphasis Panel", code: "ZRG1" });
  });
  it("keeps a bare-code name (older awards) as it is", () => {
    expect(parseStudySection({ name: "GMBB", srg_code: "GMBB" })).toEqual({ name: "GMBB", code: "GMBB" });
    expect(parseStudySection({ name: "ZRG2-IMB(01)L", srg_code: "ZRG2" })).toEqual({ name: "ZRG2-IMB(01)L", code: "ZRG2" });
  });
  it("reads the code from the bracket when srg_code is missing, and only when it is a bare code", () => {
    expect(parseStudySection({ name: "Immunobiology Study Section[IMB]", srg_code: null })).toEqual({ name: "Immunobiology Study Section", code: "IMB" });
    expect(parseStudySection({ name: "Special Emphasis Panel[ZRG1 MOSS-C (56)]", srg_code: null })).toEqual({ name: "Special Emphasis Panel", code: null });
    expect(parseStudySection({ name: "[IMB]", srg_code: null })).toEqual({ name: "[IMB]", code: "IMB" });
  });
  it("is null / null without a panel", () => {
    expect(parseStudySection({ name: null, srg_code: null, srg_flex: null })).toEqual({ name: null, code: null });
    expect(parseStudySection(null)).toEqual({ name: null, code: null });
    expect(parseStudySection("HAI")).toEqual({ name: null, code: null });
  });
});

describe("parseContactPi", () => {
  const pis = rowB.principal_investigators;
  it("returns the flag of the PI entry carrying the investigator's profile id", () => {
    expect(parseContactPi(pis, 2000003)).toBe(true);
    expect(parseContactPi(pis, 2000002)).toBe(false);
    expect(parseContactPi(rowA.principal_investigators, "1000001")).toBe(true);
  });
  it("matches the id as digits — text column, prefixes, leading zeros", () => {
    expect(parseContactPi(pis, "2000003")).toBe(true);
    expect(parseContactPi(pis, "PI 2000002")).toBe(false);
    expect(parseContactPi(pis, "0002000003")).toBe(true);
    expect(parseContactPi([{ profile_id: "0002000003", is_contact_pi: "true" }], 2000003)).toBe(true);
  });
  it("is null when the id is unknown, absent from the list, or the flag is missing", () => {
    expect(parseContactPi(pis, null)).toBeNull();
    expect(parseContactPi(pis, "")).toBeNull();
    expect(parseContactPi(pis, 9999999)).toBeNull();
    expect(parseContactPi([{ profile_id: 2000003 }], 2000003)).toBeNull();
    expect(parseContactPi(null, 2000003)).toBeNull();
    expect(parseContactPi("PAULA POE", 2000003)).toBeNull();
  });
});

describe("normalizeReporterText", () => {
  it("unwraps hard line breaks and padding, keeps blank-line paragraphs", () => {
    expect(normalizeReporterText(rowA.abstract_text)).toBe(
      "New antigens appear on the surface of infected erythrocytes (IEs). The new antigens may mediate essential functions in the parasite's life cycle.\n\nWe will map them."
    );
    expect(normalizeReporterText(rowB.abstract_text)).toBe(
      "PROJECT SUMMARY While the advent of therapy has reduced morbidity, viral eradication is not achievable.\n\nWe propose three aims."
    );
    expect(normalizeReporterText("a\r\n\r\nb\r\nc")).toBe("a\n\nb c");
  });
  it("is null when empty or not text", () => {
    expect(normalizeReporterText(null)).toBeNull();
    expect(normalizeReporterText("   \n \n ")).toBeNull();
    expect(normalizeReporterText(12)).toBeNull();
  });
});

describe("parseReporterRow", () => {
  it("fixture A: old R01, one contact PI, no RCDC, bracketed study section, no PHR", () => {
    expect(parseReporterRow(rowA, 1000001, AT)).toEqual({
      activity_code: "R01",
      rcdc_categories: null,
      study_section: "Tropical Medicine and Parasitology Study Section",
      study_section_code: "TMP",
      is_contact_pi: true,
      abstract:
        "New antigens appear on the surface of infected erythrocytes (IEs). The new antigens may mediate essential functions in the parasite's life cycle.\n\nWe will map them.",
      phr_text: null,
      fields_parsed_at: AT,
    });
  });

  it("fixture B: DP2 (unreadable by grantCode), MPI non-contact, RCDC, SEP, PHR", () => {
    expect(parseReporterRow(rowB, "2000002", AT)).toEqual({
      activity_code: "DP2",
      rcdc_categories: ["Cancer", "Immunization", "Immunotherapy", "Vaccine Related", "Clinical Research"],
      study_section: "Special Emphasis Panel",
      study_section_code: "ZRG1",
      is_contact_pi: false,
      abstract: "PROJECT SUMMARY While the advent of therapy has reduced morbidity, viral eradication is not achievable.\n\nWe propose three aims.",
      phr_text: "This proposal will apply novel imaging to define the first hours after arrival of metastatic cells.",
      fields_parsed_at: AT,
    });
    expect(parseReporterRow(rowB, 2000003, AT).is_contact_pi).toBe(true);
    expect(parseReporterRow(rowB, null, AT).is_contact_pi).toBeNull();
  });

  it("falls back to RePORTER's own activity_code when the project number does not parse", () => {
    expect(parseReporterRow({ ...rowB, project_num: "unknown", core_project_num: null }, null, AT).activity_code).toBe("DP2");
    expect(parseReporterRow({ ...rowB, project_num: "unknown", core_project_num: null, activity_code: null }, null, AT).activity_code).toBe("DP2");
    expect(parseReporterRow({ project_num: "unknown" }, null, AT).activity_code).toBeNull();
  });

  it("a minimal record (the ingest test shape) and an empty one parse to nulls, never throw", () => {
    expect(parseReporterRow({ project_num: "1R01DK092469-01", fiscal_year: 2012, principal_investigators: [{ profile_id: 1955985, is_contact_pi: true }] }, 1955985, AT)).toEqual({
      activity_code: "R01",
      rcdc_categories: null,
      study_section: null,
      study_section_code: null,
      is_contact_pi: true,
      abstract: null,
      phr_text: null,
      fields_parsed_at: AT,
    });
    expect(parseReporterRow({}, null, AT)).toEqual({
      activity_code: null,
      rcdc_categories: null,
      study_section: null,
      study_section_code: null,
      is_contact_pi: null,
      abstract: null,
      phr_text: null,
      fields_parsed_at: AT,
    });
  });

  it("stamps fields_parsed_at with the current time by default", () => {
    const before = Date.now();
    const at = Date.parse(parseReporterRow(rowA, 1000001).fields_parsed_at);
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });
});
