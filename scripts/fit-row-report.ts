/**
 * Fit engine · PR 3.2b · what a fit row actually says, read back off the
 * stored corpus. READ-ONLY: it reads `fit_results`, plus the notice titles
 * and investigator names it needs to print a row by name, and changes
 * nothing.
 *
 *   npm run fit:row-report                                # every stored row — strong, moderate, exploratory, poor
 *   npm run fit:row-report -- --limit 5000                # the first N rows, primary-key order
 *   npm run fit:row-report -- --investigator <uuid>       # one person's rows (repeatable, or comma-separated)
 *   npm run fit:row-report -- --tier exploratory          # one tier (repeatable, or comma-separated)
 *   npm run fit:row-report -- --json                      # the same numbers as JSON on stdout
 *
 * `row-line.ts` has only ever run against hand-written fixtures. This runs it
 * over the stored pairs and prints what came out, in six sections:
 *
 *   1. Raw ids that survive. `hasRawId` on every sentence, flag and "Why not?"
 *      line a row would print — and the wider net that guard cannot cast:
 *      snake_case the display-label map does not know (which `humanizeIds`
 *      therefore cannot rewrite *and* `hasRawId` stays quiet about), and
 *      paradigm ids `matchSentence` had to spell out. The first list is a
 *      rewrite that did not fire; the other two are labels the map is missing.
 *   2. Length. The rendered line per tier (min / median / p90 / max) and the
 *      rows over 240 characters, the worst printed in full. The change this
 *      checks replaced a nine-component rationale dump that ran ~25 lines.
 *   3. Sentence count. The invariant every surface leans on: at most two.
 *   4. Empty or useless lines. The paradigm fallback (`best_pair` null), a
 *      below-Strong row with no gap clause, a Poor row with no `why_not` —
 *      each a row that says less than it should.
 *   5. Flags. What the dedupe drops, split into "already in the list" and
 *      "already said in the sentences", and the flag vocabulary with counts.
 *   6. A sample. The five highest-scoring rows of each tier as the surface
 *      shows them, named, so a person can judge whether they are good English.
 *
 * The rendered line is what the surface prints: the two sentences for a
 * surfaced row (`fit-opportunities.tsx`), and the one-line `whyNotLine` for a
 * Poor one — a Poor row never renders `rowLine`, though the guard is run over
 * its `rowLine` output too, since the engine may yet surface it.
 *
 * Reads are paged the way `results.ts` pages — 1000 rows at a time in
 * primary-key order, only the columns a row line needs, never the
 * `provenance` or `adjudication` blobs. Titles and names are read in chunks
 * of 200 for the handful of rows the report actually prints.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { hasRawId, knownLabel } from "../src/lib/fit/inspect/display-labels";
import { MISSING_TABLE, TIER_RANK, type FitResultListRow } from "../src/lib/fit/results";
import { matchSentence, ROW_CLAUSE_MAX, ROW_LINE_MAX, ROW_MATCH_MAX, rowFlags, rowLine, whyNotLine } from "../src/lib/fit/row-line";
import { TAXONOMY_VERSION } from "../src/lib/fit/taxonomy";
import type { Tier } from "../src/lib/fit/types";

config({ path: ".env.local", quiet: true });

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opts = (name: string) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]!] : []));
const opt = (name: string) => opts(name)[0];
const split = (xs: string[]) => xs.flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);

const INVESTIGATORS = split(opts("--investigator"));
const TIERS = split(opts("--tier")).map((t) => t.toLowerCase());
const LIMIT = opt("--limit") ? Number(opt("--limit")) : Number.POSITIVE_INFINITY;
const JSON_OUT = flag("--json");

const ALL_TIERS = (Object.keys(TIER_RANK) as Tier[]).sort((a, b) => TIER_RANK[a] - TIER_RANK[b]);
const USAGE = "usage: fit:row-report [--limit N] [--investigator <uuid>]... [--tier strong|moderate|exploratory|poor]... [--json]";

const badTier = TIERS.find((t) => !ALL_TIERS.includes(t as Tier));
if (badTier) {
  console.error(`unknown tier "${badTier}" — one of ${ALL_TIERS.join(", ")}\n${USAGE}`);
  process.exit(1);
}
if (opt("--limit") !== undefined && (!Number.isFinite(LIMIT) || LIMIT < 1)) {
  console.error(`--limit wants a positive number, got "${opt("--limit")}"\n${USAGE}`);
  process.exit(1);
}
const tierFilter = TIERS as Tier[];

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}
const supabase: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });

/** The page size `results.ts` reads `fit_results` in. */
const PAGE = 1000;
/** The length a row line may not exceed before it stops being one line a person reads. */
const LONG = 240;
/** The invariant: what matched, and the binding gap. Nothing else fits in a row. */
const MAX_SENTENCES = 2;
/** Rows printed per tier in the sample, and worst-case rows printed in full. */
const SAMPLE = 5;
/** A distinct-string tally is bounded so a pathological corpus cannot fill memory. */
const MAX_DISTINCT = 400;

