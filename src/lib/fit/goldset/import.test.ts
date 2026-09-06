import { describe, expect, it } from "vitest";
import { csvRowFor, type CsvRow } from "@/lib/fit/goldset/csv";
import { PAIR } from "@/lib/fit/goldset/test-fixtures";
import { planImport, type ImportLabelers } from "@/lib/fit/goldset/import";
import type { GoldLabelRow } from "@/lib/fit/goldset/labels";
import type { ManifestPair } from "@/lib/fit/goldset/manifest";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";
const labelers: ImportLabelers = { a: A, b: B, adjudicator: C };

const PAIR2: ManifestPair = { ...PAIR, id: "g002", opportunity_id: "8b1c6b5e-4e0d-4c2a-9c7f-2f5f6a1b3c4d", stratum: "current" };
const pairsById = new Map([[PAIR.id, PAIR], [PAIR2.id, PAIR2]]);

const csv = (pair: ManifestPair, labels: Parameters<typeof csvRowFor>[1]): CsvRow => csvRowFor(pair, labels);

function stored(over: Partial<GoldLabelRow> & { labeler: string; tier: string }): GoldLabelRow {
  return { id: `s-${over.labeler.slice(0, 2)}-${over.tier}`, investigator_id: PAIR.investigator_id, opportunity_id: PAIR.opportunity_id, reason: null, axis_reason: null, engine_version: "engine-1", source: "gold", created_at: "2026-09-10T00:00:00.000Z", ...over };
}

