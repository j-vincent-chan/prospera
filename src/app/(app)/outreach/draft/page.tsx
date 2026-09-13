import { redirect } from "next/navigation";
import { DraftScreen } from "@/components/outreach/draft-screen";
import { getSessionUser, getSessionWorkspace } from "@/lib/auth/session";
import { isoToday } from "@/lib/funding-opportunities/receipt-cycles";
import { loadDraftSet } from "@/lib/outreach/draft-queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Message — Draft outreach (design_handoff_prospera_review_outreach README §6).
 *
 * `/outreach/draft` drafts every match that is Ready to send; `?item=<id>`
 * narrows it to one notice (the Review queued bar), `?match=<recipient id>`
 * opens on that match and admits a contacted one for a follow-up (the board's
 * Draft and Nudge verbs), `?from=review` points the back link at Review.
 */
export default async function DraftOutreachPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const supabase = createClient();
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const context = await getSessionWorkspace();
  if (!context?.current) redirect("/onboarding");
  const { current } = context;
  const get = (k: string) => (typeof searchParams[k] === "string" ? (searchParams[k] as string) : "");
  const itemId = get("item") || null;
  const matchId = get("match") || null;
  const from = get("from") === "review" ? "review" : "outreach";

  const routing = { days: current.team.routingDays, dayType: current.team.routingDayType, holidayCalendar: current.team.routingHolidayCalendar } as const;
  const viewer = { name: context.profile.fullName?.trim() || context.profile.email || "You", title: (context.profile as { title?: string | null }).title ?? null };
  const set = await loadDraftSet(supabase, { teamId: current.teamId, viewer, routing, today: isoToday(), itemId, matchId });

  return <DraftScreen set={set} initialMatch={matchId} from={from} />;
}
