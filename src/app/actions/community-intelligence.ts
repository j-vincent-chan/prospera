"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  formatBulkRefreshSummary,
  refreshAllInvestigatorsCommunityCaches,
} from "@/lib/community/bulk-refresh-investigator-caches";
import { recomputeCoauthorshipFromPublications } from "@/lib/community/collaborations";
import { refreshInvestigatorClinicalTrials } from "@/lib/community/clinicaltrials-ingest";
import { refreshInvestigatorPubMed } from "@/lib/community/pubmed-ingest";
import { isGatewayStatusMessage } from "@/lib/supabase/postgrest-error";
import { refreshInvestigatorReporter } from "@/lib/community/reporter-ingest";
import { ingestUcsfNewsFromSitemaps } from "@/lib/community/ucsf-news-ingest";
import {
  formatLinkUcsfNewsSummary,
  linkUcsfNewsItemsToWatchlist,
} from "@/lib/community/ucsf-news-investigator-linking";
import {
  formatSyncCommunitySignalsSummary,
  syncAllCommunitySignalsFromCaches,
  syncInvestigatorCommunitySignalsFromCaches,
} from "@/lib/community/sync-community-signals-from-caches";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/admin-service";

const engagementStatusSchema = z.enum([
  "identified",
  "matched",
  "contacted",
  "engaged",
  "drafting",
  "internal_review",
  "submitted",
  "funded",
  "declined",
  "dormant",
]);

const createEngagementSchema = z.object({
  investigatorId: z.string().uuid(),
  engagementType: z.string().trim().min(1).max(120).optional(),
  status: engagementStatusSchema.optional(),
  opportunityId: z.string().uuid().optional().nullable(),
  notes: z.string().max(20_000).optional().nullable(),
  nextStep: z.string().max(10_000).optional().nullable(),
  nextStepDueDate: z.string().optional().nullable(),
});

export async function createStrategistEngagementFormAction(formData: FormData): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const rawOpp = formData.get("opportunityId");
  const oppTrim =
    rawOpp && String(rawOpp).trim() ? String(rawOpp).trim() : null;
  const opportunityId =
    oppTrim && z.string().uuid().safeParse(oppTrim).success ? oppTrim : null;

  const parsed = createEngagementSchema.safeParse({
    investigatorId: formData.get("investigatorId"),
    engagementType: formData.get("engagementType") || "outreach",
    status: formData.get("status") || "identified",
    opportunityId,
    notes: formData.get("notes") || null,
    nextStep: formData.get("nextStep") || null,
    nextStepDueDate: formData.get("nextStepDueDate") || null,
  });
  if (!parsed.success) {
    throw new Error("Invalid engagement form");
  }

  const { error } = await supabase.from("strategist_engagements").insert({
    investigator_id: parsed.data.investigatorId,
    owner_user_id: user.id,
    engagement_type: parsed.data.engagementType ?? "outreach",
    status: parsed.data.status ?? "identified",
    opportunity_id: parsed.data.opportunityId ?? null,
    notes: parsed.data.notes ?? null,
    next_step: parsed.data.nextStep ?? null,
    next_step_due_date: parsed.data.nextStepDueDate?.trim()
      ? parsed.data.nextStepDueDate
      : null,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/portfolio-intelligence");
  revalidatePath("/portfolio-intelligence/engagements");
  revalidatePath(`/investigators/${parsed.data.investigatorId}`);
}

const updateEngagementSchema = z.object({
  engagementId: z.string().uuid(),
  status: engagementStatusSchema,
  lastContactDate: z.string().optional().nullable(),
  nextStep: z.string().max(10_000).optional().nullable(),
  nextStepDueDate: z.string().optional().nullable(),
  notes: z.string().max(20_000).optional().nullable(),
  outcome: z.string().max(10_000).optional().nullable(),
});

export async function updateStrategistEngagementFormAction(formData: FormData): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const parsed = updateEngagementSchema.safeParse({
    engagementId: formData.get("engagementId"),
    status: formData.get("status"),
    lastContactDate: formData.get("lastContactDate") || null,
    nextStep: formData.get("nextStep") || null,
    nextStepDueDate: formData.get("nextStepDueDate") || null,
    notes: formData.get("notes") || null,
    outcome: formData.get("outcome") || null,
  });
  if (!parsed.success) throw new Error("Invalid update");

  const { data: existing } = await supabase
    .from("strategist_engagements")
    .select("investigator_id")
    .eq("id", parsed.data.engagementId)
    .maybeSingle();

  const { error } = await supabase
    .from("strategist_engagements")
    .update({
      status: parsed.data.status,
      last_contact_date: parsed.data.lastContactDate?.trim() || null,
      next_step: parsed.data.nextStep ?? null,
      next_step_due_date: parsed.data.nextStepDueDate?.trim() || null,
      notes: parsed.data.notes ?? null,
      outcome: parsed.data.outcome ?? null,
    })
    .eq("id", parsed.data.engagementId);

  if (error) throw new Error(error.message);
  revalidatePath("/portfolio-intelligence");
  revalidatePath("/portfolio-intelligence/engagements");
  revalidatePath(`/portfolio-intelligence/engagements/${parsed.data.engagementId}`);
  if (existing?.investigator_id) {
    revalidatePath(`/investigators/${existing.investigator_id}`);
  }
}

