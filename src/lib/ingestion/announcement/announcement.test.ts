/**
 * The announcement framework's pure parts (PR 5.2). The NIH path's own
 * behaviour is held by `nih-guide-sync.test.ts` and by the dry-run comparison
 * in the PR, which is what proves the move behind the interface changed nothing.
 */
import { describe, expect, it } from "vitest";
import { funderFamilyOf, firstUsableTarget, type AnnouncementTarget } from "@/lib/ingestion/announcement/registry";
import { EmptyPdfError, htmlToLines, isPdfBytes, linesToText, normalizeLines, NotImplementedError, pdfToLines } from "@/lib/ingestion/announcement/text";
import { hasObjectives, sectionByHeadings, singleSection, type HeadingPattern } from "@/lib/ingestion/announcement/sectioner";

describe("funderFamilyOf", () => {
  const cases: Array<[string, Parameters<typeof funderFamilyOf>[0], string]> = [
    ["agency code beats everything", { agency_code: "HHS-NIH11", opportunity_number: "26-507" }, "nih"],
    ["CDMRP by agency code", { agency_code: "DOD-AMRAA", opportunity_number: "HT942526PRPIIRA" }, "dod_cdmrp"],
    ["NSF by agency code", { agency_code: "NSF", opportunity_number: "24-529" }, "nsf"],
    ["DOE field offices", { agency_code: "DOE-NETL" }, "doe"],
    ["DOE Office of Science posts as PAMS-SC", { agency_code: "PAMS-SC" }, "doe"],
    ["other HHS", { agency_code: "HHS-CDC-GHC" }, "hhs_other"],
    ["NIH by number when the code is missing", { opportunity_number: "PAR-27-064" }, "nih"],
    ["a CDC RFA is NIH-like: the Guide sync already targets it", { agency_code: null, opportunity_number: "RFA-OH-25-003" }, "nih"],
    ["CDMRP by number shape", { opportunity_number: "HT942526SCIRPTRA" }, "dod_cdmrp"],
    ["the pre-2023 CDMRP shape", { opportunity_number: "W81XWH-22-BAA" }, "dod_cdmrp"],
    ["an NSF publication number", { opportunity_number: "26-507" }, "nsf"],
    ["an NSF program description", { opportunity_number: "PD-24-110Z" }, "nsf"],
    ["agency display string is the last resort", { agency: "U.S. National Science Foundation" }, "nsf"],
    ["anything else is other_federal, not excluded", { agency_code: "USDA-NIFA" }, "other_federal"],
    ["source_system wins outright", { source_system: "foundation", agency_code: "HHS-NIH11" }, "foundation"],
  ];
  for (const [name, row, expected] of cases) {
    it(name, () => expect(funderFamilyOf(row)).toBe(expected));
  }

  it("is a routing table, not a relevance filter: every federal row still gets a family", () => {
    for (const code of ["USDA-NIFA", "DOT-FTA", "NOAA", "DOI-BLM", "NEA"]) {
      expect(funderFamilyOf({ agency_code: code })).toBe("other_federal");
    }
  });
});

