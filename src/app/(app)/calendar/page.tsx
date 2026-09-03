import { redirect } from "next/navigation";
import { CalendarScreen } from "@/components/calendar/calendar-screen";
import { loadCalendarEvents, monthRange } from "@/lib/calendar/queries";
import { createClient } from "@/lib/supabase/server";
import { loadWorkspaceContext } from "@/lib/team/current-team";
import { siteUrl } from "@/lib/team/urls";

export const dynamic = "force-dynamic";

export default async function CalendarPage({ searchParams }: { searchParams: { month?: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const context = await loadWorkspaceContext(supabase, user.id);
  if (!context?.current) redirect("/onboarding");
  const { current } = context;
  const today = new Date().toISOString().slice(0, 10);
  const month = /^\d{4}-\d{2}$/.test(searchParams.month ?? "") ? searchParams.month! : today.slice(0, 7);
  const range = monthRange(month);
  const routing = { days: current.team.routingDays, dayType: current.team.routingDayType, holidayCalendar: current.team.routingHolidayCalendar } as const;
  const in14 = new Date(`${today}T00:00:00Z`);
  in14.setUTCDate(in14.getUTCDate() + 14);
  const [events, upcoming, { data: teamRow }, { data: items }] = await Promise.all([
    loadCalendarEvents(supabase, current.teamId, routing, { from: range.gridFrom, to: range.gridTo }),
    loadCalendarEvents(supabase, current.teamId, routing, { from: today, to: in14.toISOString().slice(0, 10) }),
    supabase.from("teams").select("calendar_token").eq("id", current.teamId).maybeSingle(),
    supabase.from("outreach_items").select("id, funding_opportunities(title)").eq("team_id", current.teamId).not("stage", "in", '("outcome","parked")').order("last_activity_at", { ascending: false }).limit(60),
  ]);
  const token = (teamRow as { calendar_token?: string | null } | null)?.calendar_token ?? null;
  const itemOptions = ((items ?? []) as Array<{ id: string; funding_opportunities: { title: string } | { title: string }[] | null }>).map((i) => ({ id: i.id, title: (Array.isArray(i.funding_opportunities) ? i.funding_opportunities[0] : i.funding_opportunities)?.title ?? "Opportunity" }));

  return <CalendarScreen month={month} today={today} range={range} events={events} upcoming={upcoming} icsUrl={token ? `${siteUrl()}/api/calendar/${token}.ics` : null} canRotate={current.role !== "member"} items={itemOptions} />;
}
