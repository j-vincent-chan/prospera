/**
 * The Review queue from Next's data cache (2026-09-13, Vincent: "reduce this
 * load time"). Measured: `loadReviewQueue` costs ~1.1 s warm against the
 * live database and Home, Review and Today all read it. Every Review write
 * already revalidates the `review-badges` tag (`app/actions/review-actions.ts`
 * and the Outreach match actions), so the queue is served from the cache for
 * a minute and re-read the moment a decision lands.
 *
 * `unstable_cache` stores JSON, and the queue carries Maps and Sets — so the
 * record crosses the cache as arrays (`toCacheable`) and comes back as the
 * queue the surfaces expect (`fromCacheable`). The cached function makes its
 * own service-role client; the key is the opts (team, day, engine, cap,
 * viewer), so no team reads another's queue.
 */
import { unstable_cache } from "next/cache";
import { REVIEW_BADGES_TAG } from "@/lib/review/badges";
import type { MatchDecision } from "@/lib/review/decisions";
import { loadReviewQueue, type ReviewQueue } from "@/lib/review/queries";
import { createServiceRoleClient } from "@/lib/supabase/admin-service";

const TTL_SECONDS = 60;

export type QueueOpts = Parameters<typeof loadReviewQueue>[1];

/** The queue with its Maps and Sets as arrays — what the cache can hold. */
export type CacheableQueue = Omit<ReviewQueue, "pairs" | "decisions" | "doNotContact" | "limited"> & {
  pairs: Omit<ReviewQueue["pairs"], "notices" | "byTier"> & { notices: Array<[string, ReviewQueue["pairs"]["notices"] extends Map<string, infer V> ? V : never]>; byTier: Array<[string, ReviewQueue["pairs"]["byTier"] extends Map<string, infer V> ? V : never]> };
  decisions: Array<[string, MatchDecision]>;
  doNotContact: string[];
  limited: string[];
};

/** Pure. */
export function toCacheable(q: ReviewQueue): CacheableQueue {
  return { ...q, pairs: { ...q.pairs, notices: Array.from(q.pairs.notices.entries()), byTier: Array.from(q.pairs.byTier.entries()) }, decisions: Array.from(q.decisions.entries()), doNotContact: Array.from(q.doNotContact), limited: Array.from(q.limited) };
}

/** Pure. The inverse. */
export function fromCacheable(c: CacheableQueue): ReviewQueue {
  return { ...c, pairs: { ...c.pairs, notices: new Map(c.pairs.notices), byTier: new Map(c.pairs.byTier) }, decisions: new Map(c.decisions), doNotContact: new Set(c.doNotContact), limited: new Set(c.limited) };
}

const cachedQueue = unstable_cache(
  async (opts: QueueOpts): Promise<CacheableQueue | null> => {
    const admin = createServiceRoleClient();
    if (!admin) return null;
    return toCacheable(await loadReviewQueue(admin, opts));
  },
  ["review-queue"],
  { tags: [REVIEW_BADGES_TAG], revalidate: TTL_SECONDS },
);

/** The queue from the cache; the live read through `fallback` when no service-role client is configured. */
export async function getReviewQueue(opts: QueueOpts, fallback: () => Promise<ReviewQueue>): Promise<ReviewQueue> {
  const cached = await cachedQueue(opts);
  return cached ? fromCacheable(cached) : fallback();
}
