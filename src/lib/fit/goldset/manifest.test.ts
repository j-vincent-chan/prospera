import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { forbiddenCellPairs } from "@/lib/fit/engine/fixtures";
import { CSV_COLUMNS, LABEL_COLUMNS, parseCsv } from "@/lib/fit/goldset/csv";
import { EXCERPT_MAX } from "@/lib/fit/goldset/excerpt";
import { cellKey, forbiddenCellKeys, isMatrixFamilySlot } from "@/lib/fit/goldset/families";
import { GOLDSET_CSV_PATH, GOLDSET_MANIFEST, LABELER_CONFIG, manifestPairById, manifestPairByKey } from "@/lib/fit/goldset/manifest";
import { GOLDSET_QUOTAS, STRATA } from "@/lib/fit/goldset/stratify";
import { TAXONOMY_VERSION } from "@/lib/fit/taxonomy";

/** The committed gold set v1 (docs/fit-engine/goldset): the invariants the page and the scripts rely on. */
describe("goldset/manifest · goldset-v1", () => {
  const m = GOLDSET_MANIFEST;

  it("is the versioned 200-pair set drawn from seed 1 under the current taxonomy", () => {
    expect(m.version).toBe("v1");
    expect(m.seed).toBe(1);
    expect(m.taxonomy_version).toBe(TAXONOMY_VERSION);
    expect(m.engine_version).toBe("engine-1");
    expect(m.quotas).toEqual(GOLDSET_QUOTAS);
    expect(m.counts).toEqual(GOLDSET_QUOTAS);
    expect(m.pairs).toHaveLength(200);
    expect(m.shortfalls).toEqual([]);
  });

  it("pair ids run g001…g200 and no pair repeats", () => {
    expect(m.pairs.map((p) => p.id)).toEqual(Array.from({ length: 200 }, (_, i) => `g${String(i + 1).padStart(3, "0")}`));
    expect(manifestPairByKey(m).size).toBe(200);
    expect(manifestPairById(m).size).toBe(200);
  });

  it("strata match the quotas and every adversarial pair sits in a coverable off-diagonal cell", () => {
    for (const s of STRATA) expect(m.pairs.filter((p) => p.stratum === s)).toHaveLength(GOLDSET_QUOTAS[s]);
    const adversarial = m.pairs.filter((p) => p.stratum === "adversarial");
    const covered = new Map(m.cells.covered.map((c) => [c.key, c]));
    for (const p of adversarial) {
      expect(isMatrixFamilySlot(p.cell.investigator) && isMatrixFamilySlot(p.cell.notice) && p.cell.investigator !== p.cell.notice).toBe(true);
      expect(covered.has(cellKey(p.cell.investigator, p.cell.notice))).toBe(true);
    }
    expect(m.cells.covered.reduce((s, c) => s + c.pairs, 0)).toBe(GOLDSET_QUOTAS.adversarial);
    expect(m.cells.covered.length + m.cells.uncovered.length).toBe(30);
    expect(m.cells.forbidden_total).toBe(8);
    const forbidden = forbiddenCellKeys(forbiddenCellPairs());
    for (const p of m.pairs) expect(p.forbidden).toBe(forbidden.has(cellKey(p.cell.investigator, p.cell.notice)));
    for (const c of m.cells.uncovered) expect(c.reason).toMatch(/no investigator on the roster|no open notice|already drawn/);
  });

  it("every pair carries what a labeler needs: a name, a dominant paradigm, a notice number and title, a designation and an excerpt within the limit", () => {
    for (const p of m.pairs) {
      expect(p.investigator.name).toBeTruthy();
      expect(p.investigator.dominant.label).toBeTruthy();
      expect(p.notice.number).toBeTruthy();
      expect(p.notice.title).toBeTruthy();
      expect(p.notice.designation).toBeTruthy();
      expect(p.notice.excerpt.length).toBeLessThanOrEqual(EXCERPT_MAX);
      expect(p.investigator.evidence.length).toBeLessThanOrEqual(3);
      expect(["strong", "moderate", "exploratory", "poor", null]).toContain(p.at_export.fit_v1_tier);
      expect(["strong", "potential", "exploratory", "dropped"]).toContain(p.at_export.legacy_tier);
    }
    expect(m.pairs.filter((p) => p.notice.excerpt).length).toBeGreaterThan(190);
  });

  it("the dropped stratum comes from the thinnest profiles and both engines dropped every pair at export", () => {
    const dropped = m.pairs.filter((p) => p.stratum === "dropped");
    for (const p of dropped) {
      expect(p.at_export.legacy_tier).toBe("dropped");
      expect(p.at_export.fit_v1_tier === null || p.at_export.fit_v1_tier === "poor").toBe(true);
    }
    expect(m.dropped_investigators.length).toBeGreaterThan(0);
    const counts = m.dropped_investigators.map((d) => d.item_count);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
  });

  it("the CSV beside it has the same pairs in order, the label columns empty", () => {
    const parsed = parseCsv(readFileSync(GOLDSET_CSV_PATH, "utf8"));
    expect(parsed.errors).toEqual([]);
    expect(parsed.missing_columns).toEqual([]);
    expect(parsed.rows.map((r) => r.pair_id)).toEqual(m.pairs.map((p) => p.id));
    expect(parsed.rows.map((r) => r.opportunity_id)).toEqual(m.pairs.map((p) => p.opportunity_id));
    for (const r of parsed.rows) for (const c of LABEL_COLUMNS) expect(r[c]).toBe("");
    expect(readFileSync(GOLDSET_CSV_PATH, "utf8").split("\n")[0]).toBe(CSV_COLUMNS.join(","));
  });

  it("labelers.json is present with three slots (null until D4)", () => {
    expect(Object.keys(LABELER_CONFIG).sort()).toEqual(["a", "adjudicator", "b"]);
  });
});