describe("text extraction preserves line structure", () => {
  it("turns block tags into line breaks and keeps the lines apart", () => {
    expect(htmlToLines("<p>II. PROGRAM DESCRIPTION</p><p>The program funds work on</p><ul><li>one</li><li>two</li></ul>")).toEqual([
      "II. PROGRAM DESCRIPTION",
      "The program funds work on",
      "one",
      "two",
    ]);
  });

  it("does not join words across an inline tag", () => {
    expect(htmlToLines("<p>clinical <b>trial</b> required</p>")).toEqual(["clinical trial required"]);
  });

  it("drops scripts and styles rather than reading them as text", () => {
    expect(htmlToLines("<p>kept</p><script>var x = 'dropped';</script><style>.a{color:red}</style>")).toEqual(["kept"]);
  });

  it("decodes entities", () => {
    expect(htmlToLines("<p>R&amp;D &mdash; 50&#37; &nbsp;effort</p>")).toEqual(["R&D — 50% effort"]);
  });

  // `decodeEntities` used to be thirteen names and everything else survived
  // verbatim; it now reads `formatting/html-entities.ts`. These four hold the
  // widening: same characters for what already worked, real characters for what
  // did not, and no page decoded twice.
  it("decodes every reference the old table knew to exactly the character it used to produce", () => {
    const unchanged: Array<[string, string]> = [
      ["&nbsp;", " "], ["&amp;", "&"], ["&lt;", "<"], ["&gt;", ">"], ["&quot;", '"'],
      ["&#039;", "'"], ["&apos;", "'"], ["&rsquo;", "'"], ["&lsquo;", "'"],
      ["&ldquo;", '"'], ["&rdquo;", '"'], ["&mdash;", "\u2014"], ["&ndash;", "\u2013"], ["&hellip;", "\u2026"],
    ];
    for (const [reference, character] of unchanged) {
      expect(htmlToLines(`<p>a${reference}b</p>`), reference).toEqual([`a${character}b`]);
    }
  });

  it("decodes the references that were surviving verbatim into the extractor's input", () => {
    // 60 of the 72 undecoded references measured across the open NSF
    // solicitations were this line's `&sect;`.
    expect(htmlToLines("<p>eligible under 25 U.S.C. &sect;&sect; 5130-5131</p>")).toEqual(["eligible under 25 U.S.C. §§ 5130-5131"]);
    expect(htmlToLines("<p>Cas9&reg; at 37&deg;C, RNAscope&trade;</p>")).toEqual(["Cas9® at 37°C, RNAscope™"]);
    // `&micro;` is U+00B5, the micro sign, not U+03BC Greek mu — the table keeps
    // them apart, and a solicitation writing concentrations means the former.
    expect(htmlToLines("<p>&alpha;-synuclein at 5 &micro;M, p &le; 0.05</p>")).toEqual(["α-synuclein at 5 \u00b5M, p ≤ 0.05"]);
  });

  it("drops a soft hyphen instead of leaving an invisible character inside a word", () => {
    // Decoded to U+00AD this reads as `interdisciplinary` and matches nothing.
    expect(htmlToLines("<p>inter&shy;disciplinary research</p>")).toEqual(["interdisciplinary research"]);
  });

  it("decodes in one pass, so text the funder escaped stays escaped", () => {
    expect(htmlToLines("<p>write it as &amp;sect; in the form</p>")).toEqual(["write it as &sect; in the form"]);
  });

  it("collapses whitespace inside a line but never across lines — the whole point", () => {
    expect(normalizeLines("IV.   ELIGIBILITY\n\n\n\nWho may submit")).toEqual(["IV. ELIGIBILITY", "", "Who may submit"]);
  });

  it("round-trips through linesToText without gluing headings to bodies", () => {
    expect(linesToText(htmlToLines("<h2>II. PROGRAM DESCRIPTION</h2><p>body</p>"))).toBe("II. PROGRAM DESCRIPTION\nbody");
  });

  // PR 5.3 answers D66 with `unpdf`, so this block replaces PR 5.2's assertion
  // that `pdfToLines` throws `NotImplementedError` with `/D66/`. The *contract*
  // that assertion protected is kept verbatim: a PDF that yields no text still
  // throws rather than returning `[]`, so a caller can never store a notice as
  // "read, nothing in it". The signature is now async — every PDF library is.
  it("pdfToLines throws rather than returning nothing when there is no text", async () => {
    await expect(pdfToLines(new Uint8Array())).rejects.toThrow(EmptyPdfError);
  });

  it("pdfToLines rejects on bytes that are not a PDF at all", async () => {
    await expect(pdfToLines(new TextEncoder().encode("not a pdf"))).rejects.toThrow();
  });

  it("isPdfBytes trusts the signature, not the server's content type", () => {
    expect(isPdfBytes(new TextEncoder().encode("%PDF-1.7\n"))).toBe(true);
    expect(isPdfBytes(new TextEncoder().encode("<!doctype html>"))).toBe(false);
    expect(isPdfBytes(new Uint8Array())).toBe(false);
  });

  it("NotImplementedError is still exported: PRs 5.4+ stub with it", () => {
    expect(new NotImplementedError("x")).toBeInstanceOf(Error);
  });
});

