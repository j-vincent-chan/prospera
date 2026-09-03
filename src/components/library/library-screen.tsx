"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LibraryItemSheet, TrustPill } from "@/components/library/library-item-sheet";
import { LibraryUploadFlow } from "@/components/library/library-upload-flow";
import { RatesEditor } from "@/components/library/rates-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { fmtMonDY } from "@/lib/funding-opportunities/receipt-cycles";
import { libraryHref, type LibraryData, type LibraryItemDetail } from "@/lib/institution/library";
import { CONTENT_TYPES } from "@/lib/institution/types";
import { cn } from "@/lib/utils/cn";

const GRID = "grid-cols-[minmax(0,1.9fr)_150px_minmax(0,1fr)_120px]";

export function LibraryScreen({ data, detail, viewer, today, openUpload }: { data: LibraryData; detail: LibraryItemDetail | null; viewer: { id: string; name: string; department: string | null; isSteward: boolean }; today: string; openUpload: boolean }) {
  const router = useRouter();
  const f = data.filters;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [ratesOpen, setRatesOpen] = useState(false);
  useEffect(() => setSheetOpen(Boolean(detail)), [detail]);
  useEffect(() => setUploadOpen(openUpload), [openUpload]);
  const go = (patch: Partial<typeof f>) => router.push(libraryHref({ ...patch, page: 1 }, f));
  const closeSheet = () => {
    setSheetOpen(false);
    router.push(libraryHref({}, f));
  };
  const closeUpload = () => {
    setUploadOpen(false);
    if (openUpload) router.push(libraryHref({}, f));
  };
  const rangeLabel = data.total ? `${(data.page - 1) * data.perPage + 1}–${Math.min(data.page * data.perPage, data.total)} of ${data.total.toLocaleString("en-US")}` : "0 of 0";

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-1 mt-0 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">UCSF · shared across all teams</p>
          <h1 className="m-0 text-h1 font-semibold text-ink">Proposal library</h1>
          <p className="mb-0 mt-1.5 text-body text-ink-muted">
            {data.header.published.toLocaleString("en-US")} item{data.header.published === 1 ? "" : "s"} · {data.header.departments} department{data.header.departments === 1 ? "" : "s"} · {data.header.uploadsThisMonth} upload{data.header.uploadsThisMonth === 1 ? "" : "s"} this month{viewer.isSteward ? " · you are a Library steward" : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/library/awards" className="inline-flex h-9 items-center rounded-control border border-line-control bg-card px-3.5 text-body font-medium text-ink hover:bg-canvas">UCSF awards (OSR)</Link>
          <Button variant="primary" onClick={() => setUploadOpen(true)}>Upload to library</Button>
        </div>
      </header>

      <form className="flex flex-wrap items-center gap-3" action="/library" method="get">
        <div className="relative min-w-[280px] max-w-[520px] flex-1">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none absolute left-3 top-2.5" aria-hidden><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
          <Input name="q" defaultValue={f.q} placeholder="Search by meaning — “aging R01 research strategy”, “F&A rate off-campus”…" className="pl-9" aria-label="Search the library" />
          {f.type ? <input type="hidden" name="type" value={f.type} /> : null}
          {f.sponsor ? <input type="hidden" name="sponsor" value={f.sponsor} /> : null}
          {f.mechanism ? <input type="hidden" name="mechanism" value={f.mechanism} /> : null}
          {f.department ? <input type="hidden" name="department" value={f.department} /> : null}
          {f.trust ? <input type="hidden" name="trust" value={f.trust} /> : null}
        </div>
        <Select value={f.type} onChange={(e) => go({ type: e.target.value })} aria-label="Content type">
          <option value="">All content types</option>
          {CONTENT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </Select>
        <Select value={f.sponsor} onChange={(e) => go({ sponsor: e.target.value })} aria-label="Sponsor">
          <option value="">Any sponsor</option>
          {["NIH", "NSF", "DoD", "Foundation"].map((s) => <option key={s} value={s}>{s === "Foundation" ? "Foundations" : s}</option>)}
        </Select>
        <Select value={f.mechanism} onChange={(e) => go({ mechanism: e.target.value })} aria-label="Mechanism">
          <option value="">Any mechanism</option>
          {data.facets.mechanisms.map((m) => <option key={m} value={m}>{m}</option>)}
        </Select>
        <Select value={f.department} onChange={(e) => go({ department: e.target.value })} aria-label="Department">
          <option value="">Any department</option>
          {data.facets.departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </Select>
        <Select value={f.trust} onChange={(e) => go({ trust: e.target.value })} aria-label="Trust level">
          <option value="">Any trust level</option>
          <option value="osr">OSR-verified only</option>
          <option value="curated">Curated</option>
          <option value="community">Community upload</option>
        </Select>
      </form>

      {f.q ? (
        <p className="m-0 text-meta text-ink-muted">
          {data.searchMode === "semantic" ? "Ranked by meaning" : "Ranked by text match"} for “{f.q}” · <Link href={libraryHref({ q: "" }, f)} className="text-teal hover:text-navy">Clear</Link>
        </p>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-card border border-line bg-card">
          <div className={cn("grid gap-4 border-b border-line px-5 py-2.5 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted", GRID)}><span>Item</span><span>Trust</span><span>Source</span><span>Confirmed</span></div>
          {data.rows.length ? data.rows.map((it) => (
            <Link key={it.id} href={libraryHref({}, f, { item: it.id })} scroll={false} className={cn("grid items-center gap-4 border-t border-line-row px-5 py-3 text-ink hover:bg-canvas", GRID)}>
              <div className="min-w-0">
                <p className="m-0 flex items-center gap-2 truncate text-body font-medium text-ink">
                  <span className="truncate">{it.title}</span>
                  {it.status === "pending_review" ? <Pill variant="status-draft">In review</Pill> : it.status === "changes_requested" ? <Pill variant="status-needs-review">Changes requested</Pill> : null}
                </p>
                <p className="mb-0 mt-0.5 truncate text-meta text-ink-muted">{it.meta}</p>
              </div>
              <span><TrustPill tier={it.trust} /></span>
              <span className="truncate text-meta text-ink-body">{it.source}</span>
              <span className={cn("whitespace-nowrap text-meta", it.stale ? "font-medium text-warning-dark" : "text-ink-body")}>{it.confirmed}</span>
            </Link>
          )) : (
            <div className="px-5 py-10 text-center text-dense text-ink-muted">{data.total === 0 && !f.q && !f.type && !f.sponsor && !f.mechanism && !f.department && !f.trust ? "Nothing in the library yet. Upload the first example, or ask a steward to add OSR's institutional descriptions." : "No items match. Try fewer filters or a broader search."}</div>
          )}
          <div className="flex items-center justify-between gap-4 border-t border-line px-5 py-3 text-meta text-ink-muted">
            <span className="flex items-center gap-2">
              {rangeLabel}
              {data.total > data.perPage ? (
                <>
                  <Button variant="secondary" size={28} disabled={data.page <= 1} onClick={() => router.push(libraryHref({ page: data.page - 1 }, f))}>Previous</Button>
                  <Button variant="secondary" size={28} disabled={data.page * data.perPage >= data.total} onClick={() => router.push(libraryHref({ page: data.page + 1 }, f))}>Next</Button>
                </>
              ) : null}
            </span>
            <span className="inline-flex flex-wrap gap-3.5">
              <span className="inline-flex items-center gap-1.5"><Pill variant="trust-osr">OSR-verified</Pill>system of record</span>
              <span className="inline-flex items-center gap-1.5"><Pill variant="trust-curated">Curated</Pill>entered by a Curator</span>
              <span className="inline-flex items-center gap-1.5"><Pill variant="trust-community">Community</Pill>uploaded by a colleague</span>
            </span>
          </div>
        </section>

        <aside className="flex flex-col gap-4">
          <section className="rounded-card border border-line bg-card px-5 py-4">
            <h2 className="mb-2.5 text-section font-semibold uppercase text-ink">Rates &amp; required language</h2>
            <div className="flex flex-col gap-2.5 text-dense">
              {data.rates.rows.length ? data.rates.rows.map((r) => (
                <div key={r.label} className="flex justify-between gap-3"><span className="text-ink">{r.label}</span><span className="font-semibold tabular-nums text-ink">{r.value}</span></div>
              )) : <p className="m-0 text-ink-muted">No rate schedule on file yet.{viewer.isSteward ? " Add OSR's current agreement below." : " A Library steward adds OSR's current agreement."}</p>}
              <p className="mb-0 mt-0.5 text-meta leading-normal text-ink-muted">
                <Pill variant="trust-osr">OSR-verified</Pill> {data.rates.agreement ?? "Rate agreement"}{data.rates.effective ? ` · effective ${fmtMonDY(data.rates.effective)}` : ""}{data.rates.verifiedAt ? ` · confirmed ${data.rates.verifiedAt.slice(0, 10) === today ? "today" : fmtMonDY(data.rates.verifiedAt.slice(0, 10))}` : ""}{data.rates.sourceUrl ? <> · <a href={data.rates.sourceUrl} target="_blank" rel="noreferrer" className="text-teal hover:text-navy">Full schedule</a></> : null}
              </p>
              <p className="m-0 text-meta leading-normal text-ink-muted">Rates are never accepted as uploads. If OSR&apos;s agreement changes, this panel and every item citing it update together.</p>
              {viewer.isSteward ? <button type="button" className="self-start text-dense font-medium text-teal hover:text-navy" onClick={() => setRatesOpen(true)}>{data.rates.rows.length ? "Update the schedule" : "Add OSR's schedule"} →</button> : null}
            </div>
          </section>
          {viewer.isSteward ? (
            <section className="rounded-card border border-line bg-card px-5 py-4">
              <h2 className="mb-2.5 text-section font-semibold uppercase text-ink">Steward queue</h2>
              <div className="flex flex-col gap-2 text-dense">
                <div className="flex justify-between gap-3"><span>Awaiting review before public</span><span className="font-semibold text-ink">{data.queue.pending}</span></div>
                <div className="flex justify-between gap-3"><span>Flagged by readers</span><span className="font-semibold text-ink">{data.queue.flagged}</span></div>
                <div className="flex justify-between gap-3"><span>Past review date</span><span className={cn("font-semibold", data.queue.pastReview ? "text-warning-dark" : "text-ink")}>{data.queue.pastReview}</span></div>
              </div>
              <Link href="/library/queue" className="mt-2.5 inline-block text-dense font-medium text-teal hover:text-navy">Open queue →</Link>
            </section>
          ) : null}
          <section className="rounded-card border border-line bg-card px-5 py-4">
            <h2 className="mb-1.5 text-section font-semibold uppercase text-ink">How the library works</h2>
            <p className="m-0 text-dense leading-normal text-ink-body">Everything here is visible to everyone at UCSF using Prospera. Examples are shared for calibration, not copying. Redact preliminary data and named collaborators before uploading, or ask for a steward review first.</p>
          </section>
        </aside>
      </div>

      <LibraryItemSheet detail={detail} open={sheetOpen && Boolean(detail)} onClose={closeSheet} viewerIsSteward={viewer.isSteward} />
      <LibraryUploadFlow open={uploadOpen} onClose={closeUpload} viewer={{ department: viewer.department }} today={today} />
      {viewer.isSteward ? <RatesEditor key={`${data.rates.rows.length}-${data.rates.verifiedAt ?? ""}`} open={ratesOpen} onClose={() => setRatesOpen(false)} initial={{ rows: data.rates.rows, agreement: data.rates.agreement, effective: data.rates.effective, sourceUrl: data.rates.sourceUrl }} /> : null}
    </div>
  );
}
