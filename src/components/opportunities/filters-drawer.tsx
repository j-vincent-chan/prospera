"use client";

import Link from "next/link";
import { useRef } from "react";
import { useModal } from "@/components/ui/use-modal";
import { Button } from "@/components/ui/button";
import type { FilterGroup } from "@/components/opportunities/opportunities-screen";
import { cn } from "@/lib/utils/cn";

/** 400px "More filters" drawer. Each option is a link that toggles itself in the URL. */
export function FiltersDrawer({ open, onClose, groups, resultCount, resetHref }: { open: boolean; onClose: () => void; groups: FilterGroup[]; resultCount: number; resetHref: string }) {
  const ref = useRef<HTMLElement>(null);
  useModal(ref, open, onClose);
  if (!open) return null;
  return (
    <>
      <div onClick={onClose} className="fixed inset-0 z-40 bg-scrim" aria-hidden />
      <aside ref={ref} role="dialog" aria-modal="true" aria-label="Filters drawer" tabIndex={-1} className="fixed bottom-0 right-0 top-0 z-50 flex w-[400px] flex-col border-l border-line bg-card shadow-slideover outline-none">
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="m-0 text-[15px] font-semibold text-ink">Filters</h2>
          <div className="flex items-center gap-2">
            <Link href={resetHref} className="text-dense text-teal hover:text-navy">Reset</Link>
            <button type="button" onClick={onClose} aria-label="Close" className="inline-flex h-7 w-7 items-center justify-center rounded-control border border-line-control bg-card text-ink-muted">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-5 pt-2">
          {groups.map((g) => (
            <details key={g.param} open={g.open} className="border-b border-line-row py-3">
              <summary className="flex cursor-pointer list-none items-center justify-between text-body font-medium text-ink [&::-webkit-details-marker]:hidden">
                {g.title}
                <span className="text-meta font-normal text-ink-muted">{g.summary}</span>
              </summary>
              <div className="mt-2.5 flex flex-col gap-1.5">
                {g.options.map((o) => (
                  <Link key={o.value} href={o.href} scroll={false} className="flex items-center gap-2 text-dense text-ink">
                    <span className={cn("inline-flex h-4 w-4 items-center justify-center rounded-[3px] border", o.on ? "border-navy bg-navy text-white" : "border-line-control bg-card")} aria-hidden>
                      {o.on ? <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg> : null}
                    </span>
                    {o.label}
                  </Link>
                ))}
              </div>
            </details>
          ))}
        </div>
        <footer className="flex justify-end gap-2 border-t border-line bg-footer-bar px-5 py-3">
          <Button variant="primary" size={32} onClick={onClose}>Show {new Intl.NumberFormat("en-US").format(resultCount)} results</Button>
        </footer>
      </aside>
    </>
  );
}
