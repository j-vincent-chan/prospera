"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { addCommunityMembersAction, generateCommunityBriefAction, linkSavedSearchToCommunityAction, refreshCommunityFitsAction, removeCommunityMemberAction, restoreCommunityMemberAction, saveCommunityAction, searchDirectoryForRosterAction, setCommunityMemberRoleAction, type CommunityInput } from "@/app/actions/community-actions";
import { createOutreachItemAction } from "@/app/actions/outreach-actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Tabs } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { fmtMonD } from "@/lib/funding-opportunities/receipt-cycles";
import type { CommunityOption, CommunityOverview, FitRow, RosterRow } from "@/lib/communities/queries";
import { cn } from "@/lib/utils/cn";

type Tab = "overview" | "roster" | "opportunities" | "outreach" | "searches";
export type CommunitiesScreenProps = {
  data: CommunityOverview | null;
  options: CommunityOption[];
  tab: Tab;
  today: string;
  viewer: { canEdit: boolean; teamMembers: Array<{ id: string; name: string }> };
  linkable: Array<{ id: string; name: string; communityId: string | null }>;
};

const href = (id: string | null, tab: Tab = "overview") => (id ? `/communities?community=${id}${tab !== "overview" ? `&tab=${tab}` : ""}` : "/communities");

