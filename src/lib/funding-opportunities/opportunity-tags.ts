/**
 * Display tags for one notice — the "Opportunity profile" facets on the
 * opportunity page and the "Tags" row of the peek. Deterministic: the
 * controlled vocabulary (`normalize-text-to-tags`) over the notice text, plus
 * the NIH triage signals stored on the row. No model, no database.
 *
 * These tags describe the notice only. They rank nothing: the tag-overlap
 * engine that once scored investigators against them was retired in PR 2.3
 * (DECISIONS D8); "Best fit in your directory" reads `fit_results`
 * (`notice-fit.ts`).
 */
import type { ClinicalTrialMode, RdResearchPathway } from "@/lib/funding-opportunities/rd-signals";
import { coercePlainTextFromUnknown } from "@/lib/formatting/coerce-plain-text";
import { mergeTagBuckets, normalizeTextToTags, preprocessText, type TagBuckets } from "@/lib/normalization/normalize-text-to-tags";

/** Canonical ids (e.g. `tumor_immunology`) in the three display buckets. */
export type OpportunityTagBuckets = {
  research_focal_areas: string[];
  disease_areas: string[];
  technical_expertise: string[];
};

export type OpportunityTagSignals = {
  nih_ic_tokens?: string[] | null;
  rd_research_pathway?: RdResearchPathway | string | null;
  clinical_trial_mode?: ClinicalTrialMode | string | null;
  activity_families?: string[] | null;
  category?: string | null;
};

function uniqSorted(arr: string[]): string[] {
  return Array.from(new Set(arr)).sort();
}

const EMPTY_BUCKETS: TagBuckets = { science: [], disease: [], method: [], translational: [], fallbackText: "" };

function toBuckets(b: TagBuckets): OpportunityTagBuckets {
  return {
    research_focal_areas: uniqSorted([...b.science, ...b.translational]),
    disease_areas: uniqSorted(b.disease),
    technical_expertise: uniqSorted(b.method),
  };
}

/** Concatenate the notice's text sources and derive the display tags. */
export function extractOpportunityTags(input: {
  title: string;
  description?: string | null;
  agency?: string | null;
  agency_code?: string | null;
  opportunity_number?: string | null;
  category?: string | null;
  funding_instrument?: string | null;
  applicant_types?: unknown;
  raw_payload_json?: unknown;
}): OpportunityTagBuckets {
  const chunks: string[] = [input.title];
  if (input.opportunity_number) chunks.push(String(input.opportunity_number));
  if (input.description) chunks.push(String(input.description));
  if (input.agency) chunks.push(String(input.agency));
  if (input.agency_code) chunks.push(String(input.agency_code));
  if (input.category) chunks.push(String(input.category));
  if (input.funding_instrument) chunks.push(String(input.funding_instrument));
  const at = input.applicant_types;
  if (Array.isArray(at)) chunks.push(at.map((x) => String(x)).join(" "));
  else chunks.push(coercePlainTextFromUnknown(at));

  const raw = input.raw_payload_json;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    for (const key of ["summary", "eligibility", "agency_name", "opportunity_title", "funding_category", "fundingCategory", "category_description", "synopsis"]) {
      const v = o[key];
      if (typeof v === "string" && v.trim()) chunks.push(v);
      else if (v && typeof v === "object") chunks.push(JSON.stringify(v).slice(0, 4000));
    }
  }

  let acc = EMPTY_BUCKETS;
  for (const chunk of chunks) {
    if (!preprocessText(chunk)) continue;
    acc = mergeTagBuckets(acc, normalizeTextToTags(chunk));
  }
  return toBuckets(acc);
}

const NIH_IC_SCIENCE: Record<string, string[]> = {
  NCI: ["tumor_immunology"],
  NHLBI: ["cardiovascular_biology"],
  NIAID: ["immunology"],
  NINDS: ["neuroscience"],
  NIDDK: ["metabolic_disease"],
  NICHD: ["pediatric_research"],
  NIMH: ["mental_health_research"],
  NIA: ["aging_research"],
  NEI: ["biomedical_imaging"],
  NIEHS: ["environmental_health"],
  NHGRI: ["genetics_genomics"],
  NIBIB: ["biomedical_imaging"],
  NCATS: ["translational_research"],
  NIAMS: ["musculoskeletal_research"],
};

