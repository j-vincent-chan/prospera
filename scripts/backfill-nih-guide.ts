/**
 * One-off / manual: fetch NIH Guide pages for NIH notices and store receipt
 * cycles. Nightly runs are handled by /api/cron/sync-nih-guide; use this to
 * backfill after the step-3 migration or to re-check a few notices.
 *
 *   npm run backfill-nih-guide                # up to 1500 notices, ~700ms apart
 *   npm run backfill-nih-guide -- --limit 50
 *   npm run backfill-nih-guide -- --force PAR-25-301 RFA-NS-25-018
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { syncNihGuide } from "../src/lib/services/nih-guide-sync";

config({ path: ".env.local" });

const args = process.argv.slice(2);
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : 1500;
const force = args.includes("--force");
const numbers = args.filter((a) => /^(PA|PAR|RFA)-[A-Z]{2}-\d{2}-\d{3}$/i.test(a)).map((a) => a.toUpperCase());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
syncNihGuide(supabase, { limit, force, opportunityNumbers: numbers.length ? numbers : undefined, minIntervalMs: 700 })
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
