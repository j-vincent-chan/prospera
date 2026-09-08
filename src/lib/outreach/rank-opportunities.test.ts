import { describe, expect, it } from "vitest";
import { fakeDb } from "@/lib/fit/__fixtures__/fake-db";
import { FIT_RESULT_DETAIL_COLUMNS, FIT_RESULT_LIST_COLUMNS, FIT_RESULT_WHY_NOT_COLUMNS } from "@/lib/fit/results";
import { rankOpportunitiesForInvestigator } from "./rank-opportunities";

/** PR 3.2: the list columns (the summary six plus the slim JSON paths), and the Poor "Why not?" read a strategist's page adds. */
const SUMMARY_READ = `fit_results:${FIT_RESULT_LIST_COLUMNS}`;
const WHY_NOT_READ = `fit_results:${FIT_RESULT_WHY_NOT_COLUMNS}`;
/** PR 3.2b: "Why this suggestion", one read keyed to the pairs the page shows. */
const DETAIL_READ = `fit_results:${FIT_RESULT_DETAIL_COLUMNS}`;
const PAIR = { investigator: "clinical_trials", notice: "clinical_trials" };
const MATCHED = "Paradigm matches: Clinical trials work, which is what the notice asks for.";

const notices = [
  { id: "n1", title: "Mechanisms of ferroptosis", agency: "NIH", close_date: "2027-01-01" },
  { id: "n2", title: "Trials in cancer", agency: "NIH", close_date: "2027-01-01" },
  { id: "n3", title: "Down syndrome awards", agency: "NIH", close_date: "2027-01-01" },
];

