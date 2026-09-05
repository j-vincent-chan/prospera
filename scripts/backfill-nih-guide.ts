/**
 * NIH Guide backfill / manual runs. Nightly runs are handled by
 * /api/cron/sync-nih-guide (src/lib/services/nih-guide-sync.ts); this script
 * drives the same sync by hand and adds the PR 0.5 modes.
 *
 *   npm run backfill-nih-guide                                   # counts, then up to 1500 due notices, ~700 ms apart
 *   npm run backfill-nih-guide -- --counts                       # counts only (no network)
 *   npm run backfill-nih-guide -- --dry-run --status not_found --open --limit 25
 *   npm run backfill-nih-guide -- --dry-run --status ok --limit 5
 *   npm run backfill-nih-guide -- --force --status not_found --open      # Fix B pass: posted not_found rows, prints the attachment hit rate
 *   npm run backfill-nih-guide -- --force --status ok --limit 400        # re-parse ok rows for sections, a night at a time
 *   npm run backfill-nih-guide -- --force PAR-25-301 RFA-NS-25-018 PAS-27-028
 *   npm run backfill-nih-guide -- --reparse-reissue --dry-run [--reset-exemplar-stamps]
 *
 * Flags: --limit N · --force · --dry-run (fetch, resolve and parse; write nothing, not even a
 * sync_job_logs row) · --status ok|not_found|error|not_applicable|never (repeatable) · --open
 * (notices open today) · --counts · --reparse-reissue · --reset-exemplar-stamps.
 *
 * Writes refuse to run until supabase/migrations/20260914100000_fit_guide_sections.sql is
 * applied (a GET probe of the new columns, not an error-message match); --dry-run works either way.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isGuideNumber } from "../src/lib/ingestion/nih-guide/client";
import { planGuideFetch, syncNihGuide, type GuideCandidateRow, type NoticeOutcome } from "../src/lib/services/nih-guide-sync";

config({ path: ".env.local", quiet: true });

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opts = (name: string): string[] => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]!] : []));

const DRY_RUN = flag("--dry-run");
const FORCE = flag("--force");
const COUNTS_ONLY = flag("--counts");
const OPEN_ONLY = flag("--open");
const REPARSE_REISSUE = flag("--reparse-reissue");
const RESET_EXEMPLAR_STAMPS = flag("--reset-exemplar-stamps");
const LIMIT = opts("--limit").length ? Number(opts("--limit")[0]) : 1500;
const STATUS_IN = opts("--status") as Array<"ok" | "not_found" | "error" | "not_applicable" | "never">;
const NUMBERS = args.filter((a) => /^(PA|PAR|PAS|RFA|NOT)-(?:[A-Z]{2}-)?\d{2}-\d{3}$/i.test(a)).map((a) => a.toUpperCase());
const MIGRATION = "supabase/migrations/20260914100000_fit_guide_sections.sql";

if (!Number.isFinite(LIMIT) || LIMIT < 0) {
  console.error("--limit expects a non-negative number");
  process.exit(1);
}
for (const s of STATUS_IN) {
  if (!["ok", "not_found", "error", "not_applicable", "never"].includes(s)) {
    console.error(`--status expects ok | not_found | error | not_applicable | never, got ${s}`);
    process.exit(1);
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}
const supabase: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });

// ---------------------------------------------------------------------------
// Schema probes (GET a column; never match on an error message)
// ---------------------------------------------------------------------------

async function columnExists(table: string, column: string): Promise<boolean> {
  const { error } = await supabase.from(table).select(column).limit(1);
  return !error;
}

async function migrationApplied(): Promise<boolean> {
  for (const c of ["guide_sections", "clinical_trial_designation", "program_division", "guide_html_hash", "guide_source", "source_updated_at"]) {
    if (!(await columnExists("funding_opportunities", c))) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Counts (read-only)
// ---------------------------------------------------------------------------

type CountRow = GuideCandidateRow & { id: string; posted_date: string | null; agency_code: string | null };

async function loadCandidates(extended: boolean): Promise<CountRow[]> {
  const cols = "id, opportunity_number, posted_date, forecasted, agency_code, guide_url, guide_fetched_at, guide_fetch_status, raw_payload_json" + (extended ? ", source_updated_at" : "");
  const out: CountRow[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from("funding_opportunities")
      .select(cols)
      .or("agency_code.like.HHS-NIH%,opportunity_number.like.PA-%,opportunity_number.like.PAR-%,opportunity_number.like.PAS-__-___,opportunity_number.like.RFA-%")
      .order("posted_date", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true })
      .range(from, from + page - 1);
    if (error) throw new Error(`funding_opportunities read failed: ${error.message}`);
    const rows = (data ?? []) as unknown as CountRow[];
    out.push(...rows.map((r) => ({ ...r, source_updated_at: r.source_updated_at ?? null })));
    if (rows.length < page) break;
  }
  return out;
}

function tally<T>(items: T[], keyOf: (t: T) => string): string {
  const m = new Map<string, number>();
  for (const it of items) m.set(keyOf(it), (m.get(keyOf(it)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join(", ");
}

async function printCounts(extended: boolean): Promise<void> {
  const rows = await loadCandidates(extended);
  const plans = rows.map((r) => ({ r, plan: planGuideFetch(r) }));
  console.error(`candidates (NIH agency or Guide-style number): ${rows.length}`);
  console.error(`  by guide_fetch_status: ${tally(rows, (r) => r.guide_fetch_status ?? "never")}`);
  console.error(`  forecasts: ${rows.filter((r) => r.forecasted).length}; posted with an ill-formed / placeholder number: ${rows.filter((r) => !r.forecasted && !isGuideNumber(r.opportunity_number) && !/^NOT-/i.test(r.opportunity_number ?? "")).length}`);
  console.error(`  plan tonight (default cadence): ${tally(plans, ({ plan }) => (plan.action === "fetch" ? `fetch:${plan.reason}` : plan.action === "not_applicable" ? `not_applicable:${plan.reason}${plan.stamp ? "" : " (already stamped)"}` : "skip"))}`);
  const postedNotFound = rows.filter((r) => !r.forecasted && r.guide_fetch_status === "not_found" && isGuideNumber(r.opportunity_number));
  console.error(`  posted, well-formed, not_found (Fix B population): ${postedNotFound.length}; of which with attachments already in raw_payload_json: ${postedNotFound.filter((r) => Array.isArray(r.raw_payload_json?.attachments)).length}`);
  if (!extended) console.error(`  (source_updated_at not yet in the schema — every fetched row falls to the 7-day cadence until ${MIGRATION} is applied and the Simpler sync has run)`);
}

// ---------------------------------------------------------------------------
// Dry-run listing
// ---------------------------------------------------------------------------

function fmtOutcome(o: NoticeOutcome): string {
  const cols = [
    o.number.padEnd(14),
    o.status.padEnd(14),
    (o.source ?? "—").padEnd(18),
    `att=${o.attachment}`.padEnd(10),
    `get=${o.pageFetches} api=${o.simplerCalls}`.padEnd(12),
    `cycles=${o.cycles}`.padEnd(10),
    `sections=${o.sections}`.padEnd(12),
    `[${o.sectionKeys.join(",")}]`.padEnd(38),
    `designation=${o.designation ?? "—"}`.padEnd(26),
    `division=${o.division ?? "—"}`,
    `hash=${o.hash ? o.hash.slice(0, 12) : "—"}`,
    `reissue=${o.reissueOf ?? "—"}`,
    o.reason ? `(${o.reason})` : "",
    o.error ? `error: ${o.error}` : "",
  ];
  return cols.join(" | ").replace(/\s+\|\s*$/g, "").trim();
}

// ---------------------------------------------------------------------------
// --reparse-reissue
// ---------------------------------------------------------------------------

type ReissueRow = { id: string; opportunity_number: string | null; reissue_of: string | null; description: string | null; guide_sections?: Array<{ part: number; heading: string; text: string }> | null };

const REISSUE_RE = /Reissue of\s*((?:RFA|PA|PAR|PAS)-(?:[A-Z]{2}-)?\d{2}-\d{3})/i;

/** The HTML is not stored; the only stored text that can carry "Reissue of …" is Part 1's Announcement Type block (after this PR) or Simpler's description. */
function derivedReissue(row: ReissueRow): { value: string | null; from: "guide_sections" | "description" | null } {
  const announcement = row.guide_sections?.find((s) => s.part === 1 && /^Announcement Type$/i.test(s.heading));
  const fromSections = announcement?.text.match(REISSUE_RE)?.[1]?.toUpperCase() ?? null;
  if (fromSections) return { value: fromSections, from: "guide_sections" };
  const fromDescription = row.description?.match(REISSUE_RE)?.[1]?.toUpperCase() ?? null;
  if (fromDescription) return { value: fromDescription, from: "description" };
  return { value: null, from: null };
}

