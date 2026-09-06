import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { Pill, type PillVariant } from "@/components/ui/pill";
import type { EvidenceRef } from "@/lib/fit/inspect/evidence";
import { CONFIDENCE_LABEL } from "@/lib/fit/inspect/labels";
import type { QuoteView } from "@/lib/fit/inspect/opportunity-view";
import type { Confidence } from "@/lib/fit/types";
import { cn } from "@/lib/utils/cn";

/**
 * Presentational pieces shared by the three inspector pages (plan § PR 1.6).
 * `SectionCard` is the card the investigator and opportunity detail pages
 * define locally (same markup), lifted here so the fit pages can reuse it.
 */
export function SectionCard({ title, aside, children, className }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-card border border-line bg-card", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <h2 className="m-0 whitespace-nowrap text-[15px] font-semibold text-ink">{title}</h2>
        {/* A div, not a span: the flag form inside it is a 520px block, and it wraps under the title when the row is too narrow. */}
        {aside ? <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2 text-right text-meta text-ink-muted">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

const CONFIDENCE_VARIANT: Record<Confidence, PillVariant> = { high: "status-open", medium: "status-needs-review", low: "status-closed" };

/** Confidence badge: high green, medium amber, low grey — the existing status pills, label always as text. */
export function ConfidencePill({ confidence, prefix }: { confidence: Confidence; prefix?: string }) {
  const c: Confidence = confidence === "high" || confidence === "medium" ? confidence : "low";
  return (
    <Pill variant={CONFIDENCE_VARIANT[c]} title={`Confidence ${c}`}>
      {prefix ? `${prefix} · ` : ""}
      {CONFIDENCE_LABEL[c]}
    </Pill>
  );
}

/** A weight in [0, 1] as a short bar with the number beside it. */
export function WeightBar({ weight, muted }: { weight: number | null; muted?: boolean }) {
  if (weight === null || weight === undefined) return <span className="text-meta text-ink-muted">—</span>;
  const pct = Math.max(0, Math.min(1, weight)) * 100;
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className="inline-block h-1.5 w-20 overflow-hidden rounded-full bg-line-row" aria-hidden>
        <span className={cn("block h-full rounded-full", muted ? "bg-line-control" : "bg-teal")} style={{ width: `${pct}%` }} />
      </span>
      <span className={cn("font-mono text-meta tabular-nums", muted ? "text-ink-muted" : "text-ink")}>{weight.toFixed(2)}</span>
    </span>
  );
}

/** The partial-profile banner (D20 / D22). */
export function PartialBanner({ title, message, items }: { title: string; message: string; items?: string[] }) {
  return (
    <div role="status" className="rounded-card border border-warning bg-warning-tint px-5 py-3.5 text-dense text-ink">
      <p className="m-0 font-semibold">{title}</p>
      <p className="mb-0 mt-1 leading-normal">{message}</p>
      {items?.length ? (
        <ul className="mb-0 mt-1.5 list-disc pl-5">
          {items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The not-authorized treatment of the other role-gated pages (library queue): one empty state, no redirect. */
export function AdminsOnly() {
  return <EmptyState title="Admins only" description="The fit-profile inspector is for the profile spot check. Ask an administrator for the admin role, or open the investigator or opportunity page instead." />;
}

/** The evidence behind one category: kind, title (linked when public), meta. */
export function EvidenceList({ items, empty = "No evidence recorded for this category." }: { items: EvidenceRef[]; empty?: string }) {
  if (!items.length) return <p className="m-0 text-meta text-ink-muted">{empty}</p>;
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {items.map((e) => (
        <li key={e.id} className="flex items-start gap-2 text-meta leading-snug">
          <span className={cn("mt-px inline-flex h-4 shrink-0 items-center rounded-full px-1.5 text-micro font-medium", e.prior ? "bg-card text-ink-muted border border-line-control" : "bg-line-row text-ink-body")} title={e.id}>
            {e.kindLabel}
          </span>
          <span className="min-w-0">
            {e.href ? (
              <a href={e.href} target="_blank" rel="noreferrer" className={cn("font-medium hover:text-teal", e.resolved ? "text-ink" : "text-ink-muted")}>
                {e.title}
              </a>
            ) : (
              <span className={cn("font-medium", e.resolved ? "text-ink" : "text-ink-muted")}>{e.title}</span>
            )}
            {e.meta ? <span className="text-ink-muted"> · {e.meta}</span> : null}
            {!e.resolved && e.kind !== "unknown" ? <span className="text-ink-muted"> · row not on file</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A verified notice quote with the Guide section it came from. */
export function Quote({ q, compact }: { q: QuoteView | null; compact?: boolean }) {
  if (!q) return compact ? null : <p className="m-0 text-meta text-ink-muted">No verified quote.</p>;
  return (
    <blockquote className={cn("m-0 border-l-2 border-line-control pl-3 text-meta leading-snug text-ink-body", compact && "mt-1")}>
      <span className="italic">“{q.quote}”</span>
      {q.section ? <span className="block text-micro text-ink-muted">{q.section}</span> : null}
    </blockquote>
  );
}

/** Label / value pairs, optionally with a quote under the value. */
export function FactTable({ rows }: { rows: Array<{ label: string; value: string; quote?: QuoteView | null }> }) {
  return (
    <dl className="m-0 grid grid-cols-[minmax(160px,220px)_minmax(0,1fr)] gap-x-4 gap-y-2 px-5 py-4 text-dense">
      {rows.map((r) => (
        <div key={r.label} className="contents">
          <dt className="text-ink-muted">{r.label}</dt>
          <dd className="m-0 min-w-0 break-words">
            {r.value}
            {r.quote ? <Quote q={r.quote} compact /> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** "Label · label · label" of the page header. */
export function MetaLine({ parts }: { parts: Array<ReactNode | null | undefined | false> }) {
  const shown = parts.filter((p) => p !== null && p !== undefined && p !== false);
  return (
    <p className="mb-0 mt-1 text-dense text-ink-muted">
      {shown.map((p, i) => (
        <span key={i}>
          {i ? " · " : ""}
          {p}
        </span>
      ))}
    </p>
  );
}

export function TagList({ tags, empty = "—", mono }: { tags: string[]; empty?: string; mono?: boolean }) {
  if (!tags.length) return <span className="text-meta text-ink-muted">{empty}</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((t, i) => (
        <span key={`${t}-${i}`} className={cn("inline-flex h-[22px] items-center rounded-full bg-line-row px-2 text-meta text-ink-body", mono && "font-mono")}>
          {t}
        </span>
      ))}
    </span>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="text-dense text-ink-muted hover:text-ink">
      ← {label}
    </Link>
  );
}

/** Log lines (merge log, blend log, dropped claims) in a small mono list. */
export function LogList({ lines, empty = "—" }: { lines: string[]; empty?: string }) {
  if (!lines.length) return <p className="m-0 text-meta text-ink-muted">{empty}</p>;
  return (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0 font-mono text-micro leading-snug text-ink-body">
      {lines.map((l, i) => (
        <li key={i} className="break-words">
          {l}
        </li>
      ))}
    </ul>
  );
}
