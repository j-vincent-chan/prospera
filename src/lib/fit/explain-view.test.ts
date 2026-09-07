/**
 * What a shown pair says for itself (PR 3.2): the D7 audience, the groups
 * and their order, the rationale's evidence citations and their fallbacks,
 * the judged marker, and the Outreach snapshot's rationale.
 */
import { describe, expect, it } from "vitest";
import { citedEvidenceIds, citedJudgedRefs, evidenceIdsToResolve, fitAudienceFor, groupFitRows, judgedOf, leadLineOf, needsProfileFallback, profileFallbackIds, rationaleView, shortTitleOf, showsExploratory, showsWhyNot, snapshotRationale, type RationaleInput } from "@/lib/fit/explain-view";
import { resolveEvidenceId, type EvidenceLookup } from "@/lib/fit/inspect/evidence";
import type { AxisProvenance } from "@/lib/fit/types";

const INV = "0f5b1b2c-1111-4222-8333-444455556666";
const PUB = `publication:${INV}:31000001`;
const GRANT = "grant:9a9a9a9a-2222-4333-8444-555566667777";
const TRIAL = `trial:${INV}:NCT04000001`;

const lookup: EvidenceLookup = {
  publications: new Map([["31000001", { pmid: "31000001", title: "Anifrolumab in active systemic lupus erythematosus: a phase II trial", journal: "Lancet Rheumatol", publication_date: "2024-03-01" }]]),
  grants: new Map([["9a9a9a9a-2222-4333-8444-555566667777", { id: "9a9a9a9a-2222-4333-8444-555566667777", project_num: "5R01AR070001-03", project_title: "Targeted agents in SLE", fiscal_year: 2025, activity_code: "R01" }]]),
  trials: new Map([["NCT04000001", { nct_id: "NCT04000001", title: "Phase II of X in SLE", start_date: "2023-01-01" }]]),
};

const row = (over: Partial<RationaleInput> = {}): RationaleInput => ({ rationale: null, top_items: null, best_pair: null, judged_at: null, judged_evidence: null, ...over });

describe("explain-view · audience (D7)", () => {
  it("the viewer is the investigator exactly when the sign-in email is the directory record's (case-insensitive); Exploratory and Why not? are strategists-only", () => {
    expect(fitAudienceFor({ email: "Ada@ucsf.edu " }, { email: "ada@ucsf.edu" })).toBe("investigator");
    expect(fitAudienceFor({ email: "ada@ucsf.edu" }, { email: "ben@ucsf.edu" })).toBe("strategist");
    expect(fitAudienceFor({ email: null }, { email: "ada@ucsf.edu" })).toBe("strategist");
    expect(fitAudienceFor({ email: "ada@ucsf.edu" }, { email: null })).toBe("strategist");
    expect(fitAudienceFor({ email: "" }, { email: "" })).toBe("strategist");
    expect(showsExploratory("strategist")).toBe(true);
    expect(showsExploratory("investigator")).toBe(false);
    expect(showsWhyNot("investigator")).toBe(false);
  });
});

describe("explain-view · groups", () => {
  const rows = [
    { id: "e1", tier: "exploratory" as const, score: 95 },
    { id: "m1", tier: "moderate" as const, score: 90 },
    { id: "s2", tier: "strong" as const, score: 60 },
    { id: "p1", tier: "poor" as const, score: 99 },
    { id: "s1", tier: "strong" as const, score: 70 },
    { id: "e2", tier: "exploratory" as const, score: 40 },
    { id: "m2", tier: "moderate" as const, score: 90 },
  ];
  const id = (r: { id: string }) => r.id;

  it("Recommended is Strong then Moderate by score then id; Exploratory its own group; Poor never; a PI gets no Exploratory", () => {
    const g = groupFitRows(rows, id, "strategist");
    expect(g.recommended.map(id)).toEqual(["s1", "s2", "m1", "m2"]);
    expect(g.exploratory.map(id)).toEqual(["e1", "e2"]);
    const pi = groupFitRows(rows, id, "investigator");
    expect(pi.recommended.map(id)).toEqual(["s1", "s2", "m1", "m2"]);
    expect(pi.exploratory).toEqual([]);
    expect(groupFitRows([], id, "strategist")).toEqual({ recommended: [], exploratory: [] });
  });

  it("an Exploratory row leads with its gap sentence; other tiers show the rationale alone", () => {
    expect(leadLineOf({ tier: "exploratory", gap: "Design: a trialist collaborator." }, "Paradigm 0.60.")).toEqual({ lead: "Design: a trialist collaborator.", rest: "Paradigm 0.60." });
    expect(leadLineOf({ tier: "exploratory", gap: null }, "Paradigm 0.60.")).toEqual({ lead: null, rest: "Paradigm 0.60." });
    expect(leadLineOf({ tier: "moderate", gap: "ignored" }, "Paradigm 0.80.")).toEqual({ lead: null, rest: "Paradigm 0.80." });
  });
});

