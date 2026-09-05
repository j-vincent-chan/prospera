/**
 * Fit engine · PR 0.4 · materialize the RePORTER structured fields on
 * investigator_nih_grants (activity_code, rcdc_categories, study_section,
 * study_section_code, is_contact_pi, abstract, phr_text) from the raw_json
 * already held. No network: everything comes from parseReporterRow over the
 * stored projects API v2 record.
 *
 *   npm run fit:backfill-reporter-fields -- --dry-run                 # parse every row, print 20, coverage + RCDC tally (INVENTORY § 12 markdown), write nothing
 *   npm run fit:backfill-reporter-fields -- --dry-run --limit 50      # print 50 rows instead
 *   npm run fit:backfill-reporter-fields                              # every row with fields_parsed_at IS NULL; resumable (a rerun skips stamped rows)
 *   npm run fit:backfill-reporter-fields -- --all                     # re-parse every row (after a parser change)
 *   npm run fit:backfill-reporter-fields -- --investigator <uuid>     # one person's rows
 *   npm run fit:backfill-reporter-fields -- --limit 100               # at most 100 rows written this run
 *
 * Idempotent: parseReporterRow is deterministic over raw_json, rows are updated
 * by primary key, and fields_parsed_at is stamped so a rerun skips them. Every
 * identity_status is covered — the fields are facts about the award, and the
 * rows fit-fix-profile-ids rejected keep them for the provenance review (their
 * is_contact_pi is null: the profile id they were fetched with is gone).
 *
 * The dry run scans every row read-only regardless of --limit / --investigator
 * and reports the shares the plan asks for: activity_code parsed (target 100%),
 * rows whose raw_json has spending_categories_desc, and every distinct RCDC
 * value with its row count split by D9 status (mapped / unverified / unmapped).
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseReporterRow, type ReporterParsedFields } from "../src/lib/community/reporter-fields";
import {
  formatCoverageReport,
  formatDryRunRow,
  formatRcdcSection,
  rcdcNamesInSignalMapping,
  summarizeCoverage,
  tallyRcdc,
  type ScannedRow,
} from "../src/lib/community/reporter-fields-backfill";

config({ path: ".env.local", quiet: true });

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const DRY_RUN = flag("--dry-run");
const ALL = flag("--all");
const LIMIT = opt("--limit") ? Number(opt("--limit")) : DRY_RUN ? 20 : null;
const INVESTIGATOR = opt("--investigator") ?? null;
const PAGE = 500;
const MIGRATION = "supabase/migrations/20260913120000_fit_reporter_fields.sql";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}
const supabase: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });

type GrantRow = {
  id: string;
  investigator_id: string;
  project_num: string;
  fiscal_year: number | null;
  identity_status: string;
  raw_json: Record<string, unknown> | null;
  fields_parsed_at?: string | null;
  investigators: { nih_profile_id: string | null; full_name: string | null } | null;
};

function isMissingFieldsColumn(message: string): boolean {
  return /fields_parsed_at/i.test(message);
}

/** Every grant row with the investigator's RePORTER id and name. Before the migration is applied, --dry-run treats every row as pending. */
async function loadRows(): Promise<{ rows: GrantRow[]; migrationApplied: boolean }> {
  const rows: GrantRow[] = [];
  let migrationApplied = true;
  for (let from = 0; ; from += PAGE) {
    const columns =
      "id, investigator_id, project_num, fiscal_year, identity_status, raw_json, " +
      (migrationApplied ? "fields_parsed_at, " : "") +
      "investigators(nih_profile_id, full_name)";
    const { data, error } = await supabase.from("investigator_nih_grants").select(columns).order("id").range(from, from + PAGE - 1);
    if (error) {
      if (migrationApplied && isMissingFieldsColumn(error.message)) {
        if (!DRY_RUN) throw new Error(`${error.message}\nApply ${MIGRATION} before running the backfill.`);
        console.error(`note: ${error.message} — migration not applied; dry run treats every row as pending`);
        migrationApplied = false;
        from -= PAGE;
        continue;
      }
      throw new Error(`investigator_nih_grants read failed: ${error.message}`);
    }
    rows.push(...((data ?? []) as unknown as GrantRow[]));
    if (!data || data.length < PAGE) break;
  }
  return { rows, migrationApplied };
}

async function main(): Promise<void> {
  const { rows, migrationApplied } = await loadRows();
  const parsedAt = new Date().toISOString();

  const scanned: Array<ScannedRow & { row: GrantRow }> = rows.map((row) => {
    const raw = row.raw_json ?? {};
    return { row, raw, fields: parseReporterRow(raw, row.investigators?.nih_profile_id ?? null, parsedAt) };
  });

  const alreadyParsed = migrationApplied ? rows.filter((r) => r.fields_parsed_at).length : 0;
  let selected = scanned.filter(({ row }) => ALL || !migrationApplied || !row.fields_parsed_at);
  if (INVESTIGATOR) selected = selected.filter(({ row }) => row.investigator_id === INVESTIGATOR);
  const pendingCount = selected.length;
  if (LIMIT != null) selected = selected.slice(0, LIMIT);

  console.error(
    `${rows.length} grant rows; ${alreadyParsed} already parsed; ${pendingCount} pending${ALL ? " (--all: every row)" : ""}${INVESTIGATOR ? ` for investigator ${INVESTIGATOR}` : ""}` +
      (DRY_RUN ? `; printing ${selected.length}  [dry run: nothing will be written]` : `; writing ${selected.length}`) +
      (migrationApplied ? "" : "  [migration not applied]")
  );

  if (DRY_RUN) {
    for (const { row, fields } of selected) {
      const label = `${row.investigators?.full_name ?? row.investigator_id}${row.identity_status === "verified" ? "" : ` (${row.identity_status})`}`;
      console.log(formatDryRunRow(label, row.project_num, row.fiscal_year, fields));
    }
  } else {
    let written = 0;
    for (const { row, fields } of selected) {
      const update: ReporterParsedFields = fields;
      const { error } = await supabase.from("investigator_nih_grants").update(update).eq("id", row.id);
      if (error) throw new Error(`update failed for ${row.id} (${row.project_num}): ${error.message}\nRerun to resume; ${written} rows were stamped.`);
      written += 1;
      if (written % 100 === 0) console.error(`  ${written}/${selected.length} rows written`);
    }
    console.error(`done: ${written} rows updated; fields_parsed_at ${parsedAt}`);
  }

  // Coverage over every row, read-only, whatever was selected above.
  const coverage = summarizeCoverage(scanned);
  console.error(`\n${formatCoverageReport(coverage)}`);
  if (DRY_RUN) {
    const mapping = rcdcNamesInSignalMapping();
    const tally = tallyRcdc(
      scanned.map((s) => s.fields.rcdc_categories),
      mapping
    );
    console.log(`\n${formatRcdcSection(tally, coverage, mapping, parsedAt)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
