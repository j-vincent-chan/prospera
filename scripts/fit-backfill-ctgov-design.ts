/**
 * Fit engine · PR 0.3 · backfill the ClinicalTrials.gov design fields and the
 * investigator's role onto investigator_clinical_trials from the API v2 record
 * each row already holds in raw_json. No network.
 *
 *   npm run fit:backfill-ctgov-design -- --dry-run                    # parse every row, print what would be stored, write nothing
 *   npm run fit:backfill-ctgov-design                                 # every row; idempotent — re-parsing yields the same values
 *   npm run fit:backfill-ctgov-design -- --pending                    # only rows never parsed (design_parsed_at IS NULL)
 *   npm run fit:backfill-ctgov-design -- --limit 50
 *   npm run fit:backfill-ctgov-design -- --investigator <uuid>        # one person's rows
 *   npm run fit:backfill-ctgov-design -- --nct NCT03293030,NCT04404075
 *
 * The role is matched against investigators.full_name — the name the ingest
 * searched CT.gov with — so a row and its next refresh agree. A row whose
 * raw_json has no protocolSection gets null fields, role UNKNOWN and a
 * design_parsed_at stamp all the same; the summary counts those separately,
 * and the acceptance share (study_type filled among rows with a
 * protocolSection) leaves them out.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ClinicalTrialsStudyRecord } from "../src/lib/community/clinicaltrials-api-client";
import {
  designCaptureFields,
  designCoverage,
  formatDesignCoverage,
  formatDesignDryRunRow,
  parseDesign,
  type ClinicalTrialDesignFields,
} from "../src/lib/community/clinicaltrials-design";

config({ path: ".env.local", quiet: true });

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const DRY_RUN = flag("--dry-run");
const PENDING = flag("--pending");
const LIMIT = opt("--limit") ? Number(opt("--limit")) : null;
const INVESTIGATOR = opt("--investigator") ?? null;
const NCT_IDS = (opt("--nct") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const UPSERT_CHUNK = 200;
const PAGE = 1000;
const MIGRATION = "supabase/migrations/20260913110000_fit_ctgov_design.sql";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}
const supabase: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });

type TrialRow = { investigator_id: string; nct_id: string; raw_json: unknown };

function isMissingDesignColumn(message: string): boolean {
  return /design_parsed_at|study_type|investigator_role/i.test(message);
}

/** The write path must not rely on PostgREST naming a column in its error: probe one before writing (pubmed backfill pattern). */
async function assertMigrationApplied(): Promise<void> {
  const { error } = await supabase.from("investigator_clinical_trials").select("design_parsed_at").limit(1);
  if (!error) return;
  if (isMissingDesignColumn(error.message)) throw new Error(`${error.message}\nApply ${MIGRATION} before running the backfill.`);
  throw new Error(`investigator_clinical_trials read failed: ${error.message}`);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function loadInvestigatorNames(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("investigators")
      .select("id, full_name")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`investigators read failed: ${error.message}`);
    for (const r of (data ?? []) as Array<{ id: string; full_name: string | null }>) out.set(r.id, r.full_name ?? "");
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** Every trial row (or the filtered subset). Before the migration is applied, --pending --dry-run treats every row as pending. */
async function loadRows(): Promise<{ rows: TrialRow[]; migrationApplied: boolean }> {
  const rows: TrialRow[] = [];
  let migrationApplied = true;
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from("investigator_clinical_trials")
      .select("investigator_id, nct_id, raw_json")
      .order("nct_id")
      .order("investigator_id")
      .range(from, from + PAGE - 1);
    if (INVESTIGATOR) q = q.eq("investigator_id", INVESTIGATOR);
    if (NCT_IDS.length) q = q.in("nct_id", NCT_IDS);
    if (PENDING && migrationApplied) q = q.is("design_parsed_at", null);
    const { data, error } = await q;
    if (error) {
      if (PENDING && migrationApplied && isMissingDesignColumn(error.message)) {
        if (!DRY_RUN) throw new Error(`${error.message}\nApply ${MIGRATION} before running the backfill.`);
        console.error(`note: ${error.message} — migration not applied; dry run treats every row as pending`);
        migrationApplied = false;
        from -= PAGE;
        continue;
      }
      throw new Error(`investigator_clinical_trials read failed: ${error.message}`);
    }
    rows.push(...((data ?? []) as TrialRow[]));
    if (!data || data.length < PAGE) break;
  }
  return { rows, migrationApplied };
}

async function main(): Promise<void> {
  const names = await loadInvestigatorNames();
  const { rows, migrationApplied } = await loadRows();
  const selected = LIMIT != null ? rows.slice(0, LIMIT) : rows;
  const parsedAt = new Date().toISOString();

  const items = selected.map((row) => {
    const study = (row.raw_json && typeof row.raw_json === "object" ? row.raw_json : {}) as ClinicalTrialsStudyRecord;
    const investigator = names.get(row.investigator_id) ?? "";
    const design = parseDesign(study, investigator);
    return { row, study, design, label: investigator || row.investigator_id, fields: designCaptureFields(design, parsedAt) };
  });

  console.error(
    `${rows.length} trial row${rows.length === 1 ? "" : "s"}${PENDING ? " pending" : ""}` +
      (LIMIT != null ? `, ${selected.length} selected` : "") +
      ` → parse from raw_json, no network` +
      (DRY_RUN ? "  [dry run: nothing will be written]" : "") +
      (migrationApplied ? "" : "  [migration not applied]")
  );
  if (!items.length) return;

  let rowsWritten = 0;
  if (DRY_RUN) {
    for (const item of items) console.log(formatDesignDryRunRow(item.row.nct_id, item.label, item.study, item.fields));
  } else {
    await assertMigrationApplied();
    const updates: Array<Pick<TrialRow, "investigator_id" | "nct_id"> & ClinicalTrialDesignFields> = items.map((item) => ({
      investigator_id: item.row.investigator_id,
      nct_id: item.row.nct_id,
      ...item.fields,
    }));
    for (const part of chunk(updates, UPSERT_CHUNK)) {
      const { error } = await supabase.from("investigator_clinical_trials").upsert(part, { onConflict: "investigator_id,nct_id" });
      if (error) {
        if (isMissingDesignColumn(error.message)) throw new Error(`${error.message}\nApply ${MIGRATION} before running the backfill.`);
        throw new Error(`upsert failed: ${error.message}`);
      }
      rowsWritten += part.length;
    }
  }

  console.error(
    `\ndone: ${formatDesignCoverage(designCoverage(items))}` +
      (DRY_RUN ? " (dry run, nothing written)" : `; ${rowsWritten} rows updated`)
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