async function reparseReissue(): Promise<void> {
  const hasSections = await columnExists("funding_opportunities", "guide_sections");
  const hasExemplarStamp = await columnExists("funding_opportunities", "exemplars_fetched_at");
  const cols = "id, opportunity_number, reissue_of, description" + (hasSections ? ", guide_sections" : "");
  const rows: ReissueRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("funding_opportunities")
      .select(cols)
      .or("agency_code.like.HHS-NIH%,opportunity_number.like.PA-%,opportunity_number.like.PAR-%,opportunity_number.like.PAS-__-___,opportunity_number.like.RFA-%")
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`funding_opportunities read failed: ${error.message}`);
    rows.push(...((data ?? []) as unknown as ReissueRow[]));
    if (!data || data.length < 1000) break;
  }
  const derived = rows.map((row) => ({ row, ...derivedReissue(row) }));
  const withStoredText = derived.filter((d) => d.from !== null);
  const changed = derived.filter((d) => d.value && d.value !== (d.row.reissue_of ?? null));
  console.error(`reparse-reissue: ${rows.length} NIH rows; reissue_of set on ${rows.filter((r) => r.reissue_of).length} (PA/PAR/PAS predecessors: ${rows.filter((r) => /^PA[RS]?-\d/.test(r.reissue_of ?? "")).length}, RFA: ${rows.filter((r) => /^RFA-/.test(r.reissue_of ?? "")).length})`);
  console.error(`  rows with stored text carrying "Reissue of": ${withStoredText.length} (from guide_sections: ${withStoredText.filter((d) => d.from === "guide_sections").length}${hasSections ? "" : " — column not present yet"}, from description: ${withStoredText.filter((d) => d.from === "description").length})`);
  console.error(`  reissue_of would change on ${changed.length} rows; ${rows.length - withStoredText.length} rows hold no stored text with a predecessor — the Guide HTML is not stored, so the next fetch (nightly cadence or --force) re-derives those.`);
  for (const d of changed) console.log(`  ${d.row.opportunity_number}: ${d.row.reissue_of ?? "null"} → ${d.value} (from ${d.from})`);
  if (RESET_EXEMPLAR_STAMPS) {
    console.error(hasExemplarStamp ? `  --reset-exemplar-stamps: would null exemplars_fetched_at on ${changed.length} rows` : "  --reset-exemplar-stamps: funding_opportunities.exemplars_fetched_at does not exist yet — no-op");
  }
  if (DRY_RUN) {
    console.error("  [dry run: nothing written]");
    return;
  }
  let written = 0;
  for (const d of changed) {
    const update: Record<string, unknown> = { reissue_of: d.value };
    if (RESET_EXEMPLAR_STAMPS && hasExemplarStamp) update.exemplars_fetched_at = null;
    const { error } = await supabase.from("funding_opportunities").update(update).eq("id", d.row.id);
    if (error) throw new Error(`update failed for ${d.row.opportunity_number}: ${error.message}\nRerun to resume; ${written} rows were written.`);
    written += 1;
  }
  console.error(`  done: ${written} rows updated`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const applied = await migrationApplied();
  if (!applied && !DRY_RUN && !COUNTS_ONLY) {
    console.error(`${MIGRATION} is not applied (probe of the new funding_opportunities columns failed). Apply it first; --dry-run and --counts work without it.`);
    process.exit(2);
  }
  if (!applied) console.error(`note: ${MIGRATION} not applied — read-only mode, new columns read as null`);

  if (REPARSE_REISSUE) {
    await reparseReissue();
    return;
  }

  await printCounts(applied);
  if (COUNTS_ONLY) return;

  const outcomes: NoticeOutcome[] = [];
  console.error(
    `\n${DRY_RUN ? "DRY RUN — fetching, resolving and parsing; nothing will be written" : "writing"}: limit ${LIMIT}${FORCE ? ", --force" : ""}${STATUS_IN.length ? `, status in [${STATUS_IN.join(", ")}]` : ""}${OPEN_ONLY ? ", open notices only" : ""}${NUMBERS.length ? `, numbers [${NUMBERS.join(", ")}]` : ""}\n`,
  );
  const result = await syncNihGuide(supabase, {
    limit: LIMIT,
    force: FORCE,
    dryRun: DRY_RUN,
    statusIn: STATUS_IN.length ? STATUS_IN : undefined,
    openOnly: OPEN_ONLY,
    opportunityNumbers: NUMBERS.length ? NUMBERS : undefined,
    minIntervalMs: 700,
    simplerMinIntervalMs: 550,
    extendedColumns: applied,
    onNotice: (o) => {
      outcomes.push(o);
      if (o.status !== "not_applicable" || DRY_RUN) console.log(fmtOutcome(o));
    },
  });
  if (!result.ok) {
    console.error(result.error);
    process.exit(1);
  }

  const resolved = outcomes.filter((o) => o.simplerCalls > 0);
  const hits = resolved.filter((o) => o.attachment === "hit" && (o.status === "ok" || o.status === "unchanged"));
  const notFoundBefore = outcomes.filter((o) => o.status !== "not_applicable");
  console.error(`\nsummary: ${JSON.stringify(result)}`);
  console.error(`notices processed: ${notFoundBefore.length}; by outcome: ${tally(notFoundBefore, (o) => o.status)}; by source: ${tally(outcomes.filter((o) => o.source), (o) => o.source!)}`);
  console.error(`attachment resolution: ${resolved.length} Simpler GET(s) → ${hits.length} readable announcement(s) (${resolved.length ? Math.round((100 * hits.length) / resolved.length) : 0}% hit rate); ${resolved.filter((o) => o.attachment === "miss").length} without one; ${resolved.filter((o) => o.attachment === "error").length} API errors`);
  const parsed = outcomes.filter((o) => o.status === "ok");
  if (parsed.length) {
    console.error(`parsed ${parsed.length}: with sections ${parsed.filter((o) => o.sections > 0).length}; with a Section I block ${parsed.filter((o) => o.sectionKeys.includes("I")).length}; designation ${tally(parsed, (o) => o.designation ?? "—")}; division set ${parsed.filter((o) => o.division).length}; reissue set ${parsed.filter((o) => o.reissueOf).length} (PA/PAR/PAS ${parsed.filter((o) => /^PA[RS]?-\d/.test(o.reissueOf ?? "")).length})`);
  }
  process.exit(result.errors > 0 && result.updated === 0 && result.unchanged === 0 && !DRY_RUN ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
