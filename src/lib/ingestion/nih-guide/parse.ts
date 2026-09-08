import { createHash } from "node:crypto";
import type { CycleKind, ReceiptCycle } from "@/lib/funding-opportunities/receipt-cycles";
import { withRoles, type SectionRole } from "@/lib/fit/profile/section-roles";

/**
 * Parser for the NIH Guide notice page (Key Dates section and header facts),
 * plus — PR 0.5 — the sectioned full text, the clinical-trial designation and
 * the scientific contact's division.
 *
 * Markup, as served in 2025-26 (the same template on grants.nih.gov and on the
 * `<number>-Full-Announcement.html` attachments Simpler.Grants.gov hosts):
 *   <div class="row"><div class="col-md-4 datalabel" data-section-code="KD">Posted Date</div>
 *                    <div class="col-md-8 datacolumn">September 24, 2024</div></div>
 * and one table whose first row reads "Application Due Dates | Review and Award Cycles"
 * with columns New | Renewal/Resubmission/Revision | AIDS | Scientific Merit Review |
 * Advisory Council Review | Earliest Start Date. "Standard dates apply" notices are
 * rendered expanded by NIH, so no local standard-date table is needed.
 *
 * Part 2 is <h1>Part 2. Full Text of Announcement</h1> followed by
 * <h2>Section I. …</h2> … <h2>Section VIII. …</h2>; sub-headings inside a
 * section are <h4>, <div class="heading4"> or a paragraph that is only bold
 * text. A few notices (PAR-27-026, PA-27-034/035/036, RFA-DK-26-308) are served
 * as a plain text stream with no headings at all; those fall back to the known
 * heading phrases and get section-level text without sub-headings.
 */

export type ParsedRelatedNotice = { date: string | null; text: string; number: string | null };

export type ParsedGuide = {
  title: string | null;
  /** The Guide prefixes titles of expired notices with "Expired". */
  expired: boolean;
  activityCode: string | null;
  activityTitle: string | null;
  postedDate: string | null;
  openDate: string | null;
  loiDue: string | null;
  loiNote: string | null;
  cycles: ReceiptCycle[];
  standardDatesApply: boolean;
  expirationDate: string | null;
  originalExpirationDate: string | null;
  earliestStart: string | null;
  reissueOf: string | null;
  companionOf: string | null;
  clinicalTrial: "required" | "optional" | "not_allowed" | null;
  clinicalTrialNote: string | null;
  relatedNotices: ParsedRelatedNotice[];
  /** e.g. "Dates in bold and italics reflect changes per NOT-NS-26-005" */
  lastChangeNote: string | null;
};

/** One block of the notice's full text. `section` is "overview" (Part 1) or a roman numeral, optionally with a numbered item ("III.3", "IV.2"). */
export type GuideSection = {
  part: 1 | 2;
  section: string;
  /** Heading text verbatim (entities decoded, whitespace collapsed). */
  heading: string;
  /** Plain text, one line per paragraph / list item / <br>. */
  text: string;
  /**
   * What the block is for (PR 5.1), so the extractor can route on the role
   * rather than on the NIH numbering. Derived here from `section` and
   * `heading`; `withRoles()` derives the same values for rows stored before
   * 5.1, so a backfill is not needed.
   */
  roles: SectionRole[];
};

/** A section as the two parsers build it, before `withRoles` stamps its roles. */
type RawGuideSection = Omit<GuideSection, "roles">;

export type ClinicalTrialDesignation = "required" | "optional" | "not_allowed" | "besh_required" | "unknown";

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"',
  ndash: "–", mdash: "—", hellip: "…", bull: "•", middot: "·", copy: "©", reg: "®", trade: "™",
  deg: "°", plusmn: "±", times: "×", sect: "§", para: "¶", frac12: "½", micro: "µ", eacute: "é",
};
/** Windows-1252 code points the Guide emits as numeric references (&#147; … &#151;). */
const CP1252: Record<number, string> = { 133: "…", 145: "'", 146: "'", 147: '"', 148: '"', 149: "•", 150: "–", 151: "—" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (_m, body: string) => {
    if (body[0] === "#") {
      const cp = body[1]?.toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(cp) || cp === 160) return " ";
      const win = CP1252[cp];
      if (win) return win;
      try {
        return String.fromCodePoint(cp);
      } catch {
        return " ";
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? " ";
  });
}

