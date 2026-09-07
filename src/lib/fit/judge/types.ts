/**
 * Stage-8 shapes (plan § PR 3.1; spec §7 stage 8, §16). The three passes —
 * blind (`blind.ts`), skeptic (`skeptic.ts`), reconciler (`reconcile.ts`) —
 * read `JudgeInputs` (`inputs.ts`), return the validated outputs below, and
 * the pure reconciliation table turns them into a `Reconciliation`. What the
 * database keeps: `fit_adjudications` holds the full validated outputs
 * (`StoredAdjudication`), `fit_results.adjudication` the compact
 * `Adjudication` the surfaces read (PR 3.2) and the review queue filters
 * (PR 3.3 — `reconciliation.review.kind`, `fit_corrections.status`).
 */
import type { NoticeSection } from "@/lib/fit/profile/opportunity-extract";
import type { CapId, Correction, CorrectionStatus, InvestigatorCharacteristics, ItemKind, Stage8CapId, Tier } from "@/lib/fit/types";

/** Bumped when a prompt, a validation rule or the reconciliation table changes; part of `profile_versions`, so a bump re-judges every pair. */
export const JUDGE_VERSION = "judge-1";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** One evidence item as the judge sees it (blind-pass.md › Inputs). `id` is the short stable id the model cites; `ref` the internal item id the rest of the system uses. */
export type JudgeEvidenceItem = {
  /** PMID:<n>, <NCT id>, <project number>, biosketch:statement, biosketch:contribution:<n>, profiles:narrative, self_declared. */
  id: string;
  /** `ItemProfile.id` (publication:<inv>:<pmid>, grant:<row id>, …). */
  ref: string;
  kind: ItemKind;
  year: number | null;
  /** Evidence-role id (taxonomy `aggregation.role`), or null. */
  role: string | null;
  title: string | null;
  /** ≤ `EVIDENCE_TEXT_MAX` chars. */
  text: string;
  /** MeSH descriptor names on the item (publications), for masking. */
  mesh_names: string[];
  /** The classifier's specific terms, for masking. */
  topic_terms: string[];
  /** w_item = reliability × role × recency (aggregate.ts). */
  weight: number;
  /** Cosine of the item's embedding against the notice's; null when either side has none. */
  similarity: number | null;
};

export type JudgeCollaborator = { name_or_id: string; one_line_summary: string };

/** The notice as the judge sees it (blind-pass.md › Inputs `notice`), plus what masking and quote verification need. */
export type JudgeNotice = {
  opportunity_id: string;
  number: string;
  title: string;
  activity_code: string | null;
  clinical_trial_designation: string;
  /** Part 1 Purpose + Section I minus the non-responsive sub-sections, ≤ `SECTION_I_MAX` chars. */
  section_I_text: string;
  non_responsive_text: string;
  /** Section III.3. */
  eligibility_text: string;
  team_text: string;
  /** The extractor's distinguishing terms (`topic.terms`), for masking. */
  topic_terms: string[];
  /** Descriptor names of the notice's mapped MeSH codes, for masking. */
  mesh_names: string[];
  rcdc: string[];
  /** The sections the texts were cut from — the reconciler's quotes verify against these. */
  sections: NoticeSection[];
};

export type JudgeInputs = {
  evidence: JudgeEvidenceItem[];
  collaborators: JudgeCollaborator[];
  notice: JudgeNotice;
  /** Facts for the skeptic's INVESTIGATOR CHARACTERISTICS line — no scores. */
  characteristics: InvestigatorCharacteristics;
};

/** The cache key of an adjudication (`fit_adjudications.profile_versions`). */
export type ProfileVersions = {
  /** Content hash of the stored investigator profile (computed_at excluded). */
  investigator: string;
  /** Content hash of the stored notice profile (computed_at excluded). */
  opportunity: string;
  taxonomy: string;
  judge: string;
};

// ---------------------------------------------------------------------------
// Blind pass
// ---------------------------------------------------------------------------

