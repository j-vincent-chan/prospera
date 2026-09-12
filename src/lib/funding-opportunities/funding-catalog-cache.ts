/**
 * Catalog-wide answers shared across renders of /opportunities and Home.
 *
 * Every navigation on /opportunities used to recount each of the team's
 * saved searches — two exact-count scans of the catalog per chip, an ILIKE
 * over every description for a keyword search — plus the whole-table count
 * and the last sync stamp, although none of those depend on the URL. With
 * five chips that was twelve catalog scans racing the list query on a
 * shared-CPU database, on every dropdown change and every chip click.
 *
 * Next's data cache keeps each answer for a while. A chip count is keyed by
 * the filters the count actually reads, the search's last-viewed stamp and
 * the day (the scope filter compares close dates with today), so editing or
 * opening a saved search changes its key and the answer is fresh at once.
 * New notices only arrive through the Simpler sync, whose entry points call
 * {@link revalidateFundingCatalogCache} when they finish; the TTLs are a
 * backstop for writers outside a Next request (scripts, backfills).
 *
 * The cached queries run with the service-role client: the catalog is
 * readable by every signed-in user (`funding_opportunities_all_authenticated`),
 * so a shared answer exposes nothing the caller could not query directly,
 * and a cached function cannot read request cookies anyway. Outside a Next
 * request or without a service key the live query runs as before.
 */
import { revalidateTag, unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSavedSearchMatchStats, type SavedSearchMatchStats } from "@/lib/funding-opportunities/funding-search-notification-query";
import type { FundingListClientState } from "@/lib/funding-opportunities/funding-list-url";
import { createServiceRoleClient } from "@/lib/supabase/admin-service";

/** Tag on every cached catalog answer; the sync invalidates it when new notices land. */
export const FUNDING_CATALOG_CACHE_TAG = "funding-catalog";

/** Chip counts: a backstop for catalog writes that bypass the sync entry points. */
const MATCH_STATS_TTL_SECONDS = 15 * 60;
/** Header facts (row count, last sync): the sync revalidates; this only bounds staleness otherwise. */
const HEADER_TTL_SECONDS = 10 * 60;

/** The subset of a saved search's state that `getSavedSearchMatchStats` reads — quick filters, sort and paging do not change the count. */
export function savedSearchMatchStatsKey(state: FundingListClientState): string {
  const subs = Object.keys(state.departmentSubs)
    .sort()
    .reduce<Record<string, string[]>>((acc, dept) => {
      acc[dept] = [...(state.departmentSubs[dept] ?? [])].sort();
      return acc;
    }, {});
  return JSON.stringify({
    q: state.q,
    scope: state.scope,
    departments: [...state.departments].sort(),
    departmentSubs: subs,
    legacyAgencies: [...state.legacyAgencies].sort(),
    noDepartmentsSelected: Boolean(state.noDepartmentsSelected),
    rd: state.rd,
  });
}

const cachedMatchStats = unstable_cache(
  // `dayIso` is part of the cache key only: the count compares close dates with today.
  async (stateKey: string, lastViewedAt: string | null, includeForecasted: boolean, dayIso: string): Promise<SavedSearchMatchStats> => {
    void dayIso;
    const db = createServiceRoleClient();
    if (!db) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
    return getSavedSearchMatchStats(db, JSON.parse(stateKey) as FundingListClientState, { lastViewedAt, includeForecasted, throwOnError: true });
  },
  ["saved-search-match-stats"],
  { revalidate: MATCH_STATS_TTL_SECONDS, tags: [FUNDING_CATALOG_CACHE_TAG] },
);

/**
 * `getSavedSearchMatchStats` through the data cache. Same inputs, same
 * answer; the request-scoped client is only used when the cache is
 * unavailable.
 */
export async function loadSavedSearchMatchStats(
  supabase: SupabaseClient,
  state: FundingListClientState,
  input: { lastViewedAt?: string | null; includeForecasted?: boolean },
): Promise<SavedSearchMatchStats> {
  const lastViewedAt = input.lastViewedAt?.trim() || null;
  const includeForecasted = input.includeForecasted !== false;
  try {
    return await cachedMatchStats(savedSearchMatchStatsKey(state), lastViewedAt, includeForecasted, new Date().toISOString().slice(0, 10));
  } catch {
    return getSavedSearchMatchStats(supabase, state, { lastViewedAt, includeForecasted });
  }
}

export type FundingCatalogHeader = {
  /** Every notice in the catalog, closed ones included. */
  total: number;
  /** The most recent Simpler sync run. */
  lastSync: { finished_at: string | null; started_at: string | null; status: string | null } | null;
};

async function queryCatalogHeader(db: SupabaseClient, opts: { throwOnError: boolean }): Promise<FundingCatalogHeader> {
  const [countAll, lastSync] = await Promise.all([
    db.from("funding_opportunities").select("id", { count: "exact", head: true }),
    db.from("sync_job_logs").select("finished_at, started_at, status").eq("job_type", "simpler_grants_sync").order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const error = countAll.error ?? lastSync.error;
  if (error && opts.throwOnError) throw new Error(error.message);
  return { total: countAll.count ?? 0, lastSync: (lastSync.data as FundingCatalogHeader["lastSync"]) ?? null };
}

const cachedCatalogHeader = unstable_cache(
  async (): Promise<FundingCatalogHeader> => {
    const db = createServiceRoleClient();
    if (!db) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
    return queryCatalogHeader(db, { throwOnError: true });
  },
  ["funding-catalog-header"],
  { revalidate: HEADER_TTL_SECONDS, tags: [FUNDING_CATALOG_CACHE_TAG] },
);

/** Catalog size and last sync for the page header, through the data cache. */
export async function loadFundingCatalogHeader(supabase: SupabaseClient): Promise<FundingCatalogHeader> {
  try {
    return await cachedCatalogHeader();
  } catch {
    return queryCatalogHeader(supabase, { throwOnError: false });
  }
}

/**
 * Drop every cached catalog answer. Called where a sync finishes inside a
 * Next request (cron routes, server actions); a no-op anywhere else.
 */
export function revalidateFundingCatalogCache(): void {
  try {
    revalidateTag(FUNDING_CATALOG_CACHE_TAG);
  } catch {
    // Outside a request (scripts): nothing is cached there to drop.
  }
}
