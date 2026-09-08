/**
 * Stage 5 · scientific-topic alignment score (spec §7 stage 5; §11).
 *
 *   T = w_coded · coded + w_embedding · embedding + w_bm25 · bm25
 *   (weights and parameters from `compose.topic`)
 *
 * Coded overlap compares the notice's MeSH tree numbers and RCDC categories
 * with the investigator's, weighted by tree depth and inverse document
 * frequency over the notice corpus (§11 rules 1–2). For each notice tree
 * number c the deepest common prefix with any investigator tree number is
 * the matched ancestor a; c contributes depth(a) · idf(a) against a
 * denominator of max(depth(c), `min_specific_depth_for_strong`) · idf(c),
 * so Neoplasms (C04, depth 1) is worth little and Cholangiocarcinoma (depth
 * 6) decisive, a notice code at the Strong depth or deeper that the
 * investigator covers exactly or more specifically counts in full, and a
 * notice whose codes are all shallower than the Strong depth tops out at
 * depth / `min_specific_depth_for_strong` (a C04-only notice at 1/3). RCDC
 * categories match by name at depth 1 and carry their IDF only, against
 * the same denominator. A depth ≥ `min_specific_depth_for_strong` match is
 * what the Strong topic floor needs.
 *
 * Embedding similarity is the mean of the top `embedding_top_k` cosines
 * between the notice's topic text and the *compatible* evidence items,
 * rescaled from the `embedding_rescale` band — per item, never the career
 * vector (§11 rule 4). BM25 runs the notice's distinguishing terms
 * (`topic.terms`, tokenized here) against the compatible items' term
 * counts, each item's score normalized by the ideal score so it sits in
 * [0, 1], then the same top-k mean. Both take precomputed inputs from
 * `ctx.topic`; a missing input is never an error.
 *
 * A term whose input is *absent* is left out of the composition and its
 * weight redistributed over the terms that have one — the notice named no
 * MeSH code or RCDC category, no compatible item carried a cosine, or none
 * carried text against a notice that named query terms. Absence is not
 * evidence of a mismatch, and scoring it as a zero is the difference between
 * "this investigator's science is unrelated" and "the notice says nothing to
 * compare against"; the other axes already say so out loud (a notice naming
 * no unit requirement scores U = 1 with a flag, not U = 0). On the
 * 2026-09-07 corpus 149 of 436 notices carried no code at all, and the 19,229
 * pairs on them could not exceed T = 0.278 against an Exploratory floor of
 * 0.35 — a third of the directory invisible for want of a denominator. Every
 * term present is the ordinary case and composes exactly as before. This
 * cannot inflate Strong: `tiers.strong.T_specific_depth` requires a coded
 * match at depth ≥ 3, which a notice with no codes can never supply.
 *
 * Compatible items are those whose paradigm passes the stage-2 formula at
 * `paradigm.gates.poor_below` and whose designs pass `designCompatible`
 * (stage 4) for this notice.
 */
import { paradigmGates, topicWeights } from "@/lib/fit/taxonomy";
import type { Bm25Stats, CodedTopicMatch, IdfTable, InvestigatorFitProfile, OpportunityFitProfile, OpportunityTopic, ProfileTopic, ScoreContext, TopicItemInput } from "@/lib/fit/types";
import { designCompatible } from "@/lib/fit/engine/design";
import { paradigmSupport } from "@/lib/fit/engine/paradigm";
import { clamp01, foldName, lookupNumber, uniq } from "@/lib/fit/engine/util";

/** Decision (PR 2.1, kept in code): a BM25 token is two or more characters — one-letter fragments ("t" of "t-cell") carry nothing; the term list itself comes from the notice profile. */
const MIN_TOKEN_LENGTH = 2;

/** Lower-case alphanumeric tokens of `MIN_TOKEN_LENGTH` or more characters. PR 2.2 must build `TopicItemInput.tf` with this. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= MIN_TOKEN_LENGTH);
}

/** The MeSH tree number at the start of a code ("C04.557.470 Bile Duct Neoplasms" → "C04.557.470"); null when there is none. */
export function meshTreeNumber(code: string): string | null {
  const m = /^[A-Z]\d{2}(?:\.\d{3})*/.exec(code.trim());
  return m ? m[0] : null;
}