/** What a row line needs, and nothing else: the list columns minus the blobs, plus `why_not` for a Poor row. */
const ROW_COLUMNS = "investigator_id, opportunity_id, tier, score, gap, why_not, flags, best_pair:provenance->P->best_pair";

type RowLineRow = Pick<FitResultListRow, "investigator_id" | "opportunity_id" | "tier" | "score" | "gap" | "flags" | "best_pair"> & { why_not: string | null };

/** Where in a row a string came from — the four places the surfaces print engine text. */
type Where = "gap" | "match" | "flag" | "why-not";

type Example = { investigator_id: string; opportunity_id: string; tier: Tier; where: Where };
type Tallied = { count: number; example: Example; text: string };
type Sample = { investigator_id: string; opportunity_id: string; tier: Tier; score: number; sentences: string[]; flags: string[] };
type LongRow = { investigator_id: string; opportunity_id: string; tier: Tier; score: number; length: number; text: string };
type OverRow = { investigator_id: string; opportunity_id: string; tier: Tier; sentences: string[] };

const zero = <T>(make: () => T): Record<Tier, T> => Object.fromEntries(ALL_TIERS.map((t) => [t, make()])) as Record<Tier, T>;

type Tally = { map: Map<string, Tallied>; overflow: number };
const tally = (): Tally => ({ map: new Map(), overflow: 0 });

function bump(t: Tally, key: string, example: Example, text: string): void {
  const seen = t.map.get(key);
  if (seen) {
    seen.count += 1;
    return;
  }
  if (t.map.size >= MAX_DISTINCT) {
    t.overflow += 1;
    return;
  }
  t.map.set(key, { count: 1, example, text });
}

const ranked = (t: Tally) => Array.from(t.map.entries()).sort((a, b) => b[1].count - a[1].count || (a[0] < b[0] ? -1 : 1));

/** Keep the k worst, cheaply: the lists this feeds are five long. */
function keepTop<T>(list: T[], item: T, k: number, worst: (a: T, b: T) => number): void {
  list.push(item);
  list.sort(worst);
  if (list.length > k) list.length = k;
}

/**
 * Mirrors the strip in `hasRawId`: an evidence id (`publication:<uuid>:12345`)
 * or a notice number is an identifier a reader wants, not vocabulary.
 */
const EVIDENCE_ID = /[A-Za-z0-9_-]*:[A-Za-z0-9_:-]+/g;
/** Any snake_case word at all — a wider net than `hasRawId`, which only knows the ids the label map holds. */
const SNAKE_TOKEN = /[a-z][a-z0-9]*(?:_[a-z0-9]+)+/g;

const snakeTokens = (text: string): string[] => Array.from(text.replace(EVIDENCE_ID, " ").matchAll(SNAKE_TOKEN), (m) => m[0]);

/** The two sentences the modules fall back to, read off the modules so they cannot drift. */
const MATCH_FALLBACK = matchSentence({ best_pair: null });
const WHY_NOT_FALLBACK = whyNotLine(null);

