/**
 * Corrections (plan § PR 3.1 `judge/corrections.ts`; spec §16 "the model
 * never emits a score; it proposes corrections to inputs", "What an override
 * must be able to show"; reconciler.md post-rules 1–4).
 *
 * A correction names one field of a stored profile, the current value, the
 * proposed value and the evidence. Validation (pure, `validateCorrection`):
 * the target and kind agree; the path is one the grammar below knows — a
 * topic field never (a topical argument reopens no gate); `from` matches the
 * stored value (a weight within 0.01, the excerpt's rounding; a list as a
 * set; a scalar exactly; null ≡ absent); `to` is valid for the path (a
 * weight in [0, 1], vocabulary ids, a boolean, a count) and differs from the
 * stored value; the evidence clears the bar — an investigator paradigm
 * weight needs ≥ 2 verified items (no priors), any other investigator field
 * ≥ 1 evidence id, a notice field a quote that verifies verbatim against the
 * Guide sections (`verifyQuote`, D22). Anything short is dropped and logged.
 *
 * Routing (`routeCorrection`): investigator `ingest_miss` / `characteristic`
 * at high confidence → `auto` (applied by the judge, status applied);
 * investigator `profile_weight` → `provisional` (D6: strategist confirmation
 * before it persists); every notice correction → `provisional` (applied for
 * the raising pair only until confirmed, then globally — PR 3.3).
 *
 * Persistence is a thin `CorrectionStore` (Supabase, or in memory in tests):
 * `applyCorrection` re-checks `from` against the profile as stored now,
 * patches the profile JSON, marks the row applied and re-scores the affected
 * pairs through the callback the service passes; `rejectCorrection` marks
 * it rejected — a rejected (target, path, to, evidence) never reappears
 * (`alreadyDecided`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyQuote, type NoticeSection } from "@/lib/fit/profile/opportunity-extract";
import type { CorrectionRoute, ValidatedCorrection } from "@/lib/fit/judge/types";
import { enumOf, fmt, idList, isRecord, knownIds, str, strList } from "@/lib/fit/judge/validate";
import { CLINICAL_TRIAL_DESIGNATION_IDS, isDesignId, isMaterialsKind, isObjectiveId, isParadigmCategory, isUnitLevel } from "@/lib/fit/taxonomy";
import type { Correction, CorrectionKind, CorrectionStatus, CorrectionTarget, InvestigatorFitProfile, OpportunityFitProfile } from "@/lib/fit/types";

export const CORRECTIONS_MIGRATION = "supabase/migrations/20260919100000_fit_adjudications_corrections.sql";

/** PostgREST's message for a table the schema cache does not know (the migration not applied yet). */
export const MISSING_TABLE = /could not find the table|relation .* does not exist|schema cache/i;

// ---------------------------------------------------------------------------
// Path grammar
// ---------------------------------------------------------------------------

export type PathValueKind = "weight" | "unit_levels" | "designs" | "materials" | "boolean" | "count" | "text" | "text_list" | "codes" | "designation" | "career_stage";

/** A parsed, known path: where it lives in the profile and what `to` must be. */
export type ParsedPath = {
  target: CorrectionTarget;
  /** The normalized path as stored (`paradigm.recent.clinical_trials`). */
  path: string;
  /** The object keys from the profile root to the value. */
  keys: string[];
  value: PathValueKind;
  /** The axis or field group, for the evidence bar and the gate test. */
  group: "paradigm" | "unit" | "design" | "materials" | "objective" | "characteristics" | "eligibility" | "mechanism";
};

const CAREER_STAGES = ["trainee", "early", "mid", "senior"] as const;

const INVESTIGATOR_CHARACTERISTICS: Record<string, PathValueKind> = { trial_pi_count: "count", active_awards: "count", esi: "boolean", mechanisms_held: "codes", career_stage: "career_stage", clinical_role: "text", degrees: "text_list", title_series: "text" };
const NOTICE_ELIGIBILITY: Record<string, PathValueKind> = { esi_only: "boolean", new_investigator_only: "boolean", clinician_required: "boolean", independent_appointment_required: "boolean", degree_required: "text", citizenship_rule: "text", investigator_rules: "text_list" };