/** Tree depth = number of dot-separated components (C04 → 1; C04.557.470.200.025.390 → 6) (§11 rule 1). */
export function meshDepth(tree: string): number {
  return tree.split(".").length;
}

function commonPrefixDepth(a: string[], b: string[]): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

export type CodedOverlap = {
  score: number;
  /** One entry per matched notice code: the matched ancestor and its depth. */
  matches: CodedTopicMatch[];
  /** Notice codes with no match — for the gap sentence. */
  unmatched: string[];
  /** A match at depth ≥ `compose.topic.min_specific_depth_for_strong`. */
  specific: boolean;
  max_depth: number;
  /** The notice named codes at all, so `score` is a measurement. False: nothing to compare against. */
  scored: boolean;
};

export function codedOverlap(inv: ProfileTopic, opp: OpportunityTopic, idf: IdfTable): CodedOverlap {
  const idfOf = (code: string) => lookupNumber(idf.weights, code, idf.unknown);
  const minDepth = topicWeights().min_specific_depth_for_strong;
  /** A notice code's slot: its depth, but never less than the Strong depth, so shallow codes cannot fill the score. */
  const slot = (depth: number) => Math.max(depth, minDepth);
  const invMesh = uniq(inv.mesh_major.map(meshTreeNumber).filter((c): c is string => c !== null)).map((c) => c.split("."));
  const invRcdc = new Set(inv.rcdc.map(foldName));
  const matches: CodedTopicMatch[] = [];
  const unmatched: string[] = [];
  let num = 0;
  let den = 0;

  for (const raw of uniq(opp.mesh)) {
    const c = meshTreeNumber(raw);
    if (!c) continue;
    const parts = c.split(".");
    den += slot(parts.length) * idfOf(c);
    let bestDepth = 0;
    for (const i of invMesh) bestDepth = Math.max(bestDepth, commonPrefixDepth(parts, i));
    if (bestDepth > 0) {
      const anc = parts.slice(0, bestDepth).join(".");
      num += bestDepth * idfOf(anc);
      matches.push({ code: anc, depth: bestDepth });
    } else unmatched.push(c);
  }
  for (const raw of uniq(opp.rcdc)) {
    const key = foldName(raw);
    if (!key) continue;
    const w = idfOf(raw);
    den += slot(1) * w;
    if (invRcdc.has(key)) {
      num += w;
      matches.push({ code: raw, depth: 1 });
    } else unmatched.push(raw);
  }

  const max_depth = matches.reduce((m, x) => Math.max(m, x.depth), 0);
  return { score: den > 0 ? clamp01(num / den) : 0, matches, unmatched, specific: max_depth >= minDepth, max_depth, scored: den > 0 };
}

export type TopKScore = { score: number; top: Array<{ id: string; value: number }> };

const NONE: TopKScore = { score: 0, top: [] };

function topK<T extends { id: string; value: number }>(xs: T[], k: number): T[] {
  return [...xs].sort((a, b) => b.value - a.value || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, Math.max(0, k));
}

/** Mean of the top-k item cosines, rescaled from `embedding_rescale` and clamped to [0, 1]. */
export function embeddingSimilarity(items: readonly TopicItemInput[]): TopKScore {
  const p = topicWeights();
  const lo = p.embedding_rescale[0];
  const hi = p.embedding_rescale[1];
  const top = topK(
    items.filter((i) => i.cosine !== null).map((i) => ({ id: i.id, value: i.cosine as number })),
    p.embedding_top_k
  );
  if (!top.length || !(hi > lo)) return NONE;
  const mean = top.reduce((s, x) => s + x.value, 0) / top.length;
  return { score: clamp01((mean - lo) / (hi - lo)), top };
}

