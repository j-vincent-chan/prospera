"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setLimitedInterestAction } from "@/app/actions/curate-actions";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { SlideOver } from "@/components/ui/slide-over";
import { useToast } from "@/components/ui/toast";
import { fmtMonDY } from "@/lib/funding-opportunities/receipt-cycles";
import type { InternalRow, InternalScope, LimitedRow, LimitedScope } from "@/lib/institution/curated";
import { REVIEW_PROCESSES, SOURCE_KIND_LABEL, type DerivedStatus } from "@/lib/institution/types";
import { cn } from "@/lib/utils/cn";

const INTERNAL_GRID = "grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_130px_120px_110px]";
const LIMITED_GRID = "grid-cols-[minmax(0,2fr)_150px_150px_minmax(0,1.2fr)_130px]";

function StatusPill({ status }: { status: DerivedStatus }) {
  if (status === "published") return <Pill variant="status-published">Published</Pill>;
  if (status === "needs_review") return <Pill variant="status-needs-review">Needs review</Pill>;
  if (status === "closed") return <Pill variant="status-closed">Closed</Pill>;
  return <Pill variant="status-draft">Draft</Pill>;
}

export function internalStamp(scope: InternalScope | null): string {
  if (!scope || (!scope.published && !scope.needsReview && !scope.drafts)) return "Curated by UCSF Curators · nothing published yet";
  const bits = ["Curated by UCSF Curators"];
  if (scope.rapCount) bits.push(`${scope.rapCount} from RAP announcements`);
  if (scope.manualCount) bits.push(`${scope.manualCount} manual program${scope.manualCount === 1 ? "" : "s"}`);
  if (scope.lastVerifiedAt) bits.push(`last verified ${fmtMonDY(scope.lastVerifiedAt.slice(0, 10))}`);
  return bits.join(" · ");
}

export function limitedStamp(scope: LimitedScope | null): string {
  if (!scope || !scope.rows.length) return "Sponsor notices synced · UCSF process curated from InfoReady · nothing published yet";
  return `Sponsor notices synced · UCSF process curated from InfoReady${scope.lastVerifiedAt ? ` · updated ${fmtMonDY(scope.lastVerifiedAt.slice(0, 10))}` : ""}`;
}

export function InternalScopeTable({ scope, viewerIsCurator }: { scope: InternalScope; viewerIsCurator: boolean }) {
  const [open, setOpen] = useState<InternalRow | null>(null);
  const title = (
    <>
      <span className="font-semibold">{scope.published}</span>{" "}
      <span className="text-ink-muted">published · {scope.needsReview} need{scope.needsReview === 1 ? "s" : ""} review{viewerIsCurator ? ` · ${scope.drafts} draft${scope.drafts === 1 ? "" : "s"} (curators only)` : ""}</span>
    </>
  );
  return (
    <section className="rounded-card border border-line bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <p className="m-0 text-body">{title}</p>
        <div className="flex items-center gap-2">
          <span className="text-meta text-ink-muted">Kept apart from the synced catalog · never mixed into Federal</span>
          {viewerIsCurator ? <Link href="/curate" className="inline-flex h-7 items-center whitespace-nowrap rounded-control bg-navy px-2.5 text-dense font-medium text-white">Curate opportunity</Link> : null}
        </div>
      </div>
      <div className={cn("grid gap-4 border-b border-line px-5 py-2.5 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted", INTERNAL_GRID)}><span>Program</span><span>Provenance</span><span>Due</span><span>Status</span><span /></div>
      {scope.rows.length ? scope.rows.map((r) => (
        <div key={r.id} className={cn("grid items-center gap-4 border-t border-line-row px-5 py-3", INTERNAL_GRID, r.status === "draft" && "opacity-70")}>
          <div className="min-w-0">
            <p className="m-0 truncate text-body font-medium text-ink">{r.title}</p>
            <p className="mb-0 mt-0.5 truncate text-meta text-ink-muted">{r.meta}</p>
          </div>
          <div className="min-w-0 text-meta leading-normal text-ink-body">
            <span className="flex items-center gap-1.5 truncate"><Pill variant="trust-curated">Curated</Pill><span className="truncate">{r.prov}</span></span>
            <span className="block truncate text-ink-muted">{r.prov2}</span>
          </div>
          <span className="whitespace-nowrap text-dense tabular-nums text-ink">{r.due}</span>
          <span><StatusPill status={r.status} /></span>
          <span className="flex justify-end">
            {r.action.kind === "view" ? (
              <Button variant="secondary" size={28} onClick={() => setOpen(r)}>View</Button>
            ) : (
              <Link href={r.editHref} className="inline-flex h-7 items-center whitespace-nowrap rounded-control border border-line-control bg-card px-2.5 text-dense font-medium text-ink hover:bg-canvas">{r.action.label}</Link>
            )}
          </span>
        </div>
      )) : (
        <div className="px-5 py-8 text-center text-dense text-ink-muted">{viewerIsCurator ? "No internal (UCSF) opportunities have been curated yet. Curate the first one." : "No internal (UCSF) opportunities have been published yet."}</div>
      )}
      <div className="border-t border-line px-5 py-3 text-meta leading-normal text-ink-muted">
        Internal records are entered by UCSF Curators from RAP or program offices and require a source, source link and review-by date to publish. Suggestions and Home ignore drafts and anything past its review date.{scope.closedHidden ? ` ${scope.closedHidden} closed program${scope.closedHidden === 1 ? "" : "s"} hidden.` : ""}
      </div>
      <InternalDetailSheet row={open} onClose={() => setOpen(null)} viewerIsCurator={viewerIsCurator} />
    </section>
  );
}

