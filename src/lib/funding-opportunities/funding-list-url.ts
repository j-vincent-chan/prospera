import type { DepartmentSubsSelection } from "@/lib/funding-opportunities/agency-filter";
import type { FundingListAgencySelection } from "@/lib/funding-opportunities/keyword-filter";
import { isKnownDepartmentId } from "@/lib/funding-opportunities/agency-taxonomy";
import { isKnownDepartmentSubId, normalizeDepartmentSubId } from "@/lib/funding-opportunities/department-subcomponents";
import {
  quickFiltersFromSearchParams,
  type FundingListQuickFilterTab,
} from "@/lib/funding-opportunities/funding-quick-filters";
import type { SearchParams } from "@/lib/funding-opportunities/rd-list-filters";
import {
  appendRdListFiltersToUrlSearchParams,
  parseRdListFilters,
  type RdListFilterState,
} from "@/lib/funding-opportunities/rd-list-filters";

/** URL param for Notion-style side peek panel on the funding list. */
export const FUNDING_PEEK_PARAM = "peek";

/** URL param pinning which saved search is active (chip highlight / context bar). */
export const FUNDING_SAVED_SEARCH_PARAM = "saved";

export function parseSavedSearchId(searchParams: SearchParams): string | null {
  const raw = firstStringParam(searchParams[FUNDING_SAVED_SEARCH_PARAM]).trim();
  if (!raw) return null;
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw);
  return uuid ? raw : null;
}

export function parsePeekOpportunityId(searchParams: SearchParams): string | null {
  const raw = firstStringParam(searchParams[FUNDING_PEEK_PARAM]).trim();
  if (!raw) return null;
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw);
  return uuid ? raw : null;
}

export type FundingListScope = "any" | "all" | "open" | "forecasted" | "closed";
export type ClosingSoonDays = 30 | 60 | 90;
export type PostedWithinDays = 7 | 30 | 90;
export type FundingListViewTab =
  | "all"
  | "recommended"
  | "closing_soon"
  | "new_this_week"
  | "last_updated"
  | "large_awards"
  | "esi_career"
  | "investigator_initiated"
  | "foundations"
  | "nih"
  | "immunology_translational";

/** Allowed results-per-page values for the funding list. */
export const FUNDING_LIST_PAGE_SIZES = [50, 100, 250, 500, 1000] as const;
export type FundingListPageSize = (typeof FUNDING_LIST_PAGE_SIZES)[number];

export const DEFAULT_FUNDING_LIST_PAGE = 1;
export const DEFAULT_FUNDING_LIST_PER_PAGE = 50;

export type FundingListSortKey =
  | "title"
  | "agency"
  | "status"
  | "posted_date"
  | "close_date"
  | "next_due"
  | "funding_instrument";

export type FundingListClientState = {
  q: string;
  scope: FundingListScope;
  /** Stacked quick filters (AND semantics). Empty = no quick filters. */
  tabs: FundingListQuickFilterTab[];
  /** When `closing_soon` is in tabs, horizon in days (default 30). */
  closingDays?: ClosingSoonDays;
  /** When `new_this_week` is in tabs, lookback in days (default 7). */
  postedDays?: PostedWithinDays;
  /** When `last_updated` is in tabs, lookback in days (default 7). */
  updatedDays?: PostedWithinDays;
  sort: string;
  order: "asc" | "desc";
  /** 1-based page index (URL `page`). */
  page: number;
  /** Rows per page (URL `per`). */
  perPage: number;
  /** Cabinet / department slugs, e.g. `hhs`, `dol`. */
  departments: string[];
  /** Selected sub-agency ids per department, e.g. `{ hhs: ["nih"], dol: ["osha"] }`. URL `sub=dept:subId`. */
  departmentSubs: DepartmentSubsSelection;
  /** Legacy `?agency=` tokens; used only when no department filters are present. */
  legacyAgencies: string[];
  /** When true, URL uses `dept=all` (cross-department; skip HHS/NIH auto-default). */
  allDepartments?: boolean;
  /** When true, URL uses `dept=none` (explicit empty department selection). */
  noDepartmentsSelected?: boolean;
  rd: RdListFilterState;
  /** Active saved-search pin (`?saved=`). UI only — not persisted in saved search JSON. */
  savedSearchId?: string | null;
};

