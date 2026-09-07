import { describe, expect, it } from "vitest";
import { adjudicate, assignSlots, goldLabelRow, isMissingSyntheticColumn, isUuid, labelersByFirstLabel, labelSubject, latestByLabeler, progressOf, resolveIdentity, rowPairKey, rowSubjectId, sameLabel, slotLabelsFor, splitIdentityValues, type GoldLabelRow, type LabelerIdentity } from "@/lib/fit/goldset/labels";
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
  return { id: `r${String(seq).padStart(3, "0")}`, investigator_id: INV, synthetic_source: null, opportunity_id: OPP, reason: null, axis_reason: null, engine_version: "engine-1", source: "gold", created_at: `2026-09-10T00:00:${String(seq).padStart(2, "0")}.000Z`, ...over };
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

  it("a synthetic row is keyed by synthetic:<case> (the manifest's id); a row naming no pair is skipped; the subject helpers round-trip", () => {
    const SYN = "synthetic:2_cvd_epi_vs_mito_mechanism";
    const syn = row({ labeler: A, tier: "poor", reason: "wrong_research_type", axis_reason: "paradigm", investigator_id: null, synthetic_source: "2_cvd_epi_vs_mito_mechanism" });
    const noticeOnly = row({ labeler: A, tier: null, investigator_id: null, source: "profile_flag" });
    const latest = latestByLabeler([syn, noticeOnly, row({ labeler: B, tier: "strong" })]);
    expect(Array.from(latest.keys()).sort()).toEqual([pairKey(INV, OPP), pairKey(SYN, OPP)].sort());
    expect(latest.get(pairKey(SYN, OPP))?.get(A)?.id).toBe(syn.id);
    expect(rowSubjectId(syn)).toBe(SYN);
    expect(rowPairKey(syn)).toBe(pairKey(SYN, OPP));
    expect(rowPairKey(noticeOnly)).toBeNull();
    expect(rowPairKey({ investigator_id: INV, synthetic_source: null, opportunity_id: null })).toBeNull();
    expect(labelSubject(SYN)).toEqual({ investigator_id: null, synthetic_source: "2_cvd_epi_vs_mito_mechanism" });
    expect(labelSubject(INV)).toEqual({ investigator_id: INV, synthetic_source: null });
    expect(isMissingSyntheticColumn("fit_labels read failed: column fit_labels.synthetic_source does not exist")).toBe(true);
    expect(isMissingSyntheticColumn("Could not find the 'synthetic_source' column of 'fit_labels' in the schema cache")).toBe(true);
    expect(isMissingSyntheticColumn("Could not find the table 'public.fit_labels' in the schema cache")).toBe(false);
  });

  it("orders labelers by their first row", () => {
    const rows = [row({ labeler: B, tier: "strong" }), row({ labeler: A, tier: "strong" }), row({ labeler: B, tier: "poor" }), row({ labeler: C, tier: "strong" })];
    expect(labelersByFirstLabel(rows)).toEqual([B, A, C]);
  });
});

