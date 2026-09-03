import { redirect } from "next/navigation";
import { OpportunitiesScreen, type FilterGroup, type SavedSearchChip } from "@/components/opportunities/opportunities-screen";
import { TOP_LEVEL_DEPARTMENTS } from "@/lib/funding-opportunities/agency-taxonomy";
import { getSubcomponentsForDepartment } from "@/lib/funding-opportunities/department-subcomponents";
import { fetchFundingListRows } from "@/lib/funding-opportunities/fetch-funding-list-rows";
import { applyFundingQuickFilters } from "@/lib/funding-opportunities/funding-quick-filters";
import { fundingListHref, agencySelectionFromSearchParams, isDepartmentSubsEmpty, type FundingListClientState } from "@/lib/funding-opportunities/funding-list-url";
import { getSavedSearchMatchStats } from "@/lib/funding-opportunities/funding-search-notification-query";
import { isoToday } from "@/lib/funding-opportunities/receipt-cycles";
import type { SearchParams } from "@/lib/funding-opportunities/rd-list-filters";
import { fundingListStateForBookmark, parseSavedFundingListState, formatSavedSearchFilterSummary } from "@/lib/funding-opportunities/saved-funding-list-state";
import { fetchSavedFundingSearchesForTeam } from "@/lib/funding-opportunities/saved-funding-search-query";
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";
import { createClient } from "@/lib/supabase/server";
import { activeChips, clearAllHref, opportunitiesHref, parseOpportunitiesState, type OpportunitiesListState } from "@/lib/opportunities/list-state";
import { buildRowModel, sortByNextDue, type OpportunityRowModel } from "@/lib/opportunities/list-model";
import { loadWorkspaceContext } from "@/lib/team/current-team";

export const maxDuration = 60;

