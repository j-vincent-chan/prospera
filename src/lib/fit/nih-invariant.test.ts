/**
 * The NIH invariant, enforced by the suite (PR 5.0a).
 *
 * NON_NIH_PLAN § "The NIH invariant" requires that every Phase 5 PR keeps
 * `npm run fit:nih-invariant -- --verify --offline` green, and PR 5.1's
 * acceptance says the rendered prompt for every NIH fixture being byte-identical
 * "is a test, not a review note". This is that test: it runs the same pure check
 * the script's `--offline` mode runs, so a change to `sectionLabel()`, a group
 * schema, the quote reminder, `groupSections`, `chunkSections`, the engine or
 * `bm25StatsFor` fails here rather than being noticed later.
 *
 * A failure is not a fixture to update. It means an NIH notice's extraction
 * cache key or score has moved, which silently re-extracts the corpus with a
 * strong model and produces new profiles. Bring the diff to a person.
 */
import { describe, expect, it } from "vitest";
import { canonical, h, stable, verifyOffline } from "@/lib/fit/nih-invariant";

describe("NIH invariant (offline)", () => {
  it("every fixture prompt, cache key and sampled pair score is unchanged", () => {
    const { diffs, fixtures, pairs } = verifyOffline();

    expect(fixtures, "no prompt fixtures in the baseline").toBeGreaterThan(0);
    expect(pairs, "no scored pairs in the baseline").toBeGreaterThan(0);

    // The message carries the first few differences so a failure is readable
    // without re-running the script.
    const report = diffs
      .slice(0, 10)
      .map((d) => `  ${d.subject} · ${d.path}\n    baseline: ${d.baseline}\n    now:      ${d.current}`)
      .join("\n");
    expect(
      diffs.length,
      diffs.length === 0
        ? ""
        : `${diffs.length} difference(s) from docs/fit-engine/nih-baseline — the NIH invariant is broken:\n${report}\n` +
          `Run \`npm run fit:nih-invariant -- --verify\` for the corpus-wide diff. Do not recapture the baseline to make this pass.`,
    ).toBe(0);
  });
});

describe("canonicalisation", () => {
  it("is stable under key order", () => {
    expect(stable({ b: 1, a: 2 })).toBe(stable({ a: 2, b: 1 }));
  });

  it("drops clock readings, so a re-read row hashes the same", () => {
    expect(h({ x: 1, computed_at: "2026-01-01T00:00:00Z" })).toBe(h({ x: 1, computed_at: "2027-06-06T12:00:00Z" }));
    expect(h({ x: 1 })).toBe(h({ x: 1, updated_at: "anything" }));
  });

  it("fixes floats to 6 dp, so drift below that is not a difference", () => {
    expect(stable({ s: 0.1234567891 })).toBe(stable({ s: 0.123456789 }));
    expect(stable({ s: 0.1234565 })).not.toBe(stable({ s: 0.1234575 }));
  });

  it("distinguishes -0 from 0 nowhere, and keeps integers exact", () => {
    expect(stable({ s: -0 })).toBe(stable({ s: 0 }));
    expect(canonical({ n: 54017 })).toEqual({ n: 54017 });
  });

  it("does not confuse a missing key with a null one at the top level", () => {
    // Both canonicalise to null: the harness compares presence separately, via
    // compareKeyed's membership check, so this is deliberate.
    expect(stable({ a: null })).toBe(stable({ a: undefined }));
  });
});
