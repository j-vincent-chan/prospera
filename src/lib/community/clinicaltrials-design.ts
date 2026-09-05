/**
 * Pure parser over one ClinicalTrials.gov API v2 study record (PR 0.3).
 *
 * Captures the design fields the ingest used to leave inside raw_json —
 * study type, phases, primary purpose, allocation, intervention and
 * observational models, time perspective, enrollment, intervention types —
 * and the role the investigator holds on the study. No network, no Supabase:
 * the ingest and the raw_json backfill both call this on records they
 * already hold. The values feed the ctgov rules in
 * src/lib/fit/signal-mapping.json (study_type, primary_purpose,
 * observational_model, enrollment_min, intervention_types_any,
 * investigator_role_any), so enums are stored the way CT.gov spells them.
 */
import type { ClinicalTrialsStudyRecord } from "@/lib/community/clinicaltrials-api-client";

/**
 * investigator_clinical_trials.investigator_role, in precedence order: when
 * the record names this person in more than one place, the earliest entry
 * wins. The first three are overallOfficials[].role; RESPONSIBLE_PARTY_PI is
 * responsibleParty (type PRINCIPAL_INVESTIGATOR or SPONSOR_INVESTIGATOR)
 * naming this person as investigatorFullName. LISTED: the record names
 * officials or a responsible-party investigator and this person is not among
 * them in a recognised role — the study came back from the name search,
 * nothing more. UNKNOWN: nothing to match against (no protocolSection, no
 * officials and no responsible-party investigator, or no name to look for).
 */
export const CLINICAL_TRIAL_INVESTIGATOR_ROLES = [
  "PRINCIPAL_INVESTIGATOR",
  "STUDY_CHAIR",
  "STUDY_DIRECTOR",
  "RESPONSIBLE_PARTY_PI",
  "LISTED",
  "UNKNOWN",
] as const;
export type ClinicalTrialInvestigatorRole = (typeof CLINICAL_TRIAL_INVESTIGATOR_ROLES)[number];

/** overallOfficials[].role values CT.gov emits. Anything else on a matched official counts as LISTED. */
const OFFICIAL_ROLES: ReadonlySet<string> = new Set(["PRINCIPAL_INVESTIGATOR", "STUDY_CHAIR", "STUDY_DIRECTOR"]);
/** responsibleParty.type values that carry an investigatorFullName. */
const RESPONSIBLE_PARTY_INVESTIGATOR_TYPES: ReadonlySet<string> = new Set(["PRINCIPAL_INVESTIGATOR", "SPONSOR_INVESTIGATOR"]);

export type ClinicalTrialDesign = {
  studyType: string | null;
  /** As CT.gov lists them (EARLY_PHASE1 … PHASE4). ["NA"] for interventional studies outside the drug-phase ladder; [] when the record has none (observational). */
  phases: string[];
  primaryPurpose: string | null;
  allocation: string | null;
  interventionModel: string | null;
  observationalModel: string | null;
  timePerspective: string | null;
  enrollment: number | null;
  /** armsInterventionsModule.interventions[].type, deduplicated in record order. */
  interventionTypes: string[];
  investigatorRole: ClinicalTrialInvestigatorRole;
};

// ---------------------------------------------------------------------------
// Enums and names
// ---------------------------------------------------------------------------

/**
 * API v2 enums arrive UPPER_SNAKE (INTERVENTIONAL, PHASE2, NA, RANDOMIZED,
 * SINGLE_GROUP, COHORT); this only folds case and separators and turns "N/A"
 * into NA, so a hand-edited value lands on the same spelling. Classic-API
 * labels ("Parallel Assignment") are not remapped — every stored row came
 * from v2.
 */
export function normalizeCtgovEnum(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const folded = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (!folded) return null;
  return folded === "N/A" ? "NA" : folded;
}

