/**
 * Stage 1 · eligibility hard filter (spec §7 stage 1; §9 "Exclude" rows;
 * §10 E row).
 *
 * Fails on any rule Prospera can evaluate with confidence. A rule it cannot
 * evaluate is an "unknown" flag — never a fail — that caps the tier at
 * `confidence_caps.eligibility_unknown_max_tier` (tier.ts) and appears in
 * the rationale ("ESI status not on file"). E ∈ {0, 1}.
 *
 * Rules: ESI-only and new-investigator-only against `characteristics.esi`
 * (false once an R01-equivalent was held, PR 1.4; null = not inferable);
 * clinician / degree requirements against `degrees` and `clinical_role`;
 * independent appointment against `career_stage`; a citizenship rule and
 * every verbatim `investigator_rules` entry are unknowns; a passed deadline
 * (negative runway) fails; a self-declared do-not-suggest family that is the
 * notice's dominant required family fails (§9 last row; D5). The degree
 * vocabularies come from `signal-mapping.json › eligibility`.
 */
import { eligibilityVocabulary } from "@/lib/fit/signal-mapping";
import { familyOf, PARADIGM_FAMILY_IDS } from "@/lib/fit/taxonomy";
import type { InvestigatorFitProfile, OpportunityFitProfile, ParadigmFamily, ScoreContext } from "@/lib/fit/types";
import { weightEntries } from "@/lib/fit/engine/util";

export type EligibilityResult = {
  E: 0 | 1;
  /** Rules that failed; E = 0 when any. */
  failed: string[];
  /** Rules Prospera could not evaluate; each caps the tier (never fails). */
  unknown: string[];
};

/** "M.D., Ph.D." → ["md", "phd"]: split on separators and conjunctions, letters only (the token form of `signal-mapping.json › eligibility`). */
export function degreeTokens(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split(/[,;/&()]|\band\b|\bor\b|\s+/i)
    .map((t) => t.toLowerCase().replace(/[^a-z]/g, ""))
    .filter((t) => t.length > 0);
}

export type NoticeFamilies = {
  /** The family carrying the most `paradigm.required` weight; null when nothing is required outright. Ties: taxonomy order. */
  dominant: ParadigmFamily | null;
  /** Families of every required and required_any category, taxonomy order. */
  all: ParadigmFamily[];
};

/** The paradigm families a notice requires (§9 do-not-suggest; exploratory_exceptions collaborator rule). */
export function noticeFamilies(opp: OpportunityFitProfile): NoticeFamilies {
  const byFamily = new Map<ParadigmFamily, number>();
  for (const [c, w] of weightEntries(opp.paradigm.required)) {
    if (w <= 0) continue;
    const f = familyOf(c);
    byFamily.set(f, (byFamily.get(f) ?? 0) + w);
  }
  let dominant: ParadigmFamily | null = null;
  let best = 0;
  for (const f of PARADIGM_FAMILY_IDS) {
    const w = byFamily.get(f) ?? 0;
    if (w > best) {
      best = w;
      dominant = f;
    }
  }
  const all = new Set<ParadigmFamily>(byFamily.keys());
  for (const [c, w] of weightEntries(opp.paradigm.required_any)) if (w > 0) all.add(familyOf(c));
  return { dominant, all: PARADIGM_FAMILY_IDS.filter((f) => all.has(f)) };
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function eligibility(inv: InvestigatorFitProfile, opp: OpportunityFitProfile, ctx: ScoreContext): EligibilityResult {
  const failed: string[] = [];
  const unknown: string[] = [];
  const c = inv.characteristics;
  const e = opp.eligibility;
  const vocab = eligibilityVocabulary();
  const degrees = c.degrees.flatMap((d) => degreeTokens(d));
  const clinicalDegree = degrees.some((d) => vocab.clinical_degrees.has(d)) || (c.clinical_role?.startsWith("md_") ?? false);

  if (e.esi_only) {
    if (c.esi === false) failed.push("ESI-only notice; investigator has held an R01-equivalent award");
    else if (c.esi === null) unknown.push("ESI status not on file");
  }
  if (e.new_investigator_only) {
    if (c.esi === false) failed.push("new-investigator-only notice; investigator has held an R01-equivalent award");
    else if (c.esi === null) unknown.push("new-investigator status not on file");
  }
  if (e.clinician_required && !clinicalDegree) {
    if (degrees.length > 0) failed.push(`MD/DO required; degrees on file: ${c.degrees.join(", ")}`);
    else if (c.clinical_role === "phd_investigator") failed.push("MD/DO required; clinical role on file: phd_investigator");
    else unknown.push("clinical degree not on file");
  }
  if (e.degree_required) {
    const wanted = degreeTokens(e.degree_required).filter((t) => vocab.known_degrees.has(t));
    if (!wanted.length || vocab.open_ended_degree_rule.test(e.degree_required)) unknown.push(`degree rule not evaluated: "${truncate(e.degree_required, 120)}"`);
    else if (!degrees.length) unknown.push(`degree not on file (${e.degree_required} required)`);
    else if (!wanted.some((w) => degrees.includes(w))) failed.push(`${e.degree_required} required; degrees on file: ${c.degrees.join(", ")}`);
  }
  if (e.independent_appointment_required) {
    if (c.career_stage === "trainee") failed.push("independent appointment required; career stage on file: trainee");
    else if (c.career_stage === null) unknown.push("rank not on file (independent appointment required)");
  }
  if (e.citizenship_rule) unknown.push(`citizenship rule not evaluated: "${truncate(e.citizenship_rule, 120)}"`);
  for (const rule of e.investigator_rules) unknown.push(`not evaluated: "${truncate(rule, 160)}"`);

  const runway = ctx.actionability.runway_weeks;
  if (runway !== null && runway < 0) failed.push("deadline has passed");

  const fam = noticeFamilies(opp);
  if (fam.dominant && inv.do_not_suggest.includes(fam.dominant)) failed.push(`self-declared do-not-suggest: ${fam.dominant}`);
  else if (!fam.dominant && fam.all.length > 0 && fam.all.every((f) => inv.do_not_suggest.includes(f))) failed.push(`self-declared do-not-suggest: ${fam.all.join(", ")}`);

  return { E: failed.length ? 0 : 1, failed, unknown };
}
