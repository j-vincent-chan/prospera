import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseGuideSections } from "@/lib/ingestion/nih-guide/parse";
import { findNihInstitutes, noticeInstituteCode } from "./nih-institutes";
import { NIH_IC_SOURCES, nihIcSourceRank, participatingOrganizationsText, resolveNihIcTokens } from "./nih-ic-resolution";
import { buildRdSignalColumns } from "./rd-signals";

const FIXTURES = path.join(__dirname, "..", "ingestion", "nih-guide", "__fixtures__");
const guide = (file: string) => parseGuideSections(readFileSync(path.join(FIXTURES, file), "utf8"));

const section = (text: string) => [{ heading: "Components of Participating Organizations", text }];
const NIAID_CONTACT = "National Institute of Allergy and Infectious Diseases (NIAID)\nminnicozzim@niaid.nih.gov";
const statuses = (r: ReturnType<typeof resolveNihIcTokens>) => Object.fromEntries(r.attempts.map((a) => [a.source, a.status]));

describe("findNihInstitutes", () => {
  it("matches the Guide's 'Name (ABBR)' lines, including the spacing and casing variants the Guide actually uses", () => {
    expect(findNihInstitutes("National Center for Complementary and Integrative Health ( NCCIH)")).toEqual(["NCCIH"]);
    expect(findNihInstitutes("National Heart, Lung, and Blood Institute (NHLBI ), March 26, 2026 - Participation added")).toEqual(["NHLBI"]);
    expect(findNihInstitutes("NATIONAL INSTITUTE OF GENERAL MEDICAL SCIENCES (NIGMS)")).toEqual(["NIGMS"]);
    expect(findNihInstitutes("National Institute on Diabetes and Digestive and Kidney Diseases")).toEqual(["NIDDK"]);
    expect(findNihInstitutes("Eunice Kennedy Shriver National Institute of Child and Human Development (NICHD)")).toEqual(["NICHD"]);
  });

  it("reads the institute out of a contact block, mailbox domain included", () => {
    expect(findNihInstitutes(NIAID_CONTACT)).toEqual(["NIAID"]);
    expect(findNihInstitutes("Program Officer\nsomeone@nia.nih.gov")).toEqual(["NIA"]);
  });

  it("takes the Office of the Director in its parenthesised, spelled-out and office forms, never as a bare 'OD'", () => {
    expect(findNihInstitutes("Office of The Director, National Institutes of Health (OD)")).toEqual(["OD"]);
    expect(findNihInstitutes("Office of Strategic Coordination (Common Fund)")).toEqual(["OD"]);
    expect(findNihInstitutes("Applicants OD-eligible must … see OD guidance")).toEqual([]);
    // Its offices count only in a participant list; in prose they are co-funding language.
    expect(findNihInstitutes("Office of Research on Women's Health (ORWH)", { participants: true })).toEqual(["OD"]);
    expect(findNihInstitutes("Office of Data Science Strategy (ODSS)", { participants: true })).toEqual(["OD"]);
    expect(findNihInstitutes("ORWH encourages applications on women's health.")).toEqual([]);
  });

  it("names nothing for NIH itself, other HHS agencies or unknown programs", () => {
    expect(findNihInstitutes("NATIONAL INSTITUTES OF HEALTH (NIH)\nCENTERS FOR DISEASE CONTROL AND PREVENTION (CDC)\nINCLUDE Project")).toEqual([]);
    expect(findNihInstitutes("")).toEqual([]);
  });
});

describe("noticeInstituteCode", () => {
  it("reads the serial code from RFA and NOT numbers and nothing from PA/PAR", () => {
    expect(noticeInstituteCode("RFA-AI-27-004")).toBe("AI");
    expect(noticeInstituteCode("NOT-CA-26-009")).toBe("CA");
    expect(noticeInstituteCode("FOR-AR-26-008")).toBe("AR");
    expect(noticeInstituteCode("FOR-TEMP-28167")).toBeNull();
    expect(noticeInstituteCode("PAR-27-026")).toBeNull();
    expect(noticeInstituteCode("PA-25-303")).toBeNull();
    expect(noticeInstituteCode(null)).toBeNull();
  });
});