export type BlindVariant = 1 | 2;
export type ParadigmFit = "strong" | "adjacent" | "weak" | "incompatible";
export type UnitFit = "match" | "adjacent" | "mismatch";
export type TopicFit = "strong" | "moderate" | "weak";
export type LatentFitShape = "methodological_transfer" | "asset_ownership" | "trajectory" | "mechanistic_adjacency" | "team_shape" | "constraint_in_prose";

/** Call A (masked): the structural fields. */
export type BlindCallA = {
  investigator_paradigm: { dominant: string[]; secondary: string[]; evidence_ids: string[]; note: string };
  notice_paradigm: { required: string[]; allowed: string[]; excluded: string[]; note: string };
  paradigm_fit: ParadigmFit | null;
  unit_fit: UnitFit | null;
  design: { notice_requires: string[]; investigator_has_led: string[]; investigator_has_contributed: string[]; unmet_required: string[]; evidence_ids: string[] };
  materials: { notice_expects: string[]; investigator_has: string[]; gap: string | null };
};

export type StructuralRevision = { field: string; from: unknown; to: unknown; why: string };

export type LatentFit = { found: boolean; shape: LatentFitShape | null; explanation: string; evidence_ids: string[] };

/** Call B (unmasked): topic, verdict, gap, counter-case; `latent_fit` for the scout variant. */
export type BlindCallB = {
  structural_revision: StructuralRevision | null;
  topic_fit: TopicFit | null;
  topic_note: string;
  topic_evidence_ids: string[];
  eligibility_concerns: string[];
  verdict: Tier;
  biggest_gap: string;
  what_would_make_it_strong: string | null;
  collaborator_suggestion: string | null;
  counter_case: string;
  counter_case_is_gate_level: boolean;
  rationale: string;
  latent_fit: LatentFit | null;
};

export type BlindVariantResult = {
  variant: BlindVariant;
  a: BlindCallA | null;
  b: BlindCallB | null;
  /** The verdict as the model gave it. */
  verdict_raw: Tier | null;
  /** After the post-rules (counter-case, contradiction with its own structural fields) and the grounding rule; null = absent. */
  verdict: Tier | null;
  /** At least one cited id across Call A and Call B exists in the evidence (spec §16 guardrail 2). */
  grounded: boolean;
  /** Why the verdict was lowered or voided. */
  lowered: string[];
  /** False when a reply did not parse, was cut off or lacked a verdict — never cached. */
  usable: boolean;
  dropped: string[];
  /** Model calls made for this variant (0–2). */
  calls: number;
};

export type BlindResult = {
  variants: BlindVariantResult[];
  /** The combined verdict: the lower of the usable variants; null when none is usable or the variants disagree by ≥ 2 tiers (R8). */
  verdict: Tier | null;
  /** False = R8: the two variants disagree by two or more tiers. */
  self_consistent: boolean;
  scout: boolean;
  /** The scout's finding when `found` with ≥ 2 cited ids; null otherwise. */
  latent_fit: LatentFit | null;
  /** Ids the pass was given, in prompt order. */
  evidence_ids: string[];
  calls: number;
};

// ---------------------------------------------------------------------------
// Skeptic
// ---------------------------------------------------------------------------

export type ObjectionKind = "eligibility" | "paradigm" | "design" | "unit_materials" | "scale_role" | "topic";

export type SkepticResult = {
  objection: string | null;
  objection_kind: ObjectionKind | null;
  /** Derived from the kind (eligibility / paradigm / design / unit_materials), not taken from the model. */
  gate_level: boolean;
  evidence_ids: string[];
  confidence: "high" | "medium" | "low" | null;
  what_would_resolve_it: string | null;
  /** An objection with ≥ 1 verifying id (an evidence id or a notice section reference). */
  grounded: boolean;
  usable: boolean;
  dropped: string[];
  calls: number;
};

// ---------------------------------------------------------------------------
// Reconciler and the reconciliation
// ---------------------------------------------------------------------------

export type Agreement = "agree" | "structured_higher" | "blind_higher" | "blind_unavailable";

