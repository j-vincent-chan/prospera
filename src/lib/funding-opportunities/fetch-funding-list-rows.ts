import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";
import {
  applyFundingListOrFilters,
  type FundingListAgencySelection,
} from "@/lib/funding-opportunities/keyword-filter";
import {
  applyRdFiltersToFundingQuery,
  isMissingRdColumnsPostgrestError,
  rdFiltersActive,
  type RdListFilterState,
} from "@/lib/funding-opportunities/rd-list-filters";
import type { FundingListSortKey } from "@/lib/funding-opportunities/funding-list-url";

/** Upper bound when paginating the funding list (PostgREST pages at 1000 rows). */
export const FUNDING_LIST_FETCH_MAX_ROWS = 200_000;

export type FundingListDbRow = {
  id: string;
  title: string;
  agency: string | null;
  agency_code: string | null;
  close_date: string | null;
  posted_date: string | null;
  updated_at: string | null;
  funding_instrument: string | null;
  status: string | null;
  forecasted: boolean | null;
  source_system?: string | null;
  source_opportunity_id?: string | null;
  activity_families?: string[] | null;
  opportunity_number?: string | null;
  // v2 receipt cycles (see receipt-cycles.ts)
  next_due?: string | null;
  receipt_cycles?: unknown;
  cycles_source?: string | null;
  standard_dates_apply?: boolean | null;
  expiration_date?: string | null;
  activity_code?: string | null;
  reissue_of?: string | null;
};

const fundingListSelectBase =
  "id, title, agency, agency_code, close_date, posted_date, updated_at, funding_instrument, status, forecasted, source_system, source_opportunity_id, opportunity_number, next_due, receipt_cycles, cycles_source, standard_dates_apply, expiration_date, activity_code, reissue_of";
const fundingListSelectWithHeuristics = `${fundingListSelectBase}, activity_families`;

type BuildQueryOpts = {
  rdFilters: boolean;
  heuristicColumns: boolean;
};

/** PostgREST caps a response at 1000 rows; the catalog is a few thousand, so a full list is a handful of pages. */
const LIST_PAGE_SIZE = 1000;
/** Pages requested together after the first one — bounds the fan-out if the planner's estimate is wild. */
const MAX_PARALLEL_PAGES = 4;

/**
 * The list buckets a notice as closed when (next_due ?? close_date) is before
 * today and it is not forecasted (see buildRowModel). When the view cannot show
 * closed notices anyway, apply that rule in SQL so a default render does not
 * pull ~45% of the catalog only to discard it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyNotClosedFilter(query: any, todayIso: string): any {
  return query.or(`forecasted.eq.true,status.eq.forecasted,next_due.gte.${todayIso},and(next_due.is.null,close_date.is.null),and(next_due.is.null,close_date.gte.${todayIso})`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applySortOrder(query: any, sortKey: FundingListSortKey, sortDir: "asc" | "desc", clientSortOnly: boolean): any {
  const asc = sortDir === "asc";
  let qq = query;
  if (!clientSortOnly) {
    if (sortKey === "title") {
      qq = qq.order("title", { ascending: asc, nullsFirst: false });
    } else if (sortKey === "agency") {
      qq = qq.order("agency", { ascending: asc, nullsFirst: false });
    } else if (sortKey === "posted_date") {
      qq = qq.order("posted_date", { ascending: asc, nullsFirst: false });
    } else if (sortKey === "close_date") {
      qq = qq.order("close_date", { ascending: asc, nullsFirst: false });
    } else if (sortKey === "next_due") {
      qq = qq.order("next_due", { ascending: asc, nullsFirst: false });
    } else if (sortKey === "funding_instrument") {
      qq = qq.order("funding_instrument", { ascending: asc, nullsFirst: false });
    } else {
      qq = qq.order("close_date", { ascending: true, nullsFirst: false });
    }
  } else {
    qq = qq.order("close_date", { ascending: true, nullsFirst: false });
  }
  return qq.order("id", { ascending: true });
}

function buildFundingListQuery(
  supabase: SupabaseClient,
  opts: {
    build: BuildQueryOpts;
    agencySelection: FundingListAgencySelection;
    qParam: string;
    rdFilterState: RdListFilterState;
    sortKey: FundingListSortKey;
    sortDir: "asc" | "desc";
    clientSortOnly: boolean;
    excludeClosedBefore?: string;
    /** Ask PostgREST for the planner's row estimate (Content-Range) alongside the page. */
    count?: "planned";
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const selectStr = opts.build.heuristicColumns ? fundingListSelectWithHeuristics : fundingListSelectBase;
  let query = supabase.from("funding_opportunities").select(selectStr, opts.count ? { count: opts.count } : undefined);
  query = applyFundingListOrFilters(query, opts.qParam, opts.agencySelection, opts.rdFilterState.nihIc);
  if (opts.excludeClosedBefore) query = applyNotClosedFilter(query, opts.excludeClosedBefore);
  const rdWithoutNihIc = { ...opts.rdFilterState, nihIc: [] as string[] };
  if (opts.build.rdFilters && rdFiltersActive(rdWithoutNihIc)) {
    query = applyRdFiltersToFundingQuery(query, rdWithoutNihIc);
  }
  return applySortOrder(query, opts.sortKey, opts.sortDir, opts.clientSortOnly);
}

