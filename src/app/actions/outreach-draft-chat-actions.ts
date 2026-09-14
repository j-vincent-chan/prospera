"use server";

import { z } from "zod";
import { runOutreachDraftChat } from "@/lib/ai/outreach-draft-chat";
import { HISTORY_TURNS, SECTION_KEYS, type ChatChanges } from "@/lib/outreach/draft-chat";
import { requireTeamRole } from "@/lib/team/require-team";

const text = (max: number) => z.string().max(max);

const schema = z.object({
  itemId: z.string().uuid(),
  focus: z.enum(SECTION_KEYS),
  instruction: z.string().trim().min(1, "Ask for a change first.").max(2_000),
  texts: z.object({ subject: text(400), relevant: text(4_000), whyYou: text(4_000), know: text(4_000), next: text(4_000) }),
  context: z.object({
    recipient: z.object({ name: text(200), lastName: text(100), followUp: z.boolean(), sharedWith: z.number().int().min(1).max(500) }),
    notice: z.object({ sponsor: text(200).nullable(), mechanism: text(200).nullable(), number: text(100).nullable(), title: text(600), dueDate: text(40).nullable(), awardLine: text(200).nullable(), summary: text(2_000).nullable() }),
    sender: z.object({ name: text(200), title: text(200).nullable() }),
    whyYou: z.object({ evidence: text(2_000), sharp: text(2_000).nullable() }),
  }),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: text(4_000) })).max(HISTORY_TURNS * 2),
});

export type RefineDraftInput = z.input<typeof schema>;
export type RefineDraftResult = { ok: true; reply: string; changes: ChatChanges } | { ok: false; error: string };

/**
 * Message — Draft outreach (R37): one turn of the section chat. A team
 * member asks for a change to the message they are looking at; the model
 * rewrites the texts the request names and the page applies them. Nothing
 * is written here — the draft is saved and sent by the page's own buttons.
 */
export async function refineOutreachDraftAction(input: RefineDraftInput): Promise<RefineDraftResult> {
  const guard = await requireTeamRole("member");
  if (!guard.ok) return { ok: false, error: guard.error };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "The request could not be read." };
  const { data: item } = await guard.admin.from("outreach_items").select("id").eq("id", parsed.data.itemId).eq("team_id", guard.actor.teamId).maybeSingle();
  if (!item) return { ok: false, error: "Outreach item not found." };
  const timeout = new Promise<RefineDraftResult>((resolve) => setTimeout(() => resolve({ ok: false, error: "Prospera did not answer within 25 seconds; the message is unchanged." }), 25_000));
  return Promise.race([runOutreachDraftChat(parsed.data), timeout]);
}
