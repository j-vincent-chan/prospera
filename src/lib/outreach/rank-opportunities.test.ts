import { describe, expect, it } from "vitest";
import { fakeDb } from "@/lib/fit/__fixtures__/fake-db";
import { rankOpportunitiesForInvestigator } from "./rank-opportunities";

const SUMMARY_READ = "fit_results:investigator_id, opportunity_id, tier, score, rationale, gap";

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
        { investigator_id: "p1", opportunity_id: "n2", tier: "exploratory", score: "41.5", rationale: "Paradigm 0.60.", gap: "Topic 0.30 is below the Moderate floor 0.45." },
        { investigator_id: "p1", opportunity_id: "n1", tier: "strong", score: "78.25", rationale: "Paradigm 1.00 · Topic 0.70.", gap: null },
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
    expect(r.matches).toEqual([
      { opportunityId: "n1", title: "Mechanisms of ferroptosis", agency: "NIH", tier: "strong", similarity: 0.7825, why: "Paradigm 1.00 · Topic 0.70." },
      { opportunityId: "n2", title: "Trials in cancer", agency: "NIH", tier: "exploratory", similarity: 0.415, why: "Paradigm 0.60. Topic 0.30 is below the Moderate floor 0.45." },
    ]);
    // the six summary columns, one read per surfaced tier (fewer than topN rows, so every tier is read); no embedding table touched
    expect(db.log.reads.filter((x) => x.startsWith("fit_results:"))).toEqual([SUMMARY_READ, SUMMARY_READ, SUMMARY_READ]);
    expect(db.log.reads.some((x) => x.startsWith("investigator_embeddings") || x.startsWith("opportunity_embeddings"))).toBe(false);
    expect(db.log.reads[0]).toBe("funding_opportunities:id, opportunity_fit_profiles!inner(opportunity_id)");
  });

  it("before the migration the page is told the table is unavailable; with no rows the person is not embedded", async () => {
    const missing = await rankOpportunitiesForInvestigator(fakeDb({ funding_opportunities: notices, fit_results: null }), "p1", 5, { fitEngine: "fit-v1" });
    expect(missing).toEqual({ matches: [], embedded: false, openNotices: 3, engine: "fit-v1", unavailable: true });
    const none = await rankOpportunitiesForInvestigator(fakeDb({ funding_opportunities: notices, fit_results: [] }), "p1", 5, { fitEngine: "fit-v1" });
    expect(none).toEqual({ matches: [], embedded: false, openNotices: 3, engine: "fit-v1" });
  });

  it("a Moderate that outscores a Strong is listed after it: tier before score, the same order as the opportunity page", async () => {
    const db = fakeDb({
      funding_opportunities: notices,
      fit_results: [
        { investigator_id: "p1", opportunity_id: "n2", tier: "moderate", score: "88", rationale: "high S, one floor missed", gap: null },
        { investigator_id: "p1", opportunity_id: "n1", tier: "strong", score: "66", rationale: "every floor met", gap: null },
        { investigator_id: "p1", opportunity_id: "n3", tier: "exploratory", score: "91", rationale: "lead", gap: "Design: a trialist collaborator." },
      ],
    });
    const r = await rankOpportunitiesForInvestigator(db, "p1", 5, { fitEngine: "fit-v1" });
    expect(r.matches.map((m) => [m.opportunityId, m.tier, m.similarity])).toEqual([
      ["n1", "strong", 0.66],
      ["n2", "potential", 0.88],
      ["n3", "exploratory", 0.91],
    ]);
    expect(r.matches[2]!.why).toBe("lead Design: a trialist collaborator.");
  });

  it("reads one tier at a time and stops once topN rows are in hand: a Strong is never cut by a higher-scoring Moderate, and the lower tiers are not read", async () => {
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
    expect(db.log.reads.filter((x) => x.startsWith("fit_results:"))).toEqual([SUMMARY_READ]);
  });

  it("a tier short of topN is topped up from the next one, and the tiers below the fill are not read", async () => {
    const db = fakeDb({
      funding_opportunities: notices,
      fit_results: [
        { investigator_id: "p1", opportunity_id: "n1", tier: "strong", score: 40, rationale: "a", gap: null },
        { investigator_id: "p1", opportunity_id: "n2", tier: "moderate", score: 80, rationale: "b", gap: null },
        { investigator_id: "p1", opportunity_id: "n3", tier: "moderate", score: 60, rationale: "c", gap: null },
        { investigator_id: "p1", opportunity_id: "n9", tier: "exploratory", score: 95, rationale: "never read", gap: null },
      ],
    });
    const r = await rankOpportunitiesForInvestigator(db, "p1", 3, { fitEngine: "fit-v1" });
    expect(r.matches.map((m) => [m.opportunityId, m.tier])).toEqual([
      ["n1", "strong"],
      ["n2", "potential"],
      ["n3", "potential"],
    ]);
    expect(db.log.reads.filter((x) => x.startsWith("fit_results:"))).toEqual([SUMMARY_READ, SUMMARY_READ]);
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
});
