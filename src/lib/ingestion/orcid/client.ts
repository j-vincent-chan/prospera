/**
 * ORCID public API connector (pub.orcid.org, no credentials needed).
 *
 * Two jobs: look an iD up by name + UCSF affiliation when the directory has
 * none, and pull the works list so PMIDs on the record become verified
 * identity evidence for PubMed items.
 */

import { ORCID_RE, normalizeOrcid, orcidChecksumOk } from "@/lib/investigators/orcid";
import { AsyncRateLimiter } from "@/lib/utils/async-rate-limiter";

export const ORCID_API = "https://pub.orcid.org/v3.0";
const limiter = new AsyncRateLimiter(400);

// Parsing and the MOD 11-2 checksum live in the pure module (PR 0.7) so the
// onboarding step, the edit sheet and the import wizard validate the same way.
export { normalizeOrcid, orcidChecksumOk };

export type OrcidWork = {
  putCode: number;
  title: string | null;
  type: string | null;
  year: number | null;
  journal: string | null;
  pmid: string | null;
  doi: string | null;
};

export type OrcidEmployment = { organization: string | null; role: string | null; start: string | null; end: string | null };

async function get(path: string): Promise<Response> {
  return limiter.schedule(() =>
    fetch(`${ORCID_API}${path}`, { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(30_000) }),
  );
}

type WorksResponse = {
  group?: Array<{
    "external-ids"?: { "external-id"?: Array<{ "external-id-type"?: string; "external-id-value"?: string }> };
    "work-summary"?: Array<{
      "put-code"?: number;
      title?: { title?: { value?: string } };
      type?: string;
      "journal-title"?: { value?: string } | null;
      "publication-date"?: { year?: { value?: string } } | null;
      "external-ids"?: { "external-id"?: Array<{ "external-id-type"?: string; "external-id-value"?: string }> };
    }>;
  }>;
};

export function parseOrcidWorks(json: WorksResponse): OrcidWork[] {
  const out: OrcidWork[] = [];
  for (const group of json.group ?? []) {
    const summary = group["work-summary"]?.[0];
    if (!summary) continue;
    const ids = [...(group["external-ids"]?.["external-id"] ?? []), ...(summary["external-ids"]?.["external-id"] ?? [])];
    const find = (type: string) => ids.find((i) => i["external-id-type"]?.toLowerCase() === type)?.["external-id-value"]?.trim() ?? null;
    const year = Number.parseInt(summary["publication-date"]?.year?.value ?? "", 10);
    out.push({
      putCode: summary["put-code"] ?? 0,
      title: summary.title?.title?.value?.trim() ?? null,
      type: summary.type ?? null,
      year: Number.isFinite(year) ? year : null,
      journal: summary["journal-title"]?.value?.trim() ?? null,
      pmid: find("pmid"),
      doi: find("doi")?.toLowerCase() ?? null,
    });
  }
  return out;
}

export async function fetchOrcidWorks(orcid: string): Promise<OrcidWork[]> {
  const res = await get(`/${orcid}/works`);
  if (res.status === 404) throw new Error(`ORCID iD ${orcid} not found`);
  if (!res.ok) throw new Error(`ORCID API ${res.status}`);
  return parseOrcidWorks((await res.json()) as WorksResponse);
}

type EmploymentsResponse = {
  "affiliation-group"?: Array<{
    summaries?: Array<{
      "employment-summary"?: {
        organization?: { name?: string };
        "role-title"?: string | null;
        "start-date"?: { year?: { value?: string } } | null;
        "end-date"?: { year?: { value?: string } } | null;
      };
    }>;
  }>;
};

export async function fetchOrcidEmployments(orcid: string): Promise<OrcidEmployment[]> {
  const res = await get(`/${orcid}/employments`);
  if (!res.ok) return [];
  const json = (await res.json()) as EmploymentsResponse;
  const out: OrcidEmployment[] = [];
  for (const g of json["affiliation-group"] ?? []) {
    for (const s of g.summaries ?? []) {
      const e = s["employment-summary"];
      if (!e) continue;
      out.push({
        organization: e.organization?.name ?? null,
        role: e["role-title"] ?? null,
        start: e["start-date"]?.year?.value ?? null,
        end: e["end-date"]?.year?.value ?? null,
      });
    }
  }
  return out;
}

export const UCSF_ORG_RE = /university of california,? san francisco|\bucsf\b|gladstone/i;

export type OrcidSearchHit = { orcid: string; givenNames: string | null; familyName: string | null; institutions: string[] };

/**
 * Look up candidates by exact family + given name. Returns hits whose
 * institution list mentions UCSF first; the caller decides whether a single
 * unambiguous hit is good enough.
 */
export async function searchOrcidByName(givenNames: string, familyName: string): Promise<OrcidSearchHit[]> {
  const q = `family-name:"${familyName.replace(/"/g, "")}" AND given-names:"${givenNames.replace(/"/g, "")}"`;
  const res = await get(`/expanded-search/?q=${encodeURIComponent(q)}&rows=10`);
  if (!res.ok) throw new Error(`ORCID search ${res.status}`);
  const json = (await res.json()) as {
    "expanded-result"?: Array<{ "orcid-id"?: string; "given-names"?: string; "family-names"?: string; "institution-name"?: string[] }>;
  };
  const hits = (json["expanded-result"] ?? [])
    .map((r) => ({
      orcid: r["orcid-id"] ?? "",
      givenNames: r["given-names"] ?? null,
      familyName: r["family-names"] ?? null,
      institutions: r["institution-name"] ?? [],
    }))
    .filter((h) => ORCID_RE.test(h.orcid));
  return hits.sort((a, b) => Number(b.institutions.some((i) => UCSF_ORG_RE.test(i))) - Number(a.institutions.some((i) => UCSF_ORG_RE.test(i))));
}

/**
 * The one case we trust without a human: exactly one hit, and it lists UCSF
 * (or Gladstone) as an institution. Anything else needs a strategist.
 */
export function pickConfidentOrcid(hits: OrcidSearchHit[]): OrcidSearchHit | null {
  const ucsf = hits.filter((h) => h.institutions.some((i) => UCSF_ORG_RE.test(i)));
  if (ucsf.length === 1) return ucsf[0]!;
  return null;
}
