/**
 * Fit engine · PR 0.1b · PubMed override seeding and identity coverage report.
 *
 *   npm run fit:seed-pubmed-overrides -- --csv "../Form Responses-Grid view.csv"          # propose overrides (no writes)
 *   npm run fit:seed-pubmed-overrides -- --csv a.csv --csv b.csv --apply                  # several sheets; first term found wins
 *   npm run fit:seed-pubmed-overrides -- --csv a.csv --apply --skip "Rajalingam"          # leave named people out
 *   npm run fit:seed-pubmed-overrides -- --report                                          # coverage table; append § 10 to INVENTORY.md
 *   npm run fit:seed-pubmed-overrides -- --report --no-inventory                           # coverage table only
 *
 * Counts come from esearch with retmax=0 (three calls per investigator: strict
 * term, initials + UCSF, initials alone). Reads only, unless --apply.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import {
  buildInitialsPubmedTerm,
  buildStrictPubmedTerm,
  buildUnaffiliatedInitialsTerm,
  pubmedNameResolutionError,
  type PubmedInvestigatorName,
} from "../src/lib/community/pubmed-query";

config({ path: ".env.local", quiet: true });

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const APPLY = flag("--apply");
const REPORT = flag("--report");
const WRITE_INVENTORY = REPORT && !flag("--no-inventory");
const CSV_PATHS = args.flatMap((a, i) => (a === "--csv" && args[i + 1] ? [args[i + 1]!] : []));
const SKIP = (opt("--skip") ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
const INVENTORY_PATH = path.join("docs", "fit-engine", "INVENTORY.md");
/** Strict / initials below this is flagged for review and, with a CSV term, proposed as an override. */
const FLAG_RATIO = 0.3;

