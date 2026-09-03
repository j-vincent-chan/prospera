import { describe, expect, it } from "vitest";
import { guessProfilesUrlName, normalizeProfilesUrlName, parseProfilesRecord, profileMatchesPerson } from "./client";

const sample = {
  Name: "Katerina Akassoglou, PhD",
  FirstName: "Katerina",
  LastName: "Akassoglou",
  Email: null,
  Department: "Neurology",
  School: "School of Medicine",
  Title: "Professor",
  Titles: ["Professor", "UCSF Weill Institute for Neurosciences"],
  ORCID: "0000-0002-2632-1465",
  ProfilesURL: "https://profiles.ucsf.edu/katerina.akassoglou",
  PublicationCount: 114,
  Keywords: ["Fibrinogen", "Microglia"],
  Publications: [
    {
      Year: 2025,
      Publication: "Journal of neuroinflammation",
      PublicationMedlineTA: "J Neuroinflammation",
      Date: "2025-12-17",
      Claimed: true,
      Title: "Development of a humanized anti-fibrin monoclonal antibody.",
      PublicationSource: [{ PublicationSourceName: "PubMed", PublicationSourceURL: "http://www.ncbi.nlm.nih.gov/pubmed/41408289", PMID: "41408289" }],
    },
    { Year: 2019, Title: "No PMID here", PublicationSource: [] },
  ],
  ResearchActivitiesAndFunding: [{ SponsorAwardID: "R35NS143067", Sponsor: "NIH", EndDate: "2033-08-31", StartDate: "2025-09-01", Role: "Principal Investigator", Title: "Neurovascular Interactions" }],
};

describe("UCSF Profiles connector", () => {
  it("guesses first.last URL names", () => {
    expect(guessProfilesUrlName("Katerina", "Akassoglou")).toBe("katerina.akassoglou");
    expect(guessProfilesUrlName("Mei-Ling", "Chen")).toBe("mei-ling.chen");
    expect(guessProfilesUrlName("José", "Núñez Pérez")).toBe("jose.nunezperez");
    expect(normalizeProfilesUrlName("https://profiles.ucsf.edu/hannah.park")).toBe("hannah.park");
    expect(normalizeProfilesUrlName("Hannah Park")).toBe("hannah.park");
  });

  it("parses the record with PMIDs, ORCID, keywords and funding", () => {
    const p = parseProfilesRecord(sample, "katerina.akassoglou");
    expect(p.urlName).toBe("katerina.akassoglou");
    expect(p.orcid).toBe("0000-0002-2632-1465");
    expect(p.publicationCount).toBe(114);
    expect(p.publications[0]).toMatchObject({ pmid: "41408289", journal: "J Neuroinflammation", year: 2025, claimed: true });
    expect(p.publications[1]!.pmid).toBeNull();
    expect(p.funding[0]).toMatchObject({ sponsor_award_id: "R35NS143067", role: "Principal Investigator" });
  });

  it("only accepts a profile whose surname agrees", () => {
    const p = parseProfilesRecord(sample, "katerina.akassoglou");
    expect(profileMatchesPerson(p, "Akassoglou")).toBe(true);
    expect(profileMatchesPerson(p, "Chen")).toBe(false);
  });
});