/** How a validated correction is routed (reconciler.md post-rules 2–4). */
export type CorrectionRoute = "auto" | "provisional";

export type ValidatedCorrection = Correction & {
  route: CorrectionRoute;
  /** The reconciler's `section` after verification (the section the quote was found in). */
  verified_section: string | null;
};

export type ReconcilerOutput = {
  agreement: Agreement | null;
  disagreement_explanation: string | null;
  corrections: ValidatedCorrection[];
  inexpressible_insight: string | null;
  rationale: string | null;
  why_not: string | null;
  usable: boolean;
  dropped: string[];
  calls: number;
};

/** Which row of the §16 table (or which of the code's completions of it) decided the pair. */
export type ReconciliationRow =
  | "R1_strong_agree"
  | "R2_strong_blind_moderate"
  | "R3_strong_gate_objection"
  | "R4_strong_unsupported_dissent"
  | "R5_raise_by_correction"
  | "R6_ai_flagged_lead"
  | "R7_gate_stands"
  | "R7_gate_corrected"
  | "R8_blind_void"
  | "confirmed"
  | "dissent_stands"
  | "objection_lowers"
  | "structured_only";

export type ShownConfidence = "high" | "medium" | "low" | "review" | "structured_only";

export type ReviewKind = "ungrounded_dissent" | "ai_flagged_lead" | "structured_miss" | "gate_correction" | "pending_confirmation";

export type ReviewItem = { kind: ReviewKind; note: string };

export type AppliedCorrection = {
  correction: ValidatedCorrection;
  /** The `fit_corrections` row id once persisted; null in a dry run. */
  id: string | null;
  status: CorrectionStatus;
};

export type Reconciliation = {
  row: ReconciliationRow;
  /** The engine's tier before any correction. */
  tier_structured: Tier;
  /** The engine's tier after the validated corrections were applied and the pair re-scored. */
  tier_rescored: Tier;
  /** The tier after adjudication. */
  tier: Tier;
  /** The final caps: the re-scored engine's plus `caps_added`. */
  caps: CapId[];
  caps_added: Stage8CapId[];
  confidence: ShownConfidence;
  reasons: string[];
  review: ReviewItem | null;
  /** R3: the structure missed a gate the judge saw — logged for taxonomy or ingest repair. */
  structured_miss: boolean;
  /** The reconciler's rationale when it cites existing evidence, else the engine's. */
  rationale: string | null;
  why_not: string | null;
  corrections: AppliedCorrection[];
};

// ---------------------------------------------------------------------------
// Stored shapes
// ---------------------------------------------------------------------------

/** `fit_results.adjudication` — the compact summary the surfaces read. */
export type Adjudication = {
  version: string;
  judged_at: string;
  model: string;
  profile_versions: ProfileVersions;
  blind: {
    verdict: Tier | null;
    variants: Array<{ variant: BlindVariant; verdict: Tier | null; verdict_raw: Tier | null; usable: boolean }>;
    self_consistent: boolean;
    scout: boolean;
    latent_fit: LatentFit | null;
  } | null;
  skeptic: { objection: string | null; objection_kind: ObjectionKind | null; gate_level: boolean; grounded: boolean; confidence: SkepticResult["confidence"] } | null;
  reconciliation: Reconciliation;
  /** Short id → internal item id, so a rationale's citations resolve. */
  evidence: Array<{ id: string; ref: string }>;
};

/** One `fit_adjudications` row: the full validated outputs (the cache the sweep re-derives the tier from). */
export type StoredAdjudication = {
  investigator_id: string;
  opportunity_id: string;
  profile_versions: ProfileVersions;
  blind: BlindResult | null;
  skeptic: SkepticResult | null;
  reconciliation: {
    reconciler: ReconcilerOutput | null;
    result: Reconciliation;
    evidence: Array<{ id: string; ref: string }>;
    engine: { tier: Tier; score: number; caps: CapId[] };
  };
  model: string;
  created_at: string;
};
