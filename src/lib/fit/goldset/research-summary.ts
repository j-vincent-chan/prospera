/**
 * The research summary the calibration card shows under the investigator
 * (redesign § 1.6). Pure: grant rows and the UCSF Profiles narrative in, the
 * one paragraph a grader reads out.
 *
 * Order of preference, and why:
 *  1. `investigator_nih_grants.phr_text` — NIH's Public Health Relevance
 *     statement, which the application guide requires to be a brief
 *     plain-language account of what the work does and why it matters. It is
 *     the only field here written *to be* a summary.
 *  2. `investigator_nih_grants.abstract` — the project abstract, clamped. More
 *     technical and much longer, but it names the model systems and disease
 *     area a grader is judging against.
 *  3. The Profiles narrative — free text with no defined purpose, so it is
 *     taken only when it reads like research at all. Faculty commonly use the
 *     field for clinic contact details ("Please call UCSF Dermatology at … for
 *     appointments"), which tells a grader nothing and crowds out the evidence
 *     titles beneath it.
 *
 * Every one of these is source material the fit engine reads too, never the
 * engine's own verdict — a grader must judge the pair independently, and
 * nothing here reports what the engine concluded.
 */

export type ResearchSummary = {
  text: string;
  /** Provenance for the card's eyebrow: "NIH RePORTER · R03 FY2023", "UCSF Profiles". */
  source: string;
};

export type GrantSummaryRow = {
  activity_code: string | null;
  fiscal_year: number | null;
  abstract: string | null;
  phr_text: string | null;
  is_contact_pi: boolean | null;
};

/** A US phone number in any of the shapes the Profiles narratives use. */
const PHONE = /\b\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;

/** Clinic-directory boilerplate: the narrative is an appointment notice, not a research account. */
const CONTACT_NOISE = /\b(appointments?|clinical care|not monitored|to schedule|for referrals?|please call|telephone)\b/i;

/** Below this a narrative is a directory blurb ("Dermatologist.") rather than a summary. */
const MIN_NARRATIVE = 80;

/**
 * Pure. Whether a Profiles narrative reads as research rather than as clinic
 * contact details. Deliberately strict: a false negative only omits the block,
 * while a false positive puts a phone number where the science should be.
 */
export function looksLikeResearchNarrative(raw: string | null | undefined): boolean {
  const text = (raw ?? "").trim();
  if (text.length < MIN_NARRATIVE) return false;
  if (PHONE.test(text)) return false;
  if (CONTACT_NOISE.test(text)) return false;
  return true;
}

/**
 * Pure. Trim prose to `max` characters on a sentence boundary where one is
 * near the limit, else on a word boundary; an ellipsis marks the cut.
 */
export function clampProse(raw: string, max: number): string {
  const text = raw.trim();
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf("? "), head.lastIndexOf("! "));
  if (sentence >= max * 0.6) return head.slice(0, sentence + 1);
  const word = head.lastIndexOf(" ");
  return `${(word > 0 ? head.slice(0, word) : head).replace(/[.,;:]$/, "")}…`;
}

/** The grant label the eyebrow carries: "NIH RePORTER · R03 FY2023", degrading as fields are missing. */
function grantSource(row: GrantSummaryRow): string {
  const parts = [row.activity_code, row.fiscal_year ? `FY${row.fiscal_year}` : null].filter(Boolean);
  return parts.length ? `NIH RePORTER · ${parts.join(" ")}` : "NIH RePORTER";
}

/**
 * Pure. The best grant summary among an investigator's awards: the newest
 * award carrying a relevance statement, preferring one where they are the
 * contact PI (their own programme rather than a project they support); an
 * abstract only when no award has a statement. Rows may arrive in any order.
 */
export function pickGrantSummary(rows: readonly GrantSummaryRow[], abstractMax = 600): ResearchSummary | null {
  const rank = (r: GrantSummaryRow) => [r.is_contact_pi === true ? 1 : 0, r.fiscal_year ?? 0] as const;
  const newestFirst = (a: GrantSummaryRow, b: GrantSummaryRow) => {
    const [ac, ay] = rank(a);
    const [bc, by] = rank(b);
    return bc - ac || by - ay;
  };
  const sorted = [...rows].sort(newestFirst);
  const withPhr = sorted.find((r) => (r.phr_text ?? "").trim().length >= 40);
  if (withPhr) return { text: clampProse(withPhr.phr_text!, abstractMax), source: grantSource(withPhr) };
  const withAbstract = sorted.find((r) => (r.abstract ?? "").trim().length >= 40);
  if (withAbstract) return { text: clampProse(withAbstract.abstract!, abstractMax), source: grantSource(withAbstract) };
  return null;
}

/** Pure. The card's summary: a grant statement when there is one, else a Profiles narrative that reads like research. */
export function researchSummaryOf(grants: readonly GrantSummaryRow[], narrative: string | null, abstractMax = 600): ResearchSummary | null {
  const grant = pickGrantSummary(grants, abstractMax);
  if (grant) return grant;
  if (looksLikeResearchNarrative(narrative)) return { text: narrative!.trim(), source: "UCSF Profiles" };
  return null;
}