export function CommunitiesScreen({ data, options, tab, today, viewer, linkable }: CommunitiesScreenProps) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [editOpen, setEditOpen] = useState<"edit" | "new" | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [rosterFilter, setRosterFilter] = useState("");
  const [briefText, setBriefText] = useState<string | null>(data?.brief.text ?? null);
  useEffect(() => setBriefText(data?.brief.text ?? null), [data?.brief.text, data?.community.id]);

  if (!data) {
    return (
      <div className="flex flex-col gap-5">
        <header>
          <h1 className="m-0 text-h1 font-semibold text-ink">Communities</h1>
          <p className="mb-0 mt-1.5 text-body text-ink-muted">Monitored partner communities: rosters, open fits, outreach and a generated strategy brief.</p>
        </header>
        <EmptyState title="No monitored communities yet" description={viewer.canEdit ? "Create the first community, then add investigators from the directory." : "A team owner or admin creates communities and rosters."} actions={viewer.canEdit ? <Button variant="primary" onClick={() => setEditOpen("new")}>New community</Button> : undefined} />
        {editOpen ? <EditCommunityDialog mode="new" initial={null} leads={[]} roster={[]} teamMembers={viewer.teamMembers} onClose={() => setEditOpen(null)} onSaved={(id) => router.push(href(id))} /> : null}
      </div>
    );
  }

  const c = data.community;
  const m = data.meta;
  const generate = () =>
    start(async () => {
      toast({ message: "Generating the brief from the roster's recent activity…", duration: 6000 });
      const r = await generateCommunityBriefAction({ communityId: c.id });
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      setBriefText(r.text);
      toast({ message: "Strategy brief generated · labeled as generated" });
      router.refresh();
    });
  const refreshFits = () =>
    start(async () => {
      const r = await refreshCommunityFitsAction({ communityId: c.id });
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      toast({ message: `${r.notices} open notice${r.notices === 1 ? "" : "s"} fit · ${r.embedded} of ${r.members} members have embedded evidence` });
      router.refresh();
    });
  const removeMember = (row: RosterRow) =>
    start(async () => {
      const r = await removeCommunityMemberAction({ communityId: c.id, investigatorId: row.investigatorId });
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      toast({ message: `Removed ${row.name} from ${c.label}`, action: { label: "Undo", onClick: () => void restoreCommunityMemberAction({ communityId: c.id, investigatorId: row.investigatorId, role: r.role }).then(() => router.refresh()) } });
      router.refresh();
    });
  const setRole = (row: RosterRow, role: "lead" | "member") =>
    start(async () => {
      const r = await setCommunityMemberRoleAction({ communityId: c.id, investigatorId: row.investigatorId, role });
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      router.refresh();
    });
  const saveFit = (f: FitRow) =>
    start(async () => {
      const r = await createOutreachItemAction(f.opportunityId);
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      toast({ message: r.created ? "Saved to outreach · Triage" : "Already in outreach" });
      router.push(`/outreach?item=${r.itemId}`);
    });

  const filteredRoster = data.roster.rows.filter((r) => !rosterFilter.trim() || `${r.name} ${r.dept}`.toLowerCase().includes(rosterFilter.trim().toLowerCase()));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2 text-dense text-ink-muted">
        <Link href="/communities" className="text-ink-muted hover:text-navy">Communities</Link>
        <span>/</span>
        <span className="font-medium text-ink">{c.label}</span>
      </div>
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-wrap items-center gap-4">
          <select aria-label="Community" value={c.id} onChange={(e) => (e.target.value === "__new" ? setEditOpen("new") : router.push(href(e.target.value, tab)))} className="h-9 rounded-control border border-line-control bg-card px-3 text-[18px] font-semibold tracking-[-0.01em] text-ink outline-none">
            {options.map((o) => <option key={o.id} value={o.id}>{o.label}{o.active ? "" : " (inactive)"}</option>)}
            {viewer.canEdit ? <option value="__new">+ New community…</option> : null}
          </select>
          <p className="m-0 text-body text-ink-muted">{m.members} investigator{m.members === 1 ? "" : "s"} · {m.leads} lead{m.leads === 1 ? "" : "s"} · {m.openFits} open fit{m.openFits === 1 ? "" : "s"} · {m.signals12mo.toLocaleString("en-US")} signal{m.signals12mo === 1 ? "" : "s"} in the last 12 months{c.active ? "" : " · inactive"}</p>
        </div>
        <div className="flex gap-2">
          {viewer.canEdit ? <Button variant="secondary" onClick={() => setEditOpen("edit")}>Edit community</Button> : null}
          <Button variant="primary" onClick={generate} disabled={pending}>{briefText ? "Regenerate brief" : "Generate brief"}</Button>
        </div>
      </header>

      <Tabs
        active={tab}
        items={[
          { key: "overview", label: "Overview", href: href(c.id, "overview") },
          { key: "roster", label: "Roster", count: data.roster.total, href: href(c.id, "roster") },
          { key: "opportunities", label: "Opportunities", count: data.fits.total, href: href(c.id, "opportunities") },
          { key: "outreach", label: "Outreach", count: data.outreach.total, href: `/outreach?community=${c.id}` },
          { key: "searches", label: "Saved searches", count: data.searches.length, href: href(c.id, "searches") },
        ]}
      />

      {tab === "overview" ? (
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex flex-col gap-4">
            <section className="rounded-card border border-line bg-card p-5">
              <p className="mb-2 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">Strategy brief{data.brief.generatedAt ? ` · generated ${fmtMonD(data.brief.generatedAt.slice(0, 10), today)}` : " · not generated yet"}{data.brief.stale ? " · older than 30 days" : ""}</p>
              {briefText ? <p className="m-0 max-w-[72ch] text-body leading-relaxed text-ink print:max-w-none">{briefText}</p> : <p className="m-0 max-w-[72ch] text-body leading-relaxed text-ink-muted">No brief yet. Generate one from the roster&apos;s recent publications, grants, themes and open fits. It is labeled as generated and can be regenerated any time.</p>}
              <div className="mt-3.5 flex gap-2 print:hidden">
                <Button variant="secondary" size={28} onClick={generate} disabled={pending}>{briefText ? "Regenerate" : "Generate"}</Button>
                <Button variant="secondary" size={28} onClick={() => window.print()} disabled={!briefText}>Export for consultation</Button>
                {!data.profileComplete && viewer.canEdit ? <Button variant="ghost" size={28} onClick={() => setEditOpen("edit")}>Complete the profile →</Button> : null}
              </div>
            </section>

            <FitsSection rows={data.fits.rows.slice(0, 4)} total={data.fits.total} refreshedAt={data.fits.refreshedAt} embedded={data.fits.embeddedMembers} members={m.members} communityId={c.id} onRefresh={refreshFits} onSave={saveFit} pending={pending} today={today} compact />

            <section className="rounded-card border border-line bg-card">
              <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
                <h2 className="m-0 text-section font-semibold uppercase text-ink">Roster</h2>
                <div className="flex gap-2">
                  <Input size={32} value={rosterFilter} onChange={(e) => setRosterFilter(e.target.value)} placeholder="Filter roster…" aria-label="Filter roster" className="h-7 w-[200px]" />
                  {viewer.canEdit ? <Button variant="secondary" size={28} onClick={() => setAddOpen(true)}>Add members</Button> : null}
                </div>
              </div>
              {filteredRoster.length ? filteredRoster.slice(0, 6).map((r) => <RosterLine key={r.investigatorId} row={r} />) : <div className="px-5 py-6 text-dense text-ink-muted">{data.roster.total ? "No one on the roster matches that filter." : viewer.canEdit ? "No investigators on this roster yet. Add members from the directory." : "No investigators on this roster yet."}</div>}
              {data.roster.total > 6 ? <div className="border-t border-line-row px-5 py-2.5"><Link href={href(c.id, "roster")} className="text-dense text-teal hover:text-navy">Show all {data.roster.total} →</Link></div> : null}
            </section>
          </div>

          <aside className="flex flex-col gap-4">
            <section className="flex flex-col gap-2.5 rounded-card border border-line bg-card px-5 py-4">
              <h2 className="m-0 text-section font-semibold uppercase text-ink">Leads &amp; owner</h2>
              <div className="flex justify-between gap-3 text-dense"><span className="text-ink-muted">Faculty leads</span><span className="text-right text-ink">{data.leads.names}</span></div>
              <div className="flex justify-between gap-3 text-dense"><span className="text-ink-muted">RD strategist</span><span className="text-ink">{data.leads.strategist ?? "Not set"}</span></div>
              <div className="flex justify-between gap-3 text-dense"><span className="text-ink-muted">Listserv</span><span className="truncate text-ink">{data.leads.listserv ? <a href={`mailto:${data.leads.listserv}`} className="text-ink hover:text-teal">{data.leads.listserv}</a> : "Not set"}</span></div>
            </section>
            <section className="rounded-card border border-line bg-card">
              <div className="border-b border-line px-5 py-3.5"><h2 className="m-0 text-section font-semibold uppercase text-ink">Outreach for {c.label}</h2></div>
              {data.outreach.stages.map((s) => (
                <div key={s.key} className="flex justify-between border-t border-line-row px-5 py-2 text-dense first:border-t-0"><span>{s.name}</span><span className="font-semibold tabular-nums text-ink">{s.n}</span></div>
              ))}
              <div className="border-t border-line-row px-5 py-2.5"><Link href={`/outreach?community=${c.id}`} className="text-dense text-teal hover:text-navy">Open filtered outreach →</Link></div>
            </section>
            <section className="rounded-card border border-line bg-card">
              <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-3.5"><h2 className="m-0 text-section font-semibold uppercase text-ink">Saved searches for this community</h2><button type="button" className="text-meta font-medium text-teal hover:text-navy" onClick={() => setLinkOpen(true)}>Link</button></div>
              {data.searches.length ? data.searches.map((s) => (
                <div key={s.id} className="flex justify-between gap-3 border-t border-line-row px-5 py-3 text-dense first:border-t-0"><Link href={s.href} className="font-medium text-ink hover:text-teal">{s.name}</Link><span className={cn("whitespace-nowrap", s.newMatches ? "font-semibold text-teal" : "text-ink-muted")}>{s.newMatches} new</span></div>
              )) : <div className="px-5 py-3 text-dense text-ink-muted">No saved searches linked. Link one, or pick the community when saving a search.</div>}
            </section>
            <section className="rounded-card border border-line bg-card px-5 py-4">
              <h2 className="mb-2 text-section font-semibold uppercase text-ink">Top themes · 12 months</h2>
              {data.themes.length ? data.themes.map((t) => (
                <div key={t.label} className="grid grid-cols-[minmax(0,1fr)_36px] items-center gap-2.5 py-[5px]">
                  <div><p className="mb-1 text-dense text-ink">{t.label}</p><div className="h-1 rounded-[2px] bg-line-row"><div className="h-1 rounded-[2px] bg-teal" style={{ width: `${t.pct}%` }} /></div></div>
                  <span className="text-right text-dense font-medium text-ink">{t.n}</span>
                </div>
              )) : <p className="m-0 text-dense text-ink-muted">Themes appear once roster members have profile tags and recent publications on file.</p>}
            </section>
          </aside>
        </div>
      ) : null}

      {tab === "roster" ? (
        <section className="rounded-card border border-line bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
            <h2 className="m-0 text-section font-semibold uppercase text-ink">Roster · {data.roster.total}</h2>
            <div className="flex gap-2">
              <Input size={32} value={rosterFilter} onChange={(e) => setRosterFilter(e.target.value)} placeholder="Filter roster…" aria-label="Filter roster" className="h-7 w-[220px]" />
              {viewer.canEdit ? <Button variant="secondary" size={28} onClick={() => setAddOpen(true)}>Add members</Button> : null}
            </div>
          </div>
          {filteredRoster.length ? filteredRoster.map((r) => (
            <RosterLine key={r.investigatorId} row={r} actions={viewer.canEdit ? (
              <span className="flex items-center gap-1.5">
                <Button variant="ghost" size={28} onClick={() => setRole(r, r.role === "lead" ? "member" : "lead")} disabled={pending}>{r.role === "lead" ? "Make member" : "Make lead"}</Button>
                <Button variant="ghost" size={28} onClick={() => removeMember(r)} disabled={pending}>Remove</Button>
              </span>
            ) : undefined} />
          )) : <div className="px-5 py-8 text-center text-dense text-ink-muted">{data.roster.total ? "No one matches that filter." : "No investigators on this roster yet."}</div>}
          <div className="border-t border-line px-5 py-3 text-meta leading-normal text-ink-muted">Roster membership also shows in the Investigators directory and gives the suggestion engine a community to evaluate. Signals count publications, competing grants and trials from the last 12 months.</div>
        </section>
      ) : null}

      {tab === "opportunities" ? <FitsSection rows={data.fits.rows} total={data.fits.total} refreshedAt={data.fits.refreshedAt} embedded={data.fits.embeddedMembers} members={m.members} communityId={c.id} onRefresh={refreshFits} onSave={saveFit} pending={pending} today={today} /> : null}

      {tab === "searches" ? (
        <section className="rounded-card border border-line bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5"><h2 className="m-0 text-section font-semibold uppercase text-ink">Saved searches for {c.label}</h2><Button variant="secondary" size={28} onClick={() => setLinkOpen(true)}>Link a saved search</Button></div>
          {data.searches.length ? data.searches.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 border-t border-line-row px-5 py-3 text-dense first:border-t-0">
              <Link href={s.href} className="font-medium text-ink hover:text-teal">{s.name}</Link>
              <span className="flex items-center gap-3"><span className={cn(s.newMatches ? "font-semibold text-teal" : "text-ink-muted")}>{s.newMatches} new</span><Button variant="ghost" size={28} onClick={() => start(async () => { const r = await linkSavedSearchToCommunityAction({ savedSearchId: s.id, communityId: null }); if (!r.ok) return toast({ message: r.error, tone: "error" }); toast({ message: `Unlinked “${s.name}”`, action: { label: "Undo", onClick: () => void linkSavedSearchToCommunityAction({ savedSearchId: s.id, communityId: c.id }).then(() => router.refresh()) } }); router.refresh(); })}>Unlink</Button></span>
            </div>
          )) : <div className="px-5 py-8 text-center text-dense text-ink-muted">No saved searches linked to this community yet.</div>}
        </section>
      ) : null}

      {editOpen ? <EditCommunityDialog mode={editOpen} initial={editOpen === "edit" ? c : null} leads={data.roster.rows.filter((r) => r.role === "lead").map((r) => r.investigatorId)} roster={data.roster.rows} teamMembers={viewer.teamMembers} onClose={() => setEditOpen(null)} onSaved={(id) => { setEditOpen(null); if (id !== c.id) router.push(href(id)); else router.refresh(); }} /> : null}
      {addOpen ? <AddMembersDialog communityId={c.id} communityLabel={c.label} excludeIds={data.roster.rows.map((r) => r.investigatorId)} onClose={() => setAddOpen(false)} /> : null}
      {linkOpen ? <LinkSearchDialog communityId={c.id} linkable={linkable.filter((l) => l.communityId !== c.id)} onClose={() => setLinkOpen(false)} /> : null}
    </div>
  );
}

