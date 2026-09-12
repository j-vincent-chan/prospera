import type { SupabaseClient } from "@supabase/supabase-js";
import { SimplerGrantsClient } from "@/lib/ingestion/simpler-grants/client";
import type {
  SimplerOpportunityHit,
  SimplerSearchResponse,
} from "@/lib/ingestion/simpler-grants/types";
import { extractOpportunityFeatures } from "@/lib/funding-opportunities/extract-opportunity-features";
import { normalizeAgencyDisplayName } from "@/lib/funding-opportunities/agency-display";
import { buildRdSignalColumns } from "@/lib/funding-opportunities/rd-signals";
import { coerceDateString } from "@/lib/formatting/coerce-plain-text";
import { sourceUpdatedAt } from "@/lib/ingestion/simpler-grants/timestamps";
import { agencyContactFromRaw, descriptionFromRaw } from "@/lib/ingestion/simpler-grants/fields";

/** Default maximum opportunities fetched per sync (pages × page_size, capped by this) */
export const DEFAULT_MAX_NOFOS_PER_SYNC = 5000;

export type SimplerSyncParams = {
  /** Max pages per run; capped so pages × page_size ≤ maxNofosPerRun */
  maxPages?: number;
  pageSize?: number;
  /** Upper bound on opportunities to pull this run (default 5000) */
  maxNofosPerRun?: number;
  /** Include forecasted + posted opportunities (excludes closed/archived in the request). */
  includeForecasted?: boolean;
  /**
   * When true (default), each search hit is merged with `GET /v1/opportunities/{id}` so dates,
   * instruments, applicant types, and award bounds match the detail payload. Search-only rows are
   * often incomplete. Set false to skip extra requests (faster; thinner rows).
   */
  enrichWithDetailFetch?: boolean;
};

export type SimplerSyncResult = {
  pagesFetched: number;
  upserted: number;
  skippedClosed: number;
  /** Reserved for future “locked row” logic; always 0 after legacy matches removal. */
  skippedLocked: number;
  /** From the latest search response `pagination_info`, when the API sends it. */
  apiTotalRecords: number | null;
  apiTotalPages: number | null;
  errors: string[];
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Overlay detail GET onto search hit so nested objects (e.g. `dates`) and missing top-level keys fill in. */
function mergeHitWithDetail(
  hit: SimplerOpportunityHit,
  detail: SimplerOpportunityHit
): Record<string, unknown> {
  const base = { ...(hit as unknown as Record<string, unknown>) };
  const overlay = detail as unknown as Record<string, unknown>;
  for (const key of Object.keys(overlay)) {
    const next = overlay[key];
    if (next === undefined) continue;
    const prev = base[key];
    if (isPlainRecord(next) && isPlainRecord(prev)) {
      base[key] = { ...prev, ...next };
    } else {
      base[key] = next;
    }
  }
  return base;
}

function firstStringish(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

/** Simpler API nests dates, instruments, applicants, and award bounds on `summary` (object). */
function opportunitySummary(
  raw: Record<string, unknown>,
  hit: SimplerOpportunityHit
): Record<string, unknown> | null {
  const s = raw.summary ?? (hit as unknown as Record<string, unknown>).summary;
  if (s && typeof s === "object" && !Array.isArray(s)) {
    return s as Record<string, unknown>;
  }
  return null;
}

/** Join funding instrument(s) from string, string[], or {code|name|label}[] payloads. */
function normalizeInstrumentList(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string" && v.trim()) return v.trim();
  if (!Array.isArray(v) || v.length === 0) return null;
  const parts: string[] = [];
  for (const item of v) {
    if (typeof item === "string" && item.trim()) {
      parts.push(item.trim());
      continue;
    }
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const s = firstStringish(
        o.code,
        o.name,
        o.label,
        o.funding_instrument,
        o.fundingInstrument,
        o.type,
        o.value
      );
      if (s) parts.push(s);
    }
  }
  return parts.length ? parts.join(", ") : null;
}

function resolveFundingInstrument(hit: SimplerOpportunityHit, raw: Record<string, unknown>): string | null {
  const sm = opportunitySummary(raw, hit);
  const fromSummary =
    normalizeInstrumentList(sm?.funding_instruments) ??
    normalizeInstrumentList(sm?.fundingInstrument) ??
    firstStringish(sm?.funding_instrument as unknown);
  if (fromSummary) return fromSummary;
  const direct = firstStringish(
    hit.funding_instrument,
    raw.funding_instrument,
    raw.fundingInstrument,
    raw.primary_funding_instrument,
    raw.primaryFundingInstrument
  );
  if (direct) return direct;
  const fromArrays =
    normalizeInstrumentList(raw.funding_instruments) ??
    normalizeInstrumentList(hit.funding_instruments) ??
    normalizeInstrumentList(raw.opportunity_funding_instruments) ??
    normalizeInstrumentList(raw.opportunityFundingInstruments);
  if (fromArrays) return fromArrays;
  const inner = raw.opportunity ?? raw.data ?? raw.opportunity_details ?? raw.opportunityDetails;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    const n = inner as Record<string, unknown>;
    const nested = firstStringish(n.funding_instrument, n.fundingInstrument, n.primary_funding_instrument);
    if (nested) return nested;
    const arr =
      normalizeInstrumentList(n.funding_instruments) ?? normalizeInstrumentList(n.opportunity_funding_instruments);
    if (arr) return arr;
  }
  return null;
}

