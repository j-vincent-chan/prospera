/**
 * The row view model the redesigned fit surfaces render (fit-UX PR 1; brief:
 * `docs/fit-ux/AUDIT_AND_DECISIONS.md` §3a–§3b and §5 "PR 1"). Pure: it takes
 * records the surface has already loaded and returns text. No Supabase, no
 * `fetch`, no `await` — loading is PR 3's problem (decision A3).
 *
 * One judgment, said four ways and never blended (§3a):
 *
 *   - **label** — the engine's tier vocabulary plus the two states a tier
 *     cannot express: `ruled_out` (the engine excluded the pair) and
 *     `cannot_assess` (the notice profile is incomplete, so the assessment is
 *     not one to act on).
 *   - **approach / eligibility / evidence** — three verdicts a strategist
 *     must keep apart: is this the same *kind* of research, may this person
 *     *apply*, and how much *evidence* does the assessment rest on.
 *   - **reason** and **caveat** — one sentence each, the caveat naming the
 *     single binding constraint and never empty (§3b).
 *   - **action** — one verb, or none for the PI (§3h; see `action` below).
 *
 * Three rules this module is written to keep:
 *
 *   1. **Topic never gates** (CLAUDE.md "Terms"). `approach` compares
 *      paradigm *families* and reads nothing from `topic`, so shared disease
 *      keywords can never make a row say "same approach".
 *   2. **Eligibility is who may apply; requirements are what the application
 *      must contain** (§3e). `eligibility` reads `OpportunityEligibility` and
 *      the stage-1 provenance only — human subjects, required designs and the
 *      clinical-trial designation are requirements and stay out of it; they
 *      reach the row through `caveat`.
 *   3. **No threshold is typed here** (decision A4). Every floor, cap and
 *      thin-evidence count is read from `taxonomy.json` through
 *      `lib/fit/taxonomy.ts` at render time.
 */
import { rationaleView } from "@/lib/fit/explain-view";
import type { FitAudience } from "@/lib/fit/explain-view";
import { designSupport } from "@/lib/fit/engine/design";
import type { EvidenceLookup } from "@/lib/fit/inspect/evidence";
import type { FitResultVerdictRow } from "@/lib/fit/results";
import {
  categoryLabel,
  confidenceCap,
  designGates,
  familyLabel,
  familyOf,
  floors,
  isMatrixFamily,
  isParadigmCategory,
  isUnitLevel,
  levelLabel,
  PARADIGM_FAMILY_IDS,
  thinEvidence,
  UNIT_LEVEL_IDS,
} from "@/lib/fit/taxonomy";
import type {
  Components,
  DesignId,
  FloorComponent,
  InvestigatorFitProfile,
  OpportunityEligibility,
  OpportunityFitProfile,
  ParadigmFamily,
  Tier,
  UnitLevel,
} from "@/lib/fit/types";

// ---------------------------------------------------------------------------
// The view model
// ---------------------------------------------------------------------------

/** How a verdict chip reads: neutral, a warning, or a block (§3a chips). */
export type Tone = "ok" | "caution" | "blocking";

/** The caveat's severity — `quiet` when nothing binds (§3b: the caveat line is grey, amber or red). */
export type CaveatTone = "quiet" | "caution" | "blocking";

/** The five labels a row can carry: the engine's three surfaced tiers plus the two states a tier cannot express (§3a). */
export type VerdictLabel = "strong" | "moderate" | "exploratory" | "cannot_assess" | "ruled_out";

export type ActionKind = "primary" | "secondary" | "quiet";

export type Verdict = { text: string; tone: Tone };
export type Caveat = { text: string; tone: CaveatTone };
export type VerdictAction = { label: string; kind: ActionKind };

export type FitVerdicts = {
  label: VerdictLabel;
  /** Paradigm families compared. Never "same" on the strength of shared topic terms. */
  approach: Verdict;
  /** Who may apply, from `OpportunityEligibility` and stage 1 only. */
  eligibility: Verdict;
  /** What the assessment rests on, in words rather than dots. */
  evidence: Verdict;
  /** The first clause of the rationale, evidence ids resolved to titles. */
  reason: string;
  /** The single binding constraint. Never empty. */
  caveat: Caveat;
  /**
   * The row's one verb — `null` for the `investigator` audience (§3h).
   *
   * D7's PI view has no per-row action: Outreach is the office's internal
   * queue, a PI cannot add themselves to it, and `FitOpportunities` has no
   * per-row action for that audience today either. Modelling it as `null`
   * (rather than returning an action the caller is expected to drop) makes
   * the deliberate gap a fact of the type: a surface cannot render a PI
   * button by forgetting to check the audience.
   */
  action: VerdictAction | null;
};

