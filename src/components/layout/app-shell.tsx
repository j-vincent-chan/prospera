import { AppShellSidebar, type SidebarBadges, type SidebarUser } from "@/components/layout/app-shell-sidebar";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { ToastProvider } from "@/components/ui/toast";
import type { CurrentWorkspace } from "@/lib/team/current-team";

/**
 * The frame, in three widths (design_handoff_prospera_v2 "Mobile v2" §Responsive
 * rules, mapped onto Tailwind's breakpoints):
 *
 * - `xl` and up (≥ 1280): the full sidebar (`w-sidebar`, a clamp) and the
 *   README's 32/40/64 page padding.
 * - `md` to `xl` (768–1279): the sidebar collapses to a 56px icon rail and the
 *   page padding drops to 24px, so a 1024px tablet or a small laptop gets the
 *   whole width for content.
 * - below `md` (< 768): no sidebar; the bottom tab bar (`MobileTabBar`) and
 *   16px padding, with room under the content for the bar.
 *
 * There is no minimum page width any more. The old `md:min-w-page` (1366px)
 * made every screen scroll sideways in a narrower window — measured at 1024px:
 * the document overflowed by 342px with 67 elements past the viewport edge on
 * Home. Screens are responsible for wrapping and stacking below `xl`.
 * Toasts mount here so any screen can raise one.
 */
export function AppShell({
  children,
  user,
  workspace,
  pendingCount,
  badges,
}: {
  children: React.ReactNode;
  user: SidebarUser;
  /** Null while the user has no team (onboarding, waiting room). */
  workspace: CurrentWorkspace | null;
  pendingCount: number;
  /** The Review and Outreach nav counts (`lib/review/badges.ts`). */
  badges?: SidebarBadges;
}) {
  return (
    <ToastProvider>
      <div className="flex min-h-screen bg-canvas">
        <div className="hidden md:block">
          <AppShellSidebar user={user} workspace={workspace} pendingCount={pendingCount} badges={badges} />
        </div>
        <main className="flex min-w-0 flex-1 flex-col pb-20 md:pb-0">
          {workspace?.archived ? (
            <div className="border-b border-warning-border bg-warning-tint px-4 py-2.5 text-dense text-warning-dark md:px-6 xl:px-page">
              <span className="font-medium">{workspace.name} is archived.</span> The workspace is read-only; an Owner
              can restore it from Team settings within 90 days.
            </div>
          ) : null}
          <div className="flex w-full min-w-0 flex-1 flex-col px-4 pb-16 pt-5 md:px-6 md:pt-8 xl:px-page">{children}</div>
        </main>
        <MobileTabBar badges={badges} />
      </div>
    </ToastProvider>
  );
}