function coerceCategorySlug(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return firstStringish(o.slug, o.code, o.name, o.label, o.value, o.funding_category, o.fundingCategory);
  }
  return null;
}

function resolveFundingCategory(hit: SimplerOpportunityHit, raw: Record<string, unknown>): string | null {
  const sm = opportunitySummary(raw, hit);
  const singles: unknown[] = [
    sm?.funding_category,
    sm?.category,
    hit.funding_category,
    hit.category,
    raw.funding_category,
    raw.fundingCategory,
    raw.category,
    raw.opportunity_category,
    raw.opportunityCategory,
    raw.cfda_number,
    raw.cfdaNumber,
  ];
  for (const s of singles) {
    const t = coerceCategorySlug(s);
    if (t) return t;
  }
  const multi =
    sm?.funding_categories ??
    sm?.fundingCategories ??
    raw.funding_categories ??
    raw.fundingCategories ??
    hit.funding_categories;
  if (Array.isArray(multi) && multi.length > 0) {
    const parts = multi.map((x) => coerceCategorySlug(x)).filter((x): x is string => !!x);
    if (parts.length) return parts.join(", ");
  }
  const inner = raw.opportunity ?? raw.data ?? raw.opportunity_details ?? raw.opportunityDetails;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    const n = inner as Record<string, unknown>;
    const nested = coerceCategorySlug(n.funding_category ?? n.fundingCategory ?? n.category);
    if (nested) return nested;
  }
  return null;
}

/** JSONB-friendly list of applicant type codes/labels. */
function normalizeApplicantTypesForDb(v: unknown): unknown | null {
  if (v == null) return null;
  if (typeof v === "string") {
    const t = v.trim();
    return t ? [t] : null;
  }
  if (!Array.isArray(v) || v.length === 0) return null;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === "string" && item.trim()) {
      out.push(item.trim());
      continue;
    }
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const s = firstStringish(
        o.applicant_type,
        o.applicantType,
        o.code,
        o.name,
        o.label,
        o.description
      );
      if (s) out.push(s);
    }
  }
  return out.length ? out : null;
}

function resolveApplicantTypes(hit: SimplerOpportunityHit, raw: Record<string, unknown>): unknown | null {
  const sm = opportunitySummary(raw, hit);
  const candidates: unknown[] = [
    sm?.applicant_types,
    sm?.applicantTypes,
    hit.applicant_types,
    raw.applicant_types,
    raw.applicantTypes,
    raw.eligible_applicants,
    raw.eligibleApplicants,
    raw.applicant_eligibility,
    raw.applicantEligibility,
  ];
  for (const c of candidates) {
    const n = normalizeApplicantTypesForDb(c);
    if (n != null) return n;
  }
  const inner = raw.opportunity ?? raw.data ?? raw.opportunity_details ?? raw.opportunityDetails;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    const n = inner as Record<string, unknown>;
    const nested = normalizeApplicantTypesForDb(
      n.applicant_types ?? n.applicantTypes ?? n.eligible_applicants ?? n.eligibleApplicants
    );
    if (nested != null) return nested;
  }
  return null;
}

function coerceAwardNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const t = v.replace(/[$,\s]/g, "").trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function awardBoundsFromNested(v: unknown): { floor: number | null; ceiling: number | null } {
  if (!v || typeof v !== "object") return { floor: null, ceiling: null };
  const o = v as Record<string, unknown>;
  return {
    floor: coerceAwardNumber(
      o.floor ?? o.min ?? o.minimum ?? o.award_floor ?? o.awardFloor ?? o.lower_bound ?? o.lowerBound
    ),
    ceiling: coerceAwardNumber(
      o.ceiling ?? o.max ?? o.maximum ?? o.award_ceiling ?? o.awardCeiling ?? o.upper_bound ?? o.upperBound
    ),
  };
}

function resolveAwardFloor(hit: SimplerOpportunityHit, raw: Record<string, unknown>): number | null {
  const sm = opportunitySummary(raw, hit);
  const candidates: unknown[] = [
    sm?.award_floor,
    sm?.awardFloor,
    hit.award_floor,
    raw.award_floor,
    raw.awardFloor,
    raw.floor_award_amount,
    raw.floorAwardAmount,
    raw.estimated_award_floor,
    raw.estimatedAwardFloor,
    raw.award_floor_amount,
    raw.awardFloorAmount,
  ];
  for (const c of candidates) {
    const n = coerceAwardNumber(c);
    if (n != null) return n;
  }
  for (const key of ["award", "award_amount", "awardAmount", "award_range", "awardRange", "funding"]) {
    const b = awardBoundsFromNested(raw[key]);
    if (b.floor != null) return b.floor;
  }
  const inner = raw.opportunity ?? raw.data ?? raw.opportunity_details ?? raw.opportunityDetails;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    const n = inner as Record<string, unknown>;
    for (const c of [
      n.award_floor,
      n.awardFloor,
      n.floor_award_amount,
      n.floorAwardAmount,
    ]) {
      const x = coerceAwardNumber(c);
      if (x != null) return x;
    }
    const b = awardBoundsFromNested(n.award ?? n.award_amount ?? n.award_range ?? n);
    if (b.floor != null) return b.floor;
  }
  return null;
}

function resolveAwardCeiling(hit: SimplerOpportunityHit, raw: Record<string, unknown>): number | null {
  const sm = opportunitySummary(raw, hit);
  const candidates: unknown[] = [
    sm?.award_ceiling,
    sm?.awardCeiling,
    hit.award_ceiling,
    raw.award_ceiling,
    raw.awardCeiling,
    raw.ceiling_award_amount,
    raw.ceilingAwardAmount,
    raw.estimated_award_ceiling,
    raw.estimatedAwardCeiling,
    raw.award_ceiling_amount,
    raw.awardCeilingAmount,
  ];
  for (const c of candidates) {
    const n = coerceAwardNumber(c);
    if (n != null) return n;
  }
  for (const key of ["award", "award_amount", "awardAmount", "award_range", "awardRange", "funding"]) {
    const b = awardBoundsFromNested(raw[key]);
    if (b.ceiling != null) return b.ceiling;
  }
  const inner = raw.opportunity ?? raw.data ?? raw.opportunity_details ?? raw.opportunityDetails;
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    const n = inner as Record<string, unknown>;
    for (const c of [
      n.award_ceiling,
      n.awardCeiling,
      n.ceiling_award_amount,
      n.ceilingAwardAmount,
    ]) {
      const x = coerceAwardNumber(c);
      if (x != null) return x;
    }
    const b = awardBoundsFromNested(n.award ?? n.award_amount ?? n.award_range ?? n);
    if (b.ceiling != null) return b.ceiling;
  }
  return null;
}

/** Grants.gov / Simpler sometimes omit agency_name but still send agency_code (e.g. HHS-NIH-NCI). */
function resolveAgencyLabel(hit: SimplerOpportunityHit): string | null {
  const name = typeof hit.agency_name === "string" ? hit.agency_name.trim() : "";
  if (name) return normalizeAgencyDisplayName(name) ?? name;
  const code = typeof hit.agency_code === "string" ? hit.agency_code.trim() : "";
  if (code) return code;
  return null;
}

