import { redirect } from "next/navigation";
import { ReportsScreen } from "@/components/reports/reports-screen";
import { loadReports, type ReportPeriod } from "@/lib/reports/queries";
import { createClient } from "@/lib/supabase/server";
import { loadWorkspaceContext } from "@/lib/team/current-team";

export const dynamic = "force-dynamic";

export default async function ReportsPage({ searchParams }: { searchParams: { period?: string; community?: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const context = await loadWorkspaceContext(supabase, user.id);
  if (!context?.current) redirect("/onboarding");
  const period: ReportPeriod = searchParams.period === "last_quarter" || searchParams.period === "previous_fy" ? searchParams.period : "fy_to_date";
  const community = searchParams.community?.trim() || null;
  const [data, { data: communities }] = await Promise.all([
    loadReports(supabase, context.current.teamId, period, community),
    supabase.from("pipeline_communities").select("id, label").order("sort_order"),
  ]);
  return <ReportsScreen data={data} period={period} community={community} communities={(communities ?? []) as Array<{ id: string; label: string }>} />;
}
