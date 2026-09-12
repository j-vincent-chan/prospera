/**
 * Re-resolve `nih_ic_tokens` for every NIH notice with the ranked resolver
 * (src/lib/funding-opportunities/nih-ic-resolution.ts) and stamp `nih_ic_source` /
 * `nih_ic_reason`. Every option's input is read from the stored row (Guide sections,
 * Simpler payload, number, title, summary), so this is a full resolution — nothing is
 * carried from the previous answer.
 *
 *   npm run backfill-nih-ic -- --dry-run                 # resolve every NIH notice, print the report, write nothing
 *   npm run backfill-nih-ic -- --dry-run --open           # open notices only
 *   npm run backfill-nih-ic -- --dry-run RFA-AI-27-004    # one or more notice numbers
 *   npm run backfill-nih-ic -- --limit 25                 # first real run: a few rows, then inspect them
 *   npm run backfill-nih-ic                               # the rest (idempotent; ordered by id, resumable with --after <id>)
 *
 * Flags: --dry-run · --open · --limit N · --after <id> · --changes N (how many changed rows to print, default 40).
 * Writes refuse to run until supabase/migrations/20260928100000_funding_opportunities_nih_ic_source.sql
 * is applied (a GET probe of the new columns); --dry-run works either way.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { agencyContactFromRaw } from "../src/lib/ingestion/simpler-grants/fields";
import {
  NIH_IC_SOURCES,
  nihIcSourceRank,
  resolveNihIcTokens,
  type NihIcResolution,
  type NihIcSourceColumn,
} from "../src/lib/funding-opportunities/nih-ic-resolution";

config({ path: ".env.local", quiet: true });

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opts = (name: string): string[] => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]!] : []));

const DRY_RUN = flag("--dry-run");
const OPEN_ONLY = flag("--open");
const LIMIT = opts("--limit").length ? Number(opts("--limit")[0]) : Infinity;
const AFTER = opts("--after")[0] ?? null;
const SHOW_CHANGES = opts("--changes").length ? Number(opts("--changes")[0]) : 40;
const NUMBERS = args.filter((a) => /^(PA|PAR|PAS|RFA|NOT)-(?:[A-Z]{2}-)?\d{2}-\d{3}$/i.test(a)).map((a) => a.toUpperCase());
const MIGRATION = "supabase/migrations/20260928100000_funding_opportunities_nih_ic_source.sql";
const PAGE = 500;

if (!Number.isFinite(LIMIT) && LIMIT !== Infinity) {
  console.error("--limit expects a number");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

type Row = {
  id: string;
  opportunity_number: string | null;
  title: string | null;
  description: string | null;
  agency_code: string | null;
  close_date: string | null;
  nih_ic_tokens: string[] | null;
  nih_ic_source: string | null;
  guide_sections: Array<{ heading: string; text: string }> | null;
  raw_payload_json: Record<string, unknown> | null;
};

const BASE_SELECT = "id, opportunity_number, title, description, agency_code, close_date, nih_ic_tokens, guide_sections, raw_payload_json";
// The same candidate filter the Guide sync uses: NIH by agency code or by number shape.
const NIH_FILTER = "agency_code.like.HHS-NIH%,opportunity_number.like.PA-%,opportunity_number.like.PAR-%,opportunity_number.like.PAS-__-___,opportunity_number.like.RFA-%";

async function columnsApplied(): Promise<boolean> {
  const { error } = await supabase.from("funding_opportunities").select("nih_ic_source, nih_ic_reason").limit(1);
  return !error;
}

async function* rows(withSource: boolean): AsyncGenerator<Row> {
  const select = withSource ? `${BASE_SELECT}, nih_ic_source` : BASE_SELECT;
  let after = AFTER;
  for (;;) {
    let q = supabase.from("funding_opportunities").select(select).or(NIH_FILTER).order("id", { ascending: true }).limit(PAGE);
    if (after) q = q.gt("id", after);
    if (OPEN_ONLY) q = q.gte("close_date", new Date().toISOString().slice(0, 10));
    if (NUMBERS.length) q = q.in("opportunity_number", NUMBERS);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const page = (data ?? []) as unknown as Row[];
    for (const r of page) yield { ...r, nih_ic_source: r.nih_ic_source ?? null };
    if (page.length < PAGE) return;
    after = page[page.length - 1]!.id;
  }
}

const same = (a: string[] | null | undefined, b: string[]) => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...b].sort());

async function main() {
  const applied = await columnsApplied();
  if (!DRY_RUN && !applied) {
    console.error(`${MIGRATION} is not applied (probe of the new funding_opportunities columns failed). Apply it first; --dry-run works without it.`);
    process.exit(1);
  }
  if (DRY_RUN && !applied) console.error(`note: ${MIGRATION} not applied — dry run only; the stored source reads as null`);
  console.log(`${DRY_RUN ? "DRY RUN — " : ""}resolving NIH notices${OPEN_ONLY ? " (open only)" : ""}${NUMBERS.length ? ` [${NUMBERS.join(", ")}]` : ""}${Number.isFinite(LIMIT) ? `, limit ${LIMIT}` : ""}${AFTER ? `, after ${AFTER}` : ""}`);

  const bySource: Record<NihIcSourceColumn, number> = { guide_participating_orgs: 0, summary_text: 0, notice_number: 0, agency_contact: 0, unresolved: 0 };
  const before = { withTokens: 0, empty: 0 };
  let scanned = 0;
  let changed = 0;
  let upgraded = 0;
  let filled = 0;
  let emptied = 0;
  let written = 0;
  let errors = 0;
  const changes: string[] = [];
  const unresolved: string[] = [];
  let unresolvedNih = 0;
  const disagreements: string[] = [];
  const summaryVsGuide = { rows: 0, exact: 0, tp: 0, fp: 0, fn: 0 };
  let lastId: string | null = null;

  for await (const row of rows(applied)) {
    if (scanned >= LIMIT) break;
    scanned += 1;
    lastId = row.id;
    const res: NihIcResolution = resolveNihIcTokens({
      opportunity_number: row.opportunity_number,
      title: row.title,
      description: row.description,
      guide_sections: Array.isArray(row.guide_sections) ? row.guide_sections : null,
      agency_contact_description: agencyContactFromRaw(row.raw_payload_json),
    });
    bySource[res.source] += 1;
    const had = (row.nih_ic_tokens ?? []).length > 0;
    if (had) before.withTokens += 1;
    else before.empty += 1;

    const tokensChanged = !same(row.nih_ic_tokens, res.tokens);
    const sourceChanged = (row.nih_ic_source ?? null) !== res.source;
    if (tokensChanged) {
      changed += 1;
      if (!had && res.tokens.length) filled += 1;
      if (had && !res.tokens.length) emptied += 1;
      if (changes.length < SHOW_CHANGES) changes.push(`  ${row.opportunity_number ?? row.id}: [${(row.nih_ic_tokens ?? []).join(", ")}] → [${res.tokens.join(", ")}]  ← ${res.source}`);
    }
    if (nihIcSourceRank(res.source) < nihIcSourceRank(row.nih_ic_source)) upgraded += 1;
    if (res.source === "unresolved") {
      const nih = String(row.agency_code ?? "").startsWith("HHS-NIH");
      if (nih) unresolvedNih += 1;
      // The candidate filter is by number shape too, so CDC/FDA RFA-… rows land here; NIH ones are the flag that matters.
      if (nih && unresolved.length < 25) unresolved.push(`  ${row.opportunity_number ?? row.id}: ${res.reason}`);
    }
    // Where the summary names institutes the Guide does not (or vice versa) — the precision check behind the ranking.
    if (res.source === "guide_participating_orgs") {
      const summary = resolveNihIcTokens({ title: row.title, description: row.description });
      if (summary.tokens.length) {
        summaryVsGuide.rows += 1;
        const extra = summary.tokens.filter((t) => !res.tokens.includes(t));
        const missed = res.tokens.filter((t) => !summary.tokens.includes(t));
        summaryVsGuide.tp += summary.tokens.length - extra.length;
        summaryVsGuide.fp += extra.length;
        summaryVsGuide.fn += missed.length;
        if (!extra.length && !missed.length) summaryVsGuide.exact += 1;
        if (extra.length && disagreements.length < 15) disagreements.push(`  ${row.opportunity_number ?? row.id}: summary names [${summary.tokens.join(", ")}], Guide lists [${res.tokens.join(", ")}]`);
      }
    }

    if (DRY_RUN || (!tokensChanged && !sourceChanged && row.nih_ic_source !== null)) continue;
    const { error } = await supabase
      .from("funding_opportunities")
      .update({ nih_ic_tokens: res.tokens, nih_ic_source: res.source, nih_ic_reason: res.reason })
      .eq("id", row.id);
    if (error) {
      errors += 1;
      console.error(`  ${row.opportunity_number ?? row.id}: ${error.message}`);
    } else written += 1;
  }

  console.log(`\nscanned ${scanned} NIH notices (before: ${before.withTokens} with institutes, ${before.empty} without)`);
  console.log("resolved by option:");
  for (const s of [...NIH_IC_SOURCES, "unresolved"] as NihIcSourceColumn[]) console.log(`  ${s.padEnd(26)} ${String(bySource[s]).padStart(5)}`);
  console.log(`\ntokens change on ${changed} rows (${filled} filled from empty, ${emptied} emptied); source improves on ${upgraded}`);
  if (changes.length) console.log(`first ${changes.length} changes:\n${changes.join("\n")}`);
  console.log(`\nunresolved: ${bySource.unresolved}, of which ${unresolvedNih} carry an NIH agency code (the rest are CDC/FDA/AHRQ numbers the candidate filter admits by shape)`);
  if (unresolved.length) console.log(`NIH unresolved (first ${unresolved.length}):\n${unresolved.join("\n")}`);
  if (summaryVsGuide.rows) {
    const p = summaryVsGuide;
    console.log(`\nsummary text vs Guide on ${p.rows} notices that have both: exact ${p.exact}, precision ${(p.tp / (p.tp + p.fp)).toFixed(3)}, recall ${(p.tp / (p.tp + p.fn)).toFixed(3)}`);
    if (disagreements.length) console.log(`summary names an institute the Guide does not (first ${disagreements.length}):\n${disagreements.join("\n")}`);
  }
  if (!DRY_RUN) console.log(`\nwrote ${written} rows, ${errors} errors${lastId ? `; last id ${lastId}` : ""}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
