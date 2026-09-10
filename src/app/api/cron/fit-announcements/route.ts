import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron/authorize-cron-request";
import type { FunderFamily } from "@/lib/ingestion/announcement/registry";
import { syncAnnouncements, type AnnouncementSyncParams } from "@/lib/services/announcement-sync";
import { createServiceRoleClient } from "@/lib/supabase/admin-service";

export const maxDuration = 300;

const FAMILIES: FunderFamily[] = ["hhs_other", "nsf", "dod_cdmrp", "doe", "other_federal", "foundation", "internal"];

/**
 * Daily 08:50 UTC (vercel.json), between the Simpler sync (08:00, which posts
 * the new notices) and fit-opportunity-profiles (09:15, which reads the text):
 * read the full announcement for open, posted, **non-NIH** notices through the
 * PR 5.3–5.5 adapters and store the sectioned text.
 *
 * `/api/cron/sync-nih-guide` (08:30) owns the NIH corpus and this route may
 * never touch it — `syncAnnouncements` refuses `families: ['nih']` and
 * `planAnnouncementFetch` drops every NIH-corpus row before any adapter runs
 * (NON_NIH_PLAN.md § The NIH invariant).
 *
 * Storing text changes no fit result today: the profile builder's candidate
 * query still requires NIH_NOTICE_FILTER, so these notices are still not
 * profiled and still not scored. PR 5.6 is what opens that gate.
 *
 * Vercel Cron uses GET; manual runs may POST { limit?, timeBudgetMs?, families?,
 * opportunityNumbers?, force?, dryRun?, refreshAfterDays?, retryAfterDays?,
 * minIntervalMs?, programPage? }. 400 on a malformed family.
 * Headers: Authorization: Bearer <CRON_SECRET>
 */
async function handle(req: Request) {
  const denied = authorizeCronRequest(req);
  if (denied) return denied;

  const supabase = createServiceRoleClient();
  if (!supabase) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 503 });

  const params: AnnouncementSyncParams = {};
  if (req.method === "POST") {
    let body: Record<string, unknown> = {};
    try {
      body = ((await req.json()) ?? {}) as Record<string, unknown>;
    } catch {
      /* no body */
    }
    if (body.families !== undefined && body.families !== null) {
      if (!Array.isArray(body.families)) return NextResponse.json({ ok: false, error: "families must be an array" }, { status: 400 });
      const bad = body.families.filter((f) => !FAMILIES.includes(f as FunderFamily));
      // 'nih' lands here rather than in the service's own refusal, so the
      // caller gets a 400 naming it instead of a 500-shaped result.
      if (bad.length) return NextResponse.json({ ok: false, error: `families must be one of ${FAMILIES.join(" | ")}; rejected ${bad.map(String).join(", ")}` }, { status: 400 });
      params.families = body.families as FunderFamily[];
    }
    if (typeof body.limit === "number") params.limit = Math.min(Math.max(1, Math.floor(body.limit)), 500);
    if (typeof body.timeBudgetMs === "number") params.timeBudgetMs = Math.min(Math.max(1_000, Math.floor(body.timeBudgetMs)), 280_000);
    if (typeof body.refreshAfterDays === "number") params.refreshAfterDays = Math.max(0, Math.floor(body.refreshAfterDays));
    if (typeof body.retryAfterDays === "number") params.retryAfterDays = Math.max(0, Math.floor(body.retryAfterDays));
    if (typeof body.minIntervalMs === "number") params.minIntervalMs = Math.max(700, Math.floor(body.minIntervalMs));
    if (typeof body.programPage === "boolean") params.programPage = body.programPage;
    if (Array.isArray(body.opportunityNumbers)) params.opportunityNumbers = body.opportunityNumbers.filter((n): n is string => typeof n === "string").slice(0, 200);
    params.force = Boolean(body.force);
    params.dryRun = Boolean(body.dryRun);
  }

  const result = await syncAnnouncements(supabase, params);
  if (!result.ok) return NextResponse.json(result, { status: 500 });
  return NextResponse.json(result);
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
