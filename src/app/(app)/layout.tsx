import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getSessionUser, getSessionWorkspace } from "@/lib/auth/session";

/** Routes a signed-in user without a team may still open. */
const NO_TEAM_ALLOWED = ["/onboarding", "/settings", "/invite", "/join", "/opportunities"];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Both reads are request-scoped: the page under this layout gets the same answer without repeating them.
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const context = await getSessionWorkspace();
  if (!context) redirect("/login");

  const pathname = headers().get("x-pathname") ?? "";
  if (!context.workspace && !NO_TEAM_ALLOWED.some((p) => pathname.startsWith(p))) {
    redirect("/onboarding");
  }

  return (
    <AppShell
      user={{ name: context.profile.fullName, email: context.profile.email }}
      workspace={context.workspace}
      pendingCount={context.pendingCount}
    >
      {children}
    </AppShell>
  );
}
