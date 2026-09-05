import { describe, expect, it } from "vitest";
import { parsePubmedArticleAuthors } from "@/lib/community/pubmed-author-match";
import {
  authorPositionAt,
  captureFieldsFromXml,
  locateInvestigatorAuthor,
  normalizeOrcid,
  parsePubmedAbstract,
  parsePubmedAuthorPosition,
  parsePubmedMesh,
  parsePubmedPmid,
  parsePubmedPublicationTypes,
  parsePubmedRecord,
  type PubmedCaptureSubject,
} from "@/lib/community/pubmed-record";

// Fixture shapes follow real efetch output for PMIDs 39808693, 41735490 and 41197250.

type Author = { last: string; fore?: string; initials?: string; aff?: string[]; eq?: boolean; orcid?: string };
type Mesh = { ui: string; name: string; major?: boolean; qualifiers?: Array<{ name: string; major?: boolean }> };

const UCSF = "Department of Medicine, University of California, San Francisco, CA, USA.";
const UCSF_EMAIL = "Department of Radiation Oncology, University of California, San Francisco, USA. Electronic address: mhbh@ucsf.edu.";
const UNR = "Department of Electrical and Biomedical Engineering, University of Nevada, Reno, USA.";

function authorXml(a: Author): string {
  return (
    `<Author ValidYN="Y"${a.eq ? ' EqualContrib="Y"' : ""}><LastName>${a.last}</LastName>` +
    (a.fore ? `<ForeName>${a.fore}</ForeName>` : "") +
    (a.initials ? `<Initials>${a.initials}</Initials>` : "") +
    (a.orcid ? `<Identifier Source="ORCID">${a.orcid}</Identifier>` : "") +
    (a.aff ?? []).map((x) => `<AffiliationInfo><Affiliation>${x}</Affiliation></AffiliationInfo>`).join("") +
    `</Author>`
  );
}

function meshXml(headings: Mesh[]): string {
  if (!headings.length) return "";
  const items = headings
    .map(
      (h) =>
        `<MeshHeading><DescriptorName UI="${h.ui}" MajorTopicYN="${h.major ? "Y" : "N"}">${h.name}</DescriptorName>` +
        (h.qualifiers ?? [])
          .map((q) => `<QualifierName UI="Q000000" MajorTopicYN="${q.major ? "Y" : "N"}">${q.name}</QualifierName>`)
          .join("") +
        `</MeshHeading>`
    )
    .join("");
  return `<MeshHeadingList>${items}</MeshHeadingList>`;
}

function article(opts: {
  pmid?: string;
  authors?: Author[];
  mesh?: Mesh[];
  pubtypes?: Array<{ ui: string; name: string }>;
  abstract?: string;
}): string {
  const pubtypes = (opts.pubtypes ?? [{ ui: "D016428", name: "Journal Article" }])
    .map((p) => `<PublicationType UI="${p.ui}">${p.name}</PublicationType>`)
    .join("");
  return (
    `<PubmedArticle><MedlineCitation Status="MEDLINE"><PMID Version="1">${opts.pmid ?? "1"}</PMID><Article>` +
    (opts.abstract ?? "") +
    `<AuthorList CompleteYN="Y">${(opts.authors ?? []).map(authorXml).join("")}</AuthorList>` +
    `<PublicationTypeList>${pubtypes}</PublicationTypeList></Article>` +
    meshXml(opts.mesh ?? []) +
    `</MedlineCitation></PubmedArticle>`
  );
}

describe("parsePubmedMesh", () => {
  it("reads descriptor UI, name, major flag and qualifiers", () => {
    const xml = article({
      mesh: [
        { ui: "D006801", name: "Humans" },
        {
          ui: "D000077329",
          name: "Agammaglobulinaemia Tyrosine Kinase",
          major: true,
          qualifiers: [{ name: "metabolism" }, { name: "genetics" }],
        },
      ],
    });
    expect(parsePubmedMesh(xml)).toEqual([
      { ui: "D006801", name: "Humans", major: false, qualifiers: [] },
      { ui: "D000077329", name: "Agammaglobulinaemia Tyrosine Kinase", major: true, qualifiers: ["metabolism", "genetics"] },
    ]);
  });

  it("marks a heading major when only a qualifier is starred", () => {
    const xml = article({
      mesh: [{ ui: "D001943", name: "Breast Neoplasms", qualifiers: [{ name: "pathology", major: true }, { name: "classification" }] }],
    });
    expect(parsePubmedMesh(xml)[0]).toMatchObject({ major: true, qualifiers: ["pathology", "classification"] });
  });

  it("decodes entities and drops duplicate UIs", () => {
    const xml = article({
      mesh: [
        { ui: "D000970", name: "Antineoplastic Agents", qualifiers: [{ name: "antagonists &amp; inhibitors" }] },
        { ui: "D000970", name: "Antineoplastic Agents" },
      ],
    });
    const out = parsePubmedMesh(xml);
    expect(out).toHaveLength(1);
    expect(out[0]!.qualifiers).toEqual(["antagonists & inhibitors"]);
  });

  it("returns [] for an in-process record with no MeshHeadingList", () => {
    expect(parsePubmedMesh(article({}))).toEqual([]);
  });
});