describe("explain-view · citations", () => {
  it("finds every evidence id a rationale names, once, in order, without the punctuation around it", () => {
    const text = `Topic 0.62 — 1 coded match (C20.111 at depth 3); 3 compatible items (${PUB}, ${GRANT}, ${TRIAL}) · Methods 0.5 · again ${PUB}.`;
    expect(citedEvidenceIds(text)).toEqual([PUB, GRANT, TRIAL]);
    expect(citedEvidenceIds(`biosketch:${INV}:statement and profiles:${INV}, aspiration:${INV}:2.`)).toEqual([`biosketch:${INV}:statement`, `profiles:${INV}`, `aspiration:${INV}:2`]);
    expect(citedEvidenceIds("Paradigm 1.00 · Topic 0.70.")).toEqual([]);
    expect(citedEvidenceIds(null)).toEqual([]);
  });

  it("maps a judged rationale's short ids back to items in order of appearance", () => {
    const ev = [{ id: "PMID:31000001", ref: PUB }, { id: "NCT04000001", ref: TRIAL }, { id: "5R01AR070001", ref: GRANT }];
    expect(citedJudgedRefs("The NCT04000001 trial and PMID:31000001 show it; NCT04000001 again.", ev)).toEqual([TRIAL, PUB]);
    expect(citedJudgedRefs("nothing cited", ev)).toEqual([]);
    expect(citedJudgedRefs("PMID:31000001", null)).toEqual([]);
  });

  it("short titles read inside a sentence: a quoted clipped paper title, a project number, an NCT id, a prior by name", () => {
    expect(shortTitleOf(resolveEvidenceId(PUB, lookup))).toBe("“Anifrolumab in active systemic lupus erythematosus: a phase…”");
    expect(shortTitleOf(resolveEvidenceId(GRANT, lookup))).toBe("5R01AR070001-03");
    expect(shortTitleOf(resolveEvidenceId(TRIAL, lookup))).toBe("NCT04000001");
    expect(shortTitleOf(resolveEvidenceId(`profiles:${INV}`, lookup))).toBe("the UCSF Profiles narrative");
    expect(shortTitleOf(resolveEvidenceId(`publication:${INV}:99`, lookup))).toBe("PMID 99");
  });
});