if (!REPORT && !CSV_PATHS.length) {
  console.error("Pass --csv <intake.csv> to propose overrides, or --report for the coverage table.");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

// ---------------------------------------------------------------------------
// esearch counts
// ---------------------------------------------------------------------------

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const INTERVAL_MS = Number(process.env.NCBI_EUTILS_INTERVAL_MS ?? (process.env.NCBI_API_KEY?.trim() ? 120 : 400));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;

async function esearchCount(term: string): Promise<number> {
  if (!term) return 0;
  const wait = INTERVAL_MS - (Date.now() - lastCall);
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  const u = new URL(EUTILS);
  u.searchParams.set("db", "pubmed");
  u.searchParams.set("term", term);
  u.searchParams.set("retmax", "0");
  u.searchParams.set("retmode", "json");
  u.searchParams.set("tool", "prospera_funding_app");
  if (process.env.NCBI_CONTACT_EMAIL?.trim()) u.searchParams.set("email", process.env.NCBI_CONTACT_EMAIL.trim());
  if (process.env.NCBI_API_KEY?.trim()) u.searchParams.set("api_key", process.env.NCBI_API_KEY.trim());
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(u, { cache: "no-store" });
    if (res.status === 429 || res.status >= 500) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (!res.ok) throw new Error(`esearch ${res.status} for ${term}`);
    const json = (await res.json()) as { esearchresult?: { count?: string; ERROR?: string } };
    if (json.esearchresult?.ERROR) throw new Error(`esearch rejected ${term}: ${json.esearchresult.ERROR}`);
    return Number(json.esearchresult?.count ?? 0);
  }
  throw new Error(`esearch kept failing for ${term}`);
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

async function fetchAll(db: SupabaseClient, table: string, columns: string, filter?: (q: any) => any): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    let q: any = db.from(table).select(columns);
    if (filter) q = filter(q);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

type Coverage = {
  id: string;
  name: string;
  nih_profile_id: string | null;
  orcid: string | null;
  override: string | null;
  state: string | null;
  identity_method: string | null;
  item_count: number;
  strictTerm: string;
  strict: number;
  initials: number;
  unaffiliated: number;
  ratio: number | null;
  nameError: string | null;
};

async function loadCoverage(db: SupabaseClient): Promise<Coverage[]> {
  const investigators = await fetchAll(
    db,
    "investigators",
    "id, first_name, last_name, middle_initial, full_name, nih_profile_id, orcid, pubmed_query_override",
    (q) => q.is("archived_at", null)
  );
  const sources = await fetchAll(db, "investigator_sources", "investigator_id, state, identity_method, item_count", (q) =>
    q.eq("source", "pubmed")
  );
  const src = new Map(sources.map((s) => [String(s.investigator_id), s]));
  const rows: Coverage[] = [];
  let i = 0;
  for (const inv of investigators) {
    i += 1;
    const name: PubmedInvestigatorName = {
      firstName: String(inv.first_name ?? ""),
      lastName: String(inv.last_name ?? ""),
      middleInitial: inv.middle_initial ? String(inv.middle_initial) : null,
      fullName: String(inv.full_name ?? ""),
    };
    const nameError = pubmedNameResolutionError(name);
    const strictTerm = nameError ? "" : buildStrictPubmedTerm(name);
    const initialsTerm = nameError ? "" : buildInitialsPubmedTerm(name);
    const unaffTerm = nameError ? "" : buildUnaffiliatedInitialsTerm(name);
    process.stderr.write(`\r  counting ${i}/${investigators.length} ${String(inv.full_name ?? "").padEnd(32).slice(0, 32)}`);
    const [strict, initials, unaffiliated] = [
      await esearchCount(strictTerm),
      await esearchCount(initialsTerm),
      await esearchCount(unaffTerm),
    ];
    const s = src.get(String(inv.id));
    rows.push({
      id: String(inv.id),
      name: String(inv.full_name ?? ""),
      nih_profile_id: (inv.nih_profile_id as string | null) ?? null,
      orcid: (inv.orcid as string | null) ?? null,
      override: (inv.pubmed_query_override as string | null) ?? null,
      state: (s?.state as string | null) ?? null,
      identity_method: (s?.identity_method as string | null) ?? null,
      item_count: Number(s?.item_count ?? 0),
      strictTerm,
      strict,
      initials,
      unaffiliated,
      ratio: initials > 0 ? strict / initials : null,
      nameError,
    });
  }
  process.stderr.write("\n");
  return rows;
}

// ---------------------------------------------------------------------------
// Intake CSV → proposed overrides
// ---------------------------------------------------------------------------

type CsvMatch = { row: Record<string, string>; url: string; term: string | null; csvName?: string };

function pick(row: Record<string, string>, re: RegExp): string {
  const k = Object.keys(row).find((h) => re.test(h.trim()));
  return k ? String(row[k] ?? "").trim() : "";
}

/** `term=` from a PubMed search URL; null for MyNCBI bibliographies and anything without a term. */
export function termFromPubmedUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (!/ncbi\.nlm\.nih\.gov$/i.test(u.hostname)) return null;
  const term = u.searchParams.get("term");
  if (!term) return null;
  const cleaned = term.replace(/\+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function loadCsv(csvPath: string): CsvMatch[] {
  const text = readFileSync(csvPath, "utf8").replace(/^﻿/, "");
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  const out: CsvMatch[] = [];
  for (const row of parsed.data) {
    const url = pick(row, /pubmed/i);
    out.push({ row, url, term: termFromPubmedUrl(url) });
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const digits = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "");

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const lastOf = (fullName: string) => norm(fold(fullName).trim().split(/\s+/).pop() ?? "");

/**
 * CSV row → investigator. An NIH profile id match is accepted only when the
 * last names agree too (the intake sheet's ids are not reliable enough to
 * override a name); otherwise match on first + last name. Rows whose id
 * points at a different person are reported, never used.
 */
function matchCsvToInvestigator(
  csv: CsvMatch[],
  cov: Coverage[]
): { matched: Map<string, CsvMatch>; conflicts: Array<{ csvName: string; nih: string; dbName: string }> } {
  const byNih = new Map<string, Coverage>();
  const byName = new Map<string, Coverage>();
  for (const c of cov) {
    if (c.nih_profile_id) byNih.set(digits(c.nih_profile_id), c);
    byName.set(norm(fold(c.name)), c);
  }
  const matched = new Map<string, CsvMatch>();
  const conflicts: Array<{ csvName: string; nih: string; dbName: string }> = [];
  for (const m of csv) {
    const nih = digits(pick(m.row, /nih.*profile|reporter.*profile/i));
    const first = pick(m.row, /^first/i);
    const last = pick(m.row, /^last/i);
    const csvName = `${first} ${last}`.trim();
    let hit: Coverage | null = null;
    const byId = nih ? byNih.get(nih) ?? null : null;
    if (byId && lastOf(byId.name) === norm(fold(last))) hit = byId;
    else {
      if (byId) conflicts.push({ csvName, nih, dbName: byId.name });
      hit = byName.get(norm(fold(csvName))) ?? null;
    }
    if (hit && !matched.has(hit.id)) matched.set(hit.id, { ...m, csvName });
  }
  return { matched, conflicts };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const f = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "number" && !Number.isInteger(v) ? v.toFixed(2) : String(v));
const cell = (v: unknown) => f(v).replace(/\|/g, "\\|");

function coverageTable(rows: Coverage[]): string {
  const head = "| investigator | pubmed state | method | items | strict | initials+UCSF | unaffiliated | strict/initials | flag |\n|---|---|---|---|---|---|---|---|---|";
  const body = rows
    .map((r) => {
      const flagTxt = r.nameError
        ? "name error"
        : r.ratio !== null && r.ratio < FLAG_RATIO
          ? "REVIEW"
          : r.initials === 0 && r.strict === 0
            ? r.override
              ? "no UCSF hits (override set)"
              : "manual override needed"
            : "";
      return `| ${cell(r.name)} | ${cell(r.state)} | ${cell(r.identity_method)} | ${r.item_count} | ${r.strict} | ${r.initials} | ${r.unaffiliated} | ${cell(r.ratio)} | ${flagTxt} |`;
    })
    .join("\n");
  return `${head}\n${body}`;
}

function coverageSummary(rows: Coverage[]): string {
  const flagged = rows.filter((r) => r.ratio !== null && r.ratio < FLAG_RATIO);
  const noHits = rows.filter((r) => r.strict === 0 && r.initials === 0);
  const unavailable = rows.filter((r) => r.state !== "available");
  const median = (xs: number[]) => {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    const m = (s.length - 1) / 2;
    return (s[Math.floor(m)]! + s[Math.ceil(m)]!) / 2;
  };
  const lines = [
    `| Metric | Value |`,
    `|---|---|`,
    `| investigators counted | ${rows.length} |`,
    `| pubmed source not 'available' | ${unavailable.length} |`,
    `| strict / initials ratio < ${FLAG_RATIO} (flagged for review) | ${flagged.length} |`,
    `| manual override needed (zero hits on both strict and initials + UCSF) | ${noHits.length} |`,
    `| median strict count | ${median(rows.map((r) => r.strict))} |`,
    `| median initials + UCSF count | ${median(rows.map((r) => r.initials))} |`,
    `| median unaffiliated initials count | ${median(rows.map((r) => r.unaffiliated))} |`,
    `| with pubmed_query_override | ${rows.filter((r) => r.override).length} |`,
    `| name resolution errors | ${rows.filter((r) => r.nameError).length} |`,
  ];
  const flaggedTable = flagged.length
    ? "\n\nFlagged (strict / initials < " + FLAG_RATIO + "):\n\n" + coverageTable(flagged)
    : "";
  const noHitTable = noHits.length
    ? "\n\nManual override needed — zero UCSF-affiliated hits under either term (a strategist sets `pubmed_query_override`):\n\n" + coverageTable(noHits)
    : "";
  return lines.join("\n") + flaggedTable + noHitTable;
}

function writeInventorySection(summary: string) {
  const heading = "## 10. PubMed identity coverage (PR 0.1b)";
  const section = `${heading}\n\nGenerated ${new Date().toISOString()} by \`npm run fit:seed-pubmed-overrides -- --report\`. Counts are esearch totals (retmax=0): strict = \`Last First M[Author]\` + UCSF; initials = \`Last FM[Author]\` + UCSF; unaffiliated = initials alone.\n\n${summary}\n`;
  const existing = existsSync(INVENTORY_PATH) ? readFileSync(INVENTORY_PATH, "utf8") : "";
  const idx = existing.indexOf(heading);
  const next = idx >= 0 ? existing.slice(0, idx).replace(/\n+$/, "\n\n") + section : existing.replace(/\n+$/, "\n\n") + section;
  writeFileSync(INVENTORY_PATH, next);
  console.log(`\nWrote ${heading} to ${INVENTORY_PATH}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.error("Counting esearch totals for every non-archived investigator…");
  const cov = await loadCoverage(supabase);

  if (REPORT) {
    console.log("\n# PubMed identity coverage\n");
    console.log(coverageTable(cov));
    console.log("\n# Summary\n");
    const summary = coverageSummary(cov);
    console.log(summary);
    if (WRITE_INVENTORY) writeInventorySection(summary);
  }

  if (CSV_PATHS.length) {
    // Later sheets only fill investigators the earlier ones did not match.
    const csv = CSV_PATHS.flatMap(loadCsv);
    const { matched, conflicts } = matchCsvToInvestigator(csv, cov);
    const proposals: Array<{ c: Coverage; term: string; reason: string }> = [];
    const skipped: Array<{ c: Coverage; url: string; reason: string }> = [];
    for (const c of cov) {
      const m = matched.get(c.id);
      const needs = c.state === "unavailable" || (c.ratio !== null && c.ratio < FLAG_RATIO);
      if (!needs) continue;
      const reason = c.state === "unavailable" ? "pubmed state unavailable" : `strict/initials ${c.ratio?.toFixed(2)} < ${FLAG_RATIO}`;
      if (!m) {
        skipped.push({ c, url: "", reason: `${reason}; no CSV row matched` });
        continue;
      }
      if (!m.term) {
        skipped.push({ c, url: m.url, reason: `${reason}; CSV URL has no term= (MyNCBI bibliography or empty)` });
        continue;
      }
      if (c.override && c.override.trim() === m.term) {
        skipped.push({ c, url: m.url, reason: `${reason}; override already set to the same term` });
        continue;
      }
      if (SKIP.some((x) => c.name.toLowerCase().includes(x))) {
        skipped.push({ c, url: m.url, reason: `${reason}; skipped by --skip` });
        continue;
      }
      proposals.push({ c, term: m.term, reason });
    }

    console.log(`\n# Proposed pubmed_query_override (${proposals.length})\n`);
    console.log("| investigator | CSV row | pubmed state | strict | initials | current override | proposed term | why |\n|---|---|---|---|---|---|---|---|");
    for (const p of proposals) {
      const m = matched.get(p.c.id);
      console.log(`| ${cell(p.c.name)} | ${cell(m?.csvName)} | ${cell(p.c.state)} | ${p.c.strict} | ${p.c.initials} | ${cell(p.c.override)} | \`${p.term.replace(/`/g, "'")}\` | ${p.reason} |`);
    }
    if (conflicts.length) {
      console.log(`\n# CSV rows whose NIH profile id points at a different investigator (ignored; matched by name instead) (${conflicts.length})\n`);
      console.log("| CSV row | NIH id in CSV | investigator holding that id |\n|---|---|---|");
      for (const c of conflicts) console.log(`| ${cell(c.csvName)} | ${c.nih} | ${cell(c.dbName)} |`);
    }
    console.log(`\n# Needs an override but none could be derived (${skipped.length})\n`);
    console.log("| investigator | pubmed state | strict | initials | CSV URL | why |\n|---|---|---|---|---|---|");
    for (const s of skipped) console.log(`| ${cell(s.c.name)} | ${cell(s.c.state)} | ${s.c.strict} | ${s.c.initials} | ${cell(s.url)} | ${s.reason} |`);
    console.log(`\nCSV rows: ${csv.length}; matched to investigators: ${matched.size}; rows with a term=: ${csv.filter((m) => m.term).length}.`);

    if (APPLY) {
      let n = 0;
      for (const p of proposals) {
        const { error } = await supabase.from("investigators").update({ pubmed_query_override: p.term }).eq("id", p.c.id);
        if (error) throw new Error(`update ${p.c.name}: ${error.message}`);
        n += 1;
      }
      console.log(`\nApplied ${n} override(s). Re-run the PubMed fetch for them (scripts/retry-pubmed-investigators.ts <ids>).`);
      if (proposals.length) console.log(proposals.map((p) => p.c.id).join(" "));
    } else if (proposals.length) {
      console.log("\nDry run. Re-run with --apply to write these overrides.");
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
