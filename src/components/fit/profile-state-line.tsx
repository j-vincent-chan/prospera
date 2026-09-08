import Link from "next/link";
import { fmtMonDYear } from "@/lib/investigators/sources";
import type { ProfileState } from "@/lib/fit/profile-state";
import { cn } from "@/lib/utils/cn";

const nf = new Intl.NumberFormat("en-US");

/**
 * What the ranking ran on (plan § PR 3.2, follow-up "3.2b"), above the groups.
 *
 * The groups used to be introduced by "refreshed nightly". This says the
 * three things that decide whether to trust the list: what the ranking read,
 * when it read it, and — the one that changes a decision — what it could not
 * read. A thin list under "no biosketch on file, no self-declared axes" is a
 * fact about the profile, not about the person, and the fix is a link away.
 */
export function ProfileStateLine({ state, investigatorId, className }: { state: ProfileState; investigatorId: string; className?: string }) {
  const ran = state.itemCount === null ? null : `${nf.format(state.itemCount)} classified item${state.itemCount === 1 ? "" : "s"}`;
  return (
    <div className={cn("border-b border-line-row bg-card px-5 py-2.5 text-meta leading-normal text-ink-muted", className)}>
      {state.missing ? (
        <p className="m-0">
          No fit profile has been built for this person yet, so nothing below has been ranked against the notices.{" "}
          <Link href={`/investigators/${investigatorId}/fit`} className="font-medium text-teal hover:text-navy">
            What the profile would read
          </Link>
        </p>
      ) : (
        <>
          <p className="m-0">
            Ranked on {ran ?? "the stored fit profile"}
            {state.sources.length ? ` — ${state.sources.join(", ")}` : ""}
            {state.builtAt ? `, built ${fmtMonDYear(state.builtAt)}` : ""}
            {state.rankedAt ? `; scored against the open notices ${fmtMonDYear(state.rankedAt)}` : ""}.{" "}
            <Link href={`/investigators/${investigatorId}/fit`} className="font-medium text-teal hover:text-navy">
              The profile behind this
            </Link>
          </p>
          {state.gaps.length ? (
            <p className="m-0 mt-0.5 text-ink-body">
              <span className="font-medium">Could not use:</span> {state.gaps.join("; ")}.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
