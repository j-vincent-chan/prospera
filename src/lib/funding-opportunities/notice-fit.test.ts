/**
 * "Best fit in your directory" from `fit_results` (PR 2.3): the pure ranking
 * (tier before score, score before id, Poor hidden), the open filter, the
 * empty-state copy, and the loader against the fake PostgREST builder — the
 * flag gate (legacy reads nothing), the missing table, the unscored and
 * all-Poor states, archived people dropped — however many sit ahead of the
 * live rows — one read per table.
 */
import { describe, expect, it } from "vitest";
import { fakeDb, type Row } from "@/lib/fit/__fixtures__/fake-db";
import { FIT_RESULT_LIST_COLUMNS, FIT_RESULT_VERDICT_COLUMNS } from "@/lib/fit/results";
import { EMPTY_DIRECTORY_COVERAGE, noticeChangedAfter, noticeSurfaceState } from "@/lib/fit/surface-states";
import { VALUES_ONLY } from "@/lib/fit/verdicts";
import { loadContactStates, loadNoticeFit, noticeAsideStates, noticeFitEmptyText, noticeIsScorable, rankNoticeFitRows, type NoticeFit, type NoticeFitState } from "./notice-fit";

/** fit-UX PR 3: the verdict columns (the list ones plus `components`, `caps`, `flags`, `why_not`). */
const LIST_READ = `fit_results:${FIT_RESULT_VERDICT_COLUMNS}`;
/** W10: the narrow read the peek takes — the list columns, no `components` / `caps` / `flags` / `why_not`. */
const SUMMARY_READ = `fit_results:${FIT_RESULT_LIST_COLUMNS}`;
/** C3: the two counterpart profiles a verdict is read against — one bounded read each, over the shown rows only. */
const NOTICE_PROFILE_READ = "opportunity_fit_profiles:opportunity_id, profile, complete:sources->complete, guide_html_hash";
const INVESTIGATOR_PROFILE_READ = "investigator_fit_profiles:investigator_id, profile";
/** The narrow provenance select the summary read falls back to (what this surface did before fit-UX PR 3). */
const PROVENANCE_READ = "investigator_fit_profiles:investigator_id, provenance:profile->provenance";
/** fit-UX PR 5 (§3i.4): the two head counts behind "the directory is too thin to assess", read under `verdicts` only. */
const COVERAGE_READS = ["investigators:id", "investigator_fit_profiles:investigator_id"];
/** A fake with no `investigator_fit_profiles` table: the coverage read degrades rather than throwing, and makes no claim. */
const NO_PROFILES_TABLE = { directory: 0, profiled: 0, available: false, error: null };

const row = (investigator_id: string, opportunity_id: string, tier: string, score: number | string, over: Row = {}): Row => ({ investigator_id, opportunity_id, tier, score, rationale: null, gap: null, why_not: null, components: { E: 1, P: 0.8, U: 0.7, D: 0.7, T: 0.7, M: 0.6, O: 0.6, K: 0.5, A: 1 }, caps: [], flags: [], ...over });

