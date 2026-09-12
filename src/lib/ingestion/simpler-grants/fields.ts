import { coercePlainTextFromUnknown } from "@/lib/formatting/coerce-plain-text";
import { stripHtmlToText } from "@/lib/formatting/html";

type Raw = Record<string, unknown>;

/** `summary` of a Simpler search hit or detail record, whichever shape the payload has. */
export function opportunitySummaryFromRaw(raw: Raw | null | undefined): Raw | null {
  const s = raw?.summary;
  return s && typeof s === "object" && !Array.isArray(s) ? (s as Raw) : null;
}

/** The notice's summary text as stored in `funding_opportunities.description`. */
export function descriptionFromRaw(raw: Raw | null | undefined): string {
  const sm = opportunitySummaryFromRaw(raw);
  const candidates: unknown[] = [
    sm?.summary_description,
    sm?.summaryDescription,
    raw?.summary_description,
    typeof raw?.summary === "string" ? raw.summary : null,
    raw?.description,
    raw?.opportunity_description,
  ];
  for (const c of candidates) {
    const s = coercePlainTextFromUnknown(c);
    if (!s) continue;
    return stripHtmlToText(s);
  }
  return "";
}

/**
 * Simpler's `agency_contact_description` — for NIH notices the program contact's
 * institute and mailbox ("National Institute of Allergy and Infectious Diseases (NIAID)\n…").
 * Null when the payload has none, so a resolver can tell "absent" from "not read".
 */
export function agencyContactFromRaw(raw: Raw | null | undefined): string | null {
  const sm = opportunitySummaryFromRaw(raw);
  const s = coercePlainTextFromUnknown(sm?.agency_contact_description ?? raw?.agency_contact_description);
  return s ? stripHtmlToText(s).trim() || null : null;
}
