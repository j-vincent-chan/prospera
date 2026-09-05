/**
 * Fit engine · PR 0.5a Guide fetch diagnostics. READ-ONLY.
 *
 * Explains the Guide coverage gap (INVENTORY.md § 4: of the open notices,
 * guide_fetch_status is `ok` for 313, `not_found` for 341, never fetched for
 * 650) before PR 0.5 builds on Guide text. Three parts:
 *
 *   1. Population: every open notice by guide_fetch_status × opportunity_number
 *      prefix class, the not_found rows by agency family × Simpler status, and
 *      the never-fetched rows by whether the sync would ever target them.
 *   2. Sample: `--sample 30` not_found rows (seeded shuffle over the population
 *      sorted by opportunity_number, so a rerun with the same `--seed` and the
 *      same population reproduces the list), each with its prefix class and
 *      the URL `guideUrlFor()` derives from opportunity_number and
 *      additional_info_url.
 *   3. Fetch: `--fetch 10` of the sampled rows (round-robin across
 *      family / status / prefix strata so every stratum is exercised) are
 *      requested from grants.nih.gov — GET only, ≥ 700 ms apart, browser-like
 *      User-Agent — and classified:
 *        (i)   page exists but fails the /Key Dates|Application Due Date/i
 *              heuristic in fetchNihGuideHtml
 *        (ii)  URL pattern wrong (page missing at the derived URL for a posted
 *              NIH notice — e.g. PAS- prefixes, additional_info_url off-Guide)
 *        (iii) genuinely no Guide page (non-NIH agency, CDC placeholders, or an
 *              NIH forecast that has not been published in the Guide yet)
 *        (iv)  page exists and passes the heuristic today (transient; the
 *              weekly not_found retry heals it)
 *
 *   npm run fit:guide-diagnostics                        # population + 30-row sample, no network
 *   npm run fit:guide-diagnostics -- --sample 30 --fetch 10
 *   npm run fit:guide-diagnostics -- --url https://grants.nih.gov/grants/guide/pa-files/PAS-27-028.html
 *   npm run fit:guide-diagnostics -- --seed 7 --out /tmp/guide.md
 *
 * Nothing here writes to the database (select() only) and nothing writes to
 * the network beyond read-only GETs to *.nih.gov.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { guideUrlFor } from "../src/lib/ingestion/nih-guide/client";
import { AsyncRateLimiter } from "../src/lib/utils/async-rate-limiter";

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
function numArg(flag: string, fallback: number): number {
  const i = args.indexOf(flag);
  if (i < 0) return fallback;
  const n = Number(args[i + 1]);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`${flag} expects a non-negative number`);
    process.exit(1);
  }
  return n;
}
function strArgs(flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === flag && args[i + 1]) out.push(args[i + 1]!);
  }
  return out;
}

const sampleSize = numArg("--sample", 30);
const fetchCount = numArg("--fetch", 0);
const seed = numArg("--seed", 20260905);
const extraUrls = strArgs("--url");
const outPath = strArgs("--out")[0];

config({ path: ".env.local", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

// ---------------------------------------------------------------------------
// Types and helpers
// ---------------------------------------------------------------------------

type Notice = {
  id: string;
  opportunity_number: string | null;
  agency_code: string | null;
  status: string | null;
  forecasted: boolean | null;
  posted_date: string | null;
  guide_fetch_status: string | null;
  guide_fetched_at: string | null;
  guide_url: string | null;
  raw_payload_json: { summary?: { additional_info_url?: string | null } } | null;
};

const SELECT =
  "id, opportunity_number, agency_code, status, forecasted, posted_date, guide_fetch_status, guide_fetched_at, guide_url, raw_payload_json";

type PrefixClass = "PA" | "PAR" | "PAS" | "RFA" | "NOT" | "non-NIH";

/** Prefix classes named in the plan; anything else (NSF 26-…, FOR-…, W81XWH…) is non-NIH-Guide. */
function prefixClass(num: string | null): PrefixClass {
  const n = (num ?? "").trim().toUpperCase();
  if (/^PA-/.test(n)) return "PA";
  if (/^PAR-/.test(n)) return "PAR";
  if (/^PAS-/.test(n)) return "PAS";
  if (/^RFA-/.test(n)) return "RFA";
  if (/^NOT-/.test(n)) return "NOT";
  return "non-NIH";
}

/** The raw token before the first dash or space, for the non-NIH bucket ("FOR", "NSF", "HRSA"). */
function rawPrefix(num: string | null): string {
  const m = (num ?? "").trim().toUpperCase().match(/^([A-Z0-9]+)[-\s]/);
  return m ? m[1]! : "(none)";
}

