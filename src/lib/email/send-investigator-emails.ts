import { sendTransactionalTextEmail } from "@/lib/email/send-transactional-text";
import { band, brandAttachments, button, escapeHtml, paragraph, personRow, renderEmail, section, fmtShortDate } from "@/lib/email/team-email-html";
import { biosketchUrl, siteUrl } from "@/lib/team/urls";

/**
 * Biosketch request to an investigator. The link opens a public page where
 * they upload the document, date it and authorize its use — or decline, which
 * Prospera records so nobody asks again.
 */
export async function sendBiosketchRequestEmail(input: {
  to: string;
  investigatorName: string;
  strategistName: string | null;
  strategistTitle?: string | null;
  teamName: string;
  token: string;
  kind: "request" | "reminder" | "update";
  currentDocumentDate?: string | null;
}) {
  const url = biosketchUrl(input.token);
  const from = input.strategistName ?? input.teamName;
  const subjectBase =
    input.kind === "update"
      ? `Could you share an updated NIH biosketch with ${input.teamName}?`
      : `Could you share your NIH biosketch with ${input.teamName}?`;
  const subject = input.kind === "reminder" ? `Reminder: ${subjectBase}` : subjectBase;

  const intro =
    input.kind === "update"
      ? `The biosketch on file${input.currentDocumentDate ? ` is dated ${escapeHtml(fmtShortDate(input.currentDocumentDate))} and` : ""} may no longer reflect your current directions. A current version helps us match you only to notices that fit.`
      : `${escapeHtml(from)} uses Prospera to match UCSF investigators with funding notices. A biosketch is the best description of your expertise in your own words, so matches cite what you actually do rather than keywords.`;

  const html = renderEmail({
    siteUrl: siteUrl(),
    preheader: `${from} is asking for your NIH biosketch. Share it, or decline, in one step.`,
    headerMeta: input.kind === "reminder" ? "Biosketch request · reminder" : "Biosketch request",
    rows: [
      section(
        personRow({ name: from, meta: [input.strategistTitle, input.teamName, fmtShortDate(new Date().toISOString())].filter(Boolean).join(" · ") }) +
          `<div style="margin-top:14px">${paragraph(`Dear ${escapeHtml(input.investigatorName)},`)}</div>
           <div style="margin-top:10px">${paragraph(intro)}</div>`,
      ),
      band({
        label: "What we're asking",
        title: "Your NIH biosketch (PDF)",
        subtitle: "Used only to match you with funding notices and to draft outreach to you. Withdraw at any time from the same page.",
      }),
      section(
        `${button({ href: url, label: input.kind === "update" ? "Share an updated biosketch" : "Share my biosketch" })}
         <div style="margin-top:12px">${paragraph("Prefer not to? The same page has a Decline option, and Prospera won't ask again.", { muted: true, size: 13 })}</div>`,
      ),
    ],
    footerNote: "You received this because a UCSF research-development team keeps you in its directory.",
  });

  return sendTransactionalTextEmail({
    to: input.to,
    subject,
    html,
    attachments: brandAttachments(),
    text: [
      `Dear ${input.investigatorName},`,
      "",
      input.kind === "update"
        ? "The biosketch on file may no longer reflect your current directions. Could you share a current version?"
        : `${from} uses Prospera to match UCSF investigators with funding notices. Could you share your NIH biosketch (PDF)? It is used only to match you with notices and to draft outreach to you.`,
      "",
      "Share it, or decline, here:",
      url,
      "",
      "Prospera · Office of Collaborative Research, UCSF",
    ].join("\n"),
  });
}