/** Posted / open date: Simpler search hits and raw_payload keys vary by notice type. */
function resolvePostedDate(hit: SimplerOpportunityHit, raw: Record<string, unknown>): string | null {
  const r = raw;
  const sm = opportunitySummary(r, hit);
  const dates = r.dates as Record<string, unknown> | undefined;
  const candidates: unknown[] = [
    sm?.post_date,
    sm?.postDate,
    sm?.posted_date,
    sm?.forecasted_post_date,
    sm?.forecastedPostDate,
    hit.post_date,
    r.post_date,
    r.postDate,
    r.open_date,
    r.openDate,
    r.release_date,
    r.releaseDate,
    r.posted_date,
    r.postedDate,
    r.publish_date,
    r.publishDate,
    r.published_date,
    r.publishedDate,
    r.opportunity_posted_date,
    r.opportunityPostedDate,
    r.synopsis_posted_date,
    r.synopsisPostedDate,
    r.forecasted_post_date,
    r.forecastedPostDate,
    hit.forecasted_post_date,
    r.anticipated_post_date,
    r.anticipatedPostDate,
    dates?.post_date,
    dates?.open_date,
    dates?.forecasted_post_date,
    dates?.release_date,
    dates?.posted_date,
    dates?.synopsis_posted_date,
  ];
  for (const c of candidates) {
    const d = coerceDateString(c);
    if (d) return d;
  }
  return null;
}

/** Application deadline / close: Simpler search hits and raw_payload keys vary by notice type. */
function resolveCloseDate(hit: SimplerOpportunityHit, raw: Record<string, unknown>): string | null {
  const r = raw;
  const sm = opportunitySummary(r, hit);
  const dates = r.dates as Record<string, unknown> | undefined;
  const candidates: unknown[] = [
    sm?.close_date,
    sm?.closeDate,
    sm?.application_due_date,
    sm?.forecasted_close_date,
    sm?.forecastedCloseDate,
    hit.close_date,
    r.close_date,
    r.closeDate,
    r.application_due_date,
    r.applicationDueDate,
    r.response_deadline,
    r.due_date,
    r.closing_date,
    r.forecasted_close_date,
    r.forecastedCloseDate,
    hit.forecasted_close_date,
    r.estimated_application_due_date,
    r.estimated_synopsis_close_date,
    r.opportunity_close_date,
    r.latest_close_date,
    r.original_close_date,
    r.synopsis_close_date,
    r.synopsisCloseDate,
    dates?.close_date,
    dates?.application_due_date,
    dates?.forecasted_close_date,
    dates?.synopsis_close_date,
  ];
  for (const c of candidates) {
    const d = coerceDateString(c);
    if (d) return d;
  }
  return null;
}

function descriptionFromHit(hit: SimplerOpportunityHit, raw: Record<string, unknown>): string {
  // `raw` is the hit (or the hit merged with its detail record); the second read only matters when a caller passes them apart.
  return descriptionFromRaw(raw) || descriptionFromRaw(hit as unknown as Record<string, unknown>);
}

/** The stored institute resolution, so a sync without the Guide text cannot demote a Guide-derived answer. */
export type StoredIcResolution = { nih_ic_tokens: string[] | null; nih_ic_source: string | null };

