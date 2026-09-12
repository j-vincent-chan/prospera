import {
  inferCollaborationComplexity,
  inferHumanSubjectsRelevance,
  inferMechanismType,
} from "./mechanism-heuristics";
import { resolveNihIcTokens, type NihIcResolutionInput, type NihIcSourceColumn } from "./nih-ic-resolution";

export type ClinicalTrialMode = "unknown" | "required" | "allowed" | "not_allowed";
export type RdAnnouncementClass = "unknown" | "parent_notice" | "targeted_rfa" | "nos" | "other";
export type RdResearchPathway =
  | "unknown"
  | "basic"
  | "translational"
  | "clinical"
  | "population"
  | "health_services"
  | "computational"
  | "mixed";

const ACTIVITY_TOKEN =
  /\b(R\d{2}[A-Z]?|K\d{2}[A-Z]?|P\d{2}[A-Z]?|F\d{2}[A-Z]?|T\d{2}[A-Z]?|U\d{2}[A-Z]?|X\d{2}[A-Z]?|DP\d|SBIR|STTR|SC\d+|RM\d+|TL\d+|UL\d+|G\d{2})\b/gi;

function familyFromActivityToken(raw: string): string | null {
  const t = raw.toUpperCase();
  if (t.includes("SBIR")) return "SBIR";
  if (t.includes("STTR")) return "STTR";
  if (t.startsWith("DP")) return "DP";
  if (t.startsWith("SC")) return "SC";
  if (t.startsWith("RM")) return "RM";
  if (t.startsWith("TL") || t.startsWith("UL")) return t.slice(0, 2);
  if (/^[RKFTPUXG]/.test(t)) return t[0] ?? null;
  return null;
}

