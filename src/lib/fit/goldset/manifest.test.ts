import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { forbiddenCellPairs } from "@/lib/fit/engine/fixtures";
import { CSV_COLUMNS, LABEL_COLUMNS, parseCsv, SYNTHETIC_MARK } from "@/lib/fit/goldset/csv";
import { EXCERPT_MAX } from "@/lib/fit/goldset/excerpt";
import { cellKey, forbiddenCellKeys, isMatrixFamilySlot } from "@/lib/fit/goldset/families";
import { LEGACY_SHOWN_TOP_N, LEGACY_TOP_HITS } from "@/lib/fit/goldset/legacy";
import { diffManifestPairs, GOLDSET_CSV_PATH, GOLDSET_MANIFEST, LABELER_CONFIG, manifestPairById, manifestPairByKey } from "@/lib/fit/goldset/manifest";
import { GOLDSET_QUOTAS, isSyntheticId, SPEC_STRATA, STRATA } from "@/lib/fit/goldset/stratify";
import { SYNTHETIC_CASES } from "@/lib/fit/goldset/synthetic";

/**
 * The committed gold set v1 (docs/fit-engine/goldset): the invariants the
 * page and the scripts rely on. The literals below are THE MANIFEST'S OWN
 * (its seed, its taxonomy and engine versions, its counts), not the
 * current TAXONOMY_VERSION or ENGINE_VERSION: the versioned set is frozen
 * (goldset/manifest.ts) — a taxonomy or engine bump does not redraw it, a
 * new draw is a new version — so this test pins what was written, and
 * fails only when the file itself changes.
 */
