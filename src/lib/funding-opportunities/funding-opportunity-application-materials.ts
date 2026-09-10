import type { FundingListRowBucket } from "@/lib/funding-opportunities/funding-list-row-scope";
import {
  grantsGovAttachmentUrl,
  grantsGovPackagePreviewUrl,
  grantsGovStartApplicationUrl,
  type GrantsGovAttachment,
  type GrantsGovOpportunityLookup,
} from "@/lib/funding-opportunities/grants-gov-opportunity-api";
import { isGrantsGovAttachmentDownload, isInlineSimplerAttachment } from "@/lib/funding-opportunities/notice-links";
import { isExternalHttpUrl } from "@/lib/funding-opportunities/source-url";

export type FundingApplicationDocument = {
  fileName: string;
  downloadUrl: string;
  /**
   * A URL that opens the same document as a page in the browser, when one is
   * known: the NIH full-announcement HTML from its Simpler.Grants.gov copy or
   * the NIH Guide page. The Grants.gov attachment endpoint in `downloadUrl`
   * answers with `Content-Disposition: attachment`, which is why "Download" is
   * all it can be.
   */
  openUrl: string | null;
  fileSizeBytes: number | null;
  folderType: string | null;
};

export type FundingApplicationMaterials = {
  packageAvailable: boolean;
  statusMessage: string | null;
  previewPackageUrl: string | null;
  previewPackageLabel: string;
  startApplicationUrl: string | null;
  startApplicationLabel: string;
  startApplicationSubtitle: string;
  assistUrl: string | null;
  nihStandardFormsUrl: string | null;
  documents: FundingApplicationDocument[];
};

const NIH_STANDARD_FORMS_URL = "https://grants.nih.gov/grants/forms.htm";
const NIH_ASSIST_URL = "https://public.era.nih.gov/assist/";

export function formatApplicationDocumentSize(bytes: number | null): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isNihFundingOpportunity(input: {
  agency?: string | null;
  agencyCode?: string | null;
  opportunityNumber?: string | null;
  nihIcTokens?: string[] | null;
}): boolean {
  const agency = `${input.agency ?? ""} ${input.agencyCode ?? ""}`.toLowerCase();
  if (
    /\bnih\b|national institutes of health|national institute of|national cancer institute|\bnci\b/.test(
      agency
    )
  ) {
    return true;
  }
  if (Array.isArray(input.nihIcTokens) && input.nihIcTokens.length > 0) return true;
  const fon = (input.opportunityNumber ?? "").trim().toUpperCase();
  return /^(PAR|PA|RFA|RFI|NOT|RM|UG|BT|EB|MH|AG|AT|CA|DE|DK|EB|ES|EY|FR|GM|HD|HG|HL|LM|MD|MH|RR|TR|TW|OD)-/.test(
    fon
  );
}

function parseAttachmentsFromRawPayload(raw: unknown): FundingApplicationDocument[] {
  if (raw == null || typeof raw !== "object") return [];

  const docs: FundingApplicationDocument[] = [];
  const seen = new Set<string>();

  function pushDoc(fileName: string, downloadUrl: string, fileSizeBytes: number | null, folderType: string | null) {
    const key = `${downloadUrl}::${fileName}`;
    if (seen.has(key) || !isExternalHttpUrl(downloadUrl)) return;
    seen.add(key);
    docs.push({ fileName, downloadUrl, openUrl: null, fileSizeBytes, folderType });
  }

  function walkAttachments(value: unknown, folderType: string | null, depth = 0) {
    if (depth > 6 || value == null) return;
    if (Array.isArray(value)) {
      for (const item of value) walkAttachments(item, folderType, depth + 1);
      return;
    }
    if (typeof value !== "object") return;

    const record = value as Record<string, unknown>;
    const fileName = [record.file_name, record.fileName, record.name, record.title]
      .find((v) => typeof v === "string" && v.trim())
      ?.toString()
      .trim();
    const downloadUrl = [record.download_url, record.downloadUrl, record.url, record.href]
      .find((v) => typeof v === "string" && isExternalHttpUrl(v.trim()))
      ?.toString()
      .trim();
    if (fileName && downloadUrl) {
      const sizeRaw = record.file_size ?? record.fileSize ?? record.fileLobSize ?? record.byte_size;
      const fileSizeBytes =
        typeof sizeRaw === "number" && Number.isFinite(sizeRaw) ? sizeRaw : null;
      pushDoc(fileName, downloadUrl, fileSizeBytes, folderType);
    }

    if (Array.isArray(record.attachments)) {
      walkAttachments(record.attachments, folderType, depth + 1);
    }
    if (Array.isArray(record.synopsisAttachmentFolders)) {
      for (const folder of record.synopsisAttachmentFolders) {
        if (!folder || typeof folder !== "object") continue;
        const ft =
          typeof (folder as { folderType?: unknown }).folderType === "string"
            ? (folder as { folderType: string }).folderType
            : folderType;
        walkAttachments((folder as { synopsisAttachments?: unknown }).synopsisAttachments, ft, depth + 1);
      }
    }
  }

  walkAttachments((raw as Record<string, unknown>).attachments, null);
  walkAttachments(raw, null);
  return docs;
}

