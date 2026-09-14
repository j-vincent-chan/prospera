import { redirect } from "next/navigation";
import { ReviewScreen } from "@/components/review/review-screen";
import { getSessionUser, getSessionWorkspace } from "@/lib/auth/session";
import { loadTeamFitEngine } from "@/lib/fit/flag";
import { isoToday, type RoutingRule } from "@/lib/funding-opportunities/receipt-cycles";
import { isReviewFilter } from "@/lib/review/calls";
import { exploratoryCapFor } from "@/lib/review/queue";
import { getReviewQueue } from "@/lib/review/cached-queue";
import { loadOvernight } from "@/lib/review/overnight-queries";
import { loadReviewNotice, loadReviewQueue, loadShowExploratory } from "@/lib/review/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Discover — Review, list mode (design_handoff_prospera_review_outreach README §2); the app opens here (N2).
 *
 * The queue is the URL: `?notice=<id>` selects a notice, the aside's items
 * are links, and a decision that finishes a notice navigates to the next one.
 * The page loads the queue (light — every queued notice's counts) and the one
 * selected notice's rows (the heavy read, through the same loader the
 * opportunity page's aside uses), and hands both to the client shell.
 */
export default async function ReviewPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const supabase = createClient();
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const context = await getSessionWorkspace();
  if (!context?.current) redirect("/onboarding");
  const { current } = context;
  const today = isoToday();

  const [fitEngine, showExploratory, { data: visit }] = await Promise.all([
    loadTeamFitEngine(supabase, current.teamId),
    loadShowExploratory(supabase, user.id),
    // N2: the overnight strip's window opens at the viewer's last visit (the column keeps its Home-era name).
    supabase.from("profiles").select("last_home_visit_at").eq("id", user.id).maybeSingle(),
  ]);
  // R35: owners and admins adjudicate disagreements; the filter rides in the URL like the mode. R32: the viewer's leads switch sets the cap.
  const viewer = { id: user.id, isAdmin: current.role !== "member" };
  const filter = isReviewFilter(searchParams.filter) ? searchParams.filter : "all";
  const queueOpts = { teamId: current.teamId, today, fitEngine, exploratoryCap: exploratoryCapFor(showExploratory), viewer };
  // The queue from the data cache (a minute, revalidated by every Review write); the notice read below stays live.
  const queue = await getReviewQueue(queueOpts, () => loadReviewQueue(supabase, queueOpts));

  const requested = typeof searchParams.notice === "string" ? searchParams.notice : null;
  const mode = searchParams.mode === "focus" ? "focus" : "list";
  const selectedId = requested && queue.notices.some((n) => n.id === requested) ? requested : (queue.notices[0]?.id ?? null);
  // A notice that is not in the queue (decided away, closed, a stale link) falls back to the first one, and the URL says so.
  if (requested && selectedId && requested !== selectedId) redirect(`/review?notice=${selectedId}${mode === "focus" ? "&mode=focus" : ""}${filter !== "all" ? `&filter=${filter}` : ""}`);

  const routing: RoutingRule = { days: current.team.routingDays, dayType: current.team.routingDayType, holidayCalendar: current.team.routingHolidayCalendar };
  const [notice, overnight] = await Promise.all([
    selectedId ? loadReviewNotice(supabase, { teamId: current.teamId, opportunityId: selectedId, today, routing, viewerId: user.id, viewerIsAdmin: viewer.isAdmin, queue }) : null,
    // N2: what arrived since the viewer last looked, and the office's other business — the strip under the title.
    loadOvernight(supabase, { teamId: current.teamId, teamName: current.team.name, userId: user.id, role: current.role, lastVisitAt: (visit as { last_home_visit_at?: string | null } | null)?.last_home_visit_at ?? null, queued: new Set(queue.notices.map((n) => n.id)), today }),
  ]);

  return (
    <ReviewScreen
      engine={fitEngine}
      available={queue.available}
      decisionsAvailable={queue.decisionsAvailable}
      notices={queue.notices}
      confirmedInQueue={queue.confirmed}
      selectedId={selectedId}
      notice={notice}
      viewerId={user.id}
      viewerIsAdmin={viewer.isAdmin}
      filter={filter}
      showExploratory={showExploratory}
      mode={mode}
      overnight={overnight}
    />
  );
}
