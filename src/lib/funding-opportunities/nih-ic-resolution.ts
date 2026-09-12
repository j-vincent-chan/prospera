import { IC_BY_NOTICE_CODE, findNihInstitutes, noticeInstituteCode } from "./nih-institutes";

/**
 * Which NIH institute(s) a notice belongs to (`funding_opportunities.nih_ic_tokens`),
 * resolved from the best source available and stamped with that source.
 *
 * The options, best first. A lower option is consulted only when every option above
 * it is *unavailable* (its input does not exist) or *unsuitable* (the input exists but
 * names no institute we recognise). A lower option never overrides a higher one, even
 * when it would name more institutes; when no option yields an institute the result is
 * `unresolved` — never a guess.
 *
 * Ranking criteria, heaviest first:
 *   1. Declared and complete — the source lists the participating institutes.
 *   2. Declared but partial — the source identifies one institute with certainty
 *      (the one that issued the notice, or the one the program contact sits in) but
 *      not the others.
 *   3. Within a tier, structured over free text — a dedicated section or an
 *      NIH-assigned identifier beats a field someone typed.
 *
 * Measured on 2026-09-12 against the Guide's list for the 512 notices that have one
 * (scripts/backfill-nih-ic-tokens.ts --dry-run prints the same comparison):
 *
 * | rank | source                     | tier                 | against the Guide            |
 * |------|----------------------------|----------------------|------------------------------|
 * | 1    | `guide_participating_orgs` | declared, complete   | —                            |
 * | 2    | `summary_text`             | declared, complete   | 99.1% precision, 85% recall  |
 * | 3    | `notice_number`            | declared, partial    | issuing IC in the list 100%  |
 * | 4    | `agency_contact`           | declared, partial    | in the list 100%, exact 69%  |
 *
 * 1. The NIH Guide's "Components of Participating Organizations" section lists every
 *    institute that will fund the notice, one per line; OD offices that follow "The
 *    following NIH Offices may co-fund …" are not participants and are dropped.
 *    Unavailable when the Guide has not been read; unsuitable when the section is
 *    missing or names nothing we recognise ("All NIH Institutes and Centers").
 * 2. Institute names in the title and Simpler.Grants.gov summary. The summary is the
 *    notice's own purpose statement and names its participants; it was the previous
 *    sole source, and the measurement above is why it sits this high.
 * 3. RFA-XX-…, NOT-XX-… and FOR-XX-… numbers carry the issuing institute's serial code
 *    (AI = NIAID). PA/PAR numbers carry none (unavailable); a code outside NIH — RFA-HS
 *    is AHRQ, RFA-OH is NIOSH — is unsuitable.
 * 4. Simpler's `agency_contact_description` names the program contact's institute
 *    ("National Institute of Allergy and Infectious Diseases (NIAID)\n…@niaid.nih.gov").
 *
 * A caller that cannot re-read an option's input this run (the Simpler sync has no Guide
 * text) passes the stored resolution as `prior`; it stands in for that one option only,
 * at that option's rank, so a nightly Simpler sync cannot demote a Guide-derived answer.
 */

export const NIH_IC_SOURCES = ["guide_participating_orgs", "summary_text", "notice_number", "agency_contact"] as const;
export type NihIcSource = (typeof NIH_IC_SOURCES)[number];
/** What `funding_opportunities.nih_ic_source` holds: the option used, or the explicit flag that none could be. */
export type NihIcSourceColumn = NihIcSource | "unresolved";

export type NihIcAttemptStatus =
  /** This option produced the answer. */
  | "used"
  /** This option's stored answer was carried forward because its input could not be re-read. */
  | "carried"
  /** The option's input does not exist for this notice. */
  | "unavailable"
  /** The input exists but names no institute we recognise. */
  | "no_match"
  /** A higher option already answered; recorded for the audit trail only. */
  | "not_consulted";

export type NihIcAttempt = {
  source: NihIcSource;
  status: NihIcAttemptStatus;
  /** What the option found, empty unless it matched. */
  tokens: string[];
  /** One clause for the reason line. */
  note: string;
};

