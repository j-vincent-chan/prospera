/**
 * Non-NIH announcement backfill (PR 5.3).
 *
 * Reads the full announcement for posted, open, non-NIH notices through the
 * Grants.gov attachment adapter and stores the sectioned text the profile
 * builder reads. The NIH corpus is untouched: `--family nih` is refused and
 * `NIH_LIKE` rows are excluded from every query, so nothing this script does
 * can move an NIH notice's `guide_sections`.
 *
 *   npm run fit:backfill-announcements -- --dry-run --limit 40
 *   npm run fit:backfill-announcements -- --dry-run --family dod_cdmrp --limit 20
 *   npm run fit:backfill-announcements -- --dry-run --only CDC-RFA-JG-26-0043,HRSA-27-099
 *   npm run fit:backfill-announcements -- --write --limit 200 --cursor <uuid>
 *
 * Flags
 *   --family F[,F]   restrict to funder families (registry.ts): hhs_other, nsf,
 *                    dod_cdmrp, doe, other_federal. `nih` is refused.
 *   --limit N        notices to process this run (default 40).
 *   --only NUM,…     only these opportunity numbers (ignores --family/--cursor).
 *   --cursor ID      resume: start after this funding_opportunities.id.
 *                    Rows are ordered by id ascending, so the last id printed by
 *                    the previous run is the cursor for the next one.
 *   --dry-run        resolve, fetch, parse and print; write nothing (default).
 *   --write          persist guide_sections and the announcement columns.
 *   --interval MS    per-host minimum gap (default 700; the floor is 700).
 *
 * Idempotent and resumable: every write is a single `update` keyed by id, and
 * re-running over the same rows recomputes the same sections. Nothing is
 * deleted, and a row that fails keeps whatever it had.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AsyncRateLimiter } from "../src/lib/utils/async-rate-limiter";
import { createSimplerGrantsClient } from "../src/lib/ingestion/simpler-grants/client";
import { funderFamilyOf, type FunderFamily } from "../src/lib/ingestion/announcement/registry";
import {
  GRANTS_GOV_ATTACHMENT_ADAPTER_ID,
  acquireGrantsGovAttachment,
  appliesToGrantsGovAttachment,
  type GrantsGovExtra,
  type GrantsGovRow,
} from "../src/lib/ingestion/announcement/adapters/grants-gov-attachment";

config({ path: ".env.local", quiet: true });

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string): string | null => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1]! : null;
};
const list = (name: string): string[] =>
  (opt(name) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const WRITE = flag("--write");
const DRY_RUN = !WRITE;
const LIMIT = Number(opt("--limit") ?? 40);
const CURSOR = opt("--cursor");
/** Verbatim: `opportunity_number` is stored as the funder writes it and `.in()` is case-sensitive. */
const ONLY = list("--only");
const FAMILIES = list("--family") as FunderFamily[];
const INTERVAL = Math.max(700, Number(opt("--interval") ?? 700));
const OBJECTIVES_PREVIEW = 400;

const KNOWN_FAMILIES: FunderFamily[] = ["nih", "hhs_other", "nsf", "dod_cdmrp", "doe", "other_federal", "foundation", "internal"];

