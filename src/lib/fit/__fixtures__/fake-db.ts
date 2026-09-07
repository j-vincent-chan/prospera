/**
 * The narrowest fake of the PostgREST builder the fit-v1 surfaces use, for
 * tests: `from(table)` → a chainable, awaitable builder over in-memory rows.
 * Filters: eq / neq / in / is / not / like (a dotted column reads into an
 * embedded object, so `investigators.archived_at` works on a row that carries
 * `investigators: { … }`, and a PostgREST JSON path — `adjudication->a->>b` —
 * reads into a stored object, so the review queue's filter on
 * `adjudication->reconciliation->review->>kind` works); `or` accepts every
 * row (the open-notice filter is
 * not modelled); order (nullsFirst honoured), range, limit, count / head,
 * maybeSingle / single. Writes are applied to the rows and logged: insert
 * and upsert append (an `id` is minted when missing), update merges into the
 * matching rows, delete removes them. A table mapped to `null` — or absent —
 * answers with PostgREST's missing-table message.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type Row = Record<string, unknown>;
/** Table → rows; `null` = the table is not on the database. */
export type FakeTables = Record<string, Row[] | null>;
export type FakeWrite = { table: string; op: "insert" | "upsert" | "update" | "delete"; rows: Row[]; values: Row | null; filters: string[] };
export type FakeLog = { reads: string[]; writes: FakeWrite[] };

type Result = { data: unknown; error: { message: string } | null; count: number | null };

/** `a.b` on a row: into an embedded object (the first element when the embed is an array); `a->b->>c` into a stored JSON object, the way PostgREST addresses one. */
export function readPath(row: Row, path: string): unknown {
  return path
    .split(/->>|->|\./)
    .filter(Boolean)
    .reduce<unknown>((v, k) => {
      if (!v || typeof v !== "object") return undefined;
      const o = Array.isArray(v) ? (v[0] as Row | undefined) : (v as Row);
      return o?.[k];
    }, row);
}

export function fakeDb(tables: FakeTables, log: FakeLog = { reads: [], writes: [] }): SupabaseClient & { log: FakeLog; tables: FakeTables } {
  let seq = 0;
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    const filterText: string[] = [];
    const orders: Array<{ col: string; asc: boolean; nullsFirst: boolean }> = [];
    let range: [number, number] | null = null;
    let limitN: number | null = null;
    let head = false;
    let counting = false;
    let op: FakeWrite["op"] | "select" = "select";
    let payload: Row[] = [];
    let values: Row | null = null;
    let returning = false;
    const run = (): Result => {
      const rows = tables[table];
      if (rows === undefined || rows === null) return { data: null, error: { message: `Could not find the table 'public.${table}' in the schema cache` }, count: null };
      if (op !== "select") {
        log.writes.push({ table, op, rows: payload, values, filters: filterText });
        if (op === "insert" || op === "upsert") {
          const stored = payload.map((r) => ({ id: `${table}-${++seq}`, ...r }));
          rows.push(...stored);
          return { data: returning ? stored : null, error: null, count: null };
        }
        if (op === "update") {
          let matched = 0;
          for (const r of rows)
            if (filters.every((f) => f(r))) {
              Object.assign(r, values);
              matched += 1;
            }
          return { data: null, error: null, count: counting ? matched : null };
        }
        const keep = rows.filter((r) => !filters.every((f) => f(r)));
        rows.splice(0, rows.length, ...keep);
        return { data: null, error: null, count: null };
      }
      let out = rows.filter((r) => filters.every((f) => f(r)));
      for (const o of [...orders].reverse()) {
        out = [...out].sort((a, b) => {
          const x = readPath(a, o.col) as string | number | null | undefined;
          const y = readPath(b, o.col) as string | number | null | undefined;
          if (x == null || y == null) {
            if (x == null && y == null) return 0;
            return (x == null) === o.nullsFirst ? -1 : 1;
          }
          return (x < y ? -1 : x > y ? 1 : 0) * (o.asc ? 1 : -1);
        });
      }
      const total = out.length;
      if (range) out = out.slice(range[0], range[1] + 1);
      if (limitN != null) out = out.slice(0, limitN);
      return { data: head ? null : out.map((r) => ({ ...r })), error: null, count: counting ? total : null };
    };
    const like = (pattern: string) => new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, "i");
    const q: Record<string, unknown> = {
      select: (cols = "*", opts: { count?: string; head?: boolean } = {}) => {
        if (op === "select") log.reads.push(`${table}:${cols}`);
        else returning = true;
        head = Boolean(opts.head);
        counting = Boolean(opts.count);
        return q;
      },
      insert: (rows: Row | Row[]) => ((op = "insert"), (payload = Array.isArray(rows) ? rows : [rows]), q),
      upsert: (rows: Row | Row[]) => ((op = "upsert"), (payload = Array.isArray(rows) ? rows : [rows]), q),
      update: (v: Row, opts: { count?: string } = {}) => ((op = "update"), (values = v), (counting = counting || Boolean(opts.count)), q),
      delete: () => ((op = "delete"), q),
      eq: (col: string, v: unknown) => (filters.push((r) => readPath(r, col) === v), filterText.push(`${col}=${String(v)}`), q),
      neq: (col: string, v: unknown) => (filters.push((r) => readPath(r, col) !== v), filterText.push(`${col}!=${String(v)}`), q),
      in: (col: string, vs: unknown[]) => (filters.push((r) => vs.includes(readPath(r, col))), filterText.push(`${col} in ${vs.join(",")}`), q),
      is: (col: string, v: unknown) => (filters.push((r) => (readPath(r, col) ?? null) === v), filterText.push(`${col} is ${String(v)}`), q),
      /** Only the shapes the code uses: `not(col, "is", null)` and `not(col, "eq", v)`. */
      not: (col: string, op: string, v: unknown) => (filters.push((r) => (op === "is" ? (readPath(r, col) ?? null) !== v : readPath(r, col) !== v)), filterText.push(`${col} not.${op}.${String(v)}`), q),
      like: (col: string, pattern: string) => (filters.push((r) => like(pattern).test(String(readPath(r, col) ?? ""))), filterText.push(`${col} like ${pattern}`), q),
      or: () => q,
      order: (col: string, opts: { ascending?: boolean; nullsFirst?: boolean } = {}) => (orders.push({ col, asc: opts.ascending ?? true, nullsFirst: opts.nullsFirst ?? !(opts.ascending ?? true) }), q),
      range: (a: number, b: number) => ((range = [a, b]), q),
      limit: (n: number) => ((limitN = n), q),
      maybeSingle: async () => {
        const r = run();
        return { data: r.error ? null : ((r.data as Row[])[0] ?? null), error: r.error };
      },
      single: async () => {
        const r = run();
        const first = r.error ? null : ((r.data as Row[])[0] ?? null);
        return { data: first, error: r.error ?? (first ? null : { message: "JSON object requested, multiple (or no) rows returned" }) };
      },
      then: (resolve: (v: Result) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve().then(run).then(resolve, reject),
    };
    return q;
  };
  return { from, log, tables } as unknown as SupabaseClient & { log: FakeLog; tables: FakeTables };
}