export type NihIcResolution = {
  tokens: string[];
  source: NihIcSourceColumn;
  /** One sentence: the option used and why the ones above it were passed over, or why none could answer. */
  reason: string;
  attempts: NihIcAttempt[];
};

export type NihIcResolutionInput = {
  opportunity_number?: string | null;
  title?: string | null;
  description?: string | null;
  /**
   * The parsed Guide sections. `undefined` — not read this run (a `prior` from the Guide
   * stands in); `null` or `[]` — read, and there is no Guide text for this notice.
   */
  guide_sections?: ReadonlyArray<{ heading: string; text: string }> | null;
  /** Simpler's `summary.agency_contact_description`. `undefined` — not read this run. */
  agency_contact_description?: string | null;
  /** The stored `nih_ic_tokens` + `nih_ic_source`, for options whose input this caller cannot re-read. */
  prior?: { tokens: string[] | null | undefined; source: string | null | undefined } | null;
};

export const NIH_IC_SOURCE_LABEL: Record<NihIcSourceColumn, string> = {
  guide_participating_orgs: "NIH Guide, participating organizations",
  summary_text: "Notice title and summary",
  notice_number: "Notice number",
  agency_contact: "Simpler.Grants.gov program contact",
  unresolved: "Not determined",
};

const PARTICIPATING_HEADING = /Participating Organization/i;
/** Everything from this line on lists OD offices that may co-fund, not participants. */
const CO_FUND_LINE = /may co-fund/i;

/** The participating-organizations section's text with the co-funder tail removed; null when there is no such section. */
export function participatingOrganizationsText(sections: ReadonlyArray<{ heading: string; text: string }>): string | null {
  const section = sections.find((s) => PARTICIPATING_HEADING.test(s.heading));
  if (!section) return null;
  const lines = section.text.split("\n");
  const cut = lines.findIndex((l) => CO_FUND_LINE.test(l));
  return (cut >= 0 ? lines.slice(0, cut) : lines).join("\n");
}

type Evaluated = { status: Exclude<NihIcAttemptStatus, "not_consulted">; tokens: string[]; note: string };

function carry(input: NihIcResolutionInput, source: NihIcSource, usedNote: string): Evaluated | null {
  const prior = input.prior;
  if (!prior || prior.source !== source) return null;
  const tokens = (prior.tokens ?? []).filter((t): t is string => typeof t === "string" && t.trim().length > 0);
  if (tokens.length === 0) return null;
  return { status: "carried", tokens, note: `${usedNote} (stored answer kept; not re-read this run)` };
}

function evaluateGuide(input: NihIcResolutionInput): Evaluated {
  const usedNote = "From the NIH Guide's participating organizations";
  if (input.guide_sections === undefined) {
    return carry(input, "guide_participating_orgs", usedNote) ?? { status: "unavailable", tokens: [], note: "the NIH Guide was not read this run" };
  }
  if (!input.guide_sections || input.guide_sections.length === 0) {
    return { status: "unavailable", tokens: [], note: "the NIH Guide has not been read for this notice" };
  }
  const text = participatingOrganizationsText(input.guide_sections);
  if (text === null) return { status: "unavailable", tokens: [], note: "the Guide text has no participating-organizations section" };
  const tokens = findNihInstitutes(text, { participants: true });
  if (tokens.length === 0) return { status: "no_match", tokens, note: "the Guide's participating-organizations section names no institute we recognise" };
  return { status: "used", tokens, note: usedNote };
}

function evaluateNumber(input: NihIcResolutionInput): Evaluated {
  const number = (input.opportunity_number ?? "").trim();
  if (!number) return { status: "unavailable", tokens: [], note: "the notice has no number" };
  const code = noticeInstituteCode(number);
  if (!code) return { status: "unavailable", tokens: [], note: `${number.split("-")[0]} numbers carry no institute code` };
  const token = IC_BY_NOTICE_CODE[code];
  if (!token) return { status: "no_match", tokens: [], note: `the ${number.split("-").slice(0, 2).join("-")} code is not an NIH institute` };
  return { status: "used", tokens: [token], note: `From the notice number (${number.split("-").slice(0, 2).join("-")} = ${token})` };
}

