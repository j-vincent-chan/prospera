/**
 * Mirror the investigator evidence caches into `community_source_items`.
 *
 * This importer reads the caches and writes only the community feed. It does
 * not decide identity and does not call PubMed: a publication is mirrored when
 * `identity_status = 'verified'`, whichever ladder rung verified it (D11 —
 * affiliation, ORCID `[auid]` or RePORTER linkage). Re-checking affiliation
 * here would drop every ORCID- and RePORTER-verified paper, because those are
 * verified by identifier rather than by an affiliation string on the record.
 *
 * Affiliation self-heal lives in the ingest path instead:
 * `pruneInvalidInvestigatorPubmedCache`, called by `refreshInvestigatorPubMed`,
 * re-checks unreviewed affiliation rows and removes the ones that no longer
 * match. That is the only writer that deletes from `investigator_publications`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { clinicalTrialsStudyUrl } from "@/lib/community/clinicaltrials-ingest";
import { isNihNewGrantByProjectNum } from "@/lib/community/signal-nih-funding";
import {
  dateToPublishedAt,
  fiscalYearToPublishedAt,
  prosperaClinicalTrialsCacheKey,
  prosperaCommunityItemId,
  prosperaPubmedCacheKey,
  prosperaReporterCacheKey,
} from "@/lib/community/prospera-community-item-id";

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
  identity_status: string | null;
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
    if (byEntityErr) throw new Error(byEntityErr.message);
    for (const row of byEntity ?? []) {
      if (row.id) candidateIds.add(String(row.id));
    }

    const { data: linked, error: linkedErr } = await supabase
      .from("community_source_item_entities")
      .select("source_item_id")
      .eq("signal_entity_id", signalEntityId);
    if (linkedErr) throw new Error(linkedErr.message);
    const linkedIds = (linked ?? []).map((row) => String(row.source_item_id ?? "")).filter(Boolean);
    if (linkedIds.length > 0) {
      const { data: linkedItems, error: linkedItemsErr } = await supabase
        .from("community_source_items")
        .select("id")
        .eq("origin", "signal")
        .eq("source_type", "pubmed")
        .in("id", linkedIds);
      if (linkedItemsErr) throw new Error(linkedItemsErr.message);
      for (const row of linkedItems ?? []) {
        if (row.id) candidateIds.add(String(row.id));
      }
    }
  }

  const ids = Array.from(candidateIds);
  if (ids.length === 0) return 0;

  const { error: delErr } = await supabase.from("community_source_items").delete().in("id", ids);
  if (delErr) throw new Error(delErr.message);
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
  if (invErr) throw new Error(invErr.message);
  if (!inv) throw new Error("Investigator not found");

  const [
    { data: publications, error: pubErr },
    { data: grants, error: grantErr },
    { data: trials, error: trialErr },
  ] = await Promise.all([
    supabase
      .from("investigator_publications")
      .select("pmid,title,journal,publication_date,created_at,identity_status")
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

  if (pubErr) throw new Error(pubErr.message);
  if (grantErr) throw new Error(grantErr.message);
  if (trialErr) throw new Error(trialErr.message);

  const publicationRows = (publications ?? []) as PublicationRow[];

  const now = new Date().toISOString();
  const activeKeys = new Set<string>();
  const upsertRows: Record<string, unknown>[] = [];

  let publicationsMirrored = 0;
  for (const pub of publicationRows) {
    const pmid = pub.pmid?.trim();
    // Unverified name-only hits stay as evidence for a strategist to confirm;
    // they are not community signals until someone verifies them.
    if (!pmid || pub.identity_status !== "verified") continue;
    publicationsMirrored += 1;
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

  if (upsertRows.length > 0) {
    const { error: upsertErr } = await supabase
      .from("community_source_items")
      .upsert(upsertRows, { onConflict: "id" });
    if (upsertErr) throw new Error(upsertErr.message);
  }

  const { data: existingProspera, error: listErr } = await supabase
    .from("community_source_items")
    .select("id, prospera_cache_key")
    .eq("origin", "prospera")
    .eq("prospera_investigator_id", investigatorId);

  if (listErr) throw new Error(listErr.message);

  const staleIds = (existingProspera ?? [])
    .filter((row) => {
      const key = row.prospera_cache_key as string | null;
      return key && !activeKeys.has(key);
    })
    .map((row) => row.id as string);

  if (staleIds.length > 0) {
    const { error: delErr } = await supabase
      .from("community_source_items")
      .delete()
      .in("id", staleIds);
    if (delErr) throw new Error(delErr.message);
  }

  const removedLegacySignalPubmed = await removeLegacySignalPubmedItems(
    supabase,
    parseSignalEntityId(inv.raw_profile_json)
  );

  return {
    investigatorId,
    publicationsSynced: publicationsMirrored,
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
    if (error) throw new Error(error.message);
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