describe("explain-view · rationaleView", () => {
  it("cited: the ids in the text become titles and chips (at most `max`), in order", () => {
    const r = rationaleView(row({ rationale: `Paradigm 1.00 · Topic 0.62; 3 compatible items (${PUB}, ${GRANT}, ${TRIAL}) · Methods 0.50` }), lookup, { max: 2 });
    expect(r.source).toBe("engine");
    expect(r.fallback).toBe("cited");
    expect(r.text).toBe("Paradigm 1.00 · Topic 0.62; 3 compatible items (“Anifrolumab in active systemic lupus erythematosus: a phase…”, 5R01AR070001-03, NCT04000001) · Methods 0.50");
    expect(r.evidence.map((e) => [e.kind, e.resolved, e.href])).toEqual([
      ["publication", true, "https://pubmed.ncbi.nlm.nih.gov/31000001/"],
      ["grant", true, null],
    ]);
  });

  it("a rationale that cites nothing falls back to stage 5's top items, then to the profile's evidence behind the paradigm match; never an empty rationale", () => {
    const top = rationaleView(row({ rationale: "Paradigm 1.00 · Topic 0.70 — 0 compatible items", top_items: [GRANT] }), lookup);
    expect(top).toMatchObject({ fallback: "top_items", text: "Paradigm 1.00 · Topic 0.70 — 0 compatible items" });
    expect(top.evidence.map((e) => e.id)).toEqual([GRANT]);

    const provenance: AxisProvenance[] = [
      { axis: "unit", category: "L3", top_items: [TRIAL] },
      { axis: "paradigm", category: "translational", top_items: [`profiles:${INV}`] },
      { axis: "paradigm", category: "clinical_trials", top_items: [PUB, TRIAL] },
    ];
    const prof = rationaleView(row({ rationale: "Paradigm 0.80 — Clinical trials vs. required Clinical trials", best_pair: { investigator: "clinical_trials", notice: "clinical_trials" } }), lookup, { profileProvenance: provenance });
    expect(prof.fallback).toBe("profile");
    expect(prof.evidence.map((e) => e.id)).toEqual([PUB, TRIAL]);
    // no best pair: the first paradigm entry with items, else the first entry with items
    expect(profileFallbackIds(provenance, null)).toEqual([`profiles:${INV}`]);
    expect(profileFallbackIds([{ axis: "unit", category: "L3", top_items: [TRIAL] }], "clinical_trials")).toEqual([TRIAL]);
    expect(profileFallbackIds(null, "clinical_trials")).toEqual([]);

    const empty = rationaleView(row(), lookup);
    expect(empty).toMatchObject({ text: "No rationale stored.", fallback: "none", evidence: [] });
  });

  it("a judged row resolves the judge's short ids through judged_evidence, else falls back to the judge's items, keeping the text as written", () => {
    const ev = [{ id: "PMID:31000001", ref: PUB }, { id: "NCT04000001", ref: TRIAL }];
    const judged = rationaleView(row({ rationale: "Led NCT04000001, the phase II reported in PMID:31000001; a trialist with the cohort in hand.", judged_at: "2026-09-06T00:00:00Z", judged_evidence: ev }), lookup);
    expect(judged).toMatchObject({ source: "judged", fallback: "cited", text: "Led NCT04000001, the phase II reported in PMID:31000001; a trialist with the cohort in hand." });
    expect(judged.evidence.map((e) => e.id)).toEqual([TRIAL, PUB]);
    const uncited = rationaleView(row({ rationale: "A trialist.", judged_at: "2026-09-06T00:00:00Z", judged_evidence: ev, top_items: [GRANT] }), lookup);
    expect(uncited.fallback).toBe("top_items");
    const judgeItems = rationaleView(row({ rationale: "A trialist.", judged_at: "2026-09-06T00:00:00Z", judged_evidence: ev }), lookup);
    expect(judgeItems).toMatchObject({ fallback: "judged_evidence" });
    expect(judgeItems.evidence.map((e) => e.id)).toEqual([PUB, TRIAL]);
  });

  it("evidenceIdsToResolve unions every candidate source; needsProfileFallback is true only when the row cites nothing on its own", () => {
    const provenance: AxisProvenance[] = [{ axis: "paradigm", category: "clinical_trials", top_items: [PUB] }];
    const r = row({ rationale: `x (${GRANT})`, top_items: [TRIAL], best_pair: { investigator: "clinical_trials", notice: "clinical_trials" }, judged_evidence: [{ id: "PMID:1", ref: `publication:${INV}:1` }] });
    expect(evidenceIdsToResolve(r, { profileProvenance: provenance })).toEqual([GRANT, TRIAL, `publication:${INV}:1`, PUB]);
    expect(needsProfileFallback(row({ rationale: "nothing" }))).toBe(true);
    expect(needsProfileFallback(row({ rationale: `cites ${PUB}` }))).toBe(false);
    expect(needsProfileFallback(row({ rationale: "nothing", top_items: [PUB] }))).toBe(false);
    expect(needsProfileFallback(row({ rationale: "nothing", judged_at: "2026-09-06", judged_evidence: [{ id: "PMID:1", ref: PUB }] }))).toBe(false);
    expect(needsProfileFallback(row({ rationale: "nothing", judged_at: "2026-09-06", judged_evidence: [] }))).toBe(true);
  });
});

