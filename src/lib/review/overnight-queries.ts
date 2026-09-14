/**
 * The read behind Discover's overnight strip (decision N2): the notices
 * Prospera first saw in the window, split by whether they entered the queue;
 * the messages sent in it; and the office's other business from
 * `loadHousekeeping` — access requests, reassignments, overdue next actions,
 * saved-search hits, watched forecasts, internal deadlines, outcomes left
 * unrecorded — which Today's aside listed as "Also waiting". The housekeeping
 * read comes from the data cache (`lib/home/cached.ts`); the two small reads
 * here are live.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getHousekeeping } from "@/lib/home/cached";
import { loadHousekeeping, type AttentionItem } from "@/lib/home/queries";
import { overnightLine, sinceLabel, windowStart, type OvernightSegment } from "@/lib/review/overnight";

export type OvernightData = {
  line: OvernightSegment[];
  feedStale: { hours: number; since: string } | null;
  /** The office's other business, from `loadHousekeeping`. */
  also: AttentionItem[];
};

export async function loadOvernight(
  db: SupabaseClient,
  input: {
    teamId: string;
    teamName: string;
    userId: string;
    role: "owner" | "admin" | "member";
    lastVisitAt: string | null;
    /** The queue's notice ids: an arrival among them produced a match. */
    queued: ReadonlySet<string>;
    today: string;
    now?: Date;
  },
): Promise<OvernightData> {
  const now = input.now ?? new Date();
  const since = windowStart(input.lastVisitAt, now, input.today);
  const housekeepingOpts = { teamId: input.teamId, teamName: input.teamName, userId: input.userId, role: input.role, lastVisitAt: input.lastVisitAt };
  const [home, fresh, sent] = await Promise.all([
    getHousekeeping(housekeepingOpts, () => loadHousekeeping(db, housekeepingOpts)),
    db.from("funding_opportunities").select("id").gte("created_at", since).limit(2000),
    db.from("outreach_messages").select("id", { count: "exact", head: true }).eq("team_id", input.teamId).gte("sent_at", since),
  ]);
  if (fresh.error) console.warn(`[overnight] funding_opportunities: ${fresh.error.message}`);
  const arrived = (fresh.data ?? []) as Array<{ id: string }>;
  const matched = arrived.filter((n) => input.queued.has(n.id)).length;
  return {
    line: overnightLine({ since: sinceLabel(since, now, input.today), newNotices: arrived.length, matched, filed: arrived.length - matched, sent: sent.count ?? 0 }),
    feedStale: home.feedStale,
    also: home.actions,
  };
}
