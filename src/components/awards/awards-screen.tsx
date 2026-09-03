"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Papa from "papaparse";
import { exportAwardsCsvAction, importOsrRowsAction, previewOsrImportAction, syncReporterAwardsAction, undoOsrImportAction } from "@/app/actions/awards-actions";
import { deleteReferenceRateAction, saveReferenceRateAction } from "@/app/actions/library-actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { awardsHref, type AwardsData, type AwardsFilters } from "@/lib/institution/awards";
import { fmtMonDY } from "@/lib/funding-opportunities/receipt-cycles";
import { cn } from "@/lib/utils/cn";

const GRID = "grid-cols-[minmax(0,2fr)_minmax(0,1fr)_110px_100px_90px]";

export function AwardsScreen({ data, viewerIsSteward, referenceRates, today }: { data: AwardsData; viewerIsSteward: boolean; referenceRates: Array<{ id: string; mechanism: string; fiscal_year: number; rate: number; label: string; source_url: string | null }>; today: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [importOpen, setImportOpen] = useState(false);
  const [refOpen, setRefOpen] = useState(false);
  const f = data.filters;
  const go = (patch: Partial<AwardsFilters>) => router.push(awardsHref({ ...patch, page: 1 }, f));
  const h = data.header;
  const syncedLine = h.lastImport ? `${h.lastImport.kind === "osr_export" ? "imported from OSR's export" : "synced from NIH RePORTER"} ${fmtWhen(h.lastImport.when, today)}${h.lastImport.by ? ` by ${h.lastImport.by}` : ""}` : "nothing imported yet";

  const exportCsv = () =>
    start(async () => {
      const res = await exportAwardsCsvAction({ filters: f });
      if (!res.ok) return toast({ message: res.error, tone: "error" });
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ucsf-awards-${today}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ message: `${res.rows.toLocaleString("en-US")} awards exported` });
    });
  const syncReporter = () =>
    start(async () => {
      toast({ message: "Pulling the last three fiscal years from NIH RePORTER… this takes a minute or two", duration: 8000 });
      const res = await syncReporterAwardsAction();
      if (!res.ok) return toast({ message: res.error, tone: "error" });
      toast({ message: `${res.upserted.toLocaleString("en-US")} UCSF awards synced from NIH RePORTER (FY${res.fiscalYears.join(", FY")})` });
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-1 mt-0 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">UCSF · shared across all teams</p>
          <h1 className="m-0 text-h1 font-semibold text-ink">What UCSF has won</h1>
          <p className="mb-0 mt-1.5 flex flex-wrap items-center gap-2 text-body text-ink-muted">
            {h.osrVerified ? <Pill variant="trust-osr">OSR-verified</Pill> : <Pill variant="trust-synced">Public · NIH RePORTER</Pill>}
            <span>
              {h.total.toLocaleString("en-US")} award{h.total === 1 ? "" : "s"}{h.sinceFy ? ` since FY${h.sinceFy}` : ""} · {h.declines.toLocaleString("en-US")} declined submissions (aggregated) · {syncedLine}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/library" className="inline-flex h-9 items-center rounded-control border border-line-control bg-card px-3.5 text-body font-medium text-ink hover:bg-canvas">Proposal library</Link>
          {viewerIsSteward ? <Button variant="secondary" onClick={() => setImportOpen(true)}>Import OSR export</Button> : null}
          {viewerIsSteward ? <Button variant="secondary" onClick={syncReporter} disabled={pending}>Sync NIH RePORTER</Button> : null}
          <Button variant="secondary" onClick={exportCsv} disabled={pending || !data.table.total}>Export CSV</Button>
        </div>
      </header>

      <form className="flex flex-wrap items-center gap-3" action="/library/awards" method="get">
        <div className="relative min-w-[260px] max-w-[440px] flex-1">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none absolute left-3 top-2.5" aria-hidden><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
          <Input name="q" defaultValue={f.q} placeholder="Search title, PI, or abstract…" className="pl-9" aria-label="Search awards" />
          {f.sponsor ? <input type="hidden" name="sponsor" value={f.sponsor} /> : null}
          {f.mechanism ? <input type="hidden" name="mechanism" value={f.mechanism} /> : null}
          {f.department ? <input type="hidden" name="department" value={f.department} /> : null}
          {f.window !== "3" ? <input type="hidden" name="window" value={f.window} /> : null}
        </div>
        <Select value={f.sponsor} onChange={(e) => go({ sponsor: e.target.value })} aria-label="Sponsor">
          <option value="">All sponsors</option>
          {["NIH", "NSF", "DoD", "Foundations"].map((s) => <option key={s} value={s}>Sponsor: {s}</option>)}
        </Select>
        <Select value={f.mechanism} onChange={(e) => go({ mechanism: e.target.value })} aria-label="Mechanism">
          <option value="">Any mechanism</option>
          {data.facets.mechanisms.map((m) => <option key={m} value={m}>Mechanism: {m}</option>)}
        </Select>
        <Select value={f.department} onChange={(e) => go({ department: e.target.value })} aria-label="Department">
          <option value="">Any department</option>
          {data.facets.departments.map((d) => <option key={d} value={d}>Department: {d}</option>)}
        </Select>
        <Select value={f.window} onChange={(e) => go({ window: e.target.value as AwardsFilters["window"] })} aria-label="Fiscal years">
          <option value="3">Last 3 fiscal years</option>
          <option value="5">Last 5</option>
          <option value="10">Last 10</option>
          <option value="all">All</option>
        </Select>
      </form>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {data.kpis.map((k) => (
          <div key={k.label} className="rounded-card border border-line bg-card px-4 py-3.5">
            <p className="m-0 text-meta text-ink-muted">{k.label}</p>
            <p className="mb-0 mt-1.5 text-stat font-semibold tabular-nums text-ink">{k.value}</p>
            <p className="mb-0 mt-1 text-meta text-ink-muted">{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="rounded-card border border-line bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
            <p className="m-0 text-body"><span className="font-semibold">{data.table.total.toLocaleString("en-US")}</span> <span className="text-ink-muted">{data.table.caption}</span></p>
            <span className="text-meta text-ink-muted">Sorted by award date</span>
          </div>
          <div className={cn("grid gap-4 border-b border-line px-5 py-2.5 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted", GRID)}><span>Award</span><span>PI · division</span><span>Institute</span><span>Direct / yr</span><span>Period</span></div>
          {data.table.rows.length ? data.table.rows.map((a) => (
            <div key={a.id} className={cn("grid items-center gap-4 border-t border-line-row px-5 py-3", GRID)}>
              <div className="min-w-0">
                <p className="m-0 truncate text-body font-medium text-ink" title={a.title}>{a.reporter_url ? <a href={a.reporter_url} target="_blank" rel="noreferrer" className="text-ink hover:text-teal">{a.title}</a> : a.title}</p>
                <p className="mb-0 mt-0.5 flex items-center gap-2 truncate text-meta text-ink-muted">
                  <span className="font-mono">{a.award_number ?? a.external_id}</span>
                  {a.source === "osr" ? <Pill variant="trust-osr">OSR-verified</Pill> : null}
                  {a.library ? <Link href={a.library.href} className="text-teal hover:text-navy">{a.library.label}</Link> : null}
                </p>
              </div>
              <span className="truncate text-dense text-ink-body" title={a.pi_name ?? undefined}>{a.piLine}</span>
              <span className="whitespace-nowrap text-dense text-ink-body">{a.institute ?? a.sponsor ?? "—"}</span>
              <span className="whitespace-nowrap text-dense tabular-nums text-ink">{a.amountLine}</span>
              <span className="whitespace-nowrap text-dense text-ink-body">{a.periodLine}</span>
            </div>
          )) : (
            <div className="px-5 py-10 text-center text-dense text-ink-muted">
              {h.total ? "No awards match these filters." : viewerIsSteward ? "No award history yet. Import OSR's export, or sync the public NIH RePORTER record to start." : "No award history yet. A Library steward can import OSR's export or sync NIH RePORTER."}
            </div>
          )}
          <div className="flex items-center justify-between gap-4 border-t border-line px-5 py-3 text-meta text-ink-muted">
            <span className="flex items-center gap-2">
              {data.table.total ? `${(data.table.page - 1) * data.table.perPage + 1}–${Math.min(data.table.page * data.table.perPage, data.table.total)} of ${data.table.total.toLocaleString("en-US")}` : "0 of 0"}
              <Button variant="secondary" size={28} disabled={data.table.page <= 1} onClick={() => router.push(awardsHref({ page: data.table.page - 1 }, f))}>Previous</Button>
              <Button variant="secondary" size={28} disabled={data.table.page * data.table.perPage >= data.table.total} onClick={() => router.push(awardsHref({ page: data.table.page + 1 }, f))}>Next</Button>
            </span>
            <span>Abstracts and aims text are shown where OSR exposes them; otherwise the NIH RePORTER record is linked.</span>
          </div>
        </section>

        <aside className="flex flex-col gap-4">
          <section className="rounded-card border border-line bg-card px-5 py-4">
            <div className="mb-2.5 flex items-baseline justify-between gap-3">
              <h2 className="m-0 text-section font-semibold uppercase text-ink">{data.rates.title}</h2>
              <span className="text-meta text-ink-muted">{data.rates.fyLabel}</span>
            </div>
            {data.rates.headline ? <p className="m-0 text-stat-lg font-semibold tabular-nums text-ink">{data.rates.headline}</p> : <p className="m-0 text-stat-lg font-semibold tabular-nums text-ink-muted">—</p>}
            <p className="mb-3 mt-1 text-dense text-ink-body">{data.rates.sub}</p>
            {data.rates.bars.map((r) => (
              <div key={r.label} className="grid grid-cols-[minmax(0,1fr)_44px] items-center gap-2.5 py-[5px]">
                <div>
                  <p className="mb-1 flex justify-between text-meta text-ink-body"><span>{r.label}</span><span className="text-ink-muted">{r.n}</span></p>
                  <div className="h-1.5 rounded-[3px] bg-line-row"><div className={cn("h-1.5 rounded-[3px]", r.tone === "teal" ? "bg-teal" : "bg-teal-light")} style={{ width: `${r.width}%` }} /></div>
                </div>
                <span className="text-right text-dense font-semibold tabular-nums text-ink">{r.pct}</span>
              </div>
            ))}
            <p className="mb-0 mt-3 text-meta leading-normal text-ink-muted">Declined submissions are counted, never named. Named decline detail is visible only to the submitting PI and their department&apos;s research administrators.</p>
            {viewerIsSteward ? <button type="button" className="mt-2.5 text-dense font-medium text-teal hover:text-navy" onClick={() => setRefOpen(true)}>NIH-wide reference rates →</button> : null}
          </section>
          <section className="rounded-card border border-line bg-card px-5 py-4">
            <h2 className="mb-2 text-section font-semibold uppercase text-ink">Where this shows up</h2>
            <p className="m-0 text-dense leading-normal text-ink-body">Every opportunity detail gets a “UCSF track record” panel: awards under the same mechanism and institute, the success rate, and funded examples in the library. Reports uses the same data for the office&apos;s outcomes.</p>
          </section>
        </aside>
      </div>

      {viewerIsSteward ? <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} /> : null}
      {viewerIsSteward ? <ReferenceRatesDialog open={refOpen} onClose={() => setRefOpen(false)} rows={referenceRates} /> : null}
    </div>
  );
}

function fmtWhen(iso: string, today: string): string {
  const d = iso.slice(0, 10);
  const t = new Date(iso);
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" }).format(t);
  return d === today ? `today ${time}` : `${fmtMonDY(d)} ${time}`;
}

function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<{ headers: string[]; rows: Record<string, string>[]; mapping: Record<string, string>; missing: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reset = () => {
    setFile(null);
    setParsed(null);
    setError(null);
  };
  const parse = (f: File) => {
    setFile(f);
    setError(null);
    Papa.parse<Record<string, string>>(f, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const headers = res.meta.fields ?? [];
        start(async () => {
          const pv = await previewOsrImportAction({ headers });
          if (!pv.ok) return setError(pv.error);
          setParsed({ headers, rows: res.data, mapping: pv.mapping, missing: pv.missing });
        });
      },
      error: (e) => setError(e.message),
    });
  };
  const run = () => {
    if (!parsed || !file) return;
    start(async () => {
      const res = await importOsrRowsAction({ fileName: file.name, headers: parsed.headers, rows: parsed.rows });
      if (!res.ok) return setError(res.error);
      const reasons = Object.entries(res.skippedReasons).map(([k, v]) => `${v} ${k}`).join(", ");
      toast({ message: `${res.awards.toLocaleString("en-US")} awards and ${res.declines.toLocaleString("en-US")} declines imported${res.skipped ? ` · ${res.skipped} skipped (${reasons})` : ""}`, duration: 10000, action: { label: "Undo", onClick: () => void undoOsrImportAction({ batchId: res.batchId }).then(() => router.refresh()) } });
      reset();
      onClose();
      router.refresh();
    });
  };
  const mapped = parsed ? Object.entries(parsed.mapping) : [];
  return (
    <Dialog
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Import OSR's award & proposal export"
      description="A CSV from OSR / RAS with one row per proposal. Rows whose status reads Awarded or Funded become OSR-verified awards; Declined or Not funded rows are counted as declines and never shown by name."
      width={560}
      footer={<><Button variant="secondary" size={32} onClick={() => { reset(); onClose(); }}>Cancel</Button><Button variant="primary" size={32} onClick={run} disabled={pending || !parsed || parsed.missing.length > 0}>{pending ? "Importing…" : parsed ? `Import ${parsed.rows.length.toLocaleString("en-US")} rows` : "Import"}</Button></>}
    >
      <div className="flex flex-col gap-3 py-1">
        <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && parse(e.target.files[0])} className="block text-dense text-ink" />
        {error ? <div className="rounded-[8px] border border-danger-border bg-danger-tint px-3 py-2 text-dense text-danger-dark">{error}</div> : null}
        {parsed ? (
          <div className="rounded-[8px] border border-line px-3 py-2.5 text-dense">
            <p className="mb-1.5 font-medium text-ink">{parsed.rows.length.toLocaleString("en-US")} rows · {parsed.headers.length} columns</p>
            {parsed.missing.length ? <p className="m-0 text-danger-dark">Couldn&apos;t find a {parsed.missing.join(" or ")} column. Expected headers like “Proposal Title” and “Status”.</p> : null}
            <p className="m-0 text-ink-muted">Recognized: {mapped.map(([field, col]) => `${col} → ${field.replace(/_/g, " ")}`).join(" · ") || "none"}</p>
          </div>
        ) : null}
        <p className="m-0 text-meta leading-normal text-ink-muted">Recognized columns: proposal id, sponsor award number, title, PI, department, division, sponsor, institute, mechanism / activity code, application type, status, fiscal year, award / receipt / decision dates, project start / end, direct and total cost, abstract. Re-importing the same file updates rows in place.</p>
      </div>
    </Dialog>
  );
}