/** Inline tags are removed without a separator so "(<a>NIAID</a>)" stays "(NIAID)"; every other tag becomes a space. */
const INLINE_TAG = /<\/?(?:a|span|strong|b|i|em|u|sup|sub|font|small|abbr|cite|q|mark|s|del|ins)\b[^>]*>/gi;

/** Strip tags → single-spaced text. */
export function text(html: string): string {
  return decode(html.replace(/<br\s*\/?>/gi, " ").replace(INLINE_TAG, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** "June 02, 2025 *" → "2025-06-02"; "Not Applicable" → null. */
export function parseGuideDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = value.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (!m) return null;
  const month = MONTHS[m[1]!.toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${String(month).padStart(2, "0")}-${String(Number(m[2])).padStart(2, "0")}`;
}

/** "July 2026" → "July 2026" (kept as printed); "Not Applicable" → null. */
function monthYear(value: string): string | null {
  const m = value.match(/([A-Za-z]{3,9})\s+(\d{4})/);
  return m ? `${m[1]} ${m[2]}` : null;
}

/** Value text for a Key Dates / header label rendered as datalabel + datacolumn. */
function labelValue(html: string, label: RegExp): string | null {
  // Label and value divs may span lines and carry bookmark anchors; match across newlines.
  const re = new RegExp(
    `<div[^>]*class="[^"]*datalabel[^"]*"[^>]*>(?:(?!</div>)[\\s\\S])*?${label.source}(?:(?!</div>)[\\s\\S])*?</div>\\s*<div[^>]*class="[^"]*datacolumn[^"]*"[^>]*>([\\s\\S]*?)</div>`,
    "i",
  );
  const m = html.match(re);
  return m ? text(m[1]!) : null;
}

function parseCyclesTable(html: string): { cycles: ReceiptCycle[]; earliestStart: string | null } {
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  const table = tables.find((t) => /Application Due Date/i.test(t) && /Review and Award/i.test(t));
  if (!table) return { cycles: [], earliestStart: null };

  const rows = (table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []).map((r) =>
    (r.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? []).map((c) => text(c)),
  );
  // Header row is the one containing "New" and "Earliest Start".
  const headerIdx = rows.findIndex((r) => r.some((c) => /^New$/i.test(c)) && r.some((c) => /Earliest Start/i.test(c)));
  if (headerIdx < 0) return { cycles: [], earliestStart: null };
  const header = rows[headerIdx]!;
  const col = (re: RegExp) => header.findIndex((c) => re.test(c));
  const iNew = col(/^New$/i);
  const iRenewal = col(/Renewal/i);
  const iAids = col(/AIDS/i);
  const iReview = col(/Scientific Merit/i);
  const iCouncil = col(/Advisory Council/i);
  const iStart = col(/Earliest Start/i);

  const cycles: ReceiptCycle[] = [];
  let earliestStart: string | null = null;
  for (const r of rows.slice(headerIdx + 1)) {
    if (r.length < 2) continue;
    const review = iReview >= 0 ? monthYear(r[iReview] ?? "") : null;
    const council = iCouncil >= 0 ? monthYear(r[iCouncil] ?? "") : null;
    const start = iStart >= 0 ? monthYear(r[iStart] ?? "") : null;
    if (!earliestStart && start) earliestStart = start;
    const push = (idx: number, kind: CycleKind) => {
      if (idx < 0) return;
      const due = parseGuideDate(r[idx]);
      if (due) cycles.push({ due, kind, review, council, start });
    };
    push(iNew, "new");
    push(iRenewal, "renewal");
    push(iAids, "aids");
  }
  // Dedupe identical (due, kind) pairs.
  const seen = new Set<string>();
  const unique = cycles.filter((c) => {
    const k = `${c.due}:${c.kind}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  unique.sort((a, b) => a.due.localeCompare(b.due) || a.kind.localeCompare(b.kind));
  return { cycles: unique, earliestStart };
}

function parseRelatedNotices(html: string): ParsedRelatedNotice[] {
  const block = labelValue(html, /Related Notices/) ?? "";
  if (!block) return [];
  const out: ParsedRelatedNotice[] = [];
  // Entries read "February 13, 2026 - Notice of Change ... See Notice NOT-NS-26-005."
  const re = /([A-Z][a-z]+ \d{1,2}, \d{4})\s*-\s*([^]*?)(?=(?:[A-Z][a-z]+ \d{1,2}, \d{4}\s*-\s*)|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) && out.length < 20) {
    const body = m[2]!.trim();
    const num = body.match(/\bNOT-[A-Z]{2}-\d{2}-\d{3}\b/)?.[0] ?? null;
    out.push({ date: parseGuideDate(m[1]), text: body.slice(0, 300), number: num });
  }
  return out;
}

/**
 * A Guide number with the IC segment optional: RFA-CA-24-018, PAR-22-181, PA-25-305, PAS-27-028.
 * (Until PR 0.5 the reissue regex demanded the IC segment, so "Reissue of PAR-xx-xxx" was never captured.)
 */
const NOTICE_NUMBER = "[A-Z]{2,3}-(?:[A-Z]{2}-)?\\d{2}-\\d{3}";

export function parseNihGuide(html: string): ParsedGuide {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const rawTitle = titleMatch ? text(titleMatch[1]!).replace(/\s*-\s*NIH.*$/i, "").trim() : "";
  const expired = /^Expired\b/i.test(rawTitle);
  const title = rawTitle.replace(/^Expired\s+/i, "").trim() || null;

  const activity = labelValue(html, /Activity Code/) ?? "";
  const activityMatch = activity.match(/^([A-Z]{1,3}\d{1,3}[A-Z]?)\s*(.*)$/);
  const activityCode = activityMatch ? activityMatch[1]! : activity ? activity.split(/\s+/)[0]! : null;
  const activityTitle = activityMatch ? activityMatch[2]!.trim() || null : null;

  const postedDate = parseGuideDate(labelValue(html, /Posted Date/));
  const openDate = parseGuideDate(labelValue(html, /Open Date/));

  const loiRaw = labelValue(html, /Letter of Intent Due Date/);
  const loiDue = parseGuideDate(loiRaw);
  const loiNote = loiRaw && !loiDue ? loiRaw.slice(0, 200) : loiRaw && /prior|before/i.test(loiRaw) ? loiRaw.slice(0, 200) : null;

  const expRaw = labelValue(html, /Expiration Date/) ?? "";
  const original = expRaw.match(/Original Expiration Date:?\s*([A-Za-z]+ \d{1,2}, \d{4})/i);
  const expirationDate = parseGuideDate(expRaw.replace(/\(Original[\s\S]*$/i, ""));

  const { cycles, earliestStart } = parseCyclesTable(html);
  const dueRaw = labelValue(html, /Application Due Date/) ?? "";
  const standardDatesApply = cycles.length === 0 && /standard dates apply/i.test(dueRaw + " " + text(html.slice(0, 200_000)).slice(0, 20_000));

  const reissue = html.match(new RegExp(`Reissue of\\s*(?:<[^>]+>\\s*)*(${NOTICE_NUMBER})`, "i"))?.[1] ?? null;
  const companionRaw = labelValue(html, /Companion Funding Opportunity/) ?? "";
  const companion = companionRaw.match(/\b(?:PA|PAR|PAS|RFA)-(?:[A-Z]{2}-)?\d{2}-\d{3}\b/)?.[0] ?? null;

  const ctRaw = labelValue(html, /Clinical Trial\?/) ?? "";
  const clinicalTrial: ParsedGuide["clinicalTrial"] = /^Required/i.test(ctRaw) ? "required" : /^Optional/i.test(ctRaw) ? "optional" : /^Not Allowed/i.test(ctRaw) ? "not_allowed" : null;

  const changeNote = text(html).match(/Dates in bold and italics reflect changes per ([A-Z]{3}-[A-Z]{2}-\d{2}-\d{3})/i);

  return {
    title,
    expired,
    activityCode,
    activityTitle,
    postedDate,
    openDate,
    loiDue,
    loiNote,
    cycles,
    standardDatesApply,
    expirationDate,
    originalExpirationDate: original ? parseGuideDate(original[1]) : null,
    earliestStart,
    reissueOf: reissue ? reissue.toUpperCase() : null,
    companionOf: companion,
    clinicalTrial,
    clinicalTrialNote: ctRaw ? ctRaw.slice(0, 240) : null,
    relatedNotices: parseRelatedNotices(html),
    lastChangeNote: changeNote ? `Key dates changed per ${changeNote[1]}` : null,
  };
}

// ---------------------------------------------------------------------------
// Sectioned full text
// ---------------------------------------------------------------------------

/** Comments, scripts and styles carry no notice text; drop them before anything else. */
function stripNoise(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "");
}

/** Block-level HTML → plain text with one line per paragraph, list item or <br>; list items get a "- " marker. */
export function blockText(fragment: string): string {
  const s = fragment
    .replace(/\r?\n|\r/g, " ") // source line breaks are not line breaks in HTML
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li\b[^>]*>/gi, "\n- ")
    .replace(/<\/\s*(?:p|div|li|ul|ol|tr|table|h[1-6]|blockquote|section|article|dd|dt|dl|pre)\s*>/gi, "\n")
    .replace(/<\s*(?:p|div|tr|table|h[1-6]|ul|ol|blockquote|section|article|dd|dt|dl|pre)\b[^>]*>/gi, "\n")
    .replace(/<\/\s*t[dh]\s*>/gi, " ")
    .replace(INLINE_TAG, "")
    .replace(/<[^>]+>/g, " ");
  const lines = decode(s)
    .split("\n")
    .map((l) => l.replace(/[ \t\u00a0\f\v]+/g, " ").trim())
    .filter(Boolean);
  // "<li><p>text</p></li>" leaves the marker alone on its line; glue it to the next one.
  const out: string[] = [];
  for (const line of lines) {
    if (line === "-") {
      out.push("-");
      continue;
    }
    if (out.length && out[out.length - 1] === "-") out[out.length - 1] = `- ${line.replace(/^-\s+/, "")}`;
    else out.push(line);
  }
  return out.filter((l) => l !== "-").join("\n");
}

/** Lines that are template boilerplate wherever they appear. */
const BOILERPLATE_LINES = [
  /^See Section VIII\.? Other Information for award authorities and regulations\.?$/i,
  /^Investigators proposing NIH-defined clinical trials may refer to the Research Methods Resources website/i,
  /^Need help determining whether you are doing a clinical trial\??$/i,
  /^All instructions in the (?:How to Apply\s*-\s*)?Application Guide must be followed\.?$/i,
  /^NIH grants policies as described in the NIH Grants Policy Statement will apply/i,
];

function dropBoilerplateLines(textBlock: string): string {
  return textBlock
    .split("\n")
    .filter((l) => !BOILERPLATE_LINES.some((re) => re.test(l)))
    .join("\n");
}

/** Sub-headings in Section III whose content is the same on every notice. */
const SECTION_III_DROP = [
  /^Eligible Organizations$/i,
  /^Foreign Organizations(?:\/International Collaborations)?$/i,
  /^Required Registrations$/i,
  /^\d+\.\s*Cost Sharing$/i,
];

/** Sub-headings in Section IV worth keeping: the clinical-trial and human-subjects items and the research plan. */
const SECTION_IV_KEEP =
  /Human Subjects|Clinical Trial|Study Record|Delayed Onset|Research Plan|Study Population|Protection and Monitoring|Data and Safety|Inclusion|Milestone|Study Timeline|Letter of Intent|Specific Aims|Research Strategy|Vertebrate Animals|Resource Sharing|Data Management/i;

/** Sub-headings in Section VII to keep (the rest are help desks and grants management). */
const SECTION_VII_KEEP = /Scientific\/Research Contact|Peer Review Contact/i;

/** Part 1 labels to keep. Key Dates are parsed separately; the rest is registry boilerplate. */
const PART1_KEEP = /^(?:Announcement Type|Components of Participating Organizations|Funding Opportunity Purpose)$/i;

const PART1_LABELS = [
  "Participating Organization(s)",
  "Components of Participating Organizations",
  "Funding Opportunity Title",
  "Activity Code",
  "Announcement Type",
  "Related Notices",
  "Funding Opportunity Number (FON)",
  "Funding Opportunity Number",
  "Companion Funding Opportunity",
  "Number of Applications",
  "Assistance Listing Number(s)",
  "Funding Opportunity Purpose",
  "Funding Opportunity Goal(s)",
  "Key Dates",
];

const SECTION_II_LABELS = [
  "Funding Instrument",
  "Application Types Allowed",
  "Clinical Trial?",
  "Funds Available and Anticipated Number of Awards",
  "Award Budget",
  "Award Project Period",
];

/** Roman numeral → canonical section key; Part 2 sections the fit engine reads. */
const KEPT_SECTIONS = new Set(["I", "II", "III", "IV", "VII"]);

/** Known Part 2 section titles, for the plain-text fallback. */
const SECTION_TITLES: Array<[string, RegExp]> = [
  ["I", /Section I\.\s*(?:Notice of )?Funding Opportunity Description/],
  ["II", /Section II\.\s*Award Information/],
  ["III", /Section III\.\s*Eligibility Information/],
  ["IV", /Section IV\.\s*Application and Submission Information/],
  ["V", /Section V\.\s*Application Review Information/],
  ["VI", /Section VI\.\s*Award Administration Information/],
  ["VII", /Section VII\.\s*Agency Contacts/],
  ["VIII", /Section VIII\.\s*Other Information/],
];

type Block = { heading: string; html: string };

function headingText(inner: string): string {
  return text(inner).replace(/^[\s :.-]+|[\s :]+$/g, "").trim();
}

/**
 * Split a section region into headed blocks. Tier A headings are <h2>–<h6>
 * (tolerating the template's unclosed `<h4>…</p>`) and <div class="heading4">;
 * tier B is a paragraph that is only bold text (Section I uses those for
 * "Applications Not Responsive to This NOFO" and the like).
 */
function splitBlocks(region: string, sectionHeading: string, tiers: "A" | "AB"): Block[] {
  const tierA =
    "<h([2-6])[^>]*>([\\s\\S]*?)(?=</h[2-6]>|</p>|</div>|<h[1-6][^>]*>|<p[^>]*>|<ul[^>]*>|<ol[^>]*>|<table[^>]*>|<div[^>]*>)|<(?:div|p)[^>]*class=\"heading4\"[^>]*>([\\s\\S]*?)</(?:div|p)>";
  const tierB =
    "<p[^>]*>\\s*(?:<a[^>]*>\\s*</a>\\s*)*(?:<(?:i|em|u|span)[^>]*>\\s*)*<(?:strong|b)[^>]*>\\s*(?:<(?:i|em|u|span|a)[^>]*>\\s*)*([^<]{1,160}?)\\s*(?:</[a-z]+>\\s*)*</p>";
  const re = new RegExp(tiers === "AB" ? `${tierA}|${tierB}` : tierA, "gi");
  const blocks: Block[] = [];
  let current: Block = { heading: sectionHeading, html: "" };
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(region))) {
    current.html += region.slice(last, m.index);
    last = m.index + m[0].length;
    const inner = m[2] ?? m[3] ?? m[4] ?? "";
    const heading = headingText(inner);
    if (!heading) continue;
    blocks.push(current);
    current = { heading, html: "" };
  }
  current.html += region.slice(last);
  blocks.push(current);
  return blocks;
}

