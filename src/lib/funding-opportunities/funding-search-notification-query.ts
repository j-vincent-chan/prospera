import type { SupabaseClient } from "@supabase/supabase-js";
import { applyFundingListOrFilters } from "@/lib/funding-opportunities/keyword-filter";
import {
  applyRdFiltersToFundingQuery,
  isMissingRdColumnsPostgrestError,
  rdFiltersActive,
} from "@/lib/funding-opportunities/rd-list-filters";
import {
  fundingListRowEligibleForEmailNotification,
  fundingListRowMatchesScope,
  fundingListRowScope,
} from "@/lib/funding-opportunities/funding-list-row-scope";
import type { FundingListClientState } from "@/lib/funding-opportunities/funding-list-url";
import { DEFAULT_MAX_NOFOS_PER_SYNC } from "@/lib/services/simpler-grants-sync";

/** Columns required for list filters + RD filters + email row bucket. */
export const FUNDING_NOTIFICATION_SELECT =
  "id, title, agency, opportunity_number, close_date, posted_date, funding_instrument, status, forecasted, updated_at, " +
  "activity_families, clinical_trial_mode, nih_ic_tokens, rd_announcement_class, rd_research_pathway, rd_investigator_tags, rd_mechanism_type, rd_collaboration, rd_human_subjects";

export type FundingNotificationCandidateRow = {
  id: string;
  title: string;
  agency: string | null;
  opportunity_number: string | null;
  close_date: string | null;
  posted_date: string | null;
  funding_instrument: string | null;
  status: string | null;
  forecasted: boolean | null;
  updated_at: string;
  activity_families?: string[] | null;
  clinical_trial_mode?: string | null;
  nih_ic_tokens?: string[] | null;
  rd_announcement_class?: string | null;
  rd_research_pathway?: string | null;
  rd_investigator_tags?: string[] | null;
  rd_mechanism_type?: string | null;
  rd_collaboration?: string | null;
  rd_human_subjects?: string | null;
};

const NOTIFICATION_FETCH_LIMIT = 2500;

/** Same lookback window as funding-search-notifications cron digests. */
export const FUNDING_SEARCH_NEW_MATCH_LOOKBACK_HOURS = 72;

export type SavedSearchMatchQueryOptions = {
  includeForecasted?: boolean;
};

export type SavedSearchMatchStats = {
  newResultsRecent: number;
  newMatchesSinceViewed: number;
  lastMatchedAt: string | null;
  totalMatches: number;
};

export async function countRecentMatchingOpportunitiesForSavedSearch(
  supabase: SupabaseClient,
  state: FundingListClientState,
  sinceIso?: string,
  options?: SavedSearchMatchQueryOptions
): Promise<number> {
  const since =
    sinceIso ??
    new Date(Date.now() - FUNDING_SEARCH_NEW_MATCH_LOOKBACK_HOURS * 3600 * 1000).toISOString();
  const { rows } = await fetchRecentMatchingOpportunitiesForSavedSearch(supabase, state, since, options);
  return rows.length;
}

/** Scope as SQL, mirroring fundingListRowScope (status, close_date, forecasted). Extra .or() filters are ANDed by PostgREST. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyScopeFilter(q: any, scope: FundingListClientState["scope"], todayIso: string): any {
  if (scope === "any") return q;
  q = q.not("status", "in", "(closed,archived)");
  if (scope === "forecasted") return q.or("forecasted.eq.true,status.eq.forecasted");
  if (scope === "open") return q.or("forecasted.is.null,forecasted.eq.false").neq("status", "forecasted").or(`close_date.is.null,close_date.gte.${todayIso}`);
  return q.or(`forecasted.eq.true,status.eq.forecasted,close_date.is.null,close_date.gte.${todayIso}`);
}

/**
 * Chip / Home / digest counts for a saved search: two `count` queries instead
 * of fetching every matching row. "New" means notices that entered the catalog
 * (created_at) after the search was last viewed — never the nightly sync's
 * updated_at touch, which used to mark almost the whole catalog as new.
 */
export async function getSavedSearchMatchStats(
  supabase: SupabaseClient,
  state: FundingListClientState,
  input: {
    lastViewedAt?: string | null;
    includeForecasted?: boolean;
  }
): Promise<SavedSearchMatchStats> {
  const agencySelection = {
    departments: state.departments,
    departmentSubs: state.departmentSubs,
    legacyAgencies: state.legacyAgencies,
    noDepartmentsSelected: state.noDepartmentsSelected,
  };
  const rdWithoutNihIc = { ...state.rd, nihIc: [] as string[] };
  const todayIso = new Date().toISOString().slice(0, 10);
  const newSince = input.lastViewedAt?.trim() || new Date(Date.now() - 7 * 86_400_000).toISOString();
  const scope = input.includeForecasted === false && state.scope === "all" ? "open" : state.scope;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const build = (rdFilters: boolean): any => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase.from("funding_opportunities").select("id", { count: "exact", head: true });
    q = applyFundingListOrFilters(q, state.q, agencySelection, state.rd.nihIc);
    if (rdFilters && rdFiltersActive(rdWithoutNihIc)) q = applyRdFiltersToFundingQuery(q, rdWithoutNihIc);
    return applyScopeFilter(q, scope, todayIso);
  };
  const count = async (withNew: boolean): Promise<number> => {
    for (const rd of [true, false]) {
      const q = withNew ? build(rd).gte("created_at", newSince) : build(rd);
      const res = (await q) as { count: number | null; error: { message: string } | null };
      if (!res.error) return res.count ?? 0;
      if (!(rd && isMissingRdColumnsPostgrestError(res.error.message))) return 0;
    }
    return 0;
  };
  const [totalMatches, fresh] = await Promise.all([count(false), count(true)]);
  return {
    newResultsRecent: fresh,
    newMatchesSinceViewed: fresh,
    lastMatchedAt: null,
    totalMatches,
  };
}