describe("sectionByHeadings", () => {
  const patterns: HeadingPattern[] = [
    { test: /^I\.\s+INTRODUCTION/i, roles: ["purpose"], section: "I" },
    { test: /^II\.\s+PROGRAM DESCRIPTION/i, roles: ["objectives"], section: "II" },
    { test: /^IV\.\s+ELIGIBILITY/i, roles: ["eligibility"], section: "IV" },
  ];
  const lines = ["front matter", "I. INTRODUCTION", "why we fund", "II. PROGRAM DESCRIPTION", "what we fund", "and more", "IV. ELIGIBILITY", "who may apply"];

  it("cuts at the headings and assigns the pattern's roles", () => {
    const sections = sectionByHeadings(lines, patterns);
    expect(sections.map((s) => [s.section, s.roles, s.text])).toEqual([
      ["I", ["purpose"], "why we fund"],
      ["II", ["objectives"], "what we fund\nand more"],
      ["IV", ["eligibility"], "who may apply"],
    ]);
  });

  it("does not repeat the heading in the text", () => {
    expect(sectionByHeadings(lines, patterns)[1]!.text).not.toContain("PROGRAM DESCRIPTION");
  });

  it("drops the preamble unless asked for it", () => {
    expect(sectionByHeadings(lines, patterns).some((s) => s.text.includes("front matter"))).toBe(false);
    const kept = sectionByHeadings(lines, patterns, { preamble: { section: "front", roles: ["other"] } });
    expect(kept[0]!.text).toBe("front matter");
  });

  it("ignores a prose line that happens to match but is too long to be a heading", () => {
    const prose = `II. PROGRAM DESCRIPTION ${"x".repeat(200)}`;
    expect(sectionByHeadings([prose], patterns)).toEqual([]);
  });

  it("drops empty sections — the extractor has nothing to read in them", () => {
    expect(sectionByHeadings(["II. PROGRAM DESCRIPTION"], patterns)).toEqual([]);
    expect(sectionByHeadings(["II. PROGRAM DESCRIPTION"], patterns, { keepEmpty: true })).toHaveLength(1);
  });

  it("singleSection is the honest fallback: one role, no invented headings", () => {
    const s = singleSection(["all of it"], "synopsis");
    expect(s).toEqual([{ part: 2, section: "full_text", heading: "Announcement", text: "all of it", roles: ["synopsis"] }]);
    expect(hasObjectives(s)).toBe(false);
  });

  it("hasObjectives is the test a resolved target has to pass", () => {
    expect(hasObjectives(sectionByHeadings(lines, patterns))).toBe(true);
  });
});

describe("firstUsableTarget", () => {
  const targets: AnnouncementTarget[] = [
    { url: "a", source: "grants_gov_attachment" },
    { url: "b", source: "nsf_solicitation" },
    { url: "c", source: "landing_page" },
  ];

  it("returns the first accepted target and stops reading", () => {
    const read: string[] = [];
    return firstUsableTarget(
      targets,
      async (t) => {
        read.push(t.url);
        return t.url;
      },
      (doc) => doc === "b",
    ).then((hit) => {
      expect(hit?.target.url).toBe("b");
      expect(read).toEqual(["a", "b"]);
    });
  });

  it("falls back to the first readable target when none is accepted", async () => {
    const hit = await firstUsableTarget(targets, async (t) => t.url, () => false);
    expect(hit?.target.url).toBe("a");
  });

  it("returns null when nothing reads", async () => {
    expect(await firstUsableTarget(targets, async () => null, () => true)).toBeNull();
  });
});
