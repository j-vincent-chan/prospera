/**
 * The signed-in user and their workspace, read once per request.
 *
 * The (app) layout and every page under it used to each call
 * `auth.getUser()` (a round trip to the auth server) and then
 * `loadWorkspaceContext()` (two more) — the same reads, twice per navigation,
 * on top of the middleware's own `getUser()`. React's `cache` memoises these
 * for the life of one server render, so the layout and the page share one
 * answer. Server actions run outside the render and keep calling
 * `createClient()` themselves.
 */
import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { loadWorkspaceContext, type WorkspaceContext } from "@/lib/team/current-team";

/** The signed-in user, or null. One auth-server call per request. */
export const getSessionUser = cache(async (): Promise<User | null> => {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/**
 * `loadWorkspaceContext` for the signed-in user, once per request. Null when
 * signed out or when the user has no profile row (the layout redirects to
 * /login in both cases).
 */
export const getSessionWorkspace = cache(async (): Promise<WorkspaceContext | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  return loadWorkspaceContext(createClient(), user.id, { authEmail: user.email ?? null });
});
