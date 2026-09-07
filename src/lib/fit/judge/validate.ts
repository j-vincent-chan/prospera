/**
 * Small validators the three passes share: every string is trimmed and
 * length-capped, every enum checked, every evidence id must exist in the set
 * the model was given (spec §16 guardrail 2 — an id that does not exist is
 * dropped and logged, never kept), and nothing here throws.
 */

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const fmt = (v: unknown): string => {
  const s = typeof v === "string" ? v : (JSON.stringify(v) ?? String(v));
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
};

/** A trimmed string cut to `max` chars; null for anything that is not a non-empty string. */
export function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function bool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

export function enumOf<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return (allowed as readonly string[]).includes(s) ? (s as T) : null;
}

/** A list of short strings (≤ `each` chars, ≤ `max` entries), deduplicated case-insensitively; anything else logged. */
export function strList(v: unknown, label: string, dropped: string[], opts: { max?: number; each?: number } = {}): string[] {
  if (v === undefined || v === null) return [];
  const list = Array.isArray(v) ? v : typeof v === "string" ? [v] : null;
  if (!list) {
    dropped.push(`${label}: not a list (${fmt(v)})`);
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of list) {
    const s = str(x, opts.each ?? 120);
    if (!s) {
      if (x !== null && x !== undefined && x !== "") dropped.push(`${label}: dropped ${fmt(x)}`);
      continue;
    }
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  const max = opts.max ?? 12;
  if (out.length > max) {
    dropped.push(`${label}: ${out.length} entries, kept first ${max}`);
    return out.slice(0, max);
  }
  return out;
}

/**
 * Evidence ids, kept only when they exist in `known` (case-insensitive,
 * whitespace-trimmed; "[PMID:123]" reads as "PMID:123"); every other value
 * is dropped and logged. The known spelling is returned.
 */
export function idList(v: unknown, known: ReadonlyMap<string, string>, label: string, dropped: string[]): string[] {
  if (v === undefined || v === null) return [];
  const list = Array.isArray(v) ? v : typeof v === "string" ? [v] : null;
  if (!list) {
    dropped.push(`${label}: not a list (${fmt(v)})`);
    return [];
  }
  const out: string[] = [];
  for (const x of list) {
    const s = typeof x === "string" ? x.trim().replace(/^\[|\]$/g, "").trim() : "";
    const hit = s ? known.get(s.toLowerCase()) : undefined;
    if (!hit) {
      dropped.push(`${label}: id not in the input (${fmt(x)})`);
      continue;
    }
    if (!out.includes(hit)) out.push(hit);
  }
  return out;
}

/** Lower-cased id → the id as given, for `idList`. */
export function knownIds(ids: Iterable<string>): Map<string, string> {
  const m = new Map<string, string>();
  for (const id of ids) m.set(id.toLowerCase(), id);
  return m;
}
