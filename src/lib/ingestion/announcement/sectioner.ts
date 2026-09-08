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
};

const DEFAULT_MAX_HEADING_CHARS = 120;

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
    const hit = line && line.length <= maxHeading ? patterns.find((p) => p.test.test(line)) : undefined;
    if (hit) {
      flush();
      current = { section: hit.section, roles: [...hit.roles], heading: line, lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
    else if (opts.preamble) preamble.push(line);
  }
  flush();

  if (opts.preamble) {
    const text = linesToText(preamble);
    if (text) out.unshift({ part: 2, section: opts.preamble.section, heading: opts.preamble.section, text, roles: [...opts.preamble.roles] });
  }
  return out;
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
