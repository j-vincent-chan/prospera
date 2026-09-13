/**
 * The sidebar's two counts (README §0): Review = undecided matches across the
 * queued notices; Outreach = rows in "Needs you today".
 *
 * The app shell renders on every navigation, so the count cannot be five
 * reads per page. Next's data cache keeps each team's answer for a few
 * minutes; every Review write (`app/actions/review-actions.ts`) revalidates
 * the tag, so a decision moves the badge at once, and the TTL is the backstop
 * for the nightly fit sweep, which writes `fit_results` outside any request.
 * The cached read uses the service-role client — a cached function cannot
 * read request cookies — and returns only counts, which every team member
 * could read for themselves.
 *
 * What the Outreach count is, today: the Outreach re-base (handoff §5) is a
 * later step, so "Needs you today" has one category this build can produce —
 * a confirmed match with no message yet. The other two (a reply to answer, a
 * nudge that is due) join when that screen does.
 */
import { unstable_cache } from "next/cache";
import { loadReviewBadges, type ReviewBadges } from "@/lib/review/queries";
import { createServiceRoleClient } from "@/lib/supabase/admin-service";
import { isoToday } from "@/lib/funding-opportunities/receipt-cycles";

export const REVIEW_BADGES_TAG = "review-badges";

const TTL_SECONDS = 5 * 60;

export const EMPTY_BADGES: ReviewBadges = { review: 0, outreach: 0 };

const cachedBadges = unstable_cache(
  async (teamId: string, dayIso: string): Promise<ReviewBadges> => {
    const admin = createServiceRoleClient();
    if (!admin) return EMPTY_BADGES;
    try {
      return await loadReviewBadges(admin, { teamId, today: dayIso });
    } catch (e) {
      console.warn(`[review] badges: ${e instanceof Error ? e.message : String(e)}`);
      return EMPTY_BADGES;
    }
  },
  ["review-badges"],
  { tags: [REVIEW_BADGES_TAG], revalidate: TTL_SECONDS },
);

/** The two counts for a team; zeros for no team. Never throws. */
export async function getReviewBadges(teamId: string | null | undefined): Promise<ReviewBadges> {
  if (!teamId) return EMPTY_BADGES;
  return cachedBadges(teamId, isoToday());
}