describe("parsePubmedPublicationTypes", () => {
  it("lists publication types in order without duplicates", () => {
    const xml = article({
      pubtypes: [
        { ui: "D016428", name: "Journal Article" },
        { ui: "D016449", name: "Randomized Controlled Trial" },
        { ui: "D016428", name: "Journal Article" },
      ],
    });
    expect(parsePubmedPublicationTypes(xml)).toEqual(["Journal Article", "Randomized Controlled Trial"]);
  });

  it("returns [] without a PublicationTypeList", () => {
    expect(parsePubmedPublicationTypes("<PubmedArticle><PMID>1</PMID></PubmedArticle>")).toEqual([]);
  });
});

describe("parsePubmedAbstract", () => {
  it("returns an unlabeled abstract as-is with inline markup stripped", () => {
    const xml = article({ abstract: "<Abstract><AbstractText>Btk signals via <i>PLC</i>γ2 &amp; PKC.</AbstractText></Abstract>" });
    expect(parsePubmedAbstract(xml)).toBe("Btk signals via PLCγ2 & PKC.");
  });

  it("decodes hex and decimal character references and &apos; (AHI &#x2265; 15 was stored undecoded in the first live batch)", () => {
    const xml = article({ abstract: "<Abstract><AbstractText>AHI &#x2265; 15, p &#8804; 0.05, it&apos;s &amp;lt; not a tag, &#x1F9EC;</AbstractText></Abstract>" });
    expect(parsePubmedAbstract(xml)).toBe("AHI ≥ 15, p ≤ 0.05, it's &lt; not a tag, 🧬");
  });

  it("joins labeled sections as LABEL: text paragraphs and drops the copyright line", () => {
    const xml = article({
      abstract:
        `<Abstract>` +
        `<AbstractText Label="BACKGROUND AND OBJECTIVE" NlmCategory="OBJECTIVE">Radiation alters the mammary stroma.</AbstractText>` +
        `<AbstractText Label="METHOD" NlmCategory="METHODS">Mice were irradiated.</AbstractText>` +
        `<AbstractText Label="RESULTS" NlmCategory="RESULTS">Tumors changed subtype.</AbstractText>` +
        `<CopyrightInformation>Copyright © 2026 Elsevier.</CopyrightInformation>` +
        `</Abstract>`,
    });
    expect(parsePubmedAbstract(xml)).toBe(
      "BACKGROUND AND OBJECTIVE: Radiation alters the mammary stroma.\n\nMETHOD: Mice were irradiated.\n\nRESULTS: Tumors changed subtype."
    );
  });

  it("ignores OtherAbstract and returns null when there is no abstract", () => {
    const withOther = article({ abstract: "<OtherAbstract Type=\"plain-language-summary\"><AbstractText>Summary.</AbstractText></OtherAbstract>" });
    expect(parsePubmedAbstract(withOther)).toBeNull();
    expect(parsePubmedAbstract(article({}))).toBeNull();
  });
});

describe("parsePubmedRecord", () => {
  it("bundles pmid, mesh, publication types and abstract", () => {
    const xml = article({
      pmid: "41197250",
      mesh: [{ ui: "D051379", name: "Mice" }],
      pubtypes: [{ ui: "D016428", name: "Journal Article" }],
      abstract: "<Abstract><AbstractText>Text.</AbstractText></Abstract>",
    });
    expect(parsePubmedRecord(xml)).toEqual({
      pmid: "41197250",
      mesh: [{ ui: "D051379", name: "Mice", major: false, qualifiers: [] }],
      publicationTypes: ["Journal Article"],
      abstract: "Text.",
    });
    expect(parsePubmedPmid(xml)).toBe("41197250");
  });
});

// ---------------------------------------------------------------------------
// Author position
// ---------------------------------------------------------------------------

const subject = (name: PubmedCaptureSubject["name"], orcid: string | null = null): PubmedCaptureSubject => ({ name, orcid });
const barcellosHoff = subject({ firstName: "Mary Helen", lastName: "Barcellos-Hoff", middleInitial: null, fullName: "Mary Helen Barcellos-Hoff" });
const weiss = subject({ firstName: "Art", lastName: "Weiss", middleInitial: null, fullName: "Art Weiss" });
const ansel = subject({ firstName: "Karl", lastName: "Ansel", middleInitial: "M", fullName: "Karl M Ansel" });
const WEISS_ORCID = "0000-0002-2414-9024";

