/** Absolute app URLs used in emails and on the invitation / team screens. Safe to import from client components. */

export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

export function invitationUrl(token: string): string {
  return `${siteUrl()}/invite/${token}`;
}

export function inviteLinkUrl(slug: string, token: string): string {
  return `${siteUrl()}/join/${slug}/${token}`;
}

/** Lands a server-generated Supabase sign-in link on /auth/confirm, then continues to `next`. */
export function confirmUrl(tokenHash: string, type: "invite" | "magiclink", next: string): string {
  const u = new URL(`${siteUrl()}/auth/confirm`);
  u.searchParams.set("token_hash", tokenHash);
  u.searchParams.set("type", type);
  u.searchParams.set("next", next);
  return u.toString();
}
