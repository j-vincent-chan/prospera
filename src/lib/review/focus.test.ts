/** Focus mode and the drawers, as pure view builders (`lib/review/focus.ts`). */
import { describe, expect, it } from "vitest";
import type { AuditContent } from "@/lib/fit/audit-view";
import type { InvestigatorFitProfile, OpportunityFitProfile } from "@/lib/fit/types";
import { authorRole, checksOf, CITED, citedFirst, decisionsLine, doneLine, focusActions, focusGrant, focusPublication, noticeDetail, pageLabel, profileCard, progressLine, progressPercentOf, termLabel } from "@/lib/review/focus";

const TODAY = "2026-09-13";

describe("progress", () => {
  it("the two lines and the bar", () => {
    expect(progressLine({ match: 1, matches: 4, notice: 1, notices: 3 })).toBe("Reviewing match 1 of 4 on notice 1 of 3");
    expect(decisionsLine({ undecided: 8, total: 8 })).toBe("8 decisions left · 0 of 8 done");
    expect(decisionsLine({ undecided: 1, total: 8 })).toBe("1 decision left · 7 of 8 done");
    expect(progressPercentOf({ undecided: 6, total: 8 })).toBe(25);
    expect(progressPercentOf({ undecided: 0, total: 0 })).toBe(0);
    expect(doneLine(2)).toBe("2 confirmed and waiting in the outreach draft. Nothing has been sent.");
    expect(doneLine(0)).toBe("Nothing was confirmed, so no outreach is queued.");
  });
});

describe("the keyed actions", () => {
  it("1 is the label's primary, 2 opens the reasons or reinstates, 3 watches", () => {
    const strong = focusActions("strong");
    expect(strong.map((a) => [a.key, a.label, a.status, a.opensReasons])).toEqual([
      ["1", "Confirm match", "confirmed", false],
      ["2", "Dismiss match", "rejected", true],
      ["3", "Watch", "watch", false],
    ]);
    expect(focusActions("cannot_assess")[0]).toMatchObject({ label: "Request a biosketch", status: "watch", reason: "biosketch_requested" });
    const ruled = focusActions("ruled_out");
    expect(ruled[0]).toMatchObject({ label: "Keep it ruled out", status: "rejected" });
    expect(ruled[1]).toMatchObject({ label: "Reinstate", status: "confirmed", opensReasons: false });
    expect(strong[0]!.kind).toBe("primary");
    expect(strong[1]!.kind).toBe("secondary");
  });
});

describe("the investigator card", () => {
  const profile = {
    characteristics: { career_stage: "mid", esi: false, esi_eligible_until: null, mechanisms_held: ["R01", "K08"], active_awards: 1, clinical_role: "sees_patients", trial_pi_count: 0, degrees: ["MD", "PhD"], title_series: "In Residence" },
    paradigm: { recent: { human_translational_mechanistic: 0.7, molecular_cellular_mechanistic: 0.2 }, career: {} },
    topic: { mesh_major: [], rcdc: ["Immunology", "Dermatology", "Skin"], free_text: null },
    evidence_summary: { publications_verified: 40, grants: 5, trials: 0, trials_as_pi: 0, biosketch: "not_requested", self_declared: false },
    collaborators: [{ id: "c1", name: "Ari Molofsky", dominant_family: "discovery", categories: [] }],
    do_not_suggest: [],
  } as unknown as InvestigatorFitProfile;

  it("stage, paradigm, themes and the drawer's facts come from the profile", () => {
    const card = profileCard(profile, { rank: "Associate Professor", doNotContact: false });
    expect(card.stage).toBe("Mid-career · In Residence");
    expect(card.paradigm).toMatch(/·/);
    expect(card.themes).toEqual(["Immunology", "Dermatology", "Skin"]);
    expect(card.facts.map((f) => f.key)).toEqual(["Appointment", "Award history", "Clinical role", "Collaborators", "Eligibility flags"]);
    expect(card.facts[0]!.value).toBe("Associate Professor · In Residence · MD, PhD · Mid-career");
    expect(card.facts[1]!.value).toBe("5 awards on file, 1 active. Mechanisms held as PI: R01, K08.");
    expect(card.facts[4]!.value).toBe("Not an early-stage investigator");
  });

  it("no profile: nothing claimed", () => {
    expect(profileCard(null, { rank: "member", doNotContact: true })).toEqual({ stage: null, paradigm: null, themes: [], facts: [] });
  });

  it("a do-not-contact flag and an ESI estimate are said in the flags row", () => {
    const p = { ...profile, characteristics: { ...profile.characteristics, esi: true, esi_eligible_until: "2028-06-30" } } as InvestigatorFitProfile;
    const card = profileCard(p, { rank: null, doNotContact: true });
    expect(card.facts.find((f) => f.key === "Eligibility flags")!.value).toBe("Early-stage investigator, estimated until 2028. Do not contact is set on the profile");
  });
});

