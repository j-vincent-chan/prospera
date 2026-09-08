/**
 * Which funder family a notice belongs to, and which adapter reads it (PR 5.2).
 *
 * An explicit table, not heuristics: `agency_code` first, the
 * `opportunity_number` shape second, the `agency` display string last and only
 * as a tie-breaker. `funding-opportunities/agency-taxonomy.ts` matches display
 * strings for the UI's filters, so it is a vocabulary worth reusing but not a
 * router — `agency` is free text from Simpler and changes wording.
 *
 * The family decides nothing about relevance. D67 is explicit that no
 * corpus-level filter by agency or subject may exist: Prospera serves several
 * communities off one notice table, and the same USDA or DOT row is a lead for
 * one and noise for another. This table only says *where the announcement text
 * lives*, which is a fact about the funder's website.
 */
import type { NoticeSection } from "@/lib/fit/profile/opportunity-extract";

export type FunderFamily = "nih" | "hhs_other" | "nsf" | "dod_cdmrp" | "doe" | "other_federal" | "foundation" | "internal";

/** The columns the router reads; every caller has these. */
export type FunderRow = {
  agency_code?: string | null;
  agency?: string | null;
  opportunity_number?: string | null;
  source_system?: string | null;
};

/** `agency_code` prefixes, longest first so `HHS-NIH11` beats `HHS-`. */
const BY_AGENCY_CODE: ReadonlyArray<readonly [string, FunderFamily]> = [
  ["HHS-NIH", "nih"],
  ["DOD-AMRAA", "dod_cdmrp"],
  ["NSF", "nsf"],
  ["DOE-", "doe"],
  ["PAMS-", "doe"],
  ["HHS-", "hhs_other"],
];

/** Number shapes that decide a family on their own when the agency code does not. */
const BY_NUMBER: ReadonlyArray<readonly [RegExp, FunderFamily]> = [
  // NIH Guide announcement numbers, including the CDC/NIOSH and AHRQ RFA- forms
  // the Guide sync already targets.
  [/^(?:PA|PAR|PAS)-\d{2}-\d{3}$/i, "nih"],
  [/^RFA-[A-Z]{2}-\d{2}-\d{3}$/i, "nih"],
  // CDMRP funding opportunity numbers: HT9425 + FY + program + mechanism, and
  // the pre-2023 W81XWH- form.
  [/^HT\d{4}\d{2}[A-Z0-9]+$/i, "dod_cdmrp"],
  [/^W81XWH-\d{2}-/i, "dod_cdmrp"],
  // NSF publication numbers ("26-507"); PD- are program descriptions, still NSF.
  [/^\d{2}-\d{3}$/, "nsf"],
  [/^PD-\d{2}-/i, "nsf"],
];

/** `source_system` values that are not federal at all. */
const BY_SOURCE_SYSTEM: Readonly<Record<string, FunderFamily>> = {
  foundation: "foundation",
  internal: "internal",
  ucsf_internal: "internal",
};

export function funderFamilyOf(row: FunderRow): FunderFamily {
  const system = (row.source_system ?? "").trim().toLowerCase();
  if (system && BY_SOURCE_SYSTEM[system]) return BY_SOURCE_SYSTEM[system]!;

  const code = (row.agency_code ?? "").trim().toUpperCase();
  for (const [prefix, family] of BY_AGENCY_CODE) {
    if (code.startsWith(prefix)) return family;
  }

  const number = (row.opportunity_number ?? "").trim();
  for (const [re, family] of BY_NUMBER) {
    if (re.test(number)) return family;
  }

  // `agency` last: a display string, only ever a tie-breaker.
  const agency = (row.agency ?? "").toLowerCase();
  if (/national science foundation/.test(agency)) return "nsf";
  if (/department of energy/.test(agency)) return "doe";
  if (/congressionally directed medical research|cdmrp/.test(agency)) return "dod_cdmrp";

  return "other_federal";
}

// ---------------------------------------------------------------------------
// The adapter registry
// ---------------------------------------------------------------------------

/** Where a document was read from; mirrors `funding_opportunities.guide_source`. */
export type AnnouncementSource =
  | "grants_nih_gov"
  | "simpler_attachment"
  | "grants_gov_attachment"
  | "nsf_solicitation"
  | "cdmrp_pa"
  | "landing_page"
  | "synopsis";

export const ANNOUNCEMENT_SOURCES: readonly AnnouncementSource[] = [
  "grants_nih_gov",
  "simpler_attachment",
  "grants_gov_attachment",
  "nsf_solicitation",
  "cdmrp_pa",
  "landing_page",
  "synopsis",
];

/** One candidate document for a notice, in the order the adapter wants them tried. */
export type AnnouncementTarget = { url: string; source: AnnouncementSource; note?: string };

/** What one acquisition attempt produced. */
export type Acquisition =
  | { status: "ok"; url: string; source: AnnouncementSource; sections: NoticeSection[]; textHash: string; pageFetches: number; simplerCalls: number; extra?: Record<string, unknown> }
  | { status: "unchanged"; url: string; source: AnnouncementSource; textHash: string; pageFetches: number; simplerCalls: number; extra?: Record<string, unknown> }
  | { status: "not_found" | "error"; url: string | null; source: AnnouncementSource | null; error: string | null; pageFetches: number; simplerCalls: number; extra?: Record<string, unknown> };

/**
 * An adapter owns one funder family's route from a notice row to sectioned text.
 *
 * `acquire` deliberately owns the whole per-notice flow rather than exposing a
 * declarative list of targets. The NIH route is *adaptive*: it reads the classic
 * Guide page first and only calls the Simpler API when that 404s, which is what
 * bounds the API cost to one GET per affected notice. A `resolve() → targets[]`
 * interface would have to resolve every notice up front, and PR 5.2 may not
 * change NIH behaviour. Adapters that genuinely do have a static target list
 * (PRs 5.3–5.5) use `firstUsableTarget` inside `acquire`.
 */
export type AnnouncementAdapter<Row, Deps> = {
  id: string;
  family: FunderFamily;
  applies(row: Row): boolean;
  acquire(row: Row, deps: Deps): Promise<Acquisition>;
};

/** Try targets in order; the first whose document yields sections the caller accepts wins. */
export async function firstUsableTarget<T>(
  targets: readonly AnnouncementTarget[],
  read: (target: AnnouncementTarget) => Promise<T | null>,
  accept: (doc: T, target: AnnouncementTarget) => boolean,
): Promise<{ target: AnnouncementTarget; doc: T } | null> {
  let fallback: { target: AnnouncementTarget; doc: T } | null = null;
  for (const target of targets) {
    const doc = await read(target);
    if (doc == null) continue;
    if (accept(doc, target)) return { target, doc };
    fallback ??= { target, doc };
  }
  return fallback;
}
