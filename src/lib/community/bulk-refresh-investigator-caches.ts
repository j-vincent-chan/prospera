import type { SupabaseClient } from "@supabase/supabase-js";
import { recomputeCoauthorshipFromPublications } from "@/lib/community/collaborations";
import { pruneInvalidInvestigatorPubmedCache } from "@/lib/community/pubmed-ingest";
import { resolvePubmedInvestigatorName } from "@/lib/community/pubmed-query";
import { syncInvestigatorCommunitySignalsFromCaches } from "@/lib/community/sync-community-signals-from-caches";
import { refreshInvestigatorSources, type SourceRefreshOutcome } from "@/lib/investigators/refresh-sources";
import { runWorkerPool } from "@/lib/utils/async-rate-limiter";

const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 12;

export type BulkRefreshInvestigatorCachesResult = {
  totalInvestigators: number;
  concurrency: number;
  pubmedOk: number;
  pubmedErr: number;
  reporterOk: number;
  reporterSkippedNoProfile: number;
  reporterErr: number;
  clinicalTrialsOk: number;
  clinicalTrialsErr: number;
  profilesOk: number;
  profilesSkipped: number;
  profilesErr: number;
  orcidOk: number;
  orcidSkipped: number;
  orcidErr: number;
  pubmedErrors: { id: string; message: string }[];
  reporterErrors: { id: string; message: string }[];
  clinicalTrialsErrors: { id: string; message: string }[];
  connectorErrors: { id: string; message: string }[];
};

function pushErr(
  list: { id: string; message: string }[],
  id: string,
  message: string
) {
  if (list.length < 25) list.push({ id, message });
}

/** Resolve parallel investigator workers (1–12). */
export function resolveBulkRefreshConcurrency(value?: number): number {
  if (value != null && Number.isFinite(value)) {
    return Math.max(1, Math.min(MAX_CONCURRENCY, Math.floor(value)));
  }
  const env = process.env.BULK_REFRESH_CONCURRENCY?.trim();
  const fromEnv = env ? parseInt(env, 10) : NaN;
  if (Number.isFinite(fromEnv)) {
    return Math.max(1, Math.min(MAX_CONCURRENCY, fromEnv));
  }
  return DEFAULT_CONCURRENCY;
}

async function fetchAllInvestigatorIds(supabase: SupabaseClient): Promise<string[]> {
  const ids: string[] = [];
  const pageSize = 500;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("investigators")
      .select("id")
      .is("archived_at", null)
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const r of rows) {
      if (r.id) ids.push(String(r.id));
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return ids;
}

type MutableBulkResult = BulkRefreshInvestigatorCachesResult;

async function fetchInvestigatorPubmedName(
  supabase: SupabaseClient,
  id: string
): Promise<{
  firstName: string;
  lastName: string;
  middleInitial: string | null;
  fullName: string;
} | null> {
  const { data, error } = await supabase
    .from("investigators")
    .select("first_name,last_name,middle_initial,full_name")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return {
    firstName: String(data.first_name ?? "").trim(),
    lastName: String(data.last_name ?? "").trim(),
    middleInitial: data.middle_initial ? String(data.middle_initial).trim() : null,
    fullName: data.full_name ?? "",
  };
}

function tally(result: MutableBulkResult, id: string, o: SourceRefreshOutcome) {
  switch (o.source) {
    case "pubmed":
      if (o.ok) result.pubmedOk += 1;
      else {
        result.pubmedErr += 1;
        pushErr(result.pubmedErrors, id, o.message);
      }
      break;
    case "reporter":
      if (!o.ok) {
        result.reporterErr += 1;
        pushErr(result.reporterErrors, id, o.message);
      } else if (o.skipped) result.reporterSkippedNoProfile += 1;
      else result.reporterOk += 1;
      break;
    case "trials":
      if (o.ok) result.clinicalTrialsOk += 1;
      else {
        result.clinicalTrialsErr += 1;
        pushErr(result.clinicalTrialsErrors, id, o.message);
      }
      break;
    case "profiles":
      if (!o.ok) {
        result.profilesErr += 1;
        pushErr(result.connectorErrors, id, o.message);
      } else if (o.skipped) result.profilesSkipped += 1;
      else result.profilesOk += 1;
      break;
    case "orcid":
      if (!o.ok) {
        result.orcidErr += 1;
        pushErr(result.connectorErrors, id, o.message);
      } else if (o.skipped) result.orcidSkipped += 1;
      else result.orcidOk += 1;
      break;
  }
}