/**
 * What `fitVerdicts` needs, all of it already loaded by the surface (A3).
 * Every record is nullable because the degraded states (§3i) render the same
 * row shape with the profile missing.
 */
export type VerdictInput = {
  row: FitResultVerdictRow;
  notice: OpportunityFitProfile | null;
  investigator: InvestigatorFitProfile | null;
  /** Resolves the evidence ids a rationale cites; `EMPTY_LOOKUP` is fine. */
  lookup: EvidenceLookup;
  audience: FitAudience;
  /**
   * `opportunity_fit_profiles.sources.complete` (D22) when the caller has the
   * **column**. Prefer passing it: the profile record's own `sources` is
   * written as `{ text, exemplar_count }` and never carries `complete` (see
   * `OpportunitySources` in types.ts). Omitted, this falls back to
   * `notice.sources.complete !== false`, i.e. "complete" — matching the two
   * existing readers (`service.ts`, `inspect/load.ts`).
   */
  noticeComplete?: boolean;
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One sentence: trimmed, punctuated once. */
function sentence(text: string): string {
  const t = text.trim().replace(/[\s·;,]+$/, "");
  if (!t) return "";
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/**
 * The heaviest categories of a paradigm vector, as their taxonomy labels.
 *
 * The approach chip is family-level ("Different approach · Population vs
 * Discovery"); a caveat that repeated that would spend the row's one caveat
 * slot on a sentence already read one line up — §2.7's complaint. Categories
 * are the specificity the chip does not have ("implementation science,
 * health services research"), which is the voice the prototype's own copy
 * uses for this case.
 */
function topCategoryWords(weights: Partial<Record<string, number>> | null | undefined, max = 2): string[] {
  if (!weights) return [];
  return Object.entries(weights)
    .filter(([id, w]) => typeof w === "number" && Number.isFinite(w) && w > 0 && isParadigmCategory(id))
    .sort((a, b) => (b[1] as number) - (a[1] as number) || a[0].localeCompare(b[0]))
    .slice(0, Math.max(1, max))
    .map(([id]) => categoryLabel(id).toLowerCase());
}

/**
 * The one sentence a ruled-out row shows as its reason, from `why_not`.
 *
 * `why_not` is the engine's diagnostic paragraph, written for the strategist's
 * "Why not?" disclosure rather than for a row: several sentences, one per axis,
 * carrying the values and floors behind each ("yours is Molecular / cellular
 * mechanistic (0.85, recent view) (support 0.05) … Topic 0.30 is below the
 * Exploratory floor 0.35"). Rendered whole it would put the inspector's whole
 * dump on the decision surface — worse than the "No rationale stored." it
 * replaces. So: the first sentence only, with the numeric parentheticals and
 * any trailing value clause dropped. What survives is the axis and the two
 * things being compared, which is what §3f wants visible so a wrong exclusion
 * is catchable.
 */
function whyNotSentence(whyNot: string | null | undefined): string | null {
  const raw = whyNot?.trim();
  if (!raw) return null;
  return plainSentence(raw.split(/(?<=\.)\s+(?=[A-Z])/)[0] ?? raw);
}

/**
 * One clause of engine prose, with the inspector's numbers taken out.
 *
 * The engine writes both `rationale` and `why_not` in its own voice, and that
 * voice is numeric: `"Paradigm 0.45 — Clinical trials (yours 0.85) vs.
 * required Genetic epidemiology"`, `"yours is Molecular / cellular mechanistic
 * (0.85, recent view) (support 0.05)"`, `"Topic 0.30 is below the Exploratory
 * floor 0.35"`. The brief's rule for `reason` is "the first clause of the
 * rationale", which taken literally puts all of that on the decision surface —
 * the §2.5 complaint the redesign exists to answer. So the axis-and-value
 * prefix, the parenthetical values and any floor comparison come out, and what
 * is left is the claim itself.
 *
 * A judged row is untouched in practice: the reconciler writes prose, and none
 * of these patterns match it.
 */
function plainSentence(clause: string): string | null {
  const cleaned = clause
    .replace(/^\s*[A-Z][A-Za-z ]*\s\d+(?:\.\d+)?\s*[—–-]\s*/, "") // "Paradigm 0.45 — "
    .replace(/\s*\([^()]*\d+\.\d+[^()]*\)/g, "") // "(0.85, recent view)", "(support 0.05)" — a decimal, never a citation like "(PMID:123)"
    .replace(/[;,]?\s*[A-Za-z ]+\s\d+(?:\.\d+)?\s+is below the \w+ floor\s\d+(?:\.\d+)?/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([;,.])/g, "$1")
    .replace(/^[\s;,—–-]+/, "");
  const out = sentence(cleaned);
  if (!out) return null;
  return out[0]!.toUpperCase() + out.slice(1);
}

/** "a, b and c" — the caveat's list voice. */
function andList(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** A design id as a decision surface reads it. `taxonomy.json` gives designs no display label — only ids grouped under `design.groups` — so the id is de-underscored, never invented. */
const designWords = (d: DesignId | string) => String(d).replace(/_/g, " ");

/** "gwas or secondary data analysis". */
const anyOf = (designs: readonly (DesignId | string)[]) => designs.map(designWords).join(" or ");

/**
 * A family as a chip reads it. `familyLabel` is the taxonomy's own label; the
 * one trailing parenthetical it carries ("Cross-cutting (compatibility from
 * axes B–D)") is an aside for readers of the JSON, not chip copy, so it is
 * dropped. The words themselves are never invented here.
 */
const familyWords = (f: ParadigmFamily) => familyLabel(f).replace(/\s*\([^()]*\)\s*$/, "");

/** `familyOf` throws on a category the taxonomy does not know; a stale row must still render. */
function safeFamilyOf(category: string | null | undefined): ParadigmFamily | null {
  return category && isParadigmCategory(category) ? familyOf(category) : null;
}

/** The heaviest key of a weight map, in the given canonical order (ties: taxonomy order). */
function heaviestKey<Id extends string>(weights: Partial<Record<Id, number>> | null | undefined, order: readonly Id[]): Id | null {
  let best: Id | null = null;
  let bestWeight = 0;
  for (const id of order) {
    const w = weights?.[id];
    if (typeof w === "number" && Number.isFinite(w) && w > bestWeight) {
      bestWeight = w;
      best = id;
    }
  }
  return best;
}

/** The `caps` of a row as a set, tolerant of a null column. */
const capSet = (row: Pick<FitResultVerdictRow, "caps">) => new Set<string>(row.caps ?? []);

const hasRelaxedParadigmGate = (caps: ReadonlySet<string>) => Array.from(caps).some((c) => c.startsWith("paradigm_gate_relaxed_"));

/** Stage 1's failed rules, which `tier.ts` leaves on `flags` as `excluded: <rules>` (there is no column of its own). */
function failedEligibilityRule(row: Pick<FitResultVerdictRow, "flags">): string | null {
  for (const f of row.flags ?? []) if (f.startsWith("excluded: ")) return f.slice("excluded: ".length);
  return null;
}

/**
 * Stage 1's unevaluable rules, which `tier.ts` also leaves on `flags`, one per
 * entry, verbatim from `engine/eligibility.ts` ("ESI status not on file",
 * `citizenship rule not evaluated: "…"`, …). Only read when the row actually
 * carries the `eligibility_unknown` cap, so no other flag can be mistaken for
 * one; "deadline not on file" is stage 7's and is excluded by name.
 */
const ELIGIBILITY_UNKNOWN_RE = /\bnot on file\b|\bnot evaluated\b/i;

function unknownEligibilityRules(row: Pick<FitResultVerdictRow, "caps" | "flags">): string[] {
  if (!capSet(row).has("eligibility_unknown")) return [];
  return (row.flags ?? []).filter((f) => ELIGIBILITY_UNKNOWN_RE.test(f) && f !== "deadline not on file");
}

/** The tier word a cap's ceiling reads as ("Moderate at best"). */
const tierWord = (t: Tier) => t[0]!.toUpperCase() + t.slice(1);

// ---------------------------------------------------------------------------
// label (§3a)
// ---------------------------------------------------------------------------

/**
 * Pure. Whether the notice profile the row was scored against is complete
 * (D22). `noticeComplete` wins when given — that is the stored column; the
 * profile record's own `sources.complete` is optional and, today, never
 * written. Absent everywhere, a row counts as complete.
 */
export function noticeIsComplete(input: Pick<VerdictInput, "notice" | "noticeComplete">): boolean {
  if (typeof input.noticeComplete === "boolean") return input.noticeComplete;
  return input.notice?.sources?.complete !== false;
}

/**
 * Pure. The row's label.
 *
 * Precedence, as the brief lists it: the engine's exclusion first, then the
 * notice's completeness, then the tier.
 *
 *   - `ruled_out` — `components.E === 0` (stage 1 failed a rule it could
 *     evaluate) **or** `tier === "poor"`. The tier union has no `poor` and
 *     the redesign shows Poor rows under "Show *n* ruled out" (§3f), so Poor
 *     is exactly the row the engine ruled out — by the eligibility gate or by
 *     one of the paradigm / unit / design gates.
 *   - `cannot_assess` — the notice profile is incomplete, regardless of tier
 *     (§4.2: a notice whose Part 2 never parsed can otherwise produce a
 *     confident-looking row). A pair the engine excluded stays `ruled_out`:
 *     a rule that *was* read and failed is a fact about the person, and
 *     hiding it behind "can't assess" would re-hide the exclusion §3f exists
 *     to surface.
 *   - otherwise the tier.
 */
export function verdictLabelOf(row: Pick<FitResultVerdictRow, "tier" | "components">, complete: boolean): VerdictLabel {
  if (row.components?.E === 0 || row.tier === "poor") return "ruled_out";
  if (!complete) return "cannot_assess";
  return row.tier;
}

// ---------------------------------------------------------------------------
// approach (§3a) — paradigm families, never topic
// ---------------------------------------------------------------------------

export type ApproachPair = { investigator: ParadigmFamily | null; notice: ParadigmFamily | null };

/**
 * Pure. The two paradigm families the row compares: **what each side actually
 * is**, not what best supported the other.
 *
 * The investigator's family is the one carrying the most weight across the
 * recent view (then the career view); the notice's is the one carrying the
 * most `paradigm.required` weight (then `required_any`, for a notice that
 * requires an any-of set alone, as a BESH notice does). Stage 2's `best_pair`
 * is the fallback for a row whose profiles are not loaded. Topic is never
 * consulted — that is rule 1 at the top of this file.
 *
 * **Deliberately not `best_pair` first**, though the brief's PR-1 table says
 * `best_pair.investigator`. Stage 2 stores the pair that *best supports the
 * notice*, which is the investigator's most charitable category rather than
 * their approach: fixture 2's cardiovascular epidemiologist (`epidemiology`
 * 0.90, `population_health` 0.60) has `best_pair.investigator =
 * clinical_observational` (0.45), so a `best_pair` reading of the chip tells a
 * strategist the evidence is *Clinical*. Summing to families also keeps the
 * chip consistent with the tier: on `best_pair` categories, fixture 6a is a
 * Strong match that reads "Different approach".
 */
export function approachFamilies(input: Pick<VerdictInput, "row" | "notice" | "investigator">): ApproachPair {
  const pair = input.row.best_pair;
  const inv = dominantFamily(input.investigator?.paradigm?.recent) ?? dominantFamily(input.investigator?.paradigm?.career) ?? safeFamilyOf(pair?.investigator);
  const notice = dominantFamily(input.notice?.paradigm?.required) ?? dominantFamily(input.notice?.paradigm?.required_any) ?? safeFamilyOf(pair?.notice);
  return { investigator: inv, notice };
}

/** The family carrying the most weight in a category-keyed vector; ties break in taxonomy family order. */
function dominantFamily(weights: Partial<Record<string, number>> | null | undefined): ParadigmFamily | null {
  if (!weights) return null;
  const byFamily = new Map<ParadigmFamily, number>();
  for (const [category, w] of Object.entries(weights)) {
    if (typeof w !== "number" || !Number.isFinite(w) || w <= 0) continue;
    const f = safeFamilyOf(category);
    if (!f) continue;
    byFamily.set(f, (byFamily.get(f) ?? 0) + w);
  }
  let best: ParadigmFamily | null = null;
  let bestWeight = 0;
  for (const f of PARADIGM_FAMILY_IDS) {
    const w = byFamily.get(f) ?? 0;
    if (w > bestWeight) {
      bestWeight = w;
      best = f;
    }
  }
  return best;
}

/**
 * Pure. The approach verdict. Same family → "Same approach · <family>";
 * different families → "Different approach · <investigator> vs <notice>",
 * blocking whatever the tier says. Either side unknown → neither claim.
 *
 * One exception, and it comes from the taxonomy rather than from taste:
 * `cross_cutting` is not in `paradigm.family_compat.order`, and compatibility
 * for it "comes from the unit and design axes" (§4, §7 stage 2) —
 * `familyCompat` throws if asked. So when either side is cross-cutting the
 * families do not decide, and the chip is a caution rather than a block: it
 * says the two differ and that this axis is not what settles it. Fixture 4 is
 * the case — a computational statistical geneticist against a genomics
 * notice, Moderate on the engine's own numbers, which a plain family
 * comparison would paint red.
 */
export function approachVerdict(input: Pick<VerdictInput, "row" | "notice" | "investigator">): Verdict {
  const { investigator, notice } = approachFamilies(input);
  if (!investigator || !notice) return { text: "Approach not established", tone: "caution" };
  if (investigator === notice) return { text: `Same approach · ${familyWords(investigator)}`, tone: "ok" };
  const text = `Different approach · ${familyWords(investigator)} vs ${familyWords(notice)}`;
  const crossCutting = !isMatrixFamily(investigator) || !isMatrixFamily(notice);
  return crossCutting ? { text: `${text}, judged on unit and design`, tone: "caution" } : { text, tone: "blocking" };
}

// ---------------------------------------------------------------------------
// eligibility (§3e) — who may apply, and nothing else
// ---------------------------------------------------------------------------

/**
 * Pure. The notice's investigator-level restrictions, in the notice's own
 * terms. Career stage, ESI, new investigator, clinician, degree, independent
 * appointment and citizenship — the seven `OpportunityEligibility` fields.
 * Human subjects, required designs and the clinical-trial designation are
 * requirements (§3e) and are deliberately absent.
 */
export function eligibilityRestrictions(e: OpportunityEligibility | null | undefined): string[] {
  if (!e) return [];
  const out: string[] = [];
  if (e.esi_only) out.push("early-stage investigators only");
  if (e.new_investigator_only) out.push("new investigators only");
  if (e.clinician_required) out.push("clinician required");
  if (e.degree_required) out.push(`${e.degree_required} required`);
  if (e.independent_appointment_required) out.push("independent appointment required");
  if (e.citizenship_rule) out.push("a citizenship rule applies");
  if (e.investigator_rules?.length) out.push(plural(e.investigator_rules.length, "further rule in the notice", "further rules in the notice"));
  return out;
}

/** Pure. The eligibility verdict: stage 1's state, worded from the notice's who-may-apply rules. */
export function eligibilityVerdict(input: Pick<VerdictInput, "row" | "notice">): Verdict {
  const failed = failedEligibilityRule(input.row);
  if (input.row.components?.E === 0) return { text: `Not eligible · ${failed ?? "an investigator rule in the notice"}`, tone: "blocking" };
  const unknown = unknownEligibilityRules(input.row);
  if (unknown.length) return { text: `Eligibility unverified · ${unknown.join("; ")}`, tone: "caution" };
  if (!input.notice) return { text: "Eligibility unverified · no notice profile on file", tone: "caution" };
  const restrictions = eligibilityRestrictions(input.notice.eligibility);
  return { text: restrictions.length ? `Eligible · ${restrictions.join(", ")}` : "Eligible · the notice names no investigator restrictions", tone: "ok" };
}

// ---------------------------------------------------------------------------
// evidence (§3a, §4.4) — confidence in words, not dots
// ---------------------------------------------------------------------------

export type EvidenceCounts = { publications: number; grants: number; trials: number; items: number };

/** Pure. What the profile rests on, by kind (`evidence_summary`, §5 profile record). */
export function evidenceCounts(inv: InvestigatorFitProfile | null | undefined): EvidenceCounts {
  const s = inv?.evidence_summary;
  const publications = Math.max(0, s?.publications_verified ?? 0);
  const grants = Math.max(0, s?.grants ?? 0);
  const trials = Math.max(0, s?.trials ?? 0);
  return { publications, grants, trials, items: publications + grants + trials };
}

/**
 * Pure. The evidence verdict.
 *
 * Thin when `aggregation.thin_evidence` would call it thin — fewer than
 * `min_items` items, or fewer than `min_grants` grants — or when the row
 * carries the `low_profile_confidence` cap. The engine applies those two
 * counts per category when aggregating (§5); the same two numbers are read
 * here, at profile level, to say in words what §4.4 says fires silently. The
 * notice side (`low_notice_confidence`) is named too, since it caps the pair
 * for the same reason: not enough was read.
 */
export function evidenceVerdict(input: Pick<VerdictInput, "row" | "investigator">): Verdict {
  const caps = capSet(input.row);
  const noticeThin = caps.has("low_notice_confidence");
  if (!input.investigator) {
    const text = noticeThin ? "Evidence not assessed · no fit profile on file, and the notice was read from limited text" : "Evidence not assessed · no fit profile on file";
    return { text, tone: "caution" };
  }
  const counts = evidenceCounts(input.investigator);
  const thresholds = thinEvidence();
  const thin = counts.items < thresholds.min_items || counts.grants < thresholds.min_grants || caps.has("low_profile_confidence");

  // what there is, then what is missing — "Well evidenced · no publications on file, 2 awards"
  // reads as a contradiction, and the gap still has to be named (§4.4)
  const present: string[] = [];
  const absent: string[] = [];
  (counts.publications > 0 ? present : absent).push(counts.publications > 0 ? plural(counts.publications, "paper") : "no publications on file");
  (counts.grants > 0 ? present : absent).push(counts.grants > 0 ? plural(counts.grants, "award") : "RePORTER not linked");
  if (counts.trials > 0) present.push(plural(counts.trials, "trial"));
  if (noticeThin) absent.push("notice read from limited text");

  const head = thin ? "Thin" : "Well evidenced";
  return { text: `${head} · ${[...present, ...absent].join(", ")}`, tone: thin || noticeThin ? "caution" : "ok" };
}

// ---------------------------------------------------------------------------
// reason (§3b) — one sentence, citations resolved
// ---------------------------------------------------------------------------

/**
 * Pure. The first clause of the rationale, with the evidence ids it cites
 * resolved to titles by `explain-view.rationaleView` — id resolution and the
 * `top_items` / profile-provenance fallbacks are not reimplemented here.
 *
 * The engine writes its rationale as ` · `-separated component clauses
 * ("Paradigm 0.42 — … · Unit 0.60 — … · Topic …"), so the first clause is the
 * paradigm one; a judged row's rationale is the reconciler's prose, where the
 * citations sit in the opening sentence and this reads as intended.
 */
export function reasonOf(input: Pick<VerdictInput, "row" | "investigator" | "lookup">): string {
  // A ruled-out row has no rationale — `toFitResultRow` nulls it for a Poor
  // pair — but it does carry `why_not`, the one sentence that says what
  // excluded it. §3f shows ruled-out rows so a wrong exclusion is catchable,
  // which it is not if every one of them reads "No rationale stored."
  if (!input.row.rationale?.trim()) {
    const whyNot = whyNotSentence(input.row.why_not);
    if (whyNot) return whyNot;
  }
  const view = rationaleView(input.row, input.lookup, { profileProvenance: input.investigator?.provenance ?? null });
  const first = view.text.split(" · ")[0] ?? view.text;
  return plainSentence(first) || "No rationale stored.";
}

// ---------------------------------------------------------------------------
// caveat (§3b) — the single binding constraint, never empty
// ---------------------------------------------------------------------------

/** The numeric floors that are a plain component comparison (§10 table); the three composite keys are not. */
const FLOOR_COMPONENTS: readonly FloorComponent[] = ["P", "U", "D", "T", "M", "K"];

/** The component labels the audit view's internals block prints beside each bar (PR 4); no decision surface shows these. */
export const COMPONENT_WORD: Record<FloorComponent, string> = {
  P: "Paradigm",
  U: "Unit of analysis",
  D: "Design",
  T: "Topic",
  M: "Methods",
  K: "Track record",
};

/** The tier whose floors a row is measured against: the next one up, or Strong's own for a Strong row. */
export function floorTierFor(tier: Tier): "strong" | "moderate" | "exploratory" {
  switch (tier) {
    case "strong":
      return "strong";
    case "moderate":
      return "strong";
    case "exploratory":
      return "moderate";
    default:
      return "exploratory";
  }
}

/** The confidence caps a caveat can name, in the order they bind. */
const CONFIDENCE_CAP_ORDER = ["eligibility_unknown", "low_profile_confidence", "low_notice_confidence", "readiness_far", "runway_short"] as const;

/** The required design groups the evidence does not support, named. */
function unmetRequiredDesigns(input: Pick<VerdictInput, "notice" | "investigator">): DesignId[][] {
  const notice = input.notice;
  if (!notice) return [];
  if (input.investigator) {
    const unmet = designSupport(input.investigator.design, notice).unmet_required;
    if (unmet.length) return unmet;
    // the cap says a group is unsupported; without agreement, name every required group rather than nothing
  }
  return [notice.design.required_any, notice.design.required_any_2].filter((g) => g.length > 0);
}

/** The unit levels the notice works at, and the level the evidence sits at. */
function unitLevels(input: Pick<VerdictInput, "notice" | "investigator">): { notice: UnitLevel[]; investigator: UnitLevel | null } {
  const required = [...(input.notice?.unit.required ?? []), ...(input.notice?.unit.required_any ?? [])].filter((l): l is UnitLevel => isUnitLevel(l));
  return { notice: required, investigator: heaviestKey(input.investigator?.unit, UNIT_LEVEL_IDS) };
}

const level = (l: UnitLevel) => `${l} (${levelLabel(l)})`;

export type NearestFloor = { component: FloorComponent; value: number; floor: number; margin: number; tier: "strong" | "moderate" | "exploratory" };

/**
 * Pure. The component closest to the floor it is measured against — below it
 * (what keeps the row where it is) or, when nothing is below, the smallest
 * margin above (what would give first). Floors come from `taxonomy.json` at
 * call time (A4); a floor the tier does not carry is skipped.
 */
export function nearestFloor(components: Components | null | undefined, tier: Tier): NearestFloor | null {
  if (!components) return null;
  const floorTier = floorTierFor(tier);
  const table = floors(floorTier) as Partial<Record<FloorComponent, number>>;
  let best: NearestFloor | null = null;
  for (const c of FLOOR_COMPONENTS) {
    const floor = table[c];
    const value = components[c];
    if (typeof floor !== "number" || typeof value !== "number" || !Number.isFinite(value)) continue;
    const margin = value - floor;
    if (!best || margin < best.margin) best = { component: c, value, floor, margin, tier: floorTier };
  }
  return best;
}

/**
 * Pure. The one constraint that binds, in the brief's precedence:
 *
 *   1. a failed gate, and its rule — the eligibility gate first (a fact about
 *      the person), then the paradigm gate, then the unit gate;
 *   2. an unmet required design group — a *requirement*, not an exclusion,
 *      so it is amber where the gates are red (§3e, §4.1);
 *   3. the floor named in `caps` — the notice's completeness first, then the
 *      confidence caps, each with the ceiling `taxonomy.confidence_caps`
 *      gives it;
 *   4. the component nearest its floor;
 *   5. nothing binds, said plainly rather than left blank.
 */
export function caveatOf(input: VerdictInput): Caveat {
  const { row } = input;
  const caps = capSet(row);

  // 1 · gates
  if (row.components?.E === 0) {
    const rule = failedEligibilityRule(row);
    return { text: sentence(rule ? `Not eligible: ${rule}` : "Not eligible under the notice's investigator rules"), tone: "blocking" };
  }
  // a gate cap is blocking when it actually excluded the pair (the row is Poor)
  // and a caution when the row survived it: `paradigm.gates` caps at Poor below
  // `poor_below` and at Exploratory below `exploratory_below`, and the cap id
  // does not record which — the tier does.
  const excluded = row.tier === "poor";
  if (caps.has("paradigm_gate") || hasRelaxedParadigmGate(caps)) {
    const relaxed = hasRelaxedParadigmGate(caps);
    // Categories, not the chip's families: the chip has already said which two
    // families these are, so the caveat earns its slot only by being more
    // specific than the chip — what the notice funds, in the taxonomy's own
    // words, against what this profile's work is.
    const wants = topCategoryWords(input.notice?.paradigm?.required ?? input.notice?.paradigm?.required_any);
    const has = topCategoryWords(input.investigator?.paradigm?.recent ?? input.investigator?.paradigm?.career);
    const text =
      wants.length && has.length
        ? `Different kind of research. The notice funds ${andList(wants)}; this profile's work is ${andList(has)}`
        : "Different kind of research: the approach the notice funds is not what the evidence shows";
    const closer = relaxed
      ? "The gap names the collaboration that would open it"
      : excluded
        ? "Shared disease terms do not close this"
        : "It holds the pair at Exploratory until that changes";
    return { text: `${sentence(text)} ${sentence(closer)}`, tone: excluded && !relaxed ? "blocking" : "caution" };
  }
  if (caps.has("unit_gate")) {
    const u = unitLevels(input);
    const text = u.notice.length
      ? `The notice works at ${u.notice.map(level).join(", ")}; the evidence is at ${u.investigator ? level(u.investigator) : "another level"}`
      : "The notice's unit of analysis is not supported by the evidence";
    return { text: sentence(text), tone: excluded ? "blocking" : "caution" };
  }

  // 2 · an unmet required design (§4.1 — the case a strategist reads as "nearly there" and the engine does not)
  if (caps.has("design_required_unsupported")) {
    const groups = unmetRequiredDesigns(input);
    const text = groups.length
      ? `The notice requires ${groups.map((g) => anyOf(g)).join("; and ")}; the evidence shows none of it`
      : "The notice requires a study design the evidence does not show";
    const ceiling = designGates().required_unsupported_cap_tier;
    return { text: sentence(`${text} — ${tierWord(ceiling)} at best`), tone: "caution" };
  }

  // 3 · a floor named in caps
  if (!noticeIsComplete(input)) {
    return { text: sentence(`The notice profile is incomplete, so this pair was assessed on part of the notice — ${tierWord(confidenceCap("low_notice_confidence"))} at best`), tone: "caution" };
  }
  for (const id of CONFIDENCE_CAP_ORDER) {
    if (!caps.has(id)) continue;
    return { text: sentence(`${confidenceCapReason(id, input)} — ${tierWord(confidenceCap(id))} at best`), tone: "caution" };
  }

  // 4 · the nearest floor, said in words
  const near = nearestFloor(row.components, row.tier);
  if (near && near.margin < 0) return { text: sentence(missedFloorWords(near.component, near.tier, input)), tone: "caution" };

  // 5 · nothing binds
  return { text: sentence(["No blocking constraint", ...adjacentFacts(input.notice)].join(". ")), tone: "quiet" };
}

/**
 * What a missed floor says on a decision surface: what is absent, and what a
 * reviewer will make of it. Never the value and never the floor — those are
 * the collapsed internals block's and the admin inspectors' (§2.5, §3a), and
 * "Topic 0.55 is below the Strong floor 0.6" is exactly the inspector voice
 * the redesign takes off this surface. Facts come from the loaded profiles
 * where they are there, and the sentence degrades to the plainest true form
 * where they are not.
 */
function missedFloorWords(component: FloorComponent, tier: "strong" | "moderate" | "exploratory", input: VerdictInput): string {
  const short = tierWord(tier);
  switch (component) {
    case "T": {
      const terms = input.notice?.topic?.terms ?? [];
      const named = terms.length ? ` The notice's distinguishing terms are ${andList(terms.slice(0, 3).map((t) => t.toLowerCase()))}` : "";
      return `The topic overlap is broad rather than specific — nothing coded at the depth ${short} asks for.${named}`;
    }
    case "K": {
      const code = input.notice?.mechanism?.activity_code ?? null;
      const held = input.investigator?.characteristics?.mechanisms_held ?? [];
      if (code && !held.includes(code)) return `No ${code} or equivalent in the recent record, so reviewers will read this as a new mechanism for the lab`;
      return "The track record is short of what reviewers will expect at this mechanism";
    }
    case "M":
      return "The methods the notice expects are only partly evidenced";
    case "D":
      return `The designs the notice expects are only partly evidenced — short of ${short}, though none of them is a required design`;
    case "U": {
      const u = unitLevels(input);
      return u.notice.length ? `The notice works at ${u.notice.map(level).join(", ")}; the evidence mostly sits at another level` : "The unit of analysis is close but short of what the notice works at";
    }
    case "P":
      return "The research approach is adjacent to what the notice funds rather than the same";
  }
}

/**
 * The one adjacent fact a clean row is allowed beside "No blocking
 * constraint" — the prototype's Strong row reads "No blocking constraint.
 * Multi-PI allowed." Facts about how the application may be *built*, never a
 * component score. At most one, so the slot stays one sentence long.
 */
function adjacentFacts(notice: OpportunityFitProfile | null | undefined): string[] {
  if (!notice) return [];
  if (notice.team?.consortium_required) return ["A consortium is required"];
  if (notice.team?.multi_pi_allowed) return ["Multi-PI allowed"];
  if (notice.mechanism?.clinical_trial === "not_allowed") return ["Clinical trials are not allowed"];
  return [];
}

/** The words for one confidence cap, drawn from what the row and the profiles say rather than from the engine's `reason` string (which the list read does not carry). */
function confidenceCapReason(id: (typeof CONFIDENCE_CAP_ORDER)[number], input: VerdictInput): string {
  switch (id) {
    case "eligibility_unknown": {
      const unknown = unknownEligibilityRules(input.row);
      return unknown.length ? `Eligibility could not be confirmed: ${unknown.join("; ")}` : "Eligibility could not be confirmed from the notice's rules";
    }
    case "low_profile_confidence": {
      const c = evidenceCounts(input.investigator);
      return input.investigator ? `The assessment rests on ${plural(c.items, "item")} in the profile` : "The investigator profile is too thin to be confident";
    }
    case "low_notice_confidence":
      return input.notice?.sources?.text === "synopsis" ? "The notice was read from its synopsis, not the full text" : "The notice profile rests on limited text";
    case "readiness_far":
      return "The mechanism sits far above what this investigator has held";
    case "runway_short":
      return "The deadline is too close to prepare this application";
  }
}

// ---------------------------------------------------------------------------
// action (§3h)
// ---------------------------------------------------------------------------

/** Label → verb (§5 "PR 1"). One verb per label; the strategist's next move, never a judgment of merit. */
export const VERDICT_ACTION: Record<VerdictLabel, VerdictAction> = {
  strong: { label: "Add to outreach", kind: "primary" },
  moderate: { label: "See what's missing", kind: "secondary" },
  exploratory: { label: "Keep as a lead", kind: "secondary" },
  cannot_assess: { label: "Read the notice", kind: "secondary" },
  ruled_out: { label: "Dismiss", kind: "quiet" },
};

/** Pure. The row's action, or `null` for the PI (§3h — see `FitVerdicts.action`). */
export function actionOf(label: VerdictLabel, audience: FitAudience): VerdictAction | null {
  return audience === "investigator" ? null : VERDICT_ACTION[label];
}

// ---------------------------------------------------------------------------
// The whole row
// ---------------------------------------------------------------------------

/** Pure. One scored pair as the redesigned surfaces render it. */
export function fitVerdicts(input: VerdictInput): FitVerdicts {
  const label = verdictLabelOf(input.row, noticeIsComplete(input));
  return {
    label,
    approach: approachVerdict(input),
    eligibility: eligibilityVerdict(input),
    evidence: evidenceVerdict(input),
    reason: reasonOf(input),
    caveat: caveatOf(input),
    action: actionOf(label, input.audience),
  };
}
