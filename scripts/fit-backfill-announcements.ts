/**
 * Non-NIH announcement backfill (PR 5.3; NSF added in PR 5.4, CDMRP in PR 5.5).
 *
 * Reads the full announcement for posted, open, non-NIH notices and stores the
 * sectioned text the profile builder reads. The NIH corpus is untouched:
 * `--family nih` is refused and `NIH_LIKE` rows are excluded from every query,
 * so nothing this script does can move an NIH notice's `guide_sections`.
 *
 * One adapter is chosen per row, by funder family (`registry.ts`):
 *
 *   nsf        → `adapters/nsf-solicitation.ts`, which follows the row's stored
 *                `additional_info_url` to the HTML solicitation on `www.nsf.gov`.
 *   dod_cdmrp  → `adapters/cdmrp-pa.ts`, the derivable `cdmrp.health.mil`
 *                `_GG.pdf` first and PR 5.3's Grants.gov mirror as the fallback.
 *   *          → `adapters/grants-gov-attachment.ts`, the attachment route.
 *
 * NSF gets its own adapter because it attaches nothing to Grants.gov: the
 * Grants.gov route reports every one of its 91 open rows `not_applicable`.
 * CDMRP gets one because the mirror it does attach is a second-hand copy — the
 * PA on the funder's own host is the document of record.
 *
 *   npm run fit:backfill-announcements -- --dry-run --limit 40
 *   npm run fit:backfill-announcements -- --dry-run --family nsf --limit 91
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
 *   --interval MS    per-host minimum gap (default 700; the floor is 700, and
 *                    1000 for cdmrp.health.mil).
 *   --no-program-page  NSF only: skip the one extra GET that reads the program
 *                    element codes off the program page. Costs the codes.
 *   --fon-report     CDMRP only: decompose every candidate opportunity number
 *                    and print the program / mechanism tables, then exit.
 *                    Sends no funder traffic. It is not request-free: it still
 *                    reads the candidate rows from Supabase (~5 calls, the same
 *                    ones every run makes), but it reaches no funder host and
 *                    fetches no document.
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
import {
  NSF_SOLICITATION_ADAPTER_ID,
  acquireNsfSolicitation,
  appliesToNsfSolicitation,
  type NsfExtra,
  type NsfRow,
} from "../src/lib/ingestion/announcement/adapters/nsf-solicitation";
import {
  CDMRP_HOST,
  CDMRP_MIN_INTERVAL_MS,
  CDMRP_PA_ADAPTER_ID,
  CDMRP_PROGRAM_NAMES,
  acquireCdmrpPa,
  appliesToCdmrpPa,
  decomposeCdmrpFon,
  type CdmrpExtra,
  type CdmrpRow,
} from "../src/lib/ingestion/announcement/adapters/cdmrp-pa";

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
// `Number("abc")` is NaN and `NaN > 0` is false, so an unparsable --interval
// silently turned rate limiting OFF — the opposite of what the flag is for, on
// runs that hit a federal host ~144 times. --limit already guards this way.
const INTERVAL_RAW = Number(opt("--interval") ?? 700);
const INTERVAL = Math.max(700, Number.isFinite(INTERVAL_RAW) ? INTERVAL_RAW : 700);
/**
 * The NSF program-page hop is what lifts element-code recovery from 8 % to
 * 95 %, but nothing persists the codes yet — `--write` stores only the sections
 * and the hashes, so on a write run those ~69 extra GETs at a federal host are
 * spent and discarded. Until PR 5.7 has a column to put them in, `--write`
 * implies `--no-program-page`; the dry run, which is where the codes are
 * actually read, keeps them.
 */
const PROGRAM_PAGE = !flag("--no-program-page") && !flag("--write");
/** PR 5.5: decompose the CDMRP numbers and stop. Reads the table, reaches no funder. */
const FON_REPORT = flag("--fon-report");
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