const stats = {
  rows: 0,
  investigators: new Set<string>(),
  notices: new Set<string>(),
  byTier: zero(() => 0),
  lengths: zero((): number[] => []),
  longCount: 0,
  longByTier: zero(() => 0),
  longest: [] as LongRow[],
  overSentences: 0,
  overSentenceRows: [] as OverRow[],
  noPair: zero(() => 0),
  noGap: zero(() => 0),
  noWhyNot: 0,
  strings: tally(),
  knownTokens: tally(),
  unknownTokens: tally(),
  paradigms: tally(),
  flagRows: 0,
  flagRaw: 0,
  flagDeduped: 0,
  flagKept: 0,
  flagDropRows: 0,
  flagTally: tally(),
  flagSuppressed: new Map<string, number>(),
  samples: zero((): Sample[] => []),
};

function scan(row: RowLineRow): void {
  const tier = row.tier;
  const line = rowLine(row);
  const poor = tier === "poor";
  const why = poor ? whyNotLine(row.why_not) : null;
  // What the surface prints: the two sentences on a surfaced row, the one "Why not?" line on a Poor one.
  const rendered = why ?? line.sentences.join(" ");

  stats.rows += 1;
  stats.byTier[tier] += 1;
  stats.investigators.add(row.investigator_id);
  stats.notices.add(row.opportunity_id);
  stats.lengths[tier].push(rendered.length);

  const at = (where: Where): Example => ({ investigator_id: row.investigator_id, opportunity_id: row.opportunity_id, tier, where });

  // 1. Every string this row would print, through the guard and through the wider snake_case net.
  const printed: Array<[string, Where]> = [];
  if (line.gap) printed.push([line.gap, "gap"]);
  printed.push([line.match, "match"]);
  for (const f of line.flags) printed.push([f, "flag"]);
  if (why) printed.push([why, "why-not"]);
  for (const [text, where] of printed) {
    if (hasRawId(text)) bump(stats.strings, text, at(where), text);
    for (const token of snakeTokens(text)) bump(knownLabel(token) ? stats.knownTokens : stats.unknownTokens, token, at(where), text);
  }
  // The paradigm pair never reaches `humanizeIds`: `matchSentence` labels it directly, and an id
  // with no label is spelled out rather than shown raw — legible, but the label map is still missing it.
  for (const id of [row.best_pair?.investigator, row.best_pair?.notice]) {
    if (id && !knownLabel(id)) bump(stats.paradigms, id, at("match"), line.match);
  }

  // 2 and 3. Length and the two-sentence invariant.
  if (rendered.length > LONG) {
    stats.longCount += 1;
    stats.longByTier[tier] += 1;
    keepTop(stats.longest, { investigator_id: row.investigator_id, opportunity_id: row.opportunity_id, tier, score: row.score, length: rendered.length, text: rendered }, SAMPLE, (a, b) => b.length - a.length);
  }
  if (line.sentences.length > MAX_SENTENCES) {
    stats.overSentences += 1;
    keepTop(stats.overSentenceRows, { investigator_id: row.investigator_id, opportunity_id: row.opportunity_id, tier, sentences: line.sentences }, SAMPLE, (a, b) => b.sentences.length - a.sentences.length);
  }

  // 4. Rows that say less than they should.
  if (line.match === MATCH_FALLBACK) stats.noPair[tier] += 1;
  if (tier !== "strong" && line.gap === null) stats.noGap[tier] += 1;
  if (why === WHY_NOT_FALLBACK) stats.noWhyNot += 1;

  // 5. What the flag dedupe did. `rowFlags(flags, [])` is the same humanize-and-dedupe pass with
  // nothing said above it, so the difference between the two calls is exactly the "already said" drop.
  const raw = (row.flags ?? []).filter((f) => f.trim().length > 0);
  const deduped = rowFlags(row.flags, []);
  stats.flagRaw += raw.length;
  stats.flagDeduped += deduped.length;
  stats.flagKept += line.flags.length;
  if (raw.length) stats.flagRows += 1;
  if (deduped.length > line.flags.length) stats.flagDropRows += 1;
  for (const f of deduped) {
    bump(stats.flagTally, f, at("flag"), f);
    if (!line.flags.includes(f)) stats.flagSuppressed.set(f, (stats.flagSuppressed.get(f) ?? 0) + 1);
  }

  // 6. The five highest-scoring rows of each tier, as the surface renders them.
  keepTop(stats.samples[tier], { investigator_id: row.investigator_id, opportunity_id: row.opportunity_id, tier, score: row.score, sentences: why ? [why] : line.sentences, flags: poor ? [] : line.flags }, SAMPLE, (a, b) => b.score - a.score);
}

