/**
 * The investigator page's fit surface (PR 3.2) on the fake PostgREST
 * builder: the three groups and their reads, the D7 gate (a PI's page reads
 * neither Exploratory nor Poor), the rationale's evidence, the judged marker,
 * the profile-provenance fallback, and the missing table.
 */
import { describe, expect, it } from "vitest";
import { fakeDb, type Row } from "@/lib/fit/__fixtures__/fake-db";
import { loadInvestigatorFitSurface } from "@/lib/fit/investigator-fits";
import { FIT_RESULT_VERDICT_COLUMNS } from "@/lib/fit/results";

const INV = "0f5b1b2c-1111-4222-8333-444455556666";
const PUB = `publication:${INV}:31000001`;
const GRANT = "grant:9a9a9a9a-2222-4333-8444-555566667777";
const LIST = `fit_results:${FIT_RESULT_VERDICT_COLUMNS}`;
const WHY = LIST;
const NOTICES = "funding_opportunities:id, title, agency, agency_code, opportunity_number, activity_code, award_ceiling, receipt_cycles, cycles_source, standard_dates_apply, close_date, expiration_date, forecasted, status";
const NOTICE_PROFILES = "opportunity_fit_profiles:opportunity_id, profile, complete:sources->complete";
const INV_PROFILES = "investigator_fit_profiles:investigator_id, profile";

const notices = [
  { id: "n1", title: "Mechanisms of ferroptosis", agency: "NIH", close_date: "2027-01-01" },
  { id: "n2", title: "Trials in cancer", agency: "NIH", close_date: "2027-01-01" },
  { id: "n3", title: "Down syndrome awards", agency: "NIH", close_date: "2027-01-01" },
  { id: "n4", title: "Health services", agency: "AHRQ", close_date: "2027-01-01" },
  { id: "n5", title: "Population cohorts", agency: "NIH", close_date: "2027-01-01" },
];

const fr = (opportunity_id: string, tier: string, score: number | string, over: Row = {}): Row => ({ investigator_id: INV, opportunity_id, tier, score, rationale: null, gap: null, why_not: null, top_items: null, best_pair: null, judged_at: null, judged_tier: null, judged_from: null, judged_confidence: null, judged_evidence: null, components: { E: 1, P: 0.8, U: 0.7, D: 0.7, T: 0.7, M: 0.6, O: 0.6, K: 0.5, A: 1 }, caps: [], flags: [], ...over });

const results = [
  fr("n1", "strong", "78.25", { rationale: `Paradigm 1.00 · Topic 0.70; 2 compatible items (${PUB}, ${GRANT})`, judged_at: "2026-09-06T09:45:00Z", judged_tier: "strong", judged_from: "strong", judged_confidence: "high", judged_evidence: [{ id: "PMID:31000001", ref: PUB }] }),
  fr("n2", "exploratory", "41.5", { rationale: "Paradigm 0.60 — 0 compatible items", gap: "Design: rct required, none in the evidence.", best_pair: { investigator: "clinical_observational", notice: "clinical_trials" } }),
  fr("n3", "poor", "10", { why_not: "Paradigm: notice requires Epidemiology; yours is Clinical trials (support 0.05)." }),
  fr("n4", "poor", "22", { why_not: "Unit: notice works at L5; yours is L3 (0.10)." }),
  fr("n5", "moderate", "88", { rationale: "Paradigm 0.80 · Topic 0.50", top_items: [GRANT] }),
  { ...fr("n1", "strong", "90", { rationale: "someone else" }), investigator_id: "p2" },
];

const tables = () => ({
  funding_opportunities: notices.map((n) => ({ ...n })),
  fit_results: results.map((r) => ({ ...r })),
  investigator_publications: [{ investigator_id: INV, pmid: "31000001", title: "Anifrolumab in SLE", journal: "Lancet Rheumatol", publication_date: "2024-03-01" }],
  investigator_nih_grants: [{ id: "9a9a9a9a-2222-4333-8444-555566667777", project_num: "5R01AR070001-03", project_title: "Targeted agents", fiscal_year: 2025, activity_code: "R01" }],
  investigator_clinical_trials: [] as Row[],
  investigator_fit_profiles: [{ investigator_id: INV, provenance: [{ axis: "paradigm", category: "clinical_observational", top_items: [PUB] }], profile: { provenance: [{ axis: "paradigm", category: "clinical_observational", top_items: [PUB] }] } }],
});

