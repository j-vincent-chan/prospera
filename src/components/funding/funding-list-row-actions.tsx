"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dismissFundingOpportunityAction } from "@/app/actions/funding-search-saves";
import { openExternalFundingUrl } from "@/lib/funding-opportunities/source-url";

const ICON_16 = "h-4 w-4 shrink-0";
const ICON_12 = "h-3 w-3 shrink-0";


function MoreIcon() {
  return (
    <svg viewBox="0 0 16 16" className={ICON_16} fill="currentColor" aria-hidden>
      <circle cx="3" cy="8" r="1.25" />
      <circle cx="8" cy="8" r="1.25" />
      <circle cx="13" cy="8" r="1.25" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg viewBox="0 0 16 16" className={ICON_12} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M6 2.5H3.5A1 1 0 002.5 3.5v9a1 1 0 001 1h9a1 1 0 001-1V11M9 2.5h4.5V7M7 9l6.5-6.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 16 16" className={ICON_12} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <circle cx="12" cy="3.5" r="1.75" />
      <circle cx="4" cy="8" r="1.75" />
      <circle cx="12" cy="12.5" r="1.75" />
      <path d="M5.6 7.1l4.8-2.4M5.6 8.9l4.8 2.4" strokeLinecap="round" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 16 16" className={ICON_12} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <circle cx="6" cy="5.5" r="2" />
      <path d="M2 13.5c0-2.2 1.8-3.5 4-3.5s4 1.3 4 3.5" strokeLinecap="round" />
      <circle cx="11.5" cy="5" r="1.5" />
      <path d="M14 13.5c0-1.5-1-2.5-2.5-2.8" strokeLinecap="round" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 16 16" className={ICON_12} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
    </svg>
  );
}

function iconButtonClass() {
  return "inline-flex h-[26px] w-[26px] items-center justify-center rounded-[6px] text-[var(--fo-ink-faint)] transition-colors hover:bg-[var(--fo-paper-2)] hover:text-[var(--fo-title)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fo-focus-ring)]";
}

function menuItemClass(danger?: boolean) {
  return [
    "flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-medium transition-colors",
    danger
      ? "text-[var(--fo-ink-body)] hover:bg-red-50 hover:text-red-700"
      : "text-[var(--fo-ink-body)] hover:bg-[var(--fo-row-hover)]",
  ].join(" ");
}

export function FundingListRowActions({
  opportunityId,
  title,
  sourceUrl,
  isMatched,
  loggedIn,
}: {
  opportunityId: string;
  title: string;
  sourceUrl: string | null;
  isMatched: boolean;
  loggedIn: boolean;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [menuOpen]);

  const mailto = `mailto:?subject=${encodeURIComponent(`Funding opportunity: ${title}`)}&body=${encodeURIComponent(`Review this opportunity: /funding-opportunities/${opportunityId}`)}`;
  // Matching moves into the Outreach workspace (step 5); until then the row action lands on /outreach.
  const matchHref = "/outreach";

  return (
    <div className="flex shrink-0 items-center justify-end gap-[6px]">
      <Link
        href={matchHref}
        className="inline-flex h-7 shrink-0 items-center rounded-control border border-line-control bg-card px-2.5 text-dense font-medium text-ink hover:bg-canvas"
      >
        {isMatched ? "Matched" : "Match"}
      </Link>

      <div ref={menuRef} className="relative">
        <button
          type="button"
          aria-label="More actions"
          aria-expanded={menuOpen}
          title="More actions"
          className={iconButtonClass()}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <MoreIcon />
        </button>
        {menuOpen ? (
          <div
            role="menu"
            className="absolute right-0 top-[calc(100%+4px)] z-50 min-w-[150px] overflow-hidden rounded-[10px] border border-[var(--fo-border)] bg-white py-1 shadow-[0_4px_16px_rgba(0,0,0,0.08)]"
          >
            {sourceUrl ? (
              <button
                type="button"
                role="menuitem"
                className={menuItemClass()}
                onClick={() => {
                  setMenuOpen(false);
                  openExternalFundingUrl(sourceUrl);
                }}
              >
                <ExternalLinkIcon />
                View detail
              </button>
            ) : (
              <Link
                href={`/funding-opportunities/${opportunityId}`}
                role="menuitem"
                className={menuItemClass()}
                onClick={() => setMenuOpen(false)}
              >
                <ExternalLinkIcon />
                View detail
              </Link>
            )}
            <a href={mailto} role="menuitem" className={menuItemClass()} onClick={() => setMenuOpen(false)}>
              <ShareIcon />
              Share
            </a>
            <Link
              href={`/match/saved/${opportunityId}`}
              role="menuitem"
              className={menuItemClass()}
              onClick={() => setMenuOpen(false)}
            >
              <UsersIcon />
              Assign
            </Link>
            <div className="my-1 border-t border-[var(--fo-divider)]" role="separator" />
            {loggedIn ? (
              <button
                type="button"
                role="menuitem"
                disabled={pending}
                className={menuItemClass(true)}
                onClick={() => {
                  setMenuOpen(false);
                  if (!window.confirm("Dismiss this opportunity? It will be hidden from your search results.")) {
                    return;
                  }
                  startTransition(async () => {
                    const result = await dismissFundingOpportunityAction(opportunityId);
                    if (!result.ok) window.alert(result.error);
                    else router.refresh();
                  });
                }}
              >
                <XIcon />
                Dismiss
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
