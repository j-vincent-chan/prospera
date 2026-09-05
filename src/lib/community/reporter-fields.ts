/**
 * Pure parsers over one RePORTER project record — the projects API v2 payload
 * `refreshInvestigatorReporter` stores whole in `investigator_nih_grants.raw_json`
 * (PR 0.4). No network, no Supabase: the ingest calls `parseReporterRow` on the
 * record it just fetched and scripts/fit-backfill-reporter-fields.ts calls it on
 * raw_json already held.
 *
 * Field names follow the v2 payload: `project_num` ("1R01AI024349-01"),
 * `spending_categories_desc` ("Cancer; Immunization; Vaccine Related"),
 * `full_study_section` ({name, srg_code, …}), `principal_investigators[]`
 * ({profile_id, is_contact_pi, …}), `abstract_text`, `phr_text`. Every one of the
 * 818 rows held on 2026-09-05 carries all of these keys (values may be null).
 */

/** The PR 0.4 columns on investigator_nih_grants, as written on upsert and by the backfill. */
export type ReporterParsedFields = {
  activity_code: string | null;
  /** Null when RePORTER has no RCDC categories for the project; never `[]`. */
  rcdc_categories: string[] | null;
  study_section: string | null;
  study_section_code: string | null;
  /** Null when the investigator's profile id is unknown or not on the PI list. */
  is_contact_pi: boolean | null;
  abstract: string | null;
  phr_text: string | null;
  fields_parsed_at: string;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  return s || null;
}

// ---------------------------------------------------------------------------
// Activity code
// ---------------------------------------------------------------------------

/** Project number as the ingest stores it: `project_num`, else its alias, else the core number; "unknown" when none. */
export function pickProjectNum(row: Record<string, unknown>): string {
  const n =
    (row.project_num as string | undefined) ??
    (row.project_num_alias as string | undefined) ??
    (row.core_project_num as string | undefined);
  return String(n ?? "").trim() || "unknown";
}

/**
 * Activity code as the Outreach suggestion engine has always read it: drop the
 * application-type digit, take one or two letters and two digits ("1R01AI…" →
 * R01). Moved here from suggest.ts unchanged and re-exported there, so the
 * legacy path is untouched. It misses the letter-digit-letter shapes — DP2,
 * UG3, UM1, RM1, OT2, RC1 — 36 of 818 rows on 2026-09-05, three of which
 * (UG3, UM1, UG1) `reporter_trial_mechanisms` in signal-mapping.json keys on;
 * `parseActivityCode` covers them.
 */
export const grantCode = (projectNum: string) => projectNum.replace(/^\d/, "").match(/^([A-Z]{1,2}\d{2})/)?.[1] ?? null;

/**
 * NIH project number: `[application type][activity code][IC][serial]-[support year][suffix]`,
 * e.g. 1DP2AI177915-01 or, without the type digit, R01AI024349. The activity
 * code is a letter and two alphanumerics standing directly before the two-letter
 * IC code and the serial digits. Falls back to `grantCode` for shapes without
 * an IC / serial, else null.
 */
const PROJECT_NUM_ACTIVITY_RE = /^\d?([A-Z][A-Z0-9]{2})(?=[A-Z]{2}\d)/;

export function parseActivityCode(projectNum: unknown): string | null {
  const s = String(projectNum ?? "").toUpperCase().replace(/\s+/g, "");
  if (!s) return null;
  return s.match(PROJECT_NUM_ACTIVITY_RE)?.[1] ?? grantCode(s);
}

/** The code RePORTER itself reports (`activity_code`, else `project_num_split.activity_code`); the parse is preferred, this is the fallback. */
export function rawActivityCode(row: Record<string, unknown>): string | null {
  const direct = str(row.activity_code);
  if (direct) return direct.toUpperCase();
  const split = asObject(row.project_num_split);
  const fromSplit = str(split?.activity_code);
  return fromSplit ? fromSplit.toUpperCase() : null;
}

// ---------------------------------------------------------------------------
// RCDC categories, study section, contact PI, narrative text
// ---------------------------------------------------------------------------

/**
 * `spending_categories_desc` — "Cancer; Immunization; Immunotherapy; Vaccine
 * Related" — split on ";", trimmed, deduplicated, order kept. Null when RePORTER
 * has none for the project (awards before FY2008, when RCDC began, and new
 * awards not yet categorized) so a scorer can tell "not categorized" from
 * "categorized, nothing matched".
 */
