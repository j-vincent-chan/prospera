import { describe, expect, it, vi } from "vitest";
import {
  activityCodeOf,
  buildExemplarRequest,
  buildLineage,
  countDistinctCoreProjects,
  EXEMPLAR_CAP,
  EXEMPLAR_INCLUDE_FIELDS,
  exemplarFromProject,
  exemplarsDueFilter,
  fetchNoticeExemplars,
  formatNoticeResult,
  indexLineageRows,
  LINEAGE_MAX_STEPS,
  normalizeAnnouncementNumber,
  openNoticeFilter,
  parseExemplarPiNames,
  parseExemplarRcdc,
  parseExemplarStudySection,
  selectExemplars,
  type ExemplarContext,
  type LineageRow,
  type ReporterProject,
  type ReporterSearchBody,
} from "./exemplars";

// A record as RePORTER v2 returned it on 2026-09-05 for PAR-25-122 (include_fields trimmed to what the row stores).
const REAL_PROJECT: ReporterProject = {
  appl_id: 11439155,
  subproject_id: null,
  fiscal_year: 2026,
  project_num: "1R03TR006462-01",
  organization: { org_name: "UNIVERSITY OF FLORIDA", org_city: "GAINESVILLE", org_state: "FL" },
  award_type: "1",
  activity_code: "R03",
  principal_investigators: [{ profile_id: 12492357, first_name: "Meiyan", middle_name: "", last_name: "Jin", is_contact_pi: true, full_name: "Meiyan  Jin" }],
  opportunity_number: "PAR-25-122",
  full_study_section: { srg_code: "ZRG1", sra_designator_code: "BN", group_code: "92", name: "Special Emphasis Panel[ZRG1 BN-F (92)]" },
  core_project_num: "R03TR006462",
  abstract_text: "Project Summary/Abstract\n Many rare diseases result from single-gene mutations.",
  project_title: "Pilot Studies on SCYL2, an AMC-Associated Protein, in Endocytosis and Neuronal Development",
  spending_categories_desc: null,
};

const FETCHED_AT = "2026-09-05T12:00:00.000Z";

function ctxFor(lineage: string[], noticeNumber = lineage[0]!): ExemplarContext {
  return { noticeNumber, depthByNumber: new Map(lineage.map((n, i) => [n, i])), fetchedAt: FETCHED_AT };
}

function project(over: Partial<Record<string, unknown>>): ReporterProject {
  return { ...REAL_PROJECT, ...over };
}

describe("normalizeAnnouncementNumber", () => {
  it("accepts PA / PAR / RFA shapes, upper-cases and trims", () => {
    expect(normalizeAnnouncementNumber("PAR-25-122")).toBe("PAR-25-122");
    expect(normalizeAnnouncementNumber(" rfa-tr-22-030 ")).toBe("RFA-TR-22-030");
    expect(normalizeAnnouncementNumber("PA-20-185")).toBe("PA-20-185");
    expect(normalizeAnnouncementNumber("PAS-23-046")).toBe("PAS-23-046");
  });
  it("rejects Simpler ids, other agencies' numbers, null", () => {
    expect(normalizeAnnouncementNumber("DFOP0018683")).toBeNull();
    expect(normalizeAnnouncementNumber("HRSA-26-050")).toBeNull();
    expect(normalizeAnnouncementNumber("PA-FPH-27-001")).toBeNull();
    expect(normalizeAnnouncementNumber(null)).toBeNull();
    expect(normalizeAnnouncementNumber("")).toBeNull();
  });
});

