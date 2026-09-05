/**
 * ClinicalTrials.gov ingestion via the public REST API v2.
 * Docs: https://clinicaltrials.gov/data-api/about-api
 *
 * API v2 does not support AREA[LeadInvestigator]; use quoted full-text name search
 * plus optional AREA[LocationFacility] in filter.advanced.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  searchClinicalTrialsStudiesPaginated,
  type ClinicalTrialsStudyRecord,
} from "@/lib/community/clinicaltrials-api-client";
import { designCaptureFields, parseDesign, personNameMatches } from "@/lib/community/clinicaltrials-design";

export function resolveClinicalTrialsMaxResults(optsMax?: number): number {
  const env = process.env.CLINICALTRIALS_MAX_RESULTS?.trim();
  const fromEnv = env ? parseInt(env, 10) : NaN;
  const cap = Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 500;
  if (optsMax != null && Number.isFinite(optsMax) && optsMax > 0) {
    return Math.min(cap, Math.floor(optsMax));
  }
  return cap;
}

export type ClinicalTrialsSearchQuery = {
  queryTerm: string;
  filterAdvanced?: string;
};

/** Build API v2 search using supported query.term + filter.advanced parameters. */
export function buildClinicalTrialsSearch(args: {
  fullName: string;
  clinicaltrialsQueryOverride: string | null;
  affiliation?: string | null;
}): ClinicalTrialsSearchQuery {
  if (args.clinicaltrialsQueryOverride?.trim()) {
    return { queryTerm: args.clinicaltrialsQueryOverride.trim() };
  }
  const name = args.fullName.trim();
  if (!name) return { queryTerm: "" };
  const escaped = name.replace(/"/g, "");
  const queryTerm = `"${escaped}"`;
  const aff = args.affiliation?.trim();
  const filterAdvanced = aff ? `AREA[LocationFacility]${aff}` : undefined;
  return { queryTerm, filterAdvanced };
}

/** @deprecated Use buildClinicalTrialsSearch — returns query.term only for display. */
export function buildClinicalTrialsQuery(args: {
  fullName: string;
  clinicaltrialsQueryOverride: string | null;
  affiliation?: string | null;
}): string {
  const { queryTerm, filterAdvanced } = buildClinicalTrialsSearch(args);
  if (!queryTerm) return "";
  if (filterAdvanced) return `${queryTerm} AND ${filterAdvanced}`;
  return queryTerm;
}

function parseIsoDate(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const d = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

export function parseClinicalTrialStudy(study: ClinicalTrialsStudyRecord): {
  nctId: string;
  title: string;
  overallStatus: string | null;
  conditions: string[];
  leadSponsor: string | null;
  startDate: string | null;
  lastUpdateDate: string | null;
  briefSummary: string | null;
} | null {
  const section = study.protocolSection;
  const ident = section?.identificationModule;
  const nctId = ident?.nctId?.trim().toUpperCase() ?? "";
  if (!/^NCT\d{8}$/.test(nctId)) return null;

  const title =
    (ident?.briefTitle ?? ident?.officialTitle ?? "").replace(/\s+/g, " ").trim() || nctId;
  const status = section?.statusModule;
  const conditions = (section?.conditionsModule?.conditions ?? [])
    .map((c) => (typeof c === "string" ? c.trim() : ""))
    .filter(Boolean)
    .slice(0, 12);

  return {
    nctId,
    title,
    overallStatus: status?.overallStatus?.trim() || null,
    conditions,
    leadSponsor: section?.sponsorCollaboratorsModule?.leadSponsor?.name?.trim() || null,
    startDate: parseIsoDate(status?.startDateStruct?.date ?? null),
    lastUpdateDate: parseIsoDate(status?.lastUpdatePostDateStruct?.date ?? null),
    briefSummary: section?.descriptionModule?.briefSummary?.replace(/\s+/g, " ").trim() || null,
  };
}

/** Prefer studies where the investigator appears as an overall official when that data is present. */
export function studyMatchesInvestigatorName(
  study: ClinicalTrialsStudyRecord,
  investigatorName: string
): boolean {
  if (!investigatorName.trim()) return true;
  const officials = study.protocolSection?.contactsLocationsModule?.overallOfficials ?? [];
  if (!officials.length) return true;
  return officials.some((official) => personNameMatches(official?.name, investigatorName));
}

export async function searchClinicalTrialsStudies(
  search: ClinicalTrialsSearchQuery,
  maxResults: number,
  opts?: { investigatorName?: string }
): Promise<{ studies: ClinicalTrialsStudyRecord[]; totalCount: number | null }> {
  const { studies, totalCount } = await searchClinicalTrialsStudiesPaginated(
    {
      queryTerm: search.queryTerm,
      filterAdvanced: search.filterAdvanced,
    },
    maxResults
  );

  const name = opts?.investigatorName?.trim();
  if (!name) return { studies, totalCount };

  const filtered = studies.filter((study) => studyMatchesInvestigatorName(study, name));
  return { studies: filtered, totalCount };
}

export type ClinicalTrialsIngestResult = {
  inserted: number;
  queryTerm: string;
  filterAdvanced?: string;
  nctIds: string[];
  totalCount: number | null;
  warning?: string;
};

/**
 * Search ClinicalTrials.gov for studies tied to an investigator and upsert cache rows.
 */
export async function refreshInvestigatorClinicalTrials(
  supabase: SupabaseClient,
  investigatorId: string,
  opts: { max?: number } = {}
): Promise<ClinicalTrialsIngestResult> {
  const max = resolveClinicalTrialsMaxResults(opts.max);

  const { data: inv, error: invErr } = await supabase
    .from("investigators")
    .select("id, full_name, home_department, division, clinicaltrials_query_override")
    .eq("id", investigatorId)
    .maybeSingle();

  if (invErr || !inv) {
    throw new Error(invErr?.message ?? "Investigator not found");
  }

  const search = buildClinicalTrialsSearch({
    fullName: inv.full_name ?? "",
    clinicaltrialsQueryOverride: inv.clinicaltrials_query_override ?? null,
    affiliation: inv.home_department ?? inv.division ?? "UCSF",
  });
  if (!search.queryTerm) {
    throw new Error(
      "No ClinicalTrials.gov query — set full name or clinicaltrials_query_override on the investigator."
    );
  }

  const { studies, totalCount } = await searchClinicalTrialsStudies(search, max, {
    investigatorName: inv.full_name ?? "",
  });
  if (studies.length === 0) {
    return {
      inserted: 0,
      queryTerm: search.queryTerm,
      filterAdvanced: search.filterAdvanced,
      nctIds: [],
      totalCount,
      warning: "No studies returned for this query.",
    };
  }

  let inserted = 0;
  const nctIds: string[] = [];
  // PR 0.3: design fields and the investigator's role, parsed from the same record raw_json keeps.
  const parsedAt = new Date().toISOString();

  for (const study of studies) {
    const parsed = parseClinicalTrialStudy(study);
    if (!parsed) continue;
    nctIds.push(parsed.nctId);

    const provenance = search.filterAdvanced
      ? `query.term: ${search.queryTerm}; filter.advanced: ${search.filterAdvanced}`
      : `query.term: ${search.queryTerm}`;

    const { error } = await supabase.from("investigator_clinical_trials").upsert(
      {
        investigator_id: investigatorId,
        nct_id: parsed.nctId,
        title: parsed.title,
        overall_status: parsed.overallStatus,
        conditions: parsed.conditions,
        lead_sponsor: parsed.leadSponsor,
        start_date: parsed.startDate,
        last_update_date: parsed.lastUpdateDate,
        brief_summary: parsed.briefSummary,
        source: "clinicaltrials_api_v2",
        raw_json: study as unknown as Record<string, unknown>,
        match_confidence: "medium",
        provenance_note: provenance,
        ...designCaptureFields(parseDesign(study, inv.full_name ?? ""), parsedAt),
      },
      { onConflict: "investigator_id,nct_id" }
    );
    if (!error) inserted += 1;
  }

  return {
    inserted,
    queryTerm: search.queryTerm,
    filterAdvanced: search.filterAdvanced,
    nctIds,
    totalCount,
  };
}

export function clinicalTrialsStudyUrl(nctId: string): string {
  return `https://clinicaltrials.gov/study/${nctId}`;
}
