/**
 * PR 5.5: the CDMRP / DHA adapter — the FON decomposition, the direct
 * `cdmrp.health.mil` route, the mirror fallback, and the CDMRP heading table on
 * a real Program Announcement.
 *
 * The fixture is `HT942526BCRPBTA122` — the FY26 Breast Cancer Research Program
 * Breakthrough Award Levels 1 and 2 — read through the *direct* route and saved
 * as the text `pdfToLines` produced, the same convention PR 5.3 used. It is a
 * different program and a different award family from PR 5.3's
 * `HT942526SCIRPTRA`, and it is the row that exercises the level split
 * (`BTA` + `122`), so the two together pin both halves of the decomposition.
 *
 * `FON_TAILS` is `NON_NIH_INVENTORY.md` § 5b, verbatim and uncollapsed. § 5a's
 * suffix match is known-wrong and is not asserted anywhere; § 5b is the input.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AsyncRateLimiter } from "@/lib/utils/async-rate-limiter";
import { CDMRP_PA_HEADINGS, hasObjectives } from "@/lib/ingestion/announcement/sectioner";
import { textToLines } from "@/lib/ingestion/announcement/text";
import {
  acquireGrantsGovAttachment,
  type GrantsGovDeps,
  type GrantsGovExtra,
  type GrantsGovRow,
} from "@/lib/ingestion/announcement/adapters/grants-gov-attachment";
import {
  CDMRP_HEADING_TABLES,
  CDMRP_HOST,
  CDMRP_MIN_INTERVAL_MS,
  CDMRP_PA_HEADINGS_ALL,
  CDMRP_PROGRAMS,
  acquireCdmrpPa,
  appliesToCdmrpPa,
  cdmrpProgramAnnouncementUrl,
  decomposeCdmrpFon,
  matchProgram,
  parseCdmrpCoverPage,
  sectionCdmrpDocument,
  type CdmrpExtra,
} from "@/lib/ingestion/announcement/adapters/cdmrp-pa";

const FIXTURES = path.join(__dirname, "__fixtures__");
const fixture = (name: string) => textToLines(readFileSync(path.join(FIXTURES, name), "utf8"));

/** `NON_NIH_INVENTORY.md` § 5b — every open DOD-AMRAA number, uncollapsed. */
const FON_TAILS: readonly string[] = [
  "HT942526ALSRPCOBA", "HT942526ALSRPPCTA", "HT942526ALSRPTDA", "HT942526ALSRPTIA",
  "HT942526ARPCDA", "HT942526ARPCTA", "HT942526ARPIDA",
  "HT942526ATRPCRA", "HT942526ATRPTRA",
  "HT942526AZRPTRCA", "HT942526AZRPTRDA", "HT942526AZRPTRRA",
  "HT942526BCRPBTA122", "HT942526BCRPBTA3", "HT942526BCRPBTA4", "HT942526BCRPCREA2", "HT942526BCRPTBCCA",
  "HT942526BMFRPIDA", "HT942526BMFRPIIRA", "HT942526BMFRPRDA",
  "HT942526CRRPTRA",
  "HT942526DMDRPCTRA", "HT942526DMDRPIDA",
  "HT942526HRRPFRA",
  "HT942526JWMRPMMRDA",
  "HT942526KCRPAKCIECSA", "HT942526KCRPIDA",
  "HT942526MBRPDA", "HT942526MBRPPCRA", "HT942526MBRPTTDA",
  "HT942526MRPFPARM", "HT942526MRPIA", "HT942526MRPMASA", "HT942526MRPSRA", "HT942526MRPTSA",
  "HT942526NFRPEHDA", "HT942526NFRPIIRA", "HT942526NFRPNFRALA", "HT942526NFRPNFRASA", "HT942526NFRPSIA",
  "HT942526OCRPCTA", "HT942526OCRPIIRA", "HT942526OCRPOCAECI", "HT942526OCRPOCCTAECI", "HT942526OCRPPA",
  "HT942526ORPARA", "HT942526ORPCRA",
  "HT942526PCARPFPTA", "HT942526PCARPIDA", "HT942526PCARPTRPA",
  "HT942526PRCRPCTA", "HT942526PRCRPIA", "HT942526PRCRPIPA",
  "HT942526PRMRPCTA", "HT942526PRMRPPCTA",
  "HT942526PRPEIRA", "HT942526PRPIIRA",
  "HT942526RCRPCA", "HT942526RCRPIDA", "HT942526RCRPRCDA",
  "HT942526RTRPCA", "HT942526RTRPIIRA",
  "HT942523SBAA1",
  "HT942526SCIRPCTA", "HT942526SCIRPCTRA", "HT942526SCIRPIIRA", "HT942526SCIRPTRA",
  "HT942526TBDRPIDA", "HT942526TBDRPTDRA",
  "HT942526TBIPHRPCTA", "HT942526TBIPHRPHSRA", "HT942526TBIPHRPTRA",
  "HT942526TERPCTA", "HT942526TERPIIRA", "HT942526TERPTRA",
  "HT942526VRPCTA", "HT942526VRPIIRA", "HT942526VRPMCRA", "HT942526VRPTRA",
];

