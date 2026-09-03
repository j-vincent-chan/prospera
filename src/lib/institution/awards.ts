/**
 * UCSF award history: filters, KPIs, table, success rates (aggregate-only
 * through the osr_success_rates RPC) and the Opportunity Detail track-record
 * panel. Awards come from an OSR export (OSR-verified) or the public NIH
 * RePORTER sync; declines only ever arrive from OSR.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows";
import { fiscalYearOf, fyRangeLabel, median, money, pct, piShort } from "@/lib/institution/types";

export type AwardRow = {
  id: string;
  source: "osr" | "reporter";
  external_id: string;
  award_number: string | null;
  core_project_num: string | null;
  title: string;
  pi_name: string | null;
  pi_investigator_id: string | null;
  department: string | null;
  division: string | null;
  sponsor: string | null;
  institute: string | null;
  mechanism: string | null;
  application_type: string | null;
  is_resubmission: boolean | null;
  fiscal_year: number | null;
  award_date: string | null;
  receipt_date: string | null;
  project_start: string | null;
  project_end: string | null;
  direct_cost: number | null;
  total_cost: number | null;
  reporter_url: string | null;
};

export const AWARD_COLUMNS = "id, source, external_id, award_number, core_project_num, title, pi_name, pi_investigator_id, department, division, sponsor, institute, mechanism, application_type, is_resubmission, fiscal_year, award_date, receipt_date, project_start, project_end, direct_cost, total_cost, reporter_url";

export type AwardsFilters = { q: string; sponsor: string; mechanism: string; department: string; window: "3" | "5" | "10" | "all"; page: number };
export const AWARDS_PER_PAGE = 25;

export function parseAwardsFilters(sp: Record<string, string | string[] | undefined>): AwardsFilters {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const w = s("window");
  return { q: s("q").trim(), sponsor: s("sponsor"), mechanism: s("mechanism"), department: s("department"), window: w === "5" || w === "10" || w === "all" ? w : "3", page: Math.max(1, Number(s("page")) || 1) };
}

export function awardsHref(f: Partial<AwardsFilters>, base: AwardsFilters): string {
  const merged = { ...base, ...f };
  const p = new URLSearchParams();
  if (merged.q) p.set("q", merged.q);
  if (merged.sponsor) p.set("sponsor", merged.sponsor);
  if (merged.mechanism) p.set("mechanism", merged.mechanism);
  if (merged.department) p.set("department", merged.department);
  if (merged.window !== "3") p.set("window", merged.window);
  if (merged.page > 1) p.set("page", String(merged.page));
  const qs = p.toString();
  return `/library/awards${qs ? `?${qs}` : ""}`;
}

export function currentFiscalYear(today: string): number {
  return fiscalYearOf(today);
}

export function fyWindow(window: AwardsFilters["window"], today: string): { from: number | null; to: number } {
  const to = currentFiscalYear(today);
  if (window === "all") return { from: null, to };
  return { from: to - Number(window) + 1, to };
}

/** Competing (new / renewal / resubmission) awards only, so continuation years are not counted as wins. */
export function isCompeting(a: { application_type: string | null }): boolean {
  const t = (a.application_type ?? "").toLowerCase();
  return t === "" || t === "1" || t === "2" || t === "9" || t === "new" || t === "renewal" || t === "resubmission" || t === "competing";
}

export function sponsorMatches(a: { sponsor: string | null; institute: string | null }, sponsor: string): boolean {
  if (!sponsor) return true;
  const s = (a.sponsor ?? "").toUpperCase();
  if (sponsor === "Foundations") return Boolean(s) && !["NIH", "NSF", "DOD", "DEPARTMENT OF DEFENSE"].includes(s) && !/^NIH/.test(s);
  return s === sponsor.toUpperCase() || s.startsWith(sponsor.toUpperCase());
}