function die(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

if (!Number.isFinite(LIMIT) || LIMIT <= 0) die("--limit expects a positive number");
if (flag("--dry-run") && WRITE) die("--dry-run and --write are mutually exclusive");
for (const f of FAMILIES) {
  if (!KNOWN_FAMILIES.includes(f)) die(`--family expects one of ${KNOWN_FAMILIES.join(" | ")}, got ${f}`);
  // The NIH invariant: this script may never touch an NIH notice. The Guide
  // sync owns those, and re-sectioning one here would change guide_sections and
  // re-key every cached extraction.
  if (f === "nih") die("--family nih is refused: NIH notices are owned by npm run backfill-nih-guide (see NON_NIH_PLAN.md § The NIH invariant)", 2);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) die("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
const supabase: SupabaseClient = createClient(url!, key!, { auth: { persistSession: false } });

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

/**
 * The TypeScript mirror of `NIH_NOTICE_FILTER` (`profile/opportunity.ts:132`),
 * copied from `scripts/fit-non-nih-inventory.ts:300`, which asserted it agrees
 * with PostgREST's version on the live table. Excluding NIH rows in JS rather
 * than in the query is deliberate: a negated `.or()` in PostgREST is NULL for a
 * row with a null `agency_code`, which would silently drop real non-NIH rows.
 */
function isNihLike(r: { agency_code?: string | null; opportunity_number?: string | null }): boolean {
  const n = String(r.opportunity_number ?? "");
  return (
    String(r.agency_code ?? "").startsWith("HHS-NIH") ||
    n.startsWith("PA-") ||
    n.startsWith("PAR-") ||
    n.startsWith("RFA-") ||
    /^PAS-.{2}-.{3}$/.test(n)
  );
}

const SELECT =
  "id, opportunity_number, title, agency, agency_code, source_system, forecasted, source_opportunity_id, guide_url, guide_fetch_status, guide_fetched_at, announcement_kind, announcement_text_hash, raw_payload_json";

type Row = GrantsGovRow & {
  title: string | null;
  agency_code: string | null;
  guide_fetch_status: string | null;
  announcement_kind?: string | null;
  announcement_text_hash?: string | null;
};

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

async function loadCandidates(): Promise<Row[]> {
  const out: Row[] = [];
  const page = 1000;
  const today = isoToday();
  for (let from = 0; ; from += page) {
    let query = supabase.from("funding_opportunities").select(SELECT).order("id", { ascending: true }).range(from, from + page - 1);
    if (ONLY.length) {
      query = query.in("opportunity_number", ONLY);
    } else {
      query = query.eq("forecasted", false).or(`close_date.gte.${today},next_due.gte.${today},expiration_date.gte.${today}`);
      if (CURSOR) query = query.gt("id", CURSOR);
    }
    const { data, error } = await query;
    if (error) die(`funding_opportunities read failed: ${error.message}`, 2);
    const rows = (data ?? []) as unknown as Row[];
    // Unconditionally, including under --only. funderFamilyOf() is a "where does
    // the text live" router, not the NIH-corpus test: it puts CDC, FDA, AHRQ and
    // OPHS RFA-/PA- rows in `hhs_other`, but NIH_NOTICE_FILTER counts every
    // RFA-/PA-/PAR- number as NIH and the Guide sync owns them. 51 open rows are
    // in that gap and 13 already carry Guide-parsed guide_sections, so an --only
    // run could have rewritten an NIH notice's sections and re-keyed its cached
    // extraction — exactly what NON_NIH_PLAN.md § The NIH invariant forbids.
    const nih = rows.filter(isNihLike);
    if (ONLY.length && nih.length) {
      console.error(`  refused ${nih.length} NIH-corpus row(s) named by --only (owned by npm run backfill-nih-guide): ${nih.map((r) => r.opportunity_number).join(", ")}`);
    }
    out.push(...rows.filter((r) => !isNihLike(r)));
    if (rows.length < page) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Schema probe — writes refuse until the PR 5.2 migration is applied
// ---------------------------------------------------------------------------

async function migrationApplied(): Promise<boolean> {
  for (const c of ["announcement_kind", "announcement_text_hash", "guide_sections", "guide_source"]) {
    const { error } = await supabase.from("funding_opportunities").select(c).limit(1);
    if (error) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

type Outcome = {
  row: Row;
  family: FunderFamily;
  status: "ok" | "not_applicable" | "not_found" | "error" | "skipped";
  url: string | null;
  source: string | null;
  pageFetches: number;
  simplerCalls: number;
  extra: GrantsGovExtra | null;
  error: string | null;
  sections: number;
};

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function preview(text: string | null, n: number): string {
  if (!text) return "—";
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= n ? flat : `${flat.slice(0, n)}…`;
}

function printOutcome(o: Outcome): void {
  const e = o.extra;
  console.log(
    [
      pad(o.row.opportunity_number ?? "(none)", 26),
      pad(o.row.agency_code ?? "—", 18),
      pad(o.family, 14),
      pad(o.status, 10),
      pad(`resolved=${e?.routesUsed.join("+") || "—"}`, 26),
      pad(`files=${e?.candidates ?? 0}/${e?.considered.length ?? 0}`, 12),
      pad(`get=${o.pageFetches} api=${o.simplerCalls}`, 12),
      pad(`table=${e?.table ?? "—"}`, 22),
      pad(`sections=${o.sections}`, 12),
      `roles=[${e?.roles.join(",") ?? ""}]`,
    ].join(" | "),
  );
  if (e?.chosen) console.log(`    file: ${e.chosen.fileName}  (${e.chosen.route}, ${e.chosen.mimeType ?? "?"}, ${e.chosen.bytes ?? "?"} bytes, folder=${e.chosen.folderType ?? "—"})`);
  if (e?.objectives) console.log(`    objectives: ${preview(e.objectives, OBJECTIVES_PREVIEW)}`);
  if (o.error) console.log(`    error: ${o.error}`);
}

async function main(): Promise<void> {
  const applied = await migrationApplied();
  if (WRITE && !applied) {
    die("supabase/migrations/20260923100000_fit_announcement_sources.sql is not applied (column probe failed). Apply it first; --dry-run works without it.", 2);
  }

  const all = await loadCandidates();
  const eligible = all
    .map((row) => ({ row, family: funderFamilyOf(row) }))
    .filter(({ family }) => family !== "nih")
    .filter(({ family }) => (FAMILIES.length ? FAMILIES.includes(family) : true))
    .filter(({ row }) => appliesToGrantsGovAttachment(row));

  console.error(
    `${DRY_RUN ? "DRY RUN — resolving, fetching and parsing; nothing will be written" : "WRITING"}: ` +
      `${all.length} candidate rows scanned, ${eligible.length} the adapter applies to, processing ${Math.min(LIMIT, eligible.length)}` +
      `${FAMILIES.length ? `, families [${FAMILIES.join(", ")}]` : ""}${CURSOR ? `, after cursor ${CURSOR}` : ""}${ONLY.length ? `, numbers [${ONLY.join(", ")}]` : ""}` +
      `, ${INTERVAL} ms per host\n`,
  );

  const limiters = new Map<string, AsyncRateLimiter>();
  const limiterFor = (host: string): AsyncRateLimiter => {
    const k = host || "(unknown)";
    let l = limiters.get(k);
    if (!l) {
      l = new AsyncRateLimiter(INTERVAL);
      limiters.set(k, l);
    }
    return l;
  };
  const simplerLimiter = new AsyncRateLimiter(Math.max(550, INTERVAL));
  const simpler = createSimplerGrantsClient();

  const outcomes: Outcome[] = [];
  let lastId: string | null = null;

  for (const { row, family } of eligible.slice(0, LIMIT)) {
    lastId = row.id;
    const acq = await acquireGrantsGovAttachment(row, { limiterFor, simplerLimiter, simpler });
    const extra = (acq.extra ?? null) as GrantsGovExtra | null;
    const outcome: Outcome = {
      row,
      family,
      status: acq.status === "unchanged" ? "ok" : acq.status,
      url: acq.url,
      source: acq.source,
      pageFetches: acq.pageFetches,
      simplerCalls: acq.simplerCalls,
      extra,
      error: acq.status === "ok" || acq.status === "unchanged" ? null : acq.error,
      sections: acq.status === "ok" ? acq.sections.length : 0,
    };
    outcomes.push(outcome);
    printOutcome(outcome);

    if (DRY_RUN || acq.status !== "ok") continue;
    const { error } = await supabase
      .from("funding_opportunities")
      .update({
        guide_sections: acq.sections,
        guide_source: acq.source,
        guide_url: acq.url,
        guide_fetched_at: new Date().toISOString(),
        guide_fetch_status: "ok",
        announcement_kind: GRANTS_GOV_ATTACHMENT_ADAPTER_ID,
        announcement_text_hash: acq.textHash,
      })
      .eq("id", row.id);
    if (error) console.error(`  write failed for ${row.opportunity_number}: ${error.message}\n  resume with --cursor ${lastId}`);
  }

  // A failed row is stamped, never written with partial sections: guide_sections
  // is left alone so the profile builder falls through to the synopsis.
  // A failed row is stamped with the status the adapter actually reached, never
  // collapsed to `error`: `not_applicable` (no announcement exists on any
  // route) is a structural fact and must not sit in a retry cadence or inflate
  // the data-sources page's failure count, which is why
  // 20260914100000_fit_guide_sections.sql added that value. `guide_url` is only
  // written when the adapter reached one — nulling it would clear whatever the
  // row already had.
  if (WRITE) {
    for (const o of outcomes.filter((x) => x.status === "error" || x.status === "not_found" || x.status === "not_applicable")) {
      await supabase
        .from("funding_opportunities")
        .update({
          guide_fetch_status: o.status,
          guide_fetched_at: new Date().toISOString(),
          ...(o.url ? { guide_url: o.url } : {}),
        })
        .eq("id", o.row.id);
    }
  }

  report(outcomes, lastId);
  process.exit(0);
}

function report(outcomes: Outcome[], lastId: string | null): void {
  const byStatus = new Map<string, number>();
  for (const o of outcomes) byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);
  const withObjectives = outcomes.filter((o) => o.extra?.objectives);
  // The acceptance bar's denominator: rows that carry at least one acceptable
  // attachment, which is the population `NON_NIH_INVENTORY.md` § 2a measured
  // (65.1 % of posted non-NIH rows). Rows with no attachment at all — NSF's 90,
  // DOJ's 31, NASA's 11 — are counted separately: they are PR 5.4's problem or
  // the synopsis fallback's, not this adapter's.
  const withAttachment = outcomes.filter((o) => (o.extra?.considered.length ?? 0) > 0);
  const withAttachmentObj = withAttachment.filter((o) => o.extra?.objectives);
  const readable = outcomes.filter((o) => (o.extra?.targets ?? 0) > 0);
  const readableObj = readable.filter((o) => o.extra?.objectives);
  const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(1) : "0.0");

  console.error(`\n--- summary ---`);
  console.error(`processed ${outcomes.length}: ${[...byStatus].map(([k, n]) => `${k}=${n}`).join(", ")}`);
  console.error(`requests: ${outcomes.reduce((n, o) => n + o.pageFetches, 0)} document GETs, ${outcomes.reduce((n, o) => n + o.simplerCalls, 0)} Simpler API calls`);
  console.error(`objectives recovered:`);
  console.error(`  ${withAttachmentObj.length}/${withAttachment.length} (${pct(withAttachmentObj.length, withAttachment.length)} %) of rows with ≥ 1 acceptable attachment  ← the acceptance bar (≥ 70 %)`);
  console.error(`  ${readableObj.length}/${readable.length} (${pct(readableObj.length, readable.length)} %) of rows with any readable target (attachment or package instructions)`);
  console.error(`  ${withObjectives.length}/${outcomes.length} (${pct(withObjectives.length, outcomes.length)} %) of every row processed, including those with no attachment at all`);

  const perAgency = new Map<string, { n: number; obj: number }>();
  for (const o of outcomes) {
    const k = o.row.agency_code ?? "—";
    const e = perAgency.get(k) ?? { n: 0, obj: 0 };
    e.n += 1;
    if (o.extra?.objectives) e.obj += 1;
    perAgency.set(k, e);
  }
  console.error(`\nby agency_code (rows · objectives):`);
  for (const [k, v] of [...perAgency].sort((a, b) => b[1].n - a[1].n)) console.error(`  ${pad(k, 22)} ${v.n} · ${v.obj}`);

  const perTable = new Map<string, number>();
  for (const o of outcomes) perTable.set(o.extra?.table ?? "(none)", (perTable.get(o.extra?.table ?? "(none)") ?? 0) + 1);
  console.error(`\nheading table chosen: ${[...perTable].map(([k, n]) => `${k}=${n}`).join(", ")}`);

  const perRoute = new Map<string, number>();
  for (const o of outcomes) perRoute.set(o.extra?.chosen?.route ?? "(none)", (perRoute.get(o.extra?.chosen?.route ?? "(none)") ?? 0) + 1);
  console.error(`chosen file's route: ${[...perRoute].map(([k, n]) => `${k}=${n}`).join(", ")}`);

  const failures = outcomes.filter((o) => o.status !== "ok");
  if (failures.length) {
    console.error(`\nfailures (${failures.length}) — each stamps guide_fetch_status='error' and falls through to the synopsis:`);
    for (const f of failures) console.error(`  ${pad(f.row.opportunity_number ?? "?", 26)} ${pad(f.row.agency_code ?? "—", 18)} ${f.error ?? ""}`);
  }
  if (lastId) console.error(`\nresume with: --cursor ${lastId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
