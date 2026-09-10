import { isExternalHttpUrl } from "@/lib/funding-opportunities/source-url";

const GRANTS_GOV_API = "https://api.grants.gov/v1/api";
const REQUEST_TIMEOUT_MS = 12_000;

export type GrantsGovAttachment = {
  id: number;
  fileName: string;
  mimeType: string | null;
  fileSizeBytes: number | null;
  folderType: string | null;
};

export type GrantsGovOpportunityDetails = {
  legacyOpportunityId: number;
  opportunityNumber: string | null;
  assistUrl: string | null;
  assistCompatible: boolean;
  workspaceCompatible: boolean;
  attachments: GrantsGovAttachment[];
  packageIds: string[];
};

/** Grants.gov did not answer (network, timeout, non-2xx) — as opposed to answering that there is nothing there. */
export class GrantsGovUnavailableError extends Error {
  constructor(path: string, cause: unknown) {
    super(`Grants.gov ${path} unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "GrantsGovUnavailableError";
  }
}

/** One Grants.gov call. Null when the service answered with no data; throws `GrantsGovUnavailableError` when it did not answer. */
async function postGrantsGovOrThrow<T>(path: string, body: Record<string, unknown>): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${GRANTS_GOV_API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) throw new GrantsGovUnavailableError(path, `HTTP ${res.status}`);
    const json = (await res.json()) as { errorcode?: number; data?: T };
    if (json.errorcode !== 0 || json.data == null) return null;
    return json.data;
  } catch (e) {
    throw e instanceof GrantsGovUnavailableError ? e : new GrantsGovUnavailableError(path, e);
  } finally {
    clearTimeout(timer);
  }
}

type SearchHit = { id?: string; number?: string; oppStatus?: string };

async function searchGrantsGovOpportunityIdOrThrow(opportunityNumber: string): Promise<number | null> {
  const trimmed = opportunityNumber.trim();
  if (!trimmed) return null;

  const data = await postGrantsGovOrThrow<{
    oppHits?: SearchHit[];
  }>("/search2", {
    oppNum: trimmed,
    rows: 5,
    oppStatuses: "forecasted|posted|closed|archived",
  });

  const hits = data?.oppHits ?? [];
  const exact = hits.find((h) => h.number?.trim().toUpperCase() === trimmed.toUpperCase());
  const hit = exact ?? hits[0];
  const id = hit?.id ? parseInt(hit.id, 10) : NaN;
  return Number.isFinite(id) ? id : null;
}

export async function searchGrantsGovOpportunityId(
  opportunityNumber: string
): Promise<number | null> {
  try {
    return await searchGrantsGovOpportunityIdOrThrow(opportunityNumber);
  } catch {
    return null;
  }
}

export type GrantsGovOpportunityLookup = {
  legacyOpportunityId: number | null;
  details: GrantsGovOpportunityDetails | null;
};

/**
 * The Grants.gov record behind a notice: its legacy id and the details
 * (packages, attachments, ASSIST). `legacyIdHint` is the id the Simpler
 * payload already carries (`legacy_opportunity_id`, present on every synced
 * row); with it the `/search2` lookup — the slow, variable one, 0.3–3.4 s —
 * is skipped and one call remains. Throws `GrantsGovUnavailableError` when
 * Grants.gov did not answer, so a caller that caches never stores an outage
 * as "no package".
 */
export async function lookupGrantsGovOpportunity(opportunityNumber: string | null, legacyIdHint: number | null): Promise<GrantsGovOpportunityLookup> {
  const legacyOpportunityId =
    legacyIdHint != null && Number.isFinite(legacyIdHint) ? legacyIdHint : opportunityNumber?.trim() ? await searchGrantsGovOpportunityIdOrThrow(opportunityNumber) : null;
  if (legacyOpportunityId == null) return { legacyOpportunityId: null, details: null };
  const details = await fetchGrantsGovOpportunityDetailsOrThrow(legacyOpportunityId);
  return { legacyOpportunityId, details };
}

function synopsisAttachmentDownloadUrl(attachmentId: number): string {
  return `https://www.grants.gov/grantsws/rest/opportunity/att/download/${attachmentId}`;
}

export async function fetchGrantsGovOpportunityDetails(
  legacyOpportunityId: number
): Promise<GrantsGovOpportunityDetails | null> {
  try {
    return await fetchGrantsGovOpportunityDetailsOrThrow(legacyOpportunityId);
  } catch {
    return null;
  }
}

async function fetchGrantsGovOpportunityDetailsOrThrow(
  legacyOpportunityId: number
): Promise<GrantsGovOpportunityDetails | null> {
  const data = await postGrantsGovOrThrow<Record<string, unknown>>("/fetchOpportunity", {
    opportunityId: legacyOpportunityId,
  });
  if (!data) return null;

  const attachments: GrantsGovAttachment[] = [];
  const folders = data.synopsisAttachmentFolders;
  if (Array.isArray(folders)) {
    for (const folder of folders) {
      if (!folder || typeof folder !== "object") continue;
      const folderType =
        typeof (folder as { folderType?: unknown }).folderType === "string"
          ? (folder as { folderType: string }).folderType
          : null;
      const synopsisAttachments = (folder as { synopsisAttachments?: unknown }).synopsisAttachments;
      if (!Array.isArray(synopsisAttachments)) continue;
      for (const att of synopsisAttachments) {
        if (!att || typeof att !== "object") continue;
        const record = att as {
          id?: unknown;
          fileName?: unknown;
          mimeType?: unknown;
          fileLobSize?: unknown;
        };
        const id = typeof record.id === "number" ? record.id : parseInt(String(record.id ?? ""), 10);
        const fileName = typeof record.fileName === "string" ? record.fileName.trim() : "";
        if (!Number.isFinite(id) || !fileName) continue;
        const fileSizeBytes =
          typeof record.fileLobSize === "number" && Number.isFinite(record.fileLobSize)
            ? record.fileLobSize
            : null;
        attachments.push({
          id,
          fileName,
          mimeType: typeof record.mimeType === "string" ? record.mimeType : null,
          fileSizeBytes,
          folderType,
        });
      }
    }
  }

  const packageIds: string[] = [];
  const pkgs = data.opportunityPkgs;
  if (Array.isArray(pkgs)) {
    for (const pkg of pkgs) {
      if (!pkg || typeof pkg !== "object") continue;
      const packageId = (pkg as { packageId?: unknown }).packageId;
      if (typeof packageId === "string" && packageId.trim()) {
        packageIds.push(packageId.trim());
      }
    }
  }

  const assistUrlRaw = data.assistURL;
  const assistUrl =
    typeof assistUrlRaw === "string" && isExternalHttpUrl(assistUrlRaw.trim())
      ? assistUrlRaw.trim()
      : null;

  const workspaceCompatible = Array.isArray(pkgs) && pkgs.some((pkg) => {
    if (!pkg || typeof pkg !== "object") return false;
    return (pkg as { workspaceCompatibleFlag?: unknown }).workspaceCompatibleFlag === "Y";
  });

  return {
    legacyOpportunityId,
    opportunityNumber:
      typeof data.opportunityNumber === "string" ? data.opportunityNumber : null,
    assistUrl,
    assistCompatible: data.assistCompatible === true,
    workspaceCompatible,
    attachments,
    packageIds,
  };
}

export function grantsGovOpportunityDetailUrl(legacyOpportunityId: number): string {
  return `https://www.grants.gov/search-results-detail/${legacyOpportunityId}`;
}

export function grantsGovPackagePreviewUrl(legacyOpportunityId: number): string {
  return grantsGovOpportunityDetailUrl(legacyOpportunityId);
}

export function grantsGovStartApplicationUrl(legacyOpportunityId: number): string {
  return grantsGovOpportunityDetailUrl(legacyOpportunityId);
}

export function grantsGovAttachmentUrl(attachment: GrantsGovAttachment): string {
  return synopsisAttachmentDownloadUrl(attachment.id);
}

/**
 * The application package's instructions PDF (PR 5.3, target (d)).
 *
 * Additive: nothing above changes. This is the one Grants.gov document that is
 * **not** served from `www.grants.gov` — the instructions bundle lives on
 * `apply07.grants.gov`, and `https://www.grants.gov/apply/opportunities/instructions/…`
 * answers 200 with the site's HTML shell instead, which is worse than a 404
 * because it looks like a document. Verified on `PKG00293844`
 * (`CDC-RFA-JG-26-0043`): apply07 returns the 2,673,320-byte announcement PDF,
 * byte-for-byte the same file as synopsis attachment 354704, while www returns
 * 27 KB of HTML. The `www.grants.gov` rule in the plan is about
 * `grantsGovAttachmentUrl` above, which already follows it.
 *
 * Last resort only: for many opportunities this bundle is forms rather than the
 * announcement, so the adapter tries it after every synopsis attachment.
 */
export function grantsGovPackageInstructionsUrl(packageId: string): string {
  return `https://apply07.grants.gov/apply/opportunities/instructions/${encodeURIComponent(packageId.trim())}-instructions.pdf`;
}