/** Walk datalabel/datacolumn rows (with `col-md-push-4` continuation rows) and return label → value HTML in order. */
function labelRows(region: string): { rows: Array<{ label: string; html: string }>; tail: string } {
  const chunks = region.split(/<div[^>]*class="row"[^>]*>/i);
  const rows: Array<{ label: string; html: string }> = [];
  let tail = "";
  for (const chunk of chunks) {
    const label = chunk.match(/<div[^>]*class="[^"]*datalabel[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const value = chunk.match(/<div[^>]*class="[^"]*datacolumn[^"]*"[^>]*>([\s\S]*)$/i);
    if (!label && !value) continue;
    // A value runs to the next section-coded block (prose that follows the rows, e.g. "Other Award Budget Information").
    let valueHtml = value ? value[1]! : "";
    const after = valueHtml.search(/<div[^>]*data-section-code=/i);
    if (after >= 0) {
      tail = valueHtml.slice(after);
      valueHtml = valueHtml.slice(0, after);
    } else {
      tail = "";
    }
    if (label) rows.push({ label: headingText(label[1]!), html: valueHtml });
    else if (rows.length && /col-md-push-4/i.test(chunk)) rows[rows.length - 1]!.html += `\n${valueHtml}`;
  }
  return { rows, tail };
}

function pushSection(out: RawGuideSection[], part: 1 | 2, section: string, heading: string, html: string): void {
  const body = dropBoilerplateLines(blockText(html)).trim();
  if (!body) return;
  out.push({ part, section, heading, text: body });
}

function parseStyledSections(html: string): RawGuideSection[] {
  const out: RawGuideSection[] = [];
  const part1At = html.search(/<h1[^>]*>\s*Part\s*1\./i);
  const part2At = html.search(/<h1[^>]*>\s*Part\s*2\./i);
  if (part1At >= 0) {
    const part1 = html.slice(part1At, part2At > part1At ? part2At : undefined);
    const keyDatesAt = part1.search(/<h2[^>]*>\s*Key Dates/i);
    for (const row of labelRows(keyDatesAt >= 0 ? part1.slice(0, keyDatesAt) : part1).rows) {
      if (PART1_KEEP.test(row.label)) pushSection(out, 1, "overview", row.label, row.html);
    }
  }
  if (part2At < 0) return out;
  const part2 = html.slice(part2At);

  // Section boundaries: <h2>Section N. …</h2>; other <h2>s (e.g. "Other Award Budget Information") are sub-headings.
  const h2 = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
  const marks: Array<{ numeral: string; heading: string; start: number; bodyStart: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = h2.exec(part2))) {
    const heading = headingText(m[1]!);
    const num = heading.match(/^Section\s+([IVX]+)\./i);
    if (num) marks.push({ numeral: num[1]!.toUpperCase(), heading, start: m.index, bodyStart: m.index + m[0].length });
  }
  for (let i = 0; i < marks.length; i += 1) {
    const mark = marks[i]!;
    if (!KEPT_SECTIONS.has(mark.numeral)) continue;
    const region = part2.slice(mark.bodyStart, i + 1 < marks.length ? marks[i + 1]!.start : undefined);
    switch (mark.numeral) {
      case "I":
        for (const b of splitBlocks(region, mark.heading, "AB")) pushSection(out, 2, "I", b.heading, b.html);
        break;
      case "II": {
        // Datalabel rows first (Funding Instrument … Award Project Period), then any headed prose after them ("Other Award Budget Information").
        const { rows, tail } = labelRows(region);
        for (const row of rows) if (row.label) pushSection(out, 2, "II", row.label, row.html);
        for (const b of splitBlocks(tail, mark.heading, "A").slice(1)) pushSection(out, 2, "II", b.heading, b.html);
        break;
      }
      case "III":
      case "IV": {
        let item: string | null = null;
        const blocks = splitBlocks(region, mark.heading, "A");
        for (const b of blocks.slice(1)) {
          const numbered = b.heading.match(/^(\d+)\.\s/);
          if (numbered) item = numbered[1]!;
          if (mark.numeral === "III" && SECTION_III_DROP.some((re) => re.test(b.heading))) continue;
          if (mark.numeral === "IV" && !SECTION_IV_KEEP.test(b.heading)) continue;
          pushSection(out, 2, item ? `${mark.numeral}.${item}` : mark.numeral, b.heading, b.html);
        }
        break;
      }
      case "VII":
        for (const b of splitBlocks(region, mark.heading, "A").slice(1)) {
          if (SECTION_VII_KEEP.test(b.heading)) pushSection(out, 2, "VII", b.heading, b.html);
        }
        break;
    }
  }
  return out;
}

