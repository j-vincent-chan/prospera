import { AppShellSidebar, type SidebarUser } from "@/components/layout/app-shell-sidebar";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { ToastProvider } from "@/components/ui/toast";
import type { CurrentWorkspace } from "@/lib/team/current-team";

/**
 * Desktop-first frame: 240px sidebar + page column padded 32/40/64 with the
 * 1366 minimum from the README. Toasts mount here so any screen can raise one.
 */
export function AppShell({
  children,
  user,
  workspace,
  pendingCount,
}: {
  children: React.ReactNode;
  user: SidebarUser;
  /** Null while the user has no team (onboarding, waiting room). */
  workspace: CurrentWorkspace | null;
  pendingCount: number;
}) {
  return (
    <ToastProvider>
      <div className="flex min-h-screen bg-canvas md:min-w-page">
        <div className="hidden md:block">
          <AppShellSidebar user={user} workspace={workspace} pendingCount={pendingCount} />
        </div>
        <main className="flex min-w-0 flex-1 flex-col pb-20 md:pb-0">
          {workspace?.archived ? (
            <div className="border-b border-warning-border bg-warning-tint px-page py-2.5 text-dense text-warning-dark">
              <span className="font-medium">{workspace.name} is archived.</span> The workspace is read-only; an Owner
              can restore it from Team settings within 90 days.
            </div>
          ) : null}
          <div className="flex w-full flex-1 flex-col px-4 pb-16 pt-5 md:px-page md:pt-8">{children}</div>
        </main>
        <MobileTabBar />
      </div>
    </ToastProvider>
  );
}
