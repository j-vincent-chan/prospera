/**
 * Strict PubMed esearch terms: author (last + first + optional middle initial) AND UCSF affiliation.
 */

export const UCSF_AFFILIATION_CLAUSE = [
  '"University of California San Francisco"[Affiliation]',
  '"University of California, San Francisco"[Affiliation]',
  '"Univ of California San Francisco"[Affiliation]',
  '"University of California SF"[Affiliation]',
  "UCSF[Affiliation]",
].join(" OR ");

export type PubmedInvestigatorName = {
  firstName: string;
  lastName: string;
  middleInitial?: string | null;
  fullName?: string | null;
};

function normalizePart(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseNameFromFullName(fullName: string): {
  firstName: string;
  lastName: string;
  middleInitial: string | null;
} {
  const parts = normalizePart(fullName).split(" ").filter(Boolean);
  if (parts.length < 2) {
    return { firstName: parts[0] ?? "", lastName: "", middleInitial: null };
  }
  const firstName = parts[0] ?? "";
  const lastName = parts[parts.length - 1] ?? "";
  let middleInitial: string | null = null;
  if (parts.length >= 3) {
    const middle = parts.slice(1, -1).join(" ");
    const letter = middle.replace(/\./g, "").trim()[0];
    middleInitial = letter ? letter.toUpperCase() : null;
  }
  return { firstName, lastName, middleInitial };
}

function splitStructuredFirstName(firstName: string): {
  firstName: string;
  middleInitial: string | null;
} {
  const parts = normalizePart(firstName).split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const middleToken = parts[1]?.replace(/\./g, "").trim() ?? "";
    if (middleToken.length === 1) {
      return {
        firstName: parts[0] ?? "",
        middleInitial: middleToken.toUpperCase(),
      };
    }
  }
  return { firstName: normalizePart(firstName), middleInitial: null };
}

function normalizeNameToken(value: string): string {
  return value.replace(/\./g, "").trim().toLowerCase();
}

/**
 * Middle initial implied by full_name once the structured first and last
 * names are accounted for. "Nam Woo Cho" with first_name "Nam Woo" has no
 * middle name; the old parser produced a phantom "W" (PR 0.1b diagnosis).
 */
function middleInitialFromFullName(fullName: string, firstName: string, lastName: string): string | null {
  const tokens = normalizePart(fullName).split(" ").filter(Boolean);
  if (tokens.length < 3) return null;
  const consumed = new Set(
    [...firstName.split(/\s+/), ...lastName.split(/\s+/)].map(normalizeNameToken).filter(Boolean)
  );
  const leftover = tokens.slice(1, -1).filter((t) => !consumed.has(normalizeNameToken(t)));
  const letter = leftover[0]?.replace(/\./g, "")[0];
  return letter ? letter.toUpperCase() : null;
}

export function resolvePubmedInvestigatorName(input: PubmedInvestigatorName): {
  firstName: string;
  lastName: string;
  middleInitial: string | null;
} {
  const parsed = parseNameFromFullName(input.fullName ?? "");
  const fromFirstField = splitStructuredFirstName(normalizePart(input.firstName));
  const firstName = fromFirstField.firstName || parsed.firstName;
  const lastName = normalizePart(input.lastName) || parsed.lastName;
  const middleFromField = normalizePart(input.middleInitial ?? "")
    .replace(/\./g, "")
    .slice(0, 1)
    .toUpperCase();
  const middleInitial =
    middleFromField ||
    fromFirstField.middleInitial ||
    middleInitialFromFullName(input.fullName ?? "", firstName, lastName) ||
    null;

  return { firstName, lastName, middleInitial };
}

/** PubMed author field: `Lee James C[Author]` when first + middle are known; else `He Peng[Author]`. */
export function pubmedAuthorVariants(
  lastName: string,
  firstName: string,
  middleInitial: string | null
): string[] {
  const last = normalizePart(lastName);
  const first = normalizePart(firstName);
  const firstLetter = first[0]?.toUpperCase();
  if (!last || !firstLetter) return [];

  if (middleInitial) {
    const mi = middleInitial.replace(/\./g, "").slice(0, 1).toUpperCase();
    if (first.length >= 2) {
      return [`${last} ${first} ${mi}[Author]`];
    }
    return [`${last} ${firstLetter}${mi}[Author]`];
  }
  if (first.length >= 2) {
    return [`${last} ${first}[Author]`];
  }
  return [`${last} ${firstLetter}[Author]`];
}