function parseActivityFamilies(blob: string, opportunityNumber: string | null | undefined): string[] {
  const set = new Set<string>();
  const scan = `${opportunityNumber ?? ""}\n${blob}`;
  const re = new RegExp(ACTIVITY_TOKEN.source, ACTIVITY_TOKEN.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(scan)) !== null) {
    const fam = familyFromActivityToken(m[0]);
    if (fam) set.add(fam);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function inferClinicalTrialMode(blob: string): ClinicalTrialMode {
  const b = blob.toLowerCase();
  if (
    /clinical trial required|must conduct.{0,40}clinical trial|ct\s*required|interventional trial required/.test(
      b
    )
  ) {
    return "required";
  }
  if (
    /clinical trial.{0,30}not permitted|no clinical trial|clinical trials? not allowed|non-clinical only/.test(
      b
    )
  ) {
    return "not_allowed";
  }
  if (/clinical trial.{0,40}allowed|clinical trials? permitted|ct\s*allowed|may include a clinical trial/.test(b)) {
    return "allowed";
  }
  return "unknown";
}

function inferAnnouncementClass(oppNo: string | null | undefined): RdAnnouncementClass {
  const u = (oppNo ?? "").toUpperCase();
  if (/^NOT-|^NOT\s/i.test(oppNo ?? "")) return "nos";
  if (u.startsWith("RFA-") || u.includes("RFA-")) return "targeted_rfa";
  if (u.startsWith("PAR-") || u.startsWith("PA-")) return "parent_notice";
  if (u.length > 0) return "other";
  return "unknown";
}

function inferResearchPathway(blob: string): RdResearchPathway {
  const b = blob.toLowerCase();
  const scores: Record<Exclude<RdResearchPathway, "unknown" | "mixed">, number> = {
    basic: 0,
    translational: 0,
    clinical: 0,
    population: 0,
    health_services: 0,
    computational: 0,
  };
  if (/\bbasic science\b|\bfundamental research\b|\bmechanistic\b|\bmolecular\b|\bcellular\b/.test(b)) {
    scores.basic += 2;
  }
  if (/\btranslational\b|\bbench to bedside\b|\bT[0-4]\b/.test(b)) scores.translational += 2;
  if (/\bclinical trial\b|\binterventional\b|\bpatient cohort\b|\bpragmatic trial\b|\bphase\s*[I234]\b/.test(b)) {
    scores.clinical += 2;
  }
  if (/\bpopulation health\b|\bepidemiolog|\bobservational cohort\b|\bregistry study\b/.test(b)) {
    scores.population += 2;
  }
  if (/\bhealth services research\b|\bimplementation science\b|\bdelivery science\b|\bhealth policy\b/.test(b)) {
    scores.health_services += 2;
  }
  if (/\bmachine learning\b|\bai-?driven\b|\bcomputational biology\b|\bbioinformatics\b|\bdata science\b/.test(b)) {
    scores.computational += 2;
  }
  const entries = Object.entries(scores) as [keyof typeof scores, number][];
  entries.sort((a, b) => b[1] - a[1]);
  const top = entries[0];
  const second = entries[1];
  if (top[1] === 0) return "unknown";
  if (second[1] >= top[1] - 0.01 && second[1] > 0) return "mixed";
  return top[0] as RdResearchPathway;
}

function inferInvestigatorTags(blob: string): string[] {
  const b = blob.toLowerCase();
  const tags = new Set<string>();
  if (/\bearly[-\s]?stage investigator\b|\bESI\b/.test(b)) tags.add("early_stage_investigator");
  if (/\bnew investigator\b|\bfirst\s+R01\b|\bfirst-time applicant\b/.test(b)) tags.add("new_investigator");
  if (/\bestablished investigator\b|\bexperienced PD\/PI\b|\bsenior investigator\b/.test(b)) {
    tags.add("established_pi");
  }
  if (/\bcareer development\b|\bK awardee\b|\bmentored\b/.test(b)) tags.add("career_stage");
  return Array.from(tags).sort();
}

/**
 * Heuristic columns for academic medical center triage — not authoritative Grants.gov metadata.
 * Recomputed on each Simpler sync and when opportunity features are extracted.
 *
 * `nih_ic_tokens` is the one exception to "heuristic": it comes from the ranked
 * resolver in `nih-ic-resolution.ts`, and `nih_ic_source` / `nih_ic_reason` record
 * which option answered. Pass `guide_sections`, `agency_contact_description` and
 * `prior` (the stored answer) so a caller without the Guide cannot demote one.
 */
export function buildRdSignalColumns(input: {
  title: string;
  description: string;
  opportunity_number?: string | null;
  agency?: string | null;
  agency_code?: string | null;
} & Pick<NihIcResolutionInput, "guide_sections" | "agency_contact_description" | "prior">): {
  activity_families: string[];
  clinical_trial_mode: ClinicalTrialMode;
  nih_ic_tokens: string[];
  nih_ic_source: NihIcSourceColumn;
  nih_ic_reason: string;
  rd_announcement_class: RdAnnouncementClass;
  rd_research_pathway: RdResearchPathway;
  rd_investigator_tags: string[];
  rd_mechanism_type: ReturnType<typeof inferMechanismType>;
  rd_collaboration: ReturnType<typeof inferCollaborationComplexity>;
  rd_human_subjects: ReturnType<typeof inferHumanSubjectsRelevance>;
} {
  const blob = [input.title, input.description, input.agency, input.agency_code, input.opportunity_number]
    .filter(Boolean)
    .join("\n");
  const ic = resolveNihIcTokens({
    opportunity_number: input.opportunity_number,
    title: input.title,
    description: input.description,
    guide_sections: input.guide_sections,
    agency_contact_description: input.agency_contact_description,
    prior: input.prior,
  });

  return {
    activity_families: parseActivityFamilies(blob, input.opportunity_number),
    clinical_trial_mode: inferClinicalTrialMode(blob),
    nih_ic_tokens: ic.tokens,
    nih_ic_source: ic.source,
    nih_ic_reason: ic.reason,
    rd_announcement_class: inferAnnouncementClass(input.opportunity_number),
    rd_research_pathway: inferResearchPathway(blob),
    rd_investigator_tags: inferInvestigatorTags(blob),
    rd_mechanism_type: inferMechanismType(input.title, input.description),
    rd_collaboration: inferCollaborationComplexity(input.title, input.description),
    rd_human_subjects: inferHumanSubjectsRelevance(input.title, input.description),
  };
}
