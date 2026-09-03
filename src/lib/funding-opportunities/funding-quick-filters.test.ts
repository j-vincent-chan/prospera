import { describe, expect, it } from "vitest";
import {
  applyFundingQuickFilters,
  isFundingListQuickFilterTab,
  quickFiltersFromSearchParams,
} from "./funding-quick-filters";
import { buildNextFundingListState } from "@/lib/funding-opportunities/funding-list-navigate";
import { fundingListHref, searchParamsToFundingListState, defaultFundingListClientState, isNihDepartmentFilterActive, nihDepartmentFilterPatch, quickFilterSidebarResetPatch } from "./funding-list-url";

describe("quickFiltersFromSearchParams", () => {
  it("parses a single tab param", () => {
    expect(quickFiltersFromSearchParams({ tab: "esi_career" })).toEqual(["esi_career"]);
  });

  it("parses stacked tab params", () => {
    expect(
      quickFiltersFromSearchParams({ tab: ["esi_career", "large_awards", "esi_career"] })
    ).toEqual(["esi_career", "large_awards"]);
  });

  it("ignores all and unknown tabs", () => {
    expect(quickFiltersFromSearchParams({ tab: ["all", "nope", "saved"] })).toEqual([]);
  });
});

describe("fundingListHref stacked tabs", () => {
  it("serializes multiple tab params", () => {
    const href = fundingListHref({
      q: "",
      scope: "all",
      tabs: ["esi_career", "investigator_initiated"],
      sort: "posted_date",
      order: "desc",
      page: 1,
      perPage: 50,
      departments: ["hhs"],
      departmentSubs: { hhs: ["nih"] },
      legacyAgencies: [],
      allDepartments: false,
      rd: {
        activityFamilies: [],
        clinicalTrialMode: null,
        nihIc: [],
        announcement: [],
        pathway: [],
        investigatorTags: [],
        mechanismTypes: [],
        collaborations: [],
        humanSubjects: [],
      },
    });
    expect(href).toContain("tab=esi_career");
    expect(href).toContain("tab=investigator_initiated");
  });

  it("round-trips stacked tabs through searchParamsToFundingListState", () => {
    const href =
      "/funding-opportunities?scope=all&sort=posted_date&order=desc&tab=esi_career&tab=closing_soon&closing_days=60&dept=hhs&sub=hhs:nih";
    const query = href.split("?")[1] ?? "";
    const params = new URLSearchParams(query);
    const record: Record<string, string | string[]> = {};
    for (const key of new Set(params.keys())) {
      const all = params.getAll(key);
      record[key] = all.length === 1 ? all[0]! : all;
    }
    const state = searchParamsToFundingListState(record);
    expect(state.tabs).toEqual(["esi_career", "closing_soon"]);
    expect(state.closingDays).toBe(60);
  });

  it("round-trips last_updated tab with updated_days", () => {
    const href = fundingListHref({
      q: "",
      scope: "all",
      tabs: ["last_updated"],
      updatedDays: 30,
      sort: "posted_date",
      order: "desc",
      page: 1,
      perPage: 50,
      departments: ["hhs"],
      departmentSubs: { hhs: ["nih"] },
      legacyAgencies: [],
      allDepartments: false,
      rd: {
        activityFamilies: [],
        clinicalTrialMode: null,
        nihIc: [],
        announcement: [],
        pathway: [],
        investigatorTags: [],
        mechanismTypes: [],
        collaborations: [],
        humanSubjects: [],
      },
    });
    expect(href).toContain("tab=last_updated");
    expect(href).toContain("updated_days=30");
    const query = href.split("?")[1] ?? "";
    const params = new URLSearchParams(query);
    const record: Record<string, string | string[]> = {};
    for (const key of new Set(params.keys())) {
      const all = params.getAll(key);
      record[key] = all.length === 1 ? all[0]! : all;
    }
    const state = searchParamsToFundingListState(record);
    expect(state.tabs).toEqual(["last_updated"]);
    expect(state.updatedDays).toBe(30);
  });
});