describe("participatingOrganizationsText", () => {
  it("drops the co-funding OD offices that follow the Guide's 'may co-fund' line", () => {
    const text = participatingOrganizationsText(
      section(
        "National Cancer Institute (NCI)\nNational Institute on Aging (NIA)\nAll applications to this funding opportunity announcement should fall within the mission of the Institutes/Centers. The following NIH Offices may co-fund applications assigned to those Institutes/Centers.\nOffice of Research on Women's Health (ORWH)\nOffice of The Director, National Institutes of Health (OD)"
      )
    );
    expect(text).toBe("National Cancer Institute (NCI)\nNational Institute on Aging (NIA)");
    expect(findNihInstitutes(text)).toEqual(["NCI", "NIA"]);
  });

  it("counts an OD office listed as a participant (RFA-OD-24-011 leads through ODSS)", () => {
    const r = resolveNihIcTokens({ opportunity_number: "RFA-OD-24-011", guide_sections: section("Office of Data Science Strategy (ODSS)\nNational Eye Institute (NEI)") });
    expect(r.tokens).toEqual(["NEI", "OD"]);
  });

  it("is null when the Guide text has no such section", () => {
    expect(participatingOrganizationsText([{ heading: "Funding Opportunity Purpose", text: "…" }])).toBeNull();
  });
});

