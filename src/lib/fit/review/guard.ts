/**
 * Who may open `/team/fit-review` and who may decide on its items (plan § PR
 * 3.3, "strategist-gated").
 *
 * **"Strategist" in this codebase is not a `team_memberships.role`.** The
 * roles are owner / admin / member; the strategist is the *audience* —
 * `fitAudienceFor` (PR 3.2, D43) reads a viewer as `investigator` exactly
 * when their sign-in email is the directory record's, and as `strategist`
 * otherwise. So reading and deciding are gated apart:
 *
 *   **Reading** (`gateReviewPage`): any signed-in member of a team, at any
 *   role, and never a signed-out visitor. The queue is a working surface for
 *   research-development staff; hiding it from members would hide the judge's
 *   reasoning from the people who work the Outreach queue.
 *
 *   **Deciding** (`requireStrategist`): **admin or owner**. Every decision
 *   here changes an institution-wide stored profile — a notice correction
 *   re-scores every investigator against that notice, a profile-weight
 *   correction moves one investigator's gates for every team — and nothing
 *   about it is team-scoped or reversible without a second write. That is the
 *   same line `/team/data-sources` draws for its runs, so the page renders for
 *   a member with the decision controls disabled and a line saying to ask a
 *   team admin, rather than 403-ing the whole surface.
 *
 * Two extra rules D6 asks for, both enforced per decision rather than by
 * hiding the page — "strategist confirmation before it persists" means a
 * second pair of eyes, and PR 3.2 already lets a PI *propose* a correction
 * from their own page:
 *
 *   1 A correction on an investigator's own profile may not be decided by
 *     that investigator (`fitAudienceFor` on the directory email).
 *   2 A correction the *investigator themselves* proposed, on a subject the
 *     directory has no email for, may not be decided at all: rule 1 cannot
 *     run without an email, so the check would pass vacuously and the PI
 *     could close their own loop from a second account. On the 2026-09
 *     directory no investigator carries an email, so rule 1 is inert today
 *     and rule 2 is what actually holds the line.
 *
 * `refusesOwnProfile` is both, and the action runs it on every
 * `investigator_profile` decision.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fitAudienceFor } from "@/lib/fit/explain-view";
import type { CorrectionRow } from "@/lib/fit/judge/corrections";
import { loadWorkspaceContext } from "@/lib/team/current-team";
import { requireTeamRole, type Guard, type TeamActor } from "@/lib/team/require-team";
import type { TeamRole } from "@/lib/team/types";

export type StrategistGuard = Guard<{ actor: TeamActor; admin: SupabaseClient; session: SupabaseClient }>;

/** The review queue's gate for a **write**: an owner or an admin of the current team (see the module note — every decision here is institution-wide). */
export async function requireStrategist(): Promise<StrategistGuard> {
  return requireTeamRole("admin");
}

/** Pure. Whether a viewer at this role may decide, not only read — what the page passes the screen as `canDecide`. The line a member sees instead is `CANNOT_DECIDE_NOTE` in `components/fit/review-queue.tsx`; the copy lives there because this module pulls the service-role client and may not reach a client bundle. */
export const canDecideAtRole = (role: TeamRole): boolean => role !== "member";

/** What the page does with a viewer: render, or send them somewhere. */
export type PageGate = { ok: true; userId: string; teamId: string; teamName: string; role: TeamRole } | { ok: false; redirect: "/login" | "/onboarding" };

/**
 * The read gate for the page render (`/team/fit-review/page.tsx`), as a plain
 * function so the redirects are testable without rendering: signed out → the
 * login page, signed in without a current team → onboarding, otherwise the
 * queue for a member of any role. The role comes back with it, because the
 * page renders the decision controls only for `canDecideAtRole`.
 */
export async function gateReviewPage(supabase: SupabaseClient): Promise<PageGate> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, redirect: "/login" };
  const context = await loadWorkspaceContext(supabase, user.id);
  if (!context?.current) return { ok: false, redirect: "/onboarding" };
  return { ok: true, userId: user.id, teamId: context.current.teamId, teamName: context.current.team.name, role: context.current.role };
}

/**
 * Pure. D6's two refusals on an `investigator_profile` decision (see the
 * module note): the viewer is the subject, or the subject has no email on
 * file and the *investigator* proposed the correction, so no second pair of
 * eyes can be established. `null` = allowed; a string = the refusal.
 */
export function refusesOwnProfile(actor: Pick<TeamActor, "authEmail">, subject: { email?: string | null } | null, proposal: { proposedBy?: CorrectionRow["proposed_by"] | null } = {}): string | null {
  const email = subject?.email?.trim() || null;
  if (subject && fitAudienceFor({ email: actor.authEmail }, subject) === "investigator") {
    return "This correction is on your own fit profile. A profile correction needs another strategist's confirmation (D6) — ask a colleague on your team to decide it.";
  }
  if (!email && proposal.proposedBy === "investigator") {
    return "This correction was proposed by the investigator and the directory has no email on file for them, so D6's “not your own profile” check cannot run. Add the investigator's email to the directory record, then decide it.";
  }
  return null;
}
