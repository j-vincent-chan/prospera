/**
 * Message — Draft outreach: the section chat under the preview (R37).
 *
 * The strategist picks one of the four sections, edits it by hand, or asks
 * Prospera for a change in plain words; the model rewrites that section (or
 * the ones the request names) and the preview follows. Pure — the prompt is
 * built here and the reply is parsed here; the model call is
 * `lib/ai/outreach-draft-chat.ts`, and the draft's state stays in the page.
 *
 * The model is told the facts it may use and nothing else: the notice card
 * the email shows, who the recipient is, the lines Prospera composed for
 * "why you", and the five texts as they stand. It rewrites words; it does
 * not add dates, amounts or claims. A reply that changes nothing is an
 * answer, not an error.
 */
import { z } from "zod";

export const SECTION_KEYS = ["relevant", "whyYou", "know", "next"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];
export const SECTION_LABELS: Record<SectionKey, string> = { relevant: "Why it is relevant", whyYou: "Why you", know: "What to know", next: "Next step" };

/** Everything the chat may rewrite: the four sections and the subject. */
export type ChatTextKey = SectionKey | "subject";
export const CHAT_TEXT_KEYS: readonly ChatTextKey[] = ["subject", ...SECTION_KEYS];
export type ChatTexts = Record<ChatTextKey, string>;
export type ChatChanges = Partial<ChatTexts>;

export type DraftChatTurn = { role: "user" | "assistant"; content: string };

export type DraftChatContext = {
  recipient: { name: string; lastName: string; followUp: boolean; sharedWith: number };
  /** The notice card the email shows — the facts the model may use. */
  notice: { sponsor: string | null; mechanism: string | null; number: string | null; title: string; dueDate: string | null; awardLine: string | null; summary: string | null };
  sender: { name: string; title: string | null };
  /** The lines Prospera composed for "why you"; `sharp` is null when the notice has no profile to say it. */
  whyYou: { evidence: string; sharp: string | null };
};

export type DraftChatRequest = { context: DraftChatContext; texts: ChatTexts; focus: SectionKey; instruction: string; history: DraftChatTurn[] };
export type DraftChatResult = { ok: true; reply: string; changes: ChatChanges } | { ok: false; error: string };
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export const MAX_SECTION_CHARS = 1_500;
export const MAX_SUBJECT_CHARS = 200;
/** Prior exchanges the model sees — this many user turns and their answers. */
export const HISTORY_TURNS = 8;

const UNREADABLE = "Prospera's answer could not be read; the message is unchanged.";

const listAnd = (xs: readonly string[]): string => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** "the subject", "Why you" — how a changed text is named in a sentence. */
export function changedLabels(keys: readonly ChatTextKey[]): string[] {
  return keys.map((k) => (k === "subject" ? "the subject" : SECTION_LABELS[k]));
}

/** Pure. The system prompt: what the email is, the facts the model may use, the section in focus, the JSON shape. */
export function systemPrompt(ctx: DraftChatContext, focus: SectionKey): string {
  const n = ctx.notice;
  const head = [n.sponsor, n.mechanism].filter(Boolean).join(" · ");
  const what = [n.number, n.title].filter(Boolean).join(" — ");
  const facts = [
    `- Recipient: Dr. ${ctx.recipient.name} (surname ${ctx.recipient.lastName}). ${ctx.recipient.followUp ? "This is a follow-up to an earlier note about this notice." : "This is the first message to them about this notice."}`,
    `- Notice: ${head ? `${head}: ` : ""}${what}.${n.dueDate ? ` Due ${n.dueDate}.` : ""}${n.awardLine ? ` Award: ${n.awardLine}.` : ""}`,
    n.summary ? `- What the notice funds, in its own words: ${n.summary}` : null,
    `- Sender: ${ctx.sender.name}${ctx.sender.title ? `, ${ctx.sender.title}` : ""}, UCSF Office of Collaborative Research.`,
    `- Lines Prospera composed for "Why you": evidence-led — "${ctx.whyYou.evidence}"${ctx.whyYou.sharp ? `; sharper — "${ctx.whyYou.sharp}"` : ". No sharper line exists for this notice"}.`,
    ctx.recipient.sharedWith > 1 ? `- The subject and sections 1, 3 and 4 go to all ${ctx.recipient.sharedWith} recipients on this notice; only "Why you" is written for this person alone.` : null,
  ].filter((s): s is string => Boolean(s));
  return [
    "You help a research-development strategist at UCSF finish one email to one investigator about one funding notice. The strategist signs it; you rewrite words on request.",
    "",
    "The email is a subject line and four short sections, in this order:",
    `1. relevant — "${SECTION_LABELS.relevant}": the notice's own facts (sponsor, number, title, deadline, award).`,
    `2. whyYou — "${SECTION_LABELS.whyYou}": the one sentence written for this recipient, from the evidence behind the match.`,
    `3. know — "${SECTION_LABELS.know}": the constraints worth flagging before they decide, and the offer to handle internal routing.`,
    `4. next — "${SECTION_LABELS.next}": the closing line.`,
    "The greeting and the sign-off are added by the system. Never put a greeting, a sign-off or the sender's name inside a section.",
    "",
    "Facts you may use — and the only ones:",
    ...facts,
    "Do not add any date, amount, title, name, requirement or claim that is not in these facts or in the current text. If asked for something the facts cannot support, say so in the reply and change nothing.",
    "",
    `The strategist is looking at "${SECTION_LABELS[focus]}". Apply the request to that section unless it clearly names another section, the subject, or the whole message. Put a text in "changes" only when the request asked for it to change, and give it in full; a text the request did not ask about is left out of "changes" entirely, even if you would word it differently — never echo it back, never tidy it.`,
    "Voice: plain, warm, specific, one professional to another. No marketing language, no exclamation marks, no bullet points, no headings. Write dates and amounts the way the current text does. Keep each section to its own job; do not move facts between sections unless asked.",
    "A question, or a request that needs no change, gets an answer in the reply and an empty changes object.",
    "",
    'Respond with JSON only, in this shape: {"reply": string, "changes": {"subject"?: string, "relevant"?: string, "whyYou"?: string, "know"?: string, "next"?: string}}. The reply is one or two sentences to the strategist saying what you changed, or answering them.',
  ].join("\n");
}