describe("goldset/import · planImport", () => {
  it("agreement: one row per labeler plus the adjudicated row under the adjudicator, carrying the agreed tier and A's reason", () => {
    const plan = planImport({ rows: [csv(PAIR, { a: { tier: "poor", reason: "wrong_type", axis_reason: "paradigm:epidemiology" }, b: { tier: "Poor", reason: "not relevant", axis_reason: "" } })], pairsById, labelers, existing: [], engine_version: "engine-1" });
    expect(plan.errors).toEqual([]);
    expect(plan.rows.map((r) => [r.slot, r.kind, r.tier, r.reason, r.axis_reason, r.action])).toEqual([
      ["a", "label", "poor", "wrong_type", "paradigm:epidemiology", "insert"],
      ["b", "label", "poor", "not_relevant", null, "insert"],
      ["adjudicator", "adjudicated", "poor", "wrong_type", "paradigm:epidemiology", "insert"],
    ]);
    expect(plan.rows[2]!.labeler).toBe(C);
    expect(plan.adjudication).toMatchObject({ agreed: 1, by_adjudicator: 0, unresolved: [], pending: [] });
    expect(plan.per_slot.a).toEqual({ labeled: 1, inserts: 1, unchanged: 0 });
    expect(plan.per_slot.adjudicator.labeled).toBe(0);
  });

  it("disagreement: the adjudicator's column decides and is the only adjudicator row; without it the pair is unresolved", () => {
    const decided = planImport({ rows: [csv(PAIR, { a: { tier: "strong", reason: "", axis_reason: "" }, b: { tier: "moderate", reason: "", axis_reason: "" }, adj: { tier: "moderate", reason: "", axis_reason: "" } })], pairsById, labelers, existing: [], engine_version: "engine-1" });
    expect(decided.rows.filter((r) => r.slot === "adjudicator")).toHaveLength(1);
    expect(decided.rows.find((r) => r.slot === "adjudicator")).toMatchObject({ kind: "label", tier: "moderate" });
    expect(decided.adjudication.by_adjudicator).toBe(1);
    const open = planImport({ rows: [csv(PAIR, { a: { tier: "strong", reason: "", axis_reason: "" }, b: { tier: "potential", reason: "", axis_reason: "" } })], pairsById, labelers, existing: [], engine_version: "engine-1" });
    expect(open.rows).toHaveLength(2);
    expect(open.adjudication.unresolved).toEqual(["g001"]);
    expect(open.rows[1]).toMatchObject({ slot: "b", tier: "moderate" });
  });

  it("one label is pending; an empty row is unlabeled", () => {
    const plan = planImport({ rows: [csv(PAIR, { a: { tier: "strong", reason: "", axis_reason: "" } }), csv(PAIR2, {})], pairsById, labelers, existing: [], engine_version: "engine-1" });
    expect(plan.rows).toHaveLength(1);
    expect(plan.adjudication).toMatchObject({ pending: ["g001"], unlabeled: 1 });
  });

  it("validates every label and blocks the row: bad tier, missing reason, bad axis, reason without tier, unknown pair, mismatched ids, duplicates", () => {
    const rows: CsvRow[] = [
      csv(PAIR, { a: { tier: "great", reason: "", axis_reason: "" } }),
      csv(PAIR2, { a: { tier: "exploratory", reason: "", axis_reason: "" }, b: { tier: "poor", reason: "wrong_type", axis_reason: "paradigm:nope" } }),
      { ...csv(PAIR, { b: { tier: "", reason: "not_relevant", axis_reason: "" } }), pair_id: "g001" },
      { ...csv(PAIR, {}), pair_id: "g999" },
      { ...csv(PAIR2, { a: { tier: "strong", reason: "", axis_reason: "" } }), investigator_id: "00000000-0000-4000-8000-000000000000" },
    ];
    const plan = planImport({ rows, pairsById, labelers, existing: [], engine_version: "engine-1" });
    expect(plan.rows).toEqual([]);
    expect(plan.errors.map((e) => e.message)).toEqual([
      expect.stringMatching(/g001 a: Tier "great"/),
      expect.stringMatching(/g002 a: Exploratory labels need a reason/),
      expect.stringMatching(/g002 b: "nope" is not a paradigm category/),
      expect.stringMatching(/g001 appears more than once/),
      expect.stringMatching(/g999 is not in the manifest/),
      expect.stringMatching(/g002 appears more than once/),
    ]);
    expect(plan.unknown_pairs).toEqual(["g999"]);
    const mismatch = planImport({ rows: [{ ...csv(PAIR2, { a: { tier: "strong", reason: "", axis_reason: "" } }), investigator_id: "00000000-0000-4000-8000-000000000000" }], pairsById, labelers, existing: [], engine_version: "engine-1" });
    expect(mismatch.errors[0]!.message).toMatch(/ids do not match the manifest/);
    const reasonOnly = planImport({ rows: [csv(PAIR, { b: { tier: "", reason: "not_relevant", axis_reason: "" } })], pairsById, labelers, existing: [], engine_version: "engine-1" });
    expect(reasonOnly.errors[0]!.message).toMatch(/g001 b: a reason without a tier/);
  });

  it("is idempotent: rows identical to the latest stored ones are unchanged, so a re-import plans no insert", () => {
    const existing = [
      stored({ labeler: A, tier: "poor", reason: "wrong_type", axis_reason: "paradigm:epidemiology" }),
      stored({ labeler: B, tier: "poor", reason: "not_relevant" }),
      stored({ labeler: C, tier: "poor", reason: "wrong_type", axis_reason: "paradigm:epidemiology" }),
      stored({ labeler: A, tier: "strong", created_at: "2026-09-01T00:00:00.000Z" }), // older row, superseded
    ];
    const plan = planImport({ rows: [csv(PAIR, { a: { tier: "poor", reason: "wrong_type", axis_reason: "paradigm:epidemiology" }, b: { tier: "poor", reason: "not_relevant", axis_reason: "" } })], pairsById, labelers, existing, engine_version: "engine-1" });
    expect(plan.inserts).toBe(0);
    expect(plan.unchanged).toBe(3);
    const changed = planImport({ rows: [csv(PAIR, { a: { tier: "exploratory", reason: "not_relevant", axis_reason: "" }, b: { tier: "poor", reason: "not_relevant", axis_reason: "" } })], pairsById, labelers, existing, engine_version: "engine-1" });
    expect(changed.rows.map((r) => [r.slot, r.action])).toEqual([["a", "insert"], ["b", "unchanged"]]);
    expect(changed.adjudication.unresolved).toEqual(["g001"]);
  });
});