/** The two rows § 5b lists as not matching the modern shape. */
const NON_MODERN: readonly string[] = ["HT9425-23-S-SOC1", "W81XWH-22-DHAPP"];

// ---------------------------------------------------------------------------
// The FON decomposition
// ---------------------------------------------------------------------------

describe("decomposeCdmrpFon", () => {
  it("cuts office, fiscal year, program and mechanism", () => {
    expect(decomposeCdmrpFon("HT942526PRMRPCTA")).toMatchObject({
      fon: "HT942526PRMRPCTA",
      office: "HT9425",
      fy: "26",
      fiscalYear: 2026,
      tail: "PRMRPCTA",
      program: "PRMRP",
      programName: "Peer Reviewed Medical Research Program",
      mechanism: "CTA",
      mechanismBase: "CTA",
      mechanismVariant: null,
      kind: "program_announcement",
    });
  });

  /**
   * The three cuts § 5a got wrong. Each one is a case where a suffix regex has
   * to choose between a longer program and a longer mechanism and has no way to.
   */
  it("binds the program greedily, which is the only way § 5a's three mis-cuts come out right", () => {
    // `PCTA ×10` was `P` + `CTA` mis-bound. Both readings are real, in
    // different programs, and only the program list separates them.
    expect(decomposeCdmrpFon("HT942526OCRPCTA")).toMatchObject({ program: "OCRP", mechanism: "CTA" });
    expect(decomposeCdmrpFon("HT942526ALSRPPCTA")).toMatchObject({ program: "ALSRP", mechanism: "PCTA" });
    expect(decomposeCdmrpFon("HT942526PRMRPPCTA")).toMatchObject({ program: "PRMRP", mechanism: "PCTA" });
    // `AZRPTRCA` is `AZRP` + `TRCA` (Transforming Care Award), not `AZRPTR` + `CA`.
    expect(decomposeCdmrpFon("HT942526AZRPTRCA")).toMatchObject({ program: "AZRP", mechanism: "TRCA" });
    // `MRPFPARM` is `MRP` + `FPARM`, not `MRPFP` + `ARM`.
    expect(decomposeCdmrpFon("HT942526MRPFPARM")).toMatchObject({ program: "MRP", mechanism: "FPARM" });
  });

  it("splits an award level off the mechanism letters PR 5.8 keys on", () => {
    expect(decomposeCdmrpFon("HT942526BCRPBTA122")).toMatchObject({ mechanism: "BTA122", mechanismBase: "BTA", mechanismVariant: "122" });
    expect(decomposeCdmrpFon("HT942526BCRPBTA3")).toMatchObject({ mechanism: "BTA3", mechanismBase: "BTA", mechanismVariant: "3" });
    expect(decomposeCdmrpFon("HT942526BCRPCREA2")).toMatchObject({ mechanism: "CREA2", mechanismBase: "CREA", mechanismVariant: "2" });
  });

  /**
   * `ORP` is on CDMRP's published funding page ("Orthopaedic Research Program
   * (ORP)") but its program page is still at the legacy `/prorp/` slug. Seeding
   * from the slugs alone loses both Orthopaedic rows.
   */
  it("knows ORP, whose FON abbreviation and website slug disagree", () => {
    expect(decomposeCdmrpFon("HT942526ORPARA")).toMatchObject({ program: "ORP", mechanism: "ARA", programName: "Orthopaedic Research Program" });
    expect(decomposeCdmrpFon("HT942526ORPCRA")).toMatchObject({ program: "ORP", mechanism: "CRA" });
  });

  it("reports the standing DHA Broad Agency Announcement as one, rather than inventing a mechanism", () => {
    expect(decomposeCdmrpFon("HT942523SBAA1")).toMatchObject({
      office: "HT9425",
      fy: "23",
      tail: "SBAA1",
      program: null,
      mechanism: null,
      kind: "broad_agency_announcement",
    });
  });

  it("still cuts office and fiscal year off the pre-FY23 dashed numbers", () => {
    expect(decomposeCdmrpFon("W81XWH-22-DHAPP")).toMatchObject({ office: "W81XWH", fy: "22", fiscalYear: 2022, tail: "DHAPP", program: null, kind: "other" });
    expect(decomposeCdmrpFon("HT9425-23-S-SOC1")).toMatchObject({ office: "HT9425", fy: "23", tail: "S-SOC1", program: null, kind: "other" });
  });

  it("never throws, and never guesses a mechanism it cannot justify", () => {
    for (const junk of ["", null, undefined, "not-a-fon", "HT9425", "HT94252699999"]) {
      const f = decomposeCdmrpFon(junk);
      expect(f.mechanism == null || f.program != null).toBe(true);
    }
  });

  it("is case- and whitespace-insensitive", () => {
    expect(decomposeCdmrpFon("  ht942526scirptra ")).toMatchObject({ fon: "HT942526SCIRPTRA", program: "SCIRP", mechanism: "TRA" });
  });

  /** The acceptance bar, pinned: ≥ 95 % of the 81 open rows, zero unmatched mechanisms. */
  it("decomposes 78 of the 81 open rows, and every matched program leaves a mechanism", () => {
    const all = [...FON_TAILS, ...NON_MODERN];
    expect(all).toHaveLength(81);
    const decomposed = all.map(decomposeCdmrpFon).filter((f) => f.program && f.mechanism);
    expect(decomposed).toHaveLength(78);
    expect(decomposed.length / all.length).toBeGreaterThanOrEqual(0.95);
    // "Zero unmatched mechanisms": no row is left with a program but no
    // mechanism, and no mechanism contains anything but letters and digits.
    for (const f of all.map(decomposeCdmrpFon)) {
      if (f.program) expect(f.mechanism).toMatch(/^[A-Z]+\d*$/);
    }
  });

  it("leaves exactly the three rows that carry no CDMRP program", () => {
    const unmatched = [...FON_TAILS, ...NON_MODERN].map(decomposeCdmrpFon).filter((f) => !f.program);
    expect(unmatched.map((f) => f.fon).sort()).toEqual(["HT9425-23-S-SOC1", "HT942523SBAA1", "W81XWH-22-DHAPP"]);
  });
});

