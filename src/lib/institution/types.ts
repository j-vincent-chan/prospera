/**
 * Institutional layer (step 7): shared labels, option lists and the derived
 * statuses the design shows (Published / Needs review / Draft, nomination
 * open / closed / passed). Pure — no Supabase here.
 */

export type InstitutionRole = "curator" | "library_steward";
export const INSTITUTION_ROLE_LABEL: Record<InstitutionRole, string> = { curator: "Curator", library_steward: "Library steward" };
export const INSTITUTION_ROLE_HELP: Record<InstitutionRole, string> = {
  curator: "Enters Internal (UCSF) funding and limited-submission overlays; drafts are visible to curators only until published.",
  library_steward: "Reviews library uploads before they go public, resolves flags, keeps the OSR rate schedule and award imports current.",
};

export type CuratedKind = "internal" | "nonfederal";
export type CuratedStatus = "draft" | "published";
export type SourceKind = "program_office" | "rap" | "infoready" | "email" | "sponsor_site";
export const SOURCE_KINDS: Array<{ key: SourceKind; label: string }> = [
  { key: "program_office", label: "Program office (manual)" },
  { key: "rap", label: "RAP announcement" },
  { key: "infoready", label: "InfoReady competition" },
  { key: "email", label: "Program office email" },
  { key: "sponsor_site", label: "Sponsor website" },
];
export const SOURCE_KIND_LABEL: Record<SourceKind, string> = Object.fromEntries(SOURCE_KINDS.map((s) => [s.key, s.label])) as Record<SourceKind, string>;
/** Short provenance line used in tables ("RAP feed", "Program office"). */
export const SOURCE_KIND_SHORT: Record<SourceKind, string> = { program_office: "Program office", rap: "RAP feed", infoready: "InfoReady", email: "Program office email", sponsor_site: "Sponsor website" };

export type ReviewProcess = "committee_scored" | "program_director" | "external_reviewers";
export const REVIEW_PROCESSES: Array<{ key: ReviewProcess; label: string }> = [
  { key: "committee_scored", label: "Internal committee · scored" },
  { key: "program_director", label: "Program director decision" },
  { key: "external_reviewers", label: "External reviewers" },
];

/** Derived state of a curated record or overlay on a given day. */
export type DerivedStatus = "draft" | "published" | "needs_review" | "closed";
export const DERIVED_STATUS_LABEL: Record<DerivedStatus, string> = { draft: "Draft", published: "Published", needs_review: "Needs review", closed: "Closed" };

export function derivedStatus(rec: { status: CuratedStatus; review_by: string | null; application_due?: string | null }, today: string): DerivedStatus {
  if (rec.status !== "published") return "draft";
  if (rec.application_due && rec.application_due < today) return "closed";
  if (rec.review_by && rec.review_by < today) return "needs_review";
  return "published";
}

/** Published, current and not past its deadline: the only records suggestions and Home may use. */
export function isLive(rec: { status: CuratedStatus; review_by: string | null; application_due?: string | null }, today: string): boolean {
  return derivedStatus(rec, today) === "published";
}

export function overlayNominationLine(o: { cap: number | null; nominated_count: number; interest_count: number }): string {
  const cap = o.cap ?? 0;
  const closed = cap > 0 && o.nominated_count >= cap;
  const parts = [`${cap} nominee${cap === 1 ? "" : "s"}`, `${o.nominated_count} nominated${closed ? " (closed)" : ""}`];
  if (!closed && o.interest_count) parts.push(`${o.interest_count} interested`);
  return parts.join(" · ");
}

export function nominationClosed(o: { cap: number | null; nominated_count: number }): boolean {
  return (o.cap ?? 0) > 0 && o.nominated_count >= (o.cap ?? 0);
}

/** Library content types (design list order). */
export type ContentType = "institutional_description" | "rates" | "specific_aims" | "research_strategy" | "dms_plan" | "letter_of_support" | "budget_justification" | "human_subjects";
export const CONTENT_TYPES: Array<{ key: ContentType; label: string; short: string; chip: string }> = [
  { key: "institutional_description", label: "Institutional description", short: "Institutional description", chip: "Institutional description" },
  { key: "rates", label: "Rates & required language", short: "Rates", chip: "Rates / required language" },
  { key: "specific_aims", label: "Specific Aims (example)", short: "Specific Aims", chip: "Specific Aims (example)" },
  { key: "research_strategy", label: "Research Strategy (example)", short: "Research Strategy", chip: "Research Strategy (example)" },
  { key: "dms_plan", label: "Data Management & Sharing plan", short: "DMS plan", chip: "DMS plan" },
  { key: "letter_of_support", label: "Letter of support", short: "Letter of support", chip: "Letter of support" },
  { key: "budget_justification", label: "Budget justification", short: "Budget justification", chip: "Budget justification" },
  { key: "human_subjects", label: "Human subjects section", short: "Human subjects", chip: "Human subjects" },
];
export const CONTENT_TYPE_LABEL: Record<ContentType, string> = Object.fromEntries(CONTENT_TYPES.map((c) => [c.key, c.label])) as Record<ContentType, string>;
export const CONTENT_TYPE_SHORT: Record<ContentType, string> = Object.fromEntries(CONTENT_TYPES.map((c) => [c.key, c.short])) as Record<ContentType, string>;