function normalizePersonName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The ingest's official-name test, shared with the role parser: equal after
 * case and whitespace folding, or one contains the other ("Wilson Liao, MD"
 * ↔ "Wilson Liao"). A middle initial on one side only ("Susan M. Chang, MD"
 * vs "Susan Chang") does not match — the limit the ingest filter has today.
 */
export function personNameMatches(candidate: string | null | undefined, investigatorName: string): boolean {
  const target = normalizePersonName(investigatorName);
  const name = normalizePersonName(candidate ?? "");
  if (!target || !name) return false;
  return name === target || name.includes(target) || target.includes(name);
}

// ---------------------------------------------------------------------------
// Design
// ---------------------------------------------------------------------------

function enumList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const value of values) {
    const v = normalizeCtgovEnum(value);
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/** enrollmentInfo.count — a non-negative integer; anything else is null. */
function parseEnrollment(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * ["NA"] is CT.gov's phase for interventional studies outside the drug ladder
 * (behavioral, device, procedure, supportive care) and is stored as such; this
 * says whether the phases carry any design information at all — false for []
 * and ["NA"] — so a classifier reads allocation and interventionModel instead
 * of the phase for those.
 */
export function phasesAreInformative(phases: string[]): boolean {
  return phases.some((phase) => phase !== "NA");
}

export function parseInvestigatorRole(
  study: ClinicalTrialsStudyRecord,
  investigatorName: string
): ClinicalTrialInvestigatorRole {
  const section = study.protocolSection;
  const officials = (section?.contactsLocationsModule?.overallOfficials ?? []).filter((official) => official?.name?.trim());
  const party = section?.sponsorCollaboratorsModule?.responsibleParty;
  const partyType = normalizeCtgovEnum(party?.type);
  const partyInvestigator =
    partyType && RESPONSIBLE_PARTY_INVESTIGATOR_TYPES.has(partyType) ? (party?.investigatorFullName ?? "").trim() : "";
  if (!section || !investigatorName.trim() || (!officials.length && !partyInvestigator)) return "UNKNOWN";

  const found = new Set<ClinicalTrialInvestigatorRole>();
  for (const official of officials) {
    if (!personNameMatches(official.name, investigatorName)) continue;
    const role = normalizeCtgovEnum(official.role);
    found.add(role && OFFICIAL_ROLES.has(role) ? (role as ClinicalTrialInvestigatorRole) : "LISTED");
  }
  if (partyInvestigator && personNameMatches(partyInvestigator, investigatorName)) found.add("RESPONSIBLE_PARTY_PI");
  return CLINICAL_TRIAL_INVESTIGATOR_ROLES.find((role) => found.has(role)) ?? "LISTED";
}

export function parseDesign(study: ClinicalTrialsStudyRecord, investigatorName: string): ClinicalTrialDesign {
  const design = study.protocolSection?.designModule;
  const info = design?.designInfo;
  const interventions = study.protocolSection?.armsInterventionsModule?.interventions ?? [];
  return {
    studyType: normalizeCtgovEnum(design?.studyType),
    phases: enumList(design?.phases),
    primaryPurpose: normalizeCtgovEnum(info?.primaryPurpose),
    allocation: normalizeCtgovEnum(info?.allocation),
    interventionModel: normalizeCtgovEnum(info?.interventionModel),
    observationalModel: normalizeCtgovEnum(info?.observationalModel),
    timePerspective: normalizeCtgovEnum(info?.timePerspective),
    enrollment: parseEnrollment(design?.enrollmentInfo?.count),
    interventionTypes: enumList(interventions.map((intervention) => intervention?.type)),
    investigatorRole: parseInvestigatorRole(study, investigatorName),
  };
}

// ---------------------------------------------------------------------------
// What the ingest and the backfill store
// ---------------------------------------------------------------------------

/** The PR 0.3 columns on investigator_clinical_trials, as written on upsert. */
export type ClinicalTrialDesignFields = {
  study_type: string | null;
  phases: string[];
  primary_purpose: string | null;
  allocation: string | null;
  intervention_model: string | null;
  observational_model: string | null;
  time_perspective: string | null;
  enrollment: number | null;
  intervention_types: string[];
  investigator_role: ClinicalTrialInvestigatorRole;
  design_parsed_at: string;
};

export function designCaptureFields(design: ClinicalTrialDesign, parsedAt: string): ClinicalTrialDesignFields {
  return {
    study_type: design.studyType,
    phases: design.phases,
    primary_purpose: design.primaryPurpose,
    allocation: design.allocation,
    intervention_model: design.interventionModel,
    observational_model: design.observationalModel,
    time_perspective: design.timePerspective,
    enrollment: design.enrollment,
    intervention_types: design.interventionTypes,
    investigator_role: design.investigatorRole,
    design_parsed_at: parsedAt,
  };
}

// ---------------------------------------------------------------------------
// What the backfill reports
// ---------------------------------------------------------------------------

export function hasProtocolSection(study: ClinicalTrialsStudyRecord): boolean {
  return Boolean(study.protocolSection && typeof study.protocolSection === "object");
}

export type DesignCoverage = {
  rows: number;
  withProtocolSection: number;
  /** Among rows with a protocolSection — the PR 0.3 acceptance share (≥ 95 %). */
  withStudyType: number;
  roles: Record<ClinicalTrialInvestigatorRole, number>;
};

export function designCoverage(items: Array<{ study: ClinicalTrialsStudyRecord; design: ClinicalTrialDesign }>): DesignCoverage {
  const roles = Object.fromEntries(CLINICAL_TRIAL_INVESTIGATOR_ROLES.map((role) => [role, 0])) as Record<
    ClinicalTrialInvestigatorRole,
    number
  >;
  let withProtocolSection = 0;
  let withStudyType = 0;
  for (const { study, design } of items) {
    roles[design.investigatorRole] += 1;
    if (!hasProtocolSection(study)) continue;
    withProtocolSection += 1;
    if (design.studyType) withStudyType += 1;
  }
  return { rows: items.length, withProtocolSection, withStudyType, roles };
}

function percent(n: number, of: number): string {
  return of ? `${Math.round((1000 * n) / of) / 10}%` : "n/a";
}

export function formatDesignCoverage(coverage: DesignCoverage): string {
  const roles =
    CLINICAL_TRIAL_INVESTIGATOR_ROLES.filter((role) => coverage.roles[role] > 0)
      .map((role) => `${role} ${coverage.roles[role]}`)
      .join(", ") || "none";
  return (
    `${coverage.rows} rows; ${coverage.withProtocolSection} with a protocolSection (${percent(coverage.withProtocolSection, coverage.rows)}); ` +
    `study_type filled on ${coverage.withStudyType} of ${coverage.withProtocolSection} with a protocolSection (${percent(coverage.withStudyType, coverage.withProtocolSection)}); ` +
    `roles — ${roles}`
  );
}

/** One row of --dry-run output: the NCT id, who the row belongs to, and every column as it would be stored. */
export function formatDesignDryRunRow(
  nctId: string,
  investigator: string,
  study: ClinicalTrialsStudyRecord,
  fields: ClinicalTrialDesignFields
): string {
  const show = (value: string | number | null) => (value == null ? "—" : String(value));
  const list = (values: string[]) => `[${values.join(", ")}]`;
  return (
    `${nctId}  ${investigator}  protocolSection: ${hasProtocolSection(study) ? "yes" : "no"}\n` +
    `  study_type ${show(fields.study_type)} · phases ${list(fields.phases)} · primary_purpose ${show(fields.primary_purpose)} · ` +
    `allocation ${show(fields.allocation)} · intervention_model ${show(fields.intervention_model)} · ` +
    `observational_model ${show(fields.observational_model)} · time_perspective ${show(fields.time_perspective)} · ` +
    `enrollment ${show(fields.enrollment)} · intervention_types ${list(fields.intervention_types)} · investigator_role ${fields.investigator_role}`
  );
}