type Row = GrantsGovRow &
  NsfRow & {
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

/**
 * Which adapter owns a row. `funderFamilyOf` is the router; this is the one
 * place the script turns a family into code, so adding an adapter is one line
 * here, one in `adapterApplies` and one in the `acquire` switch.
 */
type AdapterId = typeof GRANTS_GOV_ATTACHMENT_ADAPTER_ID | typeof NSF_SOLICITATION_ADAPTER_ID | typeof CDMRP_PA_ADAPTER_ID;

function adapterForFamily(family: FunderFamily): AdapterId {
  if (family === "nsf") return NSF_SOLICITATION_ADAPTER_ID;
  if (family === "dod_cdmrp") return CDMRP_PA_ADAPTER_ID;
  return GRANTS_GOV_ATTACHMENT_ADAPTER_ID;
}

function adapterApplies(adapter: AdapterId, row: Row): boolean {
  if (adapter === NSF_SOLICITATION_ADAPTER_ID) return appliesToNsfSolicitation(row);
  if (adapter === CDMRP_PA_ADAPTER_ID) return appliesToCdmrpPa(row);
  return appliesToGrantsGovAttachment(row);
}

/**
 * Every adapter's `extra`. The three shapes are disjoint by construction and
 * each guard names a field only its own shape has: `NsfExtra.kind` (CDMRP's
 * `kind` is nested inside `fon`, not top-level) and `CdmrpExtra.fon`.
 */
type AnyExtra = GrantsGovExtra | NsfExtra | CdmrpExtra;

function isNsfExtra(e: AnyExtra | null): e is NsfExtra {
  return e != null && "kind" in e;
}

function isCdmrpExtra(e: AnyExtra | null): e is CdmrpExtra {
  return e != null && "fon" in e;
}

/**
 * The Grants.gov half of an outcome: the extra itself for a Grants.gov row, the
 * mirror a CDMRP row fell through to, and null for NSF — which never reads an
 * attachment, so every attachment-shaped statistic must skip it.
 */
function attachmentExtra(e: AnyExtra | null): GrantsGovExtra | null {
  if (e == null || isNsfExtra(e)) return null;
  return isCdmrpExtra(e) ? e.mirror : e;
}

/** The fields the shared printer and summary read, from any adapter's extra. */
type CommonExtra = { resolved: string; files: string; table: string | null; roles: string[]; objectives: string | null };

function commonExtra(e: AnyExtra | null): CommonExtra {
  if (!e) return { resolved: "—", files: "files=0/0", table: null, roles: [], objectives: null };
  const common = { table: e.table, roles: e.roles, objectives: e.objectives };
  if (isNsfExtra(e)) return { resolved: `route=${e.route ?? "—"}`, files: `kind=${e.kind}`, ...common };
  if (isCdmrpExtra(e)) {
    const mirror = e.mirror ? `mirror:${e.mirror.routesUsed.join("+") || "none"}` : null;
    return {
      resolved: `resolved=${[`direct:${e.direct}`, mirror].filter(Boolean).join(" ")}`,
      files: `files=${e.mirror?.candidates ?? 0}/${e.mirror?.considered.length ?? 0}`,
      ...common,
    };
  }
  return { resolved: `resolved=${e.routesUsed.join("+") || "—"}`, files: `files=${e.candidates}/${e.considered.length}`, ...common };
}

type Outcome = {
  row: Row;
  family: FunderFamily;
  /** The adapter id that produced this outcome — what `announcement_kind` stores. */
  adapter: AdapterId;
  status: "ok" | "not_applicable" | "not_found" | "error" | "skipped";
  url: string | null;
  source: string | null;
  pageFetches: number;
  simplerCalls: number;
  extra: AnyExtra | null;
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
  const nsf = isNsfExtra(e) ? e : null;
  const c = commonExtra(e);
  console.log(
    [
      pad(o.row.opportunity_number ?? "(none)", 26),
      pad(o.row.agency_code ?? "—", 18),
      pad(o.family, 14),
      pad(o.status, 10),
      // 30, not PR 5.4's 26: a CDMRP row prints both routes it tried.
      pad(c.resolved, 30),
      pad(c.files, 22),
      pad(`get=${o.pageFetches} api=${o.simplerCalls}`, 12),
      pad(`table=${c.table ?? "—"}`, 22),
      pad(`sections=${o.sections}`, 12),
      `roles=[${c.roles.join(",")}]`,
    ].join(" | "),
  );
  if (isCdmrpExtra(e)) {
    const f = e.fon;
    console.log(
      `    fon: office=${f.office ?? "—"} fy=${f.fy ?? "—"} program=${f.program ?? "(none)"} mechanism=${f.mechanism ?? "(none)"}` +
        `${f.mechanismVariant ? ` (base=${f.mechanismBase} var=${f.mechanismVariant})` : ""} kind=${f.kind}${f.programName ? ` · ${f.programName}` : ""}`,
    );
    if (e.directUrl) console.log(`    direct: ${e.direct} ${e.directUrl}`);
    if (e.cover?.awardName) console.log(`    cover: ${e.cover.programName ?? "?"} · ${e.cover.awardName}`);
    if (e.fonMismatch) console.log(`    !! cover page names ${e.fonMismatch}, not ${f.fon} — document refused`);
  }
  const att = attachmentExtra(e);
  if (att?.chosen) console.log(`    file: ${att.chosen.fileName}  (${att.chosen.route}, ${att.chosen.mimeType ?? "?"}, ${att.chosen.bytes ?? "?"} bytes, folder=${att.chosen.folderType ?? "—"})`);
  if (nsf?.finalUrl) console.log(`    final url: ${nsf.finalUrl}`);
  if (nsf && (nsf.programElementCodes.length || nsf.replaces.length)) {
    console.log(`    codes: [${nsf.programElementCodes.join(",") || "—"}] refs=[${nsf.programReferenceCodes.join(",") || "—"}] via ${nsf.codeSource ?? "—"}   replaces: [${nsf.replaces.join(",") || "—"}]`);
  }
  if (c.objectives) console.log(`    objectives: ${preview(c.objectives, OBJECTIVES_PREVIEW)}`);
  if (o.error) console.log(`    error: ${o.error}`);
}

async function main(): Promise<void> {
  const applied = await migrationApplied();
  if (WRITE && !applied) {
    die("supabase/migrations/20260923100000_fit_announcement_sources.sql is not applied (column probe failed). Apply it first; --dry-run works without it.", 2);
  }

  const all = await loadCandidates();
  const eligible = all
    .map((row) => ({ row, family: funderFamilyOf(row), adapter: adapterForFamily(funderFamilyOf(row)) }))
    .filter(({ family }) => family !== "nih")
    .filter(({ family }) => (FAMILIES.length ? FAMILIES.includes(family) : true))
    .filter(({ row, adapter }) => adapterApplies(adapter, row));

  // PR 5.5: the decomposition alone, over every candidate, with no funder traffic.
  if (FON_REPORT) {
    const cdmrp = eligible.filter(({ family }) => family === "dod_cdmrp");
    console.error(`FON REPORT — ${cdmrp.length} CDMRP / DHA rows; the rows are already read, no funder host will be reached\n`);
    console.log(["opportunity_number", "office", "FY", "program", "mechanism", "base", "level", "kind", "programName"].join("\t"));
    for (const { row } of cdmrp) {
      const f = decomposeCdmrpFon(row.opportunity_number);
      console.log([f.fon, f.office ?? "—", f.fy ?? "—", f.program ?? "(none)", f.mechanism ?? "(none)", f.mechanismBase ?? "—", f.mechanismVariant ?? "—", f.kind, f.programName ?? "—"].join("\t"));
    }
    reportCdmrp(
      cdmrp.map(
        ({ row, family, adapter }) =>
          ({ row, family, adapter, status: "skipped", url: null, source: null, pageFetches: 0, simplerCalls: 0, extra: null, error: null, sections: 0 }) satisfies Outcome,
      ),
      { measured: false },
    );
    process.exit(0);
  }

  console.error(
    `${DRY_RUN ? "DRY RUN — resolving, fetching and parsing; nothing will be written" : "WRITING"}: ` +
      `${all.length} candidate rows scanned, ${eligible.length} the adapter applies to, processing ${Math.min(LIMIT, eligible.length)}` +
      `${FAMILIES.length ? `, families [${FAMILIES.join(", ")}]` : ""}${CURSOR ? `, after cursor ${CURSOR}` : ""}${ONLY.length ? `, numbers [${ONLY.join(", ")}]` : ""}` +
      `, ${INTERVAL} ms per host (${Math.max(INTERVAL, CDMRP_MIN_INTERVAL_MS)} ms for ${CDMRP_HOST})\n`,
  );

  const limiters = new Map<string, AsyncRateLimiter>();
  const limiterFor = (host: string): AsyncRateLimiter => {
    const k = host || "(unknown)";
    let l = limiters.get(k);
    if (!l) {
      // `cdmrp.health.mil` gets its own, slower floor (PR 5.5): a Defense
      // Health Agency host serving ~745 KB PDFs, with no published rate policy.
      l = new AsyncRateLimiter(k === CDMRP_HOST ? Math.max(INTERVAL, CDMRP_MIN_INTERVAL_MS) : INTERVAL);
      limiters.set(k, l);
    }
    return l;
  };
  const simplerLimiter = new AsyncRateLimiter(Math.max(550, INTERVAL));
  const simpler = createSimplerGrantsClient();

  const outcomes: Outcome[] = [];
  let lastId: string | null = null;

  for (const { row, family, adapter } of eligible.slice(0, LIMIT)) {
    lastId = row.id;
    const acq =
      adapter === NSF_SOLICITATION_ADAPTER_ID
        ? await acquireNsfSolicitation(row, { limiterFor, programPage: PROGRAM_PAGE })
        : adapter === CDMRP_PA_ADAPTER_ID
          ? // The CDMRP adapter's deps *are* the Grants.gov adapter's: the mirror
            // it falls back to is that adapter, so the driver injects one bag.
            await acquireCdmrpPa(row satisfies CdmrpRow, { limiterFor, simplerLimiter, simpler })
          : await acquireGrantsGovAttachment(row, { limiterFor, simplerLimiter, simpler });
    const extra = (acq.extra ?? null) as AnyExtra | null;
    const outcome: Outcome = {
      row,
      family,
      adapter,
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
        announcement_kind: adapter,
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

const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(1) : "0.0");

function report(outcomes: Outcome[], lastId: string | null): void {
  const byStatus = new Map<string, number>();
  for (const o of outcomes) byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);
  const withObjectives = outcomes.filter((o) => commonExtra(o.extra).objectives);
  // Each adapter's acceptance bar is measured over its own population, because
  // the denominators are different facts: the Grants.gov bar is over rows that
  // carry an attachment, the NSF bar over rows whose number is a solicitation,
  // the CDMRP bar over rows whose number derives a PA URL.
  const ggOutcomes = outcomes.filter((o) => o.adapter === GRANTS_GOV_ATTACHMENT_ADAPTER_ID);
  // The acceptance bar's denominator: rows that carry at least one acceptable
  // attachment, which is the population `NON_NIH_INVENTORY.md` § 2a measured
  // (65.1 % of posted non-NIH rows). Rows with no attachment at all — DOJ's 31,
  // NASA's 11 — are counted separately: they are the synopsis fallback's
  // problem, not this adapter's. NSF's 91 and CDMRP's 81 are no longer among
  // them: they have their own adapters, reported below.
  const withAttachment = ggOutcomes.filter((o) => (attachmentExtra(o.extra)?.considered.length ?? 0) > 0);
  const withAttachmentObj = withAttachment.filter((o) => commonExtra(o.extra).objectives);
  const readable = ggOutcomes.filter((o) => (attachmentExtra(o.extra)?.targets ?? 0) > 0);
  const readableObj = readable.filter((o) => commonExtra(o.extra).objectives);

  console.error(`\n--- summary ---`);
  console.error(`processed ${outcomes.length}: ${[...byStatus].map(([k, n]) => `${k}=${n}`).join(", ")}`);
  console.error(`requests: ${outcomes.reduce((n, o) => n + o.pageFetches, 0)} document GETs, ${outcomes.reduce((n, o) => n + o.simplerCalls, 0)} Simpler API calls`);
  console.error(`objectives recovered:`);
  if (ggOutcomes.length) {
    console.error(`  ${withAttachmentObj.length}/${withAttachment.length} (${pct(withAttachmentObj.length, withAttachment.length)} %) of Grants.gov rows with ≥ 1 acceptable attachment  ← PR 5.3's bar (≥ 70 %)`);
    console.error(`  ${readableObj.length}/${readable.length} (${pct(readableObj.length, readable.length)} %) of Grants.gov rows with any readable target (attachment or package instructions)`);
  }
  console.error(`  ${withObjectives.length}/${outcomes.length} (${pct(withObjectives.length, outcomes.length)} %) of every row processed, whatever the adapter`);
  reportNsf(outcomes);

  const perAgency = new Map<string, { n: number; obj: number }>();
  for (const o of outcomes) {
    const k = o.row.agency_code ?? "—";
    const e = perAgency.get(k) ?? { n: 0, obj: 0 };
    e.n += 1;
    if (commonExtra(o.extra).objectives) e.obj += 1;
    perAgency.set(k, e);
  }
  console.error(`\nby agency_code (rows · objectives):`);
  for (const [k, v] of [...perAgency].sort((a, b) => b[1].n - a[1].n)) console.error(`  ${pad(k, 22)} ${v.n} · ${v.obj}`);

  const perTable = new Map<string, number>();
  for (const o of outcomes) {
    const t = commonExtra(o.extra).table ?? "(none)";
    perTable.set(t, (perTable.get(t) ?? 0) + 1);
  }
  console.error(`\nheading table chosen: ${[...perTable].map(([k, n]) => `${k}=${n}`).join(", ")}`);

  // Grants.gov rows choose a file, and so do the CDMRP rows that fell through
  // to the mirror. A CDMRP row won by the direct route never looked at an
  // attachment, and an NSF row cannot have one at all — counting either as
  // `(none)` would read as "no route worked" rather than "no route was tried",
  // so both are left out and the line disappears when nobody chose a file.
  const routed = outcomes.filter((o) => o.adapter === GRANTS_GOV_ATTACHMENT_ADAPTER_ID || attachmentExtra(o.extra) != null);
  if (routed.length) {
    const perRoute = new Map<string, number>();
    for (const o of routed) {
      const route = attachmentExtra(o.extra)?.chosen?.route ?? "(none)";
      perRoute.set(route, (perRoute.get(route) ?? 0) + 1);
    }
    console.error(`chosen file's route: ${[...perRoute].map(([k, n]) => `${k}=${n}`).join(", ")}`);
  }

  reportCdmrp(outcomes, { measured: true });

  // D69: the three non-`ok` statuses are three different facts and this listing
  // must not collapse them. `not_applicable` is *structural* — no announcement
  // exists on any route — so calling those rows failures is exactly what the
  // status was added to stop (it was the whole point of the value in
  // 20260914100000_fit_guide_sections.sql). NSF's 16 `PD-` rows are the largest
  // group in that bucket, and none of them is a failure of anything.
  const structural = outcomes.filter((o) => o.status === "not_applicable");
  const failures = outcomes.filter((o) => o.status === "error" || o.status === "not_found" || o.status === "skipped");
  if (structural.length) {
    console.error(`\nno announcement exists on any route (${structural.length}) — stamped guide_fetch_status='not_applicable', never retried, falls through to the synopsis:`);
    for (const f of structural) console.error(`  ${pad(f.row.opportunity_number ?? "?", 26)} ${pad(f.row.agency_code ?? "—", 18)} ${f.error ?? ""}`);
  }
  if (failures.length) {
    console.error(`\nfailures (${failures.length}) — each stamps the status it reached ('error' or 'not_found') and falls through to the synopsis:`);
    for (const f of failures) console.error(`  ${pad(f.row.opportunity_number ?? "?", 26)} ${pad(f.row.agency_code ?? "—", 18)} ${pad(f.status, 14)} ${f.error ?? ""}`);
  }
  if (lastId) console.error(`\nresume with: --cursor ${lastId}`);
}

/**
 * NSF's own numbers (PR 5.4). Kept apart from the Grants.gov summary because
 * the two measure different populations, and because two of these lines are the
 * PR's acceptance criteria:
 *
 *   - `objectives` over the **`NN-NNN` solicitation rows only** (bar: ≥ 95 %).
 *     `PD-` rows are program descriptions with no solicitation behind them
 *     (NON_NIH_INVENTORY § 4c), so counting them in the denominator would
 *     report a source's shape as an adapter's failure.
 *   - program element codes over the same rows (bar: ≥ 60 %).
 */
function reportNsf(outcomes: Outcome[]): void {
  const nsf = outcomes.filter((o) => o.adapter === NSF_SOLICITATION_ADAPTER_ID);
  if (!nsf.length) return;
  const extraOf = (o: Outcome): NsfExtra | null => (isNsfExtra(o.extra) ? o.extra : null);
  const byKind = (k: string) => nsf.filter((o) => extraOf(o)?.kind === k);
  const sol = byKind("solicitation");
  const pd = byKind("program_description");
  const unknown = byKind("unknown");
  const solObj = sol.filter((o) => extraOf(o)?.objectives);
  const solEle = sol.filter((o) => (extraOf(o)?.programElementCodes.length ?? 0) > 0);
  const solAnyCode = sol.filter((o) => (extraOf(o)?.programElementCodes.length ?? 0) + (extraOf(o)?.programReferenceCodes.length ?? 0) > 0);
  const solReplaces = sol.filter((o) => (extraOf(o)?.replaces.length ?? 0) > 0);
  const storedMissing = nsf.filter((o) => extraOf(o)?.storedUrl == null);
  const finalSolicitation = sol.filter((o) => /\/solicitation\/?$/.test(extraOf(o)?.finalUrl ?? ""));

  console.error(`\n--- NSF (PR 5.4) ---`);
  console.error(`rows: ${nsf.length} = ${sol.length} NN-NNN solicitations + ${pd.length} PD- program descriptions${unknown.length ? ` + ${unknown.length} unrecognised number shapes` : ""}`);
  console.error(`rows carrying a stored *.nsf.gov additional_info_url: ${nsf.length - storedMissing.length}/${nsf.length} (an ods_key is never constructed)`);
  console.error(`objectives (II. Program Description) recovered: ${solObj.length}/${sol.length} (${pct(solObj.length, sol.length)} %)  ← the acceptance bar (≥ 95 %)`);
  console.error(`final URL ends /solicitation: ${finalSolicitation.length}/${sol.length}`);
  console.error(`PD- rows: ${pd.length}, all not_applicable with 0 requests — they fall through to the synopsis and are never retried`);
  console.error(`program element codes: ${solEle.length}/${sol.length} (${pct(solEle.length, sol.length)} %)  ← the acceptance bar (≥ 60 %); element or reference code: ${solAnyCode.length}/${sol.length} (${pct(solAnyCode.length, sol.length)} %)`);
  console.error(`reissue lineage (Replaces:) found on ${solReplaces.length}/${sol.length} (${pct(solReplaces.length, sol.length)} %)`);

  const perSource = new Map<string, number>();
  for (const o of nsf) {
    const k = extraOf(o)?.codeSource ?? "(none)";
    perSource.set(k, (perSource.get(k) ?? 0) + 1);
  }
  console.error(`code source: ${[...perSource].map(([k, n]) => `${k}=${n}`).join(", ")}`);
  const perRoute = new Map<string, number>();
  for (const o of nsf) {
    const k = extraOf(o)?.route ?? "(none)";
    perRoute.set(k, (perRoute.get(k) ?? 0) + 1);
  }
  console.error(`document route: ${[...perRoute].map(([k, n]) => `${k}=${n}`).join(", ")}`);

  console.error(`\nnumber       kind                  status          roles  elements                              replaces`);
  for (const o of nsf) {
    const e = extraOf(o);
    console.error(
      `${pad(o.row.opportunity_number ?? "?", 12)} ${pad(e?.kind ?? "?", 21)} ${pad(o.status, 15)} ${pad(String(e?.roles.length ?? 0), 6)} ${pad(e?.programElementCodes.join(",") || "—", 37)} ${e?.replaces.join(",") || "—"}`,
    );
  }
}

// ---------------------------------------------------------------------------
// CDMRP (PR 5.5): the FON decomposition, which is what PR 5.8 consumes
// ---------------------------------------------------------------------------

/**
 * CDMRP's own numbers. Kept apart from the Grants.gov summary for the same
 * reason `reportNsf` is: the denominators are different populations.
 *
 * `--fon-report` calls this with `measured: false`. Nothing is fetched on that
 * path, so the two lines whose numerators can only come from a fetch — the
 * direct `_GG.pdf` rate and `objectives` recovered — are suppressed rather than
 * printed as `0/0 (0.0 %)` and `0/81 (0.0 %)` beside their acceptance bars. A
 * zero that means "not measured" reads exactly like a zero that means "every
 * row failed", and printing it next to a bar invites the reader to conclude the
 * bar was missed. The decomposition below *is* measured on that path — it is
 * the whole point of the flag — so it always prints.
 */
function reportCdmrp(outcomes: Outcome[], opts: { measured: boolean }): void {
  const cdmrp = outcomes.filter((o) => o.family === "dod_cdmrp");
  if (cdmrp.length === 0) return;

  const fons = cdmrp.map((o) => decomposeCdmrpFon(o.row.opportunity_number));
  const decomposed = fons.filter((f) => f.program && f.mechanism);
  console.error(`\n--- CDMRP / DHA (PR 5.5) ---`);
  console.error(`FON decomposed to program+mechanism: ${decomposed.length}/${fons.length} (${pct(decomposed.length, fons.length)} %)  ← the acceptance bar (≥ 95 %)`);
  const unmatched = fons.filter((f) => !f.program);
  if (unmatched.length) {
    console.error(`no program in the seeded list (${unmatched.length}): ${unmatched.map((f) => `${f.fon} [${f.kind}]`).join(", ")}`);
  }

  if (opts.measured) {
    const derivable = cdmrp.filter((o) => isCdmrpExtra(o.extra) && o.extra.directUrl != null);
    const directOk = derivable.filter((o) => isCdmrpExtra(o.extra) && o.extra.direct === "ok");
    const byDirect = new Map<string, number>();
    for (const o of cdmrp) {
      const e = o.extra;
      const k = isCdmrpExtra(e) ? e.direct : "(none)";
      byDirect.set(k, (byDirect.get(k) ?? 0) + 1);
    }
    // 86.1 %, not 88 %: NON_NIH_INVENTORY § 5c probed all 79 derivable numbers
    // and got 68. NON_NIH_PLAN § PR 5.5 records that the earlier "88 %" was a
    // capped 44/50 run and contradicted its own source.
    console.error(
      `direct cdmrp.health.mil _GG.pdf: ${directOk.length}/${derivable.length} (${pct(directOk.length, derivable.length)} %) of derivable numbers  ← the acceptance bar (≥ 86.1 %)`,
    );
    console.error(`  direct outcomes: ${[...byDirect].map(([k, n]) => `${k}=${n}`).join(", ")}`);
    const objectives = cdmrp.filter((o) => commonExtra(o.extra).objectives);
    console.error(`objectives recovered (either route): ${objectives.length}/${cdmrp.length} (${pct(objectives.length, cdmrp.length)} %)  ← the acceptance bar (≥ 90 %)`);
    const viaMirror = cdmrp.filter((o) => isCdmrpExtra(o.extra) && o.extra.route === "mirror");
    console.error(`  won by the direct route: ${cdmrp.filter((o) => isCdmrpExtra(o.extra) && o.extra.route === "direct").length}, by the Simpler/Grants.gov mirror: ${viaMirror.length}`);

    const mismatched = cdmrp.filter((o) => isCdmrpExtra(o.extra) && o.extra.fonMismatch);
    if (mismatched.length) {
      console.error(`!! derived URL served another notice's PA (${mismatched.length}) — refused:`);
      for (const o of mismatched) console.error(`  ${o.row.opportunity_number} → ${(o.extra as CdmrpExtra).fonMismatch}`);
    }
  } else {
    console.error(`no document was fetched on this run: the direct-route rate and objectives recovery are not measured here`);
  }

  const byProgram = new Map<string, number>();
  for (const f of fons) if (f.program) byProgram.set(f.program, (byProgram.get(f.program) ?? 0) + 1);
  console.error(`\nprograms (${byProgram.size} distinct):`);
  for (const [k, n] of [...byProgram].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    console.error(`  ${pad(k, 10)} ${String(n).padStart(2)}  ${CDMRP_PROGRAM_NAMES[k] ?? ""}`);
  }

  /**
   * The mechanism-suffix table.
   *
   * Keyed on `mechanismBase` — the letters — so `BTA3` and `BTA4` count as two
   * announcements of one mechanism rather than two mechanisms; the level lives
   * in `mechanismVariant`. The same code means different awards in different
   * programs (`PCTA` is ALSRP's *Pilot Clinical Trial* Award and PRMRP's
   * *Platform Clinical Translation* Award), so the programs that use each code
   * are printed with it: PR 5.8's priors are program-scoped, not global.
   *
   * **Falls back to the whole `mechanism` when the split failed.**
   * `decomposeCdmrpFon`'s `MECHANISM` is `/^([A-Z]+)(\d*)$/` — letters then
   * trailing digits — so it returns a null base for any suffix that interleaves
   * them, `BTA1AND2` and `BTA1B` being the obvious next spellings of a level
   * split BCRP already ships as `BTA122`. Skipping those rows would silently
   * shorten the one table this report exists to produce, and PR 5.8 would never
   * learn the mechanism existed. A row with no mechanism at all — the standing
   * BAA, the two pre-FY23 numbers — still has nothing to key on and is skipped.
   */
  type Mech = { n: number; programs: Set<string>; variants: Set<string>; names: Set<string> };
  const byMechanism = new Map<string, Mech>();
  for (const o of cdmrp) {
    const f = decomposeCdmrpFon(o.row.opportunity_number);
    const key = f.mechanismBase ?? f.mechanism;
    if (!key) continue;
    const e = byMechanism.get(key) ?? { n: 0, programs: new Set(), variants: new Set(), names: new Set() };
    e.n += 1;
    if (f.program) e.programs.add(f.program);
    if (f.mechanismVariant) e.variants.add(f.mechanismVariant);
    const award = isCdmrpExtra(o.extra) ? o.extra.cover?.awardName : null;
    if (award) e.names.add(award);
    byMechanism.set(key, e);
  }
  console.error(`\nmechanism suffixes (${byMechanism.size} distinct) — PR 5.8's input:`);
  console.error(`  ${pad("code", 10)} ${pad("n", 3)} ${pad("levels", 8)} ${pad("programs", 40)} award name (from the PA cover page)`);
  for (const [k, v] of [...byMechanism].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))) {
    console.error(
      `  ${pad(k, 10)} ${pad(String(v.n), 3)} ${pad([...v.variants].sort().join("/") || "—", 8)} ${pad([...v.programs].sort().join(",") || "—", 40)} ${[...v.names].join(" | ") || "—"}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
