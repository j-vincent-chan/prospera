/**
 * Who may open `/team/fit-review` and decide on its items (plan § PR 3.3,
 * "strategist-gated").
 *
 * **"Strategist" in this codebase is not a `team_memberships.role`.** The
 * roles are owner / admin / member; the strategist is the *audience* —
 * `fitAudienceFor` (PR 3.2, D43) reads a viewer as `investigator` exactly
 * when their sign-in email is the directory record's, and as `strategist`
 * otherwise. So the gate here is: **a signed-in member of a team**, any role
 * — the research-development staff who work the Outreach queue, most of whom
 * are plain members, and never a signed-out visitor. Requiring `admin` would
 * lock out the people the queue is for; the inspector's `requireAdmin`
 * (profiles.role = 'admin') is a different, narrower tool for a debugging
 * surface.
 *
 * One extra rule the audience gives us, and D6 asks for: a correction on an
 * investigator's own profile may not be decided by that investigator. D6 is
 * "strategist confirmation before it persists", and PR 3.2 already lets a PI
 * *propose* one from their own page; approving their own proposal would close
 * the loop with no second pair of eyes. `refusesOwnProfile` is that check, and
 * the action runs it on every `investigator_profile` decision.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fitAudienceFor } from "@/lib/fit/explain-view";
import { loadWorkspaceContext } from "@/lib/team/current-team";
import { requireTeamRole, type Guard, type TeamActor } from "@/lib/team/require-team";
import type { TeamRole } from "@/lib/team/types";

export type StrategistGuard = Guard<{ actor: TeamActor; admin: SupabaseClient; session: SupabaseClient }>;

/** The review queue's gate for a write: a signed-in user with a current-team membership at any role. */
export async function requireStrategist(): Promise<StrategistGuard> {
  return requireTeamRole("member");
}

/** What the page does with a viewer: render, or send them somewhere. */
export type PageGate = { ok: true; userId: string; teamId: string; teamName: string; role: TeamRole } | { ok: false; redirect: "/login" | "/onboarding" };

/**
 * The same gate for the page render (`/team/fit-review/page.tsx`), as a
 * plain function so the redirects are testable without rendering: signed out
 * → the login page, signed in without a current team → onboarding, otherwise
 * the queue for a member of any role.
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
 * Pure. D6: an investigator may not decide a correction to their own fit
 * profile. `null` = allowed; a string = the refusal.
 */
export function refusesOwnProfile(actor: Pick<TeamActor, "authEmail">, subject: { email?: string | null } | null): string | null {
  if (!subject) return null;
  if (fitAudienceFor({ email: actor.authEmail }, subject) !== "investigator") return null;
  return "This correction is on your own fit profile. A profile correction needs another strategist's confirmation (D6) — ask a colleague on your team to decide it.";
}