/** Default funding list: all departments, open+forecasted scope, posted date sort. */
export function defaultFundingListClientState(): FundingListClientState {
  return {
    q: "",
    scope: "all",
    tabs: [],
    sort: "posted_date",
    order: "desc",
    page: DEFAULT_FUNDING_LIST_PAGE,
    perPage: DEFAULT_FUNDING_LIST_PER_PAGE,
    departments: [],
    departmentSubs: {},
    legacyAgencies: [],
    allDepartments: true,
    noDepartmentsSelected: false,
    rd: parseRdListFilters({}),
  };
}

export function nihDepartmentFilterPatch(): Pick<
  FundingListClientState,
  "departments" | "departmentSubs" | "legacyAgencies" | "allDepartments" | "noDepartmentsSelected"
> {
  return {
    departments: ["hhs"],
    departmentSubs: { hhs: ["nih"] },
    legacyAgencies: [],
    allDepartments: false,
    noDepartmentsSelected: false,
  };
}

export function isNihDepartmentFilterActive(
  state: Pick<
    FundingListClientState,
    "departments" | "departmentSubs" | "legacyAgencies" | "allDepartments" | "noDepartmentsSelected"
  >
): boolean {
  if (state.allDepartments || state.noDepartmentsSelected || state.legacyAgencies.length > 0) {
    return false;
  }
  const hhsSubs = state.departmentSubs.hhs ?? [];
  return state.departments.length === 1 && state.departments[0] === "hhs" && hhsSubs.length === 1 && hhsSubs[0] === "nih";
}

/** Agency + RD sidebar defaults — applied when a quick filter takes over from manual filters. */
export function defaultSidebarFilterPatch(): Pick<
  FundingListClientState,
  "departments" | "departmentSubs" | "legacyAgencies" | "allDepartments" | "noDepartmentsSelected" | "rd"
> {
  const defaults = defaultFundingListClientState();
  return {
    departments: defaults.departments,
    departmentSubs: defaults.departmentSubs,
    legacyAgencies: defaults.legacyAgencies,
    allDepartments: defaults.allDepartments,
    noDepartmentsSelected: defaults.noDepartmentsSelected,
    rd: defaults.rd,
  };
}

/** Sidebar reset when stacking quick filters — keeps NIH agency selection when `tab=nih` is active. */
export function quickFilterSidebarResetPatch(
  tabs: FundingListQuickFilterTab[]
): Pick<
  FundingListClientState,
  "departments" | "departmentSubs" | "legacyAgencies" | "allDepartments" | "noDepartmentsSelected" | "rd"
> {
  const patch = defaultSidebarFilterPatch();
  if (tabs.includes("nih")) {
    Object.assign(patch, nihDepartmentFilterPatch());
  }
  return patch;
}

/** Keep URL department params aligned with the stackable NIH quick filter tab. */
export function syncNihQuickFilterDepartments(state: FundingListClientState): FundingListClientState {
  if (!state.tabs.includes("nih")) return state;
  return {
    ...state,
    ...nihDepartmentFilterPatch(),
  };
}

export function fundingListDefaultHref(): string {
  return fundingListHref(defaultFundingListClientState());
}

export type FundingListQuickFilterLayer = Pick<
  FundingListClientState,
  "tabs" | "closingDays" | "postedDays" | "updatedDays"
>;

