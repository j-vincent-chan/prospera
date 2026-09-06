import { describe, expect, it } from "vitest";
import { adjudicate, assignSlots, goldLabelRow, labelersByFirstLabel, latestByLabeler, progressOf, resolveIdentity, sameLabel, slotLabelsFor, type GoldLabelRow, type LabelerIdentity } from "@/lib/fit/goldset/labels";
import { pairKey } from "@/lib/fit/goldset/stratify";

const INV = "04e59cf5-600a-462c-91bc-b2b97f122c3d";
const OPP = "710a95dc-223f-4dd4-a76a-4bd686f2463f";
const OPP2 = "8b1c6b5e-4e0d-4c2a-9c7f-2f5f6a1b3c4d";
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";
const D = "dddddddd-0000-4000-8000-000000000004";

let seq = 0;
function row(over: Partial<GoldLabelRow> & { labeler: string; tier: string | null }): GoldLabelRow {
  seq += 1;
  return { id: `r${String(seq).padStart(3, "0")}`, investigator_id: INV, opportunity_id: OPP, reason: null, axis_reason: null, engine_version: "engine-1", source: "gold", created_at: `2026-09-10T00:00:${String(seq).padStart(2, "0")}.000Z`, ...over };
}

const identities: LabelerIdentity[] = [
  { id: A, email: "a@ucsf.edu", name: "Ann" },
  { id: B, email: "B@UCSF.EDU", name: "Ben" },
  { id: C, email: "c@ucsf.edu", name: null },
];

describe("goldset/labels · latest rows", () => {
  it("takes the newest row per (pair, labeler), ties by id, and skips rows without both ids or a labeler", () => {
    const first = row({ labeler: A, tier: "strong" });
    const second = row({ labeler: A, tier: "poor", reason: "not_relevant" });
    const same = { ...second, id: "r999", tier: "moderate" };
    const b = row({ labeler: B, tier: "exploratory", reason: "thin_evidence" });
    const flag = row({ labeler: A, tier: null, opportunity_id: null, source: "profile_flag" });
    const latest = latestByLabeler([first, second, same, b, flag]);
    const byLabeler = latest.get(pairKey(INV, OPP))!;
    expect(byLabeler.get(A)?.id).toBe("r999");
    expect(byLabeler.get(B)?.tier).toBe("exploratory");
    expect(latest.size).toBe(1);
  });

  it("orders labelers by their first row", () => {
    const rows = [row({ labeler: B, tier: "strong" }), row({ labeler: A, tier: "strong" }), row({ labeler: B, tier: "poor" }), row({ labeler: C, tier: "strong" })];
    expect(labelersByFirstLabel(rows)).toEqual([B, A, C]);
  });
});

describe("goldset/labels · slots", () => {
  it("resolves a configured email or id case-insensitively", () => {
    expect(resolveIdentity("b@ucsf.edu", identities)).toBe(B);
    expect(resolveIdentity(A.toUpperCase(), identities)).toBe(A);
    expect(resolveIdentity("nobody@ucsf.edu", identities)).toBeNull();
    expect(resolveIdentity("", identities)).toBeNull();
  });

  it("configured slots win, unresolved values are reported, and a labeler outside the configuration is unassigned", () => {
    const rows = [row({ labeler: D, tier: "strong" })];
    const s = assignSlots({ a: "a@ucsf.edu", b: "b@ucsf.edu", adjudicator: "zed@ucsf.edu" }, identities, rows, D);
    expect(s).toMatchObject({ mode: "configured", slots: { a: A, b: B, adjudicator: null }, unresolved: ["zed@ucsf.edu"], unassigned: [D], current: null });
    expect(assignSlots({ a: "a@ucsf.edu", b: null, adjudicator: null }, identities, rows, A).current).toBe("a");
  });

  it("without a configuration, slots go by order of first label and a new admin takes the first empty one", () => {
    const empty = assignSlots({ a: null, b: null, adjudicator: null }, identities, [], A);
    expect(empty).toMatchObject({ mode: "first_label", slots: { a: A, b: null, adjudicator: null }, current: "a" });
    const rows = [row({ labeler: B, tier: "strong" }), row({ labeler: A, tier: "moderate" })];
    const second = assignSlots({ a: null, b: null, adjudicator: null }, identities, rows, A);
    expect(second.slots).toEqual({ a: B, b: A, adjudicator: null });
    expect(second.current).toBe("b");
    const third = assignSlots({ a: null, b: null, adjudicator: null }, identities, rows, C);
    expect(third).toMatchObject({ slots: { a: B, b: A, adjudicator: C }, current: "adjudicator" });
    const withThree = [...rows, row({ labeler: C, tier: "strong" })];
    const fourth = assignSlots({ a: null, b: null, adjudicator: null }, identities, withThree, D);
    expect(fourth.current).toBeNull();
    expect(fourth.slots).toEqual({ a: B, b: A, adjudicator: C });
    expect(fourth.unassigned).toEqual([]);
    const fourthLabeled = assignSlots({ a: null, b: null, adjudicator: null }, identities, [...withThree, row({ labeler: D, tier: "poor" })], D);
    expect(fourthLabeled.unassigned).toEqual([D]);
  });
});

