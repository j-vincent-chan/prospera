import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/team/current-team";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, role")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <AppShell
      user={{
        name: profile?.full_name?.trim() || null,
        email: profile?.email ?? user.email ?? null,
      }}
      workspace={getCurrentWorkspace(profile?.role)}
    >
      {children}
    </AppShell>
  );
}
