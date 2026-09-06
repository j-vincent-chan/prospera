/**
 * The six notice-extractor fixtures (docs/fit-engine/prompts/notice-extractor.md
 * › Fixture notices) as typed data, the mocked model that answers them, and
 * the expectation check shared by opportunity.test.ts and
 * scripts/fit-opportunity-report.ts --fixtures. Data lives in
 * src/lib/fit/__fixtures__/notice-extractor-fixtures.json.
 */
import fixtureJson from "@/lib/fit/__fixtures__/notice-extractor-fixtures.json";
import type { ModelFn, ModelRequest } from "@/lib/fit/classify/llm";
import type { ExemplarRecord, NoticeRecord, ProfileBuild } from "@/lib/fit/profile/opportunity";
import type { Confidence } from "@/lib/fit/types";

export type NoticeFixtureExpect = {
  paradigm?: {
    required_min?: Record<string, number>;
    /** Upper bound, so a blended or overridden weight is pinned from both sides. */
    required_max?: Record<string, number>;
    required_any_min?: Record<string, number>;
    required_present?: string[];
    allowed_present?: string[];
    allowed_min?: Record<string, number>;
    allowed_max?: Record<string, number>;
    excluded_present?: string[];
    required_empty?: boolean;
  };
  unit?: { required_includes?: string[]; required_excludes?: string[]; required_any_includes?: string[] };
  design?: { required_any_includes?: string[]; required_any_2_includes?: string[]; prohibited_includes?: string[] };
  materials?: { required_includes?: string[]; required_any_includes?: string[]; expected_includes?: string[]; human_required?: boolean };
  objective_min?: Record<string, number>;
  mechanism?: { ceiling_direct_per_year?: number; period_years?: number; clinical_trial?: string; besh?: boolean; program_division?: string };
  non_responsive_min?: number;
  eligibility?: { investigator_rules_min?: number; independent_appointment_required?: boolean; esi_only?: boolean };
  team?: { multi_pi_allowed?: boolean; required_partners_min?: number };
  exemplars?: { count?: number; classified?: number; informative?: number; blend_exemplar?: number };
  /** Verified prior_overrides applied to the overlays (`merged.overrides_applied.length`). */
  overrides_applied?: number;
  confidence?: Confidence;
  confidence_max?: Confidence;
  needs_review?: boolean;
  sources_text?: "full_text" | "synopsis" | "none";
};

export type NoticeFixture = {
  n: number;
  label: string;
  notice: NoticeRecord;
  exemplars: ExemplarRecord[];
  /** Section group ("1" | "2" | "3") → the mocked reply. */
  model_output: Record<string, unknown>;
  expect: NoticeFixtureExpect;
};

type FixtureFile = { thresholds: { present_min: number }; items: NoticeFixture[] };

const file = fixtureJson as unknown as FixtureFile;

export const NOTICE_FIXTURE_THRESHOLDS = file.thresholds;
export const NOTICE_FIXTURES: readonly NoticeFixture[] = file.items;

/** The mocked extractor: answers with `model_output[group]` for the `Section group:` line of the prompt; throws for a group the fixture has no reply for. */
export function fixtureModel(f: NoticeFixture): { fn: ModelFn; calls: ModelRequest[] } {
  const calls: ModelRequest[] = [];
  const fn: ModelFn = async (req) => {
    calls.push(req);
    const group = /^Section group: (\d)/m.exec(req.user)?.[1];
    const reply = group ? f.model_output[group] : undefined;
    if (reply === undefined) throw new Error(`fixture ${f.n} has no model_output for section group ${group ?? "(none)"}`);
    return JSON.stringify(reply);
  };
  return { fn, calls };
}

export type NoticeCheck = { ok: boolean; note: string };

const CONF: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
const show = (v: number | undefined) => (v === undefined ? "missing" : v.toFixed(2));

