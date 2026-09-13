/**
 * Home's two team reads from Next's data cache (2026-09-13, Vincent: "reduce
 * this load time"). Measured on a production build: Home rendered in 3.9 s
 * cold and 2.8 s warm, and the reads behind it were the cost — the
 * housekeeping read (access requests, reassignments, saved-search hits,
 * internal deadlines, consults, outcomes due) ~2.2 s and the Outreach board
 * ~0.7 s, every visit. Both are served from the cache and re-read when an
 * Outreach or Review write revalidates the `review-badges` tag, or after the
 * TTL.
 *
 * The housekeeping key buckets the last visit to its day: the page restamps
 * the visit on every render, and a key that changed every visit would never
 * hit. Both cached functions make their own service-role client; the key
 * carries the team and the viewer, so no team reads another's.
 */
import { unstable_cache } from "next/cache";
import type { RoutingRule } from "@/lib/funding-opportunities/receipt-cycles";
import { loadHousekeeping, type Housekeeping } from "@/lib/home/queries";
import { loadMatchBoard, type MatchBoard } from "@/lib/outreach/match-queries";
import { REVIEW_BADGES_TAG } from "@/lib/review/badges";
import { createServiceRoleClient } from "@/lib/supabase/admin-service";

const HOUSEKEEPING_TTL = 120;
const BOARD_TTL = 60;

type HousekeepingOpts = Parameters<typeof loadHousekeeping>[1];

const cachedHousekeeping = unstable_cache(
  async (opts: HousekeepingOpts): Promise<Housekeeping | null> => {
    const admin = createServiceRoleClient();
    if (!admin) return null;
    return loadHousekeeping(admin, opts);
  },
  ["home-housekeeping"],
  { tags: [REVIEW_BADGES_TAG], revalidate: HOUSEKEEPING_TTL },
);

/** Pure. The last visit bucketed to its day, so the cache key is stable across a day's visits. */
export function visitBucket(lastVisitAt: string | null): string | null {
  return lastVisitAt ? `${lastVisitAt.slice(0, 10)}T00:00:00.000Z` : null;
}

export async function getHousekeeping(opts: HousekeepingOpts, fallback: () => Promise<Housekeeping>): Promise<Housekeeping> {
  const cached = await cachedHousekeeping({ ...opts, lastVisitAt: visitBucket(opts.lastVisitAt) });
  return cached ?? fallback();
}

type BoardOpts = { teamId: string; viewerId: string; routing: RoutingRule | null; today: string };

const cachedBoard = unstable_cache(
  async (opts: BoardOpts): Promise<MatchBoard | null> => {
    const admin = createServiceRoleClient();
    if (!admin) return null;
    return loadMatchBoard(admin, opts);
  },
  ["outreach-board"],
  { tags: [REVIEW_BADGES_TAG], revalidate: BOARD_TTL },
);

export async function getMatchBoard(opts: BoardOpts, fallback: () => Promise<MatchBoard>): Promise<MatchBoard> {
  const cached = await cachedBoard(opts);
  return cached ?? fallback();
}
