import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron/authorize-cron-request";
import { revalidateFundingCatalogCache } from "@/lib/funding-opportunities/funding-catalog-cache";
import { runSimplerGrantsSyncJob } from "@/lib/services/run-simpler-grants-sync-job";
import { createServiceRoleClient } from "@/lib/supabase/admin-service";

export const maxDuration = 300;

/**
 * Nightly sync: Simpler.Grants.gov → `funding_opportunities` (NIH and other federal notices).
 * Vercel Cron uses GET; manual runs may use POST.
 * Headers: Authorization: Bearer <CRON_SECRET>
 * Requires SUPABASE_SERVICE_ROLE_KEY and SIMPLER_GRANTS_API_KEY.
 */
async function handleCronSync(req: Request) {
  const denied = authorizeCronRequest(req);
  if (denied) return denied;

  const supabase = createServiceRoleClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY not configured" },
      { status: 503 }
    );
  }

  // Skip per-notice detail enrichment so the nightly job finishes within the function time limit
  // (enriching thousands of notices can take 10+ min). The in-app "Sync Simpler" still enriches.
  const result = await runSimplerGrantsSyncJob(supabase, {
    source: "vercel_cron",
    enrichWithDetailFetch: false,
  });
  // Cached chip counts and the header's sync stamp describe the catalog before this run.
  revalidateFundingCatalogCache();
  if (!result.ok) {
    const status = result.error.includes("not configured") ? 503 : 500;
    return NextResponse.json({ ok: false, error: result.error }, { status });
  }

  return NextResponse.json({
    ok: true,
    upserted: result.upserted,
    pagesFetched: result.pagesFetched,
    skippedClosed: result.skippedClosed,
    maxNofosPerRun: result.maxNofosPerRun,
    errors: result.errors,
  });
}

export async function GET(req: Request) {
  return handleCronSync(req);
}

export async function POST(req: Request) {
  return handleCronSync(req);
}
