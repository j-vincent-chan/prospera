/**
 * Investigator CSV import: header auto-mapping and per-row mapping (pure).
 *
 * The wizard parses the file in the browser (papaparse) and calls
 * `mapImportRow` for every record; the server action receives rows already
 * keyed by Prospera field and validates them again with `importRowSchema`.
 * No React, no Supabase, so the same mapping runs over a real roster in
 * import-mapping.test.ts.
 *
 * PR 0.7 additions: `Rank Series` → title_series; the intake sheet's
 * `Clinical Samples` / `Biobanks` free text → self-declared materials (per
 * signal-mapping's self_declared_* rules); `orcid` validated with the MOD 11-2
 * checksum — an invalid value is reported as a warning and not stored, the
 * row still imports.
 */
import { z } from "zod";
import { normalizeCsvHeader } from "@/lib/csv/normalize-csv-header";
import { intakeMaterials, materialsKindSchema } from "@/lib/fit/self-declared";
import { parseOrcid, type OrcidParseFailure } from "@/lib/investigators/orcid";

export type ImportFieldKey =
  | "first_name" | "last_name" | "full_name" | "middle_initial" | "email" | "home_department" | "division" | "rank" | "title_series"
  | "primary_research_area" | "research_summary" | "secondary_research_areas" | "primary_disease_focus" | "secondary_disease_focuses"
  | "technological_expertise" | "clinical_samples" | "biobanks" | "small_grants" | "large_grants"
  | "nih_profile_id" | "orcid" | "communities" | "note" | "skip";

export const IMPORT_FIELDS: Array<{ value: ImportFieldKey; label: string }> = [
  { value: "first_name", label: "First name" },
  { value: "last_name", label: "Last name" },
  { value: "full_name", label: "Full name (split into first and last)" },
  { value: "middle_initial", label: "Middle initial" },
  { value: "email", label: "Email" },
  { value: "home_department", label: "Department" },
  { value: "division", label: "Division" },
  { value: "rank", label: "Rank" },
  { value: "title_series", label: "Title series (Rank Series)" },
  { value: "primary_research_area", label: "Research focus" },
  { value: "research_summary", label: "Research summary" },
  { value: "secondary_research_areas", label: "Secondary research areas" },
  { value: "primary_disease_focus", label: "Disease focus" },
  { value: "secondary_disease_focuses", label: "Secondary disease focuses" },
  { value: "technological_expertise", label: "Technical expertise" },
  { value: "clinical_samples", label: "Clinical samples" },
  { value: "biobanks", label: "Biobanks" },
  { value: "small_grants", label: "Small grants" },
  { value: "large_grants", label: "Large grants" },
  { value: "nih_profile_id", label: "RePORTER profile ID" },
  { value: "orcid", label: "ORCID iD" },
  { value: "communities", label: "Communities (multi)" },
  { value: "note", label: "Store as note (not used for fit)" },
  { value: "skip", label: "Skip this column" },
];

/** Fields that are stored but never feed fit tiers. */
export const NOTE_ONLY_FIELDS: ImportFieldKey[] = ["rank", "note", "middle_initial"];

/** Fields the fit engine reads as self-declared signal (shown as such on the mapping step). */
export const SELF_DECLARED_FIELDS: ImportFieldKey[] = ["title_series", "clinical_samples", "biobanks", "orcid"];

const ALIASES: Record<string, ImportFieldKey> = {
  first_name: "first_name", firstname: "first_name", fname: "first_name", given_name: "first_name",
  last_name: "last_name", lastname: "last_name", lname: "last_name", surname: "last_name", family_name: "last_name",
  name: "full_name", full_name: "full_name", investigator: "full_name", pi: "full_name", pi_name: "full_name",
  middle_initial: "middle_initial", mi: "middle_initial", middle: "middle_initial",
  email: "email", email_address: "email", ucsf_email: "email",
  home_department: "home_department", department: "home_department", dept: "home_department",
  division: "division", rank: "rank", title: "rank", academic_rank: "rank", rank_title: "rank",
  title_series: "title_series", rank_series: "title_series", series: "title_series",
  primary_research_area: "primary_research_area", research_focus: "primary_research_area", research_area: "primary_research_area", research_interests: "primary_research_area", focus: "primary_research_area",
  research_summary: "research_summary", summary: "research_summary", bio: "research_summary",
  secondary_research_areas: "secondary_research_areas",
  primary_disease_focus: "primary_disease_focus", disease_focus: "primary_disease_focus", disease: "primary_disease_focus",
  secondary_disease_focuses: "secondary_disease_focuses",
  technological_expertise: "technological_expertise", technical_expertise: "technological_expertise", methods: "technological_expertise", techniques: "technological_expertise",
  clinical_samples: "clinical_samples", biobanks: "biobanks", small_grants: "small_grants", large_grants: "large_grants",
  nih_profile_id: "nih_profile_id", nih_reporter_id: "nih_profile_id", reporter_profile_id: "nih_profile_id", reporter_id: "nih_profile_id",
  orcid: "orcid", orcid_id: "orcid",
  affiliations: "communities", affiliation: "communities", community: "communities", communities: "communities",
};

