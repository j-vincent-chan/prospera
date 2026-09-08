/**
 * Fit engine · PR 5.0 non-NIH inventory. READ-ONLY.
 *
 * Replaces the estimates in docs/fit-engine/NON_NIH_FEASIBILITY.md with
 * measurements, so Phase 5 is sized against data. Answers the nine questions in
 * NON_NIH_PLAN.md § PR 5.0 and writes docs/fit-engine/NON_NIH_INVENTORY.md.
 *
 * It does NOT append to INVENTORY.md: scripts/fit-inventory.ts rewrites that
 * file wholesale with writeFileSync, so a second writer's section would be
 * destroyed on the next `npm run fit:inventory`.
 *
 *   npm run fit:non-nih-inventory -- --dry-run        # request plan, no third-party network
 *   npm run fit:non-nih-inventory -- --limit 50       # smoke run: ≤ 50 rows per probe
 *   npm run fit:non-nih-inventory                     # full run (≈ 800 requests, ≈ 12 min)
 *   npm run fit:non-nih-inventory -- --stdout         # print the Markdown, write nothing
 *   npm run fit:non-nih-inventory -- --out /tmp/x.md --seed 7 --legacy-sample 50
 *
 * Nothing here writes to Supabase (select() and count() only) and every
 * outbound request is a GET / a search POST to one of five allow-listed hosts,
 * each behind its own AsyncRateLimiter at ≥ --interval-ms (default 700 ms).
 *
 * Exit codes: 0 all nine questions answered; 1 a fatal error (credentials, a
 * failed Supabase read); 2 the report was written but at least one predicate
 * could not be evaluated — § 10 names them.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AsyncRateLimiter } from "../src/lib/utils/async-rate-limiter";
import { createSimplerGrantsClient, type SimplerGrantsClient } from "../src/lib/ingestion/simpler-grants/client";
import type { SimplerAttachment } from "../src/lib/ingestion/simpler-grants/types";
import {
  fetchGrantsGovOpportunityDetails,
  searchGrantsGovOpportunityId,
  type GrantsGovAttachment,
} from "../src/lib/funding-opportunities/grants-gov-opportunity-api";
import {
  buildLineage,
  fetchNoticeExemplars,
  normalizeAnnouncementNumber,
  openNoticeFilter,
  type LineageRow,
} from "../src/lib/ingestion/reporter/exemplars";
import { NIH_NOTICE_FILTER } from "../src/lib/fit/profile/opportunity";

const DEFAULT_OUT = path.join("docs", "fit-engine", "NON_NIH_INVENTORY.md");

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
function flag(name: string): boolean {
  return args.includes(name);
}
function numArg(name: string, fallback: number): number {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  const n = Number(args[i + 1]);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`${name} expects a non-negative number`);
    process.exit(1);
  }
  return n;
}
function strArg(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const dryRun = flag("--dry-run");
const toStdout = flag("--stdout");
const outPath = strArg("--out") ?? DEFAULT_OUT;
const seed = numArg("--seed", 20260907);
/** 0 = no cap. Caps every per-row probe; the report labels each capped section. */
const limit = numArg("--limit", 0);
const legacySample = numArg("--legacy-sample", 50);
const intervalMs = numArg("--interval-ms", 700);

config({ path: ".env.local", quiet: true });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

// ---------------------------------------------------------------------------
// Hosts. Nothing outside this list is ever requested.
// ---------------------------------------------------------------------------

const HOSTS = {
  simpler: "api.simpler.grants.gov",
  grantsGov: "api.grants.gov",
  nsf: "nsf-gov-resources.nsf.gov",
  nsfWww: "www.nsf.gov",
  cdmrp: "cdmrp.health.mil",
  reporter: "api.reporter.nih.gov",
} as const;
type HostKey = keyof typeof HOSTS;

const limiters: Record<HostKey, AsyncRateLimiter> = {
  simpler: new AsyncRateLimiter(intervalMs),
  grantsGov: new AsyncRateLimiter(intervalMs),
  nsf: new AsyncRateLimiter(intervalMs),
  nsfWww: new AsyncRateLimiter(intervalMs),
  cdmrp: new AsyncRateLimiter(intervalMs),
  reporter: new AsyncRateLimiter(intervalMs),
};

/** Requests actually issued, per host — printed in § 10 so the run's cost is on the face of the report. */
const requestCount: Record<HostKey, number> = { simpler: 0, grantsGov: 0, nsf: 0, nsfWww: 0, cdmrp: 0, reporter: 0 };
/** What a --dry-run would have issued: host → [count, first few URLs]. */
const plannedRequests: Array<{ host: string; what: string; count: number; examples: string[] }> = [];

function allowedHost(u: string): boolean {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return (Object.values(HOSTS) as string[]).includes(h);
  } catch {
    return false;
  }
}

/** Predicates the run could not evaluate; a non-empty list exits 2. */
const unevaluated: Array<{ question: string; reason: string }> = [];
function cannotEvaluate(question: string, reason: string): void {
  unevaluated.push({ question, reason });
  process.stderr.write(`  ! ${question}: ${reason}\n`);
}

// ---------------------------------------------------------------------------
// Small helpers (same shapes as fit-inventory.ts / fit-guide-diagnostics.ts)
// ---------------------------------------------------------------------------

function groupCount<T>(items: T[], keyOf: (t: T) => string): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = keyOf(it);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** Postgres percentile_cont: linear interpolation between the two neighbouring values. */
function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? s[lo]! : s[lo]! + (s[hi]! - s[lo]!) * (idx - lo);
}
const median = (v: number[]) => percentile(v, 0.5);

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(1);
  if (Array.isArray(v)) return v.length ? v.map(String).join(", ") : "[]";
  return String(v).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function table(headers: string[], rows: unknown[][]): string {
  if (rows.length === 0) return "_(no rows)_";
  return [
    `| ${headers.join(" | ")} |`,
    `|${headers.map(() => "---").join("|")}|`,
    ...rows.map((r) => `| ${r.map(fmt).join(" | ")} |`),
  ].join("\n");
}

function kv(pairs: Array<[string, unknown]>): string {
  return ["| Metric | Value |", "|---|---|", ...pairs.map(([k, v]) => `| ${k} | ${fmt(v)} |`)].join("\n");
}

function pct(n: number, of: number): string {
  return of === 0 ? "—" : `${((100 * n) / of).toFixed(1)} %`;
}

