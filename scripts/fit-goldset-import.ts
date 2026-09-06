/**
 * Fit engine · PR 2.4 · import a labeled gold-set CSV into fit_labels.
 *
 *   npm run fit:goldset-import -- --csv labels.csv --dry-run                                   # labelers from docs/fit-engine/goldset/labelers.json
 *   npm run fit:goldset-import -- --csv labels.csv --labeler-a a@ucsf.edu --labeler-b b@ucsf.edu --adjudicator c@ucsf.edu --dry-run
 *   npm run fit:goldset-import -- --csv labels.csv --write                                     # the coordinator's path
 *
 * Reads the CSV (the export's columns with tier_a / reason_a / axis_reason_a,
 * tier_b …, tier_adj … filled in — or the page's export), validates every
 * label (tier in the taxonomy's four; reason from the feedback list, required
 * for Exploratory / Poor; axis sub-reason `<axis>:<category>` valid against the
 * taxonomy and required by "wrong type of research"), resolves the three
 * labelers by email or auth user id against `profiles`, computes the
 * adjudicated tier (agreement → that tier; disagreement → the adjudicator's
 * column; else the pair is flagged unresolved) and plans one `fit_labels` row
 * per (pair, labeler) plus one adjudicated row under the adjudicator (source
 * `gold`, engine_version = the manifest's). A row identical to the latest
 * stored one for that (pair, labeler) is skipped, so a re-import writes
 * nothing. `--dry-run` prints the plan; `--write` inserts it. Validation
 * errors block the write.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { parseCsv } from "../src/lib/fit/goldset/csv";
import { formatPlannedRow, planImport } from "../src/lib/fit/goldset/import";
import { goldLabelRow, resolveIdentity, SLOTS, type Slot } from "../src/lib/fit/goldset/labels";
import { loadGoldLabels, loadLabelerIdentities } from "../src/lib/fit/goldset/load";
import { GOLDSET_MANIFEST, LABELER_CONFIG, manifestPairById } from "../src/lib/fit/goldset/manifest";

config({ path: ".env.local", quiet: true });

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]!] : []))[0];
const CSV = opt("--csv");
const DRY_RUN = flag("--dry-run");
const WRITE = flag("--write");
const LABELERS: Record<Slot, string | null> = { a: opt("--labeler-a") ?? LABELER_CONFIG.a, b: opt("--labeler-b") ?? LABELER_CONFIG.b, adjudicator: opt("--adjudicator") ?? LABELER_CONFIG.adjudicator };

if (!CSV || DRY_RUN === WRITE) {
  console.error("usage: fit:goldset-import -- --csv <file> [--labeler-a <email|uuid>] [--labeler-b <email|uuid>] [--adjudicator <email|uuid>] (--dry-run | --write)");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}
const supabase: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });

async function main(): Promise<void> {
  const text = readFileSync(CSV!, "utf8");
  const parsed = parseCsv(text);
  if (parsed.missing_columns.length) {
    console.error(`CSV is missing columns: ${parsed.missing_columns.join(", ")}`);
    process.exit(2);
  }
  for (const e of parsed.errors) console.error(`csv: ${e}`);

  const missing = SLOTS.filter((s) => !LABELERS[s]);
  if (missing.length) {
    console.error(`labelers not configured: ${missing.join(", ")} — pass --labeler-a / --labeler-b / --adjudicator or fill docs/fit-engine/goldset/labelers.json (D4)`);
    process.exit(2);
  }
  const identities = await loadLabelerIdentities(supabase, { ids: SLOTS.map((s) => LABELERS[s]!), emails: SLOTS.map((s) => LABELERS[s]!) });
  const resolved = {} as Record<Slot, string>;
  for (const s of SLOTS) {
    const id = resolveIdentity(LABELERS[s], identities);
    if (!id) {
      console.error(`labeler ${s} "${LABELERS[s]}" matches no profiles row (email or id)`);
      process.exit(2);
    }
    resolved[s] = id;
  }
  if (new Set(Object.values(resolved)).size < 3) {
    console.error("the three labelers must be three different people");
    process.exit(2);
  }

  const existing = await loadGoldLabels(supabase);
  if (!existing.available) {
    console.error("fit_labels is not on the database — apply supabase/migrations/20260916100000_fit_labels.sql first");
    process.exit(3);
  }
  if (existing.error) throw new Error(existing.error);

  const plan = planImport({ rows: parsed.rows, pairsById: manifestPairById(GOLDSET_MANIFEST), labelers: resolved, existing: existing.rows, engine_version: GOLDSET_MANIFEST.engine_version });

  console.log(`# fit:goldset-import — ${DRY_RUN ? "dry run" : "write"} — ${CSV} — gold set ${GOLDSET_MANIFEST.version} (engine ${GOLDSET_MANIFEST.engine_version})`);
  console.log(`labelers: a ${LABELERS.a} → ${resolved.a}; b ${LABELERS.b} → ${resolved.b}; adjudicator ${LABELERS.adjudicator} → ${resolved.adjudicator}`);
  console.log(`csv rows ${parsed.rows.length}; existing gold rows ${existing.rows.length}`);
  for (const s of SLOTS) console.log(`  ${s.padEnd(11)} labeled ${plan.per_slot[s].labeled} (${plan.per_slot[s].inserts} to insert, ${plan.per_slot[s].unchanged} unchanged)`);
  console.log(`adjudication: agreed ${plan.adjudication.agreed}, by adjudicator ${plan.adjudication.by_adjudicator}, unresolved ${plan.adjudication.unresolved.length}${plan.adjudication.unresolved.length ? ` (${plan.adjudication.unresolved.join(", ")})` : ""}, pending one label ${plan.adjudication.pending.length}, unlabeled ${plan.adjudication.unlabeled}`);
  console.log(`rows: ${plan.rows.length} planned — ${plan.inserts} inserts, ${plan.unchanged} unchanged`);
  for (const r of plan.rows) console.log(`  ${formatPlannedRow(r)}`);
  for (const e of plan.errors) console.log(`ERROR ${e.message}`);
  if (plan.errors.length) {
    console.error(`${plan.errors.length} validation error(s) — nothing written`);
    process.exit(2);
  }
  if (DRY_RUN) return;

  const inserts = plan.rows.filter((r) => r.action === "insert").map((r) => goldLabelRow({ investigator_id: r.investigator_id, opportunity_id: r.opportunity_id, tier: r.tier, reason: r.reason, axis_reason: r.axis_reason, labeler: r.labeler, engine_version: GOLDSET_MANIFEST.engine_version }));
  let written = 0;
  for (let i = 0; i < inserts.length; i += 100) {
    const { error } = await supabase.from("fit_labels").insert(inserts.slice(i, i + 100));
    if (error) throw new Error(`fit_labels insert failed after ${written} rows: ${error.message}`);
    written += Math.min(100, inserts.length - i);
  }
  console.log(`written ${written} fit_labels rows`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
