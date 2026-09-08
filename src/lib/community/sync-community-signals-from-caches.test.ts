import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const filterPubmedPmidsForInvestigator = vi.fn();
const deleteInvestigatorPubmedPmids = vi.fn();

vi.mock("@/lib/community/pubmed-ingest", () => ({
  filterPubmedPmidsForInvestigator: (...args: unknown[]) =>
    filterPubmedPmidsForInvestigator(...args),
  deleteInvestigatorPubmedPmids: (...args: unknown[]) => deleteInvestigatorPubmedPmids(...args),
}));

const { syncInvestigatorCommunitySignalsFromCaches } = await import(
  "@/lib/community/sync-community-signals-from-caches"
);

const INVESTIGATOR_ID = "4f0f46cd-5087-479e-b7e4-16271d1613b0";

type Filter = { op: "eq" | "in"; column: string; value: unknown };
type Op = {
  table: string;
  method: "select" | "upsert" | "delete" | "update";
  filters: Filter[];
  rows?: unknown[];
  range?: [number, number];
};
type Respond = (op: Op) => { data?: unknown; error?: unknown };

function createFakeSupabase(respond: Respond) {
  const ops: Op[] = [];
  const from = (table: string) => {
    const op: Op = { table, method: "select", filters: [] };
    const builder: Record<string, unknown> = {
      select: () => builder,
      delete: () => {
        op.method = "delete";
        return builder;
      },
      upsert: (rows: unknown[]) => {
        op.method = "upsert";
        op.rows = rows;
        return builder;
      },
      update: (row: unknown) => {
        op.method = "update";
        op.rows = [row];
        return builder;
      },
      eq: (column: string, value: unknown) => {
        op.filters.push({ op: "eq", column, value });
        return builder;
      },
      in: (column: string, value: unknown) => {
        op.filters.push({ op: "in", column, value });
        return builder;
      },
      order: () => builder,
      range: (from: number, to: number) => {
        op.range = [from, to];
        return builder;
      },
      maybeSingle: () => builder,
      then: (
        resolve: (v: { data: unknown; error: unknown }) => unknown,
        reject: (e: unknown) => unknown
      ) => {
        ops.push(op);
        const res = respond(op);
        return Promise.resolve({ data: res.data ?? null, error: res.error ?? null }).then(
          resolve,
          reject
        );
      },
    };
    return builder;
  };
  return { supabase: { from } as unknown as SupabaseClient, ops };
}

/** One investigator, `pubCount` cached publications, `staleCount` orphaned Prospera rows. */
function respondWith(opts: { pubCount: number; staleCount: number; deleteError?: unknown }): {
  respond: Respond;
  staleIds: string[];
} {
  const staleIds = Array.from(
    { length: opts.staleCount },
    (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`
  );
  const respond: Respond = (op) => {
    if (op.table === "investigators") {
      return {
        data: {
          first_name: "Nam",
          last_name: "Cho",
          middle_initial: "W",
          full_name: "Nam Woo Cho",
          raw_profile_json: null,
        },
      };
    }
    if (op.table === "investigator_publications") {
      return {
        data: Array.from({ length: opts.pubCount }, (_, i) => ({
          pmid: `4000${i}`,
          title: `Paper ${i}`,
          journal: "Journal",
          publication_date: "2026-01-02",
          created_at: "2026-01-02T00:00:00.000Z",
        })),
      };
    }
    if (op.table === "investigator_nih_grants" || op.table === "investigator_clinical_trials") {
      return { data: [] };
    }
    if (op.table === "community_source_items" && op.method === "select") {
      const rows = staleIds.map((id) => ({
        id,
        prospera_cache_key: `pubmed:${INVESTIGATOR_ID}:stale-${id}`,
      }));
      // PostgREST caps a page at 1000 rows; honour the requested range.
      const [from, to] = op.range ?? [0, 999];
      return { data: rows.slice(from, to + 1) };
    }
    if (op.table === "community_source_items" && op.method === "delete") {
      return { error: opts.deleteError ?? null };
    }
    return { data: null };
  };
  return { respond, staleIds };
}

beforeEach(() => {
  vi.clearAllMocks();
  filterPubmedPmidsForInvestigator.mockImplementation(async (pmids: string[]) => ({
    validated: pmids,
    rejected: [],
  }));
});

describe("syncInvestigatorCommunitySignalsFromCaches", () => {
  it("deletes a large stale set in batches small enough for the Supabase gateway", async () => {
    const { respond, staleIds } = respondWith({ pubCount: 8, staleCount: 716 });
    const { supabase, ops } = createFakeSupabase(respond);

    const result = await syncInvestigatorCommunitySignalsFromCaches(supabase, INVESTIGATOR_ID);

    expect(result.removedStale).toBe(716);
    const deletes = ops.filter((op) => op.table === "community_source_items" && op.method === "delete");
    expect(deletes.length).toBeGreaterThan(1);

    const deletedIds: string[] = [];
    for (const op of deletes) {
      const idFilter = op.filters.find((f) => f.op === "in" && f.column === "id");
      const chunk = idFilter?.value as string[];
      expect(chunk.length).toBeLessThanOrEqual(100);
      const query = `id=in.${encodeURIComponent(`(${chunk.join(",")})`)}`;
      expect(query.length).toBeLessThan(24_000);
      deletedIds.push(...chunk);
    }
    expect(deletedIds.sort()).toEqual([...staleIds].sort());
  });

  it("pages past the PostgREST 1000-row cap when listing stale rows", async () => {
    const { respond, staleIds } = respondWith({ pubCount: 8, staleCount: 1500 });
    const { supabase, ops } = createFakeSupabase(respond);

    const result = await syncInvestigatorCommunitySignalsFromCaches(supabase, INVESTIGATOR_ID);

    expect(result.removedStale).toBe(1500);
    const listPages = ops.filter(
      (op) => op.table === "community_source_items" && op.method === "select"
    );
    expect(listPages.length).toBeGreaterThan(1);

    const deletedIds = ops
      .filter((op) => op.table === "community_source_items" && op.method === "delete")
      .flatMap((op) => (op.filters.find((f) => f.op === "in")?.value as string[]) ?? []);
    expect(deletedIds.sort()).toEqual([...staleIds].sort());
  });

  it("issues no delete request when nothing is stale", async () => {
    const { respond } = respondWith({ pubCount: 0, staleCount: 0 });
    const { supabase, ops } = createFakeSupabase(respond);

    const result = await syncInvestigatorCommunitySignalsFromCaches(supabase, INVESTIGATOR_ID);

    expect(result.removedStale).toBe(0);
    expect(ops.some((op) => op.method === "delete")).toBe(false);
  });

  it("reports which operation failed instead of a bare gateway status", async () => {
    const { respond } = respondWith({
      pubCount: 8,
      staleCount: 120,
      deleteError: { message: "Bad Request" },
    });
    const { supabase } = createFakeSupabase(respond);

    const error = await syncInvestigatorCommunitySignalsFromCaches(
      supabase,
      INVESTIGATOR_ID
    ).catch((e: unknown) => e as Error);

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain("community_source_items delete (stale Prospera rows) (100 rows)");
    expect(message).toContain("Bad Request");
    expect(message).toContain("Supabase gateway");
  });

  it("upserts one row per validated publication", async () => {
    const { respond } = respondWith({ pubCount: 8, staleCount: 0 });
    const { supabase, ops } = createFakeSupabase(respond);

    await syncInvestigatorCommunitySignalsFromCaches(supabase, INVESTIGATOR_ID);

    const upserts = ops.filter((op) => op.method === "upsert");
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.rows).toHaveLength(8);
  });
});
