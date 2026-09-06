/**
 * Notice MeSH codes from the extractor's topic terms (plan § PR 2.2).
 *
 * PR 1.5's opportunity profile stores `topic.terms` (the extractor's
 * distinguishing terms, diseases and biological processes, merged) and
 * `topic.rcdc` (the funded exemplars' RCDC categories) but leaves
 * `topic.mesh` empty, which makes the coded-overlap half of T zero for every
 * pair and Strong unreachable (spec §11 rule 1: a Strong topic score needs a
 * coded match at depth ≥ 3). This module maps those names to descriptors by
 * folded name — exact, then the singular / plural form, then with a
 * possessive dropped ("Alzheimer's disease" → Alzheimer Disease) — and
 * returns the descriptors' tree numbers. No fuzzy matching, no entry terms
 * (`mesh_descriptors` holds descriptor names only), no model: a term the
 * vocabulary does not spell exactly that way stays unmapped and is reported.
 *
 * Depth guard: a match is kept only when the descriptor has a tree number at
 * depth ≥ `compose.topic.min_specific_depth_for_strong` — a broad term ("lung"
 * is A04.411, "neoplasms" C04) names an organ or a field, not a topic, and
 * would credit every investigator under it; such a term is reported as
 * unmapped with reason `shallow`.
 *
 * Pure given a name → descriptor map (`buildMeshNameIndex` over the PR 1.4
 * descriptor index). The service applies it at load (`withNoticeMesh`) so
 * the stored row stays the extractor's output and a descriptor reload
 * changes every notice at once.
 */
import type { MeshDescriptorRow, MeshIndex } from "@/lib/fit/classify/mesh";
import { topicWeights } from "@/lib/fit/taxonomy";
import type { OpportunityFitProfile } from "@/lib/fit/types";

export type MeshNameEntry = Pick<MeshDescriptorRow, "ui" | "name" | "tree_numbers">;

/** Folded descriptor name → descriptor. */
export type MeshNameIndex = Map<string, MeshNameEntry>;

/** Lower-cased, whitespace-collapsed, typographic quotes and dashes folded, surrounding punctuation dropped. */
export function foldMeshName(s: string): string {
  return s
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s"'.,;:()]+|[\s"'.,;:()]+$/g, "");
}

/** The folded name with possessives removed ("alzheimer's disease" → "alzheimer disease", "parkinsons disease" untouched). */
export function dropPossessive(folded: string): string {
  return folded.replace(/'s\b/g, "").replace(/s'\s/g, "s ").replace(/\s+/g, " ").trim();
}

const VOWELS = new Set(["a", "e", "i", "o", "u"]);

/** Plural spellings of a folded name's last word: cancer → cancers; virus → viruses; therapy → therapies. */
export function pluralForms(folded: string): string[] {
  const m = /^(.*?)([a-z]+)$/.exec(folded);
  if (!m) return [];
  const head = m[1]!;
  const word = m[2]!;
  const out: string[] = [];
  if (/(s|x|z|ch|sh)$/.test(word)) out.push(`${head}${word}es`);
  else if (/y$/.test(word) && word.length > 1 && !VOWELS.has(word[word.length - 2]!)) out.push(`${head}${word.slice(0, -1)}ies`);
  else out.push(`${head}${word}s`);
  return out;
}

/** Singular spellings of a folded name's last word: neoplasms → neoplasm; viruses → virus (and viruse); therapies → therapy. */
export function singularForms(folded: string): string[] {
  const m = /^(.*?)([a-z]+)$/.exec(folded);
  if (!m) return [];
  const head = m[1]!;
  const word = m[2]!;
  const out: string[] = [];
  if (/ies$/.test(word) && word.length > 3) return [`${head}${word.slice(0, -3)}y`];
  if (/(ses|xes|zes|ches|shes)$/.test(word) && word.length > 3) out.push(`${head}${word.slice(0, -2)}`);
  if (/s$/.test(word) && !/ss$/.test(word) && word.length > 1) out.push(`${head}${word.slice(0, -1)}`);
  return Array.from(new Set(out));
}

/** Folded descriptor name → descriptor, over the PR 1.4 index (or any list of rows). */
export function buildMeshNameIndex(index: Pick<MeshIndex, "byName"> | { rows: MeshNameEntry[] }): MeshNameIndex {
  const out: MeshNameIndex = new Map();
  const rows: Iterable<MeshNameEntry> = "rows" in index ? index.rows : index.byName.values();
  for (const row of rows) {
    const key = foldMeshName(row.name);
    if (key && !out.has(key)) out.set(key, { ui: row.ui, name: row.name, tree_numbers: row.tree_numbers });
  }
  return out;
}

