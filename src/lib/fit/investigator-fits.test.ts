/**
 * The investigator page's fit surface (PR 3.2) on the fake PostgREST
 * builder: the three groups and their reads, the D7 gate (a PI's page reads
 * neither Exploratory nor Poor), the rationale's evidence, the judged marker,
 * the profile-provenance fallback, and the missing table.
 */
import { describe, expect, it } from "vitest";
import { fakeDb, type Row } from "@/lib/fit/__fixtures__/fake-db";
import { loadInvestigatorFitSurface } from "@/lib/fit/investigator-fits";
import { FIT_RESULT_DETAIL_COLUMNS, FIT_RESULT_LIST_COLUMNS, FIT_RESULT_WHY_NOT_COLUMNS } from "@/lib/fit/results";

const INV = "0f5b1b2c-1111-4222-8333-444455556666";
const PUB = `publication:${INV}:31000001`;
const GRANT = "grant:9a9a9a9a-2222-4333-8444-555566667777";
const LIST = `fit_results:${FIT_RESULT_LIST_COLUMNS}`;
const WHY = `fit_results:${FIT_RESULT_WHY_NOT_COLUMNS}`;
const DETAIL = `fit_results:${FIT_RESULT_DETAIL_COLUMNS}`;
const PROFILE = "investigator_fit_profiles:investigator_id, taxonomy_version, item_count, pending_items, computed_at, confidence, evidence_summary:profile->evidence_summary, collaborators:profile->collaborators, provenance:profile->provenance";
const PROFILE_NO_PROV = "investigator_fit_profiles:investigator_id, taxonomy_version, item_count, pending_items, computed_at, confidence, evidence_summary:profile->evidence_summary, collaborators:profile->collaborators";

const notices = [
  { id: "n1", title: "Mechanisms of ferroptosis", agency: "NIH", close_date: "2027-01-01" },
  { id: "n2", title: "Trials in cancer", agency: "NIH", close_date: "2027-01-01" },
  { id: "n3", title: "Down syndrome awards", agency: "NIH", close_date: "2027-01-01" },
  { id: "n4", title: "Health services", agency: "AHRQ", close_date: "2027-01-01" },
  { id: "n5", title: "Population cohorts", agency: "NIH", close_date: "2027-01-01" },
];

/** The fake builder returns whole rows, so a fixture carries the list aliases and the detail aliases as flat keys. */
const fr = (opportunity_id: string, tier: string, score: number | string, over: Row = {}): Row => ({
  investigator_id: INV,
  opportunity_id,
  tier,
  score,
  rationale: null,
  gap: null,
  why_not: null,
  flags: [],
  computed_at: "2026-09-06T09:45:00Z",
  engine_version: "fit-v1",
  components: { E: 1, P: 0.8, U: 0.7, D: 0.4, T: 0.5, M: 0.6, O: 0.5, K: 0.3, A: 0.9 },
  caps: [],
  top_items: null,
  best_pair: null,
  judged_at: null,
  judged_tier: null,
  judged_from: null,
  judged_confidence: null,
  judged_evidence: null,
  e_failed: null,
  e_unknown: null,
  p_view: "recent",
  p_best_pair: null,
  p_excluded: null,
  p_exception: null,
  u_best_pair: null,
  d_unmet: null,
  d_prohibited: null,
  t_coded: null,
  t_items: null,
  m_met: null,
  m_missing: null,
  k_held: null,
  k_code: null,
  floors_tier: tier,
  floors_unmet: null,
  collaborators: null,
  ...over,
});

const results = [
  fr("n1", "strong", "78.25", { rationale: `Paradigm 1.00 · Topic 0.70; 2 compatible items (${PUB}, ${GRANT})`, judged_at: "2026-09-06T09:45:00Z", judged_tier: "strong", judged_from: "strong", judged_confidence: "high", judged_evidence: [{ id: "PMID:31000001", ref: PUB }] }),
  fr("n2", "exploratory", "41.5", {
    rationale: "Paradigm 0.60 — 0 compatible items",
    gap: "Design: rct | early_phase_trial required, none in the evidence. Topic 0.18 is below the Moderate floor 0.35.",
    best_pair: { investigator: "clinical_observational", notice: "clinical_trials" },
    p_best_pair: { investigator: "clinical_observational", notice: "clinical_trials" },
    flags: ["mechanism far above readiness; consider as project lead, not PI"],
    caps: ["design_required_unsupported"],
    d_unmet: [["rct", "early_phase_trial"]],
    t_coded: [{ code: "C20.111.197", depth: 3 }],
    e_unknown: ['citizenship rule not evaluated: "Applicants must be citizens."'],
    floors_unmet: [{ key: "T", value: 0.18, floor: 0.35 }],
    collaborators: ["7a2e0000-2222-4333-8444-555566667777"],
  }),
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
  investigator_fit_profiles: [
    {
      investigator_id: INV,
      taxonomy_version: "2026.09",
      item_count: 214,
      pending_items: 12,
      computed_at: "2026-09-05T04:10:00Z",
      confidence: { paradigm: "high", unit: "high", design: "low", materials: "medium", objective: "medium", topic: "high" },
      evidence_summary: { publications_verified: 187, grants: 22, trials: 5, trials_as_pi: 1, biosketch: "not_requested", self_declared: false },
      collaborators: [{ id: "7a2e0000-2222-4333-8444-555566667777", name: "Grace Hopper", dominant_family: "clinical", categories: ["clinical_trials"] }],
      provenance: [{ axis: "paradigm", category: "clinical_observational", top_items: [PUB] }],
      profile: { provenance: [{ axis: "paradigm", category: "clinical_observational", top_items: [PUB] }] },
    },
  ],
});

