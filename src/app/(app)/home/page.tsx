import { redirect } from "next/navigation";
import { HomeScreen } from "@/components/home/home-screen";
import { getSessionUser, getSessionWorkspace } from "@/lib/auth/session";
import { loadTeamFitEngine } from "@/lib/fit/flag";
import { isoToday, type RoutingRule } from "@/lib/funding-opportunities/receipt-cycles";
import { loadToday } from "@/lib/home/today";
import { exploratoryCapFor } from "@/lib/review/queue";
import { loadShowExploratory } from "@/lib/review/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Today (README §1), at `/home`: the day's three queues and what was filed without a match. */
export default async function HomePage() {
  const supabase = createClient();
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const context = await getSessionWorkspace();
  if (!context?.current) redirect("/onboarding");
  const { current, profile } = context;
  const lastVisit = (profile as { lastHomeVisitAt?: string | null }).lastHomeVisitAt ?? null;
  const [{ data: p }, fitEngine, showExploratory] = await Promise.all([
    supabase.from("profiles").select("last_home_visit_at").eq("id", user.id).maybeSingle(),
    loadTeamFitEngine(supabase, current.teamId),
    loadShowExploratory(supabase, user.id),
  ]);
  const routing: RoutingRule = { days: current.team.routingDays, dayType: current.team.routingDayType, holidayCalendar: current.team.routingHolidayCalendar };
  const data = await loadToday(supabase, {
    teamId: current.teamId,
    teamName: current.team.name,
    userId: user.id,
    role: current.role,
    lastVisitAt: (p as { last_home_visit_at?: string | null } | null)?.last_home_visit_at ?? lastVisit,
    routing,
    fitEngine,
    exploratoryCap: exploratoryCapFor(showExploratory),
    today: isoToday(),
  });
  return <HomeScreen data={data} />;
}
