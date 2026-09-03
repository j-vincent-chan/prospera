"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { refreshConnectorsAction, retryFailedPubmedAction, sendTestEmailAction, syncSimplerNowAction } from "@/app/actions/data-source-actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { SourceHealth, SourceRow } from "@/lib/data-sources/status";
import { cn } from "@/lib/utils/cn";

const STATUS_COLOR: Record<SourceRow["status"], string> = { healthy: "text-success", degraded: "text-warning", failing: "text-danger", manual: "text-warning", not_connected: "text-ink-muted" };
const STATUS_DOT: Record<SourceRow["status"], string> = { healthy: "bg-success", degraded: "bg-warning", failing: "bg-danger", manual: "bg-warning", not_connected: "bg-ink-muted" };

export function DataSourcesScreen({ health, teamName, canRun, fullLog, viewerEmail }: { health: SourceHealth; teamName: string; canRun: boolean; fullLog: boolean; viewerEmail: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const run = (key: string, fn: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>) => {
    setBusy(key);
    startTransition(async () => {
      const r = await fn();
      setBusy(null);
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      toast({ message: r.message });
      router.refresh();
    });
  };

  const act = (s: SourceRow) => {
    switch (s.action.kind) {
      case "sync_simpler":
        return run(s.key, async () => { const r = await syncSimplerNowAction(); return r.ok ? { ok: true, message: `Simpler.Grants.gov · ${r.summary}` } : r; });
      case "retry_pubmed":
        return run(s.key, async () => { const r = await retryFailedPubmedAction(); return r.ok ? { ok: true, message: `Re-ran PubMed for ${r.retried} profile${r.retried === 1 ? "" : "s"}${r.remaining ? ` · ${r.remaining} left for the nightly job` : ""}` } : r; });
      case "refresh_connectors":
        return run(s.key, async () => { const r = await refreshConnectorsAction(); return r.ok ? { ok: true, message: `Looked up UCSF Profiles and ORCID for ${r.refreshed} people${r.remaining ? ` · ${r.remaining} left for the nightly job` : ""}` } : r; });
      case "send_test":
        return run(s.key, async () => { const r = await sendTestEmailAction(); return r.ok ? { ok: true, message: `Test message sent to ${r.to}` } : r; });
      default:
        return undefined;
    }
  };

  const runAll = () =>
    run("all", async () => {
      const a = await syncSimplerNowAction();
      const b = await retryFailedPubmedAction();
      if (!a.ok) return a;
      return { ok: true, message: `Simpler.Grants.gov synced${b.ok && b.retried ? ` · ${b.retried} PubMed profiles retried` : ""} · connectors run nightly` };
    });

  const runs = fullLog ? health.runs : health.runs.slice(0, 6);
  return (
    <div className="flex max-w-[1040px] flex-col gap-5">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-1 mt-0 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">Team settings · {teamName}</p>
          <h1 className="m-0 text-h1 font-semibold tracking-[-0.02em] text-ink">Data sources</h1>
          <p className="mb-0 mt-1.5 text-body text-ink-muted">{health.summary}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/team" className="inline-flex h-9 items-center rounded-control border border-line-control bg-card px-3.5 text-body font-medium text-ink hover:bg-canvas">Team settings</Link>
          {canRun ? <Button variant="primary" onClick={runAll} disabled={pending}>{busy === "all" ? "Running…" : "Run all now"}</Button> : null}
        </div>
      </header>

      {health.stale ? (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-danger-border bg-danger-tint px-4 py-3 text-dense leading-normal text-danger-dark">
          <span><span className="font-semibold">Funding feed is {health.stale.hours} hours old.</span> {health.stale.failures ? `The Simpler.Grants.gov sync has failed ${health.stale.failures} time${health.stale.failures === 1 ? "" : "s"} since ${health.stale.since}${health.stale.error ? ` (${health.stale.error.slice(0, 60)})` : ""}.` : `The last successful sync was ${health.stale.since}.`} Deadlines and new notices may be missing; Home shows the same warning to every member.</span>
          <div className="flex gap-2">
            {canRun ? <Button variant="secondary" size={32} className="border-danger-border text-danger-dark" onClick={() => act(health.sources[0]!)} disabled={pending}>Retry now</Button> : null}
            <Link href="/team/data-sources?log=1" className="inline-flex items-center text-dense font-medium text-danger-dark">View log</Link>
          </div>
        </div>
      ) : null}

      <section className="rounded-card border border-line bg-card">
        <div className="grid grid-cols-[minmax(0,1.5fr)_130px_minmax(0,1.1fr)_150px_140px] gap-4 border-b border-line px-5 py-2.5 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted"><span>Source</span><span>Status</span><span>Coverage</span><span>Last run</span><span /></div>
        {health.sources.map((s) => (
          <div key={s.key} className="grid grid-cols-[minmax(0,1.5fr)_130px_minmax(0,1.1fr)_150px_140px] items-center gap-4 border-t border-line-row px-5 py-3.5 first:border-t-0">
            <div className="min-w-0"><p className="m-0 text-body font-medium text-ink">{s.name}</p><p className="mb-0 mt-0.5 text-meta leading-normal text-ink-muted">{s.what}</p></div>
            <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-dense font-medium", STATUS_COLOR[s.status])}><span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", STATUS_DOT[s.status])} />{s.statusLabel}</span>
            <span className="text-dense leading-normal text-ink-body">{s.coverage}</span>
            <span className="whitespace-nowrap text-dense leading-normal text-ink-body">{s.last}<span className="block text-meta text-ink-muted">{s.next}</span></span>
            <div className="flex justify-end">
              {s.action.kind === "link" && s.action.href ? (
                <a href={s.action.href} target={s.action.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className="inline-flex h-[30px] items-center whitespace-nowrap rounded-control border border-line-control bg-card px-3 text-dense font-medium text-ink hover:bg-canvas">{s.action.label}</a>
              ) : s.action.kind === "none" ? (
                <span className="inline-flex h-[30px] items-center whitespace-nowrap rounded-control border border-line-control bg-card px-3 text-dense font-medium text-ink-muted" title="Arrives with step 7">{s.action.label}</span>
              ) : (
                <Button variant={s.action.primary ? "primary" : "secondary"} size={32} disabled={pending || (!canRun && s.action.kind !== "send_test")} onClick={() => act(s)}>{busy === s.key ? "Running…" : s.action.label}</Button>
              )}
            </div>
          </div>
        ))}
        <div className="border-t border-line-row px-5 py-3 text-meta leading-normal text-ink-muted">Nightly jobs run at 1:00 AM PT. A source is marked <span className="font-medium text-warning">Degraded</span> after one failed run and <span className="font-medium text-danger">Failing</span> after two; owners and admins are emailed at Failing. Freshness stamps across the product (“refreshed Aug 28”, “synced 1:02 AM”) come from this page. Test messages go to {viewerEmail || "your address"}.</div>
      </section>

      <section className="rounded-card border border-line bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5"><h2 className="m-0 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink">Recent runs</h2>{fullLog ? <Link href="/team/data-sources" className="text-dense text-teal hover:text-navy">Recent only</Link> : <Link href="/team/data-sources?log=1" className="text-dense text-teal hover:text-navy">Full log →</Link>}</div>
        {runs.length === 0 ? <p className="m-0 px-5 py-5 text-dense text-ink-muted">No runs logged yet.</p> : null}
        {runs.map((r) => (
          <div key={r.id} className="grid grid-cols-[150px_minmax(0,1fr)_auto] items-center gap-4 border-t border-line-row px-5 py-2.5 text-dense first:border-t-0">
            <span className="whitespace-nowrap tabular text-ink-muted">{r.when}</span>
            <span className="min-w-0 truncate text-ink">{r.what}</span>
            <span className={cn("whitespace-nowrap text-meta font-medium", r.tone === "ok" ? "text-success" : r.tone === "warn" ? "text-warning" : "text-danger")}>{r.result}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
