/**
 * Fit engine · PR 0.2 · backfill MeSH headings, publication types, abstract and
 * author position onto investigator_publications from PubMed efetch.
 *
 *   npm run fit:backfill-pubmed-mesh -- --dry-run --limit 20        # fetch + parse 20 PMIDs, print what would be stored, write nothing
 *   npm run fit:backfill-pubmed-mesh                                 # every pending verified row; resumable (reruns skip stamped PMIDs)
 *   npm run fit:backfill-pubmed-mesh -- --limit 500                  # at most 500 distinct PMIDs this run
 *   npm run fit:backfill-pubmed-mesh -- --investigator <uuid>        # one person's rows
 *   npm run fit:backfill-pubmed-mesh -- --pmid 39808693,41197250     # specific PMIDs (only rows that exist, still only pending ones)
 *   npm run fit:backfill-pubmed-mesh -- --pmid 39808693 --force       # re-fetch listed PMIDs even if already stamped (after a parser fix)
 *   npm run fit:backfill-pubmed-mesh -- --batch 200 --interval-ms 350
 *   npm run fit:backfill-pubmed-mesh -- --report                     # rows by mesh_fetch_outcome, terminal + watch PMIDs, corpus distribution → INVENTORY.md § 11
 *   npm run fit:backfill-pubmed-mesh -- --report --no-inventory      # print the report only
 *
 * Pending = identity_status 'verified' AND (mesh_fetch_outcome = 'pending' OR
 * (mesh_fetch_outcome IN ('no_mesh','not_returned') AND mesh_fetched_at < now() - 30 days)).
 * There is no identity_method filter. PMIDs are fetched once each (200 per POST,
 * ≥ 350 ms apart) and written to every row that carries them — verified or not —
 * so co-authors get identical MeSH. mesh_fetched_at is stamped for every PMID
 * touched. A PMID efetch does not return is `not_returned` once and
 * `not_returned_terminal` on the second miss; terminal PMIDs are never
 * re-requested and are listed by --report for a person to look at.
 *
 * PR 0.2a — a miss is confirmed before it is stamped. PMIDs absent from a
 * batch response are re-requested once, together with a canary PMID this run
 * already received. A retry that returns nothing (canary included) is an
 * outage, not data: nothing is stamped, the run exits 2 and prints the batch
 * index and the resume point so a cron-driven run surfaces it. More than 25
 * still missing in one batch after a healthy retry aborts the same way.
 *
 * fit 0.2c — --report is read-only on the database (it writes only
 * INVENTORY.md) and also pages every publication row (mesh, publication types,
 * outcome, author position — never the abstract) and the descriptor table to
 * print the corpus distribution: share of rows with MeSH, triangle class per
 * row and per investigator, top descriptors, check tags, publication types.
 * A hand-written "### Reading for Phase 1" block at the end of § 11 survives
 * a rerun.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { computeCorpusDistribution, type CorpusRow } from "../src/lib/community/pubmed-corpus-stats";
import { captureFieldsFromXml, type PubmedCaptureFields, type PubmedCaptureSubject } from "../src/lib/community/pubmed-record";
import { buildMeshIndex, type MeshDescriptorRow, type MeshIndex } from "../src/lib/fit/classify/mesh";
import {
  BACKFILL_EFETCH_BATCH,
  BACKFILL_MIN_INTERVAL_MS,
  chunk,
  COVERAGE_HEADING,
  decideBatchMisses,
  distinctPmids,
  expectedEfetchCalls,
  formatBatchAbort,
  formatCoverageSection,
  formatDryRunRecord,
  MESH_FETCH_STATES,
  nextFetchState,
  pendingFilter,
  spliceCoverageSection,
  type CoverageCounts,
  type DryRunRow,
  type MeshFetchState,
  type PublicationRowRef,
  type PublicationRowState,
  type TerminalRow,
  type WatchRow,
} from "../src/lib/community/pubmed-mesh-backfill";

config({ path: ".env.local", quiet: true });

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const DRY_RUN = flag("--dry-run");
const REPORT = flag("--report");
const WRITE_INVENTORY = REPORT && !flag("--no-inventory");
const LIMIT = opt("--limit") ? Number(opt("--limit")) : null;
const INVESTIGATOR = opt("--investigator") ?? null;
const PMIDS = (opt("--pmid") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
/** With --pmid: ignore the pending predicate for the listed PMIDs (re-store after a parser fix, or re-check a row). */
const FORCE = flag("--force") && PMIDS.length > 0;
const BATCH = Math.min(BACKFILL_EFETCH_BATCH, Math.max(1, Number(opt("--batch") ?? BACKFILL_EFETCH_BATCH)));
const INTERVAL_MS = Math.max(BACKFILL_MIN_INTERVAL_MS, Number(opt("--interval-ms") ?? BACKFILL_MIN_INTERVAL_MS));
const UPSERT_CHUNK = 200;
const PAGE = 1000;
const INVENTORY_PATH = path.join("docs", "fit-engine", "INVENTORY.md");
const MIGRATION = "supabase/migrations/20260912100000_fit_pubmed_capture.sql";

