/**
 * Shared fixtures for the judge tests: a lupus trialist (spec §13 case 5),
 * the SLE Clinical Trial Required notice, four evidence items, the notice's
 * Guide sections, and a model stub that answers by purpose and records what
 * it was asked. Nothing here touches the network or the database.
 */
import { scorePair } from "@/lib/fit/engine";
import { hydrateContext, hydrateInvestigator, hydrateOpportunity } from "@/lib/fit/engine/fixtures";
import type { JudgeModelFn, JudgeModelRequest, JudgePurpose } from "@/lib/fit/judge/model";
import type { BlindResult, BlindVariantResult, JudgeEvidenceItem, JudgeInputs, ReconcilerOutput, SkepticResult } from "@/lib/fit/judge/types";
import type { NoticeSection } from "@/lib/fit/profile/opportunity-extract";
import type { FitResult, InvestigatorFitProfile, OpportunityFitProfile, Tier } from "@/lib/fit/types";

export const TRIALIST: InvestigatorFitProfile = hydrateInvestigator("inv-lupus", {
  paradigm: { recent: { clinical_trials: 0.81, clinical_observational: 0.55, translational: 0.29 }, career: { clinical_trials: 0.7, clinical_observational: 0.6, translational: 0.3 } },
  unit: { L3: 0.9, L4: 0.4 },
  design: { rct: 0.7, prospective_cohort: 0.4, biospecimen_assay: 0.3 },
  materials: { enrolled_participants: 0.9, human_blood_fluids: 0.5 },
  objective: { treatment_evaluation_efficacy: 0.85, biomarker_discovery_validation: 0.4 },
  topic: { mesh_major: ["C20.111.590", "C17.300.480"], rcdc: ["Lupus", "Autoimmune Disease"] },
  characteristics: { career_stage: "mid", esi: false, mechanisms_held: ["K23", "R01", "U01"], active_awards: 2, trial_pi_count: 4, degrees: ["MD"], title_series: "Associate Professor", clinical_role: "md_clinician_investigator", runway_weeks: 11 },
  confidence: { paradigm: "high", unit: "high", design: "high", topic: "high", materials: "high", objective: "high" },
  collaborators: [{ id: "collab-1", name: "R. Immunologist", dominant_family: "discovery", categories: ["molecular_cellular_mechanistic"] }],
});

export const SLE_TRIAL: OpportunityFitProfile = hydrateOpportunity("opp-sle", {
  mechanism: { activity_code: "R01", clinical_trial: "required", issuing_ic: "NIAMS" },
  paradigm: { required: { clinical_trials: 1 }, allowed: { translational: 0.5, human_biospecimen: 0.4 }, excluded: { animal_model: 0.9 } },
  unit: { required: ["L3"] },
  design: { required_any: ["rct", "early_phase_trial"], allowed: ["biospecimen_assay"], prohibited: ["animal_in_vivo"] },
  materials: { expected: ["enrolled_participants", "human_blood_fluids"], human_required: true },
  objective: { treatment_evaluation_efficacy: 0.9 },
  topic: { mesh: ["C20.111.590", "C17.300.480"], terms: ["systemic lupus erythematosus", "interferon signature", "targeted agents"], free_text: "Phase II trials of targeted agents in SLE." },
  eligibility: { investigator_rules: ["Multiple PDs/PIs are not allowed."] },
  confidence: "high",
});

export const SECTIONS: NoticeSection[] = [
  { part: 1, section: "overview", heading: "Funding Opportunity Purpose", text: "This NOFO supports phase II mechanistic or efficacy clinical trials of targeted agents in systemic lupus erythematosus (SLE). Biomarker-guided designs are encouraged." },
  { part: 2, section: "I", heading: "Research Objectives", text: "Applications must propose a clinical trial in participants with SLE. Mechanistic studies in human tissue collected during the trial are welcome as correlative aims." },
  { part: 2, section: "I", heading: "Applications Not Responsive to this NOFO", text: "Applications proposing animal studies only, or observational studies without an intervention, will be considered non-responsive and will not be reviewed." },
  { part: 2, section: "I", heading: "Team and Collaborations", text: "Applicants are encouraged to pair a trialist with a basic immunologist." },
  { part: 2, section: "II", heading: "Clinical Trial?", text: "Required: Only accepting applications that propose clinical trial(s)." },
  { part: 2, section: "III.3", heading: "Additional Information on Eligibility", text: "Multiple PDs/PIs are not allowed. The PD/PI must hold an independent research appointment." },
];

