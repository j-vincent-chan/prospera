import { redirect } from "next/navigation";
import { DataSourcesScreen } from "@/components/data-sources/data-sources-screen";
import { sourceHealth } from "@/lib/data-sources/status";
import { createClient } from "@/lib/supabase/server";
import { loadWorkspaceContext } from "@/lib/team/current-team";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function DataSourcesPage({ searchParams }: { searchParams: { log?: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const context = await loadWorkspaceContext(supabase, user.id);
  if (!context?.current) redirect("/onboarding");
  const health = await sourceHealth(supabase);
  return <DataSourcesScreen health={health} teamName={context.current.team.name} canRun={context.current.role !== "member"} fullLog={searchParams.log === "1"} viewerEmail={context.profile.email ?? ""} />;
}
