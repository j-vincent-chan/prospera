/**
 * Pure helpers for scripts/fit-backfill-reporter-fields.ts (PR 0.4): which RCDC
 * names the rule mapping keys on (D9), the corpus tally of RCDC values seen,
 * the per-field coverage the dry run reports, and the INVENTORY.md § 12 markdown.
 */
import signalMapping from "@/lib/fit/signal-mapping.json";
import { grantCode, pickProjectNum, rawActivityCode, type ReporterParsedFields } from "@/lib/community/reporter-fields";

type RuleLike = { id: string; when?: Record<string, unknown>; _verify_name?: boolean };
type MappingLike = { rules: RuleLike[] };

export type RcdcMapping = {
  /** The research-type names D9 maps by default — every `rcdc_any` value on a rule without `_verify_name`. */
  mapped: string[];
  /** Names on `_verify_name` rules: in the mapping, not yet confirmed against the current RCDC list. */
  unverified: string[];
  /** RCDC name → rule ids that fire on it. */
  ruleIds: Record<string, string[]>;
};

/** RCDC names in signal-mapping.json (`rcdc_any` clauses), split by whether D9 has confirmed them. */
export function rcdcNamesInSignalMapping(mapping: MappingLike = signalMapping as MappingLike): RcdcMapping {
  const mapped = new Set<string>();
  const unverified = new Set<string>();
  const ruleIds: Record<string, string[]> = {};
  for (const rule of mapping.rules) {
    const raw = rule.when?.rcdc_any;
    const names = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
    for (const name of names) {
      (rule._verify_name ? unverified : mapped).add(name);
      (ruleIds[name] ??= []).push(rule.id);
    }
  }
  return { mapped: Array.from(mapped), unverified: Array.from(unverified), ruleIds };
}

export type RcdcStatus = "mapped" | "unverified" | "unmapped";
export type RcdcTally = { name: string; rows: number; status: RcdcStatus };

export function rcdcStatus(name: string, mapping: RcdcMapping): RcdcStatus {
  if (mapping.mapped.includes(name)) return "mapped";
  if (mapping.unverified.includes(name)) return "unverified";
  return "unmapped";
}

