/**
 * The Grants.gov attachment adapter (PR 5.3).
 *
 * The largest single coverage win in Phase 5: 328 of the 504 posted non-NIH
 * rows Simpler answered for carry at least one attachment
 * (`NON_NIH_INVENTORY.md` § 2a, 65.1 %), and for CDC, HRSA, USDA NIFA, DOE,
 * NIST, IMLS, NEH, DOI and the CDMRP mirror that attachment is the full
 * announcement — the only place the program's objectives are written down.
 *
 * ## Resolving the document
 *
 * Four routes, tried in order, the first that yields an `objectives` section
 * wins (`firstUsableTarget`):
 *
 *   (a) `raw_payload_json.attachments[]` when the Simpler detail record has
 *       already been merged into the row — free, no request. Only 8 of 536 rows
 *       have it today, but the NIH sync merges it on every resolve, so it grows.
 *   (b) the legacy Grants.gov `fetchOpportunity`, keyed on the stored
 *       `raw_payload_json.legacy_opportunity_id`.
 *   (c) Simpler `getOpportunity(source_opportunity_id)`.
 *   (d) the application package's instructions PDF, once (b) has told us the
 *       package id.
 *
 * **(b) before (c) — the one place this departs from the plan's ordering, and
 * why.** The plan says the two are interchangeable (§ 2b measured the same file
 * set on 50/50 rows) and to "prefer whichever is cheaper". They are: both are
 * one request, but the legacy route needs no API key and does not share a rate
 * limiter with the nightly Simpler sync. The deciding difference is that the
 * legacy record carries `synopsisAttachmentFolders[].folderType` and Simpler's
 * `attachments[]` does not, and that folder is the strongest ranking signal
 * there is. `HRSA-27-099` is the worked example: seven PDFs, and the largest
 * (2.75 MB) is `EID Checklist Form.pdf` while the announcement
 * (`FOA Content HRSA-27-099 Final v2.pdf`, 0.69 MB) sits alone in the
 * `Full Announcement` folder. Ranking on size alone reads the wrong document;
 * ranking on the folder cannot. Route (c) stays as the fallback so no notice
 * depends on a single API.
 *
 * `searchGrantsGovOpportunityId()` is never called: § 2 measured
 * `legacy_opportunity_id` on 536/536 posted non-NIH rows and § 2b confirmed it
 * equals the searched id on 50/50, so the `search2` round-trip buys nothing.
 *
 * ## Never a partial write
 *
 * The `Acquisition` union has no `sections` on its `error` / `not_found`
 * variants, so a failed extraction *cannot* be written with a partial section
 * set — the type is the guarantee, not a convention. This adapter also
 * deliberately has **no `singleSection` fallback**: a document we read but
 * could not structure is reported as an error and falls through to the synopsis
 * at profile time, where D62's Exploratory ceiling already applies. Storing a
 * 100 KB unstructured blob under one role would blow `MAX_GROUP_CHARS` and
 * would claim structure that is not there.
 */
import {
  fetchGrantsGovOpportunityDetails,
  grantsGovAttachmentUrl,
  grantsGovPackageInstructionsUrl,
  type GrantsGovAttachment,
  type GrantsGovOpportunityDetails,
} from "@/lib/funding-opportunities/grants-gov-opportunity-api";
import type { SimplerAttachment, SimplerOpportunityHit } from "@/lib/ingestion/simpler-grants/types";
import {
  announcementTextHash,
  firstUsableTarget,
  funderFamilyOf,
  type Acquisition,
  type AnnouncementAdapter,
  type AnnouncementSource,
  type AnnouncementTarget,
  type FunderRow,
} from "@/lib/ingestion/announcement/registry";
import {
  ANNOUNCEMENT_HEADING_TABLES,
  hasObjectives,
  isTableOfContentsLine,
  sectionWithBestTable,
  type SectionedDocument,
} from "@/lib/ingestion/announcement/sectioner";
import { htmlToLines, isPdfBytes, pdfToLines, type TextLine } from "@/lib/ingestion/announcement/text";
import type { AsyncRateLimiter } from "@/lib/utils/async-rate-limiter";