/** mulberry32, as fit-guide-diagnostics.ts uses, so a rerun with the same --seed and population reproduces. */
function rng(seedValue: number): () => number {
  let a = seedValue >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(items: T[], seedValue: number): T[] {
  const arr = [...items];
  const next = rng(seedValue);
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/** Round-robin across strata so a capped run touches every family, not just the largest. */
function roundRobin<T>(items: T[], keyOf: (t: T) => string, n: number): T[] {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const k = keyOf(it);
    const g = groups.get(k);
    if (g) g.push(it);
    else groups.set(k, [it]);
  }
  const out: T[] = [];
  const queues = [...groups.values()];
  while (out.length < n && queues.some((q) => q.length > 0)) {
    for (const q of queues) {
      if (out.length >= n) break;
      const it = q.shift();
      if (it !== undefined) out.push(it);
    }
  }
  return out;
}

/**
 * The rows a per-row probe runs against: the whole population when --limit is 0,
 * otherwise a seeded shuffle dealt round-robin across `stratum` so every family
 * is represented. A capped result is a smoke test, never a rate estimate.
 */
function probeSet<T>(population: T[], stratum: (t: T) => string): T[] {
  if (limit === 0 || population.length <= limit) return population;
  return roundRobin(seededShuffle(population, seed), stratum, limit);
}

// ---------------------------------------------------------------------------
// Population
// ---------------------------------------------------------------------------

type Notice = {
  id: string;
  opportunity_number: string | null;
  title: string | null;
  agency: string | null;
  agency_code: string | null;
  source_opportunity_id: string;
  forecasted: boolean | null;
  status: string | null;
  posted_date: string | null;
  category: string | null;
  /** JSONB list of Simpler applicant-type codes; a legacy string payload is normalised to one entry. */
  applicant_types: string[] | string | null;
  /** Comma-joined instrument codes (`simpler-grants-sync.ts:511`), e.g. "cooperative_agreement, grant". */
  funding_instrument: string | null;
  description: string | null;
  reissue_of: string | null;
  guide_fetch_status: string | null;
  raw_payload_json: RawPayload | null;
};

type RawPayload = {
  legacy_opportunity_id?: unknown;
  top_level_agency_code?: unknown;
  top_level_agency_name?: unknown;
  opportunity_assistance_listings?: unknown;
  attachments?: unknown;
  summary?: { additional_info_url?: unknown; summary_description?: unknown } | null;
};

const NOTICE_SELECT =
  "id, opportunity_number, title, agency, agency_code, source_opportunity_id, forecasted, status, posted_date, " +
  "category, applicant_types, funding_instrument, description, reissue_of, guide_fetch_status, raw_payload_json";

const PAGE = 500;

async function fetchOpenNotices(db: SupabaseClient, today: string): Promise<Notice[]> {
  const rows: Notice[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("funding_opportunities")
      .select(NOTICE_SELECT)
      .or(openNoticeFilter(today))
      .order("opportunity_number", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`funding_opportunities: ${error.message}`);
    const page = (data ?? []) as unknown as Notice[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

/**
 * Mirrors NIH_NOTICE_FILTER (src/lib/fit/profile/opportunity.ts) in TypeScript:
 * agency_code LIKE 'HHS-NIH%' OR number LIKE 'PA-%' / 'PAR-%' / 'RFA-%' / 'PAS-__-___'.
 * § 1 checks it against PostgREST's own evaluation of the same filter and exits 2 on a mismatch.
 */
function isNihLike(r: Notice): boolean {
  const n = String(r.opportunity_number ?? "");
  return (
    String(r.agency_code ?? "").startsWith("HHS-NIH") ||
    n.startsWith("PA-") ||
    n.startsWith("PAR-") ||
    n.startsWith("RFA-") ||
    /^PAS-.{2}-.{3}$/.test(n)
  );
}

function isPosted(r: Notice): boolean {
  return !(r.forecasted === true || r.status === "forecasted");
}

/** GUIDE_DIAGNOSTICS § 1e's grouping, by agency_code alone. */
type AgencyFamily = "NIH" | "CDC" | "other HHS" | "non-HHS";
function agencyFamily(agencyCode: string | null): AgencyFamily {
  const a = agencyCode ?? "";
  if (a.startsWith("HHS-NIH")) return "NIH";
  if (a.startsWith("HHS-CDC")) return "CDC";
  if (a.startsWith("HHS-")) return "other HHS";
  return "non-HHS";
}

/**
 * The funder families PR 5.2's registry will route on, decided from agency_code
 * first and the number shape second — an explicit table, not a heuristic.
 */
type FunderFamily = "nih" | "hhs_other" | "nsf" | "dod_cdmrp" | "dod_other" | "doe" | "other_federal";
function funderFamily(r: Notice): FunderFamily {
  const a = String(r.agency_code ?? "").toUpperCase();
  const n = String(r.opportunity_number ?? "").toUpperCase();
  if (a.startsWith("HHS-NIH")) return "nih";
  if (a === "NSF" || a.startsWith("NSF-")) return "nsf";
  if (a === "DOD-AMRAA" || /^(HT\d{4}|W81XWH)/.test(n)) return "dod_cdmrp";
  if (a.startsWith("DOD-")) return "dod_other";
  if (a.startsWith("DOE-")) return "doe";
  if (a.startsWith("HHS-")) return "hhs_other";
  return "other_federal";
}

function legacyOpportunityId(r: Notice): number | null {
  const v = r.raw_payload_json?.legacy_opportunity_id;
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return parseInt(v.trim(), 10);
  return null;
}

type AssistanceListing = { number: string; title: string };
function assistanceListings(r: Notice): AssistanceListing[] {
  const raw = r.raw_payload_json?.opportunity_assistance_listings;
  if (!Array.isArray(raw)) return [];
  const out: AssistanceListing[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    const num = typeof o.assistance_listing_number === "string" ? o.assistance_listing_number.trim() : "";
    const title = typeof o.program_title === "string" ? o.program_title.trim() : "";
    if (num || title) out.push({ number: num || "(none)", title: title || "(no title)" });
  }
  return out;
}

/** description carries the Simpler summary_description, HTML and all; the extractor would read the text. */
function strippedText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Network probes
// ---------------------------------------------------------------------------

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

type HeadProbe = {
  url: string;
  method: "HEAD" | "GET";
  http: number | string;
  contentType: string | null;
  contentLength: number | null;
  finalUrl: string | null;
};

/**
 * HEAD the URL; a server that rejects HEAD (405/501) is retried once with a
 * 1 KB ranged GET. Nothing but the headers is kept either way.
 */
async function headProbe(host: HostKey, url: string, timeoutMs = 25_000): Promise<HeadProbe> {
  const once = async (method: "HEAD" | "GET"): Promise<HeadProbe> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = { "user-agent": USER_AGENT, accept: "application/pdf,text/html,*/*" };
      if (method === "GET") headers.range = "bytes=0-1023";
      const res = await fetch(url, { method, headers, redirect: "follow", signal: controller.signal, cache: "no-store" });
      if (method === "GET") await res.arrayBuffer();
      const len = res.headers.get("content-length");
      return {
        url,
        method,
        http: res.status,
        contentType: res.headers.get("content-type"),
        contentLength: len && /^\d+$/.test(len) ? parseInt(len, 10) : null,
        finalUrl: res.url && res.url !== url ? res.url : null,
      };
    } catch (e) {
      return {
        url,
        method,
        http: e instanceof Error ? e.name : String(e),
        contentType: null,
        contentLength: null,
        finalUrl: null,
      };
    } finally {
      clearTimeout(timer);
    }
  };

  if (!allowedHost(url)) return { url, method: "HEAD", http: "blocked (host not allow-listed)", contentType: null, contentLength: null, finalUrl: null };
  requestCount[host] += 1;
  const first = await limiters[host].schedule(() => once("HEAD"));
  if (first.http === 405 || first.http === 501) {
    requestCount[host] += 1;
    return limiters[host].schedule(() => once("GET"));
  }
  return first;
}

type PageProbe = HeadProbe & { bytes: number; title: string | null; headings: string[] };

/**
 * GET a landing page, follow redirects, and record the final URL plus which of
 * the roles NON_NIH_FEASIBILITY § 6 names are visible as headings in the text.
 * Nothing is stored; only the presence tests survive.
 */
async function pageProbe(host: HostKey, url: string, wanted: Array<[string, RegExp]>, timeoutMs = 30_000): Promise<PageProbe> {
  const empty = { url, method: "GET" as const, contentType: null, contentLength: null, finalUrl: null, bytes: 0, title: null, headings: [] };
  if (!allowedHost(url)) return { ...empty, http: "blocked (host not allow-listed)" };
  requestCount[host] += 1;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await limiters[host].schedule(async () => {
      const res = await fetch(url, {
        method: "GET",
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
        redirect: "follow",
        signal: controller.signal,
        cache: "no-store",
      });
      const html = await res.text();
      const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ");
      return {
        url,
        method: "GET" as const,
        http: res.status,
        contentType: res.headers.get("content-type"),
        contentLength: html.length,
        finalUrl: res.url && res.url !== url ? res.url : null,
        bytes: html.length,
        title: html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ?? null,
        headings: wanted.filter(([, re]) => re.test(text)).map(([label]) => label),
      };
    });
  } catch (e) {
    return { ...empty, http: e instanceof Error ? e.name : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Simpler URL-safes attachment names (`Part 2.pdf` → `Part_2.pdf`); compare on this form, not verbatim. */
function normalizeFileName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_]+/g, "_");
}

/**
 * Simpler also drops punctuation grants.gov keeps (`M&E` → `ME`, `(1)` → `1`),
 * so the strict comparison still reports differences that are only spelling.
 * This form keeps letters and digits alone — it can only hide a difference of
 * punctuation, never a missing or extra file.
 */
function foldFileName(name: string): string {
  return name.trim().toLowerCase().replace(/&amp;/g, "&").replace(/[^a-z0-9]/g, "");
}

function sameNameSet(a: string[], b: string[], key = normalizeFileName): boolean {
  const x = new Set(a.map(key));
  const y = new Set(b.map(key));
  return x.size === y.size && [...x].every((n) => y.has(n));
}

// ---------------------------------------------------------------------------
// § 9 · call-site scan (read-only filesystem walk, no shelling out)
// ---------------------------------------------------------------------------

const SCAN_ROOTS = ["src", "scripts", "supabase"];
const SCAN_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const SCAN_SKIP = new Set(["node_modules", ".next", ".git", ".claude", ".vercel", "dist", "build", "coverage"]);

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SCAN_SKIP.has(name)) continue;
    const full = path.join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (SCAN_EXT.has(path.extname(name))) out.push(full);
  }
  return out;
}

type ImportHit = { file: string; line: number; text: string };

function scanImporters(files: string[], moduleSuffix: string): ImportHit[] {
  const hits: ImportHit[] = [];
  const re = new RegExp(`(?:from|require\\()\\s*["'][^"']*${moduleSuffix.replace(/[/\-]/g, "\\$&")}["']`);
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!text.includes(moduleSuffix)) continue;
    text.split(/\r?\n/).forEach((line, i) => {
      if (re.test(line)) hits.push({ file, line: i + 1, text: line.trim() });
    });
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