export type TrustTier = "osr" | "curated" | "community";
export const TRUST_LABEL: Record<TrustTier, string> = { osr: "OSR-verified", curated: "Curated", community: "Community" };

export type LibraryOutcome = "funded" | "not_funded" | "template";
export const OUTCOME_LABEL: Record<LibraryOutcome, string> = { funded: "Funded", not_funded: "Not funded", template: "Not submitted / template" };

export type ReviewStatus = "pending_review" | "published" | "changes_requested" | "removed";

export type FlagReason = "outdated" | "sensitive" | "wrong_metadata" | "other";
export const FLAG_REASONS: Array<{ key: FlagReason; label: string }> = [
  { key: "outdated", label: "Out of date" },
  { key: "sensitive", label: "Contains unpublished data or names people" },
  { key: "wrong_metadata", label: "Wrong sponsor, mechanism or department" },
  { key: "other", label: "Something else" },
];

export const SPONSOR_OPTIONS = ["NIH", "NSF", "DoD", "Foundations", "Other"] as const;
/** "NIH · NIAID" style sponsor picker for uploads: NIH institutes first. */
export const NIH_INSTITUTES = ["NIAID", "NCI", "NHLBI", "NIDDK", "NINDS", "NIA", "NIAMS", "NICHD", "NIMH", "NIGMS", "NIDA", "NEI", "NIEHS", "NHGRI", "NIDCR", "NIBIB", "NIMHD", "NIAAA", "NIDCD", "NINR", "NCATS", "NLM", "OD"] as const;
export const MECHANISM_OPTIONS = ["R01", "R21", "R03", "R35", "K08", "K23", "K99", "U01", "U54", "P01", "P30", "T32", "F31", "F32", "DP1", "DP2"] as const;

/** Federal fiscal year (Oct 1 – Sep 30) of an ISO date. */
export function fiscalYearOf(iso: string): number {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return m >= 10 ? y + 1 : y;
}

export function fyLabel(fy: number): string {
  return `FY${fy}`;
}
export function fyRangeLabel(from: number, to: number): string {
  return from === to ? `FY${from}` : `FY${from}–${String(to).slice(2)}`;
}

/** Search in a mechanism string for the activity code ("5R01AI158703-03" → R01). */
export function activityCodeOf(projectNumber: string | null | undefined): string | null {
  if (!projectNumber) return null;
  const m = projectNumber.replace(/^\d/, "").match(/^([A-Z]{1,2}\d{2})/);
  return m ? m[1] : null;
}

export function institutePrefixOf(projectNumber: string | null | undefined): string | null {
  if (!projectNumber) return null;
  const m = projectNumber.replace(/^\d/, "").match(/^[A-Z]{1,2}\d{2}([A-Z]{2})/);
  return m ? m[1] : null;
}

/** RePORTER/NIH two-letter serial prefixes → institute acronym. */
export const IC_BY_PREFIX: Record<string, string> = {
  AI: "NIAID", CA: "NCI", HL: "NHLBI", DK: "NIDDK", NS: "NINDS", AG: "NIA", AR: "NIAMS", HD: "NICHD", MH: "NIMH", GM: "NIGMS", DA: "NIDA", EY: "NEI", ES: "NIEHS", HG: "NHGRI", DE: "NIDCR", EB: "NIBIB", MD: "NIMHD", AA: "NIAAA", DC: "NIDCD", NR: "NINR", TR: "NCATS", LM: "NLM", OD: "OD", RM: "OD", AT: "NCCIH", TW: "FIC",
};

export function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

export function pct(numer: number, denom: number): string {
  if (!denom) return "—";
  return `${Math.round((numer / denom) * 100)}%`;
}

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** "Natarajan · Rheumatology" from "NATARAJAN, PRIYA" + division/department. */
export function piShort(piName: string | null, unit: string | null): string {
  if (!piName) return unit ?? "—";
  const last = piName.includes(",") ? piName.split(",")[0] : piName.trim().split(/\s+/).slice(-1)[0];
  const cased = last.trim().toLowerCase().replace(/(^|[\s'-])([a-z])/g, (m) => m.toUpperCase());
  return unit ? `${cased} · ${unit}` : cased;
}

/** Title-case an ALL CAPS RePORTER department ("INTERNAL MEDICINE/MEDICINE" → "Medicine"). */
export function tidyDepartment(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const last = raw.split("/").slice(-1)[0].trim();
  if (!last) return null;
  return last.toLowerCase().replace(/(^|[\s&(-])([a-z])/g, (m) => m.toUpperCase()).replace(/\bAnd\b/g, "and").replace(/\bOf\b/g, "of");
}
