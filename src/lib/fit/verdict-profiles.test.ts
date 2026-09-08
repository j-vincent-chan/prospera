/**
 * The counterpart-profile reads C3 adds (fit-UX PR 3): the pure helpers, and
 * the two loaders against the fake PostgREST builder — one bounded read each,
 * the `sources.complete` column read as D22 spells it, a missing table
 * degrading rather than throwing.
 */
import { describe, expect, it } from "vitest";
import { fakeDb, type Row } from "@/lib/fit/__fixtures__/fake-db";
import { CHUNK, idChunks, loadDirectoryCoverage, loadInvestigatorProfiles, loadNoticeProfiles, noticeCompleteOf, noticeInputFor, profilesDegraded } from "@/lib/fit/verdict-profiles";
import { directoryIsThin } from "@/lib/fit/surface-states";

const NOTICE_READ = "opportunity_fit_profiles:opportunity_id, profile, complete:sources->complete, guide_html_hash";
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

  it("the default bound is real: it splits, and it splits at 200", () => {
    // `CHUNK` is what stops an `in()` list becoming a URL PostgREST refuses.
    // Raised past any list the app can produce it is not a bound at all, and
    // nothing above notices — every surface today shows far fewer than 200
    // rows, so only the default itself can be asserted.
    expect(CHUNK).toBe(200);
    const ids = Array.from({ length: 201 }, (_, i) => `id${i}`);
    expect(idChunks(ids).length).toBe(2);
    expect(idChunks(ids)[0]!.length).toBe(200);
    expect(idChunks(ids)[1]).toEqual(["id200"]);
    expect(idChunks(Array.from({ length: 200 }, (_, i) => `id${i}`)).length).toBe(1);
  });
});

describe("profilesDegraded (pure)", () => {
  it("a missing table or a failed read is degraded; two clean reads are not", () => {
    expect(profilesDegraded({ available: true, error: null }, { available: true, error: null })).toBe(false);
    expect(profilesDegraded({ available: false, error: null }, { available: true, error: null })).toBe(true);
    expect(profilesDegraded({ available: true, error: null }, { available: true, error: "boom" })).toBe(true);
    expect(profilesDegraded()).toBe(false);
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
    expect(loaded).toMatchObject({ available: false, error: null });
    expect(loaded.profiles.size).toBe(0);
  });

  it("a read that fails for any other reason degrades too, and reports the reason instead of throwing", async () => {
    // This read sits inside `loadWorkspace`, which `outreach/page.tsx` awaits in
    // a `Promise.all`. Throwing here 500s the whole Outreach board over bars,
    // chips and a couple of sentences.
    const db = fakeDb({ opportunity_fit_profiles: [noticeRow("n1")] }, undefined, { fail: { opportunity_fit_profiles: "canceling statement due to statement timeout" } });
    const loaded = await loadNoticeProfiles(db, ["n1"]);
    expect(loaded.available).toBe(true);
    expect(loaded.error).toContain("statement timeout");
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
    expect(await loadInvestigatorProfiles(fakeDb({ investigator_fit_profiles: null }), ["p1"])).toMatchObject({ available: false, error: null });
  });

  it("any other read failure degrades rather than throwing", async () => {
    const db = fakeDb({ investigator_fit_profiles: [] }, undefined, { fail: { investigator_fit_profiles: "permission denied for table investigator_fit_profiles" } });
    const loaded = await loadInvestigatorProfiles(db, ["p1"]);
    expect(loaded.available).toBe(true);
    expect(loaded.error).toContain("permission denied");
    expect(loaded.profiles.size).toBe(0);
  });

  it("the read is bounded to the ids it was given — not to every row of the table", async () => {
    const db = fakeDb({ investigator_fit_profiles: [{ investigator_id: "p1", profile: {} }, { investigator_id: "p9", profile: {} }] });
    await loadInvestigatorProfiles(db, ["p1"]);
    expect(db.log.selects.map((s) => [s.table, s.filters])).toEqual([["investigator_fit_profiles", ["investigator_id in p1"]]]);
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

// ---------------------------------------------------------------------------
// loadDirectoryCoverage (fit-UX PR 5, §3i.4)
// ---------------------------------------------------------------------------

describe("loadDirectoryCoverage", () => {
  const people = [
    { id: "p1", archived_at: null },
    { id: "p2", archived_at: null },
    { id: "p3", archived_at: "2026-01-01" },
  ];

  it("two head counts, and the directory is the live records only", async () => {
    const db = fakeDb({ investigators: people, investigator_fit_profiles: [{ investigator_id: "p1", profile: {} }] });
    expect(await loadDirectoryCoverage(db)).toEqual({ directory: 2, profiled: 1, available: true, error: null });
    // Counting archived people into the denominator would make a tidy
    // directory read as a thin one; the surfaces drop them from every list.
    expect(db.log.selects.map((s) => [s.table, s.filters])).toEqual([
      ["investigators", ["archived_at is null"]],
      ["investigator_fit_profiles", []],
    ]);
    expect(db.log.reads).toEqual(["investigators:id", "investigator_fit_profiles:investigator_id"]);
  });

  it("before the migration it degrades rather than throwing, and makes no claim", async () => {
    const db = fakeDb({ investigators: people, investigator_fit_profiles: null });
    const c = await loadDirectoryCoverage(db);
    expect(c).toEqual({ directory: 0, profiled: 0, available: false, error: null });
    expect(directoryIsThin(c)).toBe(false);
  });

  it("any other read failure degrades rather than throwing, and still makes no claim", async () => {
    const db = fakeDb({ investigators: people, investigator_fit_profiles: [] }, undefined, { fail: { investigators: "canceling statement due to statement timeout" } });
    const c = await loadDirectoryCoverage(db);
    expect(c.available).toBe(true);
    expect(c.error).toContain("statement timeout");
    expect(c.directory).toBe(0);
    expect(directoryIsThin(c)).toBe(false);
  });

  it("a directory nobody has profiled is thin; one that is fully profiled is not", async () => {
    const none = fakeDb({ investigators: people, investigator_fit_profiles: [] });
    expect(directoryIsThin(await loadDirectoryCoverage(none))).toBe(true);
    const all = fakeDb({ investigators: people, investigator_fit_profiles: [{ investigator_id: "p1", profile: {} }, { investigator_id: "p2", profile: {} }] });
    expect(directoryIsThin(await loadDirectoryCoverage(all))).toBe(false);
  });
});
