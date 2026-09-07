/**
 * Topic masking for the blind pass (plan § PR 3.1 `judge/mask.ts`; spec §16
 * guardrail 3 "Topic-masked sub-pass": disease and topic terms in both the
 * evidence and the notice are replaced with placeholders before the model
 * judges paradigm, unit and design — "Ignoring what this is about, does this
 * person do the kind of research required?").
 *
 * What is masked: the item classifier's `topic.terms` and the MeSH descriptor
 * names on every evidence item, the notice's distinguishing `topic.terms`,
 * the descriptor names of its mapped MeSH codes and its RCDC categories — the
 * union, applied to every text on both sides. The placeholder follows the
 * descriptor's tree: diseases (C, F03) → [DISEASE]; chemicals, drugs and
 * biological processes (D, G) → [PATHWAY]; persons, population
 * characteristics and social groups (M01, N01, I) → [POPULATION]; anatomy,
 * behaviour and a term with no tree (a classifier term, an RCDC category) →
 * [TOPIC].
 *
 * What is never masked (spec §11 rule 3 "route paradigm words to the
 * paradigm axis"): organisms (B — mice, humans), techniques and study
 * designs (E — cohort studies, randomized controlled trials as topic),
 * health-care facilities and services (N02–N05), public-health methods
 * (N06, where Epidemiology lives), publication characteristics (V), the
 * check tags, and a short protected vocabulary of paradigm / design / unit
 * words a classifier term could coincide with (`PROTECTED_TERMS`). Losing a
 * paradigm word would blind the judgment the pass exists to make; a leaked
 * topic word is the lesser harm.
 *
 * Matching is whole-word, case-insensitive, over the term's spelling
 * variants: an inverted MeSH name in natural order ("Colitis, Ulcerative" →
 * "ulcerative colitis"), the possessive dropped, the plural and singular of
 * the last word, hyphen / space interchange between tokens. Longest term
 * first, so "Crohn disease" goes before "Crohn". Pure.
 */
import { dropPossessive, foldMeshName, pluralForms, singularForms } from "@/lib/fit/topic/notice-mesh";

export type MaskPlaceholder = "[DISEASE]" | "[PATHWAY]" | "[POPULATION]" | "[TOPIC]";

export type MaskTerm = { term: string; placeholder: MaskPlaceholder };

/** A descriptor as masking needs it: its name and tree numbers (a UI when known, for the never-mask set). */
export type MaskDescriptor = { name: string; tree_numbers: string[]; ui?: string };

export type MaskInput = {
  /** Free terms: the classifier's `topic.terms`, the notice's `topic.terms`, RCDC categories. */
  terms: string[];
  descriptors: MaskDescriptor[];
};

/** Terms shorter than this never mask (a stray "TB" or "IL" would shred the text). */
export const MIN_TERM_LENGTH = 3;

/** Check-tag UIs that are paradigm facts, never topic (Humans, Animals, Mice, Rats, Male, Female). */
export const NEVER_MASK_UIS: ReadonlySet<string> = new Set(["D006801", "D000818", "D051379", "D051381", "D008297", "D005260"]);

/**
 * Paradigm, design, unit and generic words a classifier term could coincide
 * with; never masked whatever tree they map to (spec §11 rule 3). Decision
 * (PR 3.1, kept in code — no taxonomy block defines it): the words the five
 * axes are read from, plus the generic nouns whose masking would only shred
 * sentences without hiding a topic.
 */
export const PROTECTED_TERMS: ReadonlySet<string> = new Set([
  "human",
  "humans",
  "patient",
  "patients",
  "participant",
  "participants",
  "subject",
  "subjects",
  "person",
  "persons",
  "people",
  "mouse",
  "mice",
  "murine",
  "rat",
  "rats",
  "animal",
  "animals",
  "cell",
  "cells",
  "tissue",
  "tissues",
  "in vivo",
  "in vitro",
  "trial",
  "trials",
  "clinical trial",
  "clinical trials",
  "randomized",
  "randomised",
  "cohort",
  "cohorts",
  "registry",
  "registries",
  "claims",
  "ehr",
  "electronic health records",
  "survey",
  "surveys",
  "population",
  "populations",
  "community",
  "communities",
  "health system",
  "health systems",
  "implementation",
  "clinical",
  "preclinical",
  "translational",
  "epidemiology",
  "epidemiologic",
  "epidemiological",
  "mechanistic",
  "mechanism",
  "mechanisms",
  "molecular",
  "biomarker",
  "biomarkers",
  "disease",
  "diseases",
  "health",
  "research",
  "study",
  "studies",
  "analysis",
  "outcomes",
  "risk",
  "care",
  "intervention",
  "interventions",
  "treatment",
  "treatments",
  "therapy",
  "therapies",
  "data",
  "model",
  "models",
  "genome",
  "genomic",
  "genomics",
  "male",
  "female",
]);

const PLACEHOLDER_ORDER: MaskPlaceholder[] = ["[DISEASE]", "[PATHWAY]", "[POPULATION]", "[TOPIC]"];

