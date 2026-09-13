/**
 * Today (design_handoff_prospera_review_outreach README §1) — the Home page's
 * read model. Three queues, each already loaded by the surface it starts:
 *
 *   - **Decide on new matches** is the Review queue (`loadReviewQueue`);
 *   - **Answer a PI** and **Follow up** are the Outreach board's rows
 *     (`loadMatchBoard`), split by state;
 *   - **Filed without a match** is every notice Prospera first saw since the
 *     last visit that did not enter the queue, with the reason the fit engine
 *     gives for it.
 *
 * The office's other business — access requests, reassignments, a PI's
 * consult request, outcomes left unrecorded, internal deadlines, saved-search
 * hits — comes from `loadHousekeeping`, and sits in the aside under the
 * filed list rather than in a queue of its own.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FitEngine } from "@/lib/fit/flag";
import type { Tier } from "@/lib/fit/types";
import { normalizeAgencyDisplayName } from "@/lib/funding-opportunities/agency-display";
import { fundingListRowScope } from "@/lib/funding-opportunities/funding-list-row-scope";
import { fmtMonD, isNihNotice, type RoutingRule } from "@/lib/funding-opportunities/receipt-cycles";
import { loadHousekeeping, type AttentionItem } from "@/lib/home/queries";
import { answerItem, answerSub, dateLine, decideItem, decideSub, filedLine, filedReason, followItem, followSub, overnightLine, sinceLabel, FILED_HREF, type FiledKind, type FiledNotice, type TodayCard } from "@/lib/home/today-view";
import { loadMatchBoard } from "@/lib/outreach/match-queries";
import { cardTitleOf } from "@/lib/review/queue";
import { loadReviewQueue } from "@/lib/review/queries";

export type TodayData = {
  /** "Saturday, September 13" */
  dateLine: string;
  /** "Overnight: 22 new notices. 8 produced matches, 14 produced none and were filed. Nothing has been sent." */
  overnight: string;
  feedStale: { hours: number; since: string } | null;
  cards: TodayCard[];
  filed: { count: number; line: string; items: FiledNotice[]; href: string };
  /** The office's other business, from `loadHousekeeping`. */
  also: AttentionItem[];
  /** The Review queue is on but `fit_results` is not on the database; the Decide card says so. */
  reviewUnavailable: boolean;
};

/** The window Today reports on: since the last visit, never more than 14 days back. */
export function windowStart(lastVisitAt: string | null, now: Date): string {
  const floor = new Date(now.getTime() - 14 * 86_400_000);
  const last = lastVisitAt ? new Date(lastVisitAt) : null;
  return (last && last > floor ? last : floor).toISOString();
}

type NewNotice = { id: string; title: string; agency: string | null; agency_code: string | null; opportunity_number: string | null; status: string | null; forecasted: boolean | null; close_date: string | null; created_at: string };

/** Pure. Why a new notice did not enter the queue, from what `fit_results` holds for it. */
export function filedKind(input: { engine: FitEngine; open: boolean; tiers: Partial<Record<Tier, number>> | null }): FiledKind {
  if (input.engine !== "fit-v1") return "engine_off";
  if (!input.open) return "not_open";
  if (!input.tiers) return "unscored";
  if (input.tiers.exploratory) return "exploratory";
  return "none";
}