describe("buildLineage", () => {
  const rows = (...list: LineageRow[]) => indexLineageRows(list);

  it("is the notice alone when reissue_of is null", () => {
    const l = buildLineage({ opportunity_number: "PAR-25-122", reissue_of: null }, rows());
    expect(l.numbers).toEqual(["PAR-25-122"]);
    expect(l.depthByNumber.get("PAR-25-122")).toBe(0);
    expect(l.missing).toEqual([]);
    expect(l.truncated).toBe(false);
  });

  it("includes a predecessor that has no row, and stops there", () => {
    const l = buildLineage({ opportunity_number: "PAR-25-122", reissue_of: "RFA-TR-22-030" }, rows());
    expect(l.numbers).toEqual(["PAR-25-122", "RFA-TR-22-030"]);
    expect(l.depthByNumber.get("RFA-TR-22-030")).toBe(1);
    expect(l.missing).toEqual(["RFA-TR-22-030"]);
  });

  it("follows reissue_of through the rows given", () => {
    const l = buildLineage(
      { opportunity_number: "PAR-25-001", reissue_of: "PAR-22-001" },
      rows({ opportunity_number: "PAR-22-001", reissue_of: "par-19-001" }, { opportunity_number: "PAR-19-001", reissue_of: null })
    );
    expect(l.numbers).toEqual(["PAR-25-001", "PAR-22-001", "PAR-19-001"]);
    expect(l.depthByNumber.get("PAR-19-001")).toBe(2);
    expect(l.missing).toEqual([]);
    expect(l.truncated).toBe(false);
  });

  it(`walks at most ${LINEAGE_MAX_STEPS} steps and reports truncation`, () => {
    const chain: LineageRow[] = [];
    for (let i = 1; i <= 6; i += 1) chain.push({ opportunity_number: `PAR-${20 - i}-001`, reissue_of: `PAR-${19 - i}-001` });
    const l = buildLineage({ opportunity_number: "PAR-20-001", reissue_of: "PAR-19-001" }, rows(...chain));
    expect(l.numbers).toEqual(["PAR-20-001", "PAR-19-001", "PAR-18-001", "PAR-17-001", "PAR-16-001"]);
    expect(l.truncated).toBe(true);
    expect(buildLineage({ opportunity_number: "PAR-20-001", reissue_of: "PAR-19-001" }, rows(...chain), 1).numbers).toEqual(["PAR-20-001", "PAR-19-001"]);
  });

  it("stops on a cycle", () => {
    const l = buildLineage(
      { opportunity_number: "PAR-25-001", reissue_of: "PAR-22-001" },
      rows({ opportunity_number: "PAR-22-001", reissue_of: "PAR-25-001" })
    );
    expect(l.numbers).toEqual(["PAR-25-001", "PAR-22-001"]);
    expect(l.truncated).toBe(false);
  });

  it("is empty for a notice without an announcement number, and ignores a malformed reissue_of", () => {
    expect(buildLineage({ opportunity_number: "DFOP0018683", reissue_of: "PAR-22-001" }, rows()).numbers).toEqual([]);
    expect(buildLineage({ opportunity_number: "PAR-25-001", reissue_of: "see NOT-OD-24" }, rows()).numbers).toEqual(["PAR-25-001"]);
  });
});

describe("buildExemplarRequest", () => {
  it("asks for the lineage numbers, newest fiscal year first, subprojects excluded, only the stored fields", () => {
    const body = buildExemplarRequest(["PAR-25-122", "RFA-TR-22-030"], 100, 100);
    expect(body).toEqual({
      criteria: { opportunity_numbers: ["PAR-25-122", "RFA-TR-22-030"], exclude_subprojects: true },
      include_fields: [...EXEMPLAR_INCLUDE_FIELDS],
      offset: 100,
      limit: 100,
      sort_field: "fiscal_year",
      sort_order: "desc",
    });
    expect(body.include_fields).toContain("AbstractText");
    expect(body.include_fields).toContain("OpportunityNumber");
  });
});

