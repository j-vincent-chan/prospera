import { normalizeAgencyDisplayName } from "@/lib/funding-opportunities/agency-display";
import type { FundingListDbRow } from "@/lib/funding-opportunities/fetch-funding-list-rows";
import { resolveListPostedDate } from "@/lib/funding-opportunities/funding-opportunity-dates";
import { fundingListRowScope, type FundingListRowBucket } from "@/lib/funding-opportunities/funding-list-row-scope";
import {
  cycleFactsFromRow,
  dueDisplay,
  fmtMonDY,
  isoToday,
  type DueDisplay,
} from "@/lib/funding-opportunities/receipt-cycles";

/** What the Opportunities table renders per row (Opportunities v2). */
export type OpportunityRowModel = {
  id: string;
  title: string;
  /** "NIH · PAR-26-114" */
  agencyLine: string;
  agencyShort: string;
  opportunityNumber: string | null;
  statusBucket: FundingListRowBucket;
  statusLabel: "Open" | "Forecasted" | "Closed";
  due: DueDisplay;
  nextDue: string | null;
  postedLabel: string;
  postedDate: string | null;
  instrumentLabel: string;
  badges: Array<"Limited submission" | "Watching" | "Reissue">;
  reissueOf: string | null;
  isNih: boolean;
  saved: boolean;
  dismissed: boolean;
  watching: boolean;
};

const INSTRUMENT_LABELS: Record<string, string> = {
  grant: "Grant",
  cooperative_agreement: "Co-op agreement",
  procurement_contract: "Contract",
  other: "Other",
};

export function instrumentLabel(raw: string | null | undefined): string {
  if (!raw) return "—";
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (INSTRUMENT_LABELS[key]) return INSTRUMENT_LABELS[key]!;
  if (key.includes("cooperative")) return "Co-op agreement";
  if (key.includes("grant")) return "Grant";
  return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function agencyShortName(agency: string | null, agencyCode: string | null): string {
  const normalized = normalizeAgencyDisplayName(agency);
  if (normalized) return normalized;
  const code = (agencyCode ?? "").toUpperCase();
  if (code.startsWith("HHS-NIH")) return "NIH";
  if (code.startsWith("HHS-CDC")) return "CDC";
  if (code === "NSF") return "NSF";
  if (code.startsWith("DOD")) return "DoD";
  return agency?.trim() || agencyCode || "—";
}

export type RowFlags = {
  savedIds: Set<string>;
  dismissedIds: Set<string>;
  watchedIds: Set<string>;
};

export function buildRowModel(row: FundingListDbRow, flags: RowFlags, today: string = isoToday()): OpportunityRowModel {
  const todayDate = new Date(`${today}T00:00:00`);
  const statusBucket = fundingListRowScope({ status: row.status, close_date: row.next_due ?? row.close_date, forecasted: row.forecasted }, todayDate);
  const facts = cycleFactsFromRow({
    receipt_cycles: row.receipt_cycles,
    cycles_source: row.cycles_source,
    standard_dates_apply: row.standard_dates_apply,
    close_date: row.close_date,
    expiration_date: row.expiration_date,
    forecasted: row.forecasted,
    status: row.status,
    agency_code: row.agency_code,
    opportunity_number: row.opportunity_number,
  });
  const due = dueDisplay(facts, today);
  const postedDate = resolveListPostedDate({ statusBucket, postedDate: row.posted_date ?? null, rawPayload: null });
  const agencyShort = agencyShortName(row.agency, row.agency_code);
  const number = row.opportunity_number?.trim() || null;

  const badges: OpportunityRowModel["badges"] = [];
  if (flags.watchedIds.has(row.id)) badges.push("Watching");
  if (row.reissue_of) badges.push("Reissue");

  return {
    id: row.id,
    title: row.title,
    agencyLine: number ? `${agencyShort} · ${number}` : agencyShort,
    agencyShort,
    opportunityNumber: number,
    statusBucket,
    statusLabel: statusBucket === "open" ? "Open" : statusBucket === "forecasted" ? "Forecasted" : "Closed",
    due,
    nextDue: row.next_due ?? facts.closeDate,
    postedLabel: postedDate ? (statusBucket === "forecasted" ? `Updated ${fmtMonDY(postedDate)}` : fmtMonDY(postedDate)) : "—",
    postedDate,
    instrumentLabel: instrumentLabel(row.funding_instrument),
    badges,
    reissueOf: row.reissue_of ?? null,
    isNih: facts.isNih,
    saved: flags.savedIds.has(row.id),
    dismissed: flags.dismissedIds.has(row.id),
    watching: flags.watchedIds.has(row.id),
  };
}

/**
 * Sort by next receipt date: upcoming dates soonest-first, then notices with
 * no date, then past dates most-recent-first (stale forecasts and closed
 * notices sink). `asc=false` reverses the upcoming block only.
 */
export function sortByNextDue<T extends { nextDue: string | null; title: string }>(rows: T[], asc = true, today: string = isoToday()): T[] {
  const rank = (r: T) => (r.nextDue == null ? 1 : r.nextDue >= today ? 0 : 2);
  return [...rows].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0 && a.nextDue !== b.nextDue) return asc ? a.nextDue!.localeCompare(b.nextDue!) : b.nextDue!.localeCompare(a.nextDue!);
    if (ra === 2 && a.nextDue !== b.nextDue) return b.nextDue!.localeCompare(a.nextDue!);
    return a.title.localeCompare(b.title);
  });
}
