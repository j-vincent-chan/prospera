/**
 * Heading-driven sectioning (PR 5.2).
 *
 * A non-NIH announcement has no markup to route on — an NSF solicitation and a
 * CDMRP Program Announcement carry their structure in lines that look like
 * headings. `sectionByHeadings` walks the lines once, opens a section whenever a
 * line matches a pattern, and assigns that pattern's roles to it; everything
 * until the next match is the section's text.
 *
 * The roles come from the pattern, not from the text, so each source's heading
 * table (PRs 5.3–5.5) is a small declarative list rather than a parser.
 */
import type { NoticeSection } from "@/lib/fit/profile/opportunity-extract";
import type { SectionRole } from "@/lib/fit/profile/section-roles";
import { linesToText, type TextLine } from "@/lib/ingestion/announcement/text";

/** One heading a source is known to use, and what the block under it is for. */
export type HeadingPattern = {
  /** Matched against a whole line, already whitespace-collapsed. */
  test: RegExp;
  roles: SectionRole[];
  /** A stable id for the section, e.g. "II" for NSF's Program Description. Free text; only `sectionLabel` reads it. */
  section: string;
};

export type SectionByHeadingsOptions = {
  /** Lines before the first heading: kept under this role when set, dropped otherwise. */
  preamble?: { section: string; roles: SectionRole[] } | null;
  /** A heading line longer than this is prose that happens to match, not a heading. */
  maxHeadingChars?: number;
  /** Sections with no text are dropped; the extractor has nothing to read in them. */
  keepEmpty?: boolean;
  /**
   * A line this returns true for can never open a section (PR 5.3). PDFs repeat
   * their headings in a table of contents and in per-page navigation ribbons;
   * without this every announcement's `objectives` block would be the two-line
   * contents blurb rather than the body. See `isTableOfContentsLine`.
   */
  ignoreHeading?: (line: string) => boolean;
  /**
   * `"longest"`: when the same `section` id opens more than once, keep only the
   * longest block (PR 5.3). A repeated heading in a paginated document is a
   * contents entry, a running header or a cross-reference; the body is the long
   * one. Off by default so PR 5.2's behaviour is unchanged.
   */
  dedupe?: "longest";
};

const DEFAULT_MAX_HEADING_CHARS = 120;

/**
 * A contents line, not a heading: leader dots (`PART I. …………… 7`), or a heading
 * followed by nothing but a page number (`Before you begin 3`). Both forms are
 * in the three fixtures. Deliberately narrow — it must never swallow a real
 * heading, and `dedupe: "longest"` is the backstop for the ones it misses (a
 * bare contents entry with the page number on its own line, as HHS's
 * modernised template writes them).
 */
export function isTableOfContentsLine(line: string): boolean {
  return /\.{4,}\s*\d*\s*$/.test(line) || /\s\d{1,3}$/.test(line);
}

/**
 * Cut `lines` into sections at the heading patterns. The first matching pattern
 * wins, so order the table from most specific to least.
 *
 * A matched line is the heading and is not repeated in the text — the same
 * convention `parseGuideSections` follows, so the two produce sections the
 * extractor treats alike.
 */
