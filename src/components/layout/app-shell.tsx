import { AppShellSidebar, type SidebarUser } from "@/components/layout/app-shell-sidebar";
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
}: {
  children: React.ReactNode;
  user: SidebarUser;
  workspace: CurrentWorkspace;
}) {
  return (
    <ToastProvider>
      <div className="flex min-h-screen min-w-page bg-canvas">
        <AppShellSidebar user={user} workspace={workspace} />
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex w-full flex-1 flex-col px-page pb-16 pt-8">{children}</div>
        </main>
      </div>
    </ToastProvider>
  );
}
