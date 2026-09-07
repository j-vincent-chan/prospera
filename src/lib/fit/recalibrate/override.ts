/**
 * The taxonomy-override injection point (plan Phase 4 ·
 * `scripts/fit-recalibrate.ts`; spec §12 "Periodically, globally").
 *
 * Recalibration has to score the same pairs under thousands of candidate
 * parameter vectors, and every threshold the engine reads lives in
 * `taxonomy.json` behind the `taxonomy.ts` accessors — which read the JSON
 * object live, on every call (no module-level copy of a value: see
 * `taxonomy.ts`). So a candidate vector is injected by writing the numbers
 * the search owns into that one shared object for the duration of one
 * callback and restoring them afterwards, in a `finally`, whatever the
 * callback did:
 *
 *   withTaxonomyOverrides([{ paths: ["tiers.strong.P"], value: 0.7 }], () =>
 *     pairs.map((p) => scorePair(p.inv, p.opp, p.ctx))
 *   );
 *
 * Rules that keep this honest, and testable (`override.test.ts`):
 *   · only numbers already in the file are written — a path that is absent,
 *     or does not hold a finite number, throws (`TaxonomyOverrideError`);
 *     nothing is created, no shape changes
 *   · values must be finite and in [0, 1] — every parameter §12 fits is a
 *     compatibility value, a floor or a gate on that scale
 *   · the same path may be named once per call
 *   · calls do not nest (a nested call would restore the wrong baseline)
 *   · the saved values are restored in reverse order in a `finally`, so the
 *     shipped taxonomy is what every later reader sees — production
 *     behaviour is unchanged by anything in this module, and the script
 *     never writes `taxonomy.json` (it proposes a textual patch instead)
 *
 * Nothing here is asynchronous on purpose: an `await` inside the callback
 * would let unrelated work observe the overridden values. Keep the callback
 * synchronous — `scorePair` is.
 */
import taxonomy from "@/lib/fit/taxonomy.json";

/** One assignment: the paths that carry the value (a symmetric matrix cell has two) and the value. */
export type TaxonomyOverride = { paths: readonly string[]; value: number };

export class TaxonomyOverrideError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaxonomyOverrideError";
  }
}

/** `paradigm.family_compat.matrix[0][3]` and `paradigm.family_compat.matrix.0.3` are the same path. */
export function pathSegments(path: string): string[] {
  return path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** The number at `path` in any parsed taxonomy object (the live one, or a candidate parsed from patched text). Throws when the path is absent or does not hold a finite number. */
export function numberAtPath(root: unknown, path: string): number {
  const segments = pathSegments(path);
  if (!segments.length) throw new TaxonomyOverrideError(`empty taxonomy path ${JSON.stringify(path)}`);
  let cur: unknown = root;
  for (const seg of segments) {
    if (!isRecord(cur) && !Array.isArray(cur)) throw new TaxonomyOverrideError(`taxonomy path ${path} stops at ${JSON.stringify(seg)}: not an object`);
    cur = (cur as Record<string, unknown>)[seg];
  }
  if (typeof cur !== "number" || !Number.isFinite(cur)) throw new TaxonomyOverrideError(`taxonomy path ${path} does not hold a finite number (${JSON.stringify(cur)})`);
  return cur;
}

/** The parent container and the last segment of a path that already holds a number. */
function slotAt(path: string): { parent: Record<string, unknown>; key: string } {
  const segments = pathSegments(path);
  numberAtPath(taxonomy, path); // the path must already hold a number
  const key = segments[segments.length - 1]!;
  let cur: unknown = taxonomy;
  for (const seg of segments.slice(0, -1)) cur = (cur as Record<string, unknown>)[seg];
  return { parent: cur as Record<string, unknown>, key };
}

/** The number `taxonomy.json` holds at `path` right now — the shipped value unless an override is in force. */
export function readTaxonomyNumber(path: string): number {
  return numberAtPath(taxonomy, path);
}

let active = false;

/** True while a `withTaxonomyOverrides` callback is running. */
export const isTaxonomyOverrideActive = (): boolean => active;

/**
 * Run `fn` with every override in force, then restore the shipped values.
 * Returns whatever `fn` returns; an exception from `fn` propagates with the
 * taxonomy already restored.
 */
export function withTaxonomyOverrides<T>(overrides: readonly TaxonomyOverride[], fn: () => T): T {
  if (active) throw new TaxonomyOverrideError("withTaxonomyOverrides does not nest: one override scope at a time, so the restore cannot take the wrong baseline");
  const seen = new Set<string>();
  const slots: Array<{ path: string; parent: Record<string, unknown>; key: string; saved: number; value: number }> = [];
  for (const o of overrides) {
    if (typeof o.value !== "number" || !Number.isFinite(o.value)) throw new TaxonomyOverrideError(`override value ${JSON.stringify(o.value)} is not a finite number`);
    if (o.value < 0 || o.value > 1) throw new TaxonomyOverrideError(`override value ${o.value} is outside [0, 1]; every parameter §12 fits is a compatibility value, a floor or a gate on that scale`);
    if (!o.paths.length) throw new TaxonomyOverrideError("an override names no path");
    for (const path of o.paths) {
      if (seen.has(path)) throw new TaxonomyOverrideError(`taxonomy path ${path} is overridden twice in one call`);
      seen.add(path);
      const { parent, key } = slotAt(path);
      slots.push({ path, parent, key, saved: parent[key] as number, value: o.value });
    }
  }
  active = true;
  try {
    for (const s of slots) s.parent[s.key] = s.value;
    return fn();
  } finally {
    for (let i = slots.length - 1; i >= 0; i -= 1) {
      const s = slots[i]!;
      s.parent[s.key] = s.saved;
    }
    active = false;
  }
}
