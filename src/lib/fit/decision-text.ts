/**
 * **One invariant for every string a decision surface renders** (fit-UX final
 * round, B1; brief: `AUDIT_AND_DECISIONS.md` §2.5 "Inspector numbers on a
 * decision surface", §3a "No score, no tier tooltip, no component numbers on
 * the decision surface").
 *
 * The invariant, stated once and checked in one place:
 *
 * > A string rendered on a decision surface may not contain a **decimal
 * > number**, a **raw ontology code**, a **percentage derived from a
 * > component**, or a **raw record id**. Whole numbers that are genuine item
 * > counts — "48 papers, 2 awards", "3 of 3", "11 weeks to the deadline" —
 * > stay, and so do mechanism codes ("R01", "K23"), unit levels ("L3") and
 * > verbatim quotes from the notice or an item.
 *
 * ### Why this module exists rather than a fourth regex in `verdicts.ts`
 *
 * The previous approach de-numbered per *shape*: an axis prefix **followed by
 * a dash**, a parenthetical that is only a number, and one floor comparison.
 * Everything the engine wrote in a fourth shape went straight to 14px ink —
 * `Objective 0.63` (no dash, written unconditionally on every rationale),
 * `rct 0.70`, `(C20.111.590 at depth 3)`, `80% of design mass`. Driven through
 * the real engine, **all six scored adversarial fixtures leaked, both Strong
 * pairs included**. A stripper that is a list of known shapes fails open on
 * the shape nobody listed.
 *
 * So the rule is inverted. `plainClause` still *rewrites* the engine's numeric
 * voice into prose — that is how a clause is made safe rather than lost — but
 * what guarantees the invariant is the check after it: a clause that is still
 * unsafe is **dropped**, never shipped half-stripped. Three levels, each
 * general rather than per-shape:
 *
 *   1. **rewrite** — the engine's own numeric idioms, six of them, each a
 *      shape of *writing a value* rather than a shape of one sentence;
 *   2. **prune** — a list keeps its safe members ("not in the evidence:
 *      C12.777.419.780, Kidney Disease" → "not in the evidence: Kidney
 *      Disease");
 *   3. **drop** — anything still unsafe returns `null` and the caller loses
 *      the clause.
 *
 * ### Why the prose path, and not composition from structured provenance
 *
 * Composing the panel from the row's own provenance was the alternative, and
 * it is not available where the panel is drawn. The facts a composed panel
 * needs — `provenance.T.coded_matches`, `P.best_pair`'s weights, `D.groups`,
 * `K.mechanisms_held` — live in `fit_results.provenance`, and
 * `FIT_RESULT_LIST_COLUMNS` deliberately does not select that blob (D32, and
 * C2 kept it that way when it added `components` / `caps` / `flags`). Every
 * decision surface reads the verdict columns; none of them has the provenance.
 * Adding it would put the inspector's payload on three list queries to render
 * prose the engine has already written. So: keep the prose, and make the
 * invariant total.
 *
 * Nothing here is a display *threshold* (A4 is untouched — floors, caps and
 * counts still come from `taxonomy.json`); these are patterns for the shapes
 * the engine writes values in.
 */
import type { Collaborator } from "@/lib/fit/types";

// ---------------------------------------------------------------------------
// The invariant
// ---------------------------------------------------------------------------

/**
 * A decimal number: every component value, support, weight and floor the
 * engine prints (`engine/util.fmt` is `toFixed(2)`). Also catches a MeSH tree
 * number, which is dotted digits by construction.
 */
const DECIMAL = /\d+\.\d+/;

/** A percentage. `engine/explain.ts` writes one shape of these — `Math.round(prohibited_share * 100)` — and every one of them is a component share. */
const PERCENT = /\d+(?:\.\d+)?\s?%/;

