/**
 * Verify a PubMed record lists the investigator as an author with UCSF affiliation
 * on that same author entry (esearch Author+Affiliation can match across co-authors).
 */

import {
  resolvePubmedInvestigatorName,
  strictMiddleRequiredOnAuthorRecord,
  type PubmedInvestigatorName,
} from "@/lib/community/pubmed-query";

export type PubmedParsedAuthor = {
  lastName: string;
  foreName: string;
  initials: string;
  affiliations: string[];
  /** `<Author EqualContrib="Y">` — PubMed's co-first / equal-contribution marker. */
  equalContrib: boolean;
  /** `<Identifier Source="ORCID">` on the entry, as printed (bare `0000-…` or the https://orcid.org/ form). */
  orcid: string | null;
};

export type ResolvedPubmedName = ReturnType<typeof resolvePubmedInvestigatorName>;

export function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function stripInnerTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXmlEntities(stripInnerTags(match[1] ?? "")) : "";
}

export function parsePubmedArticleAuthors(xml: string): PubmedParsedAuthor[] {
  const authors: PubmedParsedAuthor[] = [];
  const authorBlocks = xml.match(/<Author\b[^>]*>[\s\S]*?<\/Author>/gi) ?? [];

  for (const block of authorBlocks) {
    if (/<CollectiveName>/i.test(block)) continue;
    const lastName = extractTag(block, "LastName");
    if (!lastName) continue;

    const affiliations: string[] = [];
    for (const match of block.matchAll(/<Affiliation>([\s\S]*?)<\/Affiliation>/gi)) {
      const text = decodeXmlEntities(stripInnerTags(match[1] ?? ""));
      if (text) affiliations.push(text);
    }

    authors.push({
      lastName,
      foreName: extractTag(block, "ForeName"),
      initials: extractTag(block, "Initials"),
      affiliations,
      equalContrib: /<Author\b[^>]*\bEqualContrib="Y"/i.test(block),
      orcid: block.match(/<Identifier\b[^>]*\bSource="ORCID"[^>]*>([^<]*)<\/Identifier>/i)?.[1]?.trim() || null,
    });
  }

  return authors;
}

export function isUcsfAffiliation(text: string): boolean {
  const normalized = text.toLowerCase().replace(/\s+/g, " ");
  if (/\bucsf\b/.test(normalized)) return true;
  if (/university of california[, ]+san francisco/.test(normalized)) return true;
  if (/univ(?:ersity)?\.?\s+of\s+california[, ]+san\s+francisco/.test(normalized)) return true;
  if (/university of california[, ]+sf\b/.test(normalized)) return true;
  return false;
}

/** Letters only, diacritics folded: "Nicolás-Ávila" and "Nicolas Avila" compare equal. */
function normalizeLetters(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/gi, "")
    .toLowerCase();
}

export function lastNameMatches(authorLast: string, investigatorLast: string): boolean {
  return normalizeLetters(authorLast) === normalizeLetters(investigatorLast);
}

function normalizePart(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeNameToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\./g, "")
    .trim()
    .toLowerCase();
}

function firstNameMatches(
  author: PubmedParsedAuthor,
  investigatorFirst: string,
  /** Ambiguous names (James C Lee) reject records that carry no fore name at all. */
  strictAmbiguous: boolean
): boolean {
  const target = normalizePart(investigatorFirst);
  if (!target) return false;

  const firstForeToken = normalizePart(author.foreName).split(/\s+/)[0] ?? "";
  const initials = normalizedAuthorInitials(author);
  // Two-token given names ("Nam Woo", "Mary Helen") compare on their first token;
  // the second token shows up as the second initial, not as a middle name.
  const targetFirst = normalizeNameToken(target).split(/\s+/)[0] ?? "";
  if (!targetFirst) return false;

  if (firstForeToken.length > 0) {
    const tokenLower = normalizeNameToken(firstForeToken);
    // Abbreviated fore name on the record ("K Mark" for Karl M Ansel): compare the initial.
    // The middle initial and the UCSF affiliation are still checked by the caller.
    if (tokenLower.length === 1) {
      return tokenLower === targetFirst[0];
    }
    if (targetFirst.length >= 2) {
      if (tokenLower === targetFirst) return true;
      if (tokenLower.startsWith(`${targetFirst}-`)) return true;
      // Short form on the roster, full form on the record (Art → Arthur, Dan → Daniel).
      // Three letters minimum; last name, middle initial and affiliation still gate.
      if (targetFirst.length >= 3 && tokenLower.startsWith(targetFirst)) return true;
      return false;
    }
    return tokenLower[0] === targetFirst[0];
  }

  // No fore name on the record (older PubMed entries carry Initials only).
  if (strictAmbiguous && targetFirst.length >= 2) {
    return false;
  }

  if (targetFirst.length >= 2) {
    if (initials.toLowerCase() === targetFirst) return true;
    // Initials-only record ("KM" for Karl M): the first letter must agree; the
    // middle letter is checked by middleInitialMatches.
    return !!initials && initials[0]!.toLowerCase() === targetFirst[0];
  }

  return initials[0]?.toLowerCase() === targetFirst[0];
}

