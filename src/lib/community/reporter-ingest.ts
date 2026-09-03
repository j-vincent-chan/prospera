/**
 * NIH RePORTER projects API v2.
 *
 * Only `criteria.pi_profile_ids` from `investigators.nih_profile_id` (positive integer,
 * RePORTER / eRA PI profile id). Name-based search is intentionally not used — it matches
 * unrelated PIs who share a first or last name.
 *
 * If `nih_profile_id` is missing, cached rows for this investigator are cleared and the
 * refresh returns `skipped: "missing_nih_profile_id"` (no API call).
 *
 * Results are attributed to a single investigator row; multi-PI projects may still list
 * other investigators in API payloads.
 *
 * Only **new** awards are stored: project numbers must start with `1` (type-1 / new mechanism).
 * Continuing renewals (e.g. leading `5`) are skipped.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeReporterAgencyField,
  normalizeReporterOrgName,
  pickReporterProjectTitle,
} from "@/lib/community/reporter-display";
import { isNihNewGrantByProjectNum } from "@/lib/community/signal-nih-funding";
import { AsyncRateLimiter } from "@/lib/utils/async-rate-limiter";

const REPORTER_SEARCH = "https://api.reporter.nih.gov/v2/projects/search";
const REPORTER_MIN_INTERVAL_MS = Number(process.env.REPORTER_MIN_INTERVAL_MS ?? 250);
const reporterRateLimiter = new AsyncRateLimiter(REPORTER_MIN_INTERVAL_MS);

export type ReporterIngestResult = {
  inserted: number;
  searchText: string;
  warning?: string;
  /** Set when refresh did not call the API (e.g. no `nih_profile_id`). */
  skipped?: "missing_nih_profile_id";
};

type ReporterResponse = {
  results?: Array<Record<string, unknown>>;
  meta?: { total?: number };
};

function pickProjectNum(row: Record<string, unknown>): string {
  const n =
    (row.project_num as string | undefined) ??
    (row.project_num_alias as string | undefined) ??
    (row.core_project_num as string | undefined);
  return String(n ?? "").trim() || "unknown";
}

function pickFiscalYear(row: Record<string, unknown>): number {
  const fy = row.fiscal_year ?? row.award_notice_date;
  if (typeof fy === "number" && Number.isFinite(fy)) return fy;
  const s = String(fy ?? "");
  const m = s.match(/([12]\d{3})/);
  if (m) return parseInt(m[1], 10);
  return new Date().getFullYear();
}

