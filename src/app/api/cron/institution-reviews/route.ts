import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron/authorize-cron-request";
import { fmtMonDY, isoToday } from "@/lib/funding-opportunities/receipt-cycles";
import { sendCuratedNeedsReviewEmail, sendReviewReminderEmail } from "@/lib/institution/emails";
import { createServiceRoleClient } from "@/lib/supabase/admin-service";

export const maxDuration = 120;

/**
 * Daily: curated records and overlays past review-by → one "Needs review"
 * email to the verifier; published library items past review due → one
 * reminder to the uploader every 30 days.
 */
async function handle(req: Request) {
  const denied = authorizeCronRequest(req);
  if (denied) return denied;
  const db = createServiceRoleClient();
  if (!db) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY not configured" }, { status: 503 });
  const today = isoToday();
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
  let curated = 0;
  let overlays = 0;
  let reminders = 0;

  const { data: recs } = await db.from("curated_opportunities").select("id, title, review_by, verified_by, created_by").eq("status", "published").is("deleted_at", null).lt("review_by", today).is("needs_review_notified_at", null).limit(50);
  for (const r of (recs ?? []) as Array<{ id: string; title: string; review_by: string; verified_by: string | null; created_by: string | null }>) {
    const email = await emailFor(db, r.verified_by ?? r.created_by);
    if (email) await sendCuratedNeedsReviewEmail({ to: email, title: r.title, kind: "internal", reviewBy: fmtMonDY(r.review_by), editPath: `/curate?id=${r.id}` });
    await db.from("curated_opportunities").update({ needs_review_notified_at: new Date().toISOString() }).eq("id", r.id);
    curated += 1;
  }
  const { data: ovs } = await db.from("limited_submission_overlays").select("id, review_by, verified_by, created_by, funding_opportunities(title), curated_opportunities(title)").eq("status", "published").is("deleted_at", null).lt("review_by", today).is("needs_review_notified_at", null).limit(50);
  for (const o of (ovs ?? []) as Array<Record<string, unknown>>) {
    const fo = (Array.isArray(o.funding_opportunities) ? o.funding_opportunities[0] : o.funding_opportunities) as { title?: string } | null;
    const cu = (Array.isArray(o.curated_opportunities) ? o.curated_opportunities[0] : o.curated_opportunities) as { title?: string } | null;
    const email = await emailFor(db, (o.verified_by as string | null) ?? (o.created_by as string | null));
    if (email) await sendCuratedNeedsReviewEmail({ to: email, title: String(fo?.title ?? cu?.title ?? "Limited submission"), kind: "limited", reviewBy: fmtMonDY(String(o.review_by)), editPath: `/curate?kind=limited&id=${String(o.id)}` });
    await db.from("limited_submission_overlays").update({ needs_review_notified_at: new Date().toISOString() }).eq("id", String(o.id));
    overlays += 1;
  }
  const { data: items } = await db.from("library_items").select("id, title, review_due, uploader_id, reminder_sent_at").eq("review_status", "published").is("removed_at", null).lt("review_due", today).or(`reminder_sent_at.is.null,reminder_sent_at.lt.${monthAgo}`).limit(50);
  for (const it of (items ?? []) as Array<{ id: string; title: string; review_due: string; uploader_id: string | null }>) {
    const email = await emailFor(db, it.uploader_id);
    if (email) {
      const r = await sendReviewReminderEmail({ to: email, title: it.title, reviewDue: fmtMonDY(it.review_due), itemId: it.id });
      if (r.ok) {
        await db.from("library_items").update({ reminder_sent_at: new Date().toISOString() }).eq("id", it.id);
        await db.from("library_item_events").insert({ item_id: it.id, kind: "reminder_sent", text: "Review date passed · reminder sent to uploader" });
        reminders += 1;
      }
    } else {
      await db.from("library_items").update({ reminder_sent_at: new Date().toISOString() }).eq("id", it.id);
    }
  }
  await db.from("sync_job_logs").insert({ job_type: "institution_reviews", status: "success", message: `${curated} internal records and ${overlays} overlays flagged Needs review · ${reminders} library reminders sent`, details: { curated, overlays, reminders }, finished_at: new Date().toISOString() });
  return NextResponse.json({ ok: true, curated, overlays, reminders });
}

async function emailFor(db: NonNullable<ReturnType<typeof createServiceRoleClient>>, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data } = await db.from("profiles").select("email").eq("id", userId).maybeSingle();
  return (data as { email?: string | null } | null)?.email ?? null;
}

export async function GET(req: Request) {
  return handle(req);
}
export async function POST(req: Request) {
  return handle(req);
}
