/**
 * PR 5.4: the NSF solicitation adapter, its heading table, and the two rules
 * the plan is emphatic about — never construct an `ods_key`, and never treat a
 * `PD-` program description as a failed solicitation.
 *
 * The two fixtures are the **raw HTML** of real solicitation pages, saved
 * verbatim, because NSF's route is HTML end to end: `htmlToLines` has to strip
 * ninety lines of site navigation, a duplicated summary block and a Table of
 * Contents that repeats every heading before the sectioner sees a single real
 * one, and a hand-cut skeleton would exercise none of that.
 *
 *   nsf24-529  Innovations in Graduate Education. The canonical shape: one
 *              `Replaces:` line, and **no** programme codes anywhere on the
 *              page — the case that forces the program-page hop.
 *   nsf26-519  MPS Chemistry research programs. Award-search links in the body,
 *              so the codes are recovered with no second request, and a
 *              `Replaces:` line naming two publications.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  NSF_HEADING_TABLES,
  NSF_SOLICITATION_HEADINGS,
  hasObjectives,
  isTableOfContentsLine,
  rolesOf,
  sectionByHeadings,
  sectionWithBestTable,
} from "@/lib/ingestion/announcement/sectioner";
import { htmlToLines, textToLines } from "@/lib/ingestion/announcement/text";
import {
  NSF_SOLICITATION_ADAPTER_ID,
  acquireNsfSolicitation,
  appliesToNsfSolicitation,
  derivedNsfPdfUrl,
  extractNsfCodes,
  extractReplacedDocuments,
  nsfElementCodeStem,
  nsfNumberKind,
  programElementFromPdNumber,
  programPageUrlFor,
  storedNsfUrl,
  type NsfDeps,
  type NsfDocument,
  type NsfExtra,
  type NsfRow,
} from "@/lib/ingestion/announcement/adapters/nsf-solicitation";
import { AsyncRateLimiter } from "@/lib/utils/async-rate-limiter";

const FIXTURES = path.join(__dirname, "__fixtures__");
const html = (name: string) => readFileSync(path.join(FIXTURES, name), "utf8");
const lines = (name: string) => htmlToLines(html(name));

const OPTS = { ignoreHeading: isTableOfContentsLine, dedupe: "longest" as const };
const section = (name: string) => sectionWithBestTable(lines(name), NSF_HEADING_TABLES, OPTS);

const FIXTURE_FILES = ["nsf24-529.solicitation.html", "nsf26-519.solicitation.html"] as const;

// ---------------------------------------------------------------------------
// The heading table, on real solicitation pages
// ---------------------------------------------------------------------------

describe("the NSF heading table on real solicitation pages", () => {
  for (const file of FIXTURE_FILES) {
    it(`${file}: recovers an objectives block from II. Program Description`, () => {
      const doc = section(file);
      expect(doc).not.toBeNull();
      expect(doc!.table).toBe("nsf_solicitation");
      expect(hasObjectives(doc!.sections)).toBe(true);
    });

    it(`${file}: recovers all six roles the plan names`, () => {
      const doc = section(file)!;
      for (const role of ["purpose", "objectives", "award_info", "eligibility", "review", "contacts"]) {
        expect(doc.roles).toContain(role);
      }
    });

    it(`${file}: every section id appears once — the Table of Contents re-opened none of them`, () => {
      const ids = section(file)!.sections.map((s) => s.section);
      expect(ids).toEqual([...new Set(ids)]);
    });

    it(`${file}: the nine numbered parts are all found, so no block swallows the next`, () => {
      const ids = section(file)!.sections.map((s) => s.section);
      expect(ids).toEqual([
        "nsf.summary",
        "nsf.introduction",
        "nsf.program_description",
        "nsf.award",
        "nsf.eligibility",
        "nsf.proposal_prep",
        "nsf.review",
        "nsf.administration",
        "nsf.contacts",
        "nsf.other",
      ]);
    });

    it(`${file}: no section id is an NIH roman numeral, so sectionLabel cannot render it as one`, () => {
      // `isNihSectionId` matches /^[IVX]+(\.\d+)?$/; an id of "II" would make a
      // Part 2 · Section II · … label appear on an NSF notice.
      for (const s of section(file)!.sections) expect(s.section).toMatch(/^nsf\./);
    });
  }

  it("nsf24-529: the objectives block is the body of II, not the contents entry", () => {
    const doc = section("nsf24-529.solicitation.html")!;
    const objectives = doc.sections.filter((s) => s.roles?.includes("objectives"));
    expect(objectives).toHaveLength(1);
    expect(objectives[0]!.heading).toBe("II. Program Description");
    expect(objectives[0]!.text).toContain("The IGE program is dedicated to");
    expect(objectives[0]!.text.length).toBeGreaterThan(3000);
  });

  it("nsf26-519: the objectives block names the disciplinary programmes", () => {
    const doc = section("nsf26-519.solicitation.html")!;
    const objectives = doc.sections.filter((s) => s.roles?.includes("objectives")).map((s) => s.text).join("\n");
    expect(objectives).toContain("Chemical Catalysis");
  });

  it("the Summary of Program Requirements is kept as purpose, and it is the real block not the contents entry", () => {
    const summary = section("nsf24-529.solicitation.html")!.sections.find((s) => s.section === "nsf.summary")!;
    expect(summary.roles).toEqual(["purpose"]);
    // The contents list re-opens this heading a few lines later; `dedupe:
    // "longest"` is what keeps the block that carries the synopsis.
    expect(summary.text).toContain("Synopsis of Program:");
    expect(summary.text.length).toBeGreaterThan(2000);
  });

  it("the terminators bound the blocks that feed the extractor", () => {
    const doc = section("nsf24-529.solicitation.html")!;
    const eligibility = doc.sections.find((s) => s.section === "nsf.eligibility")!;
    // Without the `V.` pattern this block would run to `VI.` and carry twenty
    // kilobytes of PAPPG proposal-preparation boilerplate into group 3.
    expect(eligibility.text).not.toContain("Proposal Preparation Instructions");
    expect(eligibility.text.length).toBeLessThan(6000);
  });

  it("a Table of Contents entry cannot open a section on its own", () => {
    // Every contents entry is the bare title with no roman numeral; only the
    // enumerated body headings match.
    const doc = sectionByHeadings(
      textToLines(["Table Of Contents", "Program Description", "Award Information", "II. Program Description", "the body text", "III. Award Information", "the award text"].join("\n")),
      NSF_SOLICITATION_HEADINGS,
      OPTS,
    );
    const objectives = doc.filter((s) => s.roles?.includes("objectives"));
    expect(objectives).toHaveLength(1);
    expect(objectives[0]!.text).toBe("the body text");
  });

  it("a solicitation that renumbers its parts still sections", () => {
    // The titles identify the block; the numeral is only an enumerator, so a
    // solicitation with no Introduction and Program Description at I. works.
    const doc = sectionByHeadings(
      textToLines(["I. PROGRAM DESCRIPTION", "objectives text", "II. AWARD INFORMATION", "award text", "III. ELIGIBILITY INFORMATION", "eligibility text"].join("\n")),
      NSF_SOLICITATION_HEADINGS,
      OPTS,
    );
    expect(rolesOf(doc)).toEqual(["award_info", "eligibility", "objectives"]);
  });

  it("a proposal-content outline inside II does not open a new section", () => {
    // Two of the 74 open solicitations number the required proposal sections
    // `I. Overview`, `II. Execution Plan…`, `III. Organization and Management`
    // inside the Program Description. None of those titles is in the table.
    const doc = sectionByHeadings(
      textToLines(["II. Program Description", "prelude", "I. Overview", "a", "II. Execution Plan, Evaluation, and Assessment", "b", "III. Organization and Management", "c"].join("\n")),
      NSF_SOLICITATION_HEADINGS,
      OPTS,
    );
    expect(doc).toHaveLength(1);
    expect(doc[0]!.section).toBe("nsf.program_description");
    expect(doc[0]!.text).toContain("Execution Plan");
  });
});

// ---------------------------------------------------------------------------
// Reading the row: never construct an ods_key
// ---------------------------------------------------------------------------

describe("storedNsfUrl reads the row and never builds a URL", () => {
  const row = (summary: unknown): NsfRow => ({ id: "x", opportunity_number: "24-529", agency_code: "NSF", raw_payload_json: { summary } as Record<string, unknown> });

  it("takes the stored additional_info_url", () => {
    expect(storedNsfUrl(row({ additional_info_url: "http://www.nsf.gov/publications/pub_summ.jsp?ods_key=nsf24529" }))).toBe(
      "http://www.nsf.gov/publications/pub_summ.jsp?ods_key=nsf24529",
    );
  });

  it("takes the older pgm_summ.jsp?pims_id form too — two shapes exist, which is why keys are never built", () => {
    expect(storedNsfUrl(row({ additional_info_url: "http://www.nsf.gov/funding/pgm_summ.jsp?pims_id=5664" }))).toBe("http://www.nsf.gov/funding/pgm_summ.jsp?pims_id=5664");
  });

  it("returns null rather than a guess when the row stores nothing", () => {
    expect(storedNsfUrl(row({}))).toBeNull();
    expect(storedNsfUrl(row(null))).toBeNull();
    expect(storedNsfUrl({ raw_payload_json: null })).toBeNull();
  });

  it("refuses a stored URL that is not on nsf.gov", () => {
    expect(storedNsfUrl(row({ additional_info_url: "https://evil.example.com/nsf.gov/pub_summ.jsp?ods_key=nsf24529" }))).toBeNull();
    expect(storedNsfUrl(row({ additional_info_url: "https://www.nsf.gov.example.com/x" }))).toBeNull();
    expect(storedNsfUrl(row({ additional_info_url: "https://www.nsf.gov@evil.example.com/x" }))).toBeNull();
    expect(storedNsfUrl(row({ additional_info_url: "//www.nsf.gov/x" }))).toBeNull();
  });

  it("refuses a scheme that is not http(s), even on an nsf.gov host", () => {
    // `new URL("file://nsf.gov/…").hostname` is "nsf.gov", so a host test on
    // its own admits this.
    expect(storedNsfUrl(row({ additional_info_url: "file://nsf.gov/etc/passwd" }))).toBeNull();
    expect(storedNsfUrl(row({ additional_info_url: "data:text/html,<p>II. Program Description</p>" }))).toBeNull();
  });
});

describe("nsfNumberKind", () => {
  it("reads NN-NNN as a solicitation and PD-YY-EEEE as a program description", () => {
    expect(nsfNumberKind("24-529")).toBe("solicitation");
    expect(nsfNumberKind("26-514")).toBe("solicitation");
    expect(nsfNumberKind("PD-18-1263")).toBe("program_description");
    expect(nsfNumberKind("PD-24-110Z")).toBe("program_description");
    expect(nsfNumberKind("PD-26-366Y")).toBe("program_description");
  });

  it("does not guess at a shape it has not seen", () => {
    expect(nsfNumberKind("NSF 24-529")).toBe("unknown");
    expect(nsfNumberKind(null)).toBe("unknown");
    expect(nsfNumberKind("DCL-25-001")).toBe("unknown");
  });
});

describe("derivedNsfPdfUrl — the fallback, and only the fallback", () => {
  it("builds the path NON_NIH_INVENTORY § 4b probed", () => {
    expect(derivedNsfPdfUrl("24-564")).toBe("https://nsf-gov-resources.nsf.gov/solicitations/pubs/2024/nsf24564/nsf24564.pdf");
    expect(derivedNsfPdfUrl("20-544")).toBe("https://nsf-gov-resources.nsf.gov/solicitations/pubs/2020/nsf20544/nsf20544.pdf");
  });

  it("has nothing to build for a program description", () => {
    expect(derivedNsfPdfUrl("PD-18-1263")).toBeNull();
    expect(derivedNsfPdfUrl(null)).toBeNull();
  });
});

describe("programPageUrlFor", () => {
  it("takes the slug from the final URL, which every solicitation page has", () => {
    expect(programPageUrlFor("https://www.nsf.gov/funding/opportunities/innovations-graduate-education-program/nsf24-529/solicitation")).toBe(
      "https://www.nsf.gov/funding/opportunities/innovations-graduate-education-program",
    );
  });

  it("handles the extra numeric segment four of the pages carry", () => {
    expect(programPageUrlFor("https://www.nsf.gov/funding/opportunities/che-drp-division-chemistry-disciplinary-research-programs/505537/nsf22-605/solicitation")).toBe(
      "https://www.nsf.gov/funding/opportunities/che-drp-division-chemistry-disciplinary-research-programs",
    );
  });

  it("returns null when the URL is already the program page, or is not one at all", () => {
    expect(programPageUrlFor("https://www.nsf.gov/funding/opportunities/probability")).toBeNull();
    expect(programPageUrlFor("https://www.nsf.gov/")).toBeNull();
    expect(programPageUrlFor("not a url")).toBeNull();
  });

  it("builds nothing from a final URL that is not on nsf.gov", () => {
    // The input is where the redirects landed, not a URL this module chose, so
    // without the host test one off-host redirect buys the redirect target a
    // GET at an origin of its own choosing.
    expect(programPageUrlFor("https://evil.example.com/funding/opportunities/anything/x")).toBeNull();
    expect(programPageUrlFor("http://www.nsf.gov.evil.example.com/funding/opportunities/x/y")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Reissue lineage
// ---------------------------------------------------------------------------

describe("extractReplacedDocuments", () => {
  it("reads the modern page's single Replaces line", () => {
    expect(extractReplacedDocuments(lines("nsf24-529.solicitation.html"))).toEqual(["20-595"]);
  });

  it("reads a list of replaced publications", () => {
    expect(extractReplacedDocuments(lines("nsf26-519.solicitation.html"))).toEqual(["22-605", "22-606"]);
  });

  it("normalises a replaced program description to the PD- form the opportunity_number uses", () => {
    expect(extractReplacedDocuments(textToLines("Replaces: PD 18-1517 , PD 18-7564 , PD 19-088Y"))).toEqual(["PD-18-1517", "PD-18-7564", "PD-19-088Y"]);
  });

  it("reads the PDF's REPLACES DOCUMENT(S) form with the numbers on the next line", () => {
    expect(extractReplacedDocuments(textToLines(["REPLACES DOCUMENT(S):", "NSF 20-595", "Some following paragraph that is not a number."].join("\n")))).toEqual(["20-595"]);
  });

  it("does not read a sentence that merely starts with the word", () => {
    expect(extractReplacedDocuments(textToLines("Replaces the previous edition of the guide, effective 24-529 days after publication."))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Programme codes
// ---------------------------------------------------------------------------

describe("extractNsfCodes", () => {
  it("reads the award-search links printed in a solicitation body", () => {
    const found = extractNsfCodes({ html: html("nsf26-519.solicitation.html"), lines: lines("nsf26-519.solicitation.html") });
    expect(found.elements).toContain("687800");
    expect(found.elements).toContain("910200");
  });

  it("finds nothing on a page that prints none — the case that forces the program-page hop", () => {
    const found = extractNsfCodes({ html: html("nsf24-529.solicitation.html"), lines: lines("nsf24-529.solicitation.html") });
    expect(found.elements).toEqual([]);
    expect(found.references).toEqual([]);
  });

  it("decodes a comma-separated ProgEleCode link and keeps both code widths verbatim", () => {
    expect(extractNsfCodes({ html: 'href="/awardsearch/search-results?ProgEleCode=079Y%2C080Y%2C7727&BooleanElement=Any"' }).elements).toEqual(["079Y", "080Y", "7727"]);
    expect(extractNsfCodes({ html: 'href="…?ProgEleCode=199700%2C260Y00"' }).elements).toEqual(["199700", "260Y00"]);
  });

  it("reads reference codes separately from element codes", () => {
    const found = extractNsfCodes({ html: 'href="…?ProgEleCode=772300&ProgRefCode=9251%2C019Z"' });
    expect(found.elements).toEqual(["772300"]);
    expect(found.references).toEqual(["019Z", "9251"]);
  });

  it("reads the classic printed block and NSF's prose forms", () => {
    expect(extractNsfCodes({ lines: textToLines("Program Element Code(s): 7222, 8091") }).elements).toEqual(["7222", "8091"]);
    expect(extractNsfCodes({ lines: textToLines("Chemical Catalysis (CAT), Element code 688400.") }).elements).toEqual(["688400"]);
    expect(extractNsfCodes({ lines: textToLines("…using the program element code of 7412 in the awards search function.") }).elements).toEqual(["7412"]);
  });

  it("stops at the first token that is not a code, so a year later in the sentence is not one", () => {
    expect(extractNsfCodes({ lines: textToLines("Program Element Code(s): 7222 were awarded in 2024 across 1200 projects.") }).elements).toEqual(["7222"]);
  });

  it("nsfElementCodeStem gives the four-character form without applying it", () => {
    expect(nsfElementCodeStem("772300")).toBe("7723");
    expect(nsfElementCodeStem("7727")).toBe("7727");
    expect(nsfElementCodeStem("260Y00")).toBe("260Y");
  });
});

describe("programElementFromPdNumber", () => {
  it("reads the element code out of the PD number, which is what it is", () => {
    expect(programElementFromPdNumber("PD-18-1263")).toEqual(["126300"]);
    expect(programElementFromPdNumber("PD-18-7970")).toEqual(["797000"]);
    expect(programElementFromPdNumber("PD-26-366Y")).toEqual(["366Y00"]);
  });

  it("has nothing to say about a solicitation number", () => {
    expect(programElementFromPdNumber("24-529")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

const STORED = "http://www.nsf.gov/publications/pub_summ.jsp?ods_key=nsf24529";
const FINAL = "https://www.nsf.gov/funding/opportunities/innovations-graduate-education-program/nsf24-529/solicitation";

function row(over: Partial<NsfRow> = {}): NsfRow {
  return {
    id: "row-1",
    opportunity_number: "24-529",
    agency_code: "NSF",
    forecasted: false,
    raw_payload_json: { summary: { additional_info_url: STORED } },
    ...over,
  };
}

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function deps(fetchDocument: NsfDeps["fetchDocument"], over: Partial<NsfDeps> = {}): NsfDeps {
  const limiter = new AsyncRateLimiter(0);
  return { limiterFor: () => limiter, fetchDocument, ...over };
}

const okDoc = (url: string, finalUrl: string, body: string): NsfDocument => ({
  status: "ok",
  url,
  finalUrl,
  bytes: bytesOf(body),
  contentType: "text/html; charset=UTF-8",
});

describe("appliesToNsfSolicitation", () => {
  it("takes every NSF row, solicitation or program description", () => {
    expect(appliesToNsfSolicitation(row())).toBe(true);
    expect(appliesToNsfSolicitation(row({ opportunity_number: "PD-18-1263" }))).toBe(true);
  });

  it("leaves other families and forecasts alone", () => {
    expect(appliesToNsfSolicitation(row({ agency_code: "HHS-CDC", opportunity_number: "CDC-RFA-JG-26-0043" }))).toBe(false);
    expect(appliesToNsfSolicitation(row({ forecasted: true }))).toBe(false);
  });
});

describe("acquireNsfSolicitation", () => {
  it("follows the stored URL, sections the page and reports the final URL", async () => {
    const seen: string[] = [];
    const acq = await acquireNsfSolicitation(
      row(),
      deps(async (url) => {
        seen.push(url);
        return okDoc(url, FINAL, html("nsf24-529.solicitation.html"));
      }),
    );
    expect(acq.status).toBe("ok");
    if (acq.status !== "ok") return;
    const extra = acq.extra as NsfExtra;
    expect(seen[0]).toBe(STORED);
    expect(extra.route).toBe("stored_url");
    expect(extra.finalUrl).toBe(FINAL);
    expect(acq.url).toBe(FINAL);
    expect(acq.source).toBe("nsf_solicitation");
    expect(extra.replaces).toEqual(["20-595"]);
    expect(acq.sections.some((s) => s.roles?.includes("objectives"))).toBe(true);
    expect(acq.textHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never fetches anything for a PD- row, and calls it not_applicable rather than a failure", async () => {
    const acq = await acquireNsfSolicitation(
      row({ opportunity_number: "PD-18-1263", raw_payload_json: { summary: { additional_info_url: "http://www.nsf.gov/funding/pgm_summ.jsp?pims_id=5555" } } }),
      deps(async () => {
        throw new Error("a PD- row must not be fetched");
      }),
    );
    expect(acq.status).toBe("not_applicable");
    expect(acq.pageFetches).toBe(0);
    const extra = acq.extra as NsfExtra;
    expect(extra.kind).toBe("program_description");
    // The element code still comes out, because the number is the code.
    expect(extra.programElementCodes).toEqual(["126300"]);
    expect(extra.codeSource).toBe("number");
  });

  it("reports a row with no stored URL as unresolvable when there is nothing to derive either", async () => {
    const acq = await acquireNsfSolicitation(
      row({ opportunity_number: "DCL-25-001", raw_payload_json: {} }),
      deps(async () => {
        throw new Error("nothing should be fetched");
      }),
    );
    expect(acq.status).toBe("not_applicable");
    expect(acq.pageFetches).toBe(0);
    if (acq.status === "ok" || acq.status === "unchanged") return;
    expect(acq.error).toMatch(/ods_key is never constructed/);
  });

  it("falls back to the derived PDF only after the stored URL fails", async () => {
    const seen: string[] = [];
    const acq = await acquireNsfSolicitation(
      row(),
      deps(async (url) => {
        seen.push(url);
        return { status: "not_found", url };
      }),
    );
    expect(seen).toEqual([STORED, "https://nsf-gov-resources.nsf.gov/solicitations/pubs/2024/nsf24529/nsf24529.pdf"]);
    expect(acq.status).toBe("not_found");
    expect(acq.pageFetches).toBe(2);
  });

  it("stops at the stored URL when it works, so the derived PDF is never requested", async () => {
    const seen: string[] = [];
    await acquireNsfSolicitation(
      row({ opportunity_number: "26-519", raw_payload_json: { summary: { additional_info_url: "http://www.nsf.gov/publications/pub_summ.jsp?ods_key=nsf26519" } } }),
      deps(async (url) => {
        seen.push(url);
        return okDoc(url, "https://www.nsf.gov/funding/opportunities/mps-chem/nsf26-519/solicitation", html("nsf26-519.solicitation.html"));
      }),
    );
    expect(seen.filter((u) => u.includes("nsf-gov-resources"))).toEqual([]);
  });

  it("refuses a document that sections but carries no objectives — it is never stored (D69)", async () => {
    const body = "<h1>NSF 24-529</h1><p>I. Introduction</p><p>some prose</p><p>VIII. Agency Contacts</p><p>someone@nsf.gov</p>";
    const acq = await acquireNsfSolicitation(row(), deps(async (url) => okDoc(url, FINAL, body)));
    expect(acq.status).toBe("error");
    if (acq.status === "ok" || acq.status === "unchanged") return;
    expect(acq.error).toMatch(/no II. Program Description block/);
    expect(acq).not.toHaveProperty("sections");
  });

  it("refuses a document whose redirects landed off nsf.gov — it is never sectioned or stored", async () => {
    // `redirect: "follow"` means the bytes need not come from the host that was
    // asked. This body sections perfectly and carries a real objectives block:
    // without the final-URL check it would be stored as the announcement, and
    // `sources.text` would then say NSF's solicitation had been read.
    const acq = await acquireNsfSolicitation(
      row(),
      deps(async (url) => okDoc(url, "https://evil.example.com/funding/opportunities/x/nsf24-529/solicitation", html("nsf24-529.solicitation.html"))),
    );
    expect(acq.status).toBe("error");
    expect(acq).not.toHaveProperty("sections");
    if (acq.status === "ok" || acq.status === "unchanged") return;
    expect(acq.error).toMatch(/redirected off nsf\.gov/);
  });

  it("takes no codes from a program page that redirected off nsf.gov", async () => {
    const acq = await acquireNsfSolicitation(
      row(),
      deps(async (url) => {
        if (url.endsWith("/innovations-graduate-education-program")) {
          return okDoc(url, "https://evil.example.com/x", '<a href="/awardsearch/search-results?ProgEleCode=199700">Awards</a>');
        }
        return okDoc(url, FINAL, html("nsf24-529.solicitation.html"));
      }),
    );
    expect(acq.status).toBe("ok");
    const extra = acq.extra as NsfExtra;
    expect(extra.programElementCodes).toEqual([]);
    expect(extra.codeSource).toBeNull();
  });

  it("distinguishes a transport failure from a 404 on every target", async () => {
    const acq = await acquireNsfSolicitation(row(), deps(async (url) => ({ status: "error", url, error: "socket hang up" })));
    expect(acq.status).toBe("error");
  });

  it("reads the programme codes off the program page when the document printed none", async () => {
    const seen: string[] = [];
    const acq = await acquireNsfSolicitation(
      row(),
      deps(async (url) => {
        seen.push(url);
        if (url.endsWith("/innovations-graduate-education-program")) {
          return okDoc(url, url, '<a href="/awardsearch/search-results?ProgEleCode=199700%2C260Y00&amp;BooleanElement=Any">Awards</a>');
        }
        return okDoc(url, FINAL, html("nsf24-529.solicitation.html"));
      }),
    );
    expect(acq.status).toBe("ok");
    const extra = acq.extra as NsfExtra;
    expect(seen).toEqual([STORED, "https://www.nsf.gov/funding/opportunities/innovations-graduate-education-program"]);
    expect(extra.programElementCodes).toEqual(["199700", "260Y00"]);
    expect(extra.codeSource).toBe("program_page");
    expect(acq.pageFetches).toBe(2);
  });

  it("does not spend the extra request when the document already printed the codes", async () => {
    const seen: string[] = [];
    const acq = await acquireNsfSolicitation(
      row({ opportunity_number: "26-519" }),
      deps(async (url) => {
        seen.push(url);
        return okDoc(url, "https://www.nsf.gov/funding/opportunities/mps-chem/nsf26-519/solicitation", html("nsf26-519.solicitation.html"));
      }),
    );
    expect(seen).toHaveLength(1);
    const extra = acq.extra as NsfExtra;
    expect(extra.codeSource).toBe("document");
    expect(extra.programElementCodes).toContain("687800");
  });

  it("--no-program-page skips the hop and costs only the codes", async () => {
    const seen: string[] = [];
    const acq = await acquireNsfSolicitation(
      row(),
      deps(
        async (url) => {
          seen.push(url);
          return okDoc(url, FINAL, html("nsf24-529.solicitation.html"));
        },
        { programPage: false },
      ),
    );
    expect(acq.status).toBe("ok");
    expect(seen).toHaveLength(1);
    expect((acq.extra as NsfExtra).programElementCodes).toEqual([]);
  });

  it("a failing program page never fails the notice", async () => {
    const acq = await acquireNsfSolicitation(
      row(),
      deps(async (url) => (url.includes("pub_summ") ? okDoc(url, FINAL, html("nsf24-529.solicitation.html")) : { status: "error", url, error: "HTTP 503" })),
    );
    expect(acq.status).toBe("ok");
    expect((acq.extra as NsfExtra).codeSource).toBeNull();
  });

  it("the adapter id is the value the backfill stamps into announcement_kind", () => {
    expect(NSF_SOLICITATION_ADAPTER_ID).toBe("nsf_solicitation");
  });
});