const CAREER_OPTIONS = [
  { value: "early_stage_investigator", label: "Early-stage investigator" },
  { value: "new_investigator", label: "New investigator" },
  { value: "established_pi", label: "Established" },
];
const TRIAL_OPTIONS = [
  { value: "required", label: "Required" },
  { value: "allowed", label: "Optional" },
  { value: "not_allowed", label: "Not allowed" },
];
const COLLAB_OPTIONS = [
  { value: "single_pi", label: "Single PI" },
  { value: "multi_pi", label: "Multi-PI / team" },
  { value: "center_like", label: "Center / consortium" },
];
const ACTIVITY_OPTIONS = [
  { value: "R", label: "R (research)" },
  { value: "K", label: "K (career)" },
  { value: "U", label: "U (cooperative)" },
  { value: "P", label: "P (program)" },
  { value: "F", label: "F (fellowship)" },
  { value: "T", label: "T (training)" },
  { value: "DP", label: "DP (director's awards)" },
];

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function buildFilterGroups(state: OpportunitiesListState): FilterGroup[] {
  const list = state.list;
  const href = (patch: Partial<FundingListClientState>) => opportunitiesHref({ ...state, list: { ...list, ...patch } });

  const deptOptions = TOP_LEVEL_DEPARTMENTS.map((d) => {
    const on = list.departments.includes(d.id);
    const departments = toggle(list.departments, d.id);
    const departmentSubs = { ...list.departmentSubs };
    if (on) delete departmentSubs[d.id];
    return { value: d.id, label: d.label, on, href: href({ departments, departmentSubs, allDepartments: departments.length === 0, noDepartmentsSelected: false, legacyAgencies: [] }) };
  });

  const nihSubs = getSubcomponentsForDepartment("hhs");
  const nihIcOptions = list.rd.nihIc.length || true
    ? ["NIAID", "NCI", "NIAMS", "NHLBI", "NIDDK", "NINDS", "NIMH", "NIA", "NICHD", "NIEHS", "NHGRI", "NIBIB", "NCATS", "NIMHD", "NIDA", "NIDCR", "NEI", "NLM"].map((ic) => ({
        value: ic,
        label: ic,
        on: list.rd.nihIc.includes(ic),
        href: href({ rd: { ...list.rd, nihIc: toggle(list.rd.nihIc, ic) } }),
      }))
    : [];

  const summaryOf = (opts: Array<{ label: string; on: boolean }>) => {
    const on = opts.filter((o) => o.on).map((o) => o.label);
    return on.length === 0 ? "Any" : on.length <= 2 ? on.join(", ") : `${on.length} selected`;
  };

  const groups: FilterGroup[] = [
    { title: "Agency", param: "dept", options: deptOptions, summary: summaryOf(deptOptions), open: deptOptions.some((o) => o.on) },
    { title: "NIH institute", param: "ic", options: nihIcOptions, summary: summaryOf(nihIcOptions), open: nihIcOptions.some((o) => o.on) },
    {
      title: "Activity code",
      param: "activity",
      options: ACTIVITY_OPTIONS.map((o) => ({ ...o, on: list.rd.activityFamilies.includes(o.value), href: href({ rd: { ...list.rd, activityFamilies: toggle(list.rd.activityFamilies, o.value) } }) })),
      summary: "",
      open: false,
    },
    {
      title: "Career stage",
      param: "inv",
      options: CAREER_OPTIONS.map((o) => ({ ...o, on: list.rd.investigatorTags.includes(o.value), href: href({ rd: { ...list.rd, investigatorTags: toggle(list.rd.investigatorTags, o.value) } }) })),
      summary: "",
      open: false,
    },
    {
      title: "Clinical trial",
      param: "trial",
      options: TRIAL_OPTIONS.map((o) => ({ ...o, on: list.rd.clinicalTrialMode === o.value, href: href({ rd: { ...list.rd, clinicalTrialMode: list.rd.clinicalTrialMode === o.value ? null : (o.value as FundingListClientState["rd"]["clinicalTrialMode"]) } }) })),
      summary: "",
      open: false,
    },
    {
      title: "Collaboration",
      param: "collab",
      options: COLLAB_OPTIONS.map((o) => ({ ...o, on: list.rd.collaborations.includes(o.value), href: href({ rd: { ...list.rd, collaborations: toggle(list.rd.collaborations, o.value) } }) })),
      summary: "",
      open: false,
    },
  ];
  for (const g of groups) {
    if (!g.summary) g.summary = summaryOf(g.options);
    if (!g.open) g.open = g.options.some((o) => o.on);
  }
  void nihSubs;
  return groups;
}

function departmentLabel(ids: string[], subs: FundingListClientState["departmentSubs"]): string | null {
  const parts: string[] = [];
  for (const id of ids) {
    const dept = TOP_LEVEL_DEPARTMENTS.find((d) => d.id === id);
    const subIds = subs[id] ?? [];
    const subLabels = subIds.map((s) => getSubcomponentsForDepartment(id).find((x) => x.id === s)?.label ?? s.toUpperCase());
    parts.push(subLabels.length ? subLabels.join(", ") : (dept?.label ?? id.toUpperCase()));
  }
  return parts.length ? parts.join(" · ") : null;
}

function rdLabels(list: FundingListClientState): string[] {
  const out: string[] = [];
  if (list.rd.nihIc.length) out.push(`Institute: ${list.rd.nihIc.join(", ")}`);
  if (list.rd.activityFamilies.length) out.push(`Activity: ${list.rd.activityFamilies.join(", ")}`);
  if (list.rd.investigatorTags.length) out.push(CAREER_OPTIONS.filter((o) => list.rd.investigatorTags.includes(o.value)).map((o) => o.label).join(", "));
  if (list.rd.clinicalTrialMode) out.push(`Clinical trial: ${TRIAL_OPTIONS.find((o) => o.value === list.rd.clinicalTrialMode)?.label ?? list.rd.clinicalTrialMode}`);
  if (list.rd.collaborations.length) out.push(COLLAB_OPTIONS.filter((o) => list.rd.collaborations.includes(o.value)).map((o) => o.label).join(", "));
  return out;
}