/** The placeholder one tree number asks for; null when its subtree is never masked. */
export function placeholderForTreeNumber(tree: string): MaskPlaceholder | null {
  const t = tree.trim().toUpperCase();
  if (!t) return null;
  const letter = t[0]!;
  const top = t.split(".")[0]!;
  switch (letter) {
    case "C":
      return "[DISEASE]";
    case "F":
      return top === "F03" ? "[DISEASE]" : "[TOPIC]";
    case "D":
    case "G":
      return "[PATHWAY]";
    case "A":
      return "[TOPIC]";
    case "I":
      return "[POPULATION]";
    case "M":
      return "[POPULATION]";
    case "N":
      return top === "N01" ? "[POPULATION]" : null;
    default:
      // B organisms, E techniques and designs, H disciplines, J technology, K humanities, L information science, V publication characteristics, Z geographic
      return null;
  }
}

/** The placeholder for a descriptor: the highest-priority placeholder any of its tree numbers asks for; null when none does or the descriptor is a never-mask check tag. */
export function placeholderForDescriptor(d: MaskDescriptor): MaskPlaceholder | null {
  if (d.ui && NEVER_MASK_UIS.has(d.ui)) return null;
  const asked = new Set<MaskPlaceholder>();
  for (const t of d.tree_numbers) {
    const p = placeholderForTreeNumber(t);
    if (p) asked.add(p);
  }
  return PLACEHOLDER_ORDER.find((p) => asked.has(p)) ?? null;
}

/** "Colitis, Ulcerative" → "ulcerative colitis"; a name without a comma is returned folded. */
export function naturalOrder(name: string): string {
  const folded = foldMeshName(name);
  const parts = folded.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return folded;
  return [...parts.slice(1).reverse(), parts[0]!].join(" ");
}

/** Every spelling a term is matched under: folded, natural order, possessive dropped, plural / singular of the last word. Deduplicated, protected and short forms removed. */
export function termVariants(term: string): string[] {
  const out = new Set<string>();
  const add = (s: string) => {
    const v = s.replace(/\s+/g, " ").trim();
    if (v.length >= MIN_TERM_LENGTH && !PROTECTED_TERMS.has(v)) out.add(v);
  };
  const base = foldMeshName(term);
  if (!base || base.length < MIN_TERM_LENGTH) return [];
  const roots = [base, naturalOrder(term), dropPossessive(base), dropPossessive(naturalOrder(term))];
  // A protected word in any of its spellings protects the whole term ("Humans" is never masked because "human" is).
  if (roots.some((r) => PROTECTED_TERMS.has(r) || singularForms(r).some((x) => PROTECTED_TERMS.has(x)))) return [];
  for (const form of new Set(roots)) {
    add(form);
    for (const p of pluralForms(form)) add(p);
    for (const s of singularForms(form)) add(s);
  }
  return Array.from(out);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A whole-word, case-insensitive regex for one variant; tokens may be joined by spaces or hyphens in the text. */
export function variantRegex(variant: string): RegExp {
  const tokens = variant.split(/[\s-]+/).filter(Boolean).map(escape);
  return new RegExp(`(?<![A-Za-z0-9])${tokens.join("[\\s\\-‐-―−]+")}(?![A-Za-z0-9])`, "gi");
}

/**
 * Pure. The mask terms for a set of inputs: every free term at [TOPIC] unless
 * a descriptor of the same folded name says otherwise, every descriptor at
 * its tree's placeholder; longest first so a longer phrase is replaced before
 * a word inside it.
 */
export function buildMask(input: MaskInput): MaskTerm[] {
  const byTerm = new Map<string, MaskPlaceholder>();
  const put = (term: string, placeholder: MaskPlaceholder) => {
    for (const v of termVariants(term)) {
      const existing = byTerm.get(v);
      if (!existing || PLACEHOLDER_ORDER.indexOf(placeholder) < PLACEHOLDER_ORDER.indexOf(existing)) byTerm.set(v, placeholder);
    }
  };
  const descriptorByName = new Map<string, MaskPlaceholder | null>();
  for (const d of input.descriptors) {
    const p = placeholderForDescriptor(d);
    descriptorByName.set(foldMeshName(d.name), p);
    descriptorByName.set(naturalOrder(d.name), p);
    if (p) put(d.name, p);
  }
  for (const term of input.terms) {
    const folded = foldMeshName(term);
    if (!folded) continue;
    const known = descriptorByName.get(folded);
    if (known === null) continue; // a descriptor in a never-mask subtree
    put(term, known ?? "[TOPIC]");
  }
  return Array.from(byTerm.entries())
    .map(([term, placeholder]) => ({ term, placeholder }))
    .sort((a, b) => b.term.length - a.term.length || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0));
}

export type MaskedText = { text: string; masked: string[] };

/** Pure. Replace every mask term in `text` with its placeholder; `masked` lists the terms that were found, in mask order. */
export function maskText(text: string, mask: readonly MaskTerm[]): MaskedText {
  let out = text;
  const masked: string[] = [];
  for (const m of mask) {
    const re = variantRegex(m.term);
    if (!re.test(out)) continue;
    re.lastIndex = 0;
    out = out.replace(re, m.placeholder);
    masked.push(m.term);
  }
  // Collapse runs the replacement can leave behind ("[DISEASE] [DISEASE]", "[DISEASE]-[PATHWAY]" keep their shape; only exact repeats collapse).
  out = out.replace(/(\[(?:DISEASE|PATHWAY|POPULATION|TOPIC)\])(?:[\s,;/]+\1)+/g, "$1");
  return { text: out, masked };
}

/** Pure. The mask terms still present in `text` — the leak check the tests and the dry run print. */
export function maskLeaks(text: string, mask: readonly MaskTerm[]): string[] {
  return mask.filter((m) => variantRegex(m.term).test(text)).map((m) => m.term);
}
