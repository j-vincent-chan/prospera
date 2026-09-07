/**
 * The proposed `taxonomy.json` diff (plan Phase 4: "never auto-apply —
 * writes a proposed `taxonomy.json` diff for review").
 *
 * `taxonomy.json` is hand-formatted: compact rows, aligned keys, `_comment`
 * fields that carry the reasoning, matrices laid out as tables a person can
 * read. Re-serializing it from a parsed object would reformat all 217 lines
 * and make the one number that moved unreviewable, so a proposal is a
 * TEXTUAL substitution: each parameter carries the locator of its number in
 * the file (`parameters.ts`), the substitution replaces exactly that number
 * (keeping the literal's decimal places), and everything else — every space,
 * every comment, every line — is byte-identical.
 *
 * The patch is then verified three ways before it is written
 * (`verifyPatch`): the patched text parses as JSON, every path holds the
 * proposed value (including a symmetric matrix cell's mirror), and the
 * unified diff, applied back to the original text, reproduces the patched
 * text exactly.
 *
 * Nothing here writes a file; the script does that, and never to
 * `taxonomy.json`.
 */
import { numberAtPath } from "@/lib/fit/recalibrate/override";
import type { ParameterDelta, RecalibrationParameter, TextLocator } from "@/lib/fit/recalibrate/parameters";

export class PatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PatchError";
  }
}

const NUMBER = /-?\d+(?:\.\d+)?/g;

/** The value formatted with the literal's decimal places (0.75 → "0.80"), widened only if that would round it. */
export function formatLike(literal: string, value: number): string {
  const decimals = literal.includes(".") ? literal.split(".")[1]!.length : 0;
  for (let d = decimals; d <= 6; d += 1) {
    const s = value.toFixed(d);
    if (Number(s) === value) return s;
  }
  throw new PatchError(`cannot format ${value} like ${literal}`);
}

function anchorLine(lines: readonly string[], anchor: string): number {
  const hits = lines.flatMap((l, i) => (l.includes(anchor) ? [i] : []));
  if (hits.length !== 1) throw new PatchError(`taxonomy.json: ${hits.length} lines contain ${anchor}; the locator must match exactly one`);
  return hits[0]!;
}

