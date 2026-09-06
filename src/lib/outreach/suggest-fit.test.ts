/**
 * `runSuggestions` under `fit_engine = 'fit-v1'` (PR 2.2) against the fake
 * PostgREST builder: the nightly rows become snapshots, the excluded list
 * comes from the eligibility pass over the stored profiles, and the two
 * "not ready" states are explicit errors on the item, never a silent empty
 * run. The legacy branch (embedding + match_evidence) is not exercised here.
 */
import { describe, expect, it } from "vitest";
import { fakeDb, type FakeTables, type Row } from "@/lib/fit/__fixtures__/fake-db";
import { hydrateInvestigator, hydrateOpportunity } from "@/lib/fit/engine/fixtures";
import { runSuggestions } from "./suggest";

const profile = { version: 1, extractedAt: "2026-09-01T00:00:00Z", source: "llm", facets: { topics: ["ferroptosis"], disease: [], methods: [], disciplines: [], stage: [], mechanism: ["R01"], eligibility: [], team: [], excluded: [] } };

const provenance = {
  engine: "engine-1",
  E: { failed: [], unknown: [] },
  P: { view: "recent", best_pair: { investigator: "molecular_cellular_mechanistic", notice: "molecular_cellular_mechanistic" }, excluded_hit: null, exception: null },
  U: { best_pair: { investigator: "L1", notice: "L1" } },
  D: { unmet_required: [], dominant_prohibited: null },
  T: { top_items: ["publication:p1:111"], coded_matches: [{ code: "C04.557.470", depth: 3 }] },
  M: { met: [], missing: [] },
  K: { mechanisms_held: ["R01"], activity_code: "R01" },
  A: { runway_weeks: 12, in_pipeline: false, recently_dismissed: false },
  floors: { tier_by_floors: "strong", unmet: [] },
  collaborators: [],
};

const person = (id: string, over: Row = {}): Row => ({ id, full_name: `Person ${id}`, first_name: "P", last_name: id, email: `${id}@ucsf.edu`, home_department: "Medicine", division: null, rank: "member", research_community_id: null, created_at: "2025-01-10T00:00:00Z", do_not_contact_at: null, raw_profile_json: { title: "Professor" }, archived_at: null, ...over });

/** An ESI-only notice: p1 (ESI) is scored Strong, p2 (has held an R01) is excluded by the eligibility pass, p3 has no profile row and no result. */
function tables(over: Partial<FakeTables> = {}): FakeTables {
  const notice = hydrateOpportunity("o1", { mechanism: { activity_code: "R01" }, paradigm: { required: { molecular_cellular_mechanistic: 1 } }, eligibility: { esi_only: true } });
  return {
    outreach_items: [{ id: "item1", team_id: "t1", opportunity_id: "o1", profile, profile_version: 1, suggestion_options: null, suggestions_state: "idle" }],
    teams: [{ id: "t1", fit_engine: "fit-v1" }],
    funding_opportunities: [{ id: "o1", title: "Mechanisms of ferroptosis (R01)", opportunity_number: "RFA-X-26-001", agency: "NIH", description: null, raw_payload_json: null, activity_code: "R01", activity_title: null, award_ceiling: null, clinical_trial_note: null, applicant_types: null, funding_instrument: null, updated_at: "2026-09-01T00:00:00Z", close_date: "2027-01-01", next_due: "2026-12-05", expiration_date: null, receipt_cycles: null }],
    fit_results: [
      { investigator_id: "p1", opportunity_id: "o1", engine_version: "fit-v1", components: { E: 1, P: 1, U: 1, D: 0.9, T: 0.7, M: 1, O: 0.8, K: 0.8, A: 1 }, caps: [], score: "78.5", tier: "strong", provenance, adjudication: null, rationale: "Paradigm 1.00 · Topic 0.70.", why_not: null, gap: null, flags: [], computed_at: "2026-09-06T00:00:00Z" },
      { investigator_id: "p3", opportunity_id: "o1", engine_version: "fit-v1", components: { E: 1, P: 0.2, U: 1, D: 0.5, T: 0.2, M: 1, O: 0.5, K: 0.5, A: 1 }, caps: ["paradigm_gate"], score: "4", tier: "poor", provenance: { engine: "engine-1", E: provenance.E, P: provenance.P }, adjudication: null, rationale: null, why_not: "Paradigm 0.20 is below the gate.", gap: null, flags: [], computed_at: "2026-09-06T00:00:00Z" },
    ],
    opportunity_fit_profiles: [{ opportunity_id: "o1", profile: notice }],
    investigator_fit_profiles: [
      { investigator_id: "p1", profile: hydrateInvestigator("p1", { paradigm: { recent: { molecular_cellular_mechanistic: 0.9 } }, characteristics: { esi: true, career_stage: "early" } }) },
      { investigator_id: "p2", profile: hydrateInvestigator("p2", { paradigm: { recent: { molecular_cellular_mechanistic: 0.9 } }, characteristics: { esi: false, career_stage: "senior", mechanisms_held: ["R01"] } }) },
    ],
    investigators: [person("p1"), person("p2"), person("p3")],
    investigator_sources: [],
    investigator_nih_grants: [],
    investigator_publications: [{ id: "pub1", investigator_id: "p1", pmid: "111", title: "Ferroptosis in cholangiocarcinoma", journal: "Cell", publication_date: "2025-03-01", identity_method: "affiliation", identity_status: "verified" }],
    pipeline_communities: [],
    outreach_recipients: [],
    outreach_suggestions: [],
    outreach_message_recipients: [],
    outreach_activity: [],
    ...over,
  };
}