/** Pure. The five texts as the model reads them. */
export function renderTexts(texts: ChatTexts): string {
  return [`Subject: ${texts.subject}`, "", ...SECTION_KEYS.flatMap((k) => [`[${SECTION_LABELS[k]}]`, texts[k].trim() || "(empty)", ""])].join("\n").trimEnd();
}

/** Pure. System prompt, the last few exchanges, then the current texts and the request. */
export function buildDraftChatMessages(req: DraftChatRequest): ChatMessage[] {
  const history = req.history.filter((t) => t.content.trim()).slice(-HISTORY_TURNS * 2);
  return [
    { role: "system", content: systemPrompt(req.context, req.focus) },
    ...history.map((t): ChatMessage => ({ role: t.role, content: t.content })),
    { role: "user", content: `Current email:\n\n${renderTexts(req.texts)}\n\nRequest: ${req.instruction.trim()}` },
  ];
}

const GREETING = /^\s*dear\b[^\n]*\n+/i;
const SIGNOFF = /\n+\s*(?:best|all the best|best regards|best wishes|warm regards|warmly|kind regards|regards|sincerely|thanks|thank you|cheers)[,.!]?\s*(?:\n[\s\S]*)?$/i;

/** Pure. A returned text, made safe to drop into the email: no greeting or sign-off, no runaway length, a subject on one line. */
export function cleanText(key: ChatTextKey, raw: string): string {
  if (key === "subject") return raw.replace(/\s+/g, " ").trim().slice(0, MAX_SUBJECT_CHARS).trim();
  const text = raw.replace(/\r\n?/g, "\n").replace(GREETING, "").replace(SIGNOFF, "").replace(/\n{3,}/g, "\n\n").trim();
  return text.length > MAX_SECTION_CHARS ? text.slice(0, MAX_SECTION_CHARS).trim() : text;
}

/** The JSON object in a reply, with or without a code fence around it. */
function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1]! : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

const replySchema = z.object({ reply: z.unknown().optional(), changes: z.record(z.string(), z.unknown()).nullish() });

/** The same words: whitespace runs, straight and curly quotes, and dash forms do not make a change. */
export function sameWords(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
  return norm(a) === norm(b);
}

/**
 * Pure. The model's JSON as a reply and the texts that actually changed:
 * unknown keys are dropped, so is a text that is empty or says the same
 * words as what the strategist has (a model echoing every section with a
 * curlier quote is not a rewrite). A reply with no words gets a plain one.
 */
export function parseDraftChatReply(raw: string, current: ChatTexts): DraftChatResult {
  let json: unknown;
  try {
    json = JSON.parse(extractJson(raw));
  } catch {
    return { ok: false, error: UNREADABLE };
  }
  const parsed = replySchema.safeParse(json);
  if (!parsed.success) return { ok: false, error: UNREADABLE };
  const changes: ChatChanges = {};
  for (const key of CHAT_TEXT_KEYS) {
    const value = parsed.data.changes?.[key];
    if (typeof value !== "string") continue;
    const text = cleanText(key, value);
    if (!text || sameWords(text, current[key])) continue;
    changes[key] = text;
  }
  const changed = Object.keys(changes) as ChatTextKey[];
  const said = typeof parsed.data.reply === "string" ? parsed.data.reply.trim() : "";
  const reply = said || (changed.length ? `Rewrote ${listAnd(changedLabels(changed))}.` : "Nothing to change there.");
  return { ok: true, reply, changes };
}

/** Pure. The texts with the changes applied, what each replaced (for Undo), and which keys moved, in section order. */
export function applyChanges(texts: ChatTexts, changes: ChatChanges): { next: ChatTexts; before: ChatChanges; changed: ChatTextKey[] } {
  const next = { ...texts };
  const before: ChatChanges = {};
  const changed: ChatTextKey[] = [];
  for (const key of CHAT_TEXT_KEYS) {
    const value = changes[key];
    if (value == null || value === texts[key]) continue;
    before[key] = texts[key];
    next[key] = value;
    changed.push(key);
  }
  return { next, before, changed };
}
