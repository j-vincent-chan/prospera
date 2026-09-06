import { describe, expect, it } from "vitest";
import { bm25Scores, bm25Similarity, codedOverlap, compatibleItems, embeddingSimilarity, meshDepth, meshTreeNumber, tokenize, topic } from "@/lib/fit/engine/topic";
import { hydrateContext, hydrateInvestigator, hydrateOpportunity, type FixtureOpportunity } from "@/lib/fit/engine/fixtures";
import { topicWeights } from "@/lib/fit/taxonomy";
import type { Bm25Stats, IdfTable, TopicItemInput } from "@/lib/fit/types";

const opp = (fx: FixtureOpportunity) => hydrateOpportunity("o", fx);
const item = (id: string, over: Partial<TopicItemInput> = {}): TopicItemInput => ({ id, paradigm: {}, design: {}, cosine: null, tf: null, length: 0, ...over });
const idf = (weights: Record<string, number>, unknown = 1): IdfTable => ({ weights, unknown });
const P = topicWeights();

describe("stage 5 · topic (§7 stage 5; §11)", () => {
  it("tokenize, meshTreeNumber and meshDepth", () => {
    expect(tokenize("CRISPR-Cas9 T-cell exhaustion, 2024!")).toEqual(["crispr", "cas9", "cell", "exhaustion", "2024"]);
    expect(meshTreeNumber("C04.557.470 Bile Duct Neoplasms")).toBe("C04.557.470");
    expect(meshTreeNumber(" C04 ")).toBe("C04");
    expect(meshTreeNumber("Cancer")).toBeNull();
    expect(meshDepth("C04")).toBe(1);
    expect(meshDepth("C04.557.470.200.025.390")).toBe(6);
  });

  it("coded overlap credits the deepest common ancestor, weighted by depth and IDF, against the notice's own weight", () => {
    // notice C04.557.470 (depth 3, idf 2) matched in full by the investigator's deeper C04.557.470.200.025.390 → 3 · 2 = 6
    // notice C06 (depth 1, idf 1) unmatched; its slot is the Strong depth 3 · 1 → denominator 6 + 3 = 9 → 6 / 9
    const r = codedOverlap({ mesh_major: ["C04.557.470.200.025.390"], rcdc: [], free_text: null }, { mesh: ["C04.557.470", "C06"], rcdc: [], terms: [], free_text: null }, idf({ "C04.557.470": 2, C06: 1 }));
    expect(r.score).toBeCloseTo(6 / 9, 10);
    expect(r.matches).toEqual([{ code: "C04.557.470", depth: 3 }]);
    expect(r.unmatched).toEqual(["C06"]);
    expect(r.specific).toBe(true);
    expect(r.max_depth).toBe(3);
  });

  it("a notice code's slot is never shallower than the Strong depth: a C04-only notice tops out at 1 / min_specific_depth_for_strong; a deep code is unchanged", () => {
    const only = (code: string, inv: string) => codedOverlap({ mesh_major: [inv], rcdc: [], free_text: null }, { mesh: [code], rcdc: [], terms: [], free_text: null }, idf({}));
    expect(P.min_specific_depth_for_strong).toBe(3);
    expect(only("C04", "C04").score).toBeCloseTo(1 / 3, 10);
    expect(only("C04", "C04.557.470").score).toBeCloseTo(1 / 3, 10);
    expect(only("C04.557", "C04.557").score).toBeCloseTo(2 / 3, 10);
    expect(only("C04.557.470", "C04.557.470").score).toBe(1);
    expect(only("C04.557.470.200.025.390", "C04.557.470.200.025.390").score).toBe(1);
    expect(only("C04.557.470.200.025.390", "C04.557.470").score).toBeCloseTo(3 / 6, 10);
    // an exact RCDC match fills a Strong-depth slot the same way
    const rcdc = codedOverlap({ mesh_major: [], rcdc: ["Cancer"], free_text: null }, { mesh: [], rcdc: ["Cancer"], terms: [], free_text: null }, idf({}));
    expect(rcdc.score).toBeCloseTo(1 / 3, 10);
    expect(rcdc.specific).toBe(false);
  });

  it("a shallower investigator code earns the ancestor's share only, and is not specific under the Strong depth", () => {
    // investigator C04.557 vs notice C04.557.470.200.025.390, every idf 1: ancestor depth 2 → 2 / 6
    const r = codedOverlap({ mesh_major: ["C04.557"], rcdc: [], free_text: null }, { mesh: ["C04.557.470.200.025.390"], rcdc: [], terms: [], free_text: null }, idf({}));
    expect(r.score).toBeCloseTo(2 / 6, 10);
    expect(r.matches).toEqual([{ code: "C04.557", depth: 2 }]);
    expect(r.specific).toBe(P.min_specific_depth_for_strong <= 2);
    // a generic shared root is worth little: C04 vs C06 share nothing; C04.1 vs C04.2 share C04 at depth 1
    const root = codedOverlap({ mesh_major: ["C04.588"], rcdc: [], free_text: null }, { mesh: ["C04.557.470"], rcdc: [], terms: [], free_text: null }, idf({ C04: 0.1, "C04.557.470": 3 }));
    expect(root.score).toBeCloseTo((1 * 0.1) / (3 * 3), 10);
  });

  it("RCDC categories match by folded name at depth 1 with their IDF; a missing code takes the table's unknown weight", () => {
    // " cancer" (idf unknown 0.1) matched → 0.1 over slots 3 · 0.1 + 3 · 2 = 6.3
    const r = codedOverlap({ mesh_major: [], rcdc: ["Cancer"], free_text: null }, { mesh: [], rcdc: [" cancer", "Genetics"], terms: [], free_text: null }, idf({ Genetics: 2 }, 0.1));
    expect(r.score).toBeCloseTo(0.1 / 6.3, 10);
    expect(r.matches).toEqual([{ code: " cancer", depth: 1 }]);
    expect(r.unmatched).toEqual(["Genetics"]);
    expect(r.specific).toBe(false);
  });

  it("a notice with no codes scores 0; an inverted IDF table is clamped to 1", () => {
    expect(codedOverlap({ mesh_major: ["C04"], rcdc: ["Cancer"], free_text: null }, { mesh: [], rcdc: [], terms: [], free_text: null }, idf({})).score).toBe(0);
    const r = codedOverlap({ mesh_major: ["C04.557"], rcdc: [], free_text: null }, { mesh: ["C04.557.470"], rcdc: [], terms: [], free_text: null }, idf({ "C04.557": 10, "C04.557.470": 1 }));
    expect(r.score).toBe(1);
  });

  it("embedding: mean of the top-k cosines rescaled from the band", () => {
    const [lo, hi] = P.embedding_rescale;
    const items = [item("a", { cosine: 0.65 }), item("b", { cosine: 0.5 }), item("c", { cosine: 0.35 }), item("d", { cosine: 0.2 }), item("e", { cosine: null })];
    const r = embeddingSimilarity(items);
    expect(r.top.map((x) => x.id)).toEqual(["a", "b", "c"].slice(0, P.embedding_top_k));
    const mean = r.top.reduce((s, x) => s + x.value, 0) / r.top.length;
    expect(r.score).toBeCloseTo((mean - lo) / (hi - lo), 10);
    expect(embeddingSimilarity([item("a", { cosine: hi })]).score).toBe(1);
    expect(embeddingSimilarity([item("a", { cosine: lo - 0.1 })]).score).toBe(0);
    expect(embeddingSimilarity([item("e", { cosine: null })]).score).toBe(0);
    expect(embeddingSimilarity([])).toEqual({ score: 0, top: [] });
  });

  it("BM25: normalized by the ideal score; k1 = 1.2, b = 0.75 come from the caller", () => {
    // idf(crispr) = ln(1 + (10 − 1 + 0.5) / (1 + 0.5)) = ln(7.3333); item tf 2 at average length:
    // score = idf · 2 · 2.2 / (2 + 1.2 · (1 − 0.75 + 0.75 · 1)) = idf · 4.4 / 3.2; ideal = idf · 2.2 → 0.625
    const stats: Bm25Stats = { k1: 1.2, b: 0.75, avg_doc_length: 10, doc_count: 10, doc_freq: { crispr: 1 } };
    const scored = bm25Scores([item("a", { tf: { crispr: 2 }, length: 10 }), item("b", { tf: { mouse: 3 }, length: 10 }), item("c")], ["crispr"], stats);
    expect(scored).toEqual([
      { id: "a", value: expect.closeTo(0.625, 10) },
      { id: "b", value: 0 },
    ]);
    expect(bm25Scores([item("a", { tf: { crispr: 2 }, length: 10 })], [], stats)).toEqual([]);
    expect(bm25Similarity([item("a", { tf: { crispr: 2 }, length: 10 })], ["crispr"], null)).toEqual({ score: 0, top: [] });
    expect(bm25Similarity([item("a", { tf: { crispr: 2 }, length: 10 })], ["crispr"], stats).score).toBeCloseTo(0.625, 10);
    // a term in every document has idf ln(1 + 0.5 / 10.5) > 0 but tiny; a term in no document has the largest idf
    expect(bm25Scores([item("a", { tf: { the: 5 }, length: 10 })], ["the"], { ...stats, doc_freq: { the: 10 } })[0]!.value).toBeCloseTo(5 * 2.2 / (5 + 1.2) / 2.2, 10);
  });

  it("compatible items: paradigm at or above the Poor gate for this notice and designs not contradicting it", () => {
    const notice = opp({ paradigm: { required: { molecular_cellular_mechanistic: 0.9 } }, design: { required_any: ["wet_lab_experiment"], prohibited: ["prospective_cohort"] } });
    const ud = { U: 1, D: 1 };
    const a = item("a", { paradigm: { molecular_cellular_mechanistic: 0.9 }, design: { wet_lab_experiment: 0.9 } });
    const b = item("b", { paradigm: { epidemiology: 0.9 }, design: { prospective_cohort: 0.9 } }); // 0.9 · 0.05 = 0.045 < 0.25
    const c = item("c", { paradigm: { molecular_cellular_mechanistic: 0.9 }, design: { rct: 0.9 } }); // required wet_lab unmet
    const d = item("d", { paradigm: { molecular_cellular_mechanistic: 0.9 } }); // no design: compatible
    expect(compatibleItems([a, b, c, d], notice, ud).map((i) => i.id)).toEqual(["a", "d"]);
  });

  it("T = w_coded · coded + w_embedding · embedding + w_bm25 · bm25 over compatible items only; an override replaces T but keeps the coded matches", () => {
    const inv = hydrateInvestigator("i", { paradigm: { recent: { molecular_cellular_mechanistic: 0.9 } }, topic: { mesh_major: ["C04.557.470"], rcdc: ["Cancer"] } });
    const notice = opp({ paradigm: { required: { molecular_cellular_mechanistic: 0.9 } }, topic: { mesh: ["C04.557.470"], rcdc: ["Cancer"], terms: ["ferroptosis"] } });
    const stats: Bm25Stats = { k1: 1.2, b: 0.75, avg_doc_length: 10, doc_count: 10, doc_freq: { ferroptosis: 1 } };
    const items = [
      item("good", { paradigm: { molecular_cellular_mechanistic: 0.9 }, cosine: 0.65, tf: { ferroptosis: 2 }, length: 10 }),
      item("wrong-kind", { paradigm: { epidemiology: 0.9 }, cosine: 0.9, tf: { ferroptosis: 9 }, length: 10 }),
    ];
    const ctx = { ...hydrateContext({ paradigm: { recent: {} } }), topic: { idf: idf({}), items, bm25: stats, override: null } };
    const r = topic(inv, notice, ctx, { U: 1, D: 1 });
    expect(r.compatible).toEqual(["good"]);
    // coded: C04.557.470 fills its depth-3 slot (3 of 3); Cancer fills 1 of a Strong-depth slot of 3 → 4 / 6
    const coded = (3 + 1) / (3 + 3);
    expect(r.coded.score).toBeCloseTo(coded, 10);
    expect(r.embedding.score).toBe(1);
    expect(r.bm25.score).toBeCloseTo(0.625, 10);
    expect(r.T).toBeCloseTo(P.w_coded * coded + P.w_embedding * 1 + P.w_bm25 * 0.625, 10);
    expect(r.top_items).toEqual(["good"]);
    const over = topic(inv, notice, { ...ctx, topic: { ...ctx.topic, override: 0.3 } }, { U: 1, D: 1 });
    expect(over).toMatchObject({ T: 0.3, overridden: true, top_items: [] });
    expect(over.coded.matches).toEqual([{ code: "C04.557.470", depth: 3 }, { code: "Cancer", depth: 1 }]);
    // no items at all: T is the coded term alone
    const none = topic(inv, notice, { ...ctx, topic: { ...ctx.topic, items: [] } }, { U: 1, D: 1 });
    expect(none.T).toBeCloseTo(P.w_coded * coded, 10);
  });
});
