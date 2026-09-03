"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { ReportPeriod, ReportsData } from "@/lib/reports/queries";
import { cn } from "@/lib/utils/cn";

function SectionHead({ title }: { title: string }) {
  return (
    <div className="border-b border-line px-5 py-3.5">
      <h2 className="m-0 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink">{title}</h2>
    </div>
  );
}

export function ReportsScreen({ data, period, community, communities }: { data: ReportsData; period: ReportPeriod; community: string | null; communities: Array<{ id: string; label: string }> }) {
  const router = useRouter();
  const href = (p: ReportPeriod, c: string | null) => `/reports?period=${p}${c ? `&community=${c}` : ""}`;
  const PILL: Record<string, string> = { success: "bg-success-tint text-success", neutral: "bg-line-row text-ink-body", danger: "bg-danger-tint text-danger", warning: "bg-warning-tint text-warning" };

  return (
    <div className="flex max-w-[1240px] flex-col gap-5 print:max-w-none">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="m-0 text-[26px] font-semibold tracking-[-0.015em] text-ink">Reports</h1>
          <p className="mb-0 mt-1.5 text-body text-ink-muted">What the office surfaced, pursued and won · {data.periodLabel}</p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Select value={period} onChange={(e) => router.push(href(e.target.value as ReportPeriod, community))} aria-label="Period">
            <option value="fy_to_date">FY to date</option>
            <option value="last_quarter">Last quarter</option>
            <option value="previous_fy">Previous FY</option>
          </Select>
          <Select value={community ?? ""} onChange={(e) => router.push(href(period, e.target.value || null))} aria-label="Community">
            <option value="">All communities</option>
            {communities.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </Select>
          <Button variant="secondary" onClick={() => window.print()}>Export PDF</Button>
        </div>
      </header>

      {data.needsOutcomes ? (
        <div className="flex items-center justify-between gap-3 rounded-card border border-warning-border bg-warning-tint px-4 py-3 text-dense text-warning-dark print:hidden">
          <span><span className="font-medium">{data.needsOutcomes} item{data.needsOutcomes === 1 ? "" : "s"} in Submitted without an outcome.</span> Funded and Not funded only count once the outcome is recorded.</span>
          <Link href="/outreach?stage=submitted" className="whitespace-nowrap font-medium text-warning-dark">Record outcomes →</Link>
        </div>
      ) : null}

      <section className="rounded-card border border-line bg-card p-5">
        <p className="mb-4 mt-0 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink">Funnel</p>
        <div className="grid grid-cols-5 items-end">
          {data.funnel.map((f) => (
            <div key={f.label} className="border-l border-line-row px-3 first:border-l-0">
              <div className="rounded-t-[4px]" style={{ height: f.height, background: f.color }} />
              <p className="mb-0 mt-2.5 text-[24px] font-semibold tracking-[-0.02em] tabular text-ink">{f.n}</p>
              <p className="mb-0 mt-0.5 text-dense font-medium text-ink">{f.label}</p>
              <p className="mb-0 mt-0.5 text-meta text-ink-muted">{f.sub}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-card border border-line bg-card">
          <SectionHead title="Outcomes" />
          {data.outcomes.length === 0 ? <p className="m-0 px-5 py-6 text-dense text-ink-muted">Nothing submitted in this period yet. Move items to Submitted in Outreach and record the outcome when it arrives.</p> : null}
          {data.outcomes.map((o) => (
            <div key={o.id} className="grid grid-cols-[minmax(0,1fr)_90px_100px] items-center gap-3 border-t border-line-row px-5 py-3 first:border-t-0">
              <div className="min-w-0">
                <Link href={`/outreach?item=${o.id}`} className="block truncate text-body font-medium text-ink hover:text-teal">{o.title}</Link>
                <p className="mb-0 mt-0.5 text-meta text-ink-muted">{o.meta}</p>
              </div>
              <span className={cn("inline-flex h-[22px] items-center justify-self-start rounded-full px-2 text-meta font-medium", PILL[o.tone])}>{o.status}</span>
              <span className="text-right text-dense tabular text-ink">{o.amount}</span>
            </div>
          ))}
        </section>
        <div className="flex flex-col gap-4">
          <section className="rounded-card border border-line bg-card">
            <SectionHead title="By community" />
            {data.byCommunity.map((c) => (
              <div key={c.id} className="grid grid-cols-[minmax(0,1fr)_60px_60px_60px] items-center gap-3 border-t border-line-row px-5 py-2.5 text-dense first:border-t-0">
                <span className="font-medium text-ink">{c.name}</span>
                <span className="text-right tabular text-ink-body">{c.outreach}</span>
                <span className="text-right tabular text-ink-body">{c.submitted}</span>
                <span className="text-right font-semibold tabular text-success">{c.funded}</span>
              </div>
            ))}
            <div className="grid grid-cols-[minmax(0,1fr)_60px_60px_60px] gap-3 border-t border-line-row px-5 py-2 text-[11px] text-ink-muted">
              <span /><span className="text-right">Outreach</span><span className="text-right">Submitted</span><span className="text-right">Funded</span>
            </div>
          </section>
          <section className="rounded-card border border-line bg-card px-5 py-4">
            <h2 className="mb-2.5 mt-0 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink">Responsiveness</h2>
            <div className="grid grid-cols-3 gap-3">
              {([[data.responsiveness.postedToTriaged, "Posted → triaged (median)"], [data.responsiveness.replyRate, "PI reply rate"], [data.responsiveness.leadTime, "Avg lead time at outreach"]] as const).map(([v, l]) => (
                <div key={l}><p className="m-0 text-[20px] font-semibold tabular text-ink">{v}</p><p className="mb-0 mt-0.5 text-meta text-ink-muted">{l}</p></div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