/** Sidebar, keyword, agency, scope, and sort — independent of quick-filter tabs. */
export function fundingListCoreState(state: FundingListClientState): FundingListClientState {
  return {
    q: state.q,
    scope: state.scope,
    tabs: [],
    sort: state.sort,
    order: state.order,
    page: DEFAULT_FUNDING_LIST_PAGE,
    perPage: state.perPage,
    departments: [...state.departments],
    departmentSubs: { ...state.departmentSubs },
    legacyAgencies: [...state.legacyAgencies],
    allDepartments: state.allDepartments,
    noDepartmentsSelected: state.noDepartmentsSelected,
    rd: { ...state.rd },
    savedSearchId: null,
  };
}

export function fundingListQuickFilterLayer(state: FundingListClientState): FundingListQuickFilterLayer {
  return {
    tabs: [...state.tabs],
    closingDays: state.closingDays,
    postedDays: state.postedDays,
    updatedDays: state.updatedDays,
  };
}

/** Combine core filters, stacked quick-filter tabs, and an optional saved-search pin. */
export function mergeFundingListLayers(
  core: FundingListClientState,
  quick: FundingListQuickFilterLayer,
  savedSearchId?: string | null
): FundingListClientState {
  return syncNihQuickFilterDepartments({
    ...core,
    tabs: quick.tabs,
    closingDays: quick.closingDays,
    postedDays: quick.postedDays,
    updatedDays: quick.updatedDays,
    savedSearchId: savedSearchId ?? null,
    page: DEFAULT_FUNDING_LIST_PAGE,
  });
}

export function parseFundingListHref(href: string): FundingListClientState {
  const queryString = href.includes("?") ? (href.split("?")[1] ?? "") : "";
  return searchParamsToFundingListState(
    urlSearchParamsToRecord(new URLSearchParams(queryString))
  );
}

function isExplicitAllDepartmentsParam(searchParams: SearchParams): boolean {
  const raw = searchParams.dept;
  if (raw === "all") return true;
  if (Array.isArray(raw) && raw.some((v) => v === "all")) return true;
  return false;
}

function isExplicitNoDepartmentsParam(searchParams: SearchParams): boolean {
  const raw = searchParams.dept;
  if (raw === "none") return true;
  if (Array.isArray(raw) && raw.some((v) => v === "none")) return true;
  return false;
}

export function urlHasAgencyFilterParams(searchParams: SearchParams): boolean {
  if (isExplicitAllDepartmentsParam(searchParams)) return true;
  if (searchParams.dept !== undefined) return true;
  if (searchParams.hhs !== undefined) return true;
  if (searchParams.sub !== undefined) return true;
  if (searchParams.agency !== undefined) return true;
  return false;
}

export function urlSearchParamsToRecord(sp: URLSearchParams): SearchParams {
  const out: SearchParams = {};
  const keys = Array.from(new Set(Array.from(sp.keys())));
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i]!;
    const all = sp.getAll(key);
    if (all.length === 0) continue;
    out[key] = all.length === 1 ? all[0]! : all;
  }
  return out;
}

export function firstStringParam(v: string | string[] | undefined): string {
  if (v === undefined) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    const x = v.find((i) => typeof i === "string" && i.length > 0);
    return typeof x === "string" ? x : "";
  }
  return "";
}

export function agenciesFromSearchParams(searchParams: SearchParams): string[] {
  const raw = searchParams.agency;
  if (raw === undefined) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string" || !item.trim()) continue;
    out.push(item.trim());
  }
  return Array.from(new Set(out));
}

export function departmentsFromSearchParams(searchParams: SearchParams): string[] {
  const raw = searchParams.dept;
  if (raw === undefined) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string" || !item.trim()) continue;
    const id = item.trim();
    if (id === "all" || id === "none") continue;
    if (isKnownDepartmentId(id)) out.push(id);
  }
  return Array.from(new Set(out));
}

export function agencySelectionFromSearchParams(searchParams: SearchParams): FundingListAgencySelection {
  return {
    departments: departmentsFromSearchParams(searchParams),
    departmentSubs: departmentSubsFromSearchParams(searchParams),
    legacyAgencies: agenciesFromSearchParams(searchParams),
    noDepartmentsSelected: isExplicitNoDepartmentsParam(searchParams),
  };
}

