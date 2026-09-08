/**
 * Heading tables for the announcement templates a Grants.gov attachment
 * actually uses (PR 5.3). Re-exported from `sectioner.ts`, which is where the
 * plan says they live.
 *
 * Three templates cover the federal corpus, and the plan named only one of
 * them. The other two were found by reading real attachments:
 *
 *  1. **`FEDERAL_NOFO_HEADINGS`** — the classic 2 CFR 200 skeleton, `PART I.
 *     FUNDING OPPORTUNITY DESCRIPTION` … `PART VII. OTHER INFORMATION`. USDA
 *     NIFA, NIST, DOJ, DOI and most of the non-HHS tail. Agencies renumber
 *     freely (NIFA has no Part VIII; some use letters), so the numeral is only
 *     an enumerator and the *title* is what identifies the block.
 *  2. **`SIMPLIFIED_NOFO_HEADINGS`** — HHS's modernised template (`Step 1:
 *     Review the Opportunity` … `Step 6`, with bare `Basic information`,
 *     `Eligibility`, `Program description`, `Award information` blocks). This
 *     is what **every** current HRSA and CDC NOFO uses — `HRSA-27-099` and
 *     `CDC-RFA-JG-26-0043`, the two HHS fixtures, are both in it, and neither
 *     carries a single roman numeral. The plan's `I. … VIII.` table alone would
 *     have recovered nothing from HHS.
 *  3. **`CDMRP_PA_HEADINGS`** — the numbered thirteen-block CDMRP Program
 *     Announcement structure the plan lists, which is `1. Basic Information
 *     About the Funding Opportunity` … `9. Other Information` plus appendices
 *     in the FY26 documents.
 *
 * Two shared hazards, both measured on the fixtures:
 *
 *  - **Every heading appears at least twice.** Once in the contents, once in
 *    the body, and in HHS's template once more in a per-step mini-contents on
 *    each section's first page. `isTableOfContentsLine` removes the leader-dot
 *    and trailing-page-number forms; `dedupe: "longest"` removes the rest, on
 *    the rule that a repeated heading in a paginated document is a reference
 *    and the body block is the long one.
 *  - **Nav ribbons.** A CDMRP PA prints `Basic Information | Eligibility |
 *    Program Description | …` on every page. Every pattern here is `$`-anchored
 *    (allowing only a trailing colon), so a ribbon line cannot open a section.
 *
 * Roles are assigned **one group-feeding role per pattern**: `groupSections`
 * pushes a section once per role that maps to a group, so two such roles on one
 * section would duplicate its text inside the extractor prompt.
 */
import type { SectionRole } from "@/lib/fit/profile/section-roles";
import type { HeadingPattern } from "@/lib/ingestion/announcement/sectioner";

/**
 * `PART I.` / `Section IV:` / `A.` / `3.` / `A.7` — the enumerator a classic
 * NOFO puts before the block title. Required there, because without it "Award
 * Information" matches prose in a dozen places.
 *
 * The `A.7` form is USDA APHIS's (`A.7 PROGRAM DESCRIPTION`), where the letter
 * is the part and the digit the block; found on
 * `USDA-APHIS-10031-PPQ-PPDMDPP-2027` in the first 40-row dry run, which
 * recovered `review` and nothing else until this allowed for it.
 */
const ENUM = String.raw`(?:PART\s+|SECTION\s+)?(?:[IVX]{1,5}|[A-H]|\d{1,2})(?:\.\d{1,2})?[.):]?\s+`;

/** Optional trailing colon and nothing else: the line has to *be* the heading. */
const END = String.raw`\s*:?\s*$`;

function classic(section: string, title: string, roles: SectionRole[]): HeadingPattern {
  return { section, roles, test: new RegExp(`^${ENUM}(?:${title})${END}`, "i") };
}

function bare(section: string, title: string, roles: SectionRole[]): HeadingPattern {
  return { section, roles, test: new RegExp(`^(?:${title})${END}`, "i") };
}

function numbered(section: string, n: number, title: string, roles: SectionRole[]): HeadingPattern {
  return { section, roles, test: new RegExp(`^(?:${n}\\s*\\.\\s*)?(?:${title})${END}`, "i") };
}

