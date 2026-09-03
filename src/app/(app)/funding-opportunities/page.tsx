import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/formatting/dates";
import { SimplerSyncControls } from "@/components/funding/simpler-sync-controls";
import { DEFAULT_MAX_NOFOS_PER_SYNC } from "@/lib/services/simpler-grants-sync";
import {
  parseRdListFilters,
  rdFiltersActive,
  type SearchParams,
} from "@/lib/funding-opportunities/rd-list-filters";
import {
  fetchFundingListRows,
  FUNDING_LIST_FETCH_MAX_ROWS,
  type FundingListDbRow,
} from "@/lib/funding-opportunities/fetch-funding-list-rows";
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";
import {
  agencySelectionFromSearchParams,
  firstStringParam,
  fundingListHref,
  isDepartmentSubsEmpty,
  nextColumnSort,
  parseFundingListPagination,
  parseListSort,
  parseClosingDays,
  parsePostedDays,
  parseUpdatedDays,
  resolveListScope,
  searchParamsToFundingListState,
  type FundingListSortKey,
} from "@/lib/funding-opportunities/funding-list-url";
import { type FundingQuickFiltersCounts } from "@/components/funding/funding-quick-filters-bar";
import { FundingListToolbar } from "@/components/funding/funding-list-toolbar";
import {
  applyFundingQuickFilters,
  quickFiltersFromSearchParams,
} from "@/lib/funding-opportunities/funding-quick-filters";
import {
  isEsiCareerDevelopment,
  isFoundationOpportunity,
  isInvestigatorInitiated,
  isRecommendedMatch,
  looksLargeCollaborativeGrant,
} from "@/lib/funding-opportunities/funding-quick-filter-heuristics";
import { isNihFundingOpportunity } from "@/lib/funding-opportunities/funding-opportunity-application-materials";
import { FundingListKeywordSearch } from "@/components/funding/funding-list-keyword-search";
import { FundingChatPanel } from "@/components/funding/funding-chat-panel";
import { FundingListPagination } from "@/components/funding/funding-list-pagination";
import { FundingOpportunitiesFiltersPanel } from "@/components/funding/funding-opportunities-filters-panel";
import {
  FundingListResultsTable,
  type FundingListResultsRow,
} from "@/components/funding/funding-list-results-table";
import { normalizeAgencyDisplayName } from "@/lib/funding-opportunities/agency-display";
import {
  resolveEstimatedOpenDate,
  resolveListPostedDate,
  resolveRowLastUpdatedAt,
  isNewWithinDays,
  isUpdatedWithinDays,
} from "@/lib/funding-opportunities/funding-opportunity-dates";
import {
  formatSavedSearchFilterSummary,
  fundingListStateForBookmark,
  parseSavedFundingListState,
  savedSearchStillActive,
} from "@/lib/funding-opportunities/saved-funding-list-state";
import { fetchSavedFundingSearchesForTeam } from "@/lib/funding-opportunities/saved-funding-search-query";
import { getCurrentTeamId } from "@/lib/team/current-team";
import { fetchActiveRdsgOwnersForAlerts } from "@/lib/funding-opportunities/saved-search-alert-recipients";
import { FundingSearchBookmarksRail } from "@/components/funding/funding-search-bookmarks-rail";
import { type SavedSearchLink } from "@/components/funding/funding-saved-searches-strip";
import { getSavedSearchMatchStats } from "@/lib/funding-opportunities/funding-search-notification-query";
import {
  FundingOpportunityPeekPanel,
  FundingOpportunityPeekProvider,
} from "@/components/funding/funding-opportunity-peek-panel";
import { resolveFundingSourceUrl } from "@/lib/funding-opportunities/source-url";
import {
  fundingListRowMatchesScope,
  fundingListRowScope,
  type FundingListRowBucket,
} from "@/lib/funding-opportunities/funding-list-row-scope";

function buildFundingListUrl(
  current: SearchParams,
  next: { sort: string; order: "asc" | "desc" }
): string {
  const base = searchParamsToFundingListState(current);
  return fundingListHref({ ...base, sort: next.sort, order: next.order, page: 1 });
}

const SORT_COLUMNS: FundingListSortKey[] = [
  "title",
  "agency",
  "status",
  "posted_date",
  "close_date",
  "funding_instrument",
];

export const maxDuration = 60;

