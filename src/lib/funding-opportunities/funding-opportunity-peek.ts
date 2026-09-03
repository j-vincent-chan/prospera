import { computeNextDue, cycleFactsFromRow, type CycleFacts } from "@/lib/funding-opportunities/receipt-cycles";
import type { SupabaseClient } from "@supabase/supabase-js";
import { coercePlainTextFromUnknown } from "@/lib/formatting/coerce-plain-text";
import { normalizeAgencyDisplayName } from "@/lib/funding-opportunities/agency-display";
import { resolveFundingOpportunityDescription } from "@/lib/funding-opportunities/display-text";
import {
  buildPiDecisionBrief,
  loadPiInvestigatorMatches,
  loadSimilarGrantAwardees,
  type PiDecisionBrief,
  type PiInvestigatorMatch,
  type SimilarGrantAwardee,
} from "@/lib/funding-opportunities/funding-opportunity-pi-brief";
import {
  fundingListRowScope,
  type FundingListRowBucket,
} from "@/lib/funding-opportunities/funding-list-row-scope";
import { resolveExpectedNumberOfAwards } from "@/lib/funding-opportunities/expected-awards";
import {
  resolveEstimatedOpenDate,
  resolveListLastUpdatedDate,
  resolveListPostedDate,
} from "@/lib/funding-opportunities/funding-opportunity-dates";
import {
  resolveFundingApplicationMaterials,
  type FundingApplicationMaterials,
} from "@/lib/funding-opportunities/funding-opportunity-application-materials";
import { resolveFundingSourceUrl } from "@/lib/funding-opportunities/source-url";
import { buildOpportunityQuickTags } from "@/lib/quick-match/tag-opportunity";
import type { QuickMatchBuckets } from "@/lib/quick-match/types";

export type FundingOpportunityPeekData = {
  id: string;
  title: string;
  agency: string;
  opportunityNumber: string | null;
  status: string | null;
  statusBucket: FundingListRowBucket;
  postedDate: string | null;
  closeDate: string | null;
  updatedAt: string | null;
  estimatedOpenDate: string | null;
  fundingInstrument: string | null;
  activityFamilies: string[] | null;
  applicantTypes: string | null;
  awardFloor: number | null;
  awardCeiling: number | null;
  expectedNumberOfAwards: number | null;
  description: string;
  sourceUrl: string | null;
  quickTags: QuickMatchBuckets;
  piBrief: PiDecisionBrief;
  investigatorMatches: PiInvestigatorMatch[];
  similarAwardees: SimilarGrantAwardee[];
  applicationMaterials: FundingApplicationMaterials;
  // v2 receipt cycles + NIH Guide key dates
  cycleFacts: CycleFacts;
  nextDue: string | null;
  loiDue: string | null;
  loiNote: string | null;
  openDate: string | null;
  expirationDate: string | null;
  earliestStart: string | null;
  activityCode: string | null;
  reissueOf: string | null;
  companionOf: string | null;
  relatedNotices: Array<{ date: string | null; text: string; number: string | null }>;
  guideUrl: string | null;
  guideFetchedAt: string | null;
  clinicalTrialNote: string | null;
  isNih: boolean;
};

