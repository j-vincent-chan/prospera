/**
 * The investigator page's fit surface (PR 3.2) on the fake PostgREST
 * builder: the three groups and their reads, the D7 gate (a PI's page reads
 * neither Exploratory nor Poor), the rationale's evidence, the judged marker,
 * the profile-provenance fallback, and the missing table.
 */
import { describe, expect, it } from "vitest";
import { fakeDb, type Row } from "@/lib/fit/__fixtures__/fake-db";
import { corpusOf, investigatorCardState, loadInvestigatorFitSurface } from "@/lib/fit/investigator-fits";
import { NOTHING_CLEARS_HEADLINE } from "@/lib/fit/surface-states";
import { FIT_RESULT_VERDICT_COLUMNS } from "@/lib/fit/results";

const INV = "0f5b1b2c-1111-4222-8333-444455556666";
const PUB = `publication:${INV}:31000001`;
const GRANT = "grant:9a9a9a9a-2222-4333-8444-555566667777";
const LIST = `fit_results:${FIT_RESULT_VERDICT_COLUMNS}`;
const WHY = LIST;
const NOTICES = "funding_opportunities:id, title, agency, agency_code, opportunity_number, activity_code, award_ceiling, receipt_cycles, cycles_source, standard_dates_apply, close_date, expiration_date, forecasted, status";
const NOTICE_PROFILES = "opportunity_fit_profiles:opportunity_id, profile, complete:sources->complete, guide_html_hash";
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

// ---------------------------------------------------------------------------
// C3 — what the two counterpart-profile reads are *for*
//
// The reads land and the row is built, and until these fixtures existed every
// one of their inputs could be thrown away without a test noticing: hardcode
// `noticeComplete: true`, or pass `notice: null` / `investigator: null` into
// `fitVerdicts`, and 1,921 tests stayed green. Each block below fails on
// exactly one of those.
// ---------------------------------------------------------------------------

/** A notice profile with one investigator-level rule the eligibility verdict can only get from the record. */
const noticeProfile = (opportunity_id: string, over: Row = {}): Row => ({
  opportunity_id,
  profile: { opportunity_id, eligibility: { investigator_rules: [], esi_only: true, new_investigator_only: false, clinician_required: false, degree_required: null, independent_appointment_required: false, citizenship_rule: null } },
  ...over,
});

/** An investigator profile whose counts the evidence verdict can only get from the record. */
const investigatorProfile = (investigator_id: string, over: Row = {}): Row => ({
  investigator_id,
  profile: { investigator_id, evidence_summary: { publications_verified: 48, grants: 2, trials: 0, trials_as_pi: 0, biosketch: "none", self_declared: false }, provenance: [{ axis: "paradigm", category: "clinical_observational", top_items: [PUB] }] },
  ...over,
});

const withProfiles = (over: Row = {}) => ({
  ...tables(),
  opportunity_fit_profiles: [noticeProfile("n1"), noticeProfile("n5")],
  investigator_fit_profiles: [investigatorProfile(INV)],
  ...over,
});