export default async function FundingOpportunitiesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const activeQuickFilters = quickFiltersFromSearchParams(searchParams);
  const closingDays = parseClosingDays(searchParams) ?? 30;
  const postedDays = parsePostedDays(searchParams) ?? 7;
  const updatedDays = parseUpdatedDays(searchParams) ?? 7;
  const scope = resolveListScope(searchParams);
  const sortState = parseListSort(searchParams);
  const rdFilterState = parseRdListFilters(searchParams);
  const agencySelection = agencySelectionFromSearchParams(searchParams);
  const noDepartmentsSelected = Boolean(agencySelection.noDepartmentsSelected);
  const hasAgencyFilter =
    !noDepartmentsSelected &&
    (agencySelection.departments.length > 0 ||
      !isDepartmentSubsEmpty(agencySelection.departmentSubs) ||
      agencySelection.legacyAgencies.length > 0);
  const qParam = firstStringParam(searchParams.q);
  const { page: requestedPage, perPage } = parseFundingListPagination(searchParams);

  const supabase = createClient();

  const { key: sortKey, dir: sortDir } = sortState;
  const asc = sortDir === "asc";
  const clientSortOnly = sortKey === "status";

  const [countResult, listFetch] = await Promise.all([
    supabase.from("funding_opportunities").select("id", { count: "exact", head: true }),
    fetchFundingListRows(supabase, {
      agencySelection,
      qParam,
      rdFilterState,
      sortKey,
      sortDir,
      clientSortOnly,
    }),
  ]);

  const fundingOppDbTotal = countResult.count;
  const {
    rows,
    error: listError,
    truncated: listTruncated,
    rdFiltersSkippedMigration,
    listIncludesActivityFamilies,
  } = listFetch;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Shared work is team-scoped; users without a team browse the catalog read-only.
  const teamId = user ? await getCurrentTeamId(supabase, user.id) : null;

  const dismissedOppIds = new Set<string>();
  if (user && teamId) {
    const { data: dismissedRows, error: dismissedError } = await fetchAllRows<{ opportunity_id: string }>(
      async (from, to) => {
        const res = await supabase
          .from("dismissed_funding_opportunities")
          .select("opportunity_id")
          .eq("team_id", teamId)
          .order("opportunity_id", { ascending: true })
          .range(from, to);
        return { data: res.data ?? [], error: res.error };
      },
      { maxRows: 50_000 }
    );
    if (!dismissedError) {
      for (const row of dismissedRows) {
        if (row.opportunity_id) dismissedOppIds.add(row.opportunity_id);
      }
    }
  }

  const today = new Date(new Date().toDateString());
  type FundingListRow = FundingListDbRow;
  const filtered = rows
    .filter((r) => !dismissedOppIds.has(r.id))
    .filter((r) => fundingListRowMatchesScope(fundingListRowScope(r, today), scope));

  const addDays = (base: Date, days: number) => new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
  const inDays = (iso: string | null, days: number) => {
    if (!iso) return false;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return false;
    return d >= today && d <= addDays(today, days);
  };
  const postedWithinDays = (iso: string | null, days: number) => {
    if (!iso) return false;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return false;
    return d >= addDays(today, -days) && d <= addDays(today, 1);
  };
  const isRowNewWithinDays = (row: FundingListRow, days: number) =>
    isNewWithinDays(
      {
        statusBucket: fundingListRowScope(row, today),
        postedDate: row.posted_date,
        updatedAt: resolveRowLastUpdatedAt(row),
      },
      days,
      postedWithinDays
    );
  const isRowUpdatedWithinDays = (row: FundingListRow, days: number) =>
    isUpdatedWithinDays(resolveRowLastUpdatedAt(row), days, postedWithinDays);

  function statusRank(bucket: FundingListRowBucket): number {
    if (bucket === "forecasted") return 0;
    if (bucket === "open") return 1;
    return 2;
  }

  const sorted = [...filtered];
  if (sortKey === "status") {
    sorted.sort((a, b) => {
      const ra = statusRank(
        fundingListRowScope(
          { status: a.status, close_date: a.close_date, forecasted: a.forecasted },
          today
        )
      );
      const rb = statusRank(
        fundingListRowScope(
          { status: b.status, close_date: b.close_date, forecasted: b.forecasted },
          today
        )
      );
      if (ra !== rb) {
        return asc ? ra - rb : rb - ra;
      }
      return String(a.title ?? "").localeCompare(String(b.title ?? ""));
    });
  }

  const tabbed = applyFundingQuickFilters(sorted, activeQuickFilters, {
    today,
    inDays,
    postedWithinDays,
    closingDays,
    postedDays,
    updatedDays,
  });

  const totalFiltered = tabbed.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / perPage));
  const effectivePage = Math.min(Math.max(1, requestedPage), totalPages);
  const pageSlice = tabbed.slice(
    (effectivePage - 1) * perPage,
    (effectivePage - 1) * perPage + perPage
  );

  const matchedOppIdsOnPage = new Set<string>();
  const savedSearchLinks: SavedSearchLink[] = [];
  let rdsgOwners: Awaited<ReturnType<typeof fetchActiveRdsgOwnersForAlerts>> = [];
  if (user) {
    const sliceIds = pageSlice.map((o) => o.id);
    const [searchesRes, matchedOnPageRes, rdsgOwnerRows] = await Promise.all([
      teamId ? fetchSavedFundingSearchesForTeam(supabase, teamId, 25) : Promise.resolve({ rows: [], error: null }),
      sliceIds.length > 0
        ? supabase
            .from("saved_opportunity_pi_matches")
            .select("opportunity_id")
            .eq("user_id", user.id)
            .in("opportunity_id", sliceIds)
        : Promise.resolve({ data: [] as { opportunity_id: string }[], error: null }),
      fetchActiveRdsgOwnersForAlerts(supabase),
    ]);

    rdsgOwners = rdsgOwnerRows;

    const searchRows = searchesRes.rows;
    const matchStats = await Promise.all(
      searchRows.map(async (row) => {
        const r = row as {
          state: unknown;
          last_viewed_at?: string | null;
          alert_forecasted_notices?: boolean | null;
        };
        const st = parseSavedFundingListState(r.state);
        if (!st) {
          return {
            newMatchesSinceViewed: 0,
            newResultsRecent: 0,
            lastMatchedAt: null as string | null,
            totalMatches: 0,
          };
        }
        return getSavedSearchMatchStats(supabase, st, {
          lastViewedAt: r.last_viewed_at ?? null,
          includeForecasted: r.alert_forecasted_notices !== false,
        });
      })
    );

    for (let i = 0; i < searchRows.length; i += 1) {
      const row = searchRows[i]!;
      const r = row as {
        id: string;
        name: string;
        state: unknown;
        email_notifications_enabled?: boolean | null;
        alert_frequency?: string | null;
        alert_forecasted_notices?: boolean | null;
        alert_rdsg_owner_ids?: string[] | null;
        last_viewed_at?: string | null;
        last_matched_at?: string | null;
      };
      const st = parseSavedFundingListState(r.state);
      const stats = matchStats[i]!;
      const href = st ? fundingListHref(st) : "/funding-opportunities";
      const currentListState = fundingListStateForBookmark(searchParamsToFundingListState(searchParams));
      const activeSavedSearch =
        st != null &&
        (currentListState.savedSearchId === r.id ||
          savedSearchStillActive(currentListState, href, r.id));
      const totalMatches = activeSavedSearch ? totalFiltered : stats.totalMatches;
      const frequency =
        r.alert_frequency === "instant" || r.alert_frequency === "daily" || r.alert_frequency === "weekly"
          ? r.alert_frequency
          : "weekly";
      savedSearchLinks.push({
        id: r.id,
        name: String(r.name ?? "Saved search"),
        href,
        filterSummary: st ? formatSavedSearchFilterSummary(st) : "All opportunities",
        emailNotificationsEnabled: Boolean(r.email_notifications_enabled),
        alertFrequency: frequency,
        alertForecastedNotices: r.alert_forecasted_notices !== false,
        alertRdsgOwnerIds: Array.isArray(r.alert_rdsg_owner_ids) ? r.alert_rdsg_owner_ids : [],
        createdAt: (row as { created_at?: string | null }).created_at ?? null,
        updatedAt: (row as { updated_at?: string | null }).updated_at ?? null,
        lastViewedAt: r.last_viewed_at ?? null,
        lastMatchedAt: stats.lastMatchedAt ?? r.last_matched_at ?? null,
        newMatchesSinceViewed: stats.newMatchesSinceViewed,
        newResultsRecent: stats.newResultsRecent,
        totalMatches,
      });
    }

    for (const row of matchedOnPageRes.data ?? []) {
      if (row.opportunity_id) matchedOppIdsOnPage.add(row.opportunity_id);
    }
  }

  const unscopedRows = rows;

  const openCount = filtered.filter((row) => fundingListRowScope(row, today) === "open").length;
  const forecastedCount = filtered.filter((row) => fundingListRowScope(row, today) === "forecasted").length;
  const activeInList = openCount + forecastedCount;
  const totalInList = unscopedRows.length;
  const hasListFilters =
    hasAgencyFilter || noDepartmentsSelected || qParam.trim().length > 0 || rdFiltersActive(rdFilterState);
  const totalOpportunities = hasListFilters ? totalInList : (fundingOppDbTotal ?? totalInList);

  const quickFilterCounts: FundingQuickFiltersCounts = {
    matched: filtered.filter((row) => isRecommendedMatch(row, inDays)).length,
    closing: {
      d30: filtered.filter((row) => inDays(row.close_date, 30)).length,
      d60: filtered.filter((row) => inDays(row.close_date, 60)).length,
      d90: filtered.filter((row) => inDays(row.close_date, 90)).length,
    },
    scope: {
      all: activeInList,
      open: openCount,
      forecasted: forecastedCount,
    },
    new: {
      week: filtered.filter((row) => isRowNewWithinDays(row, 7)).length,
      month: filtered.filter((row) => isRowNewWithinDays(row, 30)).length,
      quarter: filtered.filter((row) => isRowNewWithinDays(row, 90)).length,
    },
    updated: {
      week: filtered.filter((row) => isRowUpdatedWithinDays(row, 7)).length,
      month: filtered.filter((row) => isRowUpdatedWithinDays(row, 30)).length,
      quarter: filtered.filter((row) => isRowUpdatedWithinDays(row, 90)).length,
    },
    nih: filtered.filter((row) =>
      isNihFundingOpportunity({ agency: row.agency, agencyCode: row.agency_code })
    ).length,
    esi: filtered.filter((row) => isEsiCareerDevelopment(row)).length,
    collaborative: filtered.filter((row) => looksLargeCollaborativeGrant(row)).length,
    investigatorInitiated: filtered.filter((row) => isInvestigatorInitiated(row)).length,
    foundations: filtered.filter((row) => isFoundationOpportunity(row)).length,
  };

  const sortHrefs = Object.fromEntries(
    SORT_COLUMNS.map((column) => [
      column,
      buildFundingListUrl(searchParams, nextColumnSort(column, sortState)),
    ])
  ) as Record<FundingListSortKey, string>;

  const resultsTableRows: FundingListResultsRow[] = pageSlice.map((o) => {
    const row = o as FundingListRow;
    const bucket = fundingListRowScope(
      {
        status: row.status,
        close_date: row.close_date,
        forecasted: row.forecasted,
      },
      today
    );
    const closingUrgency: 30 | 60 | 90 | null =
      bucket === "forecasted"
        ? null
        : inDays(row.close_date, 30)
          ? 30
          : inDays(row.close_date, 60)
            ? 60
            : inDays(row.close_date, 90)
              ? 90
              : null;
    let closeDateLabel = formatDate(row.close_date);
    if (closingUrgency) {
      closeDateLabel = `${closeDateLabel} · ≤${closingUrgency}d`;
    }
    return {
      id: row.id,
      title: row.title,
      agencyDisplay: normalizeAgencyDisplayName(row.agency) ?? row.agency ?? "—",
      statusBucket: bucket,
      postedDate: resolveListPostedDate({
        statusBucket: bucket,
        postedDate: row.posted_date,
      }),
      estimatedOpenDate: resolveEstimatedOpenDate({
        statusBucket: bucket,
        postedDate: row.posted_date,
      }),
      updatedAt: resolveRowLastUpdatedAt(row),
      closeDate: row.close_date,
      closeDateLabel,
      closingUrgency,
      fundingInstrument: row.funding_instrument,
      activityFamilies: row.activity_families ?? null,
      sourceUrl: resolveFundingSourceUrl({
        source_system: row.source_system,
        source_opportunity_id: row.source_opportunity_id,
      }),
      isMatched: matchedOppIdsOnPage.has(row.id),
    };
  });

  return (
    <FundingOpportunityPeekProvider>
    <div className="mx-auto flex min-h-0 w-full max-w-full flex-1 flex-col">
        <header className="mb-8 pt-2">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-[var(--fo-ink-muted)]">
            Prospera
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--fo-title)] sm:text-4xl lg:text-[2.5rem] lg:leading-tight">
            Funding Opportunities
          </h1>
          <p className="mt-3 max-w-xl text-sm font-medium leading-relaxed text-[var(--fo-ink-body)] sm:text-base">
            Search, filter, and track grants matched to your research
          </p>
        </header>

        <div className="mb-6">
          <FundingListKeywordSearch editorial />
        </div>

        <FundingChatPanel />

        <div className="flex min-h-0 flex-1 flex-col gap-8 md:flex-row md:items-start md:gap-8 lg:gap-10 xl:gap-12">
          <div className="order-2 min-h-0 min-w-0 flex-1 space-y-8 md:order-1">
            {rdFiltersSkippedMigration || !listIncludesActivityFamilies ? (
              <div className="rounded-xl border border-[var(--fo-border)] border-l-[3px] border-l-[var(--fo-brand)] bg-[var(--fo-paper)] px-5 py-5 text-sm font-medium leading-relaxed text-[var(--fo-ink-body)] shadow-[var(--fo-shadow-surface)]">
                <p className="text-[0.95rem] font-bold tracking-tight text-[var(--fo-title)]">
                  Research triage data is not fully available
                </p>
                <p className="mt-2 text-[0.8125rem] font-medium text-[var(--fo-ink-body)]">
                  The database may be missing heuristic columns (for example{" "}
                  <code className="rounded-[12px] bg-[var(--fo-paper)] px-2 py-0.5 text-[0.7rem] font-semibold text-[var(--fo-title)] ring-1 ring-[var(--fo-border)]">
                    activity_families
                  </code>
                  ). Apply migration{" "}
                  <code className="rounded-[12px] bg-[var(--fo-paper)] px-2 py-0.5 text-[0.7rem] font-semibold text-[var(--fo-title)] ring-1 ring-[var(--fo-border)]">
                    20260418100000_funding_opportunities_rd_signals.sql
                  </code>{" "}
                  from{" "}
                  <code className="rounded-[12px] bg-[var(--fo-paper)] px-2 py-0.5 text-[0.7rem] font-semibold text-[var(--fo-title)] ring-1 ring-[var(--fo-border)]">
                    supabase/migrations/
                  </code>{" "}
                  in the Supabase SQL editor or via{" "}
                  <code className="rounded-[12px] bg-[var(--fo-paper)] px-2 py-0.5 text-[0.7rem] font-semibold text-[var(--fo-title)] ring-1 ring-[var(--fo-border)]">
                    supabase db push
                  </code>
                  , then run <strong className="font-bold text-[var(--fo-title)]">Extract features</strong> or a Simpler
                  sync.{" "}
                  {rdFiltersSkippedMigration ? "Your research triage filters were skipped for this request." : null}{" "}
                  {!listIncludesActivityFamilies
                    ? "The activity family column is hidden until those columns exist."
                    : null}{" "}
                  The table still uses keywords, agency, and opportunity scope.
                </p>
              </div>
            ) : null}

            {listTruncated ? (
              <div className="rounded-xl border border-[var(--fo-border)] border-l-[3px] border-l-amber-500 bg-[var(--fo-paper)] px-5 py-4 text-sm font-medium leading-relaxed text-[var(--fo-ink-body)] shadow-[var(--fo-shadow-surface)]">
                <p className="font-bold text-[var(--fo-title)]">List truncated</p>
                <p className="mt-1 text-[0.8125rem]">
                  More than {FUNDING_LIST_FETCH_MAX_ROWS.toLocaleString()} opportunities match your filters. Quick
                  filters and counts reflect the first {FUNDING_LIST_FETCH_MAX_ROWS.toLocaleString()} rows only —
                  narrow department or keyword filters to see a complete set.
                </p>
              </div>
            ) : null}

            {listError ? (
              <p className="text-sm text-red-700/90">{listError}</p>
            ) : (
              <section className="fo-panel">
                <div className="overflow-hidden rounded-t-[var(--fo-radius-lg)] border-b border-[var(--fo-border)] bg-[var(--fo-paper)] px-5 py-3 sm:px-6">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-base font-bold tracking-tight text-[var(--fo-title)]">
                      Results{" "}
                        <span className="font-semibold tabular-nums text-[var(--fo-interaction)]">({totalFiltered})</span>
                      <span className="ml-2 text-sm font-normal text-[var(--fo-ink-muted)]">
                        {totalOpportunities.toLocaleString()} total · {openCount.toLocaleString()} open ·{" "}
                        {forecastedCount.toLocaleString()} forecasted
                      </span>
                    </h2>
                    <p className="text-xs font-medium text-[var(--fo-ink-muted)]">
                      Sort by column headers · {perPage} per page
                    </p>
                  </div>
                </div>

                <Suspense fallback={null}>
                  <FundingListToolbar
                    counts={quickFilterCounts}
                    savedSearches={savedSearchLinks}
                    showSavedSearches={!!user}
                    rdsgOwners={rdsgOwners}
                  />
                </Suspense>

                {totalFiltered === 0 ? (
                  <div className="overflow-hidden rounded-b-[var(--fo-radius-lg)] px-5 py-8">
                    <EmptyState
                      title="No funding opportunities"
                      className="rounded-xl border border-dashed border-[var(--fo-border)] bg-[var(--fo-paper)]"
                      description={
                        rows.length > 0
                          ? "Nothing in this view matches your filters. Try changing opportunity scope."
                          : noDepartmentsSelected
                            ? "No departments are selected. Check at least one department, or choose All to search across every agency."
                            : hasAgencyFilter
                              ? "No stored notices for the selected departments. Clear filters or choose broader departments."
                              : "Run a Simpler sync after setting the API key."
                      }
                    />
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-b-[var(--fo-radius-lg)]">
                <FundingListResultsTable
                  rows={resultsTableRows}
                  loggedIn={!!user}
                  listIncludesActivityFamilies={listIncludesActivityFamilies}
                  sortState={sortState}
                  sortHrefs={sortHrefs}
                />
                <FundingListPagination
                  totalFiltered={totalFiltered}
                  effectivePage={effectivePage}
                  perPage={perPage}
                  editorial
                />
                  </div>
                )}
              </section>
            )}

            <details className="fo-panel group overflow-hidden">
              <summary className="cursor-pointer list-none px-5 py-4 text-[0.8125rem] font-semibold text-inherit transition-colors marker:content-none [&::-webkit-details-marker]:hidden hover:opacity-90">
                <span className="select-none">Data sync & extraction</span>
              </summary>
              <div className="border-t border-[var(--fo-divider)] bg-[var(--fo-paper-2)] px-5 py-5">
                <SimplerSyncControls editorial />
                <p className="mt-4 text-[0.75rem] font-medium leading-relaxed text-[var(--fo-ink-body)]">
                  Requires{" "}
                  <code className="rounded-[12px] bg-[var(--fo-paper)] px-2 py-0.5 text-[0.7rem] font-semibold text-[var(--fo-title)] ring-1 ring-[var(--fo-border)]">
                    SIMPLER_GRANTS_API_KEY
                  </code>
                  . Each run requests up to {DEFAULT_MAX_NOFOS_PER_SYNC} posted or forecasted notices (closed and
                  archived are not pulled). Compare upserted count to the API total in the log when pagination
                  finishes.
                </p>
              </div>
            </details>
          </div>

          <aside className="order-1 w-full shrink-0 self-start md:order-2 md:w-[min(100%,20rem)] lg:w-[min(100%,21rem)] xl:w-80">
            <div className="fo-filter-rail overflow-hidden">
              <div className="fo-filter-rail-header px-5 py-5">
                <p className="text-[0.65rem] font-bold uppercase tracking-[0.16em] text-inherit opacity-95">
                  Refine
                </p>
                <p className="mt-1 text-[0.8125rem] font-semibold leading-snug text-inherit">
                  Narrow your list
                </p>
                <p className="mt-1 text-[0.75rem] leading-snug text-inherit opacity-90">
                  Sort, agency scope, and research triage filters
                </p>
              </div>
              <div className="px-4 py-5 pb-6 sm:px-5">
                <FundingOpportunitiesFiltersPanel editorial />
                <FundingSearchBookmarksRail />
              </div>
            </div>
          </aside>
        </div>

        <FundingOpportunityPeekPanel loggedIn={!!user} />
    </div>
    </FundingOpportunityPeekProvider>
  );
}
