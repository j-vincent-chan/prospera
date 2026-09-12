"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_MAX_NOFOS_PER_SYNC } from "@/lib/services/simpler-grants-sync";
import { extractOpportunityFeatures } from "@/lib/funding-opportunities/extract-opportunity-features";
import { revalidateFundingCatalogCache } from "@/lib/funding-opportunities/funding-catalog-cache";
import { buildRdSignalColumns } from "@/lib/funding-opportunities/rd-signals";
import { agencyContactFromRaw } from "@/lib/ingestion/simpler-grants/fields";
import { runSimplerGrantsSyncJob } from "@/lib/services/run-simpler-grants-sync-job";

/** Form-friendly wrapper (returns void for Next.js <form action>). */
export async function syncFundingOpportunitiesForm(formData: FormData): Promise<void> {
  void formData;
  await syncFundingOpportunities();
}

function clampSyncMaxNofos(requested?: number): number {
  if (requested == null || Number.isNaN(requested)) return DEFAULT_MAX_NOFOS_PER_SYNC;
  return Math.min(DEFAULT_MAX_NOFOS_PER_SYNC, Math.max(1, Math.floor(requested)));
}

async function syncFundingOpportunitiesWithCap(maxNofosPerRun: number) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const cap = clampSyncMaxNofos(maxNofosPerRun);
  const result = await runSimplerGrantsSyncJob(supabase, {
    maxNofosPerRun: cap,
    source: "ui",
  });
  revalidateFundingCatalogCache();
  if (!result.ok) return { error: result.error };

  revalidatePath("/funding-opportunities");
  // `result` already carries `ok: true` plus the sync counters.
  return result;
}

/** Full sync up to {@link DEFAULT_MAX_NOFOS_PER_SYNC} opportunities. */
export async function syncFundingOpportunities() {
  return syncFundingOpportunitiesWithCap(DEFAULT_MAX_NOFOS_PER_SYNC);
}

export async function extractOpportunityFeaturesAllForm(formData: FormData): Promise<void> {
  void formData;
  await extractOpportunityFeaturesAll();
}

export async function extractOpportunityFeaturesAll() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const { data: opps, error } = await supabase.from("funding_opportunities").select("*");
  if (error) return { error: error.message };

  let n = 0;
  const errors: string[] = [];
  for (const o of opps ?? []) {
    const feats = extractOpportunityFeatures({
      title: o.title,
      description: o.description ?? "",
      category: o.category,
      funding_instrument: o.funding_instrument,
    });
    const { error: uErr } = await supabase.from("opportunity_features").upsert(
      {
        opportunity_id: o.id,
        ...feats,
      },
      { onConflict: "opportunity_id" }
    );
    if (uErr) {
      errors.push(`${o.id}: ${uErr.message}`);
      continue;
    }
    const rd = buildRdSignalColumns({
      title: o.title,
      description: o.description ?? "",
      opportunity_number: o.opportunity_number,
      agency: o.agency,
      agency_code: o.agency_code,
      // `select("*")` carries the stored Guide sections and Simpler payload, so this is a full re-resolution.
      guide_sections: Array.isArray(o.guide_sections) ? o.guide_sections : null,
      agency_contact_description: agencyContactFromRaw(o.raw_payload_json),
    });
    const { error: rdErr } = await supabase.from("funding_opportunities").update(rd).eq("id", o.id);
    if (rdErr) errors.push(`${o.id} rd: ${rdErr.message}`);
    else n += 1;
  }

  revalidatePath("/funding-opportunities");
  return { ok: true as const, extracted: n, errors };
}
