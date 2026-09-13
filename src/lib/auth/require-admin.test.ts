/**
 * The admin gate (fix: the Team screen's "Admin" now opens the admin pages).
 * `profiles.role` is a pre-teams flag nothing in the product writes, so a
 * team owner or admin has to clear the gate too, or these pages are
 * unreachable by anyone who joined after the database was seeded.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAdminTeamRole, requireAdmin } from "@/lib/auth/require-admin";

const TEAM = "f2765762-28f2-419e-aa07-6aad422ae928";
const USER = "9a9a9a9a-2222-4333-8444-555566667777";

type Rows = { profile?: Record<string, unknown> | null; membership?: Record<string, unknown> | null; profileError?: string; membershipError?: string };

/** The two reads `requireAdmin` makes, in order, with a signed-in user unless `user` is null. */
const client = (rows: Rows, user: { id: string } | null = { id: USER }): SupabaseClient => {
  const seen: string[] = [];
  return {
    auth: { getUser: async () => ({ data: { user } }) },
    from(table: string) {
      seen.push(table);
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () =>
          table === "profiles"
            ? { data: rows.profile ?? null, error: rows.profileError ? { message: rows.profileError } : null }
            : { data: rows.membership ?? null, error: rows.membershipError ? { message: rows.membershipError } : null },
      };
      return builder;
    },
    seen,
  } as unknown as SupabaseClient;
};

describe("requireAdmin", () => {
  it("admits the pre-teams global flag without reading a membership", async () => {
    const db = client({ profile: { role: "admin", current_team_id: TEAM } });
    expect(await requireAdmin(db)).toEqual({ ok: true, userId: USER, via: "profile_role" });
    expect((db as unknown as { seen: string[] }).seen).toEqual(["profiles"]);
  });

  it("admits a team owner and a team admin — the roles the product can actually grant", async () => {
    for (const role of ["owner", "admin"] as const) {
      const db = client({ profile: { role: "staff", current_team_id: TEAM }, membership: { role } });
      expect(await requireAdmin(db), role).toEqual({ ok: true, userId: USER, via: "team_role" });
    }
  });

  it("refuses a plain member, and says the same thing it always said", async () => {
    const db = client({ profile: { role: "staff", current_team_id: TEAM }, membership: { role: "member" } });
    expect(await requireAdmin(db)).toEqual({ ok: false, error: "Admin role required" });
  });

  it("refuses someone with no membership on their current team, and someone with no team at all", async () => {
    expect(await requireAdmin(client({ profile: { role: "staff", current_team_id: TEAM }, membership: null }))).toEqual({ ok: false, error: "Admin role required" });
    const noTeam = client({ profile: { role: "staff", current_team_id: null } });
    expect(await requireAdmin(noTeam)).toEqual({ ok: false, error: "Admin role required" });
    // no team means no second read
    expect((noTeam as unknown as { seen: string[] }).seen).toEqual(["profiles"]);
  });

  it("refuses a signed-out visitor before reading anything", async () => {
    const db = client({}, null);
    expect(await requireAdmin(db)).toEqual({ ok: false, error: "Unauthorized" });
    expect((db as unknown as { seen: string[] }).seen).toEqual([]);
  });

  it("surfaces a read failure rather than admitting or silently refusing", async () => {
    expect(await requireAdmin(client({ profileError: "profiles unavailable" }))).toEqual({ ok: false, error: "profiles unavailable" });
    expect(await requireAdmin(client({ profile: { role: "staff", current_team_id: TEAM }, membershipError: "memberships unavailable" }))).toEqual({ ok: false, error: "memberships unavailable" });
  });

  it("isAdminTeamRole is ordered on ROLE_RANK, so a role above admin counts", () => {
    expect(isAdminTeamRole("owner")).toBe(true);
    expect(isAdminTeamRole("admin")).toBe(true);
    expect(isAdminTeamRole("member")).toBe(false);
    expect(isAdminTeamRole(null)).toBe(false);
  });
});