function mergeDepartmentSubs(
  dest: DepartmentSubsSelection,
  deptId: string,
  subIds: string[]
): void {
  if (subIds.length === 0) return;
  const cur = dest[deptId] ?? [];
  dest[deptId] = Array.from(new Set([...cur, ...subIds]));
}

/** Legacy `?hhs=` tokens merged into `departmentSubs.hhs`. */
function legacyHhsFromSearchParams(searchParams: SearchParams): string[] {
  const raw = searchParams.hhs;
  if (raw === undefined) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string" || !item.trim()) continue;
    const id = item.trim();
    if (isKnownDepartmentSubId("hhs", id)) out.push(id);
  }
  return Array.from(new Set(out));
}

/** Parse `sub=dept:subId` and legacy `hhs=` into a department → sub-ids map. */
export function departmentSubsFromSearchParams(searchParams: SearchParams): DepartmentSubsSelection {
  const out: DepartmentSubsSelection = {};
  const rawSub = searchParams.sub;
  const subList = rawSub === undefined ? [] : Array.isArray(rawSub) ? rawSub : [rawSub];
  for (const item of subList) {
    if (typeof item !== "string" || !item.trim()) continue;
    const colon = item.indexOf(":");
    if (colon <= 0) continue;
    const dept = item.slice(0, colon).trim();
    const rawSid = item.slice(colon + 1).trim();
    const sid = normalizeDepartmentSubId(dept, rawSid);
    if (!dept || !sid || !isKnownDepartmentId(dept)) continue;
    if (!isKnownDepartmentSubId(dept, sid)) continue;
    mergeDepartmentSubs(out, dept, [sid]);
  }
  const legacy = legacyHhsFromSearchParams(searchParams);
  if (legacy.length > 0) mergeDepartmentSubs(out, "hhs", legacy);
  return out;
}

export function isDepartmentSubsEmpty(subs: DepartmentSubsSelection | undefined): boolean {
  if (!subs) return true;
  for (const v of Object.values(subs)) {
    if (v && v.length > 0) return false;
  }
  return true;
}

export function parseFundingListPagination(searchParams: SearchParams): {
  page: number;
  perPage: FundingListPageSize;
} {
  const rawPage = typeof searchParams.page === "string" ? searchParams.page.trim() : "";
  const rawPer = typeof searchParams.per === "string" ? searchParams.per.trim() : "";
  let page = parseInt(rawPage, 10);
  if (!Number.isFinite(page) || page < 1) page = DEFAULT_FUNDING_LIST_PAGE;
  const perNum = parseInt(rawPer, 10);
  const allowed = FUNDING_LIST_PAGE_SIZES as readonly number[];
  const perPage = allowed.includes(perNum) ? (perNum as FundingListPageSize) : DEFAULT_FUNDING_LIST_PER_PAGE;
  return { page, perPage };
}

export function resolveListScope(searchParams: SearchParams): FundingListScope {
  const raw = typeof searchParams.scope === "string" ? searchParams.scope : "";
  if (raw === "any" || raw === "all" || raw === "open" || raw === "forecasted" || raw === "closed") {
    return raw;
  }
  if (typeof searchParams.active === "string" && searchParams.active === "0") return "closed";
  return "all";
}

/** @deprecated Use {@link quickFiltersFromSearchParams} for stacked quick filters. */
export function resolveListTab(searchParams: SearchParams): FundingListViewTab {
  const tabs = quickFiltersFromSearchParams(searchParams);
  if (tabs.length === 1) return tabs[0]!;
  if (tabs.length === 0) return "all";
  return tabs[0]!;
}

export function parseClosingDays(searchParams: SearchParams): ClosingSoonDays | undefined {
  const raw = typeof searchParams.closing_days === "string" ? parseInt(searchParams.closing_days, 10) : NaN;
  if (raw === 30 || raw === 60 || raw === 90) return raw;
  return undefined;
}