describe("goldset/labels · adjudication", () => {
  const l = (tier: string, reason: string | null = null, axis_reason: string | null = null) => ({ tier, reason, axis_reason });
  it("the adjudicator's row wins; agreement is that tier; disagreement is unresolved; one label is pending; none is unlabeled", () => {
    expect(adjudicate({ a: l("strong"), b: l("poor", "not_relevant"), adjudicator: l("moderate") })).toMatchObject({ status: "adjudicated", tier: "moderate", by: "adjudicator" });
    expect(adjudicate({ a: l("poor", "wrong_type", "paradigm:epidemiology"), b: l("poor", "not_relevant") })).toMatchObject({ status: "agreed", tier: "poor", reason: "wrong_type", axis_reason: "paradigm:epidemiology", by: "a" });
    expect(adjudicate({ a: l("strong"), b: l("moderate") })).toMatchObject({ status: "unresolved", tier: null, by: null });
    expect(adjudicate({ a: l("strong") })).toMatchObject({ status: "pending", tier: null });
    expect(adjudicate({ b: l("strong") })).toMatchObject({ status: "pending" });
    expect(adjudicate({})).toMatchObject({ status: "unlabeled", tier: null });
  });

  it("slotLabelsFor and progressOf count per slot and per status", () => {
    const rows = [
      row({ labeler: A, tier: "strong" }),
      row({ labeler: B, tier: "strong" }),
      row({ labeler: A, tier: "poor", reason: "not_relevant", opportunity_id: OPP2 }),
      row({ labeler: B, tier: "moderate", opportunity_id: OPP2 }),
    ];
    const latest = latestByLabeler(rows);
    const slots = { a: A, b: B, adjudicator: C };
    expect(slotLabelsFor(latest.get(pairKey(INV, OPP)), slots).adjudicator).toBeNull();
    const p = progressOf([pairKey(INV, OPP), pairKey(INV, OPP2), pairKey(INV, "x")], latest, slots);
    expect(p).toEqual({ total: 3, labeled: { a: 2, b: 2, adjudicator: 0 }, agreed: 1, adjudicated: 0, awaiting_adjudication: 1, pending: 0, unlabeled: 1, resolved: 1 });
    const adjudicated = latestByLabeler([...rows, row({ labeler: C, tier: "moderate", opportunity_id: OPP2 })]);
    expect(progressOf([pairKey(INV, OPP2)], adjudicated, slots)).toMatchObject({ adjudicated: 1, awaiting_adjudication: 0, resolved: 1, labeled: { adjudicator: 1 } });
  });

  it("goldLabelRow is a gold-source insert; sameLabel spots an identical re-save", () => {
    const r = goldLabelRow({ investigator_id: INV, opportunity_id: OPP, tier: "poor", reason: "wrong_type", axis_reason: "paradigm:epidemiology", labeler: A, engine_version: "engine-1" });
    expect(r).toEqual({ investigator_id: INV, opportunity_id: OPP, tier: "poor", reason: "wrong_type", axis_reason: "paradigm:epidemiology", labeler: A, engine_version: "engine-1", source: "gold" });
    expect(sameLabel({ tier: "poor", reason: "wrong_type", axis_reason: "paradigm:epidemiology" }, { tier: "poor", reason: "wrong_type", axis_reason: "paradigm:epidemiology" })).toBe(true);
    expect(sameLabel({ tier: "poor", reason: "wrong_type", axis_reason: "paradigm:epidemiology" }, { tier: "poor", reason: "wrong_type", axis_reason: null })).toBe(false);
    expect(sameLabel(null, { tier: "poor", reason: null, axis_reason: null })).toBe(false);
  });
});
