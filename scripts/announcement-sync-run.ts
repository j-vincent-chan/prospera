/**
 * Manual driver for the nightly announcement sync (PR 5.5a) — the same
 * `syncAnnouncements` the cron calls, run from a shell against `.env.local`.
 * The cron owns the schedule; this is for the first sweeps and for debugging.
 *
 *   npm run fit:announcements -- --dry-run --limit 20
 *   npm run fit:announcements -- --write --limit 40
 *   npm run fit:announcements -- --write --family nsf --limit 91
 *
 * `--write` is required to write; the default is a dry run. Families are the
 * registry's, minus `nih`, which the service refuses.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { FunderFamily } from "../src/lib/ingestion/announcement/registry";
import { syncAnnouncements, type NoticeOutcome } from "../src/lib/services/announcement-sync";

config({ path: ".env.local", quiet: true });

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string): string | null => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1]! : null;
};

const write = flag("--write");
const limit = Number(opt("--limit") ?? 20);
const families = (opt("--family") ?? "").split(",").map((s) => s.trim()).filter(Boolean) as FunderFamily[];
const only = (opt("--only") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const timeBudgetMs = Number(opt("--time-budget") ?? 3_600_000);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}

const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));

async function main() {
  const db = createClient(url!, key!, { auth: { persistSession: false } });
  console.error(`${write ? "WRITING" : "DRY RUN — nothing will be written"}: limit ${limit}${families.length ? `, families [${families.join(", ")}]` : ""}${only.length ? `, numbers [${only.join(", ")}]` : ""}\n`);
  const started = Date.now();
  const result = await syncAnnouncements(db, {
    limit,
    timeBudgetMs,
    dryRun: !write,
    families: families.length ? families : undefined,
    opportunityNumbers: only.length ? only : undefined,
    onNotice: (o: NoticeOutcome) =>
      console.log(
        [
          pad(o.number, 26),
          pad(o.family, 14),
          pad(o.adapter, 22),
          pad(o.reason, 14),
          pad(o.status, 16),
          pad(`sections=${o.sections}`, 13),
          pad(`get=${o.pageFetches} api=${o.simplerCalls}`, 12),
          o.error ? `error: ${o.error}` : (o.source ?? ""),
        ].join(" | "),
      ),
  });
  console.error(`\n--- summary (${((Date.now() - started) / 1000).toFixed(1)} s) ---`);
  console.error(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
