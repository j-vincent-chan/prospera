import {
  fundingListHref,
  searchParamsToFundingListState,
  type FundingListClientState,
} from "@/lib/funding-opportunities/funding-list-url";
import type { SearchParams } from "@/lib/funding-opportunities/rd-list-filters";

/**
 * URL state for /opportunities (Opportunities v2). The federal scope reuses
 * the existing list state (departments, RD filters, quick filters, sort,
 * paging) and adds the v2 controls; internal and limited scopes are curated
 * records (step 7) and carry no filters.
 *
 *   ?scope=federal|internal|limited   ?mode=search|ask   ?status=open_forecasted|open|forecasted|all
 *   ?closing=30|60|90   ?posted=7|30|90   ?dismissed=1   ?peek=<id>   ?saved=<id>
 */

export type OpportunityScope = "federal" | "internal" | "limited";
export type SearchMode = "search" | "ask";
export type StatusChoice = "open_forecasted" | "open" | "forecasted" | "all";
export type ClosingChoice = 30 | 60 | 90 | null;
export type PostedChoice = 7 | 30 | 90 | null;

export type OpportunitiesListState = {
  scope: OpportunityScope;
  mode: SearchMode;
  status: StatusChoice;
  closing: ClosingChoice;
  posted: PostedChoice;
  /** Show the team's dismissed notices instead of hiding them. */
  dismissed: boolean;
  /** Underlying federal list state (filters, sort, paging, q). */
  list: FundingListClientState;
};

const STATUS_TO_SCOPE: Record<StatusChoice, FundingListClientState["scope"]> = {
  open_forecasted: "all",
  open: "open",
  forecasted: "forecasted",
  all: "any",
};

const SCOPE_TO_STATUS: Partial<Record<FundingListClientState["scope"], StatusChoice>> = {
  all: "open_forecasted",
  open: "open",
  forecasted: "forecasted",
  any: "all",
  closed: "all",
};

function first(sp: SearchParams, key: string): string {
  const v = sp[key];
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) return (v.find((x) => typeof x === "string") ?? "").trim();
  return "";
}

export function parseOpportunitiesState(sp: SearchParams): OpportunitiesListState {
  const scopeRaw = first(sp, "scope");
  const scope: OpportunityScope = scopeRaw === "internal" || scopeRaw === "limited" ? scopeRaw : "federal";
  const mode: SearchMode = first(sp, "mode") === "ask" ? "ask" : "search";

  const list = searchParamsToFundingListState(sp);
  // Default sort for v2 is the next receipt date, soonest first.
  if (!first(sp, "sort")) {
    list.sort = "next_due";
    list.order = "asc";
  }

  const statusRaw = first(sp, "status") as StatusChoice;
  const status: StatusChoice =
    statusRaw === "open" || statusRaw === "forecasted" || statusRaw === "all" || statusRaw === "open_forecasted"
      ? statusRaw
      : (SCOPE_TO_STATUS[list.scope] ?? "open_forecasted");
  list.scope = STATUS_TO_SCOPE[status];

  const closingRaw = Number(first(sp, "closing"));
  const closing: ClosingChoice = closingRaw === 30 || closingRaw === 60 || closingRaw === 90 ? closingRaw : null;
  const postedRaw = Number(first(sp, "posted"));
  const posted: PostedChoice = postedRaw === 7 || postedRaw === 30 || postedRaw === 90 ? postedRaw : null;

  return { scope, mode, status, closing, posted, dismissed: first(sp, "dismissed") === "1", list };
}

