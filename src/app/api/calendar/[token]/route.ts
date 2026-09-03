import { NextResponse } from "next/server";
import { buildIcs } from "@/lib/calendar/ics";
import { loadCalendarEvents } from "@/lib/calendar/queries";
import { createServiceRoleClient } from "@/lib/supabase/admin-service";
import { siteUrl } from "@/lib/team/urls";

export const dynamic = "force-dynamic";

/** ICS feed for calendar apps; the token in the URL is the credential. */
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const token = params.token.replace(/\.ics$/i, "");
  if (!/^[a-f0-9]{48,64}$/.test(token)) return new NextResponse("Not found", { status: 404 });
  const admin = createServiceRoleClient();
  if (!admin) return new NextResponse("Service unavailable", { status: 503 });
  const { data: team } = await admin.from("teams").select("id, name, routing_days, routing_day_type, routing_holiday_calendar").eq("calendar_token", token).is("archived_at", null).maybeSingle();
  if (!team) return new NextResponse("Not found", { status: 404 });
  const t = team as { id: string; name: string; routing_days: number; routing_day_type: "business" | "calendar"; routing_holiday_calendar: "ucsf" | "us_federal" | "none" };
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - 30);
  const to = new Date();
  to.setUTCMonth(to.getUTCMonth() + 12);
  const events = await loadCalendarEvents(admin, t.id, { days: t.routing_days, dayType: t.routing_day_type, holidayCalendar: t.routing_holiday_calendar }, { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) });
  const body = buildIcs({ teamName: t.name, events, siteUrl: siteUrl() });
  return new NextResponse(body, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `inline; filename="prospera-${t.id.slice(0, 8)}.ics"`, "Cache-Control": "private, max-age=600" } });
}
