import type { ClinicalTrialMode } from "./rd-signals";

export type SearchParams = Record<string, string | string[] | undefined>;

const ACTIVITY_WHITELIST = new Set([
  "R",
  "K",
  "F",
  "T",
  "P",
  "U",
  "X",
  "DP",
  "SBIR",
  "STTR",
  "SC",
  "RM",
  "TL",
  "UL",
  "G",
]);

const TRIAL_MODES = new Set(["unknown", "required", "allowed", "not_allowed"]);

const ANN = new Set(["unknown", "parent_notice", "targeted_rfa", "nos", "other"]);

const PATH = new Set([
  "unknown",
  "basic",
  "translational",
  "clinical",
  "population",
  "health_services",
  "computational",
  "mixed",
]);

const MECH = new Set(["small_grant", "large_grant", "center_like", "training", "unknown"]);

const COLLAB = new Set(["single_pi", "multi_pi", "center_like", "unknown"]);

const HS = new Set(["true", "false", "unknown"]);

const NIH_IC_WHITELIST = new Set([
  "NCI",
  "NHLBI",
  "NIAID",
  "NINDS",
  "NIDDK",
  "NICHD",
  "NIMH",
  "NIA",
  "NEI",
  "NIEHS",
  "NHGRI",
  "NIBIB",
  "NCATS",
  "NLM",
  "NCCIH",
  "NIMHD",
  "NINR",
  "NIAMS",
  "NIDCR",
  "NIDA",
  "NIDCD",
  "NIGMS",
  "NIAAA",
  "FIC",
  "OD",
]);

const INV = new Set([
  "early_stage_investigator",
  "new_investigator",
  "established_pi",
  "career_stage",
]);

function multiParam(sp: SearchParams, key: string, whitelist?: Set<string>): string[] {
  const raw = sp[key];
  const list = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string" || !item.trim()) continue;
    const v = item.trim();
    if (whitelist && !whitelist.has(v)) continue;
    out.push(v);
  }
  return Array.from(new Set(out));
}

function firstParam(sp: SearchParams, key: string): string {
  const raw = sp[key];
  if (typeof raw === "string") return raw.trim();
  if (Array.isArray(raw)) {
    const x = raw.find((i) => typeof i === "string" && i.trim());
    return typeof x === "string" ? x.trim() : "";
  }
  return "";
}

export type RdListFilterState = {
  activityFamilies: string[];
  clinicalTrialMode: ClinicalTrialMode | null;
  nihIc: string[];
  announcement: string[];
  pathway: string[];
  investigatorTags: string[];
  mechanismTypes: string[];
  collaborations: string[];
  humanSubjects: string[];
};

export function parseRdListFilters(sp: SearchParams): RdListFilterState {
  const ct = firstParam(sp, "ct");
  const clinicalTrialMode: ClinicalTrialMode | null =
    ct && TRIAL_MODES.has(ct) ? (ct as ClinicalTrialMode) : null;

  return {
    activityFamilies: multiParam(sp, "act", ACTIVITY_WHITELIST),
    clinicalTrialMode,
    nihIc: multiParam(sp, "ic", NIH_IC_WHITELIST),
    announcement: multiParam(sp, "ann", ANN),
    pathway: multiParam(sp, "path", PATH),
    investigatorTags: multiParam(sp, "inv", INV),
    mechanismTypes: multiParam(sp, "mech", MECH),
    collaborations: multiParam(sp, "collab", COLLAB),
    humanSubjects: multiParam(sp, "hs", HS),
  };
}

/** Preserve RD filter params when building sort links etc. */
export function rdFiltersActive(f: RdListFilterState): boolean {
  return (
    f.activityFamilies.length > 0 ||
    f.clinicalTrialMode != null ||
    f.nihIc.length > 0 ||
    f.announcement.length > 0 ||
    f.pathway.length > 0 ||
    f.investigatorTags.length > 0 ||
    f.mechanismTypes.length > 0 ||
    f.collaborations.length > 0 ||
    f.humanSubjects.length > 0
  );
}

/** PostgREST error when `funding_opportunities` RD columns were never migrated. */
export function isMissingRdColumnsPostgrestError(message: string): boolean {
  if (!message) return false;
  if (!/does not exist/i.test(message)) return false;
  return (
    message.includes("activity_families") ||
    message.includes("clinical_trial_mode") ||
    message.includes("nih_ic_tokens") ||
    message.includes("rd_announcement_class") ||
    message.includes("rd_research_pathway") ||
    message.includes("rd_investigator_tags") ||
    message.includes("rd_mechanism_type") ||
    message.includes("rd_collaboration") ||
    message.includes("rd_human_subjects")
  );
}

export function appendRdFiltersFromSearchParams(p: URLSearchParams, sp: SearchParams): void {
  appendRdListFiltersToUrlSearchParams(p, parseRdListFilters(sp));
}

/** Serialize triage filters into a query string (used by instant filter navigation). */
export function appendRdListFiltersToUrlSearchParams(p: URLSearchParams, rd: RdListFilterState): void {
  if (rd.clinicalTrialMode) p.set("ct", rd.clinicalTrialMode);
  for (const v of rd.activityFamilies) p.append("act", v);
  for (const v of rd.nihIc) p.append("ic", v);
  for (const v of rd.announcement) p.append("ann", v);
  for (const v of rd.pathway) p.append("path", v);
  for (const v of rd.investigatorTags) p.append("inv", v);
  for (const v of rd.mechanismTypes) p.append("mech", v);
  for (const v of rd.collaborations) p.append("collab", v);
  for (const v of rd.humanSubjects) p.append("hs", v);
}

export function normalizeClinicalTrialQueryValue(raw: string): ClinicalTrialMode | null {
  const t = raw.trim();
  return t && TRIAL_MODES.has(t as ClinicalTrialMode) ? (t as ClinicalTrialMode) : null;
}

/** PostgREST filter chain from `from('funding_opportunities')` — typed loosely to avoid deep generic recursion. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyRdFiltersToFundingQuery(q: any, f: RdListFilterState): any {
  let out = q;
  if (f.activityFamilies.length) out = out.overlaps("activity_families", f.activityFamilies);
  if (f.nihIc.length) out = out.overlaps("nih_ic_tokens", f.nihIc);
  if (f.clinicalTrialMode != null) out = out.eq("clinical_trial_mode", f.clinicalTrialMode);
  if (f.announcement.length) out = out.in("rd_announcement_class", f.announcement);
  if (f.pathway.length) out = out.in("rd_research_pathway", f.pathway);
  if (f.investigatorTags.length) out = out.overlaps("rd_investigator_tags", f.investigatorTags);
  if (f.mechanismTypes.length) out = out.in("rd_mechanism_type", f.mechanismTypes);
  if (f.collaborations.length) out = out.in("rd_collaboration", f.collaborations);
  if (f.humanSubjects.length) out = out.in("rd_human_subjects", f.humanSubjects);
  return out;
}