const AMBIGUOUS_FIRST_NAMES = new Set([
  "james",
  "michael",
  "david",
  "john",
  "robert",
  "william",
  "richard",
  "thomas",
  "mark",
  "paul",
  "daniel",
  "andrew",
  "christopher",
  "matthew",
  "joseph",
  "kevin",
  "brian",
  "eric",
  "steven",
  "peter",
  "peng",
  "ping",
  "alexander",
  "benjamin",
  "samuel",
  "ryan",
  "justin",
  "joshua",
  "george",
  "charles",
  "anthony",
  "donald",
  "kenneth",
  "stephen",
  "timothy",
  "ronald",
  "edward",
  "jason",
  "jeffrey",
  "gregory",
  "patrick",
  "raymond",
  "jack",
  "dennis",
]);

const AMBIGUOUS_LAST_NAMES = new Set([
  "lee",
  "kim",
  "chen",
  "wang",
  "li",
  "zhang",
  "liu",
  "wu",
  "lin",
  "yang",
  "huang",
  "zhao",
  "zhou",
  "xu",
  "sun",
  "ma",
  "he",
  "wilson",
  "anderson",
  "brown",
  "jones",
  "johnson",
  "smith",
  "martin",
  "garcia",
  "nguyen",
  "chan",
  "wong",
  "park",
  "choi",
  "kang",
  "tan",
  "ho",
  "young",
  "king",
  "wright",
  "hill",
  "green",
  "adams",
  "baker",
  "nelson",
  "carter",
  "mitchell",
  "roberts",
  "turner",
  "phillips",
  "campbell",
  "parker",
  "evans",
  "edwards",
  "collins",
  "stewart",
  "morris",
  "rogers",
  "reed",
  "cook",
  "morgan",
  "bell",
  "murphy",
  "bailey",
  "rivera",
  "cooper",
  "richardson",
  "cox",
  "howard",
  "ward",
  "torres",
  "peterson",
  "gray",
  "ramirez",
  "james",
  "watson",
  "brooks",
  "kelly",
  "sanders",
  "price",
  "bennett",
  "wood",
  "barnes",
  "ross",
  "henderson",
  "coleman",
  "jenkins",
  "perry",
  "powell",
  "long",
  "patterson",
  "hughes",
  "flores",
  "washington",
  "butler",
  "simmons",
  "foster",
  "gonzalez",
  "bryant",
  "alexander",
  "russell",
  "griffin",
  "diaz",
  "hayes",
]);

/** Names that need a stored middle_initial for reliable PubMed disambiguation at UCSF. */
export function pubmedNameRequiresMiddleInitial(firstName: string, lastName: string): boolean {
  const first = normalizePart(firstName).toLowerCase();
  const last = normalizePart(lastName).toLowerCase();
  if (!first || !last) return false;
  if (last === "lee" && first === "james") return true;
  if (last === "wilson" && first === "michael") return true;
  if (last === "he" && (first === "peng" || first === "ping")) return true;
  if (AMBIGUOUS_FIRST_NAMES.has(first) && AMBIGUOUS_LAST_NAMES.has(last)) return true;
  return false;
}

/** When set, PubMed author XML must show a middle initial that matches (not just last+first+UCSF). */
export function strictMiddleRequiredOnAuthorRecord(
  resolved: ReturnType<typeof resolvePubmedInvestigatorName>
): boolean {
  if (!resolved.middleInitial) return false;
  if (!pubmedNameRequiresMiddleInitial(resolved.firstName, resolved.lastName)) return false;
  // Very short last names (He, Li, Wu) often only publish a single Initials letter in PubMed.
  if (normalizePart(resolved.lastName).length <= 2) return false;
  return true;
}

