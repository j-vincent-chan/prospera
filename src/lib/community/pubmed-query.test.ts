import { describe, expect, it } from "vitest";
import {
  buildInitialsPubmedTerm,
  buildOrcidPubmedTerm,
  buildStrictPubmedTerm,
  buildUnaffiliatedInitialsTerm,
  pubmedAuthorVariants,
  pubmedInitialsAuthorVariant,
  pubmedNameResolutionError,
  resolvePubmedInvestigatorName,
} from "@/lib/community/pubmed-query";

describe("buildStrictPubmedTerm", () => {
  it("builds author + UCSF affiliation query from structured names", () => {
    const term = buildStrictPubmedTerm({
      firstName: "Vincent",
      lastName: "Chan",
      middleInitial: "M",
    });
    expect(term).toContain("Chan Vincent M[Author]");
    expect(term).not.toContain("Chan VM[Author]");
    expect(term).toContain('"University of California San Francisco"[Affiliation]');
    expect(term).toContain("UCSF[Affiliation]");
  });

  it("uses only middle-initial author variant when middle is known", () => {
    expect(pubmedAuthorVariants("Anderson", "Mark", "S")).toEqual(["Anderson Mark S[Author]"]);
    expect(pubmedAuthorVariants("Anderson", "Mark", null)).toEqual(["Anderson Mark[Author]"]);
  });

  it("uses full given name for multi-character first names without middle initial", () => {
    expect(pubmedAuthorVariants("He", "Peng", null)).toEqual(["He Peng[Author]"]);
    expect(pubmedAuthorVariants("He", "Peng", null)).not.toContain("He P[Author]");
  });

  it("uses middle initial from full_name when structured middle_initial is empty", () => {
    const resolved = resolvePubmedInvestigatorName({
      firstName: "Mark",
      lastName: "Anderson",
      middleInitial: null,
      fullName: "Mark S. Anderson",
    });
    expect(resolved.middleInitial).toBe("S");
    const term = buildStrictPubmedTerm(resolved);
    expect(term).toContain("Anderson Mark S[Author]");
    expect(term).not.toContain("Anderson MS[Author]");
  });

  it("parses middle initial from full name when fields missing", () => {
    const resolved = resolvePubmedInvestigatorName({
      firstName: "",
      lastName: "",
      fullName: "Alexander R Marson",
    });
    expect(resolved).toEqual({
      firstName: "Alexander",
      lastName: "Marson",
      middleInitial: "R",
    });
  });

  it("parses middle initial from first_name when stored as James C", () => {
    const resolved = resolvePubmedInvestigatorName({
      firstName: "James C",
      lastName: "Lee",
      fullName: "James Lee",
    });
    expect(resolved).toEqual({
      firstName: "James",
      lastName: "Lee",
      middleInitial: "C",
    });
    expect(buildStrictPubmedTerm(resolved)).toContain("Lee James C[Author]");
    expect(buildStrictPubmedTerm(resolved)).not.toContain("Lee JC[Author]");
    expect(buildStrictPubmedTerm(resolved)).not.toContain("Lee James[Author]");
  });

  it("requires middle initial for ambiguous James Lee", () => {
    expect(
      pubmedNameResolutionError({
        firstName: "James",
        lastName: "Lee",
        fullName: "James Lee",
      })
    ).toMatch(/middle_initial/i);
    expect(
      pubmedNameResolutionError({
        firstName: "James",
        lastName: "Lee",
        middleInitial: "C",
        fullName: "James C Lee",
      })
    ).toBeNull();
  });

  it("requires middle_initial column for ambiguous names even when full_name has middle", () => {
    expect(
      pubmedNameResolutionError({
        firstName: "James",
        lastName: "Lee",
        middleInitial: null,
        fullName: "James C Lee",
      })
    ).toMatch(/middle_initial/i);
  });

  it("requires middle_initial column for Peng He", () => {
    expect(
      pubmedNameResolutionError({
        firstName: "Peng",
        lastName: "He",
        fullName: "Peng He",
      })
    ).toMatch(/middle_initial/i);
  });
});

describe("PR 0.1b · name resolution and ladder terms", () => {
  it("does not invent a middle initial from a two-token first name", () => {
    expect(
      resolvePubmedInvestigatorName({ firstName: "Nam Woo", lastName: "Cho", middleInitial: null, fullName: "Nam Woo Cho" })
    ).toEqual({ firstName: "Nam Woo", lastName: "Cho", middleInitial: null });
    expect(
      resolvePubmedInvestigatorName({
        firstName: "Mary Helen",
        lastName: "Barcellos-Hoff",
        middleInitial: null,
        fullName: "Mary Helen Barcellos-Hoff",
      }).middleInitial
    ).toBeNull();
  });

  it("does not invent a middle initial from a two-token last name", () => {
    expect(
      resolvePubmedInvestigatorName({
        firstName: "Jose Angel",
        lastName: "Nicolas Avila",
        middleInitial: null,
        fullName: "Jose Angel Nicolas Avila",
      }).middleInitial
    ).toBeNull();
  });

  it("still reads a real middle initial out of full_name", () => {
    expect(
      resolvePubmedInvestigatorName({ firstName: "Judith", lastName: "Ashouri-Sinha", middleInitial: null, fullName: "Judith F Ashouri-Sinha" })
        .middleInitial
    ).toBe("F");
    expect(
      resolvePubmedInvestigatorName({ firstName: "Karl", lastName: "Ansel", middleInitial: null, fullName: "Karl M Ansel" }).middleInitial
    ).toBe("M");
  });

  it("builds the initials author variant PubMed indexes", () => {
    expect(pubmedInitialsAuthorVariant("Ansel", "Karl", "M")).toBe("Ansel KM[Author]");
    expect(pubmedInitialsAuthorVariant("Weiss", "Art", null)).toBe("Weiss A[Author]");
    expect(pubmedInitialsAuthorVariant("Cho", "Nam Woo", null)).toBe("Cho NW[Author]");
    expect(pubmedInitialsAuthorVariant("Barcellos-Hoff", "Mary Helen", null)).toBe("Barcellos-Hoff MH[Author]");
    expect(pubmedInitialsAuthorVariant("", "Karl", "M")).toBe("");
  });

  it("wraps the initials variant in the UCSF affiliation clause", () => {
    const term = buildInitialsPubmedTerm({ firstName: "Karl", lastName: "Ansel", middleInitial: "M" });
    expect(term.startsWith("(Ansel KM[Author]) AND (")).toBe(true);
    expect(term).toContain("UCSF[Affiliation]");
    expect(buildUnaffiliatedInitialsTerm({ firstName: "Karl", lastName: "Ansel", middleInitial: "M" })).toBe("Ansel KM[Author]");
  });

  it("builds an [auid] term only for a well-formed ORCID", () => {
    expect(buildOrcidPubmedTerm("0000-0002-5994-9558")).toBe("0000-0002-5994-9558[auid]");
    expect(buildOrcidPubmedTerm("https://orcid.org/0000-0002-1825-009x")).toBe("0000-0002-1825-009X[auid]");
    expect(buildOrcidPubmedTerm("")).toBe("");
    expect(buildOrcidPubmedTerm("not-an-orcid")).toBe("");
    expect(buildOrcidPubmedTerm(null)).toBe("");
  });
});
