/**
 * Fit engine · PR 0.6 · RePORTER exemplars by announcement.
 *
 *   npm run fit:reporter-exemplars -- --dry-run --limit 13                       # fetch for 13 due notices, print counts, write nothing
 *   npm run fit:reporter-exemplars -- --dry-run --opportunity PAR-25-122,RFA-DA-27-004
 *   npm run fit:reporter-exemplars                                               # every due open NIH notice; resumable (stamped notices are skipped for 30 days)
 *   npm run fit:reporter-exemplars -- --limit 100                                # at most 100 notices this run
 *   npm run fit:reporter-exemplars -- --opportunity PAR-25-122                   # re-fetch these now, regardless of the stamp
 *
 * The real path is exactly what /api/cron/fit-exemplars runs
 * (syncOpportunityExemplars): open NIH-like notices never fetched or fetched
 * more than 30 days ago (errors after 7), oldest stamp first; per notice one
 * RePORTER request per 100 award-years (≥ 250 ms apart, at most 5 pages), the
 * lineage walked through funding_opportunities.reissue_of up to 4 steps; up to
 * 60 exemplars stored newest fiscal year first, the notice's older rows pruned,
 * and funding_opportunities.exemplars_fetched_at stamped — for zero-exemplar
 * notices too, so a rerun never re-fetches the corpus.
 *
 * Requires supabase/migrations/20260913130000_fit_reporter_exemplars.sql for the
 * real path; --dry-run works before it is applied (every open NIH notice counts
 * as due).
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { REPORTER_EXEMPLAR_MAX_PAGES } from "../src/lib/ingestion/reporter/exemplars";
import { countDueNotices, EXEMPLARS_MIGRATION, formatSyncSummary, syncOpportunityExemplars } from "../src/lib/ingestion/reporter/exemplars-sync";

config({ path: ".env.local", quiet: true });

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const DRY_RUN = flag("--dry-run");
const LIMIT = opt("--limit") ? Number(opt("--limit")) : null;
const OPPORTUNITIES = (opt("--opportunity") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (LIMIT != null && (!Number.isFinite(LIMIT) || LIMIT < 1)) {
  console.error("--limit must be a positive integer");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}
const supabase: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const now = new Date();
  console.log(`fit:reporter-exemplars · ${DRY_RUN ? "DRY RUN (nothing is written)" : "real run"} · ${now.toISOString()}`);

  let planned: number;
  if (OPPORTUNITIES.length) {
    planned = OPPORTUNITIES.length;
    console.log(`Requested notices: ${OPPORTUNITIES.length} (${OPPORTUNITIES.join(", ")}) — the stamp is ignored for these`);
  } else {
    const { due, migrationApplied } = await countDueNotices(supabase, now);
    if (!migrationApplied && !DRY_RUN) {
      console.error(`${EXEMPLARS_MIGRATION} is not applied; apply it before the real run (--dry-run works without it).`);
      process.exit(1);
    }
    planned = LIMIT != null ? Math.min(LIMIT, due) : due;
    console.log(`Due notices (open, NIH-like, ${migrationApplied ? "never fetched or older than 30 days" : "every one — the stamp columns do not exist yet"}): ${due}; this run: ${planned}`);
  }
  console.log(`RePORTER requests: ≥ ${planned}, ≤ ${planned * REPORTER_EXEMPLAR_MAX_PAGES} (one per 100 award-years, at most ${REPORTER_EXEMPLAR_MAX_PAGES} pages per notice, ≥ 250 ms apart)`);
  if (!planned) {
    console.log("Nothing to do.");
    return;
  }
  console.log("");

  const result = await syncOpportunityExemplars(supabase, {
    limit: LIMIT ?? undefined,
    opportunityNumbers: OPPORTUNITIES.length ? OPPORTUNITIES : undefined,
    dryRun: DRY_RUN,
    now,
    log: (line) => console.log(line),
  });
  if (!result.ok) {
    console.error(`Failed: ${result.error}`);
    process.exit(1);
  }
  console.log("");
  console.log(formatSyncSummary(result));
  if (result.errors > 0 && result.fetched === 0) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
