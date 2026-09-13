/**
 * The vocabulary of the one-click email response, kept pure so the public
 * page's client component can import it. `response.ts` holds the reads and
 * writes (Supabase, notifications) and re-exports these; a client bundle
 * that reached `response.ts` would drag `lib/notifications/digest` — and
 * through it `fs` — into the browser, which `next build` refuses.
 */

export type OutreachResponse = "interested" | "pass";

export const TOKEN_RE = /^[a-f0-9]{48}$/;
export const isOutreachResponse = (v: unknown): v is OutreachResponse => v === "interested" || v === "pass";

/** The match status each answer writes (`RecipientStatus` in types.ts). "Not this time" is the product's "Not now". */
export const RESPONSE_STATUS: Record<OutreachResponse, "replied_interested" | "replied_not_now"> = { interested: "replied_interested", pass: "replied_not_now" };
export const RESPONSE_LABEL: Record<OutreachResponse, string> = { interested: "Interested", pass: "Not this time" };

/** What the public page needs to render, resolved from the token. */
export type ResponseContext = {
  messageRecipientId: string;
  /** The match; null when the recipient row was removed after sending. */
  recipientId: string | null;
  itemId: string;
  teamId: string;
  investigatorName: string;
  firstName: string;
  strategistName: string;
  strategistFirstName: string;
  replyTo: string | null;
  noticeNumber: string | null;
  noticeTitle: string;
  sentAt: string | null;
  response: OutreachResponse | null;
  responseNote: string | null;
  respondedAt: string | null;
};
