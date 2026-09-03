import { redirect } from "next/navigation";
import { OutreachBoard } from "@/components/outreach/outreach-board";
import { loadBoard, loadWorkspace } from "@/lib/outreach/queries";
import { STAGES, type OutreachStage } from "@/lib/outreach/types";
import { createClient } from "@/lib/supabase/server";
import { loadWorkspaceContext } from "@/lib/team/current-team";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function OutreachPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const context = await loadWorkspaceContext(supabase, user.id);
  if (!context?.current) redirect("/onboarding");
  const { current } = context;
  const get = (k: string) => (typeof searchParams[k] === "string" ? (searchParams[k] as string) : "");
  const stage = (STAGES as string[]).includes(get("stage")) ? (get("stage") as OutreachStage) : "triage";
  const community = get("community") || null;
  const itemId = get("item") || null;
  const tab = get("tab") === "compose" || get("tab") === "activity" ? (get("tab") as "compose" | "activity") : "recipients";
  const evidence = get("evidence") || null;

  const routing = { days: current.team.routingDays, dayType: current.team.routingDayType, holidayCalendar: current.team.routingHolidayCalendar } as const;
  const viewer = { id: user.id, name: context.profile.fullName?.trim() || context.profile.email || "You", title: (context.profile as { title?: string | null }).title ?? null };

  const [board, workspace] = await Promise.all([
    loadBoard(supabase, current.teamId, { stage, community }),
    itemId ? loadWorkspace(supabase, current.teamId, itemId, viewer, routing) : Promise.resolve(null),
  ]);

  return <OutreachBoard board={board} stage={stage} community={community} workspace={workspace} workspaceTab={tab} evidenceFor={evidence} viewer={viewer} />;
}
