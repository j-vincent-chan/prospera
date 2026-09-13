/**
 * Who an outreach message is from, as the team's sending identity says
 * (Team settings → Outreach). Pure; `send.ts` and every surface that
 * promises "sent as …" read the same answer here, so the promise and the
 * header cannot disagree.
 *
 * The mailer can only change the *display name*: the address is always the
 * verified sender (`RESEND_FROM_EMAIL`). So "Team address" means the team's
 * name in the From header and the team's address as the reply-to — not a
 * message sent from that address, which the domain would refuse.
 */

export type SendingIdentity = "strategist_via_prospera" | "team_address";

export const isSendingIdentity = (v: unknown): v is SendingIdentity => v === "strategist_via_prospera" || v === "team_address";

/** "Vincent Chan via Prospera", or the team's name. An unknown setting reads as the strategist's. */
export function senderLabel(input: { identity: string | null | undefined; senderName: string; teamName: string }): string {
  return input.identity === "team_address" ? input.teamName.trim() || "The team" : `${input.senderName.trim() || "Prospera"} via Prospera`;
}

/** Where replies go: the team address under the team identity, else the reply-to inbox, else the sender's own address. */
export function replyToFor(input: { identity: string | null | undefined; sendingAddress: string | null; replyToEmail: string | null; senderEmail: string | null }): string | null {
  const team = input.identity === "team_address" ? input.sendingAddress?.trim() || null : null;
  return team || input.replyToEmail?.trim() || input.senderEmail?.trim() || null;
}

/** "Sent individually as “Vincent Chan via Prospera” from outreach@…; replies go to ocr@… and are recorded here." */
export function sendingNote(input: { label: string; fromAddress: string | null; replyTo: string | null }): string {
  return `Sent individually as “${input.label}”${input.fromAddress ? ` from ${input.fromAddress}` : ""}; replies go to ${input.replyTo ?? "your address"} and are recorded here.`;
}