export async function loadToday(
  db: SupabaseClient,
  input: { teamId: string; teamName: string; userId: string; role: "owner" | "admin" | "member"; lastVisitAt: string | null; routing: RoutingRule | null; fitEngine: FitEngine; /** `exploratoryCapFor(the viewer's switch)` — Decide follows what the viewer would see in Review. */ exploratoryCap: number; today: string; now?: Date },
): Promise<TodayData> {
  const now = input.now ?? new Date();
  const { today } = input;
  const since = windowStart(input.lastVisitAt, now);
  const sinceWord = sinceLabel(since, now, today);

  const [home, queue, board, fresh, sentCount] = await Promise.all([
    loadHousekeeping(db, { teamId: input.teamId, teamName: input.teamName, userId: input.userId, role: input.role, lastVisitAt: input.lastVisitAt }),
    loadReviewQueue(db, { teamId: input.teamId, today, fitEngine: input.fitEngine, exploratoryCap: input.exploratoryCap, viewer: { id: input.userId, isAdmin: input.role !== "member" } }),
    loadMatchBoard(db, { teamId: input.teamId, viewerId: input.userId, routing: input.routing, today }),
    db.from("funding_opportunities").select("id, title, agency, agency_code, opportunity_number, status, forecasted, close_date, created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(500),
    db.from("outreach_messages").select("id", { count: "exact", head: true }).eq("team_id", input.teamId).gte("sent_at", since),
  ]);
  if (fresh.error) console.warn(`[today] funding_opportunities: ${fresh.error.message}`);

  // ---- what arrived, and what it produced ----
  const arrived = (fresh.data ?? []) as NewNotice[];
  const queued = new Set(queue.notices.map((n) => n.id));
  const matched = arrived.filter((n) => queued.has(n.id));
  const filedRows = arrived.filter((n) => !queued.has(n.id));
  const tiersBy = new Map<string, Partial<Record<Tier, number>>>();
  if (filedRows.length && input.fitEngine === "fit-v1") {
    const { data } = await db.from("fit_results").select("opportunity_id, tier").in("opportunity_id", filedRows.map((n) => n.id)).limit(5000);
    for (const r of (data ?? []) as Array<{ opportunity_id: string; tier: Tier }>) {
      const t = tiersBy.get(r.opportunity_id) ?? {};
      t[r.tier] = (t[r.tier] ?? 0) + 1;
      tiersBy.set(r.opportunity_id, t);
    }
  }
  const agencyShort = (n: NewNotice) => (isNihNotice(n) ? "NIH" : (normalizeAgencyDisplayName(n.agency) ?? n.agency_code ?? null));
  const filedItems: FiledNotice[] = filedRows.map((n) => {
    const open = fundingListRowScope({ status: n.status, close_date: n.close_date, forecasted: n.forecasted }, new Date(`${today}T00:00:00Z`)) === "open";
    return { id: n.id, title: cardTitleOf(n.title), reason: filedReason(filedKind({ engine: input.fitEngine, open, tiers: tiersBy.get(n.id) ?? null }), agencyShort(n)), href: `/opportunities/${n.id}` };
  });

  // ---- the three queues ----
  const decideItems = queue.notices.slice(0, 8).map((n) => decideItem(n, { activityCode: queue.pairs.notices.get(n.id)?.activity_code ?? null, arrived: arrived.some((a) => a.id === n.id) }));
  const replies = board.rows.filter((r) => r.view.state === "replied_interested" || r.view.state === "replied_maybe" || r.view.state === "replied_not_now");
  const answerItems = replies.map((r) => answerItem(r, today));
  const dated = replies.filter((r) => r.thread.some((t) => t.kind === "reply" && !/day not recorded/.test(t.head) && t.when >= since)).length;
  const follow = board.rows.map((r) => followItem(r, today)).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const overdue = follow.filter((f) => f.kind === "overdue").length;
  const scheduled = follow.length - overdue;

  const cards: TodayCard[] = [
    {
      key: "decide",
      title: "Decide on new matches",
      sub: queue.available ? decideSub({ undecided: queue.undecided, notices: queue.notices.length, newNotices: arrived.length, matched: matched.length, since: sinceWord }) : "Prospera's assessment is not on this database yet",
      cta: { label: "Start reviewing", href: queue.notices[0] ? `/review?notice=${queue.notices[0].id}` : "/review", kind: "primary" },
      items: decideItems,
      empty: input.fitEngine === "fit-v1" ? "Nothing is waiting for a decision. A notice enters here when someone in the directory clears the bar for it." : "Matching is on the legacy engine for this team; the Review queue starts when it moves to fit-v1.",
    },
    {
      key: "answer",
      title: "Answer a PI",
      sub: answerSub({ replies: replies.length, dated, since: sinceWord }),
      cta: { label: "Open outreach", href: "/outreach", kind: "secondary" },
      items: answerItems,
      empty: "No investigator is waiting on an answer.",
    },
    {
      key: "follow",
      title: "Follow up",
      sub: followSub({ overdue, scheduled }),
      cta: { label: "Open outreach", href: "/outreach", kind: "secondary" },
      items: follow.map((f) => f.item),
      empty: "Nothing sent is waiting past its reply window, and no nudge is due.",
    },
  ];

  // The office's other business: everything the housekeeping read lists — none of it is a queue above.
  const also = home.actions;

  return {
    dateLine: dateLine(now),
    overnight: overnightLine({ since: sinceWord, newNotices: arrived.length, matched: matched.length, filed: filedRows.length, sent: sentCount.count ?? 0 }),
    feedStale: home.feedStale,
    cards,
    filed: { count: filedRows.length, line: filedLine({ filed: filedRows.length, newNotices: arrived.length, since: sinceWord }), items: filedItems.slice(0, 5), href: FILED_HREF },
    also,
    reviewUnavailable: !queue.available,
  };
}

/** For the page's own tests and smoke: the window's start as a day. */
export const windowDay = (sinceIso: string, today: string): string => fmtMonD(sinceIso.slice(0, 10), today);
