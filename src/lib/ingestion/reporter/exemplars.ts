/**
 * RePORTER exemplars by announcement (fit engine PR 0.6).
 *
 * For one notice: walk its `reissue_of` lineage through funding_opportunities
 * rows (≤ 4 steps), ask RePORTER v2 `/projects/search` for projects awarded
 * under any number in the lineage, and keep up to 60 exemplars, newest fiscal
 * years first, one per core project.
 *
 * RePORTER filters by announcement with `criteria.opportunity_numbers` — the
 * documented name; `criteria.foa` is an undocumented alias with identical
 * results (verified 2026-09-05 against PAR-25-122 / RFA-TR-22-030: both return
 * the same totals, matching is exact per number and case-insensitive, several
 * numbers OR together, and the reissue lineage is not followed by the API).
 *
 * Everything above `fetchNoticeExemplars` is pure (no fetch, no Supabase) and
 * unit-tested; `fetchNoticeExemplars` pages through the API with the shared
 * AsyncRateLimiter and accepts an injected `search` for tests. Supabase
 * orchestration lives in ./exemplars-sync.ts.
 *
 * Field parsing mirrors PR 0.4's reporter-fields.ts (activity code, RCDC split,
 * study-section bracket) so the two can share one module once 0.4 lands.
 */
import { AsyncRateLimiter } from "@/lib/utils/async-rate-limiter";

/** Plan PR 0.6: at most this many exemplars per notice. */
export const EXEMPLAR_CAP = 60;
/** Plan PR 0.6: walk reissue_of at most this many steps from the notice. */
export const LINEAGE_MAX_STEPS = 4;
/** Spec §6: exemplars are refreshed monthly. */
export const EXEMPLAR_REFRESH_DAYS = 30;
/** A failed RePORTER request is retried sooner than a successful fetch is refreshed. */
export const EXEMPLAR_RETRY_ERROR_DAYS = 7;
/** Rows per RePORTER page; the newest fiscal year alone usually fills the cap. */
export const REPORTER_EXEMPLAR_PAGE = 100;
/** Never read past this many pages for one notice (a parent PA has thousands of awards). */
export const REPORTER_EXEMPLAR_MAX_PAGES = 5;
export const REPORTER_PROJECTS_SEARCH = "https://api.reporter.nih.gov/v2/projects/search";
export const EXEMPLAR_JOB_TYPE = "fit_exemplars";

const REPORTER_MIN_INTERVAL_MS = Number(process.env.REPORTER_MIN_INTERVAL_MS ?? 250);
const exemplarRateLimiter = new AsyncRateLimiter(REPORTER_MIN_INTERVAL_MS);

/**
 * Only what the exemplar row stores (RePORTER's `include_fields` takes the
 * PascalCase names and returns snake_case keys). Abstracts dominate the payload.
 */
export const EXEMPLAR_INCLUDE_FIELDS = [
  "ApplId",
  "SubprojectId",
  "ProjectNum",
  "CoreProjectNum",
  "FiscalYear",
  "AwardType",
  "OpportunityNumber",
  "ProjectTitle",
  "AbstractText",
  "ActivityCode",
  "SpendingCategoriesDesc",
  "FullStudySection",
  "PrincipalInvestigators",
  "Organization",
] as const;

// ---------------------------------------------------------------------------
// Announcement numbers and lineage
// ---------------------------------------------------------------------------

/** PA-25-123, PAR-25-122, PAS-…, RFA-TR-22-030, OTA-… — the shapes RePORTER's opportunity_number carries. */
const ANNOUNCEMENT_RE = /^[A-Z]{2,3}-(?:[A-Z]{2}-)?\d{2}-\d{3}$/;

