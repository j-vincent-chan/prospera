import type { CycleKind, ReceiptCycle } from "@/lib/funding-opportunities/receipt-cycles";

/**
 * Parser for the NIH Guide notice page (Key Dates section and header facts).
 *
 * Markup, as served in 2025-26:
 *   <div class="row"><div class="col-md-4 datalabel" data-section-code="KD">Posted Date</div>
 *                    <div class="col-md-8 datacolumn">September 24, 2024</div></div>
 * and one table whose first row reads "Application Due Dates | Review and Award Cycles"
 * with columns New | Renewal/Resubmission/Revision | AIDS | Scientific Merit Review |
 * Advisory Council Review | Earliest Start Date. "Standard dates apply" notices are
 * rendered expanded by NIH, so no local standard-date table is needed.
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

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function decode(s: string): string {
  return s
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&[a-z]+;/g, " ");
}

/** Strip tags → single-spaced text. */
export function text(html: string): string {
  return decode(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
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

export function parseNihGuide(html: string): ParsedGuide {
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
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

  const reissue = html.match(/Reissue of\s*(?:<[^>]+>\s*)*([A-Z]{2,3}-[A-Z]{2}-\d{2}-\d{3})/i)?.[1] ?? null;
  const companionRaw = labelValue(html, /Companion Funding Opportunity/) ?? "";
  const companion = companionRaw.match(/\b(?:PA|PAR|RFA)-[A-Z]{2}-\d{2}-\d{3}\b/)?.[0] ?? null;

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