export function parsePostedDays(searchParams: SearchParams): PostedWithinDays | undefined {
  const raw = typeof searchParams.posted_days === "string" ? parseInt(searchParams.posted_days, 10) : NaN;
  if (raw === 7 || raw === 30 || raw === 90) return raw;
  return undefined;
}

export function parseUpdatedDays(searchParams: SearchParams): PostedWithinDays | undefined {
  const raw = typeof searchParams.updated_days === "string" ? parseInt(searchParams.updated_days, 10) : NaN;
  if (raw === 7 || raw === 30 || raw === 90) return raw;
  return undefined;
}

export function defaultSortDirForKey(key: FundingListSortKey): "asc" | "desc" {
  if (key === "posted_date") return "desc";
  return "asc";
}

export function parseListSort(searchParams: SearchParams): {
  key: FundingListSortKey;
  dir: "asc" | "desc";
} {
  const raw = typeof searchParams.sort === "string" ? searchParams.sort.trim() : "";
  const orderRaw = typeof searchParams.order === "string" ? searchParams.order.trim() : "";

  const legacy: Record<string, { key: FundingListSortKey; dir: "asc" | "desc" }> = {
    close_date: { key: "close_date", dir: "asc" },
    next_due: { key: "next_due", dir: "asc" },
    posted_date: { key: "posted_date", dir: "desc" },
  };

  const keyAliases: Record<string, FundingListSortKey> = {
    close_date: "close_date",
    next_due: "next_due",
    posted_date: "posted_date",
    title: "title",
    agency: "agency",
    status: "status",
    funding_instrument: "funding_instrument",
    instrument: "funding_instrument",
  };

  const key = keyAliases[raw] ?? "posted_date";
  const order = orderRaw === "asc" || orderRaw === "desc" ? orderRaw : null;

  if (order) {
    return { key, dir: order };
  }
  if (raw && legacy[raw]) {
    return legacy[raw];
  }
  return { key, dir: defaultSortDirForKey(key) };
}

export function sortParamForKey(key: FundingListSortKey): string {
  return key;
}

export function nextColumnSort(
  column: FundingListSortKey,
  current: { key: FundingListSortKey; dir: "asc" | "desc" }
): { sort: string; order: "asc" | "desc" } {
  if (current.key === column) {
    return { sort: sortParamForKey(column), order: current.dir === "asc" ? "desc" : "asc" };
  }
  return { sort: sortParamForKey(column), order: defaultSortDirForKey(column) };
}

export function searchParamsToFundingListState(searchParams: SearchParams): FundingListClientState {
  const sort = parseListSort(searchParams);
  const { page, perPage } = parseFundingListPagination(searchParams);
  const tabs = quickFiltersFromSearchParams(searchParams);
  return {
    q: firstStringParam(searchParams.q),
    scope: resolveListScope(searchParams),
    tabs,
    closingDays: tabs.includes("closing_soon") ? parseClosingDays(searchParams) ?? 30 : undefined,
    postedDays: tabs.includes("new_this_week") ? parsePostedDays(searchParams) ?? 7 : undefined,
    updatedDays: tabs.includes("last_updated") ? parseUpdatedDays(searchParams) ?? 7 : undefined,
    sort: sortParamForKey(sort.key),
    order: sort.dir,
    page,
    perPage,
    departments: departmentsFromSearchParams(searchParams),
    departmentSubs: departmentSubsFromSearchParams(searchParams),
    legacyAgencies: agenciesFromSearchParams(searchParams),
    allDepartments: isExplicitAllDepartmentsParam(searchParams),
    noDepartmentsSelected: isExplicitNoDepartmentsParam(searchParams),
    rd: parseRdListFilters(searchParams),
    savedSearchId: parseSavedSearchId(searchParams),
  };
}