/** Distinct RCDC values across rows with how many rows carry each, most common first, ties by name. */
export function tallyRcdc(categories: Array<string[] | null>, mapping: RcdcMapping): RcdcTally[] {
  const counts = new Map<string, number>();
  for (const list of categories) for (const name of list ?? []) counts.set(name, (counts.get(name) ?? 0) + 1);
  return Array.from(counts, ([name, rows]) => ({ name, rows, status: rcdcStatus(name, mapping) })).sort(
    (a, b) => b.rows - a.rows || a.name.localeCompare(b.name)
  );
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

export type ScannedRow = { raw: Record<string, unknown>; fields: ReporterParsedFields };

export type ReporterFieldCoverage = {
  rows: number;
  activity_code: number;
  /** Rows the legacy `grantCode` (suggest.ts) cannot read; only parseActivityCode reaches them. */
  activity_code_legacy_null: number;
  activity_code_raw_present: number;
  /** Parsed code differs from RePORTER's own `activity_code` — should be 0. */
  activity_code_raw_disagrees: number;
  /** raw_json.spending_categories_desc is a non-empty string. */
  rcdc_field_present: number;
  rcdc_parsed: number;
  study_section: number;
  study_section_code: number;
  contact_pi_true: number;
  contact_pi_false: number;
  contact_pi_null: number;
  abstract: number;
  phr_text: number;
};

export function summarizeCoverage(rows: ScannedRow[]): ReporterFieldCoverage {
  const c: ReporterFieldCoverage = {
    rows: rows.length,
    activity_code: 0,
    activity_code_legacy_null: 0,
    activity_code_raw_present: 0,
    activity_code_raw_disagrees: 0,
    rcdc_field_present: 0,
    rcdc_parsed: 0,
    study_section: 0,
    study_section_code: 0,
    contact_pi_true: 0,
    contact_pi_false: 0,
    contact_pi_null: 0,
    abstract: 0,
    phr_text: 0,
  };
  for (const { raw, fields } of rows) {
    if (fields.activity_code) c.activity_code += 1;
    if (!grantCode(pickProjectNum(raw))) c.activity_code_legacy_null += 1;
    const own = rawActivityCode(raw);
    if (own) {
      c.activity_code_raw_present += 1;
      if (fields.activity_code && fields.activity_code !== own) c.activity_code_raw_disagrees += 1;
    }
    if (typeof raw.spending_categories_desc === "string" && raw.spending_categories_desc.trim()) c.rcdc_field_present += 1;
    if (fields.rcdc_categories) c.rcdc_parsed += 1;
    if (fields.study_section) c.study_section += 1;
    if (fields.study_section_code) c.study_section_code += 1;
    if (fields.is_contact_pi === true) c.contact_pi_true += 1;
    else if (fields.is_contact_pi === false) c.contact_pi_false += 1;
    else c.contact_pi_null += 1;
    if (fields.abstract) c.abstract += 1;
    if (fields.phr_text) c.phr_text += 1;
  }
  return c;
}

export function pct(n: number, d: number): string {
  if (!d) return "—";
  const p = (100 * n) / d;
  return `${Number.isInteger(p) ? p : p.toFixed(1)}%`;
}

const share = (n: number, d: number) => `${n} (${pct(n, d)})`;

/** The coverage block the dry run prints after scanning every row. */
export function formatCoverageReport(c: ReporterFieldCoverage): string {
  const d = c.rows;
  return [
    `Coverage over ${d} rows (read-only scan of raw_json):`,
    `  activity_code parsed            ${share(c.activity_code, d)}   [target 100%]`,
    `    reachable only by parseActivityCode (grantCode returns null)  ${share(c.activity_code_legacy_null, d)}`,
    `    RePORTER's own activity_code present ${share(c.activity_code_raw_present, d)}; parsed value disagrees with it on ${c.activity_code_raw_disagrees}`,
    `  spending_categories_desc present ${share(c.rcdc_field_present, d)}   → rcdc_categories parsed ${share(c.rcdc_parsed, d)}`,
    `  study_section                   ${share(c.study_section, d)}; study_section_code ${share(c.study_section_code, d)}`,
    `  is_contact_pi                   true ${c.contact_pi_true} · false ${c.contact_pi_false} · null ${c.contact_pi_null}`,
    `  abstract                        ${share(c.abstract, d)}; phr_text ${share(c.phr_text, d)}`,
  ].join("\n");
}

/** One row's dry-run line: what would be stored. */
export function formatDryRunRow(label: string, projectNum: string, fiscalYear: number | null, fields: ReporterParsedFields): string {
  const chars = (s: string | null) => (s ? `${s.length.toLocaleString()} chars` : "none");
  const section = fields.study_section ? `${JSON.stringify(fields.study_section)}${fields.study_section_code ? ` [${fields.study_section_code}]` : ""}` : "—";
  return (
    `${projectNum}  FY${fiscalYear ?? "?"}  ${label}\n` +
    `    activity_code ${fields.activity_code ?? "NULL"} · contact_pi ${fields.is_contact_pi ?? "null"} · study_section ${section}\n` +
    `    rcdc ${fields.rcdc_categories ? fields.rcdc_categories.join(" · ") : "—"}\n` +
    `    abstract ${chars(fields.abstract)} · phr ${chars(fields.phr_text)}`
  );
}

// ---------------------------------------------------------------------------
// INVENTORY.md § 12
// ---------------------------------------------------------------------------

export const RCDC_HEADING = "## 12. RePORTER RCDC values seen (PR 0.4, D9)";

const mdCell = (s: string) => s.replace(/\|/g, "\\|");

/** Markdown for INVENTORY.md § 12: the corpus shares and every distinct RCDC value by D9 status. */
export function formatRcdcSection(tally: RcdcTally[], coverage: ReporterFieldCoverage, mapping: RcdcMapping, generatedAt: string): string {
  const seen = new Map(tally.map((t) => [t.name, t.rows]));
  const mappedSeen = mapping.mapped.filter((n) => seen.has(n));
  const unverifiedSeen = mapping.unverified.filter((n) => seen.has(n));
  const unmapped = tally.filter((t) => t.status === "unmapped");
  const d = coverage.rows;
  const lines: string[] = [
    RCDC_HEADING,
    "",
    `Generated ${generatedAt} by \`npm run fit:backfill-reporter-fields -- --dry-run\`, read-only over every row of \`investigator_nih_grants\`. RCDC = \`raw_json.spending_categories_desc\` split on \`;\`. Status: **mapped** = one of the seven research-type names D9 maps by default (the \`rcdc_any\` rules in \`signal-mapping.json\`); **unverified** = named by a \`_verify_name\` rule D9 has not confirmed against the current RCDC list; **unmapped** = a disease / topic category no rule keys on.`,
    "",
    "| Metric | Value |",
    "|---|---|",
    `| rows | ${d} |`,
    `| rows with activity_code parsed | ${share(coverage.activity_code, d)} |`,
    `| rows with spending_categories_desc | ${share(coverage.rcdc_field_present, d)} |`,
    `| rows with rcdc_categories parsed | ${share(coverage.rcdc_parsed, d)} |`,
    `| distinct RCDC values | ${tally.length} |`,
    `| mapped names seen | ${mappedSeen.length} of ${mapping.mapped.length} |`,
    `| unverified names seen | ${unverifiedSeen.length} of ${mapping.unverified.length} |`,
    `| unmapped values | ${unmapped.length} |`,
    "",
    "Research-type names in the mapping (D9) and the rows carrying each; 0 = in the mapping, not in this corpus:",
    "",
    "| RCDC value | status | rules | rows |",
    "|---|---|---|---|",
    ...[...mapping.mapped, ...mapping.unverified].map(
      (n) => `| ${mdCell(n)} | ${rcdcStatus(n, mapping)} | ${(mapping.ruleIds[n] ?? []).map((id) => `\`${id}\``).join(", ")} | ${seen.get(n) ?? 0} |`
    ),
    "",
    `Unmapped values seen (${unmapped.length}; disease / topic categories — no rule keys on them):`,
    "",
    "| RCDC value | rows |",
    "|---|---|",
    ...unmapped.map((t) => `| ${mdCell(t.name)} | ${t.rows} |`),
  ];
  return lines.join("\n") + "\n";
}
