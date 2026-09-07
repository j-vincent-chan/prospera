/**
 * The parameter set §12's recalibration fits (plan Phase 4 ·
 * `scripts/fit-recalibrate.ts`; spec §12 "Periodically, globally":
 * "recalibrate the floors in §10 and the family/level matrices in §4
 * against the label set … a handful of parameters fit to a few hundred
 * labels — a spreadsheet-scale problem, deliberately").
 *
 * Four kinds, 44 parameters in all, every one of them a number already in
 * `taxonomy.json` and marked there as a prior:
 *
 *   floor        18 · the numeric floors of `tiers.strong`, `tiers.moderate`
 *                     and `tiers.exploratory` (§10 table). `T_specific_depth`
 *                     (a MeSH tree depth, not a [0, 1] floor) and
 *                     `gaps_allowed` (the §10 gap rule, a count) are not
 *                     fitted. Range ±0.15, step 0.05.
 *   family_cell  15 · the off-diagonal cells of `paradigm.family_compat`
 *                     (§4 "Family compatibility matrix"). The matrix is
 *                     symmetric (`_comment`: "prior · symmetric"), so one
 *                     parameter writes both [i][j] and [j][i]; the diagonal
 *                     is 1.00 by construction and is not fitted, nor is
 *                     `within_family` (same / sibling category). Range
 *                     ±0.20, step 0.05.
 *   unit_cell    10 · the off-diagonal cells of `unit.level_compat` (§4 Axis
 *                     B), symmetric the same way. Range ±0.20, step 0.05.
 *   gate          1 · `paradigm.gates.poor_below` — the §9 paradigm gate.
 *                     Range ±0.10, step 0.05.
 *
 * Held fixed on purpose, and worth knowing when reading a proposal:
 * `paradigm.gates.exploratory_below` (0.45) caps a pair at Exploratory
 * before any Moderate floor is read, so a Moderate P floor moved below it is
 * inert; the excluded-paradigm rule, `design.score`, `compose.*` and the
 * confidence caps are not §12 parameters either.
 *
 * Constraints (`violations`) are hard: a candidate vector that breaks one is
 * never evaluated. They are what keeps a fit from buying agreement with
 * incoherence —
 *   · floors stay ordered Strong ≥ Moderate ≥ Exploratory per key, and
 *     Exploratory's aspiration P floor stays at or above its P floor;
 *   · the paradigm gate stays at or below the Exploratory P floor (else a
 *     pair the §10 floors admit is capped Poor with no floor naming it) and
 *     strictly below `exploratory_below`;
 *   · a FORBIDDEN family cell (§14 "off-diagonal mass in the forbidden cells
 *     … should be zero"; §9 "No collaborator makes a mechanist a cohort
 *     epidemiologist") stays strictly under the paradigm gate, so no fit can
 *     open 1↔5, 1↔6, 2↔5 or 2↔6 however many labels ask for it. The
 *     forbidden pairs come in from the caller (`engine/fixtures.ts`
 *     `forbiddenCellPairs()`), as in `goldset/families.ts`.
 *
 * Pure: reads `taxonomy.json` through `override.ts`, writes nothing. Each
 * parameter carries the taxonomy paths it owns (for the override) and the
 * textual locator of the number in the hand-formatted file (for the proposed
 * patch, `patch.ts`) — never a JSON re-serialization.
 */
import taxonomy from "@/lib/fit/taxonomy.json";
import { isTaxonomyOverrideActive, readTaxonomyNumber } from "@/lib/fit/recalibrate/override";
import type { TaxonomyOverride } from "@/lib/fit/recalibrate/override";
import { familyLabel, levelLabel } from "@/lib/fit/taxonomy";

export type ParameterKind = "floor" | "family_cell" | "unit_cell" | "gate";

/** How the proposed patch finds the number in the hand-formatted JSON text (`patch.ts`). */
export type TextLocator =
  /** The line carrying `anchor` holds `"key": <number>`. */
  | { kind: "key"; anchor: string; key: string }
  /** The `row`-th line after the `"matrix": [` that follows `anchor`; the `col`-th number on it. */
  | { kind: "matrix_cell"; anchor: string; row: number; col: number };

