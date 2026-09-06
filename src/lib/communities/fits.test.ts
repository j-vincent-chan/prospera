import { describe, expect, it } from "vitest";
import { fakeDb } from "@/lib/fit/__fixtures__/fake-db";
import type { FitResultKeyRow } from "@/lib/fit/results";
import { communityFitRowsFromResults, refreshCommunityFits } from "./fits";

const row = (investigator_id: string, opportunity_id: string, tier: FitResultKeyRow["tier"], score: number): FitResultKeyRow => ({ investigator_id, opportunity_id, tier, score });

describe("community fits · fit-v1 aggregation (pure)", () => {
  it("counts Strong as strong, Moderate as potential, scores 1 / 0.5, drops Exploratory, Poor and closed notices, orders members best first and notices by id", () => {
    const rows = [
      row("p2", "n2", "moderate", 40),
      row("p1", "n2", "strong", 70),
      row("p3", "n2", "strong", 70),
      row("p1", "n1", "exploratory", 30),
      row("p2", "n1", "poor", 5),
      row("p1", "n3", "strong", 80),
      row("p2", "n3", "strong", "65" as unknown as number),
    ];
    const out = communityFitRowsFromResults("c1", rows, new Set(["n1", "n2"]), "2026-09-06T00:00:00.000Z");
    expect(out).toEqual([{ community_id: "c1", opportunity_id: "n2", investigator_ids: ["p1", "p3", "p2"], strong_count: 2, potential_count: 1, score: 2.5, computed_at: "2026-09-06T00:00:00.000Z" }]);
    expect(communityFitRowsFromResults("c1", [], new Set(["n1"]), "x")).toEqual([]);
  });
});

describe("community fits · refreshFromFitResults (fake client)", () => {
  const members = [
    { community_id: "c1", investigator_id: "p1", investigators: { id: "p1", archived_at: null } },
    { community_id: "c1", investigator_id: "p2", investigators: { id: "p2", archived_at: null } },
    { community_id: "c1", investigator_id: "p9", investigators: { id: "p9", archived_at: "2026-01-01" } },
  ];

  it("reads the members' Strong / Moderate rows (four columns), keeps the open notices, replaces the cache and stamps the community", async () => {
    const db = fakeDb({
      community_members: members,
      fit_results: [
        { investigator_id: "p1", opportunity_id: "n1", tier: "strong", score: "70", provenance: { big: true } },
        { investigator_id: "p2", opportunity_id: "n1", tier: "moderate", score: "50" },
        { investigator_id: "p2", opportunity_id: "n2", tier: "exploratory", score: "30" },
        { investigator_id: "p9", opportunity_id: "n1", tier: "strong", score: "90" },
      ],
      funding_opportunities: [{ id: "n1" }, { id: "n2" }],
      community_fits: [{ community_id: "c1", opportunity_id: "stale" }],
      pipeline_communities: [{ id: "c1", fits_refreshed_at: null }],
    });
    const r = await refreshCommunityFits(db, "c1", { engine: "fit-v1" });
    expect(r).toEqual({ ok: true, communityId: "c1", members: 2, embedded: 2, notices: 1, engine: "fit-v1" });
    expect(db.log.reads.filter((x) => x.startsWith("fit_results:"))).toEqual(["fit_results:investigator_id, opportunity_id, tier, score"]);
    const writes = db.log.writes.map((w) => `${w.table}:${w.op}`);
    expect(writes).toEqual(["community_fits:delete", "community_fits:insert", "pipeline_communities:update"]);
    expect(db.tables.community_fits).toEqual([expect.objectContaining({ community_id: "c1", opportunity_id: "n1", investigator_ids: ["p1", "p2"], strong_count: 1, potential_count: 1, score: 1.5 })]);
    expect((db.tables.pipeline_communities![0] as { fits_refreshed_at: string | null }).fits_refreshed_at).not.toBeNull();
  });

  it("with no engine given, every writer follows the every-team rule: fit-v1 only when every team is on it", async () => {
    const base = () => ({
      community_members: members,
      fit_results: [{ investigator_id: "p1", opportunity_id: "n1", tier: "strong", score: "70" }],
      funding_opportunities: [{ id: "n1" }],
      community_fits: [],
      pipeline_communities: [{ id: "c1", fits_refreshed_at: null }],
    });
    const all = fakeDb({ ...base(), teams: [{ id: "t1", fit_engine: "fit-v1" }, { id: "t2", fit_engine: "fit-v1" }] });
    expect(await refreshCommunityFits(all, "c1")).toMatchObject({ ok: true, engine: "fit-v1", notices: 1 });
    expect(all.log.reads[0]).toBe("teams:fit_engine");
    expect(all.log.reads.some((x) => x.startsWith("fit_results:"))).toBe(true);

    // One team still on legacy: the cache stays legacy for everyone, even when a flipped team's screen asks (no embeddings here, so an empty cache).
    const mixed = fakeDb({ ...base(), teams: [{ id: "t1", fit_engine: "fit-v1" }, { id: "t2", fit_engine: "legacy" }] });
    expect(await refreshCommunityFits(mixed, "c1")).toMatchObject({ ok: true, engine: "legacy", notices: 0 });
    expect(mixed.log.reads.some((x) => x.startsWith("fit_results:"))).toBe(false);
  });

  it("before the migration the refresh fails with the migration named, writing nothing", async () => {
    const db = fakeDb({ community_members: members, fit_results: null, community_fits: [], pipeline_communities: [] });
    const r = await refreshCommunityFits(db, "c1", { engine: "fit-v1" });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/fit_results is not on the database/) });
    expect(db.log.writes).toEqual([]);
  });

  it("a community with no members writes an empty cache", async () => {
    const db = fakeDb({ community_members: [], fit_results: [], funding_opportunities: [], community_fits: [], pipeline_communities: [{ id: "c1" }] });
    const r = await refreshCommunityFits(db, "c1", { engine: "fit-v1" });
    expect(r).toMatchObject({ ok: true, members: 0, embedded: 0, notices: 0 });
    expect(db.log.writes.map((w) => w.op)).toEqual(["delete", "update"]);
  });
});
