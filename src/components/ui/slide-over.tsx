"use client";

import { useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils/cn";
import { useHydrated } from "@/components/ui/use-hydrated";
import { useModal } from "@/components/ui/use-modal";

/**
 * Right-edge panel. Same modal contract as Dialog (Esc, scrim, focus trap,
 * focus return). Widths in the system: 560 for the opportunity peek, 880 for
 * the outreach workspace.
 */
export function SlideOver({
  open,
  onClose,
  label,
  header,
  children,
  footer,
  width = 560,
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible name for the panel. */
  label: string;
  /** Rendered inside the sticky header, beside the close button. */
  header?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const panelRef = useRef<HTMLElement>(null);
  // A portal cannot exist in server HTML, so a panel that is *already open on
  // the first render* — `/outreach?item=<id>`, where the page reads `?item=`
  // and server-renders the workspace open — used to hydrate a portal the
  // server never emitted: "Expected server HTML to contain a matching <div>",
  // then a failed hydration and a discarded subtree, on every bookmarked or
  // shared link. Waiting for hydration makes the client's first render agree
  // with the server's (both render nothing) and moves the portal into the
  // commit straight after. `useHydrated` costs the click-opened panels
  // nothing: React only takes the server snapshot while hydrating.
  const hydrated = useHydrated();
  const active = open && hydrated;
  // The modal contract keys off `active`, not `open`, so the trap installs
  // when the panel is really in the DOM and `panelRef` can be focused.
  useModal(panelRef, active, onClose);

  if (!active || typeof document === "undefined") return null;

  return createPortal(
    <>
      <div onClick={onClose} className="fixed inset-0 z-40 bg-scrim" aria-hidden />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        style={{ width }}
        className={cn(
          "fixed bottom-0 right-0 top-0 z-50 flex max-w-full flex-col",
          "border-l border-line bg-card shadow-slideover outline-none",
        )}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-6 py-5">
          <div className="min-w-0 flex-1">{header}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-line-row hover:text-ink"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer ? (
          <footer className="shrink-0 border-t border-line bg-footer-bar px-6 py-3">{footer}</footer>
        ) : null}
      </aside>
    </>,
    document.body,
  );
}