describe("loadInvestigatorFitSurface · strategist", () => {
  it("three groups from bounded reads: Strong then Moderate, Exploratory, the Poor rows with their count, the titles, the evidence titles — and the profile's provenance only for a row that cites nothing", async () => {
    const db = fakeDb(tables());
    const s = await loadInvestigatorFitSurface(db, INV, { audience: "strategist", recommended: 5, exploratory: 5, whyNot: 1 });
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
    // the Exploratory row leads with the binding gap — the first clause, its ids read as labels — and cites the profile's evidence behind the paradigm match
    const expl = s.exploratory[0]!;
    expect(s.exploratory.map((r) => [r.opportunityId, r.tier, r.lead])).toEqual([["n2", "exploratory", "Design: Randomized controlled trial or Early-phase trial required, none in the evidence."]]);
    expect(expl.rationale).toMatchObject({ fallback: "profile" });
    expect(expl.rationale.evidence.map((e) => e.id)).toEqual([PUB]);
    // PR 3.2b: two sentences, gap first, and the engine's rationale nowhere in them
    expect(expl.line.sentences).toEqual([
      "Design: Randomized controlled trial or Early-phase trial required, none in the evidence.",
      "Closest on paradigm: Clinical observational work against the notice's Clinical trials.",
    ]);
    expect(expl.why).toBe(expl.line.sentences.join(" "));
    expect(expl.why).not.toContain("Paradigm 0.60");
    expect(expl.line.flags).toEqual(["mechanism far above readiness; consider as project lead, not PI"]);
    // Why not?: the nearest Poor row, the count of every Poor row
    expect(s.whyNot).toEqual([{ opportunityId: "n4", title: "Health services", agency: "AHRQ", score: 22, whyNot: "Unit: notice works at L5; yours is L3 (0.10)." }]);
    // every row's rationale cites at least one item
    for (const r of [...s.recommended, ...s.exploratory]) expect(r.rationale.evidence.length).toBeGreaterThan(0);

    expect(db.log.reads).toEqual([
      "funding_opportunities:id, opportunity_fit_profiles!inner(opportunity_id)",
      LIST, // strong
      LIST, // moderate
      LIST, // exploratory
      WHY,
      PROFILE, // the profile-state line, the collaborator names, and the citation fallback in one read
      "funding_opportunities:id, title, agency",
      "investigator_publications:pmid, title, journal, publication_date",
      "investigator_nih_grants:id, project_num, project_title, fiscal_year, activity_code",
      DETAIL, // "Why this suggestion", keyed to the shown pairs only
    ]);
  });

  it("PR 3.2b: the profile-state line says what the ranking ran on, when, and what it could not use", async () => {
    const db = fakeDb(tables());
    const s = await loadInvestigatorFitSurface(db, INV, { audience: "strategist", recommended: 5, exploratory: 5, whyNot: 1 });
    expect(s.profile).toMatchObject({ missing: false, itemCount: 214, builtAt: "2026-09-05T04:10:00Z", rankedAt: "2026-09-06T09:45:00Z", taxonomyVersion: "2026.09" });
    expect(s.profile.sources).toEqual(["187 verified publications", "22 NIH awards", "5 registered trials"]);
    expect(s.profile.gaps).toEqual(["no biosketch on file", "no self-declared research axes", "study design read at low confidence", "12 items still waiting to be classified"]);
    expect(s.collaboratorNames.get("7a2e0000-2222-4333-8444-555566667777")).toBe("Grace Hopper");
  });

  it("PR 3.2b: \"Why this suggestion\" carries the components, caps, coded topics and the eligibility the row no longer prints", async () => {
    const db = fakeDb(tables());
    const s = await loadInvestigatorFitSurface(db, INV, { audience: "strategist", recommended: 5, exploratory: 5, whyNot: 1 });
    const d = s.exploratory[0]!.detail!;
    expect(d.tierWord).toBe("Exploratory");
    expect(d.measuredAgainst).toBe("moderate");
    expect(d.components.map((c) => c.key)).toEqual(["P", "U", "D", "T", "M", "O", "K", "A"]);
    expect(d.components.find((c) => c.key === "T")).toMatchObject({ value: 0.5, floor: expect.any(Number) });
    expect(d.caps).toEqual(["A required study design has no support in the evidence"]);
    expect(d.floorsMissed).toEqual([{ key: "T", label: "Topic", value: 0.18, floor: 0.35 }]);
    expect(d.design.unmet).toEqual(["Randomized controlled trial or Early-phase trial"]);
    expect(d.topic.codes).toEqual([{ code: "C20.111.197", depth: 3 }]);
    expect(d.eligibility).toEqual([{ kind: "unchecked", text: 'citizenship rule not evaluated: "Applicants must be citizens."' }]);
    expect(d.collaborators).toEqual(["7a2e0000-2222-4333-8444-555566667777"]);
    // a Strong row keeps its detail too
    expect(s.recommended[0]!.detail?.tierWord).toBe("Strong");
  });

  it("Recommended stops reading once full: a Strong is never cut by a higher-scoring Moderate, and Moderate is not read", async () => {
    const db = fakeDb({ ...tables(), fit_results: [fr("n1", "strong", 60, { rationale: "a", top_items: [GRANT] }), fr("n2", "strong", 70, { rationale: "b", top_items: [GRANT] }), fr("n3", "moderate", 99, { rationale: "c", top_items: [GRANT] })] });
    const s = await loadInvestigatorFitSurface(db, INV, { audience: "strategist", recommended: 2, exploratory: 2, whyNot: 2 });
    expect(s.recommended.map((r) => [r.opportunityId, r.score])).toEqual([
      ["n2", 70],
      ["n1", 60],
    ]);
    expect(db.log.reads.filter((x) => x.startsWith("fit_results:"))).toEqual([LIST, LIST, WHY, DETAIL]);
    expect(s.poorTotal).toBe(0);
    expect(s.whyNot).toEqual([]);
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
    const s = await loadInvestigatorFitSurface(db, INV, { audience: "investigator", recommended: 5, exploratory: 5, whyNot: 5 });
    expect(s.audience).toBe("investigator");
    expect(s.recommended.map((r) => r.opportunityId)).toEqual(["n1", "n5"]);
    expect(s.exploratory).toEqual([]);
    expect(s.whyNot).toEqual([]);
    expect(s.poorTotal).toBe(0);
    expect(db.log.reads.filter((x) => x.startsWith("fit_results:"))).toEqual([LIST, LIST, DETAIL]);
    expect(db.log.reads).not.toContain(WHY);
    // the citation fallback is not needed here, so the profile read leaves the provenance path off
    expect(db.log.reads).toContain(PROFILE_NO_PROV);
  });

  it("with nothing Recommended, one head count says whether the person was scored at all — a PI sees no Poor row", async () => {
    const db = fakeDb({ ...tables(), fit_results: [fr("n3", "poor", 10, { why_not: "poor" }), fr("n2", "exploratory", 40, { rationale: "lead", gap: "gap" })] });
    const s = await loadInvestigatorFitSurface(db, INV, { audience: "investigator" });
    expect(s).toMatchObject({ scored: true, recommended: [], exploratory: [], whyNot: [], poorTotal: 0 });
    expect(db.log.reads.filter((x) => x.startsWith("fit_results:"))).toEqual([LIST, LIST, "fit_results:opportunity_id"]);
    const none = await loadInvestigatorFitSurface(fakeDb({ ...tables(), fit_results: [] }), INV, { audience: "investigator" });
    expect(none.scored).toBe(false);
  });
});

