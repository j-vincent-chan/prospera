/** Shared types for the Outreach workspace (Outreach v4). */

export type OutreachStage = "triage" | "contacting" | "developing" | "submitted" | "outcome" | "parked";

export const STAGES: OutreachStage[] = ["triage", "contacting", "developing", "submitted", "outcome", "parked"];

/** Board tab labels (design: the Contacting stage reads "Outreach" on the tab strip). */
export const STAGE_TAB_LABEL: Record<OutreachStage, string> = {
  triage: "Triage",
  contacting: "Outreach",
  developing: "Developing",
  submitted: "Submitted",
  outcome: "Outcome",
  parked: "Parked",
};

export const STAGE_LABEL: Record<OutreachStage, string> = {
  triage: "Triage",
  contacting: "Contacting",
  developing: "Developing",
  submitted: "Submitted",
  outcome: "Outcome",
  parked: "Parked",
};

export type Outcome = "funded" | "not_funded" | "withdrawn" | "not_submitted" | "pending";

export const OUTCOME_LABEL: Record<Outcome, string> = {
  funded: "Funded",
  not_funded: "Not funded",
  withdrawn: "Withdrawn",
  not_submitted: "Not submitted",
  pending: "Decision pending",
};

export type SuggestionsState = "none" | "loading" | "ready" | "error" | "manual" | "outdated";

export type FacetKey = "topics" | "disease" | "methods" | "disciplines" | "stage" | "mechanism" | "eligibility" | "team" | "excluded";

export const FACETS: Array<{ key: FacetKey; label: string; collapsed: number; excluded?: boolean }> = [
  { key: "topics", label: "Scientific topics", collapsed: 3 },
  { key: "disease", label: "Disease · population", collapsed: 2 },
  { key: "methods", label: "Methods · technologies", collapsed: 2 },
  { key: "disciplines", label: "Disciplines", collapsed: 0 },
  { key: "stage", label: "Research stage", collapsed: 0 },
  { key: "mechanism", label: "Funding mechanism", collapsed: 1 },
  { key: "eligibility", label: "Eligibility · career stage", collapsed: 0 },
  { key: "team", label: "Team science", collapsed: 0 },
  { key: "excluded", label: "Excluded · nonresponsive", collapsed: 3, excluded: true },
];

export type OpportunityProfile = {
  version: number;
  extractedAt: string | null;
  /** "llm" | "tags" | "empty" */
  source: string;
  facets: Record<FacetKey, string[]>;
  /** Facet → section of the notice the terms came from. */
  sections?: Partial<Record<FacetKey, string>>;
  editedBy?: string | null;
  editedAt?: string | null;
};

export type SuggestionOptions = {
  excludeRecentlyContacted: boolean;
  earlyCareerOnly: boolean;
  excludeRenewalsDue: boolean;
};

export const DEFAULT_SUGGESTION_OPTIONS: SuggestionOptions = { excludeRecentlyContacted: true, earlyCareerOnly: false, excludeRenewalsDue: false };

export type SuggestionTier = "strong" | "potential" | "exploratory";
export type Coverage = "strong" | "partial" | "limited";

export const TIER_LABEL: Record<SuggestionTier, string> = { strong: "Strong match", potential: "Potential match", exploratory: "Exploratory" };

export const TIER_HELP: Record<SuggestionTier, string> = {
  strong: "Direct overlap on science and disease, supported by at least two dated items from two or more sources.",
  potential: "Overlap on one axis, or strong overlap with limited or uncertain evidence. Eligibility or identity questions cap a suggestion here.",
  exploratory: "Keyword-level or roster-only overlap. A lead to check, not a recommendation.",
};

export const COVERAGE_HELP: Record<Coverage, string> = {
  strong: "Three or more sources: roster, PubMed, RePORTER, biosketch or ORCID.",
  partial: "Two sources. Missing items are listed in the evidence view.",
  limited: "Roster only, or a single unverified source.",
};

export type SuggestionFlag = { kind: "eligibility" | "identity" | "conflict" | "limited" | "stale"; text: string };

export type SuggestionReason = { text: string; source: string; title: string; evidenceIds: string[] };

export type ChecklistMark = "yes" | "no" | "conflict" | "unclear";
export type ChecklistRow = { facet: string; value: string; mark: ChecklistMark };

export type EvidenceItem = {
  id: string;
  heading: string;
  sub: string;
  link?: { label: string; href: string } | null;
  quote?: string | null;
  tags?: string | null;
  inferred?: string | null;
  identity?: { text: string; kind: "ok" | "warn" } | null;
  /** publication id for "Not this person". */
  publicationId?: string | null;
  similarity?: number | null;
};

export type EvidenceGroup = { key: "research" | "funding" | "self" | "institutional" | "history"; title: string; meta: string; items: EvidenceItem[]; empty?: string; action?: { kind: string; label: string } | null };

export type SuggestionSnapshot = {
  tier: SuggestionTier;
  coverage: Coverage;
  score: number;
  flags: SuggestionFlag[];
  reasons: SuggestionReason[];
  checklist: ChecklistRow[];
  groups: EvidenceGroup[];
  identityLine: string;
  freshLine: string;
  freshWarn: boolean;
  historyLine: string | null;
  historyKind: "good" | "warn" | null;
  isNew: boolean;
  excludedReason: string | null;
};

export type RecipientStatus = "selected" | "contacted" | "replied_interested" | "replied_maybe" | "replied_not_now" | "declined" | "bounced";

export const RECIPIENT_STATUS_LABEL: Record<RecipientStatus, string> = {
  selected: "Selected",
  contacted: "Contacted",
  replied_interested: "Interested",
  replied_maybe: "Maybe",
  replied_not_now: "Not now",
  declined: "Declined",
  bounced: "Bounced",
};

export type CommunityTier = "strong" | "potential" | "not_suggested" | "cant_evaluate" | "inactive";

export type DismissReason = "not_relevant" | "wrong_area" | "wrong_person" | "already_aware" | "do_not_contact" | "";

export const DISMISS_REASON_LABEL: Record<Exclude<DismissReason, "">, string> = {
  not_relevant: "not relevant",
  wrong_area: "wrong research area",
  wrong_person: "wrong person · profile flagged for review",
  already_aware: "already aware",
  do_not_contact: "do not contact · saved to profile",
};
