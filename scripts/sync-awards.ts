/**
 * Backfill UCSF awards from the public NIH RePORTER API.
 *   npx tsx --env-file=.env.local scripts/sync-awards.ts [--from 2015] [--to 2026]
 */
import { createClient } from "@supabase/supabase-js";
import { linkAwardPis, syncReporterAwards } from "../src/lib/institution/reporter-sync";
import { currentFiscalYear } from "../src/lib/institution/awards";
import { isoToday } from "../src/lib/funding-opportunities/receipt-cycles";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const args = process.argv.slice(2);
  const arg = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? Number(args[i + 1]) : null;
  };
  const to = arg("--to") ?? currentFiscalYear(isoToday());
  const from = arg("--from") ?? to - 2;
  const fiscalYears = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const admin = createClient(url, key, { auth: { persistSession: false } });
  console.log(`Syncing UCSF awards from NIH RePORTER for FY${from}–FY${to}…`);
  const r = await syncReporterAwards(admin, { fiscalYears, log: (l) => console.log(l) });
  console.log(r.ok ? `Upserted ${r.upserted} awards across ${r.pages} pages` : `Failed: ${r.error}`);
  const linked = await linkAwardPis(admin);
  console.log(`Linked ${linked} awards to investigators`);
  process.exit(r.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