describe("publications and awards", () => {
  it("author roles", () => {
    expect(authorRole("first")).toEqual({ label: "First author", lead: true });
    expect(authorRole("last")).toEqual({ label: "Senior author", lead: true });
    expect(authorRole("corresponding")).toEqual({ label: "Corresponding author", lead: true });
    expect(authorRole("middle")).toEqual({ label: "Co-author", lead: false });
    expect(authorRole(null)).toEqual({ label: null, lead: false });
  });

  it("a publication as the card lists it", () => {
    const p = focusPublication({ id: "p1", pmid: "12345", title: " IL-31 in itch ", journal: "J Clin Invest", publication_date: "2025-03-01", author_position: "last", abstract: null }, true);
    expect(p).toMatchObject({ title: "IL-31 in itch", meta: "J Clin Invest · 2025", role: "Senior author", roleLead: true, relevance: CITED, abstract: null });
    expect(focusPublication({ id: "p2", pmid: "1", title: "", journal: null, publication_date: null, author_position: null, abstract: "  " }, false)).toMatchObject({ title: "Untitled", meta: "PubMed", role: null, relevance: null, abstract: null });
  });

  it("an award as the card lists it", () => {
    const g = focusGrant({ id: "g1", project_num: "R03AR082948", fiscal_year: 2025, project_title: "Illuminating IL-31", ic_name: "NIAMS", is_active: true, is_contact_pi: true, award_amount: "100000", abstract: "Abstract.", phr_text: "Plain-language relevance.", raw_json: { project_start_date: "2023-07-01", project_end_date: "2027-06-30" } }, true, false);
    expect(g).toMatchObject({ number: "R03AR082948", sponsor: "NIAMS", active: true, title: "Illuminating IL-31", line: "Contact PI · 2023 – 2027 · $100k/yr", detail: "Plain-language relevance.", relevance: null });
    const closed = focusGrant({ id: "g2", project_num: "K08", fiscal_year: 2019, project_title: null, ic_name: null, is_active: false, is_contact_pi: null, award_amount: 1_800_000, abstract: null, phr_text: null, raw_json: null }, false, true);
    expect(closed).toMatchObject({ title: "Untitled award", line: "PI · FY2019 · $1.8M/yr", active: false, detail: null, relevance: CITED });
  });

  it("paging and cited-first", () => {
    expect(pageLabel(0, 2, 8)).toBe("1–2 of 8");
    expect(pageLabel(3, 2, 7)).toBe("7 of 7");
    expect(pageLabel(0, 2, 0)).toBe("0 of 0");
    expect(citedFirst([{ relevance: null, id: 1 }, { relevance: CITED, id: 2 }, { relevance: null, id: 3 }]).map((x) => x.id)).toEqual([2, 1, 3]);
  });
});