function evaluateContact(input: NihIcResolutionInput): Evaluated {
  const usedNote = "From the Simpler.Grants.gov program contact";
  if (input.agency_contact_description === undefined) {
    return carry(input, "agency_contact", usedNote) ?? { status: "unavailable", tokens: [], note: "the Simpler.Grants.gov contact was not read this run" };
  }
  const text = (input.agency_contact_description ?? "").trim();
  if (!text) return { status: "unavailable", tokens: [], note: "no program contact is listed on Simpler.Grants.gov" };
  // The contact sits in the issuing unit, so an OD office named here is the issuer, not a co-funder.
  const tokens = findNihInstitutes(text, { participants: true });
  if (tokens.length === 0) return { status: "no_match", tokens, note: "the Simpler.Grants.gov program contact names no institute" };
  return { status: "used", tokens, note: `${usedNote} (${tokens.join(", ")})` };
}

function evaluateSummary(input: NihIcResolutionInput): Evaluated {
  const usedNote = "From institute names in the title and summary";
  if (input.title === undefined && input.description === undefined) {
    return carry(input, "summary_text", usedNote) ?? { status: "unavailable", tokens: [], note: "the title and summary were not read this run" };
  }
  const text = [input.title, input.description].filter((s): s is string => typeof s === "string" && s.trim().length > 0).join("\n");
  if (!text) return { status: "unavailable", tokens: [], note: "the notice has no title or summary text" };
  const tokens = findNihInstitutes(text);
  if (tokens.length === 0) return { status: "no_match", tokens, note: "the title and summary name no institute" };
  return { status: "used", tokens, note: usedNote };
}

const EVALUATORS: Record<NihIcSource, (input: NihIcResolutionInput) => Evaluated> = {
  guide_participating_orgs: evaluateGuide,
  summary_text: evaluateSummary,
  notice_number: evaluateNumber,
  agency_contact: evaluateContact,
};

function joinClauses(clauses: string[]): string {
  if (clauses.length <= 1) return clauses.join("");
  return `${clauses.slice(0, -1).join(", ")} and ${clauses[clauses.length - 1]}`;
}

/** Walk the options in rank order; stop at the first that answers. */
export function resolveNihIcTokens(input: NihIcResolutionInput): NihIcResolution {
  const attempts: NihIcAttempt[] = [];
  let winner: NihIcAttempt | null = null;
  for (const source of NIH_IC_SOURCES) {
    if (winner) {
      attempts.push({ source, status: "not_consulted", tokens: [], note: "not consulted" });
      continue;
    }
    const attempt: NihIcAttempt = { source, ...EVALUATORS[source](input) };
    attempts.push(attempt);
    if (attempt.status === "used" || attempt.status === "carried") winner = attempt;
  }
  const passedOver = attempts.filter((a) => a.status === "unavailable" || a.status === "no_match").map((a) => a.note);
  if (!winner) {
    return { tokens: [], source: "unresolved", reason: `Not determined: ${joinClauses(passedOver)}.`, attempts };
  }
  const reason = passedOver.length ? `${winner.note}; ${joinClauses(passedOver)}.` : `${winner.note}.`;
  return { tokens: winner.tokens, source: winner.source, reason, attempts };
}

export function isNihIcSourceColumn(value: unknown): value is NihIcSourceColumn {
  return value === "unresolved" || (NIH_IC_SOURCES as readonly string[]).includes(String(value));
}

/** Rank of a stored `nih_ic_source`; lower is better; `unresolved`, null and unknown strings rank last. */
export function nihIcSourceRank(source: string | null | undefined): number {
  const i = (NIH_IC_SOURCES as readonly string[]).indexOf(source ?? "");
  return i === -1 ? NIH_IC_SOURCES.length : i;
}
