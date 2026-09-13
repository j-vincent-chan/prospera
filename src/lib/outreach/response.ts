/**
 * The one-click response behind the email's two links. The 48-hex token in
 * /r/<token> is minted per `outreach_message_recipients` row by `send.ts`;
 * it is the only credential the public page accepts and it reaches exactly
 * that row — and, through it, the match (`outreach_recipients`) the message
 * was sent for. Mirrors `recordReplyAction`, with `reply_source: "email_link"`
 * instead of "manual" and the investigator as the actor.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isOutreachResponse, RESPONSE_LABEL, RESPONSE_STATUS, TOKEN_RE, type OutreachResponse, type ResponseContext } from "@/lib/outreach/response-types";

export { isOutreachResponse, RESPONSE_LABEL, RESPONSE_STATUS, TOKEN_RE, type OutreachResponse, type ResponseContext };

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const firstOf = (name: string) => name.trim().split(/\s+/)[0] || name;

type Row = {
  id: string;
  recipient_id: string | null;
  to_name: string | null;
  sent_at: string | null;
  response: string | null;
  response_note: string | null;
  responded_at: string | null;
  outreach_messages:
    | { item_id: string; team_id: string; sender_name: string | null; reply_to: string | null; outreach_items: { funding_opportunities: { title: string; opportunity_number: string | null } | { title: string; opportunity_number: string | null }[] | null } | { funding_opportunities: { title: string; opportunity_number: string | null } | { title: string; opportunity_number: string | null }[] | null }[] | null }
    | Array<{ item_id: string; team_id: string; sender_name: string | null; reply_to: string | null; outreach_items: { funding_opportunities: { title: string; opportunity_number: string | null } | { title: string; opportunity_number: string | null }[] | null } | { funding_opportunities: { title: string; opportunity_number: string | null } | { title: string; opportunity_number: string | null }[] | null }[] | null }>
    | null;
};

export async function loadResponseContext(admin: SupabaseClient, token: string): Promise<ResponseContext | null> {
  if (!TOKEN_RE.test(token)) return null;
  const { data } = await admin
    .from("outreach_message_recipients")
    .select("id, recipient_id, to_name, sent_at, response, response_note, responded_at, outreach_messages!inner(item_id, team_id, sender_name, reply_to, outreach_items(funding_opportunities(title, opportunity_number)))")
    .eq("response_token", token)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as Row;
  const msg = one(row.outreach_messages);
  if (!msg) return null;
  const fo = one(one(msg.outreach_items)?.funding_opportunities);
  const investigatorName = row.to_name?.trim() || "Investigator";
  const strategistName = msg.sender_name?.trim() || "Your research development strategist";
  return {
    messageRecipientId: row.id,
    recipientId: row.recipient_id,
    itemId: msg.item_id,
    teamId: msg.team_id,
    investigatorName,
    firstName: firstOf(investigatorName),
    strategistName,
    strategistFirstName: firstOf(strategistName),
    replyTo: msg.reply_to,
    noticeNumber: fo?.opportunity_number ?? null,
    noticeTitle: fo?.title?.replace(/\s*\((R|U|K|P|F|T|D|G|S|X|C|N|M)\d{2}[^)]*\)\s*$/i, "").trim() || "the funding opportunity",
    sentAt: row.sent_at,
    response: isOutreachResponse(row.response) ? row.response : null,
    responseNote: row.response_note,
    respondedAt: row.responded_at,
  };
}

/**
 * Write the answer: the message row, the match (status, replied_at, note,
 * source), the activity log, an immediate "PI reply" notification for
 * teammates who asked for one. Answering again overwrites — the log keeps
 * both, and says it was a change.
 */
export async function recordResponse(admin: SupabaseClient, ctx: ResponseContext, input: { response: OutreachResponse; note: string | null }): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = new Date().toISOString();
  const note = input.note?.trim().slice(0, 1000) || null;
  const changed = ctx.response != null && ctx.response !== input.response;
  const label = RESPONSE_LABEL[input.response];

  const { error } = await admin.from("outreach_message_recipients").update({ response: input.response, response_note: note, responded_at: now }).eq("id", ctx.messageRecipientId);
  if (error) return { ok: false, error: error.message };
  if (ctx.recipientId) {
    await admin.from("outreach_recipients").update({ status: RESPONSE_STATUS[input.response], replied_at: now, reply_note: note, reply_source: "email_link" }).eq("id", ctx.recipientId);
  }
  await admin.from("outreach_activity").insert({
    item_id: ctx.itemId,
    team_id: ctx.teamId,
    actor_id: null,
    actor_name: ctx.investigatorName,
    kind: "reply",
    text: `${changed ? "changed the reply to" : "replied"} ${label} from the email${note ? ` · “${note.slice(0, 120)}”` : ""}`,
    payload: { message_recipient_id: ctx.messageRecipientId, response: input.response, source: "email_link" },
  });
  await admin.from("outreach_items").update({ last_activity_at: now }).eq("id", ctx.itemId);
  try {
    const { notifyImmediate } = await import("@/lib/notifications/digest");
    await notifyImmediate(admin, {
      teamId: ctx.teamId,
      eventType: "pi_reply",
      key: `pi_reply:${ctx.recipientId ?? ctx.messageRecipientId}:${now}`,
      subject: `${ctx.investigatorName} replied ${label}`,
      text: `${ctx.investigatorName} replied ${label} from the outreach email about ${ctx.noticeTitle}${note ? `: “${note.slice(0, 200)}”` : ""}.`,
      href: `/outreach?item=${ctx.itemId}`,
    });
  } catch {
    // Notifications are best-effort.
  }
  return { ok: true };
}
