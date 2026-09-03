"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { archiveInvestigatorAction, refreshSourcesAction, restoreInvestigatorAction } from "@/app/actions/investigator-actions";
import { BiosketchRequestDialog, IdentifierDialog, type BiosketchRequestKind, type IdentifierKind } from "@/components/investigators/investigator-dialogs";
import { SourceChip, SourceChipButton } from "@/components/investigators/source-chip";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Menu, MenuItem } from "@/components/ui/menu";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import type { CommunityOption } from "@/lib/investigators/directory";
import { investigatorsHref, type InvestigatorsListState } from "@/lib/investigators/list-state";
import type { RefreshableSource } from "@/lib/investigators/refresh-sources";
import { SOURCES_FILTER_OPTIONS, type PersonChips, type SourceAction, type SourcesFilter } from "@/lib/investigators/sources";

export type DirectoryRowView = {
  id: string;
  fullName: string;
  initials: string;
  email: string | null;
  departmentLine: string | null;
  communityLabel: string | null;
  tagsLine: string;
  chips: PersonChips;
  nihProfileId: string | null;
  orcid: string | null;
  profilesUrlName: string | null;
};

type Props = {
  summary: string;
  rows: DirectoryRowView[];
  totalInDirectory: number;
  state: InvestigatorsListState;
  communities: CommunityOption[];
  page: { index: number; perPage: number; total: number };
};

const SOURCE_FOR_ACTION: Partial<Record<SourceAction["kind"], RefreshableSource>> = { fetch_pubmed: "pubmed" };

