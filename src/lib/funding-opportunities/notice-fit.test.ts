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
import { FIT_RESULT_DETAIL_COLUMNS, FIT_RESULT_LIST_COLUMNS } from "@/lib/fit/results";
import { loadNoticeFit, noticeFitEmptyText, noticeIsScorable, rankNoticeFitRows, type NoticeFitState } from "./notice-fit";

/** PR 3.2: the list columns (summary six plus the slim JSON paths for the cited items and the stage-8 marker). */
const LIST_READ = `fit_results:${FIT_RESULT_LIST_COLUMNS}`;
/** A row whose rationale cites nothing reads the profile's provenance for the paradigm evidence behind the match (absent here: the table is not in the fake). */
const PROVENANCE_READ = "investigator_fit_profiles:investigator_id, provenance:profile->provenance";
/** PR 3.2b: "Why this suggestion", one read keyed to the pairs this card shows. */
const DETAIL_READ = `fit_results:${FIT_RESULT_DETAIL_COLUMNS}`;
const PAIR = { investigator: "clinical_trials", notice: "clinical_trials" };
const MATCHED = "Paradigm matches: Clinical trials work, which is what the notice asks for.";

const row = (investigator_id: string, opportunity_id: string, tier: string, score: number | string, over: Row = {}): Row => ({ investigator_id, opportunity_id, tier, score, rationale: null, gap: null, flags: [], computed_at: "2026-09-06T09:45:00Z", engine_version: "fit-v1", components: { E: 1, P: 0.9, U: 0.8, D: 0.5, T: 0.6, M: 0.5, O: 0.4, K: 0.3, A: 0.8 }, caps: [], floors_tier: tier, best_pair: PAIR, p_best_pair: PAIR, ...over });

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
    row("p2", "n1", "moderate", "88", { rationale: "Paradigm 0.80 · Topic 0.50." }),
    row("p1", "n1", "strong", "71.25", { rationale: "Paradigm 1.00 · Topic 0.70." }),
    row("p3", "n1", "strong", "95", { rationale: "archived" }),
    row("p4", "n1", "exploratory", "40", { rationale: "Paradigm 0.60.", gap: "Design: a trialist collaborator." }),
    row("p5", "n1", "poor", "9", { why_not: "paradigm 0.05" }),
    row("p5", "n2", "strong", "90", { rationale: "another notice" }),
  ];

  it("under legacy nothing is read and the surface points to Outreach", async () => {
    const db = fakeDb({ fit_results: results, investigators: people });
    const fit = await loadNoticeFit(db, { opportunityId: "n1", statusBucket: "open", fitEngine: "legacy" });
    expect(fit).toEqual({ engine: "legacy", state: "legacy", matches: [] });
    expect(db.log.reads).toEqual([]);
  });

  it("a closed notice is not read", async () => {
    const db = fakeDb({ fit_results: results, investigators: people });
    const fit = await loadNoticeFit(db, { opportunityId: "n1", statusBucket: "closed", fitEngine: "fit-v1" });
    expect(fit).toEqual({ engine: "fit-v1", state: "closed", matches: [] });
    expect(db.log.reads).toEqual([]);
  });

  it("before the migration the table is reported unavailable", async () => {
    const db = fakeDb({ fit_results: null, investigators: people });
    const fit = await loadNoticeFit(db, { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1" });
    expect(fit).toEqual({ engine: "fit-v1", state: "unavailable", matches: [] });
  });

  it("under fit-v1: the notice's surfaced rows best first, tiers mapped to the pill vocabulary, the archived person dropped, Poor and other notices ignored — one summary read and one name read", async () => {
    const db = fakeDb({ fit_results: results, investigators: people });
    const fit = await loadNoticeFit(db, { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1", limit: 5 });
    expect(fit.engine).toBe("fit-v1");
    expect(fit.state).toBe("ok");
    // PR 3.2b: the card's line is what matched and the binding gap; the rationale stays behind "Why this suggestion"
    expect(fit.matches).toMatchObject([
      { investigatorId: "p1", fullName: "Ada One", department: "Medicine", tier: "strong", fitTier: "strong", score: 71.25, why: MATCHED, lead: null, judged: null, rationale: { text: "Paradigm 1.00 · Topic 0.70.", source: "engine" } },
      { investigatorId: "p2", fullName: "Ben Two", department: null, tier: "potential", fitTier: "moderate", score: 88, why: MATCHED },
      { investigatorId: "p4", fullName: "Di Four", department: "Pediatrics", tier: "exploratory", fitTier: "exploratory", score: 40, why: `Design: a trialist collaborator. ${MATCHED}`, lead: "Design: a trialist collaborator." },
    ]);
    expect(db.log.reads).toEqual([LIST_READ, "investigators:id, full_name, home_department", PROVENANCE_READ, DETAIL_READ]);
  });

  it("the limit bounds the list after the archived person is dropped", async () => {
    const db = fakeDb({ fit_results: results, investigators: people });
    const fit = await loadNoticeFit(db, { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1", limit: 2 });
    expect(fit.matches.map((m) => m.investigatorId)).toEqual(["p1", "p2"]);
  });

  it("no row at any tier is 'unscored'; only Poor rows is 'none' — one extra count read either way", async () => {
    const unscored = fakeDb({ fit_results: results.filter((r) => r.opportunity_id !== "n1"), investigators: people });
    expect(await loadNoticeFit(unscored, { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1" })).toEqual({ engine: "fit-v1", state: "unscored", matches: [] });
    expect(unscored.log.reads).toEqual([LIST_READ, "fit_results:investigator_id"]);

    const allPoor = fakeDb({ fit_results: [row("p1", "n1", "poor", "3"), row("p2", "n1", "poor", "1")], investigators: people });
    expect(await loadNoticeFit(allPoor, { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1" })).toEqual({ engine: "fit-v1", state: "none", matches: [] });
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
      ["p1", "exploratory", `Design: a trialist collaborator. ${MATCHED}`],
      ["p2", "exploratory", MATCHED],
    ]);
    expect(db.log.reads).toEqual([LIST_READ, "investigators:id, full_name, home_department", PROVENANCE_READ, DETAIL_READ]);
  });

  it("PR 3.2: the rationale cites evidence — ids in the text as titles, stage 5's top item, the profile's paradigm evidence — and a judged pair carries the marker; titles come from one read per kind, never per person", async () => {
    const PUB1 = "publication:p1:31000001";
    const GRANT2 = "grant:g-2";
    const db = fakeDb({
      fit_results: [
        row("p1", "n1", "strong", "71", { rationale: `Paradigm 1.00 · Topic 0.70; 1 compatible item (${PUB1})`, judged_at: "2026-09-06T09:45:00Z", judged_tier: "strong", judged_from: "moderate", judged_confidence: "medium", judged_evidence: [{ id: "PMID:31000001", ref: PUB1 }] }),
        row("p2", "n1", "moderate", "60", { rationale: "Paradigm 0.80 — 0 compatible items", top_items: [GRANT2] }),
        row("p4", "n1", "exploratory", "40", { rationale: "Paradigm 0.60", gap: "Design: a trialist collaborator.", best_pair: { investigator: "clinical_observational", notice: "clinical_trials" }, p_best_pair: { investigator: "clinical_observational", notice: "clinical_trials" } }),
      ],
      investigators: people,
      investigator_publications: [{ investigator_id: "p1", pmid: "31000001", title: "Anifrolumab in SLE", journal: "Lancet Rheumatol", publication_date: "2024-03-01" }],
      investigator_nih_grants: [{ id: "g-2", project_num: "5R01AR070001-03", project_title: "Targeted agents", fiscal_year: 2025, activity_code: "R01" }],
      investigator_clinical_trials: [],
      investigator_fit_profiles: [{ investigator_id: "p4", provenance: [{ axis: "paradigm", category: "clinical_observational", top_items: ["profiles:p4"] }] }],
    });
    const fit = await loadNoticeFit(db, { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1", limit: 5 });
    expect(fit.matches.map((m) => [m.investigatorId, m.rationale.fallback, m.rationale.evidence.map((e) => e.title), m.judged?.label ?? null])).toEqual([
      ["p1", "cited", ["Anifrolumab in SLE"], "judged · medium"],
      ["p2", "top_items", ["Targeted agents"], null],
      ["p4", "profile", ["UCSF Profiles narrative"], null],
    ]);
    // the rationale still resolves its citations for the chips; the row's own line is the two sentences
    expect(fit.matches[0]!.rationale.text).toBe("Paradigm 1.00 · Topic 0.70; 1 compatible item (“Anifrolumab in SLE”)");
    expect(fit.matches[0]!.why).toBe(MATCHED);
    expect(fit.matches[0]!.judged).toMatchObject({ from: "moderate", tier: "strong", changed: true });
    expect(db.log.reads).toEqual([LIST_READ, "investigators:id, full_name, home_department", PROVENANCE_READ, "investigator_publications:pmid, title, journal, publication_date", "investigator_nih_grants:id, project_num, project_title, fiscal_year, activity_code", DETAIL_READ]);
    for (const m of fit.matches) expect(m.rationale.evidence.length).toBeGreaterThan(0);
  });

  it("a row whose person is no longer in the directory yields 'none', not a phantom entry", async () => {
    const db = fakeDb({ fit_results: [row("p3", "n1", "strong", "95")], investigators: people });
    expect(await loadNoticeFit(db, { opportunityId: "n1", statusBucket: "open", fitEngine: "fit-v1" })).toEqual({ engine: "fit-v1", state: "none", matches: [] });
  });
});