describe("explain-view · judgedOf", () => {
  it("null for an engine-only row; a label with the confidence and a tooltip naming the change and the date", () => {
    expect(judgedOf({ judged_at: null, judged_tier: null, judged_from: null, judged_confidence: null })).toBeNull();
    const same = judgedOf({ judged_at: "2026-09-06T09:45:00Z", judged_tier: "strong", judged_from: "strong", judged_confidence: "high" });
    expect(same).toMatchObject({ tier: "strong", from: "strong", changed: false, label: "judged · high" });
    expect(same!.title).toBe("Stage 8 — blind pass, skeptic and reconciler — judged this pair on 2026-09-06: confirmed Strong (high confidence). The tier is the judged one; the engine's was Strong.");
    const lowered = judgedOf({ judged_at: "2026-09-06T09:45:00Z", judged_tier: "exploratory", judged_from: "strong", judged_confidence: "review" });
    expect(lowered).toMatchObject({ changed: true, label: "judged · needs review" });
    expect(lowered!.title).toMatch(/Strong → Exploratory \(needs review\)/);
    expect(judgedOf({ judged_at: "2026-09-06", judged_tier: "moderate", judged_from: "moderate", judged_confidence: "structured_only" })!.label).toBe("judged · structure only");
    expect(judgedOf({ judged_at: "2026-09-06", judged_tier: "moderate", judged_from: null, judged_confidence: null })!.label).toBe("judged · reviewed");
  });
});

describe("explain-view · snapshotRationale (Outreach)", () => {
  const item = (id: string, heading: string) => ({ id, heading, sub: "" });
  const groups = [
    { key: "research" as const, title: "Research alignment", meta: "", items: [item("publication:1", "Paper one"), item("publication:2", "Paper two")] },
    { key: "funding" as const, title: "Funding", meta: "", items: [item("grant:5R01", "R01 · Targeted agents")] },
    { key: "self" as const, title: "Self", meta: "", items: [] },
    { key: "institutional" as const, title: "Institutional", meta: "", items: [item("roster", "Medicine · Professor")] },
    { key: "history" as const, title: "History", meta: "", items: [] },
  ];

  it("the first reason's text with its cited ids resolved against the snapshot's own items; uncited falls back research → funding → self → institutional; never empty while the roster row exists", () => {
    const cited = snapshotRationale({ reasons: [{ text: "Paradigm 1.00 · Topic 0.70.", source: "Fit engine", title: "Strong fit", evidenceIds: ["publication:2", "grant:5R01", "publication:none"] }], groups });
    expect(cited).toMatchObject({ text: "Paradigm 1.00 · Topic 0.70.", fallback: "cited" });
    expect(cited.evidence.map((e) => e.id)).toEqual(["publication:2", "grant:5R01"]);
    expect(snapshotRationale({ reasons: [{ text: "r", source: "", title: "", evidenceIds: [] }], groups })).toMatchObject({ fallback: "research", evidence: [expect.objectContaining({ id: "publication:1" }), expect.objectContaining({ id: "publication:2" })] });
    expect(snapshotRationale({ reasons: [{ text: "r", source: "", title: "", evidenceIds: [] }], groups: groups.filter((g) => g.key !== "research") })).toMatchObject({ fallback: "funding" });
    expect(snapshotRationale({ reasons: [], groups: groups.filter((g) => g.key === "institutional"), summary: "Summary line" })).toMatchObject({ text: "Summary line", fallback: "institutional" });
    expect(snapshotRationale({ reasons: [], groups: [] })).toEqual({ text: "No rationale stored.", evidence: [], fallback: "none" });
  });
});