function InternalDetailSheet({ row, onClose, viewerIsCurator }: { row: InternalRow | null; onClose: () => void; viewerIsCurator: boolean }) {
  if (!row) return null;
  const rec = row.record;
  const dl: Array<[string, React.ReactNode]> = [
    ["Funder", rec.funder ?? "—"],
    ["Award", rec.award_summary ?? "—"],
    ["Application due", rec.application_due ? fmtMonDY(rec.application_due) : "—"],
    ["Letter of intent", rec.loi_due ? fmtMonDY(rec.loi_due) : "—"],
    ["Review process", REVIEW_PROCESSES.find((p) => p.key === rec.review_process)?.label ?? "—"],
    ["Program contact", rec.contact_email ? <a href={`mailto:${rec.contact_email}`} className="text-teal hover:text-navy">{rec.contact_name ? `${rec.contact_name} · ${rec.contact_email}` : rec.contact_email}</a> : rec.contact_name ?? "—"],
    ["Program page", rec.program_url ? <a href={rec.program_url} target="_blank" rel="noreferrer" className="break-all text-teal hover:text-navy">{rec.program_url}</a> : "—"],
  ];
  const prov: Array<[string, React.ReactNode]> = [
    ["Source", rec.source_kind ? SOURCE_KIND_LABEL[rec.source_kind] : "—"],
    ["Source link", rec.source_url ? <a href={rec.source_url} target="_blank" rel="noreferrer" className="break-all text-teal hover:text-navy">{rec.source_url}</a> : "—"],
    ["Verified by", rec.verified_by_name && rec.verified_at ? `${rec.verified_by_name} · ${fmtMonDY(rec.verified_at.slice(0, 10))}` : "Not yet verified"],
    ["Review by", rec.review_by ? fmtMonDY(rec.review_by) : "—"],
  ];
  return (
    <SlideOver
      open={Boolean(row)}
      onClose={onClose}
      label="Internal opportunity"
      header={
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2"><Pill variant="trust-curated">Curated</Pill><StatusPill status={row.status} /></div>
          <h2 className="m-0 text-title font-semibold text-ink">{rec.title}</h2>
          <p className="mb-0 mt-1.5 text-meta text-ink-muted">{row.meta}</p>
        </div>
      }
      footer={<div className="flex items-center justify-between gap-2"><span className="text-meta text-ink-muted">Internal (UCSF) scope · never in the federal catalog</span>{viewerIsCurator ? <Link href={row.editHref} className="inline-flex h-8 items-center rounded-control border border-line-control bg-card px-3 text-dense font-medium text-ink hover:bg-canvas">Edit in Curator</Link> : null}</div>}
    >
      <div className="flex flex-col gap-[18px] px-6 py-5">
        {row.status === "needs_review" ? <div className="rounded-[8px] border border-warning-border bg-warning-tint px-3 py-2.5 text-dense leading-normal text-warning-dark">Past its review-by date. Left out of suggestions and Home until a curator re-verifies it.</div> : null}
        <section>
          <p className="mb-2 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">Program</p>
          <dl className="m-0 grid grid-cols-[130px_minmax(0,1fr)] gap-x-4 gap-y-2 text-dense">{dl.map(([k, v]) => <div key={k} className="contents"><dt className="text-ink-muted">{k}</dt><dd className="m-0 font-medium text-ink">{v}</dd></div>)}</dl>
        </section>
        {rec.eligibility ? (
          <section>
            <p className="mb-2 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">UCSF eligibility</p>
            <p className="m-0 whitespace-pre-line text-body leading-relaxed text-ink">{rec.eligibility}</p>
          </section>
        ) : null}
        <section>
          <p className="mb-2 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">Provenance</p>
          <dl className="m-0 grid grid-cols-[130px_minmax(0,1fr)] gap-x-4 gap-y-2 text-dense">{prov.map(([k, v]) => <div key={k} className="contents"><dt className="text-ink-muted">{k}</dt><dd className="m-0 font-medium text-ink">{v}</dd></div>)}</dl>
        </section>
      </div>
    </SlideOver>
  );
}

