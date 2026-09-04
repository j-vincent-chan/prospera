"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition, type ComponentType, type SVGProps } from "react";
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
  IconLogOut,
  IconNetwork,
  IconReport,
  IconSearch,
  IconSend,
  IconSettings,
  IconUsers,
} from "@/components/layout/sidebar-nav-icons";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

type NavItem = {
  href: string;
  label: string;
  Icon: Icon;
  isActive: (pathname: string) => boolean;
  /** Group break above the item (Sidebar2: Calendar, Investigators, Reports). */
  groupBreak?: boolean;
};

// Order and grouping are the design's; labels match page titles exactly.
const NAV: NavItem[] = [
  { href: "/home", label: "Home", Icon: IconHome, isActive: (p) => p.startsWith("/home") },
  {
    href: "/opportunities",
    label: "Opportunities",
    Icon: IconSearch,
    isActive: (p) => p.startsWith("/opportunities") || p.startsWith("/curate"),
  },
  { href: "/outreach", label: "Outreach", Icon: IconSend, isActive: (p) => p.startsWith("/outreach") },
  {
    href: "/calendar",
    label: "Calendar",
    Icon: IconCalendar,
    isActive: (p) => p.startsWith("/calendar"),
    groupBreak: true,
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

const navItemClass = (active: boolean) =>
  cn(
    "flex h-9 items-center gap-2.5 rounded-control px-2.5 text-body font-medium",
    active ? "bg-navy-nav text-ink" : "text-ink-body hover:bg-line-row hover:text-ink",
  );

function NavRow({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = item.isActive(pathname);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(navItemClass(active), item.groupBreak && "mt-3")}
    >
      <item.Icon className="h-[18px] w-[18px] shrink-0" />
      <span>{item.label}</span>
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

export function AppShellSidebar({
  user,
  workspace,
  pendingCount,
}: {
  user: SidebarUser;
  workspace: CurrentWorkspace | null;
  pendingCount: number;
}) {
  const pathname = usePathname() ?? "";
  const settingsActive = pathname.startsWith("/settings");

  return (
    <aside className="sticky top-0 flex h-screen w-sidebar shrink-0 flex-col overflow-y-auto border-r border-line bg-card px-3 py-5">
      <Link href="/home" className="flex items-center gap-2.5 px-2 pb-3.5 pt-1" title="Prospera — Home">
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
          className="h-[18px] w-auto"
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
          <NavRow key={item.href} item={item} pathname={pathname} />
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-0.5 border-t border-line pt-3">
        <Link
          href="/settings"
          aria-current={settingsActive ? "page" : undefined}
          className={navItemClass(settingsActive)}
        >
          <IconSettings className="h-[18px] w-[18px] shrink-0" />
          <span>Settings</span>
        </Link>

        <div className="flex items-center gap-2.5 px-2.5 pb-1 pt-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-tint text-micro font-semibold text-teal">
            {initialsOf(user.name, user.email)}
          </span>
          <div className="min-w-0 flex-1">
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

        <p className="mb-0 mt-2 px-2.5 text-micro leading-[1.4] text-ink-muted">
          Office of Collaborative Research · UCSF
        </p>
      </div>
    </aside>
  );
}

function WorkspaceSwitcher({ workspace }: { workspace: CurrentWorkspace }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
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
          {...triggerProps}
          className={cn(
            "flex h-[46px] w-full items-center gap-2.5 rounded-tile border px-2 text-left",
            open ? "border-line-control bg-canvas" : "border-line bg-card hover:border-line-control hover:bg-canvas",
          )}
        >
          <TeamTile team={workspace} size={26} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-dense font-semibold text-ink">{workspace.name}</span>
            <span className="block whitespace-nowrap text-micro text-ink-muted">
              Team workspace · {workspace.roleLabel}
            </span>
          </span>
          <IconChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-ink-muted" strokeWidth={2} />
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
      className="flex h-[46px] w-full items-center gap-2.5 rounded-tile border border-dashed border-line-control bg-card px-2 hover:bg-canvas"
    >
      <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-control bg-line-row text-micro font-semibold text-ink-muted">
        ?
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-dense font-semibold text-ink">No team yet</span>
        <span className="block whitespace-nowrap text-micro text-ink-muted">
          {pendingCount > 0 ? `${pendingCount} pending · ` : ""}Join or create a team
        </span>
      </span>
    </Link>
  );
}
