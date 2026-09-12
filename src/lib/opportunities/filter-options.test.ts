import { describe, expect, it } from "vitest";
import { applyFilterOption, filterGroupSummary, isFilterOptionOn } from "./filter-options";
import { opportunitiesHref, parseOpportunitiesState } from "./list-state";

const empty = parseOpportunitiesState({});

describe("applyFilterOption", () => {
  it("toggles a department on and off, dropping its sub-agencies when it goes off", () => {
    const on = applyFilterOption(empty, "dept", "hhs");
    expect(on.list.departments).toEqual(["hhs"]);
    expect(isFilterOptionOn(on, "dept", "hhs")).toBe(true);
    const withSub = { ...on, list: { ...on.list, departmentSubs: { hhs: ["nih"] } } };
    const off = applyFilterOption(withSub, "dept", "hhs");
    expect(off.list.departments).toEqual([]);
    expect(off.list.departmentSubs).toEqual({});
    expect(off.list.allDepartments).toBe(true);
    expect(isFilterOptionOn(off, "dept", "hhs")).toBe(false);
  });

  it("stacks multi-select groups and treats clinical trial as a single choice", () => {
    let s = applyFilterOption(empty, "ic", "NCI");
    s = applyFilterOption(s, "ic", "NHLBI");
    expect(s.list.rd.nihIc).toEqual(["NCI", "NHLBI"]);
    s = applyFilterOption(s, "activity", "R");
    s = applyFilterOption(s, "inv", "new_investigator");
    s = applyFilterOption(s, "collab", "multi_pi");
    expect(s.list.rd.activityFamilies).toEqual(["R"]);
    expect(s.list.rd.investigatorTags).toEqual(["new_investigator"]);
    expect(s.list.rd.collaborations).toEqual(["multi_pi"]);
    s = applyFilterOption(s, "trial", "required");
    expect(s.list.rd.clinicalTrialMode).toBe("required");
    s = applyFilterOption(s, "trial", "allowed");
    expect(s.list.rd.clinicalTrialMode).toBe("allowed");
    s = applyFilterOption(s, "trial", "allowed");
    expect(s.list.rd.clinicalTrialMode).toBeNull();
  });

  it("a second toggle before the first response builds on the first, and the URL round-trips", () => {
    const twice = applyFilterOption(applyFilterOption(empty, "ic", "NCI"), "activity", "K");
    const href = opportunitiesHref(twice);
    const sp: Record<string, string | string[]> = {};
    for (const [k, v] of new URL(href, "http://x").searchParams) {
      const prev = sp[k];
      sp[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
    }
    const back = parseOpportunitiesState(sp);
    expect(back.list.rd.nihIc).toEqual(["NCI"]);
    expect(back.list.rd.activityFamilies).toEqual(["K"]);
    expect(isFilterOptionOn(back, "ic", "NCI")).toBe(true);
    expect(isFilterOptionOn(back, "activity", "K")).toBe(true);
  });
});

describe("filterGroupSummary", () => {
  it("says Any, lists up to two, then counts", () => {
    expect(filterGroupSummary([{ label: "A", on: false }])).toBe("Any");
    expect(filterGroupSummary([{ label: "A", on: true }, { label: "B", on: true }, { label: "C", on: false }])).toBe("A, B");
    expect(filterGroupSummary([{ label: "A", on: true }, { label: "B", on: true }, { label: "C", on: true }])).toBe("3 selected");
  });
});
