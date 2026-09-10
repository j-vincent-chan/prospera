/**
 * Which adapter owns a notice row (PR 5.5a).
 *
 * PRs 5.3–5.5 each built an adapter and `scripts/fit-backfill-announcements.ts`
 * wired all three by hand, so the wiring existed only inside a script nothing
 * scheduled. This module is that wiring, lifted out unchanged, so the nightly
 * sync (`src/lib/services/announcement-sync.ts`) and the backfill route rows
 * identically — adding an adapter is one line in `adapterForFamily`, one in
 * `adapterApplies` and one in `acquireAnnouncement`.
 *
 * Nothing here reaches the network or Supabase: it maps a row to an adapter and
 * calls it with the caller's deps.
 */
import type { Acquisition } from "@/lib/ingestion/announcement/registry";
import { funderFamilyOf, type FunderFamily } from "@/lib/ingestion/announcement/registry";
import {
  GRANTS_GOV_ATTACHMENT_ADAPTER_ID,
  acquireGrantsGovAttachment,
  appliesToGrantsGovAttachment,
  type GrantsGovDeps,
  type GrantsGovRow,
} from "@/lib/ingestion/announcement/adapters/grants-gov-attachment";
import {
  NSF_SOLICITATION_ADAPTER_ID,
  acquireNsfSolicitation,
  appliesToNsfSolicitation,
  type NsfRow,
} from "@/lib/ingestion/announcement/adapters/nsf-solicitation";
import { CDMRP_PA_ADAPTER_ID, acquireCdmrpPa, appliesToCdmrpPa } from "@/lib/ingestion/announcement/adapters/cdmrp-pa";

/** Every column any of the three adapters reads. `CdmrpRow` is `GrantsGovRow`, so two shapes cover all three. */
export type AnnouncementRow = GrantsGovRow & NsfRow;

/** Every dependency any of the three needs. NSF ignores the Simpler half; CDMRP shares the Grants.gov bag. */
export type AnnouncementDeps = GrantsGovDeps & { programPage?: boolean };

/** The non-NIH adapter ids. The NIH one is deliberately absent — see `isNihCorpusRow`. */
export type NonNihAdapterId = typeof GRANTS_GOV_ATTACHMENT_ADAPTER_ID | typeof NSF_SOLICITATION_ADAPTER_ID | typeof CDMRP_PA_ADAPTER_ID;

/**
 * The NIH corpus test, and the reason it is written in TypeScript rather than
 * as a negated PostgREST filter: `not.or(...)` is NULL — and therefore false —
 * for a row with a null `agency_code`, which would silently drop real non-NIH
 * rows. Copied verbatim from `scripts/fit-backfill-announcements.ts`, which took
 * it from `scripts/fit-non-nih-inventory.ts:300`, where it was asserted to agree
 * with `NIH_NOTICE_FILTER` (`fit/profile/opportunity.ts`) on the live table.
 *
 * This is NOT `funderFamilyOf(row) === "nih"`. That function is a "where does
 * the text live" router and puts CDC, FDA, AHRQ and OPHS `RFA-`/`PA-` rows in
 * `hhs_other`, but `NIH_NOTICE_FILTER` counts every `RFA-`/`PA-`/`PAR-` number
 * as NIH and the Guide sync owns them. 51 open rows sit in that gap and 13
 * already carry Guide-parsed `guide_sections`; re-sectioning one here would
 * change `guide_sections` and re-key every cached extraction, which is exactly
 * what NON_NIH_PLAN.md § The NIH invariant forbids.
 */
export function isNihCorpusRow(row: { agency_code?: string | null; opportunity_number?: string | null }): boolean {
  const n = String(row.opportunity_number ?? "");
  return (
    String(row.agency_code ?? "").startsWith("HHS-NIH") ||
    n.startsWith("PA-") ||
    n.startsWith("PAR-") ||
    n.startsWith("RFA-") ||
    /^PAS-.{2}-.{3}$/.test(n)
  );
}

/**
 * NSF gets its own adapter because it attaches nothing to Grants.gov — the
 * attachment route reports every one of its open rows `not_applicable`. CDMRP
 * gets one because the mirror it does attach is a second-hand copy; the PA on
 * the funder's own host is the document of record. Everything else goes through
 * the attachment route.
 */
export function adapterForFamily(family: FunderFamily): NonNihAdapterId {
  if (family === "nsf") return NSF_SOLICITATION_ADAPTER_ID;
  if (family === "dod_cdmrp") return CDMRP_PA_ADAPTER_ID;
  return GRANTS_GOV_ATTACHMENT_ADAPTER_ID;
}

export function adapterApplies(adapter: NonNihAdapterId, row: AnnouncementRow): boolean {
  if (adapter === NSF_SOLICITATION_ADAPTER_ID) return appliesToNsfSolicitation(row);
  if (adapter === CDMRP_PA_ADAPTER_ID) return appliesToCdmrpPa(row);
  return appliesToGrantsGovAttachment(row);
}

/** The adapter a row would be read by, or null when no non-NIH adapter applies. */
export function adapterFor(row: AnnouncementRow): NonNihAdapterId | null {
  if (isNihCorpusRow(row)) return null;
  const family = funderFamilyOf(row);
  if (family === "nih" || family === "foundation" || family === "internal") return null;
  const adapter = adapterForFamily(family);
  return adapterApplies(adapter, row) ? adapter : null;
}

/** Run one adapter over one row. The caller owns the limiters, the Simpler client and the budget. */
export function acquireAnnouncement(adapter: NonNihAdapterId, row: AnnouncementRow, deps: AnnouncementDeps): Promise<Acquisition> {
  if (adapter === NSF_SOLICITATION_ADAPTER_ID) return acquireNsfSolicitation(row, { limiterFor: deps.limiterFor, programPage: deps.programPage });
  if (adapter === CDMRP_PA_ADAPTER_ID) return acquireCdmrpPa(row, deps);
  return acquireGrantsGovAttachment(row, deps);
}