function ReferenceRatesDialog({ open, onClose, rows }: { open: boolean; onClose: () => void; rows: Array<{ id: string; mechanism: string; fiscal_year: number; rate: number; label: string; source_url: string | null }> }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [mech, setMech] = useState("R01");
  const [fy, setFy] = useState(String(new Date().getFullYear()));
  const [rate, setRate] = useState("");
  const [url, setUrl] = useState("https://report.nih.gov/funding/nih-budget-and-spending-data-past-fiscal-years/success-rates");
  const add = () =>
    start(async () => {
      const res = await saveReferenceRateAction({ mechanism: mech, fiscalYear: Number(fy), rate: Number(rate), sourceUrl: url });
      if (!res.ok) return toast({ message: res.error, tone: "error" });
      setRate("");
      toast({ message: `${mech} FY${fy} reference rate saved` });
      router.refresh();
    });
  return (
    <Dialog open={open} onClose={onClose} title="NIH-wide reference rates" description="Published NIH success rates (RePORT) used for the “NIH-wide, same period” comparison. Enter the figure and where it came from." width={560} footer={<Button variant="secondary" size={32} onClick={onClose}>Close</Button>}>
      <div className="flex flex-col gap-3 py-1">
        <div className="rounded-[8px] border border-line">
          {rows.length ? rows.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 border-t border-line-row px-3 py-2 text-dense first:border-t-0">
              <span><span className="font-medium text-ink">{r.mechanism}</span> · FY{r.fiscal_year} · {r.label} {Math.round(Number(r.rate))}%{r.source_url ? <> · <a href={r.source_url} target="_blank" rel="noreferrer" className="text-teal">source</a></> : null}</span>
              <Button variant="ghost" size={28} onClick={() => start(async () => { await deleteReferenceRateAction({ id: r.id }); router.refresh(); })}>Remove</Button>
            </div>
          )) : <div className="px-3 py-2 text-dense text-ink-muted">No reference rates on file. Success-rate panels show UCSF figures alone until one is added.</div>}
        </div>
        <div className="grid grid-cols-[90px_90px_90px_minmax(0,1fr)] gap-2">
          <Field label="Mechanism" labelSize={12}>{({ id }) => <Input id={id} size={32} value={mech} onChange={(e) => setMech(e.target.value.toUpperCase())} />}</Field>
          <Field label="FY" labelSize={12}>{({ id }) => <Input id={id} size={32} inputMode="numeric" value={fy} onChange={(e) => setFy(e.target.value.replace(/\D/g, "").slice(0, 4))} />}</Field>
          <Field label="Rate %" labelSize={12}>{({ id }) => <Input id={id} size={32} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="20.7" />}</Field>
          <Field label="Source link" labelSize={12}>{({ id }) => <Input id={id} size={32} value={url} onChange={(e) => setUrl(e.target.value)} className="font-mono text-[12px]" />}</Field>
        </div>
        <div><Button variant="secondary" size={32} onClick={add} disabled={pending || !rate}>Add rate</Button></div>
      </div>
    </Dialog>
  );
}