describe("matchProgram", () => {
  it("takes the longest published abbreviation, so a shorter one can never eat a longer program", () => {
    expect(matchProgram("PCARPIDA")).toBe("PCARP");
    expect(matchProgram("PCRPIDA")).toBe("PCRP");
    expect(matchProgram("PRMRPCTA")).toBe("PRMRP");
    expect(matchProgram("PRPIIRA")).toBe("PRP");
    expect(matchProgram("PRCRPIA")).toBe("PRCRP");
    expect(matchProgram("TBIPHRPCTA")).toBe("TBIPHRP");
    expect(matchProgram("ZZZZ")).toBeNull();
  });

  it("has no duplicate abbreviations in the seeded list", () => {
    const abbrs = CDMRP_PROGRAMS.map(([a]) => a);
    expect(new Set(abbrs).size).toBe(abbrs.length);
    for (const [abbr] of CDMRP_PROGRAMS) expect(abbr).toMatch(/^[A-Z]{2,8}$/);
  });
});

describe("cdmrpProgramAnnouncementUrl", () => {
  it("is the route NON_NIH_INVENTORY § 5c measured", () => {
    expect(cdmrpProgramAnnouncementUrl("HT942526PRMRPCTA")).toBe("https://cdmrp.health.mil/funding/pa/HT942526PRMRPCTA_GG.pdf");
  });
});

