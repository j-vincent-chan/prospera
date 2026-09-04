/**
 * OSR export import. There is no OSR API; a Library steward uploads OSR's
 * proposal/award report as CSV. Headers are matched loosely so the usual
 * RAS / OSR column names work without editing the file. Rows with a funded
 * status become osr_awards (source 'osr'); declined rows become
 * osr_declines, which are only ever counted.
 */
import { IC_BY_PREFIX, activityCodeOf, fiscalYearOf, institutePrefixOf } from "@/lib/institution/types";

export type OsrRowInput = Record<string, string | number | null | undefined>;

const ALIASES: Record<string, string[]> = {
  external_id: ["proposal id", "proposal number", "proposal #", "award id", "award number", "record id", "id", "ras id", "osr id", "proposal no", "prop id"],
  award_number: ["sponsor award number", "award number", "sponsor award #", "grant number", "sponsor reference", "sponsor award id", "project number"],
  title: ["title", "project title", "proposal title"],
  pi_name: ["pi", "pi name", "principal investigator", "pi full name", "contact pi"],
  department: ["department", "dept", "home department", "pi department", "admin department", "pi dept"],
  division: ["division", "pi division"],
  sponsor: ["sponsor", "sponsor name", "funding agency", "prime sponsor", "sponsor type"],
  institute: ["institute", "ic", "nih institute", "sponsor institute", "agency ic", "awarding institute"],
  mechanism: ["mechanism", "activity code", "funding mechanism", "instrument", "activity"],
  application_type: ["application type", "proposal type", "type", "appl type", "submission type"],
  status: ["status", "proposal status", "award status", "outcome", "decision"],
  fiscal_year: ["fiscal year", "fy", "award fy", "proposal fy", "submission fy"],
  award_date: ["award date", "notice of award date", "noa date", "award notice date", "date awarded"],
  receipt_date: ["receipt date", "submission date", "submitted date", "date submitted", "sponsor deadline"],
  decided_date: ["decision date", "declined date", "date declined", "status date"],
  project_start: ["project start", "start date", "project start date", "period start", "begin date"],
  project_end: ["project end", "end date", "project end date", "period end"],
  direct_cost: ["direct cost", "direct costs", "annual direct", "direct cost per year", "direct/yr", "year 1 direct", "direct"],
  total_cost: ["total cost", "total costs", "total award", "total requested", "total", "award amount"],
  abstract: ["abstract", "summary", "project abstract"],
};

function norm(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9#/ ]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Map the file's headers onto our fields. Returns which fields matched. */
export function mapHeaders(headers: string[]): Record<string, string> {
  const normalized = headers.map((h) => [h, norm(h)] as const);
  const out: Record<string, string> = {};
  for (const [field, aliases] of Object.entries(ALIASES)) {
    for (const alias of aliases) {
      const hit = normalized.find(([, n]) => n === alias);
      if (hit) {
        out[field] = hit[0];
        break;
      }
    }
  }
  return out;
}

export const REQUIRED_FIELDS = ["title", "status"] as const;

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}
function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function date(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export type NormalizedOsr = { awards: Array<Record<string, unknown>>; declines: Array<Record<string, unknown>>; skipped: number; skippedReasons: Record<string, number> };

const FUNDED = /\b(award(ed)?|funded|active|issued|accepted)\b/i;
const DECLINED = /\b(declin|not funded|unfunded|rejected|not awarded|withdrawn|unsuccessful|not selected)/i;

export function normalizeOsrRows(rows: OsrRowInput[], mapping: Record<string, string>, batchId: string | null): NormalizedOsr {
  const get = (r: OsrRowInput, f: string) => (mapping[f] ? r[mapping[f]] : undefined);
  const out: NormalizedOsr = { awards: [], declines: [], skipped: 0, skippedReasons: {} };
  const skip = (why: string) => {
    out.skipped += 1;
    out.skippedReasons[why] = (out.skippedReasons[why] ?? 0) + 1;
  };
  rows.forEach((r, i) => {
    const title = str(get(r, "title"));
    const status = str(get(r, "status")) ?? "";
    if (!title) return skip("no title");
    const funded = FUNDED.test(status) && !DECLINED.test(status);
    const declined = DECLINED.test(status);
    if (!funded && !declined) return skip(`status “${status || "blank"}” not recognized`);
    const awardNumber = str(get(r, "award_number"));
    const mech = str(get(r, "mechanism")) ?? activityCodeOf(awardNumber);
    const instRaw = str(get(r, "institute"));
    const inst = instRaw ?? (institutePrefixOf(awardNumber) ? IC_BY_PREFIX[institutePrefixOf(awardNumber)!] ?? null : null);
    const type = str(get(r, "application_type"));
    const fyRaw = num(get(r, "fiscal_year"));
    const awardDate = date(get(r, "award_date"));
    const receipt = date(get(r, "receipt_date"));
    const fy = fyRaw ?? (awardDate ? fiscalYearOf(awardDate) : receipt ? fiscalYearOf(receipt) : null);
    const ext = str(get(r, "external_id")) ?? `${awardNumber ?? title.slice(0, 40)}|${fy ?? ""}|${i}`;
    const resub = /\b(resubmission|a1|revised)\b/i.test(type ?? "") || /A1\b/.test(awardNumber ?? "");
    const base = {
      external_id: ext,
      pi_name: str(get(r, "pi_name")),
      department: str(get(r, "department")),
      division: str(get(r, "division")),
      sponsor: str(get(r, "sponsor")),
      institute: inst,
      mechanism: mech,
      application_type: type,
      is_resubmission: resub,
      fiscal_year: fy,
      raw: r,
      import_batch_id: batchId,
      imported_at: new Date().toISOString(),
    };
    if (funded) {
      out.awards.push({ ...base, source: "osr", award_number: awardNumber, core_project_num: awardNumber ? awardNumber.replace(/^\d/, "").replace(/-.*$/, "") : null, title, award_date: awardDate, receipt_date: receipt, project_start: date(get(r, "project_start")), project_end: date(get(r, "project_end")), direct_cost: num(get(r, "direct_cost")), total_cost: num(get(r, "total_cost")), abstract: str(get(r, "abstract")), reporter_url: null });
    } else {
      out.declines.push({ ...base, source: "osr", submitted_date: receipt, decided_date: date(get(r, "decided_date")) });
    }
  });
  return out;
}
