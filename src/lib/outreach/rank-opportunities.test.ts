import { describe, expect, it } from "vitest";
import { fakeDb } from "@/lib/fit/__fixtures__/fake-db";
import { rankOpportunitiesForInvestigator } from "./rank-opportunities";

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
    // one fit_results read, no embedding table touched
    expect(db.log.reads.filter((x) => x.startsWith("fit_results:"))).toHaveLength(1);
    expect(db.log.reads.some((x) => x.startsWith("investigator_embeddings") || x.startsWith("opportunity_embeddings"))).toBe(false);
    expect(db.log.reads[0]).toBe("funding_opportunities:id, opportunity_fit_profiles!inner(opportunity_id)");
  });

  it("before the migration the page is told the table is unavailable; with no rows the person is not embedded", async () => {
    const missing = await rankOpportunitiesForInvestigator(fakeDb({ funding_opportunities: notices, fit_results: null }), "p1", 5, { fitEngine: "fit-v1" });
    expect(missing).toEqual({ matches: [], embedded: false, openNotices: 3, engine: "fit-v1", unavailable: true });
    const none = await rankOpportunitiesForInvestigator(fakeDb({ funding_opportunities: notices, fit_results: [] }), "p1", 5, { fitEngine: "fit-v1" });
    expect(none).toEqual({ matches: [], embedded: false, openNotices: 3, engine: "fit-v1" });
  });

  it("topN bounds the read", async () => {
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
