"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/menu";
import type { SourceAction, SourceChipModel } from "@/lib/investigators/sources";
import { cn } from "@/lib/utils/cn";

/**
 * One source chip from Investigators v2 — `RePORTER (3)` — with its evidence
 * popover. Teal = available, amber = stale, dashed = unavailable, teal dot =
 * updated this week. The state is always written out in the popover.
 */

const chipVisual = {
  ok: "bg-teal-tint text-teal border border-transparent",
  stale: "bg-warning-tint text-warning border border-transparent",
  none: "bg-card text-ink-muted border border-dashed border-line-control",
} as const;

export function StatePill({ label }: { label: SourceChipModel["stateLabel"] }) {
  const cls =
    label === "Updated this week"
      ? "bg-teal text-white"
      : label === "Available"
        ? "bg-teal-tint text-teal"
        : label === "Stale"
          ? "bg-warning-tint text-warning"
          : "bg-line-row text-ink-muted";
  return <span className={cn("inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-full px-2 text-micro font-medium", cls)}>{label}</span>;
}

export function SourceChipButton({
  chip,
  open,
  onClick,
  size = "row",
  className,
  ...rest
}: {
  chip: Pick<SourceChipModel, "label" | "count" | "visual" | "recent" | "title">;
  open?: boolean;
  onClick?: () => void;
  size?: "row" | "legend";
  className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "title">) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={chip.title}
      aria-expanded={onClick ? open : undefined}
      aria-haspopup={onClick ? "dialog" : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-control font-medium hover:brightness-[0.97]",
        size === "row" ? "h-6 px-2 text-meta" : "h-[18px] px-1.5 text-[11px]",
        chipVisual[chip.visual],
        open && "ring-2 ring-teal",
        !onClick && "cursor-default",
        className,
      )}
      {...rest}
    >
      {chip.recent ? <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-teal" /> : null}
      {chip.label} <span className="tabular font-normal opacity-80">{chip.count}</span>
    </button>
  );
}

export function SourceChip({
  chip,
  open,
  onToggle,
  onClose,
  profileHref,
  onAction,
  pending,
}: {
  chip: SourceChipModel;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  profileHref: string;
  onAction: (action: SourceAction) => void;
  pending: boolean;
}) {
  const actionIsLink = chip.action.kind === "open_profile" || chip.action.kind === "review_identity";
  const actionHref = chip.action.kind === "review_identity" ? `${profileHref}#publications` : profileHref;
  return (
    <span className="relative inline-flex">
      <SourceChipButton chip={chip} open={open} onClick={onToggle} />
      <Popover open={open} onClose={onClose} label={chip.popTitle} width={380} className="!top-[30px] p-0 whitespace-normal">
        <div className="flex items-start justify-between gap-3 border-b border-line-row px-3.5 py-3">
          <div className="min-w-0">
            <p className="m-0 text-dense font-semibold text-ink">{chip.popTitle}</p>
            <p className="mb-0 mt-0.5 text-meta leading-normal text-ink-muted">{chip.meta}</p>
            {chip.flag ? <p className="mb-0 mt-1 text-meta leading-normal text-warning">{chip.flag}</p> : null}
          </div>
          <StatePill label={chip.stateLabel} />
        </div>
        {chip.items.length ? (
          <ul className="m-0 list-none p-0">
            {chip.items.map((it, i) => (
              <li key={i} className="border-b border-line-row px-3.5 py-2">
                <p className="m-0 text-dense font-medium leading-snug text-ink">{it.heading}</p>
                {it.sub ? <p className="mb-0 mt-0.5 text-meta leading-snug text-ink-muted">{it.sub}</p> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {chip.empty ? <p className="m-0 border-b border-line-row px-3.5 py-3 text-dense leading-normal text-ink-body">{chip.empty}</p> : null}
        <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
          <Link href={profileHref} className="whitespace-nowrap text-meta font-medium text-teal hover:text-navy">
            Open profile →
          </Link>
          {actionIsLink ? (
            <Link href={actionHref} className="inline-flex h-7 items-center whitespace-nowrap rounded-control border border-line-control bg-card px-2.5 text-meta font-medium text-ink hover:bg-canvas">
              {chip.action.label}
            </Link>
          ) : (
            <Button variant="secondary" size={28} className="text-meta" disabled={pending} onClick={() => onAction(chip.action)}>
              {pending ? "Working…" : chip.action.label}
            </Button>
          )}
        </div>
      </Popover>
    </span>
  );
}
