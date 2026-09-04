import { describe, expect, it } from "vitest";
import {
  authorEntryMatchesInvestigator,
  investigatorListedWithUcsfAffiliation,
  isUcsfAffiliation,
  parsePubmedArticleAuthors,
} from "@/lib/community/pubmed-author-match";

const HARVARD_MARK_ANDERSON = `
<PubmedArticle>
  <Author>
    <LastName>Anderson</LastName>
    <ForeName>Mark</ForeName>
    <Initials>M</Initials>
    <AffiliationInfo>
      <Affiliation>Department of Radiology, Massachusetts General Hospital, Harvard Medical School, Boston, MA, USA.</Affiliation>
    </AffiliationInfo>
  </Author>
</PubmedArticle>`;

const UCSF_MARK_S_ANDERSON = `
<PubmedArticle>
  <Author>
    <LastName>Anderson</LastName>
    <ForeName>Mark S</ForeName>
    <Initials>MS</Initials>
    <AffiliationInfo>
      <Affiliation>Department of Medicine, University of California, San Francisco, San Francisco, CA, USA.</Affiliation>
    </AffiliationInfo>
  </Author>
</PubmedArticle>`;

const GHANA_MICHAEL_DAVID_WILSON = `
<PubmedArticle>
  <Author>
    <LastName>Wilson</LastName>
    <ForeName>Michael David</ForeName>
    <Initials>MD</Initials>
    <AffiliationInfo>
      <Affiliation>Department of Parasitology, Noguchi Memorial Institute for Medical Research, University of Ghana, Legon, Accra, Ghana.</Affiliation>
    </AffiliationInfo>
  </Author>
</PubmedArticle>`;

describe("isUcsfAffiliation", () => {
  it("detects UCSF variants", () => {
    expect(isUcsfAffiliation("University of California, San Francisco")).toBe(true);
    expect(isUcsfAffiliation("Massachusetts General Hospital")).toBe(false);
  });
});