describe("loadInvestigatorFitSurface · strategist", () => {
  it("three groups from bounded reads: Strong then Moderate, Exploratory, the Poor rows with their count, the titles, the evidence titles — and the profile's provenance only for a row that cites nothing", async () => {
    const db = fakeDb(tables());
    const s = await loadInvestigatorFitSurface(db, INV, { audience: "strategist", recommended: 5, exploratory: 5, ruledOut: 1 });
    expect(s).toMatchObject({ engine: "fit-v1", audience: "strategist", unavailable: false, scored: true, openNotices: 5, poorTotal: 2 });
    expect(s.recommended.map((r) => [r.opportunityId, r.tier, r.fitTier, r.score])).toEqual([
      ["n1", "strong", "strong", 78.25],
      ["n5", "potential", "moderate", 88],
    ]);
    // the Strong row: a judged pair (the marker) whose stored rationale is the engine's — it names no judge short id, so the engine's ids in the text are the citations and read as titles
    const strong = s.recommended[0]!;
    expect(strong.judged).toMatchObject({ tier: "strong", from: "strong", changed: false, label: "judged · high" });
    expect(strong.rationale.source).toBe("judged");
    expect(strong.rationale.fallback).toBe("cited");
    expect(strong.rationale.evidence.map((e) => e.title)).toEqual(["Anifrolumab in SLE", "Targeted agents"]);
    expect(strong.rationale.text).toBe("Paradigm 1.00 · Topic 0.70; 2 compatible items (“Anifrolumab in SLE”, 5R01AR070001-03)");
    expect(strong.lead).toBeNull();
    // the Moderate row: nothing in the text, stage 5's top item
    const moderate = s.recommended[1]!;
    expect(moderate.judged).toBeNull();
    expect(moderate.rationale).toMatchObject({ fallback: "top_items", source: "engine" });
    expect(moderate.rationale.evidence.map((e) => e.title)).toEqual(["Targeted agents"]);
    // the Exploratory row leads with the gap and cites the profile's evidence behind the paradigm match
    expect(s.exploratory.map((r) => [r.opportunityId, r.tier, r.lead])).toEqual([["n2", "exploratory", "Design: rct required, none in the evidence."]]);
    expect(s.exploratory[0]!.rationale).toMatchObject({ fallback: "profile" });
    expect(s.exploratory[0]!.rationale.evidence.map((e) => e.id)).toEqual([PUB]);
    expect(s.exploratory[0]!.why).toBe("Paradigm 0.60 — 0 compatible items Design: rct required, none in the evidence.");
    // §3f: the nearest ruled-out row in the same row shape, and the count of every Poor row
    expect(s.ruledOut.map((r) => [r.opportunityId, r.title, r.score, r.ruledOut, r.verdicts.label, r.verdicts.reason])).toEqual([
      ["n4", "Health services", 22, true, "ruled_out", "Unit: notice works at L5; yours is L3."],
    ]);
    // and it does not read as reassuring: no chip is `ok`, the caveat blocks (D-e)
    const out = s.ruledOut[0]!;
    expect(out.verdicts.caveat.tone).toBe("blocking");
    expect([out.verdicts.approach.tone, out.verdicts.eligibility.tone, out.verdicts.evidence.tone]).not.toContain("ok");
    // every row's rationale cites at least one item
    for (const r of [...s.recommended, ...s.exploratory]) expect(r.rationale.evidence.length).toBeGreaterThan(0);

    // every read bounded, none per candidate: the corpus count, the four
    // `fit_results` reads, the notices, and one each for the two counterpart
    // profiles the verdicts are read against (C3).
    expect(db.log.reads).toEqual([
      "funding_opportunities:id, opportunity_fit_profiles!inner(opportunity_id)",
      LIST, // strong
      LIST, // moderate
      LIST, // exploratory
      WHY, // ruled out
      NOTICES,
      NOTICE_PROFILES,
      INV_PROFILES,
      "investigator_publications:pmid, title, journal, publication_date",
      "investigator_nih_grants:id, project_num, project_title, fiscal_year, activity_code",
    ]);
  });

  it("Recommended stops reading once full: a Strong is never cut by a higher-scoring Moderate, and Moderate is not read", async () => {
    const db = fakeDb({ ...tables(), fit_results: [fr("n1", "strong", 60, { rationale: "a", top_items: [GRANT] }), fr("n2", "strong", 70, { rationale: "b", top_items: [GRANT] }), fr("n3", "moderate", 99, { rationale: "c", top_items: [GRANT] })] });
    const s = await loadInvestigatorFitSurface(db, INV, { audience: "strategist", recommended: 2, exploratory: 2, ruledOut: 2 });
    expect(s.recommended.map((r) => [r.opportunityId, r.score])).toEqual([
      ["n2", 70],
      ["n1", 60],
    ]);
    expect(db.log.reads.filter((x) => x.startsWith("fit_results:"))).toEqual([LIST, LIST, WHY]);
    expect(s.poorTotal).toBe(0);
    expect(s.ruledOut).toEqual([]);
  });

  it("a Moderate that outscores a Strong lists after it (tier before score)", async () => {
    const db = fakeDb({ ...tables(), fit_results: [fr("n2", "moderate", 88, { rationale: "m", top_items: [GRANT] }), fr("n1", "strong", 66, { rationale: "s", top_items: [GRANT] })] });
    const s = await loadInvestigatorFitSurface(db, INV, { audience: "strategist" });
    expect(s.recommended.map((r) => [r.opportunityId, r.tier])).toEqual([
      ["n1", "strong"],
      ["n2", "potential"],
    ]);
  });
});

