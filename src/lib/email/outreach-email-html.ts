/**
 * The PI-facing outreach email (design: "Prospera Outreach Email"; the
 * reviewed reference is reference/prospera-outreach-email.html in the handoff
 * folder). A letter from a colleague in the Office of Collaborative Research,
 * not a Prospera notification: OCR is the sender, Prospera is a small mark in
 * the corner, the sign-off carries the OCR seal.
 *
 * Pure — words and URLs in, HTML out — so the Draft outreach page renders the
 * same document in a preview iframe and the send path renders it once per
 * recipient. No `fs`, no env: image sources arrive as `assets` (`cid:` when
 * sending, `/brand/…` when previewing; see outreach-email-assets.ts) and the
 * two response URLs arrive already minted. Keep it importable from a client
 * component — that is why `escapeHtml` is local rather than imported from
 * team-email-html.ts, which reads files.
 *
 * Email clients ignore stylesheets and web fonts, so everything is inline and
 * table-based, 600px wide (fluid below that: `width="600"` for Outlook,
 * `max-width:600px` for everyone else), Arial for text and Georgia for the
 * notice title.
 * The one <style> block is the mobile media query; clients that honour it
 * apply it, the rest ignore it harmlessly.
 *
 * Section order follows the design: header row → greeting and opening
 * paragraph (beat 1) → notice card → the ask (two buttons; beat 4 under them)
 * → "Why you" (beat 2, the only per-recipient sentence) → what to know
 * (beat 3) → signature with the OCR mark → footer.
 */

export type OutreachEmailCard = {
  /** "National Institutes of Health" — the eyebrow's first half. */
  sponsor: string | null;
  /** "R03", "U19 · cooperative agreement" — the eyebrow's second half. */
  mechanism: string | null;
  number: string | null;
  /** The title without its "(R03 Clinical Trial Not Allowed)" tail. */
  title: string;
  /** One or two sentences of the notice's purpose; null omits the row. */
  summary: string | null;
  /** ISO date (yyyy-mm-dd); null omits the deadline cell. */
  dueDate: string | null;
  /** "$100,000 direct / year · 2 years"; null omits the award cell. */
  awardLine: string | null;
  /** Where "View full funding announcement" goes; null omits the link. */
  url: string | null;
};

export type OutreachEmailAssets = { icon: string; wordmark: string; ocr: string };

export type OutreachEmailInput = {
  subject: string;
  /** Shown by mail clients beside the subject. The "why you" line is the strongest candidate. */
  preheader: string;
  /** "Dear Dr. Wiita," */
  greeting: string;
  /** Beat 1 — why it is relevant. Blank lines split paragraphs. */
  relevant: string;
  /** Beat 2 — this recipient's line. */
  whyYou: string;
  /** Beat 3 — what to know before deciding; null omits the paragraph. */
  know: string | null;
  /** Beat 4 — the next step; sits under the two buttons. */
  next: string;
  card: OutreachEmailCard;
  sender: { name: string; title: string | null; email: string | null };
  /** The research community the sender serves this recipient through ("ImmunoX", "Diabetes Center"); null when none is known. Names the footer's reason. */
  community: string | null;
  urls: { interested: string; pass: string };
  assets: OutreachEmailAssets;
};

export const ORG_NAME = "UCSF Office of Collaborative Research";
/** The line under the card — the office's mailing address (confirmed 2026-09-13). */
export const ORG_ADDRESS = "UCSF Office of Collaborative Research · 513 Parnassus Ave, MSB-447, San Francisco, CA 94143";
export const ASK = "Interested in exploring this?";
export const INTERESTED_LABEL = "I’m interested";
export const PASS_LABEL = "Not this time";
export const ANNOUNCEMENT_LABEL = "View full funding announcement";