describe("normalizeOrcid", () => {
  it("accepts bare and URL forms, upper-cases the X check digit, rejects junk", () => {
    expect(normalizeOrcid("0000-0002-2414-9024")).toBe("0000-0002-2414-9024");
    expect(normalizeOrcid("https://orcid.org/0000-0002-2414-902x")).toBe("0000-0002-2414-902X");
    expect(normalizeOrcid("  ")).toBeNull();
    expect(normalizeOrcid(null)).toBeNull();
    expect(normalizeOrcid("0000-0002")).toBeNull();
  });
});

describe("parsePubmedAuthorPosition", () => {
  it("first author, by name", () => {
    const xml = article({ authors: [{ last: "Ansel", fore: "K Mark", initials: "KM", aff: [UCSF] }, { last: "Nakano", fore: "Yukiko", initials: "Y", aff: [UCSF] }] });
    expect(parsePubmedAuthorPosition(xml, ansel)).toEqual({ position: "first", method: "name" });
  });

  it("last author", () => {
    const xml = article({ authors: [{ last: "Shemirani", fore: "Rozana", initials: "R", aff: [UCSF] }, { last: "Ansel", fore: "K Mark", initials: "KM", aff: [UCSF] }] });
    expect(parsePubmedAuthorPosition(xml, ansel).position).toBe("last");
  });

  it("middle author without a corresponding marker", () => {
    const xml = article({
      authors: [
        { last: "Eisen", fore: "Timothy J", initials: "TJ", aff: [UCSF] },
        { last: "Weiss", fore: "Arthur", initials: "A", aff: [UCSF] },
        { last: "Kuriyan", fore: "John", initials: "J", aff: [UCSF] },
      ],
    });
    expect(parsePubmedAuthorPosition(xml, weiss).position).toBe("middle");
  });

  it("corresponding: a middle author whose affiliation carries the e-mail", () => {
    const xml = article({
      authors: [
        { last: "Mohammed", fore: "Sahar A", initials: "SA", aff: [UNR] },
        { last: "Barcellos-Hoff", fore: "Mary Helen", initials: "MH", aff: [UCSF_EMAIL] },
        { last: "Parvin", fore: "Bahram", initials: "B", aff: [UNR] },
      ],
    });
    expect(parsePubmedAuthorPosition(xml, barcellosHoff).position).toBe("corresponding");
  });

  it("co-first via EqualContrib counts as first", () => {
    const xml = article({
      authors: [
        { last: "Mohammed", fore: "Sahar A", initials: "SA", aff: [UNR], eq: true },
        { last: "Weiss", fore: "Arthur", initials: "A", aff: [UCSF], eq: true },
        { last: "Kuriyan", fore: "John", initials: "J", aff: [UCSF] },
      ],
    });
    expect(parsePubmedAuthorPosition(xml, weiss).position).toBe("first");
  });

  it("a single-author paper is first", () => {
    expect(parsePubmedAuthorPosition(article({ authors: [{ last: "Weiss", fore: "Arthur", initials: "A", aff: [UCSF] }] }), weiss).position).toBe("first");
  });

  it("ORCID on the entry wins over a namesake and is recorded as the method", () => {
    const xml = article({
      authors: [
        { last: "Weiss", fore: "Arthur", initials: "A", aff: [UCSF] }, // a different Art Weiss at UCSF, no ORCID
        { last: "Chen", fore: "Li", initials: "L" },
        { last: "Weiss", fore: "Arthur", initials: "A", aff: [UNR], orcid: WEISS_ORCID },
      ],
    });
    expect(parsePubmedAuthorPosition(xml, subject(weiss.name, WEISS_ORCID))).toEqual({ position: "last", method: "orcid" });
    expect(parsePubmedAuthorPosition(xml, subject(weiss.name, `https://orcid.org/${WEISS_ORCID}`)).method).toBe("orcid");
    // Without the ORCID the strict UCSF entry wins, by name.
    expect(parsePubmedAuthorPosition(xml, weiss)).toEqual({ position: "first", method: "name" });
  });

  it("an ORCID the record does not carry falls back to the name match", () => {
    const xml = article({ authors: [{ last: "Weiss", fore: "Arthur", initials: "A", aff: [UCSF] }, { last: "Kuriyan", fore: "John", initials: "J" }] });
    expect(parsePubmedAuthorPosition(xml, subject(weiss.name, WEISS_ORCID))).toEqual({ position: "first", method: "name" });
  });

  it("falls back to a name-only match for ORCID / RePORTER-verified records without a UCSF affiliation", () => {
    const xml = article({
      authors: [
        { last: "Mohammed", fore: "Sahar A", initials: "SA", aff: [UNR] },
        { last: "Barcellos-Hoff", fore: "Mary Helen", initials: "MH", aff: ["New York University School of Medicine, NY, USA."] },
      ],
    });
    expect(parsePubmedAuthorPosition(xml, barcellosHoff)).toEqual({ position: "last", method: "name" });
  });

  it("absent when the investigator is not on the author list, or the list is empty", () => {
    const xml = article({ authors: [{ last: "Parvin", fore: "Bahram", initials: "B", aff: [UNR] }] });
    expect(parsePubmedAuthorPosition(xml, weiss)).toEqual({ position: "unknown", method: "absent" });
    expect(parsePubmedAuthorPosition(article({}), weiss)).toEqual({ position: "unknown", method: "absent" });
  });

  it("absent when two authors share the last name and first initial and no middle initial separates them", () => {
    const xml = article({ authors: [{ last: "Lee", fore: "James", initials: "J" }, { last: "Lee", fore: "Jin", initials: "J" }] });
    expect(parsePubmedAuthorPosition(xml, subject({ firstName: "James", lastName: "Lee", middleInitial: null, fullName: "James Lee" }))).toEqual({
      position: "unknown",
      method: "absent",
    });
  });

  it("narrows same-name authors by middle initial", () => {
    const xml = article({ authors: [{ last: "Ansel", fore: "Kevin", initials: "KJ" }, { last: "Ansel", fore: "K Mark", initials: "KM" }, { last: "Nakano", fore: "Yukiko", initials: "Y" }] });
    expect(parsePubmedAuthorPosition(xml, ansel)).toEqual({ position: "middle", method: "name" });
  });
});