export function LimitedScopeTable({ scope, viewerIsCurator }: { scope: LimitedScope; viewerIsCurator: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState<LimitedRow | null>(null);
  const setInterest = (r: LimitedRow, interested: boolean) =>
    start(async () => {
      const res = await setLimitedInterestAction({ overlayId: r.id, interested });
      if (!res.ok) return toast({ message: res.error, tone: "error" });
      if (interested) toast({ message: `Interest recorded for ${r.title.slice(0, 40)} · the curators see the count`, action: { label: "Undo", onClick: () => void setLimitedInterestAction({ overlayId: r.id, interested: false }).then(() => router.refresh()) } });
      else toast({ message: "Interest withdrawn" });
      router.refresh();
    });
  return (
    <section className="rounded-card border border-line bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <p className="m-0 text-body"><span className="font-semibold">{scope.count}</span> <span className="text-ink-muted">sponsor notice{scope.count === 1 ? "" : "s"} with a UCSF nomination process{viewerIsCurator && scope.drafts ? ` · ${scope.drafts} draft${scope.drafts === 1 ? "" : "s"} (curators only)` : ""}</span></p>
        <div className="flex items-center gap-2">
          <span className="text-meta text-ink-muted">Sponsor notice stays synced; the UCSF process is a curated overlay</span>
          {viewerIsCurator ? <Link href="/curate?kind=limited" className="inline-flex h-7 items-center whitespace-nowrap rounded-control bg-navy px-2.5 text-dense font-medium text-white">Add overlay</Link> : null}
        </div>
      </div>
      <div className={cn("grid gap-4 border-b border-line px-5 py-2.5 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted", LIMITED_GRID)}><span>Sponsor notice</span><span>Internal nomination</span><span>Sponsor due</span><span>Cap · nominations</span><span /></div>
      {scope.rows.length ? scope.rows.map((r) => (
        <div key={r.id} className={cn("grid items-center gap-4 border-t border-line-row px-5 py-3", LIMITED_GRID, r.status === "draft" && "opacity-70")}>
          <div className="min-w-0">
            <p className="m-0 truncate text-body font-medium text-ink">{r.noticeHref ? <Link href={r.noticeHref} className="text-ink hover:text-teal">{r.title}</Link> : r.title}</p>
            <p className="mb-0 mt-0.5 flex items-center gap-1.5 truncate text-meta text-ink-muted">
              {r.mark === "synced" ? <Pill variant="trust-synced">Synced</Pill> : <Pill variant="trust-curated">Curated</Pill>}
              <span className="truncate">{r.meta}</span>
              {r.status === "draft" ? <Pill variant="status-draft">Draft</Pill> : r.status === "needs_review" ? <Pill variant="status-needs-review">Needs review</Pill> : null}
            </p>
          </div>
          <span className={cn("whitespace-nowrap text-dense font-medium tabular-nums", r.internal.tone === "urgent" ? "text-danger" : r.internal.tone === "muted" ? "text-ink-muted" : "text-ink")}>{r.internal.label}</span>
          <span className="whitespace-nowrap text-dense tabular-nums text-ink-body">{r.sponsorDue}</span>
          <span className="truncate text-dense text-ink-body">{r.capLine}</span>
          <span className="flex items-center justify-end gap-1.5">
            {viewerIsCurator ? <Link href={r.editHref} className="text-meta font-medium text-ink-muted hover:text-navy">Edit</Link> : null}
            {r.interested ? (
              <Button variant="secondary" size={28} onClick={() => setInterest(r, false)} disabled={pending}>Withdraw interest</Button>
            ) : r.canExpress ? (
              <Button variant="secondary" size={28} onClick={() => setInterest(r, true)} disabled={pending}>Express interest</Button>
            ) : (
              <Button variant="secondary" size={28} onClick={() => setOpen(r)}>View</Button>
            )}
          </span>
        </div>
      )) : (
        <div className="px-5 py-8 text-center text-dense text-ink-muted">{viewerIsCurator ? "No limited-submission overlays have been added yet. Add the first one from an InfoReady competition." : "No limited-submission overlays have been published yet."}</div>
      )}
      <div className="border-t border-line px-5 py-3 text-meta leading-normal text-ink-muted">Overlays come from InfoReady (manual re-entry until an API is confirmed). The sponsor record is the synced federal notice and cannot be edited here; a foundation notice not in the catalog appears as Curated.</div>
      <LimitedDetailSheet row={open} onClose={() => setOpen(null)} viewerIsCurator={viewerIsCurator} />
    </section>
  );
}

export function LimitedDetailSheet({ row, onClose, viewerIsCurator }: { row: LimitedRow | null; onClose: () => void; viewerIsCurator: boolean }) {
  if (!row) return null;
  const o = row.overlay;
  const dl: Array<[string, React.ReactNode]> = [
    ["Internal nomination due", o.internal_due ? fmtMonDY(o.internal_due) : "—"],
    ["Sponsor due", row.sponsorDue],
    ["Cap · nominations", row.capLine],
    ["InfoReady competition", o.infoready_url ? <a href={o.infoready_url} target="_blank" rel="noreferrer" className="break-all text-teal hover:text-navy">{o.infoready_url}</a> : "—"],
  ];
  const prov: Array<[string, React.ReactNode]> = [
    ["Source", o.source_kind ? SOURCE_KIND_LABEL[o.source_kind] : "—"],
    ["Source link", o.source_url ? <a href={o.source_url} target="_blank" rel="noreferrer" className="break-all text-teal hover:text-navy">{o.source_url}</a> : "—"],
    ["Verified by", o.verified_by_name && o.verified_at ? `${o.verified_by_name} · ${fmtMonDY(o.verified_at.slice(0, 10))}` : "Not yet verified"],
    ["Review by", o.review_by ? fmtMonDY(o.review_by) : "—"],
  ];
  return (
    <SlideOver
      open={Boolean(row)}
      onClose={onClose}
      label="Limited submission"
      header={
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2">{row.mark === "synced" ? <Pill variant="trust-synced">Synced</Pill> : <Pill variant="trust-curated">Curated</Pill>}<Pill variant="trust-curated">UCSF process · Curated</Pill><StatusPill status={row.status} /></div>
          <h2 className="m-0 text-title font-semibold text-ink">{row.title}</h2>
          <p className="mb-0 mt-1.5 text-meta text-ink-muted">{row.meta}</p>
        </div>
      }
      footer={<div className="flex items-center justify-between gap-2"><span className="text-meta text-ink-muted">{row.noticeHref ? <Link href={row.noticeHref} className="text-teal hover:text-navy">Open the sponsor notice →</Link> : "Curated non-federal notice"}</span>{viewerIsCurator ? <Link href={row.editHref} className="inline-flex h-8 items-center rounded-control border border-line-control bg-card px-3 text-dense font-medium text-ink hover:bg-canvas">Edit in Curator</Link> : null}</div>}
    >
      <div className="flex flex-col gap-[18px] px-6 py-5">
        {row.closed ? <div className="rounded-[8px] border border-line bg-canvas px-3 py-2.5 text-dense leading-normal text-ink-body">UCSF has filled its nomination slot{(o.cap ?? 0) === 1 ? "" : "s"} for this competition.</div> : row.passed ? <div className="rounded-[8px] border border-line bg-canvas px-3 py-2.5 text-dense leading-normal text-ink-body">The internal nomination deadline has passed.</div> : null}
        <section>
          <p className="mb-2 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">UCSF process</p>
          {o.process ? <p className="mb-3 mt-0 whitespace-pre-line text-body leading-relaxed text-ink">{o.process}</p> : null}
          <dl className="m-0 grid grid-cols-[170px_minmax(0,1fr)] gap-x-4 gap-y-2 text-dense">{dl.map(([k, v]) => <div key={k} className="contents"><dt className="text-ink-muted">{k}</dt><dd className="m-0 font-medium text-ink">{v}</dd></div>)}</dl>
        </section>
        <section>
          <p className="mb-2 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">Provenance</p>
          <dl className="m-0 grid grid-cols-[170px_minmax(0,1fr)] gap-x-4 gap-y-2 text-dense">{prov.map(([k, v]) => <div key={k} className="contents"><dt className="text-ink-muted">{k}</dt><dd className="m-0 font-medium text-ink">{v}</dd></div>)}</dl>
        </section>
      </div>
    </SlideOver>
  );
}