export const GRANTS_GOV_ATTACHMENT_ADAPTER_ID = "grants_gov_attachment";

/**
 * The size cap, and why this number.
 *
 * `NON_NIH_INVENTORY.md` § 2a measured the attachment size distribution over
 * 892 files: median 304 KB, p90 1.07 MB. The largest announcement seen while
 * building this PR is `CDC-RFA-JG-26-0043` at 2.67 MB / 70 pages, which pdf.js
 * reads in 122 ms. **12 MB** is therefore ~11× p90 and ~4.5× the largest real
 * announcement — high enough that no announcement is refused for its size, low
 * enough that a scanned appendix bundle or a mis-typed archive cannot pull tens
 * of megabytes into a 300 s serverless function. A file over the cap is
 * skipped, not truncated: half a PDF is not a PDF.
 */
export const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;

const USER_AGENT = "Prospera/1.0 (UCSF research-development tool; contact research.dev@ucsf.edu)";
const FETCH_TIMEOUT_MS = 30_000;

/**
 * How many ranked attachments one notice may be read for, and how many package
 * bundles after them.
 *
 * `HR001126S0015` (DARPA DSO) lists 17 files and `W911NF-20-S-0008` 14
 * (`NON_NIH_INVENTORY.md` § 2b). Reading all of them at the mandatory 700 ms
 * spacing would be twelve seconds and tens of megabytes on one funder's server
 * for one notice, and would not help: the announcement is what the folder and
 * the name rank first, so if the top four do not carry an `objectives` block
 * the seventeenth will not either. Four is where the ranking's confidence runs
 * out, not a budget — a row that needs a fifth read is a ranking bug to fix.
 */
export const MAX_ATTACHMENTS_TRIED = 4;
export const MAX_PACKAGES_TRIED = 2;

/**
 * Announcement-shaped file names. The plan's list plus `program statement`:
 * the State Department publishes every embassy opportunity as an "Annual
 * Program Statement", and those files sit in `Other Supporting Documents`
 * (`DFOP0018775`'s `FY 2026 CPC Annual Program Statement.pdf`), so neither the
 * folder tier nor the plan's names would have reached them.
 */
const ANNOUNCEMENT_NAME = /(full.?announcement|nofo|foa|program.?announcement|program.?statement|solicitation)/i;
/** `folderType` values the legacy record uses for the announcement itself. */
const ANNOUNCEMENT_FOLDER = /full\s*announcement/i;

/** Types we will read. `application/octet-stream` is included **only** with a `.pdf` / `.htm(l)` name — see `acceptableType`. */
const PDF_TYPE = /^application\/(?:pdf|x-pdf)\b/i;
const HTML_TYPE = /^(?:text\/html|application\/xhtml\+xml)\b/i;
const OPAQUE_TYPE = /^application\/(?:octet-stream|force-download|download)\b/i;
const PDF_NAME = /\.pdf$/i;
const HTML_NAME = /\.x?html?$/i;

// ---------------------------------------------------------------------------
// Row and dependency shapes
// ---------------------------------------------------------------------------

/** The columns the adapter reads. */
export type GrantsGovRow = FunderRow & {
  id: string;
  opportunity_number: string | null;
  forecasted?: boolean | null;
  source_opportunity_id: string | null;
  guide_url?: string | null;
  raw_payload_json: Record<string, unknown> | null;
};

export type SimplerClientLike = { getOpportunity(id: string): Promise<SimplerOpportunityHit> };

/** One downloaded document, before it is turned into lines. */
export type FetchedDocument =
  | { status: "ok"; url: string; bytes: Uint8Array; contentType: string | null }
  | { status: "not_found"; url: string }
  | { status: "error"; url: string; error: string };