describe("runSuggestions · fit-v1 (fake client)", () => {
  it("writes one snapshot per scored person and lists every ineligible investigator from the eligibility pass", async () => {
    const db = fakeDb(tables());
    const r = await runSuggestions(db, "item1", { id: "u1", name: "Vincent" });
    expect(r).toMatchObject({ ok: true, suggested: 1, excluded: 1, communities: 0 });
    const upsert = db.log.writes.find((w) => w.table === "outreach_suggestions" && w.op === "upsert")!;
    const byPerson = new Map(upsert.rows.map((row) => [row.investigator_id as string, row]));
    expect(Array.from(byPerson.keys()).sort()).toEqual(["p1", "p2"]);
    expect(byPerson.get("p1")).toMatchObject({ item_id: "item1", tier: "strong", status: "active", score: 0.785, excluded_reason: null, summary: "Paradigm 1.00 · Topic 0.70." });
    expect((byPerson.get("p1")!.evidence as { groups: Array<{ key: string; items: Array<{ id: string }> }> }).groups[0]!.items[0]!.id).toBe("publication:111");
    expect(byPerson.get("p2")).toMatchObject({ tier: "exploratory", status: "excluded", score: 0, excluded_reason: "Not eligible: ESI-only notice; investigator has held an R01-equivalent award" });
    // the Poor row was not read (tiers narrowed), and p3 — no profile, no surfaced row — is not written
    expect(db.log.reads.filter((x) => x.startsWith("fit_results:"))).toHaveLength(1);
    expect(db.log.reads.filter((x) => x.startsWith("investigator_fit_profiles:"))).toEqual(["investigator_fit_profiles:investigator_id, profile"]);
    expect(db.log.reads.some((x) => x.startsWith("evidence_embeddings") || x.includes("match_evidence"))).toBe(false);
    const item = db.tables.outreach_items![0] as { suggestions_state: string; suggestions_error: string | null };
    expect(item.suggestions_state).toBe("ready");
    expect(item.suggestions_error).toBeNull();
    const activity = db.log.writes.find((w) => w.table === "outreach_activity")!.rows[0] as { text: string; payload: Row };
    expect(activity.text).toContain("1 people suggested, 1 excluded by eligibility or options");
    expect(activity.payload).toMatchObject({ suggested: 1, excluded: 1 });
  });

  it("a scored notice whose surfaced rows are all Poor is an empty run, not an error", async () => {
    const t = tables();
    t.fit_results = [t.fit_results![1]!];
    const db = fakeDb(t);
    const r = await runSuggestions(db, "item1");
    expect(r).toMatchObject({ ok: true, suggested: 0, excluded: 1 });
    expect(db.log.reads.filter((x) => x.startsWith("fit_results:"))).toHaveLength(2);
  });

  it("before the migration the item is put in error naming the migration; an unscored or unprofiled notice likewise", async () => {
    const missing = fakeDb(tables({ fit_results: null }));
    expect(await runSuggestions(missing, "item1")).toEqual({ ok: false, error: expect.stringMatching(/fit_results is not on the database yet \(apply supabase\/migrations\/20260917100000_fit_results_and_engine_flag\.sql\)/) });
    expect((missing.tables.outreach_items![0] as { suggestions_state: string }).suggestions_state).toBe("error");
    expect(missing.log.writes.some((w) => w.table === "outreach_suggestions")).toBe(false);

    const unscored = fakeDb(tables({ fit_results: [] }));
    expect(await runSuggestions(unscored, "item1")).toEqual({ ok: false, error: expect.stringMatching(/has not been scored yet/) });

    const unprofiled = fakeDb(tables({ fit_results: [], opportunity_fit_profiles: [] }));
    expect(await runSuggestions(unprofiled, "item1")).toEqual({ ok: false, error: expect.stringMatching(/has no fit profile yet/) });
  });

  it("a passed deadline excludes everyone (E = 0 for every pair)", async () => {
    const t = tables();
    (t.funding_opportunities![0] as Row).next_due = "2026-01-05";
    (t.funding_opportunities![0] as Row).close_date = "2026-01-05";
    const db = fakeDb(t);
    const r = await runSuggestions(db, "item1");
    expect(r).toMatchObject({ ok: true, suggested: 0, excluded: 2 });
    const upsert = db.log.writes.find((w) => w.table === "outreach_suggestions" && w.op === "upsert")!;
    expect(Object.fromEntries(upsert.rows.map((row) => [row.investigator_id, row.excluded_reason]))).toEqual({
      p1: "Not eligible: deadline has passed",
      p2: "Not eligible: ESI-only notice; investigator has held an R01-equivalent award; deadline has passed",
    });
  });
});
