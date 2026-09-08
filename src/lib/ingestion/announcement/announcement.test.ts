/**
 * The announcement framework's pure parts (PR 5.2). The NIH path's own
 * behaviour is held by `nih-guide-sync.test.ts` and by the dry-run comparison
 * in the PR, which is what proves the move behind the interface changed nothing.
 */
import { describe, expect, it } from "vitest";
import { funderFamilyOf, firstUsableTarget, type AnnouncementTarget } from "@/lib/ingestion/announcement/registry";
import { htmlToLines, linesToText, normalizeLines, NotImplementedError, pdfToLines } from "@/lib/ingestion/announcement/text";
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

  it("collapses whitespace inside a line but never across lines — the whole point", () => {
    expect(normalizeLines("IV.   ELIGIBILITY\n\n\n\nWho may submit")).toEqual(["IV. ELIGIBILITY", "", "Who may submit"]);
  });

  it("round-trips through linesToText without gluing headings to bodies", () => {
    expect(linesToText(htmlToLines("<h2>II. PROGRAM DESCRIPTION</h2><p>body</p>"))).toBe("II. PROGRAM DESCRIPTION\nbody");
  });

  it("pdfToLines throws rather than returning nothing, because D66 is open", () => {
    expect(() => pdfToLines(new Uint8Array())).toThrow(NotImplementedError);
    expect(() => pdfToLines(new Uint8Array())).toThrow(/D66/);
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