describe("loadInvestigatorFitSurface · the counterpart profiles reach the row (C3)", () => {
  it("the notice's own eligibility rules are on the row's eligibility chip — a row built with `notice: null` cannot say this", async () => {
    const s = await loadInvestigatorFitSurface(fakeDb(withProfiles()), INV, { audience: "strategist" });
    expect(s.recommended.map((r) => r.verdicts.eligibility.text)).toEqual(["Eligible · early-stage investigators only", "Eligible · early-stage investigators only"]);
    // …and without the record it is the honest non-claim instead
    const bare = await loadInvestigatorFitSurface(fakeDb({ ...tables(), opportunity_fit_profiles: [] }), INV, { audience: "strategist" });
    expect(bare.recommended[0]!.verdicts.eligibility.text).toBe("Eligibility unverified · no notice profile on file");
  });

  it("the person's own evidence counts are on the row's evidence chip — a row built with `investigator: null` cannot say this", async () => {
    const s = await loadInvestigatorFitSurface(fakeDb(withProfiles()), INV, { audience: "strategist" });
    expect(s.recommended[0]!.verdicts.evidence.text).toBe("Well evidenced · 48 papers, 2 awards");
    const bare = await loadInvestigatorFitSurface(fakeDb({ ...withProfiles(), investigator_fit_profiles: [] }), INV, { audience: "strategist" });
    expect(bare.recommended[0]!.verdicts.evidence.text).toBe("Evidence not assessed · no fit profile on file");
  });

  it("a notice whose profile column says `complete: false` renders **Can't assess**, whatever tier the sweep stored (D22, §4.2)", async () => {
    // The one signal `cannot_assess` rests on, and the one a caller can drop by
    // writing `noticeComplete: true` at the `fitVerdicts` call.
    const db = fakeDb(withProfiles({ opportunity_fit_profiles: [noticeProfile("n1", { complete: false }), noticeProfile("n5")] }));
    const s = await loadInvestigatorFitSurface(db, INV, { audience: "strategist" });
    const byId = new Map(s.recommended.map((r) => [r.opportunityId, r]));
    expect(byId.get("n1")!.fitTier).toBe("strong");
    expect(byId.get("n1")!.verdicts.label).toBe("cannot_assess");
    expect(byId.get("n1")!.verdicts.action).toMatchObject({ id: "read_notice" });
    expect(byId.get("n1")!.verdicts.caveat.text).toContain("incomplete");
    // the neighbouring notice is untouched: it is a fact about that notice, not a mode
    expect(byId.get("n5")!.verdicts.label).toBe("moderate");
  });

  it("the two reads are bounded to the rows the card shows", async () => {
    const db = fakeDb(withProfiles());
    await loadInvestigatorFitSurface(db, INV, { audience: "strategist", recommended: 5, exploratory: 5, ruledOut: 1 });
    const notice = db.log.selects.find((x) => x.table === "opportunity_fit_profiles")!;
    const person = db.log.selects.find((x) => x.table === "investigator_fit_profiles")!;
    // the four shown rows (n1, n5, n2, n4) — not the five notices, and not the corpus
    expect(notice.filters).toEqual(["opportunity_id in n1,n5,n2,n4"]);
    expect(person.filters).toEqual([`investigator_id in ${INV}`]);
  });

  it("neither read takes the page down, and the card says once that it could not read them (§3i)", async () => {
    for (const tablesUnderTest of [
      withProfiles({ opportunity_fit_profiles: null }),
      withProfiles({ investigator_fit_profiles: null }),
    ]) {
      const s = await loadInvestigatorFitSurface(fakeDb(tablesUnderTest), INV, { audience: "strategist" });
      expect(s.recommended.length).toBeGreaterThan(0);
      expect(s.profilesDegraded).toBe(true);
    }
    // and the other kind of failure — the one a migration will not fix — too
    const failing = fakeDb(withProfiles(), undefined, { fail: { opportunity_fit_profiles: "canceling statement due to statement timeout" } });
    const s = await loadInvestigatorFitSurface(failing, INV, { audience: "strategist" });
    expect(s.recommended.length).toBeGreaterThan(0);
    expect(s.profilesDegraded).toBe(true);
    // a clean read says nothing
    expect((await loadInvestigatorFitSurface(fakeDb(withProfiles()), INV, { audience: "strategist" })).profilesDegraded).toBe(false);
  });
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
    // fit-UX PR 5: `plainWhyLine`, the same two steps `reasonOf` takes — and
    // B3: one sentence, so the gap paragraph is no longer appended to it.
    expect(s.exploratory[0]!.why).toBe("0 compatible items.");
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
    //
    // fit-UX PR 5 moved the person's own profile read up beside the corpus
    // count — it is the same round trip, run in parallel with a count it used
    // to be serialised behind, and it is what §3i's first state is decided on
    // (`profileBuilt`). It has to happen on the path where *nothing* is
    // listed too, which is the path that used to do no profile read at all.
    expect(db.log.reads).toEqual([
      "funding_opportunities:id, opportunity_fit_profiles!inner(opportunity_id)",
      INV_PROFILES,
      LIST, // strong
      LIST, // moderate
      LIST, // exploratory
      WHY, // ruled out
      NOTICES,
      NOTICE_PROFILES,
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

  it("§3h holds after labelling, not only after the tier read: no Can't assess row on the PI's own page", async () => {
    // The audience gate was the loader's *tier* filter, and `verdictLabelOf`
    // relabels a Strong pair whose notice profile is incomplete as
    // `cannot_assess` — so a PI's own page carried a **Can't assess** row and a
    // "Can't assess 1" chip in its header. Screenshot 08 has All / Strong /
    // Moderate and nothing else.
    const db = fakeDb(withProfiles({ opportunity_fit_profiles: [noticeProfile("n1", { complete: false }), noticeProfile("n5")] }));
    const pi = await loadInvestigatorFitSurface(db, INV, { audience: "investigator" });
    expect(pi.recommended.map((r) => [r.opportunityId, r.verdicts.label])).toEqual([["n5", "moderate"]]);
    for (const r of pi.recommended) expect(["strong", "moderate"]).toContain(r.verdicts.label);
    // the strategist still sees it, labelled for what it is
    const strategist = await loadInvestigatorFitSurface(fakeDb(withProfiles({ opportunity_fit_profiles: [noticeProfile("n1", { complete: false }), noticeProfile("n5")] })), INV, { audience: "strategist" });
    expect(strategist.recommended.map((r) => r.verdicts.label)).toEqual(["cannot_assess", "moderate"]);
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

  it("the ruled-out read is bounded by default: the rows nearest the bar, not every Poor pair", async () => {
    // §3f shows "the *limit* nearest the bar" behind a toggle. Raised, the card
    // silently loads and serialises every Poor pair of a person against 1,190
    // open notices, and nothing above it counts the rows.
    const poor = Array.from({ length: 7 }, (_, i) => fr(`p${i}`, "poor", 30 - i, { why_not: `Paradigm: reason ${i}.` }));
    const db = fakeDb({ ...withProfiles(), fit_results: poor, funding_opportunities: poor.map((r) => ({ id: r.opportunity_id, title: `Notice ${r.opportunity_id}`, agency: "NIH", close_date: "2027-01-01" })) });
    const s = await loadInvestigatorFitSurface(db, INV, { audience: "strategist" });
    expect(s.poorTotal).toBe(7);
    expect(s.ruledOut.length).toBe(5);
    expect(s.ruledOut.map((r) => r.opportunityId)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
    expect(db.log.selects.find((x) => x.table === "fit_results" && x.filters.includes("tier=poor"))).toBeTruthy();
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

// ---------------------------------------------------------------------------
// fit-UX PR 4 — the audit layer reaches the row, and its inputs are the
// verdicts' inputs
//
// The pure derivations are covered in `audit-view.test.ts`. What only this
// harness can reach is the **wiring**: that the surface builds the audit at
// all, that it builds it from the two counterpart profiles rather than from
// nulls, and that it costs no read of its own.
// ---------------------------------------------------------------------------

describe("loadInvestigatorFitSurface · the audit layer (PR 4)", () => {
  it("every row carries an audit built from the loaded notice profile", async () => {
    const s = await loadInvestigatorFitSurface(fakeDb(withProfiles()), INV, { audience: "strategist" });
    const row = s.recommended.find((r) => r.opportunityId === "n1")!;
    // The notice fixture's one eligibility rule, read from the record the
    // surface loaded. A row whose audit were built with `notice: null` would
    // have an empty table here.
    expect(row.audit.eligibility.map((r) => [r.rule, r.state])).toEqual([["Early-stage investigators only", "met"]]);
    expect(row.audit.notice.map((r) => r.label)).toEqual(["Paradigm funded", "Unit required", "Designs required", "Topic terms"]);
    expect(row.audit.notice.every((r) => r.value !== "Not on file")).toBe(true);
  });

  it("and from the person's own profile: the evidence panel is not the fallback text", async () => {
    const s = await loadInvestigatorFitSurface(fakeDb(withProfiles()), INV, { audience: "strategist" });
    const withRecord = s.recommended[0]!.audit.evidence;
    const bare = await loadInvestigatorFitSurface(fakeDb({ ...withProfiles(), investigator_fit_profiles: [] }), INV, { audience: "strategist" });
    expect(bare.recommended[0]!.audit.evidence.every((r) => r.value === "Not on file")).toBe(true);
    expect(withRecord.some((r) => r.value === "Not on file")).toBe(false);
  });

  it("the internals block carries the row's own S, caps and floors", async () => {
    const s = await loadInvestigatorFitSurface(fakeDb(withProfiles()), INV, { audience: "strategist" });
    const row = s.recommended.find((r) => r.opportunityId === "n1")!;
    expect(row.audit.internals.score).toBe(`S ${row.score.toFixed(1)}`);
    expect(row.audit.internals.caps).toBe("no cap");
    expect(row.audit.internals.judged?.label).toBe("judged · high");
    expect(row.audit.components.map((c) => c.key)).toEqual(["P", "U", "D", "T", "M", "O", "K", "A"]);
    expect(row.audit.components.find((c) => c.key === "P")).toMatchObject({ strong: 0.75, moderate: 0.5 });
    expect(row.audit.components.find((c) => c.key === "O")).toMatchObject({ strong: null, moderate: null });
  });

  it("the items are the resolved evidence, with their source links, and no publication id to review", async () => {
    const s = await loadInvestigatorFitSurface(fakeDb(withProfiles()), INV, { audience: "strategist" });
    const row = s.recommended.find((r) => r.opportunityId === "n1")!;
    expect(row.items).toHaveLength(1);
    expect(row.items[0]!.items.map((i) => i.title)).toContain("Anifrolumab in SLE");
    // The kind label the disclosure's own evidence card uses, so the two
    // surfaces name a source the same way.
    expect(row.items[0]!.items.find((i) => i.id === PUB)!.link).toEqual({ label: "Publication ↗", href: "https://pubmed.ncbi.nlm.nih.gov/31000001/" });
    // C4's other half: this surface has the evidence id, never the
    // `investigator_publications` row id, so it draws no identity control.
    expect(row.items[0]!.items.every((i) => !i.identityItem)).toBe(true);
  });

  it("costs no read of its own: the same reads as before the audit existed", async () => {
    const db = fakeDb(withProfiles());
    await loadInvestigatorFitSurface(db, INV, { audience: "strategist" });
    expect(db.log.reads.filter((x) => x.startsWith(NOTICE_PROFILES))).toHaveLength(1);
    expect(db.log.reads.filter((x) => x.startsWith(INV_PROFILES))).toHaveLength(1);
    expect(db.log.reads.filter((x) => x.startsWith(NOTICES))).toHaveLength(1);
  });

  it("a ruled-out row is audited too, so a wrong exclusion is catchable (§3f)", async () => {
    const db = fakeDb(withProfiles({ opportunity_fit_profiles: [noticeProfile("n1"), noticeProfile("n3"), noticeProfile("n5")] }));
    const s = await loadInvestigatorFitSurface(db, INV, { audience: "strategist" });
    const ruled = s.ruledOut.find((r) => r.opportunityId === "n3")!;
    expect(ruled.audit.eligibility.length + ruled.audit.requirements.length).toBeGreaterThan(0);
    expect(ruled.audit.notice).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// §3i.1 / §3i.2 — the fact the two states are told apart on (fit-UX PR 5)
//
// Before `profileBuilt` the card said "No fit results yet against the 3
// profiled open notices" for a person whose profile has never been built and
// for a person whose profile cleared nothing, in the same words. The read that
// tells them apart is the person's own `investigator_fit_profiles` row, and it
// has to happen on the path where nothing is listed — which is the path that
// used to do no profile read at all.
// ---------------------------------------------------------------------------

describe("loadInvestigatorFitSurface · §3i (fit-UX PR 5)", () => {
  const opts = { audience: "strategist" as const };

  it("a person with a stored profile and nothing scored: profileBuilt, not scored", async () => {
    const db = fakeDb({ ...tables(), fit_results: [] });
    const s = await loadInvestigatorFitSurface(db, INV, opts);
    expect(s.profileBuilt).toBe(true);
    expect(s.scored).toBe(false);
    expect(s.investigatorId).toBe(INV);
    // The corpus is still counted, because the answer states it.
    expect(s.openNotices).toBe(notices.length);
    // The profile read happens on this path — the one that used to do none.
    expect(db.log.reads).toEqual(["funding_opportunities:id, opportunity_fit_profiles!inner(opportunity_id)", INV_PROFILES, LIST, LIST, LIST, WHY]);
  });

  // -------------------------------------------------------------------------
  // B5 — "Nothing clears the bar" was claimed on a failed read
  //
  // The corpus count's `error` was destructured away, so a read that did not
  // land gave `openNotices = 0` and the card said "**0 open notices were
  // assessed** against this profile and none reached Exploratory or better.
  // This is a real answer, not a gap." `directoryIsThin` and `profileBuilt`
  // both refuse to claim on a read that did not land; this now matches.
  // -------------------------------------------------------------------------

  it("a corpus count that did not land is not a corpus of zero", async () => {
    const failing = fakeDb({ ...tables(), fit_results: [] }, undefined, { fail: { funding_opportunities: "canceling statement due to statement timeout" } });
    const s = await loadInvestigatorFitSurface(failing, INV, opts);
    expect(s.openNoticesCounted).toBe(false);
    expect(corpusOf(s)).toBeNull();
    // …and the answer stays an answer; only the number comes off it.
    const state = investigatorCardState(s)!;
    expect(state.id).toBe("nothing_clears");
    expect(state.headline).toBe(NOTHING_CLEARS_HEADLINE);
    expect(state.body).not.toMatch(/\b0 open notices\b/);
    expect(state.body).toContain("could not be read");
    expect(state.body).toContain("This is a real answer, not a gap");
  });

  it("and a count that landed still states the corpus", async () => {
    const db = fakeDb({ ...tables(), fit_results: [] });
    const s = await loadInvestigatorFitSurface(db, INV, opts);
    expect(s.openNoticesCounted).toBe(true);
    expect(corpusOf(s)).toBe(notices.length);
    expect(investigatorCardState(s)!.body).toContain(`${notices.length} open notices were assessed`);
  });

  it("a person with no stored profile: not profileBuilt", async () => {
    const db = fakeDb({ ...tables(), fit_results: [], investigator_fit_profiles: [] });
    expect((await loadInvestigatorFitSurface(db, INV, opts)).profileBuilt).toBe(false);
  });

  it("a profile stored for somebody else is not this person's", async () => {
    const db = fakeDb({ ...tables(), fit_results: [], investigator_fit_profiles: [{ investigator_id: "someone-else", profile: {} }] });
    expect((await loadInvestigatorFitSurface(db, INV, opts)).profileBuilt).toBe(false);
  });

  it("a read that did not land claims nothing: profileBuilt stays true and the footer says the profiles could not be read", async () => {
    // The table is not on the database.
    const missing = fakeDb({ ...tables(), fit_results: [], investigator_fit_profiles: null });
    const a = await loadInvestigatorFitSurface(missing, INV, opts);
    expect(a.profileBuilt).toBe(true);
    expect(a.profilesDegraded).toBe(true);

    // …and a failure that is not a missing table.
    const failing = fakeDb({ ...tables(), fit_results: [] }, undefined, { fail: { investigator_fit_profiles: "canceling statement due to statement timeout" } });
    const b = await loadInvestigatorFitSurface(failing, INV, opts);
    expect(b.profileBuilt).toBe(true);
    expect(b.profilesDegraded).toBe(true);
  });

  it("a populated surface still reads the profile once, and the ruled-out rows are what 'the nearest' can offer", async () => {
    const db = fakeDb(tables());
    const s = await loadInvestigatorFitSurface(db, INV, opts);
    expect(s.profileBuilt).toBe(true);
    expect(db.log.reads.filter((r) => r === INV_PROFILES)).toHaveLength(1);
    // `poorTotal` counts every Poor row; `ruledOut` is what the loader holds,
    // and it is the second that the state's button may offer to show.
    expect(s.poorTotal).toBe(2);
    expect(s.ruledOut).toHaveLength(2);
  });

  it("D7: a PI's surface reads no ruled-out rows, so the state can offer none", async () => {
    const db = fakeDb({ ...tables(), fit_results: [] });
    const s = await loadInvestigatorFitSurface(db, INV, { audience: "investigator" });
    expect(s.ruledOut).toEqual([]);
    expect(s.poorTotal).toBe(0);
    expect(s.profileBuilt).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// investigatorCardState — the card's wiring, moved here to be reachable
// ---------------------------------------------------------------------------

describe("investigatorCardState (pure)", () => {
  const surface = async (tables: Record<string, Row[] | null>, audience: "strategist" | "investigator" = "strategist") =>
    loadInvestigatorFitSurface(fakeDb(tables), INV, { audience });

  it("a populated card is in no state at all", async () => {
    expect(investigatorCardState(await surface(tables()))).toBeNull();
  });

  it("a card whose only content is ruled-out rows is the answer, not an empty list", async () => {
    // The rows are there and `rows.length` is 2; nothing is *listed*, because
    // §3f puts them behind the footer's toggle. Counting them as content is
    // what made the answer unreachable and drew "No row in this filter."
    const s = await surface({ ...tables(), fit_results: [fr("n3", "poor", "10", { why_not: "Paradigm: no overlap." }), fr("n4", "poor", "22", { why_not: "Unit: no overlap." })] });
    expect(s.recommended.length + s.exploratory.length).toBe(0);
    expect(s.ruledOut).toHaveLength(2);
    const state = investigatorCardState(s)!;
    expect(state.id).toBe("nothing_clears");
    expect(state.actions[0]!.label).toBe("Show the 2 nearest, and why they fell short");
  });

  it("the nearest count is what the loader holds, never `poorTotal`", async () => {
    const many = Array.from({ length: 9 }, (_, i) => fr(`p${i}`, "poor", 30 - i, { why_not: "Paradigm: no overlap." }));
    const s = await loadInvestigatorFitSurface(fakeDb({ ...tables(), funding_opportunities: many.map((r) => ({ id: r.opportunity_id, title: `N${r.opportunity_id}`, agency: "NIH", close_date: "2027-01-01" })), fit_results: many }), INV, { audience: "strategist", ruledOut: 3 });
    expect(s.poorTotal).toBe(9);
    expect(s.ruledOut).toHaveLength(3);
    expect(investigatorCardState(s)!.actions[0]!.label).toBe("Show the 3 nearest, and why they fell short");
  });

  it("no profile built outranks everything, and carries the strategist's two actions", async () => {
    const s = await surface({ ...tables(), fit_results: [], investigator_fit_profiles: [] });
    const state = investigatorCardState(s)!;
    expect(state.id).toBe("no_profile");
    expect(state.actions.map((a) => a.id)).toEqual(["refresh_sources", "what_goes_into_a_profile"]);
  });

  it("the sentence is written for the surface's own audience (§3h)", async () => {
    const pi = await surface({ ...tables(), fit_results: [] }, "investigator");
    const state = investigatorCardState(pi)!;
    expect(state.body).toMatch(/against your profile/);
    expect(state.body).toMatch(/none reached Moderate or better/);
    // D7: no ruled-out rows are read for a PI, so no button.
    expect(state.actions).toEqual([]);
  });

  it("the corpus in the sentence is the corpus the footer states", async () => {
    const s = await surface({ ...tables(), fit_results: [] });
    expect(s.openNotices).toBe(notices.length);
    expect(investigatorCardState(s)!.body).toMatch(new RegExp(`^${notices.length} open notices were assessed`));
  });
});