/**
 * A raw ontology code: a MeSH tree number (`C20.111.590`, `G05.360.340.024.340`)
 * or a MeSH descriptor UI (`D008180`).
 *
 * **Narrow on purpose.** A bare letter and two digits is also every NIH
 * activity code the row legitimately names — `R01`, `K23`, `U01`, `R21` — so
 * the pattern requires either a dotted tree number (depth ≥ 2, which every
 * code the engine prints has, since it prints the *deepest* match) or the six
 * digits of a descriptor id.
 */
const ONTOLOGY_CODE = /\b[A-Z]\d{2}(?:\.\d{1,3})+\b|\b[A-Z]\d{6}\b/;

/** A record id. Production `Collaborator.id`s are `investigators.id` UUIDs, and an id is not something a reader can act on. */
const RECORD_ID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

/**
 * Pure. **The invariant.** True when a string may not be rendered on a
 * decision surface.
 *
 * Exported so the surfaces' own tests can assert it over whatever they
 * produce, rather than each re-deriving what "the inspector's voice" is.
 */
export function isEngineValueText(text: string): boolean {
  return DECIMAL.test(text) || PERCENT.test(text) || ONTOLOGY_CODE.test(text) || RECORD_ID.test(text);
}

// ---------------------------------------------------------------------------
// Small shared shapes
// ---------------------------------------------------------------------------

/** Has something to say — not blank and not punctuation alone. A strip that leaves `"."` has removed the sentence, and `"."` is truthy. */
export const hasWords = (text: string) => /[A-Za-z0-9]/.test(text);

