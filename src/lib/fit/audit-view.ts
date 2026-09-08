/**
 * What the audit layer says (fit-UX PR 4; brief: `docs/fit-ux/README.md`
 * §"Screens / views" 4, `AUDIT_AND_DECISIONS.md` §3d–§3e). Pure: it takes the
 * records the surface has already loaded — the same four `fitVerdicts` takes —
 * and returns the three instruments the row cannot carry.
 *
 *   - **Approach, side by side** (§3d, §2.8). Four aligned rows per panel:
 *     paradigm, unit, designs, topic terms — what the notice funds against
 *     what the evidence shows. This is the instrument that stops shared
 *     disease keywords reading as a match, because the axis is *shown* rather
 *     than stated. A divergence is a property of the **pair**, so both panels
 *     colour the same row.
 *   - **Two rule tables** (§3e). "Eligibility · who may apply" is career
 *     stage, institution and prior support, Met / Fails / Unknown.
 *     "Notice requirements · what the application must contain" is human
 *     subjects, required materials, required designs and the clinical-trial
 *     allowance, assessed against the evidence, Met by the evidence / Not met
 *     by the evidence / Unknown. **Merging them is what makes a row read as
 *     blocked when it is merely unwritable, and vice versa**, so the split is
 *     structural here: `eligibilityTable` reads `OpportunityEligibility` and
 *     stage 1's flags and nothing else; `requirementsTable` reads
 *     `materials`, `design` and `mechanism` and never touches either.
 *   - **Engine internals** (§"Deep view" 8). The eight components with their
 *     real floor pair, S, the caps and the stage-8 marker — framed as inputs
 *     to the verdicts above, not a second opinion on them.
 *
 * Three rules this module keeps, the same three `verdicts.ts` keeps:
 *
 *   1. **Nothing is re-derived that `verdicts.ts` already derives.** The two
 *      approach families come from `approachFamilies`, the paradigm row's
 *      colour from `approachVerdict`, the eligibility states from
 *      `failedEligibilityRules` / `unknownEligibilityRules` /
 *      `isInvestigatorRule`, the category and family words from
 *      `topCategoryWords` / `familyWords`. A second parse of `flags` here
 *      would be a second answer to "is this an eligibility fact".
 *   2. **No threshold is typed here.** Floors come from `taxonomy.floors` at
 *      call time, "the evidence shows it" from
 *      `taxonomy.methodsParams().evidence_min`, an unmet required design
 *      group from `engine/design.designSupport` — the engine's own gate.
 *   3. **Topic never gates** (CLAUDE.md "Terms"). The topic row can read
 *      `caution` when the coded overlap is under the floor it is measured
 *      against; it can never read `blocking`.
 *
 * And one this module adds: **a state is never invented from silence.** A row
 * whose `flags` column was not loaded, or whose counterpart profile is
 * missing, answers `unknown` on every rule rather than `met` — the shape a
 * table full of green Mets would otherwise take for a pair nothing was
 * actually checked against.
 */
import { designSupport } from "@/lib/fit/engine/design";
import { quoteFor, type QuoteView } from "@/lib/fit/inspect/opportunity-view";
import { judgedOf, type JudgedView, type RationaleView } from "@/lib/fit/explain-view";
import type { FitResultVerdictRow } from "@/lib/fit/results";
import { DESIGN_IDS, designsOf, floors, materialsOf, methodsParams, UNIT_LEVEL_IDS } from "@/lib/fit/taxonomy";
import type {
  Component,
  DesignId,
  DesignWeights,
  FloorComponent,
  FloorTier,
  InvestigatorFitProfile,
  MaterialsKind,
  MaterialsWeights,
  OpportunityEligibility,
  OpportunityFitProfile,
  UnitLevel,
} from "@/lib/fit/types";
import {
  anyOf,
  approachFamilies,
  approachVerdict,
  COMPONENT_WORD,
  designWords,
  failedEligibilityRules,
  familyWords,
  floorTierFor,
  isInvestigatorRule,
  topCategoryWords,
  unitLevelWords,
  unknownEligibilityRules,
  type VerdictInput,
} from "@/lib/fit/verdicts";

// ---------------------------------------------------------------------------
// The view model
// ---------------------------------------------------------------------------

/** Exactly what `fitVerdicts` reads, minus the two fields only the row's sentences need. The audit layer must not be able to see more than the row it explains. */
export type AuditInput = Pick<VerdictInput, "row" | "notice" | "investigator">;

/** How a row of either approach panel reads: agreeing, a real difference, or a disqualifying one. */
export type AuditTone = "ok" | "caution" | "blocking";

/** The four axes the two panels compare, in the order the README lists them. */
export type ApproachAxis = "paradigm" | "unit" | "designs" | "topic";

