import { readFileSync } from "fs";
import path from "path";

/**
 * HTML layout for Prospera's transactional email, in the Share Brief grammar:
 * canvas background, a bordered white card with a sender row, a tinted band
 * for the subject (team, opportunity), a navy button, muted footer.
 *
 * Email clients ignore stylesheets and web fonts, so everything is inline,
 * table-based, and falls back to the system sans. Keep it 600px wide.
 *
 * Dark mode: colours are set inline for the light scheme and overridden by
 * class under `prefers-color-scheme: dark` (Apple Mail, iOS Mail, Outlook)
 * and `[data-ogsc]` (Outlook.com). The brand icon ships as an inline
 * attachment (cid:) so it renders without remote-image permission, and the
 * wordmark is text so it recolours with the scheme.
 */

export const EMAIL = {
  canvas: "#f7f8fa",
  card: "#ffffff",
  border: "#e2e8f0",
  hairline: "#f1f5f9",
  navy: "#0b1d3a",
  teal: "#0e6b78",
  tealTint: "#e3f4f6",
  ink: "#0b1d3a",
  body: "#475569",
  muted: "#64748b",
  font: "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
} as const;

const DARK = {
  canvas: "#0b1526",
  card: "#132238",
  border: "#27395a",
  hairline: "#1d2f4b",
  band: "#0f1c30",
  ink: "#e8edf5",
  body: "#b8c4d6",
  muted: "#8fa0b8",
  teal: "#5fc2cc",
  tealTint: "#173a45",
  quote: "#0f1c30",
  buttonBg: "#e8edf5",
  buttonFg: "#0b1d3a",
} as const;

export const BRAND_ICON_CID = "prospera-icon";

/** Inline attachment for the brand icon (referenced as cid:prospera-icon). */
export function brandAttachments(): Array<{ filename: string; content: string; content_id: string }> {
  try {
    const file = path.join(process.cwd(), "public", "brand", "prospera-app-icon.png");
    return [{ filename: "prospera-app-icon.png", content: readFileSync(file).toString("base64"), content_id: BRAND_ICON_CID }];
  } catch {
    return [];
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    parts
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join("") || "?"
  );
}

export function fmtLongDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function fmtShortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function brandLockup(iconSrc: string): string {
  return `<img src="${iconSrc}" width="24" height="26" alt="" style="display:inline-block;vertical-align:middle;border:0;height:26px;width:auto;margin-right:8px"><span class="em-ink" style="display:inline-block;vertical-align:middle;font-family:${EMAIL.font};font-size:18px;font-weight:600;color:${EMAIL.navy};letter-spacing:-0.01em">Prospera</span>`;
}

