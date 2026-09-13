import { readFileSync } from "fs";
import path from "path";
import { OUTREACH_CID } from "@/lib/email/outreach-email-html";

/**
 * Server side only (reads /public). The three images the outreach email
 * references as cid: — the Prospera icon and wordmark in the header, the OCR
 * mark in the signature — as Resend inline attachments, the same way
 * `brandAttachments()` in team-email-html.ts ships the app icon. Inline
 * attachments render without remote-image permission; a relative or
 * app-hosted URL would not.
 */
const FILES: ReadonlyArray<{ cid: string; file: string }> = [
  { cid: OUTREACH_CID.icon, file: "prospera-app-icon.png" },
  { cid: OUTREACH_CID.wordmark, file: "prospera-wordmark.png" },
  { cid: OUTREACH_CID.ocr, file: "ocr-mark.png" },
];

/** A missing file is skipped, never thrown — the message still goes, with that image's alt text in its place. */
export function outreachEmailAttachments(): Array<{ filename: string; content: string; content_id: string }> {
  const out: Array<{ filename: string; content: string; content_id: string }> = [];
  for (const f of FILES) {
    try {
      out.push({ filename: f.file, content: readFileSync(path.join(process.cwd(), "public", "brand", f.file)).toString("base64"), content_id: f.cid });
    } catch {
      // skipped
    }
  }
  return out;
}
