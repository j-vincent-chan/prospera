/**
 * The gold-set CSV (plan § PR 2.4): one row per pair with the summaries a
 * labeler needs — investigator name, dominant paradigm, top evidence
 * titles (the fixture narrative for a synthetic investigator), notice
 * number, title, designation and the Section I / Part 1 Purpose excerpt —
 * the stratum, a `synthetic` mark, and EMPTY label columns for labeler A,
 * labeler B and the adjudicator. The engines' tiers stay in the manifest
 * (a labeler should not see what the engines said). The page's export
 * writes the same columns with the stored labels filled in, so a CSV from
 * either path feeds scripts/fit-goldset-import.ts (a synthetic pair's rows
 * carry `synthetic_source`; while that column is not on the database,
 * scripts/fit-metrics.ts reads its labels from here with `--labels-csv`).
 * Pure; papaparse does the quoting.
 */
import Papa from "papaparse";
import type { ManifestPair } from "@/lib/fit/goldset/manifest";
import { STRATUM_LABEL, type Stratum } from "@/lib/fit/goldset/stratify";

export const LABEL_SLOTS = ["a", "b", "adj"] as const;
export type LabelSlotKey = (typeof LABEL_SLOTS)[number];

export const LABEL_COLUMNS = LABEL_SLOTS.flatMap((s) => [`tier_${s}`, `reason_${s}`, `axis_reason_${s}`] as const);

export const CSV_COLUMNS = [
  "pair_id",
  "investigator_id",
  "investigator_name",
  "investigator_paradigm",
  "investigator_family",
  "evidence_top3",
  "opportunity_id",
  "notice_number",
  "notice_title",
  "designation",
  "notice_family",
  "purpose_excerpt",
  "stratum",
  "synthetic",
  ...LABEL_COLUMNS,
  "notes",
] as const;

/** Columns a CSV may omit (older files, hand-made ones): the labels, the mark, the notes. */
const OPTIONAL_COLUMNS: readonly string[] = [...LABEL_COLUMNS, "synthetic", "notes"];

/** The `synthetic` cell of a synthetic pair. */
export const SYNTHETIC_MARK = "yes";

export type CsvColumn = (typeof CSV_COLUMNS)[number];

export type CsvRow = Record<CsvColumn, string>;

export type SlotLabel = { tier: string; reason: string; axis_reason: string };

/** Pure. One CSV row for a manifest pair; `labels` fills the slot columns (empty by default). */
export function csvRowFor(pair: ManifestPair, labels: Partial<Record<LabelSlotKey, SlotLabel>> = {}, notes = ""): CsvRow {
  const slot = (k: LabelSlotKey) => labels[k] ?? { tier: "", reason: "", axis_reason: "" };
  return {
    pair_id: pair.id,
    investigator_id: pair.investigator_id,
    investigator_name: pair.investigator.name,
    investigator_paradigm: pair.investigator.dominant.label,
    investigator_family: pair.investigator.dominant.family,
    evidence_top3: pair.investigator.evidence.join(" | "),
    opportunity_id: pair.opportunity_id,
    notice_number: pair.notice.number,
    notice_title: pair.notice.title,
    designation: pair.notice.designation,
    notice_family: pair.notice.family,
    purpose_excerpt: pair.notice.excerpt,
    stratum: pair.stratum,
    synthetic: pair.synthetic ? SYNTHETIC_MARK : "",
    tier_a: slot("a").tier,
    reason_a: slot("a").reason,
    axis_reason_a: slot("a").axis_reason,
    tier_b: slot("b").tier,
    reason_b: slot("b").reason,
    axis_reason_b: slot("b").axis_reason,
    tier_adj: slot("adj").tier,
    reason_adj: slot("adj").reason,
    axis_reason_adj: slot("adj").axis_reason,
    notes,
  };
}

/** Pure. The CSV text: a header row, then one row per pair in manifest order. */
export function serializeCsv(rows: readonly CsvRow[]): string {
  return Papa.unparse({ fields: [...CSV_COLUMNS], data: rows.map((r) => CSV_COLUMNS.map((c) => r[c] ?? "")) }, { newline: "\n" });
}

export type ParsedCsv = { rows: CsvRow[]; missing_columns: string[]; errors: string[] };

/** Pure. A labeled CSV back into rows; unknown columns are ignored, missing ones reported (label columns default to empty). */
export function parseCsv(text: string): ParsedCsv {
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
  const fields = parsed.meta.fields ?? [];
  const missing = CSV_COLUMNS.filter((c) => !fields.includes(c) && !OPTIONAL_COLUMNS.includes(c));
  const rows: CsvRow[] = parsed.data.map((raw) => {
    const row = {} as CsvRow;
    for (const c of CSV_COLUMNS) row[c] = (raw[c] ?? "").trim();
    return row;
  });
  const errors = parsed.errors.map((e) => `row ${e.row ?? "?"}: ${e.message}`);
  return { rows, missing_columns: missing, errors };
}

/** The stratum label for a CSV / page cell. */
export function stratumLabel(s: Stratum | string): string {
  return (STRATUM_LABEL as Record<string, string>)[s] ?? s;
}