/** One sentence: trimmed, punctuated once. */
export function sentence(text: string): string {
  const t = text.trim().replace(/[\s·;,]+$/, "");
  if (!t) return "";
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/** Sentence-split on `. ` before a capital — the shape `engine/explain.ts` joins its gap sentences in. */
export function sentencesOf(text: string | null | undefined): string[] {
  const raw = text?.trim();
  if (!raw) return [];
  return raw
    .split(/(?<=\.)\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(hasWords);
}

/** The engine's clause separator inside one rationale (`engine/explain.ts` joins with `" · "`). */
export const CLAUSE_SEPARATOR = " · ";

// ---------------------------------------------------------------------------
// The rewrites — the engine's numeric voice, as prose
// ---------------------------------------------------------------------------

/** `"Paradigm 0.45 — "`, `"Track record 0.10: "` — an axis label, its value and whatever the engine punctuates the join with. */
const AXIS_VALUE_PREFIX = /^\s*[A-Z][A-Za-z /]*\s\d+(?:\.\d+)?\s*[—–:-]\s*/;

/** `"Topic 0.30 is no coded match at depth ≥ 3"` — the same head, joined with a verb instead. */
const AXIS_VALUE_IS = /^\s*[A-Z][A-Za-z /]*\s\d+(?:\.\d+)?\s+is\s+/;

/** `"Objective 0.63"` — a clause whose whole content **is** the value. Nothing survives the strip, so the clause goes. */
const AXIS_VALUE_ONLY = /^\s*[A-Z][A-Za-z /]*\s\d+(?:\.\d+)?\s*$/;

/**
 * `"Topic 0.55 is below the Strong floor 0.6"` — a floor comparison, anchored
 * to the start of its clause.
 *
 * **Anchored, because the unanchored version ate a sentence boundary.**
 * `[A-Za-z ]+` will happily start on the space after `"…none in the
 * evidence."`, so the old pattern matched `" Methods 0.25 is below the
 * Moderate floor 0.3"` **including its leading space** and left `"evidence.;
 * missing gwas…"` — a `.;` in 11px grey on the opportunity peek. Clauses are
 * split before the rewrites now, so this only ever has to match at position 0.
 */
const FLOOR_COMPARISON = /^\s*[A-Z][A-Za-z ]*\s\d+(?:\.\d+)?\s+is below the \w+ floor\s\d+(?:\.\d+)?\s*[;,]?\s*/;

/** `"rct | early_phase_trial required, rct 0.70"` — `designGroupsClause`'s best-supported design and its support. The design is the fact; the support is the inspector's. */
const DESIGN_SUPPORT = /(\brequired,\s+[A-Za-z0-9_]+)\s+\d+(?:\.\d+)?/g;

/** `", 80% of the design evidence"`, `"(80% of design mass)"` — the one percentage `engine/explain.ts` writes, in both places it writes it. */
const DESIGN_SHARE = /\s*,?\s*\(?\d+% of (?:the )?design (?:mass|evidence)\)?/g;

/** Any parenthetical whose content trips the invariant: `(0.85, recent view)`, `(support 0.05)`, `(C20.111.590 at depth 3)`. Keeps `(human aggregate)` and a reconciler's `(PMID:123)`. */
const PARENTHETICAL = /\s*\([^()]*\)/g;

/** `"Collaborators in the directory who do this: <ids>."` — `engine/explain.ts`'s one clause that names records rather than facts. */
const COLLABORATORS = /^Collaborators in the directory who do this:\s*(.*?)\s*\.?$/;

/**
 * `"Caps — paradigm_gate (exploratory: P 0.45 < 0.45); design_required_unsupported (…)"`.
 *
 * A cap *id* is not a value, so the invariant alone does not catch it once its
 * parenthetical is gone — and `Caps — paradigm_gate.` is still the inspector
 * naming an internal id on a decision surface. The caveat above has already
 * said which cap binds, in words, so this is §2.5 and §2.7 at once. Dropped
 * wherever engine prose is read, not only in the disclosure that first
 * noticed it.
 */
const CAPS_CLAUSE = /^\s*Caps\b/i;

/** Tidy after a strip: doubled spaces, a space before punctuation, a leading separator left behind. */
function tidy(text: string): string {
  return text
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([;,.])/g, "$1")
    .replace(/^[\s;,—–-]+/, "")
    .trim();
}

/**
 * The collaborator clause, with names where the profile has them.
 *
 * `engine/tier.ts`'s `collaboratorsIn` maps `.map((c) => c.id)`, so what
 * reaches this clause in production is `investigators.id` UUIDs — and
 * `Collaborator` carries a `name` the engine never uses. The engine is not
 * changed; the surface resolves the ids it is given against the profile it has
 * already loaded. **A clause that cannot name every collaborator it lists is
 * dropped**, never rendered with an id in it: "Collaborators in the directory
 * who do this: 8f2c…" tells a strategist nothing they can act on.
 */
function namedCollaborators(clause: string, collaborators: readonly Collaborator[] | null | undefined): string | null {
  const m = COLLABORATORS.exec(clause.trim());
  if (!m) return clause;
  const ids = (m[1] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!ids.length) return null;
  const byId = new Map((collaborators ?? []).map((c) => [c.id, c.name?.trim() || null]));
  const names = ids.map((id) => byId.get(id) ?? null);
  if (names.some((n) => !n)) return null;
  return `Collaborators in the directory who do this: ${names.join(", ")}.`;
}

/**
 * A list keeps its safe members.
 *
 * `gapSentences` writes `"; not in the evidence: <unmatched codes>, <notice
 * terms>"` — MeSH tree numbers and readable topic terms in one comma list, so
 * the clause is unsafe and the terms are the half worth keeping. Generic: it
 * is applied to whatever list a clause ends in, and returns `null` when
 * nothing readable survives.
 */
function pruneList(clause: string): string | null {
  const at = clause.lastIndexOf(": ");
  if (at < 0) return null;
  const head = clause.slice(0, at);
  const tail = clause.slice(at + 2).replace(/\.$/, "");
  const kept = tail
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !isEngineValueText(s));
  if (!kept.length || isEngineValueText(head)) return null;
  return `${head}: ${kept.join(", ")}.`;
}

export type PlainOptions = {
  /** The investigator's own collaborator records, for the one clause the engine writes as ids. */
  collaborators?: readonly Collaborator[] | null;
};