export type AwardsData = {
  filters: AwardsFilters;
  facets: { mechanisms: string[]; departments: string[]; sponsors: string[] };
  header: { total: number; declines: number; sinceFy: number | null; osrVerified: boolean; lastImport: { when: string; kind: "osr_export" | "reporter_sync"; by: string | null } | null };
  kpis: Array<{ label: string; value: string; sub: string }>;
  table: { rows: Array<AwardRow & { piLine: string; amountLine: string; periodLine: string; library: { label: string; href: string } | null }>; total: number; page: number; perPage: number; caption: string; fyLabel: string };
  rates: { title: string; fyLabel: string; headline: string | null; sub: string; bars: Array<{ label: string; n: string; pct: string; width: number; tone: "teal" | "light" }>; needsOsr: boolean; reference: string | null };
};

export async function loadAwards(db: SupabaseClient, filters: AwardsFilters, today: string): Promise<AwardsData> {
  const win = fyWindow(filters.window, today);
  const [{ data: all, truncated }, batches, declinesCount, libraryLinks, refRates] = await Promise.all([
    fetchAllRows<AwardRow>(async (from, to) => {
      let q = db.from("osr_awards").select(AWARD_COLUMNS).order("award_date", { ascending: false, nullsFirst: false }).order("fiscal_year", { ascending: false }).range(from, to);
      if (win.from != null) q = q.gte("fiscal_year", win.from);
      if (filters.mechanism) q = q.eq("mechanism", filters.mechanism);
      if (filters.department) q = q.eq("department", filters.department);
      if (filters.q) {
        const pattern = `%${filters.q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
        q = q.or(`title.ilike.${pattern},pi_name.ilike.${pattern},abstract.ilike.${pattern},award_number.ilike.${pattern}`);
      }
      return await q;
    }),
    db.from("osr_import_batches").select("kind, created_at, imported_by_name").order("created_at", { ascending: false }).limit(1),
    db.rpc("osr_success_rates", { p_fy_from: null, p_fy_to: null }),
    db.from("library_items").select("id, linked_award_number, content_type").eq("review_status", "published").is("removed_at", null).not("linked_award_number", "is", null),
    db.from("reference_success_rates").select("mechanism, fiscal_year, rate, label").order("fiscal_year", { ascending: false }),
  ]);
  void truncated;
  const facetsSource = all;
  const rowsAll = all.filter((a) => sponsorMatches(a, filters.sponsor) && isCompeting(a));
  const mechanisms = Array.from(new Set(facetsSource.map((a) => a.mechanism).filter((x): x is string => Boolean(x)))).sort();
  const departments = Array.from(new Set(facetsSource.map((a) => a.department).filter((x): x is string => Boolean(x)))).sort();
  const sponsors = Array.from(new Set(facetsSource.map((a) => a.sponsor).filter((x): x is string => Boolean(x)))).sort();

  const libByAward = new Map<string, { label: string; href: string }>();
  for (const l of (libraryLinks.data ?? []) as Array<{ id: string; linked_award_number: string; content_type: string }>) {
    const core = coreOf(l.linked_award_number);
    const label = l.content_type === "specific_aims" ? "Aims in library" : l.content_type === "research_strategy" ? "Strategy in library" : "Example in library";
    if (core && !libByAward.has(core)) libByAward.set(core, { label, href: `/library?item=${l.id}` });
  }

  const osrRows = rowsAll.filter((a) => a.source === "osr");
  const osrVerified = osrRows.length > 0;
  const fyFrom = win.from ?? Math.min(...rowsAll.map((a) => a.fiscal_year ?? win.to), win.to);
  const fyLbl = fyRangeLabel(fyFrom, win.to);
  const directs = rowsAll.map((a) => Number(a.direct_cost)).filter((n) => Number.isFinite(n) && n > 0);
  const directTotal = directs.reduce((n, x) => n + x, 0);
  const med = median(directs);
  const mechLabel = filters.mechanism ? `${filters.mechanism}s` : "awards";
  const deptLabel = filters.department ? ` · ${filters.department}` : "";

  // Success rates (aggregate RPC) — only meaningful once OSR declines exist.
  const totalDeclines = ((declinesCount.data ?? []) as Array<{ bucket: string; funded: number; declined: number }>).reduce((n, r) => n + Number(r.declined), 0);
  const { data: rateRows } = await db.rpc("osr_success_rates", { p_mechanism: filters.mechanism || null, p_department: filters.department || null, p_sponsor: filters.sponsor && filters.sponsor !== "Foundations" ? filters.sponsor : null, p_fy_from: win.from, p_fy_to: win.to });
  const rr = (rateRows ?? []) as Array<{ bucket: "first" | "resubmission"; funded: number; declined: number }>;
  const first = rr.find((r) => r.bucket === "first") ?? { funded: 0, declined: 0 };
  const resub = rr.find((r) => r.bucket === "resubmission") ?? { funded: 0, declined: 0 };
  const funded = Number(first.funded) + Number(resub.funded);
  const submitted = funded + Number(first.declined) + Number(resub.declined);
  const needsOsr = totalDeclines === 0;
  const ref = (refRates.data ?? []) as Array<{ mechanism: string; fiscal_year: number; rate: number; label: string }>;
  const refRow = filters.mechanism ? ref.find((r) => r.mechanism === filters.mechanism && r.fiscal_year <= win.to) ?? null : null;
  const reference = refRow ? `${refRow.label} ${refRow.mechanism} rate, FY${refRow.fiscal_year}: ${Math.round(Number(refRow.rate))}%` : null;

  const timeToAward = osrRows.map((a) => (a.receipt_date && a.award_date ? (Date.parse(a.award_date) - Date.parse(a.receipt_date)) / (30.44 * 86_400_000) : NaN)).filter((n) => Number.isFinite(n) && n > 0);
  const tta = median(timeToAward);

  const kpis: AwardsData["kpis"] = [
    { label: `Funded ${mechLabel}${deptLabel} · ${fyLbl}`, value: rowsAll.length.toLocaleString("en-US"), sub: directs.length ? `${money(directTotal)} direct · median ${money(med)} / yr` : "direct costs not on file" },
    needsOsr
      ? { label: `Success rate${filters.mechanism ? ` · ${filters.mechanism}` : ""}${deptLabel}`, value: "—", sub: "Needs OSR's declined-submission export" }
      : { label: `Success rate${filters.mechanism ? ` · ${filters.mechanism}` : ""}${deptLabel}`, value: pct(funded, submitted), sub: `${submitted.toLocaleString("en-US")} submitted${refRow ? ` · ${refRow.label} ${Math.round(Number(refRow.rate))}%` : ""}` },
    needsOsr
      ? { label: "Resubmission (A1) success", value: "—", sub: "Needs OSR's declined-submission export" }
      : { label: "Resubmission (A1) success", value: pct(Number(resub.funded), Number(resub.funded) + Number(resub.declined)), sub: `vs ${pct(Number(first.funded), Number(first.funded) + Number(first.declined))} for first submissions` },
    tta != null ? { label: "Median time to award", value: `${tta.toFixed(1)} mo`, sub: "from receipt date to notice of award" } : { label: "Median time to award", value: "—", sub: osrVerified ? "receipt dates not in the export" : "Needs OSR receipt dates" },
  ];

  const total = rowsAll.length;
  const page = Math.min(filters.page, Math.max(1, Math.ceil(total / AWARDS_PER_PAGE)));
  const slice = rowsAll.slice((page - 1) * AWARDS_PER_PAGE, page * AWARDS_PER_PAGE);
  const rows = slice.map((a) => ({
    ...a,
    piLine: piShort(a.pi_name, a.division ?? a.department),
    amountLine: a.direct_cost != null ? money(Number(a.direct_cost)) : "—",
    periodLine: a.project_start && a.project_end ? `${a.project_start.slice(0, 4)}–${a.project_end.slice(2, 4)}` : a.fiscal_year ? `FY${a.fiscal_year}` : "—",
    library: libByAward.get(coreOf(a.award_number ?? a.core_project_num) ?? "") ?? null,
  }));

  const bars: AwardsData["rates"]["bars"] = needsOsr
    ? []
    : [
        { label: `${filters.mechanism || "All"} · first submission`, n: `${(Number(first.funded) + Number(first.declined)).toLocaleString("en-US")} submitted`, pct: pct(Number(first.funded), Number(first.funded) + Number(first.declined)), width: Number(first.funded) + Number(first.declined) ? Math.round((Number(first.funded) / (Number(first.funded) + Number(first.declined))) * 100) : 0, tone: "teal" },
        { label: `${filters.mechanism || "All"} · resubmission (A1)`, n: `${(Number(resub.funded) + Number(resub.declined)).toLocaleString("en-US")} submitted`, pct: pct(Number(resub.funded), Number(resub.funded) + Number(resub.declined)), width: Number(resub.funded) + Number(resub.declined) ? Math.round((Number(resub.funded) / (Number(resub.funded) + Number(resub.declined))) * 100) : 0, tone: "teal" },
      ];

  const batch = (batches.data ?? [])[0] as { kind: "osr_export" | "reporter_sync"; created_at: string; imported_by_name: string | null } | undefined;
  return {
    filters,
    facets: { mechanisms, departments, sponsors },
    header: { total: all.length, declines: totalDeclines, sinceFy: all.length ? Math.min(...all.map((a) => a.fiscal_year ?? win.to)) : null, osrVerified, lastImport: batch ? { when: batch.created_at, kind: batch.kind, by: batch.imported_by_name } : null },
    kpis,
    table: { rows, total, page, perPage: AWARDS_PER_PAGE, caption: `funded ${mechLabel}${deptLabel} · ${fyLbl}`, fyLabel: fyLbl },
    rates: {
      title: `Success rate${filters.mechanism ? ` · ${filters.mechanism}` : ""}${deptLabel}`,
      fyLabel: fyLbl,
      headline: needsOsr ? null : pct(funded, submitted),
      sub: needsOsr ? "Success rates need OSR's declined-submission export. Awards below come from the public NIH RePORTER record until then." : `${funded.toLocaleString("en-US")} funded of ${submitted.toLocaleString("en-US")} submitted${reference ? ` · ${reference}` : ""}`,
      bars,
      needsOsr,
      reference,
    },
  };
}

export function coreOf(num: string | null | undefined): string | null {
  if (!num) return null;
  const m = num.replace(/^\d/, "").match(/^([A-Z]{1,2}\d{2}[A-Z]{2}\d{6})/);
  return m ? m[1] : num.trim() || null;
}

// ---------------------------------------------------------------------------
// Opportunity Detail: "UCSF track record"
// ---------------------------------------------------------------------------

export type TrackRecord = {
  osrVerified: boolean;
  window: string;
  scope: string;
  rate: { value: string; sub: string } | null;
  reference: { value: string; sub: string } | null;
  fundedCount: number;
  examples: Array<{ id: string; title: string; who: string; period: string; href: string }>;
  libraryLine: string;
  libraryHref: string;
  awardsHref: string;
  empty: string | null;
};

export async function loadTrackRecord(db: SupabaseClient, input: { mechanism: string | null; institutes: string[]; today: string }): Promise<TrackRecord> {
  const to = currentFiscalYear(input.today);
  const from = to - 2;
  const window = fyRangeLabel(from, to);
  const inst = input.institutes[0] ?? null;
  const mech = input.mechanism;
  const scope = [mech, inst, `UCSF, ${window}`].filter(Boolean).join(" · ");
  const awardsHref = `/library/awards?${new URLSearchParams({ ...(mech ? { mechanism: mech } : {}) }).toString()}`;
  if (!mech) return { osrVerified: false, window, scope, rate: null, reference: null, fundedCount: 0, examples: [], libraryLine: "No activity code on this notice, so awards under the same family can't be matched.", libraryHref: "/library", awardsHref: "/library/awards", empty: "Track record needs an activity code (R01, K08…) on the notice." };

  let q = db.from("osr_awards").select(AWARD_COLUMNS).eq("mechanism", mech).gte("fiscal_year", from).lte("fiscal_year", to).order("award_date", { ascending: false, nullsFirst: false }).limit(200);
  if (inst) q = q.eq("institute", inst);
  const [{ data: awards }, { data: rateRows }, { data: ref }, { data: lib }] = await Promise.all([
    q,
    db.rpc("osr_success_rates", { p_mechanism: mech, p_institute: inst, p_fy_from: from, p_fy_to: to }),
    db.from("reference_success_rates").select("fiscal_year, rate, label").eq("mechanism", mech).lte("fiscal_year", to).order("fiscal_year", { ascending: false }).limit(1),
    db.from("library_items").select("id, content_type").eq("review_status", "published").is("removed_at", null).eq("mechanism", mech),
  ]);
  const rows = ((awards ?? []) as AwardRow[]).filter(isCompeting);
  const rr = (rateRows ?? []) as Array<{ bucket: string; funded: number; declined: number }>;
  const funded = rr.reduce((n, r) => n + Number(r.funded), 0);
  const declined = rr.reduce((n, r) => n + Number(r.declined), 0);
  const osrVerified = rows.some((a) => a.source === "osr");
  const refRow = ((ref ?? []) as Array<{ fiscal_year: number; rate: number; label: string }>)[0];
  const libRows = (lib ?? []) as Array<{ id: string; content_type: string }>;
  const strat = libRows.filter((l) => l.content_type === "research_strategy").length;
  const aims = libRows.filter((l) => l.content_type === "specific_aims").length;
  const libraryLine = libRows.length
    ? `${[strat ? `${strat} Research Strategy` : null, aims ? `${aims} Specific Aims` : null, libRows.length - strat - aims ? `${libRows.length - strat - aims} other` : null].filter(Boolean).join(" and ")} example${libRows.length === 1 ? "" : "s"} for this family in the proposal library. Declines are counted, never named.`
    : `No library examples under ${mech} yet. Declines are counted, never named.`;
  return {
    osrVerified,
    window,
    scope,
    rate: declined > 0 ? { value: pct(funded, funded + declined), sub: `${funded} funded of ${funded + declined} submitted` } : null,
    reference: refRow ? { value: `${Math.round(Number(refRow.rate))}%`, sub: `${refRow.label} · FY${refRow.fiscal_year}` } : null,
    fundedCount: rows.length,
    examples: rows.slice(0, 2).map((a) => ({ id: a.id, title: a.title, who: piShort(a.pi_name, null), period: a.project_start && a.project_end ? `${a.project_start.slice(0, 4)}–${a.project_end.slice(2, 4)}` : a.fiscal_year ? `FY${a.fiscal_year}` : "", href: awardsHref })),
    libraryLine,
    libraryHref: `/library?mechanism=${encodeURIComponent(mech)}`,
    awardsHref,
    empty: rows.length ? null : "No UCSF awards under this mechanism in the last three fiscal years are on file yet.",
  };
}

/** CSV export of the current table (all pages). */
export function awardsToCsv(rows: AwardRow[]): string {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["award_number", "title", "pi", "department", "division", "sponsor", "institute", "mechanism", "fiscal_year", "award_date", "project_start", "project_end", "direct_cost", "total_cost", "source"];
  const lines = rows.map((a) => [a.award_number, a.title, a.pi_name, a.department, a.division, a.sponsor, a.institute, a.mechanism, a.fiscal_year, a.award_date, a.project_start, a.project_end, a.direct_cost, a.total_cost, a.source === "osr" ? "OSR" : "NIH RePORTER"].map(esc).join(","));
  return [header.join(","), ...lines].join("\n");
}