/** `investigator.design.rct` → `design.rct`; `notice.paradigm.required` → `paradigm.required`; lower-cased, trimmed. */
export function normalizeCorrectionPath(path: string): string {
  return path
    .trim()
    .replace(/^(investigator_profile|opportunity_profile|investigator|notice|opportunity)\./i, "")
    .replace(/\[(\w+)\]/g, ".$1")
    .replace(/\s+/g, "")
    .toLowerCase();
}

/** Pure. The path parsed for a target; null when the grammar does not know it (topic fields included — never correctable). */
export function parseCorrectionPath(target: CorrectionTarget, rawPath: string): ParsedPath | null {
  const path = normalizeCorrectionPath(rawPath);
  const parts = path.split(".").filter(Boolean);
  if (parts.length < 2) return null;
  const [head, second, third] = parts;
  if (target === "investigator") {
    if (head === "paradigm") {
      if ((second === "recent" || second === "career") && third && isParadigmCategory(third) && parts.length === 3) return { target, path, keys: ["paradigm", second, third], value: "weight", group: "paradigm" };
      if (parts.length === 2 && isParadigmCategory(second!)) return { target, path: `paradigm.recent.${second}`, keys: ["paradigm", "recent", second!], value: "weight", group: "paradigm" };
      return null;
    }
    if (head === "unit" && parts.length === 2 && isUnitLevel(second!.toUpperCase())) return { target, path: `unit.${second!.toUpperCase()}`, keys: ["unit", second!.toUpperCase()], value: "weight", group: "unit" };
    if (head === "design" && parts.length === 2 && isDesignId(second!)) return { target, path, keys: ["design", second!], value: "weight", group: "design" };
    if (head === "materials" && parts.length === 2 && isMaterialsKind(second!)) return { target, path, keys: ["materials", second!], value: "weight", group: "materials" };
    if (head === "objective" && parts.length === 2 && isObjectiveId(second!)) return { target, path, keys: ["objective", second!], value: "weight", group: "objective" };
    if (head === "characteristics" && parts.length === 2 && second! in INVESTIGATOR_CHARACTERISTICS) return { target, path, keys: ["characteristics", second!], value: INVESTIGATOR_CHARACTERISTICS[second!]!, group: "characteristics" };
    return null;
  }
  if (head === "paradigm" && parts.length === 3 && ["required", "required_any", "allowed", "excluded"].includes(second!) && isParadigmCategory(third!)) return { target, path, keys: ["paradigm", second!, third!], value: "weight", group: "paradigm" };
  if (head === "unit" && parts.length === 2 && ["required", "required_any", "allowed"].includes(second!)) return { target, path, keys: ["unit", second!], value: "unit_levels", group: "unit" };
  if (head === "design" && parts.length === 2 && ["required_any", "required_any_2", "allowed", "prohibited"].includes(second!)) return { target, path, keys: ["design", second!], value: "designs", group: "design" };
  if (head === "materials" && parts.length === 2) {
    if (["expected", "required", "required_any"].includes(second!)) return { target, path, keys: ["materials", second!], value: "materials", group: "materials" };
    if (second === "human_required") return { target, path, keys: ["materials", "human_required"], value: "boolean", group: "materials" };
    return null;
  }
  if (head === "objective" && parts.length === 2 && isObjectiveId(second!)) return { target, path, keys: ["objective", second!], value: "weight", group: "objective" };
  if (head === "eligibility" && parts.length === 2 && second! in NOTICE_ELIGIBILITY) return { target, path, keys: ["eligibility", second!], value: NOTICE_ELIGIBILITY[second!]!, group: "eligibility" };
  if (head === "mechanism" && second === "clinical_trial" && parts.length === 2) return { target, path, keys: ["mechanism", "clinical_trial"], value: "designation", group: "mechanism" };
  return null;
}

/** A gate input (spec §16 R7: "a specific gate input" — paradigm, unit, design, or a notice's eligibility / designation). */
export function isGateInput(p: Pick<ParsedPath, "group">): boolean {
  return p.group === "paradigm" || p.group === "unit" || p.group === "design" || p.group === "eligibility" || p.group === "mechanism";
}

// ---------------------------------------------------------------------------
// Reading and writing a path
// ---------------------------------------------------------------------------

/** The stored value at a parsed path; undefined when absent. */
export function readCorrectionPath(profile: unknown, p: Pick<ParsedPath, "keys">): unknown {
  return p.keys.reduce<unknown>((v, k) => (isRecord(v) ? v[k] : undefined), profile);
}

