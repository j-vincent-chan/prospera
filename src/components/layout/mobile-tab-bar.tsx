"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { SidebarBadges } from "@/components/layout/app-shell-sidebar";
import { cn } from "@/lib/utils/cn";

/**
 * Bottom tab bar below `md` (Mobile v2 §Responsive rules: "bottom tab bar
 * (Today, Opportunities, Outreach, Calendar, More)"), with the sidebar's names
 * and order (decision N2): Discover, Outreach, Funding Notices, More. There is
 * no Home tab — Discover is where the app opens — and Discover took Calendar's
 * slot: the Review handoff (§0) put it first in the nav with the undecided
 * count, and it is the screen the strategist opens every day, while Calendar
 * moved into "More" with everything else the sidebar lists. Touch targets are
 * 44px. "More" opens a sheet over the bar rather than a page, so nothing the
 * desktop nav reaches is unreachable on a phone.
 */
const TABS = [
  { href: "/review", label: "Discover", d: "m3 17 2 2 4-4 M3 7l2 2 4-4 M13 6h8 M13 12h8 M13 18h8", badge: "review" as const },
  { href: "/outreach", label: "Outreach", d: "m22 2-7 20-4-9-9-4z M22 2 11 13", badge: "outreach" as const },
  { href: "/opportunities", label: "Funding Notices", d: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z m10 2-4.3-4.3", badge: undefined },
];

const MORE = [
  { href: "/calendar", label: "Calendar" },
  { href: "/investigators", label: "Investigators" },
  { href: "/communities", label: "Communities" },
  { href: "/reports", label: "Reports" },
  { href: "/library", label: "Proposal Library" },
  { href: "/settings", label: "Settings" },
  { href: "/team", label: "Team settings" },
];

const NO_BADGES: SidebarBadges = { review: 0, outreach: 0 };

const tabClass = (active: boolean) =>
  cn("relative flex min-h-[44px] flex-col items-center justify-center gap-[3px] text-[10px] font-medium", active ? "text-ink" : "text-ink-muted");

function TabIcon({ d }: { d: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export function MobileTabBar({ badges = NO_BADGES }: { badges?: SidebarBadges }) {
  const pathname = usePathname() ?? "";
  const [moreOpen, setMoreOpen] = useState(false);
  // Navigating closes the sheet; so does Escape.
  useEffect(() => setMoreOpen(false), [pathname]);
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMoreOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [moreOpen]);
  const moreActive = MORE.some((m) => pathname.startsWith(m.href));

  return (
    <>
      {moreOpen ? <div onClick={() => setMoreOpen(false)} className="fixed inset-0 z-30 bg-scrim md:hidden" aria-hidden /> : null}
      {moreOpen ? (
        <nav aria-label="More" className="fixed inset-x-0 bottom-[68px] z-40 rounded-t-card border-t border-line bg-card px-2 pb-2 pt-2 shadow-dialog md:hidden">
          {MORE.map((m) => {
            const active = pathname.startsWith(m.href);
            return (
              <Link key={m.href} href={m.href} aria-current={active ? "page" : undefined} className={cn("flex min-h-[44px] items-center rounded-control px-3 text-body", active ? "bg-navy-nav font-semibold text-ink" : "font-medium text-ink-body")}>
                {m.label}
              </Link>
            );
          })}
        </nav>
      ) : null}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-line bg-card pb-3.5 pt-2 md:hidden" aria-label="Primary">
        {TABS.map((t) => {
          const active = !moreOpen && pathname.startsWith(t.href);
          const count = t.badge ? badges[t.badge] : 0;
          return (
            <Link key={t.href} href={t.href} className={tabClass(active)} aria-current={active ? "page" : undefined}>
              <TabIcon d={t.d} />
              {t.label}
              {count > 0 ? (
                <span className="absolute left-1/2 top-0 ml-1.5 rounded-full bg-teal px-1.5 text-[10px] font-semibold leading-4 text-white" aria-label={`${count} ${t.badge === "review" ? "undecided" : "waiting"}`}>
                  {count}
                </span>
              ) : null}
            </Link>
          );
        })}
        <button type="button" onClick={() => setMoreOpen((o) => !o)} aria-expanded={moreOpen} aria-haspopup="menu" className={tabClass(moreOpen || moreActive)}>
          <TabIcon d="M12 12h.01 M19 12h.01 M5 12h.01" />
          More
        </button>
      </nav>
    </>
  );
}
