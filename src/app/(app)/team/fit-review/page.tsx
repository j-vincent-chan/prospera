import Link from "next/link";
import { redirect } from "next/navigation";
import { MetaLine } from "@/components/fit/inspector-ui";
import { ReviewQueueScreen } from "@/components/fit/review-queue";
import { CORRECTIONS_MIGRATION } from "@/lib/fit/feedback/load";
import { loadTeamFitEngine } from "@/lib/fit/flag";
import { gateReviewPage } from "@/lib/fit/review/guard";
import { loadReviewQueue, REVIEW_STATE_MIGRATION } from "@/lib/fit/review/load";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
/** Approving a notice correction may re-score the roster against it in the action (see FIT_RESCORE_SYNC_MAX_INVESTIGATORS). */
export const maxDuration = 300;

/**
 * The strategist review queue (plan § PR 3.3): the four things stage 8 asks a
 * person to decide — AI-flagged leads, pending global notice corrections,
 * ungrounded dissents, and profile-weight corrections awaiting confirmation.
 *
 * Gated the way the queue's actions are (`lib/fit/review/guard.ts`): a
 * signed-in member of a team, any role. "Strategist" is the audience, not a
 * membership role — `fitAudienceFor` reads a viewer as `investigator` only on
 * their own record (D43), and D6's "another pair of eyes" rule is enforced
 * per decision in the action, not by hiding the page.
 *
 * The corrections here are institution-wide, not team-scoped, so the page is
 * the same for every team; a team still on `legacy` sees a line saying its own
 * surfaces do not read these results yet.
 */
export default async function FitReviewPage() {
  const supabase = createClient();
  const gate = await gateReviewPage(supabase);
  if (!gate.ok) redirect(gate.redirect);

  const [read, engine] = await Promise.all([loadReviewQueue(supabase), loadTeamFitEngine(supabase, gate.teamId)]);
  const { queue } = read;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 text-h1 font-semibold tracking-[-0.02em] text-ink">Fit review</h1>
          <MetaLine
            parts={[
              `${queue.total} item${queue.total === 1 ? "" : "s"} waiting`,
              `${queue.counts.leads} leads · ${queue.counts.notice_corrections} notice corrections · ${queue.counts.dissents} dissents · ${queue.counts.profile_corrections} profile weights`,
              engine === "fit-v1" ? null : `${gate.teamName} still reads legacy matching — decisions here apply institution-wide`,
            ]}
          />
        </div>
        <Link href="/team" className="whitespace-nowrap text-dense font-medium text-teal hover:text-navy">
          Team settings →
        </Link>
      </header>
      <ReviewQueueScreen queue={queue} available={read.available} reviewStateAvailable={read.reviewStateAvailable} error={read.error} migrations={{ corrections: CORRECTIONS_MIGRATION, reviewState: REVIEW_STATE_MIGRATION }} />
    </div>
  );
}