describe("resolveNihIcTokens — the ranked walk", () => {
  it("ranks Guide > summary text > notice number > Simpler contact", () => {
    expect(NIH_IC_SOURCES).toEqual(["guide_participating_orgs", "summary_text", "notice_number", "agency_contact"]);
    expect(nihIcSourceRank("guide_participating_orgs")).toBeLessThan(nihIcSourceRank("summary_text"));
    expect(nihIcSourceRank("agency_contact")).toBeLessThan(nihIcSourceRank("unresolved"));
    expect(nihIcSourceRank(null)).toBe(nihIcSourceRank("unresolved"));
  });

  it("uses the Guide's participating organizations when they are there (RFA-AI-27-004's case)", () => {
    const r = resolveNihIcTokens({
      opportunity_number: "RFA-AI-27-004",
      title: "Atopic Dermatitis Research Network (ADRN) (U19 Clinical Trial Optional)",
      description: "The purpose of this notice of funding opportunity (NOFO) is to solicit applications for the ADRN program.",
      guide_sections: section("National Institute of Allergy and Infectious Diseases (NIAID)"),
      agency_contact_description: NIAID_CONTACT,
    });
    expect(r.source).toBe("guide_participating_orgs");
    expect(r.tokens).toEqual(["NIAID"]);
    expect(r.reason).toBe("From the NIH Guide's participating organizations.");
    expect(statuses(r)).toEqual({ guide_participating_orgs: "used", summary_text: "not_consulted", notice_number: "not_consulted", agency_contact: "not_consulted" });
  });

  it("never lets a lower option override a higher one, even when it would name more institutes", () => {
    const r = resolveNihIcTokens({
      opportunity_number: "RFA-AI-27-004",
      title: "A notice mentioning NCI and NHLBI at length",
      description: "Co-developed with the National Cancer Institute.",
      guide_sections: section("National Institute of Allergy and Infectious Diseases (NIAID)"),
      agency_contact_description: "National Heart, Lung, and Blood Institute (NHLBI)",
    });
    expect(r.tokens).toEqual(["NIAID"]);
    expect(r.source).toBe("guide_participating_orgs");
  });

  it("uses the summary when the Guide has not been read — it lists participants, not just the issuer", () => {
    const r = resolveNihIcTokens({
      opportunity_number: "RFA-NS-26-007",
      title: "BRAIN Initiative: …",
      description: "This NOFO is issued by NINDS, NIMH, NIA, NIDA and NICHD …",
      guide_sections: null,
      agency_contact_description: "National Institute of Neurological Disorders and Stroke (NINDS)",
    });
    expect(r.source).toBe("summary_text");
    expect(r.tokens).toEqual(["NIA", "NICHD", "NIDA", "NIMH", "NINDS"]);
    expect(r.reason).toBe("From institute names in the title and summary; the NIH Guide has not been read for this notice.");
  });

  it("falls to the notice number when neither the Guide nor the summary names an institute, and says so", () => {
    const r = resolveNihIcTokens({ opportunity_number: "RFA-AI-27-004", title: "ADRN", description: "A network of centers.", guide_sections: null, agency_contact_description: NIAID_CONTACT });
    expect(r.source).toBe("notice_number");
    expect(r.tokens).toEqual(["NIAID"]);
    expect(r.reason).toBe("From the notice number (RFA-AI = NIAID); the NIH Guide has not been read for this notice and the title and summary name no institute.");
    expect(statuses(r).guide_participating_orgs).toBe("unavailable");
    expect(statuses(r).summary_text).toBe("no_match");
  });

  it("treats a Guide section that names no institute as unsuitable, not as an answer", () => {
    const r = resolveNihIcTokens({
      opportunity_number: "RFA-RM-28-001",
      title: "NIH Director's Pioneer Award",
      description: "",
      guide_sections: section("All NIH Institutes and Centers participate in Common Fund initiatives."),
      agency_contact_description: null,
    });
    // "Common Fund" is the Office of the Director — that is a recognised participant.
    expect(r.source).toBe("guide_participating_orgs");
    expect(r.tokens).toEqual(["OD"]);

    const bare = resolveNihIcTokens({ ...{ opportunity_number: "RFA-RM-28-001", title: "", description: "" }, guide_sections: section("All NIH Institutes and Centers participate."), agency_contact_description: null });
    expect(statuses(bare).guide_participating_orgs).toBe("no_match");
    expect(bare.source).toBe("notice_number");
    expect(bare.tokens).toEqual(["OD"]);
    expect(bare.reason).toBe("From the notice number (RFA-RM = OD); the Guide's participating-organizations section names no institute we recognise and the notice has no title or summary text.");
  });

  it("skips the number for PA/PAR notices and for codes outside NIH", () => {
    const par = resolveNihIcTokens({ opportunity_number: "PAR-27-026", title: "A program", description: "", guide_sections: null, agency_contact_description: NIAID_CONTACT });
    expect(par.source).toBe("agency_contact");
    expect(par.tokens).toEqual(["NIAID"]);
    expect(par.reason).toBe("From the Simpler.Grants.gov program contact (NIAID); the NIH Guide has not been read for this notice, the title and summary name no institute and PAR numbers carry no institute code.");

    const ahrq = resolveNihIcTokens({ opportunity_number: "RFA-HS-26-001", title: "", description: "", guide_sections: null, agency_contact_description: "AHRQ Grants Office" });
    expect(statuses(ahrq).notice_number).toBe("no_match");
    expect(ahrq.source).toBe("unresolved");
  });

  it("takes an OD office in the contact block as the issuer (PAR-28-019 is ORIP's)", () => {
    const r = resolveNihIcTokens({ opportunity_number: "PAR-28-019", title: "Integrated Specific Pathogen Free Research Models", description: "This NOFO is issued during …", guide_sections: null, agency_contact_description: "Division of Comparative Medicine, Office of Research Infrastructure Programs (ORIP)\n301-435-0744" });
    expect(r.source).toBe("agency_contact");
    expect(r.tokens).toEqual(["OD"]);
  });

  it("uses the contact last, only when nothing above it answered", () => {
    const r = resolveNihIcTokens({
      opportunity_number: "PAR-27-100",
      title: "Cancer Moonshot Scholars",
      description: "Applications are invited …",
      guide_sections: [],
      agency_contact_description: "National Cancer Institute (NCI)\nx@nci.nih.gov",
    });
    expect(r.source).toBe("agency_contact");
    expect(r.tokens).toEqual(["NCI"]);
    expect(r.reason).toBe(
      "From the Simpler.Grants.gov program contact (NCI); the NIH Guide has not been read for this notice, the title and summary name no institute and PAR numbers carry no institute code."
    );
  });

  it("flags 'unresolved' with the full trail instead of forcing an answer", () => {
    const r = resolveNihIcTokens({ opportunity_number: "PAR-27-026", title: "Something", description: "About nothing in particular.", guide_sections: null, agency_contact_description: "" });
    expect(r.source).toBe("unresolved");
    expect(r.tokens).toEqual([]);
    expect(r.reason).toBe(
      "Not determined: the NIH Guide has not been read for this notice, the title and summary name no institute, PAR numbers carry no institute code and no program contact is listed on Simpler.Grants.gov."
    );
    expect(Object.values(statuses(r))).not.toContain("used");
  });

  it("carries a stored Guide answer through a run that cannot read the Guide (the Simpler sync)", () => {
    const r = resolveNihIcTokens({
      opportunity_number: "RFA-AI-27-004",
      title: "ADRN",
      description: "",
      agency_contact_description: NIAID_CONTACT,
      prior: { tokens: ["NIAID", "NIAMS"], source: "guide_participating_orgs" },
    });
    expect(r.source).toBe("guide_participating_orgs");
    expect(r.tokens).toEqual(["NIAID", "NIAMS"]);
    expect(statuses(r).guide_participating_orgs).toBe("carried");
    expect(r.reason).toBe("From the NIH Guide's participating organizations (stored answer kept; not re-read this run).");
  });

  it("does not carry a stored answer from a lower option over a fresh higher one, nor an empty one", () => {
    const fresh = resolveNihIcTokens({ opportunity_number: "RFA-AI-27-004", title: "ADRN", description: "", agency_contact_description: null, prior: { tokens: ["NCI"], source: "agency_contact" } });
    expect(fresh.source).toBe("notice_number");
    expect(fresh.tokens).toEqual(["NIAID"]);

    const empty = resolveNihIcTokens({ opportunity_number: "PAR-27-026", title: "", description: "", agency_contact_description: null, prior: { tokens: [], source: "guide_participating_orgs" } });
    expect(empty.source).toBe("unresolved");
    expect(statuses(empty).guide_participating_orgs).toBe("unavailable");
  });

  it("ignores a stored answer once the Guide is read again — a fresh read outranks memory", () => {
    const r = resolveNihIcTokens({
      opportunity_number: "RFA-AI-27-004",
      title: "",
      description: "",
      guide_sections: section("National Institute of Arthritis and Musculoskeletal and Skin Diseases (NIAMS)"),
      agency_contact_description: null,
      prior: { tokens: ["NIAID"], source: "guide_participating_orgs" },
    });
    expect(r.tokens).toEqual(["NIAMS"]);
    expect(statuses(r).guide_participating_orgs).toBe("used");
  });
});