/** Text between `label` and the next of `labels` (or `end`) in a single-line text stream. */
function between(stream: string, from: number, label: string, labels: string[], end: number): string | null {
  const at = stream.indexOf(label, from);
  if (at < 0 || at >= end) return null;
  const valueStart = at + label.length;
  let next = end;
  for (const other of labels) {
    if (other === label) continue;
    const idx = stream.indexOf(other, valueStart);
    if (idx >= 0 && idx < next) next = idx;
  }
  const value = stream.slice(valueStart, next).trim();
  return value || null;
}

/** Notices served as an unstructured text stream: anchor on the template's own heading phrases. */
function parsePlainSections(stream: string): RawGuideSection[] {
  const out: RawGuideSection[] = [];
  const part2At = stream.lastIndexOf("Part 2. Full Text of Announcement");
  const part1At = stream.lastIndexOf("Part 1. Overview Information", part2At >= 0 ? part2At : undefined);
  if (part1At >= 0) {
    const end = part2At >= 0 ? part2At : stream.length;
    for (const label of PART1_LABELS) {
      if (!PART1_KEEP.test(label)) continue;
      const value = between(stream, part1At, label, PART1_LABELS, end);
      if (value) out.push({ part: 1, section: "overview", heading: label, text: value });
    }
  }
  if (part2At < 0) return out;
  const marks: Array<{ numeral: string; heading: string; start: number; bodyStart: number }> = [];
  for (const [numeral, re] of SECTION_TITLES) {
    const m = re.exec(stream.slice(part2At));
    if (m) marks.push({ numeral, heading: m[0].replace(/\s+/g, " ").trim(), start: part2At + m.index, bodyStart: part2At + m.index + m[0].length });
  }
  marks.sort((a, b) => a.start - b.start);
  for (let i = 0; i < marks.length; i += 1) {
    const mark = marks[i]!;
    if (!KEPT_SECTIONS.has(mark.numeral)) continue;
    const end = i + 1 < marks.length ? marks[i + 1]!.start : stream.length;
    const body = stream.slice(mark.bodyStart, end).trim();
    if (!body) continue;
    if (mark.numeral === "II") {
      for (const label of SECTION_II_LABELS) {
        const value = between(stream, mark.bodyStart, label, SECTION_II_LABELS, end);
        if (value) out.push({ part: 2, section: "II", heading: label, text: value });
      }
      continue;
    }
    if (mark.numeral === "VII") {
      const labels = ["Application Submission Contacts", "Scientific/Research Contact(s)", "Peer Review Contact(s)", "Financial/Grants Management Contact(s)"];
      for (const label of labels) {
        if (!SECTION_VII_KEEP.test(label)) continue;
        const value = between(stream, mark.bodyStart, label, labels, end);
        if (value) out.push({ part: 2, section: "VII", heading: label, text: value });
      }
      continue;
    }
    out.push({ part: 2, section: mark.numeral, heading: mark.heading, text: body });
  }
  return out;
}