// ---------------------------------------------------------------------------
// 1 · The classic federal NOFO skeleton
// ---------------------------------------------------------------------------

/**
 * Ordered most specific first — `sectionByHeadings` takes the first pattern
 * that matches, so `Application Review Information` must be tested before
 * anything that could also match `Application …`.
 *
 * The `section` ids are **not** the document's roman numerals, deliberately.
 * Agencies renumber (NIFA's last part is VII, not VIII) so a numeral read off
 * the table would be a lie half the time — and, worse, `isNihSectionId()`
 * matches `/^[IVX]+(\.\d+)?$/`, so an id of `"I"` would make `sectionLabel()`
 * render a USDA notice as `Part 2 · Section I · …`, the NIH form.
 */
export const FEDERAL_NOFO_HEADINGS: readonly HeadingPattern[] = [
  classic("nofo.description", String.raw`(?:Program\s+)?(?:Funding\s+Opportunity\s+)?(?:Program\s+)?Description(?:\s+of\s+the\s+Program)?|Funding\s+Opportunity\s+Description|Program\s+Description`, ["objectives"]),
  classic("nofo.summary", String.raw`Executive\s+Summary|Program\s+Overview|Purpose\s+of\s+(?:this\s+)?(?:Notice|Announcement|Program)`, ["purpose"]),
  classic("nofo.award", String.raw`(?:Federal\s+)?Award\s+Information|Funding\s+Information|Funding\s+Details`, ["award_info"]),
  classic("nofo.basic", String.raw`Basic\s+Information`, ["award_info"]),
  classic("nofo.eligibility", String.raw`Eligibility(?:\s+Information)?(?:\s+and\s+Requirements)?|Eligible\s+(?:Applicants?|Entities|Recipients|Suggesters|Organizations?)|Applicant\s+Eligibility|Threshold\s+Eligibility\s+Criteria|Who\s+(?:May|Can)\s+Apply`, ["eligibility"]),
  classic("nofo.review", String.raw`Application\s+Review(?:\s+Information|\s+Requirements|\s+and\s+Selection\s+Process)?|Review\s+and\s+Selection\s+Process`, ["review"]),
  classic("nofo.application", String.raw`Application(?:\s*,)?\s+(?:and\s+)?Submission(?:\s+Information)?|Application\s+and\s+Submission\s+Information`, ["other"]),
  classic("nofo.administration", String.raw`(?:Federal\s+)?Award\s+Administration(?:\s+Information)?`, ["other"]),
  classic("nofo.contacts", String.raw`(?:Federal\s+)?(?:Awarding\s+)?Agency\s+Contacts?(?:\s+Information)?|Contacts?(?:\s+and\s+Support)?`, ["contacts"]),
  classic("nofo.other", String.raw`Other\s+Information`, ["other"]),
];

// ---------------------------------------------------------------------------
// 2 · HHS's modernised ("simplified") NOFO
// ---------------------------------------------------------------------------

/**
 * `Program description` is the objectives block and `Agency priorities` is the
 * programmatic direction the applicant must align to — the two highest-signal
 * paragraphs in an HHS NOFO. Both carry `objectives`; they are different
 * sections, so `groupSections` appends them rather than duplicating one.
 */
export const SIMPLIFIED_NOFO_HEADINGS: readonly HeadingPattern[] = [
  bare("program_description", String.raw`Program\s+description(?:\s+and\s+objectives)?`, ["objectives"]),
  bare("agency_priorities", String.raw`(?:Agency|CDC|HRSA)\s+priorities`, ["objectives"]),
  bare("eligibility", String.raw`Eligibility(?:\s+information)?`, ["eligibility"]),
  bare("award_information", String.raw`Award\s+information`, ["award_info"]),
  bare("funding_details", String.raw`Funding\s+details`, ["award_info"]),
  bare("basic_information", String.raw`Basic\s+information`, ["award_info"]),
  bare("application_review", String.raw`Application\s+review(?:\s+and\s+selection)?|Review\s+and\s+selection|Selection\s+process`, ["review"]),
  bare("contacts", String.raw`Contacts?\s+and\s+support|Agency\s+contacts?`, ["contacts"]),
  bare("before_you_begin", String.raw`Before\s+you\s+begin`, ["other"]),
  bare("application_contents", String.raw`Application\s+contents\s+and\s+format|Application\s+checklist`, ["other"]),
  bare("submission", String.raw`Application\s+submission\s+and\s+deadlines|Submission\s+and\s+deadlines|Other\s+submissions`, ["other"]),
  bare("award_notices", String.raw`Award\s+notices`, ["other"]),
  bare("post_award", String.raw`Post-?award\s+requirements(?:\s+and\s+administration)?|Reporting`, ["other"]),
  bare("get_ready", String.raw`Get\s+registered|Find\s+the\s+application\s+package|Application\s+writing\s+help|Help\s+applying`, ["other"]),
  bare("steps", String.raw`Step\s+[1-6]\s*:.*`, ["other"]),
  bare("endnotes", String.raw`Endnotes|Glossary`, ["other"]),
];