async function run(db: SupabaseClient): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const out: string[] = [];

  process.stderr.write("Reading funding_opportunities…\n");
  const open = await fetchOpenNotices(db, today);
  const nihLike = open.filter(isNihLike);
  const nonNih = open.filter((r) => !isNihLike(r));
  const nonNihPosted = nonNih.filter(isPosted);
  const nonNihForecast = nonNih.filter((r) => !isPosted(r));

  // Profiles, for the "does a profile exist" cross-tab and § 8's baseline.
  const profileIds = new Set<string>();
  const profileTextSource = new Map<string, string>();
  {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db
        .from("opportunity_fit_profiles")
        .select("opportunity_id, confidence, sources")
        .order("opportunity_id")
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`opportunity_fit_profiles: ${error.message}`);
      const page = (data ?? []) as Array<{ opportunity_id: string; sources: { text?: unknown } | null }>;
      for (const p of page) {
        profileIds.add(p.opportunity_id);
        const t = p.sources && typeof p.sources === "object" ? p.sources.text : undefined;
        profileTextSource.set(p.opportunity_id, typeof t === "string" ? t : String(t ?? "∅"));
      }
      if (page.length < PAGE) break;
    }
  }

  out.push("# Fit engine · non-NIH inventory (PR 5.0)");
  out.push("");
  out.push(
    `Generated ${new Date().toISOString()} by \`npm run fit:non-nih-inventory\`` +
      `${limit ? ` -- --limit ${limit}` : ""}${dryRun ? " -- --dry-run" : ""} (seed ${seed}, legacy sample ${legacySample}, ` +
      `≥ ${intervalMs} ms per host). Read-only: Supabase reads are \`select()\` only and every outbound request is a GET ` +
      `or a search POST to one of ${Object.keys(HOSTS).length} allow-listed hosts. ` +
      `"Open" = \`close_date\`, \`next_due\` or \`expiration_date\` on/after ${today}. ` +
      `Answers the nine questions in \`docs/fit-engine/NON_NIH_PLAN.md\` § PR 5.0.`,
  );
  out.push("");
  if (limit) {
    out.push(
      `> **This is a capped run (\`--limit ${limit}\`).** The cap applies only to the sections that make a request per ` +
        `row — § 2, § 4, § 5 and § 6 — each of which ran against at most ${limit} rows, dealt round-robin across agency ` +
        `strata from a seeded shuffle so every family is represented. A stratified sample is **not** an unbiased ` +
        `estimate of a population rate: read those hit-rates as a smoke test of the routes and take the numbers Phase 5 ` +
        `is sized against from an uncapped run. **§ 1, § 3, § 7, § 8 and § 9 are complete either way** — they are ` +
        `computed from the whole corpus and from the repo, and no network call is involved.`,
    );
    out.push("");
  }
  if (dryRun) {
    out.push("> **`--dry-run`: no third-party request was issued.** Supabase was read (the request plan is derived from the rows); § 0 lists what a real run would fetch.");
    out.push("");
  }

  // -------------------------------------------------------------------------
  // 1. The corpus
  // -------------------------------------------------------------------------
  process.stderr.write("§ 1 corpus…\n");
  out.push("## 1. The corpus, by agency, assistance listing, forecast status and profile");
  out.push("");

  // Integrity check: does the TS predicate agree with PostgREST's own NIH_NOTICE_FILTER?
  let filterAgrees: boolean | null = null;
  {
    const { count, error } = await db
      .from("funding_opportunities")
      .select("*", { count: "exact", head: true })
      .or(openNoticeFilter(today))
      .or(NIH_NOTICE_FILTER);
    if (error) cannotEvaluate("Q1 · NIH_NOTICE_FILTER cross-check", error.message);
    else {
      filterAgrees = count === nihLike.length;
      if (!filterAgrees) {
        cannotEvaluate(
          "Q1 · NIH_NOTICE_FILTER cross-check",
          `isNihLike() counted ${nihLike.length}, PostgREST counted ${count} — the TypeScript mirror of NIH_NOTICE_FILTER has drifted`,
        );
      }
    }
  }

  out.push(
    kv([
      ["open notices", open.length],
      ["NIH-like (mirrors `NIH_NOTICE_FILTER`)", nihLike.length],
      ["non-NIH", nonNih.length],
      ["— posted", nonNihPosted.length],
      ["— forecast", nonNihForecast.length],
      ["non-NIH with an `opportunity_fit_profiles` row", nonNih.filter((r) => profileIds.has(r.id)).length],
      ["NIH-like with a profile row", nihLike.filter((r) => profileIds.has(r.id)).length],
      ["`isNihLike()` agrees with PostgREST's `NIH_NOTICE_FILTER`", filterAgrees],
    ]),
  );
  out.push("");
  out.push(
    "`NIH-like` is the Guide sync's own target set, not an agency test: a CDC `RFA-OH-…` number is NIH-like here " +
      "(NON_NIH_FEASIBILITY § 1 — those notices are already in the `ok` / `not_found` population) while an `HHS-CDC-GHC` " +
      "notice numbered `CDC-RFA-GH…` is not.",
  );
  out.push("");

  out.push("### 1a. Non-NIH open notices × `agency_code` × forecast × profile");
  out.push("");
  out.push(
    table(
      ["agency_code", "agency", "posted", "forecast", "with profile", "total"],
      groupCount(nonNih, (r) => String(r.agency_code ?? "∅ (null)")).map(([code]) => {
        const rows = nonNih.filter((r) => String(r.agency_code ?? "∅ (null)") === code);
        return [
          code,
          rows[0]?.agency ?? "—",
          rows.filter(isPosted).length,
          rows.filter((r) => !isPosted(r)).length,
          rows.filter((r) => profileIds.has(r.id)).length,
          rows.length,
        ];
      }),
    ),
  );
  out.push("");

  out.push("### 1b. Non-NIH open notices × funder family (PR 5.2's registry)");
  out.push("");
  out.push(
    table(
      ["family", "posted", "forecast", "with profile", "total"],
      groupCount(nonNih, (r) => funderFamily(r)).map(([fam]) => {
        const rows = nonNih.filter((r) => funderFamily(r) === fam);
        return [fam, rows.filter(isPosted).length, rows.filter((r) => !isPosted(r)).length, rows.filter((r) => profileIds.has(r.id)).length, rows.length];
      }),
    ),
  );
  out.push("");

  out.push("### 1c. Non-NIH posted notices × `category` (Simpler's funding category)");
  out.push("");
  out.push(table(["category", "count"], groupCount(nonNihPosted, (r) => String(r.category ?? "∅ (null)")).map(([k, n]) => [k, n])));
  out.push("");

  out.push("### 1d. Reconciliation with `GUIDE_DIAGNOSTICS.md` § 1e (never-fetched rows × family × status)");
  out.push("");
  const neverFetched = open.filter((r) => !r.guide_fetch_status);
  out.push(
    table(
      ["family (agency_code)", "Simpler status", "count", "§ 1e (2026-09-05)"],
      (() => {
        const expected: Record<string, number> = {
          "non-HHS|posted": 512,
          "other HHS|forecast": 72,
          "CDC|forecast": 27,
          "CDC|posted": 15,
          "non-HHS|forecast": 12,
          "other HHS|posted": 11,
          "NIH|forecast": 2,
          "NIH|posted": 1,
        };
        return groupCount(neverFetched, (r) => `${agencyFamily(r.agency_code)}|${isPosted(r) ? "posted" : "forecast"}`).map(([k, n]) => {
          const [fam, st] = k.split("|");
          return [fam, st, n, expected[k] ?? "—"];
        });
      })(),
    ),
  );
  out.push("");
  const posted1e = neverFetched.filter((r) => isPosted(r) && agencyFamily(r.agency_code) !== "NIH").length;
  const forecast1e = neverFetched.filter((r) => !isPosted(r) && agencyFamily(r.agency_code) !== "NIH").length;
  out.push(
    `Never fetched, non-NIH by agency family: **${posted1e} posted** (§ 1e: 512 + 15 + 11 = 538) and ` +
      `**${forecast1e} forecast** (§ 1e: 72 + 27 + 12 = 111). The addressable set this phase is sized against is the posted half.`,
  );
  out.push("");

  out.push("### 1e. Non-NIH posted notices × assistance listing (top 30)");
  out.push("");
  {
    const perListing = new Map<string, { n: number; title: string }>();
    let withNone = 0;
    for (const r of nonNihPosted) {
      const listings = assistanceListings(r);
      if (listings.length === 0) withNone += 1;
      for (const l of listings) {
        const cur = perListing.get(l.number) ?? { n: 0, title: l.title };
        cur.n += 1;
        perListing.set(l.number, cur);
      }
    }
    out.push(
      table(
        ["assistance listing", "program title", "notices"],
        [...perListing.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0])).slice(0, 30).map(([num, v]) => [num, v.title, v.n]),
      ),
    );
    out.push("");
    out.push(
      `Distinct assistance listings among the ${nonNihPosted.length} posted non-NIH notices: **${perListing.size}**; ` +
        `rows carrying none: **${withNone}**. Cross-tabulated with agency, and with example titles, in § 7d — as description, not as a filter.`,
    );
  }
  out.push("");

  // -------------------------------------------------------------------------
  // 2. The attachment hit-rate
  // -------------------------------------------------------------------------
  process.stderr.write("§ 2 attachments…\n");
  out.push("## 2. The attachment hit-rate (Simpler detail, and the legacy Grants.gov route)");
  out.push("");

  const storedLegacy = nonNihPosted.filter((r) => legacyOpportunityId(r) != null).length;
  out.push(
    kv([
      ["posted non-NIH rows", nonNihPosted.length],
      ["with `raw_payload_json.legacy_opportunity_id`", `${storedLegacy} (${pct(storedLegacy, nonNihPosted.length)})`],
      ["with `attachments[]` already in `raw_payload_json`", nonNihPosted.filter((r) => Array.isArray(r.raw_payload_json?.attachments)).length],
    ]),
  );
  out.push("");
  out.push(
    "> **Correction to NON_NIH_FEASIBILITY § 5 and NON_NIH_PLAN § PR 5.0(2).** Both say the legacy Grants.gov route " +
      "\"needs a numeric Grants.gov id the row does **not** store\", costing one `search2` call per row. The rows do store " +
      "it: Simpler returns `legacy_opportunity_id` and `simpler-grants-sync.ts` keeps the whole hit in `raw_payload_json`. " +
      "The agreement between that stored id and `searchGrantsGovOpportunityId()` is measured below; where they agree, " +
      "PR 5.3's adapter can skip the search call entirely.",
  );
  out.push("");

  const attachProbeSet = probeSet(nonNihPosted, (r) => String(r.agency_code ?? "∅"));
  const simpler: SimplerGrantsClient | null = createSimplerGrantsClient();
  if (!simpler) cannotEvaluate("Q2 · Simpler attachment hit-rate", "SIMPLER_GRANTS_API_KEY missing from .env.local");

  type AttachRow = { notice: Notice; ok: boolean; error: string | null; attachments: SimplerAttachment[] };
  const attachRows: AttachRow[] = [];

  if (dryRun || !simpler) {
    plannedRequests.push({
      host: HOSTS.simpler,
      what: `GET /v1/opportunities/{source_opportunity_id} — Simpler detail, for the attachment hit-rate`,
      count: attachProbeSet.length,
      examples: attachProbeSet.slice(0, 3).map((r) => `https://${HOSTS.simpler}/v1/opportunities/${r.source_opportunity_id}  (${r.opportunity_number})`),
    });
  } else {
    for (const [i, r] of attachProbeSet.entries()) {
      requestCount.simpler += 1;
      try {
        const hit = await limiters.simpler.schedule(() => simpler.getOpportunity(r.source_opportunity_id));
        attachRows.push({ notice: r, ok: true, error: null, attachments: (hit.attachments ?? []) as SimplerAttachment[] });
      } catch (e) {
        attachRows.push({ notice: r, ok: false, error: e instanceof Error ? e.message.slice(0, 160) : String(e), attachments: [] });
      }
      if ((i + 1) % 25 === 0 || i + 1 === attachProbeSet.length) {
        process.stderr.write(`  simpler ${i + 1}/${attachProbeSet.length}\n`);
      }
    }
  }

  if (attachRows.length > 0) {
    const okRows = attachRows.filter((a) => a.ok);
    const withAny = okRows.filter((a) => a.attachments.length > 0);
    const allAtts = okRows.flatMap((a) => a.attachments);
    const sizes = allAtts.map((a) => Number(a.file_size_bytes ?? 0)).filter((n) => Number.isFinite(n) && n > 0);
    out.push(`### 2a. Simpler \`GET /v1/opportunities/{id}\` over ${attachRows.length} posted non-NIH rows${limit ? " (capped)" : ""}`);
    out.push("");
    out.push(
      kv([
        ["rows probed", attachRows.length],
        ["detail call failed", attachRows.length - okRows.length],
        ["rows with ≥ 1 attachment", `${withAny.length} / ${okRows.length} (${pct(withAny.length, okRows.length)})`],
        ["attachments in total", allAtts.length],
        ["attachments per row with any (median)", median(withAny.map((a) => a.attachments.length))],
        ["attachment size, median bytes", median(sizes)],
        ["attachment size, p90 bytes", percentile(sizes, 0.9)],
      ]),
    );
    out.push("");
    out.push("**Hit-rate by agency**");
    out.push("");
    out.push(
      table(
        ["agency_code", "probed", "with ≥ 1 attachment", "rate"],
        groupCount(okRows, (a) => String(a.notice.agency_code ?? "∅")).map(([code]) => {
          const rows = okRows.filter((a) => String(a.notice.agency_code ?? "∅") === code);
          const hit = rows.filter((a) => a.attachments.length > 0).length;
          return [code, rows.length, hit, pct(hit, rows.length)];
        }),
      ),
    );
    out.push("");
    out.push("**Mime-type mix**");
    out.push("");
    out.push(
      table(
        ["mime_type", "attachments"],
        groupCount(allAtts, (a) => String(a.mime_type ?? "∅ (null)").split(";")[0]!.trim()).map(([k, n]) => [k, n]),
      ),
    );
    out.push("");
    out.push("**File-name patterns** (a name can match more than one)");
    out.push("");
    const namePatterns: Array<[string, RegExp]> = [
      ["`*-Full-Announcement.html`", /full.?announcement/i],
      ["`*_GG*.pdf` (CDMRP Grants.gov mirror)", /_GG\d*\./i],
      ["`nofo`", /nofo/i],
      ["`foa`", /\bfoa\b/i],
      ["`program announcement`", /program.?announcement/i],
      ["`solicitation`", /solicitation/i],
      ["`instructions` / `application package`", /instruction|application.?package/i],
      ["`.pdf` extension", /\.pdf$/i],
      ["`.html` / `.htm` extension", /\.html?$/i],
      ["`.docx` / `.doc` extension", /\.docx?$/i],
    ];
    out.push(
      table(
        ["pattern", "attachments", "share of all"],
        namePatterns.map(([label, re]) => {
          const n = allAtts.filter((a) => re.test(String(a.file_name ?? ""))).length;
          return [label, n, pct(n, allAtts.length)];
        }),
      ),
    );
    out.push("");
    out.push("**Rows with no attachment, by agency** — these fall back to the synopsis (§ 3) and would be capped at Exploratory by the § 7.1 cap");
    out.push("");
    out.push(
      table(
        ["agency_code", "rows with 0 attachments"],
        groupCount(okRows.filter((a) => a.attachments.length === 0), (a) => String(a.notice.agency_code ?? "∅")).map(([k, n]) => [k, n]),
      ),
    );
    out.push("");
    const failed = attachRows.filter((a) => !a.ok);
    if (failed.length > 0) {
      out.push("**Detail calls that failed**");
      out.push("");
      out.push(table(["opportunity_number", "error"], failed.slice(0, 20).map((a) => [a.notice.opportunity_number, a.error])));
      out.push("");
    }
    out.push("**A sample of what came back**");
    out.push("");
    out.push(
      table(
        ["opportunity_number", "agency_code", "file_name", "mime_type", "bytes"],
        withAny.slice(0, 15).flatMap((a) => a.attachments.slice(0, 2).map((f) => [a.notice.opportunity_number, a.notice.agency_code, f.file_name, f.mime_type, f.file_size_bytes])),
      ),
    );
    out.push("");
  }

  // 2b. Legacy Grants.gov comparison on a sample of the probed rows.
  const legacyPool = attachRows.length > 0 ? attachRows.filter((a) => a.ok).map((a) => a.notice) : attachProbeSet;
  const legacyRows = roundRobin(seededShuffle(legacyPool, seed + 1), (r) => String(r.agency_code ?? "∅"), Math.min(legacySample, legacyPool.length));

  out.push(`### 2b. The legacy Grants.gov route on ${legacyRows.length} of those rows`);
  out.push("");
  if (dryRun) {
    plannedRequests.push({
      host: HOSTS.grantsGov,
      what: "POST /v1/api/search2 then POST /v1/api/fetchOpportunity — legacy id resolution and synopsisAttachments",
      count: legacyRows.length * 2,
      examples: legacyRows.slice(0, 3).map((r) => `search2 {oppNum: "${r.opportunity_number}"} → fetchOpportunity {opportunityId: ${legacyOpportunityId(r) ?? "?"}}`),
    });
    out.push("_(dry run: not issued)_");
    out.push("");
  } else {
    type LegacyRow = {
      notice: Notice;
      stored: number | null;
      searched: number | null;
      agree: boolean | null;
      attachments: GrantsGovAttachment[] | null;
      simplerNames: string[];
    };
    const legacyResults: LegacyRow[] = [];
    for (const [i, r] of legacyRows.entries()) {
      const stored = legacyOpportunityId(r);
      requestCount.grantsGov += 1;
      const searched = await limiters.grantsGov.schedule(() => searchGrantsGovOpportunityId(String(r.opportunity_number ?? "")));
      const useId = searched ?? stored;
      let attachments: GrantsGovAttachment[] | null = null;
      if (useId != null) {
        requestCount.grantsGov += 1;
        const details = await limiters.grantsGov.schedule(() => fetchGrantsGovOpportunityDetails(useId));
        attachments = details?.attachments ?? null;
      }
      const simplerNames = (attachRows.find((a) => a.notice.id === r.id)?.attachments ?? []).map((f) => String(f.file_name ?? ""));
      legacyResults.push({
        notice: r,
        stored,
        searched,
        agree: stored != null && searched != null ? stored === searched : null,
        attachments,
        simplerNames,
      });
      if ((i + 1) % 10 === 0 || i + 1 === legacyRows.length) process.stderr.write(`  grants.gov ${i + 1}/${legacyRows.length}\n`);
    }

    const resolvable = legacyResults.filter((l) => l.searched != null).length;
    const agreeing = legacyResults.filter((l) => l.agree === true).length;
    const comparable = legacyResults.filter((l) => l.agree !== null).length;
    const bothSeen = legacyResults.filter((l) => l.attachments != null && attachRows.some((a) => a.notice.id === l.notice.id && a.ok));
    const legacyNamesOf = (l: LegacyRow) => (l.attachments ?? []).map((f) => f.fileName);
    const sameCount = bothSeen.filter((l) => legacyNamesOf(l).length === l.simplerNames.length);
    const sameVerbatim = bothSeen.filter((l) => {
      const a = new Set(l.simplerNames.map((n) => n.toLowerCase()));
      const b = new Set(legacyNamesOf(l).map((n) => n.toLowerCase()));
      return a.size === b.size && [...a].every((n) => b.has(n));
    });
    const sameNormalised = bothSeen.filter((l) => sameNameSet(l.simplerNames, legacyNamesOf(l)));
    const sameFolded = bothSeen.filter((l) => sameNameSet(l.simplerNames, legacyNamesOf(l), foldFileName));
    out.push(
      kv([
        ["rows sampled", legacyResults.length],
        ["`searchGrantsGovOpportunityId()` resolved an id", `${resolvable} (${pct(resolvable, legacyResults.length)})`],
        ["stored `legacy_opportunity_id` present", legacyResults.filter((l) => l.stored != null).length],
        ["stored id **equals** the searched id", `${agreeing} / ${comparable} (${pct(agreeing, comparable)})`],
        ["`fetchOpportunity` returned a record", legacyResults.filter((l) => l.attachments != null).length],
        ["same **number** of files on both routes", `${sameCount.length} / ${bothSeen.length} (${pct(sameCount.length, bothSeen.length)})`],
        ["file names identical verbatim", `${sameVerbatim.length} / ${bothSeen.length} (${pct(sameVerbatim.length, bothSeen.length)})`],
        ["file names identical after `[ _]+ → _`", `${sameNormalised.length} / ${bothSeen.length} (${pct(sameNormalised.length, bothSeen.length)})`],
        ["file names identical with punctuation folded away", `${sameFolded.length} / ${bothSeen.length} (${pct(sameFolded.length, bothSeen.length)})`],
      ]),
    );
    out.push("");
    out.push(
      "Simpler URL-safes the name it serves and drops punctuation grants.gov keeps " +
        "(`…-Part 2.pdf` → `…-Part_2.pdf`, `M&E` → `ME`, `…_(1).xlsx` → `…_1.xlsx`), so the verbatim comparison " +
        "understates the agreement badly. The folded row is the one to read: it can hide a difference of punctuation, " +
        "never a missing or extra file, so **where it reaches 100 % the two routes returned the same set of files** " +
        "and PR 5.3 may treat them as interchangeable.",
    );
    out.push("");
    out.push(
      table(
        ["opportunity_number", "agency_code", "stored id", "search2 id", "same id", "legacy files", "simpler files", "same set"],
        legacyResults.slice(0, 30).map((l) => [
          l.notice.opportunity_number,
          l.notice.agency_code,
          l.stored,
          l.searched,
          l.agree,
          legacyNamesOf(l).length,
          l.simplerNames.length,
          l.attachments == null ? null : sameNameSet(l.simplerNames, legacyNamesOf(l)),
        ]),
      ),
    );
    out.push("");
    const differing = bothSeen.filter((l) => !sameNameSet(l.simplerNames, legacyNamesOf(l), foldFileName));
    if (differing.length > 0) {
      out.push("Rows whose file sets differ after folding — a real difference, not a spelling one:");
      out.push("");
      out.push(
        table(
          ["opportunity_number", "only on Simpler", "only on grants.gov"],
          differing.slice(0, 15).map((l) => {
            const s = new Set(l.simplerNames.map(foldFileName));
            const g = new Set(legacyNamesOf(l).map(foldFileName));
            return [
              l.notice.opportunity_number,
              [...s].filter((n) => !g.has(n)).join(", ") || "—",
              [...g].filter((n) => !s.has(n)).join(", ") || "—",
            ];
          }),
        ),
      );
      out.push("");
    }
  }

  // -------------------------------------------------------------------------
  // 3. Description coverage
  // -------------------------------------------------------------------------
  process.stderr.write("§ 3 descriptions…\n");
  out.push("## 3. `description` — the synopsis fallback's real coverage");
  out.push("");
  out.push(
    "`noticeText()` falls back to `synopsisSections(notice.description)`; `description` holds Simpler's " +
      "`summary_description`, which is HTML. Both lengths are reported because the extractor reads the text, not the markup.",
  );
  out.push("");
  out.push(
    table(
      ["family", "posted rows", "non-empty", "share non-empty", "raw chars p10", "raw median", "raw p90", "text median", "text < 500 chars"],
      groupCount(nonNihPosted, (r) => funderFamily(r)).map(([fam]) => {
        const rows = nonNihPosted.filter((r) => funderFamily(r) === fam);
        const raws = rows.map((r) => String(r.description ?? ""));
        const nonEmpty = raws.filter((s) => s.trim().length > 0);
        const texts = nonEmpty.map((s) => strippedText(s).length);
        return [
          fam,
          rows.length,
          nonEmpty.length,
          pct(nonEmpty.length, rows.length),
          percentile(nonEmpty.map((s) => s.length), 0.1),
          median(nonEmpty.map((s) => s.length)),
          percentile(nonEmpty.map((s) => s.length), 0.9),
          median(texts),
          texts.filter((n) => n < 500).length,
        ];
      }),
    ),
  );
  out.push("");
  {
    const raws = nonNihPosted.map((r) => String(r.description ?? ""));
    const nonEmpty = raws.filter((s) => s.trim().length > 0);
    const texts = nonEmpty.map((s) => strippedText(s).length);
    out.push(
      kv([
        ["posted non-NIH rows", nonNihPosted.length],
        ["with a non-empty `description`", `${nonEmpty.length} (${pct(nonEmpty.length, nonNihPosted.length)})`],
        ["stripped text, median chars", median(texts)],
        ["stripped text under 500 chars", `${texts.filter((n) => n < 500).length} (${pct(texts.filter((n) => n < 500).length, texts.length)})`],
        ["stripped text under 1,000 chars", `${texts.filter((n) => n < 1000).length} (${pct(texts.filter((n) => n < 1000).length, texts.length)})`],
      ]),
    );
  }
  out.push("");

  // -------------------------------------------------------------------------
  // 4. NSF
  // -------------------------------------------------------------------------
  process.stderr.write("§ 4 NSF…\n");
  out.push("## 4. NSF — which route reaches the solicitation");
  out.push("");
  const nsfRows = nonNihPosted.filter((r) => funderFamily(r) === "nsf");
  const NSF_NUMBER_RE = /^(\d{2})-(\d{3})$/;
  const nsfNormalised = nsfRows.filter((r) => NSF_NUMBER_RE.test(String(r.opportunity_number ?? "").trim()));
  const nsfPd = nsfRows.filter((r) => !NSF_NUMBER_RE.test(String(r.opportunity_number ?? "").trim()));
  function nsfPdfUrl(num: string): string | null {
    const m = num.trim().match(NSF_NUMBER_RE);
    if (!m) return null;
    const stem = `nsf${m[1]}${m[2]}`;
    return `https://${HOSTS.nsf}/solicitations/pubs/20${m[1]}/${stem}/${stem}.pdf`;
  }
  out.push(
    "**This section reverses what the plan originally instructed**, and the order below reflects the finding rather " +
      "than the original expectation. The plan said to derive a PDF URL from `opportunity_number` and to ignore " +
      "`additional_info_url` because it \"resolves to the wrong document\". Measured, the opposite holds: the stored " +
      "`additional_info_url` redirects to a complete HTML solicitation, and the derived PDF 404s for every 2025–26 " +
      "publication. Both are still probed here — § 4a is the route to use, § 4b is the fallback and the evidence for " +
      "not relying on it.",
  );
  out.push("");
  out.push(
    "The earlier wrong-document claim came from a **constructed** `ods_key`. This script never constructs one: " +
      "§ 4a follows the URL the row stores, and a row without one is reported as unresolvable rather than guessed at.",
  );
  out.push("");
  out.push(
    kv([
      ["NSF posted rows", nsfRows.length],
      ["`opportunity_number` matches `NN-NNN` (a solicitation)", `${nsfNormalised.length} (${pct(nsfNormalised.length, nsfRows.length)})`],
      ["`PD-…` program descriptions (§ 4c — a separate case, not a miss)", `${nsfPd.length} (${pct(nsfPd.length, nsfRows.length)})`],
    ]),
  );
  out.push("");
  // The stored additional_info_url, which redirects to the HTML solicitation. The route to use.
  out.push("### 4a. The stored `additional_info_url` → the HTML solicitation on `www.nsf.gov` — **the route to use**");
  out.push("");
  out.push(
    "The URL is taken from the row (`raw_payload_json.summary.additional_info_url`) when it is on an `*.nsf.gov` host, " +
      "and from nowhere else. Redirects are followed to the final page, which is then tested for the section skeleton " +
      "NON_NIH_FEASIBILITY § 6 maps to roles. A landing page reached this way is HTML, so **a solicitation recovered " +
      "by this route needs no PDF extraction** — which is what takes NSF out of D66's scope.",
  );
  out.push("");
  const NSF_HEADINGS: Array<[string, RegExp]> = [
    ["I. Introduction (`purpose`)", /\bI\.\s*Introduction\b/i],
    ["II. Program Description (`objectives`)", /\bII\.\s*Program Description\b/i],
    ["III. Award Information (`award_info`)", /\bIII\.\s*Award Information\b/i],
    ["IV. Eligibility Information (`eligibility`)", /\bIV\.\s*Eligibility Information\b/i],
    ["VI. Review Procedures (`review`)", /\bVI\.\s*(NSF )?Proposal Processing and Review|VI\.\s*Review Procedures/i],
    ["VIII. Agency Contacts (`contacts`)", /\bVIII\.\s*Agency Contacts\b/i],
  ];
  /**
   * The URL the row stores, and only that. An `ods_key` is never constructed:
   * the earlier "additional_info_url resolves to the wrong document" finding
   * came from a constructed one, and a guess that happens to 200 is worse than
   * a row reported as unresolvable.
   */
  function nsfLandingUrl(r: Notice): string | null {
    const given = r.raw_payload_json?.summary?.additional_info_url;
    if (typeof given !== "string" || !given.trim()) return null;
    try {
      const u = new URL(given.trim().replace(/^http:/, "https:"));
      return u.hostname.toLowerCase().endsWith("nsf.gov") ? u.toString() : null;
    } catch {
      return null;
    }
  }
  const nsfAllRows = nonNihPosted.filter((r) => funderFamily(r) === "nsf");
  const nsfLandingRows = probeSet(nsfAllRows.filter((r) => nsfLandingUrl(r) != null), () => "nsf-landing");
  out.push(
    kv([
      ["NSF posted rows", nsfAllRows.length],
      ["carrying an `*.nsf.gov` `additional_info_url`", `${nsfAllRows.filter((r) => nsfLandingUrl(r) != null).length} (${pct(nsfAllRows.filter((r) => nsfLandingUrl(r) != null).length, nsfAllRows.length)})`],
      ["carrying none — unresolvable, never guessed at", nsfAllRows.filter((r) => nsfLandingUrl(r) == null).length],
    ]),
  );
  out.push("");
  {
    const noUrl = nsfAllRows.filter((r) => nsfLandingUrl(r) == null);
    if (noUrl.length > 0) {
      out.push("Rows with no stored NSF URL:");
      out.push("");
      out.push(table(["opportunity_number", "title"], noUrl.map((r) => [r.opportunity_number, String(r.title ?? "").slice(0, 70)])));
      out.push("");
    }
  }
  if (dryRun) {
    plannedRequests.push({
      host: HOSTS.nsfWww,
      what: "GET the publication landing page, follow redirects, test for the I–IX skeleton",
      count: nsfLandingRows.length,
      examples: nsfLandingRows.slice(0, 3).map((r) => nsfLandingUrl(r)!),
    });
    out.push("_(dry run: not issued)_");
    out.push("");
  } else if (nsfLandingRows.length === 0) {
    cannotEvaluate("Q4 · NSF landing-page route", "no NSF row yields a landing URL");
  } else {
    const probes: Array<{ r: Notice; p: PageProbe }> = [];
    for (const [i, r] of nsfLandingRows.entries()) {
      probes.push({ r, p: await pageProbe("nsfWww", nsfLandingUrl(r)!, NSF_HEADINGS) });
      if ((i + 1) % 20 === 0 || i + 1 === nsfLandingRows.length) process.stderr.write(`  nsf landing ${i + 1}/${nsfLandingRows.length}\n`);
    }
    const ok = probes.filter((x) => x.p.http === 200);
    const isPd = (n: unknown) => /^PD-/i.test(String(n ?? ""));
    const solicitationRows = ok.filter((x) => !isPd(x.r.opportunity_number));
    const pdRows = ok.filter((x) => isPd(x.r.opportunity_number));
    const withObjectives = ok.filter((x) => x.p.headings.some((h) => h.startsWith("II.")));
    const solicitationUrl = ok.filter((x) => /\/solicitation\b/.test(String(x.p.finalUrl ?? x.p.url)));
    out.push(
      kv([
        ["pages fetched", probes.length],
        ["HTTP 200", `${ok.length} (${pct(ok.length, probes.length)})`],
        ["final URL ends `/solicitation`", `${solicitationUrl.length} (${pct(solicitationUrl.length, ok.length)} of 200s)`],
        ["carries `II. Program Description` (the `objectives` role)", `${withObjectives.length} (${pct(withObjectives.length, ok.length)} of 200s)`],
        ["median page bytes", median(ok.map((x) => x.p.bytes))],
      ]),
    );
    out.push("");
    out.push(
      table(
        ["row kind", "fetched", "carries `II. Program Description`", "rate"],
        [
          [
            "`NN-NNN` (a solicitation)",
            solicitationRows.length,
            solicitationRows.filter((x) => x.p.headings.some((h) => h.startsWith("II."))).length,
            pct(solicitationRows.filter((x) => x.p.headings.some((h) => h.startsWith("II."))).length, solicitationRows.length),
          ],
          [
            "`PD-…` (a program description, not a solicitation)",
            pdRows.length,
            pdRows.filter((x) => x.p.headings.some((h) => h.startsWith("II."))).length,
            pct(pdRows.filter((x) => x.p.headings.some((h) => h.startsWith("II."))).length, pdRows.length),
          ],
        ],
      ),
    );
    out.push("");
    out.push(
      "The `PD-` rows are NSF **program descriptions**, not solicitations: they land on a program page with no " +
        "`I.–IX.` skeleton and no PDF. They are a distinct acquisition case, and the solicitation rate should be read " +
        "off the first line alone.",
    );
    out.push("");
    out.push("Roles recoverable from the landing page (`NN-NNN` rows only):");
    out.push("");
    out.push(
      table(
        ["heading", "pages carrying it", "share of solicitation rows"],
        NSF_HEADINGS.map(([label]) => {
          const n = solicitationRows.filter((x) => x.p.headings.includes(label)).length;
          return [label, n, pct(n, solicitationRows.length)];
        }),
      ),
    );
    out.push("");
    out.push(
      table(
        ["opportunity_number", "HTTP", "final URL", "roles found"],
        probes.slice(0, 20).map((x) => [x.r.opportunity_number, x.p.http, String(x.p.finalUrl ?? x.p.url).slice(0, 100), x.p.headings.length]),
      ),
    );
    out.push("");
    // Route A and route B on the same rows, so PR 5.4 can choose.
    out.push(
      `The derived-PDF fallback is measured on the same corpus in § 4b, and the two are directly comparable: every ` +
        `row this route resolves to a solicitation page carrying \`II. Program Description\` is a row PR 5.4 can ` +
        `section without touching a PDF, whatever § 4b returns for it.`,
    );
    out.push("");
  }

  out.push("### 4b. The derived `nsf-gov-resources.nsf.gov` PDF — fallback only");
  out.push("");
  const nsfProbeRows = probeSet(nsfNormalised, () => "nsf");
  if (dryRun) {
    plannedRequests.push({
      host: HOSTS.nsf,
      what: "HEAD the derived solicitation PDF",
      count: nsfProbeRows.length,
      examples: nsfProbeRows.slice(0, 3).map((r) => nsfPdfUrl(String(r.opportunity_number))!),
    });
    out.push("_(dry run: HEADs not issued)_");
    out.push("");
  } else if (nsfProbeRows.length === 0) {
    cannotEvaluate("Q4 · NSF PDF hit-rate", "no NSF row with a normalising opportunity_number");
  } else {
    const probes: Array<{ r: Notice; p: HeadProbe }> = [];
    for (const [i, r] of nsfProbeRows.entries()) {
      const url = nsfPdfUrl(String(r.opportunity_number))!;
      probes.push({ r, p: await headProbe("nsf", url) });
      if ((i + 1) % 20 === 0 || i + 1 === nsfProbeRows.length) process.stderr.write(`  nsf ${i + 1}/${nsfProbeRows.length}\n`);
    }
    const ok = probes.filter((x) => x.p.http === 200);
    const pdf = ok.filter((x) => /pdf/i.test(String(x.p.contentType ?? "")));
    out.push(
      kv([
        ["URLs probed", probes.length],
        ["HTTP 200", `${ok.length} (${pct(ok.length, probes.length)})`],
        ["200 and `application/pdf`", `${pdf.length} (${pct(pdf.length, probes.length)})`],
        ["median content-length, bytes", median(pdf.map((x) => x.p.contentLength ?? 0).filter((n) => n > 0))],
      ]),
    );
    out.push("");
    out.push(table(["HTTP", "count"], groupCount(probes, (x) => String(x.p.http)).map(([k, n]) => [k, n])));
    out.push("");
    const misses = probes.filter((x) => x.p.http !== 200);
    if (misses.length > 0) {
      out.push("Misses:");
      out.push("");
      out.push(table(["opportunity_number", "URL", "HTTP"], misses.slice(0, 20).map((x) => [x.r.opportunity_number, x.p.url, x.p.http])));
      out.push("");
    }
  }

  // 4c. The PD- rows are a different kind of record, not a failure of either route.
  out.push("### 4c. `PD-` program descriptions — a separate acquisition case, not NSF misses");
  out.push("");
  out.push(
    "These rows are NSF **program descriptions**: a standing description of what a division funds, not a solicitation " +
      "with deadlines and a review process. They carry no `I.–IX.` skeleton and no PDF, so neither route can reach a " +
      "solicitation for them — because there is not one. They are counted here rather than inside either route's " +
      "hit-rate, and PR 5.4 should let them fall through to the synopsis path instead of retrying them.",
  );
  out.push("");
  out.push(
    table(
      ["opportunity_number", "title", "stored `additional_info_url`"],
      nsfPd.map((r) => {
        const v = r.raw_payload_json?.summary?.additional_info_url;
        return [r.opportunity_number, String(r.title ?? "").slice(0, 70), typeof v === "string" ? v : "—"];
      }),
    ),
  );
  out.push("");
  out.push(
    `${nsfPd.length} of the ${nsfRows.length} posted NSF rows. Two URL shapes appear among them — ` +
      "`pub_summ.jsp?ods_key=<NNNNNN>` (no `nsf` prefix, unlike a solicitation's key) and the older " +
      "`pgm_summ.jsp?pims_id=<N>` — which is a further reason not to construct keys.",
  );
  out.push("");

  // -------------------------------------------------------------------------
  // 5. CDMRP
  // -------------------------------------------------------------------------
  process.stderr.write("§ 5 CDMRP…\n");
  out.push("## 5. CDMRP / DOD-AMRAA — FON shape, the `_GG.pdf` route, and the mechanism mix");
  out.push("");
  const cdmrpRows = nonNihPosted.filter((r) => funderFamily(r) === "dod_cdmrp");
  /** The modern CDMRP FON: HT9425 + two-digit FY + program + mechanism; W81XWH-NN-… is the pre-2023 shape. */
  const FON_MODERN = /^(HT\d{4})(\d{2})([A-Z0-9]+)$/;
  const FON_LEGACY = /^W81XWH-\d{2}-[A-Z0-9-]+$/;
  const cdmrpModern = cdmrpRows.filter((r) => FON_MODERN.test(String(r.opportunity_number ?? "").trim().toUpperCase()));
  const cdmrpLegacy = cdmrpRows.filter((r) => FON_LEGACY.test(String(r.opportunity_number ?? "").trim().toUpperCase()));
  out.push(
    kv([
      ["DOD-AMRAA / CDMRP posted rows", cdmrpRows.length],
      ["matches `HT####YY<PROGRAM><MECHANISM>`", `${cdmrpModern.length} (${pct(cdmrpModern.length, cdmrpRows.length)})`],
      ["matches the legacy `W81XWH-YY-…` shape", cdmrpLegacy.length],
      ["neither", cdmrpRows.length - cdmrpModern.length - cdmrpLegacy.length],
    ]),
  );
  out.push("");

  /** Award-mechanism acronyms CDMRP appends to the FON; longest match first. PR 5.8 reads this table. */
  const CDMRP_MECHANISMS = [
    "IMPACT", "PCTA", "CTAP", "IIRA", "TTDA", "ECRA", "CDA", "CTA", "IDA", "TRA", "RTA", "FPA", "PRA", "RPA",
    "SIA", "CRA", "DRA", "TSA", "EIA", "ARM", "IPA", "NIA", "OCC", "QUAD", "TRP", "PA", "RA",
  ];
  function cdmrpSplit(num: string): { tail: string; program: string; mechanism: string } {
    const m = num.trim().toUpperCase().match(FON_MODERN);
    if (!m) return { tail: "(not a modern FON)", program: "—", mechanism: "—" };
    const tail = m[3]!;
    const hit = [...CDMRP_MECHANISMS].sort((a, b) => b.length - a.length).find((mech) => tail.endsWith(mech) && tail.length > mech.length);
    return hit ? { tail, program: tail.slice(0, tail.length - hit.length), mechanism: hit } : { tail, program: tail, mechanism: "(unmatched)" };
  }

  out.push("### 5a. Mechanism suffix distribution — known-wrong, kept only as a shape check");
  out.push("");
  out.push(
    "**Do not build on this table.** The suffix match below is wrong in both directions and is not being fixed here: " +
      "`PCTA` is `P` + `CTA` mis-bound, `AZRPTRCA` is `AZRP` + `TRCA`, and the unmatched bucket is not a residue of " +
      "rare mechanisms but of programs whose abbreviation the regex ate. It is printed only to show the rough shape " +
      "of the distribution. § 5b is the input PR 5.5 uses.",
  );
  out.push("");
  out.push(
    table(
      ["mechanism suffix", "notices", "example programs"],
      groupCount(cdmrpModern, (r) => cdmrpSplit(String(r.opportunity_number)).mechanism).map(([mech, n]) => [
        mech,
        n,
        cdmrpModern
          .filter((r) => cdmrpSplit(String(r.opportunity_number)).mechanism === mech)
          .slice(0, 4)
          .map((r) => cdmrpSplit(String(r.opportunity_number)).program)
          .join(", "),
      ]),
    ),
  );
  out.push("");
  out.push("### 5b. Raw FON tails, verbatim — PR 5.5's input");
  out.push("");
  out.push(
    "**This table, not § 5a, is the deliverable.** § 5a's suffix match is known to be wrong in both directions — " +
      "`PCTA ×10` is `P` + `CTA` mis-bound and `AZRPTRCA` is `AZRP` + `TRCA` — because CDMRP program abbreviations " +
      "vary in length and no suffix regex can cut them correctly. PR 5.5 seeds the **program** set from CDMRP's " +
      "published program list and takes the remainder as the mechanism; these are the strings it cuts. Every row is " +
      "listed, uncollapsed.",
  );
  out.push("");
  out.push(
    table(
      ["opportunity_number", "FON tail", "office+FY prefix"],
      cdmrpModern
        .map((r) => {
          const num = String(r.opportunity_number).trim().toUpperCase();
          const m = num.match(FON_MODERN);
          return [num, cdmrpSplit(num).tail, m ? `${m[1]}${m[2]}` : "—"];
        })
        .sort((a, b) => String(a[1]).localeCompare(String(b[1]))),
    ),
  );
  out.push("");
  {
    const other = cdmrpRows.filter((r) => !FON_MODERN.test(String(r.opportunity_number ?? "").trim().toUpperCase()));
    out.push(`${cdmrpModern.length} modern FONs listed above; ${other.length} row(s) do not match that shape:`);
    out.push("");
    out.push(table(["opportunity_number", "title"], other.map((r) => [r.opportunity_number, String(r.title ?? "").slice(0, 70)])));
    out.push("");
  }

  const cdmrpProbeRows = probeSet(cdmrpModern, () => "cdmrp");
  const cdmrpUrl = (num: string) => `https://${HOSTS.cdmrp}/funding/pa/${num.trim().toUpperCase()}_GG.pdf`;
  out.push("### 5c. `https://cdmrp.health.mil/funding/pa/{FON}_GG.pdf`");
  out.push("");
  if (dryRun) {
    plannedRequests.push({
      host: HOSTS.cdmrp,
      what: "HEAD the Program Announcement PDF",
      count: cdmrpProbeRows.length,
      examples: cdmrpProbeRows.slice(0, 3).map((r) => cdmrpUrl(String(r.opportunity_number))),
    });
    out.push("_(dry run: HEADs not issued)_");
    out.push("");
  } else if (cdmrpProbeRows.length === 0) {
    cannotEvaluate("Q5 · CDMRP PDF hit-rate", "no DOD-AMRAA row with a modern FON");
  } else {
    const probes: Array<{ r: Notice; p: HeadProbe }> = [];
    for (const [i, r] of cdmrpProbeRows.entries()) {
      probes.push({ r, p: await headProbe("cdmrp", cdmrpUrl(String(r.opportunity_number))) });
      if ((i + 1) % 20 === 0 || i + 1 === cdmrpProbeRows.length) process.stderr.write(`  cdmrp ${i + 1}/${cdmrpProbeRows.length}\n`);
    }
    const ok = probes.filter((x) => x.p.http === 200);
    const pdf = ok.filter((x) => /pdf/i.test(String(x.p.contentType ?? "")));
    out.push(
      kv([
        ["URLs probed", probes.length],
        ["HTTP 200", `${ok.length} (${pct(ok.length, probes.length)})`],
        ["200 and `application/pdf`", `${pdf.length} (${pct(pdf.length, probes.length)})`],
        ["median content-length, bytes", median(pdf.map((x) => x.p.contentLength ?? 0).filter((n) => n > 0))],
      ]),
    );
    out.push("");
    out.push(table(["HTTP", "count"], groupCount(probes, (x) => String(x.p.http)).map(([k, n]) => [k, n])));
    out.push("");
    const misses = probes.filter((x) => x.p.http !== 200);
    if (misses.length > 0) {
      out.push("Misses:");
      out.push("");
      out.push(table(["opportunity_number", "URL", "HTTP"], misses.slice(0, 20).map((x) => [x.r.opportunity_number, x.p.url, x.p.http])));
      out.push("");
    }
    const mirrored = probes.filter((x) => {
      const att = attachRows.find((a) => a.notice.id === x.r.id);
      return att?.ok && att.attachments.some((f) => /_GG\d*\.pdf$/i.test(String(f.file_name ?? "")));
    });
    out.push(`Of the probed rows, **${mirrored.length}** also carry a \`_GG*.pdf\` Simpler attachment (the mirror NON_NIH_FEASIBILITY § 5 predicts), among those § 2 probed.`);
    out.push("");
  }

  // -------------------------------------------------------------------------
  // 6. RePORTER coverage of the HHS siblings
  // -------------------------------------------------------------------------
  process.stderr.write("§ 6 RePORTER…\n");
  out.push("## 6. RePORTER coverage of the HHS siblings (`RFA-HS/CE/DP/OH/IP-`)");
  out.push("");
  const SIBLING_PREFIXES = ["RFA-HS-", "RFA-CE-", "RFA-DP-", "RFA-OH-", "RFA-IP-"];
  const siblings = open.filter((r) => SIBLING_PREFIXES.some((p) => String(r.opportunity_number ?? "").toUpperCase().startsWith(p)));
  const siblingsWithNumber = siblings.filter((r) => normalizeAnnouncementNumber(r.opportunity_number) != null);
  out.push(
    kv([
      ["open notices with a sibling prefix", siblings.length],
      ["— posted", siblings.filter(isPosted).length],
      ["— `normalizeAnnouncementNumber()` accepts the number", siblingsWithNumber.length],
    ]),
  );
  out.push("");
  out.push(table(["prefix", "open", "posted"], SIBLING_PREFIXES.map((p) => {
    const rows = siblings.filter((r) => String(r.opportunity_number ?? "").toUpperCase().startsWith(p));
    return [p, rows.length, rows.filter(isPosted).length];
  })));
  out.push("");

  const siblingProbeRows = probeSet(siblingsWithNumber, (r) => String(r.opportunity_number ?? "").slice(0, 7));
  if (dryRun) {
    plannedRequests.push({
      host: HOSTS.reporter,
      what: "POST /v2/projects/search with criteria.opportunity_numbers (the existing exemplar search)",
      count: siblingProbeRows.length,
      examples: siblingProbeRows.slice(0, 3).map((r) => `opportunity_numbers: ["${r.opportunity_number}"]`),
    });
    out.push("_(dry run: not issued)_");
    out.push("");
  } else if (siblingProbeRows.length === 0) {
    out.push("_(no sibling notice carries an announcement-shaped number; nothing to ask RePORTER)_");
    out.push("");
  } else {
    const lineageIndex = new Map<string, LineageRow>();
    for (const r of open) {
      const n = normalizeAnnouncementNumber(r.opportunity_number);
      if (n && !lineageIndex.has(n)) lineageIndex.set(n, { opportunity_number: r.opportunity_number, reissue_of: r.reissue_of });
    }
    const results: Array<{ r: Notice; distinct: number; apiTotal: number | null; error: string | null }> = [];
    for (const [i, r] of siblingProbeRows.entries()) {
      const lineage = buildLineage({ opportunity_number: r.opportunity_number, reissue_of: r.reissue_of }, lineageIndex);
      try {
        requestCount.reporter += 1;
        const res = await fetchNoticeExemplars({
          noticeNumber: normalizeAnnouncementNumber(r.opportunity_number)!,
          lineage,
          maxPages: 1,
        });
        results.push({ r, distinct: res.distinct, apiTotal: res.apiTotal, error: null });
      } catch (e) {
        results.push({ r, distinct: 0, apiTotal: null, error: e instanceof Error ? e.message.slice(0, 140) : String(e) });
      }
      process.stderr.write(`  reporter ${i + 1}/${siblingProbeRows.length} ${r.opportunity_number}\n`);
    }
    const okRes = results.filter((x) => x.error === null);
    const fiveOrMore = okRes.filter((x) => x.distinct >= 5);
    out.push(
      kv([
        ["notices asked", results.length],
        ["request failed", results.length - okRes.length],
        ["≥ 5 distinct projects", `${fiveOrMore.length} / ${okRes.length} (${pct(fiveOrMore.length, okRes.length)})`],
        ["≥ 1 project", `${okRes.filter((x) => x.distinct >= 1).length} / ${okRes.length}`],
        ["median distinct projects", median(okRes.map((x) => x.distinct))],
      ]),
    );
    out.push("");
    out.push("By prefix:");
    out.push("");
    out.push(
      table(
        ["prefix", "asked", "≥ 5 projects", "≥ 1 project"],
        SIBLING_PREFIXES.map((p) => {
          const rows = okRes.filter((x) => String(x.r.opportunity_number ?? "").toUpperCase().startsWith(p));
          return [p, rows.length, rows.filter((x) => x.distinct >= 5).length, rows.filter((x) => x.distinct >= 1).length];
        }),
      ),
    );
    out.push("");
    out.push(
      table(
        ["opportunity_number", "agency_code", "distinct projects", "award-years (meta.total)", "error"],
        results.slice(0, 40).map((x) => [x.r.opportunity_number, x.r.agency_code, x.distinct, x.apiTotal, x.error ?? "—"]),
      ),
    );
    out.push("");
  }

  // -------------------------------------------------------------------------
  // 7. Admission, not exclusion (D67)
  // -------------------------------------------------------------------------
  process.stderr.write("§ 7 eligibility signals…\n");
  out.push("## 7. Admission, not exclusion — the material for D67");
  out.push("");
  out.push(
    "**Nothing in this section is a proposed corpus filter, and none is implied by any number in it.** Prospera serves " +
      "multiple communities off one shared notice table (ImmunoX today, Global Health Sciences next), so no funder, " +
      "subject or assistance listing is out of scope a priori: a USDA nutrition notice or a DOT road-traffic-injury " +
      "notice is a real lead for a global-health investigator and noise for an immunologist, and it is the same row " +
      "(NON_NIH_FEASIBILITY § 1). Relevance is a property of the **pair**, and belongs where the engine already lives.",
  );
  out.push("");
  out.push(
    "What is measured here is the other thing D67 asks: **eligibility facts**, which are not subject-matter facts. " +
      "A notice a university cannot hold — one that admits only individuals or state governments, or that is a " +
      "procurement action rather than an assistance award — should be removed at stage 1 by `eligibility()` with a " +
      "stated reason (E = 0), not filtered out of the corpus and not silently scored. NON_NIH_FEASIBILITY § 7.3 asks " +
      "for the size of that set before anything is adopted; § 7c is that number.",
  );
  out.push("");

  /** Simpler's applicant-type codes an institution like UCSF can hold an award under. */
  const IHE_TYPES = ["public_and_state_institutions_of_higher_education", "private_institutions_of_higher_education"];
  const NONPROFIT_TYPES = ["nonprofits_non_higher_education_with_501c3", "nonprofits_non_higher_education_without_501c3"];
  /** "unrestricted" admits anyone; "other" defers to the announcement text — neither is an exclusion. */
  const OPEN_TYPES = ["unrestricted", "other"];

  function applicantTypes(r: Notice): string[] {
    const v = r.applicant_types;
    if (typeof v === "string") return v.trim() ? [v.trim()] : [];
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean) : [];
  }
  const hasAny = (types: string[], want: string[]) => types.some((t) => want.includes(t));

  /** funding_instrument is stored comma-joined by the sync (`simpler-grants-sync.ts:511`). */
  function fundingInstruments(r: Notice): string[] {
    return String(r.funding_instrument ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const ASSISTANCE_INSTRUMENTS = ["grant", "cooperative_agreement"];
  /** Named in NON_NIH_FEASIBILITY § 7.3 as candidates; reported even at zero, so their absence is on the record. */
  const NON_ASSISTANCE_INSTRUMENTS = [
    "procurement_contract",
    "formula_grant",
    "direct_payment_for_specified_use",
    "direct_payment_with_unrestricted_use",
    "insurance",
    "loan",
    "loan_guarantee",
  ];

  out.push("### 7a. `applicant_types` across the posted non-NIH set");
  out.push("");
  {
    const all = nonNihPosted.flatMap((r) => applicantTypes(r).map((t) => ({ r, t })));
    out.push(
      table(
        ["applicant type", "notices", "share of the 536"],
        groupCount(all, (x) => x.t).map(([t, n]) => [t, n, pct(n, nonNihPosted.length)]),
      ),
    );
    out.push("");
    out.push(
      kv([
        ["rows with an empty `applicant_types`", nonNihPosted.filter((r) => applicantTypes(r).length === 0).length],
        ["admits an institution of higher education", nonNihPosted.filter((r) => hasAny(applicantTypes(r), IHE_TYPES)).length],
        ["admits a non-profit", nonNihPosted.filter((r) => hasAny(applicantTypes(r), NONPROFIT_TYPES)).length],
        ["carries `unrestricted`", nonNihPosted.filter((r) => applicantTypes(r).includes("unrestricted")).length],
        ["carries `other` (defers to the announcement)", nonNihPosted.filter((r) => applicantTypes(r).includes("other")).length],
        ["carries `individuals`", nonNihPosted.filter((r) => applicantTypes(r).includes("individuals")).length],
      ]),
    );
    out.push("");
  }

  out.push("### 7b. `funding_instrument` across the posted non-NIH set");
  out.push("");
  {
    const all = nonNihPosted.flatMap((r) => fundingInstruments(r).map((t) => ({ r, t })));
    out.push(
      table(
        ["instrument", "notices", "share of the 536"],
        groupCount(all, (x) => x.t).map(([t, n]) => [t, n, pct(n, nonNihPosted.length)]),
      ),
    );
    out.push("");
    out.push("The combinations as stored:");
    out.push("");
    out.push(table(["`funding_instrument`", "notices"], groupCount(nonNihPosted, (r) => String(r.funding_instrument ?? "∅ (null)")).map(([k, n]) => [k, n])));
    out.push("");
    const absent = NON_ASSISTANCE_INSTRUMENTS.filter((i) => !all.some((x) => x.t === i));
    out.push(
      table(
        ["instrument named in feasibility § 7.3", "notices carrying it"],
        NON_ASSISTANCE_INSTRUMENTS.map((i) => [i, all.filter((x) => x.t === i).length]),
      ),
    );
    out.push("");
    out.push(
      absent.length === NON_ASSISTANCE_INSTRUMENTS.length
        ? "**None of the instruments § 7.3 names as candidates occurs in this corpus at all.** Simpler's vocabulary here is " +
            "`grant`, `cooperative_agreement`, `other` and `procurement_contract` only, so \"direct payments and formula grants\" " +
            "is not a live category for these rows."
        : `Not present in this corpus: ${absent.length ? "`" + absent.join("`, `") + "`" : "(none — all occur)"}.`,
    );
    out.push("");
  }

  out.push("### 7c. What a stage-1 eligibility rule would remove — measured, not adopted");
  out.push("");
  {
    /** No IHE, no non-profit, and nothing open — the announcement admits neither a university nor a non-profit. */
    const excludesUs = (r: Notice) => {
      const t = applicantTypes(r);
      return t.length > 0 && !hasAny(t, IHE_TYPES) && !hasAny(t, NONPROFIT_TYPES) && !hasAny(t, OPEN_TYPES);
    };
    /** Not an assistance award at all — nothing to apply for as a grantee. */
    const notAssistance = (r: Notice) => {
      const i = fundingInstruments(r);
      return i.length > 0 && !hasAny(i, ASSISTANCE_INSTRUMENTS);
    };
    const a = nonNihPosted.filter(excludesUs);
    const b = nonNihPosted.filter(notAssistance);
    const either = nonNihPosted.filter((r) => excludesUs(r) || notAssistance(r));
    out.push(
      kv([
        ["posted non-NIH rows", nonNihPosted.length],
        ["admits neither an IHE, a non-profit, `unrestricted` nor `other`", `${a.length} (${pct(a.length, nonNihPosted.length)})`],
        ["no `grant` or `cooperative_agreement` instrument", `${b.length} (${pct(b.length, nonNihPosted.length)})`],
        ["**either** — the whole stage-1 candidate set", `${either.length} (${pct(either.length, nonNihPosted.length)})`],
        ["…of which the notice is also individuals-only", either.filter((r) => applicantTypes(r).includes("individuals")).length],
      ]),
    );
    out.push("");
    if (either.length > 0) {
      out.push("Every row in that set, so the reason can be checked one at a time — an eligibility fact should be legible as one:");
      out.push("");
      out.push(
        table(
          ["opportunity_number", "agency_code", "title", "applicant_types", "funding_instrument", "why"],
          either.map((r) => [
            r.opportunity_number,
            r.agency_code,
            String(r.title ?? "").slice(0, 60),
            applicantTypes(r).join(", "),
            r.funding_instrument,
            [excludesUs(r) ? "no IHE / non-profit" : null, notAssistance(r) ? "not an assistance award" : null].filter(Boolean).join(" + "),
          ]),
        ),
      );
      out.push("");
      out.push(
        table(
          ["agency_code", "rows in the stage-1 candidate set"],
          groupCount(either, (r) => String(r.agency_code ?? "∅")).map(([k, n]) => [k, n]),
        ),
      );
      out.push("");
    }
    out.push(
      "This is a count, not a recommendation. `applicant_types` is Simpler's coding of the announcement, not the " +
        "announcement — the `other` and `unrestricted` rows in particular defer to text no one has read yet — so the " +
        "rule these rows would justify has to be checked against the announcements before PR 5.6, and it belongs in " +
        "`eligibility()` where E = 0 carries a stated reason, never in `loadCandidates`.",
    );
    out.push("");
    // The instrument half of the rule is the weaker one; show why in data rather than asserting it.
    const TITLE_SHAPES: Array<[string, RegExp]> = [
      ["Notice of Intent / NOI", /\bnotice of intent\b|^noi[:\s]/i],
      ["Request for Information / RFI", /\brequest for information\b|\brfi\b/i],
      ["Broad Agency Announcement / BAA", /\bbroad agency announcement\b|\bbaa\b/i],
    ];
    const shapeOf = (r: Notice) => TITLE_SHAPES.find(([, re]) => re.test(String(r.title ?? "")))?.[0] ?? "none of these";
    out.push(
      `**The two halves are not equally trustworthy.** Of the ${b.length} rows caught by the instrument test alone, ` +
        `these are the title shapes:`,
    );
    out.push("");
    out.push(table(["title shape", "rows"], groupCount(b, shapeOf).map(([k, n]) => [k, n])));
    out.push("");
    out.push(
      "A Notice of Intent or an RFI is genuinely not something to apply for, and dropping it at stage 1 would be " +
        "right. A **Broad Agency Announcement is not**: `HT9425-23-S-SOC1` — the DHA extramural biomedical BAA, " +
        "`unrestricted` applicants, coded `procurement_contract` — is exactly the kind of notice a UCSF investigator " +
        "should see, and so is `DE-FOA-0003612` (DOE Genesis Mission, coded `other`). So `funding_instrument` alone " +
        "cannot carry a stage-1 exclusion; the applicant-type half of the rule is the sound one, and the instrument " +
        "half needs the announcement text PR 5.3 will fetch before it can be used at all.",
    );
    out.push("");
  }

  out.push("### 7d. Agency × assistance listing — descriptive context, **not a proposed filter**");
  out.push("");
  out.push(
    "Printed so a person can see what is actually in the corpus. No row here is a candidate for exclusion: the " +
      "same USDA or DOT listing that is noise for one community is a lead for another (§ 7 preamble).",
  );
  out.push("");
  {
    type Pair = { agencyCode: string; agency: string; listing: string; listingTitle: string; rows: Notice[] };
    const pairs = new Map<string, Pair>();
    for (const r of nonNihPosted) {
      const code = String(r.agency_code ?? "∅ (null)");
      const listings = assistanceListings(r);
      const entries = listings.length ? listings : [{ number: "(none)", title: "(none)" }];
      for (const l of entries) {
        const key = `${code}|${l.number}`;
        const cur = pairs.get(key) ?? { agencyCode: code, agency: r.agency ?? "—", listing: l.number, listingTitle: l.title, rows: [] };
        cur.rows.push(r);
        pairs.set(key, cur);
      }
    }
    out.push(
      table(
        ["agency_code", "assistance listing", "program title", "notices", "example titles"],
        [...pairs.values()]
          .sort((a, b) => b.rows.length - a.rows.length || a.agencyCode.localeCompare(b.agencyCode) || a.listing.localeCompare(b.listing))
          .map((p) => [
            p.agencyCode,
            p.listing,
            p.listingTitle,
            p.rows.length,
            p.rows.slice(0, 3).map((r) => `“${String(r.title ?? "").slice(0, 55)}”`).join(" · "),
          ]),
      ),
    );
    out.push("");
    out.push(`${pairs.size} distinct (agency, assistance listing) pairs across the ${nonNihPosted.length} posted non-NIH notices.`);
    out.push("");
  }

  // -------------------------------------------------------------------------
  // 8. fit_topic_idf baseline
  // -------------------------------------------------------------------------
  process.stderr.write("§ 8 fit_topic_idf…\n");
  out.push("## 8. `fit_topic_idf` today — the “before” half of D63's baseline");
  out.push("");
  {
    const { count, error: cErr } = await db.from("fit_topic_idf").select("*", { count: "exact", head: true });
    const { data: top, error: tErr } = await db
      .from("fit_topic_idf")
      .select("code, kind, df, n, idf, computed_at")
      .order("df", { ascending: false })
      .order("code", { ascending: true })
      .limit(20);
    if (cErr || tErr) {
      cannotEvaluate("Q8 · fit_topic_idf baseline", (cErr ?? tErr)!.message);
    } else {
      const rows = (top ?? []) as Array<{ code: string; kind: string; df: number; n: number; idf: number; computed_at: string }>;
      const { data: kinds } = await db.from("fit_topic_idf").select("kind");
      const kindRows = (kinds ?? []) as Array<{ kind: string }>;
      out.push(
        kv([
          ["rows", count],
          ["`n` (profiled open notices at the last refresh)", rows[0]?.n ?? "—"],
          ["last `computed_at`", rows[0]?.computed_at ?? "—"],
          ["kinds", groupCount(kindRows, (k) => k.kind).map(([k, v]) => `${k} ${v}`).join(", ")],
          ["`opportunity_fit_profiles` rows now", profileIds.size],
        ]),
      );
      out.push("");
      out.push("Twenty highest-`df` codes:");
      out.push("");
      out.push(table(["code", "kind", "df", "n", "idf"], rows.map((r) => [r.code, r.kind, r.df, r.n, Number(r.idf).toFixed(4)])));
      out.push("");
      out.push(
        "Widening the corpus raises `n` while `df` for these codes stays flat, which inflates every weight — " +
          "NON_NIH_FEASIBILITY § 7.2. The fix is the corpus-keyed table in NON_NIH_PLAN § “The NIH invariant”, property 3.",
      );
      out.push("");
    }
  }
  out.push("### 8a. Profile text sources today (the `thin_notice_profile` cap must be dead code for all of these)");
  out.push("");
  out.push(table(["sources.text", "profiles"], groupCount([...profileTextSource.values()], (t) => t).map(([k, n]) => [k, n])));
  out.push("");

  // -------------------------------------------------------------------------
  // 9. grants-gov-opportunity-api call sites
  // -------------------------------------------------------------------------
  process.stderr.write("§ 9 call sites…\n");
  out.push("## 9. Is `grants-gov-opportunity-api.ts` reusable, or dead code?");
  out.push("");
  {
    const files = SCAN_ROOTS.flatMap((r) => walk(r));
    const self = path.join("scripts", "fit-non-nih-inventory.ts");
    // This script imports the module to measure it; its own import is not a call site.
    const direct = scanImporters(files, "funding-opportunities/grants-gov-opportunity-api").filter((h) => h.file !== self);
    const directFiles = [...new Set(direct.map((h) => h.file))];
    const transitive = directFiles.flatMap((f) => {
      const spec = path.basename(f, path.extname(f));
      return scanImporters(files, `funding-opportunities/${spec}`).filter((h) => h.file !== f);
    });
    out.push(
      kv([
        ["files scanned (`src`, `scripts`, `supabase`)", files.length],
        ["direct importers (this script excluded)", directFiles.length],
        ["one-hop importers of those", [...new Set(transitive.map((h) => h.file))].length],
      ]),
    );
    out.push("");
    out.push("**Direct importers**");
    out.push("");
    out.push(table(["file", "line", "statement"], direct.map((h) => [h.file, h.line, h.text.slice(0, 90)])));
    out.push("");
    out.push("**One hop out** (who imports those files)");
    out.push("");
    out.push(table(["file", "line", "statement"], transitive.map((h) => [h.file, h.line, h.text.slice(0, 90)])));
    out.push("");
    out.push(
      directFiles.length === 0
        ? "**It is dead code**: nothing imports it. PR 5.3 may reshape it freely."
        : `**It is not dead code.** ${directFiles.length} file(s) import it, and they are reached from render paths. ` +
            "NON_NIH_FEASIBILITY § 3(3) and § 13's last bullet should be corrected: PR 5.3 must reuse it without changing " +
            "the behaviour those call sites depend on.",
    );
    out.push("");
  }

  // -------------------------------------------------------------------------
  // 0/10. Request budget and unevaluated predicates
  // -------------------------------------------------------------------------
  out.push("## 10. Request budget and unevaluated predicates");
  out.push("");
  out.push(
    table(
      ["host", "requests issued"],
      (Object.keys(HOSTS) as HostKey[]).map((k) => [HOSTS[k], requestCount[k]]),
    ),
  );
  out.push("");
  if (plannedRequests.length > 0) {
    out.push("**Request plan** (what an uncapped, non-dry run would issue):");
    out.push("");
    out.push(table(["host", "what", "requests"], plannedRequests.map((p) => [p.host, p.what, p.count])));
    out.push("");
    for (const p of plannedRequests) {
      out.push(`- \`${p.host}\` — ${p.what}`);
      for (const e of p.examples) out.push(`  - \`${e}\``);
    }
    out.push("");
  }
  if (unevaluated.length === 0) {
    out.push("All nine predicates evaluated.");
  } else {
    out.push("**Unevaluated predicates** (the script exits 2):");
    out.push("");
    out.push(table(["question", "reason"], unevaluated.map((u) => [u.question, u.reason])));
  }
  out.push("");

  return out.join("\n");
}

run(supabase)
  .then((md) => {
    if (toStdout) {
      process.stdout.write(md + "\n");
    } else {
      writeFileSync(outPath, md + "\n");
      process.stdout.write(md + "\n");
      process.stderr.write(`\nWrote ${outPath}\n`);
    }
    process.exit(unevaluated.length > 0 ? 2 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