/** Upper-cased, trimmed announcement number, or null when the value is not one (Simpler ids, HRSA numbers, NOSIs). */
export function normalizeAnnouncementNumber(raw: unknown): string | null {
  const s = String(raw ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();
  return ANNOUNCEMENT_RE.test(s) ? s : null;
}

export type LineageRow = { opportunity_number: string | null; reissue_of: string | null };

export type Lineage = {
  /** Depth order: the notice's own number first, then each reissue_of predecessor. */
  numbers: string[];
  depthByNumber: Map<string, number>;
  /** Predecessor numbers that have no funding_opportunities row — the walk stops at the first one. */
  missing: string[];
  /** True when a further predecessor existed beyond LINEAGE_MAX_STEPS. */
  truncated: boolean;
};

/** Rows keyed by normalized opportunity_number; later duplicates do not overwrite earlier ones. */
export function indexLineageRows(rows: Iterable<LineageRow>): Map<string, LineageRow> {
  const out = new Map<string, LineageRow>();
  for (const row of rows) {
    const n = normalizeAnnouncementNumber(row.opportunity_number);
    if (n && !out.has(n)) out.set(n, row);
  }
  return out;
}

/**
 * The notice's number plus its `reissue_of` chain, followed through the rows
 * given (the predecessor's own reissue_of, and so on) for at most `maxSteps`
 * steps. A predecessor with no row still joins the lineage — the number alone
 * is what RePORTER needs — but the walk cannot continue past it. Cycles stop.
 */
export function buildLineage(notice: LineageRow, rowsByNumber: ReadonlyMap<string, LineageRow>, maxSteps = LINEAGE_MAX_STEPS): Lineage {
  const numbers: string[] = [];
  const depthByNumber = new Map<string, number>();
  const missing: string[] = [];
  const start = normalizeAnnouncementNumber(notice.opportunity_number);
  if (!start) return { numbers, depthByNumber, missing, truncated: false };
  numbers.push(start);
  depthByNumber.set(start, 0);

  let next = normalizeAnnouncementNumber(notice.reissue_of);
  let step = 1;
  let truncated = false;
  while (next) {
    if (depthByNumber.has(next)) break; // cycle
    if (step > maxSteps) {
      truncated = true;
      break;
    }
    numbers.push(next);
    depthByNumber.set(next, step);
    const row = rowsByNumber.get(next);
    if (!row) {
      missing.push(next);
      break;
    }
    next = normalizeAnnouncementNumber(row.reissue_of);
    step += 1;
  }
  return { numbers, depthByNumber, missing, truncated };
}

// ---------------------------------------------------------------------------
// Request body
// ---------------------------------------------------------------------------

export type ReporterSearchBody = {
  criteria: { opportunity_numbers: string[]; exclude_subprojects: true };
  include_fields: string[];
  offset: number;
  limit: number;
  sort_field: "fiscal_year";
  sort_order: "desc";
};

/** One page of projects awarded under any of `numbers`, newest fiscal year first, subprojects excluded. */
export function buildExemplarRequest(numbers: string[], offset = 0, limit = REPORTER_EXEMPLAR_PAGE): ReporterSearchBody {
  return {
    criteria: { opportunity_numbers: numbers, exclude_subprojects: true },
    include_fields: [...EXEMPLAR_INCLUDE_FIELDS],
    offset,
    limit,
    sort_field: "fiscal_year",
    sort_order: "desc",
  };
}

// ---------------------------------------------------------------------------
// Response → exemplar rows
// ---------------------------------------------------------------------------

/** A project record from the v2 payload; every field optional because include_fields shapes it. */
export type ReporterProject = Record<string, unknown>;

export type ReporterSearchResponse = { results?: ReporterProject[]; meta?: { total?: number } };

/** One row of opportunity_exemplars. */
export type ExemplarRow = {
  opportunity_number: string;
  project_num: string;
  core_project_num: string;
  appl_id: number | null;
  awarded_under: string;
  lineage_depth: number;
  fiscal_year: number | null;
  award_type: string | null;
  title: string | null;
  abstract: string | null;
  activity_code: string | null;
  rcdc_categories: string[] | null;
  study_section: string | null;
  study_section_code: string | null;
  pi_names: string[];
  org_name: string | null;
  fetched_at: string;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  return s || null;
}

function int(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return parseInt(value.trim(), 10);
  return null;
}

/** `project_num`, else its alias, else the core number — as reporter-ingest stores it. */
export function pickExemplarProjectNum(project: ReporterProject): string | null {
  return str(project.project_num) ?? str(project.project_num_alias) ?? str(project.core_project_num);
}

/** RePORTER's core_project_num, else derived: drop the application-type digit and everything from the first dash ("1R03TR006462-01" → R03TR006462). */
export function coreProjectNumOf(project: ReporterProject, projectNum: string): string {
  const given = str(project.core_project_num);
  if (given) return given.toUpperCase();
  return projectNum.toUpperCase().replace(/^\d/, "").replace(/-.*$/, "");
}

/** NIH project number: `[type][activity][IC][serial]-…`; the activity code is the three characters before the IC code. */
const PROJECT_NUM_ACTIVITY_RE = /^\d?([A-Z][A-Z0-9]{2})(?=[A-Z]{2}\d)/;

/** RePORTER's own activity_code, else parsed from the project number (covers DP2 / UG3 / UM1 shapes). */
export function activityCodeOf(project: ReporterProject, projectNum: string): string | null {
  const direct = str(project.activity_code);
  if (direct) return direct.toUpperCase();
  return projectNum.toUpperCase().replace(/\s+/g, "").match(PROJECT_NUM_ACTIVITY_RE)?.[1] ?? null;
}

/** `spending_categories_desc` "Cancer; Immunization; Vaccine Related" → names; null when RePORTER has none (never []). */
export function parseExemplarRcdc(value: unknown): string[] | null {
  const parts = typeof value === "string" ? value.split(";") : Array.isArray(value) ? value : [];
  const out: string[] = [];
  for (const part of parts) {
    if (typeof part !== "string") continue;
    const name = part.replace(/\s+/g, " ").trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out.length ? out : null;
}

const NAME_BRACKET_RE = /\s*\[([^\]]*)\]\s*$/;

/** `full_study_section` → panel name without its trailing "[CODE]" and the srg_code. */
export function parseExemplarStudySection(value: unknown): { name: string | null; code: string | null } {
  const o = asObject(value);
  const rawName = str(o?.name);
  const bracket = rawName?.match(NAME_BRACKET_RE)?.[1]?.trim() ?? null;
  const stripped = rawName ? rawName.replace(NAME_BRACKET_RE, "").trim() : "";
  const name = stripped || rawName;
  const code = str(o?.srg_code)?.toUpperCase() ?? (bracket && /^[A-Z0-9-]+$/i.test(bracket) ? bracket.toUpperCase() : null);
  return { name: name || null, code };
}

/** `principal_investigators[]` → full names in RePORTER order, whitespace collapsed ("Meiyan  Jin" → "Meiyan Jin"), deduplicated. */
export function parseExemplarPiNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const o = asObject(entry);
    if (!o) continue;
    const full = str(o.full_name) ?? [str(o.first_name), str(o.middle_name), str(o.last_name)].filter(Boolean).join(" ");
    const name = full.replace(/\s+/g, " ").trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

export type ExemplarContext = {
  /** The notice the rows are stored for. */
  noticeNumber: string;
  /** From buildLineage; a project awarded under a number outside it is dropped. */
  depthByNumber: ReadonlyMap<string, number>;
  /** ISO timestamp stamped on every row of this run. */
  fetchedAt: string;
};

/** One project record → one exemplar row, or null when it has no project number or was awarded under a number outside the lineage. */
export function exemplarFromProject(project: ReporterProject, ctx: ExemplarContext): ExemplarRow | null {
  const projectNum = pickExemplarProjectNum(project);
  if (!projectNum) return null;
  const awardedUnder = normalizeAnnouncementNumber(project.opportunity_number);
  const depth = awardedUnder != null ? ctx.depthByNumber.get(awardedUnder) : undefined;
  if (awardedUnder == null || depth == null) return null;
  const section = parseExemplarStudySection(project.full_study_section);
  const fy = int(project.fiscal_year);
  return {
    opportunity_number: ctx.noticeNumber,
    project_num: projectNum,
    core_project_num: coreProjectNumOf(project, projectNum),
    appl_id: int(project.appl_id),
    awarded_under: awardedUnder,
    lineage_depth: depth,
    fiscal_year: fy,
    award_type: str(project.award_type),
    title: str(project.project_title),
    abstract: str(project.abstract_text),
    activity_code: activityCodeOf(project, projectNum),
    rcdc_categories: parseExemplarRcdc(project.spending_categories_desc),
    study_section: section.name,
    study_section_code: section.code,
    pi_names: parseExemplarPiNames(project.principal_investigators),
    org_name: str(asObject(project.organization)?.org_name),
    fetched_at: ctx.fetchedAt,
  };
}

/** Administrative supplements carry an S-suffix ("…-02S1"); the parent award is the better exemplar. */
const SUPPLEMENT_RE = /-\d{2}S\d+/i;

/** Newest fiscal year first; within a year the parent award beats its supplement, then the higher appl_id (later award). */
function compareNewestFirst(a: ExemplarRow, b: ExemplarRow): number {
  const fy = (b.fiscal_year ?? -1) - (a.fiscal_year ?? -1);
  if (fy !== 0) return fy;
  const supp = Number(SUPPLEMENT_RE.test(a.project_num)) - Number(SUPPLEMENT_RE.test(b.project_num));
  if (supp !== 0) return supp;
  const appl = (b.appl_id ?? -1) - (a.appl_id ?? -1);
  if (appl !== 0) return appl;
  return a.project_num.localeCompare(b.project_num);
}

export type ExemplarSelection = {
  /** The rows to store: one per core project, newest first, at most `cap`. */
  rows: ExemplarRow[];
  /** Records that mapped to a row (before collapsing continuation years). */
  mapped: number;
  /** Records dropped: no project number, or awarded under a number outside the lineage. */
  dropped: number;
  /** Distinct core projects seen before the cap. */
  distinct: number;
};

/** Distinct core project numbers among records the lineage accepts — the paging loop's stop condition. */
export function countDistinctCoreProjects(projects: ReporterProject[], depthByNumber: ReadonlyMap<string, number>): number {
  const cores = new Set<string>();
  for (const p of projects) {
    const n = pickExemplarProjectNum(p);
    const under = normalizeAnnouncementNumber(p.opportunity_number);
    if (!n || under == null || !depthByNumber.has(under)) continue;
    cores.add(coreProjectNumOf(p, n));
  }
  return cores.size;
}

/**
 * Collapse a project's fiscal years onto its newest award, order newest first,
 * cap at `cap`. Ties within a year fall to RePORTER's own order (appl_id).
 */
export function selectExemplars(projects: ReporterProject[], ctx: ExemplarContext, cap = EXEMPLAR_CAP): ExemplarSelection {
  const mapped: ExemplarRow[] = [];
  let dropped = 0;
  for (const p of projects) {
    const row = exemplarFromProject(p, ctx);
    if (row) mapped.push(row);
    else dropped += 1;
  }
  mapped.sort(compareNewestFirst);
  const byCore = new Map<string, ExemplarRow>();
  for (const row of mapped) {
    if (!byCore.has(row.core_project_num)) byCore.set(row.core_project_num, row);
  }
  const distinctRows = Array.from(byCore.values());
  return { rows: distinctRows.slice(0, cap), mapped: mapped.length, dropped, distinct: distinctRows.length };
}

// ---------------------------------------------------------------------------
// Fetch for one notice (network; `search` is injectable)
// ---------------------------------------------------------------------------

export type ReporterSearch = (body: ReporterSearchBody) => Promise<ReporterSearchResponse>;

/** POST through the shared limiter (≥ REPORTER_MIN_INTERVAL_MS between starts); no retries — the next run retries an error. */
export const liveReporterSearch: ReporterSearch = async (body) => {
  const res = await exemplarRateLimiter.schedule(() =>
    fetch(REPORTER_PROJECTS_SEARCH, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    })
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`RePORTER API ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as ReporterSearchResponse;
};

export type NoticeExemplarsInput = {
  noticeNumber: string;
  lineage: Lineage;
  fetchedAt?: string;
  cap?: number;
  pageSize?: number;
  maxPages?: number;
  search?: ReporterSearch;
};

export type NoticeExemplarsResult = ExemplarSelection & {
  noticeNumber: string;
  lineage: string[];
  /** RePORTER's meta.total for the lineage — award-years, not projects. Null when the API sent none. */
  apiTotal: number | null;
  /** Records received across pages. */
  received: number;
  pages: number;
  /** Stored rows per lineage number, depth order. */
  byAwardedUnder: Array<{ number: string; depth: number; rows: number }>;
  /** [oldest, newest] fiscal year among stored rows; null when none. */
  fiscalYears: [number, number] | null;
};

/**
 * Page newest-first through RePORTER until the cap's worth of distinct core
 * projects is in hand, the results run out, or `maxPages` is reached; then
 * select. The first 100 rows are one fiscal year of awards and normally fill
 * the cap, so most notices cost one request.
 */
export async function fetchNoticeExemplars(input: NoticeExemplarsInput): Promise<NoticeExemplarsResult> {
  const { noticeNumber, lineage } = input;
  const cap = input.cap ?? EXEMPLAR_CAP;
  const pageSize = input.pageSize ?? REPORTER_EXEMPLAR_PAGE;
  const maxPages = input.maxPages ?? REPORTER_EXEMPLAR_MAX_PAGES;
  const search = input.search ?? liveReporterSearch;
  const fetchedAt = input.fetchedAt ?? new Date().toISOString();
  const ctx: ExemplarContext = { noticeNumber, depthByNumber: lineage.depthByNumber, fetchedAt };

  const projects: ReporterProject[] = [];
  let apiTotal: number | null = null;
  let pages = 0;
  if (lineage.numbers.length) {
    for (let offset = 0; pages < maxPages; offset += pageSize) {
      const json = await search(buildExemplarRequest(lineage.numbers, offset, pageSize));
      pages += 1;
      const results = json.results ?? [];
      if (typeof json.meta?.total === "number") apiTotal = json.meta.total;
      projects.push(...results);
      if (results.length < pageSize) break;
      if (apiTotal != null && offset + results.length >= apiTotal) break;
      if (countDistinctCoreProjects(projects, lineage.depthByNumber) >= cap) break;
    }
  }

  const selection = selectExemplars(projects, ctx, cap);
  const byAwardedUnder = lineage.numbers.map((number) => ({
    number,
    depth: lineage.depthByNumber.get(number) ?? 0,
    rows: selection.rows.filter((r) => r.awarded_under === number).length,
  }));
  const years = selection.rows.map((r) => r.fiscal_year).filter((y): y is number => y != null);
  const fiscalYears: [number, number] | null = years.length ? [Math.min(...years), Math.max(...years)] : null;
  return { ...selection, noticeNumber, lineage: lineage.numbers, apiTotal, received: projects.length, pages, byAwardedUnder, fiscalYears };
}

// ---------------------------------------------------------------------------
// Resume predicate and printing (pure)
// ---------------------------------------------------------------------------

export function exemplarsRefreshCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - EXEMPLAR_REFRESH_DAYS * 86_400_000);
}

export function exemplarsErrorRetryCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - EXEMPLAR_RETRY_ERROR_DAYS * 86_400_000);
}

/** PostgREST `or()` for notices due a fetch: never fetched, refreshed > 30 days ago, or an error > 7 days old. */
export function exemplarsDueFilter(now: Date = new Date()): string {
  return [
    "exemplars_fetched_at.is.null",
    `exemplars_fetched_at.lt.${exemplarsRefreshCutoff(now).toISOString()}`,
    `and(exemplars_fetch_status.eq.error,exemplars_fetched_at.lt.${exemplarsErrorRetryCutoff(now).toISOString()})`,
  ].join(",");
}

/** PostgREST `or()` for the inventory's open-notice predicate (INVENTORY.md § 4). */
export function openNoticeFilter(today: string): string {
  return `close_date.gte.${today},next_due.gte.${today},expiration_date.gte.${today}`;
}

/** PostgREST `or()` for NIH-like notices, as the Guide sync and the inventory define them. */
export const NIH_LIKE_FILTER = "agency_code.like.HHS-NIH%,opportunity_number.like.PA-%,opportunity_number.like.PAR-%,opportunity_number.like.RFA-%";

/** One line per notice for the dry run and the cron log. */
export function formatNoticeResult(r: NoticeExemplarsResult): string {
  const lineage = r.lineage.length > 1 ? r.lineage.join(" → ") : r.lineage[0] ?? "(no announcement number)";
  const under = r.byAwardedUnder.length > 1 ? ` [${r.byAwardedUnder.map((b) => `${b.number}:${b.rows}`).join(", ")}]` : "";
  const years = r.fiscalYears ? ` FY${r.fiscalYears[0]}–${r.fiscalYears[1]}` : "";
  return `${r.noticeNumber}: ${r.rows.length} exemplars of ${r.distinct} projects (${r.apiTotal ?? "?"} award-years, ${r.pages} page${r.pages === 1 ? "" : "s"})${years}${under} · lineage ${lineage}`;
}