/** Pure. Every expectation of one fixture against a built profile. */
export function checkNoticeFixture(build: ProfileBuild, e: NoticeFixtureExpect, thresholds = NOTICE_FIXTURE_THRESHOLDS): NoticeCheck[] {
  const p = build.profile;
  const out: NoticeCheck[] = [];
  const check = (ok: boolean, note: string) => out.push({ ok, note });
  const min = (map: Record<string, number | undefined>, mins: Record<string, number> | undefined, path: string) => {
    for (const [id, m] of Object.entries(mins ?? {})) check((map[id] ?? 0) >= m, `${path}.${id} ${show(map[id])} ≥ ${m}`);
  };
  const max = (map: Record<string, number | undefined>, maxes: Record<string, number> | undefined, path: string) => {
    for (const [id, m] of Object.entries(maxes ?? {})) check((map[id] ?? 0) <= m, `${path}.${id} ${show(map[id])} ≤ ${m}`);
  };
  const excludes = (list: readonly string[], ids: string[] | undefined, path: string) => {
    for (const id of ids ?? []) check(!list.includes(id), `${path} excludes ${id} (${list.join(", ") || "empty"})`);
  };
  const present = (map: Record<string, number | undefined>, ids: string[] | undefined, path: string) => {
    for (const id of ids ?? []) check((map[id] ?? 0) >= thresholds.present_min, `${path}.${id} ${show(map[id])} present (≥ ${thresholds.present_min})`);
  };
  const includes = (list: readonly string[], ids: string[] | undefined, path: string) => {
    for (const id of ids ?? []) check(list.includes(id), `${path} includes ${id} (${list.join(", ") || "empty"})`);
  };
  const pr = p.paradigm.required as Record<string, number>;
  min(pr, e.paradigm?.required_min, "paradigm.required");
  max(pr, e.paradigm?.required_max, "paradigm.required");
  min(p.paradigm.required_any as Record<string, number>, e.paradigm?.required_any_min, "paradigm.required_any");
  present(pr, e.paradigm?.required_present, "paradigm.required");
  present(p.paradigm.allowed as Record<string, number>, e.paradigm?.allowed_present, "paradigm.allowed");
  min(p.paradigm.allowed as Record<string, number>, e.paradigm?.allowed_min, "paradigm.allowed");
  max(p.paradigm.allowed as Record<string, number>, e.paradigm?.allowed_max, "paradigm.allowed");
  present(p.paradigm.excluded as Record<string, number>, e.paradigm?.excluded_present, "paradigm.excluded");
  if (e.paradigm?.required_empty) check(Object.keys(pr).length === 0, `paradigm.required empty (${Object.keys(pr).join(", ") || "empty"})`);
  includes(p.unit.required, e.unit?.required_includes, "unit.required");
  excludes(p.unit.required, e.unit?.required_excludes, "unit.required");
  includes(p.unit.required_any, e.unit?.required_any_includes, "unit.required_any");
  includes(p.design.required_any, e.design?.required_any_includes, "design.required_any");
  includes(p.design.required_any_2, e.design?.required_any_2_includes, "design.required_any_2");
  includes(p.design.prohibited, e.design?.prohibited_includes, "design.prohibited");
  includes(p.materials.required, e.materials?.required_includes, "materials.required");
  includes(p.materials.required_any, e.materials?.required_any_includes, "materials.required_any");
  includes(p.materials.expected, e.materials?.expected_includes, "materials.expected");
  if (e.materials?.human_required !== undefined) check(p.materials.human_required === e.materials.human_required, `materials.human_required ${String(p.materials.human_required)} = ${e.materials.human_required}`);
  min(p.objective as Record<string, number>, e.objective_min, "objective");
  if (e.mechanism?.ceiling_direct_per_year !== undefined) check(p.mechanism.ceiling_direct_per_year === e.mechanism.ceiling_direct_per_year, `mechanism.ceiling_direct_per_year ${String(p.mechanism.ceiling_direct_per_year)} = ${e.mechanism.ceiling_direct_per_year}`);
  if (e.mechanism?.period_years !== undefined) check(p.mechanism.period_years === e.mechanism.period_years, `mechanism.period_years ${String(p.mechanism.period_years)} = ${e.mechanism.period_years}`);
  if (e.mechanism?.clinical_trial !== undefined) check(p.mechanism.clinical_trial === e.mechanism.clinical_trial, `mechanism.clinical_trial ${p.mechanism.clinical_trial} = ${e.mechanism.clinical_trial}`);
  if (e.mechanism?.besh !== undefined) check(p.mechanism.besh === e.mechanism.besh, `mechanism.besh ${String(p.mechanism.besh)} = ${e.mechanism.besh}`);
  if (e.mechanism?.program_division !== undefined) check(p.mechanism.program_division === e.mechanism.program_division, `mechanism.program_division = ${e.mechanism.program_division}`);
  if (e.non_responsive_min !== undefined) check(p.non_responsive.length >= e.non_responsive_min, `non_responsive ${p.non_responsive.length} ≥ ${e.non_responsive_min}`);
  if (e.eligibility?.investigator_rules_min !== undefined) check(p.eligibility.investigator_rules.length >= e.eligibility.investigator_rules_min, `eligibility.investigator_rules ${p.eligibility.investigator_rules.length} ≥ ${e.eligibility.investigator_rules_min}`);
  if (e.eligibility?.independent_appointment_required !== undefined) check(p.eligibility.independent_appointment_required === e.eligibility.independent_appointment_required, `eligibility.independent_appointment_required = ${e.eligibility.independent_appointment_required}`);
  if (e.eligibility?.esi_only !== undefined) check(p.eligibility.esi_only === e.eligibility.esi_only, `eligibility.esi_only = ${e.eligibility.esi_only}`);
  if (e.team?.multi_pi_allowed !== undefined) check(p.team.multi_pi_allowed === e.team.multi_pi_allowed, `team.multi_pi_allowed = ${e.team.multi_pi_allowed}`);
  if (e.team?.required_partners_min !== undefined) check(p.team.required_partners.length >= e.team.required_partners_min, `team.required_partners ${p.team.required_partners.length} ≥ ${e.team.required_partners_min}`);
  if (e.exemplars?.count !== undefined) check(build.exemplar.rows === e.exemplars.count, `exemplars ${build.exemplar.rows} = ${e.exemplars.count}`);
  if (e.exemplars?.classified !== undefined) check(build.exemplar.classified === e.exemplars.classified, `exemplars classified ${build.exemplar.classified} = ${e.exemplars.classified}`);
  if (e.exemplars?.informative !== undefined) check(build.exemplar.informative === e.exemplars.informative, `exemplars informative ${build.exemplar.informative} = ${e.exemplars.informative}`);
  if (e.overrides_applied !== undefined) check(build.merged.overrides_applied.length === e.overrides_applied, `overrides applied ${build.merged.overrides_applied.length} = ${e.overrides_applied}`);
  if (e.exemplars?.blend_exemplar !== undefined) check(build.blend.weights.exemplar === e.exemplars.blend_exemplar, `blend exemplar weight ${build.blend.weights.exemplar} = ${e.exemplars.blend_exemplar}`);
  if (e.confidence !== undefined) check(p.confidence === e.confidence, `confidence ${p.confidence} = ${e.confidence}`);
  if (e.confidence_max !== undefined) check(CONF[p.confidence] <= CONF[e.confidence_max], `confidence ${p.confidence} ≤ ${e.confidence_max}`);
  if (e.needs_review !== undefined) check(p.needs_review === e.needs_review, `needs_review ${String(p.needs_review)} = ${e.needs_review}`);
  if (e.sources_text !== undefined) check(p.sources.text === e.sources_text, `sources.text ${p.sources.text} = ${e.sources_text}`);
  return out;
}

export function formatNoticeChecks(checks: NoticeCheck[]): string[] {
  return checks.map((c) => `${c.ok ? "OK  " : "MISS"} ${c.note}`);
}
