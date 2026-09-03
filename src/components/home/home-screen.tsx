"use client";

import Link from "next/link";
import { useEffect } from "react";
import { markHomeVisitAction } from "@/app/actions/data-source-actions";
import type { HomeData } from "@/lib/home/queries";
import { cn } from "@/lib/utils/cn";

const DOT: Record<string, string> = { danger: "bg-danger", warning: "bg-warning", teal: "bg-teal", neutral: "bg-line-control" };
const WHEN: Record<string, string> = { danger: "text-danger", warning: "text-warning", teal: "text-teal", neutral: "text-ink-body" };

function SectionHead({ title, aside }: { title: string; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
      <h2 className="m-0 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink">{title}</h2>
      {aside}
    </div>
  );
}

export function HomeScreen({ data }: { data: HomeData }) {
  useEffect(() => {
    // Stamp the visit after the page has rendered so "since your last visit" counts this view next time.
    const t = setTimeout(() => { void markHomeVisitAction(); }, 4000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="flex max-w-[1240px] flex-col gap-5">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="m-0 text-h1 font-semibold tracking-[-0.02em] text-ink">{data.greeting}</h1>
          <p className="mb-0 mt-1.5 text-body text-ink-muted">{data.meta}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/opportunities" className="inline-flex h-9 items-center rounded-control border border-line-control bg-card px-3.5 text-body font-medium text-ink hover:bg-canvas">Browse opportunities</Link>
          <Link href="/outreach" className="inline-flex h-9 items-center rounded-control border border-navy bg-navy px-3.5 text-body font-medium text-white hover:bg-navy-hover">Open outreach</Link>
        </div>
      </header>

      {data.feedStale ? (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-danger-border bg-danger-tint px-4 py-3 text-dense leading-normal text-danger-dark">
          <span><span className="font-semibold">Funding feed is {data.feedStale.hours} hours old.</span> New notices and deadline changes since {data.feedStale.since} may be missing.</span>
          <Link href="/team/data-sources" className="whitespace-nowrap font-medium text-danger-dark">Data sources →</Link>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {data.kpis.map((k) => (
          <Link key={k.label} href={k.href} className="block rounded-card border border-line bg-card px-4 py-3.5 hover:border-teal">
            <p className="m-0 text-meta text-ink-muted">{k.label}</p>
            <p className={cn("mb-0 mt-1.5 text-[24px] font-semibold tracking-[-0.02em] tabular", k.tone === "danger" ? "text-danger" : k.tone === "success" ? "text-success" : "text-ink")}>{k.value}</p>
            <p className="mb-0 mt-1 text-meta text-ink-muted">{k.sub}</p>
          </Link>
        ))}
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-4">
          <section className="rounded-card border border-line bg-card">
            <SectionHead title="Needs your attention" aside={<Link href="/outreach" className="text-dense text-teal hover:text-navy">All outreach →</Link>} />
            {data.actions.length === 0 ? <p className="m-0 px-5 py-6 text-dense text-ink-muted">Nothing needs you right now. New replies, overdue next actions, saved-search hits and requests land here.</p> : null}
            {data.actions.map((a) => (
              <div key={a.key} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3.5 border-t border-line-row px-5 py-3 first:border-t-0">
                <span className={cn("relative block h-2 w-2 rounded-full", DOT[a.dot])} title={a.dotLabel}><span className="sr-only">{a.dotLabel}</span></span>
                <div className="min-w-0">
                  <Link href={a.href} className="block truncate text-body font-medium text-ink hover:text-teal">{a.title}</Link>
                  <p className="mb-0 mt-0.5 truncate text-meta text-ink-muted">{a.meta}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className={cn("whitespace-nowrap text-meta font-medium", WHEN[a.whenTone])}>{a.when}</span>
                  <Link href={a.href} className="inline-flex h-7 items-center rounded-control border border-line-control bg-card px-2.5 text-dense font-medium text-ink hover:bg-canvas">{a.cta}</Link>
                </div>
              </div>
            ))}
          </section>

          <section className="rounded-card border border-line bg-card">
            <SectionHead title="Closing in the next 30 days" aside={<span className="text-meta text-ink-muted">Saved opportunities</span>} />
            {data.closing.length === 0 ? <p className="m-0 px-5 py-6 text-dense text-ink-muted">Nothing saved to outreach closes in the next 30 days.</p> : null}
            {data.closing.map((c) => (
              <div key={c.itemId} className="grid grid-cols-[minmax(0,1fr)_110px_140px] items-center gap-3.5 border-t border-line-row px-5 py-3 first:border-t-0">
                <div className="min-w-0">
                  <Link href={`/opportunities/${c.id}`} className="block truncate text-body font-medium text-ink hover:text-teal">{c.title}</Link>
                  <p className="mb-0 mt-0.5 text-meta text-ink-muted">{c.meta}</p>
                </div>
                <span className="text-dense text-ink-body">{c.stage}</span>
                <span className={cn("text-right text-dense font-medium", c.urgent ? "text-danger" : "text-ink")}>{c.days}</span>
              </div>
            ))}
          </section>
        </div>

        <aside className="flex flex-col gap-4">
          <section className="rounded-card border border-line bg-card">
            <SectionHead title="Saved searches" aside={<Link href="/opportunities" className="text-dense text-teal hover:text-navy">Manage</Link>} />
            {data.searches.length === 0 ? <p className="m-0 px-5 py-5 text-dense text-ink-muted">No saved searches yet. Save one from Opportunities to see new matches here.</p> : null}
            {data.searches.map((s) => (
              <Link key={s.id} href={s.href} className="flex items-center justify-between gap-3 border-t border-line-row px-5 py-3 first:border-t-0 hover:bg-canvas">
                <div><p className="m-0 text-body font-medium text-ink">{s.name}</p><p className="mb-0 mt-0.5 text-meta text-ink-muted">{s.meta}</p></div>
                <span className={cn("inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-[7px] text-meta font-semibold", s.count ? "bg-teal-tint text-teal" : "bg-line-row text-ink-muted")}>{s.count}</span>
              </Link>
            ))}
          </section>
          <section className="rounded-card border border-line bg-card">
            <SectionHead title="PI replies" />
            {data.replies.length === 0 ? <p className="m-0 px-5 py-5 text-dense text-ink-muted">No replies since your last visit.</p> : null}
            {data.replies.map((r) => (
              <div key={r.id} className="border-t border-line-row px-5 py-3 first:border-t-0">
                <div className="flex items-start gap-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-tint text-[11px] font-semibold text-teal">{r.initials}</span>
                  <div className="min-w-0">
                    <p className="m-0 text-body"><span className="font-medium text-ink">{r.name}</span> <span className={cn("ml-1 inline-flex h-5 items-center rounded-full px-2 align-middle text-micro font-medium", r.tone === "success" ? "bg-success-tint text-success" : r.tone === "warning" ? "bg-warning-tint text-warning" : "bg-line-row text-ink-body")}>{r.status}</span></p>
                    <p className="mb-0 mt-0.5 text-meta leading-[1.45] text-ink-muted"><Link href={`/outreach?item=${r.itemId}`} className="hover:text-teal">{r.meta}</Link></p>
                  </div>
                </div>
              </div>
            ))}
          </section>
          <section className="rounded-card border border-line bg-card px-5 py-3.5">
            <h2 className="mb-2.5 mt-0 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink">New this week</h2>
            <p className="m-0 text-body leading-normal"><span className="font-semibold text-ink">{data.newThisWeek.posted}</span> <span className="text-ink-body">notices posted</span> · <span className="font-semibold text-ink">{data.newThisWeek.matched}</span> <span className="text-ink-body">match your saved searches</span></p>
            <Link href="/opportunities" className="mt-2 inline-block text-dense text-teal hover:text-navy">Review new matches →</Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
