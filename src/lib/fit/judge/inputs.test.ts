import { describe, expect, it } from "vitest";
import { canonicalJson, collaboratorLines, cutText, EMBEDDED_RESERVED, EVIDENCE_TEXT_MAX, judgeDisplayId, neutralSimilarity, noticeTexts, profileVersionHash, profileVersionsOf, renderCollaborators, renderEvidence, renderNotice, sameVersions, SECTION_I_MAX, selectEvidence, type EvidenceCandidate } from "@/lib/fit/judge/inputs";
import { buildMask } from "@/lib/fit/judge/mask";
import { EVIDENCE, judgeInputs, SECTIONS, SLE_TRIAL, TRIALIST } from "@/lib/fit/judge/test-fixtures";
import { JUDGE_VERSION } from "@/lib/fit/judge/types";
import { TAXONOMY_VERSION, topicWeights } from "@/lib/fit/taxonomy";

const candidate = (id: string, over: Partial<EvidenceCandidate> = {}): EvidenceCandidate => ({ id, ref: `ref:${id}`, kind: "publication", year: 2024, role: "first_last_corresponding", title: `Title ${id}`, text: `Text of ${id}.`, mesh_names: [], topic_terms: [], weight: 1, similarity: 0.5, ...over });

describe("judge/inputs · ids", () => {
  it("gives every kind the short stable id the model cites", () => {
    const grants = new Map([["row-1", "5R01AI000001"]]);
    expect(judgeDisplayId({ id: "publication:inv:31000001", kind: "publication" })).toBe("PMID:31000001");
    expect(judgeDisplayId({ id: "grant:row-1", kind: "grant" }, grants)).toBe("5R01AI000001");
    expect(judgeDisplayId({ id: "grant:row-2", kind: "grant" }, grants)).toBe("grant:row-2");
    expect(judgeDisplayId({ id: "trial:inv:NCT01234567", kind: "trial" })).toBe("NCT01234567");
    expect(judgeDisplayId({ id: "biosketch:inv:statement", kind: "biosketch_statement" })).toBe("biosketch:statement");
    expect(judgeDisplayId({ id: "biosketch:inv:contribution:2", kind: "biosketch_contribution" })).toBe("biosketch:contribution:2");
    expect(judgeDisplayId({ id: "profiles:inv", kind: "profiles_narrative" })).toBe("profiles:narrative");
    expect(judgeDisplayId({ id: "self_declared:inv", kind: "self_declared" })).toBe("self_declared");
    expect(judgeDisplayId({ id: "aspiration:inv:1", kind: "self_declared" })).toBe("aspiration:1");
  });
});

