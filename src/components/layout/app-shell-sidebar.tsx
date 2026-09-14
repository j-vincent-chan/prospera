"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ComponentType, type SVGProps } from "react";
import { switchTeamAction } from "@/app/actions/team-actions";
import { signOut } from "@/app/actions/auth";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu";
import { cn } from "@/lib/utils/cn";
import type { CurrentWorkspace, WorkspaceSummary } from "@/lib/team/current-team";
import {
  IconBook,
  IconCalendar,
  IconChevronsUpDown,
  IconHome,
  IconListChecks,
  IconLogOut,
  IconNetwork,
  IconReport,
  IconSearch,
  IconSend,
  IconSettings,
  IconUsers,
} from "@/components/layout/sidebar-nav-icons";
import { useSubmitTransition } from "@/lib/hooks/use-submit-transition";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

/** The two counts the Review handoff puts on the nav (§0): undecided PI Match rows, and PI Outreach rows that need the strategist today. */
export type SidebarBadges = { review: number; outreach: number };

type NavItem = {
  href: string;
  label: string;
  Icon: Icon;
  isActive: (pathname: string) => boolean;
  /** Group break above the item (Sidebar2: Investigators, Reports). */
  groupBreak?: boolean;
  /** Which count this item shows on the right, when it is above zero. */
  badge?: keyof SidebarBadges;
};

// Labels match page titles exactly. Names and order are Vincent's (2026-09-13,
// decision N1): the workflow group reads PI Match, PI Outreach, Calendar, Notice
// Board — the routes keep their old names. PI Match carries the undecided count
// (Review handoff §0) and PI Outreach its "Needs you today" count.
const NAV: NavItem[] = [
  { href: "/home", label: "Home", Icon: IconHome, isActive: (p) => p.startsWith("/home") },
  { href: "/review", label: "PI Match", Icon: IconListChecks, isActive: (p) => p.startsWith("/review"), badge: "review" },
  { href: "/outreach", label: "PI Outreach", Icon: IconSend, isActive: (p) => p.startsWith("/outreach"), badge: "outreach" },
  { href: "/calendar", label: "Calendar", Icon: IconCalendar, isActive: (p) => p.startsWith("/calendar") },
  {
    href: "/opportunities",
    label: "Notice Board",
    Icon: IconSearch,
    isActive: (p) => p.startsWith("/opportunities") || p.startsWith("/curate"),
  },
  {
    href: "/investigators",
    label: "Investigators",
    Icon: IconUsers,
    isActive: (p) => p.startsWith("/investigators"),
    groupBreak: true,
  },
  {
    href: "/communities",
    label: "Communities",
    Icon: IconNetwork,
    isActive: (p) => p.startsWith("/communities"),
  },
  {
    href: "/reports",
    label: "Reports",
    Icon: IconReport,
    isActive: (p) => p.startsWith("/reports"),
    groupBreak: true,
  },
  { href: "/library", label: "Library", Icon: IconBook, isActive: (p) => p.startsWith("/library") },
];

// 36px, radius 6, padding 0 10px, gap 10, 14px: inactive 500 `#475569`, active 600 `#0b1d3a` on `#e9edf3`.
// Below `xl` the sidebar is a 56px icon rail (Mobile v2 §Responsive rules): the item is a centred icon with the
// label as its tooltip, and the count sits over the icon's corner.
const navItemClass = (active: boolean) =>
  cn(
    "relative flex h-9 items-center justify-center gap-2.5 rounded-control px-0 text-body xl:justify-start xl:px-2.5",
    active ? "bg-navy-nav font-semibold text-ink" : "font-medium text-ink-body hover:bg-line-row hover:text-ink",
  );

function NavRow({ item, pathname, count }: { item: NavItem; pathname: string; count: number }) {
  const active = item.isActive(pathname);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      title={item.label}
      className={cn(navItemClass(active), item.groupBreak && "mt-3")}
    >
      <item.Icon className="h-[18px] w-[18px] shrink-0" />
      <span className="hidden min-w-0 flex-1 truncate xl:block">{item.label}</span>
      {count > 0 ? (
        // The right-aligned count badge: 11/600 teal (§0). A number, not a dot, and only above zero.
        <span className="absolute right-1 top-0.5 text-[10px] font-semibold tabular-nums text-teal xl:static xl:ml-auto xl:shrink-0 xl:text-micro" aria-label={`${count} ${item.badge === "review" ? "undecided" : "waiting"}`}>
          {count}
        </span>
      ) : null}
    </Link>
  );
}

