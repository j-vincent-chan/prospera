/**
 * Sending. One message row per compose, one recipient row per person or
 * community address, each sent separately from the verified sender under
 * the team's sending identity (`lib/outreach/sender.ts`): "Name via
 * Prospera" with reply-to the team inbox, or the team's name with reply-to
 * the team address. Recipients are marked
 * Contacted, the item moves to Contacting, and the activity log records it.
 * Do-not-contact blocks a send; the per-investigator limit is enforced here
 * too, not only warned about in Compose.
 *
 * Two shapes of message leave here. With `email` (the Draft outreach page,
 * which knows its beats) each recipient gets the designed HTML email —
 * `lib/email/outreach-email-html.ts` — with the plain text as the
 * alternative. Without it (the Compose tab) the message is plain text, as it
 * always was. Either way each recipient row is minted a response token and
 * the two one-click links are in the message, so "I’m interested" from the
 * email lands on the match the same as a reply recorded by hand.
 */

import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { outreachEmailAttachments } from "@/lib/email/outreach-email-assets";
import { CID_ASSETS, renderOutreachEmail, responseLinksText, type OutreachEmailCard } from "@/lib/email/outreach-email-html";
import { sendTransactionalTextEmail } from "@/lib/email/send-transactional-text";
import { renderForRecipient } from "@/lib/outreach/draft";
import { replyToFor, senderLabel } from "@/lib/outreach/sender";
import { outreachResponseUrl } from "@/lib/team/urls";

export type SendTarget = {
  recipientId: string;
  kind: "person" | "community";
  investigatorId: string | null;
  communityId: string | null;
  name: string;
  lastName: string;
  email: string;
  personalLine: string | null;
  /** The research community the footer names ("ImmunoX"); null names none. See `recipient-community.ts`. */
  community: string | null;
};

/** What the HTML email needs beyond the body: beats 1, 3 and 4 as the strategist left them (beat 2 is each target's `personalLine`), the notice card, the sender's title. */
export type OutreachEmailParts = {
  relevant: string;
  know: string;
  next: string;
  card: OutreachEmailCard;
  sender: { title: string | null };
};

export type SendInput = {
  itemId: string;
  teamId: string;
  sender: { id: string; name: string; email: string | null };
  team: { name: string; sendingIdentity: string | null; sendingAddress: string | null; replyToEmail: string | null; perInvestigatorLimit: number };
  subject: string;
  body: string;
  mode: "one" | "personalized";
  targets: SendTarget[];
  /** Present → the designed HTML email; absent → plain text. */
  email?: OutreachEmailParts | null;
};

export type SendResult = { ok: true; messageId: string; sent: number; failed: Array<{ name: string; error: string }> } | { ok: false; error: string };

const quarterStart = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1)).toISOString();

/** The response-link columns exist only once 20261010100000_outreach_email_response.sql is applied; before that the message goes out as plain text without them. */
const MISSING_COLUMN = /could not find the .*column|column .* does not exist|schema cache/i;

/** Messages this team sent to each investigator this quarter. */
export async function quarterSendCounts(db: SupabaseClient, teamId: string, investigatorIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!investigatorIds.length) return out;
  const { data } = await db
    .from("outreach_message_recipients")
    .select("investigator_id, outreach_messages!inner(team_id)")
    .eq("outreach_messages.team_id", teamId)
    .eq("status", "sent")
    .gte("sent_at", quarterStart())
    .in("investigator_id", investigatorIds);
  for (const r of (data ?? []) as Array<{ investigator_id: string | null }>) if (r.investigator_id) out.set(r.investigator_id, (out.get(r.investigator_id) ?? 0) + 1);
  return out;
}

/** The per-recipient row, with the response token and HTML when the schema has room for them. `withLinks` says whether the token was stored — and so whether the links may go into the message. */
async function insertMessageRecipient(db: SupabaseClient, row: Record<string, unknown>, extras: { response_token: string; rendered_html: string | null }): Promise<{ id: string | null; withLinks: boolean }> {
  const first = await db.from("outreach_message_recipients").insert({ ...row, ...extras }).select("id").single();
  if (!first.error) return { id: (first.data as { id: string } | null)?.id ?? null, withLinks: true };
  if (!MISSING_COLUMN.test(first.error.message)) return { id: null, withLinks: false };
  const second = await db.from("outreach_message_recipients").insert(row).select("id").single();
  return { id: (second.data as { id: string } | null)?.id ?? null, withLinks: false };
}