/**
 * The notice's full text by section: Part 1 (Announcement Type, participating
 * components, Purpose); Part 2 Section I with its sub-headings (Background,
 * Research Objectives, Specific Areas of Research Interest, Non-Responsive …),
 * Section II rows, Section III (numbered items, III.3 included; standard
 * eligibility lists dropped), Section IV clinical-trial / human-subjects items,
 * Section VII scientific and peer-review contacts. Headings are verbatim.
 */
export function parseGuideSections(html: string): GuideSection[] {
  const clean = stripNoise(html);
  const styled = /<h1[^>]*>\s*Part\s*2\./i.test(clean) || /<h2[^>]*>\s*Section\s+I\./i.test(clean);
  const sections = styled ? parseStyledSections(clean) : parsePlainSections(text(clean));
  // Roles are stamped here for rows written from now on; the detection logic
  // above is untouched, and `withRoles()` derives the same values at read time
  // for every row stored before PR 5.1.
  return withRoles(sections.slice(0, 120));
}

const CT_TITLE_RE = /Clinical Trials?(?:\(s\))?\s+(Required|Optional|Not Allowed)/i;

/**
 * The clinical-trial designation. The title suffix is authoritative
 * ("(R01 Clinical Trial Not Allowed)"); Section II's "Clinical Trial?" row
 * decides when the title has none; "Basic Experimental Studies with Humans"
 * in either place is `besh_required`.
 */