async function refreshOneInvestigatorCaches(
  supabase: SupabaseClient,
  id: string,
  result: MutableBulkResult
): Promise<void> {
  const invName = await fetchInvestigatorPubmedName(supabase, id);
  if (invName) {
    try {
      await pruneInvalidInvestigatorPubmedCache(supabase, id, resolvePubmedInvestigatorName(invName));
    } catch {
      // Best-effort cleanup before refresh.
    }
  }

  const outcomes = await refreshInvestigatorSources(supabase, id, "all");
  for (const o of outcomes) tally(result, id, o);

  try {
    await syncInvestigatorCommunitySignalsFromCaches(supabase, id);
  } catch {
    // Community signal sync is best-effort during bulk refresh.
  }
}

/**
 * Refresh every investigator's sources — UCSF Profiles, ORCID, NIH RePORTER,
 * PubMed and ClinicalTrials.gov — then recompute co-authorship edges.
 *
 * Per investigator the connectors run first, then the three evidence APIs in
 * parallel. Multiple investigators run concurrently up to `concurrency`;
 * global rate limiters serialize each external API. Logged to sync_job_logs
 * as `investigator_sources`.
 */
export async function refreshAllInvestigatorsCommunityCaches(
  supabase: SupabaseClient,
  opts: { concurrency?: number } = {}
): Promise<BulkRefreshInvestigatorCachesResult> {
  const concurrency = resolveBulkRefreshConcurrency(opts.concurrency);
  const ids = await fetchAllInvestigatorIds(supabase);

  const { data: log } = await supabase
    .from("sync_job_logs")
    .insert({ job_type: "investigator_sources", status: "started", details: { investigators: ids.length, concurrency } })
    .select("id")
    .single();
  const logId = (log as { id?: string } | null)?.id ?? null;

  const result: BulkRefreshInvestigatorCachesResult = {
    totalInvestigators: ids.length,
    concurrency,
    pubmedOk: 0,
    pubmedErr: 0,
    reporterOk: 0,
    reporterSkippedNoProfile: 0,
    reporterErr: 0,
    clinicalTrialsOk: 0,
    clinicalTrialsErr: 0,
    profilesOk: 0,
    profilesSkipped: 0,
    profilesErr: 0,
    orcidOk: 0,
    orcidSkipped: 0,
    orcidErr: 0,
    pubmedErrors: [],
    reporterErrors: [],
    clinicalTrialsErrors: [],
    connectorErrors: [],
  };

  try {
    await runWorkerPool(ids, concurrency, async (id) => {
      await refreshOneInvestigatorCaches(supabase, id, result);
    });

    await recomputeCoauthorshipFromPublications(supabase);

    if (logId) {
      await supabase
        .from("sync_job_logs")
        .update({ status: "success", message: formatBulkRefreshSummary(result), details: result as unknown as Record<string, unknown>, finished_at: new Date().toISOString() })
        .eq("id", logId);
    }
  } catch (e) {
    if (logId) {
      await supabase
        .from("sync_job_logs")
        .update({ status: "error", message: e instanceof Error ? e.message : String(e), finished_at: new Date().toISOString() })
        .eq("id", logId);
    }
    throw e;
  }

  return result;
}

export function formatBulkRefreshSummary(r: BulkRefreshInvestigatorCachesResult): string {
  const lines = [
    `Investigators processed: ${r.totalInvestigators} (concurrency ${r.concurrency})`,
    `UCSF Profiles: ${r.profilesOk} matched, ${r.profilesSkipped} not found, ${r.profilesErr} failed`,
    `ORCID: ${r.orcidOk} fetched, ${r.orcidSkipped} without an iD, ${r.orcidErr} failed`,
    `PubMed: ${r.pubmedOk} ok, ${r.pubmedErr} failed`,
    `RePORTER: ${r.reporterOk} refreshed, ${r.reporterSkippedNoProfile} skipped (no NIH profile id), ${r.reporterErr} failed`,
    `ClinicalTrials.gov: ${r.clinicalTrialsOk} ok, ${r.clinicalTrialsErr} failed`,
    `Co-authorship graph recomputed from shared publications.`,
  ];
  if (r.pubmedErrors.length) {
    lines.push(`PubMed sample errors: ${r.pubmedErrors.map((e) => `${e.id.slice(0, 8)}… ${e.message}`).join(" | ")}`);
  }
  if (r.reporterErrors.length) {
    lines.push(
      `RePORTER sample errors: ${r.reporterErrors.map((e) => `${e.id.slice(0, 8)}… ${e.message}`).join(" | ")}`
    );
  }
  if (r.clinicalTrialsErrors.length) {
    lines.push(
      `ClinicalTrials.gov sample errors: ${r.clinicalTrialsErrors.map((e) => `${e.id.slice(0, 8)}… ${e.message}`).join(" | ")}`
    );
  }
  if (r.connectorErrors.length) {
    lines.push(`Connector sample errors: ${r.connectorErrors.map((e) => `${e.id.slice(0, 8)}… ${e.message}`).join(" | ")}`);
  }
  return lines.join("\n");
}