function RosterLine({ row, actions }: { row: RosterRow; actions?: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_120px_110px_90px_auto] items-center gap-3 border-t border-line-row px-5 py-2.5 first:border-t-0">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-tint text-micro font-semibold text-teal">{row.initials}</span>
        <div className="min-w-0">
          <Link href={`/investigators/${row.investigatorId}`} className="text-body font-medium text-ink hover:text-teal">{row.name}</Link>
          <p className="m-0 truncate text-meta text-ink-muted">{row.dept}</p>
        </div>
      </div>
      <span><span className={cn("inline-flex h-5 items-center rounded-full px-2 text-micro font-medium", row.role === "lead" ? "bg-teal-tint text-teal" : "bg-line-row text-ink-body")}>{row.role === "lead" ? "Lead" : "Member"}</span></span>
      <span className="text-meta text-ink-body">{row.signalsLabel}</span>
      <span className="text-right text-meta text-ink-body">{row.fits} fit{row.fits === 1 ? "" : "s"}</span>
      <span className="flex justify-end">{actions}</span>
    </div>
  );
}

function FitsSection({ rows, total, refreshedAt, embedded, members, communityId, onRefresh, onSave, pending, today, compact }: { rows: FitRow[]; total: number; refreshedAt: string | null; embedded: number; members: number; communityId: string; onRefresh: () => void; onSave: (f: FitRow) => void; pending: boolean; today: string; compact?: boolean }) {
  return (
    <section className="rounded-card border border-line bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <h2 className="m-0 text-section font-semibold uppercase text-ink">Open opportunities that fit this community</h2>
        <span className="flex items-center gap-3 text-dense">
          {compact && total > rows.length ? <Link href={href(communityId, "opportunities")} className="text-teal hover:text-navy">All {total} →</Link> : <span className="text-meta text-ink-muted">{refreshedAt ? `Refreshed ${fmtMonD(refreshedAt.slice(0, 10), today)}` : "Not computed yet"}</span>}
          <Button variant="ghost" size={28} onClick={onRefresh} disabled={pending}>Refresh</Button>
        </span>
      </div>
      {rows.length ? rows.map((f) => (
        <div key={f.opportunityId} className="grid grid-cols-[minmax(0,1fr)_200px_110px_112px] items-center gap-4 border-t border-line-row px-5 py-3">
          <div className="min-w-0">
            <Link href={`/opportunities/${f.opportunityId}`} className="block truncate text-body font-medium text-ink hover:text-teal">{f.title}</Link>
            <p className="mb-0 mt-0.5 text-meta text-ink-muted">{f.meta}</p>
          </div>
          <span className="truncate text-meta text-ink-body" title={f.whoFull}>{f.who}</span>
          <span className={cn("whitespace-nowrap text-dense font-medium tabular-nums", f.close.urgent ? "text-danger" : "text-ink")}>{f.close.label}</span>
          {f.cta.kind === "stage" ? <Link href={`/outreach?item=${f.cta.itemId}`} className="inline-flex h-7 w-full items-center justify-center whitespace-nowrap rounded-control border border-line-control bg-card px-2.5 text-dense font-medium text-ink hover:bg-canvas">{f.cta.label}</Link> : f.cta.kind === "watching" ? <Link href={`/opportunities/${f.opportunityId}`} className="inline-flex h-7 w-full items-center justify-center whitespace-nowrap rounded-control border border-line-control bg-card px-2.5 text-dense font-medium text-ink hover:bg-canvas">Watching</Link> : <Button variant="secondary" size={28} className="w-full" onClick={() => onSave(f)} disabled={pending}>Save</Button>}
        </div>
      )) : (
        <div className="px-5 py-8 text-center text-dense leading-normal text-ink-muted">
          {members === 0 ? "Add investigators to the roster to see which open notices fit." : embedded === 0 ? "No roster member has embedded evidence yet. Run the corpus embedding job, then refresh." : refreshedAt ? "No open notice clears the Potential threshold for this roster right now." : "Fits haven't been computed yet. Refresh to match the roster against open notices."}
        </div>
      )}
      {!compact ? <div className="border-t border-line px-5 py-3 text-meta leading-normal text-ink-muted">A notice fits when at least one roster member&apos;s evidence embedding clears the suggestion engine&apos;s Potential threshold; names list who fits. Refreshed nightly with suggestions.</div> : null}
    </section>
  );
}