/** Pure. A copy of `profile` with the value at the path set (a weight of 0 removes the key; null removes an optional scalar). */
export function applyCorrectionToProfile<T>(profile: T, correction: Pick<Correction, "target" | "path" | "to">): T {
  const p = parseCorrectionPath(correction.target, correction.path);
  if (!p) throw new Error(`unknown correction path ${correction.target}.${correction.path}`);
  const copy = JSON.parse(JSON.stringify(profile)) as T;
  let cursor: Record<string, unknown> = copy as unknown as Record<string, unknown>;
  for (const k of p.keys.slice(0, -1)) {
    if (!isRecord(cursor[k])) cursor[k] = {};
    cursor = cursor[k] as Record<string, unknown>;
  }
  const last = p.keys[p.keys.length - 1]!;
  if (p.value === "weight" && (correction.to === 0 || correction.to === null)) delete cursor[last];
  else cursor[last] = correction.to;
  return copy;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type CorrectionContext = {
  /** The short ids the model was given. */
  evidenceIds: readonly string[];
  /** Ids that are verified items (publications, grants, trials, biosketch), not priors — the paradigm bar. */
  verifiedIds?: readonly string[];
  sections: readonly NoticeSection[];
  investigator: InvestigatorFitProfile;
  notice: OpportunityFitProfile;
};

const KINDS: readonly CorrectionKind[] = ["ingest_miss", "misread_requirement", "profile_weight", "characteristic"];
const INVESTIGATOR_KINDS: ReadonlySet<CorrectionKind> = new Set(["ingest_miss", "profile_weight", "characteristic"]);

/** The excerpt prints weights to two decimals; a `from` within this of the stored value matches. */
export const WEIGHT_TOLERANCE = 0.01;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.some((y) => y.toLowerCase() === x.toLowerCase()));

/** Pure. `to` coerced and checked for the path's value kind; null (with the reason) when invalid. */
export function coerceTo(p: ParsedPath, to: unknown, stored: unknown): { value: unknown } | { error: string } {
  switch (p.value) {
    case "weight": {
      if (to === null && p.target === "notice") return { value: 0 };
      const n = num(to);
      if (n === null) return { error: `to is not a number (${fmt(to)})` };
      if (n < 0 || n > 1) return { error: `to ${n} is outside [0, 1]` };
      return { value: Math.round(n * 1000) / 1000 };
    }
    case "unit_levels":
    case "designs":
    case "materials": {
      const list = Array.isArray(to) ? to : typeof to === "string" ? [to] : null;
      if (!list) return { error: `to is not a list (${fmt(to)})` };
      const ids = list.map((x) => (typeof x === "string" ? (p.value === "unit_levels" ? x.trim().toUpperCase() : x.trim().toLowerCase()) : ""));
      const guard = p.value === "unit_levels" ? isUnitLevel : p.value === "designs" ? isDesignId : isMaterialsKind;
      const bad = ids.filter((x) => !guard(x));
      if (bad.length) return { error: `to has ids outside the vocabulary (${bad.join(", ")})` };
      return { value: Array.from(new Set(ids)) };
    }
    case "boolean":
      if (typeof to === "boolean") return { value: to };
      if (to === null && p.target === "notice") return { value: null };
      return { error: `to is not a boolean (${fmt(to)})` };
    case "count": {
      const n = num(to);
      if (n === null || !Number.isInteger(n) || n < 0) return { error: `to is not a non-negative integer (${fmt(to)})` };
      return { value: n };
    }
    case "text":
      if (to === null) return { value: null };
      return typeof to === "string" && to.trim() ? { value: to.trim() } : { error: `to is not text (${fmt(to)})` };
    case "text_list": {
      const dropped: string[] = [];
      const list = strList(to, "to", dropped, { max: 20, each: 400 });
      return Array.isArray(to) || typeof to === "string" ? { value: list } : { error: `to is not a list (${fmt(to)})` };
    }
    case "codes": {
      const list = Array.isArray(to) ? to : typeof to === "string" ? [to] : null;
      if (!list) return { error: `to is not a list (${fmt(to)})` };
      const codes = list.map((x) => (typeof x === "string" ? x.trim().toUpperCase() : ""));
      if (codes.some((c) => !/^[A-Z]{1,2}\d{1,2}$/.test(c))) return { error: `to has values that are not activity codes (${codes.join(", ")})` };
      const before = Array.isArray(stored) ? (stored as string[]) : [];
      return { value: Array.from(new Set([...before, ...codes])) };
    }
    case "designation": {
      const d = enumOf(to, [...CLINICAL_TRIAL_DESIGNATION_IDS, "unknown"] as const);
      return d ? { value: d } : { error: `to is not a clinical-trial designation (${fmt(to)})` };
    }
    case "career_stage": {
      const c = enumOf(to, CAREER_STAGES);
      return c ? { value: c } : { error: `to is not a career stage (${fmt(to)})` };
    }
  }
}

