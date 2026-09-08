/**
 * PR 5.3: the Grants.gov attachment adapter, the three heading tables, and the
 * "never a partial write" rule.
 *
 * The four fixtures are the text `pdfToLines` produced from real attachments,
 * saved verbatim so the sectioner is exercised on the whole document rather
 * than on a hand-cut skeleton — the hazards this PR exists to survive (a
 * contents page, a per-step mini-contents, a per-page nav ribbon, headings that
 * repeat three times) only appear at full length.
 *
 *   HRSA-27-099            HRSA NOFO, HHS's modernised template
 *   CDC-RFA-JG-26-0043     CDC NOFO, same template, different agency wording
 *   HT942526SCIRPTRA       CDMRP Program Announcement, numbered thirteen blocks
 *   USDA-NIFA-WAMS-011117  the classic `PART I. …` federal skeleton
 *   USDA-APHIS-…-2027      the same skeleton with letter enumerators (`A.7 …`)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ANNOUNCEMENT_HEADING_TABLES,
  CDMRP_PA_HEADINGS,
  FEDERAL_NOFO_HEADINGS,
  SIMPLIFIED_NOFO_HEADINGS,
  hasObjectives,
  isTableOfContentsLine,
  sectionByHeadings,
  sectionWithBestTable,
} from "@/lib/ingestion/announcement/sectioner";
import { textToLines } from "@/lib/ingestion/announcement/text";
import {
  MAX_ATTACHMENT_BYTES,
  acceptableType,
  acquireGrantsGovAttachment,
  appliesToGrantsGovAttachment,
  candidateRank,
  legacyOpportunityIdOf,
  rankCandidates,
  storedCandidates,
  type AttachmentCandidate,
  type GrantsGovDeps,
  type GrantsGovExtra,
  type GrantsGovRow,
} from "@/lib/ingestion/announcement/adapters/grants-gov-attachment";
import { AsyncRateLimiter } from "@/lib/utils/async-rate-limiter";

const FIXTURES = path.join(__dirname, "__fixtures__");
const fixture = (name: string) => textToLines(readFileSync(path.join(FIXTURES, name), "utf8"));

const OPTS = { ignoreHeading: isTableOfContentsLine, dedupe: "longest" as const };

// ---------------------------------------------------------------------------
// The heading tables, on real documents
// ---------------------------------------------------------------------------

describe("heading tables recover objectives from real announcements", () => {
  const cases: Array<[string, string, string, string]> = [
    ["HRSA NOFO", "HRSA-27-099.nofo.txt", "simplified_nofo", "Fiscal Year (FY) 2027 Expanding Nutrition Services"],
    ["CDC NOFO", "CDC-RFA-JG-26-0043.nofo.txt", "simplified_nofo", "Nigeria faces infectious disease outbreaks"],
    ["CDMRP PA", "HT942526SCIRPTRA.pa.txt", "cdmrp_pa", "Congress initiated the SCIRP in 2009"],
    ["classic federal NOFO", "USDA-NIFA-WAMS-011117.nofo.txt", "federal_nofo", ""],
    ["letter-enumerated NOFO", "USDA-APHIS-10031-PPQ-PPDMDPP-2027.nofo.txt", "federal_nofo", ""],
  ];

  for (const [name, file, table, snippet] of cases) {
    it(`${name}: picks the ${table} table and recovers an objectives block`, () => {
      const doc = sectionWithBestTable(fixture(file), ANNOUNCEMENT_HEADING_TABLES, OPTS);
      expect(doc).not.toBeNull();
      expect(doc!.table).toBe(table);
      expect(hasObjectives(doc!.sections)).toBe(true);
      if (snippet) {
        const objectives = doc!.sections.filter((s) => s.roles?.includes("objectives")).map((s) => s.text).join("\n");
        expect(objectives).toContain(snippet);
      }
    });

    it(`${name}: recovers eligibility and award_info too, so the profile is not thin`, () => {
      const doc = sectionWithBestTable(fixture(file), ANNOUNCEMENT_HEADING_TABLES, OPTS)!;
      expect(doc.roles).toContain("eligibility");
      expect(doc.roles).toContain("award_info");
    });

    it(`${name}: no section id appears twice — the contents page and the nav ribbon are gone`, () => {
      const doc = sectionWithBestTable(fixture(file), ANNOUNCEMENT_HEADING_TABLES, OPTS)!;
      const ids = doc.sections.map((s) => s.section);
      expect(ids).toEqual([...new Set(ids)]);
    });
  }

  it("the CDMRP objectives block is the body, not the two-line contents blurb", () => {
    const doc = sectionWithBestTable(fixture("HT942526SCIRPTRA.pa.txt"), ANNOUNCEMENT_HEADING_TABLES, OPTS)!;
    const objectives = doc.sections.find((s) => s.roles?.includes("objectives"))!;
    expect(objectives.text.length).toBeGreaterThan(5_000);
    expect(objectives.text).toContain("Mission of the SCIRP");
    expect(objectives.text).not.toContain("Describes the program mission and intent");
  });

  it("HHS's template carries two objectives blocks: Program description and Agency priorities", () => {
    const doc = sectionWithBestTable(fixture("CDC-RFA-JG-26-0043.nofo.txt"), ANNOUNCEMENT_HEADING_TABLES, OPTS)!;
    const ids = doc.sections.filter((s) => s.roles?.includes("objectives")).map((s) => s.section).sort();
    expect(ids).toEqual(["agency_priorities", "program_description"]);
  });

  it("the classic table finds all seven NIFA parts, labelled by role and not by numeral", () => {
    const sections = sectionByHeadings(fixture("USDA-NIFA-WAMS-011117.nofo.txt"), FEDERAL_NOFO_HEADINGS, OPTS);
    expect(sections.map((s) => s.section)).toEqual([
      "nofo.description",
      "nofo.award",
      "nofo.eligibility",
      "nofo.application",
      "nofo.review",
      "nofo.administration",
      "nofo.other",
    ]);
    expect(sections.find((s) => s.section === "nofo.description")!.roles).toEqual(["objectives"]);
    // isNihSectionId() matches bare roman numerals; a non-NIH id must not, or
    // sectionLabel() renders a USDA notice in the NIH form.
    expect(sections.every((s) => !/^[IVX]+(\.\d+)?$/.test(s.section))).toBe(true);
  });

  it("a foreign table wins on raw text and still loses, because the score counts blocks", () => {
    const lines = fixture("HT942526SCIRPTRA.pa.txt");
    const simplified = sectionByHeadings(lines, SIMPLIFIED_NOFO_HEADINGS, OPTS);
    const cdmrp = sectionByHeadings(lines, CDMRP_PA_HEADINGS, OPTS);
    // The HHS table matches this CDMRP PA's contents page and swallows the rest
    // of the document: more characters, five blocks, a 905-character objectives.
    expect(simplified.reduce((n, s) => n + s.text.length, 0)).toBeGreaterThan(cdmrp.reduce((n, s) => n + s.text.length, 0));
    expect(cdmrp.length).toBeGreaterThan(simplified.length);
    expect(sectionWithBestTable(lines, ANNOUNCEMENT_HEADING_TABLES, OPTS)!.table).toBe("cdmrp_pa");
  });

  it("APHIS numbers its blocks A.1 … E.1, and the enumerator has to allow that", () => {
    const doc = sectionWithBestTable(fixture("USDA-APHIS-10031-PPQ-PPDMDPP-2027.nofo.txt"), ANNOUNCEMENT_HEADING_TABLES, OPTS)!;
    const objectives = doc.sections.filter((s) => s.roles?.includes("objectives")).map((s) => s.text).join("\n");
    expect(objectives.length).toBeGreaterThan(200);
    expect(doc.sections.map((s) => s.section)).toContain("nofo.description");
  });

  it("returns null when no table matches anything", () => {
    expect(sectionWithBestTable(["just some prose", "and more of it"], ANNOUNCEMENT_HEADING_TABLES, OPTS)).toBeNull();
  });
});

describe("the contents-page and dedupe guards", () => {
  it("isTableOfContentsLine catches leader dots and trailing page numbers, and nothing else", () => {
    expect(isTableOfContentsLine("PART I. FUNDING OPPORTUNITY DESCRIPTION ........ 7")).toBe(true);
    expect(isTableOfContentsLine("Before you begin 3")).toBe(true);
    expect(isTableOfContentsLine("Program description")).toBe(false);
    expect(isTableOfContentsLine("3. Program Description")).toBe(false);
  });

  it("dedupe keeps the longest block for a repeated heading", () => {
    const patterns = [{ test: /^Program description$/i, roles: ["objectives" as const], section: "pd" }];
    const lines = ["Program description", "short", "Program description", "much longer body text here"];
    expect(sectionByHeadings(lines, patterns, { dedupe: "longest" }).map((s) => s.text)).toEqual(["much longer body text here"]);
    expect(sectionByHeadings(lines, patterns).map((s) => s.text)).toEqual(["short", "much longer body text here"]);
  });

  it("a nav ribbon cannot open a section: every pattern is anchored at the end of the line", () => {
    const ribbon = "Basic Information | Eligibility | Program Description | Application Contents and Format | Submission Requirements";
    expect(sectionByHeadings([ribbon, "body"], CDMRP_PA_HEADINGS, OPTS)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Candidate filtering and ranking
// ---------------------------------------------------------------------------

const candidate = (over: Partial<AttachmentCandidate>): AttachmentCandidate => ({
  url: `https://www.grants.gov/x/${over.fileName ?? "f"}`,
  source: "grants_gov_attachment",
  fileName: "file.pdf",
  mimeType: "application/pdf",
  bytes: 1000,
  folderType: null,
  route: "legacy",
  ...over,
});

describe("acceptableType", () => {
  it("takes PDF and HTML", () => {
    expect(acceptableType({ fileName: "a.pdf", mimeType: "application/pdf" })).toBe(true);
    expect(acceptableType({ fileName: "a.html", mimeType: "text/html;charset=UTF-8" })).toBe(true);
  });

  it("takes an octet-stream PDF — NEH, IMLS and DOE serve every NOFO that way", () => {
    expect(acceptableType({ fileName: "Collections_Stewardship_2026_NOFO.pdf", mimeType: "application/octet-stream" })).toBe(true);
    expect(acceptableType({ fileName: "FundOpp_DE-FOA-0003671.pdf", mimeType: "application/octet-stream" })).toBe(true);
  });

  it("rejects an octet-stream that is not named like a document", () => {
    expect(acceptableType({ fileName: "bundle.zip", mimeType: "application/octet-stream" })).toBe(false);
  });

  it("rejects archives, spreadsheets and Word documents whatever they are named", () => {
    expect(acceptableType({ fileName: "NOFO.zip", mimeType: "application/x-zip-compressed" })).toBe(false);
    expect(acceptableType({ fileName: "NOFO.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })).toBe(false);
    expect(acceptableType({ fileName: "budget.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })).toBe(false);
  });
});

describe("candidate ranking", () => {
  it("the Full Announcement folder beats the largest file — the HRSA-27-099 case", () => {
    const ranked = rankCandidates([
      candidate({ fileName: "EID Checklist Form.pdf", bytes: 2_752_418 }),
      candidate({ fileName: "Other Requirements for Sites Form.pdf", bytes: 876_925 }),
      candidate({ fileName: "FOA Content HRSA-27-099 Final v2.pdf", bytes: 691_737, folderType: "Full Announcement" }),
    ]);
    expect(ranked[0]!.fileName).toBe("FOA Content HRSA-27-099 Final v2.pdf");
  });

  it("`Revised Full Announcement` counts as the announcement folder", () => {
    expect(candidateRank(candidate({ folderType: "Revised Full Announcement" }))).toBe(0);
  });

  it("falls back to the plan's name rule when no folder is known — the Simpler route", () => {
    const ranked = rankCandidates([
      candidate({ fileName: "Budget_Template.pdf", bytes: 900_000, folderType: null }),
      candidate({ fileName: "FY26-STEM-NOFO-P.pdf", bytes: 432_023, folderType: null }),
    ]);
    expect(ranked.map((c) => c.fileName)).toEqual(["FY26-STEM-NOFO-P.pdf", "Budget_Template.pdf"]);
  });

  it("then the largest, then the name, so the order is total and a dry run matches a write", () => {
    const ranked = rankCandidates([
      candidate({ fileName: "b.pdf", bytes: 10 }),
      candidate({ fileName: "a.pdf", bytes: 10 }),
      candidate({ fileName: "c.pdf", bytes: 99 }),
    ]);
    expect(ranked.map((c) => c.fileName)).toEqual(["c.pdf", "a.pdf", "b.pdf"]);
  });

  it("drops anything over the size cap and de-duplicates by URL", () => {
    expect(rankCandidates([candidate({ bytes: MAX_ATTACHMENT_BYTES + 1 })])).toEqual([]);
    expect(rankCandidates([candidate({ fileName: "a.pdf" }), candidate({ fileName: "a.pdf" })])).toHaveLength(1);
  });

  it("keeps a file whose size the record does not state", () => {
    expect(rankCandidates([candidate({ bytes: null })])).toHaveLength(1);
  });
});

describe("row plumbing", () => {
  const row = (raw: Record<string, unknown> | null, over: Partial<GrantsGovRow> = {}): GrantsGovRow => ({
    id: "id-1",
    opportunity_number: "CDC-RFA-JG-26-0043",
    agency_code: "HHS-CDC-GHC",
    source_opportunity_id: "uuid-1",
    forecasted: false,
    raw_payload_json: raw,
    ...over,
  });

  it("reads legacy_opportunity_id from the top level, and from summary as a fallback", () => {
    expect(legacyOpportunityIdOf(row({ legacy_opportunity_id: 360332 }))).toBe(360332);
    expect(legacyOpportunityIdOf(row({ legacy_opportunity_id: "360332" }))).toBe(360332);
    expect(legacyOpportunityIdOf(row({ summary: { legacy_opportunity_id: 7 } }))).toBe(7);
    expect(legacyOpportunityIdOf(row(null))).toBeNull();
  });

  it("reads stored Simpler attachments and ignores malformed ones", () => {
    const stored = storedCandidates(
      row({
        attachments: [
          { file_name: "a.pdf", download_path: "https://files.simpler.grants.gov/a.pdf", mime_type: "application/pdf", file_size_bytes: 10 },
          { file_name: "no-url.pdf" },
          "nonsense",
        ],
      }),
    );
    expect(stored.map((c) => c.fileName)).toEqual(["a.pdf"]);
    expect(stored[0]!.route).toBe("stored");
  });

  it("never applies to an NIH notice — the Guide sync owns those", () => {
    expect(appliesToGrantsGovAttachment(row({ legacy_opportunity_id: 1 }, { agency_code: "HHS-NIH11", opportunity_number: "PAR-27-064" }))).toBe(false);
  });

  it("does not apply to a forecast, which has no attachment to read", () => {
    expect(appliesToGrantsGovAttachment(row({ legacy_opportunity_id: 1 }, { forecasted: true }))).toBe(false);
  });

  it("applies to any other federal row that carries a way to resolve a file", () => {
    expect(appliesToGrantsGovAttachment(row({ legacy_opportunity_id: 1 }, { agency_code: "USDA-NIFA" }))).toBe(true);
    expect(appliesToGrantsGovAttachment(row(null, { source_opportunity_id: null }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// acquire(): routing, and the no-partial-write rule
// ---------------------------------------------------------------------------

function deps(over: Partial<GrantsGovDeps> = {}): GrantsGovDeps {
  const limiter = new AsyncRateLimiter(0);
  return {
    limiterFor: () => limiter,
    simplerLimiter: limiter,
    simpler: null,
    fetchLegacyDetails: async () => null,
    fetchDocument: async (url) => ({ status: "not_found", url }),
    ...over,
  };
}

const HTML_DOC = (body: string) => ({
  status: "ok" as const,
  url: "u",
  bytes: new TextEncoder().encode(body),
  contentType: "text/html",
});

const ROW: GrantsGovRow = {
  id: "id-1",
  opportunity_number: "X-1",
  agency_code: "USDA-NIFA",
  source_opportunity_id: "uuid-1",
  forecasted: false,
  raw_payload_json: { legacy_opportunity_id: 1 },
};

const NOFO_HTML = "<p>Program description</p><p>We fund nutrition services research.</p><p>Eligibility</p><p>IHEs may apply.</p>";

describe("acquireGrantsGovAttachment", () => {
  it("uses the legacy record before Simpler, and does not call Simpler at all when it works", async () => {
    let simplerCalled = 0;
    const acq = await acquireGrantsGovAttachment(ROW, deps({
      fetchLegacyDetails: async () => ({
        legacyOpportunityId: 1,
        opportunityNumber: "X-1",
        assistUrl: null,
        assistCompatible: false,
        workspaceCompatible: false,
        attachments: [{ id: 9, fileName: "X-1-NOFO.pdf", mimeType: "text/html", fileSizeBytes: 100, folderType: "Full Announcement" }],
        packageIds: [],
      }),
      simpler: {
        getOpportunity: async () => {
          simplerCalled += 1;
          return { opportunity_id: "uuid-1", opportunity_title: "t", attachments: [] };
        },
      },
      fetchDocument: async () => HTML_DOC(NOFO_HTML),
    }));
    expect(acq.status).toBe("ok");
    expect(simplerCalled).toBe(0);
    const extra = acq.extra as unknown as GrantsGovExtra;
    expect(extra.routesUsed).toEqual(["legacy"]);
    expect(extra.chosen!.fileName).toBe("X-1-NOFO.pdf");
    expect(extra.objectives).toContain("nutrition services research");
  });

  it("falls back to Simpler when the legacy record lists nothing acceptable", async () => {
    const acq = await acquireGrantsGovAttachment(ROW, deps({
      fetchLegacyDetails: async () => ({
        legacyOpportunityId: 1,
        opportunityNumber: "X-1",
        assistUrl: null,
        assistCompatible: false,
        workspaceCompatible: false,
        attachments: [{ id: 9, fileName: "forms.zip", mimeType: "application/x-zip-compressed", fileSizeBytes: 100, folderType: null }],
        packageIds: [],
      }),
      simpler: {
        getOpportunity: async () => ({
          opportunity_id: "uuid-1",
          opportunity_title: "t",
          attachments: [{ file_name: "X-1-NOFO.pdf", mime_type: "application/pdf", download_path: "https://files.simpler.grants.gov/x.pdf" }],
        }),
      },
      fetchDocument: async () => HTML_DOC(NOFO_HTML),
    }));
    expect(acq.status).toBe("ok");
    expect((acq.extra as unknown as GrantsGovExtra).routesUsed).toEqual(["legacy", "simpler"]);
    expect(acq.status === "ok" && acq.source).toBe("simpler_attachment");
  });

  it("tries the next candidate when the first yields no objectives", async () => {
    const read: string[] = [];
    const acq = await acquireGrantsGovAttachment(ROW, deps({
      fetchLegacyDetails: async () => ({
        legacyOpportunityId: 1,
        opportunityNumber: "X-1",
        assistUrl: null,
        assistCompatible: false,
        workspaceCompatible: false,
        attachments: [
          { id: 1, fileName: "A-NOFO.pdf", mimeType: "text/html", fileSizeBytes: 900, folderType: null },
          { id: 2, fileName: "B-NOFO.pdf", mimeType: "text/html", fileSizeBytes: 100, folderType: null },
        ],
        packageIds: [],
      }),
      fetchDocument: async (url) => {
        read.push(url);
        return HTML_DOC(url.endsWith("/2") ? NOFO_HTML : "<p>Eligibility</p><p>IHEs may apply.</p>");
      },
    }));
    expect(read).toHaveLength(2);
    expect(acq.status).toBe("ok");
    expect(acq.status === "ok" && acq.sections.some((s) => s.roles?.includes("objectives"))).toBe(true);
  });

  it("a document with no recognisable structure is an error, never a partial write", async () => {
    const acq = await acquireGrantsGovAttachment(ROW, deps({
      fetchLegacyDetails: async () => ({
        legacyOpportunityId: 1,
        opportunityNumber: "X-1",
        assistUrl: null,
        assistCompatible: false,
        workspaceCompatible: false,
        attachments: [{ id: 1, fileName: "A-NOFO.pdf", mimeType: "text/html", fileSizeBytes: 100, folderType: null }],
        packageIds: [],
      }),
      fetchDocument: async () => HTML_DOC("<p>a page of prose with no headings at all</p>"),
    }));
    expect(acq.status).toBe("error");
    expect(acq).not.toHaveProperty("sections");
    expect(acq).not.toHaveProperty("textHash");
  });

  it("a row with no acceptable file is not_applicable — a structural absence, not a failure to retry", async () => {
    const acq = await acquireGrantsGovAttachment(ROW, deps());
    // `not_applicable` rather than `error`: NSF attaches nothing to Grants.gov
    // and DOJ publishes elsewhere, so ~180 rows have no announcement to read.
    // Stamping those `error` would put them in a retry cadence forever and
    // count them as failures on the data-sources page.
    expect(acq.status).toBe("not_applicable");
    expect(acq).not.toHaveProperty("sections");
    expect(acq.pageFetches).toBe(0);
  });

  it("a fetch failure on every candidate is an error, not a silent success", async () => {
    const acq = await acquireGrantsGovAttachment(ROW, deps({
      fetchLegacyDetails: async () => ({
        legacyOpportunityId: 1,
        opportunityNumber: "X-1",
        assistUrl: null,
        assistCompatible: false,
        workspaceCompatible: false,
        attachments: [{ id: 1, fileName: "A-NOFO.pdf", mimeType: "application/pdf", fileSizeBytes: 100, folderType: null }],
        packageIds: [],
      }),
      fetchDocument: async (url) => ({ status: "error", url, error: "HTTP 500" }),
    }));
    expect(acq.status).toBe("error");
    expect(acq.status === "error" && acq.error).toContain("HTTP 500");
  });

  it("a document that sections but has no objectives is refused, not stored (D2)", async () => {
    // The regression this guards: `firstUsableTarget` falls back to the first
    // *readable* document when none is accepted, which is right for a caller
    // that wants something over nothing and wrong here. Storing it would set
    // `sources.text` to full text — so the profile is scored as though the
    // announcement had been read — while `groupSections` produced empty groups,
    // because `award_info`/`other` roles feed no group that carries programme
    // text. Measured on the live corpus this fired on ~5% of `ok` rows.
    const acq = await acquireGrantsGovAttachment(ROW, deps({
      fetchLegacyDetails: async () => ({
        legacyOpportunityId: 1,
        opportunityNumber: "X-1",
        assistUrl: null,
        assistCompatible: false,
        workspaceCompatible: false,
        attachments: [{ id: 7, fileName: "nofo.pdf", mimeType: "text/html", fileSizeBytes: 100, folderType: "Full Announcement" }],
        packageIds: [],
      }),
      // Real headings, real sections — but none of them `objectives`.
      fetchDocument: async () => HTML_DOC("<p>III. Award Information</p><p>amounts</p><p>VIII. Other Information</p><p>notes</p>"),
    }));
    expect(acq.status).toBe("error");
    expect(acq).not.toHaveProperty("sections");
    expect(acq.status === "error" && acq.error).toContain("objectives");
  });

  it("the same document with an objectives block is stored", async () => {
    const acq = await acquireGrantsGovAttachment(ROW, deps({
      fetchLegacyDetails: async () => ({
        legacyOpportunityId: 1,
        opportunityNumber: "X-1",
        assistUrl: null,
        assistCompatible: false,
        workspaceCompatible: false,
        attachments: [{ id: 7, fileName: "nofo.pdf", mimeType: "text/html", fileSizeBytes: 100, folderType: "Full Announcement" }],
        packageIds: [],
      }),
      fetchDocument: async () => HTML_DOC("<p>Program description</p><p>what this programme funds</p><p>Eligibility</p><p>who may apply</p>"),
    }));
    expect(acq.status).toBe("ok");
    expect(acq.status === "ok" && acq.sections.some((x) => (x.roles ?? []).includes("objectives"))).toBe(true);
  });

  it("reads at most four ranked attachments, however many the record lists", async () => {
    const read: string[] = [];
    const acq = await acquireGrantsGovAttachment(ROW, deps({
      fetchLegacyDetails: async () => ({
        legacyOpportunityId: 1,
        opportunityNumber: "X-1",
        assistUrl: null,
        assistCompatible: false,
        workspaceCompatible: false,
        attachments: Array.from({ length: 17 }, (_, i) => ({ id: i + 1, fileName: `f${i}.pdf`, mimeType: "text/html", fileSizeBytes: 100 - i, folderType: null })),
        packageIds: [],
      }),
      fetchDocument: async (url) => {
        read.push(url);
        return HTML_DOC("<p>nothing structural</p>");
      },
    }));
    expect(read).toHaveLength(4);
    expect(acq.status).toBe("error");
  });

  it("adds the package-instructions PDF as a last resort once the legacy record names a package", async () => {
    const read: string[] = [];
    const acq = await acquireGrantsGovAttachment(ROW, deps({
      fetchLegacyDetails: async () => ({
        legacyOpportunityId: 1,
        opportunityNumber: "X-1",
        assistUrl: null,
        assistCompatible: false,
        workspaceCompatible: false,
        attachments: [{ id: 1, fileName: "A-NOFO.pdf", mimeType: "text/html", fileSizeBytes: 100, folderType: null }],
        packageIds: ["PKG00293844"],
      }),
      fetchDocument: async (url) => {
        read.push(url);
        return HTML_DOC(url.includes("instructions") ? NOFO_HTML : "<p>nothing structural</p>");
      },
    }));
    expect(read[1]).toBe("https://apply07.grants.gov/apply/opportunities/instructions/PKG00293844-instructions.pdf");
    expect(acq.status).toBe("ok");
  });
});