export type SidebarUser = {
  name: string | null;
  email: string | null;
};

function initialsOf(name: string | null, email: string | null): string {
  const source = (name?.trim() || email?.split("@")[0] || "?").replace(/[._-]+/g, " ");
  const parts = source.split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

const NO_BADGES: SidebarBadges = { review: 0, outreach: 0 };

export function AppShellSidebar({
  user,
  workspace,
  pendingCount,
  badges = NO_BADGES,
}: {
  user: SidebarUser;
  workspace: CurrentWorkspace | null;
  pendingCount: number;
  /** The nav counts; zeros when the team has none or the caller does not read them. */
  badges?: SidebarBadges;
}) {
  const pathname = usePathname() ?? "";
  const settingsActive = pathname.startsWith("/settings");

  return (
    // Sticky, full height, white, 1px right border; padding `20px clamp(8px,.8vw,12px)`; width `clamp(168px,15vw,272px)`
    // (`w-sidebar`) from `xl` up. Below that it is the 56px icon rail: icon only, labels as tooltips, no wordmark.
    <aside className="sticky top-0 flex h-screen w-14 shrink-0 flex-col overflow-y-auto border-r border-line bg-card px-2 py-5 xl:w-sidebar xl:px-[clamp(8px,0.8vw,12px)]">
      <Link href="/home" className="flex items-center justify-center gap-2.5 px-0 pb-3.5 pt-1 xl:justify-start xl:px-2" title="Prospera — Home">
        <Image
          src="/brand/prospera-app-icon.png"
          alt=""
          width={180}
          height={198}
          priority
          className="h-[30px] w-auto shrink-0"
        />
        <Image
          src="/brand/prospera-wordmark.png"
          alt="Prospera"
          width={555}
          height={115}
          priority
          className="hidden h-[18px] w-auto xl:block"
        />
      </Link>

      <div className="mb-3.5">
        {workspace ? (
          <WorkspaceSwitcher workspace={workspace} />
        ) : (
          <NoWorkspaceTile pendingCount={pendingCount} />
        )}
      </div>

      <nav aria-label="Primary" className="flex flex-col gap-0.5">
        {NAV.map((item) => (
          <NavRow key={item.href} item={item} pathname={pathname} count={item.badge ? badges[item.badge] : 0} />
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-0.5 border-t border-line pt-3">
        <Link
          href="/settings"
          aria-current={settingsActive ? "page" : undefined}
          title="Settings"
          className={navItemClass(settingsActive)}
        >
          <IconSettings className="h-[18px] w-[18px] shrink-0" />
          <span className="hidden xl:inline">Settings</span>
        </Link>

        <div className="flex flex-col items-center gap-2.5 px-0 pb-1 pt-2.5 xl:flex-row xl:px-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-tint text-micro font-semibold text-teal">
            {initialsOf(user.name, user.email)}
          </span>
          <div className="hidden min-w-0 flex-1 xl:block">
            <p className="m-0 truncate text-dense font-medium text-ink">{user.name ?? user.email ?? "Signed in"}</p>
            {user.email ? <p className="m-0 truncate text-micro text-ink-muted">{user.email}</p> : null}
          </div>
          <form action={signOut}>
            <button
              type="submit"
              title="Sign out"
              aria-label="Sign out"
              className="inline-flex rounded-control p-1 text-ink-muted hover:text-ink"
            >
              <IconLogOut className="h-4 w-4" />
            </button>
          </form>
        </div>

        <p className="mb-0 mt-2 hidden px-2.5 text-micro leading-[1.4] text-ink-muted xl:block">
          Office of Collaborative Research · UCSF
        </p>
      </div>
    </aside>
  );
}

function WorkspaceSwitcher({ workspace }: { workspace: CurrentWorkspace }) {
  const router = useRouter();
  const [pending, startTransition] = useSubmitTransition();
  const switchTo = (teamId: string) => {
    if (teamId === workspace.id) return;
    startTransition(async () => {
      const result = await switchTeamAction({ teamId });
      if (result.ok) router.push("/home");
    });
  };
  return (
    <Menu
      label="Workspaces"
      width={216}
      trigger={({ open, toggle, triggerProps }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label="Switch workspace"
          title={workspace.name}
          {...triggerProps}
          className={cn(
            "flex h-[46px] w-full items-center justify-center gap-2.5 rounded-tile border px-0 text-left xl:justify-start xl:px-2",
            open ? "border-line-control bg-canvas" : "border-line bg-card hover:border-line-control hover:bg-canvas",
          )}
        >
          <TeamTile team={workspace} size={26} />
          <span className="hidden min-w-0 flex-1 xl:block">
            <span className="block truncate text-dense font-semibold text-ink">{workspace.name}</span>
            <span className="block whitespace-nowrap text-micro text-ink-muted">
              Team workspace · {workspace.roleLabel}
            </span>
          </span>
          <IconChevronsUpDown className="hidden h-3.5 w-3.5 shrink-0 text-ink-muted xl:block" strokeWidth={2} />
        </button>
      )}
    >
      <MenuLabel>Your teams</MenuLabel>
      {workspace.teams.map((team) => {
        const current = team.id === workspace.id;
        return (
          <button
            key={team.id}
            type="button"
            role="menuitem"
            onClick={() => switchTo(team.id)}
            disabled={pending}
            className={cn(
              "flex h-10 w-full items-center gap-2.5 rounded-control px-2.5 text-left hover:bg-line-row disabled:opacity-60",
              current && "bg-canvas",
            )}
          >
            <TeamTile team={team} size={24} muted={!current} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-dense font-medium text-ink">{team.name}</span>
              <span className="block text-micro text-ink-muted">
                {team.roleLabel}
                {team.archived ? " · Archived" : ""}
              </span>
            </span>
            {current ? (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#0e6b78"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            ) : null}
          </button>
        );
      })}
      <MenuSeparator />
      <MenuItem href="/onboarding#invitations">
        <span className="flex items-center justify-between gap-2.5">
          <span>Invitations &amp; requests</span>
          {workspace.pendingCount > 0 ? (
            <span className="inline-flex h-[18px] items-center rounded-full bg-teal-tint px-1.5 text-micro font-semibold text-teal">
              {workspace.pendingCount}
            </span>
          ) : null}
        </span>
      </MenuItem>
      <MenuItem href="/onboarding">Create or join a team</MenuItem>
      <MenuItem href="/team">Team settings</MenuItem>
    </Menu>
  );
}

/** Initials tile, or the uploaded logo when the team has one. */
export function TeamTile({
  team,
  size,
  muted = false,
  className,
}: {
  team: Pick<WorkspaceSummary, "name" | "initials" | "logoUrl">;
  size: number;
  muted?: boolean;
  className?: string;
}) {
  const radius = size >= 48 ? "rounded-app" : size >= 32 ? "rounded-tile" : "rounded-control";
  if (team.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={team.logoUrl}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className={cn("shrink-0 border border-line bg-card object-contain", radius, className)}
      />
    );
  }
  return (
    <span
      style={{ width: size, height: size, fontSize: size >= 48 ? 28 : size >= 32 ? 11 : size >= 26 ? 11 : 10 }}
      className={cn(
        "flex shrink-0 items-center justify-center font-semibold",
        radius,
        muted ? "bg-teal-tint text-teal" : "bg-navy text-white",
        className,
      )}
    >
      {team.initials}
    </span>
  );
}

function NoWorkspaceTile({ pendingCount }: { pendingCount: number }) {
  return (
    <Link
      href="/onboarding"
      title="Join or create a team"
      className="flex h-[46px] w-full items-center justify-center gap-2.5 rounded-tile border border-dashed border-line-control bg-card px-0 hover:bg-canvas xl:justify-start xl:px-2"
    >
      <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-control bg-line-row text-micro font-semibold text-ink-muted">
        ?
      </span>
      <span className="hidden min-w-0 flex-1 xl:block">
        <span className="block truncate text-dense font-semibold text-ink">No team yet</span>
        <span className="block whitespace-nowrap text-micro text-ink-muted">
          {pendingCount > 0 ? `${pendingCount} pending · ` : ""}Join or create a team
        </span>
      </span>
    </Link>
  );
}