describe("goldset/labels · identity values", () => {
  it("splits configured values by shape: UUIDs to ids, the rest to emails (as given and lower-cased), trimmed and de-duplicated", () => {
    expect(isUuid(A)).toBe(true);
    expect(isUuid("a@ucsf.edu")).toBe(false);
    expect(splitIdentityValues([` ${A} `, "Ann.Labeler@ucsf.edu", A.toUpperCase(), null, "", undefined, "b@ucsf.edu", "b@ucsf.edu"])).toEqual({
      ids: [A],
      emails: ["Ann.Labeler@ucsf.edu", "ann.labeler@ucsf.edu", "b@ucsf.edu"],
    });
    expect(splitIdentityValues([])).toEqual({ ids: [], emails: [] });
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

  it("without a configuration, A and B go by order of first label and a new admin takes the first empty one; the adjudicator slot exists only from the configuration", () => {
    const none = { a: null, b: null, adjudicator: null };
    const empty = assignSlots(none, identities, [], A);
    expect(empty).toMatchObject({ mode: "first_label", slots: { a: A, b: null, adjudicator: null }, current: "a" });
    const rows = [row({ labeler: B, tier: "strong" }), row({ labeler: A, tier: "moderate" })];
    const second = assignSlots(none, identities, rows, A);
    expect(second.slots).toEqual({ a: B, b: A, adjudicator: null });
    expect(second.current).toBe("b");
    // A third admin is not the adjudicator by order of arrival (F6): no slot until labelers.json names them.
    const third = assignSlots(none, identities, rows, C);
    expect(third).toMatchObject({ slots: { a: B, b: A, adjudicator: null }, current: null, unassigned: [] });
    const thirdLabeled = assignSlots(none, identities, [...rows, row({ labeler: C, tier: "strong" })], C);
    expect(thirdLabeled.unassigned).toEqual([C]);
    expect(thirdLabeled.current).toBeNull();
  });

  it("a configured adjudicator holds that slot beside first-label A and B, and their rows never take a labeler slot", () => {
    const cfg = { a: null, b: null, adjudicator: "c@ucsf.edu" };
    const rows = [row({ labeler: C, tier: "strong" }), row({ labeler: B, tier: "strong" })];
    const s = assignSlots(cfg, identities, rows, A);
    expect(s).toMatchObject({ mode: "first_label", slots: { a: B, b: A, adjudicator: C }, current: "b", unassigned: [] });
    expect(assignSlots(cfg, identities, rows, C).current).toBe("adjudicator");
    expect(assignSlots({ a: "a@ucsf.edu", b: "b@ucsf.edu", adjudicator: "c@ucsf.edu" }, identities, rows, D).current).toBeNull();
  });
});

describe("goldset/labels · adjudication", () => {
  const l = (tier: string, reason: string | null = null, axis_reason: string | null = null) => ({ tier, reason, axis_reason });
  it("the adjudicator's row wins; agreement is that tier; disagreement is unresolved; one label is pending; none is unlabeled", () => {
    expect(adjudicate({ a: l("strong"), b: l("poor", "not_relevant"), adjudicator: l("moderate") })).toMatchObject({ status: "adjudicated", tier: "moderate", by: "adjudicator" });
    expect(adjudicate({ a: l("poor", "wrong_research_type", "paradigm:epidemiology"), b: l("poor", "not_relevant") })).toMatchObject({ status: "agreed", tier: "poor", reason: "wrong_research_type", axis_reason: "paradigm:epidemiology", by: "a" });
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

  it("goldLabelRow is a gold-source insert — a real subject omits synthetic_source, a synthetic one writes it with investigator_id null; sameLabel spots an identical re-save", () => {
    const r = goldLabelRow({ investigator_id: INV, synthetic_source: null, opportunity_id: OPP, tier: "poor", reason: "wrong_research_type", axis_reason: "paradigm:epidemiology", labeler: A, engine_version: "engine-1" });
    expect(r).toEqual({ investigator_id: INV, opportunity_id: OPP, tier: "poor", reason: "wrong_research_type", axis_reason: "paradigm:epidemiology", labeler: A, engine_version: "engine-1", source: "gold" });
    expect("synthetic_source" in r).toBe(false);
    expect(goldLabelRow({ investigator_id: null, synthetic_source: "2_cvd_epi_vs_mito_mechanism", opportunity_id: OPP, tier: "poor", reason: "wrong_research_type", axis_reason: "paradigm", labeler: A, engine_version: "engine-1" })).toEqual({ investigator_id: null, synthetic_source: "2_cvd_epi_vs_mito_mechanism", opportunity_id: OPP, tier: "poor", reason: "wrong_research_type", axis_reason: "paradigm", labeler: A, engine_version: "engine-1", source: "gold" });
    expect(sameLabel({ tier: "poor", reason: "wrong_research_type", axis_reason: "paradigm:epidemiology" }, { tier: "poor", reason: "wrong_research_type", axis_reason: "paradigm:epidemiology" })).toBe(true);
    expect(sameLabel({ tier: "poor", reason: "wrong_research_type", axis_reason: "paradigm:epidemiology" }, { tier: "poor", reason: "wrong_research_type", axis_reason: null })).toBe(false);
    expect(sameLabel(null, { tier: "poor", reason: null, axis_reason: null })).toBe(false);
  });
});