// ---------------------------------------------------------------------------
// 3 · The CDMRP Program Announcement
// ---------------------------------------------------------------------------

/**
 * The number is optional so that the pre-FY25 unnumbered PAs section too; the
 * `$` anchor plus `dedupe: "longest"` is what keeps the contents page and the
 * `Basic Information | Eligibility | …` nav ribbon out.
 *
 * `3. Program Description` — which carries the mission, the vision and the
 * Areas of Emphasis — is the highest-signal paradigm text in the whole non-NIH
 * corpus, and PR 5.5 reuses this table for the direct `cdmrp.health.mil` route.
 */
export const CDMRP_PA_HEADINGS: readonly HeadingPattern[] = [
  numbered("cdmrp.3", 3, String.raw`Program\s+Description(?:\s+and\s+Areas\s+of\s+Emphasis)?`, ["objectives"]),
  numbered("cdmrp.2", 2, String.raw`Eligibility(?:\s+Information)?`, ["eligibility"]),
  numbered("cdmrp.1", 1, String.raw`Basic\s+Information(?:\s+About\s+the\s+Funding\s+Opportunity)?`, ["award_info"]),
  numbered("cdmrp.6", 6, String.raw`Application\s+Review\s+Information`, ["review"]),
  numbered("cdmrp.4", 4, String.raw`Application\s+Contents(?:\s+and\s+Format)?`, ["other"]),
  numbered("cdmrp.5", 5, String.raw`Submission\s+Requirements`, ["other"]),
  numbered("cdmrp.7", 7, String.raw`Federal\s+Award\s+Notices`, ["other"]),
  numbered("cdmrp.8", 8, String.raw`Post-?Award\s+Requirements`, ["other"]),
  numbered("cdmrp.9", 9, String.raw`Other\s+Information`, ["other"]),
  bare("cdmrp.0", String.raw`Before\s+You\s+Begin`, ["other"]),
  { section: "cdmrp.appendix", roles: ["other"], test: /^Appendix\s+\d+\s*[.:]\s*.+$/i },
];

/** Every table the Grants.gov adapter tries, in the order it tries them. */
export const ANNOUNCEMENT_HEADING_TABLES: ReadonlyArray<{ id: string; patterns: readonly HeadingPattern[] }> = [
  { id: "simplified_nofo", patterns: SIMPLIFIED_NOFO_HEADINGS },
  { id: "federal_nofo", patterns: FEDERAL_NOFO_HEADINGS },
  { id: "cdmrp_pa", patterns: CDMRP_PA_HEADINGS },
];

// ---------------------------------------------------------------------------
// 4 · The NSF program solicitation (PR 5.4)
// ---------------------------------------------------------------------------

