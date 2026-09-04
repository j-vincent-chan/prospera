import { describe, expect, it } from "vitest";
import { computeSuggestion, termHits } from "./suggest";
import { emptyFacets } from "./profile";
import type { OpportunityProfile } from "./types";

const now = new Date("2026-09-03T12:00:00Z");

const profile: OpportunityProfile = {
  version: 1,
  extractedAt: null,
  source: "llm",
  facets: {
    ...emptyFacets(),
    topics: ["immune regulation", "T cell tolerance", "tissue immunity"],
    disease: ["autoimmune disease", "lupus", "psoriasis"],
    methods: ["single-cell sequencing", "spatial transcriptomics"],
    mechanism: ["R01", "$500K direct / yr"],
    eligibility: ["independent faculty appointment"],
    excluded: ["clinical trials", "cancer-primary aims"],
  },
};

const person = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  full_name: "Hannah Park",
  first_name: "Hannah",
  last_name: "Park",
  email: "hannah.park@ucsf.edu",
  home_department: "Dermatology",
  division: null,
  rank: "member",
  research_community_id: "c1",
  created_at: "2025-01-10T00:00:00Z",
  do_not_contact_at: null,
  raw_profile_json: { title: "Associate Professor" },
  ...over,
});

const sources = (over: Array<Record<string, unknown>> = []) => [
  { investigator_id: "p1", source: "pubmed", state: "available", item_count: 14, unverified_count: 0, identity_method: "affiliation", last_refreshed_at: "2026-08-28T00:00:00Z", document_date: null, authorized_at: null, personal_statement: null, contributions: null, meta: null },
  { investigator_id: "p1", source: "reporter", state: "available", item_count: 1, unverified_count: 0, identity_method: "profile_id", last_refreshed_at: "2026-08-28T00:00:00Z", document_date: null, authorized_at: null, personal_statement: null, contributions: null, meta: null },
  { investigator_id: "p1", source: "biosketch", state: "not_requested", item_count: 0, unverified_count: 0, identity_method: null, last_refreshed_at: null, document_date: null, authorized_at: null, personal_statement: null, contributions: null, meta: null },
  ...over,
] as never;

const matches = [
  { investigator_id: "p1", kind: "publication" as const, ref_id: "1", content: "Spatial atlas of tissue-resident T cells in psoriatic skin (Sci Immunol, 2025)", year: 2025, similarity: 0.62 },
  { investigator_id: "p1", kind: "publication" as const, ref_id: "2", content: "IL-17 checkpoints in cutaneous immune regulation (J Invest Dermatol, 2024)", year: 2024, similarity: 0.55 },
  { investigator_id: "p1", kind: "grant" as const, ref_id: "5R01AR078112-03", content: "Tissue-resident memory T cells in psoriasis relapse. NIAMS 2025.", year: 2025, similarity: 0.5 },
];
const grants = [{ investigator_id: "p1", project_num: "5R01AR078112-03", project_title: "Tissue-resident memory T cells in psoriasis relapse", ic_name: "NIAMS — National Institute of Arthritis", fiscal_year: 2025, raw_json: { project_start_date: "2023-07-01", project_end_date: "2028-06-30" } }];
const pubs = [
  { id: "pub1", investigator_id: "p1", pmid: "1", title: "Spatial atlas of tissue-resident T cells in psoriatic skin", journal: "Sci Immunol", publication_date: "2025-03-01", identity_method: "affiliation", identity_status: "verified" },
  { id: "pub2", investigator_id: "p1", pmid: "2", title: "IL-17 checkpoints in cutaneous immune regulation", journal: "J Invest Dermatol", publication_date: "2024-11-01", identity_method: "affiliation", identity_status: "verified" },
];
const opts = { excludeRecentlyContacted: true, earlyCareerOnly: false, excludeRenewalsDue: false };

describe("termHits", () => {
  it("matches facet terms loosely against evidence text", () => {
    expect(termHits("Spatial atlas of tissue-resident T cells in psoriatic skin", ["tissue immunity", "psoriasis", "lupus"])).toEqual(["psoriasis"]);
    expect(termHits("Immune regulation by regulatory T cells", ["immune regulation", "T cell tolerance"])).toEqual(["immune regulation"]);
  });
});

