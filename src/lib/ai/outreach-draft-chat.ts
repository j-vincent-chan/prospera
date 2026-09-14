import OpenAI from "openai";
import { buildDraftChatMessages, parseDraftChatReply, type DraftChatRequest, type DraftChatResult } from "@/lib/outreach/draft-chat";

/** The same family the Compose tab's shorten / lengthen used; `OUTREACH_DRAFT_CHAT_MODEL` names another. */
const MODEL = process.env.OUTREACH_DRAFT_CHAT_MODEL?.trim() || "gpt-4o-mini";

/**
 * One turn of the Draft page's section chat: the prompt from
 * `lib/outreach/draft-chat.ts`, JSON back, parsed there. Never in a page
 * render path — the server action calls this on a button press.
 */
export async function runOutreachDraftChat(req: DraftChatRequest): Promise<DraftChatResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return { ok: false, error: "OPENAI_API_KEY is not configured." };
  const openai = new OpenAI({ apiKey });
  try {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.3,
      max_tokens: 1_000,
      response_format: { type: "json_object" },
      messages: buildDraftChatMessages(req),
    });
    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) return { ok: false, error: "Prospera gave an empty answer; the message is unchanged." };
    return parseDraftChatReply(raw, req.texts);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
