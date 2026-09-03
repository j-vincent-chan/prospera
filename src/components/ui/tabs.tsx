"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Two tab grammars from Foundations / Team Settings:
 *  - `Tabs` — underline tabs on a hairline (14/500, navy 2px underline).
 *  - `SegmentTabs` — 32px pill buttons, navy-filled when active, with counts.
 * Both take items with either `href` (navigation) or `onSelect` (in-page).
 */
export type TabItem = {
  key: string;
  label: ReactNode;
  href?: string;
  onSelect?: () => void;
  /** Muted count after the label. */
  count?: number | string;
  /** Teal-tinted badge count (pending requests). */
  badge?: number;
  disabled?: boolean;
};

export function Tabs({
  items,
  active,
  aside,
  className,
}: {
  items: TabItem[];
  active: string;
  /** Right-aligned link or text on the tab row. */
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-end justify-between gap-6 border-b border-line", className)}>
      <div role="tablist" className="flex gap-6">
        {items.map((item) => (
          <TabButton key={item.key} item={item} active={item.key === active} />
        ))}
      </div>
      {aside ? <div className="pb-2.5 text-dense">{aside}</div> : null}
    </div>
  );
}

function TabButton({ item, active }: { item: TabItem; active: boolean }) {
  const className = cn(
    "-mb-px inline-flex items-center gap-1 whitespace-nowrap border-b-2 pb-2.5 pt-2 text-body font-medium",
    active ? "border-navy text-ink" : "border-transparent text-ink-muted hover:text-ink",
    item.disabled && "cursor-default opacity-60",
  );
  const content = (
    <>
      {item.label}
      {item.count !== undefined ? <span className="ml-1 text-ink-muted">{item.count}</span> : null}
    </>
  );
  if (item.href && !item.disabled) {
    return (
      <Link role="tab" aria-selected={active} href={item.href} className={className}>
        {content}
      </Link>
    );
  }
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      disabled={item.disabled}
      onClick={item.onSelect}
      className={className}
    >
      {content}
    </button>
  );
}

export function SegmentTabs({
  items,
  active,
  className,
}: {
  items: TabItem[];
  active: string;
  className?: string;
}) {
  return (
    <div role="tablist" className={cn("flex gap-1.5", className)}>
      {items.map((item) => {
        const on = item.key === active;
        const cls = cn(
          "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-control border px-3 text-dense font-medium",
          on ? "border-navy bg-navy text-white" : "border-line-control bg-card text-ink hover:bg-canvas",
        );
        const content = (
          <>
            {item.label}
            {item.count !== undefined ? <span className="opacity-70">{item.count}</span> : null}
            {item.badge !== undefined ? (
              <span
                className={cn(
                  "inline-flex h-[18px] items-center rounded-full px-1.5 text-micro font-semibold",
                  item.badge > 0 ? (on ? "bg-white text-navy" : "bg-teal-tint text-teal") : "opacity-70",
                )}
              >
                {item.badge}
              </span>
            ) : null}
          </>
        );
        if (item.href) {
          return (
            <Link key={item.key} role="tab" aria-selected={on} href={item.href} className={cls}>
              {content}
            </Link>
          );
        }
        return (
          <button key={item.key} type="button" role="tab" aria-selected={on} onClick={item.onSelect} className={cls}>
            {content}
          </button>
        );
      })}
    </div>
  );
}