export const EVIDENCE: JudgeEvidenceItem[] = [
  { id: "PMID:31000001", ref: "publication:inv-lupus:31000001", kind: "publication", year: 2024, role: "first_last_corresponding", title: "A randomized phase II trial of anifrolumab in active systemic lupus erythematosus", text: "We randomized 120 participants with active SLE to anifrolumab or placebo. The interferon signature predicted response.", mesh_names: ["Lupus Erythematosus, Systemic", "Randomized Controlled Trials as Topic", "Humans"], topic_terms: ["systemic lupus erythematosus", "anifrolumab", "interferon signature"], weight: 1, similarity: 0.7 },
  { id: "NCT04000001", ref: "trial:inv-lupus:NCT04000001", kind: "trial", year: 2023, role: "trial_pi", title: "Targeted B-cell therapy in lupus nephritis", text: "Interventional, randomized, phase II. Principal investigator. 80 participants with lupus nephritis.", mesh_names: [], topic_terms: ["lupus nephritis", "B-cell therapy"], weight: 0.9, similarity: null },
  { id: "5R01AR070001", ref: "grant:g1", kind: "grant", year: 2022, role: "contact_pi", title: "Biomarker-guided trials in SLE", text: "This R01 runs a multi-site interferon-signature-guided trial in SLE with correlative immune profiling.", mesh_names: [], topic_terms: ["systemic lupus erythematosus", "interferon signature"], weight: 0.8, similarity: 0.65 },
  { id: "biosketch:statement", ref: "biosketch:inv-lupus:statement", kind: "biosketch_statement", year: null, role: null, title: "Personal statement", text: "I am a rheumatologist who has led four interventional SLE trials as principal investigator.", mesh_names: [], topic_terms: ["systemic lupus erythematosus"], weight: 0.9, similarity: 0.5 },
];

export const EVIDENCE_IDS = EVIDENCE.map((e) => e.id);

export function judgeInputs(over: Partial<JudgeInputs> = {}): JudgeInputs {
  return {
    evidence: EVIDENCE,
    collaborators: [{ name_or_id: "R. Immunologist", one_line_summary: "discovery (molecular cellular mechanistic)" }],
    notice: {
      opportunity_id: "opp-sle",
      number: "RFA-AR-27-001",
      title: "Novel Therapeutics in Systemic Lupus (R01 Clinical Trial Required)",
      activity_code: "R01",
      clinical_trial_designation: "required",
      section_I_text: "## Part 1 · Overview · Funding Opportunity Purpose\nThis NOFO supports phase II mechanistic or efficacy clinical trials of targeted agents in systemic lupus erythematosus (SLE). Biomarker-guided designs are encouraged.\n\n## Part 2 · Section I · Research Objectives\nApplications must propose a clinical trial in participants with SLE. Mechanistic studies in human tissue collected during the trial are welcome as correlative aims.",
      non_responsive_text: "## Part 2 · Section I · Applications Not Responsive to this NOFO\nApplications proposing animal studies only, or observational studies without an intervention, will be considered non-responsive and will not be reviewed.",
      eligibility_text: "## Part 2 · Section III.3 · Additional Information on Eligibility\nMultiple PDs/PIs are not allowed. The PD/PI must hold an independent research appointment.",
      team_text: "## Part 2 · Section I · Team and Collaborations\nApplicants are encouraged to pair a trialist with a basic immunologist.",
      topic_terms: ["systemic lupus erythematosus", "interferon signature", "targeted agents"],
      mesh_names: ["Lupus Erythematosus, Systemic"],
      rcdc: ["Lupus"],
      sections: SECTIONS,
    },
    characteristics: TRIALIST.characteristics,
    ...over,
  };
}

/** The engine's result for the trialist against the SLE trial with the topic score supplied (Strong under the fixture's numbers). */
export function scored(inv: InvestigatorFitProfile = TRIALIST, opp: OpportunityFitProfile = SLE_TRIAL, topic = 0.85): FitResult {
  return scorePair(inv, opp, hydrateContext({ paradigm: { recent: {} }, characteristics: { runway_weeks: 11 } }, {}, topic));
}

/** A result at a given tier for the reconciliation tests: the real result with the tier, caps and components overridden. */
export function fitAt(tier: Tier, over: Partial<Pick<FitResult, "caps" | "score" | "rationale" | "why_not" | "gap">> & { components?: Partial<FitResult["components"]> } = {}): FitResult {
  const base = scored();
  return { ...base, tier, caps: over.caps ?? [], score: over.score ?? base.score, rationale: over.rationale ?? base.rationale, why_not: over.why_not ?? (tier === "poor" ? "Why not text." : null), gap: over.gap ?? (tier === "exploratory" ? "Gap text." : null), components: { ...base.components, ...(over.components ?? {}) } };
}

// ---------------------------------------------------------------------------
// Pass outputs
// ---------------------------------------------------------------------------