export function sectionByHeadings(lines: readonly TextLine[], patterns: readonly HeadingPattern[], opts: SectionByHeadingsOptions = {}): NoticeSection[] {
  const maxHeading = opts.maxHeadingChars ?? DEFAULT_MAX_HEADING_CHARS;
  const out: NoticeSection[] = [];
  let current: { section: string; roles: SectionRole[]; heading: string; lines: TextLine[] } | null = null;
  const preamble: TextLine[] = [];

  const flush = () => {
    if (!current) return;
    const text = linesToText(current.lines);
    if (text || opts.keepEmpty) {
      out.push({ part: 2, section: current.section, heading: current.heading, text, roles: current.roles });
    }
    current = null;
  };

  for (const line of lines) {
    const eligible = line !== "" && line.length <= maxHeading && !(opts.ignoreHeading?.(line) ?? false);
    const hit = eligible ? patterns.find((p) => p.test.test(line)) : undefined;
    if (hit) {
      flush();
      current = { section: hit.section, roles: [...hit.roles], heading: line, lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
    else if (opts.preamble) preamble.push(line);
  }
  flush();

  const kept = opts.dedupe === "longest" ? keepLongestPerSection(out) : out;

  if (opts.preamble) {
    const text = linesToText(preamble);
    if (text) kept.unshift({ part: 2, section: opts.preamble.section, heading: opts.preamble.section, text, roles: [...opts.preamble.roles] });
  }
  return kept;
}

/** One block per `section` id: the longest, in the order the kept blocks first appeared. */
function keepLongestPerSection(sections: NoticeSection[]): NoticeSection[] {
  const best = new Map<string, NoticeSection>();
  for (const s of sections) {
    const prev = best.get(s.section);
    if (!prev || s.text.length > prev.text.length) best.set(s.section, s);
  }
  return sections.filter((s) => best.get(s.section) === s);
}

/**
 * The prose fallback: the whole document as one section under one role, for a
 * source with no recognisable structure. The profile built from it is thin by
 * construction, which is what D62's Exploratory ceiling and D67's admission
 * rule exist to handle — this function must not pretend otherwise by inventing
 * headings.
 */
export function singleSection(lines: readonly TextLine[], role: SectionRole, heading = "Announcement", section = "full_text"): NoticeSection[] {
  const text = linesToText(lines);
  return text ? [{ part: 2, section, heading, text, roles: [role] }] : [];
}

/** True when the sections carry at least one `objectives` block — the test a resolved target has to pass to win. */
export function hasObjectives(sections: readonly NoticeSection[]): boolean {
  return sections.some((s) => (s.roles ?? []).includes("objectives"));
}

/** The distinct roles a section set carries, for reporting and for scoring a heading table. */
export function rolesOf(sections: readonly NoticeSection[]): SectionRole[] {
  return [...new Set(sections.flatMap((s) => s.roles ?? []))].sort();
}

// ---------------------------------------------------------------------------
// Choosing between heading tables (PR 5.3)
// ---------------------------------------------------------------------------

export {
  ANNOUNCEMENT_HEADING_TABLES,
  CDMRP_PA_HEADINGS,
  FEDERAL_NOFO_HEADINGS,
  SIMPLIFIED_NOFO_HEADINGS,
} from "@/lib/ingestion/announcement/heading-tables";

export type SectionedDocument = {
  /**
   * The winning table's id. Reported by the dry run only — it is not persisted:
   * `announcement_kind` stores the *adapter* id, because the table that fit
   * best is an observation about one document, not a fact about the funder.
   * `cdmrp_pa` fitting a DOJ OJP solicitation, as it does in the 40-row run,
   * means only that DOJ numbers its blocks the same way.
   */
  table: string;
  sections: NoticeSection[];
  roles: SectionRole[];
};

/**
 * Section one document with each candidate table and keep the best reading.
 *
 * A Grants.gov attachment does not say which template it follows, and the three
 * in `heading-tables.ts` do not overlap enough to merge into one list — HHS's
 * bare `Eligibility` would fire inside a classic NOFO's prose, and the classic
 * enumerator would never fire inside an HHS one. Trying each and scoring the
 * result is both simpler and more honest than sniffing the first page.
 *
 * The score is lexicographic:
 *
 *   1. an `objectives` block at all — the acceptance criterion, and the one
 *      section the extractor cannot do without;
 *   2. **how many sections it identified as something other than `other`** —
 *      the discriminator that actually works, measured on the four fixtures. A
 *      table that fits the document names most of its blocks; a foreign table
 *      catches three or four stray lines. Counting *named* blocks rather than
 *      all of them means a table cannot win by listing more `other` patterns;
 *   3. the total number of sections (15 for HHS's template on `HRSA-27-099`,
 *      11 for the CDMRP table on `HT942526SCIRPTRA`, 7 for the classic one on
 *      `USDA-NIFA-WAMS-011117`, against 0–6 for every foreign table);
 *   4. the number of distinct named roles;
 *   5. the total text captured.
 *
 * **Total text alone is actively wrong**, which is why it is last. A foreign
 * table that matches one line and then finds no further heading swallows the
 * rest of the document into a single enormous block: on `HT942526SCIRPTRA` the
 * HHS table matched the contents page and produced a 905-character
 * "objectives", while the classic table produced a 69,621-character one that is
 * most of the PDF. Both are wrong, and both beat the correct reading on size.
 */
export function sectionWithBestTable(
  lines: readonly TextLine[],
  tables: ReadonlyArray<{ id: string; patterns: readonly HeadingPattern[] }>,
  opts: SectionByHeadingsOptions = {},
): SectionedDocument | null {
  let best: (SectionedDocument & { score: readonly number[] }) | null = null;
  for (const table of tables) {
    const sections = sectionByHeadings(lines, table.patterns, opts);
    if (sections.length === 0) continue;
    const roles = rolesOf(sections);
    const score = [
      hasObjectives(sections) ? 1 : 0,
      sections.filter((s) => (s.roles ?? []).some((r) => r !== "other")).length,
      sections.length,
      roles.filter((r) => r !== "other").length,
      sections.reduce((n, s) => n + s.text.length, 0),
    ] as const;
    if (!best || compareScores(score, best.score) > 0) best = { table: table.id, sections, roles, score };
  }
  return best ? { table: best.table, sections: best.sections, roles: best.roles } : null;
}

function compareScores(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
