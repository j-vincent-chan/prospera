import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { syncInvestigatorCommunitySignalsFromCaches } from "@/lib/community/sync-community-signals-from-caches";

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

type CachedPublication = { pmid: string; identity_status: string };

/** `n` cached publications the identity ladder has already verified. */
const verified = (n: number): CachedPublication[] =>
  Array.from({ length: n }, (_, i) => ({ pmid: `4000${i}`, identity_status: "verified" }));

/** One investigator, the given cached publications, `staleCount` orphaned Prospera rows. */
function respondWith(opts: {
  publications: CachedPublication[];
  staleCount: number;
  deleteError?: unknown;
}): {
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
        data: opts.publications.map((pub) => ({
          pmid: pub.pmid,
          title: `Paper ${pub.pmid}`,
          journal: "Journal",
          publication_date: "2026-01-02",
          created_at: "2026-01-02T00:00:00.000Z",
          identity_status: pub.identity_status,
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

const mirroredPubmedRows = (ops: Op[]) =>
  ops
    .filter((op) => op.method === "upsert")
    .flatMap((op) => (op.rows ?? []) as Record<string, unknown>[])
    .filter((row) => row.source_type === "pubmed");

describe("syncInvestigatorCommunitySignalsFromCaches · stale-row cleanup", () => {
  it("deletes a large stale set in batches small enough for the Supabase gateway", async () => {
    const { respond, staleIds } = respondWith({ publications: verified(8), staleCount: 716 });
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
    const { respond, staleIds } = respondWith({ publications: verified(8), staleCount: 1500 });
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
    const { respond } = respondWith({ publications: [], staleCount: 0 });
    const { supabase, ops } = createFakeSupabase(respond);

    const result = await syncInvestigatorCommunitySignalsFromCaches(supabase, INVESTIGATOR_ID);

    expect(result.removedStale).toBe(0);
    expect(ops.some((op) => op.method === "delete")).toBe(false);
  });

  it("reports which operation failed instead of a bare gateway status", async () => {
    const { respond } = respondWith({
      publications: verified(8),
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

  it("upserts one row per verified publication", async () => {
    const { respond } = respondWith({ publications: verified(8), staleCount: 0 });
    const { supabase, ops } = createFakeSupabase(respond);

    await syncInvestigatorCommunitySignalsFromCaches(supabase, INVESTIGATOR_ID);

    const upserts = ops.filter((op) => op.method === "upsert");
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.rows).toHaveLength(8);
  });
});

describe("syncInvestigatorCommunitySignalsFromCaches · detached from PubMed identity", () => {
  const ladder: CachedPublication[] = [
    { pmid: "111", identity_status: "verified" }, // affiliation
    { pmid: "222", identity_status: "verified" }, // ORCID [auid]
    { pmid: "333", identity_status: "verified" }, // RePORTER linkage
    { pmid: "444", identity_status: "unverified" }, // name-only, still awaiting a strategist
  ];

  it("mirrors every verified publication, whichever ladder rung verified it", async () => {
    const { respond } = respondWith({ publications: ladder, staleCount: 0 });
    const { supabase, ops } = createFakeSupabase(respond);

    const result = await syncInvestigatorCommunitySignalsFromCaches(supabase, INVESTIGATOR_ID);

    expect(mirroredPubmedRows(ops).map((row) => row.source_url)).toEqual([
      "https://pubmed.ncbi.nlm.nih.gov/111/",
      "https://pubmed.ncbi.nlm.nih.gov/222/",
      "https://pubmed.ncbi.nlm.nih.gov/333/",
    ]);
    expect(result.publicationsSynced).toBe(3);
  });

  it("does not mirror an unverified name-only hit", async () => {
    const { respond } = respondWith({ publications: ladder, staleCount: 0 });
    const { supabase, ops } = createFakeSupabase(respond);

    await syncInvestigatorCommunitySignalsFromCaches(supabase, INVESTIGATOR_ID);

    expect(
      mirroredPubmedRows(ops).some((row) => String(row.source_url).includes("/444/"))
    ).toBe(false);
  });

  it("makes no network call — identity is read from the cache, never re-derived", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const { respond } = respondWith({ publications: ladder, staleCount: 0 });
      const { supabase } = createFakeSupabase(respond);
      await syncInvestigatorCommunitySignalsFromCaches(supabase, INVESTIGATOR_ID);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("never deletes from the evidence caches; it only writes the community feed", async () => {
    const { respond } = respondWith({ publications: ladder, staleCount: 5 });
    const { supabase, ops } = createFakeSupabase(respond);

    await syncInvestigatorCommunitySignalsFromCaches(supabase, INVESTIGATOR_ID);

    const deletedFrom = ops.filter((op) => op.method === "delete").map((op) => op.table);
    expect(deletedFrom).not.toContain("investigator_publications");
    expect(deletedFrom).not.toContain("investigator_nih_grants");
    expect(deletedFrom).not.toContain("investigator_clinical_trials");
    expect(deletedFrom).toEqual(["community_source_items"]);
  });

  it("counts what it mirrored, not every cached row", async () => {
    const publications: CachedPublication[] = [
      { pmid: "111", identity_status: "verified" },
      ...Array.from({ length: 9 }, (_, i) => ({ pmid: `9${i}`, identity_status: "unverified" })),
    ];
    const { respond } = respondWith({ publications, staleCount: 0 });
    const { supabase } = createFakeSupabase(respond);

    const result = await syncInvestigatorCommunitySignalsFromCaches(supabase, INVESTIGATOR_ID);

    expect(result.publicationsSynced).toBe(1);
  });
});