export function parseClinicalTrialDesignation(title: string | null | undefined, html: string): ClinicalTrialDesignation {
  const t = (title ?? "").replace(/\s+/g, " ");
  if (/Basic Experimental Stud(?:y|ies) with Humans\s+Required/i.test(t)) return "besh_required";
  const fromTitle = t.match(CT_TITLE_RE)?.[1]?.toLowerCase();
  if (fromTitle === "required") return "required";
  if (fromTitle === "optional") return "optional";
  if (fromTitle === "not allowed") return "not_allowed";

  const row = labelValue(html, /Clinical Trial\?/) ?? text(html).match(/Clinical Trial\?\s*((?:Required|Optional|Not Allowed)[^]{0,200})/i)?.[1] ?? "";
  if (!row) return "unknown";
  if (/Basic Experimental Stud(?:y|ies) with Humans/i.test(row)) return "besh_required";
  if (/^Required/i.test(row)) return "required";
  if (/^Optional/i.test(row)) return "optional";
  if (/^Not Allowed/i.test(row)) return "not_allowed";
  return "unknown";
}

const PERSON_LINE = /,\s*(?:Ph\.?\s?D|M\.?D|D\.?O|Sc\.?D|D\.?Sc|Dr\.?P\.?H|M\.?P\.?H|Pharm\.?D|D\.?V\.?M|D\.?D\.?S|D\.?M\.?D|R\.?N|M\.?S\.?N|M\.?S|M\.?A|M\.?B\.?A|J\.?D|Ed\.?D|Psy\.?D|D\.?N\.?P|D\.?P\.?T|M\.?H\.?S|M\.?P\.?P|FACP)\b|^Dr\.?\s/i;
const CONTACT_LINE = /^(?:Telephone|Phone|Tel|Fax|Email|E-mail|Web|Website)\b|@|^\+?\d[\d\s().-]{6,}$/i;
const JOB_TITLE_LINE = /\b(?:Program|Project|Scientific Review|Grants Management|Referral|Health Scientist) (?:Director|Officer|Official|Manager|Lead|Administrator|Specialist)\b|^Referral Officer$/i;
const IC_LINE = /(?:National (?:Institute|Center|Library|Eye|Heart|Cancer|Human Genome)|Institutes? of Health|Fogarty International Center|Office of the Director|Center for Scientific Review|Clinical Center|Eunice Kennedy Shriver|Centers for Disease Control|Department of Health)\b|\bNIH\b/i;
/**
 * An organizational unit reads "Division of …", "Center for …", "Office of …", "… Branch",
 * "… Division", or "… Program (ACRONYM)". A bare "… Program" or "… Program Inbox" is a
 * mailbox label ("NCI GTN Program", "NIDA CPP Program") and is not accepted.
 */