/** Per-item BM25 of the query terms, normalized by the ideal (every term saturated) score. Items without text are skipped. */
export function bm25Scores(items: readonly TopicItemInput[], queryTerms: readonly string[], stats: Bm25Stats): Array<{ id: string; value: number }> {
  const terms = uniq(queryTerms);
  if (!terms.length) return [];
  const idfT = (t: string) => {
    const df = lookupNumber(stats.doc_freq, t, 0);
    return Math.log(1 + Math.max(0, (stats.doc_count - df + 0.5) / (df + 0.5)));
  };
  const ideal = terms.reduce((s, t) => s + idfT(t) * (stats.k1 + 1), 0);
  if (!(ideal > 0)) return [];
  const out: Array<{ id: string; value: number }> = [];
  for (const item of items) {
    if (!item.tf) continue;
    const lengthNorm = stats.k1 * (1 - stats.b + stats.b * (stats.avg_doc_length > 0 ? item.length / stats.avg_doc_length : 1));
    let s = 0;
    for (const t of terms) {
      const tf = lookupNumber(item.tf, t, 0);
      if (tf > 0) s += (idfT(t) * tf * (stats.k1 + 1)) / (tf + lengthNorm);
    }
    out.push({ id: item.id, value: clamp01(s / ideal) });
  }
  return out;
}

/** Mean of the top-k normalized BM25 scores. */
export function bm25Similarity(items: readonly TopicItemInput[], queryTerms: readonly string[], stats: Bm25Stats | null): TopKScore {
  if (!stats) return NONE;
  const top = topK(bm25Scores(items, queryTerms, stats), topicWeights().embedding_top_k);
  if (!top.length) return NONE;
  return { score: top.reduce((s, x) => s + x.value, 0) / top.length, top };
}

/** The evidence items whose paradigm and design are compatible with the notice (§7 stage 5 "compatible-only"). */
export function compatibleItems(items: readonly TopicItemInput[], opp: OpportunityFitProfile, ud: { U: number; D: number }): TopicItemInput[] {
  const gate = paradigmGates().poor_below;
  return items.filter((it) => paradigmSupport(it.paradigm, opp, ud).P >= gate && designCompatible(it.design, opp));
}

export type TopicResult = {
  T: number;
  coded: CodedOverlap;
  embedding: TopKScore;
  bm25: TopKScore;
  /** Ids of the compatible items. */
  compatible: string[];
  /** The items that carried the embedding and BM25 terms, best first. */
  top_items: string[];
  /** T was supplied through `ctx.topic.override`. */
  overridden: boolean;
  /** Terms with no input at all, left out of the composition and their weight redistributed. */
  absent: TopicTerm[];
};

export type TopicTerm = "coded" | "embedding" | "bm25";

export function topic(inv: InvestigatorFitProfile, opp: OpportunityFitProfile, ctx: ScoreContext, ud: { U: number; D: number }): TopicResult {
  const coded = codedOverlap(inv.topic, opp.topic, ctx.topic.idf);
  const compatible = compatibleItems(ctx.topic.items, opp, ud);
  const ids = compatible.map((i) => i.id);
  if (ctx.topic.override !== null) {
    return { T: clamp01(ctx.topic.override), coded, embedding: NONE, bm25: NONE, compatible: ids, top_items: [], overridden: true, absent: [] };
  }
  const embedding = embeddingSimilarity(compatible);
  const bm25 = bm25Similarity(compatible, opp.topic.terms.flatMap(tokenize), ctx.topic.bm25);
  const w = topicWeights();
  const terms: Array<{ id: TopicTerm; weight: number; score: number; present: boolean }> = [
    // A term is *present* when something was there to compare: the notice named codes; an item
    // carried a cosine; an item carried text and the notice named query terms. Present-and-zero is
    // a real measurement of dissimilarity and stays a zero.
    { id: "coded", weight: w.w_coded, score: coded.score, present: coded.scored },
    { id: "embedding", weight: w.w_embedding, score: embedding.score, present: embedding.top.length > 0 },
    { id: "bm25", weight: w.w_bm25, score: bm25.score, present: bm25.top.length > 0 },
  ];
  const denominator = terms.reduce((s, t) => s + (t.present ? t.weight : 0), 0);
  const T = denominator > 0 ? terms.reduce((s, t) => s + (t.present ? t.weight * t.score : 0), 0) / denominator : 0;
  return { T, coded, embedding, bm25, compatible: ids, top_items: uniq([...embedding.top.map((x) => x.id), ...bm25.top.map((x) => x.id)]), overridden: false, absent: terms.filter((t) => !t.present).map((t) => t.id) };
}