describe("field parsers", () => {
  it("parseExemplarRcdc splits on ; and is null when RePORTER has none", () => {
    expect(parseExemplarRcdc("Cancer; Immunization;  Vaccine Related; Cancer")).toEqual(["Cancer", "Immunization", "Vaccine Related"]);
    expect(parseExemplarRcdc(null)).toBeNull();
    expect(parseExemplarRcdc("")).toBeNull();
  });
  it("parseExemplarStudySection strips the bracketed code and keeps srg_code", () => {
    expect(parseExemplarStudySection(REAL_PROJECT.full_study_section)).toEqual({ name: "Special Emphasis Panel", code: "ZRG1" });
    expect(parseExemplarStudySection({ name: "Immunobiology Study Section[IMB]" })).toEqual({ name: "Immunobiology Study Section", code: "IMB" });
    expect(parseExemplarStudySection(null)).toEqual({ name: null, code: null });
  });
  it("parseExemplarPiNames collapses whitespace, falls back to name parts, deduplicates", () => {
    expect(parseExemplarPiNames(REAL_PROJECT.principal_investigators)).toEqual(["Meiyan Jin"]);
    expect(parseExemplarPiNames([{ first_name: "Ada", last_name: "Lovelace" }, { full_name: "Ada  Lovelace" }])).toEqual(["Ada Lovelace"]);
    expect(parseExemplarPiNames(undefined)).toEqual([]);
  });
  it("activityCodeOf prefers RePORTER's field and parses DP2 / UG3 shapes from the number", () => {
    expect(activityCodeOf({ activity_code: "r03" }, "1R03TR006462-01")).toBe("R03");
    expect(activityCodeOf({}, "1DP2AI177915-01")).toBe("DP2");
    expect(activityCodeOf({}, "5UG3NS123456-02")).toBe("UG3");
    expect(activityCodeOf({}, "1R01AI024349-01A1")).toBe("R01");
  });
});

describe("exemplarFromProject", () => {
  it("maps a real record onto the row", () => {
    const row = exemplarFromProject(REAL_PROJECT, ctxFor(["PAR-25-122"]));
    expect(row).toEqual({
      opportunity_number: "PAR-25-122",
      project_num: "1R03TR006462-01",
      core_project_num: "R03TR006462",
      appl_id: 11439155,
      awarded_under: "PAR-25-122",
      lineage_depth: 0,
      fiscal_year: 2026,
      award_type: "1",
      title: "Pilot Studies on SCYL2, an AMC-Associated Protein, in Endocytosis and Neuronal Development",
      abstract: "Project Summary/Abstract\n Many rare diseases result from single-gene mutations.",
      activity_code: "R03",
      rcdc_categories: null,
      study_section: "Special Emphasis Panel",
      study_section_code: "ZRG1",
      pi_names: ["Meiyan Jin"],
      org_name: "UNIVERSITY OF FLORIDA",
      fetched_at: FETCHED_AT,
    });
  });

  it("records the predecessor it was awarded under with its depth", () => {
    const row = exemplarFromProject(project({ opportunity_number: "RFA-TR-22-030" }), ctxFor(["PAR-25-122", "RFA-TR-22-030"]));
    expect(row?.opportunity_number).toBe("PAR-25-122");
    expect(row?.awarded_under).toBe("RFA-TR-22-030");
    expect(row?.lineage_depth).toBe(1);
  });

  it("drops a record awarded under a number outside the lineage, or without a project number", () => {
    expect(exemplarFromProject(project({ opportunity_number: "PA-20-185" }), ctxFor(["PAR-25-122"]))).toBeNull();
    expect(exemplarFromProject(project({ opportunity_number: null }), ctxFor(["PAR-25-122"]))).toBeNull();
    expect(exemplarFromProject(project({ project_num: null, project_num_alias: null, core_project_num: null }), ctxFor(["PAR-25-122"]))).toBeNull();
  });

  it("derives the core number when RePORTER omits it", () => {
    expect(exemplarFromProject(project({ core_project_num: null, project_num: "5R01AI024349-32" }), ctxFor(["PAR-25-122"]))?.core_project_num).toBe("R01AI024349");
  });
});