// The E-utilities limiter reads this at module load; pin it before the ingest module is imported.
process.env.NCBI_EUTILS_INTERVAL_MS = String(INTERVAL_MS);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}
const supabase: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });

type InvestigatorRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  middle_initial: string | null;
  full_name: string | null;
  orcid: string | null;
};
type Investigator = { label: string; subject: PubmedCaptureSubject };

function isMissingCaptureColumn(message: string): boolean {
  return /mesh_fetch/i.test(message);
}

async function loadInvestigators(): Promise<Map<string, Investigator>> {
  const out = new Map<string, Investigator>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("investigators")
      .select("id, first_name, last_name, middle_initial, full_name, orcid")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`investigators read failed: ${error.message}`);
    for (const r of (data ?? []) as InvestigatorRow[]) {
      out.set(r.id, {
        label: r.full_name ?? `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(),
        subject: {
          name: {
            firstName: String(r.first_name ?? "").trim(),
            lastName: String(r.last_name ?? "").trim(),
            middleInitial: r.middle_initial ? String(r.middle_initial).trim() : null,
            fullName: r.full_name ?? "",
          },
          orcid: r.orcid ?? null,
        },
      });
    }
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** Verified rows still pending. Before the migration is applied, --dry-run treats every verified row as pending. */
async function loadPendingRows(): Promise<{ rows: PublicationRowRef[]; migrationApplied: boolean }> {
  const rows: PublicationRowRef[] = [];
  let migrationApplied = true;
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from("investigator_publications")
      .select("investigator_id, pmid")
      .eq("identity_status", "verified")
      .order("publication_date", { ascending: false, nullsFirst: false })
      .order("pmid")
      .range(from, from + PAGE - 1);
    if (INVESTIGATOR) q = q.eq("investigator_id", INVESTIGATOR);
    if (PMIDS.length) q = q.in("pmid", PMIDS);
    if (migrationApplied && !FORCE) q = q.or(pendingFilter());
    const { data, error } = await q;
    if (error) {
      if (migrationApplied && isMissingCaptureColumn(error.message)) {
        if (!DRY_RUN) throw new Error(`${error.message}\nApply ${MIGRATION} before running the backfill.`);
        console.error(`note: ${error.message} — migration not applied; dry run treats every verified row as pending`);
        migrationApplied = false;
        from -= PAGE;
        continue;
      }
      throw new Error(`investigator_publications read failed: ${error.message}`);
    }
    rows.push(...((data ?? []) as PublicationRowRef[]));
    if (!data || data.length < PAGE) break;
  }
  return { rows, migrationApplied };
}

/** Every row carrying one of these PMIDs, any identity_status — they all get the same MeSH. */
async function loadRowsForPmids(pmids: string[], migrationApplied: boolean): Promise<PublicationRowState[]> {
  const out: PublicationRowState[] = [];
  const columns = migrationApplied ? "investigator_id, pmid, mesh_fetch_outcome" : "investigator_id, pmid";
  for (const part of chunk(pmids, 100)) {
    const { data, error } = await supabase.from("investigator_publications").select(columns).in("pmid", part);
    if (error) throw new Error(`investigator_publications read failed: ${error.message}`);
    for (const r of (data ?? []) as unknown as Array<PublicationRowRef & { mesh_fetch_outcome?: MeshFetchState }>) {
      out.push({ investigator_id: r.investigator_id, pmid: r.pmid, mesh_fetch_outcome: r.mesh_fetch_outcome ?? null });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// --report: rows by state, terminal + watch PMIDs, corpus distribution → INVENTORY.md § 11 (read-only on the database)
// ---------------------------------------------------------------------------

/** HEAD count requests carry no error body, so probe the column with a GET first to get a readable message. */
async function assertMigrationApplied(): Promise<void> {
  const { error } = await supabase.from("investigator_publications").select("mesh_fetch_outcome").limit(1);
  if (!error) return;
  if (isMissingCaptureColumn(error.message)) throw new Error(`${error.message}\nApply ${MIGRATION} first.`);
  throw new Error(`investigator_publications read failed: ${error.message}`);
}

/** Rows in one fetch state, ordered by pmid — the terminal and watch tables are small. */
async function loadRowsInState<T>(state: MeshFetchState, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("investigator_publications")
      .select(columns)
      .eq("mesh_fetch_outcome", state)
      .order("pmid")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${state} rows read failed: ${error.message}`);
    out.push(...((data ?? []) as unknown as T[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** The whole descriptor table, the way fit:load-mesh-descriptors --validate-only reads it. */
async function loadMeshIndex(): Promise<MeshIndex> {
  const rows: MeshDescriptorRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("mesh_descriptors")
      .select("ui, name, tree_numbers, is_check_tag")
      .order("ui")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`mesh_descriptors read failed: ${error.message}`);
    rows.push(...((data ?? []) as MeshDescriptorRow[]));
    if (!data || data.length < PAGE) break;
  }
  if (!rows.length) throw new Error("mesh_descriptors is empty — run `npm run fit:load-mesh-descriptors` first");
  console.error(`mesh_descriptors: ${rows.length} rows`);
  return buildMeshIndex(rows);
}

type RawCorpusRow = Omit<CorpusRow, "mesh" | "publication_types"> & { mesh: unknown; publication_types: unknown };

/** Every publication row, verified or not, with the capture columns the distribution needs. Never the abstract. */
async function loadCorpusRows(): Promise<CorpusRow[]> {
  const out: CorpusRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("investigator_publications")
      .select("pmid, investigator_id, identity_status, mesh, publication_types, mesh_fetch_outcome, author_position, author_position_method")
      .order("investigator_id")
      .order("pmid")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`investigator_publications read failed: ${error.message}`);
    for (const r of (data ?? []) as unknown as RawCorpusRow[]) {
      out.push({
        ...r,
        mesh: Array.isArray(r.mesh) ? (r.mesh as CorpusRow["mesh"]) : [],
        publication_types: Array.isArray(r.publication_types) ? (r.publication_types as string[]) : [],
      });
    }
    if (!data || data.length < PAGE) break;
  }
  console.error(`investigator_publications: ${out.length} rows read`);
  return out;
}

type OutcomeRow = { pmid: string; investigator_id: string; identity_method: string };

async function report(investigators: Map<string, Investigator>): Promise<void> {
  await assertMigrationApplied();
  const counts = {} as CoverageCounts;
  for (const state of MESH_FETCH_STATES) {
    const { count, error } = await supabase
      .from("investigator_publications")
      .select("*", { count: "exact", head: true })
      .eq("mesh_fetch_outcome", state);
    if (error) throw new Error(`count failed for ${state}: ${error.message || JSON.stringify(error)}`);
    counts[state] = count ?? 0;
  }
  const label = (id: string) => investigators.get(id)?.label ?? id;
  const terminal: TerminalRow[] = (
    await loadRowsInState<OutcomeRow & { provenance_note: string | null }>("not_returned_terminal", "pmid, investigator_id, identity_method, provenance_note")
  ).map((r) => ({ pmid: r.pmid, investigator: label(r.investigator_id), identity_method: r.identity_method, provenance_note: r.provenance_note }));
  const watch: WatchRow[] = (
    await loadRowsInState<OutcomeRow & { publication_date: string | null; title: string }>("not_returned", "pmid, investigator_id, identity_method, publication_date, title")
  ).map((r) => ({ pmid: r.pmid, investigator: label(r.investigator_id), identity_method: r.identity_method, publication_date: r.publication_date, title: r.title }));

  const index = await loadMeshIndex();
  const distribution = computeCorpusDistribution(index, await loadCorpusRows());

  const section = formatCoverageSection(counts, terminal, new Date().toISOString(), { watch, distribution });
  console.log(section);
  if (WRITE_INVENTORY) {
    const existing = existsSync(INVENTORY_PATH) ? readFileSync(INVENTORY_PATH, "utf8") : "";
    writeFileSync(INVENTORY_PATH, spliceCoverageSection(existing, section));
    console.error(`wrote ${COVERAGE_HEADING} to ${INVENTORY_PATH}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const investigators = await loadInvestigators();
  if (REPORT) {
    await report(investigators);
    return;
  }

  const { fetchPubmedRecordsXml } = await import("../src/lib/community/pubmed-ingest");
  const { rows: pending, migrationApplied } = await loadPendingRows();
  let pmids = distinctPmids(pending);
  if (LIMIT != null) pmids = pmids.slice(0, LIMIT);
  const calls = expectedEfetchCalls(pmids.length, BATCH);

  console.error(
    `${pending.length} pending verified rows → ${pmids.length} distinct PMIDs → ${calls} efetch call${calls === 1 ? "" : "s"} at ${BATCH}/call, ≥ ${INTERVAL_MS} ms apart` +
      (DRY_RUN ? "  [dry run: nothing will be written]" : "") +
      (FORCE ? "  [--force: listed PMIDs re-fetched regardless of state]" : "") +
      (migrationApplied ? "" : "  [migration not applied]")
  );
  if (!process.env.NCBI_CONTACT_EMAIL?.trim()) console.error("note: NCBI_CONTACT_EMAIL is not set; NCBI asks for tool= and email= on bulk traffic");
  if (!pmids.length) return;

  const totals: Record<MeshFetchState, number> = { pending: 0, indexed: 0, no_mesh: 0, not_returned: 0, not_returned_terminal: 0 };
  const terminalThisRun: Array<{ pmid: string; investigator: string }> = [];
  let rowsWritten = 0;
  let batchNo = 0;
  let pmidsWritten = 0;
  let lastReturnedPmid: string | null = null;
  const retryStats = { batches: 0, reRequested: 0, recovered: 0 };

  for (const batch of chunk(pmids, BATCH)) {
    batchNo += 1;
    const xmlByPmid = await fetchPubmedRecordsXml(batch, { batchSize: BATCH });

    // PR 0.2a: confirm misses with a targeted retry before anything is stamped.
    const missing = batch.filter((pmid) => !xmlByPmid.has(pmid));
    let retryReturned: string[] = [];
    // Null on the first batch of a run whose first response returned nothing: the retry then has to prove health by itself.
    let canary: string | null = null;
    if (missing.length) {
      canary = batch.find((pmid) => xmlByPmid.has(pmid)) ?? lastReturnedPmid;
      const retried = await fetchPubmedRecordsXml(canary ? [...missing, canary] : missing, { batchSize: BATCH });
      retryReturned = Array.from(retried.keys());
      for (const [pmid, xml] of retried) xmlByPmid.set(pmid, xml);
      retryStats.batches += 1;
      retryStats.reRequested += missing.length;
      retryStats.recovered += missing.filter((pmid) => retried.has(pmid)).length;
    }
    const decision = decideBatchMisses({ requested: batch.length, missing, retryReturned, canary });
    if (decision.action === "abort") {
      console.error(formatBatchAbort(batchNo, calls, batch, decision, pmids.length - pmidsWritten));
      process.exit(2);
    }
    lastReturnedPmid = batch.find((pmid) => xmlByPmid.has(pmid)) ?? lastReturnedPmid;

    const fetchedAt = new Date().toISOString();
    const rows = await loadRowsForPmids(batch, migrationApplied);
    const byPmid = new Map<string, PublicationRowState[]>();
    for (const r of rows) {
      const list = byPmid.get(r.pmid) ?? [];
      list.push(r);
      byPmid.set(r.pmid, list);
    }

    const updates: Array<PublicationRowRef & Omit<PubmedCaptureFields, "mesh_fetch_outcome"> & { mesh_fetch_outcome: MeshFetchState }> = [];
    for (const pmid of batch) {
      const xml = xmlByPmid.get(pmid) ?? null;
      const shared = captureFieldsFromXml(xml, null, fetchedAt);
      const dryRows: DryRunRow[] = [];
      for (const row of byPmid.get(pmid) ?? []) {
        const inv = investigators.get(row.investigator_id);
        const fields = inv ? captureFieldsFromXml(xml, inv.subject, fetchedAt) : shared;
        const state = nextFetchState(row.mesh_fetch_outcome, fields.mesh_fetch_outcome);
        totals[state] += 1;
        if (state === "not_returned_terminal") terminalThisRun.push({ pmid, investigator: inv?.label ?? row.investigator_id });
        if (DRY_RUN) {
          dryRows.push({ investigator: inv?.label ?? row.investigator_id, author_position: fields.author_position, author_position_method: fields.author_position_method, state });
        } else {
          updates.push({ investigator_id: row.investigator_id, pmid: row.pmid, ...fields, mesh_fetch_outcome: state });
        }
      }
      if (DRY_RUN) console.log(formatDryRunRecord(pmid, shared, dryRows));
    }

    if (!DRY_RUN && updates.length) {
      for (const part of chunk(updates, UPSERT_CHUNK)) {
        const { error } = await supabase.from("investigator_publications").upsert(part, { onConflict: "investigator_id,pmid" });
        if (error) throw new Error(`upsert failed in batch ${batchNo}: ${error.message}`);
        rowsWritten += part.length;
      }
    }
    pmidsWritten += batch.length;
    console.error(
      `batch ${batchNo}/${calls}: ${batch.length} PMIDs → first response ${batch.length - missing.length}` +
        (missing.length ? `, re-requested ${missing.length} → recovered ${missing.length - decision.stillMissing.length}, confirmed absent ${decision.stillMissing.length}` : ", none missing") +
        (DRY_RUN ? "" : `; ${updates.length} rows written`)
    );
  }

  console.error(
    `\ndone: ${pmids.length} PMIDs; rows — indexed ${totals.indexed}, no MeSH yet ${totals.no_mesh}, not returned ${totals.not_returned}, terminal ${totals.not_returned_terminal}` +
      (DRY_RUN ? " (dry run, nothing written)" : `; ${rowsWritten} rows updated`) +
      (retryStats.batches ? `; retries: ${retryStats.reRequested} PMIDs re-requested across ${retryStats.batches} batch(es), ${retryStats.recovered} recovered` : "; no misses, no retries")
  );
  if (terminalThisRun.length) {
    console.error(`\nTERMINAL this run — PubMed did not return these twice; check the linkage (also listed by --report):`);
    for (const t of terminalThisRun) console.error(`  ${t.pmid}  ${t.investigator}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