export type RecalibrationParameter = {
  /** Stable id, used as the key of a parameter vector and in the report. */
  id: string;
  label: string;
  kind: ParameterKind;
  /** The taxonomy paths this parameter writes: one, or two for a symmetric matrix cell. */
  paths: readonly string[];
  /** The shipped value, read from `taxonomy.json` when the set was built. */
  current: number;
  min: number;
  max: number;
  step: number;
  /** One locator per path, in the same order: a symmetric matrix cell is written in both places in the file. */
  locators: readonly TextLocator[];
  /** Floors only: which tier and which floor key. */
  floor?: { tier: string; key: string };
  /** Matrix cells only: the two axis members and their indices. */
  cell?: { a: string; b: string; i: number; j: number };
  /** Family cells only: one of the forbidden cells (§14). */
  forbidden?: boolean;
};

/** A candidate parameter vector: every parameter id → its value. */
export type ParameterVector = Record<string, number>;

export class ParameterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParameterError";
  }
}

/** Floor keys that are not [0, 1] floors and are never fitted: a MeSH tree depth and the §10 gap count. */
export const UNFITTED_FLOOR_KEYS: readonly string[] = ["T_specific_depth", "gaps_allowed"];

/** Ranges and steps by kind (the spec calls these priors; the ranges are how far one recalibration may move them). */
export const RANGES: Record<ParameterKind, { span: number; step: number }> = {
  floor: { span: 0.15, step: 0.05 },
  family_cell: { span: 0.2, step: 0.05 },
  unit_cell: { span: 0.2, step: 0.05 },
  gate: { span: 0.1, step: 0.05 },
};

const TIER_ORDER: readonly string[] = ["strong", "moderate", "exploratory"];

const round = (x: number): number => Math.round(x * 1e6) / 1e6;
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

const FAMILY_ORDER = taxonomy.paradigm.family_compat.order as readonly string[];
const LEVEL_ORDER = taxonomy.unit.level_compat.order as readonly string[];

const FLOOR_LABEL: Record<string, string> = {
  P: "P paradigm",
  U: "U unit",
  D: "D design",
  D_required_group_min: "D required-group support",
  T: "T topic",
  M: "M methods",
  K: "K track record",
  P_with_aspiration: "P with aspiration match",
};

const tierRows = (): Record<string, Record<string, unknown>> => taxonomy.tiers as unknown as Record<string, Record<string, unknown>>;

/** The floor keys of one tier that are fitted, in taxonomy order. */
export function fittedFloorKeys(tier: string): string[] {
  const row = tierRows()[tier];
  if (!row) throw new ParameterError(`taxonomy.tiers has no ${tier} row`);
  return Object.keys(row).filter((k) => typeof row[k] === "number" && !UNFITTED_FLOOR_KEYS.includes(k));
}

function parameter(kind: ParameterKind, id: string, label: string, paths: readonly string[], locators: readonly TextLocator[], extra: Partial<RecalibrationParameter> = {}): RecalibrationParameter {
  const { span, step } = RANGES[kind];
  const current = readTaxonomyNumber(paths[0]!);
  for (const p of paths.slice(1)) {
    const mirror = readTaxonomyNumber(p);
    if (mirror !== current) throw new ParameterError(`${id}: ${paths[0]} is ${current} but ${p} is ${mirror} — the matrix is documented as symmetric`);
  }
  if (locators.length !== paths.length) throw new ParameterError(`${id}: ${paths.length} path(s) but ${locators.length} textual locator(s)`);
  return { id, label, kind, paths, current, min: round(clamp01(current - span)), max: round(clamp01(current + span)), step, locators, ...extra };
}

/**
 * The parameter set, read from `taxonomy.json` as shipped. `forbiddenCells`
 * are the §14 forbidden family cells (the caller passes
 * `engine/fixtures.ts` `forbiddenCellPairs()`, as `goldset/families.ts`
 * does), each an [investigator family, notice family] pair; the matrix is
 * symmetric, so a cell is marked forbidden when either direction is listed.
 */
