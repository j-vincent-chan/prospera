import { sendTransactionalTextEmail } from "@/lib/email/send-transactional-text";
import {
  band,
  button,
  escapeHtml,
  fmtLongDate,
  fmtShortDate,
  paragraph,
  personRow,
  quote,
  renderEmail,
  section,
} from "@/lib/email/team-email-html";

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

/** Lands a server-generated Supabase sign-in link on /auth/confirm, then continues to `next`. */
export function confirmUrl(tokenHash: string, type: "invite" | "magiclink", next: string): string {
  const u = new URL(`${siteUrl()}/auth/confirm`);
  u.searchParams.set("token_hash", tokenHash);
  u.searchParams.set("type", type);
  u.searchParams.set("next", next);
  return u.toString();
}

const roleNoun = (role: "admin" | "member") => (role === "admin" ? "an Admin" : "a Member");
const roleLabel = (role: "admin" | "member") => (role === "admin" ? "Admin" : "Member");
const today = () => fmtShortDate(new Date().toISOString());

/** Email invitation: the link opens the invitation page, which signs the person in (or creates their account). */
export async function sendInvitationEmail(input: {
  to: string;
  teamName: string;
  teamDescription?: string | null;
  inviterName: string | null;
  inviterTitle?: string | null;
  role: "admin" | "member";
  token: string;
  expiresAt: string;
}) {
  const url = invitationUrl(input.token);
  const inviter = input.inviterName ?? "A team owner";
  const expires = fmtLongDate(input.expiresAt);
  const subject = `${inviter} invited you to ${input.teamName} on Prospera`;

  const html = renderEmail({
    siteUrl: siteUrl(),
    preheader: `Join ${input.teamName} as ${roleNoun(input.role)}. The invitation expires ${expires}.`,
    headerMeta: `Team invitation · expires ${fmtShortDate(input.expiresAt)}`,
    rows: [
      section(
        personRow({
          name: inviter,
          meta: [input.inviterTitle, input.teamName, today()].filter(Boolean).join(" · "),
        }) +
          `<div style="margin-top:14px">${paragraph(
            `${escapeHtml(inviter)} invited you to join <strong style="font-weight:600">${escapeHtml(input.teamName)}</strong> on Prospera as ${roleNoun(input.role)}. Prospera is where the team scans funding notices, matches investigators and runs outreach.`,
          )}</div>`,
      ),
      band({
        label: "Team workspace",
        title: input.teamName,
        subtitle: [input.teamDescription, `You'd join as ${roleLabel(input.role)}`].filter(Boolean).join(" · "),
      }),
      section(
        `${button({ href: url, label: "Accept invitation" })}
         <div style="margin-top:12px">${paragraph(
           "UCSF faculty and staff sign in with MyAccess. External collaborators get a one-time sign-in link from the invitation page and can set a password afterwards.",
           { muted: true, size: 13 },
         )}</div>
         <div style="margin-top:10px">${paragraph(`This invitation expires on ${escapeHtml(expires)}.`, { muted: true, size: 13 })}</div>`,
      ),
    ],
  });

  return sendTransactionalTextEmail({
    to: input.to,
    subject,
    html,
    text: [
      `${inviter} invited you to join ${input.teamName} on Prospera as ${roleNoun(input.role)}.`,
      "",
      "Open this link to accept. UCSF faculty and staff sign in with MyAccess; external collaborators get a one-time sign-in link and can set a password afterwards.",
      url,
      "",
      `The invitation expires on ${expires}.`,
      "",
      "Prospera · Office of Collaborative Research, UCSF",
    ].join("\n"),
  });
}