/** Headers we won't guess: a human decides. */
const AMBIGUOUS = new Set(["profile_id", "id", "identifier", "uid", "notes", "comments", "interest", "interests"]);

export function autoMapHeader(header: string): ImportFieldKey | null {
  const n = normalizeCsvHeader(header);
  if (AMBIGUOUS.has(n)) return null;
  return ALIASES[n] ?? null;
}

export function splitName(full: string): { first: string; last: string } {
  const t = full.trim().replace(/\s+/g, " ");
  if (!t) return { first: "", last: "" };
  if (t.includes(",")) {
    const [last, first] = t.split(",").map((s) => s.trim());
    return { first: first ?? "", last: last ?? "" };
  }
  const parts = t.split(" ");
  if (parts.length === 1) return { first: parts[0]!, last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1]! };
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The review-table and server-side warning for an ORCID that failed validation. */
export function orcidWarning(raw: string, reason: OrcidParseFailure): string {
  return `ORCID “${raw}” not stored: ${reason === "checksum" ? "the check digit doesn't match" : "not an ORCID iD"}`;
}

export const importRowSchema = z.object({
  line: z.number().int().positive(),
  first_name: z.string().trim().max(120).optional().default(""),
  last_name: z.string().trim().max(120).optional().default(""),
  middle_initial: z.string().trim().max(4).optional().default(""),
  email: z.string().trim().max(320).optional().default(""),
  home_department: z.string().trim().max(300).optional().default(""),
  division: z.string().trim().max(300).optional().default(""),
  rank: z.string().trim().max(120).optional().default(""),
  title_series: z.string().trim().max(120).optional().default(""),
  primary_research_area: z.string().trim().max(4000).optional().default(""),
  secondary_research_areas: z.string().trim().max(4000).optional().default(""),
  primary_disease_focus: z.string().trim().max(2000).optional().default(""),
  secondary_disease_focuses: z.string().trim().max(4000).optional().default(""),
  technological_expertise: z.string().trim().max(8000).optional().default(""),
  clinical_samples: z.string().trim().max(2000).optional().default(""),
  biobanks: z.string().trim().max(2000).optional().default(""),
  small_grants: z.string().trim().max(2000).optional().default(""),
  large_grants: z.string().trim().max(2000).optional().default(""),
  research_summary: z.string().trim().max(16_000).optional().default(""),
  nih_profile_id: z.string().trim().max(32).optional().default(""),
  orcid: z.string().trim().max(64).optional().default(""),
  communities: z.array(z.string().trim().max(200)).optional().default([]),
  /** Materials the intake sheet implies (Clinical Samples / Biobanks), derived client-side by `mapImportRow`. */
  self_declared_materials: z.array(materialsKindSchema).optional().default([]),
  /** Unmapped-but-kept columns, stored on the raw profile. */
  extra: z.record(z.string(), z.string()).optional().default({}),
});

export type ImportRowInput = z.input<typeof importRowSchema>;

export type ImportColumn = { header: string; field: ImportFieldKey | null };

export type MappedImportRow = {
  input: ImportRowInput;
  /** Blocks the row: missing name, bad email. */
  error: string | null;
  /** Reported, the row still imports: an ORCID that failed validation and was not stored. */
  warnings: string[];
};

/** One CSV record → the row the server action accepts. `line` is the 1-based CSV line (header = 1). */
export function mapImportRow(record: Record<string, string | null | undefined>, columns: ImportColumn[], line: number): MappedImportRow {
  const input: ImportRowInput = { line, communities: [], extra: {} };
  const warnings: string[] = [];
  let rawOrcid = "";
  for (const c of columns) {
    const v = String(record[c.header] ?? "").trim();
    if (!c.field || c.field === "skip") continue;
    if (c.field === "full_name") {
      const { first, last } = splitName(v);
      if (!input.first_name) input.first_name = first;
      if (!input.last_name) input.last_name = last;
    } else if (c.field === "communities") {
      input.communities = [...(input.communities ?? []), ...v.split(/[;|,]/).map((s) => s.trim()).filter(Boolean)];
    } else if (c.field === "note") {
      input.extra = { ...(input.extra ?? {}), [normalizeCsvHeader(c.header) || c.header]: v };
    } else if (c.field === "orcid") {
      rawOrcid = v;
    } else {
      (input as Record<string, unknown>)[c.field] = v;
    }
  }

  if (rawOrcid) {
    const parsed = parseOrcid(rawOrcid);
    if (parsed.ok) input.orcid = parsed.orcid;
    else warnings.push(orcidWarning(rawOrcid, parsed.reason));
  }

  input.self_declared_materials = intakeMaterials({ clinical_samples: input.clinical_samples, biobanks: input.biobanks });

  let error: string | null = null;
  const email = (input.email ?? "").toLowerCase();
  if (!input.first_name || !input.last_name) error = "First and last name are required";
  else if (email && !EMAIL_RE.test(email)) error = "Not a valid email";

  return { input, error, warnings };
}
