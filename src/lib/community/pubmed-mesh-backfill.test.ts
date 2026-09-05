import { describe, expect, it } from "vitest";
import {
  BACKFILL_EFETCH_BATCH,
  chunk,
  COVERAGE_HEADING,
  decideBatchMisses,
  distinctPmids,
  formatBatchAbort,
  NOT_RETURNED_BATCH_CEILING,
  expectedEfetchCalls,
  formatCoverageSection,
  formatDryRunRecord,
  meshRetryCutoff,
  nextFetchState,
  pendingFilter,
} from "@/lib/community/pubmed-mesh-backfill";
import { captureFieldsFromXml } from "@/lib/community/pubmed-record";

describe("backfill sizing", () => {
  it("13,567 distinct PMIDs is 68 efetch calls at 200 per call", () => {
    expect(BACKFILL_EFETCH_BATCH).toBe(200);
    expect(expectedEfetchCalls(13_567)).toBe(68);
    expect(expectedEfetchCalls(15_375)).toBe(77);
    expect(expectedEfetchCalls(0)).toBe(0);
    expect(expectedEfetchCalls(20, 200)).toBe(1);
  });

  it("deduplicates PMIDs across roster rows, keeping first occurrence and dropping junk", () => {
    expect(distinctPmids([{ pmid: "2" }, { pmid: " 1 " }, { pmid: "2" }, { pmid: "" }, { pmid: null }, { pmid: "x1" }])).toEqual(["2", "1"]);
  });

  it("chunks", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});

describe("pending predicate and fetch state", () => {
  it("selects never-fetched rows and empty-mesh rows older than 30 days, never terminal ones", () => {
    const now = new Date("2026-09-05T12:00:00.000Z");
    expect(meshRetryCutoff(now).toISOString()).toBe("2026-08-06T12:00:00.000Z");
    expect(pendingFilter(now)).toBe(
      "mesh_fetch_outcome.eq.pending,and(mesh_fetch_outcome.in.(no_mesh,not_returned),mesh_fetched_at.lt.2026-08-06T12:00:00.000Z)"
    );
  });

  it("a second consecutive not_returned is terminal; anything returned resets", () => {
    expect(nextFetchState("pending", "not_returned")).toBe("not_returned");
    expect(nextFetchState(null, "not_returned")).toBe("not_returned");
    expect(nextFetchState("no_mesh", "not_returned")).toBe("not_returned");
    expect(nextFetchState("not_returned", "not_returned")).toBe("not_returned_terminal");
    expect(nextFetchState("not_returned_terminal", "not_returned")).toBe("not_returned_terminal");
    expect(nextFetchState("not_returned", "indexed")).toBe("indexed");
    expect(nextFetchState("not_returned", "no_mesh")).toBe("no_mesh");
  });
});

const AT = "2026-09-05T12:00:00.000Z";
const weiss = { name: { firstName: "Art", lastName: "Weiss", middleInitial: null, fullName: "Art Weiss" }, orcid: null };
const indexed =
  `<PubmedArticle><MedlineCitation><PMID Version="1">1</PMID><Article><Abstract><AbstractText>Text.</AbstractText></Abstract>` +
  `<AuthorList><Author ValidYN="Y"><LastName>Weiss</LastName><ForeName>Arthur</ForeName><Initials>A</Initials></Author></AuthorList>` +
  `<PublicationTypeList><PublicationType UI="D016428">Journal Article</PublicationType></PublicationTypeList></Article>` +
  `<MeshHeadingList><MeshHeading><DescriptorName UI="D006801" MajorTopicYN="N">Humans</DescriptorName></MeshHeading></MeshHeadingList></MedlineCitation></PubmedArticle>`;

describe("formatDryRunRecord", () => {
  it("prints what would be stored and each row's author position, method and state", () => {
    const f = captureFieldsFromXml(indexed, weiss, AT);
    const out = formatDryRunRecord("1", f, [{ investigator: "Art Weiss", author_position: "first", author_position_method: "name", state: "indexed" }]);
    expect(out).toContain("PMID 1  [indexed]  MeSH 1 (0 major)  PT: Journal Article  abstract 5 chars");
    expect(out).toContain("Humans");
    expect(out).toContain("row: Art Weiss → author_position first (name)");
  });

  it("flags a terminal row", () => {
    const f = captureFieldsFromXml(null, null, AT);
    const out = formatDryRunRecord("2", f, [{ investigator: "Art Weiss", author_position: "unknown", author_position_method: "absent", state: "not_returned_terminal" }]);
    expect(out).toContain("[not returned by efetch]");
    expect(out).toContain("← TERMINAL (second miss)");
  });
});

describe("formatCoverageSection", () => {
  it("renders counts by state and the terminal PMID table", () => {
    const md = formatCoverageSection(
      { pending: 0, indexed: 13_000, no_mesh: 500, not_returned: 3, not_returned_terminal: 2 },
      [
        { pmid: "123", investigator: "James C Lee", identity_method: "reporter_link", provenance_note: "RePORTER publications linked to R01AI000001 | x" },
        { pmid: "456", investigator: "Art Weiss", identity_method: "affiliation", provenance_note: null },
      ],
      AT
    );
    expect(md.startsWith(COVERAGE_HEADING)).toBe(true);
    expect(md).toContain("| indexed | 13000 |");
    expect(md).toContain("| (all rows) | 13505 |");
    expect(md).toContain("Terminal PMIDs");
    expect(md).toContain("| 123 | James C Lee | reporter_link | RePORTER publications linked to R01AI000001 \\| x |");
    expect(md).toContain("| 456 | Art Weiss | affiliation |  |");
  });
});

describe("decideBatchMisses (PR 0.2a): stamp not_returned only after a targeted retry with a canary", () => {
  const ids = (n: number, from = 1) => Array.from({ length: n }, (_, i) => String(from + i));

  it("no misses: nothing to stamp", () => {
    expect(decideBatchMisses({ requested: 200, missing: [], retryReturned: [] })).toEqual({ action: "stamp", stillMissing: [] });
  });

  it("isolated miss: retry returns only the canary → the miss is a real absence, stamp it", () => {
    expect(decideBatchMisses({ requested: 200, missing: ["7"], retryReturned: ["canary"] })).toEqual({ action: "stamp", stillMissing: ["7"] });
  });

  it("hiccup: retry recovers some of the misses → stamp only what is still missing", () => {
    const d = decideBatchMisses({ requested: 200, missing: ids(100), retryReturned: [...ids(98), "canary"] });
    expect(d).toEqual({ action: "stamp", stillMissing: ["99", "100"] });
  });

  it("retry recovers everything → nothing stamped, no abort", () => {
    expect(decideBatchMisses({ requested: 200, missing: ids(50), retryReturned: ids(50) })).toEqual({ action: "stamp", stillMissing: [] });
  });

  it("outage: retry returns nothing, not even the canary → abort, stamp nothing", () => {
    const d = decideBatchMisses({ requested: 200, missing: ids(100), retryReturned: [] });
    expect(d.action).toBe("abort");
    if (d.action === "abort") {
      expect(d.reason).toBe("retry_returned_nothing");
      expect(d.stillMissing).toHaveLength(100);
      expect(d.message).toContain("first response returned 100 of 200");
    }
    // a single dead PMID whose retry (with canary) returns nothing is still an outage signal
    expect(decideBatchMisses({ requested: 200, missing: ["7"], retryReturned: [] }).action).toBe("abort");
  });

  it("ceiling: a healthy retry that still leaves more than 25 missing aborts; exactly 25 stamps", () => {
    const over = decideBatchMisses({ requested: 200, missing: ids(26), retryReturned: ["canary"] });
    expect(over.action).toBe("abort");
    if (over.action === "abort") expect(over.reason).toBe("ceiling");
    expect(NOT_RETURNED_BATCH_CEILING).toBe(25);
    expect(decideBatchMisses({ requested: 200, missing: ids(25), retryReturned: ["canary"] })).toEqual({ action: "stamp", stillMissing: ids(25) });
  });

  it("abort message names the batch and the resume point", () => {
    const d = decideBatchMisses({ requested: 3, missing: ["2", "3"], retryReturned: [] });
    if (d.action !== "abort") throw new Error("expected abort");
    const msg = formatBatchAbort(4, 68, ["1", "2", "3"], d, 13_000);
    expect(msg).toContain("ABORT at batch 4/68");
    expect(msg).toContain("still missing after retry: 2, 3");
    expect(msg).toContain("Resume: rerun the same command");
    expect(msg).toContain("13000 PMIDs of this run not written, first 1");
  });
});