export type InvestigatorCacheRefreshResult = { ok: boolean; message: string };

export async function refreshInvestigatorPubMedFormAction(
  formData: FormData
): Promise<InvestigatorCacheRefreshResult> {
  const id = z.string().uuid().safeParse(formData.get("investigatorId"));
  if (!id.success) return { ok: false, message: "Invalid investigator" };
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Unauthorized" };
  try {
    const result = await refreshInvestigatorPubMed(supabase, id.data);
    const rejected =
      result.rejectedPmids && result.rejectedPmids > 0
        ? ` ${result.rejectedPmids} PMID(s) skipped (name/UCSF affiliation check).`
        : "";
    const warning = result.warning ? ` ${result.warning}` : "";
    let message = `PubMed refresh complete: ${result.inserted} publication(s) saved (${result.pmids.length} matched).${rejected}${warning}`;

    try {
      const sync = await syncInvestigatorCommunitySignalsFromCaches(supabase, id.data);
      message += ` Community signals synced (${sync.publicationsSynced} papers, ${sync.removedStale} stale removed).`;
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      const missingColumn = /42703|column .* does not exist/i.test(detail)
        ? " Apply migrations 20260528120000 and 20260528130000 if the community_source_items table is missing Prospera columns."
        : "";
      message += ` Warning: community signal sync failed (${detail}).${missingColumn}`;
    }

    try {
      const graph = await recomputeCoauthorshipFromPublications(supabase);
      message += ` Co-authorship graph updated (${graph.coauthorshipEdges} edges).`;
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      message += ` Warning: co-authorship recompute failed (${detail}).`;
    }

    revalidatePath("/portfolio-intelligence");
revalidatePath("/portfolio-intelligence/data-sources");
    revalidatePath("/portfolio-intelligence");
    revalidatePath(`/investigators/${id.data}`);
    return { ok: true, message };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    if (isGatewayStatusMessage({ message: detail })) {
      return {
        ok: false,
        message:
          `PubMed refresh failed with “${detail}” from the Supabase gateway, which rejected the request before PostgREST saw it — usually an over-long request URL or body. Check pubmed_query_override on this investigator (it must be valid PubMed query syntax, not a URL), and if the table is new, confirm migrations 20260528120000 and 20260528130000 are applied.`,
      };
    }
    return { ok: false, message: detail };
  }
}