export function parseRcdcCategories(value: unknown): string[] | null {
  const parts = typeof value === "string" ? value.split(";") : Array.isArray(value) ? value : [];
  const out: string[] = [];
  for (const part of parts) {
    if (typeof part !== "string") continue;
    const name = part.replace(/\s+/g, " ").trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out.length ? out : null;
}

export type ReporterStudySection = { name: string | null; code: string | null };

/** Trailing bracketed code on a RePORTER panel name: "…Study Section[IMB]", "Special Emphasis Panel[ZRG1 MOSS-C (56)]". */
const NAME_BRACKET_RE = /\s*\[([^\]]*)\]\s*$/;

/**
 * `full_study_section` → the panel name and its SRG code. RePORTER's name
 * usually ends in the code in brackets — "Immunobiology Study Section[IMB]",
 * "Special Emphasis Panel[ZAI1 QV-I (J1)]" — which is dropped from the name
 * because `study_section_code` carries `srg_code` (IMB, ZAI1); the full string
 * stays in raw_json. Older awards name the panel by a bare code ("GMBB",
 * "ZRG2-IMB(01)L") and are kept as they are. Both null when RePORTER has no
 * panel on record (17 of 818 rows).
 */
export function parseStudySection(value: unknown): ReporterStudySection {
  const o = asObject(value);
  const rawName = str(o?.name);
  const bracket = rawName?.match(NAME_BRACKET_RE)?.[1]?.trim() ?? null;
  const stripped = rawName ? rawName.replace(NAME_BRACKET_RE, "").trim() : "";
  const name = stripped || rawName;
  const code = str(o?.srg_code)?.toUpperCase() ?? (bracket && /^[A-Z0-9-]+$/i.test(bracket) ? bracket.toUpperCase() : null);
  return { name: name || null, code };
}

/** RePORTER profile ids are integers; investigators.nih_profile_id is text and may carry a prefix or leading zeros. */
function profileIdKey(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return digits || null;
}

/**
 * `principal_investigators[].is_contact_pi` for the entry whose `profile_id` is
 * this investigator's RePORTER id. Null when the id is unknown or no entry
 * carries it — the rows fit-fix-profile-ids rejected have had their id cleared
 * — so a scorer can tell "not the contact PI" (false) from "cannot say" (null).
 */
export function parseContactPi(pis: unknown, investigatorProfileId: number | string | null | undefined): boolean | null {
  const id = profileIdKey(investigatorProfileId);
  if (!id || !Array.isArray(pis)) return null;
  for (const pi of pis) {
    const o = asObject(pi);
    if (!o || profileIdKey(o.profile_id) !== id) continue;
    if (typeof o.is_contact_pi === "boolean") return o.is_contact_pi;
    if (typeof o.is_contact_pi === "string") return o.is_contact_pi.trim().toLowerCase() === "true";
    return null;
  }
  return null;
}

/**
 * RePORTER narrative text (`abstract_text`, `phr_text`) comes hard-wrapped at
 * ~70 characters with padded line ends. Blank-line paragraphs are kept and
 * joined with "\n\n" (the pubmed-record.ts convention); whitespace inside a
 * paragraph collapses to single spaces. Null when empty.
 */
export function normalizeReporterText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const paragraphs = value
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return paragraphs.length ? paragraphs.join("\n\n") : null;
}

// ---------------------------------------------------------------------------
// One row
// ---------------------------------------------------------------------------

/**
 * The PR 0.4 columns for one project record. `investigatorProfileId` is the
 * RePORTER PI profile id the row was fetched with (`investigators.nih_profile_id`);
 * it only decides `is_contact_pi`. `parsedAt` is stamped on every call so the
 * backfill can skip rows it has already parsed.
 */
export function parseReporterRow(
  row: Record<string, unknown>,
  investigatorProfileId: number | string | null | undefined,
  parsedAt: string = new Date().toISOString()
): ReporterParsedFields {
  const section = parseStudySection(row.full_study_section);
  return {
    activity_code: parseActivityCode(pickProjectNum(row)) ?? rawActivityCode(row),
    rcdc_categories: parseRcdcCategories(row.spending_categories_desc),
    study_section: section.name,
    study_section_code: section.code,
    is_contact_pi: parseContactPi(row.principal_investigators, investigatorProfileId),
    abstract: normalizeReporterText(row.abstract_text),
    phr_text: normalizeReporterText(row.phr_text),
    fields_parsed_at: parsedAt,
  };
}
