/**
 * ORCID iD parsing and validation (PR 0.7). Pure: no network, no Supabase.
 *
 * An iD is 16 characters in four hyphenated groups; the last character is a
 * check character computed with ISO 7064 MOD 11-2 (the ISNI scheme ORCID
 * adopted), so a mistyped digit is caught before anything is written.
 * Accepts the bare iD, the https://orcid.org/… URL form and the 16
 * characters without hyphens; normalizes to the hyphenated upper-case form
 * ORCID itself displays. The ORCID API connector re-exports these so every
 * caller validates the same way.
 */

export const ORCID_RE = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

/** An iD-shaped token bounded by non-alphanumerics, so a trailing stray digit is not silently dropped. */
const ORCID_TOKEN = /(?:^|[^0-9A-Z])(\d{4}-\d{4}-\d{4}-\d{3}[\dX])(?![0-9A-Z])/;

export type OrcidParseFailure = "empty" | "format" | "checksum";

export type OrcidParseResult = { ok: true; orcid: string } | { ok: false; reason: OrcidParseFailure };

/** What to tell the person for each failure; the empty case is for callers that require an iD. */
export const ORCID_PROBLEM: Record<OrcidParseFailure, string> = {
  empty: "Enter an ORCID iD.",
  format: "That doesn't look like an ORCID iD (0000-0000-0000-0000).",
  checksum: "The last character of that ORCID iD doesn't check out — one digit is probably mistyped.",
};

/** Candidate in canonical shape, or null when the input holds no iD-shaped token. */
function candidate(input: string): string | null {
  const t = input.trim().toUpperCase();
  if (!t) return null;
  const m = t.match(ORCID_TOKEN);
  if (m) return m[1]!;
  if (/^\d{15}[\dX]$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 8)}-${t.slice(8, 12)}-${t.slice(12)}`;
  return null;
}

/** ISO 7064 MOD 11-2 check character over the 15 leading digits, as ORCID specifies. */
export function orcidChecksumOk(id: string): boolean {
  const digits = id.replace(/-/g, "").toUpperCase();
  if (!/^\d{15}[\dX]$/.test(digits)) return false;
  let total = 0;
  for (let i = 0; i < 15; i += 1) total = (total + Number(digits[i])) * 2;
  const remainder = total % 11;
  const result = (12 - remainder) % 11;
  const check = result === 10 ? "X" : String(result);
  return digits[15] === check;
}

/** Validate and normalize; the failure reason lets a form say what was wrong. */
export function parseOrcid(input: string | null | undefined): OrcidParseResult {
  if (input == null || !input.trim()) return { ok: false, reason: "empty" };
  const c = candidate(input);
  if (!c || !ORCID_RE.test(c)) return { ok: false, reason: "format" };
  if (!orcidChecksumOk(c)) return { ok: false, reason: "checksum" };
  return { ok: true, orcid: c };
}

/** Accepts "0000-0002-1825-0097", "https://orcid.org/0000-…", or digits without hyphens; null when invalid. */
export function normalizeOrcid(input: string | null | undefined): string | null {
  const r = parseOrcid(input);
  return r.ok ? r.orcid : null;
}

export function orcidUrl(orcid: string): string {
  return `https://orcid.org/${orcid}`;
}