describe("locateInvestigatorAuthor / authorPositionAt", () => {
  it("prefers the strict name + UCSF match over a name-only namesake", () => {
    const authors = parsePubmedArticleAuthors(
      article({ authors: [{ last: "Weiss", fore: "Arthur", initials: "A", aff: [UNR] }, { last: "Weiss", fore: "Arthur", initials: "A", aff: [UCSF] }] })
    );
    expect(locateInvestigatorAuthor(authors, weiss)).toEqual({ index: 1, method: "name" });
    expect(authorPositionAt(authors, 1)).toBe("last");
    expect(authorPositionAt(authors, 5)).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// Capture fields
// ---------------------------------------------------------------------------

const AT = "2026-09-05T12:00:00.000Z";

describe("captureFieldsFromXml", () => {
  const indexed = article({
    authors: [{ last: "Weiss", fore: "Arthur", initials: "A", aff: [UCSF], orcid: WEISS_ORCID }],
    mesh: [{ ui: "D006801", name: "Humans" }],
    abstract: "<Abstract><AbstractText>Text.</AbstractText></Abstract>",
  });

  it("indexed record: everything stored, position method recorded", () => {
    expect(captureFieldsFromXml(indexed, subject(weiss.name, WEISS_ORCID), AT)).toEqual({
      mesh: [{ ui: "D006801", name: "Humans", major: false, qualifiers: [] }],
      publication_types: ["Journal Article"],
      abstract: "Text.",
      author_position: "first",
      author_position_method: "orcid",
      mesh_fetch_outcome: "indexed",
      mesh_fetched_at: AT,
    });
    expect(captureFieldsFromXml(indexed, weiss, AT).author_position_method).toBe("name");
  });

  it("in-process record: abstract and publication types kept, mesh empty, outcome no_mesh, still stamped", () => {
    const inProcess = indexed.replace(/<MeshHeadingList>[\s\S]*<\/MeshHeadingList>/, "");
    expect(captureFieldsFromXml(inProcess, weiss, AT)).toMatchObject({
      mesh: [],
      publication_types: ["Journal Article"],
      abstract: "Text.",
      author_position: "first",
      mesh_fetch_outcome: "no_mesh",
      mesh_fetched_at: AT,
    });
  });

  it("PMID not returned by efetch: empty fields, outcome not_returned, mesh_fetched_at stamped so a rerun skips it", () => {
    expect(captureFieldsFromXml(null, weiss, AT)).toEqual({
      mesh: [],
      publication_types: [],
      abstract: null,
      author_position: "unknown",
      author_position_method: "absent",
      mesh_fetch_outcome: "not_returned",
      mesh_fetched_at: AT,
    });
  });

  it("without a subject the author position is unknown / absent", () => {
    expect(captureFieldsFromXml(indexed, null, AT)).toMatchObject({ author_position: "unknown", author_position_method: "absent" });
  });
});
