/**
 * The counterpart-profile reads C3 adds (fit-UX PR 3): the pure helpers, and
 * the two loaders against the fake PostgREST builder — one bounded read each,
 * the `sources.complete` column read as D22 spells it, a missing table
 * degrading rather than throwing.
 */
import { describe, expect, it } from "vitest";
import { fakeDb, type Row } from "@/lib/fit/__fixtures__/fake-db";
import { idChunks, loadInvestigatorProfiles, loadNoticeProfiles, noticeCompleteOf, noticeInputFor } from "@/lib/fit/verdict-profiles";

const NOTICE_READ = "opportunity_fit_profiles:opportunity_id, profile, complete:sources->complete";
const INV_READ = "investigator_fit_profiles:investigator_id, profile";

const noticeRow = (opportunity_id: string, over: Row = {}): Row => ({ opportunity_id, profile: { opportunity_id, number: `PAR-26-${opportunity_id}` }, ...over });

describe("idChunks (pure)", () => {
  it("one read for a list that fits, distinct and in first-seen order", () => {
    expect(idChunks(["b", "a", "b", "c"])).toEqual([["b", "a", "c"]]);
  });

  it("no ids means no read at all", () => {
    expect(idChunks([])).toEqual([]);
    expect(idChunks(["", ""])).toEqual([]);
  });

  it("a longer list degrades into bounded reads rather than one URL PostgREST will not take", () => {
    const ids = Array.from({ length: 5 }, (_, i) => `id${i}`);
    expect(idChunks(ids, 2)).toEqual([["id0", "id1"], ["id2", "id3"], ["id4"]]);
  });
});

describe("noticeCompleteOf (D22)", () => {
  it("a row without the field counts as complete — the rule both existing readers spell", () => {
    expect(noticeCompleteOf({})).toBe(true);
    expect(noticeCompleteOf({ complete: undefined })).toBe(true);
    expect(noticeCompleteOf(null)).toBe(true);
    expect(noticeCompleteOf(undefined)).toBe(true);
  });

  it("only an explicit false is incomplete", () => {
    expect(noticeCompleteOf({ complete: false })).toBe(false);
    expect(noticeCompleteOf({ complete: true })).toBe(true);
    // not a boolean: not the signal, so not incomplete
    expect(noticeCompleteOf({ complete: 0 })).toBe(true);
  });
});

describe("loadNoticeProfiles", () => {
  it("one read for the shown notices; the profile record and the column's `complete`", async () => {
    const db = fakeDb({ opportunity_fit_profiles: [noticeRow("n1"), noticeRow("n2", { complete: false }), noticeRow("n3", { complete: true }), noticeRow("other")] });
    const loaded = await loadNoticeProfiles(db, ["n1", "n2", "n3"]);
    expect(db.log.reads).toEqual([NOTICE_READ]);
    expect(loaded.available).toBe(true);
    expect(Array.from(loaded.profiles.keys()).sort()).toEqual(["n1", "n2", "n3"]);
    expect(loaded.complete.get("n1")).toBe(true);
    expect(loaded.complete.get("n2")).toBe(false);
    expect(loaded.complete.get("n3")).toBe(true);
  });

  it("no ids, no read", async () => {
    const db = fakeDb({ opportunity_fit_profiles: [] });
    expect((await loadNoticeProfiles(db, [])).profiles.size).toBe(0);
    expect(db.log.reads).toEqual([]);
  });

  it("a notice with no profile row is absent from both maps, and a row whose `profile` is null carries only its completeness", async () => {
    const db = fakeDb({ opportunity_fit_profiles: [noticeRow("n1"), { opportunity_id: "n2", profile: null, complete: false }] });
    const loaded = await loadNoticeProfiles(db, ["n1", "n2", "n3"]);
    expect(loaded.profiles.has("n2")).toBe(false);
    expect(loaded.complete.get("n2")).toBe(false);
    expect(loaded.profiles.has("n3")).toBe(false);
    expect(loaded.complete.has("n3")).toBe(false);
  });

  it("before the migration it degrades: no rows, `available: false`, no throw", async () => {
    const db = fakeDb({ opportunity_fit_profiles: null });
    const loaded = await loadNoticeProfiles(db, ["n1"]);
    expect(loaded).toMatchObject({ available: false });
    expect(loaded.profiles.size).toBe(0);
  });
});

describe("loadInvestigatorProfiles", () => {
  it("one read for the shown people", async () => {
    const db = fakeDb({ investigator_fit_profiles: [{ investigator_id: "p1", profile: { investigator_id: "p1" } }, { investigator_id: "p2", profile: null }, { investigator_id: "p9", profile: { investigator_id: "p9" } }] });
    const loaded = await loadInvestigatorProfiles(db, ["p1", "p2"]);
    expect(db.log.reads).toEqual([INV_READ]);
    expect(Array.from(loaded.profiles.keys())).toEqual(["p1"]);
    expect(loaded.available).toBe(true);
  });

  it("before the migration it degrades rather than throwing", async () => {
    expect(await loadInvestigatorProfiles(fakeDb({ investigator_fit_profiles: null }), ["p1"])).toMatchObject({ available: false });
  });
});

describe("noticeInputFor (pure) — D-h", () => {
  it("a notice with no profile keeps `noticeComplete: true`: it is not a half-built profile, and `verdicts.ts` has its own words for it", async () => {
    const db = fakeDb({ opportunity_fit_profiles: [noticeRow("n1", { complete: false })] });
    const loaded = await loadNoticeProfiles(db, ["n1", "n2"]);
    expect(noticeInputFor(loaded, "n2")).toEqual({ notice: null, noticeComplete: true });
    expect(noticeInputFor(loaded, "n1").noticeComplete).toBe(false);
    expect(noticeInputFor(loaded, "n1").notice).not.toBeNull();
  });
});