/** The footer's why-you-got-this line: "…is the research development strategist for ImmunoX", or, with no community to name, "…is your research development strategist". */
export function footerNote(senderName: string, community: string | null): string {
  const role = community?.trim() ? `the research development strategist for ${community.trim()}` : "your research development strategist";
  return `You are receiving this because ${senderName} is ${role}. Reply and say so if you would like fewer of these.`;
}

/** Content ids for the three inline images (Resend `attachments[].content_id`). */
export const OUTREACH_CID = { icon: "prospera-icon", wordmark: "prospera-wordmark", ocr: "ocr-mark" } as const;
export const CID_ASSETS: OutreachEmailAssets = { icon: `cid:${OUTREACH_CID.icon}`, wordmark: `cid:${OUTREACH_CID.wordmark}`, ocr: `cid:${OUTREACH_CID.ocr}` };
/** What the Draft page's preview iframe loads: the same files, served from /public. */
export const PREVIEW_ASSETS: OutreachEmailAssets = { icon: "/brand/prospera-app-icon.png", wordmark: "/brand/prospera-wordmark.png", ocr: "/brand/ocr-mark.png" };

/** Design palette. The greys are the app's own (WCAG-checked against white and the card tint). */
const C = {
  canvas: "#eef0f3",
  card: "#ffffff",
  hairline: "#eceff3",
  tint: "#f5f8f9",
  tintLine: "#e3e9ec",
  navy: "#0b1d3a",
  teal: "#0e6b78",
  ink: "#26364a",
  body: "#475569",
  soft: "#5b6a7f",
  muted: "#64748b",
} as const;
const SANS = "Arial,Helvetica,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** "Friday, October 16, 2026" from an ISO date; the input when it does not parse. */
export function fmtEmailDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** The plain-text counterpart of the ask block, appended to the text body. */
export function responseLinksText(urls: { interested: string; pass: string }): string {
  return [ASK, `${INTERESTED_LABEL}: ${urls.interested}`, `${PASS_LABEL}: ${urls.pass}`].join("\n");
}

const lh = (px: number) => `line-height:${px}px;mso-line-height-rule:exactly;`;
const text = (size: number, line: number, color: string, extra = "") => `font-family:${SANS};font-size:${size}px;${lh(line)}color:${color};${extra}`;
const eyebrow = (color: string, spacing: string, bold = true) => `font-family:${SANS};font-size:10px;${lh(14)}letter-spacing:${spacing};text-transform:uppercase;${bold ? "font-weight:bold;" : ""}color:${color};`;
const T = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';