describe("goldset/manifest · goldset-v1", () => {
  const m = GOLDSET_MANIFEST;

  it("is the versioned set drawn from seed 1 under taxonomy fit-v1 / engine engine-1: the 200 plus the 28-pair fit-v1 stratum", () => {
    expect(m.version).toBe("v1");
    expect(m.seed).toBe(1);
    expect(m.generated_at).toBe("2026-09-06T20:48:45.091Z");
    expect(m.taxonomy_version).toBe("fit-v1");
    expect(m.engine_version).toBe("engine-1");
    expect(m.quotas).toEqual(GOLDSET_QUOTAS);
    expect(m.counts).toEqual({ current: 80, adversarial: 60, random: 40, dropped: 20, fit_v1: 28 });
    expect(m.pairs).toHaveLength(228);
    expect(m.shortfalls).toEqual([]);
    expect(m.legacy).toEqual({ sim: { strong: 0.5, potential: 0.45, exploratory: 0.4, support: 0.42 }, top_hits: LEGACY_TOP_HITS, shown_top_n: LEGACY_SHOWN_TOP_N, evidence_items: 6 });
    expect(m.corpus).toEqual({ investigators: 144, notices: 436, investigators_with_vector: 141, notices_with_vector: 436, legacy_candidates: 1305, evidence_vectors: 7462, fit_results_available: true, outreach_snapshots: 110 });
  });

  it("pair ids run g001…g228 and no pair repeats", () => {
    expect(m.pairs.map((p) => p.id)).toEqual(Array.from({ length: 228 }, (_, i) => `g${String(i + 1).padStart(3, "0")}`));
    expect(manifestPairByKey(m).size).toBe(228);
    expect(manifestPairById(m).size).toBe(228);
    expect(diffManifestPairs(m, m)).toMatchObject({ added: [], removed: [], kept: 228 });
  });

  it("strata match the counts, the four spec strata come first and the fit-v1 stratum last", () => {
    for (const s of STRATA) expect(m.pairs.filter((p) => p.stratum === s)).toHaveLength(m.counts[s]);
    expect(m.pairs.slice(0, 200).every((p) => (SPEC_STRATA as readonly string[]).includes(p.stratum))).toBe(true);
    expect(m.pairs.slice(200).every((p) => p.stratum === "fit_v1")).toBe(true);
    const shape: Record<string, RegExp> = { current: /^(outreach|legacy):(strong|potential)$/, adversarial: /^(cell:[a-z_]+->[a-z_]+|synthetic:.+)$/, random: /^random$/, dropped: /^thin$/, fit_v1: /^fit_v1:(strong|moderate)$/ };
    for (const p of m.pairs) expect(p.at_export.source).toMatch(shape[p.stratum]!);
  });

  it("current: 80 legacy-only pairs — Strong and Potential half each, Outreach snapshots or the page's top 5, nothing drawn for fit-v1", () => {
    const current = m.pairs.filter((p) => p.stratum === "current");
    expect(m.current_mix).toEqual({
      pool: { "outreach:strong": 3, "legacy:strong": 106, "outreach:potential": 10, "legacy:potential": 155 },
      drawn: { "outreach:strong": 3, "legacy:strong": 37, "outreach:potential": 8, "legacy:potential": 32 },
    });
    for (const p of current) {
      const a = p.at_export;
      expect(a.source.startsWith("fit_v1")).toBe(false);
      if (a.source.startsWith("legacy:")) {
        expect(a.legacy_rank).not.toBeNull();
        expect(a.legacy_rank!).toBeLessThanOrEqual(LEGACY_SHOWN_TOP_N);
        expect(a.source).toBe(`legacy:${a.legacy_tier}`);
      } else expect(a.source).toBe(`outreach:${a.outreach_tier}`);
    }
    expect(current.filter((p) => p.at_export.source.endsWith(":strong"))).toHaveLength(40);
    expect(current.filter((p) => p.at_export.source.endsWith(":potential"))).toHaveLength(40);
  });

  it("adversarial: two pairs in every one of the 30 off-diagonal cells — 40 real, 20 synthetic from the fixture for the ten cells the roster cannot fill", () => {
    const adversarial = m.pairs.filter((p) => p.stratum === "adversarial");
    const covered = new Map(m.cells.covered.map((c) => [c.key, c]));
    for (const p of adversarial) {
      expect(isMatrixFamilySlot(p.cell.investigator) && isMatrixFamilySlot(p.cell.notice) && p.cell.investigator !== p.cell.notice).toBe(true);
      expect(covered.get(cellKey(p.cell.investigator, p.cell.notice))).toMatchObject({ pairs: 2, synthetic: p.synthetic });
    }
    expect(m.cells.covered).toHaveLength(30);
    expect(m.cells.uncovered).toEqual([]);
    expect(m.cells).toMatchObject({ forbidden_total: 8, forbidden_covered: 8, synthetic: 10 });
    const forbidden = forbiddenCellKeys(forbiddenCellPairs());
    for (const p of m.pairs) expect(p.forbidden).toBe(forbidden.has(cellKey(p.cell.investigator, p.cell.notice)));
    const synthetic = adversarial.filter((p) => p.synthetic);
    expect(synthetic).toHaveLength(20);
    expect(m.pairs.filter((p) => p.synthetic)).toHaveLength(20);
    expect(m.synthetic_investigators.map((s) => [s.source, s.family, s.pairs])).toEqual(SYNTHETIC_CASES.map((c) => [c.case, c.family, 10]));
    for (const p of synthetic) {
      expect(isSyntheticId(p.investigator_id)).toBe(true);
      expect(p.synthetic_source).toBe(p.investigator_id.slice("synthetic:".length));
      expect(p.at_export).toEqual({ fit_v1_tier: null, legacy_tier: "dropped", legacy_rank: null, legacy_similarity: null, outreach_tier: null, source: `synthetic:${p.synthetic_source}` });
      expect(p.investigator.name).toMatch(/\(synthetic\)$/);
      expect(p.investigator.evidence[0]).toMatch(/^Paradigm \(recent\):/);
      expect(p.investigator.evidence_vectors).toBe(0);
      expect(["population", "health_systems"]).toContain(p.cell.investigator);
    }
    for (const p of m.pairs.filter((p) => !p.synthetic)) expect(p.synthetic_source).toBeNull();
  });

  it("random pairs are at or above the floor whatever their rank; the fit-v1 stratum is every stored Strong / Moderate pair", () => {
    for (const p of m.pairs.filter((p) => p.stratum === "random")) expect(p.at_export.legacy_similarity!).toBeGreaterThanOrEqual(m.legacy.sim.exploratory!);
    expect(m.fit_v1_mix).toEqual({ pool: { "fit_v1:strong": 0, "fit_v1:moderate": 28 }, drawn_elsewhere: 0, supplementary: 28 });
    for (const p of m.pairs.filter((p) => p.stratum === "fit_v1")) expect(p.at_export.fit_v1_tier).toBe("moderate");
  });

  it("the grid tallies behind the 30 % rule are the page's window over the candidate set and the stored fit_results over the corpus", () => {
    expect(m.legacy_grid).toEqual({ investigators: 141, candidates: 1305, pairs: 187920, strong: 315, potential: 379, exploratory: 6, not_shown: 2008, dropped: 185212, shown_outside_corpus: 436 });
    expect(m.legacy_grid.strong + m.legacy_grid.potential + m.legacy_grid.exploratory).toBeLessThanOrEqual(m.legacy_grid.investigators * LEGACY_SHOWN_TOP_N);
    expect(m.fit_results_grid).toEqual({ investigators: 144, notices: 436, pairs: 62784, strong: 0, moderate: 28, exploratory: 3066, poor: 50912, none: 8778 });
  });

  it("every pair carries what a labeler needs: a name, a dominant paradigm, a notice number and title, a designation and an excerpt within the limit", () => {
    for (const p of m.pairs) {
      expect(p.investigator.name).toBeTruthy();
      expect(p.investigator.dominant.label).toBeTruthy();
      expect(p.notice.number).toBeTruthy();
      expect(p.notice.title).toBeTruthy();
      expect(p.notice.designation).toBeTruthy();
      expect(p.notice.excerpt.length).toBeLessThanOrEqual(EXCERPT_MAX);
      if (!p.synthetic) expect(p.investigator.evidence.length).toBeLessThanOrEqual(3);
      expect(["strong", "moderate", "exploratory", "poor", null]).toContain(p.at_export.fit_v1_tier);
      expect(["strong", "potential", "exploratory", "not_shown", "dropped"]).toContain(p.at_export.legacy_tier);
      if (p.at_export.legacy_rank !== null) expect(p.at_export.legacy_rank).toBeLessThanOrEqual(LEGACY_TOP_HITS);
    }
    expect(m.pairs.filter((p) => p.notice.excerpt)).toHaveLength(228);
  });

  it("the dropped stratum comes from the thinnest profiles (highest cosine under the floor, deterministic) and both engines dropped every pair at export", () => {
    const dropped = m.pairs.filter((p) => p.stratum === "dropped");
    for (const p of dropped) {
      expect(p.at_export.legacy_tier).toBe("dropped");
      expect(p.at_export.legacy_similarity === null || p.at_export.legacy_similarity < m.legacy.sim.exploratory!).toBe(true);
      expect(p.at_export.fit_v1_tier === null || p.at_export.fit_v1_tier === "poor").toBe(true);
      expect(p.at_export.source).toBe("thin");
    }
    expect(m.dropped_investigators).toHaveLength(20);
    const counts = m.dropped_investigators.map((d) => d.item_count);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(counts[0]).toBe(3);
  });

  it("the CSV beside it has the same pairs in order, the synthetic mark set, the label columns empty", () => {
    const parsed = parseCsv(readFileSync(GOLDSET_CSV_PATH, "utf8"));
    expect(parsed.errors).toEqual([]);
    expect(parsed.missing_columns).toEqual([]);
    expect(parsed.rows.map((r) => r.pair_id)).toEqual(m.pairs.map((p) => p.id));
    expect(parsed.rows.map((r) => r.opportunity_id)).toEqual(m.pairs.map((p) => p.opportunity_id));
    expect(parsed.rows.map((r) => r.synthetic)).toEqual(m.pairs.map((p) => (p.synthetic ? SYNTHETIC_MARK : "")));
    for (const r of parsed.rows) for (const c of LABEL_COLUMNS) expect(r[c]).toBe("");
    expect(readFileSync(GOLDSET_CSV_PATH, "utf8").split("\n")[0]).toBe(CSV_COLUMNS.join(","));
  });

  it("labelers.json is present with three slots (null until D4)", () => {
    expect(Object.keys(LABELER_CONFIG).sort()).toEqual(["a", "adjudicator", "b"]);
  });
});