/** Every matching row, paged in primary-key order. Read-only; `available: false` before the migration. */
async function readAll(): Promise<{ read: number; available: boolean }> {
  let read = 0;
  for (let from = 0; read < LIMIT; from += PAGE) {
    const size = Math.min(PAGE, LIMIT - read);
    let q = supabase.from("fit_results").select(ROW_COLUMNS);
    if (INVESTIGATORS.length) q = q.in("investigator_id", INVESTIGATORS);
    if (tierFilter.length) q = q.in("tier", tierFilter);
    const { data, error } = await q.order("investigator_id").order("opportunity_id").range(from, from + size - 1);
    if (error) {
      if (MISSING_TABLE.test(error.message)) return { read, available: false };
      throw new Error(`fit_results: ${error.message}`);
    }
    const page = (data ?? []) as unknown as RowLineRow[];
    for (const r of page) scan({ ...r, score: Number(r.score) });
    read += page.length;
    if (page.length < size) break;
    if (read % 10_000 === 0) console.error(`  read ${read.toLocaleString("en-US")} rows…`);
  }
  return { read, available: true };
}

/** The names the printed rows are shown under; one read per 200 ids, for the handful of rows that reach the page. */
async function namesFor(table: "investigators" | "funding_opportunities", column: "full_name" | "title", ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const list = Array.from(new Set(ids));
  for (let i = 0; i < list.length; i += 200) {
    const { data, error } = await supabase.from(table).select(`id, ${column}`).in("id", list.slice(i, i + 200));
    if (error) throw new Error(`${table}: ${error.message}`);
    for (const r of (data ?? []) as Array<Record<string, unknown>>) out.set(String(r.id), String(r[column] ?? "").trim());
  }
  return out;
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

const n = (x: number) => x.toLocaleString("en-US");
const share = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)} %` : "—");
const plural = (x: number, one: string, many = `${one}s`) => `${n(x)} ${x === 1 ? one : many}`;

/** The q-th percentile of an ascending array, nearest rank. */
function pctl(sorted: readonly number[], q: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]!;
}

type Lengths = { tier: Tier; rows: number; min: number; median: number; p90: number; max: number; over: number };

function lengthRows(): Lengths[] {
  return ALL_TIERS.filter((t) => stats.lengths[t].length).map((tier) => {
    const s = [...stats.lengths[tier]].sort((a, b) => a - b);
    return { tier, rows: s.length, min: s[0]!, median: pctl(s, 0.5), p90: pctl(s, 0.9), max: s[s.length - 1]!, over: stats.longByTier[tier] };
  });
}

function printReport(names: { people: Map<string, string>; notices: Map<string, string> }, read: number): void {
  const who = (id: string) => names.people.get(id) || id;
  const what = (id: string) => names.notices.get(id) || id;
  const pair = (e: { investigator_id: string; opportunity_id: string }) => `${who(e.investigator_id)} × ${what(e.opportunity_id)}`;
  const ids = (e: { investigator_id: string; opportunity_id: string }) => `${e.investigator_id} / ${e.opportunity_id}`;

  console.log(`# fit:row-report — ${n(read)} rows — taxonomy ${TAXONOMY_VERSION} — ${new Date().toISOString()}`);
  const filters = [INVESTIGATORS.length ? `investigators ${INVESTIGATORS.length}` : "", tierFilter.length ? `tiers ${tierFilter.join(", ")}` : "", Number.isFinite(LIMIT) ? `limit ${n(LIMIT)}` : ""].filter(Boolean);
  console.log(`${plural(stats.rows, "row")} over ${plural(stats.investigators.size, "investigator")} and ${plural(stats.notices.size, "notice")}${filters.length ? ` · filters: ${filters.join(" · ")}` : " · the whole table"}`);
  console.log(`tiers ${ALL_TIERS.map((t) => `${t} ${n(stats.byTier[t])}`).join(" / ")}`);

  // -- 1 --------------------------------------------------------------------
  console.log(`\n## 1. Raw ids that survive`);
  console.log(`The single question this report exists for: does any id reach a row unread?\n`);

  const strings = ranked(stats.strings);
  console.log(`### 1a. hasRawId fires — the guard says a printed string still shows an id the label map knows`);
  if (!strings.length) {
    console.log(`  none: no sentence, flag or "Why not?" line over ${n(stats.rows)} rows tripped the guard.`);
  } else {
    console.log(`  ${n(strings.reduce((a, [, v]) => a + v.count, 0))} occurrence(s), ${n(strings.length)} distinct${stats.strings.overflow ? ` (+ ${n(stats.strings.overflow)} beyond the ${MAX_DISTINCT}-string cap)` : ""}:`);
    for (const [text, v] of strings) {
      console.log(`  ${String(v.count).padStart(6)} × [${v.example.where}] ${text}`);
      console.log(`           e.g. ${pair(v.example)}  (${ids(v.example)})`);
    }
  }

  const known = ranked(stats.knownTokens);
  console.log(`\n### 1b. snake_case in a printed string, id known to the label map — humanizeIds should have rewritten it`);
  if (!known.length) console.log(`  none.`);
  for (const [token, v] of known) {
    console.log(`  ${String(v.count).padStart(6)} × ${token} → the map reads it "${knownLabel(token)}"`);
    console.log(`           in [${v.example.where}] ${v.text}`);
    console.log(`           e.g. ${pair(v.example)}  (${ids(v.example)})`);
  }

  const unknown = ranked(stats.unknownTokens);
  console.log(`\n### 1c. snake_case in a printed string, id unknown to the label map — the map is missing it, and hasRawId cannot see it`);
  if (!unknown.length) console.log(`  none.`);
  for (const [token, v] of unknown) {
    console.log(`  ${String(v.count).padStart(6)} × ${token}`);
    console.log(`           in [${v.example.where}] ${v.text}`);
    console.log(`           e.g. ${pair(v.example)}  (${ids(v.example)})`);
  }

  const paradigms = ranked(stats.paradigms);
  console.log(`\n### 1d. paradigm ids matchSentence had to spell out — legible, but no label on file`);
  if (!paradigms.length) console.log(`  none: every best_pair paradigm has a taxonomy or display label.`);
  for (const [id, v] of paradigms) {
    console.log(`  ${String(v.count).padStart(6)} × ${id}`);
    console.log(`           e.g. ${v.text}`);
    console.log(`                ${pair(v.example)}  (${ids(v.example)})`);
  }

  // -- 2 --------------------------------------------------------------------
  console.log(`\n## 2. Length of the rendered line`);
  console.log(`Characters in what the surface prints: the two sentences on a surfaced row, the one "Why not?" line on a Poor one.`);
  console.log(`\`clip\` cuts the gap clause at ROW_CLAUSE_MAX = ${ROW_CLAUSE_MAX} and the match sentence at ROW_MATCH_MAX = ${ROW_MATCH_MAX}, so ROW_LINE_MAX = ${ROW_LINE_MAX} is the arithmetic ceiling; ${LONG} below is a reading yardstick, not a limit — read the tail, not just the count.\n`);
  console.log(`  tier          rows      min   median      p90      max    over ${LONG}`);
  for (const r of lengthRows()) {
    console.log(`  ${r.tier.padEnd(12)} ${String(n(r.rows)).padStart(6)}   ${String(r.min).padStart(6)}   ${String(r.median).padStart(6)}   ${String(r.p90).padStart(6)}   ${String(r.max).padStart(6)}   ${String(n(r.over)).padStart(6)} (${share(r.over, r.rows)})`);
  }
  console.log(`  ${n(stats.longCount)} row(s) over ${LONG} characters — ${share(stats.longCount, stats.rows)} of the corpus read.`);
  if (stats.longest.length) {
    console.log(`\n  The longest ${stats.longest.length}, in full:`);
    for (const r of stats.longest) {
      console.log(`\n  ${r.length} chars · ${r.tier} ${r.score.toFixed(1)} · ${pair(r)}  (${ids(r)})`);
      console.log(`      ${r.text}`);
    }
  }

  // -- 3 --------------------------------------------------------------------
  console.log(`\n## 3. Sentence count`);
  if (!stats.overSentences) {
    console.log(`  OK: every one of the ${n(stats.rows)} rows produced at most ${MAX_SENTENCES} sentences.`);
  } else {
    console.log(`  BROKEN: ${n(stats.overSentences)} row(s) produced more than ${MAX_SENTENCES} sentences. The surfaces render whatever rowLine returns, so these rows are longer than the design allows.`);
    for (const r of stats.overSentenceRows) {
      console.log(`    ${r.sentences.length} sentences · ${r.tier} · ${pair(r)}  (${ids(r)})`);
      for (const s of r.sentences) console.log(`      ${s}`);
    }
  }

  // -- 4 --------------------------------------------------------------------
  console.log(`\n## 4. Rows that say less than they should`);
  const noPair = ALL_TIERS.reduce((a, t) => a + stats.noPair[t], 0);
  const noGap = ALL_TIERS.reduce((a, t) => a + stats.noGap[t], 0);
  const belowStrong = ALL_TIERS.filter((t) => t !== "strong").reduce((a, t) => a + stats.byTier[t], 0);
  console.log(`  no paradigm pair (best_pair null → "${MATCH_FALLBACK}")`);
  console.log(`      ${n(noPair)} of ${n(stats.rows)} rows (${share(noPair, stats.rows)}) · ${ALL_TIERS.map((t) => `${t} ${n(stats.noPair[t])}`).join(" / ")}`);
  console.log(`  below Strong with no gap clause at all (the tier is the only thing saying why)`);
  console.log(`      ${n(noGap)} of ${n(belowStrong)} below-Strong rows (${share(noGap, belowStrong)}) · ${ALL_TIERS.filter((t) => t !== "strong").map((t) => `${t} ${n(stats.noGap[t])}`).join(" / ")}`);
  console.log(`  Poor with no why_not on file (→ "${WHY_NOT_FALLBACK}")`);
  console.log(`      ${n(stats.noWhyNot)} of ${n(stats.byTier.poor)} Poor rows (${share(stats.noWhyNot, stats.byTier.poor)})`);

  // -- 5 --------------------------------------------------------------------
  console.log(`\n## 5. Flags`);
  console.log(`  ${n(stats.flagRows)} row(s) carry a flag · ${n(stats.flagRaw)} stored, ${n(stats.flagDeduped)} after humanize + dedupe, ${n(stats.flagKept)} shown`);
  console.log(`  dropped as a repeat within the row's own list: ${n(stats.flagRaw - stats.flagDeduped)}`);
  console.log(`  dropped because the sentences already said it: ${n(stats.flagDeduped - stats.flagKept)}, over ${n(stats.flagDropRows)} row(s) (${share(stats.flagDropRows, stats.rows)} of rows read)`);
  const flags = ranked(stats.flagTally);
  if (!flags.length) console.log(`  no flags on any row read.`);
  else {
    console.log(`\n  The flag vocabulary — ${n(flags.length)} distinct${stats.flagTally.overflow ? ` (+ ${n(stats.flagTally.overflow)} beyond the ${MAX_DISTINCT}-string cap)` : ""}, "said" = dropped because a sentence already carried it:`);
    for (const [text, v] of flags) {
      const said = stats.flagSuppressed.get(text) ?? 0;
      console.log(`  ${String(n(v.count)).padStart(8)} × ${said ? `(${n(said)} said) ` : ""}${text}`);
    }
  }

  // -- 6 --------------------------------------------------------------------
  console.log(`\n## 6. A sample — the ${SAMPLE} highest-scoring rows of each tier, as the surface renders them`);
  console.log(`A Poor row shows its one "Why not?" line and no flags; every other row leads with the binding gap unless it is Strong.`);
  for (const tier of ALL_TIERS) {
    const rows = stats.samples[tier];
    console.log(`\n### ${tier} · ${n(stats.byTier[tier])} row(s) read`);
    if (!rows.length) console.log(`  none read.`);
    for (const r of rows) {
      console.log(`\n  ${r.score.toFixed(1)}  ${what(r.opportunity_id)}`);
      console.log(`        for ${who(r.investigator_id)}  (${ids(r)})`);
      for (const s of r.sentences) console.log(`        ${s}`);
      for (const f of r.flags) console.log(`        · ${f}`);
    }
  }
}