describe("selectExemplars", () => {
  const ctx = ctxFor(["PAR-25-122", "RFA-TR-22-030"]);

  it("collapses a project's fiscal years onto its newest award", () => {
    const sel = selectExemplars(
      [
        project({ appl_id: 1, fiscal_year: 2024, project_num: "1R03TR001-01", core_project_num: "R03TR001", award_type: "1" }),
        project({ appl_id: 2, fiscal_year: 2025, project_num: "5R03TR001-02", core_project_num: "R03TR001", award_type: "5" }),
      ],
      ctx
    );
    expect(sel.rows.map((r) => r.project_num)).toEqual(["5R03TR001-02"]);
    expect(sel.rows[0]?.fiscal_year).toBe(2025);
    expect(sel).toMatchObject({ mapped: 2, dropped: 0, distinct: 1 });
  });

  it("prefers the parent award over its supplement in the same year", () => {
    const sel = selectExemplars(
      [
        project({ appl_id: 9, fiscal_year: 2025, project_num: "3R03TR001-02S1", core_project_num: "R03TR001", award_type: "3" }),
        project({ appl_id: 2, fiscal_year: 2025, project_num: "5R03TR001-02", core_project_num: "R03TR001", award_type: "5" }),
      ],
      ctx
    );
    expect(sel.rows.map((r) => r.project_num)).toEqual(["5R03TR001-02"]);
  });

  it("orders newest fiscal year first and caps", () => {
    const projects: ReporterProject[] = [];
    for (let i = 0; i < 70; i += 1) {
      projects.push(project({ appl_id: 1000 + i, fiscal_year: 2020 + (i % 7), project_num: `1R03TR${String(i).padStart(3, "0")}-01`, core_project_num: `R03TR${String(i).padStart(3, "0")}`, opportunity_number: i % 2 ? "RFA-TR-22-030" : "PAR-25-122" }));
    }
    const sel = selectExemplars(projects, ctx);
    expect(sel.rows).toHaveLength(EXEMPLAR_CAP);
    expect(sel.distinct).toBe(70);
    const years = sel.rows.map((r) => r.fiscal_year ?? 0);
    expect([...years].sort((a, b) => b - a)).toEqual(years);
    expect(sel.rows[0]?.fiscal_year).toBe(2026);
    expect(sel.rows.at(-1)?.fiscal_year).toBe(2021); // the 10 oldest (FY2020) fell to the cap
    expect(selectExemplars(projects, ctx, 5).rows).toHaveLength(5);
  });

  it("counts dropped records", () => {
    const sel = selectExemplars([project({ opportunity_number: "PA-20-185" }), REAL_PROJECT], ctx);
    expect(sel).toMatchObject({ mapped: 1, dropped: 1, distinct: 1 });
  });
});

describe("fetchNoticeExemplars", () => {
  const lineage = buildLineage({ opportunity_number: "PAR-25-122", reissue_of: "RFA-TR-22-030" }, new Map());
  const page = (n: number, from: number, under = "PAR-25-122"): ReporterProject[] =>
    Array.from({ length: n }, (_, i) => project({ appl_id: from + i, fiscal_year: 2026 - Math.floor((from + i) / 100), project_num: `1R03TR${String(from + i).padStart(5, "0")}-01`, core_project_num: `R03TR${String(from + i).padStart(5, "0")}`, opportunity_number: under }));

  it("makes one request when the first page is short, and reports totals, lineage split and years", async () => {
    const search = vi.fn(async (body: ReporterSearchBody) => ({ results: body.offset === 0 ? [...page(3, 0), ...page(2, 500, "RFA-TR-22-030")] : [], meta: { total: 5 } }));
    const r = await fetchNoticeExemplars({ noticeNumber: "PAR-25-122", lineage, search, fetchedAt: FETCHED_AT });
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0]?.[0].criteria.opportunity_numbers).toEqual(["PAR-25-122", "RFA-TR-22-030"]);
    expect(r.rows).toHaveLength(5);
    expect(r.apiTotal).toBe(5);
    expect(r.pages).toBe(1);
    expect(r.byAwardedUnder).toEqual([
      { number: "PAR-25-122", depth: 0, rows: 3 },
      { number: "RFA-TR-22-030", depth: 1, rows: 2 },
    ]);
    expect(r.fiscalYears).toEqual([2021, 2026]);
    expect(r.rows.every((row) => row.fetched_at === FETCHED_AT)).toBe(true);
  });

  it("pages until the cap's worth of distinct projects is in hand", async () => {
    // Every project appears twice (two fiscal years), so 100 rows = 50 projects: page 2 is needed, page 3 is not.
    const search = vi.fn(async (body: ReporterSearchBody) => {
      const base = body.offset / 2;
      const rows = Array.from({ length: 50 }, (_, i) => [
        project({ appl_id: 2 * (base + i) + 1, fiscal_year: 2026, project_num: `5R03TR${String(base + i).padStart(5, "0")}-02`, core_project_num: `R03TR${String(base + i).padStart(5, "0")}` }),
        project({ appl_id: 2 * (base + i), fiscal_year: 2025, project_num: `1R03TR${String(base + i).padStart(5, "0")}-01`, core_project_num: `R03TR${String(base + i).padStart(5, "0")}` }),
      ]).flat();
      return { results: rows, meta: { total: 100_000 } };
    });
    const r = await fetchNoticeExemplars({ noticeNumber: "PAR-25-122", lineage, search });
    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls[1]?.[0].offset).toBe(100);
    expect(r.pages).toBe(2);
    expect(r.received).toBe(200);
    expect(r.distinct).toBe(100);
    expect(r.rows).toHaveLength(EXEMPLAR_CAP);
    expect(r.rows.every((row) => row.project_num.startsWith("5"))).toBe(true);
  });

  it("stops at maxPages and at the API total", async () => {
    const search = vi.fn(async (body: ReporterSearchBody) => ({ results: page(100, body.offset).map((p) => ({ ...p, core_project_num: "R03TR00001" })), meta: { total: 100_000 } }));
    const r = await fetchNoticeExemplars({ noticeNumber: "PAR-25-122", lineage, search, maxPages: 2 });
    expect(search).toHaveBeenCalledTimes(2);
    expect(r.distinct).toBe(1);
    const search2 = vi.fn(async (body: ReporterSearchBody) => ({ results: page(100, body.offset), meta: { total: 100 } }));
    const r2 = await fetchNoticeExemplars({ noticeNumber: "PAR-25-122", lineage, search: search2, cap: 500 });
    expect(search2).toHaveBeenCalledTimes(1);
    expect(r2.rows).toHaveLength(100);
  });

  it("makes no request for a notice without an announcement number", async () => {
    const search = vi.fn(async () => ({ results: [] }));
    const r = await fetchNoticeExemplars({ noticeNumber: "DFOP0018683", lineage: buildLineage({ opportunity_number: "DFOP0018683", reissue_of: null }, new Map()), search });
    expect(search).not.toHaveBeenCalled();
    expect(r.rows).toEqual([]);
    expect(r.pages).toBe(0);
  });

  it("propagates an API failure without retrying", async () => {
    const search = vi.fn(async () => {
      throw new Error("RePORTER API 503: down");
    });
    await expect(fetchNoticeExemplars({ noticeNumber: "PAR-25-122", lineage, search })).rejects.toThrow("RePORTER API 503");
    expect(search).toHaveBeenCalledTimes(1);
  });
});

