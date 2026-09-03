/**
 * Sending. One message row per compose, one recipient row per person or
 * community address, each sent separately as "Name via Prospera" from the
 * verified sender with reply-to the team inbox. Recipients are marked
 * Contacted, the item moves to Contacting, and the activity log records it.
 * Do-not-contact blocks a send; the per-investigator limit is enforced here
 * too, not only warned about in Compose.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendTransactionalTextEmail } from "@/lib/email/send-transactional-text";
import { renderForRecipient } from "@/lib/outreach/draft";

export type SendTarget = {
  recipientId: string;
  kind: "person" | "community";
  investigatorId: string | null;
  communityId: string | null;
  name: string;
  lastName: string;
  email: string;
  personalLine: string | null;
};

export type SendInput = {
  itemId: string;
  teamId: string;
  sender: { id: string; name: string; email: string | null };
  team: { replyToEmail: string | null; perInvestigatorLimit: number };
  subject: string;
  body: string;
  mode: "one" | "personalized";
  targets: SendTarget[];
};

export type SendResult = { ok: true; messageId: string; sent: number; failed: Array<{ name: string; error: string }> } | { ok: false; error: string };

const quarterStart = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1)).toISOString();

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
  const replyTo = input.team.replyToEmail?.trim() || input.sender.email || null;
  const { data: msg, error: msgErr } = await db
    .from("outreach_messages")
    .insert({ item_id: input.itemId, team_id: input.teamId, sender_id: input.sender.id, sender_name: input.sender.name, from_address: fromAddress || null, reply_to: replyTo, mode: input.mode, subject: input.subject.trim(), body: input.body })
    .select("id")
    .single();
  if (msgErr || !msg) return { ok: false, error: msgErr?.message ?? "Could not record the message." };
  const messageId = (msg as { id: string }).id;

  const failed: Array<{ name: string; error: string }> = [];
  let sent = 0;
  const now = new Date().toISOString();
  for (const t of input.targets) {
    const rendered = renderForRecipient({ subject: input.subject, body: input.body, lastName: t.lastName, personalLine: input.mode === "personalized" ? t.personalLine : null });
    const { data: mr } = await db
      .from("outreach_message_recipients")
      .insert({ message_id: messageId, recipient_id: t.recipientId, investigator_id: t.investigatorId, community_id: t.communityId, to_email: t.email, to_name: t.name, personal_line: input.mode === "personalized" ? t.personalLine : null, rendered_subject: rendered.subject, rendered_body: rendered.body, status: "queued" })
      .select("id")
      .single();
    const mrId = (mr as { id: string } | null)?.id;
    const res = await sendTransactionalTextEmail({ to: t.email, subject: rendered.subject, text: rendered.body, replyTo, fromName: `${input.sender.name} via Prospera` });
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
      payload: { message_id: messageId, sent, failed: failed.length },
    });
  }
  return { ok: true, messageId, sent, failed };
}