/**
 * Pure. **One clause of engine prose as a decision surface may render it**, or
 * `null` when it cannot be rendered at all.
 *
 * Rewrite, then prune, then check — and the check is the guarantee. A caller
 * that gets `null` has lost a clause, which is the intended outcome: §2.5's
 * complaint is that the inspector's numbers are on the decision surface, and a
 * half-stripped clause is that complaint with a smaller number in it.
 */
export function plainClause(clause: string, opts: PlainOptions = {}): string | null {
  if (CAPS_CLAUSE.test(clause)) return null;
  const named = namedCollaborators(clause, opts.collaborators);
  if (named === null) return null;
  if (AXIS_VALUE_ONLY.test(named)) return null;

  let out = named
    .replace(FLOOR_COMPARISON, "")
    .replace(AXIS_VALUE_PREFIX, "")
    .replace(AXIS_VALUE_IS, "")
    .replace(DESIGN_SHARE, "")
    .replace(DESIGN_SUPPORT, "$1 in the evidence")
    .replace(PARENTHETICAL, (p) => (isEngineValueText(p) ? "" : p));
  out = tidy(out);
  if (!hasWords(out)) return null;

  if (isEngineValueText(out)) {
    const pruned = pruneList(out);
    if (pruned === null || isEngineValueText(pruned)) return null;
    out = tidy(pruned);
    if (!hasWords(out)) return null;
  }

  const said = sentence(out);
  if (!said) return null;
  // Sentence-case, except where the clause opens on a taxonomy id. `taxonomy.json`
  // gives designs no display label, so `designGroupsClause` writes the id — and
  // capitalising it invents a word: "Rct | early_phase_trial required",
  // "Hybrid_effectiveness_implementation | implementation_evaluation required".
  return ID_HEAD.test(said) ? said : said[0]!.toUpperCase() + said.slice(1);
}

/** A design or method id at the head of a clause: an underscore-joined token, or the first arm of an `a | b` alternation. */
const ID_HEAD = /^[a-z0-9]+(?:_[a-z0-9]+)+|^[a-z0-9]+(?=\s\|\s)/;

/**
 * Pure. A whole engine paragraph as prose: split into the clauses the engine
 * joined, each made safe or dropped, and taken only while the paragraph still
 * reads at a glance.
 *
 * `max` is a display width, not a model threshold — §2.2's complaint is 50–90
 * words per row before anything actionable.
 */
export function plainClauses(text: string | null | undefined, opts: PlainOptions & { max?: number; limit?: number } = {}): string[] {
  const raw = text?.trim();
  if (!raw) return [];
  const parts = raw.includes(CLAUSE_SEPARATOR) ? raw.split(CLAUSE_SEPARATOR) : sentencesOf(raw);
  const out: string[] = [];
  let length = 0;
  for (const part of parts) {
    if (opts.limit !== undefined && out.length >= opts.limit) break;
    const clause = plainClause(part, opts);
    if (!clause) continue;
    if (opts.max !== undefined && out.length && length + clause.length + 1 > opts.max) break;
    out.push(clause);
    length += clause.length + 1;
  }
  return out;
}

/**
 * Pure. **The central guard.** Whatever a caller has composed, made safe.
 *
 * Every decision-surface field passes through this on its way out of
 * `fitVerdicts` and `verdictPanel`, so the invariant is a property of the
 * *composed* output rather than of each of the two dozen places a sentence is
 * written. A string that is already safe is returned untouched; one that is
 * not is re-read clause by clause, and the clauses that cannot be made safe
 * are dropped. `null` when nothing survives — a caller with a slot it must
 * fill supplies its own words, and one with a list drops the entry.
 */
export function plainOrNull(text: string | null | undefined, opts: PlainOptions = {}): string | null {
  const raw = text?.trim();
  if (!raw) return null;
  if (!isEngineValueText(raw)) return hasWords(raw) ? raw : null;
  const kept = plainClauses(raw, opts);
  const joined = kept.join(" ").trim();
  return joined && !isEngineValueText(joined) ? joined : null;
}
