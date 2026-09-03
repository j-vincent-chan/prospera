"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import {
  askOpportunitiesAction,
  dismissOpportunitiesAction,
  restoreOpportunitiesAction,
  saveOpportunitiesAction,
  setWatchAction,
  type AskOutcome,
} from "@/app/actions/opportunity-actions";
import { FiltersDrawer } from "@/components/opportunities/filters-drawer";
import { OpportunityPeek } from "@/components/opportunities/opportunity-peek";
import { SaveSearchDialog } from "@/components/opportunities/save-search-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Pill, type PillVariant } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, type SortDirection } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import type { FundingChatMessage } from "@/lib/ai/funding-chat";
import type { FundingListSortKey } from "@/lib/funding-opportunities/funding-list-url";
import type { RoutingRule } from "@/lib/funding-opportunities/receipt-cycles";
import type { OpportunityRowModel } from "@/lib/opportunities/list-model";
import { opportunitiesHref, type ActiveChip, type OpportunitiesListState, type OpportunityScope } from "@/lib/opportunities/list-state";
import { cn } from "@/lib/utils/cn";

export type FilterGroup = {
  title: string;
  param: string;
  summary: string;
  open: boolean;
  options: Array<{ value: string; label: string; on: boolean; href: string }>;
};

export type SavedSearchChip = { id: string; name: string; href: string; newMatches: number; active: boolean };

type Props = {
  state: OpportunitiesListState;
  team: { id: string; name: string; routing: RoutingRule } | null;
  header: { total: number; syncedAt: string | null; newThisWeek: number };
  counts: { federal: number; internal: number; limited: number; open: number; forecasted: number; results: number; dismissed: number };
  rows: OpportunityRowModel[];
  page: { index: number; perPage: number; total: number };
  sort: { key: FundingListSortKey; dir: "asc" | "desc" };
  chips: ActiveChip[];
  clearAllHref: string;
  savedSearches: SavedSearchChip[];
  filterGroups: FilterGroup[];
  savedSearchSummary: string;
  listStateForSave: unknown;
  peekId: string | null;
  hasAgencyFilter: boolean;
  truncated: boolean;
};

const STATUS_PILL: Record<OpportunityRowModel["statusLabel"], PillVariant> = { Open: "status-open", Forecasted: "status-forecasted", Closed: "status-closed" };

function fmtSynced(iso: string | null): string {
  if (!iso) return "sync time unknown";
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
  return sameDay ? `today, ${time}` : `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" })}, ${time}`;
}

const nf = new Intl.NumberFormat("en-US");