/**
 * NSF's own skeleton, which is neither of the three above: `Summary of Program
 * Requirements`, a `Table of Contents`, then `I. Introduction` … `IX. Other
 * Information`. Deliberately **not** added to `ANNOUNCEMENT_HEADING_TABLES` —
 * that list is what the Grants.gov adapter tries on an unidentified attachment,
 * and NSF's route is never unidentified: `adapters/nsf-solicitation.ts` knows
 * from the row's family exactly which document it is reading, so trying four
 * tables and scoring them would only add a way to be wrong.
 *
 * Measured over all 74 distinct open NSF solicitation pages (`NON_NIH_INVENTORY.md`
 * § 4a; the fetch is re-run in this PR):
 *
 *   I. Introduction                              74/74
 *   II. Program Description                      74/74
 *   III. Award Information                       74/74
 *   IV. Eligibility Information                  74/74
 *   V. Proposal Preparation …                    74/74  (53 "And", 21 "and")
 *   VI. NSF Proposal Processing And Review …     74/74
 *   VII. Award Administration Information        74/74
 *   VIII. Agency Contacts                        74/74
 *   IX. Other Information                        74/74  (73 title case, 1 upper)
 *
 * Three decisions the measurement forced:
 *
 *  - **The enumerator is required, but its value is not.** Every body heading
 *    carries a roman numeral; the `Table of Contents` repeats all nine titles
 *    *without* one, and the `Summary of Program Requirements` block repeats
 *    `Award Information`, `Eligibility Information` and
 *    `Award Administration Information` as bare sub-headings. Requiring the
 *    numeral is what keeps both out. Not requiring a *specific* numeral is what
 *    survives a solicitation that omits a part and renumbers the rest.
 *  - **The three terminators carry `other`, and they are load-bearing.**
 *    Without `V.`, `VII.` and `IX.` in the table, `IV. Eligibility Information`
 *    would swallow ten kilobytes of PAPPG boilerplate into group 3 and
 *    `VIII. Agency Contacts` would swallow the whole tail of the page. `other`
 *    feeds no extractor group (`ROLE_GROUP`), so they cost nothing and bound
 *    the blocks that do.
 *  - **`Table of Contents` is a heading, not a contents line.** NSF's HTML
 *    contents entries carry no page numbers and no leader dots, so
 *    `isTableOfContentsLine` cannot see them; matching the *label* is what ends
 *    the summary block before them, and `dedupe: "longest"` then discards the
 *    short `nsf.summary` the contents list re-opens.
 *
 * `II. Program Description` is the `objectives` block and the only section the
 * extractor cannot do without. `SUMMARY OF PROGRAM REQUIREMENTS` and
 * `I. INTRODUCTION` both carry `purpose`, as the plan specifies: they are
 * different sections, so `groupSections` appends them rather than duplicating
 * one section's text.
 */
const NSF_ROMAN = String.raw`[IVX]{1,5}\s*[.):]\s+`;

function nsf(section: string, title: string, roles: SectionRole[]): HeadingPattern {
  return { section, roles, test: new RegExp(`^${NSF_ROMAN}(?:${title})${END}`, "i") };
}

export const NSF_SOLICITATION_HEADINGS: readonly HeadingPattern[] = [
  nsf("nsf.program_description", String.raw`Program\s+Description`, ["objectives"]),
  nsf("nsf.introduction", String.raw`Introduction`, ["purpose"]),
  nsf("nsf.award", String.raw`Award\s+Information`, ["award_info"]),
  nsf("nsf.eligibility", String.raw`Eligibility\s+Information`, ["eligibility"]),
  // "VI. NSF Proposal Processing And Review Procedures", and the older
  // "VI. Proposal Review Information" wording some reissued solicitations keep.
  nsf("nsf.review", String.raw`.{0,60}?Review\s+Procedures|Proposal\s+Review\s+Information(?:\s+Criteria)?`, ["review"]),
  nsf("nsf.contacts", String.raw`(?:Agency|NSF)\s+Contacts?`, ["contacts"]),
  // Terminators: they bound the blocks above and feed no extractor group.
  nsf("nsf.proposal_prep", String.raw`Proposal\s+Preparation\s+and\s+Submission\s+Instructions`, ["other"]),
  nsf("nsf.administration", String.raw`Award\s+Administration\s+Information`, ["other"]),
  nsf("nsf.other", String.raw`Other\s+Information`, ["other"]),
  bare("nsf.summary", String.raw`Summary\s+of\s+Program\s+Requirements`, ["purpose"]),
  bare("nsf.toc", String.raw`Table\s+of\s+Contents`, ["other"]),
];

/** The one table the NSF adapter uses, in `sectionWithBestTable`'s shape. */
export const NSF_HEADING_TABLES: ReadonlyArray<{ id: string; patterns: readonly HeadingPattern[] }> = [
  { id: "nsf_solicitation", patterns: NSF_SOLICITATION_HEADINGS },
];