/** Build /opportunities?… from state. Page resets to 1 unless `keepPage`. */
export function opportunitiesHref(state: OpportunitiesListState, opts: { keepPage?: boolean; peek?: string | null } = {}): string {
  const list = opts.keepPage ? state.list : { ...state.list, page: 1 };
  const base = fundingListHref({ ...list, scope: STATUS_TO_SCOPE[state.status] });
  const url = new URL(base.replace(/^\/funding-opportunities/, "/opportunities"), "http://x");
  if (state.scope !== "federal") url.searchParams.set("scope", state.scope);
  if (state.mode === "ask") url.searchParams.set("mode", "ask");
  if (state.status !== "open_forecasted") url.searchParams.set("status", state.status);
  else url.searchParams.delete("status");
  if (state.closing) url.searchParams.set("closing", String(state.closing));
  if (state.posted) url.searchParams.set("posted", String(state.posted));
  if (state.dismissed) url.searchParams.set("dismissed", "1");
  if (opts.peek) url.searchParams.set("peek", opts.peek);
  // Keep the URL tidy: the underlying helper writes scope=all for the default.
  if (url.searchParams.get("scope") === "all") url.searchParams.delete("scope");
  const qs = url.searchParams.toString();
  return qs ? `/opportunities?${qs}` : "/opportunities";
}

export type ActiveChip = { key: string; label: string; href: string };

/** The "Active" chip row: one chip per non-default control, each with a URL that removes it. */
export function activeChips(state: OpportunitiesListState, labels: { departments: (ids: string[], subs: FundingListClientState["departmentSubs"]) => string | null; rd: (state: FundingListClientState) => string[] }): ActiveChip[] {
  const chips: ActiveChip[] = [];
  const without = (patch: Partial<OpportunitiesListState>, listPatch: Partial<FundingListClientState> = {}) =>
    opportunitiesHref({ ...state, ...patch, list: { ...state.list, ...listPatch } });

  if (state.list.q) chips.push({ key: "q", label: `“${state.list.q}”`, href: without({}, { q: "" }) });
  if (state.status !== "open_forecasted") {
    const label = state.status === "open" ? "Open only" : state.status === "forecasted" ? "Forecasted only" : "All statuses";
    chips.push({ key: "status", label, href: without({ status: "open_forecasted" }) });
  }
  if (state.closing) chips.push({ key: "closing", label: `Closing within ${state.closing} days`, href: without({ closing: null }) });
  if (state.posted) chips.push({ key: "posted", label: state.posted === 7 ? "Posted this week" : state.posted === 30 ? "Posted this month" : "Posted this quarter", href: without({ posted: null }) });
  const dept = labels.departments(state.list.departments, state.list.departmentSubs);
  if (dept) chips.push({ key: "dept", label: dept, href: without({}, { departments: [], departmentSubs: {}, legacyAgencies: [], allDepartments: true, noDepartmentsSelected: false }) });
  for (const tab of state.list.tabs) {
    const label = tab === "recommended" ? "Fits my investigators" : tab === "nih" ? "NIH" : tab === "esi_career" ? "ESI / career" : tab === "investigator_initiated" ? "Investigator-initiated" : tab === "foundations" ? "Foundations" : tab === "large_awards" ? "Large awards" : tab === "closing_soon" ? "Closing soon" : tab === "new_this_week" ? "New this week" : tab === "last_updated" ? "Recently updated" : tab;
    chips.push({ key: `tab:${tab}`, label, href: without({}, { tabs: state.list.tabs.filter((t) => t !== tab) }) });
  }
  for (const label of labels.rd(state.list)) chips.push({ key: `rd:${label}`, label, href: without({}, { rd: { ...state.list.rd } }) });
  return chips;
}

export function clearAllHref(state: OpportunitiesListState): string {
  return opportunitiesHref({
    ...state,
    status: "open_forecasted",
    closing: null,
    posted: null,
    list: { ...state.list, q: "", tabs: [], departments: [], departmentSubs: {}, legacyAgencies: [], allDepartments: true, noDepartmentsSelected: false, rd: { ...state.list.rd, activityFamilies: [], clinicalTrialMode: null, nihIc: [], announcement: [], pathway: [], investigatorTags: [], mechanismTypes: [], collaborations: [], humanSubjects: [] } },
  });
}