describe("investigatorListedWithUcsfAffiliation", () => {
  const markSAnderson = {
    firstName: "Mark",
    lastName: "Anderson",
    middleInitial: "S",
    fullName: "Mark S. Anderson",
  };

  it("rejects Harvard Mark Anderson without middle S", () => {
    expect(investigatorListedWithUcsfAffiliation(HARVARD_MARK_ANDERSON, markSAnderson)).toBe(false);
  });

  it("accepts UCSF Mark S Anderson", () => {
    expect(investigatorListedWithUcsfAffiliation(UCSF_MARK_S_ANDERSON, markSAnderson)).toBe(true);
  });

  it("rejects Michael David Wilson (Ghana) for UCSF Michael R Wilson", () => {
    const michaelRWilson = {
      firstName: "Michael",
      lastName: "Wilson",
      middleInitial: "R",
      fullName: "Michael R Wilson",
    };
    expect(investigatorListedWithUcsfAffiliation(GHANA_MICHAEL_DAVID_WILSON, michaelRWilson)).toBe(
      false
    );
  });

  it("rejects Michael P Wilson (UConn) for UCSF Michael R Wilson even with Michael R Gryk coauthor", () => {
    const nmrhubWilson = `
<PubmedArticle>
  <Author>
    <LastName>Wilson</LastName>
    <ForeName>Michael P</ForeName>
    <Initials>MP</Initials>
    <AffiliationInfo>
      <Affiliation>Richard D. Berlin Center for Cell Analysis and Modeling, UConn Health, Farmington, CT 06030, USA.</Affiliation>
    </AffiliationInfo>
  </Author>
  <Author>
    <LastName>Gryk</LastName>
    <ForeName>Michael R</ForeName>
    <Initials>MR</Initials>
    <AffiliationInfo>
      <Affiliation>Department of Molecular Biology &amp; Biophysics, UConn Health, Farmington, CT 06030, USA.</Affiliation>
    </AffiliationInfo>
  </Author>
</PubmedArticle>`;
    const michaelRWilson = {
      firstName: "Michael",
      lastName: "Wilson",
      middleInitial: "R",
      fullName: "Michael R Wilson",
    };
    expect(investigatorListedWithUcsfAffiliation(nmrhubWilson, michaelRWilson)).toBe(false);
  });

  it("rejects Michael D Wilson (Toronto) for UCSF Michael R Wilson", () => {
    const natureWilson = `
<PubmedArticle>
  <Author>
    <LastName>Wilson</LastName>
    <ForeName>Michael D</ForeName>
    <Initials>MD</Initials>
    <AffiliationInfo>
      <Affiliation>Program in Genetics &amp; Genome Biology, The Hospital for Sick Children, Toronto, Ontario, Canada.</Affiliation>
    </AffiliationInfo>
    <AffiliationInfo>
      <Affiliation>Department of Molecular Genetics, University of Toronto, Toronto, Ontario, Canada.</Affiliation>
    </AffiliationInfo>
  </Author>
</PubmedArticle>`;
    expect(
      investigatorListedWithUcsfAffiliation(natureWilson, {
        firstName: "Michael",
        lastName: "Wilson",
        middleInitial: "R",
        fullName: "Michael R Wilson",
      })
    ).toBe(false);
  });

  it("rejects UCSF co-author paper when only Harvard Mark is listed", () => {
    const xml = `${HARVARD_MARK_ANDERSON}
      <Author>
        <LastName>Doe</LastName>
        <ForeName>Jane</ForeName>
        <Initials>J</Initials>
        <AffiliationInfo>
          <Affiliation>University of California, San Francisco, CA, USA.</Affiliation>
        </AffiliationInfo>
      </Author>`;
    expect(investigatorListedWithUcsfAffiliation(xml, markSAnderson)).toBe(false);
  });

  it("rejects Ping He at UCSF for investigator Peng He", () => {
    const xml = `
<PubmedArticle>
  <Author>
    <LastName>He</LastName>
    <ForeName>Ping</ForeName>
    <Initials>P</Initials>
    <AffiliationInfo>
      <Affiliation>University of California, San Francisco, San Francisco, CA, USA.</Affiliation>
    </AffiliationInfo>
  </Author>
</PubmedArticle>`;
    expect(
      investigatorListedWithUcsfAffiliation(xml, {
        firstName: "Peng",
        lastName: "He",
        middleInitial: "P",
        fullName: "Peng He",
      })
    ).toBe(false);
  });

  it("accepts Peng He at UCSF Pathology", () => {
    const xml = `
<PubmedArticle>
  <Author>
    <LastName>He</LastName>
    <ForeName>Peng</ForeName>
    <Initials>P</Initials>
    <AffiliationInfo>
      <Affiliation>Department of Pathology, University of California, San Francisco, San Francisco, CA, USA.</Affiliation>
    </AffiliationInfo>
  </Author>
</PubmedArticle>`;
    expect(
      investigatorListedWithUcsfAffiliation(xml, {
        firstName: "Peng",
        lastName: "He",
        middleInitial: "P",
        fullName: "Peng He",
      })
    ).toBe(true);
  });

  it("rejects James J Lee at UCSF for James C Lee", () => {
    const xml = `
<PubmedArticle>
  <Author>
    <LastName>Lee</LastName>
    <ForeName>James J</ForeName>
    <Initials>JJ</Initials>
    <AffiliationInfo>
      <Affiliation>Division of Hematology and Oncology, University of California, San Francisco, San Francisco, CA, USA.</Affiliation>
    </AffiliationInfo>
  </Author>
</PubmedArticle>`;
    expect(
      investigatorListedWithUcsfAffiliation(xml, {
        firstName: "James",
        lastName: "Lee",
        middleInitial: "C",
        fullName: "James C Lee",
      })
    ).toBe(false);
  });

  it("rejects Jerry C Lee at UCSF for James C Lee", () => {
    const xml = `
<PubmedArticle>
  <Author>
    <LastName>Lee</LastName>
    <ForeName>Jerry C</ForeName>
    <Initials>JC</Initials>
    <AffiliationInfo>
      <Affiliation>University of California, San Francisco, San Francisco, CA, USA.</Affiliation>
    </AffiliationInfo>
  </Author>
</PubmedArticle>`;
    expect(
      investigatorListedWithUcsfAffiliation(xml, {
        firstName: "James",
        lastName: "Lee",
        middleInitial: "C",
        fullName: "James C Lee",
      })
    ).toBe(false);
  });

  it("rejects James C Lee paper for investigator James Lee without middle", () => {
    const xml = `
<PubmedArticle>
  <Author>
    <LastName>Lee</LastName>
    <ForeName>James C</ForeName>
    <Initials>JC</Initials>
    <AffiliationInfo>
      <Affiliation>Department of Radiation Oncology, University of California, San Francisco, San Francisco, CA, USA.</Affiliation>
    </AffiliationInfo>
  </Author>
</PubmedArticle>`;
    expect(
      investigatorListedWithUcsfAffiliation(xml, {
        firstName: "James",
        lastName: "Lee",
        fullName: "James Lee",
      })
    ).toBe(false);
  });

  it("rejects generic Michael Wilson at UCSF for Michael R Wilson with middle_initial R", () => {
    const xml = `
<PubmedArticle>
  <Author>
    <LastName>Wilson</LastName>
    <ForeName>Michael</ForeName>
    <Initials>M</Initials>
    <AffiliationInfo>
      <Affiliation>University of California, San Francisco, San Francisco, CA, USA.</Affiliation>
    </AffiliationInfo>
  </Author>
</PubmedArticle>`;
    expect(
      investigatorListedWithUcsfAffiliation(xml, {
        firstName: "Michael",
        lastName: "Wilson",
        middleInitial: "R",
        fullName: "Michael R Wilson",
      })
    ).toBe(false);
  });

  it("accepts Michael R Wilson when author lists middle R on the entry", () => {
    const xml = `
<PubmedArticle>
  <Author>
    <LastName>Wilson</LastName>
    <ForeName>Michael R</ForeName>
    <Initials>MR</Initials>
    <AffiliationInfo>
      <Affiliation>Weill Institute for Neurosciences, University of California, San Francisco, San Francisco, CA, USA.</Affiliation>
    </AffiliationInfo>
  </Author>
</PubmedArticle>`;
    expect(
      investigatorListedWithUcsfAffiliation(xml, {
        firstName: "Michael",
        lastName: "Wilson",
        middleInitial: "R",
        fullName: "Michael R Wilson",
      })
    ).toBe(true);
  });

  it("accepts James C Lee at UCSF Radiation Oncology", () => {
    const xml = `
<PubmedArticle>
  <Author>
    <LastName>Lee</LastName>
    <ForeName>James C</ForeName>
    <Initials>JC</Initials>
    <AffiliationInfo>
      <Affiliation>Department of Radiation Oncology, University of California, San Francisco, San Francisco, CA, USA.</Affiliation>
    </AffiliationInfo>
  </Author>
</PubmedArticle>`;
    expect(
      investigatorListedWithUcsfAffiliation(xml, {
        firstName: "James",
        lastName: "Lee",
        middleInitial: "C",
        fullName: "James C Lee",
      })
    ).toBe(true);
  });
});

