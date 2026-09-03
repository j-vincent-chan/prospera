import { redirect } from "next/navigation";
import { HomeScreen } from "@/components/home/home-screen";
import { loadHome } from "@/lib/home/queries";
import { createClient } from "@/lib/supabase/server";
import { loadWorkspaceContext } from "@/lib/team/current-team";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function HomePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const context = await loadWorkspaceContext(supabase, user.id);
  if (!context?.current) redirect("/onboarding");
  const { current, profile } = context;
  const lastVisit = (profile as { lastHomeVisitAt?: string | null }).lastHomeVisitAt ?? null;
  const { data: p } = await supabase.from("profiles").select("last_home_visit_at").eq("id", user.id).maybeSingle();
  const data = await loadHome(supabase, { teamId: current.teamId, teamName: current.team.name, userId: user.id, role: current.role, name: profile.fullName?.trim() || profile.email || "there", lastVisitAt: (p as { last_home_visit_at?: string | null } | null)?.last_home_visit_at ?? lastVisit });
  return <HomeScreen data={data} />;
}
