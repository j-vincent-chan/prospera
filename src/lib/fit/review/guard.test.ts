/**
 * The review queue's gate (plan § PR 3.3, "strategist-gated"). Two rules, and
 * the same one on the page and on its actions: a signed-in member of a team,
 * any role — "strategist" is the audience (D43), not a `team_memberships.role`
 * — and, per decision, D6's refusal to let an investigator decide a correction
 * on their own fit profile.
 */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const holder = vi.hoisted(() => ({ context: null as unknown, asked: [] as string[] }));
vi.mock("@/lib/team/current-team", () => ({
  loadWorkspaceContext: async (_db: unknown, userId: string) => (holder.asked.push(userId), holder.context),
}));

import { gateReviewPage, refusesOwnProfile } from "@/lib/fit/review/guard";

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

  it("admits a member, an admin and an owner alike — the queue is for strategists, not for a role", async () => {
    for (const role of ["member", "admin", "owner"] as const) {
      holder.context = { current: { teamId: "t-1", role, team: { name: "OCR" } } };
      expect(await gateReviewPage(client({ id: "u-1" }))).toEqual({ ok: true, userId: "u-1", teamId: "t-1", teamName: "OCR", role });
    }
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
});