export default async function OpportunitiesPage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const context = await loadWorkspaceContext(supabase, user.id);
  const team = context?.current ?? null;
  const teamId = team?.teamId ?? null;

  const state = parseOpportunitiesState(searchParams);
  const today = isoToday();
  const agencySelection = agencySelectionFromSearchParams(searchParams);
  const sortKey = state.list.sort as Parameters<typeof fetchFundingListRows>[1]["sortKey"];
  const sortDir = state.list.order;

  const [countAll, lastSync, listFetch, savedRows, dismissedRows, watchedRows, savedSearches] = await Promise.all([
    supabase.from("funding_opportunities").select("id", { count: "exact", head: true }),
    supabase.from("sync_job_logs").select("finished_at, started_at, status").eq("job_type", "simpler_grants_sync").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    state.scope === "federal"
      ? fetchFundingListRows(supabase, { agencySelection, qParam: state.list.q, rdFilterState: state.list.rd, sortKey: sortKey === "status" ? "next_due" : sortKey, sortDir, clientSortOnly: sortKey === "status" })
      : Promise.resolve({ rows: [], error: null, truncated: false, rdFiltersSkippedMigration: false, listIncludesActivityFamilies: false }),
    teamId ? supabase.from("saved_funding_opportunities").select("opportunity_id").eq("team_id", teamId) : Promise.resolve({ data: [] as Array<{ opportunity_id: string }> }),
    teamId
      ? fetchAllRows<{ opportunity_id: string }>(async (from, to) => {
          const res = await supabase.from("dismissed_funding_opportunities").select("opportunity_id").eq("team_id", teamId).order("opportunity_id").range(from, to);
          return { data: res.data ?? [], error: res.error };
        }, { maxRows: 50_000 })
      : Promise.resolve({ data: [] as Array<{ opportunity_id: string }>, error: null }),
    teamId ? supabase.from("opportunity_watches").select("opportunity_id").eq("team_id", teamId) : Promise.resolve({ data: [] as Array<{ opportunity_id: string }> }),
    teamId ? fetchSavedFundingSearchesForTeam(supabase, teamId, 25) : Promise.resolve({ rows: [], error: null }),
  ]);

  const flags = {
    savedIds: new Set(((savedRows.data ?? []) as Array<{ opportunity_id: string }>).map((r) => r.opportunity_id)),
    dismissedIds: new Set((dismissedRows.data ?? []).map((r) => r.opportunity_id)),
    watchedIds: new Set(((watchedRows.data ?? []) as Array<{ opportunity_id: string }>).map((r) => r.opportunity_id)),
  };

  // Status + window filters, dismissed, quick filters, then sort and page.
  const todayDate = new Date(`${today}T00:00:00`);
  const inDays = (iso: string | null, days: number) => Boolean(iso && iso >= today && iso <= new Date(todayDate.getTime() + days * 86_400_000).toISOString().slice(0, 10));
  const postedWithin = (iso: string | null, days: number) => Boolean(iso && iso >= new Date(todayDate.getTime() - days * 86_400_000).toISOString().slice(0, 10));

  let models: OpportunityRowModel[] = listFetch.rows.map((r) => buildRowModel(r, flags, today));
  const openCount = models.filter((m) => m.statusBucket === "open").length;
  const forecastedCount = models.filter((m) => m.statusBucket === "forecasted").length;
  const newThisWeek = models.filter((m) => postedWithin(m.postedDate, 7)).length;

  models = models.filter((m) => {
    if (state.status === "open" && m.statusBucket !== "open") return false;
    if (state.status === "forecasted" && m.statusBucket !== "forecasted") return false;
    if (state.status === "open_forecasted" && m.statusBucket === "closed") return false;
    if (state.closing && !inDays(m.nextDue, state.closing)) return false;
    if (state.posted && !postedWithin(m.postedDate, state.posted)) return false;
    return state.dismissed ? m.dismissed : !m.dismissed;
  });

  const quickRows = applyFundingQuickFilters(
    listFetch.rows.filter((r) => models.some((m) => m.id === r.id)),
    state.list.tabs,
    { today: todayDate, inDays: (iso, d) => inDays(iso, d), postedWithinDays: (iso, d) => postedWithin(iso, d), closingDays: state.list.closingDays ?? 30, postedDays: state.list.postedDays ?? 7, updatedDays: state.list.updatedDays ?? 7 },
  );
  const keep = new Set(quickRows.map((r) => r.id));
  models = models.filter((m) => keep.has(m.id));

  if (sortKey === "next_due" || sortKey === "close_date") models = sortByNextDue(models, sortDir === "asc");
  else if (sortKey === "status") models.sort((a, b) => (sortDir === "asc" ? 1 : -1) * a.statusLabel.localeCompare(b.statusLabel) || a.title.localeCompare(b.title));

  const total = models.length;
  const perPage = state.list.perPage;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const pageIndex = Math.min(Math.max(1, state.list.page), totalPages);
  const rows = models.slice((pageIndex - 1) * perPage, pageIndex * perPage);

  // Saved searches strip.
  const currentBookmark = fundingListStateForBookmark(state.list);
  const savedSearchChips: SavedSearchChip[] = await Promise.all(
    savedSearches.rows.map(async (row) => {
      const r = row as { id: string; name: string; state: unknown; last_viewed_at?: string | null; alert_forecasted_notices?: boolean | null };
      const st = parseSavedFundingListState(r.state);
      const stats = st ? await getSavedSearchMatchStats(supabase, st, { lastViewedAt: r.last_viewed_at ?? null, includeForecasted: r.alert_forecasted_notices !== false }) : { newMatchesSinceViewed: 0 };
      const href = st ? fundingListHref({ ...st, savedSearchId: r.id }).replace(/^\/funding-opportunities/, "/opportunities") : "/opportunities";
      return { id: r.id, name: r.name, href, newMatches: stats.newMatchesSinceViewed, active: currentBookmark.savedSearchId === r.id || state.list.savedSearchId === r.id };
    }),
  );

  const lastSyncRow = lastSync.data as { finished_at?: string | null; started_at?: string | null } | null;
  const dismissedCount = flags.dismissedIds.size;

  return (
    <OpportunitiesScreen
      state={state}
      team={team ? { id: team.teamId, name: team.team.name, routing: { days: team.team.routingDays, dayType: team.team.routingDayType, holidayCalendar: team.team.routingHolidayCalendar } } : null}
      header={{ total: countAll.count ?? 0, syncedAt: lastSyncRow?.finished_at ?? lastSyncRow?.started_at ?? null, newThisWeek }}
      counts={{ federal: countAll.count ?? 0, internal: 0, limited: 0, open: openCount, forecasted: forecastedCount, results: total, dismissed: dismissedCount }}
      rows={rows}
      page={{ index: pageIndex, perPage, total }}
      sort={{ key: sortKey, dir: sortDir }}
      chips={activeChips(state, { departments: departmentLabel, rd: rdLabels })}
      clearAllHref={clearAllHref(state)}
      savedSearches={savedSearchChips}
      filterGroups={buildFilterGroups(state)}
      savedSearchSummary={formatSavedSearchFilterSummary(currentBookmark)}
      listStateForSave={currentBookmark}
      peekId={typeof searchParams.peek === "string" ? searchParams.peek : null}
      hasAgencyFilter={!agencySelection.noDepartmentsSelected && (agencySelection.departments.length > 0 || !isDepartmentSubsEmpty(agencySelection.departmentSubs))}
      truncated={listFetch.truncated}
    />
  );
}
