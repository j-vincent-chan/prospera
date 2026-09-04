"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setLimitedInterestAction } from "@/app/actions/curate-actions";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { useToast } from "@/components/ui/toast";
import type { LimitedRow } from "@/lib/institution/curated";
import { cn } from "@/lib/utils/cn";
import { ptDate } from "@/lib/institution/types";

/** Opportunity Detail: the UCSF nomination process layered on a synced notice (published overlay only). */
export function LimitedOverlayPanel({ row, viewerIsCurator }: { row: LimitedRow; viewerIsCurator: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const o = row.overlay;
  const setInterest = (interested: boolean) =>
    start(async () => {
      const res = await setLimitedInterestAction({ overlayId: o.id, interested });
      if (!res.ok) return toast({ message: res.error, tone: "error" });
      toast(interested ? { message: "Interest recorded · the curators see the count", action: { label: "Undo", onClick: () => void setLimitedInterestAction({ overlayId: o.id, interested: false }).then(() => router.refresh()) } } : { message: "Interest withdrawn" });
      router.refresh();
    });
  return (
    <section className="rounded-card border border-line bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <h2 className="m-0 whitespace-nowrap text-section font-semibold uppercase text-ink">Limited submission · UCSF process</h2>
        <span className="flex items-center gap-1.5">{row.status === "draft" ? <Pill variant="status-draft">Draft</Pill> : row.status === "needs_review" ? <Pill variant="status-needs-review">Needs review</Pill> : null}<Pill variant="trust-curated">Curated</Pill></span>
      </div>
      <div className="flex flex-col gap-3 px-5 py-3.5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="m-0 text-meta text-ink-muted">Internal nomination due</p>
            <p className={cn("mb-0 mt-0.5 text-body font-semibold tabular-nums", row.internal.tone === "urgent" ? "text-danger" : row.internal.tone === "muted" ? "text-ink-muted" : "text-ink")}>{row.internal.label}</p>
          </div>
          <div>
            <p className="m-0 text-meta text-ink-muted">Cap · nominations</p>
            <p className="mb-0 mt-0.5 text-body font-semibold text-ink">{row.capLine}</p>
          </div>
        </div>
        {o.process ? <p className="m-0 whitespace-pre-line text-dense leading-normal text-ink-body">{o.process}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          {row.interested ? (
            <Button variant="secondary" size={32} onClick={() => setInterest(false)} disabled={pending}>Withdraw interest</Button>
          ) : row.canExpress ? (
            <Button variant="primary" size={32} onClick={() => setInterest(true)} disabled={pending}>Express interest</Button>
          ) : (
            <span className="text-dense text-ink-muted">{row.closed ? "UCSF's nomination slots are filled." : row.passed ? "The internal deadline has passed." : "Not open for interest."}</span>
          )}
          {o.infoready_url ? <a href={o.infoready_url} target="_blank" rel="noreferrer" className="text-dense font-medium text-teal hover:text-navy">InfoReady competition →</a> : null}
          {viewerIsCurator ? <Link href={row.editHref} className="text-dense text-ink-muted hover:text-navy">Edit overlay</Link> : null}
        </div>
        <p className="m-0 text-meta leading-normal text-ink-muted">Verified by {o.verified_by_name ?? "a curator"}{o.verified_at ? ` · ${ptDate(o.verified_at)}` : ""}{o.review_by ? ` · review by ${o.review_by}` : ""} · the sponsor notice above stays synced and read-only.</p>
      </div>
    </section>
  );
}
