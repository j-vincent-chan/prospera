import { redirect } from "next/navigation";
import { OutreachBoard } from "@/components/outreach/outreach-board";
import { loadMatchBoard } from "@/lib/outreach/match-queries";
import { loadWorkspace } from "@/lib/outreach/queries";
import { isoToday } from "@/lib/funding-opportunities/receipt-cycles";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser, getSessionWorkspace } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function OutreachPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const supabase = createClient();
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const context = await getSessionWorkspace();
  if (!context?.current) redirect("/onboarding");
  const { current } = context;
  const get = (k: string) => (typeof searchParams[k] === "string" ? (searchParams[k] as string) : "");
  // `?stage=` and `?community=` addressed the notice kanban; the match board has neither, and old links still land here.
  const itemId = get("item") || null;
  const tab = get("tab") === "compose" || get("tab") === "activity" ? (get("tab") as "compose" | "activity") : "recipients";
  const evidence = get("evidence") || null;

  const routing = { days: current.team.routingDays, dayType: current.team.routingDayType, holidayCalendar: current.team.routingHolidayCalendar } as const;
  // `isAdmin` gates the audit layer's link to the admin fit inspector, which
  // is behind `requireAdmin`; it comes off the profile `getSessionWorkspace`
  // already read, so no surface pays a read for it.
  const viewer = { id: user.id, name: context.profile.fullName?.trim() || context.profile.email || "You", title: (context.profile as { title?: string | null }).title ?? null, isAdmin: context.profile.legacyRole === "admin" };

  const [board, workspace] = await Promise.all([
    loadMatchBoard(supabase, { teamId: current.teamId, viewerId: user.id, routing, today: isoToday() }),
    itemId ? loadWorkspace(supabase, current.teamId, itemId, viewer, routing) : Promise.resolve(null),
  ]);

  return <OutreachBoard board={board} workspace={workspace} workspaceTab={tab} evidenceFor={evidence} viewer={viewer} />;
}
