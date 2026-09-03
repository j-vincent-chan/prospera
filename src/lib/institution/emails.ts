/** Library and curation notifications (steward decisions, flags, review reminders). */
import { sendTransactionalTextEmail } from "@/lib/email/send-transactional-text";
import { brandAttachments, button, escapeHtml, paragraph, renderEmail, section } from "@/lib/email/team-email-html";
import { siteUrl } from "@/lib/team/urls";

async function send(input: { to: string; subject: string; preheader: string; headerMeta: string; lines: string[]; cta?: { label: string; path: string } }) {
  const url = input.cta ? `${siteUrl()}${input.cta.path}` : null;
  const rows = [section(input.lines.map((l) => paragraph(l)).join(""), { hairline: false })];
  if (url && input.cta) rows.push(section(button({ href: url, label: input.cta.label }), { hairline: true }));
  const html = renderEmail({ preheader: input.preheader, headerMeta: input.headerMeta, rows, footerNote: "Library notices go to the uploader and stewards only." });
  const text = `${input.lines.join("\n\n")}${url ? `\n\n${input.cta!.label}: ${url}` : ""}`;
  return sendTransactionalTextEmail({ to: input.to, subject: input.subject, text, html, fromName: "Prospera library", attachments: brandAttachments() });
}

export async function sendStewardDecisionEmail(input: { to: string; title: string; decision: "published" | "changes_requested" | "removed"; note: string | null; itemId: string }) {
  const what = input.decision === "published" ? "is now published to all of UCSF" : input.decision === "changes_requested" ? "needs changes before it can go public" : "was removed by a steward";
  return send({
    to: input.to,
    subject: `Library: “${input.title.slice(0, 60)}” ${input.decision === "published" ? "is published" : input.decision === "changes_requested" ? "needs changes" : "was removed"}`,
    preheader: `Your library upload ${what}.`,
    headerMeta: "Proposal library · steward review",
    lines: [`Your upload <strong>${escapeHtml(input.title)}</strong> ${what}.`, ...(input.note ? [`Steward note: “${escapeHtml(input.note)}”`] : [])],
    cta: { label: "Open in the library", path: `/library?item=${input.itemId}` },
  });
}

export async function sendFlagEmail(input: { to: string; title: string; reason: string; note: string | null; by: string; itemId: string }) {
  return send({
    to: input.to,
    subject: `Library: a reader flagged “${input.title.slice(0, 60)}”`,
    preheader: `${input.by} flagged your library item: ${input.reason}.`,
    headerMeta: "Proposal library · flag",
    lines: [`${escapeHtml(input.by)} flagged <strong>${escapeHtml(input.title)}</strong>: ${escapeHtml(input.reason)}.`, ...(input.note ? [`“${escapeHtml(input.note)}”`] : []), "The stewards see the same flag. You can update the item, add a new version, or confirm it is still accurate."],
    cta: { label: "Open the item", path: `/library?item=${input.itemId}` },
  });
}

export async function sendReviewReminderEmail(input: { to: string; title: string; reviewDue: string; itemId: string }) {
  return send({
    to: input.to,
    subject: `Library: “${input.title.slice(0, 60)}” is past its review date`,
    preheader: `Please confirm it is still accurate or upload a new version.`,
    headerMeta: "Proposal library · review due",
    lines: [`<strong>${escapeHtml(input.title)}</strong> passed its review date (${escapeHtml(input.reviewDue)}). Readers now see it as historical.`, "Confirm it is still accurate, add a new version, or ask a steward to remove it."],
    cta: { label: "Review the item", path: `/library?item=${input.itemId}` },
  });
}

export async function sendCuratedNeedsReviewEmail(input: { to: string; title: string; kind: "internal" | "limited"; reviewBy: string; editPath: string }) {
  return send({
    to: input.to,
    subject: `Curated record needs review: “${input.title.slice(0, 60)}”`,
    preheader: `Past its review-by date; hidden from suggestions and Home until re-verified.`,
    headerMeta: input.kind === "internal" ? "Internal (UCSF) · needs review" : "Limited submissions · needs review",
    lines: [`<strong>${escapeHtml(input.title)}</strong> passed its review-by date (${escapeHtml(input.reviewBy)}). It now shows “Needs review” and is left out of suggestions and Home until you re-verify it.`],
    cta: { label: "Re-verify", path: input.editPath },
  });
}
