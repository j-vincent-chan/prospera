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
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const selectStr = opts.build.heuristicColumns ? fundingListSelectWithHeuristics : fundingListSelectBase;
  let query = supabase.from("funding_opportunities").select(selectStr);
  query = applyFundingListOrFilters(query, opts.qParam, opts.agencySelection, opts.rdFilterState.nihIc);
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
  }
): Promise<{
  rows: FundingListDbRow[];
  error: string | null;
  truncated: boolean;
  rdFiltersSkippedMigration: boolean;
  listIncludesActivityFamilies: boolean;
}> {
  async function runPagedFetch(build: BuildQueryOpts): Promise<{
    rows: FundingListDbRow[];
    error: string | null;
    truncated: boolean;
  }> {
    const { data, error, truncated } = await fetchAllRows<FundingListDbRow>(
      async (from, to) => {
        const q = buildFundingListQuery(supabase, { ...opts, build }).range(from, to);
        const res = await q;
        return { data: (res.data ?? []) as FundingListDbRow[], error: res.error };
      },
      { maxRows: FUNDING_LIST_FETCH_MAX_ROWS }
    );
    return { rows: data, error, truncated };
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