export const CALL_A_OK = {
  investigator_paradigm: { dominant: ["clinical trials"], secondary: ["clinical observational"], evidence_ids: ["PMID:31000001", "NCT04000001"], note: "Leads randomized trials." },
  notice_paradigm: { required: ["clinical trials"], allowed: ["translational human biology"], excluded: ["preclinical/animal"], note: "Clinical Trial Required." },
  paradigm_fit: "strong",
  unit_fit: "match",
  design: { notice_requires: ["trials"], investigator_has_led: ["rct"], investigator_has_contributed: ["prospective cohort"], unmet_required: [], evidence_ids: ["NCT04000001", "PMID:31000001"] },
  materials: { notice_expects: ["enrolled participants"], investigator_has: ["enrolled participants", "blood"], gap: null },
};

export function callB(verdict: Tier, over: Record<string, unknown> = {}) {
  return {
    structural_revision: null,
    topic_fit: "strong",
    topic_note: "Same disease and the same biomarker.",
    topic_evidence_ids: ["PMID:31000001", "5R01AR070001"],
    eligibility_concerns: [],
    verdict,
    biggest_gap: "None of note.",
    what_would_make_it_strong: null,
    collaborator_suggestion: null,
    counter_case: "One could argue the trials were small. They were still led as PI.",
    counter_case_is_gate_level: false,
    rationale: "Four trials as PI (NCT04000001) and an RCT publication (PMID:31000001) show trial leadership in SLE.",
    ...over,
  };
}

export const SKEPTIC_NONE = { objection: null, objection_kind: null, gate_level: false, evidence_ids: [], confidence: "high", what_would_resolve_it: null };

export function skepticReply(kind: string, over: Record<string, unknown> = {}) {
  return { objection: `A ${kind} problem.`, objection_kind: kind, gate_level: true, evidence_ids: ["PMID:31000001"], confidence: "medium", what_would_resolve_it: "Evidence to the contrary.", ...over };
}

export function reconcilerReply(over: Record<string, unknown> = {}) {
  return { agreement: "agree", disagreement_explanation: null, corrections: [], inexpressible_insight: null, rationale: "Trial leadership shown by NCT04000001 and PMID:31000001 matches the Clinical Trial Required notice.", why_not: null, ...over };
}

/** A blind result at `verdict` with both variants usable and grounded (unless overridden). */
export function blindAt(verdict: Tier | null, over: Partial<BlindResult> & { variants_at?: Array<Tier | null> } = {}): BlindResult {
  const at = over.variants_at ?? [verdict, verdict];
  const variants: BlindVariantResult[] = at.map((v, i) => ({ variant: (i + 1) as 1 | 2, a: null, b: null, verdict_raw: v, verdict: v, grounded: v !== null, lowered: [], usable: v !== null, dropped: [], calls: v !== null ? 2 : 0 }));
  const { variants_at: _v, ...rest } = over;
  void _v;
  return { variants, verdict, self_consistent: true, scout: false, latent_fit: null, evidence_ids: EVIDENCE_IDS, calls: variants.reduce((s, v) => s + v.calls, 0), ...rest };
}

export function skepticAt(kind: SkepticResult["objection_kind"], over: Partial<SkepticResult> = {}): SkepticResult {
  const gate = kind === "eligibility" || kind === "paradigm" || kind === "design" || kind === "unit_materials";
  return { objection: kind ? `A ${kind} problem.` : null, objection_kind: kind, gate_level: gate, evidence_ids: kind ? ["PMID:31000001"] : [], confidence: "medium", what_would_resolve_it: null, grounded: kind !== null, usable: true, dropped: [], calls: 1, ...over };
}

export function reconcilerAt(over: Partial<ReconcilerOutput> = {}): ReconcilerOutput {
  return { agreement: "agree", disagreement_explanation: null, corrections: [], inexpressible_insight: null, rationale: "Reconciler rationale citing NCT04000001.", why_not: null, usable: true, dropped: [], calls: 1, ...over };
}

// ---------------------------------------------------------------------------
// Model stub
// ---------------------------------------------------------------------------

export type Replies = Partial<Record<JudgePurpose, unknown | ((req: JudgeModelRequest) => unknown)>>;

/** Answers by purpose (an object is serialized; a string is returned as is; a function is called with the request); records every request. */
export function stubModel(replies: Replies): { fn: JudgeModelFn; calls: JudgeModelRequest[] } {
  const calls: JudgeModelRequest[] = [];
  const fn: JudgeModelFn = async (req) => {
    calls.push(req);
    const r = replies[req.purpose];
    const v = typeof r === "function" ? (r as (req: JudgeModelRequest) => unknown)(req) : r;
    if (v === undefined) return "{}";
    return typeof v === "string" ? v : JSON.stringify(v);
  };
  return { fn, calls };
}