describe("parsePubmedArticleAuthors", () => {
  it("extracts per-author affiliations", () => {
    const authors = parsePubmedArticleAuthors(HARVARD_MARK_ANDERSON);
    expect(authors).toHaveLength(1);
    expect(authors[0]?.affiliations[0]).toContain("Massachusetts General Hospital");
  });
});

describe("authorEntryMatchesInvestigator", () => {
  it("requires UCSF on the matched author", () => {
    const [author] = parsePubmedArticleAuthors(HARVARD_MARK_ANDERSON);
    expect(
      authorEntryMatchesInvestigator(author!, {
        firstName: "Mark",
        lastName: "Anderson",
        middleInitial: null,
      })
    ).toBe(false);
  });
});

describe("PR 0.1b · diacritics and initial-only records", () => {
  it("matches a last name regardless of diacritics", () => {
    const xml =
      '<PubmedArticle><MedlineCitation><PMID>1</PMID><Article><AuthorList><Author><LastName>Nicolás-Ávila</LastName><ForeName>José Ángel</ForeName><Initials>JA</Initials><AffiliationInfo><Affiliation>UCSF, San Francisco, CA</Affiliation></AffiliationInfo></Author></AuthorList></Article></MedlineCitation></PubmedArticle>';
    expect(
      investigatorListedWithUcsfAffiliation(xml, { firstName: "Jose Angel", lastName: "Nicolas Avila", middleInitial: null, fullName: "Jose Angel Nicolas Avila" })
    ).toBe(true);
  });

  it("accepts an abbreviated fore name and an initials-only record when the initials agree", () => {
    const abbreviated =
      '<Author><LastName>Ansel</LastName><ForeName>K Mark</ForeName><Initials>KM</Initials><AffiliationInfo><Affiliation>University of California, San Francisco</Affiliation></AffiliationInfo></Author>';
    const initialsOnly =
      '<Author><LastName>Ansel</LastName><Initials>KM</Initials><AffiliationInfo><Affiliation>UCSF</Affiliation></AffiliationInfo></Author>';
    const wrongInitials =
      '<Author><LastName>Ansel</LastName><Initials>JM</Initials><AffiliationInfo><Affiliation>UCSF</Affiliation></AffiliationInfo></Author>';
    const ansel = { firstName: "Karl", lastName: "Ansel", middleInitial: "M", fullName: "Karl M Ansel" };
    expect(investigatorListedWithUcsfAffiliation(abbreviated, ansel)).toBe(true);
    expect(investigatorListedWithUcsfAffiliation(initialsOnly, ansel)).toBe(true);
    expect(investigatorListedWithUcsfAffiliation(wrongInitials, ansel)).toBe(false);
  });

  it("still rejects initials-only records for ambiguous names that require a fore name", () => {
    const initialsOnly =
      '<Author><LastName>Lee</LastName><Initials>J</Initials><AffiliationInfo><Affiliation>UCSF</Affiliation></AffiliationInfo></Author>';
    expect(investigatorListedWithUcsfAffiliation(initialsOnly, { firstName: "James", lastName: "Lee", middleInitial: "C", fullName: "James C Lee" })).toBe(false);
  });
});