describe("judge/inputs · evidence selection (blind-pass.md: top 8 by w_item · similarity, ≤ 1,200 chars)", () => {
  it("ranks by weight × similarity, an item without an embedding at the rescale band's lower edge (F5), and takes the top 8", () => {
    const [lo] = topicWeights().embedding_rescale;
    expect(neutralSimilarity()).toBe(lo);
    expect(lo).toBe(0.35);
    const items = Array.from({ length: 12 }, (_, i) => candidate(`p${i}`, { weight: 1, similarity: 0.9 - i * 0.06 }));
    items.push(candidate("noembed", { weight: 1, similarity: null }));
    const picked = selectEvidence(items, { clinical_trial: "not_allowed" });
    expect(picked).toHaveLength(8);
    expect(picked.map((p) => p.id)).toEqual(["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7"]);
    // the unembedded item ranks at 0.35: below p9 (0.36), above p10 (0.30)
    expect(selectEvidence(items, { clinical_trial: "not_allowed" }, 11).map((p) => p.id)).toEqual(["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "noembed"]);
  });

  it("F5 · an embedded item at 0.45 outranks an unembedded one of equal weight; two slots are reserved for the highest-cosine embedded items whatever the weights", () => {
    const pair = selectEvidence([candidate("unembedded", { weight: 1, similarity: null }), candidate("embedded", { weight: 1, similarity: 0.45 })], { clinical_trial: "not_allowed" });
    expect(pair.map((p) => p.id)).toEqual(["embedded", "unembedded"]);
    // twelve unembedded items at weight 1 (0.35 each) would fill the eight slots; the two embedded items at a low cosine still get in
    const flood = Array.from({ length: 12 }, (_, i) => candidate(`u${i}`, { weight: 1, similarity: null }));
    flood.push(candidate("e-high", { weight: 0.5, similarity: 0.3 }), candidate("e-low", { weight: 0.5, similarity: 0.2 }), candidate("e-lowest", { weight: 0.5, similarity: 0.1 }));
    const picked = selectEvidence(flood, { clinical_trial: "not_allowed" }).map((p) => p.id);
    expect(picked).toHaveLength(8);
    expect(EMBEDDED_RESERVED).toBe(2);
    expect(picked).toContain("e-high");
    expect(picked).toContain("e-low");
    expect(picked).not.toContain("e-lowest");
    expect(picked.filter((id) => id.startsWith("u"))).toHaveLength(6);
  });

  it("guarantees the biosketch statement and, on a Clinical Trial Required notice, the best trial, displacing the lowest-scored", () => {
    const items = Array.from({ length: 9 }, (_, i) => candidate(`p${i}`, { similarity: 0.9 - i * 0.02 }));
    items.push(candidate("biosketch:statement", { kind: "biosketch_statement", role: null, year: null, weight: 0.3, similarity: 0.1 }));
    items.push(candidate("NCT1", { kind: "trial", role: "trial_pi", weight: 0.3, similarity: null }));
    const notRequired = selectEvidence(items, { clinical_trial: "optional" }).map((p) => p.id);
    expect(notRequired).toContain("biosketch:statement");
    expect(notRequired).not.toContain("NCT1");
    expect(notRequired).toHaveLength(8);
    const required = selectEvidence(items, { clinical_trial: "required" }).map((p) => p.id);
    expect(required).toContain("biosketch:statement");
    expect(required).toContain("NCT1");
    expect(required).toHaveLength(8);
    expect(required).not.toContain("p7");
    expect(required).not.toContain("p8");
  });

  it("drops items without text and the directory row, dedupes ids, and cuts text on a word boundary", () => {
    const long = "word ".repeat(400).trim();
    const picked = selectEvidence([candidate("a", { text: long }), candidate("a", { text: "dup" }), candidate("b", { text: null }), candidate("c", { text: "   " }), candidate("d", { kind: "directory", text: "dept" })], { clinical_trial: "unknown" });
    expect(picked.map((p) => p.id)).toEqual(["a"]);
    expect(picked[0]!.text.length).toBeLessThanOrEqual(EVIDENCE_TEXT_MAX);
    expect(picked[0]!.text.endsWith("…")).toBe(true);
    expect(cutText("short", 10)).toBe("short");
  });
});

describe("judge/inputs · notice texts from the Guide sections", () => {
  it("routes Part 1 Purpose + Section I to section_I_text, the non-responsive sub-section, III.3 and the team language to their fields", () => {
    const t = noticeTexts(SECTIONS, SLE_TRIAL);
    expect(t.section_I_text).toContain("## Part 1 · Overview · Funding Opportunity Purpose");
    expect(t.section_I_text).toContain("## Part 2 · Section I · Research Objectives");
    expect(t.section_I_text).not.toContain("non-responsive");
    // the team language is Section I text too (the extractor keeps it in group 1) and is repeated as team_text for Call B
    expect(t.section_I_text).toContain("Team and Collaborations");
    expect(t.non_responsive_text).toContain("will not be reviewed");
    expect(t.eligibility_text).toContain("Multiple PDs/PIs are not allowed");
    expect(t.team_text).toContain("pair a trialist with a basic immunologist");
    expect(t.section_I_text.length).toBeLessThanOrEqual(SECTION_I_MAX);
  });

  it("falls back to the profile's verbatim non-responsive items and rules, a PD/PI-headed Section III item, and says when nothing is on file", () => {
    const profile = { ...SLE_TRIAL, non_responsive: ["Animal-only studies are non-responsive."], eligibility: { ...SLE_TRIAL.eligibility, investigator_rules: ["Must be an ESI."] } };
    const none = noticeTexts([], profile);
    expect(none.section_I_text).toBe("(no Section I text on file)");
    expect(none.non_responsive_text).toBe("- Animal-only studies are non-responsive.");
    expect(none.eligibility_text).toBe("- Must be an ESI.");
    expect(none.team_text).toBe("(none stated)");
    const iii = noticeTexts([{ part: 2, section: "III", heading: "Eligible Individuals (Program Director/Principal Investigator)", text: "Any individual." }], SLE_TRIAL);
    expect(iii.eligibility_text).toContain("Any individual.");
    const synopsis = noticeTexts([{ part: 1, section: "synopsis", heading: "Synopsis", text: "A synopsis." }], SLE_TRIAL);
    expect(synopsis.section_I_text).toContain("## Synopsis\nA synopsis.");
  });
});

describe("judge/inputs · rendering", () => {
  it("renders each item as [id] kind · year · role, title, text — masked when a mask is given", () => {
    const text = renderEvidence(EVIDENCE.slice(0, 2));
    expect(text).toContain("[PMID:31000001] publication · 2024 · role: first last corresponding\nA randomized phase II trial of anifrolumab in active systemic lupus erythematosus\n");
    expect(text).toContain("[NCT04000001] trial · 2023 · role: trial pi\n");
    const mask = buildMask({ terms: ["systemic lupus erythematosus", "anifrolumab"], descriptors: [{ name: "Lupus Erythematosus, Systemic", tree_numbers: ["C17.300.480", "C20.111.590"] }] });
    const masked = renderEvidence(EVIDENCE.slice(0, 1), mask);
    expect(masked).not.toMatch(/lupus/i);
    expect(masked).not.toMatch(/anifrolumab/i);
    expect(masked).toContain("randomized phase II trial");
    expect(masked).toContain("[DISEASE]");
    // F6: with a mask, a project number loses its IC letters; PMIDs, NCT ids and the biosketch id are unchanged; unmasked, every id is canonical
    const grant = renderEvidence(EVIDENCE, mask);
    expect(grant).toContain("[5R01··070001] grant · 2022 · role: contact pi");
    expect(grant).not.toContain("5R01AR070001");
    expect(grant).toContain("[PMID:31000001]");
    expect(grant).toContain("[NCT04000001]");
    expect(grant).toContain("[biosketch:statement]");
    expect(renderEvidence(EVIDENCE)).toContain("[5R01AR070001] grant");
  });

  it("renders the notice header, Section I and Non-responsive, plus eligibility, team and the title only when asked; the masked header hides the IC (F6)", () => {
    const n = judgeInputs().notice;
    const masked = renderNotice(n, { mask: buildMask({ terms: ["systemic lupus erythematosus"], descriptors: [] }) });
    expect(masked.startsWith("RFA-··-27-001 · R01 · clinical trial: required\nSection I:\n")).toBe(true);
    expect(masked).not.toContain("RFA-AR-27-001");
    expect(masked).toContain("\nNon-responsive:\n");
    expect(masked).not.toContain("Eligibility (III.3):");
    expect(masked).not.toContain("Novel Therapeutics");
    expect(masked).not.toMatch(/systemic lupus erythematosus/i);
    const full = renderNotice(n, { title: true, eligibility: true, team: true });
    expect(full.startsWith("RFA-AR-27-001 · Novel Therapeutics in Systemic Lupus (R01 Clinical Trial Required) · R01 · clinical trial: required\n")).toBe(true);
    expect(full).toContain("\nEligibility (III.3):\n");
    expect(full).toContain("\nTeam:\n");
    expect(renderCollaborators([])).toBe("(none on file)");
    expect(renderCollaborators(judgeInputs().collaborators)).toBe("- R. Immunologist: discovery (molecular cellular mechanistic)");
    expect(collaboratorLines(TRIALIST)).toEqual([{ name_or_id: "R. Immunologist", one_line_summary: "discovery (molecular cellular mechanistic)" }]);
    expect(collaboratorLines({ collaborators: Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, name: null, dominant_family: "clinical" as const, categories: [] })) })).toHaveLength(6);
  });
});

