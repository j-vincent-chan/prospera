/**
 * The notice card inside the outreach email: the facts a PI needs before
 * deciding whether to read on — sponsor and mechanism, title, one or two
 * sentences of purpose, deadline, award, and a link that opens as a page.
 *
 * Read from the notice row and its fit profile the same way `draft-queries.ts`
 * reads the beats' facts, so the card the strategist previews on the Draft
 * page and the card in the sent message are the same object. `noticeCardOf`
 * is pure; `loadEmailNoticeCard` is the one-notice loader the send action
 * uses, so the client never supplies the card.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OutreachEmailCard } from "@/lib/email/outreach-email-html";
import type { OpportunityFitProfile } from "@/lib/fit/types";
import { loadNoticeProfiles } from "@/lib/fit/verdict-profiles";
import { normalizeAgencyDisplayName } from "@/lib/funding-opportunities/agency-display";
import { resolveFundingOpportunityDescription } from "@/lib/funding-opportunities/display-text";
import { resolveNoticeLinks, type NoticeLinkInput } from "@/lib/funding-opportunities/notice-links";
import { cycleFactsFromRow, dueDisplay, isNihNotice, type CycleColumns } from "@/lib/funding-opportunities/receipt-cycles";
import { shortTitleOf } from "@/lib/outreach/beats";

export type CardRow = CycleColumns &
  NoticeLinkInput & {
    id: string;
    title: string;
    opportunity_number: string | null;
    agency: string | null;
    agency_code: string | null;
    award_ceiling: number | string | null;
    activity_code: string | null;
    funding_instrument: string | null;
    description?: unknown;
  };

/** The `funding_opportunities` columns the card needs; `draft-queries.ts` selects these plus `loi_due, loi_note`. */
export const CARD_COLUMNS =
  "id, title, opportunity_number, agency, agency_code, award_ceiling, activity_code, funding_instrument, description, guide_url, guide_fetch_status, source_system, source_opportunity_id, close_date, next_due, receipt_cycles, cycles_source, standard_dates_apply, expiration_date, forecasted, status, raw_payload_json";

/** "R03" · "U19 · cooperative agreement" · "cooperative agreement" · null. A plain "Grant" instrument adds nothing and is dropped; Simpler's enum spelling ("COOPERATIVE_AGREEMENT") is read as words. */
export function mechanismOf(activityCode: string | null | undefined, instrument: string | null | undefined): string | null {
  const code = activityCode?.trim() || null;
  const inst = instrument?.trim().replace(/_/g, " ").replace(/\s+/g, " ") || null;
  const instLabel = inst && !/^grants?$/i.test(inst) ? inst.toLowerCase() : null;
  return [code, instLabel].filter(Boolean).join(" · ") || null;
}

/** "$100,000 direct / year · 2 years" · "$250,000 direct / year" · "5 years" · null. */
export function awardLineOf(ceilingPerYear: number | null, periodYears: number | null): string | null {
  const money = ceilingPerYear != null && Number.isFinite(ceilingPerYear) && ceilingPerYear > 0 ? `$${Math.round(ceilingPerYear).toLocaleString("en-US")} direct / year` : null;
  const years = periodYears != null && periodYears > 0 ? `${periodYears} year${periodYears === 1 ? "" : "s"}` : null;
  return [money, years].filter(Boolean).join(" · ") || null;
}

/** The first one or two sentences of a description, within `max` characters; null for nothing. */
export function leadOf(description: string | null | undefined, max = 300): string | null {
  const t = (description ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const sentences = t.match(/[^.!?]+[.!?]+(?:["”’)]+)?(?=\s|$)/g)?.map((s) => s.trim()) ?? [t];
  let out = sentences[0] ?? t;
  if (sentences[1] && `${out} ${sentences[1]}`.length <= max) out = `${out} ${sentences[1]}`;
  return out.length > max ? `${out.slice(0, max - 1).trimEnd()}…` : out;
}

/** Pure. The card for one notice, from its row and (when the engine has one) its fit profile. */
export function noticeCardOf(input: { fo: CardRow; profile: OpportunityFitProfile | null; today: string }): OutreachEmailCard {
  const { fo, profile, today } = input;
  const due = dueDisplay(cycleFactsFromRow(fo), today);
  const dueDate = due.date && due.tone !== "closed" && due.tone !== "muted" && due.tone !== "forecast" ? due.date : null;
  const rawCeiling = profile?.mechanism.ceiling_direct_per_year ?? (fo.award_ceiling == null ? null : Number(fo.award_ceiling));
  const ceiling = rawCeiling != null && Number.isFinite(rawCeiling) && rawCeiling > 0 ? rawCeiling : null;
  return {
    sponsor: isNihNotice(fo) ? "National Institutes of Health" : normalizeAgencyDisplayName(fo.agency) ?? fo.agency ?? fo.agency_code ?? null,
    mechanism: mechanismOf(fo.activity_code, fo.funding_instrument),
    number: fo.opportunity_number,
    title: shortTitleOf(fo.title),
    summary: leadOf(resolveFundingOpportunityDescription(fo)),
    dueDate,
    awardLine: awardLineOf(ceiling, profile?.mechanism.period_years ?? null),
    url: resolveNoticeLinks(fo).primary?.url ?? null,
  };
}

/** The card for one notice, for the send action. Null when the notice row is gone. */
export async function loadEmailNoticeCard(db: SupabaseClient, opportunityId: string, today: string): Promise<OutreachEmailCard | null> {
  const [{ data }, profiles] = await Promise.all([db.from("funding_opportunities").select(CARD_COLUMNS).eq("id", opportunityId).maybeSingle(), loadNoticeProfiles(db, [opportunityId])]);
  if (!data) return null;
  return noticeCardOf({ fo: data as unknown as CardRow, profile: profiles.profiles.get(opportunityId) ?? null, today });
}