export function recalibrationParameters(forbiddenCells: ReadonlyArray<readonly [string, string]>): RecalibrationParameter[] {
  if (isTaxonomyOverrideActive()) throw new ParameterError("recalibrationParameters() was called inside a taxonomy override: `current` would capture a candidate value, not the shipped one");
  const forbidden = new Set(forbiddenCells.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));
  const out: RecalibrationParameter[] = [];

  for (const tier of TIER_ORDER) {
    for (const key of fittedFloorKeys(tier)) {
      out.push(
        parameter("floor", `tiers.${tier}.${key}`, `${tier[0]!.toUpperCase()}${tier.slice(1)} floor · ${FLOOR_LABEL[key] ?? key}`, [`tiers.${tier}.${key}`], [{ kind: "key", anchor: `"${tier}":`, key }], { floor: { tier, key } })
      );
    }
  }

  for (let i = 0; i < FAMILY_ORDER.length; i += 1) {
    for (let j = i + 1; j < FAMILY_ORDER.length; j += 1) {
      const a = FAMILY_ORDER[i]!;
      const b = FAMILY_ORDER[j]!;
      out.push(
        parameter(
          "family_cell",
          `paradigm.family_compat.${a}↔${b}`,
          `Family compatibility · ${familyLabel(a)} ↔ ${familyLabel(b)}`,
          [`paradigm.family_compat.matrix[${i}][${j}]`, `paradigm.family_compat.matrix[${j}][${i}]`],
          [
            { kind: "matrix_cell", anchor: `"family_compat"`, row: i, col: j },
            { kind: "matrix_cell", anchor: `"family_compat"`, row: j, col: i },
          ],
          { cell: { a, b, i, j }, forbidden: forbidden.has(`${a}|${b}`) }
        )
      );
    }
  }

  for (let i = 0; i < LEVEL_ORDER.length; i += 1) {
    for (let j = i + 1; j < LEVEL_ORDER.length; j += 1) {
      const a = LEVEL_ORDER[i]!;
      const b = LEVEL_ORDER[j]!;
      out.push(
        parameter(
          "unit_cell",
          `unit.level_compat.${a}↔${b}`,
          `Unit compatibility · ${a} ${levelLabel(a)} ↔ ${b} ${levelLabel(b)}`,
          [`unit.level_compat.matrix[${i}][${j}]`, `unit.level_compat.matrix[${j}][${i}]`],
          [
            { kind: "matrix_cell", anchor: `"level_compat"`, row: i, col: j },
            { kind: "matrix_cell", anchor: `"level_compat"`, row: j, col: i },
          ],
          { cell: { a, b, i, j } }
        )
      );
    }
  }

  out.push(parameter("gate", "paradigm.gates.poor_below", "Paradigm gate · Poor below", ["paradigm.gates.poor_below"], [{ kind: "key", anchor: `"exploratory_below"`, key: "poor_below" }]));

  const ids = new Set<string>();
  for (const p of out) {
    if (ids.has(p.id)) throw new ParameterError(`duplicate parameter id ${p.id}`);
    ids.add(p.id);
  }
  return out;
}

/** The parameter with this id; throws when it is not in the set. */
export function parameterById(params: readonly RecalibrationParameter[], id: string): RecalibrationParameter {
  const p = params.find((x) => x.id === id);
  if (!p) throw new ParameterError(`no parameter ${id}`);
  return p;
}

/** The shipped values as a vector. */
export function shippedVector(params: readonly RecalibrationParameter[]): ParameterVector {
  return Object.fromEntries(params.map((p) => [p.id, p.current]));
}

/** The grid one parameter is searched over: `current ± k · step` inside [min, max], nearest the current value first (ties: the lower value), the current value excluded. */
export function gridValues(p: RecalibrationParameter): number[] {
  const out: number[] = [];
  const steps = Math.round((p.max - p.min) / p.step);
  for (let k = 0; k <= steps; k += 1) {
    const v = round(p.min + k * p.step);
    if (v > p.max + 1e-9 || Math.abs(v - p.current) < 1e-9) continue;
    out.push(v);
  }
  const distance = (v: number) => round(Math.abs(v - p.current));
  return out.sort((a, b) => distance(a) - distance(b) || a - b);
}

