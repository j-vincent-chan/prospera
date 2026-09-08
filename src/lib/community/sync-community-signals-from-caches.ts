import type { SupabaseClient } from "@supabase/supabase-js";
import { clinicalTrialsStudyUrl } from "@/lib/community/clinicaltrials-ingest";
import {
  deleteInvestigatorPubmedPmids,
  filterPubmedPmidsForInvestigator,
} from "@/lib/community/pubmed-ingest";
import { resolvePubmedInvestigatorName } from "@/lib/community/pubmed-query";
import { isNihNewGrantByProjectNum } from "@/lib/community/signal-nih-funding";
import {
  dateToPublishedAt,
  fiscalYearToPublishedAt,
  prosperaClinicalTrialsCacheKey,
  prosperaCommunityItemId,
  prosperaPubmedCacheKey,
  prosperaReporterCacheKey,
} from "@/lib/community/prospera-community-item-id";
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";
import { chunkIdsForInFilter } from "@/lib/supabase/id-filter-chunks";
import { postgrestErrorMessage } from "@/lib/supabase/postgrest-error";

export type SyncCommunitySignalsResult = {
  investigatorId: string;
  publicationsSynced: number;
  grantsSynced: number;
  clinicalTrialsSynced: number;
  removedStale: number;
  removedLegacySignalPubmed: number;
};

export type SyncAllCommunitySignalsResult = {
  investigatorsProcessed: number;
  publicationsSynced: number;
  grantsSynced: number;
  clinicalTrialsSynced: number;
  removedStale: number;
  removedLegacySignalPubmed: number;
  errors: { investigatorId: string; message: string }[];
};

type PublicationRow = {
  pmid: string;
  title: string | null;
  journal: string | null;
  publication_date: string | null;
  created_at: string | null;
};

type GrantRow = {
  project_num: string;
  fiscal_year: number;
  project_title: string | null;
  ic_name: unknown;
  created_at: string | null;
};

type ClinicalTrialRow = {
  nct_id: string;
  title: string | null;
  overall_status: string | null;
  conditions: unknown;
  lead_sponsor: string | null;
  start_date: string | null;
  last_update_date: string | null;
  brief_summary: string | null;
  created_at: string | null;
};

/** community_source_items rows written per upsert request (PostgREST body size). */
const UPSERT_CHUNK_SIZE = 500;

/**
 * Delete rows by id in `.in()`-sized batches. One request per id would be slow
 * and one request for every id builds a URL the Supabase gateway rejects.
 */
async function deleteCommunityItemsByIds(
  supabase: SupabaseClient,
  ids: string[],
  context: string
): Promise<void> {
  for (const chunk of chunkIdsForInFilter(ids)) {
    const { error } = await supabase.from("community_source_items").delete().in("id", chunk);
    if (error) throw new Error(postgrestErrorMessage(`${context} (${chunk.length} rows)`, error));
  }
}