describe("computeSuggestion", () => {
  it("makes a strong match from two verified sources with topic and disease overlap", () => {
    const s = computeSuggestion({ person: person() as never, profile, opts, matches, sources: sources(), grants: grants as never, pubs: pubs as never, history: [], communityLabel: "ImmunoX", communityTagged: false, now });
    expect(s).not.toBeNull();
    expect(s!.tier).toBe("strong");
    expect(s!.coverage).toBe("strong");
    expect(s!.reasons[0]!.source).toMatch(/^PubMed/);
    expect(s!.reasons[1]!.source).toBe("RePORTER · R01AR078112");
    expect(s!.checklist.find((c) => c.facet === "Eligibility")!.mark).toBe("yes");
    expect(s!.isNew).toBe(true);
    expect(s!.groups.find((g) => g.key === "history")!.empty).toContain("New to you");
  });

  it("caps at Potential when the appointment is unknown", () => {
    const s = computeSuggestion({ person: person({ raw_profile_json: {} }) as never, profile, opts, matches, sources: sources(), grants: grants as never, pubs: pubs as never, history: [], communityLabel: "ImmunoX", communityTagged: false, now });
    expect(s!.tier).toBe("potential");
    expect(s!.flags[0]!.kind).toBe("eligibility");
    expect(s!.checklist.find((c) => c.facet === "Eligibility")!.mark).toBe("unclear");
  });

  it("flags a conflict with the excluded facet and caps the tier", () => {
    const m = [{ ...matches[0]!, content: "Autoimmune toxicity after PD-1 blockade in head and neck cancer: cancer-primary aims in a treatment cohort" }, matches[1]!, matches[2]!];
    const s = computeSuggestion({ person: person() as never, profile, opts, matches: m, sources: sources(), grants: grants as never, pubs: pubs as never, history: [], communityLabel: "ImmunoX", communityTagged: false, now });
    expect(s!.flags.some((f) => f.kind === "conflict")).toBe(true);
    expect(s!.tier).toBe("potential");
    expect(s!.checklist.find((c) => c.facet === "Exclusions")!.mark).toBe("conflict");
  });

  it("excludes people contacted in the last 90 days when the option is on", () => {
    const s = computeSuggestion({ person: person() as never, profile, opts, matches, sources: sources(), grants: grants as never, pubs: pubs as never, history: [{ investigator_id: "p1", kind: "sent", at: "2026-07-25T00:00:00Z", label: "sent", notice: "RFA-AI-26-030", note: null }], communityLabel: "ImmunoX", communityTagged: false, now });
    expect(s!.excludedReason).toMatch(/Contacted 40 days ago/);
    expect(s!.historyLine).toBe("Contacted Jul 25 · RFA-AI-26-030 · no reply");
    expect(s!.isNew).toBe(false);
  });

  it("returns a roster-only exploratory lead for a tagged community member without evidence", () => {
    const s = computeSuggestion({ person: person() as never, profile, opts, matches: [], sources: [] as never, grants: [], pubs: [], history: [], communityLabel: "ImmunoX", communityTagged: true, now });
    expect(s!.tier).toBe("exploratory");
    expect(s!.reasons[0]!.text).toBe("ImmunoX roster membership is the only evidence on file.");
    expect(s!.flags.some((f) => f.kind === "limited")).toBe(true);
  });

  it("ignores people below the exploratory bar", () => {
    const s = computeSuggestion({ person: person() as never, profile, opts, matches: [{ ...matches[0]!, similarity: 0.2 }], sources: sources(), grants: [], pubs: pubs as never, history: [], communityLabel: null, communityTagged: false, now });
    expect(s).toBeNull();
  });
});

describe("generic terms", () => {
  it("never counts research-in-general phrases as hits", () => {
    expect(termHits("A study of analytical methods for data-driven research", ["study designs", "analytical methods", "skin biology"])).toEqual([]);
    expect(termHits("Tissue-resident T cells in skin biology", ["study designs", "skin biology"])).toEqual(["skin biology"]);
  });
});