export const APPROACH_AXES: readonly ApproachAxis[] = ["paradigm", "unit", "designs", "topic"];

/** The notice panel's row labels ("What the notice funds"). */
export const NOTICE_AXIS_LABEL: Record<ApproachAxis, string> = {
  paradigm: "Paradigm funded",
  unit: "Unit required",
  designs: "Designs required",
  topic: "Topic terms",
};

/** The evidence panel's row labels ("What the evidence shows"). The same four axes, said from the other side. */
export const EVIDENCE_AXIS_LABEL: Record<ApproachAxis, string> = {
  paradigm: "Paradigm",
  unit: "Unit",
  designs: "Designs used",
  topic: "Topic terms",
};

export type ApproachRow = { axis: ApproachAxis; label: string; value: string; tone: AuditTone };

/** "Met / Fails / Unknown" — who may apply (§3e). */
export type EligibilityState = "met" | "fails" | "unknown";

/** "Met by the evidence / Not met by the evidence / Unknown" — what the application must contain (§3e). */
export type RequirementState = "met" | "not_met" | "unknown";

export const ELIGIBILITY_STATE_TEXT: Record<EligibilityState, string> = { met: "Met", fails: "Fails", unknown: "Unknown" };

export const REQUIREMENT_STATE_TEXT: Record<RequirementState, string> = {
  met: "Met by the evidence",
  not_met: "Not met by the evidence",
  unknown: "Unknown",
};

/** One row of either rule table: the rule, the notice's verified quote behind it, and its state. */
export type AuditRule<State extends string> = {
  /** A stable key, so the two tables never collide on a repeated rule name. */
  key: string;
  /** The rule as the notice states it. */
  rule: string;
  /** The verbatim quote and section from `opportunity_fit_profiles.provenance`; null when the field carries none. */
  quote: QuoteView | null;
  state: State;
};

export type EligibilityRule = AuditRule<EligibilityState>;
export type RequirementRule = AuditRule<RequirementState>;

/** One component in the internals block: the value, its bar, and the floor pair `taxonomy.json` states for it. */
export type ComponentRow = {
  key: Component;
  label: string;
  value: number;
  /** The Strong and Moderate floors, or null where the tier sets none ("any"). */
  strong: number | null;
  moderate: number | null;
};

/** The internals block's one line under the bars. Numbers, said once, behind a `<details>`. */
export type AuditInternals = {
  /** "S 78.4"; null when the row carries no score. */
  score: string | null;
  /** "no cap", or the caps in words. */
  caps: string;
  /** Stage 8's marker, in `explain-view.judgedOf`'s vocabulary; null for an engine-only row. */
  judged: JudgedView | null;
};

