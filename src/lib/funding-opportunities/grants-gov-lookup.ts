/**
 * The notice's Grants.gov record, shared across renders.
 *
 * The opportunity page and the peek drawer used to make the two Grants.gov
 * calls live on every render — 0.7 s on a good day, 4 s on a bad one, with a
 * 24 s worst case — for a record that changes at most daily. Next's data
 * cache keeps the answer for six hours, keyed by the notice number and id;
 * an outage throws inside the cached function, so nothing is stored and the
 * page shows the attachments the payload already lists.
 *
 * Server only (`next/cache`): the pure materials builder takes the result as
 * input so the client-side peek drawer can keep importing it.
 */
import { unstable_cache } from "next/cache";
import { lookupGrantsGovOpportunity, type GrantsGovOpportunityLookup } from "@/lib/funding-opportunities/grants-gov-opportunity-api";

/** How long a notice's Grants.gov record is reused before it is fetched again. */
const GRANTS_GOV_LOOKUP_TTL_SECONDS = 6 * 60 * 60;

export const EMPTY_GRANTS_GOV_LOOKUP: GrantsGovOpportunityLookup = { legacyOpportunityId: null, details: null };

const cachedGrantsGovLookup = unstable_cache(
  async (opportunityNumber: string | null, legacyIdHint: number | null) => lookupGrantsGovOpportunity(opportunityNumber, legacyIdHint),
  ["grants-gov-opportunity-lookup"],
  { revalidate: GRANTS_GOV_LOOKUP_TTL_SECONDS },
);

export async function loadGrantsGovLookup(opportunityNumber: string | null, legacyIdHint: number | null): Promise<GrantsGovOpportunityLookup> {
  if (!opportunityNumber?.trim() && legacyIdHint == null) return EMPTY_GRANTS_GOV_LOOKUP;
  try {
    return await cachedGrantsGovLookup(opportunityNumber?.trim() || null, legacyIdHint);
  } catch {
    // Grants.gov unreachable (or no data cache outside a Next request): the payload's own attachments still render.
    return EMPTY_GRANTS_GOV_LOOKUP;
  }
}