function jsonReport(read: number): unknown {
  const example = ([text, v]: [string, Tallied]) => ({ text, count: v.count, where: v.example.where, sample: v.text, investigator_id: v.example.investigator_id, opportunity_id: v.example.opportunity_id, tier: v.example.tier });
  return {
    generated_at: new Date().toISOString(),
    taxonomy_version: TAXONOMY_VERSION,
    filters: { investigators: INVESTIGATORS, tiers: tierFilter, limit: Number.isFinite(LIMIT) ? LIMIT : null },
    read,
    rows: stats.rows,
    investigators: stats.investigators.size,
    notices: stats.notices.size,
    tiers: Object.fromEntries(ALL_TIERS.map((t) => [t, stats.byTier[t]])),
    raw_ids: {
      guard_fired: ranked(stats.strings).map(example),
      guard_fired_overflow: stats.strings.overflow,
      snake_known: ranked(stats.knownTokens).map(example),
      snake_unknown: ranked(stats.unknownTokens).map(example),
      paradigm_spelled_out: ranked(stats.paradigms).map(example),
    },
    length: { max_allowed: LONG, over: stats.longCount, by_tier: lengthRows(), longest: stats.longest },
    sentences: { max_allowed: MAX_SENTENCES, violations: stats.overSentences, rows: stats.overSentenceRows },
    thin: {
      no_paradigm_pair: Object.fromEntries(ALL_TIERS.map((t) => [t, stats.noPair[t]])),
      no_gap_below_strong: Object.fromEntries(ALL_TIERS.filter((t) => t !== "strong").map((t) => [t, stats.noGap[t]])),
      poor_without_why_not: stats.noWhyNot,
      match_fallback: MATCH_FALLBACK,
      why_not_fallback: WHY_NOT_FALLBACK,
    },
    flags: {
      rows_with_flags: stats.flagRows,
      stored: stats.flagRaw,
      after_dedupe: stats.flagDeduped,
      shown: stats.flagKept,
      dropped_repeat: stats.flagRaw - stats.flagDeduped,
      dropped_already_said: stats.flagDeduped - stats.flagKept,
      rows_with_a_drop: stats.flagDropRows,
      vocabulary: ranked(stats.flagTally).map(([text, v]) => ({ text, count: v.count, said_already: stats.flagSuppressed.get(text) ?? 0 })),
    },
    samples: Object.fromEntries(ALL_TIERS.map((t) => [t, stats.samples[t]])),
  };
}

