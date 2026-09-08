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
 * Five rules this module is written to keep:
 *
 *   1. **Topic never gates** (CLAUDE.md "Terms"). `approach` compares
 *      paradigm *families* and reads nothing from `topic`, so shared disease
 *      keywords can never make a row say "same approach".
 *   2. **Eligibility is who may apply; requirements are what the application
 *      must contain** (§3e). `eligibility` reads `OpportunityEligibility` and
 *      the stage-1 provenance only — human subjects, required designs and the
 *      clinical-trial designation are requirements and stay out of it, and so
 *      are the two stage-1 failures that are not eligibility facts (a passed
 *      deadline, a self-declared do-not-suggest family); all of them reach the
 *      row through `caveat`.
 *   3. **No threshold is typed here** (decision A4). Every floor, cap, gate
 *      and thin-evidence count is read from `taxonomy.json` through
 *      `lib/fit/taxonomy.ts` at render time — including how red a difference
 *      of approach is (`paradigm.gates.poor_below`) and what counts as thin
 *      (`aggregation.thin_evidence`, as the engine's own `and`).
 *   4. **The row is coherent with its label.** The verdicts are computed
 *      independently, and a `ruled_out` row whose chips all read `ok` is a
 *      row that lies while every part of it tells the truth. `coherent()`
 *      settles that in tone, never in words.
 *   5. **Every slot is one sentence** (§2.2: 50–90 words per row is the
 *      complaint). Engine prose is cut to its first clause, a quoted rule is
 *      shortened, a list of them is counted, and the caveat's closer is
 *      dropped before the caveat runs long.
 */
import { judgedOf, rationaleView } from "@/lib/fit/explain-view";
import type { FitAudience } from "@/lib/fit/explain-view";
import { designSupport } from "@/lib/fit/engine/design";
import type { EvidenceLookup } from "@/lib/fit/inspect/evidence";
import type { FitResultVerdictRow } from "@/lib/fit/results";
import {
  categoryLabel,
  confidenceCap,
  designGates,
  familyCompat,
  familyLabel,
  familyOf,
  floors,
  isMatrixFamily,
  isParadigmCategory,
  isParadigmFamily,
  isUnitLevel,
  levelLabel,
  paradigmGates,
  PARADIGM_FAMILY_IDS,
  thinEvidence,
  UNIT_LEVEL_IDS,
} from "@/lib/fit/taxonomy";
import type {
  Components,
  ConfidenceCapId,
  DesignId,
  FloorComponent,
  InvestigatorFitProfile,
  OpportunityEligibility,
  OpportunityFitProfile,
  ParadigmFamily,
  Stage8CapId,
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

/**
 * What a row's verb **does**, as a value a surface can switch on.
 *
 * `label` is copy and `kind` is styling; neither is an identity. Every surface
 * used to branch on the label string — `if (label === "Add to outreach")` —
 * which made the wiring a property of the words: `actionOf` returns "Open in
 * Outreach" for a row already in the pipeline (the common case, since that
 * board is the office's queue), and no surface had a branch for it. One list
 * fell through to `saveOpportunitiesAction`, so the button wrote and toasted
 * "Saved … to outreach" for something already there; the aside drew no button
 * at all. A copy change must never be able to unwire a button, so the wiring
 * is on this id and the label is free to change.
 */
export type ActionId = "add_to_outreach" | "see_whats_missing" | "keep_as_lead" | "read_notice" | "dismiss" | "open_in_outreach";

export type Verdict = { text: string; tone: Tone };
export type Caveat = { text: string; tone: CaveatTone };
export type VerdictAction = { /** What the button does. Surfaces switch on this, never on `label` (§"the label's own verb can be overridden", D-e). */ id: ActionId; label: string; kind: ActionKind };

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
   * `opportunity_fit_profiles.sources.complete` (D22), from the **column**.
   *
   * **Required**, and deliberately so. The profile record's own `sources` is
   * written as `{ text, exemplar_count }` and never carries `complete` (see
   * `OpportunitySources` in types.ts), so an optional field here would let a
   * caller omit the one signal `cannot_assess` rests on and get a confident
   * row for a notice whose Part 2 never parsed — §4.2, silently, with the
   * caveat swapped to the wrong reason. A caller with no column value must
   * say `true` and mean it. The record's own field is still honoured when it
   * is there and says `false`: either source calling the profile incomplete
   * makes it incomplete.
   */
  noticeComplete: boolean;
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

/** Has something to say — not blank and not punctuation alone. A strip that leaves `"."` has removed the sentence, and `"."` is truthy. */
const hasWords = (text: string) => /[A-Za-z0-9]/.test(text);

/**
 * Display widths, not model thresholds (A4 is about floors, caps and counts —
 * those still come from `taxonomy.json`). §2.2's complaint is 50–90 words per
 * row before anything actionable, so a slot that would run past what a
 * scanning eye reads drops its least load-bearing part rather than clipping
 * mid-word: the caveat drops its closer, a quoted rule is shortened, and a
 * list of unevaluable rules shows two and counts the rest.
 */
const CAVEAT_MAX_CHARS = 240;
const QUOTED_RULE_MAX_CHARS = 90;
const UNKNOWN_RULES_SHOWN = 2;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** A rule quoted by `engine/eligibility.ts`, shortened; a cut that lands inside the quote closes it again. */
function clipRule(rule: string): string {
  const out = clip(rule, QUOTED_RULE_MAX_CHARS);
  return (out.match(/"/g)?.length ?? 0) % 2 === 1 ? `${out}"` : out;
}

/**
 * One sentence, plus the clause that says what would change it when the two
 * still read at a glance (§3b: the caveat is one line; the paradigm gate's
 * "what would open it" is the one closer the brief asks for). Too long
 * together and the fact wins — the coda is what a strategist can lose.
 */
function withCloser(main: string, closer: string): string {
  const a = sentence(main);
  const b = sentence(closer);
  return a.length + b.length + 1 <= CAVEAT_MAX_CHARS ? `${a} ${b}` : a;
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
 * The three shapes the engine's numeric voice takes, as the writers in
 * `engine/explain.ts` compose them. Kept narrow on purpose: a parenthetical
 * is only the engine's when it is exactly a value, a labelled value
 * (`(support 0.05)`, `(yours 0.85)`) or a value with the view it was read
 * from — so a reconciler's `(mean follow-up 4.5 years)` or `(HR 0.62)`
 * survives, as `(PMID:123)` and `(2019-2024)` already did.
 */
const AXIS_VALUE_PREFIX = /^\s*[A-Z][A-Za-z ]*\s\d+(?:\.\d+)?\s*[—–-]\s*/; // "Paradigm 0.45 — "
const ENGINE_VALUE_PARENTHETICAL = /\s*\((?:support |yours )?\d+(?:\.\d+)?(?:,\s*(?:recent|career) view)?\)/g; // "(0.85, recent view)", "(support 0.05)"
const FLOOR_COMPARISON = /[;,]?\s*[A-Za-z ]+\s\d+(?:\.\d+)?\s+is below the \w+ floor\s\d+(?:\.\d+)?/gi;

/**
 * One clause of engine prose, with the inspector's numbers taken out — or
 * `null` when the numbers *were* the clause.
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
 * The last sentence of `whyNot` for a floors-only Poor pair **is** the floor
 * comparison, and stripping it leaves `"."` — truthy, and enough to satisfy a
 * caller that only checks for a falsy result. Returning `null` says what is
 * true: there is no claim left here, ask somewhere else (`reasonOf`).
 *
 * A judged row is untouched in practice: the reconciler writes prose, and none
 * of these patterns match it.
 *
 * **Exported for PR 3.** The disclosure ("Why you are seeing this", "What
 * would have to be true", "Why it is ruled out") is written from the same two
 * engine strings this reads, and it needs the same de-numbering: rendered
 * without it, the panel put `Paradigm 0.45 — Clinical trials (yours 0.85) …
 * Caps — paradigm_gate (exploratory: P 0.45 < 0.45)` one click from the row,
 * which is §2.5's complaint moved rather than answered. One de-numbering, in
 * the module that owns the engine's voice, rather than a second copy of these
 * three regexes in `verdict-panel.ts`.
 */
export function plainSentence(clause: string): string | null {
  const cleaned = clause
    .replace(AXIS_VALUE_PREFIX, "")
    .replace(ENGINE_VALUE_PARENTHETICAL, "")
    .replace(FLOOR_COMPARISON, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([;,.])/g, "$1")
    .replace(/^[\s;,—–-]+/, "");
  if (!hasWords(cleaned)) return null;
  const out = sentence(cleaned);
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

const RELAXED_PREFIX = "paradigm_gate_relaxed_";

/** Which relaxation lifted a paradigm-gated Poor: an `exploratory_exceptions` id, or `"aspiration"` (§9, §10). Null when the gate was not relaxed. */
function relaxedParadigmGate(caps: ReadonlySet<string>): string | null {
  for (const c of caps) if (c.startsWith(RELAXED_PREFIX)) return c.slice(RELAXED_PREFIX.length);
  return null;
}

/** Stage 1's failed rules, which `tier.ts` leaves on `flags` as one `excluded: <rule>; <rule>` entry (there is no column of its own), split back apart. */
function failedEligibilityRules(row: Pick<FitResultVerdictRow, "flags">): string[] {
  for (const f of row.flags ?? []) if (f.startsWith("excluded: ")) return f.slice("excluded: ".length).split("; ");
  return [];
}

/**
 * Two of stage 1's failures are not eligibility facts (§3e), and both are
 * written verbatim by `engine/eligibility.ts`:
 *
 *   - **the deadline has passed** — actionability, the same fact stage 7
 *     scores as runway. Telling a strategist the person is "not eligible"
 *     for a closed notice is false; the notice closed.
 *   - **a self-declared do-not-suggest family** (D5) — the investigator's own
 *     preference. Under the PI audience "Not eligible" tells the person they
 *     may not apply for something they asked not to be shown.
 *
 * Both still rule the pair out — `E = 0` is the engine's, not this module's —
 * and both reach the row through the caveat, in their own words.
 */
const DEADLINE_PASSED = "deadline has passed";
const DO_NOT_SUGGEST = "self-declared do-not-suggest: ";

const isInvestigatorRule = (rule: string) => rule !== DEADLINE_PASSED && !rule.startsWith(DO_NOT_SUGGEST);

/** The families a `self-declared do-not-suggest: a, b` failure names, as the taxonomy labels them. */
function doNotSuggestFamilies(rules: readonly string[]): string[] {
  const rule = rules.find((r) => r.startsWith(DO_NOT_SUGGEST));
  if (!rule) return [];
  return rule
    .slice(DO_NOT_SUGGEST.length)
    .split(", ")
    .map((f) => (isParadigmFamily(f) ? familyWords(f) : f));
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
  return (row.flags ?? []).filter((f) => ELIGIBILITY_UNKNOWN_RE.test(f) && f !== DEADLINE_NOT_ON_FILE);
}

/**
 * The unevaluable rules as one slot's worth of sentence (§2.2, §3b).
 *
 * `engine/eligibility.ts` quotes each rule verbatim — up to 120 characters for
 * a citizenship rule, 160 for each `investigator_rules` entry — and a notice
 * with four of them joined the lot into a 330-character chip, and the same
 * blob again as the caveat. Two, shortened, and a count of the rest.
 */
function unknownRulesSentence(rules: readonly string[]): string {
  const shown = rules.slice(0, UNKNOWN_RULES_SHOWN).map(clipRule);
  const rest = rules.length - shown.length;
  return rest > 0 ? `${shown.join("; ")}, and ${rest} more the notice does not settle` : shown.join("; ");
}

/**
 * Strong's `A` floor is `runway_ok_not_in_pipeline`, and `checkFloors` reads
 * it as "runway sufficient **and** not in the pipeline **and** not recently
 * dismissed" (`engine/tier.ts`). Two of those three produce a **flag and no
 * cap**: nothing reaches `caps`, `nearestFloor` never sees them (they are not
 * a numeric component), and the row lands on "No blocking constraint." with
 * "See what's missing" beside it — for a notice already sitting in the
 * strategist's own queue. The flags are `tier.ts`'s, verbatim.
 */
const IN_PIPELINE = "already in the Outreach pipeline";
const RECENTLY_DISMISSED = "dismissed by this investigator within the suppression window";
const DEADLINE_NOT_ON_FILE = "deadline not on file";

const hasFlag = (row: Pick<FitResultVerdictRow, "flags">, flag: string) => (row.flags ?? []).includes(flag);

/** The tier word a cap's ceiling reads as ("Moderate at best"). */
const tierWord = (t: Tier) => t[0]!.toUpperCase() + t.slice(1);

// ---------------------------------------------------------------------------
// label (§3a)
// ---------------------------------------------------------------------------

/**
 * Pure. Whether the notice profile the row was scored against is complete
 * (D22): the caller's column value **and** the record's own field, which is
 * optional and, today, never written — a record that does carry `false` is
 * believed. Neither can quietly go missing: `noticeComplete` is required.
 */
export function noticeIsComplete(input: Pick<VerdictInput, "notice" | "noticeComplete">): boolean {
  return input.noticeComplete && input.notice?.sources?.complete !== false;
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
 * strategist the evidence is *Clinical* when the person is an epidemiologist.
 * Fixture 6a is the milder form of the same fault: its `best_pair` is
 * `molecular_cellular_mechanistic` on both sides, so a `best_pair` chip reads
 * "Same approach · Discovery" for a human immunologist whose profile is
 * `translational` — the tier is right and the named approach is not.
 */
export function approachFamilies(input: Pick<VerdictInput, "row" | "notice" | "investigator">): ApproachPair {
  const pair = input.row.best_pair;
  const inv = dominantFamily(input.investigator?.paradigm?.recent) ?? dominantFamily(input.investigator?.paradigm?.career) ?? safeFamilyOf(pair?.investigator);
  const notice = noticeApproachFamily(input.notice, inv) ?? safeFamilyOf(pair?.notice);
  return { investigator: inv, notice };
}

/**
 * The notice's side of the comparison.
 *
 * `paradigm.required` is a conjunction — every term is scored and averaged —
 * so the family carrying the heaviest requirement is what the notice is.
 * `required_any` is a **disjunction** (D14: "the notice is satisfied by any
 * one of these", and stage 2 scores it as the max over the set), so a notice
 * that named the investigator's family as one of its alternatives has said
 * that approach is what it funds — reading one family out of the set and
 * calling the pair "different" would be the notice contradicted by its own
 * row. A BESH notice is the case: `early_phase_human_experimental |
 * human_biospecimen | molecular_cellular_mechanistic` is three families' worth
 * of "yes", and fixture 6a is a Strong match against it.
 *
 * This is not `best_pair`'s charity, which searches the whole matrix for the
 * investigator category that best supported the notice. It stays inside the
 * set the notice itself wrote as equivalent alternatives.
 */
function noticeApproachFamily(notice: OpportunityFitProfile | null | undefined, investigator: ParadigmFamily | null): ParadigmFamily | null {
  const required = dominantFamily(notice?.paradigm?.required);
  if (required) return required;
  const anyOf = notice?.paradigm?.required_any;
  if (investigator && Object.entries(anyOf ?? {}).some(([c, w]) => typeof w === "number" && w > 0 && safeFamilyOf(c) === investigator)) return investigator;
  return dominantFamily(anyOf);
}

/**
 * The family of the heaviest category in a category-keyed vector; ties break
 * in taxonomy family order.
 *
 * **Max, not sum.** Families are not the same size — `population` has six
 * categories, `discovery` two — so summing lets a family win on breadth: a
 * profile whose work is `basic_discovery` 0.90 with five population side
 * lines at 0.20 reads "Population" under a sum, which is the §2.8 error the
 * chip exists to prevent, arriving from the other direction. The heaviest
 * category is what the engine itself calls the dominant paradigm
 * (`engine/paradigm.ts` `heaviest`, `eligibility.noticeFamilies`' dominant is
 * the same idea on the notice side), and it is what the chip names.
 */
function dominantFamily(weights: Partial<Record<string, number>> | null | undefined): ParadigmFamily | null {
  if (!weights) return null;
  const byFamily = new Map<ParadigmFamily, number>();
  for (const [category, w] of Object.entries(weights)) {
    if (typeof w !== "number" || !Number.isFinite(w) || w <= 0) continue;
    const f = safeFamilyOf(category);
    if (!f) continue;
    byFamily.set(f, Math.max(byFamily.get(f) ?? 0, w));
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
 * never "ok" whatever the tier says. No notice profile, or either side
 * unknown → neither claim: the comparison was not made.
 *
 * **How red a difference is comes from the matrix, not from taste.** Every
 * cross-family pair reading `blocking` puts the same red chip on
 * translational-vs-clinical (`familyCompat` **0.60** — the pair the
 * translational bridge exists to surface at Exploratory) as on
 * health_systems-vs-discovery (**0.05**), which is the §2.8 problem again:
 * the axis is stated, not shown. The boundary is `paradigm.gates.poor_below`,
 * the taxonomy's own answer to "is this difference disqualifying" — support
 * for a required category is `(w_i / w_max) · compat(i, o)`, so a pair's
 * family compatibility is the most P it can reach, and below `poor_below`
 * that ceiling is under the gate that makes a pair Poor. Above it, the
 * difference is real but does not by itself exclude: a caution.
 *
 * One family sits outside the matrix, and that too comes from the taxonomy:
 * `cross_cutting` is not in `paradigm.family_compat.order`, and compatibility
 * for it "comes from the unit and design axes" (§4, §7 stage 2) —
 * `familyCompat` throws if asked. So when either side is cross-cutting the
 * families do not decide, and the chip says so. Fixture 4 is the case — a
 * computational statistical geneticist against a genomics notice, Moderate on
 * the engine's own numbers, which a plain family comparison would paint red.
 */
export function approachVerdict(input: Pick<VerdictInput, "row" | "notice" | "investigator">): Verdict {
  if (!input.notice) return { text: "Approach not established · no notice profile on file", tone: "caution" };
  const { investigator, notice } = approachFamilies(input);
  if (!investigator || !notice) return { text: "Approach not established", tone: "caution" };
  if (investigator === notice) return { text: `Same approach · ${familyWords(investigator)}`, tone: "ok" };
  const text = `Different approach · ${familyWords(investigator)} vs ${familyWords(notice)}`;
  if (!isMatrixFamily(investigator) || !isMatrixFamily(notice)) return { text: `${text}, judged on unit and design`, tone: "caution" };
  return { text, tone: familyCompat(investigator, notice) < paradigmGates().poor_below ? "blocking" : "caution" };
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

/**
 * Pure. The eligibility verdict: stage 1's state, worded from the notice's
 * who-may-apply rules.
 *
 * A stage-1 failure is only an eligibility failure when the rule that failed
 * is one — a passed deadline and a self-declared do-not-suggest family are
 * not (see `DEADLINE_PASSED` / `DO_NOT_SUGGEST`). §3e's separation holds
 * against those two as much as against human subjects and required designs:
 * the row still says the pair is out, in the caveat, in the words of whatever
 * actually put it out.
 */
export function eligibilityVerdict(input: Pick<VerdictInput, "row" | "notice">): Verdict {
  const failed = failedEligibilityRules(input.row);
  const investigatorRules = failed.filter(isInvestigatorRule);
  if (investigatorRules.length) return { text: `Not eligible · ${clipRule(investigatorRules[0]!)}`, tone: "blocking" };
  const doNotSuggest = doNotSuggestFamilies(failed);
  if (doNotSuggest.length) return { text: `Not suggested · this profile asks not to be shown ${andList(doNotSuggest)} notices`, tone: "blocking" };
  if (!failed.length && input.row.components?.E === 0) return { text: "Not eligible · an investigator rule in the notice", tone: "blocking" };
  const unknown = unknownEligibilityRules(input.row);
  if (unknown.length) return { text: `Eligibility unverified · ${unknownRulesSentence(unknown)}`, tone: "caution" };
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
 * **Thin is the engine's `and`, not an `or`.** `aggregation.thin_evidence`
 * caps a category when it rests on fewer than `min_items` items **and** fewer
 * than `min_grants` grants (`profile/aggregate.ts`: `c.items < min_items &&
 * c.grants < min_grants`) — a funded award is enough on its own. Read as an
 * `or`, every investigator with no linked RePORTER record is "Thin", 48
 * publications and six trials included, and the word stops meaning anything.
 * So: `Thin` for the engine's own condition plus the `low_profile_confidence`
 * cap, and nothing else.
 *
 * A missing source is a different fact and gets said as one. "48 papers, 6
 * trials; RePORTER not linked" is not a thin record — it is a well-evidenced
 * record with a gap in it — and the gap still has to reach the row (§4.4),
 * which the caution tone does. The notice side (`low_notice_confidence`) is
 * named the same way: it caps the pair because not enough of the notice was
 * read, which is about the assessment, not about the person.
 *
 * The counts are profile-level; the engine applies the same two numbers per
 * category when aggregating (§5). Both come from `taxonomy.json` (A4).
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
  const thin = (counts.items < thresholds.min_items && counts.grants < thresholds.min_grants) || caps.has("low_profile_confidence");

  // what there is, then what is missing — "Well evidenced · no publications on file, 2 awards"
  // reads as a contradiction, and the gap still has to be named (§4.4)
  const present: string[] = [];
  const absent: string[] = [];
  (counts.publications > 0 ? present : absent).push(counts.publications > 0 ? plural(counts.publications, "paper") : "no publications on file");
  (counts.grants > 0 ? present : absent).push(counts.grants > 0 ? plural(counts.grants, "award") : "RePORTER not linked");
  if (counts.trials > 0) present.push(plural(counts.trials, "trial"));
  if (noticeThin) absent.push("notice read from limited text");

  const head = thin ? "Thin" : "Well evidenced";
  const gaps = absent.length ? `${present.length ? "; " : ""}${absent.join(", ")}` : "";
  return { text: `${head} · ${present.join(", ")}${gaps}`, tone: thin || absent.length ? "caution" : "ok" };
}

// ---------------------------------------------------------------------------
// reason (§3b) — one sentence, citations resolved
// ---------------------------------------------------------------------------

/** The engine's excluded-paradigm note, appended *inside* the Paradigm clause with the same ` · ` the clauses are joined by (`engine/explain.ts` `rationale`). No digits: an axis clause always carries its value. */
const EXCLUDED_NOTE = /^([^0-9]+) excluded$/;

/**
 * The one clause a row shows, out of the engine's ` · `-separated component
 * clauses ("Paradigm 0.42 — … · Unit 0.60 — … · Topic …") — the paradigm one,
 * and with it the excluded-paradigm note.
 *
 * That note is the single most decisive paradigm fact the engine writes ("the
 * notice excludes what this profile does"), and it is appended *inside* the
 * paradigm clause with the same separator the clauses are joined by, so the
 * split drops it. It is folded back in as words instead.
 *
 * A reconciler's prose contains no ` · ` at all, so the split returns the
 * whole paragraph: the first sentence of it is the clause (§3b — one
 * sentence, not the 50–90 words of §2.2).
 */
function firstClause(text: string): string {
  const parts = text.split(" · ");
  const head = parts[0] ?? text;
  const excluded = EXCLUDED_NOTE.exec((parts[1] ?? "").trim());
  const clause = excluded ? `${head} — the notice excludes ${excluded[1]}` : head;
  return clause.split(/(?<=\.)\s+(?=[A-Z])/)[0] ?? clause;
}

/**
 * Pure. The one sentence a row leads with: the first clause of the rationale,
 * with the evidence ids it cites resolved to titles by
 * `explain-view.rationaleView` — id resolution and the `top_items` /
 * profile-provenance fallbacks are not reimplemented here.
 */
export function reasonOf(input: Pick<VerdictInput, "row" | "notice" | "investigator" | "lookup">): string {
  // A ruled-out row has no rationale — `toFitResultRow` nulls it for a Poor
  // pair — but it does carry `why_not`, the one sentence that says what
  // excluded it. §3f shows ruled-out rows so a wrong exclusion is catchable,
  // which it is not if every one of them reads "No rationale stored."
  if (!input.row.rationale?.trim()) {
    const whyNot = whyNotSentence(input.row.why_not);
    if (whyNot) return whyNot;
    // …and when `why_not` was *only* a floor comparison — the common "right
    // methods, wrong disease" exclusion, whose whole sentence is "Topic 0.30
    // is below the Exploratory floor 0.35" — the numbers came out and nothing
    // was left. The floor said in words is the reason, as it is in the caveat.
    const near = nearestFloor(input.row.components, input.row.tier);
    if (near && near.margin < 0) return sentence(missedFloorWords(near.component, near.tier, input));
  }
  const view = rationaleView(input.row, input.lookup, { profileProvenance: input.investigator?.provenance ?? null });
  return plainSentence(firstClause(view.text)) || "No rationale stored.";
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

/**
 * The confidence caps a caveat can name, in the order they bind.
 *
 * `satisfies` so a rename in `taxonomy.json` is a compile error here rather
 * than a `TaxonomyError` thrown out of `confidenceCap` in a render path —
 * `CONFIDENCE_CAP_IDS` is derived from the JSON, so `ConfidenceCapId` moves
 * with it. Same rule as `safeFamilyOf`: a stale row must still render.
 */
const CONFIDENCE_CAP_ORDER = ["eligibility_unknown", "low_profile_confidence", "low_notice_confidence", "readiness_far", "runway_short"] as const satisfies readonly ConfidenceCapId[];

/**
 * The stage-8 caps (§16; `judge/reconcile.ts`), in the order they bind. None
 * of them is a gate, none is in `CONFIDENCE_CAP_ORDER`, and none is a
 * component with a floor — so a pair a skeptic objection demoted used to fall
 * all the way to "No blocking constraint.", which is not thin but false. The
 * words are `explain-view.judgedOf`'s: what stage 8 did, and to what.
 */
const STAGE8_CAP_ORDER = ["stage8_verdict", "stage8_objection", "stage8_pending_confirmation"] as const satisfies readonly Stage8CapId[];

const STAGE8_CAP_REASON: Record<Stage8CapId, string> = {
  stage8_verdict: "The blind pass read this pair lower than the structured score, and it is held at the judged tier",
  stage8_objection: "A grounded objection from the skeptic pass lowered this pair",
  stage8_pending_confirmation: "A correction re-scores this pair higher; it is held one tier per cycle until a strategist confirms the correction",
};

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
 *      gives it, then what stage 8 did;
 *   4. an unmet Strong `A` floor, which leaves a flag and no cap;
 *   5. the component nearest its floor;
 *   6. no notice profile to check against;
 *   7. nothing binds, said plainly rather than left blank.
 */
export function caveatOf(input: VerdictInput): Caveat {
  const { row } = input;
  const caps = capSet(row);

  // 1 · gates. Stage 1 fails on three kinds of rule and only one of them is
  // an eligibility rule (§3e); each says what it is.
  const failed = failedEligibilityRules(row);
  const investigatorRules = failed.filter(isInvestigatorRule);
  if (investigatorRules.length) return { text: sentence(`Not eligible: ${investigatorRules.map(clipRule).join("; ")}`), tone: "blocking" };
  const doNotSuggest = doNotSuggestFamilies(failed);
  if (doNotSuggest.length) return { text: sentence(`This profile asks not to be shown ${andList(doNotSuggest)} notices, which is what this one funds`), tone: "blocking" };
  if (failed.includes(DEADLINE_PASSED)) return { text: "The deadline has passed.", tone: "blocking" };
  if (row.components?.E === 0) return { text: "Not eligible under the notice's investigator rules.", tone: "blocking" };
  // a gate cap is blocking when it actually excluded the pair (the row is Poor)
  // and a caution when the row survived it: `paradigm.gates` caps at Poor below
  // `poor_below` and at Exploratory below `exploratory_below`, and the cap id
  // does not record which — the tier does.
  const excluded = row.tier === "poor";
  const relaxed = relaxedParadigmGate(caps);
  if (caps.has("paradigm_gate") || relaxed) {
    // Categories, not the chip's families: the chip has already said which two
    // families these are, so the caveat earns its slot only by being more
    // specific than the chip — what the notice funds, in the taxonomy's own
    // words, against what this profile's work is.
    const wants = topCategoryWords(input.notice?.paradigm?.required ?? input.notice?.paradigm?.required_any);
    const has = topCategoryWords(input.investigator?.paradigm?.recent ?? input.investigator?.paradigm?.career);
    const text =
      wants.length && has.length
        ? `Different kind of research: the notice funds ${andList(wants)}; this profile's work is ${andList(has)}`
        : "Different kind of research: the approach the notice funds is not what the evidence shows";
    const closer = relaxed ? relaxationCloser(relaxed) : excluded ? "Shared disease terms do not close this" : "It holds the pair at Exploratory until that changes";
    return { text: withCloser(text, closer), tone: excluded && !relaxed ? "blocking" : "caution" };
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
    const ceiling = safeConfidenceCap("low_notice_confidence");
    return { text: sentence(`The notice profile is incomplete, so this pair was assessed on part of the notice${ceiling ? ` — ${tierWord(ceiling)} at best` : ""}`), tone: "caution" };
  }
  for (const id of CONFIDENCE_CAP_ORDER) {
    if (!caps.has(id)) continue;
    const ceiling = safeConfidenceCap(id);
    return { text: sentence(`${confidenceCapReason(id, input)}${ceiling ? ` — ${tierWord(ceiling)} at best` : ""}`), tone: "caution" };
  }
  // 3b · what stage 8 did — a cap with no gate, no floor and no ceiling of its own
  for (const id of STAGE8_CAP_ORDER) {
    if (!caps.has(id)) continue;
    const judged = judgedOf(row);
    const move = judged?.changed && judged.from && judged.tier ? `, ${tierWord(judged.from)} to ${tierWord(judged.tier)}` : "";
    return { text: sentence(`${STAGE8_CAP_REASON[id]}${move}`), tone: "caution" };
  }

  // 4 · Strong's `A` floor, which leaves a flag and no cap
  const actionability = actionabilityCaveat(row);
  if (actionability) return actionability;

  // 5 · the nearest floor, said in words. On an excluded pair it is not a
  // near miss but the exclusion itself, and it says so — the reason line above
  // it is this same sentence (the row's `why_not` was the floor comparison and
  // nothing else), so the caveat has to add the fact the reason cannot: this
  // is what ruled the pair out.
  const near = nearestFloor(row.components, row.tier);
  if (near && near.margin < 0) {
    const words = missedFloorWords(near.component, near.tier, input);
    if (excluded) return { text: sentence(`Ruled out: ${words[0]!.toLowerCase()}${words.slice(1)}`), tone: "blocking" };
    return { text: sentence(words), tone: "caution" };
  }

  // 6 · nothing to check the pair against. "No blocking constraint" would be a
  // claim about a notice profile the surface never loaded (§3i degraded row).
  if (!input.notice) return { text: "The notice profile is not on file, so nothing in the notice was checked against this evidence.", tone: "caution" };

  // 7 · nothing binds
  return { text: sentence(["No blocking constraint", ...adjacentFacts(input.notice)].join(". ")), tone: "quiet" };
}

/** `confidenceCap` throws on an id `taxonomy.json` no longer carries; a stale row must still render, so the ceiling clause is dropped rather than the caveat. */
function safeConfidenceCap(id: ConfidenceCapId): Tier | null {
  try {
    return confidenceCap(id);
  } catch {
    return null;
  }
}

/**
 * Strong's `A` floor in words. `checkFloors` reads it as three conditions and
 * two of them leave a flag and no cap, so nothing else in this function can
 * see them — and "already in the Outreach pipeline" is the whole answer for
 * that row: the strategist is looking at their own queue.
 */
function actionabilityCaveat(row: Pick<FitResultVerdictRow, "flags">): Caveat | null {
  if (hasFlag(row, IN_PIPELINE)) return { text: "Already in the Outreach pipeline.", tone: "caution" };
  if (hasFlag(row, RECENTLY_DISMISSED)) return { text: "Dismissed by this investigator recently enough to still be suppressed.", tone: "caution" };
  if (hasFlag(row, DEADLINE_NOT_ON_FILE)) return { text: "The notice has no deadline on file, so there is no runway to check.", tone: "caution" };
  return null;
}

/**
 * What would open a relaxed paradigm gate, per relaxation (§9, §10).
 *
 * `paradigm_gate_relaxed_aspiration` fires because the investigator *stated an
 * aspiration* naming the required paradigm — no collaborator is involved, and
 * `engine/tier.ts` does not look for one — so the collaboration sentence the
 * bridges earn is, for that row, an invention. The biospecimen bridge does not
 * name a collaborator either: it fires on human-biospecimen work against a
 * notice that allows human tissue. Only the translational bridge requires one.
 * Unknown ids degrade rather than throw (a stale row must still render).
 */
function relaxationCloser(relaxation: string): string {
  switch (relaxation) {
    case "aspiration":
      return "A stated aspiration in this direction, not the record, is what opens it";
    case "translational_bridge":
      return "A collaborator in the field the notice funds is what opens it";
    case "biospecimen_bridge":
      return "Human-biospecimen work and a notice that allows human tissue open it";
    default:
      return "An exception in the taxonomy is what opens it";
  }
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
function missedFloorWords(component: FloorComponent, tier: "strong" | "moderate" | "exploratory", input: Pick<VerdictInput, "notice" | "investigator">): string {
  const short = tierWord(tier);
  switch (component) {
    case "T": {
      const terms = input.notice?.topic?.terms ?? [];
      const named = terms.length ? `; the notice's distinguishing terms are ${andList(terms.slice(0, 3).map((t) => t.toLowerCase()))}` : "";
      return `The topic overlap is broad rather than specific — nothing coded at the depth ${short} asks for${named}`;
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
 *
 * **A constraint outranks an encouragement.** Only one of these is shown, so
 * an order that put "Multi-PI allowed" above "Clinical trials are not
 * allowed" would hide the disqualifying fact behind the encouraging one for a
 * clinical trialist — §2.3's complaint, reproduced inside the slot that was
 * meant to answer it.
 */
function adjacentFacts(notice: OpportunityFitProfile | null | undefined): string[] {
  if (!notice) return [];
  if (notice.mechanism?.clinical_trial === "not_allowed") return ["Clinical trials are not allowed"];
  if (notice.team?.consortium_required) return ["A consortium is required"];
  if (notice.team?.multi_pi_allowed) return ["Multi-PI allowed"];
  return [];
}

/** The words for one confidence cap, drawn from what the row and the profiles say rather than from the engine's `reason` string (which the list read does not carry). */
function confidenceCapReason(id: (typeof CONFIDENCE_CAP_ORDER)[number], input: VerdictInput): string {
  switch (id) {
    case "eligibility_unknown": {
      // The chip above already quotes the rules; a caveat that quoted them
      // again would spend the row's one caveat slot on the same 200 characters
      // (§2.7). One rule is worth naming; several are worth counting.
      const unknown = unknownEligibilityRules(input.row);
      if (!unknown.length) return "Eligibility could not be confirmed from the notice's rules";
      if (unknown.length === 1) return `Eligibility could not be confirmed: ${clipRule(unknown[0]!)}`;
      return `Eligibility could not be confirmed: ${plural(unknown.length, "rule")} in the notice are not settled`;
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
  strong: { id: "add_to_outreach", label: "Add to outreach", kind: "primary" },
  moderate: { id: "see_whats_missing", label: "See what's missing", kind: "secondary" },
  exploratory: { id: "keep_as_lead", label: "Keep as a lead", kind: "secondary" },
  cannot_assess: { id: "read_notice", label: "Read the notice", kind: "secondary" },
  ruled_out: { id: "dismiss", label: "Dismiss", kind: "quiet" },
};

/**
 * The pair is already in the office's queue, so the label's verb is the wrong
 * move whatever the label is: "Add to outreach" would duplicate it and "See
 * what's missing" sends a strategist looking for a gap that is not there
 * (the row is short of Strong *because* it is in the pipeline — Strong's `A`
 * floor is `runway_ok_not_in_pipeline`).
 */
const IN_PIPELINE_ACTION: VerdictAction = { id: "open_in_outreach", label: "Open in Outreach", kind: "quiet" };

/** Pure. The row's action, or `null` for the PI (§3h — see `FitVerdicts.action`). `row` overrides the label's verb where the row already has a state of its own. */
export function actionOf(label: VerdictLabel, audience: FitAudience, row?: Pick<FitResultVerdictRow, "flags">): VerdictAction | null {
  if (audience === "investigator") return null;
  if (row && hasFlag(row, IN_PIPELINE)) return IN_PIPELINE_ACTION;
  return VERDICT_ACTION[label];
}

// ---------------------------------------------------------------------------
// The whole row
// ---------------------------------------------------------------------------

/**
 * A ruled-out row must not read as reassuring (§5's requirement for the
 * adversarial cases; §3f shows these rows so a wrong exclusion is catchable,
 * which needs them to *look* excluded).
 *
 * The verdicts are computed independently — that is the point of §3a, three
 * judgments that never blend — and each can be right on its own while the row
 * they make together is not: a pair the engine ruled out on its floors carries
 * no cap, so nothing reaches `blocking`, and a Poor row lands with "Same
 * approach" in green, "Eligible" in green, "Well evidenced" in green and an
 * amber caveat. Nothing there is false; the row is. So the label, which is the
 * engine's own verdict, sets the floor: on `ruled_out` the caveat is the
 * block, and no chip is allowed to read `ok`.
 *
 * Tone only — the words each verdict chose are still the true ones, and a
 * demoted chip keeps saying exactly what it said.
 */
function coherent(label: VerdictLabel, verdicts: FitVerdicts): FitVerdicts {
  if (label !== "ruled_out") return verdicts;
  const notOk = (v: Verdict): Verdict => (v.tone === "ok" ? { ...v, tone: "caution" } : v);
  return {
    ...verdicts,
    approach: notOk(verdicts.approach),
    eligibility: notOk(verdicts.eligibility),
    evidence: notOk(verdicts.evidence),
    caveat: { ...verdicts.caveat, tone: "blocking" },
  };
}

/** Pure. One scored pair as the redesigned surfaces render it. */
export function fitVerdicts(input: VerdictInput): FitVerdicts {
  const label = verdictLabelOf(input.row, noticeIsComplete(input));
  return coherent(label, {
    label,
    approach: approachVerdict(input),
    eligibility: eligibilityVerdict(input),
    evidence: evidenceVerdict(input),
    reason: reasonOf(input),
    caveat: caveatOf(input),
    action: actionOf(label, input.audience, input.row),
  });
}
