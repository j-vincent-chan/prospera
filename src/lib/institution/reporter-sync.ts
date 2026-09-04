/**
 * Public NIH RePORTER sync of UCSF awards. This is the always-available
 * source for the Awards page and the track-record panel; it is labeled
 * "NIH RePORTER" (public), never OSR-verified. OSR exports overwrite nothing
 * here — they live under source = 'osr'.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { AsyncRateLimiter } from "@/lib/utils/async-rate-limiter";
import { IC_BY_PREFIX, activityCodeOf, institutePrefixOf, tidyDepartment } from "@/lib/institution/types";

const REPORTER_SEARCH = "https://api.reporter.nih.gov/v2/projects/search";
const PAGE = 500;
const limiter = new AsyncRateLimiter(1100);
export const UCSF_ORG_NAMES = ["UNIVERSITY OF CALIFORNIA, SAN FRANCISCO", "UNIVERSITY OF CALIFORNIA SAN FRANCISCO"];

type ReporterProject = {
  appl_id?: number;
  project_num?: string;
  core_project_num?: string;
  project_title?: string;
  contact_pi_name?: string;
  principal_investigators?: Array<{ full_name?: string; first_name?: string; last_name?: string; is_contact_pi?: boolean }>;
  organization?: { org_name?: string; org_dept?: string; org_city?: string };
  agency_ic_admin?: { abbreviation?: string; name?: string };
  activity_code?: string;
  appl_type_code?: number | string;
  fiscal_year?: number;
  award_notice_date?: string;
  project_start_date?: string;
  project_end_date?: string;
  direct_cost_amt?: number;
  indirect_cost_amt?: number;
  award_amount?: number;
  abstract_text?: string;
  project_detail_url?: string;
};

function isoDate(v: string | undefined): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function mapReporterProject(p: ReporterProject, batchId: string | null) {
  const num = p.project_num ?? null;
  // RePORTER's application type: the leading digit of the project number (1 new, 2 renewal, 3 supplement,
  // 5 non-competing continuation, 7 change of grantee, 9 change of institute). The API field is not always returned.
  const type = p.appl_type_code != null ? String(p.appl_type_code) : num && /^\d/.test(num) ? num[0] : null;
  const resub = /-\d{2}A\d/.test(num ?? "") || /A1$/.test(num ?? "");
  const inst = p.agency_ic_admin?.abbreviation ?? (institutePrefixOf(num) ? IC_BY_PREFIX[institutePrefixOf(num)!] ?? null : null);
  return {
    source: "reporter" as const,
    external_id: String(p.appl_id ?? num ?? ""),
    award_number: num,
    core_project_num: p.core_project_num ?? null,
    title: (p.project_title ?? "Untitled project").trim(),
    pi_name: p.contact_pi_name ?? p.principal_investigators?.find((x) => x.is_contact_pi)?.full_name ?? p.principal_investigators?.[0]?.full_name ?? null,
    department: tidyDepartment(p.organization?.org_dept),
    division: null,
    sponsor: "NIH",
    institute: inst,
    mechanism: p.activity_code ?? activityCodeOf(num),
    application_type: type,
    is_resubmission: resub,
    fiscal_year: p.fiscal_year ?? null,
    award_date: isoDate(p.award_notice_date),
    receipt_date: null,
    project_start: isoDate(p.project_start_date),
    project_end: isoDate(p.project_end_date),
    direct_cost: p.direct_cost_amt ?? null,
    total_cost: p.award_amount ?? (p.direct_cost_amt != null && p.indirect_cost_amt != null ? p.direct_cost_amt + p.indirect_cost_amt : null),
    abstract: p.abstract_text ? p.abstract_text.slice(0, 20_000) : null,
    reporter_url: p.project_detail_url ?? (p.appl_id ? `https://reporter.nih.gov/project-details/${p.appl_id}` : null),
    raw: null,
    import_batch_id: batchId,
    imported_at: new Date().toISOString(),
  };
}

export type ReporterSyncResult = { ok: boolean; upserted: number; fiscalYears: number[]; pages: number; error: string | null };

export async function syncReporterAwards(admin: SupabaseClient, opts: { fiscalYears: number[]; actorId?: string | null; actorName?: string | null; log?: (line: string) => void }): Promise<ReporterSyncResult> {
  const started = new Date().toISOString();
  const { data: batch } = await admin.from("osr_import_batches").insert({ kind: "reporter_sync", fiscal_years: opts.fiscalYears, imported_by: opts.actorId ?? null, imported_by_name: opts.actorName ?? null }).select("id").single();
  const batchId = (batch as { id: string } | null)?.id ?? null;
  let upserted = 0;
  let pages = 0;
  let error: string | null = null;
  try {
    for (const fy of opts.fiscalYears) {
      let offset = 0;
      while (true) {
        const body = { criteria: { org_names: UCSF_ORG_NAMES, fiscal_years: [fy] }, include_fields: ["ApplId", "ProjectNum", "CoreProjectNum", "ProjectTitle", "ContactPiName", "PrincipalInvestigators", "Organization", "AgencyIcAdmin", "ActivityCode", "ApplTypeCode", "FiscalYear", "AwardNoticeDate", "ProjectStartDate", "ProjectEndDate", "DirectCostAmt", "IndirectCostAmt", "AwardAmount", "AbstractText", "ProjectDetailUrl"], limit: PAGE, offset, sort_field: "award_notice_date", sort_order: "desc" };
        const res = await limiter.schedule(() => fetch(REPORTER_SEARCH, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body), cache: "no-store" }));
        if (!res.ok) throw new Error(`RePORTER API ${res.status}: ${(await res.text()).slice(0, 300)}`);
        const json = (await res.json()) as { results?: ReporterProject[]; meta?: { total?: number } };
        const page = json.results ?? [];
        pages += 1;
        const rows = page.map((p) => mapReporterProject(p, batchId)).filter((r) => r.external_id);
        for (let i = 0; i < rows.length; i += 100) {
          const { error: upErr } = await admin.from("osr_awards").upsert(rows.slice(i, i + 100), { onConflict: "source,external_id" });
          if (upErr) throw new Error(`osr_awards upsert: ${upErr.message}`);
          upserted += Math.min(100, rows.length - i);
        }
        opts.log?.(`FY${fy}: ${offset + page.length}${json.meta?.total != null ? ` of ${json.meta.total}` : ""}`);
        if (page.length < PAGE) break;
        offset += page.length;
        if (offset >= 14_500) break; // RePORTER caps offset at 14,999
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  if (batchId) await admin.from("osr_import_batches").update({ awards_upserted: upserted }).eq("id", batchId);
  await admin.from("sync_job_logs").insert({ job_type: "osr_awards", status: error ? "error" : "success", message: error ?? `${upserted} UCSF awards from NIH RePORTER (FY${opts.fiscalYears.join(", FY")})`, details: { source: "reporter", upserted, pages, fiscalYears: opts.fiscalYears }, started_at: started, finished_at: new Date().toISOString() });
  return { ok: !error, upserted, fiscalYears: opts.fiscalYears, pages, error };
}

/** Best-effort link of award PI names to the investigator directory (exact last name + first initial). */
export async function linkAwardPis(admin: SupabaseClient): Promise<number> {
  const { data: invs } = await admin.from("investigators").select("id, first_name, last_name").is("archived_at", null);
  const key = (last: string, first: string) => `${last.trim().toLowerCase()}|${first.trim().slice(0, 1).toLowerCase()}`;
  const byKey = new Map<string, string>();
  for (const i of (invs ?? []) as Array<{ id: string; first_name: string | null; last_name: string | null }>) if (i.last_name && i.first_name) byKey.set(key(i.last_name, i.first_name), i.id);
  const { data: awards } = await admin.from("osr_awards").select("id, pi_name").is("pi_investigator_id", null).limit(5000);
  let linked = 0;
  for (const a of (awards ?? []) as Array<{ id: string; pi_name: string | null }>) {
    if (!a.pi_name) continue;
    const [last, first] = a.pi_name.includes(",") ? a.pi_name.split(",").map((s) => s.trim()) : [a.pi_name.trim().split(/\s+/).slice(-1)[0], a.pi_name.trim().split(/\s+/)[0]];
    const id = first ? byKey.get(key(last, first)) : undefined;
    if (!id) continue;
    const { error } = await admin.from("osr_awards").update({ pi_investigator_id: id }).eq("id", a.id);
    if (!error) linked += 1;
  }
  return linked;
}