describe("judge/inputs · profile versions (the adjudication cache key)", () => {
  it("hashes the profile content with computed_at left out and keys sorted, and changes with any weight", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: 3 } })).toBe('{"a":{"c":3,"d":[2,{"y":2,"z":1}]},"b":1}');
    const same = profileVersionHash({ ...TRIALIST, computed_at: "2030-01-01T00:00:00.000Z" });
    expect(same).toBe(profileVersionHash(TRIALIST));
    expect(same).toHaveLength(16);
    const changed = profileVersionHash({ ...TRIALIST, design: { ...TRIALIST.design, rct: 0.71 } });
    expect(changed).not.toBe(same);
    const reordered = JSON.parse(JSON.stringify({ ...TRIALIST, design: { prospective_cohort: 0.4, rct: 0.7, biospecimen_assay: 0.3 } }));
    expect(profileVersionHash(reordered)).toBe(same);
    // F13: a notice re-extraction that only re-counts its sources or clears needs_review keeps the key; one that moves a weight or a rule does not
    const notice = profileVersionHash(SLE_TRIAL);
    expect(profileVersionHash({ ...SLE_TRIAL, sources: { text: "synopsis", exemplar_count: 9 }, needs_review: true, computed_at: "2030-01-01T00:00:00.000Z" })).toBe(notice);
    expect(profileVersionHash({ ...SLE_TRIAL, paradigm: { ...SLE_TRIAL.paradigm, allowed: { ...SLE_TRIAL.paradigm.allowed, translational: 0.6 } } })).not.toBe(notice);
    expect(profileVersionHash({ ...SLE_TRIAL, eligibility: { ...SLE_TRIAL.eligibility, esi_only: true } })).not.toBe(notice);
    const v = profileVersionsOf(TRIALIST, SLE_TRIAL);
    expect(v).toEqual({ investigator: same, opportunity: profileVersionHash(SLE_TRIAL), taxonomy: TAXONOMY_VERSION, judge: JUDGE_VERSION });
    expect(sameVersions(v, { ...v })).toBe(true);
    expect(sameVersions(v, { ...v, judge: "judge-0" })).toBe(false);
  });
});
