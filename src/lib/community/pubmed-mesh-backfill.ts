/**
 * Pure helpers for scripts/fit-backfill-pubmed-mesh.ts (PR 0.2): which rows are
 * pending, how a fetch outcome becomes the stored state, how PMIDs are
 * deduplicated and batched, what the dry run and the coverage report print.
 */
import type { PubmedCaptureFields, PubmedMeshFetchOutcome } from "@/lib/community/pubmed-record";

/** Rows whose mesh is still empty are retried once mesh_fetched_at is older than this. */
export const MESH_RETRY_AFTER_DAYS = 30;
/** NCBI asks for POST above ~200 ids per efetch; the backfill runs at exactly that. */
export const BACKFILL_EFETCH_BATCH = 200;
/** Plan PR 0.2: ≥ 350 ms between E-utilities calls, API key or not. */
export const BACKFILL_MIN_INTERVAL_MS = 350;

/**
 * investigator_publications.mesh_fetch_outcome. `pending` = never fetched.
 * `not_returned` is retried once; a second miss is `not_returned_terminal` —
 * a PMID PubMed does not have is a bad linkage or a withdrawn record, not an
 * in-process one, and re-requesting it monthly would never resolve it.
 */
export const MESH_FETCH_STATES = ["pending", "indexed", "no_mesh", "not_returned", "not_returned_terminal"] as const;
export type MeshFetchState = (typeof MESH_FETCH_STATES)[number];

export type PublicationRowRef = { investigator_id: string; pmid: string };
export type PublicationRowState = PublicationRowRef & { mesh_fetch_outcome: MeshFetchState | null };

export function meshRetryCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - MESH_RETRY_AFTER_DAYS * 24 * 60 * 60 * 1000);
}

/** PostgREST `or()` for the pending predicate: never fetched, or empty-mesh rows past the cutoff that are not terminal. */
export function pendingFilter(now: Date = new Date()): string {
  return `mesh_fetch_outcome.eq.pending,and(mesh_fetch_outcome.in.(no_mesh,not_returned),mesh_fetched_at.lt.${meshRetryCutoff(now).toISOString()})`;
}

/** State to store after a fetch: a second consecutive `not_returned` becomes terminal. */
export function nextFetchState(prior: MeshFetchState | null | undefined, fresh: PubmedMeshFetchOutcome): MeshFetchState {
  if (fresh !== "not_returned") return fresh;
  return prior === "not_returned" || prior === "not_returned_terminal" ? "not_returned_terminal" : "not_returned";
}

/** Numeric PMIDs, trimmed, first occurrence wins. */
export function distinctPmids(rows: Array<{ pmid: string | null | undefined }>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const pmid = String(row.pmid ?? "").trim();
    if (!/^\d+$/.test(pmid) || seen.has(pmid)) continue;
    seen.add(pmid);
    out.push(pmid);
  }
  return out;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function expectedEfetchCalls(distinctPmidCount: number, batch: number = BACKFILL_EFETCH_BATCH): number {
  return Math.ceil(distinctPmidCount / batch);
}

export type DryRunRow = { investigator: string; author_position: string; author_position_method: string; state: MeshFetchState };

/** One PMID's dry-run block: what would be stored, and each roster row's author position and state. */
export function formatDryRunRecord(pmid: string, fields: PubmedCaptureFields, rows: DryRunRow[]): string {
  const lines: string[] = [];
  const major = fields.mesh.filter((m) => m.major).length;
  const head =
    fields.mesh_fetch_outcome === "not_returned"
      ? `PMID ${pmid}  [not returned by efetch] → mesh [], publication_types [], abstract null; mesh_fetched_at stamped`
      : `PMID ${pmid}  [${fields.mesh_fetch_outcome === "indexed" ? "indexed" : "no MeSH yet (in-process)"}]  MeSH ${fields.mesh.length} (${major} major)  PT: ${fields.publication_types.join(" · ") || "—"}  abstract ${fields.abstract ? `${fields.abstract.length.toLocaleString()} chars` : "none"}`;
  lines.push(head);
  if (fields.mesh.length) {
    const names = fields.mesh.map((m) => `${m.major ? "*" : ""}${m.name}${m.qualifiers.length ? `/${m.qualifiers.join(",")}` : ""}`);
    lines.push(`    ${names.join(" · ")}`);
  }
  if (fields.abstract) lines.push(`    “${fields.abstract.slice(0, 140).replace(/\s+/g, " ")}…”`);
  for (const r of rows) {
    const terminal = r.state === "not_returned_terminal" ? "  ← TERMINAL (second miss)" : "";
    lines.push(`    row: ${r.investigator} → author_position ${r.author_position} (${r.author_position_method})${terminal}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Coverage report (INVENTORY.md § 11)
// ---------------------------------------------------------------------------

export type CoverageCounts = Record<MeshFetchState, number>;
export type TerminalRow = { pmid: string; investigator: string; identity_method: string; provenance_note: string | null };

export const COVERAGE_HEADING = "## 11. PubMed capture coverage (PR 0.2)";

/** Markdown for INVENTORY.md § 11: rows by fetch state, then every terminal PMID for a person to look at. */
export function formatCoverageSection(counts: CoverageCounts, terminal: TerminalRow[], generatedAt: string): string {
  const total = MESH_FETCH_STATES.reduce((n, s) => n + counts[s], 0);
  const lines: string[] = [
    COVERAGE_HEADING,
    "",
    `Generated ${generatedAt} by \`npm run fit:backfill-pubmed-mesh -- --report\`. Every row of \`investigator_publications\` by \`mesh_fetch_outcome\`: pending = never fetched; indexed = MeSH stored; no_mesh = returned without MeSH (in-process, retried after 30 days); not_returned = efetch did not return the PMID (retried once); not_returned_terminal = missed twice, never re-requested.`,
    "",
    "| mesh_fetch_outcome | rows |",
    "|---|---|",
    ...MESH_FETCH_STATES.map((s) => `| ${s} | ${counts[s]} |`),
    `| (all rows) | ${total} |`,
    "",
    `Terminal PMIDs — we hold them, PubMed does not return them (bad linkage or withdrawn record; someone should look): ${terminal.length}`,
  ];
  if (terminal.length) {
    lines.push("", "| pmid | investigator | identity_method | provenance |", "|---|---|---|---|");
    for (const t of terminal) {
      lines.push(`| ${t.pmid} | ${t.investigator} | ${t.identity_method} | ${(t.provenance_note ?? "").replace(/\|/g, "\\|").slice(0, 120)} |`);
    }
  }
  return lines.join("\n") + "\n";
}