export type AuditContent = {
  notice: ApproachRow[];
  evidence: ApproachRow[];
  eligibility: EligibilityRule[];
  requirements: RequirementRule[];
  components: ComponentRow[];
  internals: AuditInternals;
  /** Whether the row carries a component vector at all — a Poor stub does not. */
  scored: boolean;
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** "a, b and c". */
function andList(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * A materials kind as a panel reads it. `taxonomy.json` gives materials kinds
 * no display label — only ids grouped under `materials.kinds` — so the id is
 * de-underscored, the same rule `verdicts.designWords` keeps for designs.
 * Never invented here.
 */
const materialWords = (k: MaterialsKind | string) => String(k).replace(/_/g, " ");

/** How long a quoted rule runs in a table cell before it stops being scannable. A display width, not a model threshold. */
const RULE_MAX_CHARS = 160;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** The heaviest keys of a weight map, in the given canonical order, heaviest first. */
function heaviestKeys<Id extends string>(weights: Partial<Record<Id, number>> | null | undefined, order: readonly Id[], max: number): Id[] {
  return order
    .map((id) => [id, weights?.[id]] as const)
    .filter((e): e is readonly [Id, number] => typeof e[1] === "number" && Number.isFinite(e[1]) && e[1] > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(1, max))
    .map(([id]) => id);
}

/** The best weight any of `kinds` carries in a materials vector. */
function bestMaterialWeight(weights: MaterialsWeights | null | undefined, kinds: readonly MaterialsKind[]): number {
  let best = 0;
  for (const k of kinds) {
    const w = weights?.[k];
    if (typeof w === "number" && Number.isFinite(w) && w > best) best = w;
  }
  return best;
}

/** `designSupport` walks `design.groups` and throws on a design id the taxonomy no longer knows; a stale row must still render. */
function safeDesignSupport(weights: DesignWeights | null | undefined, notice: OpportunityFitProfile | null): ReturnType<typeof designSupport> | null {
  if (!weights || !notice) return null;
  try {
    return designSupport(weights, notice);
  } catch {
    return null;
  }
}

/** `floors` throws on `poor` and on a tier the taxonomy no longer carries; a stale row must still render. */
function safeFloors(tier: FloorTier): Partial<Record<FloorComponent, number>> | null {
  try {
    return floors(tier) as Partial<Record<FloorComponent, number>>;
  } catch {
    return null;
  }
}

/** The caps of a row as a set, tolerant of a null column. */
const capSet = (row: Pick<FitResultVerdictRow, "caps">) => new Set<string>(row.caps ?? []);

/** A row whose `flags` column was never selected cannot be read for eligibility states; `[]` and "not loaded" are different facts. */
const flagsLoaded = (row: Pick<FitResultVerdictRow, "flags">) => Array.isArray(row.flags);

// ---------------------------------------------------------------------------
// Approach, side by side (§3d)
// ---------------------------------------------------------------------------

/** What a panel says where the record it reads is not on file. Said once per row so the two panels stay line-for-line aligned. */
const NOT_ON_FILE = "Not on file";

/**
 * Pure. The tone of each axis — a property of the **pair**, so both panels
 * take it. Every one of the four comes from something the engine or the
 * taxonomy already decided:
 *
 *   - **paradigm** — `approachVerdict`'s own tone, which grades a
 *     cross-family pair against `paradigm.gates.poor_below` rather than
 *     painting every difference red (C6).
 *   - **unit** — the `unit_gate` cap, blocking only where it actually
 *     excluded the pair (the row is Poor), else the evidence's level sitting
 *     outside the set the notice requires.
 *   - **designs** — an unmet required group. Amber, never red: a required
 *     design the evidence does not show is a *requirement*, not an exclusion
 *     (§3e, §4.1 — `design.gates.required_unsupported_cap_tier` caps the tier,
 *     it does not zero the pair).
 *   - **topic** — the coded overlap against the floor it is measured against.
 *     Amber at worst: **topic never gates**.
 */
export function approachTones(input: AuditInput): Record<ApproachAxis, AuditTone> {
  const caps = capSet(input.row);
  const excluded = input.row.tier === "poor";

  const paradigm = approachVerdict({ row: input.row, notice: input.notice, investigator: input.investigator }).tone;

  const noticeLevels = noticeUnitLevels(input.notice);
  const evidenceLevel = heaviestKeys(input.investigator?.unit, UNIT_LEVEL_IDS, 1)[0] ?? null;
  const unit: AuditTone = caps.has("unit_gate")
    ? excluded
      ? "blocking"
      : "caution"
    : !input.notice || !input.investigator || !noticeLevels.length || !evidenceLevel
      ? "caution"
      : noticeLevels.includes(evidenceLevel)
        ? "ok"
        : "caution";

  const support = safeDesignSupport(input.investigator?.design, input.notice);
  const designs: AuditTone =
    !input.notice || !input.investigator ? "caution" : caps.has("design_required_unsupported") || (support?.unmet_required.length ?? 0) > 0 ? "caution" : "ok";

  const floorTable = safeFloors(floorTierFor(input.row.tier));
  const t = input.row.components?.T;
  const topicFloor = floorTable?.T;
  const topic: AuditTone =
    !input.notice || !input.investigator ? "caution" : typeof t === "number" && typeof topicFloor === "number" && t < topicFloor ? "caution" : "ok";

  return { paradigm, unit, designs, topic };
}

/** The unit levels the notice works at: everything it requires outright and everything in its any-of set. */
function noticeUnitLevels(notice: OpportunityFitProfile | null): UnitLevel[] {
  const raw = [...(notice?.unit?.required ?? []), ...(notice?.unit?.required_any ?? [])];
  return UNIT_LEVEL_IDS.filter((l) => raw.includes(l));
}

/** The required design groups a notice writes, in order; a group is any-of within, all-of across. */
export function requiredDesignGroups(notice: OpportunityFitProfile | null): DesignId[][] {
  return [notice?.design?.required_any ?? [], notice?.design?.required_any_2 ?? []].filter((g) => g.length > 0);
}

/** Pure. "What the notice funds" — four rows, always four, in `APPROACH_AXES` order. */
export function noticeApproachRows(input: AuditInput): ApproachRow[] {
  const tones = approachTones(input);
  const notice = input.notice;
  const families = approachFamilies({ row: input.row, notice, investigator: input.investigator });

  const paradigm = (() => {
    if (!notice) return NOT_ON_FILE;
    const family = families.notice ? familyWords(families.notice) : null;
    const categories = topCategoryWords(Object.keys(notice.paradigm?.required ?? {}).length ? notice.paradigm.required : notice.paradigm?.required_any);
    if (!family && !categories.length) return "The notice names no required approach";
    return [family, categories.length ? andList(categories) : null].filter(Boolean).join(" · ");
  })();

  const unit = (() => {
    if (!notice) return NOT_ON_FILE;
    const levels = noticeUnitLevels(notice);
    return levels.length ? levels.map(unitLevelWords).join(", ") : "Any level";
  })();

  const designs = (() => {
    if (!notice) return NOT_ON_FILE;
    const groups = requiredDesignGroups(notice);
    return groups.length ? groups.map((g) => anyOf(g)).join("; and ") : "Any design";
  })();

  const topic = (() => {
    if (!notice) return NOT_ON_FILE;
    const terms = notice.topic?.terms ?? [];
    return terms.length ? terms.slice(0, 4).join(", ") : "No distinguishing terms on file";
  })();

  const values: Record<ApproachAxis, string> = { paradigm, unit, designs, topic };
  return APPROACH_AXES.map((axis) => ({ axis, label: NOTICE_AXIS_LABEL[axis], value: values[axis], tone: tones[axis] }));
}

/** Pure. "What the evidence shows" — the same four axes, from the profile. */
export function evidenceApproachRows(input: AuditInput): ApproachRow[] {
  const tones = approachTones(input);
  const inv = input.investigator;
  const families = approachFamilies({ row: input.row, notice: input.notice, investigator: inv });

  const paradigm = (() => {
    if (!inv) return NOT_ON_FILE;
    const family = families.investigator ? familyWords(families.investigator) : null;
    const categories = topCategoryWords(Object.keys(inv.paradigm?.recent ?? {}).length ? inv.paradigm.recent : inv.paradigm?.career);
    if (!family && !categories.length) return "No paradigm coded on this profile";
    return [family, categories.length ? andList(categories) : null].filter(Boolean).join(" · ");
  })();

  const unit = (() => {
    if (!inv) return NOT_ON_FILE;
    const level = heaviestKeys(inv.unit, UNIT_LEVEL_IDS, 1)[0];
    return level ? unitLevelWords(level) : "No unit coded on this profile";
  })();

  const designs = (() => {
    if (!inv) return NOT_ON_FILE;
    const used = heaviestKeys(inv.design, DESIGN_IDS, 3);
    return used.length ? used.map(designWords).join(", ") : "No design coded on this profile";
  })();

  const topic = (() => {
    if (!inv) return NOT_ON_FILE;
    const rcdc = (inv.topic?.rcdc ?? []).filter((t) => t.trim().length > 0);
    if (rcdc.length) return rcdc.slice(0, 4).join(", ");
    const free = inv.topic?.free_text?.trim();
    if (free) return clip(free, RULE_MAX_CHARS);
    const mesh = inv.topic?.mesh_major?.length ?? 0;
    return mesh ? `${mesh} major MeSH ${mesh === 1 ? "topic" : "topics"} coded, none named` : "No topic coded on this profile";
  })();

  const values: Record<ApproachAxis, string> = { paradigm, unit, designs, topic };
  return APPROACH_AXES.map((axis) => ({ axis, label: EVIDENCE_AXIS_LABEL[axis], value: values[axis], tone: tones[axis] }));
}

// ---------------------------------------------------------------------------
// Eligibility · who may apply (§3e)
// ---------------------------------------------------------------------------

/**
 * The seven `OpportunityEligibility` fields, each with the words the notice's
 * restriction takes, the provenance path its quote sits on, and the two
 * literal shapes `engine/eligibility.ts` writes when it fails or cannot
 * evaluate that rule.
 *
 * **The matchers are the engine's own strings**, not a reading of them: stage
 * 1 has no per-rule column, so the only thing that says *which* rule failed is
 * the sentence it wrote. Deriving the state any other way — from the notice's
 * fields plus the investigator's characteristics, say — would be a second
 * implementation of stage 1 on a presentation surface, free to disagree with
 * the row above it.
 *
 * `clinician` is matched before `degree`, because a notice whose
 * `degree_required` is literally "MD/DO" writes the same failure prefix as the
 * clinician rule; the clinician row is the one the engine wrote it for.
 */
type EligibilityField = {
  key: string;
  path: string;
  /** Whether the notice states this rule at all, and what it says. */
  rule: (e: OpportunityEligibility) => string | null;
  /** Stage 1's failure sentence for this rule. */
  failed?: (rule: string, e: OpportunityEligibility) => boolean;
  /** Stage 1's "could not evaluate" flag for this rule. */
  unknown?: (flag: string, e: OpportunityEligibility) => boolean;
  /** A rule the engine can never evaluate — it is an unknown by construction, not by outcome. */
  alwaysUnknown?: boolean;
};

const ELIGIBILITY_FIELDS: readonly EligibilityField[] = [
  {
    key: "esi_only",
    path: "eligibility.esi_only",
    rule: (e) => (e.esi_only ? "Early-stage investigators only" : null),
    failed: (r) => r.startsWith("ESI-only notice"),
    unknown: (f) => f === "ESI status not on file",
  },
  {
    key: "new_investigator_only",
    path: "eligibility.new_investigator_only",
    rule: (e) => (e.new_investigator_only ? "New investigators only" : null),
    failed: (r) => r.startsWith("new-investigator-only notice"),
    unknown: (f) => f === "new-investigator status not on file",
  },
  {
    key: "clinician_required",
    path: "eligibility.clinician_required",
    rule: (e) => (e.clinician_required ? "Clinician required" : null),
    failed: (r) => r.startsWith("MD/DO required;"),
    unknown: (f) => f === "clinical degree not on file",
  },
  {
    key: "degree_required",
    path: "eligibility.degree_required",
    rule: (e) => (e.degree_required ? `${e.degree_required} required` : null),
    failed: (r, e) => Boolean(e.degree_required) && r.startsWith(`${e.degree_required} required; degrees on file:`),
    unknown: (f) => f.startsWith("degree rule not evaluated:") || f.startsWith("degree not on file ("),
  },
  {
    key: "independent_appointment_required",
    path: "eligibility.independent_appointment_required",
    rule: (e) => (e.independent_appointment_required ? "Independent appointment required" : null),
    failed: (r) => r.startsWith("independent appointment required;"),
    unknown: (f) => f === "rank not on file (independent appointment required)",
  },
  {
    key: "citizenship_rule",
    path: "eligibility.citizenship_rule",
    rule: (e) => (e.citizenship_rule ? `Citizenship · ${clip(e.citizenship_rule, RULE_MAX_CHARS)}` : null),
    unknown: (f) => f.startsWith("citizenship rule not evaluated:"),
    alwaysUnknown: true,
  },
];

/**
 * Pure. "Eligibility · who may apply": one row per rule the notice states
 * about the **person**, marked Met / Fails / Unknown.
 *
 * What is deliberately absent, and why the table would be wrong with it in:
 * human subjects, required designs and the clinical-trial designation are
 * requirements on the application (`requirementsTable`); a passed deadline is
 * actionability; a self-declared do-not-suggest family is the investigator's
 * own D5 preference. The last two arrive in stage 1's `failed` list beside the
 * eligibility rules and are filtered out by `isInvestigatorRule` — the same
 * filter `eligibilityVerdict` applies to the chip.
 *
 * A failure stage 1 wrote that no field claimed still gets a row of its own,
 * and a pair the engine excluded with no rule text at all gets the sentence
 * `eligibilityVerdict` gives it. Neither can be dropped: a table that says
 * every rule is Met under a `Ruled out` label is the row that lies while every
 * cell tells the truth.
 */
export function eligibilityTable(input: AuditInput): EligibilityRule[] {
  const e = input.notice?.eligibility ?? null;
  const provenance = input.notice?.provenance ?? null;
  const known = flagsLoaded(input.row);
  const failed = known ? failedEligibilityRules(input.row, e) : [];
  const investigatorFailures = failed.filter(isInvestigatorRule);
  const unknowns = known ? unknownEligibilityRules(input.row) : [];
  const claimed = new Set<string>();
  const rows: EligibilityRule[] = [];

  if (e) {
    for (const field of ELIGIBILITY_FIELDS) {
      const rule = field.rule(e);
      if (!rule) continue;
      const hit = field.failed ? investigatorFailures.find((r) => field.failed!(r, e)) : undefined;
      if (hit) claimed.add(hit);
      const isUnknown = field.alwaysUnknown || (field.unknown ? unknowns.some((f) => field.unknown!(f, e)) : false);
      const state: EligibilityState = !known ? "unknown" : hit ? "fails" : isUnknown ? "unknown" : "met";
      rows.push({ key: field.key, rule, quote: quoteFor(provenance, field.path), state });
    }
    // Every verbatim rule the notice wrote and Prospera cannot evaluate. The
    // engine pushes each of these to `unknown` unconditionally, so the row's
    // state is a fact about the rule rather than about this person.
    e.investigator_rules.forEach((rule, i) => {
      rows.push({ key: `investigator_rule_${i}`, rule: clip(rule, RULE_MAX_CHARS), quote: quoteFor(provenance, "eligibility.investigator_rules"), state: "unknown" });
    });
  }

  for (const [i, rule] of investigatorFailures.filter((r) => !claimed.has(r)).entries()) {
    rows.push({ key: `failed_${i}`, rule: clip(rule, RULE_MAX_CHARS), quote: null, state: "fails" });
  }
  // A pair the engine excluded with **no rule text at all** — `E = 0` and an
  // empty `excluded:` flag — still has to say it was excluded, in the words
  // `eligibilityVerdict` gives the chip. The condition is that verdict's,
  // exactly: `!failed.length`, not "no row failed". A stage-1 failure that
  // *is* recorded but is not an eligibility fact — a passed deadline, a
  // self-declared do-not-suggest family — must not be re-labelled "an
  // investigator rule in the notice" here, which is the §3e merge read
  // backwards: those two reach the reader through the caveat, in their own
  // words, and this table stays silent about them.
  if (known && !failed.length && input.row.components?.E === 0) {
    rows.push({ key: "excluded", rule: "An investigator rule in the notice", quote: null, state: "fails" });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Notice requirements · what the application must contain (§3e)
// ---------------------------------------------------------------------------

/** The materials kinds that are human participants, from `taxonomy.materials.kinds`; never a list typed here. */
function humanParticipantKinds(): readonly MaterialsKind[] {
  try {
    return materialsOf("human_participants");
  } catch {
    return [];
  }
}

/** Whether the evidence shows a materials kind, at the taxonomy's own `compose.methods.evidence_min` — the same bar stage 6 credits a capability at. */
function evidenceShowsMaterials(inv: InvestigatorFitProfile | null, kinds: readonly MaterialsKind[]): boolean {
  if (!inv || !kinds.length) return false;
  return bestMaterialWeight(inv.materials, kinds) >= methodsParams().evidence_min;
}

/**
 * Pure. "Notice requirements · what the application must contain": human
 * subjects, required materials, each required design group and the
 * clinical-trial allowance, each assessed **against the evidence**.
 *
 * Nothing about who may apply reaches this table — that is `eligibilityTable`,
 * and keeping them apart is §3e's load-bearing split. Every state that says
 * "Met" or "Not met" is the engine's or the taxonomy's answer:
 * `designSupport().unmet_required` for a design group,
 * `compose.methods.evidence_min` for a materials kind,
 * `designSupport().dominant_prohibited` for a notice that forbids trials.
 * With no investigator profile every row is Unknown — nothing was assessed.
 */
export function requirementsTable(input: AuditInput): RequirementRule[] {
  const notice = input.notice;
  if (!notice) return [];
  const provenance = notice.provenance ?? null;
  const inv = input.investigator;
  const support = safeDesignSupport(inv?.design, notice);
  const rows: RequirementRule[] = [];
  const assessed = Boolean(inv);

  if (notice.materials?.human_required) {
    const kinds = humanParticipantKinds();
    const state: RequirementState = !assessed || !kinds.length ? "unknown" : evidenceShowsMaterials(inv, kinds) ? "met" : "not_met";
    rows.push({ key: "human_required", rule: "Human participants", quote: quoteFor(provenance, "materials.human_required"), state });
  }

  for (const [i, kind] of (notice.materials?.required ?? []).entries()) {
    const state: RequirementState = !assessed ? "unknown" : evidenceShowsMaterials(inv, [kind]) ? "met" : "not_met";
    rows.push({ key: `materials_required_${i}`, rule: `Materials · ${materialWords(kind)}`, quote: quoteFor(provenance, "materials.required"), state });
  }
  const materialsAnyOf = notice.materials?.required_any ?? [];
  if (materialsAnyOf.length) {
    const state: RequirementState = !assessed ? "unknown" : evidenceShowsMaterials(inv, materialsAnyOf) ? "met" : "not_met";
    rows.push({ key: "materials_required_any", rule: `Materials · any of ${materialsAnyOf.map(materialWords).join(" or ")}`, quote: quoteFor(provenance, "materials.required_any"), state });
  }

  const groups = requiredDesignGroups(notice);
  const unmet = support?.unmet_required ?? [];
  groups.forEach((group, i) => {
    const state: RequirementState = !assessed || !support ? "unknown" : unmet.some((g) => g.length === group.length && g.every((d, j) => d === group[j])) ? "not_met" : "met";
    rows.push({ key: `design_group_${i}`, rule: `Study design · ${anyOf(group)}`, quote: quoteFor(provenance, i === 0 ? "design.required_any" : "design.required_any_2"), state });
  });

  const trial = notice.mechanism?.clinical_trial;
  if (trial === "required" || trial === "besh_required") {
    const state: RequirementState = !assessed ? "unknown" : (inv?.evidence_summary?.trials ?? 0) > 0 || evidenceShowsInterventionalDesign(inv) ? "met" : "not_met";
    rows.push({ key: "clinical_trial", rule: trial === "besh_required" ? "Clinical trial required (BESH)" : "Clinical trial required", quote: quoteFor(provenance, "mechanism.clinical_trial"), state });
  } else if (trial === "not_allowed") {
    const state: RequirementState = !assessed || !support ? "unknown" : support.dominant_prohibited ? "not_met" : "met";
    rows.push({ key: "clinical_trial", rule: "Clinical trials are not allowed", quote: quoteFor(provenance, "mechanism.clinical_trial"), state });
  }

  return rows;
}

/** Whether the evidence carries an interventional design at the taxonomy's `evidence_min` — the notice's "a trial is required", read from the profile rather than from the trial count alone. `designsOf` throws on a group the taxonomy no longer carries; a stale row must still render. */
function evidenceShowsInterventionalDesign(inv: InvestigatorFitProfile | null | undefined): boolean {
  if (!inv) return false;
  const min = methodsParams().evidence_min;
  try {
    return designsOf("interventional").some((d) => {
      const w = inv.design?.[d];
      return typeof w === "number" && w >= min;
    });
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Engine internals (§"Deep view" 8)
// ---------------------------------------------------------------------------

/**
 * The eight components in the order §8 names them, with the label
 * `verdicts.COMPONENT_WORD` gives each floored one. `O` and `A` carry no floor
 * in any tier and are not in that map; their words are the ones
 * `component-bars.tsx` has always used.
 */
export const AUDIT_COMPONENTS: ReadonlyArray<{ key: Component; label: string }> = [
  { key: "P", label: COMPONENT_WORD.P },
  { key: "U", label: COMPONENT_WORD.U },
  { key: "D", label: COMPONENT_WORD.D },
  { key: "T", label: COMPONENT_WORD.T },
  { key: "M", label: COMPONENT_WORD.M },
  { key: "O", label: "Objective" },
  { key: "K", label: COMPONENT_WORD.K },
  { key: "A", label: "Actionability" },
];

/**
 * Pure. The eight components with the **real** floor pair, read from
 * `taxonomy.json` at call time (CLAUDE.md: "never hard-code a threshold that
 * lives here"). A component no tier floors answers `null` on both, which the
 * block renders as "no floor" rather than as a zero.
 */
export function componentRows(row: Pick<FitResultVerdictRow, "components">): ComponentRow[] {
  const strong = safeFloors("strong");
  const moderate = safeFloors("moderate");
  const floorOf = (table: Partial<Record<FloorComponent, number>> | null, key: Component): number | null => {
    const v = (table as Partial<Record<string, number>> | null)?.[key];
    return typeof v === "number" ? v : null;
  };
  return AUDIT_COMPONENTS.map(({ key, label }) => ({
    key,
    label,
    value: Math.max(0, Math.min(1, Number(row.components?.[key] ?? 0))),
    strong: floorOf(strong, key),
    moderate: floorOf(moderate, key),
  }));
}

/** Pure. The floor pair as the block prints it: "Strong 0.75 · Moderate 0.50", or "no floor". */
export function floorPairText(component: Pick<ComponentRow, "strong" | "moderate">): string {
  const parts = [
    typeof component.strong === "number" ? `Strong ${component.strong.toFixed(2)}` : null,
    typeof component.moderate === "number" ? `Moderate ${component.moderate.toFixed(2)}` : null,
  ].filter((p): p is string => p !== null);
  return parts.length ? parts.join(" · ") : "no floor";
}

/** Pure. S, the caps and stage 8's marker — the three facts the bars do not carry. */
export function auditInternals(row: FitResultVerdictRow): AuditInternals {
  const score = Number(row.score);
  const caps = row.caps ?? [];
  return {
    score: Number.isFinite(score) ? `S ${score.toFixed(1)}` : null,
    caps: caps.length ? `caps: ${caps.map((c) => c.replace(/_/g, " ")).join(", ")}` : "no cap",
    judged: judgedOf(row),
  };
}

// ---------------------------------------------------------------------------
// The whole audit
// ---------------------------------------------------------------------------

/** Pure. One scored pair as the audit layer renders it. */
export function auditView(input: AuditInput & { row: FitResultVerdictRow }): AuditContent {
  return {
    notice: noticeApproachRows(input),
    evidence: evidenceApproachRows(input),
    eligibility: eligibilityTable(input),
    requirements: requirementsTable(input),
    components: componentRows(input.row),
    internals: auditInternals(input.row),
    scored: Boolean(input.row.components),
  };
}

// ---------------------------------------------------------------------------
// The items (§"Deep view" 7)
// ---------------------------------------------------------------------------

/** One evidence item the audit view lists, with the source link the brief asks for. */
export type AuditItem = {
  id: string;
  title: string;
  meta?: string | null;
  link?: { label: string; href: string } | null;
  quote?: string | null;
  /** "Matched: neuroinflammation, microglia". */
  matched?: string | null;
  /** Prospera's reading of the source text, marked as inferred. */
  inferred?: string | null;
  identity?: { text: string; kind: "ok" | "warn" } | null;
  /**
   * The record a "Not this person" review would write to: which table, and
   * the row's own id. Null on an item that is not an identity-attributable
   * record, or one whose row id the surface does not have — see
   * `identityReviewOf`.
   */
  identityItem?: IdentityItem | null;
};

/**
 * The row a `reviewIdentityAction` call names: its kind, and the **table row
 * id** (`investigator_publications.id`, `investigator_nih_grants.id`,
 * `investigator_clinical_trials.id`), not the evidence id.
 *
 * The two are not the same and the difference is load-bearing.
 * `collectEvidence` mints `publication:<investigator>:<pmid>`,
 * `grant:<row id>` and `trial:<investigator>:<nct id>` — so a **PMID** and an
 * **NCT id** are external identifiers, and `reviewIdentityAction`
 * (`uuid.safeParse(input.itemId)`) will reject both. Only a writer that has
 * the row in hand can fill this in.
 *
 * The kinds are `KIND_TABLE`'s exactly. Biosketch, UCSF Profiles, directory,
 * self-declared and aspiration items are not identity-attributable records —
 * there is no row whose "is this the same person" can be answered — and get
 * no control.
 */
export type IdentityItem = { kind: "publication" | "grant" | "trial"; rowId: string };

/** B8: what an **empty** group offers instead of nothing — "Add profile ID", "Request biosketch", "Send reminder". A destination, never a bare label: a control is drawn only with its mechanism. */
export type AuditItemGroupAction = { kind: string; label: string; href: string };

export type AuditItemGroup = { key: string; title: string; meta?: string | null; items: AuditItem[]; empty?: string | null; action?: AuditItemGroupAction | null };

/** The evidence-id prefix each reviewable kind is minted with (`classify/normalize.ts`). */
const IDENTITY_PREFIX: Record<IdentityItem["kind"], string> = { publication: "publication:", grant: "grant:", trial: "trial:" };

/**
 * Pure. **C4, as the user decided it.** The record "Not this person" acts on,
 * or null.
 *
 * `AUDIT_AND_DECISIONS.md` §4.3 said the action was publication-only;
 * `IMPLEMENTATION_DECISIONS.md` C4 recorded that this is not true —
 * `reviewIdentityAction` takes `kind: keyof typeof KIND_TABLE` and
 * `KIND_TABLE = { publication, grant, trial }` — but kept the restriction,
 * because scope is not widened on the strength of a corrected premise. **The
 * user has now lifted it**, so the control is offered on any record the
 * action can write to.
 *
 * Two conditions, both still required, and now checked per kind:
 *
 *   - the item's evidence id carries that kind's prefix, so the kind the
 *     action is told is the kind the item **is** rather than whatever a
 *     writer happened to attach;
 *   - the item carries a **table row id**. This is the condition that decides
 *     the real scope, not the kind list: an item resolved from an evidence id
 *     alone has a PMID or an NCT id, and `reviewIdentityAction` rejects both.
 *     No row id, no control — an inert control is worse than none.
 */
export function identityReviewOf(item: Pick<AuditItem, "id" | "identityItem">): IdentityItem | null {
  const identity = item.identityItem;
  if (!identity?.rowId) return null;
  return item.id.startsWith(IDENTITY_PREFIX[identity.kind]) ? identity : null;
}

/**
 * How many items the audit view lists. The row's disclosure shows 2–3
 * (`verdict-panel.MAX_ITEMS`); this is the view where "All evidence" is the
 * point, capped only so a judged row's citation list stays a section rather
 * than a dump. A display width, not a model threshold — and it costs no read:
 * `loadEvidenceLookup` is already fed every candidate id by
 * `evidenceIdsToResolve`, and `max` only slices what was resolved.
 */
export const AUDIT_MAX_ITEMS = 8;

/**
 * Pure. The resolved evidence a rationale cites, as items.
 *
 * No `identityItem`: an `EvidenceRef` carries the *evidence id*
 * (`publication:<investigator>:<pmid>`, `trial:<investigator>:<nct id>`), not
 * the table row id `reviewIdentityAction` writes to. So this surface draws no
 * "Not this person" control rather than one that cannot act — the same rule
 * the row keeps for a verb with no mechanism. Widening C4 does not change
 * that: the constraint here is the row id, not the kind.
 */
export function rationaleItems(rationale: Pick<RationaleView, "evidence">): AuditItem[] {
  return rationale.evidence.map((e) => ({
    id: e.id,
    title: e.title,
    meta: e.meta,
    link: e.href ? { label: `${e.kindLabel} ↗`, href: e.href } : null,
  }));
}

/** Pure. Those items as the audit view's one group. An empty group says so rather than showing a heading over nothing. */
export function rationaleItemGroup(rationale: Pick<RationaleView, "evidence">): AuditItemGroup {
  return {
    key: "rationale",
    title: "What this assessment rests on",
    meta: null,
    items: rationaleItems(rationale),
    empty: "No item is linked to this assessment yet.",
  };
}