export function InvestigatorsScreen({ summary, rows, totalInDirectory, state, communities, page }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [openChip, setOpenChip] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState<{ kind: IdentifierKind; row: DirectoryRowView } | null>(null);
  const [biosketch, setBiosketch] = useState<{ kind: BiosketchRequestKind; row: DirectoryRowView } | null>(null);

  const navigate = (patch: Partial<InvestigatorsListState>) => router.push(investigatorsHref({ ...state, page: 1, ...patch }));

  const refresh = (row: DirectoryRowView, sources: RefreshableSource[] | "all", key: string) => {
    setBusy(key);
    startTransition(async () => {
      const r = await refreshSourcesAction(row.id, sources);
      setBusy(null);
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      toast({ message: `${row.fullName}: ${r.summary}` });
      setOpenChip(null);
      router.refresh();
    });
  };

  const onChipAction = (row: DirectoryRowView, source: keyof PersonChips, action: SourceAction) => {
    const key = `${row.id}-${source}`;
    switch (action.kind) {
      case "refresh":
      case "retry":
      case "fetch_pubmed":
        return refresh(row, [SOURCE_FOR_ACTION[action.kind] ?? (source === "reporter" ? "reporter" : "pubmed")], key);
      case "add_profile_id":
      case "add_email":
      case "add_orcid":
      case "connect_profiles":
        setOpenChip(null);
        return setIdentifier({ kind: action.kind, row });
      case "request_biosketch":
        setOpenChip(null);
        return setBiosketch({ kind: "request", row });
      case "send_reminder":
        setOpenChip(null);
        return setBiosketch({ kind: "reminder", row });
      case "request_update":
        setOpenChip(null);
        return setBiosketch({ kind: "update", row });
      default:
        return undefined;
    }
  };

  const remove = (row: DirectoryRowView) =>
    startTransition(async () => {
      const r = await archiveInvestigatorAction(row.id);
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      router.refresh();
      toast({
        message: `Removed ${row.fullName} from the directory`,
        action: {
          label: "Undo",
          onClick: () =>
            startTransition(async () => {
              const u = await restoreInvestigatorAction(row.id);
              if (!u.ok) return toast({ message: u.error, tone: "error" });
              router.refresh();
            }),
        },
      });
    });

  const from = page.total === 0 ? 0 : (page.index - 1) * page.perPage + 1;
  const to = Math.min(page.total, page.index * page.perPage);
  const legend = {
    ok: { label: "PubMed", count: "(14)", visual: "ok" as const, recent: false, title: "Available, 14 items" },
    stale: { label: "PubMed", count: "(2)", visual: "stale" as const, recent: false, title: "Older than 12 months" },
    none: { label: "Biosketch", count: "(—)", visual: "none" as const, recent: false, title: "Unavailable" },
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-h1 font-semibold tracking-[-0.02em] text-ink">Investigators</h1>
          <p className="mb-0 mt-1.5 text-body text-ink-muted">{summary}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/investigators/import" className="inline-flex h-9 items-center rounded-control border border-line-control bg-card px-3.5 text-body font-medium text-ink hover:bg-canvas">
            Import CSV
          </Link>
          <Link href="/investigators/import?add=1" className="inline-flex h-9 items-center rounded-control border border-navy bg-navy px-3.5 text-body font-medium text-white hover:bg-navy-hover">
            Add investigator
          </Link>
        </div>
      </header>

      <div className="flex items-center gap-3">
        <form
          className="relative max-w-[480px] flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            const q = String(new FormData(e.currentTarget).get("q") ?? "");
            navigate({ q: q.trim() });
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="pointer-events-none absolute left-3 top-2.5 text-ink-muted">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <Input name="q" defaultValue={state.q} placeholder="Search name, department, or tag…" aria-label="Search investigators" className="pl-9" />
        </form>
        <Select aria-label="Filter by community" value={state.community} onChange={(e) => navigate({ community: e.target.value })}>
          <option value="">All monitored communities</option>
          {communities.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
          <option value="none">Not in a community</option>
        </Select>
        <Select aria-label="Filter by sources" value={state.sources} onChange={(e) => navigate({ sources: e.target.value as SourcesFilter })}>
          {SOURCES_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
      </div>

      <section className="rounded-card border border-line bg-card">
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title={totalInDirectory === 0 ? "No investigators yet" : "No one matches these filters"}
              description={totalInDirectory === 0 ? "Add one person, or import a CSV from a community roster." : "Try a broader search, or clear the community and sources filters."}
              actions={
                totalInDirectory === 0 ? (
                  <>
                    <Link href="/investigators/import?add=1" className="inline-flex h-8 items-center rounded-control border border-navy bg-navy px-3 text-dense font-medium text-white">Add investigator</Link>
                    <Link href="/investigators/import" className="inline-flex h-8 items-center rounded-control border border-line-control bg-card px-3 text-dense font-medium text-ink">Import CSV</Link>
                  </>
                ) : (
                  <Button variant="secondary" size={32} onClick={() => router.push("/investigators")}>Clear filters</Button>
                )
              }
            />
          </div>
        ) : (
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell first className="w-[24%] rounded-tl-card">Name</TableHeaderCell>
                <TableHeaderCell className="w-[14%]">Department</TableHeaderCell>
                <TableHeaderCell className="w-[11%]" title="Membership in a monitored community. Rosters are edited on the Communities page.">Community</TableHeaderCell>
                <TableHeaderCell className="w-[33%]"><span title="What Prospera has on file for each person, and how fresh it is. Click a source to see the evidence.">Sources</span></TableHeaderCell>
                <TableHeaderCell className="w-[13%]">Tags</TableHeaderCell>
                <TableHeaderCell className="w-[5%] rounded-tr-card pr-5"><span className="sr-only">Actions</span></TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {rows.map((r) => {
                const href = `/investigators/${r.id}`;
                return (
                  <TableRow key={r.id}>
                    <TableCell first className="overflow-hidden">
                      <div className="flex items-center gap-3">
                        <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-tint text-meta font-semibold text-teal">{r.initials}</span>
                        <div className="min-w-0">
                          <Link href={href} className="block truncate font-medium text-ink hover:text-teal">{r.fullName}</Link>
                          <p className="mb-0 mt-0.5 truncate text-meta text-ink-muted">{r.email ?? "No email on file"}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="truncate text-ink-body">{r.departmentLine ?? "—"}</TableCell>
                    <TableCell className="truncate text-ink-body">{r.communityLabel ?? "Not in a community"}</TableCell>
                    <TableCell className="relative">
                      <div className="flex items-center gap-1.5">
                        {(["reporter", "pubmed", "biosketch"] as const).map((s) => {
                          const key = `${r.id}-${s}`;
                          return (
                            <SourceChip
                              key={s}
                              chip={r.chips[s]}
                              open={openChip === key}
                              onToggle={() => setOpenChip(openChip === key ? null : key)}
                              onClose={() => setOpenChip((cur) => (cur === key ? null : cur))}
                              profileHref={href}
                              pending={busy === key}
                              onAction={(a) => onChipAction(r, s, a)}
                            />
                          );
                        })}
                      </div>
                    </TableCell>
                    <TableCell className="truncate text-meta text-ink-body" title={r.tagsLine}>{r.tagsLine || "—"}</TableCell>
                    <TableCell align="right" className="pr-5">
                      <Menu
                        label={`Actions for ${r.fullName}`}
                        align="end"
                        width={220}
                        trigger={({ toggle, triggerProps }) => (
                          <button type="button" onClick={toggle} {...triggerProps} aria-label="More" className="inline-flex h-7 w-7 items-center justify-center rounded-control text-ink-muted hover:bg-line-row hover:text-ink">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
                          </button>
                        )}
                      >
                        <MenuItem href={href}>Open profile</MenuItem>
                        <MenuItem onSelect={() => refresh(r, "all", `${r.id}-all`)}>Refresh sources</MenuItem>
                        <MenuItem href={`${href}?edit=1`}>Edit</MenuItem>
                        <MenuItem tone="destructive" onSelect={() => remove(r)}>Remove from directory</MenuItem>
                      </Menu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        <div className="flex items-center justify-between gap-4 border-t border-line px-5 py-3 text-dense text-ink-muted">
          <span className="tabular">{page.total === 0 ? "0 of 0" : `${from}–${to} of ${page.total}`}</span>
          <span className="inline-flex flex-wrap items-center gap-3.5 text-meta">
            <span className="inline-flex items-center gap-1.5"><SourceChipButton chip={legend.ok} size="legend" />available, 14 items</span>
            <span className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-teal" />updated this week</span>
            <span className="inline-flex items-center gap-1.5"><SourceChipButton chip={legend.stale} size="legend" />older than 12 months</span>
            <span className="inline-flex items-center gap-1.5"><SourceChipButton chip={legend.none} size="legend" />unavailable</span>
          </span>
          <span className="inline-flex gap-1">
            {page.index > 1 ? (
              <Link href={investigatorsHref({ ...state, page: page.index - 1 })} className="inline-flex h-7 items-center rounded-control border border-line-control bg-card px-2.5 text-dense font-medium text-ink hover:bg-canvas">Previous</Link>
            ) : (
              <Button variant="secondary" size={28} disabled className="opacity-40">Previous</Button>
            )}
            {to < page.total ? (
              <Link href={investigatorsHref({ ...state, page: page.index + 1 })} className="inline-flex h-7 items-center rounded-control border border-line-control bg-card px-2.5 text-dense font-medium text-ink hover:bg-canvas">Next</Link>
            ) : (
              <Button variant="secondary" size={28} disabled className="opacity-40">Next</Button>
            )}
          </span>
        </div>
      </section>

      <IdentifierDialog
        kind={identifier?.kind ?? null}
        investigatorId={identifier?.row.id ?? ""}
        investigatorName={identifier?.row.fullName ?? ""}
        initialValue={identifier ? (identifier.kind === "add_profile_id" ? identifier.row.nihProfileId : identifier.kind === "add_email" ? identifier.row.email : identifier.kind === "add_orcid" ? identifier.row.orcid : identifier.row.profilesUrlName) : ""}
        onClose={() => setIdentifier(null)}
        onSaved={() => {
          setIdentifier(null);
          router.refresh();
        }}
      />
      <BiosketchRequestDialog
        kind={biosketch?.kind ?? null}
        investigatorId={biosketch?.row.id ?? ""}
        investigatorName={biosketch?.row.fullName ?? ""}
        email={biosketch?.row.email ?? null}
        onClose={() => setBiosketch(null)}
        onSent={() => {
          setBiosketch(null);
          router.refresh();
        }}
      />
    </div>
  );
}