const NIH_IC_DISEASE: Record<string, string[]> = {
  NCI: ["solid_tumor"],
  NHLBI: ["cardiovascular_disease", "lung_disease"],
  NIAID: ["infectious_disease", "inflammatory_disease"],
  NINDS: ["neurodegenerative_disease", "stroke"],
  NIDDK: ["diabetes", "kidney_disease", "liver_disease", "obesity"],
  NICHD: ["rare_disease"],
};

const PATHWAY_SCIENCE: Record<string, string[]> = {
  basic: ["basic_research"],
  translational: ["translational_research"],
  clinical: ["clinical_research"],
  population: ["population_health"],
  health_services: ["health_services_research"],
  computational: ["computational_biology", "genetics_genomics"],
  mixed: ["translational_research"],
};

const PATHWAY_METHOD: Record<string, string[]> = {
  clinical: ["clinical_trials_methods"],
  population: ["epidemiology", "cohort_studies"],
  health_services: ["implementation_science", "health_outcomes_research"],
  computational: ["bioinformatics", "machine_learning"],
};

const CATEGORY_SCIENCE: Record<string, string[]> = {
  health: ["clinical_research"],
  education: ["health_services_research"],
  environment: ["environmental_health"],
  science: ["basic_research"],
  energy: ["basic_research"],
};

const ACTIVITY_SCIENCE: Record<string, string[]> = { K: ["career_development"], F: ["basic_research"], T: ["translational_research"] };
const ACTIVITY_METHOD: Record<string, string[]> = { U: ["consortium_coordination"], P: ["consortium_coordination"] };

/** Add the tags the stored NIH triage signals and metadata imply. */
export function enrichOpportunityTags(base: OpportunityTagBuckets, signals: OpportunityTagSignals): OpportunityTagBuckets {
  const science = new Set(base.research_focal_areas);
  const disease = new Set(base.disease_areas);
  const method = new Set(base.technical_expertise);

  for (const ic of signals.nih_ic_tokens ?? []) {
    for (const tag of NIH_IC_SCIENCE[ic] ?? []) science.add(tag);
    for (const tag of NIH_IC_DISEASE[ic] ?? []) disease.add(tag);
  }

  const pathway = signals.rd_research_pathway;
  const trialMode = signals.clinical_trial_mode;
  if (pathway && pathway !== "unknown") {
    for (const tag of PATHWAY_SCIENCE[pathway] ?? []) science.add(tag);
    for (const tag of PATHWAY_METHOD[pathway] ?? []) {
      if (tag === "clinical_trials_methods" && trialMode === "not_allowed") continue;
      method.add(tag);
    }
  }

  if (trialMode === "required" || trialMode === "allowed") {
    method.add("clinical_trials_methods");
    science.add("clinical_research");
  }

  const categoryKey = (signals.category ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  if (categoryKey) for (const tag of CATEGORY_SCIENCE[categoryKey] ?? []) science.add(tag);

  for (const family of signals.activity_families ?? []) {
    const key = family.toUpperCase();
    for (const tag of ACTIVITY_SCIENCE[key] ?? []) science.add(tag);
    for (const tag of ACTIVITY_METHOD[key] ?? []) method.add(tag);
  }

  return {
    research_focal_areas: uniqSorted(Array.from(science)),
    disease_areas: uniqSorted(Array.from(disease)),
    technical_expertise: uniqSorted(Array.from(method)),
  };
}

/** Text-derived tags plus the NIH triage signals stored on the notice row. */
export function buildOpportunityTags(input: Parameters<typeof extractOpportunityTags>[0], signals: OpportunityTagSignals): OpportunityTagBuckets {
  return enrichOpportunityTags(extractOpportunityTags(input), signals);
}