export function hitToFundingRow(hit: SimplerOpportunityHit, raw: Record<string, unknown>, prior: StoredIcResolution | null = null) {
  const title = String(hit.opportunity_title ?? "").trim() || "(untitled)";
  const description = descriptionFromHit(hit, raw);
  const status = hit.opportunity_status ?? null;
  const forecasted = status === "forecasted";

  const posted_date = resolvePostedDate(hit, raw);
  const close_date = resolveCloseDate(hit, raw);

  const rd = buildRdSignalColumns({
    title,
    description,
    opportunity_number: hit.opportunity_number,
    agency: resolveAgencyLabel(hit),
    agency_code: hit.agency_code ?? null,
    // The Guide is not read here (guide_sections stays undefined); the stored Guide answer stands in for it.
    agency_contact_description: agencyContactFromRaw(raw),
    prior: prior ? { tokens: prior.nih_ic_tokens, source: prior.nih_ic_source } : null,
  });

  return {
    source_system: "simpler_grants",
    source_opportunity_id: String(hit.opportunity_id ?? "").trim(),
    opportunity_number: hit.opportunity_number ?? null,
    title,
    agency: resolveAgencyLabel(hit),
    agency_code: hit.agency_code ?? null,
    posted_date,
    close_date,
    forecasted,
    status,
    funding_instrument: resolveFundingInstrument(hit, raw),
    category: resolveFundingCategory(hit, raw),
    applicant_types: resolveApplicantTypes(hit, raw),
    award_floor: resolveAwardFloor(hit, raw),
    award_ceiling: resolveAwardCeiling(hit, raw),
    description,
    raw_payload_json: raw,
    // Simpler's own "last changed" stamp (summary.updated_at on search hits; top-level updated_at on detail
    // records). The NIH Guide sync re-queues on this, never on the trigger-maintained updated_at.
    source_updated_at: sourceUpdatedAt(raw),
    ...rd,
  };
}

/**
 * `nih_ic_tokens` + `nih_ic_source` already stored for a page of hits, keyed by
 * Simpler opportunity id. One small read per page; a read failure yields an empty
 * map, in which case the upsert re-resolves from Simpler fields alone and the next
 * Guide sync restores any Guide-derived answer.
 */
async function loadStoredIcResolutions(supabase: SupabaseClient, hits: SimplerOpportunityHit[]): Promise<Map<string, StoredIcResolution>> {
  const keys = hits.map((h) => String(h.opportunity_id ?? "").trim()).filter(Boolean);
  const out = new Map<string, StoredIcResolution>();
  if (keys.length === 0) return out;
  const { data } = await supabase
    .from("funding_opportunities")
    .select("source_opportunity_id, nih_ic_tokens, nih_ic_source")
    .eq("source_system", "simpler_grants")
    .in("source_opportunity_id", keys);
  for (const r of (data ?? []) as Array<{ source_opportunity_id: string } & StoredIcResolution>) {
    out.set(r.source_opportunity_id, { nih_ic_tokens: r.nih_ic_tokens, nih_ic_source: r.nih_ic_source });
  }
  return out;
}

function isClosedStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return status === "closed" || status === "archived";
}

/**
 * Incremental sync from Simpler.Grants.gov: upsert by (source_system, source_opportunity_id).
 * No funding_category, agency, or free-text filter — all agencies that match the status filter are requested.
 * Caps pages so at most maxNofosPerRun rows are upserted (default 5000).
 * By default each hit is merged with GET /v1/opportunities/{id} so posted/close dates, instruments,
 * applicant types, and award bounds match the API detail shape (search hits are often incomplete).
 * Search is restricted to posted + forecasted statuses only (never closed/archived). Skips any closed/archived hits if present.
 * Skips upsert when the opportunity already exists and has any match in approved/rejected/hidden.
 * Dedupe key: UNIQUE (source_system, source_opportunity_id); IDs are trimmed from the API.
 */