function EditCommunityDialog({ mode, initial, leads, roster, teamMembers, onClose, onSaved }: { mode: "edit" | "new"; initial: CommunityOverview["community"] | null; leads: string[]; roster: RosterRow[]; teamMembers: Array<{ id: string; name: string }>; onClose: () => void; onSaved: (id: string) => void }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [label, setLabel] = useState(initial?.label ?? "");
  const [mission, setMission] = useState(initial?.mission ?? "");
  const [focus, setFocus] = useState(initial?.focus ?? "");
  const [keywords, setKeywords] = useState(initial?.keywords.join(", ") ?? "");
  const [populations, setPopulations] = useState(initial?.populations.join(", ") ?? "");
  const [active, setActive] = useState(initial?.active ?? true);
  const [strategist, setStrategist] = useState(initial?.strategist_id ?? "");
  const [listserv, setListserv] = useState(initial?.listserv ?? "");
  const [leadIds, setLeadIds] = useState<string[]>(leads);
  const [error, setError] = useState<string | null>(null);
  const save = () =>
    start(async () => {
      const input: CommunityInput = { id: initial?.id, label, mission, focus, keywords, populations, active, strategist_id: strategist || null, listserv, lead_ids: mode === "edit" ? leadIds : undefined };
      const r = await saveCommunityAction(input);
      if (!r.ok) return setError(r.error);
      toast({ message: mode === "new" ? `Created ${label}` : `${label} updated` });
      onSaved(r.id);
    });
  return (
    <Dialog open onClose={onClose} title={mode === "new" ? "New community" : `Edit ${initial?.label}`} description="The profile (mission, focus, keywords, populations) lets suggestions evaluate the community beyond roster matches." width={600} footer={<><Button variant="secondary" size={32} onClick={onClose}>Cancel</Button><Button variant="primary" size={32} onClick={save} disabled={pending || !label.trim()}>{mode === "new" ? "Create community" : "Save changes"}</Button></>}>
      <div className="flex flex-col gap-3 py-1">
        {error ? <div className="rounded-[8px] border border-danger-border bg-danger-tint px-3 py-2 text-dense text-danger-dark">{error}</div> : null}
        <Field label="Name" labelSize={12}>{({ id }) => <Input id={id} size={32} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ImmunoX" autoFocus />}</Field>
        <Field label="Mission" labelSize={12}>{({ id }) => <Textarea id={id} rows={2} value={mission} onChange={(e) => setMission(e.target.value)} placeholder="Bakar ImmunoX Initiative: immunology across disease areas at UCSF." />}</Field>
        <Field label="Scientific focus" labelSize={12} help="Used by suggestions to evaluate whether a notice fits the community.">{({ id }) => <Textarea id={id} rows={2} value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="Tissue immunity, immune regulation, tumor microenvironment, host–microbiome interactions" />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Keywords" labelSize={12} hint="comma-separated">{({ id }) => <Input id={id} size={32} value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="T cells, single-cell, autoimmunity" />}</Field>
          <Field label="Populations" labelSize={12} hint="comma-separated">{({ id }) => <Input id={id} size={32} value={populations} onChange={(e) => setPopulations(e.target.value)} placeholder="pediatric, adult" />}</Field>
          <Field label="RD strategist" labelSize={12}>{({ id }) => <Select id={id} size={32} value={strategist} onChange={(e) => setStrategist(e.target.value)}><option value="">Not set</option>{teamMembers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}</Field>
          <Field label="Listserv" labelSize={12}>{({ id }) => <Input id={id} size={32} type="email" value={listserv} onChange={(e) => setListserv(e.target.value)} placeholder="immunox-faculty@ucsf.edu" />}</Field>
        </div>
        {mode === "edit" && roster.length ? (
          <Field label="Faculty leads" labelSize={12}>
            {() => (
              <div className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto rounded-[8px] border border-line px-3 py-2">
                {roster.map((r) => (
                  <label key={r.investigatorId} className="flex items-center gap-2 text-dense text-ink"><Checkbox checked={leadIds.includes(r.investigatorId)} onChange={(e) => setLeadIds(e.target.checked ? [...leadIds, r.investigatorId] : leadIds.filter((x) => x !== r.investigatorId))} />{r.name}</label>
                ))}
              </div>
            )}
          </Field>
        ) : null}
        <label className="flex items-center gap-2 text-dense text-ink"><Checkbox checked={active} onChange={(e) => setActive(e.target.checked)} />Active · inactive communities stay in the selector but are skipped by suggestions and the nightly fit refresh</label>
      </div>
    </Dialog>
  );
}

function AddMembersDialog({ communityId, communityLabel, excludeIds, onClose }: { communityId: string; communityLabel: string; excludeIds: string[]; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Array<{ id: string; name: string; dept: string; community: string | null }>>([]);
  const [picked, setPicked] = useState<Array<{ id: string; name: string }>>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) return setResults([]);
    timer.current = setTimeout(async () => {
      const r = await searchDirectoryForRosterAction({ q, excludeIds: [...excludeIds, ...picked.map((p) => p.id)] });
      setResults(r.ok ? r.people : []);
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, excludeIds, picked]);
  const add = () =>
    start(async () => {
      const r = await addCommunityMembersAction({ communityId, investigatorIds: picked.map((p) => p.id) });
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      toast({ message: `${r.added} added to ${communityLabel} · fits refresh in the background` });
      onClose();
      router.refresh();
    });
  return (
    <Dialog open onClose={onClose} title={`Add members to ${communityLabel}`} description="Search the investigator directory by name or department. People can belong to more than one community." width={560} footer={<><Button variant="secondary" size={32} onClick={onClose}>Cancel</Button><Button variant="primary" size={32} onClick={add} disabled={pending || !picked.length}>Add {picked.length || ""} {picked.length === 1 ? "person" : "people"}</Button></>}>
      <div className="flex flex-col gap-3 py-1">
        <Input size={32} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the directory…" aria-label="Search the directory" autoFocus />
        {picked.length ? <div className="flex flex-wrap gap-1">{picked.map((p) => <button key={p.id} type="button" onClick={() => setPicked(picked.filter((x) => x.id !== p.id))} className="inline-flex h-6 items-center gap-1 rounded-full bg-navy-tint px-2 text-meta text-navy">{p.name} ×</button>)}</div> : null}
        {results.length ? (
          <div className="max-h-64 overflow-y-auto rounded-[8px] border border-line">
            {results.map((p) => (
              <button key={p.id} type="button" onClick={() => { setPicked([...picked, { id: p.id, name: p.name }]); setResults(results.filter((x) => x.id !== p.id)); }} className="flex w-full items-center justify-between gap-3 border-t border-line-row px-3 py-2 text-left first:border-t-0 hover:bg-canvas">
                <span className="min-w-0"><span className="block truncate text-dense font-medium text-ink">{p.name}</span><span className="block truncate text-meta text-ink-muted">{p.dept}</span></span>
                {p.community ? <Pill variant="tag">{p.community}</Pill> : null}
              </button>
            ))}
          </div>
        ) : q.trim().length >= 2 ? <p className="m-0 text-dense text-ink-muted">No one in the directory matches “{q}” who isn&apos;t already on the roster.</p> : null}
      </div>
    </Dialog>
  );
}

function LinkSearchDialog({ communityId, linkable, onClose }: { communityId: string; linkable: Array<{ id: string; name: string; communityId: string | null }>; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [id, setId] = useState(linkable[0]?.id ?? "");
  const link = () =>
    start(async () => {
      const r = await linkSavedSearchToCommunityAction({ savedSearchId: id, communityId });
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      toast({ message: "Saved search linked", action: { label: "Undo", onClick: () => void linkSavedSearchToCommunityAction({ savedSearchId: id, communityId: r.previous }).then(() => router.refresh()) } });
      onClose();
      router.refresh();
    });
  return (
    <Dialog open onClose={onClose} title="Link a saved search" description="Linked searches show their new matches on this community's overview. A search belongs to one community at a time." footer={<><Button variant="secondary" size={32} onClick={onClose}>Cancel</Button><Button variant="primary" size={32} onClick={link} disabled={pending || !id}>Link</Button></>}>
      <div className="py-1">
        {linkable.length ? (
          <Field label="Saved search" labelSize={12}>{({ id: fid }) => <Select id={fid} size={32} value={id} onChange={(e) => setId(e.target.value)}>{linkable.map((l) => <option key={l.id} value={l.id}>{l.name}{l.communityId ? " (linked elsewhere)" : ""}</option>)}</Select>}</Field>
        ) : <p className="m-0 text-dense text-ink-muted">Your team has no saved searches to link yet. Save one from Opportunities first.</p>}
      </div>
    </Dialog>
  );
}