describe("resolveNihIcTokens — real Guide pages", () => {
  it("lists every participating institute of a parent announcement", () => {
    const r = resolveNihIcTokens({ opportunity_number: "PA-25-303", title: "", description: "", guide_sections: guide("PA-25-303.html"), agency_contact_description: null });
    expect(r.source).toBe("guide_participating_orgs");
    expect(r.tokens).toEqual(["NCCIH", "NCI", "NEI", "NIA", "NIAAA", "NICHD", "NIDA", "NIDCD", "NIDCR", "NIDDK", "NIEHS", "NIMH", "NIMHD", "NINDS", "NINR"]);
  });

  it("finds the single institute of a targeted RFA and of a PAR", () => {
    expect(resolveNihIcTokens({ opportunity_number: "RFA-CA-27-020", guide_sections: guide("RFA-CA-27-020-Full-Announcement.html") }).tokens).toEqual(["NCI"]);
    expect(resolveNihIcTokens({ opportunity_number: "PAR-27-064", guide_sections: guide("PAR-27-064-Full-Announcement.html") }).tokens).toEqual(["NIAID"]);
  });

  it("falls through a plain-layout page that has no participating-organizations section", () => {
    const r = resolveNihIcTokens({ opportunity_number: "PAR-27-026", title: "", description: "", guide_sections: guide("PAR-27-026.html"), agency_contact_description: "National Institute on Aging (NIA)\nx@nia.nih.gov" });
    expect(statuses(r).guide_participating_orgs).toBe("unavailable");
    expect(r.source).toBe("agency_contact");
    expect(r.tokens).toEqual(["NIA"]);
  });
});

describe("buildRdSignalColumns", () => {
  it("writes the resolution into nih_ic_tokens / nih_ic_source / nih_ic_reason", () => {
    const cols = buildRdSignalColumns({
      title: "Atopic Dermatitis Research Network (ADRN) (U19 Clinical Trial Optional)",
      description: "…",
      opportunity_number: "RFA-AI-27-004",
      agency: "National Institutes of Health",
      agency_code: "HHS-NIH11",
      agency_contact_description: NIAID_CONTACT,
      prior: null,
    });
    expect(cols.nih_ic_tokens).toEqual(["NIAID"]);
    expect(cols.nih_ic_source).toBe("notice_number");
    expect(cols.nih_ic_reason).toBe("From the notice number (RFA-AI = NIAID); the NIH Guide was not read this run and the title and summary name no institute.");
    expect(cols.rd_announcement_class).toBe("targeted_rfa");
  });

  it("keeps a Guide-derived answer when the caller has no Guide text", () => {
    const cols = buildRdSignalColumns({
      title: "ADRN",
      description: "",
      opportunity_number: "RFA-AI-27-004",
      agency_contact_description: NIAID_CONTACT,
      prior: { tokens: ["NIAID", "NIAMS"], source: "guide_participating_orgs" },
    });
    expect(cols.nih_ic_tokens).toEqual(["NIAID", "NIAMS"]);
    expect(cols.nih_ic_source).toBe("guide_participating_orgs");
  });

  it("leaves a non-NIH notice unresolved rather than inventing an institute", () => {
    const cols = buildRdSignalColumns({ title: "Cancer research (NSF)", description: "Not an NIH program.", opportunity_number: "NSF 26-500", agency: "National Science Foundation", agency_code: "NSF", agency_contact_description: null });
    expect(cols.nih_ic_tokens).toEqual([]);
    expect(cols.nih_ic_source).toBe("unresolved");
  });
});