export type NoticeMeshVia = "exact" | "plural" | "singular" | "possessive";
export type NoticeMeshSource = "term" | "rcdc";

export type NoticeMeshMatch = {
  term: string;
  source: NoticeMeshSource;
  via: NoticeMeshVia;
  ui: string;
  name: string;
  tree_numbers: string[];
};

/** Why a term stayed unmapped: no descriptor spells it, or the descriptor is above the specific depth. */
export type NoticeMeshUnmappedReason = "unknown" | "shallow";

export type NoticeMeshResult = {
  /** Distinct tree numbers of every matched descriptor, in match order. */
  mesh: string[];
  matches: NoticeMeshMatch[];
  unmapped: Array<{ term: string; source: NoticeMeshSource; reason: NoticeMeshUnmappedReason }>;
};

/** The depth of a MeSH tree number: C04 → 1, C04.557 → 2, C04.557.470 → 3. */
export const treeDepth = (t: string) => t.split(".").length;

/** A descriptor is specific enough to be a topic when one of its tree numbers is at depth ≥ `compose.topic.min_specific_depth_for_strong`. */
export function isSpecificDescriptor(entry: Pick<MeshNameEntry, "tree_numbers">): boolean {
  const min = topicWeights().min_specific_depth_for_strong;
  return entry.tree_numbers.some((t) => treeDepth(t) >= min);
}

/** One name against the index: exact, then plural, then singular, then the same three with the possessive dropped. */
export function lookupMeshName(name: string, names: MeshNameIndex): { entry: MeshNameEntry; via: NoticeMeshVia } | null {
  const folded = foldMeshName(name);
  if (!folded) return null;
  const tryForms = (base: string, possessive: boolean): { entry: MeshNameEntry; via: NoticeMeshVia } | null => {
    const exact = names.get(base);
    if (exact) return { entry: exact, via: possessive ? "possessive" : "exact" };
    for (const p of pluralForms(base)) {
      const hit = names.get(p);
      if (hit) return { entry: hit, via: possessive ? "possessive" : "plural" };
    }
    for (const s of singularForms(base)) {
      const hit = names.get(s);
      if (hit) return { entry: hit, via: possessive ? "possessive" : "singular" };
    }
    return null;
  };
  const direct = tryForms(folded, false);
  if (direct) return direct;
  const noPossessive = dropPossessive(folded);
  return noPossessive !== folded ? tryForms(noPossessive, true) : null;
}

/** Map a notice's topic terms and RCDC names to MeSH tree numbers, descriptors at the specific depth only (`isSpecificDescriptor`). Pure. */
export function mapNoticeMesh(topic: { terms: readonly string[]; rcdc: readonly string[] }, names: MeshNameIndex): NoticeMeshResult {
  const matches: NoticeMeshMatch[] = [];
  const unmapped: NoticeMeshResult["unmapped"] = [];
  const seenTerm = new Set<string>();
  const mesh: string[] = [];
  const seenTree = new Set<string>();
  const consider = (term: string, source: NoticeMeshSource) => {
    const key = `${source}:${foldMeshName(term)}`;
    if (!foldMeshName(term) || seenTerm.has(key)) return;
    seenTerm.add(key);
    const hit = lookupMeshName(term, names);
    if (!hit) {
      unmapped.push({ term, source, reason: "unknown" });
      return;
    }
    if (!isSpecificDescriptor(hit.entry)) {
      unmapped.push({ term, source, reason: "shallow" });
      return;
    }
    matches.push({ term, source, via: hit.via, ui: hit.entry.ui, name: hit.entry.name, tree_numbers: [...hit.entry.tree_numbers] });
    for (const t of hit.entry.tree_numbers) {
      if (!seenTree.has(t)) {
        seenTree.add(t);
        mesh.push(t);
      }
    }
  };
  for (const t of topic.terms) consider(t, "term");
  for (const r of topic.rcdc) consider(r, "rcdc");
  return { mesh, matches, unmapped };
}

/** The profile with `topic.mesh` filled from its terms and RCDC names when the stored row left it empty; a row that already carries codes is returned as is. */
export function withNoticeMesh<T extends Pick<OpportunityFitProfile, "topic">>(profile: T, names: MeshNameIndex): T {
  if (profile.topic.mesh.length > 0) return profile;
  const mapped = mapNoticeMesh(profile.topic, names);
  if (!mapped.mesh.length) return profile;
  return { ...profile, topic: { ...profile.topic, mesh: mapped.mesh } };
}
