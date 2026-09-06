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
 * denominator of depth(c) · idf(c), so Neoplasms (C04, depth 1) is worth
 * little and Cholangiocarcinoma (depth 6) decisive, and a notice code the
 * investigator covers exactly or more specifically counts in full. RCDC
 * categories match by name at depth 1 and carry their IDF only. A depth ≥
 * `min_specific_depth_for_strong` match is what the Strong topic floor
 * needs.
 *
 * Embedding similarity is the mean of the top `embedding_top_k` cosines
 * between the notice's topic text and the *compatible* evidence items,
 * rescaled from the `embedding_rescale` band — per item, never the career
 * vector (§11 rule 4). BM25 runs the notice's distinguishing terms
 * (`topic.terms`, tokenized here) against the compatible items' term
 * counts, each item's score normalized by the ideal score so it sits in
 * [0, 1], then the same top-k mean. Both take precomputed inputs from
 * `ctx.topic`; a missing input is a 0 term, never an error.
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

/** Lower-case alphanumeric tokens of two or more characters. PR 2.2 must build `TopicItemInput.tf` with this. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
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
};

export function codedOverlap(inv: ProfileTopic, opp: OpportunityTopic, idf: IdfTable): CodedOverlap {
  const idfOf = (code: string) => lookupNumber(idf.weights, code, idf.unknown);
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
    den += parts.length * idfOf(c);
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
    den += w;
    if (invRcdc.has(key)) {
      num += w;
      matches.push({ code: raw, depth: 1 });
    } else unmatched.push(raw);
  }

  const minDepth = topicWeights().min_specific_depth_for_strong;
  const max_depth = matches.reduce((m, x) => Math.max(m, x.depth), 0);
  return { score: den > 0 ? clamp01(num / den) : 0, matches, unmatched, specific: max_depth >= minDepth, max_depth };
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
};

export function topic(inv: InvestigatorFitProfile, opp: OpportunityFitProfile, ctx: ScoreContext, ud: { U: number; D: number }): TopicResult {
  const coded = codedOverlap(inv.topic, opp.topic, ctx.topic.idf);
  const compatible = compatibleItems(ctx.topic.items, opp, ud);
  const ids = compatible.map((i) => i.id);
  if (ctx.topic.override !== null) {
    return { T: clamp01(ctx.topic.override), coded, embedding: NONE, bm25: NONE, compatible: ids, top_items: [], overridden: true };
  }
  const embedding = embeddingSimilarity(compatible);
  const bm25 = bm25Similarity(compatible, opp.topic.terms.flatMap(tokenize), ctx.topic.bm25);
  const w = topicWeights();
  const T = w.w_coded * coded.score + w.w_embedding * embedding.score + w.w_bm25 * bm25.score;
  return { T, coded, embedding, bm25, compatible: ids, top_items: uniq([...embedding.top.map((x) => x.id), ...bm25.top.map((x) => x.id)]), overridden: false };
}
