/**
 * Fit engine · PR 2.2 · retrieval + scoring over the open corpus.
 *
 *   npm run fit:results-report -- --dry-run                                  # every investigator with a stored profile, ranked in memory; nothing written
 *   npm run fit:results-report -- --dry-run --limit 3                        # the first N (id order)
 *   npm run fit:results-report -- --dry-run --investigator <uuid> [--investigator <uuid>]
 *   npm run fit:results-report -- --dry-run --notice RFA-DK-26-315           # the mirror: the roster against one notice
 *   npm run fit:results-report -- --dry-run --top 15 --json                  # rows per pair as JSON
 *   npm run fit:results-report -- --write [--limit N] [--cursor <uuid>]      # the coordinator's path: the nightly sweep (IDF + fit_results) from a terminal
 *
 * The dry run loads the open notices with a fit profile (MeSH filled from
 * their terms at load, IDF and BM25 document frequencies computed in
 * memory), each investigator's stored profile, evidence items (rules + the
 * item cache, no model call) and outreach embeddings, runs stage 1 retrieval
 * and the pure engine on every candidate, and prints per pair: tier, score,
 * the nine components, caps, and the candidate route. `--write` upserts
 * fit_results and fit_topic_idf through the same code the cron runs.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { rankForInvestigator, rankForNotice, refreshFitResults, supabaseFitStore, type FitCorpus, type RankForInvestigatorResult, type RankForNoticeResult } from "../src/lib/fit/service";
import { TAXONOMY_VERSION } from "../src/lib/fit/taxonomy";
import type { FitResult } from "../src/lib/fit/types";

config({ path: ".env.local", quiet: true });

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opts = (name: string) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]!] : []));
const opt = (name: string) => opts(name)[0];
const DRY_RUN = flag("--dry-run");
const WRITE = flag("--write");
const INVESTIGATORS = opts("--investigator").flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
const NOTICE = opt("--notice")?.trim().toUpperCase() ?? null;
const LIMIT = opt("--limit") ? Number(opt("--limit")) : null;
const CURSOR = opt("--cursor") ?? null;
const TOP = Number(opt("--top") ?? 12);
const JSON_OUT = flag("--json");

if (DRY_RUN === WRITE) {
  console.error("usage: fit:results-report -- --dry-run [--investigator <uuid>]... [--notice <number>] [--limit N] [--top N] [--json] | --write [--limit N] [--cursor <uuid>]");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}
const supabase: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });
const store = supabaseFitStore(supabase, { log: (line) => console.error(line) });

const f2 = (n: number) => n.toFixed(2);
const components = (r: FitResult) => `E ${r.components.E} P ${f2(r.components.P)} U ${f2(r.components.U)} D ${f2(r.components.D)} T ${f2(r.components.T)} M ${f2(r.components.M)} O ${f2(r.components.O)} K ${f2(r.components.K)} A ${f2(r.components.A)}`;

function pairLine(r: FitResult, label: string, via: string | null): string {
  return `  ${r.tier.padEnd(11)} ${r.score.toFixed(1).padStart(5)}  ${label}\n      ${components(r)}${r.caps.length ? ` · caps ${r.caps.join(", ")}` : ""}${via ? ` · via ${via}` : ""}${r.provenance.T.coded_matches.length ? ` · coded ${r.provenance.T.coded_matches.map((m) => `${m.code}@${m.depth}`).slice(0, 4).join(" ")}` : ""}${r.flags.length ? `\n      flags: ${r.flags.slice(0, 3).join("; ")}` : ""}${r.gap ? `\n      gap: ${r.gap.slice(0, 220)}` : ""}${r.tier === "poor" && r.why_not ? `\n      why not: ${r.why_not.slice(0, 200)}` : ""}`;
}

function printInvestigator(r: RankForInvestigatorResult, corpus: FitCorpus) {
  const titles = new Map(corpus.notices.map((n) => [n.profile.opportunity_id, `${n.profile.number ?? n.facts.opportunity_number ?? n.profile.opportunity_id} · ${(n.facts.title ?? "").slice(0, 70)}`]));
  const via = new Map(r.candidates.candidates.map((c) => [c.id, c.via]));
  console.log(`\n## ${r.name ?? r.investigator_id} (${r.investigator_id})`);
  console.log(`candidates ${r.candidates.candidates.length} of ${r.stats.notices} open profiled notices (${r.candidates.structural} structured, ${r.candidates.recall_only} recall only; ${r.candidates.failed_e} failed E, ${r.candidates.below_p} below the P gate) · tiers strong ${r.tiers.strong} / moderate ${r.tiers.moderate} / exploratory ${r.tiers.exploratory} / poor ${r.tiers.poor} · near-miss ${r.near_miss.length} · items ${r.stats.items} (${r.stats.with_vector} embedded, ${r.stats.with_text} with text${r.stats.model_pending ? `, ${r.stats.model_pending} pending the classifier` : ""}) · ${r.durationMs} ms`);
  for (const x of r.results.slice(0, TOP)) console.log(pairLine(x, titles.get(x.opportunity_id) ?? x.opportunity_id, via.get(x.opportunity_id) ?? null));
  if (r.results.length > TOP) console.log(`  … ${r.results.length - TOP} more`);
}

function printNotice(r: RankForNoticeResult, names: Map<string, string | null>) {
  console.log(`\n## ${r.number ?? r.opportunity_id} · ${r.title ?? ""}`);
  const via = new Map(r.candidates.candidates.map((c) => [c.id, c.via]));
  console.log(`candidates ${r.candidates.candidates.length} of ${r.candidates.considered} profiled investigators (${r.candidates.structural} structured, ${r.candidates.recall_only} recall only; ${r.candidates.failed_e} failed E, ${r.candidates.below_p} below the P gate) · tiers strong ${r.tiers.strong} / moderate ${r.tiers.moderate} / exploratory ${r.tiers.exploratory} / poor ${r.tiers.poor} · near-miss ${r.near_miss.length}${r.errors.length ? ` · ${r.errors.length} errors` : ""} · ${r.durationMs} ms`);
  for (const x of r.results.slice(0, TOP)) console.log(pairLine(x, names.get(x.investigator_id) ?? x.investigator_id, via.get(x.investigator_id) ?? null));
  if (r.results.length > TOP) console.log(`  … ${r.results.length - TOP} more`);
  for (const e of r.errors) console.log(`  error ${e.investigator_id}: ${e.error}`);
}

async function dryRun(): Promise<void> {
  const now = new Date();
  const corpus = await store.loadCorpus(now);
  console.error(`corpus: ${corpus.notices.length} open notices with a fit profile (${corpus.with_vector} embedded, ${corpus.mesh_mapped} MeSH-mapped at load), IDF ${corpus.idf.rows.length} codes over n = ${corpus.idf.n}, ${Object.keys(corpus.termDf).length} BM25 terms`);
  console.log(`# fit:results-report — dry run — taxonomy ${TAXONOMY_VERSION} — ${now.toISOString()}`);
  const out: unknown[] = [];
  if (NOTICE) {
    const notice = corpus.notices.find((n) => (n.profile.number ?? n.facts.opportunity_number ?? "").toUpperCase() === NOTICE || n.profile.opportunity_id === NOTICE.toLowerCase());
    if (!notice) {
      console.error(`notice ${NOTICE} is not in the open corpus with a fit profile`);
      process.exit(2);
    }
    const r = await rankForNotice(store, notice.profile.opportunity_id, { corpus, write: false, now: () => now });
    if (!r) throw new Error("rankForNotice returned null");
    const roster = await store.loadRoster();
    printNotice(r, new Map(roster.map((x) => [x.investigator_id, x.name])));
    out.push({ notice: r.number, tiers: r.tiers, results: r.results });
  } else {
    const roster = await store.loadRoster();
    const ids = INVESTIGATORS.length ? INVESTIGATORS : roster.map((x) => x.investigator_id).slice(0, LIMIT ?? roster.length);
    for (const id of ids) {
      const r = await rankForInvestigator(store, id, { corpus, write: false, now: () => now });
      if (!r) {
        console.log(`\n## ${id}: no stored fit profile`);
        continue;
      }
      printInvestigator(r, corpus);
      out.push({ investigator: r.investigator_id, name: r.name, tiers: r.tiers, candidates: r.candidates.candidates.length, results: r.results });
    }
  }
  if (JSON_OUT) console.log(JSON.stringify({ generated_at: now.toISOString(), taxonomy_version: TAXONOMY_VERSION, corpus: { notices: corpus.notices.length, idf_codes: corpus.idf.rows.length }, ranked: out }, null, 2));
}

async function write(): Promise<void> {
  const r = await refreshFitResults(store, { limit: LIMIT ?? undefined, cursor: CURSOR, investigatorIds: INVESTIGATORS.length ? INVESTIGATORS : undefined, timeBudgetMs: 6 * 3_600_000, log: (line) => console.error(line) });
  console.log(JSON.stringify({ outcome: r.outcome, taken: r.taken, written: r.written, errors: r.errors, pairs: r.pairs, upserted: r.upserted, deleted: r.deleted, tiers: r.tiers, near_miss: r.near_miss, idf: r.idf, corpus: r.corpus, next_cursor: r.next_cursor, durationMs: r.durationMs, skipped: r.skipped }, null, 2));
  if (r.outcome === "error" || r.skipped) process.exit(3);
  if (r.outcome === "partial") process.exit(2);
}

(DRY_RUN ? dryRun() : write()).catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