describe("PR 0.1b · two-token given names", () => {
  const ucsf = "University of California, San Francisco";
  const rec = (last: string, fore: string, initials: string) =>
    `<Author><LastName>${last}</LastName><ForeName>${fore}</ForeName><Initials>${initials}</Initials><AffiliationInfo><Affiliation>${ucsf}</Affiliation></AffiliationInfo></Author>`;

  it("verifies Nam Woo Cho against a 'Nam Woo' / NW record without treating W as a middle initial", () => {
    const cho = { firstName: "Nam Woo", lastName: "Cho", middleInitial: null, fullName: "Nam Woo Cho" };
    expect(investigatorListedWithUcsfAffiliation(rec("Cho", "Nam Woo", "NW"), cho)).toBe(true);
    expect(investigatorListedWithUcsfAffiliation(rec("Cho", "Nam", "N"), cho)).toBe(true);
    expect(investigatorListedWithUcsfAffiliation(rec("Cho", "Nam Woo K", "NWK"), cho)).toBe(false);
  });

  it("verifies Mary Helen Barcellos-Hoff against an MH record", () => {
    const mh = { firstName: "Mary Helen", lastName: "Barcellos-Hoff", middleInitial: null, fullName: "Mary Helen Barcellos-Hoff" };
    expect(investigatorListedWithUcsfAffiliation(rec("Barcellos-Hoff", "Mary Helen", "MH"), mh)).toBe(true);
    expect(investigatorListedWithUcsfAffiliation(`<Author><LastName>Barcellos-Hoff</LastName><Initials>MH</Initials><AffiliationInfo><Affiliation>${ucsf}</Affiliation></AffiliationInfo></Author>`, mh)).toBe(true);
  });

  it("still rejects a single-token first name when the record carries an unexpected middle initial", () => {
    const mark = { firstName: "Mark", lastName: "Anderson", middleInitial: null, fullName: "Mark Anderson" };
    expect(investigatorListedWithUcsfAffiliation(rec("Anderson", "Mark S", "MS"), mark)).toBe(false);
  });
});

describe("PR 0.1b · short given names", () => {
  const ucsf = "University of California, San Francisco";
  const rec = (fore: string, initials: string) =>
    `<Author><LastName>Weiss</LastName><ForeName>${fore}</ForeName><Initials>${initials}</Initials><AffiliationInfo><Affiliation>${ucsf}</Affiliation></AffiliationInfo></Author>`;
  const art = { firstName: "Art", lastName: "Weiss", middleInitial: null, fullName: "Art Weiss" };

  it("accepts the full form of a short roster name", () => {
    expect(investigatorListedWithUcsfAffiliation(rec("Arthur", "A"), art)).toBe(true);
    expect(investigatorListedWithUcsfAffiliation(rec("Art", "A"), art)).toBe(true);
  });

  it("does not stretch to a different name or to two-letter prefixes", () => {
    expect(investigatorListedWithUcsfAffiliation(rec("Arnold", "A"), art)).toBe(false);
    const al = { firstName: "Al", lastName: "Weiss", middleInitial: null, fullName: "Al Weiss" };
    expect(investigatorListedWithUcsfAffiliation(rec("Albert", "A"), al)).toBe(false);
  });
});
