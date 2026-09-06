/**
 * The six item-classifier fixtures (docs/fit-engine/prompts/item-classifier.md
 * › Fixture items) as typed data, plus the expectation check shared by
 * `index.test.ts` (mocked model) and `scripts/fit-classify-fixtures.ts`
 * (real endpoint). Text and expectations live in
 * src/lib/fit/__fixtures__/item-classifier-fixtures.json.
 */
import fixtureJson from "@/lib/fit/__fixtures__/item-classifier-fixtures.json";
import { AXES, type Axis, type AxisWeights, type NormalizedItem, type NormalizedItemKind } from "@/lib/fit/classify/contracts";

/** Per-axis expectation: `min` = value ≥ n; `present` = value ≥ present_min; `any` = at least one id present. */
export type AxisExpectation = { min?: Record<string, number>; present?: string[]; any?: string[] };

/** The spec's expectations for one fixture; `absent` ids must be missing or ≤ absent_max. */
export type FixtureExpectation = Partial<Record<Axis, AxisExpectation>> & { absent?: Partial<Record<Axis, string[]>> };

export type ItemClassifierFixture = {
  n: number;
  id: string;
  kind: NormalizedItemKind;
  title: string;
  year: number;
  mesh_names: string[];
  text: string;
  expect: FixtureExpectation;
  /** The mocked model reply that satisfies `expect`. */
  model_output: Record<string, unknown>;
};

export type FixtureThresholds = { present_min: number; absent_max: number };

type FixtureFile = { thresholds: FixtureThresholds; items: ItemClassifierFixture[] };

const file = fixtureJson as unknown as FixtureFile;

export const FIXTURE_THRESHOLDS: FixtureThresholds = file.thresholds;
export const ITEM_CLASSIFIER_FIXTURES: readonly ItemClassifierFixture[] = file.items;

/** The fixture as the `NormalizedItem` the classifier consumes (no MeSH, no publication types — prose only). */
export function fixtureItem(f: ItemClassifierFixture): NormalizedItem {
  return {
    id: f.id,
    kind: f.kind,
    title: f.title,
    text: f.text,
    year: f.year,
    role: null,
    mesh: f.mesh_names.map((name) => ({ ui: "", name, major: false, qualifiers: [] })),
    publication_types: [],
    signals: {},
  };
}

export type AxisCheck = {
  axis: Axis;
  /** False when any expectation on the axis is unmet. */
  ok: boolean;
  /** True when the spec states an expectation for this axis. */
  expected: boolean;
  /** One line per unmet (or, for the report, met) condition. */
  notes: string[];
};

const show = (p: number | undefined) => (p === undefined ? "missing" : p.toFixed(2));

/** Pure. Every axis, with the spec's expectations checked against the classified values. */
export function checkAxes(axes: AxisWeights, expect: FixtureExpectation, thresholds: FixtureThresholds = FIXTURE_THRESHOLDS): AxisCheck[] {
  return AXES.map((axis) => {
    const values = axes[axis] ?? {};
    const e = expect[axis] ?? {};
    const absent = expect.absent?.[axis] ?? [];
    const notes: string[] = [];
    let ok = true;
    let expected = false;
    for (const [id, min] of Object.entries(e.min ?? {})) {
      expected = true;
      const p = values[id];
      if (p === undefined || p < min) {
        ok = false;
        notes.push(`${id} ${show(p)} < ${min}`);
      } else notes.push(`${id} ${show(p)} ≥ ${min}`);
    }
    for (const id of e.present ?? []) {
      expected = true;
      const p = values[id];
      if (p === undefined || p < thresholds.present_min) {
        ok = false;
        notes.push(`${id} ${show(p)} not present (< ${thresholds.present_min})`);
      } else notes.push(`${id} ${show(p)} present`);
    }
    if (e.any?.length) {
      expected = true;
      const hit = e.any.filter((id) => (values[id] ?? 0) >= thresholds.present_min);
      if (hit.length === 0) {
        ok = false;
        notes.push(`none of ${e.any.join(" / ")} present (${e.any.map((id) => `${id} ${show(values[id])}`).join(", ")})`);
      } else notes.push(`${hit.map((id) => `${id} ${show(values[id])}`).join(", ")} present (any of ${e.any.join(" / ")})`);
    }
    for (const id of absent) {
      expected = true;
      const p = values[id];
      if (p !== undefined && p > thresholds.absent_max) {
        ok = false;
        notes.push(`${id} ${show(p)} should be absent (> ${thresholds.absent_max})`);
      } else notes.push(`${id} ${show(p)} absent`);
    }
    return { axis, ok, expected, notes };
  });
}

/** One line per axis for the report: `paradigm: OK — clinical_trials 0.95 ≥ 0.8`. */
export function formatAxisCheck(c: AxisCheck): string {
  if (!c.expected) return `${c.axis}: (no expectation)`;
  return `${c.axis}: ${c.ok ? "OK" : "MISS"} — ${c.notes.join("; ")}`;
}