export function middleInitialFromColumn(input: PubmedInvestigatorName): string | null {
  const fromColumn = normalizePart(input.middleInitial ?? "")
    .replace(/\./g, "")
    .slice(0, 1)
    .toUpperCase();
  return fromColumn || null;
}

export function pubmedNameResolutionError(input: PubmedInvestigatorName): string | null {
  const resolved = resolvePubmedInvestigatorName(input);
  if (!resolved.lastName || !resolved.firstName) {
    return "Set first and last name (or full_name) before refreshing PubMed.";
  }
  if (!pubmedNameRequiresMiddleInitial(resolved.firstName, resolved.lastName)) {
    return null;
  }
  const fromColumn = middleInitialFromColumn(input);
  if (!fromColumn) {
    return `Ambiguous name "${resolved.firstName} ${resolved.lastName}" — set middle_initial on this investigator (e.g. C for James C Lee). PubMed uses Last + First + Middle Initial + UCSF affiliation; parsing from full_name alone is not allowed for this name.`;
  }
  if (!resolved.middleInitial) {
    return `Ambiguous name "${resolved.firstName} ${resolved.lastName}" — middle_initial "${fromColumn}" could not be aligned with first/last name.`;
  }
  return null;
}

/** `(term) AND (UCSF affiliation variants)`. */
export function withUcsfAffiliation(term: string): string {
  return `(${term}) AND (${UCSF_AFFILIATION_CLAUSE})`;
}

/**
 * Build esearch term: (author variants) AND (UCSF affiliation variants).
 * Returns empty string when last/first cannot be resolved.
 */
export function buildStrictPubmedTerm(input: PubmedInvestigatorName): string {
  const { firstName, lastName, middleInitial } = resolvePubmedInvestigatorName(input);
  const authorVariants = pubmedAuthorVariants(lastName, firstName, middleInitial);
  if (authorVariants.length === 0) return "";

  return withUcsfAffiliation(authorVariants[0]!);
}

/**
 * Initials author variant, the form PubMed indexes for every record:
 * `Ansel KM[Author]`, `Cho NW[Author]` (one letter per given-name token, then
 * the middle initial). Rung c of the identity ladder (PR 0.1b): catches people
 * whose records carry initials only, or who publish under a different given
 * name (Art → Arthur Weiss, Karl → K. Mark Ansel).
 */
export function pubmedInitialsAuthorVariant(
  lastName: string,
  firstName: string,
  middleInitial: string | null
): string {
  const last = normalizePart(lastName);
  const given = normalizePart(firstName)
    .split(/\s+/)
    .map((t) => t.replace(/\./g, "")[0]?.toUpperCase() ?? "")
    .join("");
  if (!last || !given) return "";
  const mi = middleInitial ? middleInitial.replace(/\./g, "").slice(0, 1).toUpperCase() : "";
  const initials = given.endsWith(mi) && mi && given.length > 1 ? given : `${given}${mi}`;
  return `${last} ${initials}[Author]`;
}

/** Initials variant AND UCSF affiliation. Empty when the name cannot be resolved. */
export function buildInitialsPubmedTerm(input: PubmedInvestigatorName): string {
  const { firstName, lastName, middleInitial } = resolvePubmedInvestigatorName(input);
  const variant = pubmedInitialsAuthorVariant(lastName, firstName, middleInitial);
  return variant ? withUcsfAffiliation(variant) : "";
}

/** Initials variant with no affiliation clause (the "unaffiliated" count in the coverage report). */
export function buildUnaffiliatedInitialsTerm(input: PubmedInvestigatorName): string {
  const { firstName, lastName, middleInitial } = resolvePubmedInvestigatorName(input);
  return pubmedInitialsAuthorVariant(lastName, firstName, middleInitial);
}

/** ORCID author-identifier search (`0000-0002-1825-0097[auid]`). Rung d; needs no affiliation clause. */
export function buildOrcidPubmedTerm(orcid: string | null | undefined): string {
  const id = String(orcid ?? "").trim().replace(/^https?:\/\/orcid\.org\//i, "");
  if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/i.test(id)) return "";
  return `${id.toUpperCase()}[auid]`;
}
