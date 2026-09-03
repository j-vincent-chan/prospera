"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addCalendarEntryAction, deleteCalendarEntryAction, restoreCalendarEntryAction, rotateCalendarTokenAction } from "@/app/actions/calendar-actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { KIND_LABEL, type CalendarEvent, type CalendarKind } from "@/lib/calendar/queries";
import { cn } from "@/lib/utils/cn";

const KIND_BG: Record<CalendarKind, string> = { sponsor: "bg-navy", internal: "bg-warning", loi: "bg-teal", limited: "bg-danger" };
const KIND_TEXT: Record<CalendarKind, string> = { sponsor: "text-navy", internal: "text-warning", loi: "text-teal", limited: "text-danger" };

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export function CalendarScreen({ month, today, range, events, upcoming, icsUrl, canRotate, items }: { month: string; today: string; range: { from: string; to: string; gridFrom: string; gridTo: string }; events: CalendarEvent[]; upcoming: CalendarEvent[]; icsUrl: string | null; canRotate: boolean; items: Array<{ id: string; title: string }> }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [icsOpen, setIcsOpen] = useState(false);
  const [form, setForm] = useState({ title: "", kind: "internal" as CalendarKind, date: today, notes: "", itemId: "" });

  const monthLabel = new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const days: Array<{ iso: string; n: number; inMonth: boolean; isToday: boolean; events: CalendarEvent[] }> = [];
  for (let d = new Date(`${range.gridFrom}T00:00:00Z`); d <= new Date(`${range.gridTo}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    days.push({ iso, n: d.getUTCDate(), inMonth: iso >= range.from && iso <= range.to, isToday: iso === today, events: events.filter((e) => e.date === iso) });
  }

  const add = () =>
    startTransition(async () => {
      const r = await addCalendarEntryAction({ title: form.title, kind: form.kind, date: form.date, notes: form.notes, itemId: form.itemId || null });
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      setAddOpen(false);
      setForm({ title: "", kind: "internal", date: today, notes: "", itemId: "" });
      router.refresh();
      toast({ message: `Added “${form.title.trim()}” to the calendar`, action: { label: "Undo", onClick: () => startTransition(async () => { await deleteCalendarEntryAction(r.id); router.refresh(); }) } });
    });

  const remove = (e: CalendarEvent) =>
    startTransition(async () => {
      const id = e.id.replace(/^manual-/, "");
      const r = await deleteCalendarEntryAction(id);
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      router.refresh();
      toast({ message: `Removed “${e.title}”`, action: { label: "Undo", onClick: () => startTransition(async () => { await restoreCalendarEntryAction(id); router.refresh(); }) } });
    });

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="m-0 text-[26px] font-semibold tracking-[-0.015em] text-ink">Calendar</h1>
          <p className="mb-0 mt-1.5 max-w-[760px] text-body text-ink-muted">Sponsor deadlines, letters of intent, internal OSR routing dates and limited-submission competitions for everything in your outreach</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setIcsOpen(true)}>Subscribe (ICS)</Button>
          <Button variant="primary" onClick={() => setAddOpen(true)}>Add internal deadline</Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={`/calendar?month=${shiftMonth(month, -1)}`} aria-label="Previous month" className="inline-flex h-8 w-8 items-center justify-center rounded-control border border-line-control bg-card text-body text-ink hover:bg-canvas">‹</Link>
          <h2 className="m-0 min-w-[170px] text-center text-[18px] font-semibold tracking-[-0.01em] text-ink">{monthLabel}</h2>
          <Link href={`/calendar?month=${shiftMonth(month, 1)}`} aria-label="Next month" className="inline-flex h-8 w-8 items-center justify-center rounded-control border border-line-control bg-card text-body text-ink hover:bg-canvas">›</Link>
          <Link href="/calendar" className="ml-1 inline-flex h-8 items-center rounded-control border border-line-control bg-card px-2.5 text-dense font-medium text-ink hover:bg-canvas">Today</Link>
        </div>
        <div className="flex flex-wrap gap-4 text-meta text-ink-body">
          {(Object.keys(KIND_LABEL) as CalendarKind[]).map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5"><span className={cn("h-2 w-2 rounded-[2px]", KIND_BG[k])} />{KIND_LABEL[k]}</span>
          ))}
        </div>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="overflow-hidden rounded-card border border-line bg-card">
          <div className="grid grid-cols-7 border-b border-line bg-canvas">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="px-2.5 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d) => (
              <div key={d.iso} className={cn("min-h-[104px] border-b border-r border-line-row px-2.5 py-2", d.inMonth ? "bg-card" : "bg-footer-bar")}>
                {d.inMonth ? (
                  <p className={cn("mb-1.5 mt-0 text-meta font-medium", d.isToday ? "inline-flex h-[22px] w-[22px] items-center justify-center rounded-full bg-navy text-white" : "text-ink-body")}>{d.n}</p>
                ) : <p className="m-0" />}
                <div className="flex flex-col gap-[3px]">
                  {d.events.map((e) => (
                    <span key={e.id} className="group relative block">
                      {e.href ? (
                        <Link href={e.href} title={e.title} className={cn("block truncate rounded-[4px] px-1.5 py-0.5 text-[11px] font-medium leading-[1.3] text-white", KIND_BG[e.kind])}>{e.label}</Link>
                      ) : (
                        <span title={e.title} className={cn("block truncate rounded-[4px] px-1.5 py-0.5 text-[11px] font-medium leading-[1.3] text-white", KIND_BG[e.kind])}>{e.label}</span>
                      )}
                      {e.manual ? <button type="button" aria-label={`Remove ${e.title}`} onClick={() => remove(e)} className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-card text-[10px] text-ink shadow-menu group-hover:flex">×</button> : null}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <aside className="rounded-card border border-line bg-card">
          <div className="border-b border-line px-5 py-3.5"><h2 className="m-0 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink">Next 14 days</h2></div>
          {upcoming.length === 0 ? <p className="m-0 px-5 py-5 text-dense text-ink-muted">Nothing due in the next two weeks.</p> : null}
          {upcoming.slice(0, 10).map((u) => (
            <div key={u.id} className="flex items-start gap-3 border-t border-line-row px-5 py-3 first:border-t-0">
              <div className="w-10 shrink-0 text-center">
                <p className="m-0 text-[11px] font-semibold uppercase text-ink-muted">{new Date(`${u.date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}</p>
                <p className="m-0 text-[18px] font-semibold leading-[1.1] text-ink">{Number(u.date.slice(-2))}</p>
              </div>
              <div className="min-w-0">
                {u.href ? <Link href={u.href} className="m-0 block text-dense font-medium leading-[1.4] text-ink hover:text-teal">{u.title}</Link> : <p className="m-0 text-dense font-medium leading-[1.4] text-ink">{u.title}</p>}
                <p className={cn("mb-0 mt-0.5 text-meta", KIND_TEXT[u.kind])}>{u.detail}</p>
              </div>
            </div>
          ))}
        </aside>
      </div>

      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add internal deadline"
        description="A date the team tracks that no feed carries: an internal review, a limited-submission nomination, a sponsor LOI."
        footer={<><Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button><Button variant="primary" disabled={pending || !form.title.trim() || !form.date} onClick={add}>{pending ? "Adding…" : "Add to calendar"}</Button></>}
      >
        <div className="flex flex-col gap-3 py-2">
          <Field label="Title" labelSize={12}>{({ id }) => <Input id={id} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Pew Scholars — internal nomination" autoFocus />}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Kind" labelSize={12}>{({ id }) => <Select id={id} value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as CalendarKind }))} className="w-full">{(Object.keys(KIND_LABEL) as CalendarKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</Select>}</Field>
            <Field label="Date" labelSize={12}>{({ id }) => <Input id={id} type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />}</Field>
          </div>
          <Field label="Opportunity (optional)" labelSize={12}>{({ id }) => <Select id={id} value={form.itemId} onChange={(e) => setForm((f) => ({ ...f, itemId: e.target.value }))} className="w-full"><option value="">None</option>{items.map((i) => <option key={i.id} value={i.id}>{i.title.slice(0, 80)}</option>)}</Select>}</Field>
          <Field label="Notes (optional)" labelSize={12}>{({ id }) => <Textarea id={id} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="min-h-[60px]" />}</Field>
        </div>
      </Dialog>

      <Dialog
        open={icsOpen}
        onClose={() => setIcsOpen(false)}
        title="Subscribe in your calendar app"
        description="Add this address as a subscribed calendar (Google, Outlook, Apple Calendar). It refreshes twice a day and carries everything shown here for the next 12 months. Anyone with the address can read the team's deadlines."
        footer={<>{canRotate ? <Button variant="secondary" disabled={pending} onClick={() => startTransition(async () => { const r = await rotateCalendarTokenAction(); if (!r.ok) return toast({ message: r.error, tone: "error" }); toast({ message: "Feed address rotated · re-subscribe with the new address" }); router.refresh(); })}>Rotate address</Button> : null}<Button variant="primary" onClick={() => { if (icsUrl) void navigator.clipboard?.writeText(icsUrl); toast({ message: "Feed address copied" }); setIcsOpen(false); }}>Copy address</Button></>}
      >
        <div className="py-2"><Input readOnly value={icsUrl ?? "Not available"} className="font-mono text-meta" onFocus={(e) => e.currentTarget.select()} /></div>
      </Dialog>
    </div>
  );
}