/** Pure. Does the model's `from` describe the stored value? */
export function fromMatches(p: ParsedPath, from: unknown, stored: unknown): boolean {
  switch (p.value) {
    case "weight": {
      const s = typeof stored === "number" ? stored : 0;
      const f = from === null || from === undefined ? 0 : num(from);
      return f !== null && Math.abs(f - s) <= WEIGHT_TOLERANCE + 1e-9;
    }
    case "unit_levels":
    case "designs":
    case "materials":
    case "text_list":
    case "codes": {
      const s = Array.isArray(stored) ? (stored as string[]) : [];
      const f = from === null || from === undefined ? [] : Array.isArray(from) ? from.map(String) : typeof from === "string" ? [from] : null;
      return f !== null && sameSet(f, s);
    }
    case "count": {
      const s = typeof stored === "number" ? stored : 0;
      const f = from === null || from === undefined ? 0 : num(from);
      return f === s;
    }
    case "boolean":
      return (from ?? null) === (stored ?? null);
    default:
      return (from === null || from === undefined ? null : String(from).trim().toLowerCase()) === (stored === null || stored === undefined ? null : String(stored).trim().toLowerCase());
  }
}

/** Pure. One raw correction from the reconciler validated against the taxonomy, the target's current profile and the evidence; null with the reasons when dropped. */
export function validateCorrection(raw: unknown, ctx: CorrectionContext, label = "correction"): { correction: ValidatedCorrection | null; dropped: string[] } {
  const dropped: string[] = [];
  const drop = (why: string) => {
    dropped.push(`${label}: ${why}; dropped`);
    return { correction: null, dropped };
  };
  if (!isRecord(raw)) return drop(`not an object (${fmt(raw)})`);
  const target = enumOf(raw.target, ["investigator", "notice"] as const);
  if (!target) return drop(`target missing or unknown (${fmt(raw.target)})`);
  const kind = enumOf(raw.kind, KINDS);
  if (!kind) return drop(`kind missing or unknown (${fmt(raw.kind)})`);
  if (target === "investigator" ? !INVESTIGATOR_KINDS.has(kind) : kind !== "misread_requirement") return drop(`kind ${kind} does not apply to a ${target} correction`);
  const rawPath = typeof raw.path === "string" ? raw.path : "";
  if (!rawPath.trim()) return drop("path missing");
  let p = parseCorrectionPath(target, rawPath);
  let to: unknown = raw.to;
  // "notice.paradigm.required += human_biospecimen": a weight map named with the category in `to` — read as the leaf at the map's top weight.
  if (!p && target === "notice" && typeof to === "string" && /^paradigm\.(required|required_any|allowed|excluded)$/.test(normalizeCorrectionPath(rawPath)) && isParadigmCategory(to.trim().toLowerCase())) {
    const cat = to.trim().toLowerCase();
    const map = readCorrectionPath(ctx.notice, { keys: normalizeCorrectionPath(rawPath).split(".") });
    const top = isRecord(map) ? Math.max(0, ...Object.values(map).map((v) => (typeof v === "number" ? v : 0))) : 0;
    p = parseCorrectionPath(target, `${normalizeCorrectionPath(rawPath)}.${cat}`);
    to = top > 0 ? top : 1;
    dropped.push(`${label}: read "${rawPath} += ${cat}" as ${p?.path} → ${to} (the map's top weight)`);
  }
  if (!p) return drop(`path not known for a ${target} correction (${rawPath})`);
  if (p.group === "characteristics" && kind !== "characteristic") return drop(`${p.path} needs kind characteristic, not ${kind}`);
  if (p.group !== "characteristics" && kind === "characteristic") return drop(`kind characteristic does not apply to ${p.path}`);
  const profile = target === "investigator" ? ctx.investigator : ctx.notice;
  const stored = readCorrectionPath(profile, p);
  if (!fromMatches(p, raw.from, stored)) return drop(`from_value ${fmt(raw.from ?? null)} does not match the stored value ${fmt(stored ?? null)} at ${p.path}`);
  const coerced = coerceTo(p, to, stored);
  if ("error" in coerced) return drop(`${coerced.error} at ${p.path}`);
  const same = p.value === "weight" ? Math.abs((typeof stored === "number" ? stored : 0) - (coerced.value as number)) < 1e-9 : JSON.stringify(coerced.value) === JSON.stringify(stored ?? (Array.isArray(coerced.value) ? [] : null));
  if (same) return drop(`to equals the stored value at ${p.path}`);
  const confidence = enumOf(raw.confidence, ["high", "medium"] as const);
  if (!confidence) dropped.push(`${label}: confidence missing or unknown (${fmt(raw.confidence)}); treated as medium`);
  const evidence_ids = idList(raw.evidence_ids, knownIds(ctx.evidenceIds), `${label}.evidence_ids`, dropped);
  let quote: string | null = null;
  let verified_section: string | null = null;
  if (target === "notice") {
    const q = str(raw.quote, 600);
    if (!q) return drop(`a notice correction needs a verbatim quote (${p.path})`);
    const check = verifyQuote(q, str(raw.section, 200), [...ctx.sections]);
    if (!check.ok) return drop(`quote not verbatim in the notice (${check.reason})`);
    quote = q;
    verified_section = check.section;
  } else {
    const verified = ctx.verifiedIds ? evidence_ids.filter((id) => ctx.verifiedIds!.includes(id)) : evidence_ids;
    const need = p.group === "paradigm" ? 2 : 1;
    if (verified.length < need) return drop(`${p.path} needs ${need} verified evidence id${need > 1 ? "s" : ""}, ${verified.length} given`);
  }
  const correction: ValidatedCorrection = {
    target,
    path: p.path,
    from: stored === undefined ? null : stored,
    to: coerced.value,
    evidence_ids,
    quote,
    section: str(raw.section, 200),
    kind,
    confidence: confidence ?? "medium",
    route: routeCorrection({ target, kind, confidence: confidence ?? "medium" }),
    verified_section,
  };
  return { correction, dropped };
}

