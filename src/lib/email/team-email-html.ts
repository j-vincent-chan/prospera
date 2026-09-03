/**
 * HTML layout for Prospera's transactional email, in the Share Brief grammar:
 * canvas background, a bordered white card with a sender row, a tinted band
 * for the subject (team, opportunity), a navy button, muted footer.
 *
 * Email clients ignore stylesheets and web fonts, so everything is inline,
 * table-based, and falls back to the system sans. Keep it 600px wide.
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
  return parts
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("") || "?";
}

export function fmtLongDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function fmtShortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type Brand = { siteUrl: string };

function brandLockup({ siteUrl }: Brand): string {
  // Mail clients can't fetch localhost assets; fall back to a text wordmark in dev.
  if (/localhost|127\.0\.0\.1/.test(siteUrl)) {
    return `<span style="font-family:${EMAIL.font};font-size:18px;font-weight:600;color:${EMAIL.navy};letter-spacing:-0.01em">Prospera</span>`;
  }
  return `<img src="${siteUrl}/brand/prospera-app-icon.png" width="24" height="26" alt="" style="display:inline-block;vertical-align:middle;border:0;height:26px;width:auto;margin-right:8px"><img src="${siteUrl}/brand/prospera-wordmark.png" width="92" height="19" alt="Prospera" style="display:inline-block;vertical-align:middle;border:0;height:19px;width:auto">`;
}

/** Sender / requester row: initials avatar, name, muted meta line. */
export function personRow(input: { name: string; meta: string }): string {
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%">
  <tr>
    <td width="36" valign="middle" style="padding:0 12px 0 0">
      <div style="width:36px;height:36px;border-radius:18px;background:${EMAIL.tealTint};color:${EMAIL.teal};font-family:${EMAIL.font};font-size:12px;font-weight:600;line-height:36px;text-align:center">${escapeHtml(initials(input.name))}</div>
    </td>
    <td valign="middle" style="font-family:${EMAIL.font}">
      <div style="font-size:14px;font-weight:600;color:${EMAIL.ink};line-height:1.3">${escapeHtml(input.name)}</div>
      <div style="font-size:12px;color:${EMAIL.muted};line-height:1.4;margin-top:2px">${escapeHtml(input.meta)}</div>
    </td>
  </tr>
</table>`;
}

export function paragraph(text: string, opts: { muted?: boolean; size?: number } = {}): string {
  return `<p style="margin:0;font-family:${EMAIL.font};font-size:${opts.size ?? 15}px;line-height:1.6;color:${opts.muted ? EMAIL.muted : EMAIL.ink}">${text}</p>`;
}

export function label(text: string, color: string = EMAIL.muted): string {
  return `<div style="font-family:${EMAIL.font};font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${color}">${escapeHtml(text)}</div>`;
}

export function quote(text: string): string {
  return `<div style="margin:12px 0 0;padding:10px 14px;border-left:2px solid #cbd5e1;background:${EMAIL.canvas};font-family:${EMAIL.font};font-size:14px;line-height:1.55;color:#334155">&ldquo;${escapeHtml(text)}&rdquo;</div>`;
}

export function button(input: { href: string; label: string; secondary?: boolean }): string {
  const bg = input.secondary ? EMAIL.card : EMAIL.navy;
  const fg = input.secondary ? EMAIL.ink : "#ffffff";
  const border = input.secondary ? "#cbd5e1" : EMAIL.navy;
  return `<a href="${input.href}" style="display:inline-block;box-sizing:border-box;height:44px;line-height:42px;padding:0 20px;border-radius:6px;border:1px solid ${border};background:${bg};color:${fg};font-family:${EMAIL.font};font-size:14px;font-weight:500;text-decoration:none;text-align:center">${escapeHtml(input.label)}</a>`;
}

/** Tinted band with an uppercase label, a title and an optional subtitle. */
export function band(input: { label: string; title: string; subtitle?: string; extra?: string }): string {
  return `
<tr>
  <td style="padding:20px 24px;background:${EMAIL.canvas};border-top:1px solid ${EMAIL.border};border-bottom:1px solid ${EMAIL.border}">
    ${label(input.label)}
    <div style="margin-top:8px;font-family:${EMAIL.font};font-size:18px;font-weight:600;line-height:1.3;letter-spacing:-0.01em;color:${EMAIL.ink}">${escapeHtml(input.title)}</div>
    ${input.subtitle ? `<div style="margin-top:4px;font-family:${EMAIL.font};font-size:13px;line-height:1.5;color:${EMAIL.muted}">${escapeHtml(input.subtitle)}</div>` : ""}
    ${input.extra ?? ""}
  </td>
</tr>`;
}

/** A plain card section (24px padding). Pass pre-rendered inner HTML. */
export function section(inner: string, opts: { hairline?: boolean } = {}): string {
  return `
<tr>
  <td style="padding:20px 24px;${opts.hairline ? `border-top:1px solid ${EMAIL.hairline};` : ""}">${inner}</td>
</tr>`;
}

/** Full document. `rows` are already-rendered <tr> blocks for the card. */
export function renderEmail(input: {
  siteUrl: string;
  /** Hidden preview line shown by mail clients next to the subject. */
  preheader: string;
  /** Right side of the header, e.g. "Invitation · expires Oct 3". */
  headerMeta: string;
  rows: string[];
  footerNote?: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Prospera</title>
</head>
<body style="margin:0;padding:0;background:${EMAIL.canvas}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(input.preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${EMAIL.canvas}">
  <tr>
    <td align="center" style="padding:24px 16px 40px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%">
        <tr>
          <td style="padding:0 4px 14px">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td valign="middle" style="font-family:${EMAIL.font}">${brandLockup({ siteUrl: input.siteUrl })}</td>
                <td valign="middle" align="right" style="font-family:${EMAIL.font};font-size:12px;color:${EMAIL.muted}">${escapeHtml(input.headerMeta)}</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${EMAIL.card};border:1px solid ${EMAIL.border};border-radius:10px;overflow:hidden">
              ${input.rows.join("\n")}
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:16px 8px 0;font-family:${EMAIL.font};font-size:12px;line-height:1.5;color:${EMAIL.muted}">
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