/** RePORTER expects numeric PI profile ids (see API: criteria.pi_profile_ids). */
function parseReporterPiProfileId(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, "");
  if (!digits) return null;
  const n = parseInt(digits, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

const REPORTER_PAGE_SIZE = 100;

function resolveReporterMaxResults(optsLimit?: number): number | null {
  void optsLimit;
  return null;
}

/**
 * Pull NIH projects for this investigator using only RePORTER `pi_profile_ids`
 * (`investigators.nih_profile_id`).
 */
export async function refreshInvestigatorReporter(
  supabase: SupabaseClient,
  investigatorId: string,
  opts: { limit?: number } = {}
): Promise<ReporterIngestResult> {
  const maxResults = resolveReporterMaxResults(opts.limit);

  const { data: inv, error: invErr } = await supabase
    .from("investigators")
    .select("id, home_department, division, nih_profile_id")
    .eq("id", investigatorId)
    .maybeSingle();

  if (invErr || !inv) {
    throw new Error(invErr?.message ?? "Investigator not found");
  }

  const profileId = parseReporterPiProfileId(inv.nih_profile_id);

  const dept = [inv.home_department, inv.division].filter(Boolean).join(" ");

  if (profileId == null) {
    await supabase.from("investigator_nih_grants").delete().eq("investigator_id", investigatorId);
    return {
      inserted: 0,
      searchText: "skipped — no investigators.nih_profile_id",
      skipped: "missing_nih_profile_id",
      warning:
        "NIH RePORTER refresh requires a saved NIH Reporter PI profile id (digits only). Name-based search is disabled so unrelated PIs are not mixed in.",
    };
  }

  const searchText = `pi_profile_ids:[${profileId}] (from investigators.nih_profile_id)${dept ? `; context: ${dept}` : ""}`;
  const criteria: Record<string, unknown> = {
    pi_profile_ids: [profileId],
  };

  const rows: Array<Record<string, unknown>> = [];
  let offset = 0;
  let truncated = false;

  while (true) {
    const remaining = maxResults == null ? REPORTER_PAGE_SIZE : Math.max(0, maxResults - rows.length);
    if (remaining <= 0) break;
    const limit = Math.min(REPORTER_PAGE_SIZE, remaining);
    const body = {
      criteria,
      limit,
      offset,
      sort_field: "fiscal_year",
      sort_order: "desc",
    };

    const res = await reporterRateLimiter.schedule(() =>
      fetch(REPORTER_SEARCH, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      })
    );

    if (!res.ok) {
      const t = await res.text();
      throw new Error(`RePORTER API ${res.status}: ${t.slice(0, 400)}`);
    }

    const json = (await res.json()) as ReporterResponse;
    const page = json.results ?? [];
    rows.push(...page);
    if (page.length < limit) break;
    offset += page.length;
    if (maxResults != null && rows.length >= maxResults) {
      truncated = true;
      break;
    }
  }

  // Replace cache wholesale so prior name-based or wrong-profile rows cannot linger.
  const { error: delErr } = await supabase
    .from("investigator_nih_grants")
    .delete()
    .eq("investigator_id", investigatorId);
  if (delErr) {
    throw new Error(delErr.message);
  }

  if (!rows.length) {
    return {
      inserted: 0,
      searchText,
      warning:
        "No projects for this PI profile id — confirm investigators.nih_profile_id matches RePORTER.",
    };
  }

  const capWarning = truncated
    ? `RePORTER fetch reached configured limit (${maxResults}) projects.`
    : undefined;

  let inserted = 0;
  let skippedContinuing = 0;
  const confidence = "high";
  for (const row of rows) {
    const project_num = pickProjectNum(row);
    if (!isNihNewGrantByProjectNum(project_num)) {
      skippedContinuing += 1;
      continue;
    }
    const fiscal_year = pickFiscalYear(row);
    const ic =
      normalizeReporterAgencyField(row.agency_ic_admin) ??
      normalizeReporterAgencyField(row.ic_name) ??
      normalizeReporterAgencyField(row.ic);
    const org =
      normalizeReporterOrgName(row.organization_name) ??
      normalizeReporterOrgName(row.org_name);
    const amt = row.award_amount ?? row.spending_categories ?? null;
    const award_amount =
      typeof amt === "number"
        ? amt
        : typeof amt === "string"
          ? parseFloat(amt)
          : null;

    const project_title = pickReporterProjectTitle(row) || null;

    const { error } = await supabase.from("investigator_nih_grants").upsert(
      {
        investigator_id: investigatorId,
        project_num,
        fiscal_year,
        project_title,
        ic_name: ic,
        org_name: org,
        award_amount: Number.isFinite(award_amount as number) ? award_amount : null,
        is_active: true,
        source: "reporter_api_v2",
        raw_json: row,
        match_confidence: confidence,
        identity_method: "profile_id",
        identity_status: "verified",
      },
      { onConflict: "investigator_id,project_num,fiscal_year" }
    );
    if (!error) inserted += 1;
  }

  const continuingNote =
    skippedContinuing > 0
      ? `Skipped ${skippedContinuing} continuing/competing renewal project(s) (project number does not start with 1).`
      : undefined;

  return {
    inserted,
    searchText,
    warning: [capWarning, continuingNote].filter(Boolean).join(" ") || undefined,
  };
}