function parseSignalEntityId(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const id = (raw as { signal_entity_id?: unknown }).signal_entity_id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

async function removeLegacySignalPubmedItems(
  supabase: SupabaseClient,
  signalEntityId: string | null
): Promise<number> {
  const candidateIds = new Set<string>();

  if (signalEntityId) {
    const { data: byEntity, error: byEntityErr } = await supabase
      .from("community_source_items")
      .select("id")
      .eq("origin", "signal")
      .eq("source_type", "pubmed")
      .eq("signal_tracked_entity_id", signalEntityId);
    if (byEntityErr)
      throw new Error(
        postgrestErrorMessage("community_source_items lookup (legacy Signal PubMed rows)", byEntityErr)
      );
    for (const row of byEntity ?? []) {
      if (row.id) candidateIds.add(String(row.id));
    }

    const { data: linked, error: linkedErr } = await supabase
      .from("community_source_item_entities")
      .select("source_item_id")
      .eq("signal_entity_id", signalEntityId);
    if (linkedErr)
      throw new Error(
        postgrestErrorMessage("community_source_item_entities lookup (legacy Signal PubMed links)", linkedErr)
      );
    const linkedIds = (linked ?? []).map((row) => String(row.source_item_id ?? "")).filter(Boolean);
    for (const chunk of chunkIdsForInFilter(linkedIds)) {
      const { data: linkedItems, error: linkedItemsErr } = await supabase
        .from("community_source_items")
        .select("id")
        .eq("origin", "signal")
        .eq("source_type", "pubmed")
        .in("id", chunk);
      if (linkedItemsErr)
        throw new Error(
          postgrestErrorMessage(
            `community_source_items lookup (linked legacy Signal PubMed rows, ${chunk.length} ids)`,
            linkedItemsErr
          )
        );
      for (const row of linkedItems ?? []) {
        if (row.id) candidateIds.add(String(row.id));
      }
    }
  }

  const ids = Array.from(candidateIds);
  if (ids.length === 0) return 0;

  await deleteCommunityItemsByIds(
    supabase,
    ids,
    "community_source_items delete (legacy Signal PubMed rows)"
  );
  return ids.length;
}

function conditionsSummary(conditions: unknown): string | null {
  if (!Array.isArray(conditions)) return null;
  const parts = conditions
    .map((c) => (typeof c === "string" ? c.trim() : ""))
    .filter(Boolean)
    .slice(0, 5);
  return parts.length > 0 ? parts.join("; ") : null;
}

function icNameLabel(ic: unknown): string | null {
  if (typeof ic === "string" && ic.trim()) return ic.trim();
  if (Array.isArray(ic) && ic.length > 0) {
    const first = ic[0];
    if (typeof first === "string" && first.trim()) return first.trim();
  }
  return null;
}

function reporterProjectUrl(projectNum: string, fiscalYear: number): string {
  const encodedProjectNum = encodeURIComponent(projectNum);
  return `https://reporter.nih.gov/search/projects?projectNum=${encodedProjectNum}&fiscalYear=${fiscalYear}`;
}

/**
 * Mirror investigator PubMed, RePORTER, and ClinicalTrials.gov caches into community_source_items
 * so the Community dashboard works without a Signal account.
 */
export async function syncInvestigatorCommunitySignalsFromCaches(
  supabase: SupabaseClient,
  investigatorId: string
): Promise<SyncCommunitySignalsResult> {
  const { data: inv, error: invErr } = await supabase
    .from("investigators")
    .select("first_name,last_name,middle_initial,full_name,raw_profile_json")
    .eq("id", investigatorId)
    .maybeSingle();
  if (invErr) throw new Error(postgrestErrorMessage("investigators lookup", invErr));
  if (!inv) throw new Error("Investigator not found");

  const investigatorName = resolvePubmedInvestigatorName({
    firstName: String(inv.first_name ?? "").trim(),
    lastName: String(inv.last_name ?? "").trim(),
    middleInitial: inv.middle_initial ? String(inv.middle_initial).trim() : null,
    fullName: inv.full_name ?? "",
  });

  const [
    { data: publications, error: pubErr },
    { data: grants, error: grantErr },
    { data: trials, error: trialErr },
  ] = await Promise.all([
    supabase
      .from("investigator_publications")
      .select("pmid,title,journal,publication_date,created_at")
      .eq("investigator_id", investigatorId)
      .eq("source", "pubmed_eutils"),
    supabase
      .from("investigator_nih_grants")
      .select("project_num,fiscal_year,project_title,ic_name,created_at")
      .eq("investigator_id", investigatorId),
    supabase
      .from("investigator_clinical_trials")
      .select(
        "nct_id,title,overall_status,conditions,lead_sponsor,start_date,last_update_date,brief_summary,created_at"
      )
      .eq("investigator_id", investigatorId),
  ]);

  if (pubErr) throw new Error(postgrestErrorMessage("investigator_publications lookup", pubErr));
  if (grantErr) throw new Error(postgrestErrorMessage("investigator_nih_grants lookup", grantErr));
  if (trialErr) throw new Error(postgrestErrorMessage("investigator_clinical_trials lookup", trialErr));

  const publicationRows = (publications ?? []) as PublicationRow[];
  const pubPmids = publicationRows.map((pub) => pub.pmid?.trim()).filter(Boolean) as string[];
  const { validated: validatedPubPmids, rejected: rejectedPubPmids } =
    await filterPubmedPmidsForInvestigator(pubPmids, investigatorName);
  if (rejectedPubPmids.length > 0) {
    await deleteInvestigatorPubmedPmids(supabase, investigatorId, rejectedPubPmids);
  }
  const validatedPubSet = new Set(validatedPubPmids);

  const now = new Date().toISOString();
  const activeKeys = new Set<string>();
  const upsertRows: Record<string, unknown>[] = [];

  for (const pub of publicationRows) {
    const pmid = pub.pmid?.trim();
    if (!pmid || !validatedPubSet.has(pmid)) continue;
    const cacheKey = prosperaPubmedCacheKey(investigatorId, pmid);
    activeKeys.add(cacheKey);
    upsertRows.push({
      id: prosperaCommunityItemId("pubmed", cacheKey),
      origin: "prospera",
      prospera_investigator_id: investigatorId,
      prospera_cache_key: cacheKey,
      title: (pub.title ?? "").trim() || "(untitled)",
      category: "paper",
      source_type: "pubmed",
      status: "approved",
      published_at: dateToPublishedAt(pub.publication_date),
      found_at: pub.created_at ?? now,
      source_url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      source_domain: "pubmed.ncbi.nlm.nih.gov",
      raw_summary: pub.journal?.trim() ? pub.journal.trim() : null,
      signal_created_at: pub.created_at ?? now,
      imported_at: now,
    });
  }

  for (const grant of (grants ?? []) as GrantRow[]) {
    const projectNum = grant.project_num?.trim();
    const fiscalYear = grant.fiscal_year;
    if (!projectNum || !Number.isFinite(fiscalYear)) continue;
    if (!isNihNewGrantByProjectNum(projectNum)) continue;
    const cacheKey = prosperaReporterCacheKey(investigatorId, projectNum, fiscalYear);
    activeKeys.add(cacheKey);
    const ic = icNameLabel(grant.ic_name);
    const title = (grant.project_title ?? "").trim() || projectNum;
    upsertRows.push({
      id: prosperaCommunityItemId("reporter", cacheKey),
      origin: "prospera",
      prospera_investigator_id: investigatorId,
      prospera_cache_key: cacheKey,
      title,
      category: "funding",
      source_type: "reporter",
      status: "approved",
      published_at: fiscalYearToPublishedAt(fiscalYear),
      found_at: grant.created_at ?? now,
      source_url: reporterProjectUrl(projectNum, fiscalYear),
      source_domain: "reporter.nih.gov",
      raw_summary: ic ?? null,
      nih_project_num: projectNum,
      signal_created_at: grant.created_at ?? now,
      imported_at: now,
    });
  }

  for (const trial of (trials ?? []) as ClinicalTrialRow[]) {
    const nctId = trial.nct_id?.trim().toUpperCase();
    if (!nctId) continue;
    const cacheKey = prosperaClinicalTrialsCacheKey(investigatorId, nctId);
    activeKeys.add(cacheKey);
    const status = trial.overall_status?.trim();
    const cond = conditionsSummary(trial.conditions);
    const summaryParts = [status, cond, trial.lead_sponsor?.trim()].filter(Boolean);
    upsertRows.push({
      id: prosperaCommunityItemId("clinicaltrials", cacheKey),
      origin: "prospera",
      prospera_investigator_id: investigatorId,
      prospera_cache_key: cacheKey,
      title: (trial.title ?? "").trim() || nctId,
      category: "trial",
      source_type: "clinicaltrials_gov",
      status: "approved",
      published_at: dateToPublishedAt(trial.start_date) ?? dateToPublishedAt(trial.last_update_date),
      found_at: trial.created_at ?? now,
      source_url: clinicalTrialsStudyUrl(nctId),
      source_domain: "clinicaltrials.gov",
      raw_summary: summaryParts.length > 0 ? summaryParts.join(" · ") : null,
      raw_text: trial.brief_summary?.trim() || null,
      signal_created_at: trial.created_at ?? now,
      imported_at: now,
    });
  }

  for (let i = 0; i < upsertRows.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = upsertRows.slice(i, i + UPSERT_CHUNK_SIZE);
    const { error: upsertErr } = await supabase
      .from("community_source_items")
      .upsert(chunk, { onConflict: "id" });
    if (upsertErr)
      throw new Error(
        postgrestErrorMessage(`community_source_items upsert (${chunk.length} rows)`, upsertErr)
      );
  }

  // Paginated: an investigator can hold more mirrored rows than PostgREST's
  // 1000-row default, and a truncated list leaves stale rows behind forever.
  const { data: existingProspera, error: listErr } = await fetchAllRows<{
    id: string;
    prospera_cache_key: string | null;
  }>(async (from, to) => {
    const res = await supabase
      .from("community_source_items")
      .select("id, prospera_cache_key")
      .eq("origin", "prospera")
      .eq("prospera_investigator_id", investigatorId)
      .order("id", { ascending: true })
      .range(from, to);
    return {
      data: (res.data ?? []) as { id: string; prospera_cache_key: string | null }[],
      error: res.error,
    };
  });

  if (listErr)
    throw new Error(
      postgrestErrorMessage("community_source_items lookup (Prospera rows)", { message: listErr })
    );

  const staleIds = (existingProspera ?? [])
    .filter((row) => {
      const key = row.prospera_cache_key as string | null;
      return key && !activeKeys.has(key);
    })
    .map((row) => row.id as string);

  await deleteCommunityItemsByIds(
    supabase,
    staleIds,
    "community_source_items delete (stale Prospera rows)"
  );

  const removedLegacySignalPubmed = await removeLegacySignalPubmedItems(
    supabase,
    parseSignalEntityId(inv.raw_profile_json)
  );

  return {
    investigatorId,
    publicationsSynced: (publications ?? []).length,
    grantsSynced: (grants ?? []).length,
    clinicalTrialsSynced: (trials ?? []).length,
    removedStale: staleIds.length,
    removedLegacySignalPubmed,
  };
}

async function fetchAllInvestigatorIds(supabase: SupabaseClient): Promise<string[]> {
  const ids: string[] = [];
  const pageSize = 500;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("investigators")
      .select("id")
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(postgrestErrorMessage("investigators id page", error));
    const rows = data ?? [];
    for (const r of rows) ids.push(String(r.id));
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return ids;
}

export async function syncAllCommunitySignalsFromCaches(
  supabase: SupabaseClient
): Promise<SyncAllCommunitySignalsResult> {
  const ids = await fetchAllInvestigatorIds(supabase);
  const result: SyncAllCommunitySignalsResult = {
    investigatorsProcessed: ids.length,
    publicationsSynced: 0,
    grantsSynced: 0,
    clinicalTrialsSynced: 0,
    removedStale: 0,
    removedLegacySignalPubmed: 0,
    errors: [],
  };

  for (const id of ids) {
    try {
      const one = await syncInvestigatorCommunitySignalsFromCaches(supabase, id);
      result.publicationsSynced += one.publicationsSynced;
      result.grantsSynced += one.grantsSynced;
      result.clinicalTrialsSynced += one.clinicalTrialsSynced;
      result.removedStale += one.removedStale;
      result.removedLegacySignalPubmed += one.removedLegacySignalPubmed;
    } catch (e) {
      if (result.errors.length < 25) {
        result.errors.push({
          investigatorId: id,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  return result;
}

export function formatSyncCommunitySignalsSummary(r: SyncAllCommunitySignalsResult): string {
  const lines = [
    `Investigators processed: ${r.investigatorsProcessed}`,
    `Publications mirrored: ${r.publicationsSynced}`,
    `NIH grants mirrored: ${r.grantsSynced}`,
    `Clinical trials mirrored: ${r.clinicalTrialsSynced}`,
    `Stale Prospera signals removed: ${r.removedStale}`,
    `Legacy Signal PubMed rows removed: ${r.removedLegacySignalPubmed}`,
  ];
  if (r.errors.length) {
    lines.push(
      `Errors (${r.errors.length}): ${r.errors.map((e) => `${e.investigatorId.slice(0, 8)}… ${e.message}`).join(" | ")}`
    );
  }
  return lines.join("\n");
}