export async function sendOutreach(db: SupabaseClient, input: SendInput): Promise<SendResult> {
  if (!input.targets.length) return { ok: false, error: "Pick at least one recipient." };
  if (!input.subject.trim() || !input.body.trim()) return { ok: false, error: "Subject and message are required." };

  const personIds = input.targets.map((t) => t.investigatorId).filter((x): x is string => Boolean(x));
  if (personIds.length) {
    const { data: dnc } = await db.from("investigators").select("id, full_name").in("id", personIds).not("do_not_contact_at", "is", null);
    if (dnc?.length) return { ok: false, error: `${(dnc as Array<{ full_name: string }>).map((d) => d.full_name).join(", ")} ${dnc.length === 1 ? "is" : "are"} marked do not contact.` };
    const counts = await quarterSendCounts(db, input.teamId, personIds);
    const over = input.targets.filter((t) => t.investigatorId && (counts.get(t.investigatorId) ?? 0) >= input.team.perInvestigatorLimit && input.team.perInvestigatorLimit > 0);
    if (over.length) return { ok: false, error: `${over.map((t) => t.name).join(", ")} already reached the team limit of ${input.team.perInvestigatorLimit} messages this quarter.` };
  }

  const fromEnv = process.env.RESEND_FROM_EMAIL?.trim() ?? "";
  const fromAddress = fromEnv.replace(/^.*<([^>]+)>.*$/, "$1");
  const replyTo = replyToFor({ identity: input.team.sendingIdentity, sendingAddress: input.team.sendingAddress, replyToEmail: input.team.replyToEmail, senderEmail: input.sender.email });
  const fromName = senderLabel({ identity: input.team.sendingIdentity, senderName: input.sender.name, teamName: input.team.name });
  const { data: msg, error: msgErr } = await db
    .from("outreach_messages")
    .insert({ item_id: input.itemId, team_id: input.teamId, sender_id: input.sender.id, sender_name: input.sender.name, from_address: fromAddress || null, reply_to: replyTo, mode: input.mode, subject: input.subject.trim(), body: input.body })
    .select("id")
    .single();
  if (msgErr || !msg) return { ok: false, error: msgErr?.message ?? "Could not record the message." };
  const messageId = (msg as { id: string }).id;

  // The signature's address: where a reply actually goes.
  const signatureEmail = replyTo ?? input.sender.email;
  const attachments = input.email ? outreachEmailAttachments() : [];

  const failed: Array<{ name: string; error: string }> = [];
  let sent = 0;
  const now = new Date().toISOString();
  for (const t of input.targets) {
    const rendered = renderForRecipient({ subject: input.subject, body: input.body, lastName: t.lastName, personalLine: input.mode === "personalized" ? t.personalLine : null });
    const token = randomBytes(24).toString("hex");
    const urls = { interested: outreachResponseUrl(token, "interested"), pass: outreachResponseUrl(token, "pass") };
    const whyYou = (input.mode === "personalized" ? t.personalLine?.trim() : null) || null;
    let html: string | null =
      input.email && whyYou
        ? renderOutreachEmail({
            subject: rendered.subject,
            preheader: whyYou,
            greeting: `Dear Dr. ${t.lastName},`,
            relevant: input.email.relevant,
            whyYou,
            know: input.email.know,
            next: input.email.next,
            card: input.email.card,
            sender: { name: input.sender.name, title: input.email.sender.title, email: signatureEmail },
            community: t.community,
            urls,
            assets: CID_ASSETS,
          })
        : null;
    let text = `${rendered.body}\n\n${responseLinksText(urls)}`;

    const inserted = await insertMessageRecipient(
      db,
      { message_id: messageId, recipient_id: t.recipientId, investigator_id: t.investigatorId, community_id: t.communityId, to_email: t.email, to_name: t.name, personal_line: input.mode === "personalized" ? t.personalLine : null, rendered_subject: rendered.subject, rendered_body: text, status: "queued" },
      { response_token: token, rendered_html: html },
    );
    if (!inserted.withLinks) {
      // No stored token means no page to land on: send the message as it was before this feature.
      html = null;
      text = rendered.body;
      if (inserted.id) await db.from("outreach_message_recipients").update({ rendered_body: text }).eq("id", inserted.id);
    }
    const mrId = inserted.id;
    const res = await sendTransactionalTextEmail({ to: t.email, subject: rendered.subject, text, html: html ?? undefined, replyTo, fromName, attachments: html && attachments.length ? attachments : undefined });
    if (res.ok) {
      sent += 1;
      if (mrId) await db.from("outreach_message_recipients").update({ status: "sent", provider_id: res.id, sent_at: now }).eq("id", mrId);
      const { data: rec } = await db.from("outreach_recipients").select("contact_count").eq("id", t.recipientId).maybeSingle();
      await db.from("outreach_recipients").update({ status: "contacted", contacted_at: now, contact_count: ((rec as { contact_count?: number } | null)?.contact_count ?? 0) + 1 }).eq("id", t.recipientId);
    } else {
      failed.push({ name: t.name, error: res.error });
      if (mrId) await db.from("outreach_message_recipients").update({ status: "failed", error: res.error }).eq("id", mrId);
    }
  }
  if (sent > 0) {
    await db.from("outreach_messages").update({ sent_at: now }).eq("id", messageId);
    const { data: item } = await db.from("outreach_items").select("stage").eq("id", input.itemId).maybeSingle();
    const patch: Record<string, unknown> = { last_activity_at: now, draft: {}, draft_saved_at: null };
    if ((item as { stage?: string } | null)?.stage === "triage") patch.stage = "contacting";
    await db.from("outreach_items").update(patch).eq("id", input.itemId);
    const names = input.targets.filter((t) => !failed.some((f) => f.name === t.name)).map((t) => t.name);
    await db.from("outreach_activity").insert({
      item_id: input.itemId,
      team_id: input.teamId,
      actor_id: input.sender.id,
      actor_name: input.sender.name,
      kind: "outreach_sent",
      text: `sent outreach to ${names.join(", ")}${(item as { stage?: string } | null)?.stage === "triage" ? " · moved to Contacting" : ""}`,
      payload: { message_id: messageId, sent, failed: failed.length, format: input.email ? "html" : "text" },
    });
  }
  return { ok: true, messageId, sent, failed };
}