describe("rankOpportunitiesForInvestigator · fit-v1 (fake client)", () => {
  it("reads the investigator's Strong / Moderate / Exploratory rows best first, maps the tiers and the reason, and counts the open profiled notices", async () => {
    const db = fakeDb({
      funding_opportunities: notices,
      fit_results: [
        { investigator_id: "p1", opportunity_id: "n2", tier: "exploratory", score: "41.5", rationale: "Paradigm 0.60.", gap: "Topic 0.30 is below the Moderate floor 0.45.", best_pair: PAIR },
        { investigator_id: "p1", opportunity_id: "n1", tier: "strong", score: "78.25", rationale: "Paradigm 1.00 · Topic 0.70.", gap: null, best_pair: PAIR },
        { investigator_id: "p1", opportunity_id: "n3", tier: "poor", score: "10", rationale: null, gap: null },
        { investigator_id: "p2", opportunity_id: "n1", tier: "strong", score: "90", rationale: "someone else", gap: null },
        { investigator_id: "p1", opportunity_id: "gone", tier: "moderate", score: "55", rationale: "notice no longer open", gap: null },
      ],
    });
    const r = await rankOpportunitiesForInvestigator(db, "p1", 5, { fitEngine: "fit-v1" });
    expect(r.engine).toBe("fit-v1");
    expect(r.embedded).toBe(true);
    expect(r.openNotices).toBe(3);
    expect(r.unavailable).toBeUndefined();
    // PR 3.2b: the line is what matched and the binding gap — never the engine's rationale
    expect(r.matches).toEqual([
      { opportunityId: "n1", title: "Mechanisms of ferroptosis", agency: "NIH", tier: "strong", similarity: 0.7825, why: MATCHED },
      { opportunityId: "n2", title: "Trials in cancer", agency: "NIH", tier: "exploratory", similarity: 0.415, why: `Topic 0.30 is below the Moderate floor 0.45. ${MATCHED}` },
    ]);
    expect(r.matches.some((m) => m.why.includes("Paradigm 1.00"))).toBe(false);
    // the list columns, one read per surfaced tier (fewer than topN rows, so Strong and Moderate are both read; Exploratory is its own group), then the Poor "Why not?" read; no embedding table touched
    expect(db.log.reads.filter((x) => x.startsWith("fit_results:"))).toEqual([SUMMARY_READ, SUMMARY_READ, SUMMARY_READ, WHY_NOT_READ, DETAIL_READ]);
    // PR 3.2: the three groups ride along as `surface`
    expect(r.surface).toMatchObject({ audience: "strategist", recommended: [expect.objectContaining({ opportunityId: "n1" })], exploratory: [expect.objectContaining({ opportunityId: "n2", lead: "Topic 0.30 is below the Moderate floor 0.45." })], poorTotal: 1 });
    expect(r.surface!.whyNot).toEqual([{ opportunityId: "n3", title: "Down syndrome awards", agency: "NIH", score: 10, whyNot: "Below the Exploratory floors." }]);
    expect(db.log.reads.some((x) => x.startsWith("investigator_embeddings") || x.startsWith("opportunity_embeddings"))).toBe(false);
    expect(db.log.reads[0]).toBe("funding_opportunities:id, opportunity_fit_profiles!inner(opportunity_id)");
  });

  it("before the migration the page is told the table is unavailable; with no rows the person is not embedded", async () => {
    const missing = await rankOpportunitiesForInvestigator(fakeDb({ funding_opportunities: notices, fit_results: null }), "p1", 5, { fitEngine: "fit-v1" });
    expect(missing).toMatchObject({ matches: [], embedded: false, openNotices: 3, engine: "fit-v1", unavailable: true, surface: { unavailable: true } });
    const none = await rankOpportunitiesForInvestigator(fakeDb({ funding_opportunities: notices, fit_results: [] }), "p1", 5, { fitEngine: "fit-v1" });
    expect(none).toMatchObject({ matches: [], embedded: false, openNotices: 3, engine: "fit-v1", surface: { scored: false } });
    expect(none.unavailable).toBeUndefined();
  });

  it("a Moderate that outscores a Strong is listed after it: tier before score, the same order as the opportunity page", async () => {
    const db = fakeDb({
      funding_opportunities: notices,
      fit_results: [
        { investigator_id: "p1", opportunity_id: "n2", tier: "moderate", score: "88", rationale: "high S, one floor missed", gap: null },
        { investigator_id: "p1", opportunity_id: "n1", tier: "strong", score: "66", rationale: "every floor met", gap: null },
        { investigator_id: "p1", opportunity_id: "n3", tier: "exploratory", score: "91", rationale: "lead", gap: "Design: a trialist collaborator.", best_pair: PAIR },
      ],
    });
    const r = await rankOpportunitiesForInvestigator(db, "p1", 5, { fitEngine: "fit-v1" });
    expect(r.matches.map((m) => [m.opportunityId, m.tier, m.similarity])).toEqual([
      ["n1", "strong", 0.66],
      ["n2", "potential", 0.88],
      ["n3", "exploratory", 0.91],
    ]);
    expect(r.matches[2]!.why).toBe(`Design: a trialist collaborator. ${MATCHED}`);
  });

  it("reads one tier at a time and stops once topN rows are in hand: a Strong is never cut by a higher-scoring Moderate, and Moderate is not read", async () => {
    const db = fakeDb({
      funding_opportunities: notices,
      fit_results: [
        { investigator_id: "p1", opportunity_id: "n3", tier: "moderate", score: 99, rationale: "outscores every Strong", gap: null },
        { investigator_id: "p1", opportunity_id: "n1", tier: "strong", score: 60, rationale: "a", gap: null },
        { investigator_id: "p1", opportunity_id: "n2", tier: "strong", score: 70, rationale: "b", gap: null },
        { investigator_id: "p1", opportunity_id: "n9", tier: "strong", score: 50, rationale: "cut by the read bound, not by a lower tier", gap: null },
      ],
    });
    const r = await rankOpportunitiesForInvestigator(db, "p1", 2, { fitEngine: "fit-v1" });
    expect(r.matches.map((m) => [m.opportunityId, m.tier, m.similarity])).toEqual([
      ["n2", "strong", 0.7],
      ["n1", "strong", 0.6],
    ]);
    // Strong filled the group: Moderate is not read; Exploratory (its own group), the Poor "Why not?" and the detail read are
    expect(db.log.reads.filter((x) => x.startsWith("fit_results:"))).toEqual([SUMMARY_READ, SUMMARY_READ, WHY_NOT_READ, DETAIL_READ]);
  });

  it("a tier short of topN is topped up from the next one; Exploratory is its own group below Recommended (PR 3.2), never mixed in", async () => {
    const db = fakeDb({
      funding_opportunities: [...notices, { id: "n9", title: "Lead", agency: "NIH", close_date: "2027-01-01" }],
      fit_results: [
        { investigator_id: "p1", opportunity_id: "n1", tier: "strong", score: 40, rationale: "a", gap: null },
        { investigator_id: "p1", opportunity_id: "n2", tier: "moderate", score: 80, rationale: "b", gap: null },
        { investigator_id: "p1", opportunity_id: "n3", tier: "moderate", score: 60, rationale: "c", gap: null },
        { investigator_id: "p1", opportunity_id: "n9", tier: "exploratory", score: 95, rationale: "its own group", gap: "Design: a trialist collaborator." },
      ],
    });
    const r = await rankOpportunitiesForInvestigator(db, "p1", 3, { fitEngine: "fit-v1" });
    expect(r.matches.map((m) => [m.opportunityId, m.tier])).toEqual([
      ["n1", "strong"],
      ["n2", "potential"],
      ["n3", "potential"],
      ["n9", "exploratory"],
    ]);
    expect(r.surface!.recommended.map((m) => m.opportunityId)).toEqual(["n1", "n2", "n3"]);
    expect(r.surface!.exploratory.map((m) => m.opportunityId)).toEqual(["n9"]);
    expect(db.log.reads.filter((x) => x.startsWith("fit_results:"))).toEqual([SUMMARY_READ, SUMMARY_READ, SUMMARY_READ, WHY_NOT_READ, DETAIL_READ]);
  });

  it("topN bounds the list", async () => {
    const db = fakeDb({
      funding_opportunities: notices,
      fit_results: [
        { investigator_id: "p1", opportunity_id: "n1", tier: "strong", score: "78", rationale: "a", gap: null },
        { investigator_id: "p1", opportunity_id: "n2", tier: "moderate", score: "60", rationale: "b", gap: null },
      ],
    });
    const r = await rankOpportunitiesForInvestigator(db, "p1", 1, { fitEngine: "fit-v1" });
    expect(r.matches.map((m) => [m.opportunityId, m.tier])).toEqual([["n1", "strong"]]);
  });

  it("D7: a PI on their own page gets Recommended only — no Exploratory row, no Poor read", async () => {
    const db = fakeDb({
      funding_opportunities: notices,
      fit_results: [
        { investigator_id: "p1", opportunity_id: "n1", tier: "strong", score: "78", rationale: "a", gap: null },
        { investigator_id: "p1", opportunity_id: "n2", tier: "exploratory", score: "60", rationale: "b", gap: "the gap" },
        { investigator_id: "p1", opportunity_id: "n3", tier: "poor", score: "6", rationale: null, gap: null, why_not: "poor" },
      ],
    });
    const r = await rankOpportunitiesForInvestigator(db, "p1", 5, { fitEngine: "fit-v1", audience: "investigator" });
    expect(r.matches.map((m) => [m.opportunityId, m.tier])).toEqual([["n1", "strong"]]);
    expect(r.surface).toMatchObject({ audience: "investigator", exploratory: [], whyNot: [], poorTotal: 0 });
    expect(db.log.reads.filter((x) => x.startsWith("fit_results:"))).toEqual([SUMMARY_READ, SUMMARY_READ, DETAIL_READ]);
  });
});