// ---------------------------------------------------------------------------
// The Program Announcement itself
// ---------------------------------------------------------------------------

describe("the CDMRP heading table on a real Program Announcement", () => {
  const lines = fixture("HT942526BCRPBTA122.pa.txt");

  it("picks the CDMRP table and recovers the Program Description as objectives", () => {
    const doc = sectionCdmrpDocument(lines)!;
    expect(doc.table).toBe("cdmrp_pa");
    expect(hasObjectives(doc.sections)).toBe(true);
    const objectives = doc.sections.find((s) => s.roles?.includes("objectives"))!;
    expect(objectives.heading).toBe("3. Program Description");
    // The mission and the overarching challenges — the paradigm text the whole
    // PR exists to reach. Asserted on single lines: `linesToText` joins with
    // "\n", so a sentence the PDF wrapped is not one string here.
    expect(objectives.text).toContain("The BCRP challenges the scientific community");
    expect(objectives.text).toContain("• Prevent breast cancer (primary prevention)");
    expect(objectives.text).toContain("• Distinguish deadly from non-deadly breast cancers");
    expect(objectives.text.length).toBeGreaterThan(5_000);
  });

  it("recovers the five roles a CDMRP PA carries, and no section is empty", () => {
    const doc = sectionCdmrpDocument(lines)!;
    expect(doc.roles).toEqual(["award_info", "eligibility", "objectives", "other", "review"]);
    expect(doc.sections.length).toBeGreaterThanOrEqual(10);
    for (const s of doc.sections) expect(s.text.length).toBeGreaterThan(0);
  });

  /**
   * A CDMRP PA prints `Basic Information | Eligibility | Program Description |
   * …` on every page and again in the contents. Neither may open a section, or
   * the objectives block would be the two-line contents blurb.
   */
  it("is not fooled by the nav ribbon or the contents page", () => {
    const doc = sectionCdmrpDocument(lines)!;
    const ids = doc.sections.map((s) => s.section);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of doc.sections) expect(s.heading).not.toContain("|");
  });

  it("reads the cover page — the funder's own name for the mechanism the suffix encodes", () => {
    expect(parseCdmrpCoverPage(lines)).toEqual({
      fon: "HT942526BCRPBTA122",
      programName: "Breast Cancer Research Program",
      awardName: "Breakthrough Award Levels 1 and 2",
    });
  });

  /**
   * The one row in 81 that PR 5.3's table alone read wrongly. Joint Warfighter
   * publishes a Broad Agency Announcement: the same nine numbered blocks, but
   * `4. Application/Proposal Contents and Format` and `6. Review Information`.
   * With only PR 5.3's spellings the CDMRP table named three blocks and HHS's
   * table won with four contents-page entries, so the stored `objectives` was
   * the table-of-contents blurb.
   */
  describe("the Joint Warfighter Broad Agency Announcement", () => {
    const baa = fixture("HT942526JWMRPMMRDA.baa.txt");

    it("sections under the CDMRP table, not HHS's, and its objectives is the body not the contents blurb", () => {
      const doc = sectionCdmrpDocument(baa)!;
      expect(doc.table).toBe("cdmrp_pa");
      const objectives = doc.sections.find((s) => s.roles?.includes("objectives"))!;
      expect(objectives.heading).toBe("3. Program Description");
      expect(objectives.text).toContain("The Defense Health Agency Contracting Activity (DHACA)");
      expect(objectives.text).not.toContain("Describes the program mission and intent");
      expect(objectives.text.length).toBeGreaterThan(10_000);
    });

    it("names the two blocks the BAA spells differently", () => {
      const doc = sectionCdmrpDocument(baa)!;
      const byId = new Map(doc.sections.map((s) => [s.section, s]));
      expect(byId.get("cdmrp.4")!.heading).toBe("4. Application/Proposal Contents and Format");
      expect(byId.get("cdmrp.6")!.heading).toBe("6. Review Information");
      expect(byId.get("cdmrp.6")!.roles).toEqual(["review"]);
      expect(doc.roles).toEqual(["award_info", "eligibility", "objectives", "other", "review"]);
    });

    /** Its cover page wraps both names across lines, which is why the parser rejoins before it cuts. */
    it("still reads its wrapped cover page", () => {
      expect(parseCdmrpCoverPage(baa)).toEqual({
        fon: "HT942526JWMRPMMRDA",
        programName: "Joint Warfighter Medical Research Program",
        awardName: "Military Medical Research and Development Award",
      });
    });
  });

  it("reads PR 5.3's SCIRP announcement the same way", () => {
    const scirp = fixture("HT942526SCIRPTRA.pa.txt");
    expect(parseCdmrpCoverPage(scirp)).toEqual({
      fon: "HT942526SCIRPTRA",
      programName: "Spinal Cord Injury Research Program",
      awardName: "Translational Research Award",
    });
    expect(sectionCdmrpDocument(scirp)!.table).toBe("cdmrp_pa");
  });

  it("returns nulls rather than guessing when there is no cover page", () => {
    expect(parseCdmrpCoverPage(["a", "b", "c"])).toEqual({ fon: null, programName: null, awardName: null });
  });
});