describe("the opportunity card and drawer", () => {
  const profile = {
    computed_at: "2026-09-06T18:07:47.770Z",
    mechanism: { activity_code: "R03", clinical_trial: "optional", besh: false, ceiling_direct_per_year: 100000, period_years: 2, issuing_ic: null, program_division: null },
    paradigm: { required: {}, allowed: {}, excluded: { public_health: 1 }, required_any: { human_translational_mechanistic: 1 } },
    unit: { required: [], required_any: [], allowed: [] },
    design: { required_any: ["biospecimen_assay", "animal_in_vivo"], required_any_2: [], allowed: [], prohibited: ["survey"] },
    materials: { expected: [], required: ["human_biospecimen"], required_any: [], human_required: true },
    population: null,
    objective: { mechanism_discovery: 1, treatment_evaluation_efficacy: 1 },
    topic: { mesh: [], rcdc: [], terms: ["substance use disorders", "chemical probe"], free_text: null },
    eligibility: { investigator_rules: [], esi_only: true, new_investigator_only: false, clinician_required: false, degree_required: null, independent_appointment_required: false, citizenship_rule: null },
    team: { multi_pi_allowed: true, consortium_required: null, required_partners: [] },
    non_responsive: ["Applications that do not involve substance use"],
    provenance: { objective: { section: "Part 2 · Section I", quote: "to enhance understanding of substance use trajectories" }, "eligibility.investigator_rules": { section: "Part 2 · Section III.1", quote: "Any individual" } },
    sources: { text: "full_text", exemplar_count: 0 },
  } as unknown as OpportunityFitProfile;
  const keyStats = [
    { value: "Oct 5", label: "deadline · 23 days", urgent: true },
    { value: "Sep 28", label: "internal routing · 16 days", urgent: true },
    { value: "$100k / yr", label: "2 years · $200k total", urgent: false },
  ];

  it("every section is composed from the profile, never written", () => {
    const d = noticeDetail({ profile, keyStats, activityCode: "R03", instrument: "GRANT", loiDue: null, loiNote: null, limited: true, cap: 1, byTier: { strong: 1, moderate: 9, exploratory: 20 }, today: TODAY });
    expect(d.facts.map((f) => f.label)).toEqual(["Award", "Duration", "Mechanism", "Deadline", "Internal routing", "Letter of intent", "Submissions"]);
    expect(d.facts[1]).toEqual({ label: "Duration", value: "2 years", sub: null });
    expect(d.facts[2]).toEqual({ label: "Mechanism", value: "R03 grant", sub: "clinical trials optional" });
    expect(d.facts[5]).toEqual({ label: "Letter of intent", value: "Not required", sub: null });
    expect(d.facts[6]).toEqual({ label: "Submissions", value: "1 per institution", sub: "limited submission" });
    expect(d.priorities).toEqual(["substance use disorders", "chemical probe"]);
    expect(d.objectives.length).toBe(2);
    expect(d.objectiveQuote).toEqual({ text: "to enhance understanding of substance use trajectories", section: "Part 2 · Section I" });
    expect(d.notInScope[0]).toBe("Applications that do not involve substance use");
    expect(d.notInScope.some((x) => x.endsWith("excluded as a research approach"))).toBe(true);
    expect(d.notInScope.some((x) => x.endsWith("a prohibited design"))).toBe(true);
    expect(d.bestFit).toMatch(/^Work that is .*, using .*\.$/);
    expect(d.dealBreakers).toContain("Early-stage investigators only.");
    expect(d.dealBreakers).toContain("Human materials or participants are required.");
    expect(d.dealBreakers).toContain("Limited submission — UCSF may put forward 1 application.");
    expect(d.assemble.some((x) => x.startsWith("Multiple PDs/PIs are allowed"))).toBe(true);
    expect(d.assemble.some((x) => x.endsWith("— required."))).toBe(true);
    expect(d.why).toBe("1 strong match and 9 moderate matches in your directory clear the bar for this notice; 20 more people are exploratory leads. The engine compares research approach, unit of analysis, study design and topic against the notice's requirements; topic alone never qualifies a match.");
    expect(d.terms.map((t) => t.label)).toEqual(["Eligibility rules", "Objective"]);
    expect(d.terms[0]).toEqual({ label: "Eligibility rules", source: "Part 2 · Section III.1", value: "Any individual" });
    expect(d.provenance).toBe("Assessed from the notice on Sep 6");
  });

  it("no profile: the facts that come from the notice row survive, and the rest say so", () => {
    const d = noticeDetail({ profile: null, keyStats, activityCode: null, instrument: null, loiDue: "2026-10-01", loiNote: null, limited: false, cap: null, byTier: { strong: 0, moderate: 0, exploratory: 0 }, today: TODAY });
    expect(d.facts.map((f) => f.label)).toEqual(["Award", "Deadline", "Internal routing", "Letter of intent"]);
    expect(d.facts[3]).toEqual({ label: "Letter of intent", value: "Oct 1", sub: "due" });
    expect(d.objectives).toEqual([]);
    expect(d.bestFit).toBe("No fit profile has been built for this notice yet.");
    expect(d.dealBreakers).toEqual([]);
    expect(d.assemble).toEqual([]);
    expect(d.terms).toEqual([]);
    expect(d.provenance).toBeNull();
    expect(d.why.startsWith("No one in your directory clears the bar")).toBe(true);
  });

  it("term labels", () => {
    expect(termLabel("paradigm.excluded")).toBe("Research approach excluded");
    expect(termLabel("mechanism.ceiling_direct_per_year")).toBe("Award ceiling");
    expect(termLabel("something.new_field")).toBe("Something new field");
  });
});

describe("the assessment drawer's checks", () => {
  const audit = {
    scored: true,
    eligibility: [{ key: "esi", rule: "Early-stage investigators only", quote: { section: "Part 2 · Section III.1", quote: "ESI only" }, state: "fails" }],
    requirements: [
      { key: "human", rule: "Human subjects required", quote: null, state: "met" },
      { key: "design", rule: "A required design", quote: null, state: "unknown" },
    ],
  } as unknown as AuditContent;

  it("eligibility first, then requirements, with the marks", () => {
    const c = checksOf(audit, "strong");
    expect(c.assessed).toBe(true);
    expect(c.rows.map((r) => [r.mark, r.criterion])).toEqual([
      ["no", "Early-stage investigators only"],
      ["yes", "Human subjects required"],
      ["unknown", "A required design"],
    ]);
    expect(c.rows[0]!.note).toBe("Part 2 · Section III.1: “ESI only”");
    expect(c.rows[1]!.note).toBeNull();
  });

  it("never assessed: no audit, an unscored stub, or a Can't-assess label", () => {
    expect(checksOf(null, "strong")).toEqual({ assessed: false, rows: [] });
    expect(checksOf({ ...audit, scored: false }, "strong").assessed).toBe(false);
    expect(checksOf(audit, "cannot_assess").assessed).toBe(false);
  });
});