describe("loadInvestigatorFitSurface · states", () => {
  it("before the migration the surface is unavailable; with no row the person is unscored; only Poor rows is scored with an empty list and a Why not?", async () => {
    expect(await loadInvestigatorFitSurface(fakeDb({ ...tables(), fit_results: null }), INV, { audience: "strategist" })).toMatchObject({ unavailable: true, scored: false, openNotices: 5 });
    expect(await loadInvestigatorFitSurface(fakeDb({ ...tables(), fit_results: [] }), INV, { audience: "strategist" })).toMatchObject({ unavailable: false, scored: false, recommended: [], exploratory: [], whyNot: [], poorTotal: 0 });
    const onlyPoor = await loadInvestigatorFitSurface(fakeDb({ ...tables(), fit_results: [fr("n3", "poor", 10, { why_not: "Paradigm: epidemiology vs. required molecular mechanism (0.05)." })] }), INV, { audience: "strategist" });
    expect(onlyPoor).toMatchObject({ scored: true, recommended: [], exploratory: [], poorTotal: 1 });
    expect(onlyPoor.whyNot.map((w) => [w.title, w.whyNot])).toEqual([["Down syndrome awards", "Paradigm: epidemiology vs. required molecular mechanism (0.05)."]]);
  });

  it("a Poor row without a why_not still reads as a sentence; a row whose notice is gone is dropped", async () => {
    const db = fakeDb({ ...tables(), fit_results: [fr("n3", "poor", 10), fr("gone", "strong", 90, { rationale: "no notice" })] });
    const s = await loadInvestigatorFitSurface(db, INV, { audience: "strategist" });
    expect(s.recommended).toEqual([]);
    expect(s.whyNot.map((w) => w.whyNot)).toEqual(["Below the Exploratory floors."]);
  });
});
