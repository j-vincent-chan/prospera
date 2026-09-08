/**
 * Canonical section roles (PR 5.1; NON_NIH_FEASIBILITY § 6).
 *
 * The extractor reads three groups of notice text. Which group a section joins
 * has been decided by its NIH roman numeral ("II" → group 2) since PR 1.5,
 * which is exactly the piece of the pipeline a non-NIH announcement cannot
 * satisfy: an NSF solicitation's "IV. ELIGIBILITY INFORMATION" and a CDMRP
 * Program Announcement's "Eligibility Information" block carry the same *role*
 * under different names. A role vocabulary lets every source name what a
 * section is for, and lets `groupSections` route on that instead.
 *
 * This module is a pure refactor for NIH: `rolesForNihSection` reproduces the
 * previous branch-by-branch routing exactly, so the three lists — and therefore
 * the rendered extractor prompt and its `extractionCacheKey` — are unchanged
 * for every existing notice. `src/lib/fit/nih-invariant.test.ts` is what holds
 * that claim up.
 *
 * **Roles are a list, never a scalar.** The old `groupSections` was not a
 * partition: a Section I section whose heading matches `TEAM_HEADING` was
 * pushed into group 1 (or 2, when non-responsive) *and* into group 3. A scalar
 * role could not reproduce that, and dropping the duplication would change
 * group 1's text and re-key every cached extraction.
 */

/** What a section is for, independent of the numbering its funder happens to use. */
export type SectionRole =
  | "purpose"
  | "objectives"
  | "non_responsive"
  | "award_info"
  | "eligibility"
  | "human_subjects"
  | "review"
  | "contacts"
  | "team"
  | "synopsis"
  /** Read by no group — the section is kept on the notice but never sent to the extractor. */
  | "other";

export const SECTION_ROLES: readonly SectionRole[] = [
  "purpose",
  "objectives",
  "non_responsive",
  "award_info",
  "eligibility",
  "human_subjects",
  "review",
  "contacts",
  "team",
  "synopsis",
  "other",
];

/** The minimum shape `rolesForNihSection` and `withRoles` need; both `GuideSection` and `NoticeSection` satisfy it. */
export type RoleBearingSection = { part: 1 | 2; section: string; heading: string; roles?: SectionRole[] };

/**
 * Which extractor group each role feeds (NON_NIH_FEASIBILITY § 6). `review` and
 * `other` feed none: Section V was never in `KEPT_SECTIONS`, and this table
 * must not start sending it — that would change group membership.
 */
export const ROLE_GROUP: Readonly<Record<SectionRole, 1 | 2 | 3 | null>> = {
  purpose: 1,
  objectives: 1,
  synopsis: 1,
  non_responsive: 2,
  award_info: 2,
  human_subjects: 2,
  eligibility: 3,
  contacts: 3,
  team: 3,
  review: null,
  other: null,
};

/** The pseudo-section a synopsis-only notice is read as (mirrors `SYNOPSIS_SECTION`). */
const SYNOPSIS = "synopsis";

// The heading tests below are the ones `groupSections` used, kept verbatim so
// the routing cannot drift. `opportunity-extract.ts` re-exports two of them for
// `judge/inputs.ts`, which still discriminates on headings directly.

/** Section I sub-headings carrying the non-responsive list. */
export const NON_RESPONSIVE_HEADING = /non-?respons|not respons|will not be reviewed|out of scope/i;
/** Section I sub-headings about team and partnership expectations. */
export const TEAM_HEADING = /\b(?:teams?|collaborat\w*|consorti\w*|partner\w*|leadership|structure|multiple PDs?|multi-?PI)\b/i;
/** Section IV items the extractor reads. */
export const HUMAN_SUBJECTS_HEADING = /Human Subjects|Clinical Trial/i;
/** The one Part 1 heading the extractor reads. */
export const PURPOSE_HEADING = /Funding Opportunity Purpose/i;

/**
 * The roles of one NIH Guide section, in the order the old `groupSections`
 * would have pushed it: its primary role first, then `team` when the Section I
 * heading also carries team language.
 *
 * The branch order matters and mirrors the original exactly — synopsis, then
 * Part 1, then the Part 2 numerals — because a Part 1 section was `continue`d
 * before the section-id tests could see it.
 */
export function rolesForNihSection(section: string, heading: string, part: 1 | 2 = 2): SectionRole[] {
  if (section === SYNOPSIS) return ["synopsis"];
  if (part === 1) return PURPOSE_HEADING.test(heading) ? ["purpose"] : ["other"];
  if (section === "I") {
    const primary: SectionRole = NON_RESPONSIVE_HEADING.test(heading) ? "non_responsive" : "objectives";
    return TEAM_HEADING.test(heading) ? [primary, "team"] : [primary];
  }
  if (section === "II") return ["award_info"];
  if (section.startsWith("III")) return ["eligibility"];
  if (section.startsWith("IV")) return HUMAN_SUBJECTS_HEADING.test(heading) ? ["human_subjects"] : ["other"];
  if (section === "VII") return ["contacts"];
  return ["other"];
}

/**
 * Every section carrying `roles`, derived from the NIH numbering where the
 * value is absent. Stored rows written before PR 5.1 have no `roles` key, so
 * this is what makes a backfill unnecessary: they are filled at read time and
 * route exactly as they did before.
 *
 * A section that already carries roles is returned untouched — that is how a
 * non-NIH adapter's own heading table reaches `groupSections` (PR 5.2).
 */
export function withRoles<T extends RoleBearingSection>(sections: readonly T[]): Array<T & { roles: SectionRole[] }> {
  return sections.map((s) =>
    Array.isArray(s.roles) && s.roles.length
      ? (s as T & { roles: SectionRole[] })
      : { ...s, roles: rolesForNihSection(s.section, s.heading, s.part) },
  );
}

/** True when the section id is an NIH roman numeral ("I", "III.3", "IV.2"), which decides whether `sectionLabel` uses the NIH rendering. */
export function isNihSectionId(section: string): boolean {
  return /^[IVX]+(?:\.\d+)?$/.test(section);
}

/** The role a non-NIH section is labelled by: its first role that feeds a group, else its first, else "other". */
export function primaryRole(roles: readonly SectionRole[] | undefined): SectionRole {
  if (!roles || roles.length === 0) return "other";
  return roles.find((r) => ROLE_GROUP[r] !== null) ?? roles[0]!;
}

/** "Program Description" from `objectives` — the heading-style label a role-rendered section shows. */
export function roleTitle(role: SectionRole): string {
  return ROLE_TITLES[role];
}

const ROLE_TITLES: Readonly<Record<SectionRole, string>> = {
  purpose: "Purpose",
  objectives: "Program Description",
  non_responsive: "Non-Responsive",
  award_info: "Award Information",
  eligibility: "Eligibility",
  human_subjects: "Human Subjects",
  review: "Review",
  contacts: "Contacts",
  team: "Team",
  synopsis: "Synopsis",
  other: "Other",
};
