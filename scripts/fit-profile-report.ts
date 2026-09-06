/**
 * Fit engine · PR 1.4 · investigator fit profiles over the roster, for the
 * spot check: per investigator the dominant paradigm (career / recent), the
 * top designs, evidence counts by source, item count and per-axis confidence,
 * then a roster summary (distribution of dominant paradigms, share thin
 * evidence, confidence per axis). Read-only in both modes; nothing is written.
 *
 *   npm run fit:profile-report                           # --report: from stored investigator_fit_profiles rows (empty until the first cron run)
 *   npm run fit:profile-report -- --dry-run              # build every profile in memory: rules + the existing item cache, modelBudget 0, no model calls, no writes
 *   npm run fit:profile-report -- --dry-run --limit 20   # the first N investigators (id order)
 *   npm run fit:profile-report -- --investigator <uuid>  # one person (either mode)
 *   npm run fit:profile-report -- --json                 # lines + summary as JSON on stdout
 *
 * The dry run never calls the model: items the model would be needed for and
 * that the cache does not hold are counted as `skipped` and their rule-free
 * axes stay empty, so the dry-run profile is a lower bound on what the cron
 * (which spends its model budget) will store. A line marked `[PENDING n]` is
 * a partial profile — n items await the classifier (the stored row's
 * `pending_items`).
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { formatProfileReport, summarizeProfile, summarizeRoster, type ProfileReportLine } from "../src/lib/fit/profile/report";
import { profilesTableExists, syncInvestigatorFitProfiles } from "../src/lib/fit/profile/sync";
import { TAXONOMY_VERSION } from "../src/lib/fit/taxonomy";
import type { InvestigatorFitProfile } from "../src/lib/fit/types";

config({ path: ".env.local", quiet: true });

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const DRY_RUN = flag("--dry-run");
const REPORT = flag("--report") || !DRY_RUN;
const INVESTIGATOR = opt("--investigator") ?? null;
const LIMIT = opt("--limit") ? Number(opt("--limit")) : null;
const JSON_OUT = flag("--json");
const PAGE = 500;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}
const supabase: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });

function print(lines: ProfileReportLine[], mode: string) {
  const summary = summarizeRoster(lines);
  if (JSON_OUT) {
    console.log(JSON.stringify({ mode, taxonomy_version: TAXONOMY_VERSION, generated_at: new Date().toISOString(), lines, summary }, null, 2));
    return;
  }
  console.log(`# fit:profile-report — ${mode} — taxonomy ${TAXONOMY_VERSION} — ${new Date().toISOString()}\n`);
  console.log(formatProfileReport(lines, summary));
}

async function dryRun(): Promise<void> {
  const lines: ProfileReportLine[] = [];
  const result = await syncInvestigatorFitProfiles(supabase, {
    dryRun: true,
    force: true,
    maxModelCalls: 0,
    limit: LIMIT ?? 100_000,
    investigatorIds: INVESTIGATOR ? [INVESTIGATOR] : undefined,
    timeBudgetMs: 6 * 3_600_000,
    log: (line) => console.error(line),
    onBuilt: (r) => {
      lines.push(summarizeProfile(r.profile, { name: r.name, item_count: r.item_count, diagnostics: r.diagnostics, model: { needed: r.model_needed, called: r.model_called, skipped: r.model_skipped, cache_hits: r.cache_hits }, pending_items: r.pending_items, incomplete: r.incomplete }));
    },
  });
  print(lines, `dry run (rules + cache only, model calls ${result.modelCalls}, nothing written)`);
  if (result.errors) {
    console.error(`${result.errors} investigator(s) failed to build:`);
    for (const o of result.investigators.filter((i) => i.status === "error")) console.error(`  ${o.line}`);
    process.exit(2);
  }
}

async function report(): Promise<void> {
  if (!(await profilesTableExists(supabase))) {
    console.error("investigator_fit_profiles does not exist yet (apply supabase/migrations/20260915100000_fit_investigator_profiles.sql); 0 profiles stored");
    print([], "stored profiles");
    return;
  }
  const rows: Array<{ investigator_id: string; profile: InvestigatorFitProfile; item_count: number; pending_items: number | null; computed_at: string; taxonomy_version: string }> = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from("investigator_fit_profiles").select("investigator_id, profile, item_count, pending_items, computed_at, taxonomy_version").order("investigator_id");
    if (INVESTIGATOR) q = q.eq("investigator_id", INVESTIGATOR);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(`investigator_fit_profiles read failed: ${error.message}`);
    rows.push(...((data ?? []) as typeof rows));
    if (LIMIT != null && rows.length >= LIMIT) {
      rows.splice(LIMIT);
      break;
    }
    if (!data || data.length < PAGE) break;
  }
  const names = new Map<string, string | null>();
  for (let i = 0; i < rows.length; i += 200) {
    const ids = rows.slice(i, i + 200).map((r) => r.investigator_id);
    const { data, error } = await supabase.from("investigators").select("id, full_name").in("id", ids);
    if (error) throw new Error(`investigators read failed: ${error.message}`);
    for (const r of data ?? []) names.set(r.id as string, (r.full_name as string | null) ?? null);
  }
  const stale = rows.filter((r) => r.taxonomy_version !== TAXONOMY_VERSION).length;
  const pending = rows.filter((r) => (r.pending_items ?? 0) > 0).length;
  console.error(`investigator_fit_profiles: ${rows.length} stored profile(s)${stale ? `, ${stale} on another taxonomy version` : ""}${pending ? `, ${pending} pending (partial)` : ""}`);
  const lines = rows.map((r) => summarizeProfile(r.profile, { name: names.get(r.investigator_id) ?? null, item_count: r.item_count, pending_items: r.pending_items ?? 0 }));
  print(lines, "stored profiles");
}

async function main(): Promise<void> {
  if (DRY_RUN) await dryRun();
  else if (REPORT) await report();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