/** Pure. The reconciler's `corrections` list validated; duplicates by (target, path) keep the first. */
export function validateCorrections(raw: unknown, ctx: CorrectionContext): { corrections: ValidatedCorrection[]; dropped: string[] } {
  const dropped: string[] = [];
  if (raw === undefined || raw === null) return { corrections: [], dropped };
  if (!Array.isArray(raw)) {
    dropped.push(`corrections: not a list (${fmt(raw)})`);
    return { corrections: [], dropped };
  }
  const out: ValidatedCorrection[] = [];
  raw.forEach((r, i) => {
    const v = validateCorrection(r, ctx, `corrections[${i}]`);
    dropped.push(...v.dropped);
    if (!v.correction) return;
    if (out.some((c) => c.target === v.correction!.target && c.path === v.correction!.path)) {
      dropped.push(`corrections[${i}]: duplicate path ${v.correction.path}; dropped`);
      return;
    }
    out.push(v.correction);
  });
  return { corrections: out, dropped };
}

/** reconciler.md post-rules 2–4 and D6. */
export function routeCorrection(c: Pick<Correction, "target" | "kind" | "confidence">): CorrectionRoute {
  if (c.target === "investigator" && (c.kind === "ingest_miss" || c.kind === "characteristic") && c.confidence === "high") return "auto";
  return "provisional";
}

// ---------------------------------------------------------------------------
// Rows and the store
// ---------------------------------------------------------------------------

export type CorrectionTargetTable = "investigator_profile" | "opportunity_profile";

export const TARGET_TABLE: Record<CorrectionTarget, CorrectionTargetTable> = { investigator: "investigator_profile", notice: "opportunity_profile" };
export const TARGET_OF: Record<CorrectionTargetTable, CorrectionTarget> = { investigator_profile: "investigator", opportunity_profile: "notice" };

export type CorrectionEvidence = {
  ids: string[];
  quote: string | null;
  section: string | null;
  confidence: "high" | "medium";
  pair: { investigator_id: string; opportunity_id: string } | null;
  /** The pass that proposed it. */
  via?: string;
};