function parseAwardAmount(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatApplicantTypes(value: unknown): string | null {
  if (Array.isArray(value) && value.length > 0) {
    return value.map((x) => String(x)).join(", ");
  }
  const text = coercePlainTextFromUnknown(value);
  return text || null;
}

export async function loadFundingOpportunityPeek(
  supabase: SupabaseClient,
  id: string
): Promise<FundingOpportunityPeekData | null> {
  const { data: fo, error } = await supabase
    .from("funding_opportunities")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error || !fo) return null;

  const today = new Date(new Date().toDateString());
  const statusBucket = fundingListRowScope(
    {
      status: fo.status,
      close_date: fo.close_date,
      forecasted: fo.forecasted,
    },
    today
  );

  const quickTags = buildOpportunityQuickTags(
    {
      title: fo.title,
      description: fo.description,
      agency: fo.agency,
      agency_code: fo.agency_code,
      opportunity_number: fo.opportunity_number,
      category: fo.category,
      funding_instrument: fo.funding_instrument,
      applicant_types: fo.applicant_types,
      raw_payload_json: fo.raw_payload_json,
    },
    {
      nih_ic_tokens: Array.isArray(fo.nih_ic_tokens) ? (fo.nih_ic_tokens as string[]) : null,
      rd_research_pathway: fo.rd_research_pathway,
      clinical_trial_mode: fo.clinical_trial_mode,
      activity_families: Array.isArray(fo.activity_families) ? (fo.activity_families as string[]) : null,
      category: fo.category,
    }
  );

  const piBrief = buildPiDecisionBrief(fo, statusBucket, today);

  const opportunityNumber =
    coercePlainTextFromUnknown(fo.opportunity_number) ||
    coercePlainTextFromUnknown(fo.source_opportunity_id) ||
    null;

  const [investigatorMatches, similarAwardees, applicationMaterials] = await Promise.all([
    loadPiInvestigatorMatches(supabase, quickTags, 5),
    loadSimilarGrantAwardees(supabase, fo, 8),
    resolveFundingApplicationMaterials({
      opportunityNumber,
      agency: coercePlainTextFromUnknown(fo.agency) || null,
      agencyCode: coercePlainTextFromUnknown(fo.agency_code) || null,
      statusBucket,
      rawPayload: fo.raw_payload_json,
      nihIcTokens: Array.isArray(fo.nih_ic_tokens) ? (fo.nih_ic_tokens as string[]) : null,
    }),
  ]);

  const cycleFacts = cycleFactsFromRow(fo);
  const agencyRaw = coercePlainTextFromUnknown(fo.agency);
  const agencyShort = normalizeAgencyDisplayName(agencyRaw || null);
  const agencyDisplay = agencyShort || agencyRaw || "—";

  return {
    id,
    title: coercePlainTextFromUnknown(fo.title) || "(untitled)",
    agency: agencyDisplay,
    opportunityNumber,
    status: coercePlainTextFromUnknown(fo.status) || null,
    statusBucket,
    postedDate: resolveListPostedDate({
      statusBucket,
      postedDate: fo.posted_date ?? null,
      rawPayload: fo.raw_payload_json,
    }),
    closeDate: fo.close_date ?? null,
    updatedAt: resolveListLastUpdatedDate({
      dbUpdatedAt: fo.updated_at ?? null,
      rawPayload: fo.raw_payload_json,
    }),
    estimatedOpenDate: resolveEstimatedOpenDate({
      statusBucket,
      postedDate: fo.posted_date ?? null,
      rawPayload: fo.raw_payload_json,
    }),
    fundingInstrument: coercePlainTextFromUnknown(fo.funding_instrument) || null,
    activityFamilies: Array.isArray(fo.activity_families)
      ? (fo.activity_families as string[])
      : null,
    applicantTypes: formatApplicantTypes(fo.applicant_types),
    awardFloor: parseAwardAmount(fo.award_floor),
    awardCeiling: parseAwardAmount(fo.award_ceiling),
    expectedNumberOfAwards: resolveExpectedNumberOfAwards(fo.raw_payload_json),
    description: resolveFundingOpportunityDescription(fo),
    sourceUrl: resolveFundingSourceUrl({
      raw_payload_json: fo.raw_payload_json,
      source_system: fo.source_system,
      source_opportunity_id: fo.source_opportunity_id,
    }),
    quickTags,
    piBrief,
    investigatorMatches,
    similarAwardees,
    applicationMaterials,
    cycleFacts,
    nextDue: fo.next_due ?? computeNextDue(cycleFacts),
    loiDue: fo.loi_due ?? null,
    loiNote: fo.loi_note ?? null,
    openDate: fo.open_date ?? null,
    expirationDate: fo.expiration_date ?? null,
    earliestStart: fo.earliest_start ?? null,
    activityCode: fo.activity_code ?? null,
    reissueOf: fo.reissue_of ?? null,
    companionOf: fo.companion_of ?? null,
    relatedNotices: Array.isArray(fo.related_notices) ? (fo.related_notices as Array<{ date: string | null; text: string; number: string | null }>) : [],
    guideUrl: fo.guide_url ?? null,
    guideFetchedAt: fo.guide_fetched_at ?? null,
    clinicalTrialNote: fo.clinical_trial_note ?? null,
    isNih: cycleFacts.isNih,
  };
}
