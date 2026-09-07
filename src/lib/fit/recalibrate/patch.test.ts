import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { forbiddenCellPairs } from "@/lib/fit/engine/fixtures";
import { numberAtPath } from "@/lib/fit/recalibrate/override";
import { deltas, parameterById, recalibrationParameters, shippedVector, type ParameterVector } from "@/lib/fit/recalibrate/parameters";
import { applyUnifiedDiff, formatLike, patchTaxonomyText, proposedPatch, unifiedDiff, verifyPatch } from "@/lib/fit/recalibrate/patch";

const TAXONOMY_PATH = "src/lib/fit/taxonomy.json";
const text = readFileSync(TAXONOMY_PATH, "utf8");
const params = recalibrationParameters(forbiddenCellPairs());
const shipped = shippedVector(params);
const move = (v: ParameterVector): ParameterVector => ({ ...shipped, ...v });

const changedLines = (before: string, after: string): Array<[number, string, string]> => {
  const a = before.split("\n");
  const b = after.split("\n");
  return a.flatMap((line, i) => (line === b[i] ? [] : [[i + 1, line, b[i]!] as [number, string, string]]));
};

describe("formatLike", () => {
  it("keeps the literal's decimal places, widening only when that would round", () => {
    expect(formatLike("0.75", 0.8)).toBe("0.80");
    expect(formatLike("1.00", 0.7)).toBe("0.70");
    expect(formatLike("0.4", 0.35)).toBe("0.35");
    expect(formatLike("3", 4)).toBe("4");
  });
});

describe("the proposed patch is textual", () => {
  it("moves one floor and touches nothing else in the file", () => {
    const patched = patchTaxonomyText(text, deltas(params, move({ "tiers.strong.P": 0.7 })));
    const changed = changedLines(text, patched);
    expect(changed).toHaveLength(1);
    expect(changed[0]![1]).toContain(`"P": 0.75`);
    expect(changed[0]![2]).toContain(`"P": 0.70`);
    // the rest of the line — E, U, D, T, M, K, the comments — is untouched
    expect(changed[0]![2].replace(`"P": 0.70`, `"P": 0.75`)).toBe(changed[0]![1]);
    expect(patched.split("\n")).toHaveLength(text.split("\n").length);
  });

  it("writes two floors on one line", () => {
    const patched = patchTaxonomyText(text, deltas(params, move({ "tiers.strong.P": 0.7, "tiers.strong.U": 0.65 })));
    const changed = changedLines(text, patched);
    expect(changed).toHaveLength(1);
    expect(changed[0]![2]).toContain(`"P": 0.70`);
    expect(changed[0]![2]).toContain(`"U": 0.65`);
  });

  it("writes both cells of a symmetric matrix parameter, and keeps the row shape", () => {
    const patched = patchTaxonomyText(text, deltas(params, move({ "paradigm.family_compat.discovery↔clinical": 0.3 })));
    const changed = changedLines(text, patched);
    expect(changed).toHaveLength(2);
    expect(changed[0]![1].trim()).toBe("[1.00, 0.70, 0.40, 0.15, 0.05, 0.05],");
    expect(changed[0]![2].trim()).toBe("[1.00, 0.70, 0.40, 0.30, 0.05, 0.05],");
    expect(changed[1]![1].trim()).toBe("[0.15, 0.20, 0.60, 1.00, 0.45, 0.50],");
    expect(changed[1]![2].trim()).toBe("[0.30, 0.20, 0.60, 1.00, 0.45, 0.50],");
  });

  it("writes the paradigm gate, not the unit gate of the same name", () => {
    const patched = patchTaxonomyText(text, deltas(params, move({ "paradigm.gates.poor_below": 0.2 })));
    const changed = changedLines(text, patched);
    expect(changed).toHaveLength(1);
    expect(changed[0]![2]).toContain(`"poor_below": 0.20, "exploratory_below": 0.45`);
    expect(JSON.parse(patched).unit.gates.poor_below).toBe(0.2); // unchanged: it was already 0.20
    expect(JSON.parse(patched).paradigm.gates.poor_below).toBe(0.2);
  });

  it("refuses when the file no longer holds the value the parameter set read", () => {
    const stale = [{ parameter: parameterById(params, "tiers.strong.P"), from: 0.55, to: 0.6 }];
    expect(() => patchTaxonomyText(text, stale)).toThrow(/holds 0.75, not the 0.55/);
  });
});

describe("the unified diff", () => {
  const values = move({ "tiers.strong.P": 0.7, "unit.level_compat.L1↔L3": 0.6, "paradigm.gates.poor_below": 0.2 });
  const ds = deltas(params, values);

  it("round-trips: applied to the original it reproduces the patched file", () => {
    const { patched, diff, verification } = proposedPatch(text, ds, TAXONOMY_PATH);
    expect(diff.startsWith(`--- a/${TAXONOMY_PATH}\n+++ b/${TAXONOMY_PATH}\n@@`)).toBe(true);
    expect(applyUnifiedDiff(text, diff)).toBe(patched);
    expect(verification).toEqual({ parsed: true, paths: 4, diff_round_trips: true });
  });

  it("carries context around every hunk and one +/- pair per changed line", () => {
    const patched = patchTaxonomyText(text, ds);
    const diff = unifiedDiff(text, patched, TAXONOMY_PATH, 3);
    const body = diff.split("\n");
    expect(body.filter((l) => l.startsWith("@@"))).toHaveLength(3); // floors, the level matrix, the gate
    expect(body.filter((l) => l.startsWith("-") && !l.startsWith("---"))).toHaveLength(4); // the two mirrored matrix rows count twice
    expect(body.filter((l) => l.startsWith("+") && !l.startsWith("+++"))).toHaveLength(4);
  });

  it("yields the proposed values when the patched text is parsed", () => {
    const patched = patchTaxonomyText(text, ds);
    const parsed = JSON.parse(patched);
    expect(numberAtPath(parsed, "tiers.strong.P")).toBe(0.7);
    expect(numberAtPath(parsed, "unit.level_compat.matrix[0][2]")).toBe(0.6);
    expect(numberAtPath(parsed, "unit.level_compat.matrix[2][0]")).toBe(0.6);
    expect(numberAtPath(parsed, "paradigm.gates.poor_below")).toBe(0.2);
    // and nothing else moved
    expect(numberAtPath(parsed, "tiers.moderate.P")).toBe(numberAtPath(JSON.parse(text), "tiers.moderate.P"));
  });

  it("catches a patch that changed something the proposal does not name", () => {
    const patched = patchTaxonomyText(text, ds).replace(`"same_category": 1.00`, `"same_category": 0.90`);
    const diff = unifiedDiff(text, patched, TAXONOMY_PATH);
    expect(() => verifyPatch(text, patched, diff, ds)).toThrow(/changed values the proposal does not name/);
  });

  it("catches a diff that does not apply", () => {
    const patched = patchTaxonomyText(text, ds);
    const diff = unifiedDiff(text, patched, TAXONOMY_PATH).replace(`"P": 0.75`, `"P": 0.65`);
    expect(() => verifyPatch(text, patched, diff, ds)).toThrow(/removed line does not match|does not reproduce/);
  });

  it("is empty when nothing moved", () => {
    expect(unifiedDiff(text, text, TAXONOMY_PATH)).toBe("");
  });
});