/** Sender / requester row: initials avatar, name, muted meta line. */
export function personRow(input: { name: string; meta: string }): string {
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%">
  <tr>
    <td width="36" valign="middle" style="padding:0 12px 0 0">
      <div class="em-avatar" style="width:36px;height:36px;border-radius:18px;background:${EMAIL.tealTint};color:${EMAIL.teal};font-family:${EMAIL.font};font-size:12px;font-weight:600;line-height:36px;text-align:center">${escapeHtml(initials(input.name))}</div>
    </td>
    <td valign="middle" style="font-family:${EMAIL.font}">
      <div class="em-ink" style="font-size:14px;font-weight:600;color:${EMAIL.ink};line-height:1.3">${escapeHtml(input.name)}</div>
      <div class="em-muted" style="font-size:12px;color:${EMAIL.muted};line-height:1.4;margin-top:2px">${escapeHtml(input.meta)}</div>
    </td>
  </tr>
</table>`;
}

export function paragraph(text: string, opts: { muted?: boolean; size?: number } = {}): string {
  const cls = opts.muted ? "em-muted" : "em-ink";
  const color = opts.muted ? EMAIL.muted : EMAIL.ink;
  return `<p class="${cls}" style="margin:0;font-family:${EMAIL.font};font-size:${opts.size ?? 15}px;line-height:1.6;color:${color}">${text}</p>`;
}

export function label(text: string): string {
  return `<div class="em-muted" style="font-family:${EMAIL.font};font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${EMAIL.muted}">${escapeHtml(text)}</div>`;
}

export function quote(text: string): string {
  return `<div class="em-quote" style="margin:12px 0 0;padding:10px 14px;border-left:2px solid #cbd5e1;background:${EMAIL.canvas};font-family:${EMAIL.font};font-size:14px;line-height:1.55;color:#334155">&ldquo;${escapeHtml(text)}&rdquo;</div>`;
}

export function button(input: { href: string; label: string; secondary?: boolean }): string {
  const bg = input.secondary ? EMAIL.card : EMAIL.navy;
  const fg = input.secondary ? EMAIL.ink : "#ffffff";
  const border = input.secondary ? "#cbd5e1" : EMAIL.navy;
  const cls = input.secondary ? "em-btn-secondary" : "em-btn";
  return `<a class="${cls}" href="${input.href}" style="display:inline-block;box-sizing:border-box;height:44px;line-height:42px;padding:0 20px;border-radius:6px;border:1px solid ${border};background:${bg};color:${fg};font-family:${EMAIL.font};font-size:14px;font-weight:500;text-decoration:none;text-align:center">${escapeHtml(input.label)}</a>`;
}

/** Tinted band with an uppercase label, a title and an optional subtitle. */
export function band(input: { label: string; title: string; subtitle?: string; extra?: string }): string {
  return `
<tr>
  <td class="em-band" style="padding:20px 24px;background:${EMAIL.canvas};border-top:1px solid ${EMAIL.border};border-bottom:1px solid ${EMAIL.border}">
    ${label(input.label)}
    <div class="em-ink" style="margin-top:8px;font-family:${EMAIL.font};font-size:18px;font-weight:600;line-height:1.3;letter-spacing:-0.01em;color:${EMAIL.ink}">${escapeHtml(input.title)}</div>
    ${input.subtitle ? `<div class="em-muted" style="margin-top:4px;font-family:${EMAIL.font};font-size:13px;line-height:1.5;color:${EMAIL.muted}">${escapeHtml(input.subtitle)}</div>` : ""}
    ${input.extra ?? ""}
  </td>
</tr>`;
}

/** A plain card section (24px padding). Pass pre-rendered inner HTML. */
export function section(inner: string, opts: { hairline?: boolean } = {}): string {
  return `
<tr>
  <td class="${opts.hairline ? "em-hairline" : ""}" style="padding:20px 24px;${opts.hairline ? `border-top:1px solid ${EMAIL.hairline};` : ""}">${inner}</td>
</tr>`;
}

const DARK_STYLES = `
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (prefers-color-scheme: dark) {
    .em-bg { background: ${DARK.canvas} !important; }
    .em-card { background: ${DARK.card} !important; border-color: ${DARK.border} !important; }
    .em-band { background: ${DARK.band} !important; border-color: ${DARK.border} !important; }
    .em-hairline { border-color: ${DARK.hairline} !important; }
    .em-ink { color: ${DARK.ink} !important; }
    .em-body { color: ${DARK.body} !important; }
    .em-muted { color: ${DARK.muted} !important; }
    .em-avatar { background: ${DARK.tealTint} !important; color: ${DARK.teal} !important; }
    .em-quote { background: ${DARK.quote} !important; color: ${DARK.body} !important; border-color: ${DARK.border} !important; }
    .em-btn { background: ${DARK.buttonBg} !important; border-color: ${DARK.buttonBg} !important; color: ${DARK.buttonFg} !important; }
    .em-btn-secondary { background: ${DARK.card} !important; border-color: ${DARK.border} !important; color: ${DARK.ink} !important; }
    .em-link { color: ${DARK.teal} !important; }
  }
  [data-ogsc] .em-bg { background: ${DARK.canvas} !important; }
  [data-ogsc] .em-card { background: ${DARK.card} !important; border-color: ${DARK.border} !important; }
  [data-ogsc] .em-band { background: ${DARK.band} !important; border-color: ${DARK.border} !important; }
  [data-ogsc] .em-ink { color: ${DARK.ink} !important; }
  [data-ogsc] .em-body { color: ${DARK.body} !important; }
  [data-ogsc] .em-muted { color: ${DARK.muted} !important; }
  [data-ogsc] .em-btn { background: ${DARK.buttonBg} !important; border-color: ${DARK.buttonBg} !important; color: ${DARK.buttonFg} !important; }
`;

/** Full document. `rows` are already-rendered <tr> blocks for the card. */
export function renderEmail(input: {
  /** Kept for callers; assets now travel inline, so this only informs nothing visual. */
  siteUrl?: string;
  /** Hidden preview line shown by mail clients next to the subject. */
  preheader: string;
  /** Right side of the header, e.g. "Invitation · expires Oct 3". */
  headerMeta: string;
  rows: string[];
  footerNote?: string;
  /** Override the icon source (previews use a data: URI; email uses cid:). */
  iconSrc?: string;
}): string {
  const iconSrc = input.iconSrc ?? `cid:${BRAND_ICON_CID}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>Prospera</title>
<style>${DARK_STYLES}</style>
</head>
<body class="em-bg" style="margin:0;padding:0;background:${EMAIL.canvas}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(input.preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="em-bg" style="background:${EMAIL.canvas}">
  <tr>
    <td align="center" style="padding:24px 16px 40px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%">
        <tr>
          <td style="padding:0 4px 14px">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td valign="middle" style="font-family:${EMAIL.font}">${brandLockup(iconSrc)}</td>
                <td valign="middle" align="right" class="em-muted" style="font-family:${EMAIL.font};font-size:12px;color:${EMAIL.muted}">${escapeHtml(input.headerMeta)}</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="em-card" style="background:${EMAIL.card};border:1px solid ${EMAIL.border};border-radius:10px;overflow:hidden">
              ${input.rows.join("\n")}
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" class="em-muted" style="padding:16px 8px 0;font-family:${EMAIL.font};font-size:12px;line-height:1.5;color:${EMAIL.muted}">
            Prospera &middot; Office of Collaborative Research, UCSF${input.footerNote ? ` &middot; ${input.footerNote}` : ""}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