/** Number of given-name tokens the investigator uses ("Nam Woo" → 2); the middle initial sits after them. */
function givenTokenCount(firstName: string): number {
  return Math.max(1, normalizePart(firstName).split(/\s+/).filter(Boolean).length);
}

function middleInitialMatches(author: PubmedParsedAuthor, requiredMiddle: string, givenCount = 1): boolean {
  const required = requiredMiddle.replace(/\./g, "").trim()[0]?.toUpperCase();
  if (!required) return true;
  // PubMed often lists only a single Initials letter (first name); do not reject when no middle on record.
  if (!authorHasMiddleOnRecord(author, givenCount)) return true;

  const initials = normalizedAuthorInitials(author);
  const foreParts = author.foreName.split(/\s+/).filter(Boolean);

  if (foreParts.length > givenCount) {
    const fromFore = foreParts[givenCount]?.replace(/\./g, "")[0]?.toUpperCase();
    if (fromFore && fromFore !== required) return false;
  }

  if (initials.length > givenCount && initials[givenCount] !== required) return false;

  if (initials.length > givenCount && initials[givenCount] === required) return true;

  if (foreParts.length > givenCount) {
    const fromFore = foreParts[givenCount]?.replace(/\./g, "")[0]?.toUpperCase();
    if (fromFore === required) return true;
  }

  return false;
}

function normalizedAuthorInitials(author: PubmedParsedAuthor): string {
  return author.initials.replace(/[^A-Za-z]/g, "").toUpperCase();
}

/**
 * PubMed author entry carries a middle initial beyond the investigator's given
 * names: a single-letter ForeName token after them, or more Initials letters
 * than given-name tokens ("NW" for Nam Woo is not a middle initial).
 */
export function authorHasMiddleOnRecord(author: PubmedParsedAuthor, givenCount = 1): boolean {
  const foreParts = author.foreName.split(/\s+/).filter(Boolean);
  if (foreParts.length > givenCount) {
    const middleToken = foreParts[givenCount]?.replace(/\./g, "").trim() ?? "";
    if (middleToken.length === 1) return true;
  }
  const initials = normalizedAuthorInitials(author);
  if (initials.length > givenCount) return true;
  return false;
}

export function authorEntryMatchesInvestigator(
  author: PubmedParsedAuthor,
  investigator: ResolvedPubmedName
): boolean {
  if (!lastNameMatches(author.lastName, investigator.lastName)) return false;
  if (!firstNameMatches(author, investigator.firstName, strictMiddleRequiredOnAuthorRecord(investigator))) return false;

  const givenCount = givenTokenCount(investigator.firstName);
  const authorMiddle = authorHasMiddleOnRecord(author, givenCount);
  if (authorMiddle && !investigator.middleInitial) return false;
  if (!investigator.middleInitial) {
    return author.affiliations.some(isUcsfAffiliation);
  }
  if (strictMiddleRequiredOnAuthorRecord(investigator) && !authorMiddle) return false;
  if (!middleInitialMatches(author, investigator.middleInitial, givenCount)) return false;
  return author.affiliations.some(isUcsfAffiliation);
}

export function investigatorListedWithUcsfAffiliation(
  xml: string,
  investigator: PubmedInvestigatorName
): boolean {
  const resolved = resolvePubmedInvestigatorName(investigator);
  if (!resolved.lastName || !resolved.firstName) return false;
  const authors = parsePubmedArticleAuthors(xml);
  return authors.some((author) => authorEntryMatchesInvestigator(author, resolved));
}

/**
 * Weaker check for RePORTER-linked PMIDs (identity ladder rung e): the
 * investigator's last name appears on an author entry, affiliation ignored.
 * Grant linkages on P01 / T32 projects carry trainee papers; this keeps only
 * the ones the person is actually on.
 */
export function investigatorLastNameListed(xml: string, investigator: PubmedInvestigatorName): boolean {
  const resolved = resolvePubmedInvestigatorName(investigator);
  if (!resolved.lastName) return false;
  return parsePubmedArticleAuthors(xml).some((author) => lastNameMatches(author.lastName, resolved.lastName));
}