/** The line the locator points at, and the character span of the number on it. */
function locate(lines: readonly string[], locator: TextLocator): { line: number; start: number; end: number } {
  if (locator.kind === "key") {
    const line = anchorLine(lines, locator.anchor);
    const re = new RegExp(`"${locator.key}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, "g");
    const matches = [...lines[line]!.matchAll(re)];
    if (matches.length !== 1) throw new PatchError(`taxonomy.json line ${line + 1}: ${matches.length} matches for "${locator.key}": <number>`);
    const m = matches[0]!;
    const start = m.index! + m[0]!.length - m[1]!.length;
    return { line, start, end: start + m[1]!.length };
  }
  const anchor = anchorLine(lines, locator.anchor);
  let matrix = -1;
  for (let i = anchor; i < lines.length && i < anchor + 8; i += 1) {
    if (lines[i]!.includes('"matrix"')) {
      matrix = i;
      break;
    }
  }
  if (matrix < 0) throw new PatchError(`taxonomy.json: no "matrix" line within 8 lines of ${locator.anchor}`);
  const line = matrix + 1 + locator.row;
  const text = lines[line];
  if (text === undefined || !/^\s*\[[-\d., ]+\],?\s*$/.test(text)) throw new PatchError(`taxonomy.json line ${line + 1} is not a matrix row: ${JSON.stringify(text ?? null)}`);
  const cells = [...text.matchAll(NUMBER)];
  const cell = cells[locator.col];
  if (!cell) throw new PatchError(`taxonomy.json line ${line + 1} has ${cells.length} cells, no column ${locator.col}`);
  return { line, start: cell.index!, end: cell.index! + cell[0]!.length };
}

/**
 * The file text with every delta substituted. Line count and every other
 * character are unchanged; two deltas on one line (the tier rows carry
 * several floors) are applied in order.
 */
export function patchTaxonomyText(text: string, deltas: readonly ParameterDelta[]): string {
  const lines = text.split("\n");
  for (const d of deltas) {
    for (const locator of d.parameter.locators) {
      const at = locate(lines, locator);
      const line = lines[at.line]!;
      const literal = line.slice(at.start, at.end);
      if (Number(literal) !== d.from) throw new PatchError(`${d.parameter.id}: taxonomy.json line ${at.line + 1} holds ${literal}, not the ${d.from} the parameter set read — the file changed under the run`);
      lines[at.line] = line.slice(0, at.start) + formatLike(literal, d.to) + line.slice(at.end);
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Unified diff
// ---------------------------------------------------------------------------

/**
 * A unified diff of two texts with the same line count — which a textual
 * substitution always produces. Hunks carry `context` lines either side and
 * merge when they overlap.
 */
export function unifiedDiff(before: string, after: string, path: string, context = 3): string {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length !== b.length) throw new PatchError(`unifiedDiff: ${a.length} lines before, ${b.length} after — a substitution patch never changes the line count`);
  const changed = a.flatMap((line, i) => (line === b[i] ? [] : [i]));
  if (!changed.length) return "";
  const hunks: Array<{ start: number; end: number }> = [];
  for (const i of changed) {
    const start = Math.max(0, i - context);
    const end = Math.min(a.length - 1, i + context);
    const last = hunks[hunks.length - 1];
    if (last && start <= last.end + 1) last.end = Math.max(last.end, end);
    else hunks.push({ start, end });
  }
  const out: string[] = [`--- a/${path}`, `+++ b/${path}`];
  for (const h of hunks) {
    const count = h.end - h.start + 1;
    out.push(`@@ -${h.start + 1},${count} +${h.start + 1},${count} @@`);
    for (let i = h.start; i <= h.end; i += 1) {
      if (a[i] === b[i]) out.push(` ${a[i]}`);
      else {
        out.push(`-${a[i]}`);
        out.push(`+${b[i]}`);
      }
    }
  }
  return `${out.join("\n")}\n`;
}

/** Apply a unified diff produced by `unifiedDiff` back to `before`; throws when a context or removed line does not match. */
export function applyUnifiedDiff(before: string, diff: string): string {
  const lines = before.split("\n");
  const out = [...lines];
  const diffLines = diff.split("\n");
  let i = 0;
  while (i < diffLines.length) {
    const header = diffLines[i]!;
    if (!header.startsWith("@@")) {
      i += 1;
      continue;
    }
    const m = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/.exec(header);
    if (!m) throw new PatchError(`applyUnifiedDiff: bad hunk header ${header}`);
    let at = Number(m[1]) - 1;
    i += 1;
    while (i < diffLines.length && !diffLines[i]!.startsWith("@@")) {
      const line = diffLines[i]!;
      if (line === "" && i === diffLines.length - 1) break;
      const body = line.slice(1);
      if (line.startsWith(" ")) {
        if (lines[at] !== body) throw new PatchError(`applyUnifiedDiff: context mismatch at line ${at + 1}`);
        at += 1;
      } else if (line.startsWith("-")) {
        if (lines[at] !== body) throw new PatchError(`applyUnifiedDiff: removed line does not match at line ${at + 1}`);
      } else if (line.startsWith("+")) {
        out[at] = body;
        at += 1;
      } else throw new PatchError(`applyUnifiedDiff: unexpected line ${JSON.stringify(line)}`);
      i += 1;
    }
  }
  return out.join("\n");
}

export type PatchVerification = { parsed: true; paths: number; diff_round_trips: true };

/**
 * The three checks before a proposal is written: the patched text parses,
 * every path (mirrors included) holds the proposed value, and the diff
 * applied to the original reproduces the patched text.
 */
export function verifyPatch(before: string, after: string, diff: string, deltas: readonly ParameterDelta[]): PatchVerification {
  let parsed: unknown;
  try {
    parsed = JSON.parse(after);
  } catch (e) {
    throw new PatchError(`the patched taxonomy.json does not parse: ${e instanceof Error ? e.message : String(e)}`);
  }
  let paths = 0;
  for (const d of deltas) {
    for (const p of d.parameter.paths) {
      const v = numberAtPath(parsed, p);
      if (v !== d.to) throw new PatchError(`${d.parameter.id}: the patched taxonomy.json holds ${v} at ${p}, not ${d.to}`);
      paths += 1;
    }
  }
  const unchanged = untouchedPaths(JSON.parse(before), parsed, deltas);
  if (unchanged.length) throw new PatchError(`the patched taxonomy.json changed values the proposal does not name: ${unchanged.slice(0, 5).join(", ")}`);
  if (applyUnifiedDiff(before, diff) !== after) throw new PatchError("the unified diff does not reproduce the patched text");
  return { parsed: true, paths, diff_round_trips: true };
}

/** Paths whose value differs between two parsed taxonomies and that no delta names (a substitution should touch nothing else). */
function untouchedPaths(before: unknown, after: unknown, deltas: readonly ParameterDelta[]): string[] {
  const named = new Set(deltas.flatMap((d) => d.parameter.paths.map((p) => p.replace(/\[(\d+)\]/g, ".$1"))));
  const out: string[] = [];
  const walk = (a: unknown, b: unknown, path: string) => {
    if (out.length > 20) return;
    if (typeof a === "number" || typeof b === "number") {
      if (a !== b && !named.has(path)) out.push(`${path}: ${String(a)} → ${String(b)}`);
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      for (let i = 0; i < Math.max(a.length, b.length); i += 1) walk(a[i], b[i], path ? `${path}.${i}` : String(i));
      return;
    }
    if (a && b && typeof a === "object" && typeof b === "object") {
      const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
      for (const k of keys) walk((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k);
      return;
    }
    if (a !== b && !named.has(path)) out.push(`${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
  };
  walk(before, after, "");
  return out;
}

/** The patch text and its verification for one proposal. */
export function proposedPatch(text: string, deltas: readonly ParameterDelta[], path = "src/lib/fit/taxonomy.json"): { patched: string; diff: string; verification: PatchVerification } {
  const patched = patchTaxonomyText(text, deltas);
  const diff = unifiedDiff(text, patched, path);
  return { patched, diff, verification: verifyPatch(text, patched, diff, deltas) };
}

/** The parameters a patch names, for the proposal's summary line. */
export const patchedParameters = (deltas: readonly ParameterDelta[]): RecalibrationParameter[] => deltas.map((d) => d.parameter);