export type CorrectionRow = {
  id: string;
  target: CorrectionTargetTable;
  target_id: string;
  path: string;
  from_value: unknown;
  to_value: unknown;
  evidence: CorrectionEvidence;
  kind: CorrectionKind;
  proposed_by: "judge" | "investigator" | "strategist";
  status: CorrectionStatus;
  decided_by: string | null;
  created_at: string;
  decided_at: string | null;
};

export type NewCorrectionRow = Omit<CorrectionRow, "id" | "created_at">;

/** Pure. The row a validated correction is stored as for the pair that raised it. */
export function toCorrectionRow(c: ValidatedCorrection, pair: { investigator_id: string; opportunity_id: string }, status: CorrectionStatus, opts: { proposedBy?: CorrectionRow["proposed_by"]; decidedAt?: string | null } = {}): NewCorrectionRow {
  return {
    target: TARGET_TABLE[c.target],
    target_id: c.target === "investigator" ? pair.investigator_id : pair.opportunity_id,
    path: c.path,
    from_value: c.from ?? null,
    to_value: c.to ?? null,
    evidence: { ids: [...c.evidence_ids], quote: c.quote, section: c.verified_section ?? c.section, confidence: c.confidence, pair: { ...pair }, via: "reconciler" },
    kind: c.kind,
    proposed_by: opts.proposedBy ?? "judge",
    status,
    decided_by: null,
    decided_at: status === "proposed" ? null : (opts.decidedAt ?? null),
  };
}

/** Pure. A stored row back as a correction. */
export function fromCorrectionRow(row: CorrectionRow): Correction {
  return { target: TARGET_OF[row.target], path: row.path, from: row.from_value, to: row.to_value, evidence_ids: row.evidence?.ids ?? [], quote: row.evidence?.quote ?? null, section: row.evidence?.section ?? null, kind: row.kind, confidence: row.evidence?.confidence ?? "medium" };
}

const sameEvidence = (a: CorrectionEvidence, b: CorrectionEvidence) => sameSet(a.ids ?? [], b.ids ?? []) && (a.quote ?? null) === (b.quote ?? null);

/**
 * Pure. An existing row that makes a new proposal redundant: the same target,
 * path and value already proposed (still open), or rejected on the same
 * evidence (PR 3.3: "rejected items never reappear for the same evidence").
 */
export function alreadyDecided(row: NewCorrectionRow, existing: readonly CorrectionRow[]): CorrectionRow | null {
  return (
    existing.find((e) => e.target === row.target && e.target_id === row.target_id && e.path === row.path && JSON.stringify(e.to_value) === JSON.stringify(row.to_value) && (e.status === "proposed" || e.status === "applied" || (e.status === "rejected" && sameEvidence(e.evidence, row.evidence)))) ?? null
  );
}

export type CorrectionStore = {
  loadCorrection(id: string): Promise<CorrectionRow | null>;
  /** Rows for a target (optionally by status), oldest first. */
  listCorrections(filter: { target: CorrectionTargetTable; target_id: string; status?: CorrectionStatus }): Promise<CorrectionRow[]>;
  insertCorrection(row: NewCorrectionRow): Promise<string>;
  updateCorrection(id: string, patch: Partial<Pick<CorrectionRow, "status" | "decided_by" | "decided_at">>): Promise<void>;
  loadProfile(target: CorrectionTargetTable, targetId: string): Promise<unknown | null>;
  saveProfile(target: CorrectionTargetTable, targetId: string, profile: unknown): Promise<void>;
  /** True while `fit_corrections` is not on the database. */
  tableMissing(): Promise<boolean>;
};

export type ApplyOutcome = { ok: true; id: string; target: CorrectionTargetTable; target_id: string; rescored: unknown } | { ok: false; id: string; error: string };

export type ApplyOptions = {
  decidedBy?: string | null;
  now?: () => Date;
  /** Re-score the affected pairs (the service's `rankForInvestigator` / `rankForNotice`); omitted = no re-score. */
  rescore?: (target: CorrectionTargetTable, targetId: string) => Promise<unknown>;
};

