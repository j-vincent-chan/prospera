"use server";

import { revalidatePath } from "next/cache";
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";
import { isoToday } from "@/lib/funding-opportunities/receipt-cycles";
import { logAudit } from "@/lib/institution/audit";
import { AWARD_COLUMNS, awardsToCsv, fyWindow, isCompeting, parseAwardsFilters, sponsorMatches, type AwardRow, type AwardsFilters } from "@/lib/institution/awards";
import { mapHeaders, normalizeOsrRows, REQUIRED_FIELDS, type OsrRowInput } from "@/lib/institution/osr-import";
import { linkAwardPis, syncReporterAwards } from "@/lib/institution/reporter-sync";
import { requireInstitutionRole } from "@/lib/institution/roles";
import { currentFiscalYear } from "@/lib/institution/awards";

type Ok<T> = { ok: true } & T;
type Fail = { ok: false; error: string };
type Result<T = Record<never, never>> = Ok<T> | Fail;

function revalidate() {
  revalidatePath("/library/awards");
  revalidatePath("/library");
  revalidatePath("/opportunities");
  revalidatePath("/team/data-sources");
}

export async function previewOsrImportAction(input: { headers: string[] }): Promise<Result<{ mapping: Record<string, string>; missing: string[] }>> {
  const guard = await requireInstitutionRole("library_steward");
  if (!guard.ok) return guard;
  const mapping = mapHeaders(input.headers);
  const missing = REQUIRED_FIELDS.filter((f) => !mapping[f]);
  return { ok: true, mapping, missing: [...missing] };
}

/** Import parsed rows from an OSR export (client parses CSV with papaparse; rows arrive as objects keyed by header). */
export async function importOsrRowsAction(input: { fileName: string; headers: string[]; rows: OsrRowInput[] }): Promise<Result<{ awards: number; declines: number; skipped: number; skippedReasons: Record<string, number>; batchId: string }>> {
  const guard = await requireInstitutionRole("library_steward");
  if (!guard.ok) return guard;
  if (!input.rows.length) return { ok: false, error: "The file has no data rows." };
  if (input.rows.length > 20_000) return { ok: false, error: "Import at most 20,000 rows at a time." };
  const mapping = mapHeaders(input.headers);
  const missing = REQUIRED_FIELDS.filter((f) => !mapping[f]);
  if (missing.length) return { ok: false, error: `Couldn't find a ${missing.join(" or ")} column in the file.` };
  const { admin, actor } = guard;
  const { data: batch, error: bErr } = await admin.from("osr_import_batches").insert({ kind: "osr_export", file_name: input.fileName.slice(0, 200), imported_by: actor.userId, imported_by_name: actor.fullName ?? actor.email }).select("id").single();
  if (bErr || !batch) return { ok: false, error: bErr?.message ?? "Could not start the import." };
  const batchId = (batch as { id: string }).id;
  const normalized = normalizeOsrRows(input.rows, mapping, batchId);
  const fys = new Set<number>();
  for (const r of [...normalized.awards, ...normalized.declines]) if (typeof r.fiscal_year === "number") fys.add(r.fiscal_year);
  for (let i = 0; i < normalized.awards.length; i += 200) {
    const { error } = await admin.from("osr_awards").upsert(normalized.awards.slice(i, i + 200), { onConflict: "source,external_id" });
    if (error) return { ok: false, error: `Awards: ${error.message}` };
  }
  for (let i = 0; i < normalized.declines.length; i += 200) {
    const { error } = await admin.from("osr_declines").upsert(normalized.declines.slice(i, i + 200), { onConflict: "source,external_id" });
    if (error) return { ok: false, error: `Declines: ${error.message}` };
  }
  await admin.from("osr_import_batches").update({ awards_upserted: normalized.awards.length, declines_upserted: normalized.declines.length, skipped: normalized.skipped, fiscal_years: Array.from(fys).sort() }).eq("id", batchId);
  await admin.from("sync_job_logs").insert({ job_type: "osr_awards", status: "success", message: `OSR export “${input.fileName}”: ${normalized.awards.length} awards, ${normalized.declines.length} declines, ${normalized.skipped} skipped`, details: { source: "osr", batchId, ...normalized.skippedReasons }, finished_at: new Date().toISOString() });
  await logAudit(admin, { entityType: "osr_import_batch", entityId: batchId, action: "import", actorId: actor.userId, actorName: actor.fullName, details: { fileName: input.fileName, awards: normalized.awards.length, declines: normalized.declines.length, skipped: normalized.skipped } });
  void linkAwardPis(admin);
  revalidate();
  return { ok: true, awards: normalized.awards.length, declines: normalized.declines.length, skipped: normalized.skipped, skippedReasons: normalized.skippedReasons, batchId };
}

export async function undoOsrImportAction(input: { batchId: string }): Promise<Result<{ removed: number }>> {
  const guard = await requireInstitutionRole("library_steward");
  if (!guard.ok) return guard;
  const { admin, actor } = guard;
  const { count: a } = await admin.from("osr_awards").delete({ count: "exact" }).eq("import_batch_id", input.batchId);
  const { count: d } = await admin.from("osr_declines").delete({ count: "exact" }).eq("import_batch_id", input.batchId);
  await admin.from("osr_import_batches").delete().eq("id", input.batchId);
  await logAudit(admin, { entityType: "osr_import_batch", entityId: input.batchId, action: "undo_import", actorId: actor.userId, actorName: actor.fullName, details: { awards: a ?? 0, declines: d ?? 0 } });
  revalidate();
  return { ok: true, removed: (a ?? 0) + (d ?? 0) };
}

/** Pull the last three fiscal years of UCSF awards from NIH RePORTER (public). */
export async function syncReporterAwardsAction(): Promise<Result<{ upserted: number; fiscalYears: number[] }>> {
  const guard = await requireInstitutionRole("library_steward");
  if (!guard.ok) return guard;
  const fy = currentFiscalYear(isoToday());
  const r = await syncReporterAwards(guard.admin, { fiscalYears: [fy - 2, fy - 1, fy], actorId: guard.actor.userId, actorName: guard.actor.fullName });
  if (!r.ok) return { ok: false, error: r.error ?? "Sync failed." };
  void linkAwardPis(guard.admin);
  revalidate();
  return { ok: true, upserted: r.upserted, fiscalYears: r.fiscalYears };
}

export async function exportAwardsCsvAction(input: { filters: Partial<AwardsFilters> }): Promise<Result<{ csv: string; rows: number }>> {
  const guard = await requireInstitutionRole(null);
  if (!guard.ok) return guard;
  const filters = parseAwardsFilters({ ...(input.filters as Record<string, string>), page: "1" });
  const win = fyWindow(filters.window, isoToday());
  const { data } = await fetchAllRows<AwardRow>(async (from, to) => {
    let q = guard.session.from("osr_awards").select(AWARD_COLUMNS).order("award_date", { ascending: false, nullsFirst: false }).range(from, to);
    if (win.from != null) q = q.gte("fiscal_year", win.from);
    if (filters.mechanism) q = q.eq("mechanism", filters.mechanism);
    if (filters.department) q = q.eq("department", filters.department);
    if (filters.q) {
      const pattern = `*${filters.q.replace(/[%_*,()]/g, " ").trim()}*`;
      q = q.or(`title.ilike.${pattern},pi_name.ilike.${pattern},award_number.ilike.${pattern}`);
    }
    return await q;
  });
  const rows = data.filter((a) => sponsorMatches(a, filters.sponsor) && isCompeting(a));
  return { ok: true, csv: awardsToCsv(rows), rows: rows.length };
}