export function OpportunitiesScreen(props: Props) {
  const { state, rows, counts, page, sort, chips, savedSearches } = props;
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  const [mode, setMode] = useState<"search" | "ask">(state.mode);
  const [query, setQuery] = useState(state.list.q);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [askState, setAskState] = useState<{ status: "idle" | "thinking"; outcome: AskOutcome | null; question: string }>({ status: "idle", outcome: null, question: "" });
  const [restrictTo, setRestrictTo] = useState<Set<string> | null>(null);
  const [saveSearchName, setSaveSearchName] = useState<string | null>(null);

  useEffect(() => setSelected(new Set()), [rows]);
  useEffect(() => setQuery(state.list.q), [state.list.q]);

  const go = (next: OpportunitiesListState, opts?: { keepPage?: boolean; peek?: string | null }) => router.push(opportunitiesHref(next, opts));
  const setScope = (scope: OpportunityScope) => go({ ...state, scope });

  const visibleRows = useMemo(() => (restrictTo ? rows.filter((r) => restrictTo.has(r.id)) : rows), [rows, restrictTo]);
  const allSelected = visibleRows.length > 0 && visibleRows.every((r) => selected.has(r.id));

  const sortHref = (key: FundingListSortKey) => {
    const dir = sort.key === key ? (sort.dir === "asc" ? "desc" : "asc") : key === "posted_date" ? "desc" : "asc";
    return opportunitiesHref({ ...state, list: { ...state.list, sort: key, order: dir } });
  };
  const sortFor = (key: FundingListSortKey): SortDirection | null => (sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : null);

  // ----- actions -----
  const withIds = (ids: string[]) => ids.filter(Boolean);
  const titleOf = (id: string) => rows.find((r) => r.id === id)?.title ?? "opportunity";
  const short = (t: string) => (t.length > 44 ? `${t.slice(0, 42)}…` : t);

  const dismiss = (ids: string[]) =>
    startTransition(async () => {
      const result = await dismissOpportunitiesAction({ opportunityIds: withIds(ids) });
      if (!result.ok) return toast({ tone: "error", message: result.error });
      const message = ids.length === 1 ? `Dismissed “${short(titleOf(ids[0]!))}”. Hidden from your results.` : `Dismissed ${ids.length} opportunities. Hidden from your results.`;
      toast({ message, action: { label: "Undo", onClick: () => startTransition(async () => { await restoreOpportunitiesAction({ opportunityIds: ids }); router.refresh(); }) } });
      setSelected(new Set());
      if (props.peekId && ids.includes(props.peekId)) go(state, { keepPage: true, peek: null });
      else router.refresh();
    });

  const restore = (ids: string[]) =>
    startTransition(async () => {
      const result = await restoreOpportunitiesAction({ opportunityIds: withIds(ids) });
      if (!result.ok) return toast({ tone: "error", message: result.error });
      toast({ message: ids.length === 1 ? `Restored “${short(titleOf(ids[0]!))}”` : `Restored ${ids.length} opportunities`, action: { label: "Undo", onClick: () => startTransition(async () => { await dismissOpportunitiesAction({ opportunityIds: ids }); router.refresh(); }) } });
      router.refresh();
    });

  const save = (ids: string[], saved: boolean) =>
    startTransition(async () => {
      const result = await saveOpportunitiesAction({ opportunityIds: withIds(ids), saved });
      if (!result.ok) return toast({ tone: "error", message: result.error });
      toast({
        message: saved ? (ids.length === 1 ? `Saved to outreach · Triage` : `Saved ${ids.length} to outreach · Triage`) : ids.length === 1 ? "Removed from outreach" : `Removed ${ids.length} from outreach`,
        action: saved ? { label: "Open", onClick: () => router.push("/outreach") } : { label: "Undo", onClick: () => startTransition(async () => { await saveOpportunitiesAction({ opportunityIds: ids, saved: true }); router.refresh(); }) },
      });
      setSelected(new Set());
      router.refresh();
    });

  const watch = (ids: string[], watching: boolean) =>
    startTransition(async () => {
      const result = await setWatchAction({ opportunityIds: withIds(ids), watching });
      if (!result.ok) return toast({ tone: "error", message: result.error });
      toast({ message: watching ? (ids.length === 1 ? "Watching next cycle" : `Watching ${ids.length} for the next cycle`) : "Stopped watching", action: { label: "Undo", onClick: () => startTransition(async () => { await setWatchAction({ opportunityIds: ids, watching: !watching }); router.refresh(); }) } });
      setSelected(new Set());
      router.refresh();
    });

  const shareList = (ids: string[]) => {
    const text = ids.map((id) => `${titleOf(id)}\n${window.location.origin}/opportunities/${id}`).join("\n\n");
    navigator.clipboard.writeText(text).then(() => toast({ message: ids.length === 1 ? "Link copied" : `${ids.length} links copied` }));
  };

  const submitSearch = () => go({ ...state, mode: "search", list: { ...state.list, q: query.trim() } });

  const ask = (question: string) => {
    const q = question.trim();
    if (!q) return;
    setAskState({ status: "thinking", outcome: null, question: q });
    setRestrictTo(null);
    startTransition(async () => {
      const messages: FundingChatMessage[] = [{ role: "user", content: q }];
      const result = await askOpportunitiesAction({ messages });
      if (!result.ok) return setAskState({ status: "idle", outcome: { kind: "error", message: result.error }, question: q });
      setAskState({ status: "idle", outcome: result.outcome, question: q });
    });
  };

  const askSources = askState.outcome?.kind === "answer" ? askState.outcome.sources : [];

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-h1 font-semibold text-ink">Opportunities</h1>
          <p className="mb-0 mt-1.5 text-body text-ink-muted">
            {nf.format(props.header.total)} opportunities ·{" "}
            <Link href="/team/data-sources" className="text-ink-muted hover:text-navy">synced from Simpler.Grants.gov {fmtSynced(props.header.syncedAt)}</Link>
            {props.header.newThisWeek > 0 ? ` · ${nf.format(props.header.newThisWeek)} new this week` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => { setSaveSearchName(null); setSaveOpen(true); }} disabled={!props.team}>Save search</Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div role="tablist" className="inline-flex gap-0.5 rounded-tile bg-navy-nav p-[3px]">
          {([
            ["federal", "Federal", counts.federal],
            ["internal", "Internal (UCSF)", counts.internal],
            ["limited", "Limited submissions", counts.limited],
          ] as const).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={state.scope === key}
              onClick={() => setScope(key)}
              className={cn("h-[30px] whitespace-nowrap rounded-control border-0 px-3 text-dense font-medium", state.scope === key ? "bg-card text-ink shadow-[0_1px_2px_rgba(11,29,58,0.12)]" : "bg-transparent text-ink-body")}
            >
              {label} <span className="opacity-70">· {nf.format(count)}</span>
            </button>
          ))}
        </div>
        <p className="m-0 text-meta text-ink-muted">
          {state.scope === "federal"
            ? `Synced from Simpler.Grants.gov · ${fmtSynced(props.header.syncedAt)} · read-only system of record`
            : state.scope === "internal"
              ? "Curated by UCSF Curators · nothing published yet"
              : "Sponsor notices synced · UCSF process curated from InfoReady · nothing published yet"}
        </p>
      </div>

      {state.scope === "federal" ? (
        <>
          <div className="flex items-center gap-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (mode === "ask") ask(query);
                else submitSearch();
              }}
              className="flex h-9 max-w-[680px] flex-1 overflow-hidden rounded-control border border-line-control bg-card"
            >
              <div className="flex shrink-0 gap-0.5 border-r border-line bg-canvas p-[3px]">
                {(["search", "ask"] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setMode(m)} className={cn("h-7 rounded-[4px] border-0 px-2.5 text-dense font-medium", mode === m ? "bg-navy text-white" : "bg-transparent text-ink-muted")}>
                    {m === "search" ? "Search" : "Ask"}
                  </button>
                ))}
              </div>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={mode === "ask" ? "Ask about deadlines, fit, agencies, or strategy…" : "Search title, keyword, opportunity number, agency…"}
                className="h-full min-w-0 flex-1 border-0 bg-transparent px-3 text-body text-ink outline-none placeholder:text-ink-muted"
              />
            </form>
            <Select value={state.status} onChange={(e) => go({ ...state, status: e.target.value as OpportunitiesListState["status"] })} aria-label="Status">
              <option value="open_forecasted">Open &amp; forecasted</option>
              <option value="open">Open only</option>
              <option value="forecasted">Forecasted only</option>
              <option value="all">All statuses</option>
            </Select>
            <Select value={state.closing ?? ""} onChange={(e) => go({ ...state, closing: (Number(e.target.value) || null) as OpportunitiesListState["closing"] })} aria-label="Closing">
              <option value="">Closing: any</option>
              <option value="30">Within 30 days</option>
              <option value="60">Within 60 days</option>
              <option value="90">Within 90 days</option>
            </Select>
            <Select value={state.posted ?? ""} onChange={(e) => go({ ...state, posted: (Number(e.target.value) || null) as OpportunitiesListState["posted"] })} aria-label="Posted">
              <option value="">Posted: any</option>
              <option value="7">This week</option>
              <option value="30">This month</option>
              <option value="90">This quarter</option>
            </Select>
            <Button variant="secondary" onClick={() => setFiltersOpen(true)} icon={<FilterIcon />}>
              More filters
              {props.filterGroups.some((g) => g.options.some((o) => o.on)) ? (
                <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-navy px-1.5 text-micro text-white">
                  {props.filterGroups.reduce((n, g) => n + g.options.filter((o) => o.on).length, 0)}
                </span>
              ) : null}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {chips.length > 0 ? <span className="mr-1 text-meta text-ink-muted">Active</span> : null}
            {chips.map((c) => (
              <Link key={c.key} href={c.href} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-teal bg-teal-tint py-0 pl-2.5 pr-1.5 text-dense font-medium text-teal">
                {c.label}
                <CloseGlyph />
              </Link>
            ))}
            {chips.length > 0 ? <Link href={props.clearAllHref} className="ml-1 text-dense text-teal hover:text-navy">Clear all</Link> : null}
            {counts.dismissed > 0 || state.dismissed ? (
              <Link
                href={opportunitiesHref({ ...state, dismissed: !state.dismissed })}
                className={cn("ml-2 inline-flex h-7 items-center rounded-full border px-2.5 text-dense font-medium", state.dismissed ? "border-navy bg-navy text-white" : "border-dashed border-line-control bg-card text-ink-muted")}
              >
                Dismissed · {counts.dismissed}
              </Link>
            ) : null}
            <span className="flex-1" />
            {savedSearches.length > 0 ? <span className="text-meta text-ink-muted">Saved</span> : null}
            {savedSearches.map((s) => (
              <Link key={s.id} href={s.href} className={cn("inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-dense font-medium", s.active ? "border-teal bg-teal-tint text-teal" : "border-line-control bg-card text-ink")}>
                {s.name}
                {s.newMatches > 0 ? <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-teal-tint px-1.5 text-micro text-teal">{s.newMatches} new</span> : null}
              </Link>
            ))}
          </div>

          {mode === "ask" ? (
            <AskPanel
              state={askState}
              onTry={(q) => { setQuery(q); ask(q); }}
              onCancel={() => setAskState({ status: "idle", outcome: null, question: "" })}
              onRetry={() => ask(askState.question)}
              onSearchInstead={() => { setMode("search"); go({ ...state, mode: "search", list: { ...state.list, q: askState.question } }); }}
              onShowInTable={() => setRestrictTo(new Set(askSources.map((s) => s.id)))}
              onSaveAll={() => save(askSources.map((s) => s.id), true)}
              onSaveAsSearch={(name) => { setSaveSearchName(name); setSaveOpen(true); }}
              restricted={restrictTo !== null}
              onClearRestrict={() => setRestrictTo(null)}
            />
          ) : null}

          {selected.size > 0 ? (
            <div className="flex items-center justify-between gap-3 rounded-card border border-navy bg-navy py-2 pl-4 pr-2 text-white">
              <span className="text-dense font-medium">{selected.size} selected</span>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => save([...selected], true)} disabled={pending} className="h-[30px] rounded-control bg-white px-3 text-dense font-medium text-navy">Save to outreach</button>
                <button type="button" onClick={() => watch([...selected], true)} disabled={pending} className="h-[30px] rounded-control border border-white/40 px-3 text-dense font-medium text-white">Watch next cycle</button>
                <button type="button" onClick={() => shareList([...selected])} className="h-[30px] rounded-control border border-white/40 px-3 text-dense font-medium text-white">Share list</button>
                {state.dismissed ? (
                  <button type="button" onClick={() => restore([...selected])} disabled={pending} className="h-[30px] rounded-control border border-white/40 px-3 text-dense font-medium text-white">Restore</button>
                ) : (
                  <button type="button" onClick={() => dismiss([...selected])} disabled={pending} className="h-[30px] rounded-control border border-white/40 px-3 text-dense font-medium text-white">Dismiss</button>
                )}
                <button type="button" onClick={() => setSelected(new Set())} aria-label="Clear selection" className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-control text-white"><CloseGlyph size={16} /></button>
              </div>
            </div>
          ) : null}

          <section className="rounded-card border border-line bg-card">
            <div className="flex items-center justify-between rounded-t-card border-b border-line bg-card px-5 py-3">
              <p className="m-0 text-body">
                <span className="font-semibold">{nf.format(restrictTo ? visibleRows.length : page.total)}</span>{" "}
                <span className="text-ink-muted">
                  {state.dismissed ? "dismissed" : "results"} · {nf.format(counts.open)} open · {nf.format(counts.forecasted)} forecasted{props.truncated ? " · list truncated" : ""}
                </span>
              </p>
              <div className="flex items-center gap-3 text-dense text-ink-muted">
                <span>Sorted by {sort.key === "next_due" || sort.key === "close_date" ? "next due" : sort.key === "posted_date" ? "posted date" : sort.key.replace("_", " ")}</span>
              </div>
            </div>

            {visibleRows.length === 0 ? (
              <div className="px-5 py-8">
                <EmptyState
                  title={state.dismissed ? "Nothing dismissed" : chips.length ? "No results for these filters" : "No opportunities match"}
                  description={state.dismissed ? "Dismissed notices reappear here so you can restore them." : chips.length ? "Try removing a filter or widening the status and closing windows." : "Run a Simpler.Grants.gov sync from Data sources, or widen the search."}
                  actions={chips.length ? <Link href={props.clearAllHref}><Button variant="primary" size={32}>Clear all filters</Button></Link> : undefined}
                />
              </div>
            ) : (
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell first className="w-9 pr-0">
                      <Checkbox aria-label="Select all" checked={allSelected} onChange={(e) => setSelected(e.target.checked ? new Set(visibleRows.map((r) => r.id)) : new Set())} className="align-middle" />
                    </TableHeaderCell>
                    <TableHeaderCell className="w-[34%] pl-3 pr-5" sort={sortFor("title")} onSort={() => router.push(sortHref("title"))}>Title</TableHeaderCell>
                    <TableHeaderCell className="w-[11%]" sort={sortFor("status")} onSort={() => router.push(sortHref("status"))}>Status</TableHeaderCell>
                    <TableHeaderCell className="w-[22%]" sort={sortFor("next_due")} onSort={() => router.push(sortHref("next_due"))}>Next due</TableHeaderCell>
                    <TableHeaderCell className="w-[11%]" sort={sortFor("posted_date")} onSort={() => router.push(sortHref("posted_date"))}>Posted</TableHeaderCell>
                    <TableHeaderCell className="w-[10%]" sort={sortFor("funding_instrument")} onSort={() => router.push(sortHref("funding_instrument"))}>Instrument</TableHeaderCell>
                    <TableHeaderCell className="w-[10%] pr-5" />
                  </tr>
                </TableHead>
                <TableBody>
                  {visibleRows.map((r) => (
                    <TableRow key={r.id} selected={selected.has(r.id)}>
                      <TableCell first className="pr-0">
                        <Checkbox aria-label="Select row" checked={selected.has(r.id)} onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} className="align-middle" />
                      </TableCell>
                      <TableCell className="overflow-hidden pl-3 pr-5">
                        <Link href={opportunitiesHref(state, { keepPage: true, peek: r.id })} scroll={false} className="block truncate font-medium text-ink hover:text-teal">
                          {r.title}
                        </Link>
                        <p className="mb-0 mt-0.5 truncate text-meta text-ink-muted">
                          {r.agencyLine}
                          {r.badges.map((b) => (
                            <span key={b} className={cn("ml-1.5 inline-flex h-[18px] items-center rounded-full px-1.5 align-middle text-micro font-medium", b === "Watching" ? "bg-teal-tint text-teal" : b === "Reissue" ? "bg-line-row text-ink-body" : "bg-warning-tint text-warning")}>{b}</span>
                          ))}
                        </p>
                      </TableCell>
                      <TableCell><Pill variant={STATUS_PILL[r.statusLabel]}>{r.statusLabel}</Pill></TableCell>
                      <TableCell className="overflow-hidden whitespace-nowrap">
                        <span title={r.due.primary} className={cn(r.due.tone === "urgent" ? "font-medium text-danger" : r.due.tone === "closed" || r.due.tone === "muted" ? "text-ink-muted" : "text-ink")}>{r.due.primary}</span>
                        <span title={r.due.secondary} className="block truncate text-meta text-ink-muted">{r.due.secondary}</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-ink-body">{r.postedLabel}</TableCell>
                      <TableCell className="truncate whitespace-nowrap text-ink-body">{r.instrumentLabel}</TableCell>
                      <TableCell align="right" className="whitespace-nowrap pr-5">
                        <span className="inline-flex items-center gap-1">
                          {state.dismissed ? (
                            <Button variant="secondary" size={28} onClick={() => restore([r.id])} disabled={pending}>Restore</Button>
                          ) : (
                            <Button variant="secondary" size={28} onClick={() => save([r.id], !r.saved)} disabled={pending}>{r.saved ? "Saved" : "Save"}</Button>
                          )}
                          <Menu
                            label={`More actions for ${r.title}`}
                            align="end"
                            width={220}
                            trigger={({ toggle, triggerProps }) => (
                              <button type="button" onClick={toggle} aria-label="More" {...triggerProps} className="inline-flex h-7 w-7 items-center justify-center rounded-control text-ink-muted hover:bg-line-row hover:text-ink">
                                <DotsIcon />
                              </button>
                            )}
                          >
                            <MenuItem href={`/opportunities/${r.id}`}>Full page</MenuItem>
                            <MenuItem onSelect={() => watch([r.id], !r.watching)}>{r.watching ? "Stop watching" : "Watch next cycle"}</MenuItem>
                            <MenuItem onSelect={() => shareList([r.id])}>Share</MenuItem>
                            {state.dismissed ? <MenuItem onSelect={() => restore([r.id])}>Restore</MenuItem> : <MenuItem tone="destructive" onSelect={() => dismiss([r.id])}>Dismiss</MenuItem>}
                          </Menu>
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            <div className="flex items-center justify-between border-t border-line px-5 py-3 text-dense text-ink-muted">
              <span>
                {page.total === 0 ? "0 results" : `${nf.format((page.index - 1) * page.perPage + 1)}–${nf.format(Math.min(page.index * page.perPage, page.total))} of ${nf.format(page.total)}`}
              </span>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5">
                  Rows
                  <Select size={30} value={page.perPage} onChange={(e) => go({ ...state, list: { ...state.list, perPage: Number(e.target.value) } })}>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </Select>
                </label>
                <span className="inline-flex gap-1">
                  <Button variant="secondary" size={28} disabled={page.index <= 1} onClick={() => go({ ...state, list: { ...state.list, page: page.index - 1 } }, { keepPage: true })}>Previous</Button>
                  <Button variant="secondary" size={28} disabled={page.index * page.perPage >= page.total} onClick={() => go({ ...state, list: { ...state.list, page: page.index + 1 } }, { keepPage: true })}>Next</Button>
                </span>
              </div>
            </div>
          </section>
        </>
      ) : state.scope === "internal" ? (
        <CuratedScopeSection
          kind="internal"
          title={<><span className="font-semibold">0</span> <span className="text-ink-muted">published · 0 need review · 0 drafts</span></>}
          note="Kept apart from the synced catalog · never mixed into Federal"
          cta={{ label: "Curate opportunity", href: "/curate" }}
          columns={["Program", "Provenance", "Due", "Status", ""]}
          empty="No internal (UCSF) opportunities have been curated yet."
          footer="Internal records are entered by UCSF Curators from RAP or program offices and require a source, source link and review-by date to publish. Suggestions and Home ignore drafts and anything past its review date."
        />
      ) : (
        <CuratedScopeSection
          kind="limited"
          title={<><span className="font-semibold">0</span> <span className="text-ink-muted">sponsor notices with a UCSF nomination process</span></>}
          note="Sponsor notice stays synced; the UCSF process is a curated overlay"
          cta={{ label: "Add overlay", href: "/curate?kind=limited" }}
          columns={["Sponsor notice", "Internal nomination", "Sponsor due", "Cap · nominations", ""]}
          empty="No limited-submission overlays have been added yet."
          footer="Overlays come from InfoReady (manual re-entry until an API is confirmed). The sponsor record is the synced federal notice and cannot be edited here; a foundation notice not in the catalog appears as Curated."
        />
      )}

      <FiltersDrawer open={filtersOpen} onClose={() => setFiltersOpen(false)} groups={props.filterGroups} resultCount={page.total} resetHref={props.clearAllHref} />

      <SaveSearchDialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        defaultName={saveSearchName ?? suggestName(state, chips)}
        filterSummary={`${props.savedSearchSummary} · ${nf.format(page.total)} results today`}
        listState={props.listStateForSave}
        onSaved={() => { setSaveOpen(false); router.refresh(); }}
      />

      {props.peekId ? (
        <OpportunityPeek
          id={props.peekId}
          routing={props.team?.routing ?? null}
          onClose={() => go(state, { keepPage: true, peek: null })}
          onDismiss={() => dismiss([props.peekId!])}
          onWatch={(w) => watch([props.peekId!], w)}
          onSave={(s) => save([props.peekId!], s)}
          flags={rows.find((r) => r.id === props.peekId) ?? null}
        />
      ) : null}
    </div>
  );
}

