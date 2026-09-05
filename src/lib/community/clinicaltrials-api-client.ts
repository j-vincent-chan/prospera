/**
 * ClinicalTrials.gov REST API v2 client.
 * @see https://clinicaltrials.gov/data-api/about-api
 * @see https://www.nlm.nih.gov/pubs/techbull/ma24/ma24_clinicaltrials_api.html
 */

import { AsyncRateLimiter } from "@/lib/utils/async-rate-limiter";

export const CLINICALTRIALS_API_V2_BASE = "https://clinicaltrials.gov/api/v2";

const PAGE_SIZE_MAX = 100;
/** ~2 requests/second per NLM guidance. */
const MIN_INTERVAL_MS = Number(process.env.CLINICALTRIALS_MIN_INTERVAL_MS ?? 550);

const clinicalTrialsRateLimiter = new AsyncRateLimiter(MIN_INTERVAL_MS);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

export async function fetchClinicalTrialsApi(
  url: string,
  opts?: { maxAttempts?: number }
): Promise<Response> {
  const maxAttempts = Math.max(1, opts?.maxAttempts ?? 5);
  let lastRes: Response | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await clinicalTrialsRateLimiter.schedule(() =>
      fetch(url, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      })
    );
    lastRes = res;
    if (!isRetryableStatus(res.status)) return res;
    if (attempt >= maxAttempts) return res;
    await sleep(Math.min(60_000, 1500 * 2 ** (attempt - 1)));
  }
  return lastRes ?? new Response(null, { status: 503 });
}

export type ClinicalTrialsSearchRequest = {
  /** Full-text / Essie expression (query.term). */
  queryTerm: string;
  /** Advanced filter (filter.advanced), e.g. AREA[LocationFacility]UCSF */
  filterAdvanced?: string;
  pageSize: number;
  pageToken?: string;
  countTotal?: boolean;
};

export function buildClinicalTrialsStudiesUrl(req: ClinicalTrialsSearchRequest): string {
  const params = new URLSearchParams();
  params.set("query.term", req.queryTerm);
  if (req.filterAdvanced?.trim()) {
    params.set("filter.advanced", req.filterAdvanced.trim());
  }
  params.set("pageSize", String(Math.min(PAGE_SIZE_MAX, Math.max(1, req.pageSize))));
  params.set("format", "json");
  if (req.pageToken) params.set("pageToken", req.pageToken);
  if (req.countTotal) params.set("countTotal", "true");
  return `${CLINICALTRIALS_API_V2_BASE}/studies?${params.toString()}`;
}

export type ClinicalTrialsStudyRecord = {
  protocolSection?: {
    identificationModule?: {
      nctId?: string | null;
      briefTitle?: string | null;
      officialTitle?: string | null;
    };
    statusModule?: {
      overallStatus?: string | null;
      startDateStruct?: { date?: string | null } | null;
      lastUpdatePostDateStruct?: { date?: string | null } | null;
    };
    conditionsModule?: { conditions?: string[] | null };
    sponsorCollaboratorsModule?: {
      leadSponsor?: { name?: string | null } | null;
      /** type SPONSOR carries no name; PRINCIPAL_INVESTIGATOR and SPONSOR_INVESTIGATOR carry investigatorFullName. */
      responsibleParty?: {
        type?: string | null;
        investigatorFullName?: string | null;
        investigatorTitle?: string | null;
        investigatorAffiliation?: string | null;
      } | null;
    };
    descriptionModule?: { briefSummary?: string | null };
    designModule?: {
      studyType?: string | null;
      /** Absent on observational studies; ["NA"] on interventional studies outside the drug-phase ladder. */
      phases?: string[] | null;
      designInfo?: {
        allocation?: string | null;
        interventionModel?: string | null;
        primaryPurpose?: string | null;
        observationalModel?: string | null;
        timePerspective?: string | null;
      } | null;
      enrollmentInfo?: { count?: number | null; type?: string | null } | null;
    } | null;
    armsInterventionsModule?: {
      interventions?: Array<{ type?: string | null; name?: string | null }> | null;
    } | null;
    contactsLocationsModule?: {
      overallOfficials?: Array<{ name?: string | null; affiliation?: string | null; role?: string | null }> | null;
    };
  } | null;
};

export type ClinicalTrialsStudiesPage = {
  studies?: ClinicalTrialsStudyRecord[] | null;
  nextPageToken?: string | null;
  totalCount?: number | null;
};

export async function fetchClinicalTrialsStudiesPage(
  req: ClinicalTrialsSearchRequest
): Promise<ClinicalTrialsStudiesPage> {
  const url = buildClinicalTrialsStudiesUrl(req);
  const res = await fetchClinicalTrialsApi(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `ClinicalTrials.gov API ${res.status}${body ? `: ${body.slice(0, 300)}` : ""}`
    );
  }
  return (await res.json()) as ClinicalTrialsStudiesPage;
}

export async function searchClinicalTrialsStudiesPaginated(
  req: Omit<ClinicalTrialsSearchRequest, "pageToken" | "pageSize">,
  maxResults: number
): Promise<{ studies: ClinicalTrialsStudyRecord[]; totalCount: number | null }> {
  const studies: ClinicalTrialsStudyRecord[] = [];
  let pageToken: string | undefined;
  let totalCount: number | null = null;

  while (studies.length < maxResults) {
    const page = await fetchClinicalTrialsStudiesPage({
      ...req,
      pageSize: Math.min(PAGE_SIZE_MAX, maxResults - studies.length),
      pageToken,
      countTotal: totalCount == null,
    });

    if (totalCount == null && typeof page.totalCount === "number") {
      totalCount = page.totalCount;
    }

    const batch = page.studies ?? [];
    studies.push(...batch);
    pageToken = page.nextPageToken?.trim() || undefined;
    if (!pageToken || batch.length === 0) break;
  }

  return { studies: studies.slice(0, maxResults), totalCount };
}
