import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { createClient } from "@/lib/supabase/server";
import { loadWorkspaceContext } from "@/lib/team/current-team";

/** Routes a signed-in user without a team may still open. */
const NO_TEAM_ALLOWED = ["/onboarding", "/settings", "/invite", "/join", "/funding-opportunities"];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const context = await loadWorkspaceContext(supabase, user.id);
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
