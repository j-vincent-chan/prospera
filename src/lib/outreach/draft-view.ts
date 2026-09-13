/**
 * Message — Draft outreach (README §6): the page's copy and its class table.
 * Pure; `draft-view.test.ts` keeps the same invariant the Review tables do —
 * `cn` joins, so no string names one utility group twice, and the design's
 * measurements (132px beat label, 26px toggle, 32px footer buttons) are
 * values here rather than choices at the call site.
 */

export type DraftFrom = "review" | "outreach";

export function backLabel(from: DraftFrom): string {
  return from === "review" ? "← Back to review" : "← Back to outreach";
}

export function backHref(from: DraftFrom): string {
  return from === "review" ? "/review" : "/outreach";
}

/** "2 confirmed matches · each message is assembled from the evidence behind the match, then edited by you" */
export function draftSubline(counts: { matches: number; followUps: number }): string {
  const parts: string[] = [];
  if (counts.matches) parts.push(`${counts.matches} confirmed match${counts.matches === 1 ? "" : "es"}`);
  if (counts.followUps) parts.push(`${counts.followUps} follow-up${counts.followUps === 1 ? "" : "s"}`);
  const head = parts.length ? parts.join(" and ") : "Nothing to draft";
  return `${head} · each message is assembled from the evidence behind the match, then edited by you`;
}

/** "Send 2 · individually" */
export function sendLabel(n: number): string {
  return `Send ${n} · individually`;
}

export type RecipientState = "Editing" | "Draft ready" | "No email on file";

/** Pure. The state line under a recipient in the aside. */
export function recipientState(input: { selected: boolean; email: string | null }): RecipientState {
  if (!input.email) return "No email on file";
  return input.selected ? "Editing" : "Draft ready";
}

/** The aside's footer note; `sentAs` is `senderLabel(...)` — the From header the send path writes. */
export function asideNote(sentAs: string): string {
  return `Each message is sent individually as “${sentAs}”. Replies thread back onto the match.`;
}

/** The main card's footer note. */
export function footerNote(sentAs: string): string {
  return `Sent individually as “${sentAs}” — an HTML email with a plain-text copy. Replies and the two buttons come back to you and thread onto the match.`;
}

export const SENT_NOTE = "Sent. Each recipient is now marked Contacted on their own match.";
export const NOTHING_SENT = "Nothing has been sent. Nothing is contacted until you send.";
export const TOGGLE_NOTE = "the only sentence that changes per recipient";
/** Appended to a beat's source once the strategist has changed its text. */
export const EDITED = " · edited by you";

export function toggleLabel(alt: "evidence" | "sharp"): string {
  return alt === "sharp" ? "Use the evidence-led line" : "Try a sharper line";
}

/** "same for the 2 recipients on this notice", or null for a notice with one. */
export function sharedNote(recipientsOnNotice: number): string | null {
  return recipientsOnNotice > 1 ? `same for the ${recipientsOnNotice} recipients on this notice` : null;
}

/** "Draft saved · just now" / "Draft saved · 4 min ago" / "Not saved yet" / "Unsaved changes" */
export function stampText(input: { savedAt: string | null; dirty: boolean; now: number }): string {
  if (input.dirty) return input.savedAt ? "Unsaved changes" : "Not saved yet";
  if (!input.savedAt) return "Not saved yet";
  const mins = Math.max(0, Math.round((input.now - new Date(input.savedAt).getTime()) / 60_000));
  return `Draft saved · ${mins === 0 ? "just now" : `${mins} min ago`}`;
}

// ---------------------------------------------------------------------------
// Class table
// ---------------------------------------------------------------------------

export const PAGE = "mx-auto w-full max-w-[1480px]";
export const BACK = "inline-block text-dense font-medium text-teal hover:text-navy";
export const H1 = "mb-0 mt-2 text-h1 font-semibold text-ink";
export const SUB = "mb-0 mt-1.5 text-body text-ink-body";
/** Recipients beside the message from `md`; below it the list sits above the message as a scroll box. */
export const LAYOUT = "mt-[18px] flex flex-col items-start gap-[clamp(12px,1.4vw,20px)] md:flex-row md:flex-nowrap";

