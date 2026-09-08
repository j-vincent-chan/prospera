import { describe, expect, it, vi } from "vitest";
import { syncInvestigatorCommunitySignalsFromCaches } from "@/lib/community/sync-community-signals-from-caches";

type Rows = Record<string, Array<Record<string, unknown>>>;

/**
 * Minimal PostgREST-shaped fake: `.select()/.eq()` chain and resolve to the
 * table's rows, `.delete().in()` and `.upsert()` resolve and are recorded.
 */
function fakeDb(rows: Rows) {
  const calls = {
    upserted: [] as Array<Record<string, unknown>>,
    deletedFrom: [] as string[],
    selectedFrom: [] as string[],
  };
  const from = vi.fn((table: string) => {
    const result = { data: rows[table] ?? [], error: null };
    const chain: Record<string, unknown> = {
      select: () => {
        calls.selectedFrom.push(table);
        return chain;
      },
      eq: () => chain,
      delete: () => {
        calls.deletedFrom.push(table);
        return chain;
      },
      in: () => Promise.resolve({ error: null }),
      maybeSingle: () => Promise.resolve({ data: (rows[table] ?? [])[0] ?? null, error: null }),
      upsert: (r: Array<Record<string, unknown>>) => {
        calls.upserted.push(...r);
        return Promise.resolve({ error: null });
      },
      then: (onOk: (v: unknown) => unknown) => Promise.resolve(result).then(onOk),
    };
    return chain;
  });
  return { db: { from } as never, calls };
}

const paper = (pmid: string, identity_status: string) => ({
  pmid,
  title: `Paper ${pmid}`,
  journal: "Journal",
  publication_date: "2024-01-01",
  created_at: "2024-01-02T00:00:00Z",
  identity_status,
});

const baseRows = (): Rows => ({
  investigators: [
    { first_name: "Art", last_name: "Weiss", middle_initial: null, full_name: "Art Weiss", raw_profile_json: null },
  ],
  investigator_publications: [
    paper("111", "verified"), // affiliation
    paper("222", "verified"), // ORCID [auid]
    paper("333", "verified"), // RePORTER linkage
    paper("444", "unverified"), // name-only, still awaiting a strategist
  ],
  investigator_nih_grants: [],
  investigator_clinical_trials: [],
  community_source_items: [],
});

describe("syncInvestigatorCommunitySignalsFromCaches · detached from PubMed identity", () => {
  it("mirrors every verified publication, whichever ladder rung verified it", async () => {
    const { db, calls } = fakeDb(baseRows());
    const r = await syncInvestigatorCommunitySignalsFromCaches(db, "inv-1");

    const mirrored = calls.upserted.filter((row) => row.source_type === "pubmed");
    expect(mirrored.map((row) => row.source_url)).toEqual([
      "https://pubmed.ncbi.nlm.nih.gov/111/",
      "https://pubmed.ncbi.nlm.nih.gov/222/",
      "https://pubmed.ncbi.nlm.nih.gov/333/",
    ]);
    expect(r.publicationsSynced).toBe(3);
  });

  it("does not mirror an unverified name-only hit", async () => {
    const { db, calls } = fakeDb(baseRows());
    await syncInvestigatorCommunitySignalsFromCaches(db, "inv-1");
    expect(calls.upserted.some((row) => String(row.source_url).includes("/444/"))).toBe(false);
  });

  it("makes no network call — identity is read from the cache, never re-derived", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const { db } = fakeDb(baseRows());
      await syncInvestigatorCommunitySignalsFromCaches(db, "inv-1");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("never deletes from the evidence caches; it only writes the community feed", async () => {
    const { db, calls } = fakeDb(baseRows());
    await syncInvestigatorCommunitySignalsFromCaches(db, "inv-1");
    expect(calls.deletedFrom).not.toContain("investigator_publications");
    expect(calls.deletedFrom).not.toContain("investigator_nih_grants");
    expect(calls.deletedFrom).not.toContain("investigator_clinical_trials");
  });

  it("counts what it mirrored, not every cached row", async () => {
    const rows = baseRows();
    rows.investigator_publications = [paper("111", "verified"), ...Array.from({ length: 9 }, (_, i) => paper(`9${i}`, "unverified"))];
    const { db } = fakeDb(rows);
    const r = await syncInvestigatorCommunitySignalsFromCaches(db, "inv-1");
    expect(r.publicationsSynced).toBe(1);
  });
});
