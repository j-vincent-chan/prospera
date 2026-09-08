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
import { decodeEntityReferences } from "@/lib/formatting/html-entities";

/** A single extracted line: text with its leading indent measured, trailing space removed. */
export type TextLine = string;

const BLOCK_TAGS = "address|article|aside|blockquote|br|div|dd|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul";

/**
 * What a reference means *in announcement text*, where the shared table's answer
 * is not the one this pipeline wants. Everything else — `&sect;`, `&reg;`,
 * `&deg;`, `&trade;`, the Greek letters, the arrows — comes from
 * `HTML_ENTITIES` and needs no row here.
 *
 * All thirteen names this module used to know keep the character they had —
 * including the case-insensitive `&NBSP;` its `gi` flags allowed — so a page
 * that decoded cleanly before decodes identically now and its
 * `announcementTextHash` does not move. Only a page carrying a reference that
 * used to survive verbatim gets a new hash.
 */
const ANNOUNCEMENT_ENTITIES: Readonly<Record<string, string>> = {
  // Space-like references become a plain space, so `normalizeLines` collapses
  // runs of them the way it collapses ordinary indentation.
  nbsp: " ", ensp: " ", emsp: " ", thinsp: " ",
  // Invisible references are dropped rather than decoded. `inter&shy;disciplinary`
  // is one word with a hint about where it may be broken; decoded to U+00AD the
  // hint becomes a character sitting inside the word, and every reader after this
  // one — the heading tables matching a line, the sectioner, the extractor — sees
  // a word that is not in its vocabulary. Nothing is lost by dropping them: they
  // render as nothing.
  shy: "", zwj: "", zwnj: "", lrm: "", rlm: "",
  // Curly quotes fold to ASCII, which is what this module has always done with
  // `&rsquo;` and `&ldquo;`. This text is an extractor's input, not a page, and a
  // quote a pattern can match is worth more here than a typographically right one.
  lsquo: "'", rsquo: "'", sbquo: "'", ldquo: '"', rdquo: '"', bdquo: '"',
};

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
  return normalizeLines(decodeEntityReferences(stripped, ANNOUNCEMENT_ENTITIES)).filter((l) => l !== "");
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

/** A PDF that parsed but yielded no usable text — a scan, or an all-image announcement. */
export class EmptyPdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmptyPdfError";
  }
}

/** True when the bytes start with the `%PDF-` signature, whatever the server claimed the type was. */
export function isPdfBytes(data: ArrayBuffer | Uint8Array): boolean {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  // 0x25 '%', 0x50 'P', 0x44 'D', 0x46 'F', 0x2d '-'
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

/**
 * PDF → lines, preserving line structure (PR 5.3; D66 = `unpdf`).
 *
 * `unpdf` is the serverless build of Mozilla's pdf.js. It is chosen because the
 * line structure this module exists to protect is exactly what pdf.js's
 * `hasEOL` flag carries: `extractText` emits `item.str + (item.hasEOL ? "\n" : "")`,
 * so a CDMRP "3. Program Description" or an HRSA "Program description" arrives
 * as its own line and a heading table can match it. Measured against
 * `pdfjs-dist` directly the output is byte-identical (it is the same engine),
 * and `pdf-parse` agrees on the headings but is an unmaintained 2018 fork that
 * reads a bundled test PDF at import time. `unpdf` is also already a dependency
 * — `institution/library.ts` uses it for uploaded documents — so this PR adds
 * no install weight, no worker file and no new licence. Evidence is in the PR
 * 5.3 report; the row belongs in `DECISIONS.md`.
 *
 * The import is dynamic so that a module graph that merely mentions PDFs does
 * not pull ~2.5 MB of pdf.js into a page bundle, matching `library.ts`.
 *
 * Throwing rather than returning `[]` is deliberate and unchanged from PR 5.2:
 * an empty result is indistinguishable from a PDF with no extractable text, and
 * a caller would store the notice as "read, nothing in it". A scanned PDF
 * throws `EmptyPdfError`, which the adapter turns into `guide_fetch_status =
 * 'error'` — never into a partial set of sections.
 */
export async function pdfToLines(data: ArrayBuffer | Uint8Array): Promise<TextLine[]> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength === 0) throw new EmptyPdfError("pdfToLines: empty buffer");
  const { extractText, getDocumentProxy } = await import("unpdf");
  // Copy before handing the bytes to pdf.js: it takes ownership and detaches
  // the caller's buffer, so `data.byteLength` would silently become 0 and any
  // later `isPdfBytes(data)` or second parse would report an empty document.
  // `institution/library.ts:268` copies for the same reason.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  const lines = normalizeLines(String(text ?? ""));
  if (lines.every((l) => l === "")) {
    throw new EmptyPdfError("pdfToLines: the PDF parsed but carries no extractable text (a scan, or image-only)");
  }
  return lines;
}