export type GrantsGovDeps = {
  /** One limiter per host, from the driver. Every request goes through it (≥ 700 ms). */
  limiterFor(host: string): AsyncRateLimiter;
  /** The Simpler API's own limiter, shared with the NIH sync. */
  simplerLimiter: AsyncRateLimiter;
  simpler: SimplerClientLike | null;
  /** Injected in tests; defaults to a real GET with the size cap applied. */
  fetchDocument?: (url: string, maxBytes: number) => Promise<FetchedDocument>;
  /** Injected in tests; defaults to the existing legacy client. */
  fetchLegacyDetails?: (legacyOpportunityId: number) => Promise<GrantsGovOpportunityDetails | null>;
  maxBytes?: number;
  /** `--force`: ignored here (there is no stored per-file hash to skip on); kept for driver symmetry. */
  force?: boolean;
};

/** A file we might read, with everything the ranking needs. */
export type AttachmentCandidate = {
  url: string;
  source: AnnouncementSource;
  fileName: string;
  mimeType: string | null;
  bytes: number | null;
  folderType: string | null;
  /** Which of the four routes produced it — reported by the dry run. */
  route: "stored" | "legacy" | "simpler" | "package";
};

// ---------------------------------------------------------------------------
// Candidate collection
// ---------------------------------------------------------------------------

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** `raw_payload_json.legacy_opportunity_id` — present on 536/536 posted non-NIH rows (§ 2). */
export function legacyOpportunityIdOf(row: GrantsGovRow): number | null {
  const raw = row.raw_payload_json ?? {};
  const direct = asNumber((raw as { legacy_opportunity_id?: unknown }).legacy_opportunity_id);
  if (direct != null) return direct;
  const summary = (raw as { summary?: unknown }).summary;
  if (summary && typeof summary === "object") {
    return asNumber((summary as { legacy_opportunity_id?: unknown }).legacy_opportunity_id);
  }
  return null;
}

/** Route (a): the Simpler detail record's `attachments[]`, if it has already been merged into the row. */
export function storedCandidates(row: GrantsGovRow): AttachmentCandidate[] {
  const list = (row.raw_payload_json as { attachments?: unknown } | null)?.attachments;
  if (!Array.isArray(list)) return [];
  return list.flatMap((a) => (isSimplerAttachment(a) ? [simplerCandidate(a, "stored")] : []));
}

function isSimplerAttachment(a: unknown): a is SimplerAttachment {
  if (!a || typeof a !== "object") return false;
  const r = a as { file_name?: unknown; download_path?: unknown };
  return typeof r.file_name === "string" && typeof r.download_path === "string" && /^https:\/\//i.test(r.download_path);
}

function simplerCandidate(a: SimplerAttachment, route: "stored" | "simpler"): AttachmentCandidate {
  return {
    url: a.download_path.trim(),
    source: "simpler_attachment",
    fileName: a.file_name.trim(),
    mimeType: typeof a.mime_type === "string" ? a.mime_type : null,
    bytes: typeof a.file_size_bytes === "number" ? a.file_size_bytes : null,
    folderType: null,
    route,
  };
}

function legacyCandidate(a: GrantsGovAttachment): AttachmentCandidate {
  return {
    url: grantsGovAttachmentUrl(a),
    source: "grants_gov_attachment",
    fileName: a.fileName,
    mimeType: a.mimeType,
    bytes: a.fileSizeBytes,
    folderType: a.folderType,
    route: "legacy",
  };
}

// ---------------------------------------------------------------------------
// Filtering and ranking
// ---------------------------------------------------------------------------

/**
 * Whether we will even download this file.
 *
 * The plan says "reject anything not `application/pdf` or `text/html`". Applied
 * to the letter that rejects every NEH and IMLS announcement, because
 * Grants.gov serves those as `application/octet-stream` with a `…_NOFO.pdf`
 * name (`NON_NIH_INVENTORY.md` § 2a lists six of them, and `DE-FOA-0003671`'s
 * `FundOpp_….pdf` is another). So an opaque type is admitted **only** when the
 * file name says PDF or HTML, and `readDocument` then sniffs the `%PDF-`
 * signature on the bytes before believing any of it. `.zip`, `.docx` and
 * `.xlsx` are rejected outright, as the plan intends.
 */
