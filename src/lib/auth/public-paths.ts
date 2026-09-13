/**
 * Routes the session middleware lets a signed-out visitor reach. Pure, so
 * the list is testable: a page added under `app/(public)` renders without
 * the app chrome, but it is this list that keeps the middleware from
 * bouncing the visitor to /login first.
 */
export function isPublicPath(path: string): boolean {
  return (
    path.startsWith("/login") ||
    path.startsWith("/auth") ||
    // Invitation landing decides itself what to show signed-out visitors.
    path.startsWith("/invite/") ||
    // Biosketch authorization page: investigators without a Prospera account open it from email.
    path.startsWith("/biosketch/") ||
    // Outreach email response page (/r/<token>): the PI answers from the email, no account involved.
    path.startsWith("/r/") ||
    // ICS calendar feeds authenticate with the token in the URL.
    path.startsWith("/api/calendar/") ||
    // Cron endpoints authenticate via CRON_SECRET (Bearer), not a Supabase session.
    path.startsWith("/api/cron")
  );
}
