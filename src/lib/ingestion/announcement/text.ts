/**
 * Announcement text extraction (PR 5.2).
 *
 * The one rule: **line structure survives**. `nih-guide/parse.ts` collapses all
 * whitespace with `\s+ → " "` before it looks at anything, which is safe there
 * because the Guide's markup carries the structure in tags. Every other source
 * carries it in the line breaks — an NSF solicitation's `II. PROGRAM
 * DESCRIPTION` and a CDMRP Program Announcement's block headings are found by
 * matching a *line*, so collapsing first would destroy the headings before a
 * sectioner ever saw them. That helper must not be reused here, and this module
 * exists so nobody has to remember why.
 */

/** A single extracted line: text with its leading indent measured, trailing space removed. */
export type TextLine = string;

const BLOCK_TAGS = "address|article|aside|blockquote|br|div|dd|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul";

const ENTITIES: Array<[RegExp, string]> = [
  [/&nbsp;/gi, " "],
  [/&amp;/gi, "&"],
  [/&lt;/gi, "<"],
  [/&gt;/gi, ">"],
  [/&quot;/gi, '"'],
  [/&#0?39;|&apos;|&rsquo;/gi, "'"],
  [/&lsquo;/gi, "'"],
  [/&ldquo;|&rdquo;/gi, '"'],
  [/&mdash;/gi, "—"],
  [/&ndash;/gi, "–"],
  [/&hellip;/gi, "…"],
];

function decodeEntities(s: string): string {
  let out = s;
  for (const [re, to] of ENTITIES) out = out.replace(re, to);
  return out.replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-f]+);/gi, (_, hx: string) => String.fromCodePoint(parseInt(hx, 16)));
}

/**
 * HTML → lines. Script, style and comments are dropped; every block-level tag
 * becomes a line break; inline tags are removed without joining words together;
 * entities are decoded. Blank lines are dropped (they are tag artifacts) and
 * each line has its inner whitespace collapsed — **within** the line only.
 */
export function htmlToLines(html: string): TextLine[] {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(new RegExp(`<(?:${BLOCK_TAGS})\\b[^>]*>`, "gi"), "\n")
    .replace(new RegExp(`</(?:${BLOCK_TAGS})\\s*>`, "gi"), "\n")
    .replace(/<[^>]+>/g, " ");
  // Blank lines here are artifacts: an open tag and its close each produce one,
  // so adjacent blocks would be separated by an empty line that means nothing.
  // HTML carries its structure in the tags, so every block is already its own
  // line — which is also how `guide_sections` has always stored Guide text.
  // (In plain text a blank line *is* the paragraph separator, so `textToLines`
  // keeps them.)
  return normalizeLines(decodeEntities(stripped)).filter((l) => l !== "");
}

/** Plain text → lines, with the same normalisation, for a source that is already text. */
export function textToLines(text: string): TextLine[] {
  return normalizeLines(text);
}

/** Collapse whitespace inside each line, drop empties at the edges, and never allow two blank lines in a row. */
export function normalizeLines(text: string): TextLine[] {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[^\S\n]+/g, " ").trim());
  const out: TextLine[] = [];
  for (const line of lines) {
    if (!line && (out.length === 0 || out[out.length - 1] === "")) continue;
    out.push(line);
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out;
}

/** The lines joined back into the text a section stores: one line per paragraph, as `guide_sections` already holds. */
export function linesToText(lines: readonly TextLine[]): string {
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotImplementedError";
  }
}

/**
 * PDF → lines, preserving line structure.
 *
 * **Not implemented: D66 (which PDF library) is open.** PR 5.0 removed NSF from
 * its scope — every NSF solicitation is reachable as HTML — but the Grants.gov
 * attachments (PR 5.3) and the CDMRP Program Announcements (PR 5.5) are PDFs,
 * so the decision is still live and belongs to a person. Whichever library is
 * chosen must preserve line breaks and run inside the Vercel function limit.
 *
 * Throwing here rather than returning `[]` is deliberate: an empty result would
 * be indistinguishable from a PDF with no extractable text, and a caller would
 * store a notice as "read, nothing in it".
 */
export function pdfToLines(_buffer: ArrayBuffer | Uint8Array): TextLine[] {
  throw new NotImplementedError(
    "pdfToLines: D66 (PDF extraction library) is still open — see docs/fit-engine/DECISIONS.md. " +
      "PR 5.3 is the first PR that needs it; no adapter registered in PR 5.2 reads a PDF.",
  );
}