describe("countDistinctCoreProjects", () => {
  it("ignores records outside the lineage", () => {
    const depth = new Map([["PAR-25-122", 0]]);
    expect(countDistinctCoreProjects([REAL_PROJECT, project({ project_num: "5R03TR006462-02" }), project({ opportunity_number: "PA-20-185", core_project_num: "R01X" })], depth)).toBe(1);
  });
});

describe("predicates and printing", () => {
  it("exemplarsDueFilter: never fetched, older than 30 days, or an error older than 7 days", () => {
    const now = new Date("2026-09-05T00:00:00.000Z");
    expect(exemplarsDueFilter(now)).toBe(
      "exemplars_fetched_at.is.null,exemplars_fetched_at.lt.2026-08-06T00:00:00.000Z,and(exemplars_fetch_status.eq.error,exemplars_fetched_at.lt.2026-08-29T00:00:00.000Z)"
    );
    expect(openNoticeFilter("2026-09-05")).toBe("close_date.gte.2026-09-05,next_due.gte.2026-09-05,expiration_date.gte.2026-09-05");
  });

  it("formatNoticeResult is one line with counts, years and the lineage split", async () => {
    const lineage = buildLineage({ opportunity_number: "PAR-25-122", reissue_of: "RFA-TR-22-030" }, new Map());
    const r = await fetchNoticeExemplars({
      noticeNumber: "PAR-25-122",
      lineage,
      search: async () => ({ results: [REAL_PROJECT, project({ appl_id: 5, fiscal_year: 2024, project_num: "1R03TR000001-01", core_project_num: "R03TR000001", opportunity_number: "RFA-TR-22-030" })], meta: { total: 2 } }),
    });
    expect(formatNoticeResult(r)).toBe("PAR-25-122: 2 exemplars of 2 projects (2 award-years, 1 page) FY2024–2026 [PAR-25-122:1, RFA-TR-22-030:1] · lineage PAR-25-122 → RFA-TR-22-030");
  });
});