// ---------------------------------------------------------------------------
// acquire(): the direct route, the mirror fallback, and D69's statuses
// ---------------------------------------------------------------------------

const ROW: GrantsGovRow = {
  id: "id-1",
  opportunity_number: "HT942526BCRPBTA122",
  agency_code: "DOD-AMRAA",
  source_opportunity_id: "uuid-1",
  forecasted: false,
  raw_payload_json: { legacy_opportunity_id: 1 },
};

const PA_HTML =
  "<p>Program Announcement for the Defense Health Agency</p><p>Breast Cancer Research Program</p><p>Breakthrough Award Levels 1 and 2</p>" +
  "<p>Funding Opportunity Number: HT942526BCRPBTA122</p>" +
  "<p>1. Basic Information About the Funding Opportunity</p><p>$145M in FY26.</p>" +
  "<p>2. Eligibility Information</p><p>Independent investigators at any level.</p>" +
  "<p>3. Program Description</p><p>The BCRP seeks to end breast cancer.</p>";

const doc = (body: string) => ({ status: "ok" as const, url: "u", bytes: new TextEncoder().encode(body), contentType: "text/html" });

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

describe("appliesToCdmrpPa", () => {
  it("takes every posted DOD-AMRAA row, including the ones with no Grants.gov attachment", () => {
    expect(appliesToCdmrpPa(ROW)).toBe(true);
    expect(appliesToCdmrpPa({ ...ROW, raw_payload_json: null, source_opportunity_id: null })).toBe(true);
    expect(appliesToCdmrpPa({ ...ROW, agency_code: null, opportunity_number: "W81XWH-22-DHAPP" })).toBe(true);
  });

  it("takes no forecast and no other family", () => {
    expect(appliesToCdmrpPa({ ...ROW, forecasted: true })).toBe(false);
    expect(appliesToCdmrpPa({ ...ROW, agency_code: "USDA-NIFA", opportunity_number: "X-1" })).toBe(false);
  });
});

