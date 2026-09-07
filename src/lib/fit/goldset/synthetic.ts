/**
 * Synthetic investigators for the gold set (plan § PR 2.4; spec §13, §14):
 * the ImmunoX roster has no investigator whose dominant family is
 * population or health systems (D1), so ten off-diagonal cells of the
 * family matrix cannot be filled from real profiles. Two investigators
 * hydrated from the adversarial fixture stand in — case 2 (a cardiovascular
 * epidemiologist: population) and case 7a (a health-services researcher:
 * health systems) — paired with REAL open notices of each target family.
 * They carry no vector and no stored row, so the legacy engine never sees
 * them; fit-v1 scores them with the fixture's own context merged with the
 * real notice's runway and completeness. A synthetic id is
 * `synthetic:<case id>` — not a roster UUID: a `fit_labels` row for such a
 * pair carries the case id in `synthetic_source` with `investigator_id`
 * NULL (20260918100000_fit_labels_synthetic.sql). Pure apart from the
 * fixture read.
 */
import { loadAdversarialCases, type AdversarialCase } from "@/lib/fit/engine/fixtures";
import { investigatorFamily } from "@/lib/fit/goldset/families";
import type { FamilySlot } from "@/lib/fit/goldset/families";
import { SYNTHETIC_PREFIX, type SyntheticStratifyInvestigator } from "@/lib/fit/goldset/stratify";
import { categoryLabel, isParadigmCategory } from "@/lib/fit/taxonomy";
import { categoryDisplay } from "@/lib/fit/inspect/labels";
import type { InvestigatorFitProfile, ScoreContext } from "@/lib/fit/types";

/** The fixture cases that stand in for the two families the roster lacks. */
export const SYNTHETIC_CASES: ReadonlyArray<{ case: string; family: FamilySlot }> = [
  { case: "2_cvd_epi_vs_mito_mechanism", family: "population" },
  { case: "7a_hsr_vs_beta_cell_mechanism", family: "health_systems" },
];

export type SyntheticInvestigator = {
  /** `synthetic:<case id>`. */
  id: string;
  /** The fixture case id. */
  source: string;
  /** The fixture case title's investigator half ("Cardiovascular epidemiologist"). */
  name: string;
  family: FamilySlot;
  profile: InvestigatorFitProfile;
  /** The fixture's context (its `topic_score_override`, actionability defaults). */
  ctx: ScoreContext;
  /** What a labeler reads instead of evidence titles: the profile's axes in words. */
  narrative: string[];
};

const weights = (w: Record<string, number | undefined>, label: (id: string) => string): string =>
  Object.entries(w)
    .filter((e): e is [string, number] => typeof e[1] === "number" && e[1] > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([id, v]) => `${label(id)} ${v.toFixed(2)}`)
    .join(", ");

/** Pure. The narrative lines for a fixture profile: paradigm, unit, design, materials, objective, topic. */
export function syntheticNarrative(p: InvestigatorFitProfile): string[] {
  const out: string[] = [];
  const paradigm = weights(p.paradigm.recent, (id) => (isParadigmCategory(id) ? categoryLabel(id) : id));
  if (paradigm) out.push(`Paradigm (recent): ${paradigm}`);
  const unit = weights(p.unit, (id) => categoryDisplay("unit", id).label);
  if (unit) out.push(`Unit of analysis: ${unit}`);
  const design = weights(p.design, (id) => categoryDisplay("design", id).label);
  if (design) out.push(`Study designs: ${design}`);
  const materials = weights(p.materials, (id) => categoryDisplay("materials", id).label);
  if (materials) out.push(`Materials and data: ${materials}`);
  const objective = weights(p.objective, (id) => categoryDisplay("objective", id).label);
  if (objective) out.push(`Objective: ${objective}`);
  const topic = [...p.topic.rcdc, ...p.topic.mesh_major].join(", ");
  if (topic) out.push(`Topic: ${topic}`);
  return out;
}

/** The investigator half of a fixture title ("A → B" → "A"). */
const nameOf = (title: string): string => title.split("→")[0]!.trim() || title;

function fromCase(c: AdversarialCase, family: FamilySlot): SyntheticInvestigator {
  const fam = investigatorFamily(c.investigator);
  if (fam.family !== family) throw new Error(`adversarial-cases.json: case ${c.id} is a ${fam.family} investigator, not ${family} — the synthetic cases in goldset/synthetic.ts drifted from the fixture`);
  return { id: `${SYNTHETIC_PREFIX}${c.id}`, source: c.id, name: nameOf(c.title), family, profile: c.investigator, ctx: c.ctx, narrative: syntheticNarrative(c.investigator) };
}

/** The two synthetic investigators, hydrated from the fixture; throws when a case is missing or its family drifted. */
export function syntheticInvestigators(): SyntheticInvestigator[] {
  const byId = new Map(loadAdversarialCases().map((c) => [c.id, c]));
  return SYNTHETIC_CASES.map((s) => {
    const c = byId.get(s.case);
    if (!c) throw new Error(`adversarial-cases.json: no case ${s.case} for the synthetic ${s.family} investigator`);
    return fromCase(c, s.family);
  });
}

/** The stratify input for the synthetic investigators. */
export function syntheticStratifyInvestigators(list: readonly SyntheticInvestigator[] = syntheticInvestigators()): SyntheticStratifyInvestigator[] {
  return list.map((s) => ({ id: s.id, family: s.family, source: s.source }));
}

/** Pure. The fixture's context merged with the real notice's runway and completeness — what fit-v1 scores a synthetic pair with. */
export function syntheticScoreContext(base: ScoreContext, notice: { runway_weeks: number | null; complete: boolean }, now: string): ScoreContext {
  return { ...base, now, actionability: { ...base.actionability, runway_weeks: notice.runway_weeks }, notice_complete: notice.complete };
}