export function acceptableType(c: Pick<AttachmentCandidate, "fileName" | "mimeType">): boolean {
  const mime = (c.mimeType ?? "").trim();
  const name = c.fileName.trim();
  if (PDF_TYPE.test(mime) || HTML_TYPE.test(mime)) return true;
  if (!mime || OPAQUE_TYPE.test(mime)) return PDF_NAME.test(name) || HTML_NAME.test(name);
  return false;
}

function withinCap(c: AttachmentCandidate, maxBytes: number): boolean {
  return c.bytes == null || c.bytes <= maxBytes;
}

/**
 * Lower is better. Three tiers, then largest first inside a tier.
 *
 *   0 · the legacy record puts it in a `Full Announcement` folder
 *   1 · the file name matches `/(full.?announcement|nofo|foa|program.?announcement|solicitation)/i`
 *   2 · anything else acceptable
 *
 * The plan's rule is tiers 1 and 2 (name, then largest PDF, then the only PDF);
 * tier 0 is the addition, and it is the tier that gets `HRSA-27-099` right.
 * Size descending inside a tier makes the order total and deterministic, so a
 * dry run and a write pass read the same file; the name is the final tie-break.
 */
export function candidateRank(c: AttachmentCandidate): number {
  if (c.folderType && ANNOUNCEMENT_FOLDER.test(c.folderType)) return 0;
  if (ANNOUNCEMENT_NAME.test(c.fileName)) return 1;
  return 2;
}

export function rankCandidates(candidates: readonly AttachmentCandidate[], maxBytes = MAX_ATTACHMENT_BYTES): AttachmentCandidate[] {
  const seen = new Set<string>();
  return candidates
    .filter((c) => acceptableType(c) && withinCap(c, maxBytes))
    .filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)))
    .sort((a, b) => candidateRank(a) - candidateRank(b) || (b.bytes ?? 0) - (a.bytes ?? 0) || a.fileName.localeCompare(b.fileName));
}