/** One-time sign-in link requested from the invitation page. */
export async function sendInvitationSignInEmail(input: { to: string; teamName: string; url: string }) {
  const html = renderEmail({
    siteUrl: siteUrl(),
    preheader: `Your one-time sign-in link for ${input.teamName} on Prospera.`,
    headerMeta: "Sign-in link · valid for one hour",
    rows: [
      section(
        paragraph(`Here is your one-time link to sign in to Prospera and join <strong style="font-weight:600">${escapeHtml(input.teamName)}</strong>.`) +
          `<div style="margin-top:18px">${button({ href: input.url, label: `Sign in and join ${input.teamName}` })}</div>
           <div style="margin-top:12px">${paragraph(
             "The link works once and expires in an hour. If it has expired, open your invitation again and request a new one. You can set a password afterwards in Settings.",
             { muted: true, size: 13 },
           )}</div>`,
      ),
    ],
  });
  return sendTransactionalTextEmail({
    to: input.to,
    subject: `Your sign-in link for ${input.teamName} on Prospera`,
    html,
    text: [
      `Here is your one-time link to sign in to Prospera and join ${input.teamName}:`,
      input.url,
      "",
      "The link works once and expires in an hour. If it has expired, open your invitation again and request a new one.",
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
  requesterTitle?: string | null;
  note: string | null;
}) {
  const url = `${siteUrl()}/team?tab=requests`;
  const html = renderEmail({
    siteUrl: siteUrl(),
    preheader: `${input.requesterName} requested to join ${input.teamName}.`,
    headerMeta: `Access request · ${today()}`,
    rows: [
      section(
        personRow({ name: input.requesterName, meta: [input.requesterEmail, input.requesterTitle].filter(Boolean).join(" · ") }) +
          `<div style="margin-top:14px">${paragraph(`${escapeHtml(input.requesterName)} asked to join <strong style="font-weight:600">${escapeHtml(input.teamName)}</strong> on Prospera.`)}</div>` +
          (input.note ? quote(input.note) : ""),
      ),
      band({ label: "Request to join", title: input.teamName, subtitle: "Approve as Member or Admin, or deny with a note. Requests expire after 30 days." }),
      section(button({ href: url, label: "Review request" })),
    ],
  });
  return sendTransactionalTextEmail({
    to: input.to,
    subject: `${input.requesterName} asked to join ${input.teamName}`,
    html,
    text: [
      `${input.requesterName}${input.requesterEmail ? ` (${input.requesterEmail})` : ""} requested to join ${input.teamName} on Prospera.`,
      input.note ? `\n"${input.note}"\n` : "",
      "Review the request in Team settings → Requests:",
      url,
      "",
      "Prospera · Office of Collaborative Research, UCSF",
    ].join("\n"),
  });
}

/** Requester: approved. */
export async function sendRequestApprovedEmail(input: { to: string; teamName: string; role: "admin" | "member" }) {
  const url = `${siteUrl()}/home`;
  const html = renderEmail({
    siteUrl: siteUrl(),
    preheader: `Your request to join ${input.teamName} was approved.`,
    headerMeta: `Approved · ${today()}`,
    rows: [
      section(paragraph(`Your request to join <strong style="font-weight:600">${escapeHtml(input.teamName)}</strong> was approved. You're ${roleNoun(input.role)}.`)),
      band({ label: "You're in", title: input.teamName, subtitle: `Joined as ${roleLabel(input.role)}` }),
      section(button({ href: url, label: "Open Prospera" })),
    ],
  });
  return sendTransactionalTextEmail({
    to: input.to,
    subject: `You're in ${input.teamName}`,
    html,
    text: [
      `Your request to join ${input.teamName} was approved. You're ${roleNoun(input.role)}.`,
      "",
      url,
      "",
      "Prospera · Office of Collaborative Research, UCSF",
    ].join("\n"),
  });
}

/** Requester: denied, with the optional note. */
export async function sendRequestDeniedEmail(input: { to: string; teamName: string; note: string | null }) {
  const html = renderEmail({
    siteUrl: siteUrl(),
    preheader: `A team owner declined your request to join ${input.teamName}.`,
    headerMeta: `Request declined · ${today()}`,
    rows: [
      section(
        paragraph(`A team owner declined your request to join <strong style="font-weight:600">${escapeHtml(input.teamName)}</strong>.`) +
          (input.note ? quote(input.note) : "") +
          `<div style="margin-top:12px">${paragraph("You can request again after 14 days, or ask an owner to invite you by email.", { muted: true, size: 13 })}</div>`,
      ),
      section(button({ href: `${siteUrl()}/onboarding`, label: "Find another team", secondary: true })),
    ],
  });
  return sendTransactionalTextEmail({
    to: input.to,
    subject: `Your request to join ${input.teamName}`,
    html,
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
  const by = input.byName ?? "A team owner";
  const html = renderEmail({
    siteUrl: siteUrl(),
    preheader: `${by} archived ${input.teamName}. Read-only for 90 days.`,
    headerMeta: `Team archived · ${today()}`,
    rows: [
      section(
        paragraph(`${escapeHtml(by)} archived <strong style="font-weight:600">${escapeHtml(input.teamName)}</strong> on Prospera.`) +
          `<div style="margin-top:8px">${paragraph("The workspace is read-only for 90 days. Any owner can restore it from Team settings before then; after that the team and its shared work are deleted.", { muted: true, size: 13 })}</div>`,
      ),
      section(button({ href: `${siteUrl()}/team`, label: "Open Team settings", secondary: true })),
    ],
  });
  return sendTransactionalTextEmail({
    to: input.to,
    subject: `${input.teamName} was archived`,
    html,
    text: [
      `${by} archived ${input.teamName} on Prospera.`,
      "The workspace is read-only for 90 days. Any owner can restore it from Team settings before then.",
      "",
      "Prospera · Office of Collaborative Research, UCSF",
    ].join("\n"),
  });
}