const UNIT_LINE =
  /^(?:Division|Branch|Office|Center|Centre|Laboratory|Section|Program|Directorate)s?\s+(?:of|for|on|in)\b|\b(?:Division|Branch|Office|Center|Centre|Laboratory|Section)\s+(?:of|for|on)\b|\b(?:Division|Branch|Office|Center|Centre|Laboratory|Section|Directorate)(?:\s+\([A-Z]{2,8}\))?$|\bProgram\s+\([A-Z]{2,8}\)$/i;

/**
 * The organizational unit of the Scientific/Research Contact in Section VII —
 * "Division of Cancer Control and Population Sciences (DCCPS)", "Center for
 * Strategic Scientific Initiatives (CSSI)" — which tells a basic-science
 * program from a clinical or population one (spec §5). Input is the Section
 * VII text (or just the Scientific/Research Contact(s) block); the first unit
 * line that is not the IC itself, a person, a job title or a phone/e-mail
 * line wins. Null when the contact lists only the IC.
 */
export function parseProgramDivision(sectionVII: string | null | undefined): string | null {
  if (!sectionVII) return null;
  let block = /<[a-z][^>]*>/i.test(sectionVII) ? blockText(sectionVII) : sectionVII;
  const sci = block.search(/Scientific\/Research Contact/i);
  if (sci >= 0) {
    const after = block.slice(sci);
    const end = after.slice(1).search(/Peer Review Contact|Financial\/Grants Management Contact|Application Submission Contact/i);
    block = end >= 0 ? after.slice(0, end + 1) : after;
  }
  const lines = block
    .split("\n")
    .map((l) => l.replace(/^-\s+/, "").trim())
    .filter(Boolean);
  // Parent-style notices list one contact per participating IC; no single division applies.
  if (lines.filter((l) => IC_LINE.test(l)).length >= 3) return null;
  for (const line of lines) {
    if (line.length > 140) continue;
    if (/Scientific\/Research Contact/i.test(line)) continue;
    if (PERSON_LINE.test(line) || CONTACT_LINE.test(line) || JOB_TITLE_LINE.test(line) || IC_LINE.test(line)) continue;
    if (!UNIT_LINE.test(line)) continue;
    return line.replace(/[\s,;:]+$/g, "");
  }
  // A single-line stream (plain-layout notices): pick out one "Division of … (ABBR)" phrase.
  if (lines.length === 1) {
    const m = lines[0]!.match(/\b((?:Division|Branch|Office|Center|Program|Laboratory) (?:of|for|on) [A-Z][A-Za-z,'&\- ]{3,90}?(?:\s\([A-Z]{2,8}\))?)(?=\s+(?:National|NIH|Telephone|Phone|Email|E-mail|Fax|\d)|$)/);
    if (m && !IC_LINE.test(m[1]!)) return m[1]!.trim();
  }
  return null;
}

/**
 * True for the Guide's plain text template (PAR-27-026, PA-27-034/035/036,
 * RFA-DK-26-308 …): no datalabel rows and no headings, so Key Dates cannot be
 * read and sections come out without sub-headings. When Simpler holds the
 * styled `<number>-Full-Announcement.html` for such a notice, the sync prefers it.
 */
export function isPlainGuideLayout(html: string): boolean {
  return !/class="[^"]*datalabel/i.test(html) && !/<h[12][^>]*>\s*(?:Part\s*[12]\.|Section\s+[IVX]+\.)/i.test(html);
}

/**
 * Content hash of a Guide page: SHA-256 over the visible text with comments,
 * scripts, styles and markup removed and whitespace collapsed, so cosmetic
 * template changes (analytics tags, "Changed ON" comments, attribute order)
 * do not defeat the skip while any change to the notice text does.
 */
export function guideHtmlHash(html: string): string {
  return createHash("sha256").update(text(stripNoise(html))).digest("hex");
}