/** Blank-line-separated text as stacked paragraphs; single newlines become <br />. */
function paragraphs(value: string): string {
  return value
    .trim()
    .split(/\n{2,}/)
    .map((p, i) => `<p style="margin:${i ? 12 : 0}px 0 0;">${escapeHtml(p.trim()).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

function header(assets: OutreachEmailAssets): string {
  return `
        <tr>
          <td class="px" style="padding:22px 40px 0 40px;">
            <table ${T} width="100%">
              <tr>
                <td align="left" valign="middle" style="${eyebrow(C.muted, "1px", false)}padding-bottom:16px;border-bottom:1px solid ${C.hairline};">${escapeHtml(ORG_NAME)}</td>
                <td align="right" valign="middle" style="padding-bottom:16px;border-bottom:1px solid ${C.hairline};">
                  <table ${T} align="right">
                    <tr>
                      <td valign="middle" style="padding-right:6px;"><img src="${escapeHtml(assets.icon)}" width="16" height="18" alt="" style="display:block;width:16px;height:18px;border:0;" /></td>
                      <td valign="middle"><img src="${escapeHtml(assets.wordmark)}" width="58" height="12" alt="Prospera" style="display:block;width:58px;height:12px;border:0;" /></td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>`;
}

function factCell(label: string, value: string, width: number, first: boolean): string {
  return `
                      <td class="stack" width="${width}%" style="width:${width}%;padding:17px ${first ? "12px" : "0"} 0 0;vertical-align:top;">
                        <table ${T} width="100%">
                          <tr><td style="${eyebrow(C.muted, ".8px")}">${escapeHtml(label)}</td></tr>
                          <tr><td style="padding-top:5px;${text(15, 21, C.navy, "font-weight:bold;")}">${escapeHtml(value)}</td></tr>
                        </table>
                      </td>`;
}

function noticeCard(card: OutreachEmailCard): string {
  const eyebrowText = [card.sponsor, card.mechanism].filter(Boolean).join(" · ") || card.number || "Funding opportunity";
  const facts: string[] = [];
  if (card.dueDate) facts.push(factCell("Application deadline", fmtEmailDate(card.dueDate), card.awardLine ? 52 : 100, true));
  if (card.awardLine) facts.push(factCell("Award", card.awardLine, card.dueDate ? 48 : 100, !card.dueDate));
  return `
        <tr>
          <td class="px" style="padding:25px 40px 0 40px;">
            <table ${T} width="100%" style="background-color:${C.tint};border-radius:10px;">
              <tr>
                <td style="padding:21px 23px 0 23px;${eyebrow(C.teal, "1.2px")}">${escapeHtml(eyebrowText)}</td>
              </tr>
              <tr>
                <td class="h1" style="padding:10px 23px 0 23px;font-family:${SERIF};font-size:21px;${lh(29)}font-weight:bold;color:${C.navy};">${escapeHtml(card.title)}</td>
              </tr>${
                card.summary
                  ? `
              <tr>
                <td style="padding:11px 23px 0 23px;${text(15, 25, C.body)}">${escapeHtml(card.summary)}</td>
              </tr>`
                  : ""
              }${
                facts.length
                  ? `
              <tr>
                <td style="padding:19px 23px 0 23px;">
                  <table ${T} width="100%" style="border-top:1px solid ${C.tintLine};">
                    <tr>${facts.join("")}
                    </tr>
                  </table>
                </td>
              </tr>`
                  : ""
              }
              <tr>
                <td style="padding:${card.url ? "17px" : "0"} 23px 22px 23px;${text(14, 22, C.teal)}">${
                  card.url ? `<a href="${escapeHtml(card.url)}" style="color:${C.teal};text-decoration:underline;">${escapeHtml(ANNOUNCEMENT_LABEL)} &#8599;</a>` : ""
                }</td>
              </tr>
            </table>
          </td>
        </tr>`;
}

function ask(urls: { interested: string; pass: string }, next: string): string {
  return `
        <tr>
          <td class="px" style="padding:29px 40px 0 40px;">
            <table ${T} width="100%">
              <tr>
                <td align="center" style="${text(17, 24, C.navy, "font-weight:bold;")}">${escapeHtml(ASK)}</td>
              </tr>
              <tr>
                <td align="center" style="padding-top:17px;">
                  <table ${T} align="center" class="btn">
                    <tr>
                      <td align="center" bgcolor="${C.navy}" style="background-color:${C.navy};border-radius:6px;padding:13px 24px;">
                        <a href="${escapeHtml(urls.interested)}" style="display:inline-block;font-family:${SANS};font-size:15px;${lh(16)}font-weight:bold;color:#ffffff;text-decoration:none;">${escapeHtml(INTERESTED_LABEL)}</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td align="center" style="padding-top:16px;${text(14, 20, C.muted)}">
                  <a href="${escapeHtml(urls.pass)}" style="color:${C.muted};text-decoration:underline;">${escapeHtml(PASS_LABEL)}</a>
                </td>
              </tr>
              <tr>
                <td align="center" style="padding-top:14px;${text(13, 20, C.muted)}">${escapeHtml(next.trim())}</td>
              </tr>
            </table>
          </td>
        </tr>`;
}

function rule(): string {
  return `
        <tr>
          <td class="px" style="padding:31px 40px 0 40px;"><table ${T} width="100%" style="border-top:1px solid ${C.hairline};"><tr><td style="height:27px;line-height:27px;font-size:0;">&nbsp;</td></tr></table></td>
        </tr>`;
}

function signature(sender: OutreachEmailInput["sender"], assets: OutreachEmailAssets): string {
  const lines = [sender.title?.trim() || null, ORG_NAME].filter(Boolean).map((l) => escapeHtml(l as string)).join("<br />");
  return `
        <tr>
          <td class="px" style="padding:30px 40px 0 40px;">
            <table ${T} width="100%" style="border-top:1px solid ${C.hairline};">
              <tr>
                <td style="padding-top:23px;">
                  <table ${T}>
                    <tr>
                      <td valign="top" width="76" style="width:76px;padding-right:20px;"><img src="${escapeHtml(assets.ocr)}" width="76" height="76" alt="${escapeHtml(ORG_NAME)}" style="display:block;width:76px;height:76px;border:0;" /></td>
                      <td valign="top">
                        <table ${T}>
                          <tr><td style="${text(15, 21, C.navy, "font-weight:bold;")}">${escapeHtml(sender.name)}</td></tr>
                          <tr><td style="padding-top:4px;${text(14, 22, C.soft)}">${lines}</td></tr>${
                            sender.email
                              ? `
                          <tr><td style="padding-top:7px;${text(14, 20, C.teal)}"><a href="mailto:${escapeHtml(sender.email)}" style="color:${C.teal};text-decoration:underline;">${escapeHtml(sender.email)}</a></td></tr>`
                              : ""
                          }
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>`;
}

/** The full document, ready for `sendTransactionalTextEmail({ html })` or an <iframe srcDoc>. */
export function renderOutreachEmail(input: OutreachEmailInput): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${escapeHtml(input.subject)}</title>
<style>
  @media only screen and (max-width:620px){
    .px{padding-left:22px!important;padding-right:22px!important}
    .h1{font-size:18px!important;line-height:1.3!important}
    .btn{width:100%!important}
    .btn a{display:block!important;text-align:center!important}
    .stack{display:block!important;width:100%!important;padding-right:0!important}
    .stack td{padding-bottom:14px!important}
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${C.canvas};">
<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">${escapeHtml(input.preheader.slice(0, 140))}</span>

<table ${T} width="100%" style="background-color:${C.canvas};">
  <tr>
    <td align="center" style="padding:28px 12px;">

      <table ${T} width="600" style="width:100%;max-width:600px;background-color:${C.card};border-radius:4px;">
${header(input.assets)}

        <tr>
          <td class="px" style="padding:27px 40px 0 40px;${text(16, 27, C.ink)}">${escapeHtml(input.greeting.trim())}</td>
        </tr>
        <tr>
          <td class="px" style="padding:12px 40px 0 40px;${text(16, 27, C.ink)}">${paragraphs(input.relevant)}</td>
        </tr>
${noticeCard(input.card)}
${ask(input.urls, input.next)}
${rule()}
        <tr>
          <td class="px" style="padding:0 40px 0 40px;${eyebrow(C.muted, "1.2px")}">Why you</td>
        </tr>
        <tr>
          <td class="px" style="padding:11px 40px 0 40px;${text(16, 27, C.ink)}">${paragraphs(input.whyYou)}</td>
        </tr>${
          input.know?.trim()
            ? `
        <tr>
          <td class="px" style="padding:15px 40px 0 40px;${text(15, 26, C.soft)}">${paragraphs(input.know)}</td>
        </tr>`
            : ""
        }
${signature(input.sender, input.assets)}

        <tr>
          <td class="px" style="padding:26px 40px 28px 40px;${text(11, 18, C.muted)}">${escapeHtml(footerNote(input.sender.name, input.community))}</td>
        </tr>

      </table>

      <table ${T} width="600" style="width:100%;max-width:600px;">
        <tr>
          <td align="center" style="padding:16px 24px 0 24px;${text(11, 18, C.muted)}">${escapeHtml(ORG_ADDRESS)}</td>
        </tr>
      </table>

    </td>
  </tr>
</table>
</body>
</html>`;
}
