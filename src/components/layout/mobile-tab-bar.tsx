"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";

/**
 * Bottom tab bar below 800px (Mobile v2): Home, Opportunities, Outreach,
 * Calendar, More. Touch targets are 44px.
 */
const TABS = [
  { href: "/home", label: "Home", d: "m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10" },
  { href: "/opportunities", label: "Opportunities", d: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z m10 2-4.3-4.3" },
  { href: "/outreach", label: "Outreach", d: "M3 3h18v18H3z M9 3v18 M15 3v18" },
  { href: "/calendar", label: "Calendar", d: "M3 4h18v18H3z M16 2v4M8 2v4M3 10h18" },
  { href: "/settings", label: "More", d: "M12 12h.01 M19 12h.01 M5 12h.01" },
];

export function MobileTabBar() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-card pb-3.5 pt-2 md:hidden" aria-label="Primary">
      {TABS.map((t) => {
        const active = pathname.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} className={cn("flex min-h-[44px] flex-col items-center justify-center gap-[3px] text-[10px] font-medium", active ? "text-ink" : "text-ink-muted")} aria-current={active ? "page" : undefined}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={t.d} /></svg>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