/** Apply one proposed correction: re-check `from` against the stored profile, patch it, mark applied, re-score. Never throws for a bad row; answers `{ ok: false }`. */
export async function applyCorrection(store: CorrectionStore, id: string, opts: ApplyOptions = {}): Promise<ApplyOutcome> {
  const row = await store.loadCorrection(id);
  if (!row) return { ok: false, id, error: "no such correction" };
  if (row.status !== "proposed") return { ok: false, id, error: `correction is ${row.status}, not proposed` };
  const target = TARGET_OF[row.target];
  const p = parseCorrectionPath(target, row.path);
  if (!p) return { ok: false, id, error: `unknown path ${row.path}` };
  const profile = await store.loadProfile(row.target, row.target_id);
  if (!profile) return { ok: false, id, error: `no stored ${row.target} for ${row.target_id}` };
  const stored = readCorrectionPath(profile, p);
  if (!fromMatches(p, row.from_value, stored)) return { ok: false, id, error: `stored value at ${row.path} is now ${fmt(stored ?? null)}, not ${fmt(row.from_value ?? null)}; re-propose` };
  const patched = applyCorrectionToProfile(profile, { target, path: row.path, to: row.to_value });
  await store.saveProfile(row.target, row.target_id, patched);
  await store.updateCorrection(id, { status: "applied", decided_by: opts.decidedBy ?? null, decided_at: (opts.now ?? (() => new Date()))().toISOString() });
  const rescored = opts.rescore ? await opts.rescore(row.target, row.target_id) : null;
  return { ok: true, id, target: row.target, target_id: row.target_id, rescored };
}

/** Mark one proposed correction rejected. */
export async function rejectCorrection(store: CorrectionStore, id: string, opts: Pick<ApplyOptions, "decidedBy" | "now"> = {}): Promise<{ ok: boolean; error?: string }> {
  const row = await store.loadCorrection(id);
  if (!row) return { ok: false, error: "no such correction" };
  if (row.status !== "proposed") return { ok: false, error: `correction is ${row.status}, not proposed` };
  await store.updateCorrection(id, { status: "rejected", decided_by: opts.decidedBy ?? null, decided_at: (opts.now ?? (() => new Date()))().toISOString() });
  return { ok: true };
}

const PROFILE_TABLE: Record<CorrectionTargetTable, { table: string; key: string }> = { investigator_profile: { table: "investigator_fit_profiles", key: "investigator_id" }, opportunity_profile: { table: "opportunity_fit_profiles", key: "opportunity_id" } };

const CORRECTION_COLUMNS = "id, target, target_id, path, from_value, to_value, evidence, kind, proposed_by, status, decided_by, created_at, decided_at";

export function supabaseCorrectionStore(db: SupabaseClient): CorrectionStore {
  return {
    async loadCorrection(id) {
      const { data, error } = await db.from("fit_corrections").select(CORRECTION_COLUMNS).eq("id", id).maybeSingle();
      if (error) throw new Error(`fit_corrections read failed: ${error.message}`);
      return (data as CorrectionRow | null) ?? null;
    },
    async listCorrections(filter) {
      let q = db.from("fit_corrections").select(CORRECTION_COLUMNS).eq("target", filter.target).eq("target_id", filter.target_id);
      if (filter.status) q = q.eq("status", filter.status);
      const { data, error } = await q.order("created_at", { ascending: true }).limit(500);
      if (error) throw new Error(`fit_corrections read failed: ${error.message}`);
      return (data ?? []) as CorrectionRow[];
    },
    async insertCorrection(row) {
      const { data, error } = await db.from("fit_corrections").insert(row).select("id").single();
      if (error) throw new Error(`fit_corrections insert failed: ${error.message}`);
      return (data as { id: string }).id;
    },
    async updateCorrection(id, patch) {
      const { error } = await db.from("fit_corrections").update(patch).eq("id", id);
      if (error) throw new Error(`fit_corrections update failed: ${error.message}`);
    },
    async loadProfile(target, targetId) {
      const { table, key } = PROFILE_TABLE[target];
      const { data, error } = await db.from(table).select("profile").eq(key, targetId).maybeSingle();
      if (error) throw new Error(`${table} read failed: ${error.message}`);
      return (data as { profile?: unknown } | null)?.profile ?? null;
    },
    async saveProfile(target, targetId, profile) {
      const { table, key } = PROFILE_TABLE[target];
      const { error } = await db.from(table).update({ profile }).eq(key, targetId);
      if (error) throw new Error(`${table} update failed: ${error.message}`);
    },
    async tableMissing() {
      const { error } = await db.from("fit_corrections").select("id").limit(1);
      if (!error) return false;
      if (MISSING_TABLE.test(error.message)) return true;
      throw new Error(`fit_corrections read failed: ${error.message}`);
    },
  };
}