async function main(): Promise<void> {
  console.error(`reading fit_results${INVESTIGATORS.length ? ` for ${INVESTIGATORS.length} investigator(s)` : ""}${tierFilter.length ? ` at ${tierFilter.join(", ")}` : ""}${Number.isFinite(LIMIT) ? `, first ${n(LIMIT)} rows` : ""}…`);
  const { read, available } = await readAll();
  if (!available) {
    console.error(`fit_results is not on the database yet (apply supabase/migrations/20260917100000_fit_results_and_engine_flag.sql); nothing to report`);
    process.exit(1);
  }
  if (!stats.rows) {
    console.error("no rows matched");
    process.exit(1);
  }
  console.error(`read ${n(read)} rows; naming the rows the report prints…`);

  // Only the rows the report actually shows are named — bounded by construction.
  const shown = [...ALL_TIERS.flatMap((t) => stats.samples[t]), ...stats.longest, ...stats.overSentenceRows, ...[stats.strings, stats.knownTokens, stats.unknownTokens, stats.paradigms].flatMap((t) => Array.from(t.map.values()).map((v) => v.example))];
  const [people, notices] = await Promise.all([
    namesFor("investigators", "full_name", shown.map((r) => r.investigator_id)),
    namesFor("funding_opportunities", "title", shown.map((r) => r.opportunity_id)),
  ]);

  if (JSON_OUT) console.log(JSON.stringify(jsonReport(read), null, 2));
  else printReport({ people, notices }, read);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});
