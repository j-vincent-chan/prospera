/**
 * `requireUser` (PR 3.2, D7): `authEmail` is the sign-in email as the auth
 * server reports it; `email` prefers the editable `profiles.email`. A surface
 * that identifies the viewer with a directory record compares `authEmail`.
 */
import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/fit/__fixtures__/fake-db";

const holder = vi.hoisted(() => ({ session: null as unknown, admin: {} as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => holder.session }));
vi.mock("@/lib/supabase/admin-service", () => ({ createServiceRoleClient: () => holder.admin }));

import { requireUser } from "./require-team";

const withAuth = (email: string | undefined, profiles: Array<Record<string, unknown>>) => {
  const db = fakeDb({ profiles });
  (db as unknown as { auth: unknown }).auth = { getUser: async () => ({ data: { user: email === undefined ? null : { id: "user-1", email } } }) };
  return db;
};

describe("team/require-team · requireUser", () => {
  it("authEmail is auth.getUser()'s email, lower-cased; email prefers profiles.email — the two differ when the user edited their profile", async () => {
    holder.session = withAuth("Ada@UCSF.edu", [{ id: "user-1", email: "someone-else@ucsf.edu", full_name: "Ada" }]);
    const r = await requireUser();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.authEmail).toBe("ada@ucsf.edu");
    expect(r.email).toBe("someone-else@ucsf.edu");
    expect(r.userId).toBe("user-1");
    expect(r.fullName).toBe("Ada");
  });

  it("without a profile row both read the auth email; an auth user without an email has no authEmail; signed out is refused", async () => {
    holder.session = withAuth("ada@ucsf.edu", []);
    const r = await requireUser();
    expect(r.ok && [r.email, r.authEmail]).toEqual(["ada@ucsf.edu", "ada@ucsf.edu"]);
    holder.session = withAuth("", [{ id: "user-1", email: "profile@ucsf.edu" }]);
    const noAuthEmail = await requireUser();
    expect(noAuthEmail.ok && [noAuthEmail.email, noAuthEmail.authEmail]).toEqual(["profile@ucsf.edu", null]);
    holder.session = withAuth(undefined, []);
    expect(await requireUser()).toEqual({ ok: false, error: "Sign in to continue." });
  });
});
