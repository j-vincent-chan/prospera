/**
 * The review queue's gate (plan § PR 3.3, "strategist-gated"). Reading and
 * deciding are gated apart: the page renders for a signed-in member of a team
 * at any role — "strategist" is the audience (D43), not a
 * `team_memberships.role` — while a decision, which changes an
 * institution-wide profile, needs an owner or an admin. Then D6, per decision:
 * an investigator may not decide a correction on their own fit profile, and an
 * investigator-proposed correction on a subject with no directory email cannot
 * be checked at all.
 */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const holder = vi.hoisted(() => ({ context: null as unknown, asked: [] as string[], roleAsked: [] as string[] }));
vi.mock("@/lib/team/current-team", () => ({
  loadWorkspaceContext: async (_db: unknown, userId: string) => (holder.asked.push(userId), holder.context),
}));
vi.mock("@/lib/team/require-team", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  requireTeamRole: async (minRole: string) => (holder.roleAsked.push(minRole), { ok: false, error: "Owners and admins only." }),
}));

import { canDecideAtRole, gateReviewPage, refusesOwnProfile, requireStrategist } from "@/lib/fit/review/guard";

const client = (user: { id: string } | null): SupabaseClient => ({ auth: { getUser: async () => ({ data: { user } }) } }) as unknown as SupabaseClient;

describe("fit/review/guard · the page gate", () => {
  it("sends a signed-out visitor to the login page, without asking for a workspace", async () => {
    holder.asked = [];
    holder.context = null;
    expect(await gateReviewPage(client(null))).toEqual({ ok: false, redirect: "/login" });
    expect(holder.asked).toEqual([]);
  });

  it("sends a signed-in user with no current team to onboarding", async () => {
    holder.asked = [];
    holder.context = { current: null };
    expect(await gateReviewPage(client({ id: "u-1" }))).toEqual({ ok: false, redirect: "/onboarding" });
    expect(holder.asked).toEqual(["u-1"]);
    holder.context = null;
    expect(await gateReviewPage(client({ id: "u-1" }))).toEqual({ ok: false, redirect: "/onboarding" });
  });

  it("renders for a member, an admin and an owner alike, and returns the role the page decides on", async () => {
    for (const role of ["member", "admin", "owner"] as const) {
      holder.context = { current: { teamId: "t-1", role, team: { name: "OCR" } } };
      expect(await gateReviewPage(client({ id: "u-1" }))).toEqual({ ok: true, userId: "u-1", teamId: "t-1", teamName: "OCR", role });
    }
  });

  it("only an owner or an admin may decide: the write guard asks for admin, and a member reads with the controls off", async () => {
    holder.roleAsked = [];
    expect(await requireStrategist()).toMatchObject({ ok: false });
    expect(holder.roleAsked).toEqual(["admin"]);
    expect([canDecideAtRole("member"), canDecideAtRole("admin"), canDecideAtRole("owner")]).toEqual([false, true, true]);
  });
});

describe("fit/review/guard · refusesOwnProfile (D6)", () => {
  it("refuses only when the viewer's sign-in email is the directory record's, case-insensitively", () => {
    expect(refusesOwnProfile({ authEmail: "ada@ucsf.edu" }, { email: "Ada@UCSF.edu" })).toMatch(/your own fit profile/);
    expect(refusesOwnProfile({ authEmail: "s@ucsf.edu" }, { email: "ada@ucsf.edu" })).toBeNull();
    expect(refusesOwnProfile({ authEmail: null }, { email: "ada@ucsf.edu" })).toBeNull();
    expect(refusesOwnProfile({ authEmail: "ada@ucsf.edu" }, { email: null })).toBeNull();
    expect(refusesOwnProfile({ authEmail: "ada@ucsf.edu" }, null)).toBeNull();
  });

  it("refuses an investigator-proposed correction on a subject with no email on file — the check above cannot run, so it may not pass vacuously", () => {
    // No investigator in the 2026-09 directory carries an email, so this is the rule that actually holds D6's line.
    expect(refusesOwnProfile({ authEmail: "s@ucsf.edu" }, { email: null }, { proposedBy: "investigator" })).toMatch(/no email on file/);
    expect(refusesOwnProfile({ authEmail: "s@ucsf.edu" }, { email: "   " }, { proposedBy: "investigator" })).toMatch(/no email on file/);
    expect(refusesOwnProfile({ authEmail: "s@ucsf.edu" }, null, { proposedBy: "investigator" })).toMatch(/no email on file/);
    // The judge's and a strategist's proposals are unaffected, and an email on file lets the first rule do the work.
    expect(refusesOwnProfile({ authEmail: "s@ucsf.edu" }, { email: null }, { proposedBy: "judge" })).toBeNull();
    expect(refusesOwnProfile({ authEmail: "s@ucsf.edu" }, { email: null }, { proposedBy: "strategist" })).toBeNull();
    expect(refusesOwnProfile({ authEmail: "s@ucsf.edu" }, { email: "ada@ucsf.edu" }, { proposedBy: "investigator" })).toBeNull();
  });
});
