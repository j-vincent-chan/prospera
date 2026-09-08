import { describe, expect, it } from "vitest";
import { legacyEvidenceId, notEligibleReason, snapshotForIneligible, snapshotFromFitResult, type IneligibleInput, type SnapshotInput } from "@/lib/fit/suggestion-snapshot";
import type { FitProvenance, FitResult, Tier } from "@/lib/fit/types";
import { DEFAULT_SUGGESTION_OPTIONS } from "@/lib/outreach/types";

const now = new Date("2026-09-06T12:00:00Z");

const provenance = (over: Partial<FitProvenance> = {}): FitProvenance => ({
  E: { failed: [], unknown: [] },
  P: { view: "recent", best_pair: { investigator: "molecular_cellular_mechanistic", notice: "molecular_cellular_mechanistic" }, excluded_hit: null, exception: null },
  U: { best_pair: { investigator: "L1", notice: "L1" } },
  D: { unmet_required: [], dominant_prohibited: null },
  T: { top_items: ["publication:p1:111", "grant:g1"], coded_matches: [{ code: "C04.557.470", depth: 3 }] },
  M: { met: ["laboratory_experimental"], missing: [] },
  K: { mechanisms_held: ["R01"], activity_code: "R01" },
  A: { runway_weeks: 12, in_pipeline: false, recently_dismissed: false },
  floors: { tier_by_floors: "strong", unmet: [] },
  collaborators: [],
  ...over,
});

const result = (tier: Tier, over: Partial<FitResult> = {}): FitResult => ({
  investigator_id: "p1",
  opportunity_id: "o1",
  engine_version: "engine-1",
  taxonomy_version: "fit-v1",
  computed_at: "2026-09-06T00:00:00.000Z",
  components: { E: 1, P: 1, U: 1, D: 0.9, T: 0.7, M: 1, O: 0.8, K: 0.8, A: 1 },
  caps: [],
  score: 78.5,
  tier,
  provenance: provenance(),
  flags: [],
  gap: null,
  why_not: null,
  rationale: "Paradigm 1.00 — molecular_cellular_mechanistic vs molecular_cellular_mechanistic · Topic 0.70 — 1 coded match at depth 3.",
  ...over,
});

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

const sources = [
  { investigator_id: "p1", source: "pubmed", state: "available", item_count: 14, unverified_count: 0, identity_method: "affiliation", last_refreshed_at: "2026-08-28T00:00:00Z", document_date: null, authorized_at: null, personal_statement: null, contributions: null, meta: null },
  { investigator_id: "p1", source: "reporter", state: "available", item_count: 1, unverified_count: 0, identity_method: "profile_id", last_refreshed_at: "2026-08-28T00:00:00Z", document_date: null, authorized_at: null, personal_statement: null, contributions: null, meta: null },
  { investigator_id: "p1", source: "biosketch", state: "not_requested", item_count: 0, unverified_count: 0, identity_method: null, last_refreshed_at: null, document_date: null, authorized_at: null, personal_statement: null, contributions: null, meta: null },
] as SnapshotInput["sources"];
const grants = [{ id: "g1", investigator_id: "p1", project_num: "5R01AR078112-03", project_title: "Tissue-resident memory T cells in psoriasis relapse", ic_name: "NIAMS — National Institute of Arthritis", fiscal_year: 2025, raw_json: { project_start_date: "2023-07-01", project_end_date: "2028-06-30" } }];
const pubs = [{ id: "pub1", investigator_id: "p1", pmid: "111", title: "Spatial atlas of tissue-resident T cells in psoriatic skin", journal: "Sci Immunol", publication_date: "2025-03-01", identity_method: "affiliation", identity_status: "verified" }];

const input = (r: FitResult, over: Partial<SnapshotInput> = {}): SnapshotInput => ({ person: person() as never, result: r, opts: DEFAULT_SUGGESTION_OPTIONS, sources, grants, pubs, history: [], communityLabel: "ImmunoX", now, ...over });
const ineligible = (failed: string[], over: Partial<IneligibleInput> = {}): IneligibleInput => ({ person: person() as never, failed, opts: DEFAULT_SUGGESTION_OPTIONS, sources, grants, pubs, history: [], communityLabel: "ImmunoX", now, ...over });

