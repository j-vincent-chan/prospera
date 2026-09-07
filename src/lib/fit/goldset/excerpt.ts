/**
 * Notice text for the gold-set CSV (plan § PR 2.4 "the notice title /
 * Section I excerpt"): the Part 1 "Funding Opportunity Purpose" section
 * when the Guide page was parsed (PR 0.5 `guide_sections`), else the first
 * Section I purpose / description section, else the Simpler synopsis; cut
 * to `max` characters on a word boundary. Pure.
 */

export type NoticeSectionLike = { section: string; heading: string; text: string };

export const EXCERPT_MAX = 600;

const clean = (s: string): string =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** Pure. Cuts at `max` characters on the last space before it, with an ellipsis. */
export function cutAt(text: string, max = EXCERPT_MAX): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max - 1);
  const at = slice.lastIndexOf(" ");
  return `${(at > max * 0.6 ? slice.slice(0, at) : slice).trimEnd()}…`;
}

export type Excerpt = { text: string; source: string };

/** Pure. See the module note. */
export function purposeExcerpt(sections: readonly NoticeSectionLike[] | null | undefined, synopsis: string | null | undefined, max = EXCERPT_MAX): Excerpt {
  const list = (sections ?? []).filter((s) => s && typeof s.text === "string" && s.text.trim());
  const purpose = list.find((s) => /funding opportunity purpose/i.test(s.heading));
  if (purpose) return { text: cutAt(clean(purpose.text), max), source: "Part 1 · Funding Opportunity Purpose" };
  const sectionOne = list.filter((s) => s.section === "I");
  const named = sectionOne.find((s) => /purpose|description|objectives|background/i.test(s.heading)) ?? sectionOne[0];
  if (named) return { text: cutAt(clean(named.text), max), source: `Section I · ${clean(named.heading)}` };
  const syn = clean(synopsis ?? "");
  if (syn) return { text: cutAt(syn, max), source: "synopsis" };
  return { text: "", source: "none" };
}

const DESIGNATION_LABEL: Record<string, string> = {
  required: "Clinical Trial Required",
  not_allowed: "Clinical Trial Not Allowed",
  optional: "Clinical Trial Optional",
  besh_required: "Basic Experimental Studies with Humans Required",
};

/** Pure. The stored designation as the CSV shows it. */
export function designationLabel(designation: string | null | undefined): string {
  if (!designation) return "unknown";
  return DESIGNATION_LABEL[designation] ?? designation.replace(/_/g, " ");
}