export async function syncSimplerGrantsToSupabase(
  supabase: SupabaseClient,
  client: SimplerGrantsClient,
  params: SimplerSyncParams = {}
): Promise<SimplerSyncResult> {
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 50));
  const maxNofos = Math.min(
    10_000,
    Math.max(1, params.maxNofosPerRun ?? DEFAULT_MAX_NOFOS_PER_SYNC)
  );
  const maxPagesByCap = Math.ceil(maxNofos / pageSize);
  const maxPages = Math.min(params.maxPages ?? maxPagesByCap, maxPagesByCap);
  const includeForecasted = params.includeForecasted ?? true;
  const enrichWithDetailFetch = params.enrichWithDetailFetch !== false;

  const statuses = includeForecasted ? ["posted", "forecasted"] : ["posted"];

  const errors: string[] = [];
  let upserted = 0;
  let skippedClosed = 0;
  const skippedLocked = 0;
  let pagesFetched = 0;
  let apiTotalRecords: number | null = null;
  let apiTotalPages: number | null = null;

  const basePagination = (page: number) => ({
    page_offset: page,
    page_size: pageSize,
    sort_order: [{ order_by: "post_date" as const, sort_direction: "descending" as const }],
  });

  for (let page = 1; page <= maxPages; page += 1) {
    let resp: SimplerSearchResponse | null = null;
    try {
      resp = await client.searchOpportunities({
        filters: {
          opportunity_status: { one_of: statuses },
        },
        pagination: basePagination(page),
      });
    } catch (e) {
      const lastErr = e instanceof Error ? e.message : String(e);
      errors.push(`page ${page}: ${lastErr}`);
      break;
    }

    if (!resp) {
      break;
    }

    pagesFetched += 1;
    const hits = resp.data ?? [];
    const pi = resp.pagination_info;
    if (pi && typeof pi.total_records === "number") {
      apiTotalRecords = pi.total_records;
    }
    if (pi && typeof pi.total_pages === "number") {
      apiTotalPages = pi.total_pages;
    }
    if (hits.length === 0) break;

    // Prepare every row for the page (optionally enriched), then write in two batched upserts:
    // one for funding_opportunities and one for opportunity_features. Per-row round-trips were the
    // dominant cost and pushed full runs past serverless function time limits.
    const remainingBeforePage = maxNofos - upserted;
    if (remainingBeforePage <= 0) break;

    type FundingRow = ReturnType<typeof hitToFundingRow>;
    const pageRows: FundingRow[] = [];
    const rowBySourceId = new Map<string, FundingRow>();
    const priors = await loadStoredIcResolutions(supabase, hits);

    for (const hit of hits) {
      if (pageRows.length >= remainingBeforePage) break;
      const raw = hit as unknown as Record<string, unknown>;
      if (isClosedStatus(hit.opportunity_status)) {
        skippedClosed += 1;
        continue;
      }

      const sourceKey = String(hit.opportunity_id ?? "").trim();
      if (!sourceKey) {
        errors.push("skip hit: missing opportunity_id");
        continue;
      }
      let rawPayload: Record<string, unknown> = raw;
      if (enrichWithDetailFetch) {
        try {
          const detail = await client.getOpportunity(sourceKey);
          rawPayload = mergeHitWithDetail(hit, detail);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          errors.push(`getOpportunity ${sourceKey}: ${msg}`);
          rawPayload = raw;
        }
      }

      const mergedHit = rawPayload as unknown as SimplerOpportunityHit;
      const row = hitToFundingRow(mergedHit, rawPayload, priors.get(sourceKey) ?? null);
      if (!row.source_opportunity_id) {
        errors.push("skip hit: empty source_opportunity_id after trim");
        continue;
      }
      rowBySourceId.set(row.source_opportunity_id, row);
      pageRows.push(row);
    }

    if (pageRows.length > 0) {
      const { data: upData, error: upErr } = await supabase
        .from("funding_opportunities")
        .upsert(pageRows, { onConflict: "source_system,source_opportunity_id" })
        .select("id, source_opportunity_id");
      if (upErr) {
        errors.push(`upsert page ${page}: ${upErr.message}`);
      } else {
        upserted += upData?.length ?? 0;
        const featureRows = (upData ?? [])
          .map((r: { id: string; source_opportunity_id: string }) => {
            const src = rowBySourceId.get(r.source_opportunity_id);
            if (!src) return null;
            const feats = extractOpportunityFeatures({
              title: src.title,
              description: src.description ?? "",
              category: src.category,
              funding_instrument: src.funding_instrument,
            });
            return { opportunity_id: r.id, ...feats };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);
        if (featureRows.length > 0) {
          const { error: featErr } = await supabase
            .from("opportunity_features")
            .upsert(featureRows, { onConflict: "opportunity_id" });
          if (featErr) errors.push(`features page ${page}: ${featErr.message}`);
        }
      }
    }

    if (upserted >= maxNofos) {
      break;
    }

    const totalPages = resp.pagination_info?.total_pages;
    if (typeof totalPages === "number" && totalPages >= 1 && page >= totalPages) {
      break;
    }
  }

  return {
    pagesFetched,
    upserted,
    skippedClosed,
    skippedLocked,
    apiTotalRecords,
    apiTotalPages,
    errors,
  };
}