describe("fit-v1 suggestion snapshot (PR 2.2 bridge)", () => {
  it("maps the tiers onto the snapshot vocabulary and drops Poor — an E = 0 row included (such a pair is never stored)", () => {
    expect(snapshotFromFitResult(input(result("strong")))?.tier).toBe("strong");
    expect(snapshotFromFitResult(input(result("moderate")))?.tier).toBe("potential");
    expect(snapshotFromFitResult(input(result("exploratory")))?.tier).toBe("exploratory");
    expect(snapshotFromFitResult(input(result("poor", { score: 0 })))).toBeNull();
    expect(snapshotFromFitResult(input(result("poor", { score: 0, components: { E: 0, P: 1, U: 1, D: 1, T: 0.5, M: 1, O: 1, K: 1, A: 1 }, provenance: provenance({ E: { failed: ["ESI-only notice; investigator has held an R01-equivalent award"], unknown: [] } }) })))).toBeNull();
  });

  it("carries the rationale, the evidence ids in the legacy shape, the checklist and the score scale", () => {
    const s = snapshotFromFitResult(input(result("strong")))!;
    expect(s.investigatorId).toBe("p1");
    expect(s.score).toBeCloseTo(0.785, 6);
    expect(s.coverage).toBe("strong");
    expect(s.title).toBe("Associate Professor");
    expect(s.reasons[0]).toMatchObject({ source: "Fit engine · paradigm, design, topic", title: "Strong fit", evidenceIds: ["publication:111", "grant:5R01AR078112-03"] });
    expect(s.reasons[0]!.text).toMatch(/^Paradigm 1\.00/);
    expect(s.reasons.some((r) => r.title === "Track record" && /R01/.test(r.text))).toBe(true);
    expect(s.checklist.map((c) => c.facet)).toEqual(["Paradigm", "Unit", "Design", "Topic", "Methods", "Mechanism", "Eligibility", "Exclusions"]);
    expect(s.checklist.every((c) => c.mark === "yes")).toBe(true);
    expect(s.checklist[3]!.value).toContain("1 coded match (depth 3)");
    expect(s.groups.map((g) => g.key)).toEqual(["research", "funding", "self", "institutional", "history"]);
    expect(s.groups[0]!.items[0]).toMatchObject({ id: "publication:111", heading: "Spatial atlas of tissue-resident T cells in psoriatic skin", identityItem: { kind: "publication", rowId: "pub1" } });
    expect(s.groups[1]!.items[0]!.id).toBe("grant:5R01AR078112-03");
    expect(s.identityLine).toBe("confirmed (profile ID + affiliation)");
    expect(s.freshWarn).toBe(false);
    expect(s.isNew).toBe(true);
    expect(s.excludedReason).toBeNull();
    expect(s.flags).toEqual([]);
    expect(s.summary).toBe(s.reasons[0]!.text);
  });

  it("an investigator the eligibility pass excluded is written as excluded with the failed rule, the way the legacy rule excludes", () => {
    const failed = ["ESI-only notice; investigator has held an R01-equivalent award", "independent appointment required; career stage on file: trainee"];
    const s = snapshotForIneligible(ineligible(failed));
    expect(notEligibleReason(failed)).toBe("Not eligible: ESI-only notice; investigator has held an R01-equivalent award; independent appointment required; career stage on file: trainee");
    expect(s.investigatorId).toBe("p1");
    expect(s.tier).toBe("exploratory");
    expect(s.score).toBe(0);
    expect(s.coverage).toBe("strong");
    expect(s.title).toBe("Associate Professor");
    expect(s.excludedReason).toBe(notEligibleReason(failed));
    expect(s.summary).toBe(notEligibleReason(failed));
    expect(s.flags).toEqual([{ kind: "eligibility", text: `${notEligibleReason(failed)}.` }]);
    expect(s.reasons).toEqual([{ text: notEligibleReason(failed), source: "Fit engine · eligibility", title: "Not eligible", evidenceIds: [] }]);
    expect(s.checklist).toEqual([{ facet: "Eligibility", value: failed.join("; "), mark: "no" }]);
    expect(s.groups.map((g) => g.key)).toEqual(["research", "funding", "self", "institutional", "history"]);
    expect(s.groups[0]!.items).toEqual([]);
    expect(s.groups[0]!.empty).toMatch(/excluded by an eligibility rule/);
    expect(s.groups[1]!.items[0]).toMatchObject({ id: "grant:5R01AR078112-03", inferred: "Holds an active R01 as PI." });
    expect(s.groups[3]!.items[0]!.inferred).toBe(notEligibleReason(failed));
    expect(s.identityLine).toBe("confirmed (profile ID + affiliation)");
    expect(s.freshWarn).toBe(false);
    expect(s.isNew).toBe(true);
    // do-not-contact still wins, and the legacy option rule and staleness apply exactly as on the scored path
    expect(snapshotForIneligible(ineligible(failed, { person: person({ do_not_contact_at: "2026-01-01T00:00:00Z" }) as never })).excludedReason).toBe("Do not contact");
    const stale = snapshotForIneligible(ineligible(failed, { sources: sources.map((x) => ({ ...x, last_refreshed_at: x.last_refreshed_at ? "2025-06-01T00:00:00Z" : null })) }));
    expect(stale.flags.map((f) => f.kind)).toEqual(["eligibility", "stale"]);
    expect(stale.freshWarn).toBe(true);
    const contacted = snapshotForIneligible(ineligible(failed, { history: [{ investigator_id: "p1", kind: "sent", at: "2026-08-20T00:00:00Z", label: "sent", notice: "RFA-X", note: null }] }));
    expect(contacted.excludedReason).toBe(notEligibleReason(failed));
    expect(contacted.historyLine).toMatch(/^Contacted/);
    expect(contacted.isNew).toBe(false);
  });

  it("flags follow the caps and provenance; the moderate floors mark the checklist", () => {
    const r = result("moderate", {
      components: { E: 1, P: 0.6, U: 0.5, D: 0.55, T: 0.3, M: 0.2, O: 0.5, K: 0.2, A: 1 },
      caps: ["eligibility_unknown", "low_profile_confidence", "runway_short"],
      gap: "Topic 0.30 is below the Moderate floor 0.45 — no coded match at depth 3.",
      provenance: provenance({ E: { failed: [], unknown: ["ESI status not on file"] }, P: { view: "career", best_pair: null, excluded_hit: "clinical_trials", exception: null }, T: { top_items: [], coded_matches: [] } }),
    });
    const s = snapshotFromFitResult(input(r))!;
    expect(s.tier).toBe("potential");
    expect(s.flags.map((f) => f.kind)).toEqual(["eligibility", "conflict", "limited", "limited"]);
    expect(s.flags[0]!.text).toContain("ESI status not on file");
    expect(s.flags[1]!.text).toContain("clinical trials");
    expect(s.reasons[1]).toMatchObject({ title: "What would move this up" });
    const marks = Object.fromEntries(s.checklist.map((c) => [c.facet, c.mark]));
    expect(marks).toMatchObject({ Paradigm: "yes", Unit: "yes", Design: "yes", Topic: "no", Methods: "no", Mechanism: "no", Eligibility: "unclear", Exclusions: "conflict" });
    expect(s.groups[0]!.items).toEqual([]);
    expect(s.summary).toContain("Moderate floor");
  });

  it("applies the Outreach options and do-not-contact exactly as legacy", () => {
    const base = result("strong");
    const contacted = snapshotFromFitResult(input(base, { history: [{ investigator_id: "p1", kind: "sent", at: "2026-08-20T00:00:00Z", label: "sent", notice: "RFA-X", note: null }] }))!;
    expect(contacted.excludedReason).toMatch(/Contacted 17 days ago/);
    expect(contacted.historyLine).toMatch(/^Contacted/);
    expect(contacted.isNew).toBe(false);
    const allowed = snapshotFromFitResult(input(base, { opts: { ...DEFAULT_SUGGESTION_OPTIONS, excludeRecentlyContacted: false }, history: [{ investigator_id: "p1", kind: "sent", at: "2026-08-20T00:00:00Z", label: "sent", notice: "RFA-X", note: null }] }))!;
    expect(allowed.excludedReason).toBeNull();
    const established = snapshotFromFitResult(input(base, { opts: { ...DEFAULT_SUGGESTION_OPTIONS, earlyCareerOnly: true } }))!;
    expect(established.excludedReason).toBe("Early-career investigators only (option)");
    const renewal = snapshotFromFitResult(input(base, { opts: { ...DEFAULT_SUGGESTION_OPTIONS, excludeRenewalsDue: true }, grants: [{ ...grants[0]!, raw_json: { project_start_date: "2022-01-01", project_end_date: "2026-12-01" } }] }))!;
    expect(renewal.excludedReason).toMatch(/ends within 6 months/);
    const dnc = snapshotFromFitResult(input(base, { person: person({ do_not_contact_at: "2026-01-01T00:00:00Z" }) as never }))!;
    expect(dnc.excludedReason).toBe("Do not contact");
  });

  it("stale sources raise the stale flag; a never-refreshed profile says so", () => {
    const stale = sources.map((s) => ({ ...s, last_refreshed_at: s.last_refreshed_at ? "2025-06-01T00:00:00Z" : null }));
    const s = snapshotFromFitResult(input(result("strong"), { sources: stale }))!;
    expect(s.flags.map((f) => f.kind)).toEqual(["stale"]);
    expect(s.freshWarn).toBe(true);
    expect(s.freshLine).toMatch(/^Stale/);
    const never = snapshotFromFitResult(input(result("strong"), { sources: stale.map((x) => ({ ...x, last_refreshed_at: null })) }))!;
    expect(never.freshLine).toMatch(/^Never refreshed/);
  });

  it("legacyEvidenceId rewrites the engine's ids into the snapshot's", () => {
    const grantsById = new Map([["g1", "5R01AR078112-03"]]);
    expect(legacyEvidenceId("publication:p1:111", grantsById)).toBe("publication:111");
    expect(legacyEvidenceId("grant:g1", grantsById)).toBe("grant:5R01AR078112-03");
    expect(legacyEvidenceId("grant:unknown", grantsById)).toBe("grant:unknown");
    expect(legacyEvidenceId("trial:p1:NCT01", grantsById)).toBe("trial:NCT01");
    expect(legacyEvidenceId("biosketch:p1:statement", grantsById)).toBe("biosketch:p1:statement");
  });
});