export async function refreshInvestigatorReporterFormAction(
  formData: FormData
): Promise<InvestigatorCacheRefreshResult> {
  const id = z.string().uuid().safeParse(formData.get("investigatorId"));
  if (!id.success) return { ok: false, message: "Invalid investigator" };
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Unauthorized" };
  try {
    const result = await refreshInvestigatorReporter(supabase, id.data);
    await syncInvestigatorCommunitySignalsFromCaches(supabase, id.data);
    revalidatePath("/portfolio-intelligence");
revalidatePath("/portfolio-intelligence/data-sources");
    revalidatePath("/portfolio-intelligence");
    revalidatePath(`/investigators/${id.data}`);
    if (result.skipped === "missing_nih_profile_id" && result.warning) {
      return { ok: false, message: result.warning };
    }
    return {
      ok: true,
      message: `NIH RePORTER refresh complete: ${result.inserted} project(s) cached.`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function refreshInvestigatorClinicalTrialsFormAction(
  formData: FormData
): Promise<InvestigatorCacheRefreshResult> {
  const id = z.string().uuid().safeParse(formData.get("investigatorId"));
  if (!id.success) return { ok: false, message: "Invalid investigator" };
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Unauthorized" };
  try {
    const result = await refreshInvestigatorClinicalTrials(supabase, id.data);
    await syncInvestigatorCommunitySignalsFromCaches(supabase, id.data);
    revalidatePath("/portfolio-intelligence");
revalidatePath("/portfolio-intelligence/data-sources");
    revalidatePath("/portfolio-intelligence");
    revalidatePath(`/investigators/${id.data}`);
    const warning = result.warning ? ` ${result.warning}` : "";
    return {
      ok: true,
      message: `ClinicalTrials.gov refresh complete: ${result.inserted} study/studies cached.${warning}`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function recomputeCommunityCollaborationsFormAction(): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  try {
    await recomputeCoauthorshipFromPublications(supabase);
    revalidatePath("/portfolio-intelligence");
revalidatePath("/portfolio-intelligence/data-sources");
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : String(e));
  }
}

/**
 * Admin-only: refresh PubMed + RePORTER for every investigator, then recompute co-authorship.
 * May hit serverless time limits with very large directories; use `npm run refresh-investigator-caches`
 * or POST /api/cron/refresh-investigator-caches in that case.
 */
export async function refreshAllInvestigatorCachesAdminAction(): Promise<{
  ok: boolean;
  message: string;
}> {
  const supabase = createClient();
  const admin = await requireAdmin(supabase);
  if (!admin.ok) {
    return { ok: false, message: admin.error };
  }
  const sr = createServiceRoleClient() ?? supabase;
  try {
    const result = await refreshAllInvestigatorsCommunityCaches(sr);
    revalidatePath("/portfolio-intelligence");
revalidatePath("/portfolio-intelligence/data-sources");
    revalidatePath("/investigators");
    return { ok: true, message: formatBulkRefreshSummary(result) };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Mirror local PubMed / RePORTER caches into community_source_items for dashboard charts. */
export async function syncCommunitySignalsFromCachesAction(): Promise<{
  ok: boolean;
  message: string;
}> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Unauthorized" };

  try {
    const result = await syncAllCommunitySignalsFromCaches(supabase);
    revalidatePath("/portfolio-intelligence");
revalidatePath("/portfolio-intelligence/data-sources");
    return { ok: true, message: formatSyncCommunitySignalsSummary(result) };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Admin-only: ingest UCSF News directly from UCSF sitemap URLs into community_source_items. */
export async function ingestUcsfNewsFromSitemapsAction(params?: {
  maxItems?: number;
  sinceYear?: number | null;
  linkToWatchlist?: boolean;
  linkMaxItems?: number;
}): Promise<{
  ok: boolean;
  message: string;
}> {
  const supabase = createClient();
  const admin = await requireAdmin(supabase);
  if (!admin.ok) return { ok: false, message: admin.error };

  const sr = createServiceRoleClient() ?? supabase;
  try {
    const result = await ingestUcsfNewsFromSitemaps(sr, {
      maxItems: params?.maxItems,
      sinceYear: params?.sinceYear ?? null,
    });
    const lines = [
      `Sitemaps crawled: ${result.crawledSitemaps}`,
      `UCSF News URLs discovered: ${result.discoveredNewsUrls}`,
      `URLs selected: ${result.selectedNewsUrls}`,
      `Rows upserted: ${result.upserted}`,
      `Rows failed: ${result.failed}`,
      result.errors.length > 0 ? `Sample error: ${result.errors[0]}` : null,
    ];

    if (params?.linkToWatchlist !== false && result.upserted > 0) {
      const linkCap = Math.max(
        1,
        Math.min(result.upserted, params?.linkMaxItems ?? 500)
      );
      const linkResult = await linkUcsfNewsItemsToWatchlist(sr, {
        maxItems: linkCap,
        onlyUnlinked: true,
        fetchArticleBodies: true,
      });
      lines.push("", "Watchlist linking:", formatLinkUcsfNewsSummary(linkResult));
      if (result.upserted > linkCap) {
        lines.push(
          `Note: only the first ${linkCap} unlinked rows were matched this run. Use "Link to watchlist" for the rest.`
        );
      }
    }

    revalidatePath("/portfolio-intelligence");
revalidatePath("/portfolio-intelligence/data-sources");
    revalidatePath("/portfolio-intelligence");
    return {
      ok: true,
      message: lines.filter(Boolean).join("\n"),
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Admin-only: match UCSF News rows against watchlist names and write entity links. */
export async function linkUcsfNewsToWatchlistAction(params?: {
  maxItems?: number;
  onlyUnlinked?: boolean;
  fetchArticleBodies?: boolean;
}): Promise<{ ok: boolean; message: string }> {
  const supabase = createClient();
  const admin = await requireAdmin(supabase);
  if (!admin.ok) return { ok: false, message: admin.error };

  const sr = createServiceRoleClient() ?? supabase;
  try {
    const result = await linkUcsfNewsItemsToWatchlist(sr, {
      maxItems: params?.maxItems ?? 2000,
      onlyUnlinked: params?.onlyUnlinked ?? true,
      fetchArticleBodies: params?.fetchArticleBodies ?? true,
    });
    revalidatePath("/portfolio-intelligence");
revalidatePath("/portfolio-intelligence/data-sources");
    revalidatePath("/portfolio-intelligence");
    return { ok: true, message: formatLinkUcsfNewsSummary(result) };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