describe("rankNoticeFitRows (pure)", () => {
  it("orders by tier, then score, then investigator id; hides Poor; honours the limit (none: every surfaced row)", () => {
    const rows = [
      { investigator_id: "p4", tier: "moderate" as const, score: 90 },
      { investigator_id: "p2", tier: "strong" as const, score: 70 },
      { investigator_id: "p6", tier: "poor" as const, score: 99 },
      { investigator_id: "p1", tier: "strong" as const, score: 70 },
      { investigator_id: "p3", tier: "strong" as const, score: 65.5 },
      { investigator_id: "p5", tier: "exploratory" as const, score: 95 },
    ];
    expect(rankNoticeFitRows(rows, 10).map((r) => r.investigator_id)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(rankNoticeFitRows(rows).map((r) => r.investigator_id)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(rankNoticeFitRows(rows, 2).map((r) => r.investigator_id)).toEqual(["p1", "p2"]);
    expect(rankNoticeFitRows(rows, 0)).toEqual([]);
    expect(rankNoticeFitRows([], 3)).toEqual([]);
  });

  it("reads a numeric string score the way the database returns it", () => {
    const rows = [
      { investigator_id: "a", tier: "strong" as const, score: "8" as unknown as number },
      { investigator_id: "b", tier: "strong" as const, score: "70.5" as unknown as number },
    ];
    expect(rankNoticeFitRows(rows, 5).map((r) => r.investigator_id)).toEqual(["b", "a"]);
  });
});

describe("open filter and empty-state copy (pure)", () => {
  it("scores open and forecasted notices, never closed ones", () => {
    expect(noticeIsScorable("open")).toBe(true);
    expect(noticeIsScorable("forecasted")).toBe(true);
    expect(noticeIsScorable("closed")).toBe(false);
  });

  it("every empty state has a sentence; a populated list has none", () => {
    const states: NoticeFitState[] = ["legacy", "closed", "unavailable", "unscored", "none"];
    for (const state of states) expect(noticeFitEmptyText({ state })).toMatch(/\S/);
    expect(noticeFitEmptyText({ state: "legacy" })).toMatch(/Outreach/);
    expect(noticeFitEmptyText({ state: "unscored" })).toMatch(/nightly/);
    expect(noticeFitEmptyText({ state: "ok" })).toBe("");
  });
});

describe("loadNoticeFit (fake client)", () => {
  const people = [
    { id: "p1", full_name: "Ada One", home_department: "Medicine", archived_at: null },
    { id: "p2", full_name: "Ben Two", home_department: null, archived_at: null },
    { id: "p3", full_name: "Cy Three", home_department: "Surgery", archived_at: "2026-01-01" },
    { id: "p4", full_name: "Di Four", home_department: "Pediatrics", archived_at: null },
    { id: "p5", full_name: "Ed Five", home_department: "Neurology", archived_at: null },
  ];
  const results = [
    row("p2", "n1", "moderate", "88", { rationale: "Paradigm 0.80 — Discovery (yours 0.70) vs. allowed Discovery · Topic 0.50 — 1 coded match" }),
    row("p1", "n1", "strong", "71.25", { rationale: "Paradigm 1.00 — Discovery (yours 0.90) vs. required Discovery · Topic 0.70 — 2 coded matches" }),
    row("p3", "n1", "strong", "95", { rationale: "archived" }),
    row("p4", "n1", "exploratory", "40", { rationale: "Paradigm 0.60 — Clinical (yours 0.55) vs. required Discovery", gap: "Design: a trialist collaborator." }),
    row("p5", "n1", "poor", "9", { why_not: "paradigm 0.05" }),
    row("p5", "n2", "strong", "90", { rationale: "another notice" }),
  ];

  it("under legacy nothing is read and the surface points to Outreach", async () => {
    const db = fakeDb({ fit_results: results, investigators: people });
    const fit = await loadNoticeFit(db, { opportunityId: "n1", statusBucket: "open", fitEngine: "legacy" });
    expect(fit).toEqual({ engine: "legacy", state: "legacy", matches: [], total: 0, profilesDegraded: false, assessedAt: null, assessedGuideHash: null, coverage: EMPTY_DIRECTORY_COVERAGE });
    expect(db.log.reads).toEqual([]);
  });

  it("a closed notice is not read", async () => {
    const db = fakeDb({ fit_results: results, investigators: people });
    const fit = await loadNoticeFit(db, { opportunityId: "n1", statusBucket: "closed", fitEngine: "fit-v1" });
    expect(fit).toEqual({ engine: "fit-v1", state: "closed", matches: [], total: 0, profilesDegraded: false, assessedAt: null, assessedGuideHash: null, coverage: EMPTY_DIRECTORY_COVERAGE });
    expect(db.log.reads).toEqual([]);
  });

  it("before the migration the table is reported unavailable", async () => {
    const db = fakeDb({ fit_results: null, investigators: people });
    const fit = await loadNoticeFit(db, { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1" });
    expect(fit).toEqual({ engine: "fit-v1", state: "unavailable", matches: [], total: 0, profilesDegraded: false, assessedAt: null, assessedGuideHash: null, coverage: EMPTY_DIRECTORY_COVERAGE });
  });

  it("under fit-v1: the notice's surfaced rows best first, tiers mapped to the pill vocabulary, the archived person dropped, Poor and other notices ignored — one summary read and one name read", async () => {
    const db = fakeDb({ fit_results: results, investigators: people });
    const fit = await loadNoticeFit(db, { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1", limit: 5 });
    expect(fit.engine).toBe("fit-v1");
    expect(fit.state).toBe("ok");
    expect(fit.matches).toMatchObject([
      { investigatorId: "p1", fullName: "Ada One", department: "Medicine", tier: "strong", fitTier: "strong", score: 71.25, why: "Discovery vs. required Discovery.", lead: null, judged: null, rationale: { text: "Paradigm 1.00 — Discovery (yours 0.90) vs. required Discovery · Topic 0.70 — 2 coded matches", source: "engine" } },
      { investigatorId: "p2", fullName: "Ben Two", department: null, tier: "potential", fitTier: "moderate", score: 88, why: "Discovery vs. allowed Discovery." },
      // B3: `why` is one sentence. The gap is the row's `lead`, and appending it here made this line two.
      { investigatorId: "p4", fullName: "Di Four", department: "Pediatrics", tier: "exploratory", fitTier: "exploratory", score: 40, why: "Clinical vs. required Discovery.", lead: "Design: a trialist collaborator." },
    ]);
    expect(db.log.reads).toEqual([LIST_READ, "investigators:id, full_name, home_department", NOTICE_PROFILE_READ, INVESTIGATOR_PROFILE_READ, ...COVERAGE_READS]);
  });

  it("the limit bounds the list after the archived person is dropped", async () => {
    const db = fakeDb({ fit_results: results, investigators: people });
    const fit = await loadNoticeFit(db, { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1", limit: 2 });
    expect(fit.matches.map((m) => m.investigatorId)).toEqual(["p1", "p2"]);
  });

  it("no row at any tier is 'unscored'; only Poor rows is 'none' — one extra count read either way", async () => {
    const unscored = fakeDb({ fit_results: results.filter((r) => r.opportunity_id !== "n1"), investigators: people });
    expect(await loadNoticeFit(unscored, { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1" })).toEqual({ engine: "fit-v1", state: "unscored", matches: [], total: 0, profilesDegraded: false, assessedAt: null, assessedGuideHash: null, coverage: NO_PROFILES_TABLE });
    expect(unscored.log.reads).toEqual([LIST_READ, "fit_results:investigator_id", ...COVERAGE_READS]);

    const allPoor = fakeDb({ fit_results: [row("p1", "n1", "poor", "3"), row("p2", "n1", "poor", "1")], investigators: people });
    expect(await loadNoticeFit(allPoor, { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1" })).toEqual({ engine: "fit-v1", state: "none", matches: [], total: 0, profilesDegraded: false, assessedAt: null, assessedGuideHash: null, coverage: NO_PROFILES_TABLE });
  });

  it("archived people ahead of the live rows never crowd them out: every surfaced row is ranked and named, then the first `limit` live ones are taken", async () => {
    const archived = Array.from({ length: 20 }, (_, i) => ({ id: `a${String(i).padStart(2, "0")}`, full_name: `Archived ${i}`, home_department: null, archived_at: "2026-01-01" }));
    const db = fakeDb({
      fit_results: [
        ...archived.map((p, i) => row(p.id, "n1", "strong", 90 - i, { rationale: "left the directory" })),
        row("p2", "n1", "exploratory", 20, { rationale: "live too" }),
        row("p1", "n1", "exploratory", 30, { rationale: "live", gap: "Design: a trialist collaborator." }),
      ],
      investigators: [...people, ...archived],
    });
    const fit = await loadNoticeFit(db, { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1", limit: 5 });
    expect(fit.state).toBe("ok");
    expect(fit.matches.map((m) => [m.investigatorId, m.tier, m.why])).toEqual([
      ["p1", "exploratory", "Live."],
      ["p2", "exploratory", "Live too."],
    ]);
    expect(db.log.reads).toEqual([LIST_READ, "investigators:id, full_name, home_department", NOTICE_PROFILE_READ, INVESTIGATOR_PROFILE_READ, ...COVERAGE_READS]);
  });

  it("PR 3.2: the rationale cites evidence — ids in the text as titles, stage 5's top item, the profile's paradigm evidence — and a judged pair carries the marker; titles come from one read per kind, never per person", async () => {
    const PUB1 = "publication:p1:31000001";
    const GRANT2 = "grant:g-2";
    const db = fakeDb({
      fit_results: [
        row("p1", "n1", "strong", "71", { rationale: `Paradigm 1.00 — Discovery (yours 0.90) vs. required Discovery · Topic 0.70; 1 compatible item (${PUB1})`, judged_at: "2026-09-06T09:45:00Z", judged_tier: "strong", judged_from: "moderate", judged_confidence: "medium", judged_evidence: [{ id: "PMID:31000001", ref: PUB1 }] }),
        row("p2", "n1", "moderate", "60", { rationale: "Paradigm 0.80 — 0 compatible items", top_items: [GRANT2] }),
        row("p4", "n1", "exploratory", "40", { rationale: "Paradigm 0.60", gap: "Design: a trialist collaborator.", best_pair: { investigator: "clinical_observational", notice: "clinical_trials" } }),
      ],
      investigators: people,
      investigator_publications: [{ investigator_id: "p1", pmid: "31000001", title: "Anifrolumab in SLE", journal: "Lancet Rheumatol", publication_date: "2024-03-01" }],
      investigator_nih_grants: [{ id: "g-2", project_num: "5R01AR070001-03", project_title: "Targeted agents", fiscal_year: 2025, activity_code: "R01" }],
      investigator_clinical_trials: [],
      investigator_fit_profiles: [{ investigator_id: "p4", profile: { provenance: [{ axis: "paradigm", category: "clinical_observational", top_items: ["profiles:p4"] }] } }],
    });
    const fit = await loadNoticeFit(db, { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1", limit: 5 });
    expect(fit.matches.map((m) => [m.investigatorId, m.rationale.fallback, m.rationale.evidence.map((e) => e.title), m.judged?.label ?? null])).toEqual([
      ["p1", "cited", ["Anifrolumab in SLE"], "judged · medium"],
      ["p2", "top_items", ["Targeted agents"], null],
      ["p4", "profile", ["UCSF Profiles narrative"], null],
    ]);
    // fit-UX PR 5: the same two steps `reasonOf` takes — the paradigm clause,
    // de-numbered — so the peek's line and the row's reason are one sentence.
    // The cited title is still resolved; it is shown as evidence, not inlined
    // into a line that has room for one claim.
    expect(fit.matches[0]!.why).toBe("Discovery vs. required Discovery.");
    expect(fit.matches.map((m) => m.why)).not.toContain(expect.stringMatching(/0\.\d/));
    expect(fit.matches[0]!.judged).toMatchObject({ from: "moderate", tier: "strong", changed: true });
    expect(db.log.reads).toEqual([LIST_READ, "investigators:id, full_name, home_department", NOTICE_PROFILE_READ, INVESTIGATOR_PROFILE_READ, ...COVERAGE_READS, "investigator_publications:pmid, title, journal, publication_date", "investigator_nih_grants:id, project_num, project_title, fiscal_year, activity_code"]);
    for (const m of fit.matches) expect(m.rationale.evidence.length).toBeGreaterThan(0);
  });

  it("a row whose person is no longer in the directory yields 'none', not a phantom entry", async () => {
    const db = fakeDb({ fit_results: [row("p3", "n1", "strong", "95")], investigators: people });
    expect(await loadNoticeFit(db, { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1" })).toEqual({ engine: "fit-v1", state: "none", matches: [], total: 0, profilesDegraded: false, assessedAt: null, assessedGuideHash: null, coverage: NO_PROFILES_TABLE });
  });
});

// ---------------------------------------------------------------------------
// C3 on the aside — what the two counterpart reads are for, and how far they reach
// ---------------------------------------------------------------------------

const noticeProfileRow = (opportunity_id: string, over: Row = {}): Row => ({
  opportunity_id,
  profile: { opportunity_id, eligibility: { investigator_rules: [], esi_only: true, new_investigator_only: false, clinician_required: false, degree_required: null, independent_appointment_required: false, citizenship_rule: null } },
  ...over,
});

const investigatorProfileRow = (investigator_id: string, publications_verified: number): Row => ({
  investigator_id,
  profile: { investigator_id, evidence_summary: { publications_verified, grants: 1, trials: 0, trials_as_pi: 0, biosketch: "none", self_declared: false }, provenance: [] },
});

describe("loadNoticeFit · the counterpart profiles (C3)", () => {
  const people = [
    { id: "p1", full_name: "Ada One", home_department: "Medicine", archived_at: null },
    { id: "p2", full_name: "Ben Two", home_department: null, archived_at: null },
    { id: "p4", full_name: "Di Four", home_department: "Pediatrics", archived_at: null },
    { id: "p5", full_name: "Ed Five", home_department: "Neurology", archived_at: null },
  ];
  const results = [
    row("p1", "n1", "strong", "90", { rationale: "Paradigm 1.00." }),
    row("p2", "n1", "strong", "80", { rationale: "Paradigm 0.90." }),
    row("p4", "n1", "moderate", "70", { rationale: "Paradigm 0.80." }),
    row("p5", "n1", "exploratory", "40", { rationale: "Paradigm 0.60.", gap: "Design: a trialist collaborator." }),
  ];
  const base = () => ({
    fit_results: results.map((r) => ({ ...r })),
    investigators: people.map((p) => ({ ...p })),
    opportunity_fit_profiles: [noticeProfileRow("n1")],
    investigator_fit_profiles: [investigatorProfileRow("p1", 48), investigatorProfileRow("p2", 12), investigatorProfileRow("p4", 7), investigatorProfileRow("p5", 3)],
  });

  it("the investigator-profile read carries exactly the ids of the shown people — never every ranked row", async () => {
    // The aside draws three; the notice is ranked over four. Reading the whole
    // ranked list is one `in()` either way, so nothing above it notices — but
    // it is a whole `InvestigatorFitProfile` per extra person, fetched, built
    // and serialised for rows that are never drawn.
    const db = fakeDb(base());
    const fit = await loadNoticeFit(db, { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1", limit: 3 });
    expect(fit.matches.map((m) => m.investigatorId)).toEqual(["p1", "p2", "p4"]);
    expect(fit.total).toBe(4);
    const person = db.log.selects.find((x) => x.table === "investigator_fit_profiles")!;
    expect(person.filters).toEqual(["investigator_id in p1,p2,p4"]);
    const notice = db.log.selects.find((x) => x.table === "opportunity_fit_profiles")!;
    expect(notice.filters).toEqual(["opportunity_id in n1"]);
  });

  it("each shown person's own evidence counts reach their chip — a row built with `investigator: null` cannot say this", async () => {
    const fit = await loadNoticeFit(fakeDb(base()), { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1", limit: 3 });
    expect(fit.matches.map((m) => m.verdicts!.evidence.text)).toEqual(["Well evidenced · 48 papers, 1 award", "Well evidenced · 12 papers, 1 award", "Well evidenced · 7 papers, 1 award"]);
  });

  it("the notice's own eligibility rules reach the chip — a row built with `notice: null` cannot say this", async () => {
    const fit = await loadNoticeFit(fakeDb(base()), { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1", limit: 1 });
    expect(fit.matches[0]!.verdicts!.eligibility.text).toBe("Eligible · early-stage investigators only");
  });

  it("a notice whose profile column says `complete: false` puts **Can't assess** on every row of the aside (D22)", async () => {
    const db = fakeDb({ ...base(), opportunity_fit_profiles: [noticeProfileRow("n1", { complete: false })] });
    const fit = await loadNoticeFit(db, { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1", limit: 3 });
    expect(fit.matches.map((m) => m.fitTier)).toEqual(["strong", "strong", "moderate"]);
    expect(fit.matches.map((m) => m.verdicts!.label)).toEqual(["cannot_assess", "cannot_assess", "cannot_assess"]);
    expect(fit.matches[0]!.verdicts!.action).toMatchObject({ id: "read_notice" });
  });

  it("the aside is a strategist surface by default: forget the audience and the rows still carry their verb (§3h is opt-in, not the fallback)", async () => {
    // `audience ?? "investigator"` is one character and silently removes every
    // action from a surface D7 does not describe.
    const fit = await loadNoticeFit(fakeDb(base()), { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1", limit: 3 });
    for (const m of fit.matches) expect(m.verdicts!.action).not.toBeNull();
    expect(fit.matches[0]!.verdicts!.action).toMatchObject({ id: "add_to_outreach" });
    // and asking for the PI's reading really does drop them
    const pi = await loadNoticeFit(fakeDb(base()), { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1", limit: 3, audience: "investigator" });
    for (const m of pi.matches) expect(m.verdicts!.action).toBeNull();
  });

  it("a failed profile read leaves the aside standing and says so once", async () => {
    const db = fakeDb(base(), undefined, { fail: { opportunity_fit_profiles: "canceling statement due to statement timeout" } });
    const fit = await loadNoticeFit(db, { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1", limit: 3 });
    expect(fit.state).toBe("ok");
    expect(fit.matches.length).toBe(3);
    expect(fit.profilesDegraded).toBe(true);
  });

  it("B4 · M23's consequence: under `summary` the aside's own row builder yields nothing", async () => {
    // The opportunity page's aside is `data.fit.matches.slice(0, ASIDE_ROWS)`
    // flat-mapped over `m.verdicts` — a row with no verdicts has nothing the
    // stack renders. So asking the loader for the narrow read leaves the card
    // drawn, the header badge in place, and **zero rows** under it, with no
    // error anywhere. This is that consequence, by value; the page's own
    // `fit: "verdicts"` literal is pinned in `fit-state-wiring.test.ts`, which
    // says why an async server component cannot be rendered here.
    const asideRows = (fit: NoticeFit, rows: number) => fit.matches.slice(0, rows).flatMap((m) => (m.verdicts ? [m] : []));
    const verdicts = await loadNoticeFit(fakeDb(base()), { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1", limit: 3, mode: "verdicts" });
    const summary = await loadNoticeFit(fakeDb(base()), { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1", limit: 3, mode: "summary" });
    expect(asideRows(verdicts, 3).length).toBe(3);
    expect(asideRows(summary, 3)).toEqual([]);
    expect(summary.matches.length, "the matches are there; it is the verdicts that are not").toBe(3);
  });

  it("`mode: summary` reads the narrow columns, neither profile table, and builds no verdict (W10)", async () => {
    // The peek renders `fullName`, `department`, `why` and a tier pill. Under
    // the verdict read it was paying for the verdict columns over every
    // surfaced row, a notice profile, up to five whole investigator profiles,
    // five `fitVerdicts` and five disclosures — serialised through a server
    // action to the browser and dropped.
    const db = fakeDb(base());
    const fit = await loadNoticeFit(db, { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1", limit: 3, mode: "summary" });
    // B1: these fixture rationales are a component label and a value and
    // nothing else, which is what the peek used to render — `Paradigm 1.00.`
    // in 11px grey under a department. There is no claim in them to keep, so
    // the line says what is true about the stored text instead.
    expect(fit.matches.map((m) => [m.fullName, m.tier, m.why])).toEqual([
      ["Ada One", "strong", VALUES_ONLY],
      ["Ben Two", "strong", VALUES_ONLY],
      ["Di Four", "potential", VALUES_ONLY],
    ]);
    for (const m of fit.matches) {
      expect(m.verdicts).toBeNull();
      expect(m.disclosure).toBeNull();
    }
    expect(fit.profilesDegraded).toBe(false);
    // the list columns, the names, and the narrow provenance select these
    // rationales need — no verdict columns, no notice profile, no whole
    // investigator record
    expect(db.log.reads).toEqual([SUMMARY_READ, "investigators:id, full_name, home_department", PROVENANCE_READ]);
    expect(db.log.reads).not.toContain(LIST_READ);
    expect(db.log.reads).not.toContain(NOTICE_PROFILE_READ);
    expect(db.log.reads).not.toContain(INVESTIGATOR_PROFILE_READ);
    // and it is bounded to the rows shown, like everything else here
    expect(db.log.selects.find((x) => x.table === "investigator_fit_profiles")!.filters).toEqual(["investigator_id in p1,p2,p4"]);
  });

  it("`mode: summary` still resolves a rationale that cites nothing, through the narrow provenance select it used before", async () => {
    const db = fakeDb({
      ...base(),
      fit_results: [row("p1", "n1", "exploratory", "40", { rationale: "Paradigm 0.60", gap: "Design: a trialist collaborator.", best_pair: { investigator: "clinical_observational", notice: "clinical_trials" } })],
      // the row as the narrow select reads it: `provenance:profile->provenance`
      investigator_fit_profiles: [{ investigator_id: "p1", provenance: [{ axis: "paradigm", category: "clinical_observational", top_items: ["profiles:p1"] }], profile: { provenance: [{ axis: "paradigm", category: "clinical_observational", top_items: ["profiles:p1"] }] } }],
    });
    const fit = await loadNoticeFit(db, { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1", limit: 3, mode: "summary" });
    expect(fit.matches[0]!.rationale.fallback).toBe("profile");
    expect(fit.matches[0]!.rationale.evidence.map((e) => e.title)).toEqual(["UCSF Profiles narrative"]);
    expect(db.log.reads).toContain(PROVENANCE_READ);
    expect(db.log.reads).not.toContain(INVESTIGATOR_PROFILE_READ);
  });

  it("`mode: verdicts` is what the page asks for, and it is not the default", async () => {
    const db = fakeDb(base());
    await loadNoticeFit(db, { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1", limit: 3, mode: "verdicts" });
    expect(db.log.reads).toEqual([LIST_READ, "investigators:id, full_name, home_department", NOTICE_PROFILE_READ, INVESTIGATOR_PROFILE_READ, ...COVERAGE_READS]);
  });
});

describe("loadContactStates — the aside's Status column is a claim", () => {
  const recipients = [
    { item_id: "i1", investigator_id: "p1", status: "contacted", removed_at: null },
    { item_id: "i1", investigator_id: "p2", status: "contacted", removed_at: "2026-09-01T00:00:00Z" },
    { item_id: "i2", investigator_id: "p4", status: "declined", removed_at: null },
  ];

  it("a person removed from the recipients is not still 'contacted' about this notice", async () => {
    // Their row and their last status survive the removal; without
    // `removed_at is null` the aside tells a strategist they were contacted
    // about a notice they are no longer on.
    const db = fakeDb({ outreach_recipients: recipients.map((r) => ({ ...r })) });
    const states = await loadContactStates(db, "i1", ["p1", "p2"]);
    expect(states.get("p1")).toEqual({ text: "contacted", tone: "normal" });
    expect(states.get("p2")).toEqual({ text: "Not contacted", tone: "normal" });
    expect(db.log.selects[0]!.filters).toEqual(["item_id=i1", "removed_at is null", "investigator_id in p1,p2"]);
  });

  it("no item, no read — and every shown person still gets the status the surface can honestly claim", async () => {
    const db = fakeDb({ outreach_recipients: recipients.map((r) => ({ ...r })) });
    const states = await loadContactStates(db, null, ["p1", "p4"]);
    expect(db.log.reads).toEqual([]);
    expect(states.get("p1")).toEqual({ text: "Not contacted", tone: "normal" });
    expect(states.get("p4")).toEqual({ text: "Not contacted", tone: "normal" });
  });

  it("no shown people, no read at all", async () => {
    const db = fakeDb({ outreach_recipients: [] });
    expect((await loadContactStates(db, "i1", [])).size).toBe(0);
    expect(db.log.reads).toEqual([]);
  });

  it("a failed read costs the statuses, not the page", async () => {
    const db = fakeDb({ outreach_recipients: [] }, undefined, { fail: { outreach_recipients: "canceling statement due to statement timeout" } });
    const states = await loadContactStates(db, "i1", ["p1"]);
    expect(states.get("p1")).toEqual({ text: "Not contacted", tone: "normal" });
  });
});

// ---------------------------------------------------------------------------
// §3i.3 / §3i.4 — what the notice-facing states are decided on (fit-UX PR 5)
// ---------------------------------------------------------------------------

describe("loadNoticeFit · the two facts §3i's notice-facing states need", () => {
  const people = [
    { id: "p1", full_name: "Ada One", home_department: "Medicine", archived_at: null },
    { id: "p2", full_name: "Ben Two", home_department: null, archived_at: null },
    { id: "p3", full_name: "Cy Three", home_department: "Surgery", archived_at: "2026-01-01" },
    { id: "p4", full_name: "Di Four", home_department: "Pediatrics", archived_at: null },
    { id: "p5", full_name: "Ed Five", home_department: "Neurology", archived_at: null },
  ];
  const withProfiles = (over: Row[] = []) => ({
    fit_results: [
      row("p1", "n1", "strong", "80", { rationale: "Paradigm 1.00 — Discovery (yours 0.90) vs. required Discovery", computed_at: "2026-09-01T03:00:00Z" }),
      row("p2", "n1", "moderate", "70", { rationale: "Paradigm 0.80 — Discovery (yours 0.70) vs. allowed Discovery", computed_at: "2026-09-03T03:00:00Z" }),
      ...over,
    ],
    investigators: people,
    investigator_fit_profiles: [{ investigator_id: "p1", profile: {} }],
  });

  it("assessedAt is the newest computed_at of the rows the surface will draw", async () => {
    const db = fakeDb(withProfiles());
    const fit = await loadNoticeFit(db, { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1", limit: 5 });
    expect(fit.assessedAt).toBe("2026-09-03T03:00:00Z");
    // The banner says "after **these** were assessed", so a row the surface
    // will not draw cannot move the date.
    const cut = await loadNoticeFit(fakeDb(withProfiles()), { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1", limit: 1 });
    expect(cut.assessedAt).toBe("2026-09-01T03:00:00Z");
  });

  it("assessedAt drives the banner exactly as the aside composes it", async () => {
    const fit = await loadNoticeFit(fakeDb(withProfiles()), { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1" });
    expect(noticeChangedAfter({ updatedAt: "2026-09-05T10:00:00Z", assessedAt: fit.assessedAt })).toBe(true);
    expect(noticeChangedAfter({ updatedAt: "2026-09-02T10:00:00Z", assessedAt: fit.assessedAt })).toBe(false);
  });

  it("the narrow read makes no staleness claim: `summary` selects no computed_at and counts no directory", async () => {
    const db = fakeDb(withProfiles());
    const fit = await loadNoticeFit(db, { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1", mode: "summary" });
    expect(fit.assessedAt).toBeNull();
    expect(fit.coverage).toEqual(EMPTY_DIRECTORY_COVERAGE);
    expect(noticeChangedAfter({ updatedAt: "2026-09-05T10:00:00Z", assessedAt: fit.assessedAt })).toBe(false);
    expect(db.log.reads).not.toContain("investigators:id");
  });

  it("the coverage counts come back with the rows, over the live directory, and decide the thin state", async () => {
    // 4 live people (p3 is archived), 1 profiled → a minority.
    const thin = await loadNoticeFit(fakeDb(withProfiles()), { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1" });
    expect(thin.coverage).toEqual({ directory: 4, profiled: 1, available: true, error: null });
    expect(noticeSurfaceState({ coverage: thin.coverage, shown: 2 })?.id).toBe("directory_thin");

    // …and with three of the four profiled it is not thin, and there is no state.
    const tables = withProfiles();
    tables.investigator_fit_profiles = ["p1", "p2", "p4"].map((investigator_id) => ({ investigator_id, profile: {} }));
    const full = await loadNoticeFit(fakeDb(tables), { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1" });
    expect(full.coverage).toMatchObject({ directory: 4, profiled: 3 });
    expect(noticeSurfaceState({ coverage: full.coverage, shown: 2 })).toBeNull();
  });

  it("a coverage read that fails takes nothing down and makes no claim", async () => {
    const db = fakeDb(withProfiles(), undefined, { fail: { investigators: "canceling statement due to statement timeout" } });
    // `investigators` is also the name read, so this is the harshest version of
    // the failure — and it is the one that used to 500 `/outreach` (PR 3 `3b`).
    await expect(loadNoticeFit(db, { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1" })).rejects.toThrow(/investigators/);

    // The coverage read alone failing degrades: the rows are still built.
    const profilesFail = fakeDb(withProfiles(), undefined, { fail: { investigator_fit_profiles: "permission denied for table investigator_fit_profiles" } });
    const fit = await loadNoticeFit(profilesFail, { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1" });
    expect(fit.state).toBe("ok");
    expect(fit.matches).toHaveLength(2);
    expect(fit.coverage.error).toContain("permission denied");
    expect(noticeSurfaceState({ coverage: fit.coverage, shown: 2 })).toBeNull();
  });

  it("an empty notice still counts the directory, so 'nobody clears the bar' and 'nobody is profiled' are told apart", async () => {
    const tables = withProfiles();
    tables.fit_results = [row("p1", "n1", "poor", "3", { computed_at: "2026-09-01T03:00:00Z" })];
    const fit = await loadNoticeFit(fakeDb(tables), { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1" });
    expect(fit.state).toBe("none");
    expect(fit.coverage).toEqual({ directory: 4, profiled: 1, available: true, error: null });
    expect(noticeSurfaceState({ coverage: fit.coverage, shown: 0 })?.id).toBe("directory_thin");
    // With nothing to show, the state offers only the one action that leads
    // somewhere.
    expect(noticeSurfaceState({ coverage: fit.coverage, shown: 0 })!.actions.map((a) => a.id)).toEqual(["see_what_is_missing"]);
  });
});

// ---------------------------------------------------------------------------
// noticeAsideStates — the aside's wiring, moved here to be reachable
// ---------------------------------------------------------------------------

describe("noticeAsideStates (pure)", () => {
  const fit = (over: Partial<Pick<NoticeFit, "engine" | "matches" | "assessedAt" | "assessedGuideHash" | "coverage">> = {}) => ({
    engine: "fit-v1" as const,
    matches: [{}, {}, {}, {}, {}] as NoticeFit["matches"],
    assessedAt: "2026-09-01T03:00:00Z",
    // B9: the notice text this notice's profile was built from.
    assessedGuideHash: "0687f31f0000",
    coverage: { directory: 129, profiled: 100, available: true, error: null },
    ...over,
  });
  // The notice's *current* Guide hash differs from the one above, so the text
  // really did move; `updatedAt` alone is not enough any more.
  const OPTS = { updatedAt: "2026-09-05T10:00:00Z", guideHtmlHash: "9c22ab7e1111", rows: 3, today: "2026-09-07" };

  it("the banner counts the rows the aside draws, not every match", () => {
    // Five ranked, three drawn. "3 suggestions, assessed against the previous
    // version" is a claim about what is under the banner.
    expect(noticeAsideStates(fit(), OPTS).banner!.note).toBe("3 suggestions, assessed against the previous version");
    expect(noticeAsideStates(fit({ matches: [{}] as NoticeFit["matches"] }), OPTS).banner!.note).toBe("1 suggestion, assessed against the previous version");
  });

  it("no banner when the notice has not moved since the assessment, or when there is nothing under it", () => {
    expect(noticeAsideStates(fit(), { ...OPTS, updatedAt: "2026-08-01T10:00:00Z" }).banner).toBeNull();
    expect(noticeAsideStates(fit({ assessedAt: null }), OPTS).banner).toBeNull();
    expect(noticeAsideStates(fit({ matches: [] }), OPTS).banner).toBeNull();
    expect(noticeAsideStates(fit(), { ...OPTS, updatedAt: null }).banner).toBeNull();
  });

  // -------------------------------------------------------------------------
  // B9 — the banner fired on Prospera's own cron writes
  //
  // `tr_funding_opportunities_updated_at` is a blanket `BEFORE UPDATE`
  // trigger, and `ingestion/reporter/exemplars-sync.ts` stamps
  // `exemplars_fetched_at` on open NIH-like notices **daily** — nothing about
  // the notice's text moves. On this surface `reassess: false`, so there is no
  // control to clear the banner with either.
  // -------------------------------------------------------------------------

  it("a bookkeeping write moves `updated_at` and draws no banner: the notice text is what has to have moved", () => {
    // exactly the exemplars-sync case: `updated_at` is newer than the
    // assessment, and the Guide hash the profile was built from is still the
    // notice's own.
    const cron = { ...OPTS, guideHtmlHash: "0687f31f0000" };
    expect(noticeAsideStates(fit(), cron).banner).toBeNull();
    // and the text really moving still draws it
    expect(noticeAsideStates(fit(), OPTS).banner).not.toBeNull();
  });

  it("unknown is not changed: no hash on either side makes no claim", () => {
    expect(noticeAsideStates(fit({ assessedGuideHash: null }), OPTS).banner).toBeNull();
    expect(noticeAsideStates(fit(), { ...OPTS, guideHtmlHash: null }).banner).toBeNull();
    expect(noticeAsideStates(fit({ assessedGuideHash: null }), { ...OPTS, guideHtmlHash: null }).banner).toBeNull();
  });

  it("and the timestamp is still required: a rebuilt profile that was re-scored is not stale", () => {
    // The hashes differ, but the assessment is newer than the notice's last
    // write — nothing about it was made against the old text.
    expect(noticeAsideStates(fit({ assessedAt: "2026-09-06T03:00:00Z" }), OPTS).banner).toBeNull();
  });

  it("never a Reassess: nothing on this page re-runs the nightly sweep these rows come from", () => {
    expect(noticeAsideStates(fit(), OPTS).banner!.action).toBeNull();
  });

  it("the thin state is demoted — this card's footer already has a primary", () => {
    const thin = noticeAsideStates(fit({ coverage: { directory: 129, profiled: 18, available: true, error: null } }), OPTS);
    expect(thin.state!.id).toBe("directory_thin");
    expect(thin.state!.actions.filter((a) => a.kind === "primary")).toEqual([]);
    expect(thin.state!.actions.map((a) => a.label)).toEqual(["See what is missing", "Show the 3 anyway"]);
    expect(thin.when).toBe("Directory too thin to assess");
  });

  it("a directory that is mostly profiled is no state, and the header keeps its badge", () => {
    const ok = noticeAsideStates(fit(), OPTS);
    expect(ok.state).toBeNull();
    expect(ok.when).toBeNull();
  });

  it("the legacy engine has neither: it draws none of this", () => {
    expect(noticeAsideStates(fit({ engine: "legacy" }), OPTS)).toEqual({ banner: null, state: null, when: null });
  });

  it("reads a real loaded surface end to end", async () => {
    const db = fakeDb({
      fit_results: [row("p1", "n1", "strong", "80", { rationale: "Paradigm 1.00 — Discovery (yours 0.90) vs. required Discovery", computed_at: "2026-09-01T03:00:00Z" })],
      investigators: [{ id: "p1", full_name: "Ada One", home_department: "Medicine", archived_at: null }, { id: "p2", full_name: "Ben Two", home_department: null, archived_at: null }],
      investigator_fit_profiles: [],
      // B9: the profile behind the row records the notice text it was built
      // from, and `OPTS.guideHtmlHash` is a different one — the text moved.
      opportunity_fit_profiles: [{ opportunity_id: "n1", profile: {}, sources: { complete: true }, guide_html_hash: "0687f31f0000" }],
    });
    const loaded = await loadNoticeFit(db, { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1" });
    expect(loaded.assessedGuideHash).toBe("0687f31f0000");
    const states = noticeAsideStates(loaded, OPTS);
    // Nobody profiled, so the directory is thin; the notice moved after the
    // one row was scored, so the banner is there too. The two compose.
    expect(states.state!.id).toBe("directory_thin");
    expect(states.state!.body).toMatch(/^0 of 2 directory profiles have a fit profile built/);
    expect(states.banner!.text).toBe("The notice changed on Sep 5, after these were assessed. Eligibility and required designs may have changed.");
  });
});