describe("acquireCdmrpPa", () => {
  it("reads the derived _GG.pdf first, on the CDMRP host, and never touches the mirror when it works", async () => {
    const hosts: string[] = [];
    const urls: string[] = [];
    let legacyCalls = 0;
    const acq = await acquireCdmrpPa(ROW, deps({
      limiterFor: (host) => (hosts.push(host), new AsyncRateLimiter(0)),
      fetchDocument: async (url) => (urls.push(url), doc(PA_HTML)),
      fetchLegacyDetails: async () => (legacyCalls += 1, null),
    }));
    expect(acq.status).toBe("ok");
    expect(urls).toEqual(["https://cdmrp.health.mil/funding/pa/HT942526BCRPBTA122_GG.pdf"]);
    expect(hosts).toEqual([CDMRP_HOST]);
    expect(legacyCalls).toBe(0);
    expect(acq.pageFetches).toBe(1);
    expect(acq.simplerCalls).toBe(0);
    expect(acq.status === "ok" && acq.source).toBe("cdmrp_pa");
    const extra = acq.extra as unknown as CdmrpExtra;
    expect(extra.route).toBe("direct");
    expect(extra.direct).toBe("ok");
    expect(extra.fon.mechanismBase).toBe("BTA");
    expect(extra.cover?.awardName).toBe("Breakthrough Award Levels 1 and 2");
    expect(extra.objectives).toContain("end breast cancer");
  });

  it("falls through to the Simpler / Grants.gov mirror when the direct route 404s", async () => {
    const acq = await acquireCdmrpPa(ROW, deps({
      fetchDocument: async (url) => (url.includes(CDMRP_HOST) ? { status: "not_found", url } : doc(PA_HTML)),
      fetchLegacyDetails: async () => ({
        legacyOpportunityId: 1,
        opportunityNumber: "HT942526BCRPBTA122",
        assistUrl: null,
        assistCompatible: false,
        workspaceCompatible: false,
        attachments: [{ id: 9, fileName: "HT942526BCRPBTA122_GG.pdf", mimeType: "text/html", fileSizeBytes: 100, folderType: "Full Announcement" }],
        packageIds: [],
      }),
    }));
    expect(acq.status).toBe("ok");
    const extra = acq.extra as unknown as CdmrpExtra;
    expect(extra.direct).toBe("not_found");
    expect(extra.route).toBe("mirror");
    expect(extra.mirror?.chosen?.fileName).toBe("HT942526BCRPBTA122_GG.pdf");
    expect(acq.pageFetches).toBe(2);
  });

  /**
   * The URL is derived, so a wrong document is a silent data-corruption bug:
   * the wrong programme's objectives stored against this notice. The cover
   * page's own FON is the guard.
   */
  it("refuses a PA whose cover page names a different notice", async () => {
    const acq = await acquireCdmrpPa(ROW, deps({
      fetchDocument: async (url) =>
        url.includes(CDMRP_HOST) ? doc(PA_HTML.replace("HT942526BCRPBTA122</p>", "HT942526VRPTRA</p>")) : { status: "not_found", url },
    }));
    expect(acq.status).toBe("error");
    expect(acq).not.toHaveProperty("sections");
    const extra = acq.extra as unknown as CdmrpExtra;
    expect(extra.fonMismatch).toBe("HT942526VRPTRA");
    expect(extra.route).toBeNull();
  });

  it("refuses a document that sections but carries no objectives block (D69)", async () => {
    const acq = await acquireCdmrpPa(ROW, deps({
      fetchDocument: async (url) =>
        url.includes(CDMRP_HOST)
          ? doc("<p>Funding Opportunity Number: HT942526BCRPBTA122</p><p>2. Eligibility Information</p><p>Anyone.</p>")
          : { status: "not_found", url },
    }));
    expect(acq.status).toBe("error");
    expect(acq).not.toHaveProperty("sections");
    expect(acq).not.toHaveProperty("textHash");
    expect((acq.extra as unknown as CdmrpExtra).direct).toBe("no_objectives");
  });

  it("is not_found when the direct route 404s and the mirror has nothing to read either", async () => {
    const acq = await acquireCdmrpPa(ROW, deps({ fetchLegacyDetails: async () => null }));
    expect(acq.status).toBe("not_found");
    const extra = acq.extra as unknown as CdmrpExtra;
    expect(extra.direct).toBe("not_found");
    expect(extra.mirror?.considered).toEqual([]);
  });

  it("does not derive a URL for a number that is not the FY23+ program shape", async () => {
    const urls: string[] = [];
    const acq = await acquireCdmrpPa({ ...ROW, opportunity_number: "W81XWH-22-DHAPP" }, deps({
      fetchDocument: async (url) => (urls.push(url), { status: "not_found", url }),
    }));
    expect(urls.every((u) => !u.includes(CDMRP_HOST))).toBe(true);
    const extra = acq.extra as unknown as CdmrpExtra;
    expect(extra.directUrl).toBeNull();
    expect(extra.direct).toBe("skipped");
    // No candidate anywhere: structural, not a failure to retry.
    expect(acq.status).toBe("not_applicable");
  });

  it("reports a transport failure on the direct route as an error, not a 404", async () => {
    const acq = await acquireCdmrpPa(ROW, deps({
      fetchDocument: async (url) => (url.includes(CDMRP_HOST) ? { status: "error", url, error: "socket hang up" } : { status: "not_found", url }),
    }));
    expect(acq.status).toBe("error");
    expect((acq.extra as unknown as CdmrpExtra).direct).toBe("error");
    expect(acq.status === "error" && acq.error).toContain("socket hang up");
  });

  /**
   * A PA must section identically whichever route answered it, or the same
   * notice carries different `guide_sections` depending on which route happened
   * to work that day. The mirror is PR 5.3's adapter, so this PR passes the
   * CDMRP tables through to it; the A/B below is what that buys.
   */
  describe("the mirror gets the CDMRP heading tables", () => {
    const BAA_MIRROR_HTML =
      "<p>Funding Opportunity Number: HT942526BCRPBTA122</p><p>Content</p>" +
      "<p>Basic Information</p><p>Summarizes the funding opportunity and deadlines</p>" +
      "<p>Eligibility</p><p>Details eligibility factors for the applicant organization</p>" +
      "<p>Program Description</p><p>Describes the program mission and intent of the award; and outlines</p><p>funding details</p>" +
      "<p>1. Basic Information About the Funding Opportunity</p><p>Summary: the FY26 award.</p>" +
      "<p>2. Eligibility Information</p><p>Independent investigators at any level.</p>" +
      "<p>3. Program Description</p><p>The Defense Health Agency Contracting Activity (DHACA) is soliciting applications/proposals.</p>" +
      "<p>4. Application/Proposal Contents and Format</p><p>A two-step process.</p>" +
      "<p>6. Review Information</p><p>Peer review and programmatic review.</p>";

    const legacy = async () => ({
      legacyOpportunityId: 1,
      opportunityNumber: "HT942526BCRPBTA122",
      assistUrl: null,
      assistCompatible: false,
      workspaceCompatible: false,
      attachments: [{ id: 9, fileName: "HT942526BCRPBTA122_GG.pdf", mimeType: "text/html", fileSizeBytes: 100, folderType: "Full Announcement" }],
      packageIds: [],
    });

    const mirrorDeps = deps({
      fetchDocument: async (url) => (url.includes(CDMRP_HOST) ? { status: "not_found", url } : doc(BAA_MIRROR_HTML)),
      fetchLegacyDetails: legacy,
    });

    it("without them, PR 5.3's default tables store the contents-page blurb as objectives", async () => {
      const acq = await acquireGrantsGovAttachment(ROW, deps({ fetchDocument: async () => doc(BAA_MIRROR_HTML), fetchLegacyDetails: legacy }));
      const extra = acq.extra as unknown as GrantsGovExtra;
      expect(extra.table).toBe("simplified_nofo");
      expect(extra.objectives).toContain("Describes the program mission and intent");
    });

    it("with them, the same document sections under the CDMRP table and keeps the body", async () => {
      const acq = await acquireCdmrpPa(ROW, mirrorDeps);
      expect(acq.status).toBe("ok");
      const extra = acq.extra as unknown as CdmrpExtra;
      expect(extra.route).toBe("mirror");
      expect(extra.table).toBe("cdmrp_pa");
      expect(extra.objectives).toContain("Defense Health Agency Contracting Activity");
      expect(extra.objectives).not.toContain("Describes the program mission and intent");
    });

    it("leads with the CDMRP table and keeps the two federal ones behind it", () => {
      expect(CDMRP_HEADING_TABLES.map((t) => t.id)).toEqual(["cdmrp_pa", "federal_nofo", "simplified_nofo"]);
      expect(CDMRP_PA_HEADINGS_ALL.length).toBeGreaterThan(CDMRP_PA_HEADINGS.length);
    });
  });

  it("asks for at least a one-second gap on the .mil host", () => {
    expect(CDMRP_MIN_INTERVAL_MS).toBeGreaterThanOrEqual(1_000);
  });
});
