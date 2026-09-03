import { sendTransactionalTextEmail } from "@/lib/email/send-transactional-text";

function siteUrl(): string {
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

/** Email invitation: the link signs the person in (or up) and lands them in the workspace. */
export async function sendInvitationEmail(input: {
  to: string;
  teamName: string;
  inviterName: string | null;
  role: "admin" | "member";
  token: string;
  expiresAt: string;
}) {
  const expires = new Date(input.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const by = input.inviterName ? `${input.inviterName} invited you` : "You've been invited";
  return sendTransactionalTextEmail({
    to: input.to,
    subject: `${by} to ${input.teamName} on Prospera`,
    text: [
      `${by} to join ${input.teamName} on Prospera as ${input.role === "admin" ? "an Admin" : "a Member"}.`,
      "",
      "Open this link to accept. UCSF faculty and staff sign in with MyAccess; external collaborators use a password.",
      invitationUrl(input.token),
      "",
      `The invitation expires on ${expires}.`,
      "",
      "Prospera · Office of Collaborative Research, UCSF",
    ].join("\n"),
  });
}

/** Owners/admins: someone asked to join. */
export async function sendAccessRequestEmail(input: {
  to: string;
  teamName: string;
  requesterName: string;
  requesterEmail: string | null;
  note: string | null;
}) {
  return sendTransactionalTextEmail({
    to: input.to,
    subject: `${input.requesterName} asked to join ${input.teamName}`,
    text: [
      `${input.requesterName}${input.requesterEmail ? ` (${input.requesterEmail})` : ""} requested to join ${input.teamName} on Prospera.`,
      input.note ? `\n"${input.note}"\n` : "",
      "Review the request in Team settings → Requests:",
      `${siteUrl()}/team?tab=requests`,
      "",
      "Prospera · Office of Collaborative Research, UCSF",
    ].join("\n"),
  });
}

/** Requester: approved. */
export async function sendRequestApprovedEmail(input: { to: string; teamName: string; role: "admin" | "member" }) {
  return sendTransactionalTextEmail({
    to: input.to,
    subject: `You're in ${input.teamName}`,
    text: [
      `Your request to join ${input.teamName} was approved. You're ${input.role === "admin" ? "an Admin" : "a Member"}.`,
      "",
      `${siteUrl()}/home`,
      "",
      "Prospera · Office of Collaborative Research, UCSF",
    ].join("\n"),
  });
}

/** Requester: denied, with the optional note. */
export async function sendRequestDeniedEmail(input: { to: string; teamName: string; note: string | null }) {
  return sendTransactionalTextEmail({
    to: input.to,
    subject: `Your request to join ${input.teamName}`,
    text: [
      `A team owner declined your request to join ${input.teamName}.`,
      input.note ? `\n"${input.note}"\n` : "",
      "You can request again after 14 days, or ask an owner to invite you by email.",
      "",
      "Prospera · Office of Collaborative Research, UCSF",
    ].join("\n"),
  });
}

/** Members: the team was archived. */
export async function sendTeamArchivedEmail(input: { to: string; teamName: string; byName: string | null }) {
  return sendTransactionalTextEmail({
    to: input.to,
    subject: `${input.teamName} was archived`,
    text: [
      `${input.byName ?? "A team owner"} archived ${input.teamName} on Prospera.`,
      "The workspace is read-only for 90 days. Any owner can restore it from Team settings before then.",
      "",
      "Prospera · Office of Collaborative Research, UCSF",
    ].join("\n"),
  });
}