export async function fetchFundingListRows(
  supabase: SupabaseClient,
  opts: {
    agencySelection: FundingListAgencySelection;
    qParam: string;
    rdFilterState: RdListFilterState;
    sortKey: FundingListSortKey;
    sortDir: "asc" | "desc";
    clientSortOnly: boolean;
    /** ISO date: drop notices already closed before this day at the database (only when the view hides closed rows). */
    excludeClosedBefore?: string;
  }
): Promise<{
  rows: FundingListDbRow[];
  error: string | null;
  truncated: boolean;
  rdFiltersSkippedMigration: boolean;
  listIncludesActivityFamilies: boolean;
}> {
  /**
   * The first page carries the planner's estimate of the whole result, so the
   * pages after it are requested together rather than one round trip after
   * another (the default view is ~1,800 rows: two pages). The estimate only
   * decides how many pages to ask for at once — a short page still ends the
   * fetch, and a full last page still continues it, so an estimate that is
   * off in either direction costs a round trip, never rows.
   */
  async function runPagedFetch(build: BuildQueryOpts): Promise<{
    rows: FundingListDbRow[];
    error: string | null;
    truncated: boolean;
  }> {
    const page = async (from: number, count?: "planned") => {
      const res = await buildFundingListQuery(supabase, { ...opts, build, count }).range(from, Math.min(from + LIST_PAGE_SIZE, FUNDING_LIST_FETCH_MAX_ROWS) - 1);
      return { rows: (res.data ?? []) as FundingListDbRow[], error: res.error as { message: string } | null, estimate: (res.count ?? null) as number | null };
    };

    const first = await page(0, "planned");
    if (first.error) return { rows: [], error: first.error.message, truncated: false };
    const rows = first.rows;
    if (rows.length < LIST_PAGE_SIZE) return { rows, error: null, truncated: false };

    const estimatedPages = Math.ceil(Math.min(first.estimate ?? 0, FUNDING_LIST_FETCH_MAX_ROWS) / LIST_PAGE_SIZE);
    let from = LIST_PAGE_SIZE;
    if (estimatedPages > 1) {
      const batch = await Promise.all(Array.from({ length: Math.min(estimatedPages - 1, MAX_PARALLEL_PAGES) }, (_, i) => page(LIST_PAGE_SIZE * (i + 1))));
      for (const p of batch) {
        if (p.error) return { rows, error: p.error.message, truncated: false };
        rows.push(...p.rows);
        from += LIST_PAGE_SIZE;
        if (p.rows.length < LIST_PAGE_SIZE) return { rows, error: null, truncated: false };
      }
    }
    if (from >= FUNDING_LIST_FETCH_MAX_ROWS) return { rows, error: null, truncated: true };
    // The estimate ran out before the rows did: continue one page at a time, as before.
    const rest = await fetchAllRows<FundingListDbRow>(
      async (pageFrom) => {
        const p = await page(from + pageFrom);
        return { data: p.rows, error: p.error };
      },
      { pageSize: LIST_PAGE_SIZE, maxRows: Math.max(0, FUNDING_LIST_FETCH_MAX_ROWS - from) }
    );
    rows.push(...rest.data);
    return { rows, error: rest.error, truncated: rest.truncated };
  }

  let rdFiltersSkippedMigration = false;
  let listIncludesActivityFamilies = true;

  let result = await runPagedFetch({ rdFilters: true, heuristicColumns: true });
  if (
    result.error &&
    rdFiltersActive(opts.rdFilterState) &&
    isMissingRdColumnsPostgrestError(result.error)
  ) {
    rdFiltersSkippedMigration = true;
    result = await runPagedFetch({ rdFilters: false, heuristicColumns: true });
  }
  if (result.error && isMissingRdColumnsPostgrestError(result.error)) {
    listIncludesActivityFamilies = false;
    result = await runPagedFetch({ rdFilters: false, heuristicColumns: false });
  }

  return {
    rows: result.rows,
    error: result.error,
    truncated: result.truncated,
    rdFiltersSkippedMigration,
    listIncludesActivityFamilies,
  };
}