function suggestName(state: OpportunitiesListState, chips: ActiveChip[]): string {
  const parts = chips.map((c) => c.label.replace(/[“”]/g, "")).filter((l) => !/^(Open only|Forecasted only|All statuses)$/.test(l));
  if (state.list.q && !parts.includes(state.list.q)) parts.unshift(state.list.q);
  return parts.length ? parts.slice(0, 3).join(" · ") : "All opportunities";
}

// ---------------------------------------------------------------------------
// Ask panel (states: thinking · answer · empty · error · limit · scope)
// ---------------------------------------------------------------------------

function AskPanel({
  state,
  onTry,
  onCancel,
  onRetry,
  onSearchInstead,
  onShowInTable,
  onSaveAll,
  onSaveAsSearch,
  restricted,
  onClearRestrict,
}: {
  state: { status: "idle" | "thinking"; outcome: AskOutcome | null; question: string };
  onTry: (q: string) => void;
  onCancel: () => void;
  onRetry: () => void;
  onSearchInstead: () => void;
  onShowInTable: () => void;
  onSaveAll: () => void;
  onSaveAsSearch: (name: string) => void;
  restricted: boolean;
  onClearRestrict: () => void;
}) {
  const avatar = (tone: "navy" | "danger" = "navy") => (
    <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-micro font-semibold", tone === "danger" ? "bg-danger-tint text-danger" : "bg-navy text-white")}>{tone === "danger" ? "!" : "P"}</span>
  );
  const scopeNote = (
    <p className="mb-0 mt-2 text-meta leading-normal text-ink-muted">
      Ask can read synced notices, your directory and this team&apos;s outreach; it can filter the table, save searches and draft messages for you to review. It never sends anything or changes a record without a button press.
    </p>
  );
  const o = state.outcome;

  return (
    <section className="flex flex-col gap-3 rounded-card border border-line bg-card px-5 py-4">
      <div className="flex flex-wrap gap-1.5">
        <span className="mr-1 self-center text-meta text-ink-muted">Try</span>
        {["New NIH opportunities posted this week", "Immunology opportunities closing in 90 days", "Best fits for early-stage investigators"].map((q) => (
          <button key={q} type="button" onClick={() => onTry(q)} className="h-7 rounded-full border border-line-control bg-card px-2.5 text-dense text-ink hover:bg-canvas">{q}</button>
        ))}
      </div>

      {state.status === "thinking" ? (
        <div className="flex items-start gap-3 border-t border-line-row pt-3">
          {avatar()}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-[70%]" />
            <Skeleton className="h-3.5 w-[92%]" />
            <Skeleton className="h-3.5 w-[40%]" />
            <p className="mb-0 mt-1 text-meta text-ink-muted">Reading the synced notices against your directory · usually under 10 seconds · <button type="button" onClick={onCancel} className="text-teal hover:text-navy">Cancel</button></p>
          </div>
        </div>
      ) : null}

      {o?.kind === "answer" ? (
        <div className="flex items-start gap-3 border-t border-line-row pt-3">
          {avatar()}
          <div className="min-w-0 flex-1">
            <p className="m-0 text-body leading-relaxed text-ink">{renderLightMarkdown(o.answer)}</p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <Button variant="primary" size={28} onClick={onSaveAll}>Save all {o.sources.length} to outreach</Button>
              <Button variant="secondary" size={28} onClick={restricted ? onClearRestrict : onShowInTable}>{restricted ? "Show all results" : `Show the ${o.sources.length} in the table`}</Button>
              <Button variant="secondary" size={28} onClick={() => onSaveAsSearch(state.question.slice(0, 60))}>Save as search “{state.question.slice(0, 32)}{state.question.length > 32 ? "…" : ""}”</Button>
            </div>
            <p className="mb-0 mt-2 text-meta text-ink-muted">Generated from synced notices and your directory. Deadlines are the next receipt date at 5:00 PM applicant-local time. Verify on the official notice.</p>
          </div>
        </div>
      ) : null}

      {o?.kind === "empty" ? (
        <div className="flex items-start gap-3 border-t border-line-row pt-3">
          {avatar()}
          <div className="min-w-0 flex-1">
            <p className="m-0 text-body leading-relaxed text-ink">{o.answer ? renderLightMarkdown(o.answer) : <>Nothing in the synced catalog matches “<span className="font-medium">{o.question}</span>”. Prospera only carries Simpler.Grants.gov notices.</>}</p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <Button variant="secondary" size={28} onClick={onSearchInstead}>Search all agencies for “{o.question.split(/\s+/).slice(0, 3).join(" ")}”</Button>
              <Button variant="secondary" size={28} onClick={() => onTry("What can Ask search?")}>Show what Ask can search</Button>
            </div>
            {scopeNote}
          </div>
        </div>
      ) : null}

      {o?.kind === "error" ? (
        <div className="flex items-start gap-3 border-t border-line-row pt-3">
          {avatar("danger")}
          <div className="min-w-0 flex-1">
            <p className="m-0 text-body leading-relaxed text-danger-dark">Ask couldn&apos;t answer this time. {o.message} Your search filters and the table below are unaffected.</p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <button type="button" onClick={onRetry} className="h-7 rounded-control border border-danger-border bg-card px-2.5 text-dense font-medium text-danger-dark">Try again</button>
              <Button variant="secondary" size={28} onClick={onSearchInstead}>Run as a keyword search instead</Button>
            </div>
            <p className="mb-0 mt-2 text-meta text-ink-muted">If this keeps happening, owners can check the service on <Link href="/team/data-sources" className="text-teal">Data sources</Link>.</p>
          </div>
        </div>
      ) : null}

      {o?.kind === "limit" ? (
        <div className="flex items-start gap-3 border-t border-line-row pt-3">
          {avatar()}
          <div className="min-w-0 flex-1">
            <p className="m-0 text-body leading-relaxed text-ink">Your team has used today&apos;s Ask allowance ({o.limit} questions). It resets at midnight Pacific. Search, filters and saved searches still work normally.</p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <Button variant="secondary" size={28} onClick={onSearchInstead}>Switch to Search</Button>
              <Link href="/team" className="inline-flex h-7 items-center rounded-control border border-line-control bg-card px-2.5 text-dense font-medium text-ink">Ask an owner to raise the limit</Link>
            </div>
            <p className="mb-0 mt-2 text-meta text-ink-muted">Used by {o.usedBy} {o.usedBy === 1 ? "person" : "people"} today.</p>
          </div>
        </div>
      ) : null}

      {o?.kind === "scope" ? (
        <div className="flex items-start gap-3 border-t border-line-row pt-3">
          {avatar()}
          <div className="min-w-0 flex-1">
            <p className="m-0 text-body leading-relaxed text-ink">{o.answer}</p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <Link href="/outreach" className="inline-flex h-7 items-center rounded-control border border-navy bg-navy px-2.5 text-dense font-medium text-white">Draft in Outreach → Message</Link>
              <Button variant="secondary" size={28} onClick={onSearchInstead}>Show it in the table</Button>
            </div>
            {scopeNote}
          </div>
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Internal / Limited scopes (curated records arrive in step 7)
// ---------------------------------------------------------------------------

function CuratedScopeSection({ kind, title, note, cta, columns, empty, footer }: { kind: "internal" | "limited"; title: ReactNode; note: string; cta: { label: string; href: string }; columns: string[]; empty: string; footer: string }) {
  const grid = kind === "internal" ? "grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_130px_120px_110px]" : "grid-cols-[minmax(0,2fr)_150px_150px_minmax(0,1.2fr)_130px]";
  return (
    <section className="rounded-card border border-line bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <p className="m-0 text-body">{title}</p>
        <div className="flex items-center gap-2">
          <span className="text-meta text-ink-muted">{note}</span>
          <Link href={cta.href} className="inline-flex h-7 items-center whitespace-nowrap rounded-control bg-navy px-2.5 text-dense font-medium text-white">{cta.label}</Link>
        </div>
      </div>
      <div className={cn("grid gap-4 border-b border-line px-5 py-2.5 text-label font-semibold uppercase text-ink-muted", grid)}>
        {columns.map((c, i) => <span key={i}>{c}</span>)}
      </div>
      <div className="px-5 py-8 text-center text-dense text-ink-muted">{empty}</div>
      <div className="border-t border-line px-5 py-3 text-meta leading-normal text-ink-muted">{footer}</div>
    </section>
  );
}

function FilterIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>;
}
function DotsIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>;
}
function CloseGlyph({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>;
}

/** Model answers arrive as light markdown; render **bold** and line breaks, strip headings and list markers. */
function renderLightMarkdown(text: string): ReactNode {
  const lines = text.replace(/^#+\s*/gm, "").replace(/^\s*[-*]\s+/gm, "").replace(/^\s*\d+\.\s+/gm, "").split(/\n+/).filter((l) => l.trim());
  return lines.map((line, li) => (
    <span key={li} className={li > 0 ? "mt-1.5 block" : "block"}>
      {line.split(/(\*\*[^*]+\*\*)/g).map((part, pi) =>
        part.startsWith("**") && part.endsWith("**") ? <strong key={pi} className="font-medium">{part.slice(2, -2)}</strong> : <span key={pi}>{part}</span>,
      )}
    </span>
  ));
}
