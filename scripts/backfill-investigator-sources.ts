/**
 * One-off / manual: connect UCSF Profiles and ORCID for every investigator
 * and (optionally) re-fetch RePORTER / PubMed so the sources model is
 * populated. Nightly runs are handled by /api/cron/refresh-investigator-caches.
 *
 *   npm run backfill-investigator-sources                          # profiles + orcid only (fast, ~1s per person)
 *   npm run backfill-investigator-sources -- --sources all         # everything, like the nightly job
 *   npm run backfill-investigator-sources -- --sources pubmed,reporter --limit 20
 *   npm run backfill-investigator-sources -- --id <investigator uuid>
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { refreshInvestigatorSources, type RefreshableSource } from "../src/lib/investigators/refresh-sources";
import { runWorkerPool } from "../src/lib/utils/async-rate-limiter";

config({ path: ".env.local" });

const args = process.argv.slice(2);
const val = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const sourcesArg = val("--sources") ?? "profiles,orcid";
const sources: RefreshableSource[] | "all" = sourcesArg === "all" ? "all" : (sourcesArg.split(",").map((s) => s.trim()).filter(Boolean) as RefreshableSource[]);
const limit = Number(val("--limit") ?? 10_000);
const concurrency = Number(val("--concurrency") ?? 3);
const onlyId = val("--id");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const started = Date.now();
  let query = db.from("investigators").select("id, full_name").is("archived_at", null).order("last_name").limit(limit);
  if (onlyId) query = query.eq("id", onlyId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const people = (data ?? []) as Array<{ id: string; full_name: string }>;
  console.log(`Refreshing ${sources === "all" ? "all sources" : sources.join(", ")} for ${people.length} investigator(s), concurrency ${concurrency}`);

  const tally = new Map<string, { ok: number; skipped: number; failed: number }>();
  const { data: logRow } = await db.from("sync_job_logs").insert({ job_type: "investigator_sources", status: "started", details: { manual: true, sources, investigators: people.length } }).select("id").single();

  await runWorkerPool(people, concurrency, async (p, i) => {
    const outcomes = await refreshInvestigatorSources(db, p.id, sources);
    const line = outcomes.map((o) => `${o.ok ? (o.skipped ? "·" : "✓") : "✗"} ${o.message}`).join(" | ");
    console.log(`[${i + 1}/${people.length}] ${p.full_name}: ${line}`);
    for (const o of outcomes) {
      const t = tally.get(o.source) ?? { ok: 0, skipped: 0, failed: 0 };
      if (!o.ok) t.failed += 1;
      else if (o.skipped) t.skipped += 1;
      else t.ok += 1;
      tally.set(o.source, t);
    }
  });

  const summary = Array.from(tally.entries()).map(([s, t]) => `${s}: ${t.ok} ok, ${t.skipped} skipped, ${t.failed} failed`).join("\n");
  console.log(`\n${summary}\nDone in ${Math.round((Date.now() - started) / 1000)}s`);
  if (logRow?.id) {
    await db.from("sync_job_logs").update({ status: "success", message: summary, details: { manual: true, sources, investigators: people.length, tally: Object.fromEntries(tally) }, finished_at: new Date().toISOString() }).eq("id", logRow.id);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
