import { describe, expect, it } from "vitest";
import {
  defaultFundingListClientState,
  deactivateSavedSearchHrefForState,
  fundingListCoreState,
  fundingListHref,
  mergeFundingListLayers,
  parseFundingListHref,
  rememberSavedSearchRestorePoint,
  readSavedSearchRestorePoint,
  clearSavedSearchRestorePoint,
  type FundingListClientState,
} from "./funding-list-url";
import {
  isSavedSearchEngaged,
  savedSearchMatchesCurrentState,
  savedSearchStillActive,
} from "./saved-funding-list-state";
import { parseRdListFilters } from "./rd-list-filters";

const emptyRd = parseRdListFilters({});

function baseState(): FundingListClientState {
  return {
    q: "cancer",
    scope: "all",
    tabs: [],
    sort: "posted_date",
    order: "desc",
    page: 1,
    perPage: 50,
    departments: ["hhs"],
    departmentSubs: { hhs: ["nih"] },
    legacyAgencies: [],
    allDepartments: false,
    noDepartmentsSelected: false,
    rd: emptyRd,
  };
}

describe("savedSearchStillActive", () => {
  it("stays active when extra quick filters are stacked on a saved search", () => {
    const saved = baseState();
    const href = fundingListHref(saved);
    const current: FundingListClientState = { ...saved, tabs: ["esi_career"] };

    expect(savedSearchMatchesCurrentState(current, href)).toBe(false);
    expect(savedSearchStillActive(current, href)).toBe(true);
  });

  it("stays active via saved-search URL pin even when sidebar filters were reset", () => {
    // Only whitelisted activity families survive the href round-trip, so use a real one.
    const saved: FundingListClientState = {
      ...baseState(),
      rd: { ...emptyRd, activityFamilies: ["K"] },
    };
    const href = fundingListHref(saved);
    const cancerId = "11111111-1111-4111-8111-111111111111";
    const current: FundingListClientState = {
      ...baseState(),
      tabs: ["esi_career"],
      savedSearchId: cancerId,
      rd: emptyRd,
    };

    expect(savedSearchStillActive(current, href)).toBe(false);
    expect(savedSearchStillActive(current, href, cancerId)).toBe(true);
  });

  it("is inactive when core filters diverge from the saved search", () => {
    const saved = baseState();
    const href = fundingListHref(saved);
    const current = { ...saved, q: "genomics" };

    expect(savedSearchStillActive(current, href)).toBe(false);
  });

  it("is inactive when a saved quick filter tab is removed", () => {
    const saved: FundingListClientState = { ...baseState(), tabs: ["esi_career"] };
    const href = fundingListHref(saved);
    const current: FundingListClientState = { ...saved, tabs: [] };

    expect(savedSearchStillActive(current, href)).toBe(false);
  });

  it("keeps stacked quick filters when a saved search is deactivated", () => {
    const defaults = defaultFundingListClientState();
    rememberSavedSearchRestorePoint(fundingListHref(fundingListCoreState(defaults)));
    const cancer = { ...baseState(), q: "cancer" };
    const stacked = mergeFundingListLayers(
      fundingListCoreState(cancer),
      { tabs: ["esi_career"], closingDays: undefined, postedDays: undefined },
      "11111111-1111-4111-8111-111111111111"
    );
    const restoreHref = readSavedSearchRestorePoint();
    expect(restoreHref).toBeTruthy();
    const restored = deactivateSavedSearchHrefForState(stacked, restoreHref);
    const parsed = parseFundingListHref(restored);
    expect(parsed.q).toBe("");
    expect(parsed.tabs).toEqual(["esi_career"]);
    expect(parsed.savedSearchId).toBeNull();
    clearSavedSearchRestorePoint();
  });
});

describe("isSavedSearchEngaged", () => {
  it("stays engaged via loaded id when sidebar filters were reset by a quick filter", () => {
    const saved: FundingListClientState = {
      ...baseState(),
      rd: { ...emptyRd, activityFamilies: ["K"] },
    };
    const href = fundingListHref(saved);
    const cancerId = "11111111-1111-4111-8111-111111111111";
    const current: FundingListClientState = {
      ...baseState(),
      tabs: ["esi_career"],
      rd: emptyRd,
    };

    expect(savedSearchStillActive(current, href, cancerId)).toBe(false);
    expect(isSavedSearchEngaged(current, href, cancerId, cancerId)).toBe(true);
  });
});