const valueOf = (params: readonly RecalibrationParameter[], values: ParameterVector, id: string): number => {
  const v = values[id];
  if (typeof v !== "number" || !Number.isFinite(v)) throw new ParameterError(`parameter vector has no value for ${id}`);
  parameterById(params, id);
  return v;
};

/**
 * Every constraint a candidate vector breaks, as sentences (empty = valid).
 * See the module docstring: ranges and grid, floor ordering, the aspiration
 * floor, the paradigm gate's two bounds, and the forbidden family cells.
 */
export function violations(params: readonly RecalibrationParameter[], values: ParameterVector): string[] {
  const out: string[] = [];
  for (const p of params) {
    const v = valueOf(params, values, p.id);
    if (v < p.min - 1e-9 || v > p.max + 1e-9) out.push(`${p.id} = ${v} is outside [${p.min}, ${p.max}]`);
    else if (Math.abs(Math.round((v - p.current) / p.step) * p.step + p.current - v) > 1e-6) out.push(`${p.id} = ${v} is off the ${p.step} grid`);
  }
  const floorAt = (tier: string, key: string): number | null => {
    const p = params.find((x) => x.floor?.tier === tier && x.floor.key === key);
    return p ? valueOf(params, values, p.id) : null;
  };
  const keys = new Set(params.flatMap((p) => (p.floor ? [p.floor.key] : [])));
  for (const key of keys) {
    for (let i = 0; i < TIER_ORDER.length - 1; i += 1) {
      const better = floorAt(TIER_ORDER[i]!, key);
      const worse = floorAt(TIER_ORDER[i + 1]!, key);
      if (better !== null && worse !== null && better < worse - 1e-9) out.push(`${TIER_ORDER[i]} ${key} ${better} is below ${TIER_ORDER[i + 1]} ${key} ${worse}: floors must not cross`);
    }
  }
  const exploratoryP = floorAt("exploratory", "P");
  const aspiration = floorAt("exploratory", "P_with_aspiration");
  if (exploratoryP !== null && aspiration !== null && aspiration < exploratoryP - 1e-9) out.push(`exploratory P_with_aspiration ${aspiration} is below exploratory P ${exploratoryP}: an aspiration match relaxes the floor, never tightens it`);

  const gateParam = params.find((p) => p.kind === "gate");
  if (gateParam) {
    const gate = valueOf(params, values, gateParam.id);
    if (exploratoryP !== null && gate > exploratoryP + 1e-9) out.push(`paradigm gate ${gate} is above the Exploratory P floor ${exploratoryP}: a pair the §10 floors admit would be capped Poor with no floor naming it`);
    const exploratoryBelow = readTaxonomyNumber("paradigm.gates.exploratory_below");
    if (gate >= exploratoryBelow - 1e-9) out.push(`paradigm gate ${gate} is not below paradigm.gates.exploratory_below ${exploratoryBelow}`);
    for (const p of params) {
      if (!p.forbidden) continue;
      const v = valueOf(params, values, p.id);
      if (v >= gate - 1e-9) out.push(`${p.id} = ${v} reaches the paradigm gate ${gate}: §14 forbidden cells must stay under it`);
    }
  }
  return out;
}

/** True when the vector breaks no constraint. */
export const isValidVector = (params: readonly RecalibrationParameter[], values: ParameterVector): boolean => violations(params, values).length === 0;

/** The overrides for a vector: one entry per parameter whose value differs from the shipped one (`override.ts`). */
export function overridesFor(params: readonly RecalibrationParameter[], values: ParameterVector): TaxonomyOverride[] {
  return params.flatMap((p) => {
    const v = valueOf(params, values, p.id);
    return Math.abs(v - p.current) < 1e-9 ? [] : [{ paths: p.paths, value: v }];
  });
}

export type ParameterDelta = { parameter: RecalibrationParameter; from: number; to: number };

/** The parameters a vector moves, in parameter-set order. */
export function deltas(params: readonly RecalibrationParameter[], values: ParameterVector): ParameterDelta[] {
  return params.flatMap((p) => {
    const v = valueOf(params, values, p.id);
    return Math.abs(v - p.current) < 1e-9 ? [] : [{ parameter: p, from: p.current, to: v }];
  });
}
