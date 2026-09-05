import { describe, expect, it, vi } from "vitest";
import {
  buildOverridePubmedTerm,
  coreProjectNum,
  deleteInvestigatorPubmedPmids,
  resolvePubmedMaxResults,
  runPubmedIdentityLadder,
  type PubmedLadderDeps,
  type PubmedLadderInput,
} from "@/lib/community/pubmed-ingest";

describe("resolvePubmedMaxResults", () => {
  it("defaults to uncapped fetches", () => {
    expect(resolvePubmedMaxResults()).toBeNull();
  });

  it("ignores explicit opts max and remains uncapped", () => {
    expect(resolvePubmedMaxResults(999)).toBeNull();
    expect(resolvePubmedMaxResults(50)).toBeNull();
  });
});

describe("buildOverridePubmedTerm", () => {
  it("adds the UCSF affiliation clause unless the override carries one", () => {
    expect(buildOverridePubmedTerm("Weiss A[au]")).toMatch(/^\(Weiss A\[au\]\) AND \(/);
    expect(buildOverridePubmedTerm("Weiss A[au] AND Stanford[Affiliation]")).toBe("Weiss A[au] AND Stanford[Affiliation]");
  });

  it("rejects URLs", () => {
    expect(() => buildOverridePubmedTerm("https://pubmed.ncbi.nlm.nih.gov/?term=Weiss+A")).toThrow(/search syntax/);
  });
});

describe("coreProjectNum", () => {
  it("strips application type and suffix", () => {
    expect(coreProjectNum("1R01AI052116-01")).toBe("R01AI052116");
    expect(coreProjectNum("5R37AI114575-27")).toBe("R37AI114575");
    expect(coreProjectNum("3P01AI045865-15S1")).toBe("P01AI045865");
    expect(coreProjectNum("1UG3AI150725-01")).toBe("UG3AI150725");
    expect(coreProjectNum("unknown")).toBeNull();
    expect(coreProjectNum(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Identity ladder with mocked esearch / efetch / RePORTER
// ---------------------------------------------------------------------------

type Author = { last: string; fore?: string; initials?: string; aff?: string };

function article(pmid: string, authors: Author[]): string {
  const list = authors
    .map(
      (a) =>
        `<Author ValidYN="Y"><LastName>${a.last}</LastName>` +
        (a.fore ? `<ForeName>${a.fore}</ForeName>` : "") +
        (a.initials ? `<Initials>${a.initials}</Initials>` : "") +
        (a.aff ? `<AffiliationInfo><Affiliation>${a.aff}</Affiliation></AffiliationInfo>` : "") +
        `</Author>`
    )
    .join("");
  return `<PubmedArticle><MedlineCitation><PMID Version="1">${pmid}</PMID><Article><AuthorList>${list}</AuthorList></Article></MedlineCitation></PubmedArticle>`;
}

const UCSF = "Department of Medicine, University of California, San Francisco, CA, USA.";
const ELSEWHERE = "Department of Biology, Stanford University, CA, USA.";

const ansel: PubmedLadderInput["name"] = { firstName: "Karl", lastName: "Ansel", middleInitial: "M", fullName: "Karl M Ansel" };
const weiss: PubmedLadderInput["name"] = { firstName: "Art", lastName: "Weiss", middleInitial: null, fullName: "Art Weiss" };

/** Build deps from a term → ids table and a pmid → xml table. */
function mockDeps(
  hits: Record<string, string[]>,
  xml: Record<string, string>,
  reporter: string[] = []
): PubmedLadderDeps & { esearch: ReturnType<typeof vi.fn>; reporterLinkedPmids: ReturnType<typeof vi.fn> } {
  const esearch = vi.fn(async (term: string) => {
    const key = Object.keys(hits).find((k) => term.startsWith(k) || term === k);
    return key ? hits[key]! : [];
  });
  const reporterLinkedPmids = vi.fn(async () => reporter);
  return {
    esearch,
    efetchXml: async (pmids: string[]) => new Map(pmids.filter((p) => xml[p]).map((p) => [p, xml[p]!])),
    reporterLinkedPmids,
  };
}

const base = (name: PubmedLadderInput["name"], extra: Partial<PubmedLadderInput> = {}): PubmedLadderInput => ({
  name,
  pubmedQueryOverride: null,
  orcid: null,
  coreProjectNums: [],
  ...extra,
});

describe("runPubmedIdentityLadder", () => {
  it("rung a: a pubmed_query_override that verifies wins and records 'manual'", async () => {
    const deps = mockDeps(
      { "(Ansel KM[au])": ["1", "2"] },
      { "1": article("1", [{ last: "Ansel", fore: "K Mark", initials: "KM", aff: UCSF }]), "2": article("2", [{ last: "Ansel", initials: "KM", aff: ELSEWHERE }]) }
    );
    const out = await runPubmedIdentityLadder(base(ansel, { pubmedQueryOverride: "Ansel KM[au]" }), deps);
    expect(out.rung).toBe("override");
    expect(out.contributing).toEqual(["override"]);
    expect(out.identityMethod).toBe("manual");
    expect(out.methodByPmid.get("1")).toBe("affiliation");
    expect(out.verifiedPmids).toEqual(["1"]);
    expect(out.nameOnlyPmids).toEqual(["2"]);
    expect(out.rejected).toBe(1);
    expect(deps.esearch).toHaveBeenCalledTimes(1);
  });

  it("rung b: strict full name + UCSF verifies and records 'affiliation'", async () => {
    const deps = mockDeps(
      { "(Ansel Karl M[Author])": ["10"] },
      { "10": article("10", [{ last: "Ansel", fore: "Karl M", initials: "KM", aff: UCSF }]) }
    );
    const out = await runPubmedIdentityLadder(base(ansel), deps);
    expect(out.rung).toBe("strict");
    expect(out.identityMethod).toBe("affiliation");
    expect(out.verifiedPmids).toEqual(["10"]);
    expect(out.attempts.map((a) => a.rung)).toEqual(["strict"]);
  });

  it("rung c: falls through to the initials variant when the strict term returns nothing", async () => {
    const deps = mockDeps(
      { "(Ansel KM[Author])": ["20", "21", "22"] },
      {
        "20": article("20", [{ last: "Ansel", initials: "KM", aff: UCSF }]),
        "21": article("21", [{ last: "Ansel", initials: "KM", aff: UCSF }]),
        "22": article("22", [{ last: "Ansel", initials: "KM", aff: ELSEWHERE }]),
      }
    );
    const out = await runPubmedIdentityLadder(base(ansel), deps);
    expect(out.rung).toBe("initials");
    expect(out.identityMethod).toBe("initials");
    expect(out.methodByPmid.get("20")).toBe("affiliation");
    expect(out.methodByPmid.get("21")).toBe("affiliation");
    expect(out.verifiedPmids).toEqual(["20", "21"]);
    expect(out.nameOnlyPmids).toEqual(["22"]);
    expect(out.attempts).toEqual([
      { rung: "strict", term: expect.stringContaining("Ansel Karl M[Author]"), hits: 0, verified: 0 },
      { rung: "initials", term: expect.stringContaining("Ansel KM[Author]"), hits: 3, verified: 2 },
    ]);
    expect(deps.esearch.mock.calls[0]![0]).toContain("Ansel Karl M[Author]");
    expect(deps.esearch.mock.calls[1]![0]).toContain("Ansel KM[Author]");
  });

  it("rung d: ORCID [auid] hits are verified as 'orcid' with no affiliation check", async () => {
    const deps = mockDeps({ "0000-0002-5994-9558[auid]": ["30", "31"] }, {});
    const out = await runPubmedIdentityLadder(base(weiss, { orcid: "0000-0002-5994-9558" }), deps);
    expect(out.rung).toBe("orcid");
    expect(out.contributing).toEqual(["orcid"]);
    expect(out.identityMethod).toBe("orcid");
    expect(out.methodByPmid.get("30")).toBe("orcid");
    expect(out.methodByPmid.get("31")).toBe("orcid");
    expect(out.verifiedPmids).toEqual(["30", "31"]);
    expect(out.attempts.map((a) => a.rung)).toEqual(["strict", "initials", "orcid"]);
  });

  it("rung e: RePORTER-linked PMIDs are verified as 'reporter_link' only when the last name is on the record", async () => {
    const deps = mockDeps(
      {},
      {
        "40": article("40", [{ last: "Weiss", fore: "Arthur", initials: "A", aff: ELSEWHERE }]),
        "41": article("41", [{ last: "Trainee", fore: "Some", initials: "S", aff: UCSF }]),
        "42": article("42", [{ last: "Other", initials: "O" }, { last: "WEISS", initials: "A" }]),
      },
      ["40", "41", "42"]
    );
    const out = await runPubmedIdentityLadder(base(weiss, { coreProjectNums: ["R37AI114575", "P01AI045865"] }), deps);
    expect(out.rung).toBe("reporter_link");
    expect(out.contributing).toEqual(["reporter_link"]);
    expect(out.identityMethod).toBe("reporter_link");
    expect(out.methodByPmid.get("40")).toBe("reporter_link");
    expect(out.methodByPmid.get("42")).toBe("reporter_link");
    expect(out.verifiedPmids).toEqual(["40", "42"]);
    expect(out.rejected).toBe(1);
    expect(deps.reporterLinkedPmids).toHaveBeenCalledWith(["R37AI114575", "P01AI045865"]);
    expect(out.attempts.at(-1)).toMatchObject({ rung: "reporter_link", hits: 3, verified: 2 });
  });

  it("D11: ORCID and RePORTER results add to the name rung, and orcid outranks affiliation per row", async () => {
    const deps = mockDeps(
      { "(Ansel KM[au])": ["1", "2"], "0000-0002-5994-9558[auid]": ["2", "3"] },
      {
        "1": article("1", [{ last: "Ansel", fore: "K Mark", initials: "KM", aff: UCSF }]),
        "2": article("2", [{ last: "Ansel", initials: "KM", aff: ELSEWHERE }]),
        "4": article("4", [{ last: "Ansel", initials: "KM" }]),
        "5": article("5", [{ last: "Trainee", initials: "T" }]),
      },
      ["3", "4", "5"]
    );
    const out = await runPubmedIdentityLadder(
      base(ansel, { pubmedQueryOverride: "Ansel KM[au]", orcid: "0000-0002-5994-9558", coreProjectNums: ["R01HL109102"] }),
      deps
    );
    expect(out.rung).toBe("override");
    expect(out.identityMethod).toBe("manual");
    expect(out.contributing).toEqual(["override", "orcid", "reporter_link"]);
    expect(out.verifiedPmids).toEqual(["1", "2", "3", "4"]);
    expect(out.methodByPmid.get("1")).toBe("affiliation");
    expect(out.methodByPmid.get("2")).toBe("orcid"); // name-only hit upgraded by ORCID
    expect(out.methodByPmid.get("3")).toBe("orcid"); // RePORTER does not downgrade an ORCID row
    expect(out.methodByPmid.get("4")).toBe("reporter_link");
    expect(out.nameOnlyPmids).toEqual([]);
    expect(out.attempts.at(-1)).toMatchObject({ rung: "reporter_link", hits: 3, verified: 2 });
    expect(out.rejected).toBe(2); // one override hit off-affiliation, one linked PMID without the name
    expect(out.termByMethod.orcid).toBe("0000-0002-5994-9558[auid]");
  });

  it("name rungs stop at the first verified item, even when a later name rung would return more", async () => {
    const deps = mockDeps(
      { "(Weiss Art[Author])": ["50"], "(Weiss A[Author])": ["50", "51", "52"] },
      {
        "50": article("50", [{ last: "Weiss", fore: "Art", initials: "A", aff: UCSF }]),
        "51": article("51", [{ last: "Weiss", initials: "A", aff: UCSF }]),
        "52": article("52", [{ last: "Weiss", initials: "A", aff: UCSF }]),
      }
    );
    const out = await runPubmedIdentityLadder(base(weiss), deps);
    expect(out.rung).toBe("strict");
    expect(out.verifiedPmids).toEqual(["50"]);
    expect(deps.esearch).toHaveBeenCalledTimes(1);
  });

  it("returns no rung, keeps name-only evidence, and reports every attempt when nothing verifies", async () => {
    const deps = mockDeps(
      { "(Weiss Art[Author])": ["60"], "(Weiss A[Author])": ["60", "61"] },
      {
        "60": article("60", [{ last: "Weiss", fore: "Art", initials: "A", aff: ELSEWHERE }]),
        "61": article("61", [{ last: "Weiss", initials: "A", aff: ELSEWHERE }]),
      },
      ["70"]
    );
    const out = await runPubmedIdentityLadder(base(weiss, { orcid: "0000-0001-0000-0000", coreProjectNums: ["R01GM039553"] }), deps);
    expect(out.rung).toBeNull();
    expect(out.identityMethod).toBeNull();
    expect(out.verifiedPmids).toEqual([]);
    expect(out.nameOnlyPmids).toEqual(["60", "61"]);
    expect(out.attempts.map((a) => a.rung)).toEqual(["strict", "initials", "orcid", "reporter_link"]);
    // 1 (strict) + 2 (initials) + 1 (RePORTER-linked PMID without the last name) — per-attempt sum.
    expect(out.rejected).toBe(4);
  });

  it("skips the initials rung when it is identical to the strict term", async () => {
    const deps = mockDeps({}, {});
    const out = await runPubmedIdentityLadder(base({ firstName: "A", lastName: "Weiss", middleInitial: null, fullName: "A Weiss" }), deps);
    expect(out.attempts.map((a) => a.rung)).toEqual(["strict"]);
  });
});

describe("deleteInvestigatorPubmedPmids", () => {
  it("only deletes unreviewed affiliation rows, never ORCID / RePORTER / reviewed / name-only ones", async () => {
    const filters: Array<[string, ...unknown[]]> = [];
    const chain: Record<string, unknown> = {};
    for (const m of ["eq", "is", "in"]) {
      chain[m] = (...args: unknown[]) => {
        filters.push([m, ...args]);
        return m === "in" ? Promise.resolve({ error: null }) : chain;
      };
    }
    const db = { from: vi.fn(() => ({ delete: () => chain })) } as never;
    await deleteInvestigatorPubmedPmids(db, "inv-1", ["1", "2"]);
    expect(filters).toEqual([
      ["eq", "investigator_id", "inv-1"],
      ["eq", "source", "pubmed_eutils"],
      ["eq", "identity_method", "affiliation"],
      ["is", "reviewed_at", null],
      ["in", "pmid", ["1", "2"]],
    ]);
  });

  it("is a no-op for an empty list", async () => {
    const db = { from: vi.fn() } as never;
    await deleteInvestigatorPubmedPmids(db, "inv-1", []);
    expect((db as { from: ReturnType<typeof vi.fn> }).from).not.toHaveBeenCalled();
  });
});