type SavedSearchMatchFetchOptions = SavedSearchMatchQueryOptions & {
  updatedSince?: string;
  fetchLimit?: number;
};

/**
 * All opportunities matching keyword/agency/NIH IC + RD filters and the saved list scope
 * (same filters as the funding list, without the recent-update window used for alerts).
 */
export async function fetchMatchingOpportunitiesForSavedSearch(
  supabase: SupabaseClient,
  state: FundingListClientState,
  options?: Pick<SavedSearchMatchFetchOptions, "fetchLimit">
): Promise<{ rows: FundingNotificationCandidateRow[]; warning?: string }> {
  return runSavedSearchMatchQuery(supabase, state, {
    fetchLimit: options?.fetchLimit ?? DEFAULT_MAX_NOFOS_PER_SYNC,
    rowFilter: (bucket) => fundingListRowMatchesScope(bucket, state.scope),
  });
}

/**
 * Opportunities updated since `sinceIso` that match keyword/agency/NIH IC + RD filters,
 * then narrowed to posted/forecasted rows that satisfy the saved list scope.
 */
export async function fetchRecentMatchingOpportunitiesForSavedSearch(
  supabase: SupabaseClient,
  state: FundingListClientState,
  sinceIso: string,
  options?: SavedSearchMatchQueryOptions
): Promise<{ rows: FundingNotificationCandidateRow[]; warning?: string }> {
  const includeForecasted = options?.includeForecasted !== false;
  return runSavedSearchMatchQuery(supabase, state, {
    updatedSince: sinceIso,
    fetchLimit: NOTIFICATION_FETCH_LIMIT,
    rowFilter: (bucket) => {
      if (!includeForecasted && bucket === "forecasted") return false;
      return fundingListRowEligibleForEmailNotification(bucket, state.scope);
    },
  });
}

async function runSavedSearchMatchQuery(
  supabase: SupabaseClient,
  state: FundingListClientState,
  options: {
    updatedSince?: string;
    fetchLimit: number;
    rowFilter: (bucket: ReturnType<typeof fundingListRowScope>) => boolean;
  }
): Promise<{ rows: FundingNotificationCandidateRow[]; warning?: string }> {
  const agencySelection = {
    departments: state.departments,
    departmentSubs: state.departmentSubs,
    legacyAgencies: state.legacyAgencies,
    noDepartmentsSelected: state.noDepartmentsSelected,
  };
  const rdWithoutNihIc = { ...state.rd, nihIc: [] as string[] };
  const today = new Date(new Date().toDateString());

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function runQuery(rdFilters: boolean, heuristicSelect: boolean): Promise<any> {
    const selectStr = heuristicSelect
      ? FUNDING_NOTIFICATION_SELECT
      : "id, title, agency, opportunity_number, close_date, posted_date, funding_instrument, status, forecasted, updated_at";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase.from("funding_opportunities").select(selectStr).limit(options.fetchLimit);
    if (options.updatedSince) {
      q = q.gte("updated_at", options.updatedSince).order("updated_at", { ascending: false });
    } else {
      q = q.order("posted_date", { ascending: false, nullsFirst: false });
    }
    q = applyFundingListOrFilters(q, state.q, agencySelection, state.rd.nihIc);
    if (rdFilters && rdFiltersActive(rdWithoutNihIc)) {
      q = applyRdFiltersToFundingQuery(q, rdWithoutNihIc);
    }
    return q;
  }

  let res = await runQuery(true, true);
  if (
    res.error &&
    rdFiltersActive(rdWithoutNihIc) &&
    isMissingRdColumnsPostgrestError(res.error.message)
  ) {
    res = await runQuery(false, true);
  }
  if (res.error && isMissingRdColumnsPostgrestError(res.error.message)) {
    res = await runQuery(false, false);
  }

  if (res.error) {
    return { rows: [], warning: res.error.message };
  }

  const raw = (res.data ?? []) as FundingNotificationCandidateRow[];
  const rows: FundingNotificationCandidateRow[] = [];
  for (const r of raw) {
    const bucket = fundingListRowScope(r, today);
    if (!options.rowFilter(bucket)) continue;
    rows.push(r);
  }

  return { rows };
}