describe("loadInvestigatorFitSurface · a PI on their own page (D7)", () => {
  it("reads Recommended only: no Exploratory read, no Poor read, no Why not?, no Poor count", async () => {
    const db = fakeDb(tables());
    const s = await loadInvestigatorFitSurface(db, INV, { audience: "investigator", recommended: 5, exploratory: 5, ruledOut: 5 });
    expect(s.audience).toBe("investigator");
    expect(s.recommended.map((r) => r.opportunityId)).toEqual(["n1", "n5"]);
    expect(s.exploratory).toEqual([]);
    expect(s.ruledOut).toEqual([]);
    expect(s.poorTotal).toBe(0);
    // Recommended only: two reads, and neither the Exploratory nor the ruled-out one.
    expect(db.log.reads.filter((x) => x.startsWith("fit_results:"))).toEqual([LIST, LIST]);
    // …and no per-row action anywhere in the PI's list (§3h).
    for (const r of s.recommended) expect(r.verdicts.action).toBeNull();
  });

  it("with nothing Recommended, one head count says whether the person was scored at all — a PI sees no Poor row", async () => {
    const db = fakeDb({ ...tables(), fit_results: [fr("n3", "poor", 10, { why_not: "poor" }), fr("n2", "exploratory", 40, { rationale: "lead", gap: "gap" })] });
    const s = await loadInvestigatorFitSurface(db, INV, { audience: "investigator" });
    expect(s).toMatchObject({ scored: true, recommended: [], exploratory: [], ruledOut: [], poorTotal: 0 });
    expect(db.log.reads.filter((x) => x.startsWith("fit_results:"))).toEqual([LIST, LIST, "fit_results:opportunity_id"]);
    const none = await loadInvestigatorFitSurface(fakeDb({ ...tables(), fit_results: [] }), INV, { audience: "investigator" });
    expect(none.scored).toBe(false);
  });
});

describe("loadInvestigatorFitSurface · states", () => {
  it("before the migration the surface is unavailable; with no row the person is unscored; only Poor rows is scored with an empty list and a Why not?", async () => {
    expect(await loadInvestigatorFitSurface(fakeDb({ ...tables(), fit_results: null }), INV, { audience: "strategist" })).toMatchObject({ unavailable: true, scored: false, openNotices: 5 });
    expect(await loadInvestigatorFitSurface(fakeDb({ ...tables(), fit_results: [] }), INV, { audience: "strategist" })).toMatchObject({ unavailable: false, scored: false, recommended: [], exploratory: [], ruledOut: [], poorTotal: 0 });
    const onlyPoor = await loadInvestigatorFitSurface(fakeDb({ ...tables(), fit_results: [fr("n3", "poor", 10, { why_not: "Paradigm: epidemiology vs. required molecular mechanism (0.05)." })] }), INV, { audience: "strategist" });
    expect(onlyPoor).toMatchObject({ scored: true, recommended: [], exploratory: [], poorTotal: 1 });
    expect(onlyPoor.ruledOut.map((w) => [w.title, w.verdicts.reason])).toEqual([["Down syndrome awards", "Paradigm: epidemiology vs. required molecular mechanism."]]);
  });

  it("a Poor row without a why_not still reads as a sentence; a row whose notice is gone is dropped", async () => {
    const db = fakeDb({ ...tables(), fit_results: [fr("n3", "poor", 10), fr("gone", "strong", 90, { rationale: "no notice" })] });
    const s = await loadInvestigatorFitSurface(db, INV, { audience: "strategist" });
    expect(s.recommended).toEqual([]);
    // no `why_not` and no rationale: the reason falls back to the missed floor, said in words
    expect(s.ruledOut.map((w) => w.verdicts.label)).toEqual(["ruled_out"]);
    expect(s.ruledOut[0]!.verdicts.reason).toMatch(/[A-Za-z]/);
  });
});
