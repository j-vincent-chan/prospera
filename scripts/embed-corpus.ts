/**
 * One-off / manual: embed the evidence corpus for the suggestion engine —
 * every investigator's verified evidence (and document vector) and every open
 * notice. Nightly upkeep is /api/cron/refresh-investigator-caches (people)
 * and /api/cron/embed-opportunities (notices).
 *
 *   npm run embed-corpus                    # people + open notices
 *   npm run embed-corpus -- --only people
 *   npm run embed-corpus -- --only notices --limit 500
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { listOpenOpportunityIds, syncInvestigatorEmbeddings, syncOpportunityEmbeddings } from "../src/lib/outreach/embeddings";
import { runWorkerPool } from "../src/lib/utils/async-rate-limiter";

config({ path: ".env.local" });

const args = process.argv.slice(2);
const val = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = val("--only");
const limit = Number(val("--limit") ?? 10_000);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY missing in .env.local");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const started = Date.now();
  if (only !== "notices") {
    const { data } = await db.from("investigators").select("id, full_name").is("archived_at", null).order("last_name").limit(limit);
    const people = (data ?? []) as Array<{ id: string; full_name: string }>;
    let items = 0;
    let embedded = 0;
    await runWorkerPool(people, 4, async (p, i) => {
      const r = await syncInvestigatorEmbeddings(db, p.id);
      items += r.items;
      embedded += r.embedded;
      console.log(`[${i + 1}/${people.length}] ${p.full_name}: ${r.items} items, ${r.embedded} embedded`);
    });
    console.log(`People: ${people.length} · ${items} evidence items · ${embedded} newly embedded`);
  }
  if (only !== "people") {
    const ids = await listOpenOpportunityIds(db, limit);
    const r = await syncOpportunityEmbeddings(db, ids);
    console.log(`Notices: ${ids.length} open · ${r.embedded} embedded · ${r.skipped} unchanged`);
  }
  console.log(`Done in ${Math.round((Date.now() - started) / 1000)}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