function grantsGovDocsFromAttachments(attachments: GrantsGovAttachment[]): FundingApplicationDocument[] {
  return attachments.map((att) => ({
    fileName: att.fileName,
    downloadUrl: grantsGovAttachmentUrl(att),
    openUrl: null,
    fileSizeBytes: att.fileSizeBytes,
    folderType: att.folderType,
  }));
}

function mergeDocuments(...lists: FundingApplicationDocument[][]): FundingApplicationDocument[] {
  const out: FundingApplicationDocument[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const doc of list) {
      const key = `${doc.downloadUrl}::${doc.fileName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(doc);
    }
  }
  return out;
}

/** `legacy_opportunity_id` from the Simpler payload — the Grants.gov id, on every synced row. */
export function legacyOpportunityIdFromPayload(raw: unknown): number | null {
  if (raw == null || typeof raw !== "object") return null;
  const v = (raw as { legacy_opportunity_id?: unknown }).legacy_opportunity_id;
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

const HTML_FILE_RE = /\.html?$/i;

/**
 * Give the full-announcement HTML a way to open as a page. A Simpler-hosted
 * copy already renders in the browser, so its own URL is the page; the
 * Grants.gov copy of the same file is a forced download, so it opens through
 * the announcement page the notice resolved to (NIH Guide or Simpler), when
 * there is one. PDFs and Word files stay downloads.
 */
export function withInlineAnnouncement(materials: FundingApplicationMaterials, announcementUrl: string | null): FundingApplicationMaterials {
  const documents = materials.documents.map((doc) => {
    if (!HTML_FILE_RE.test(doc.fileName.trim())) return doc;
    if (isInlineSimplerAttachment(doc.downloadUrl)) return { ...doc, openUrl: doc.downloadUrl };
    if (announcementUrl && isGrantsGovAttachmentDownload(doc.downloadUrl) && /full[-_ ]?announcement/i.test(doc.fileName)) return { ...doc, openUrl: announcementUrl };
    return doc;
  });
  return { ...materials, documents };
}

function statusMessageForBucket(bucket: FundingListRowBucket, hasPackages: boolean): string | null {
  if (bucket === "forecasted") {
    return "This is a forecasted notice. Application packages and workspace forms are usually not available until the opportunity is posted.";
  }
  if (bucket === "closed") {
    return "The application deadline has passed. Package forms may still be viewable on Grants.gov for reference.";
  }
  if (!hasPackages && bucket === "open") {
    return "No application package is listed on Grants.gov yet. Check the full notice for agency-specific submission instructions.";
  }
  return null;
}

/**
 * Pure: the caller supplies the notice's Grants.gov record (see
 * `loadGrantsGovLookup` in funding-opportunity-peek.ts, which caches it);
 * this module is also imported by the peek drawer on the client, so it
 * cannot reach the network or Next's cache itself.
 */
export function resolveFundingApplicationMaterials(input: {
  opportunityNumber: string | null;
  agency: string | null;
  agencyCode: string | null;
  statusBucket: FundingListRowBucket;
  rawPayload: unknown;
  nihIcTokens?: string[] | null;
  grantsGov: GrantsGovOpportunityLookup;
}): FundingApplicationMaterials {
  const nih = isNihFundingOpportunity(input);
  const payloadDocs = parseAttachmentsFromRawPayload(input.rawPayload);

  const { legacyOpportunityId: legacyId, details: grantsGovDetails } = input.grantsGov;

  const hasPackages =
    (grantsGovDetails?.packageIds.length ?? 0) > 0 || grantsGovDetails?.workspaceCompatible === true;
  const packageAvailable = input.statusBucket === "open" && hasPackages;

  const grantsGovDocs = grantsGovDetails
    ? grantsGovDocsFromAttachments(grantsGovDetails.attachments)
    : [];
  const documents = mergeDocuments(payloadDocs, grantsGovDocs);

  const showPackageActions = legacyId != null && input.statusBucket !== "forecasted";
  const previewPackageUrl =
    legacyId != null && showPackageActions ? grantsGovPackagePreviewUrl(legacyId) : null;
  const startApplicationUrl =
    legacyId != null &&
    showPackageActions &&
    (packageAvailable || input.statusBucket === "open")
      ? grantsGovStartApplicationUrl(legacyId)
      : null;

  const assistUrl =
    grantsGovDetails?.assistUrl ??
    (nih && input.statusBucket !== "forecasted" ? NIH_ASSIST_URL : null);

  let startApplicationSubtitle = "Grants.gov Workspace";
  if (nih && grantsGovDetails?.assistCompatible) {
    startApplicationSubtitle = "ASSIST or Workspace";
  } else if (nih) {
    startApplicationSubtitle = "ASSIST or Workspace";
  }

  return {
    packageAvailable,
    statusMessage: statusMessageForBucket(input.statusBucket, hasPackages),
    previewPackageUrl,
    previewPackageLabel: "Grants.gov Package",
    startApplicationUrl,
    startApplicationLabel: "Start application",
    startApplicationSubtitle,
    assistUrl: nih ? assistUrl : grantsGovDetails?.assistUrl ?? null,
    nihStandardFormsUrl: nih ? NIH_STANDARD_FORMS_URL : null,
    documents,
  };
}