function fiscalYear(num: string | null): string {
  return (num ?? "").match(/-(\d{2})-/)?.[1] ?? "—";
}

type Family = "NIH" | "CDC" | "other HHS" | "non-HHS";
function family(agencyCode: string | null): Family {
  const a = agencyCode ?? "";
  if (a.startsWith("HHS-NIH")) return "NIH";
  if (a.startsWith("HHS-CDC")) return "CDC";
  if (a.startsWith("HHS-")) return "other HHS";
  return "non-HHS";
}

/** Mirrors the candidate filter in nih-guide-sync.ts (agency HHS-NIH% or a PA-/PAR-/RFA- number). */
function syncWouldTarget(r: Notice): boolean {
  return String(r.agency_code ?? "").startsWith("HHS-NIH") || /^(PA|PAR|RFA)-/i.test(String(r.opportunity_number ?? ""));
}

function additionalInfoUrl(r: Notice): string | null {
  const v = r.raw_payload_json?.summary?.additional_info_url;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function simplerStatus(r: Notice): "forecast" | "posted" {
  return r.forecasted || r.status === "forecasted" ? "forecast" : "posted";
}

/** mulberry32: small seeded PRNG so the sample is reproducible. */
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

function seededSample<T>(items: T[], n: number, seedValue: number): T[] {
  const arr = [...items];
  const next = rng(seedValue);
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr.slice(0, n);
}

/** Round-robin across strata, preserving sample order within each stratum. */
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

function groupCount<T>(items: T[], keyOf: (t: T) => string): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = keyOf(it);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
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

async function fetchOpenNotices(db: SupabaseClient, today: string): Promise<Notice[]> {
  const openFilter = `close_date.gte.${today},next_due.gte.${today},expiration_date.gte.${today}`;
  const rows: Notice[] = [];
  const page = 500;
  for (let from = 0; ; from += page) {
    const { data, error } = await db
      .from("funding_opportunities")
      .select(SELECT)
      .or(openFilter)
      .order("opportunity_number", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true })
      .range(from, from + page - 1);
    if (error) throw new Error(`funding_opportunities: ${error.message}`);
    const got = (data ?? []) as Notice[];
    rows.push(...got);
    if (got.length < page) break;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Fetch and classify
// ---------------------------------------------------------------------------

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const HEURISTIC = /Key Dates|Application Due Date/i;
const SOFT_404 = /page not found|not be found|no longer available|404/i;

type Probe = {
  url: string;
  http: number | string;
  finalUrl: string | null;
  contentType: string | null;
  bytes: number;
  title: string | null;
  heuristic: boolean;
  numberInPage: boolean | null;
  softNotFound: boolean;
};

/** Only the Guide host and Simpler's file host (where post-2025 NOFO announcements live) are ever requested. */
function allowedHost(u: string): boolean {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return h === "nih.gov" || h.endsWith(".nih.gov") || h === "simpler.grants.gov" || h.endsWith(".simpler.grants.gov");
  } catch {
    return false;
  }
}

async function probe(target: string, number: string | null, timeoutMs = 20_000): Promise<Probe> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(target, {
      method: "GET",
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: controller.signal,
    });
    const html = await res.text();
    const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ?? null;
    const num = (number ?? "").trim().toUpperCase();
    return {
      url: target,
      http: res.status,
      finalUrl: res.url && res.url !== target ? res.url : null,
      contentType: res.headers.get("content-type"),
      bytes: html.length,
      title,
      heuristic: HEURISTIC.test(html),
      numberInPage: num ? html.toUpperCase().includes(num) : null,
      softNotFound: title ? SOFT_404.test(title) : false,
    };
  } catch (e) {
    return {
      url: target,
      http: e instanceof Error ? e.name : String(e),
      finalUrl: null,
      contentType: null,
      bytes: 0,
      title: null,
      heuristic: false,
      numberInPage: null,
      softNotFound: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

type FetchClass = "(i) fails heuristic" | "(ii) URL pattern" | "(iii) no Guide page" | "(iv) parses" | "error";

function classify(p: Probe, r: Notice | null): { cls: FetchClass; note: string } {
  const status = typeof p.http === "number" ? p.http : null;
  if (status === null) return { cls: "error", note: `fetch failed: ${p.http}` };
  if (status >= 500 || status === 403 || status === 429) return { cls: "error", note: `HTTP ${status}` };

  const pageExists = status === 200 && !p.softNotFound && (p.numberInPage ?? true);
  if (pageExists && p.heuristic) {
    const onSimpler = /simpler\.grants\.gov$/i.test(new URL(p.url).hostname);
    return {
      cls: "(iv) parses",
      note: onSimpler ? "Simpler-hosted announcement passes the heuristic" : "Guide page exists and passes the heuristic today (weekly retry heals it)",
    };
  }
  if (pageExists) return { cls: "(i) fails heuristic", note: "200 with the notice on the page but no Key Dates text" };

  // Missing at the derived URL. Decide whether a page could exist at all.
  const where = status === 200 ? "soft 404 (200)" : `HTTP ${status}`;
  if (!r) return { cls: "(iii) no Guide page", note: where };
  if (simplerStatus(r) === "forecast") return { cls: "(iii) no Guide page", note: `${where}; Simpler forecast, not yet in the Guide` };
  if (/-\d{2}-000$/.test(r.opportunity_number ?? "")) return { cls: "(iii) no Guide page", note: `${where}; -000 placeholder number` };
  if (family(r.agency_code) !== "NIH" && family(r.agency_code) !== "CDC") return { cls: "(iii) no Guide page", note: `${where}; ${family(r.agency_code)} agency` };
  return { cls: "(ii) URL pattern", note: `${where} for a posted ${family(r.agency_code)} notice` };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

async function run(db: SupabaseClient): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const out: string[] = [];
  out.push("# Guide fetch diagnostics (PR 0.5a)");
  out.push("");
  out.push(
    `Generated ${new Date().toISOString()} by \`npm run fit:guide-diagnostics\` (seed ${seed}, sample ${sampleSize}, fetch ${fetchCount}). ` +
      `Read-only. "Open" notices = close_date, next_due or expiration_date on/after ${today}.`,
  );
  out.push("");

  const open = await fetchOpenNotices(db, today);
  const notFound = open.filter((r) => r.guide_fetch_status === "not_found");
  const never = open.filter((r) => !r.guide_fetch_status);
  const ok = open.filter((r) => r.guide_fetch_status === "ok");

  // 1. Population -----------------------------------------------------------
  out.push("## 1. Population (open notices)");
  out.push("");
  out.push(table(["guide_fetch_status", "count"], [["ok", ok.length], ["not_found", notFound.length], ["never fetched", never.length], ["error", open.length - ok.length - notFound.length - never.length], ["total", open.length]]));
  out.push("");
  out.push("### 1a. Status × opportunity_number prefix class");
  out.push("");
  out.push(
    table(
      ["status", "prefix class", "count"],
      groupCount(open, (r) => `${r.guide_fetch_status ?? "never"}|${prefixClass(r.opportunity_number)}`).map(([k, n]) => [...k.split("|"), n]),
    ),
  );
  out.push("");
  out.push("### 1b. not_found × agency family × Simpler status × fiscal year in the number");
  out.push("");
  out.push(
    table(
      ["family", "Simpler status", "FY", "count"],
      groupCount(notFound, (r) => `${family(r.agency_code)}|${simplerStatus(r)}|${fiscalYear(r.opportunity_number)}`).map(([k, n]) => [...k.split("|"), n]),
    ),
  );
  out.push("");
  out.push("### 1c. not_found · additional_info_url present?");
  out.push("");
  out.push(table(["additional_info_url", "count"], groupCount(notFound, (r) => (additionalInfoUrl(r) ? "present" : "null / empty")).map(([k, n]) => [k, n])));
  out.push("");
  out.push("### 1d. ok × fiscal year in the number (for contrast)");
  out.push("");
  out.push(table(["FY", "count"], groupCount(ok, (r) => fiscalYear(r.opportunity_number)).map(([k, n]) => [k, n])));
  out.push("");
  out.push("### 1e. never fetched · would the sync target it, and would guideUrlFor() give a URL?");
  out.push("");
  out.push(
    table(
      ["sync candidate", "guideUrlFor()", "family", "Simpler status", "count"],
      groupCount(never, (r) => `${syncWouldTarget(r) ? "yes" : "no"}|${guideUrlFor(r.opportunity_number ?? "", additionalInfoUrl(r)) ? "url" : "null"}|${family(r.agency_code)}|${simplerStatus(r)}`).map(([k, n]) => [...k.split("|"), n]),
    ),
  );
  out.push("");
  const neverNih = never.filter((r) => syncWouldTarget(r) || prefixClass(r.opportunity_number) !== "non-NIH");
  out.push(`Never-fetched rows the sync targets or that carry a Guide-style number (${neverNih.length}):`);
  out.push("");
  out.push(
    table(
      ["opportunity_number", "agency_code", "Simpler status", "posted", "guideUrlFor()"],
      neverNih.map((r) => [r.opportunity_number, r.agency_code, simplerStatus(r), r.posted_date, guideUrlFor(r.opportunity_number ?? "", additionalInfoUrl(r)) ?? "null"]),
    ),
  );
  out.push("");
  out.push("Never-fetched rows by raw number prefix (top 15):");
  out.push("");
  out.push(table(["raw prefix", "count"], groupCount(never, (r) => rawPrefix(r.opportunity_number)).slice(0, 15).map(([k, n]) => [k, n])));
  out.push("");

  // 2. Sample ---------------------------------------------------------------
  const sample = seededSample(notFound, sampleSize, seed);
  out.push(`## 2. Sample of ${sample.length} not_found notices (seed ${seed})`);
  out.push("");
  out.push(
    table(
      ["#", "opportunity_number", "prefix", "agency_code", "Simpler status", "posted", "FY", "additional_info_url", "guideUrlFor()", "stored guide_url", "last fetched"],
      sample.map((r, i) => {
        const derived = guideUrlFor(r.opportunity_number ?? "", additionalInfoUrl(r));
        return [
          i + 1,
          r.opportunity_number,
          prefixClass(r.opportunity_number),
          r.agency_code,
          simplerStatus(r),
          r.posted_date,
          fiscalYear(r.opportunity_number),
          additionalInfoUrl(r) ?? "null",
          derived ?? "null",
          derived && r.guide_url === derived ? "same" : r.guide_url ?? "—",
          (r.guide_fetched_at ?? "").slice(0, 10) || "—",
        ];
      }),
    ),
  );
  out.push("");
  out.push("Sample by prefix class:");
  out.push("");
  out.push(table(["prefix class", "count"], groupCount(sample, (r) => prefixClass(r.opportunity_number)).map(([k, n]) => [k, n])));
  out.push("");

  // 3. Fetch ----------------------------------------------------------------
  const toFetch = roundRobin(sample, (r) => `${family(r.agency_code)}/${simplerStatus(r)}/${prefixClass(r.opportunity_number)}`, fetchCount);
  const targets: Array<{ r: Notice | null; url: string; label: string }> = [];
  for (const r of toFetch) {
    const derived = guideUrlFor(r.opportunity_number ?? "", additionalInfoUrl(r));
    if (derived) targets.push({ r, url: derived, label: r.opportunity_number ?? "—" });
  }
  // A hand-checked URL classifies with its notice's context when the number is in the open corpus.
  for (const u of extraUrls) {
    const num = u.match(/((?:PA|PAR|PAS|RFA|NOT)-(?:[A-Z]{2}-)?\d{2}-\d{3})/i)?.[1]?.toUpperCase() ?? null;
    const r = num ? open.find((row) => (row.opportunity_number ?? "").toUpperCase() === num) ?? null : null;
    targets.push({ r, url: u, label: `(--url) ${num ?? ""}`.trim() });
  }

  if (targets.length > 0) {
    out.push(`## 3. Fetched ${targets.length} URLs (GET, ≥ 700 ms apart)`);
    out.push("");
    const limiter = new AsyncRateLimiter(700);
    const rows: unknown[][] = [];
    const tally = new Map<string, number>();
    for (const [i, t] of targets.entries()) {
      if (!allowedHost(t.url)) {
        rows.push([i + 1, t.label, t.url, "skipped", "—", "—", "—", "—", "not a nih.gov host", "—"]);
        continue;
      }
      const number = t.r?.opportunity_number ?? t.url.match(/((?:PA|PAR|PAS|RFA|NOT)-[A-Z]{0,2}-?\d{2}-\d{3})/i)?.[1] ?? null;
      const p = await limiter.schedule(() => probe(t.url, number));
      const { cls, note } = classify(p, t.r);
      tally.set(cls, (tally.get(cls) ?? 0) + 1);
      rows.push([
        i + 1,
        t.label,
        t.url,
        p.http,
        p.finalUrl ?? "(none)",
        p.title ? p.title.slice(0, 90) : "—",
        p.heuristic,
        p.numberInPage,
        cls,
        note,
      ]);
      process.stderr.write(`  ${i + 1}/${targets.length} ${t.label} → ${p.http} ${cls}\n`);
    }
    out.push(table(["#", "notice", "URL", "HTTP", "redirected to", "title", "heuristic", "number on page", "class", "note"], rows));
    out.push("");
    out.push("Class tally:");
    out.push("");
    out.push(table(["class", "count"], [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, n])));
    out.push("");
  } else {
    out.push("## 3. Fetch");
    out.push("");
    out.push("_(no network: pass `--fetch N` and/or `--url <grants.nih.gov URL>`)_");
    out.push("");
  }

  return out.join("\n");
}

run(supabase)
  .then((md) => {
    process.stdout.write(md + "\n");
    if (outPath) {
      writeFileSync(outPath, md + "\n");
      process.stderr.write(`Wrote ${outPath}\n`);
    }
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