export const ASIDE = "w-full shrink-0 self-start overflow-hidden rounded-card border border-line bg-card max-md:max-h-[40vh] max-md:overflow-y-auto md:sticky md:top-[60px] md:w-[clamp(220px,21vw,320px)]";
export const ASIDE_LABEL = "m-0 border-b border-line-row px-4 py-3 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted";
export const RECIPIENT = "block w-full border-b border-line-row px-4 py-3 text-left last:border-b-0";
export const RECIPIENT_TONE = { selected: "bg-teal-tint/30 shadow-[inset_3px_0_0_theme(colors.teal.DEFAULT)]", idle: "hover:bg-canvas" } as const;
export const RECIPIENT_NAME = "m-0 text-dense font-semibold text-ink";
export const RECIPIENT_NOTICE = "mb-0 mt-0.5 line-clamp-2 text-micro leading-[1.4] text-ink-muted";
export const RECIPIENT_STATE = "mb-0 mt-1 text-micro text-ink-body";
export const RECIPIENT_STATE_WARN = "mb-0 mt-1 text-micro font-medium text-warning-dark";
export const ASIDE_NOTE = "m-0 border-t border-line-row px-4 py-3 text-meta leading-normal text-ink-muted";

export const MAIN = "flex w-full min-w-0 flex-1 flex-col gap-3.5 md:min-w-[min(320px,100%)]";
export const CARD = "overflow-hidden rounded-card border border-line bg-card";
export const TO_ROW = "flex flex-wrap items-center justify-between gap-3 border-b border-line-row px-5 py-3";
export const TO_LABEL = "text-dense text-ink-muted";
export const TO_ADDRESS = "text-dense font-medium text-ink";
export const TO_MISSING = "text-dense font-medium text-warning-dark";
export const SUBJECT_BLOCK = "border-b border-line-row px-5 py-4";
export const EYEBROW = "m-0 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted";
export const SUBJECT_INPUT = "mt-1.5 w-full border-0 bg-transparent p-0 text-[15px] font-medium leading-snug text-ink outline-none";

/** Label beside the text from `sm`; stacked below. */
export const BEAT = "grid grid-cols-1 gap-x-5 gap-y-1.5 border-b border-line-row px-5 py-3 last:border-b-0 sm:grid-cols-[132px_minmax(0,1fr)]";
export const BEAT_SOURCE = "mb-0 mt-1 text-micro leading-[1.4] text-ink-muted";
export const BEAT_TEXT = "m-0 block w-full resize-none border-0 bg-transparent p-0 text-body leading-[1.65] text-ink outline-none";
export const BEAT_NOTE = "mb-0 mt-1 text-micro text-ink-muted";
export const TOGGLE_ROW = "mt-2 flex flex-wrap items-center gap-2.5";
export const TOGGLE_BTN = "inline-flex h-[26px] items-center rounded-control border border-line-control bg-card px-2.5 text-micro font-medium text-ink hover:bg-canvas";

export const FOOTER = "flex flex-wrap items-center justify-between gap-3 bg-canvas px-5 py-3.5";
export const FOOTER_NOTE = "m-0 max-w-[640px] text-meta leading-normal text-ink-muted";
export const FOOTER_ACTIONS = "flex flex-wrap items-center gap-2";
export const STAMP = "text-meta text-ink-muted";
export const SENT_LABEL = "text-meta font-semibold text-teal";

export const EMPTY = "rounded-card border border-line bg-card px-6 py-10 text-center";
export const EMPTY_TITLE = "m-0 text-body font-semibold text-ink";
export const EMPTY_TEXT = "mb-0 mt-1.5 text-dense leading-normal text-ink-muted";
export const EMPTY_LINKS = "mt-4 flex justify-center gap-4";
export const EMPTY_LINK = "text-dense font-medium text-teal hover:text-navy";

export const WARN = "m-0 rounded-tile border border-warning-border bg-warning-tint px-3.5 py-2.5 text-dense leading-normal text-warning-dark";
export const CONFIRM_ROW = "flex justify-between gap-3 border-b border-line-row py-2 text-dense";
export const CONFIRM_NAME = "whitespace-nowrap font-medium text-ink";
export const CONFIRM_EMAIL = "truncate text-ink-muted";