describe("applyFundingQuickFilters", () => {
  const today = new Date(new Date().toDateString());
  const inDays = (iso: string | null, days: number) => {
    if (!iso) return false;
    const d = new Date(iso);
    const end = new Date(today.getTime() + days * 24 * 60 * 60 * 1000);
    return d >= today && d <= end;
  };
  const postedWithinDays = () => true;

  it("AND-combines stacked filters", () => {
    const rows = [
      { title: "K99 Pathway award", funding_instrument: "K99", close_date: "2099-01-01", posted_date: null, agency: null, agency_code: null, status: "open", forecasted: false },
      { title: "R01 research project", funding_instrument: "R01", close_date: "2099-01-01", posted_date: null, agency: null, agency_code: null, status: "open", forecasted: false },
    ];
    const result = applyFundingQuickFilters(rows, ["esi_career", "investigator_initiated"], {
      today,
      inDays,
      postedWithinDays,
      closingDays: 30,
      postedDays: 7,
      updatedDays: 7,
    });
    expect(result).toHaveLength(0);
    expect(applyFundingQuickFilters(rows, ["esi_career"], { today, inDays, postedWithinDays, closingDays: 30, postedDays: 7, updatedDays: 7 })).toHaveLength(1);
  });
});

describe("defaultFundingListClientState", () => {
  it("defaults departments and agencies to All", () => {
    const state = defaultFundingListClientState();
    expect(state.allDepartments).toBe(true);
    expect(state.departments).toEqual([]);
    expect(state.departmentSubs).toEqual({});
    expect(fundingListHref(state)).toContain("dept=all");
  });
});

describe("nih quick filter tab", () => {
  it("selects DHHS with NIH and round-trips tab=nih", () => {
    const href = fundingListHref({
      ...defaultFundingListClientState(),
      tabs: ["nih", "esi_career"],
      ...nihDepartmentFilterPatch(),
    });
    expect(href).toContain("tab=nih");
    expect(href).toContain("tab=esi_career");
    expect(href).toContain("dept=hhs");
    expect(href).toContain("sub=hhs%3Anih");
    const query = href.split("?")[1] ?? "";
    const state = searchParamsToFundingListState(
      Object.fromEntries(new URLSearchParams(query))
    );
    expect(state.tabs).toEqual(["nih", "esi_career"]);
    expect(isNihDepartmentFilterActive(state)).toBe(true);
  });

  it("preserves NIH departments when sidebar resets with nih tab stacked", () => {
    const patch = quickFilterSidebarResetPatch(["nih", "closing_soon"]);
    expect(patch).toMatchObject(nihDepartmentFilterPatch());
  });

  it("stacks NIH with new this week in the navigated URL", () => {
    const nihState = buildNextFundingListState(
      defaultFundingListClientState(),
      { tabs: ["nih"], ...nihDepartmentFilterPatch() }
    );
    const stacked = buildNextFundingListState(
      nihState,
      { tabs: ["nih", "new_this_week"], postedDays: 7 },
      { resetSidebar: true }
    );
    const href = fundingListHref(stacked);
    expect(href).toContain("tab=nih");
    expect(href).toContain("tab=new_this_week");
    expect(href).toContain("posted_days=7");
    expect(href).toContain("dept=hhs");
    const state = searchParamsToFundingListState(
      Object.fromEntries(new URLSearchParams(href.split("?")[1] ?? ""))
    );
    expect(state.tabs).toEqual(["nih", "new_this_week"]);
    expect(state.postedDays).toBe(7);
    expect(isNihDepartmentFilterActive(state)).toBe(true);
  });
});

describe("isFundingListQuickFilterTab", () => {
  it("accepts stackable tabs only", () => {
    expect(isFundingListQuickFilterTab("esi_career")).toBe(true);
    expect(isFundingListQuickFilterTab("nih")).toBe(true);
    expect(isFundingListQuickFilterTab("all")).toBe(false);
    expect(isFundingListQuickFilterTab("immunology_translational")).toBe(false);
  });
});
