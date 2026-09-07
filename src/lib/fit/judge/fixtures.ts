/**
 * The blind-pass fixture pairs (blind-pass.md › Fixtures): the nine spec §13
 * pairs rendered as evidence + notice text under
 * src/lib/fit/__fixtures__/blind-pass/cases.json, with the spec's expected
 * verdicts. `fixtureInputs` builds the judge's inputs for a case (every item
 * at weight 1 with no embedding, so all of them reach the model);
 * `runBlindPassFixture` runs the blind pass on it with whatever model
 * function the caller passes — a stub in the tests, the real model from
 * scripts/fit-judge.ts --fixtures — and says whether the verdict lands
 * within one tier of the expectation ("a prompt change that moves any of
 * these by two tiers is rejected").
 */
import FILE from "@/lib/fit/__fixtures__/blind-pass/cases.json";
import { runBlindPass, type BlindPassDeps } from "@/lib/fit/judge/blind";
import { noticeTexts, selectEvidence, type EvidenceCandidate } from "@/lib/fit/judge/inputs";
import type { BlindResult, JudgeCollaborator, JudgeInputs } from "@/lib/fit/judge/types";
import { tierRank } from "@/lib/fit/engine/util";
import type { NoticeSection } from "@/lib/fit/profile/opportunity-extract";
import { isTier } from "@/lib/fit/taxonomy";
import type { InvestigatorCharacteristics, ItemKind, Tier } from "@/lib/fit/types";

export type BlindPassFixtureEvidence = { id: string; kind: ItemKind; year: number | null; role: string | null; title: string; text: string; mesh_names: string[]; topic_terms: string[] };

export type BlindPassFixture = {
  id: string;
  title: string;
  /** The spec's expected verdict(s) — "exploratory-or-poor" is two entries. */
  expect: Tier[];
  investigator: { characteristics: Partial<InvestigatorCharacteristics>; collaborators: JudgeCollaborator[] };
  evidence: BlindPassFixtureEvidence[];
  notice: { number: string; title: string; activity_code: string | null; clinical_trial_designation: string; issuing_ic?: string | null; topic_terms: string[]; rcdc: string[]; mesh_names?: string[]; sections: NoticeSection[] };
};

export const BLIND_PASS_FIXTURE_VERSION: string = FILE.version;

/** The cases, validated: known tiers in `expect`, unique evidence ids per case. */
export function loadBlindPassFixtures(): BlindPassFixture[] {
  return (FILE.cases as unknown as BlindPassFixture[]).map((c) => {
    const bad = c.expect.filter((t) => !isTier(t));
    if (bad.length) throw new Error(`blind-pass fixture ${c.id}: unknown tier(s) ${bad.join(", ")}`);
    const ids = new Set<string>();
    for (const e of c.evidence) {
      if (ids.has(e.id)) throw new Error(`blind-pass fixture ${c.id}: duplicate evidence id ${e.id}`);
      ids.add(e.id);
    }
    return c;
  });
}

const DEFAULT_CHARACTERISTICS: InvestigatorCharacteristics = { career_stage: null, esi: null, esi_eligible_until: null, mechanisms_held: [], active_awards: 0, clinical_role: null, trial_pi_count: 0, degrees: [], title_series: null };

/** Pure. The judge's inputs for a fixture case. */
export function fixtureInputs(fx: BlindPassFixture): JudgeInputs {
  const candidates: EvidenceCandidate[] = fx.evidence.map((e) => ({ ...e, ref: e.id, weight: 1, similarity: null }));
  const texts = noticeTexts(fx.notice.sections, { non_responsive: [], eligibility: { investigator_rules: [], esi_only: false, new_investigator_only: false, clinician_required: false, degree_required: null, independent_appointment_required: false, citizenship_rule: null } });
  return {
    evidence: selectEvidence(candidates, { clinical_trial: fx.notice.clinical_trial_designation }),
    collaborators: fx.investigator.collaborators,
    notice: { opportunity_id: fx.id, number: fx.notice.number, title: fx.notice.title, activity_code: fx.notice.activity_code, clinical_trial_designation: fx.notice.clinical_trial_designation, issuing_ic: fx.notice.issuing_ic ?? null, ...texts, topic_terms: fx.notice.topic_terms, mesh_names: fx.notice.mesh_names ?? [], rcdc: fx.notice.rcdc, sections: fx.notice.sections },
    characteristics: { ...DEFAULT_CHARACTERISTICS, ...fx.investigator.characteristics },
  };
}

/** Pure. A verdict within one tier of any expected tier; an absent verdict never is. */
export function withinOneTier(expected: readonly Tier[], got: Tier | null): boolean {
  if (got === null) return false;
  return expected.some((t) => Math.abs(tierRank(t) - tierRank(got)) <= 1);
}

export type FixtureRun = { id: string; title: string; expected: Tier[]; verdict: Tier | null; variants: Array<{ variant: 1 | 2; verdict_raw: Tier | null; verdict: Tier | null; usable: boolean; lowered: string[] }>; within: boolean; exact: boolean; calls: number; blind: BlindResult };

/** Run the blind pass on one fixture and compare with the expectation. */
export async function runBlindPassFixture(fx: BlindPassFixture, deps: BlindPassDeps): Promise<FixtureRun> {
  const blind = await runBlindPass(fixtureInputs(fx), deps);
  return {
    id: fx.id,
    title: fx.title,
    expected: fx.expect,
    verdict: blind.verdict,
    variants: blind.variants.map((v) => ({ variant: v.variant, verdict_raw: v.verdict_raw, verdict: v.verdict, usable: v.usable, lowered: v.lowered })),
    within: withinOneTier(fx.expect, blind.verdict),
    exact: blind.verdict !== null && fx.expect.includes(blind.verdict),
    calls: blind.calls,
    blind,
  };
}