export function hrefWithSavedSearchPin(href: string, savedSearchId: string): string {
  const [path, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  params.set(FUNDING_SAVED_SEARCH_PARAM, savedSearchId);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

const PRE_SAVED_SEARCH_HREF_KEY = "prospera-funding-pre-saved-href";

/** Remember list URL before activating a saved search (for toggle-off restore). */
export function rememberSavedSearchRestorePoint(href: string): void {
  try {
    sessionStorage.setItem(PRE_SAVED_SEARCH_HREF_KEY, href);
  } catch {
    /* private browsing / disabled storage */
  }
}

export function readSavedSearchRestorePoint(): string | null {
  try {
    return sessionStorage.getItem(PRE_SAVED_SEARCH_HREF_KEY);
  } catch {
    return null;
  }
}

export function clearSavedSearchRestorePoint(): void {
  try {
    sessionStorage.removeItem(PRE_SAVED_SEARCH_HREF_KEY);
  } catch {
    /* ignore */
  }
}

/** Build the list URL after turning off a saved search while keeping stacked quick filters. */
export function deactivateSavedSearchHrefForState(
  current: FundingListClientState,
  restoreHref: string | null
): string {
  const restoredCore = fundingListCoreState(
    restoreHref ? parseFundingListHref(restoreHref) : defaultFundingListClientState()
  );
  const quick = fundingListQuickFilterLayer(current);
  return fundingListHref(mergeFundingListLayers(restoredCore, quick, null));
}

export function fundingListHref(state: FundingListClientState): string {
  const synced = syncNihQuickFilterDepartments(state);
  const p = new URLSearchParams();
  if (synced.savedSearchId) p.set(FUNDING_SAVED_SEARCH_PARAM, synced.savedSearchId);
  if (synced.q.trim()) p.set("q", synced.q.trim());
  p.set("scope", synced.scope);
  for (const tab of synced.tabs) {
    p.append("tab", tab);
  }
  if (synced.tabs.includes("closing_soon") && synced.closingDays) {
    p.set("closing_days", String(synced.closingDays));
  }
  if (synced.tabs.includes("new_this_week") && synced.postedDays) {
    p.set("posted_days", String(synced.postedDays));
  }
  if (synced.tabs.includes("last_updated") && synced.updatedDays) {
    p.set("updated_days", String(synced.updatedDays));
  }
  p.set("sort", synced.sort);
  p.set("order", synced.order);
  if (synced.page > DEFAULT_FUNDING_LIST_PAGE) p.set("page", String(synced.page));
  if (synced.perPage !== DEFAULT_FUNDING_LIST_PER_PAGE) p.set("per", String(synced.perPage));
  if (
    synced.allDepartments &&
    synced.departments.length === 0 &&
    isDepartmentSubsEmpty(synced.departmentSubs) &&
    synced.legacyAgencies.length === 0
  ) {
    p.set("dept", "all");
  } else if (
    synced.noDepartmentsSelected &&
    synced.departments.length === 0 &&
    isDepartmentSubsEmpty(synced.departmentSubs) &&
    synced.legacyAgencies.length === 0
  ) {
    p.set("dept", "none");
  } else {
    for (const d of synced.departments) {
      p.append("dept", d);
    }
    for (const [dept, subs] of Object.entries(synced.departmentSubs)) {
      if (!subs || subs.length === 0) continue;
      for (const sid of subs) {
        p.append("sub", `${dept}:${sid}`);
      }
    }
    for (const a of synced.legacyAgencies) {
      p.append("agency", a);
    }
  }
  appendRdListFiltersToUrlSearchParams(p, synced.rd);
  const s = p.toString();
  return s ? `/funding-opportunities?${s}` : "/funding-opportunities";
}

export function fundingListHrefWithSortOverride(
  searchParams: SearchParams,
  sort: string,
  order: "asc" | "desc"
): string {
  const base = searchParamsToFundingListState(searchParams);
  return fundingListHref({ ...base, sort, order, page: DEFAULT_FUNDING_LIST_PAGE });
}