// ---------------------------------------------------------------------------
// Reading one document
// ---------------------------------------------------------------------------

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** A plain GET with the size cap enforced on `content-length` and again on the body. */
export async function fetchDocumentWithCap(url: string, maxBytes: number): Promise<FetchedDocument> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "application/pdf,text/html;q=0.9,*/*;q=0.5" },
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
    });
    if (res.status === 404 || res.status === 410) return { status: "not_found", url };
    if (!res.ok) return { status: "error", url, error: `HTTP ${res.status}` };
    const declared = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > maxBytes) {
      return { status: "error", url, error: `content-length ${declared} over the ${maxBytes}-byte cap` };
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) return { status: "error", url, error: `body ${buf.byteLength} over the ${maxBytes}-byte cap` };
    return { status: "ok", url, bytes: buf, contentType: res.headers.get("content-type") };
  } catch (e) {
    return { status: "error", url, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/** PDF bytes are trusted by their `%PDF-` signature, never by the server's content type. */
export async function documentToLines(doc: Extract<FetchedDocument, { status: "ok" }>): Promise<TextLine[]> {
  if (isPdfBytes(doc.bytes)) return pdfToLines(doc.bytes);
  const type = (doc.contentType ?? "").trim();
  if (HTML_TYPE.test(type) || !type || OPAQUE_TYPE.test(type)) {
    return htmlToLines(new TextDecoder("utf-8", { fatal: false }).decode(doc.bytes));
  }
  throw new Error(`unreadable content-type ${type}`);
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

/** What the dry run prints beyond the shared `Acquisition` fields. */
export type GrantsGovExtra = {
  candidates: number;
  considered: AttachmentCandidate[];
  /** Documents actually queued for reading: the ranked attachments plus any package-instructions PDF. */
  targets: number;
  chosen: AttachmentCandidate | null;
  table: string | null;
  roles: string[];
  /** The longest `objectives` block, for the dry run's eyes-on preview. */
  objectives: string | null;
  objectiveSections: number;
  thin: boolean;
  legacyId: number | null;
  packageIds: string[];
  routesUsed: string[];
};

export function appliesToGrantsGovAttachment(row: GrantsGovRow): boolean {
  const family = funderFamilyOf(row);
  if (family === "nih" || family === "foundation" || family === "internal") return false;
  if (row.forecasted === true) return false;
  return legacyOpportunityIdOf(row) != null || row.source_opportunity_id != null || storedCandidates(row).length > 0;
}

export async function acquireGrantsGovAttachment(row: GrantsGovRow, deps: GrantsGovDeps): Promise<Acquisition> {
  const maxBytes = deps.maxBytes ?? MAX_ATTACHMENT_BYTES;
  const read = deps.fetchDocument ?? fetchDocumentWithCap;
  const legacy = deps.fetchLegacyDetails ?? fetchGrantsGovOpportunityDetails;

  let pageFetches = 0;
  let simplerCalls = 0;
  const routesUsed: string[] = [];
  const packageIds: string[] = [];
  let error: string | null = null;

  // (a) stored — free.
  const candidates: AttachmentCandidate[] = storedCandidates(row);
  if (candidates.length) routesUsed.push("stored");

  // (b) the legacy record: one POST, no API key, and it carries `folderType`.
  const legacyId = legacyOpportunityIdOf(row);
  if (!rankCandidates(candidates, maxBytes).length && legacyId != null) {
    routesUsed.push("legacy");
    try {
      const details = await deps.limiterFor("api.grants.gov").schedule(() => legacy(legacyId));
      if (details) {
        candidates.push(...details.attachments.map(legacyCandidate));
        packageIds.push(...details.packageIds);
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  // (c) Simpler's detail record: the fallback route, same files, no folder.
  if (!rankCandidates(candidates, maxBytes).length && deps.simpler && row.source_opportunity_id) {
    routesUsed.push("simpler");
    simplerCalls += 1;
    try {
      const detail = await deps.simplerLimiter.schedule(() => deps.simpler!.getOpportunity(row.source_opportunity_id!));
      const list = Array.isArray(detail.attachments) ? detail.attachments : [];
      candidates.push(...list.filter(isSimplerAttachment).map((a) => simplerCandidate(a, "simpler")));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  const ranked = rankCandidates(candidates, maxBytes);

  // (d) the package instructions PDF, last: for many opportunities this bundle
  // is forms, but where the agency publishes no synopsis attachment it is the
  // announcement (verified on PKG00293844).
  const targets: AnnouncementTarget[] = ranked.slice(0, MAX_ATTACHMENTS_TRIED).map((c) => ({ url: c.url, source: c.source, note: c.fileName }));
  if (packageIds.length) {
    routesUsed.push("package");
    for (const pkg of packageIds.slice(0, MAX_PACKAGES_TRIED)) {
      targets.push({ url: grantsGovPackageInstructionsUrl(pkg), source: "grants_gov_attachment", note: `${pkg}-instructions.pdf` });
    }
  }

  const byUrl = new Map(ranked.map((c) => [c.url, c] as const));
  const extraBase = {
    candidates: candidates.length,
    considered: ranked,
    targets: targets.length,
    legacyId,
    packageIds,
    routesUsed,
  };

  if (targets.length === 0) {
    // Nothing acceptable on any route. This is structural, not a failure: the
    // row simply has no announcement to read (NSF attaches nothing to
    // Grants.gov; DOJ and NASA publish elsewhere). `not_applicable` keeps it
    // off the data-sources page's failure count and out of any retry cadence.
    return {
      status: "not_applicable",
      url: null,
      source: null,
      error: error ?? "no acceptable attachment",
      pageFetches,
      simplerCalls,
      extra: { ...extraBase, chosen: null, table: null, roles: [], objectives: null, objectiveSections: 0, thin: true } satisfies GrantsGovExtra,
    };
  }

  // Every candidate 404'd (as opposed to erroring or reading fine but not
  // sectioning) — the one case a later retry cadence could reasonably re-try.
  let every404 = true;
  let readSomething = false;
  const hit = await firstUsableTarget<SectionedDocument>(
    targets,
    async (target) => {
      pageFetches += 1;
      const doc = await deps.limiterFor(hostOf(target.url)).schedule(() => read(target.url, maxBytes));
      if (doc.status !== "ok") {
        if (doc.status === "error") {
          every404 = false;
          error = doc.error;
        } else {
          error = `HTTP 404 ${target.url}`;
        }
        return null;
      }
      readSomething = true;
      try {
        const lines = await documentToLines(doc);
        return sectionWithBestTable(lines, ANNOUNCEMENT_HEADING_TABLES, {
          ignoreHeading: isTableOfContentsLine,
          dedupe: "longest",
        });
      } catch (e) {
        every404 = false;
        error = e instanceof Error ? e.message : String(e);
        return null;
      }
    },
    (sectioned) => hasObjectives(sectioned.sections),
  );

  // `firstUsableTarget` falls back to the first *readable* document when none
  // was accepted, which is right for a caller that wants something over
  // nothing — and wrong here. A document with no `objectives` block has no
  // programme text in it, and storing it would be worse than storing nothing:
  // `sources.text` would read as full text, so the profile would be scored as
  // though the announcement had been read, while `groupSections` produced
  // empty groups. PR 5.6's `full_text_thin` ceiling cannot catch that either —
  // it keys on "only one role recovered", and a document can recover three
  // useless ones. So the fallback is refused and the row falls through to the
  // synopsis, which is the honest representation of what we know.
  if (!hit || !hasObjectives(hit.doc.sections)) {
    const readNothing = !hit;
    return {
      status: readNothing && every404 && !readSomething ? "not_found" : "error",
      url: hit?.target.url ?? targets[0]!.url,
      source: null,
      error: error ?? (hit ? "no objectives block in any candidate" : "no section could be recovered from any candidate"),
      pageFetches,
      simplerCalls,
      extra: { ...extraBase, chosen: null, table: null, roles: [], objectives: null, objectiveSections: 0, thin: true } satisfies GrantsGovExtra,
    };
  }

  const chosen = byUrl.get(hit.target.url) ?? null;
  // The *longest* objectives block, not the first: HHS's template puts a short
  // "Agency priorities" compliance block ahead of "Program description", and the
  // dry run exists to let a person read the programme's own words.
  const objectiveSections = hit.doc.sections.filter((s) => (s.roles ?? []).includes("objectives"));
  const objectives = objectiveSections.reduce<string | null>((best, s) => (best == null || s.text.length > best.length ? s.text : best), null);
  return {
    status: "ok",
    url: hit.target.url,
    source: hit.target.source,
    sections: hit.doc.sections,
    textHash: announcementTextHash(hit.doc.sections),
    pageFetches,
    simplerCalls,
    extra: {
      ...extraBase,
      chosen,
      table: hit.doc.table,
      roles: hit.doc.roles,
      objectives,
      objectiveSections: objectiveSections.length,
      thin: objectives == null,
    } satisfies GrantsGovExtra,
  };
}

export const grantsGovAttachmentAdapter: AnnouncementAdapter<GrantsGovRow, GrantsGovDeps> = {
  id: GRANTS_GOV_ATTACHMENT_ADAPTER_ID,
  // A routing family has to be named; this adapter is the fallback for every
  // non-NIH federal family, and `applies()` — not the family — is what decides.
  family: "other_federal",
  applies: appliesToGrantsGovAttachment,
  acquire: acquireGrantsGovAttachment,
};
