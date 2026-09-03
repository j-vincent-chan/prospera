"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isoToday } from "@/lib/funding-opportunities/receipt-cycles";
import { logAudit } from "@/lib/institution/audit";
import { CURATED_COLUMNS, OVERLAY_COLUMNS, searchCatalogNotices, type CuratedRecord, type NoticeSummary, type OverlayRecord } from "@/lib/institution/curated";
import { requireInstitutionRole } from "@/lib/institution/roles";
import { derivedStatus } from "@/lib/institution/types";

type Ok<T> = { ok: true } & T;
type Fail = { ok: false; error: string };
type Result<T = Record<never, never>> = Ok<T> | Fail;

function revalidate() {
  revalidatePath("/opportunities");
  revalidatePath("/curate");
  revalidatePath("/home");
  revalidatePath("/calendar");
  revalidatePath("/team/data-sources");
}

const optionalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
const sourceKind = z.enum(["program_office", "rap", "infoready", "email", "sponsor_site"]).nullable().optional();

const curatedInput = z.object({
  id: z.string().uuid().optional(),
  kind: z.enum(["internal", "nonfederal"]).default("internal"),
  title: z.string().trim().min(3, "Give the program a title.").max(240),
  funder: optionalText(200),
  award_summary: optionalText(200),
  application_due: optionalDate,
  loi_due: optionalDate,
  eligibility: optionalText(4000),
  review_process: z.enum(["committee_scored", "program_director", "external_reviewers"]).nullable().optional(),
  contact_name: optionalText(120),
  contact_email: optionalText(200),
  program_url: optionalText(600),
  sponsor_notice_number: optionalText(80),
  source_kind: sourceKind,
  source_url: optionalText(600),
  review_by: optionalDate,
});
export type CuratedInput = z.input<typeof curatedInput>;

function provenanceMissing(v: { source_kind?: string | null; source_url?: string | null; review_by?: string | null }): string | null {
  const missing = [!v.source_kind ? "source" : null, !v.source_url ? "source link" : null, !v.review_by ? "review-by date" : null].filter(Boolean);
  return missing.length ? `Publishing requires ${missing.join(", ")}.` : null;
}

/** Save a curated Internal / non-federal record. `publish` requires provenance; verified-by becomes the actor. */
export async function saveCuratedAction(raw: CuratedInput, opts: { publish: boolean }): Promise<Result<{ id: string; status: "draft" | "published"; message: string }>> {
  const guard = await requireInstitutionRole("curator");
  if (!guard.ok) return guard;
  const parsed = curatedInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const v = parsed.data;
  if (opts.publish) {
    const miss = provenanceMissing(v);
    if (miss) return { ok: false, error: miss };
    if (v.kind === "internal" && !v.application_due) return { ok: false, error: "Publishing an internal program needs an application due date." };
  }
  const now = new Date().toISOString();
  const { admin, actor } = guard;
  const base = {
    kind: v.kind,
    title: v.title,
    funder: v.funder ?? null,
    award_summary: v.award_summary ?? null,
    application_due: v.application_due ?? null,
    loi_due: v.loi_due ?? null,
    eligibility: v.eligibility ?? null,
    review_process: v.review_process ?? null,
    contact_name: v.contact_name ?? null,
    contact_email: v.contact_email ?? null,
    program_url: v.program_url ?? null,
    sponsor_notice_number: v.sponsor_notice_number ?? null,
    source_kind: v.source_kind ?? null,
    source_url: v.source_url ?? null,
    review_by: v.review_by ?? null,
    updated_at: now,
    ...(opts.publish ? { status: "published", published_at: now, published_by: actor.userId, verified_by: actor.userId, verified_by_name: actor.fullName ?? actor.email, verified_at: now, needs_review_notified_at: null } : {}),
  };
  let id = v.id ?? null;
  if (id) {
    const { error } = await admin.from("curated_opportunities").update(base).eq("id", id).is("deleted_at", null);
    if (error) return { ok: false, error: error.message };
  } else {
    const { data, error } = await admin.from("curated_opportunities").insert({ ...base, status: opts.publish ? "published" : "draft", created_by: actor.userId, created_by_name: actor.fullName ?? actor.email }).select("id").single();
    if (error || !data) return { ok: false, error: error?.message ?? "Could not save." };
    id = (data as { id: string }).id;
  }
  await logAudit(admin, { entityType: "curated_opportunity", entityId: id, action: opts.publish ? "publish" : v.id ? "save_draft" : "create_draft", actorId: actor.userId, actorName: actor.fullName, details: { title: v.title, kind: v.kind } });
  revalidate();
  const scope = v.kind === "internal" ? "Internal (UCSF)" : "Limited submissions";
  return { ok: true, id, status: opts.publish ? "published" : "draft", message: opts.publish ? `Published to the ${scope} scope · logged to the audit trail` : "Draft saved · visible to curators only" };
}

export async function unpublishCuratedAction(input: { id: string }): Promise<Result<{ message: string }>> {
  const guard = await requireInstitutionRole("curator");
  if (!guard.ok) return guard;
  const { error } = await guard.admin.from("curated_opportunities").update({ status: "draft", updated_at: new Date().toISOString() }).eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  await logAudit(guard.admin, { entityType: "curated_opportunity", entityId: input.id, action: "unpublish", actorId: guard.actor.userId, actorName: guard.actor.fullName });
  revalidate();
  return { ok: true, message: "Unpublished · back to draft" };
}

/** Re-verify without editing: stamps verified-by/at and pushes review-by forward a year (curator can edit after). */
export async function reverifyCuratedAction(input: { id: string; reviewBy: string }): Promise<Result> {
  const guard = await requireInstitutionRole("curator");
  if (!guard.ok) return guard;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.reviewBy)) return { ok: false, error: "Pick a review-by date." };
  const now = new Date().toISOString();
  const { error } = await guard.admin.from("curated_opportunities").update({ verified_by: guard.actor.userId, verified_by_name: guard.actor.fullName ?? guard.actor.email, verified_at: now, review_by: input.reviewBy, needs_review_notified_at: null, updated_at: now }).eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  await logAudit(guard.admin, { entityType: "curated_opportunity", entityId: input.id, action: "reverify", actorId: guard.actor.userId, actorName: guard.actor.fullName, details: { review_by: input.reviewBy } });
  revalidate();
  return { ok: true };
}

export async function deleteCuratedAction(input: { id: string }): Promise<Result> {
  const guard = await requireInstitutionRole("curator");
  if (!guard.ok) return guard;
  const { error } = await guard.admin.from("curated_opportunities").update({ deleted_at: new Date().toISOString(), deleted_by: guard.actor.userId }).eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  await logAudit(guard.admin, { entityType: "curated_opportunity", entityId: input.id, action: "delete", actorId: guard.actor.userId, actorName: guard.actor.fullName });
  revalidate();
  return { ok: true };
}

export async function restoreCuratedAction(input: { id: string }): Promise<Result> {
  const guard = await requireInstitutionRole("curator");
  if (!guard.ok) return guard;
  const { error } = await guard.admin.from("curated_opportunities").update({ deleted_at: null, deleted_by: null }).eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  await logAudit(guard.admin, { entityType: "curated_opportunity", entityId: input.id, action: "restore", actorId: guard.actor.userId, actorName: guard.actor.fullName });
  revalidate();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Limited-submission overlays
// ---------------------------------------------------------------------------

const overlayInput = z.object({
  id: z.string().uuid().optional(),
  opportunity_id: z.string().uuid().nullable().optional(),
  curated_opportunity_id: z.string().uuid().nullable().optional(),
  /** Inline creation of a curated non-federal notice when the sponsor is not in the catalog. */
  nonfederal: z.object({ title: z.string().trim().min(3).max(240), funder: optionalText(200), application_due: optionalDate, sponsor_notice_number: optionalText(80), program_url: optionalText(600) }).nullable().optional(),
  internal_due: optionalDate,
  cap: z.number().int().min(0).max(99).nullable().optional(),
  nominated_count: z.number().int().min(0).max(999).default(0),
  process: optionalText(4000),
  infoready_url: optionalText(600),
  source_kind: sourceKind,
  source_url: optionalText(600),
  review_by: optionalDate,
});
export type OverlayInput = z.input<typeof overlayInput>;

export async function saveOverlayAction(raw: OverlayInput, opts: { publish: boolean }): Promise<Result<{ id: string; status: "draft" | "published"; message: string }>> {
  const guard = await requireInstitutionRole("curator");
  if (!guard.ok) return guard;
  const parsed = overlayInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const v = parsed.data;
  const { admin, actor } = guard;
  const now = new Date().toISOString();
  let curatedId = v.curated_opportunity_id ?? null;
  if (!v.opportunity_id && !curatedId && v.nonfederal) {
    const { data, error } = await admin.from("curated_opportunities").insert({ kind: "nonfederal", title: v.nonfederal.title, funder: v.nonfederal.funder ?? null, application_due: v.nonfederal.application_due ?? null, sponsor_notice_number: v.nonfederal.sponsor_notice_number ?? null, program_url: v.nonfederal.program_url ?? null, source_kind: v.source_kind ?? null, source_url: v.source_url ?? null, review_by: v.review_by ?? null, status: opts.publish ? "published" : "draft", ...(opts.publish ? { published_at: now, published_by: actor.userId, verified_by: actor.userId, verified_by_name: actor.fullName ?? actor.email, verified_at: now } : {}), created_by: actor.userId, created_by_name: actor.fullName ?? actor.email }).select("id").single();
    if (error || !data) return { ok: false, error: error?.message ?? "Could not create the curated notice." };
    curatedId = (data as { id: string }).id;
  } else if (curatedId && v.nonfederal) {
    await admin.from("curated_opportunities").update({ title: v.nonfederal.title, funder: v.nonfederal.funder ?? null, application_due: v.nonfederal.application_due ?? null, sponsor_notice_number: v.nonfederal.sponsor_notice_number ?? null, program_url: v.nonfederal.program_url ?? null, source_kind: v.source_kind ?? null, source_url: v.source_url ?? null, review_by: v.review_by ?? null, updated_at: now, ...(opts.publish ? { status: "published", published_at: now, published_by: actor.userId, verified_by: actor.userId, verified_by_name: actor.fullName ?? actor.email, verified_at: now } : {}) }).eq("id", curatedId);
  }
  if (!v.opportunity_id && !curatedId) return { ok: false, error: "Pick a synced sponsor notice, or create a curated non-federal notice." };
  if (opts.publish) {
    const miss = provenanceMissing(v);
    if (miss) return { ok: false, error: miss };
    if (!v.internal_due) return { ok: false, error: "Publishing an overlay needs the internal nomination due date." };
  }
  const base = {
    opportunity_id: v.opportunity_id ?? null,
    curated_opportunity_id: v.opportunity_id ? null : curatedId,
    internal_due: v.internal_due ?? null,
    cap: v.cap ?? null,
    nominated_count: v.nominated_count,
    process: v.process ?? null,
    infoready_url: v.infoready_url ?? null,
    source_kind: v.source_kind ?? null,
    source_url: v.source_url ?? null,
    review_by: v.review_by ?? null,
    updated_at: now,
    ...(opts.publish ? { status: "published", published_at: now, published_by: actor.userId, verified_by: actor.userId, verified_by_name: actor.fullName ?? actor.email, verified_at: now, needs_review_notified_at: null } : {}),
  };
  let id = v.id ?? null;
  if (id) {
    const { error } = await admin.from("limited_submission_overlays").update(base).eq("id", id).is("deleted_at", null);
    if (error) return { ok: false, error: error.message };
  } else {
    const { data, error } = await admin.from("limited_submission_overlays").insert({ ...base, status: opts.publish ? "published" : "draft", created_by: actor.userId, created_by_name: actor.fullName ?? actor.email }).select("id").single();
    if (error || !data) return { ok: false, error: /limited_overlays_(opportunity|curated)_uniq/.test(error?.message ?? "") ? "That notice already has an overlay. Edit the existing one instead." : error?.message ?? "Could not save." };
    id = (data as { id: string }).id;
  }
  await logAudit(admin, { entityType: "limited_submission_overlay", entityId: id, action: opts.publish ? "publish" : v.id ? "save_draft" : "create_draft", actorId: actor.userId, actorName: actor.fullName, details: { opportunity_id: v.opportunity_id ?? null, curated_opportunity_id: curatedId } });
  revalidate();
  if (v.opportunity_id) revalidatePath(`/opportunities/${v.opportunity_id}`);
  return { ok: true, id, status: opts.publish ? "published" : "draft", message: opts.publish ? "Published to the Limited submissions scope · logged to the audit trail" : "Draft saved · visible to curators only" };
}

export async function unpublishOverlayAction(input: { id: string }): Promise<Result<{ message: string }>> {
  const guard = await requireInstitutionRole("curator");
  if (!guard.ok) return guard;
  const { error } = await guard.admin.from("limited_submission_overlays").update({ status: "draft", updated_at: new Date().toISOString() }).eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  await logAudit(guard.admin, { entityType: "limited_submission_overlay", entityId: input.id, action: "unpublish", actorId: guard.actor.userId, actorName: guard.actor.fullName });
  revalidate();
  return { ok: true, message: "Unpublished · back to draft" };
}

export async function deleteOverlayAction(input: { id: string }): Promise<Result> {
  const guard = await requireInstitutionRole("curator");
  if (!guard.ok) return guard;
  const { error } = await guard.admin.from("limited_submission_overlays").update({ deleted_at: new Date().toISOString(), deleted_by: guard.actor.userId }).eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  await logAudit(guard.admin, { entityType: "limited_submission_overlay", entityId: input.id, action: "delete", actorId: guard.actor.userId, actorName: guard.actor.fullName });
  revalidate();
  return { ok: true };
}

export async function restoreOverlayAction(input: { id: string }): Promise<Result> {
  const guard = await requireInstitutionRole("curator");
  if (!guard.ok) return guard;
  const { error } = await guard.admin.from("limited_submission_overlays").update({ deleted_at: null, deleted_by: null }).eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}

/** Any signed-in member can express (or withdraw) interest in a published overlay. */
export async function setLimitedInterestAction(input: { overlayId: string; interested: boolean; note?: string | null }): Promise<Result<{ interestCount: number }>> {
  const guard = await requireInstitutionRole(null);
  if (!guard.ok) return guard;
  const { admin, actor } = guard;
  const { data: ov } = await admin.from("limited_submission_overlays").select(OVERLAY_COLUMNS).eq("id", input.overlayId).is("deleted_at", null).maybeSingle();
  if (!ov) return { ok: false, error: "That overlay no longer exists." };
  const o = ov as OverlayRecord;
  const today = isoToday();
  if (input.interested) {
    if (derivedStatus({ status: o.status, review_by: o.review_by }, today) !== "published") return { ok: false, error: "This overlay isn't published." };
    if (o.internal_due && o.internal_due < today) return { ok: false, error: "The internal nomination deadline has passed." };
    const { error } = await admin.from("limited_submission_interests").upsert({ overlay_id: o.id, user_id: actor.userId, team_id: actor.teamId, note: input.note?.trim() || null, withdrawn_at: null, created_at: new Date().toISOString() }, { onConflict: "overlay_id,user_id" });
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await admin.from("limited_submission_interests").update({ withdrawn_at: new Date().toISOString() }).eq("overlay_id", o.id).eq("user_id", actor.userId);
    if (error) return { ok: false, error: error.message };
  }
  const { count } = await admin.from("limited_submission_interests").select("id", { count: "exact", head: true }).eq("overlay_id", o.id).is("withdrawn_at", null);
  await admin.from("limited_submission_overlays").update({ interest_count: count ?? 0 }).eq("id", o.id);
  revalidate();
  if (o.opportunity_id) revalidatePath(`/opportunities/${o.opportunity_id}`);
  return { ok: true, interestCount: count ?? 0 };
}

export async function searchCatalogAction(input: { q: string }): Promise<Result<{ notices: NoticeSummary[] }>> {
  const guard = await requireInstitutionRole("curator");
  if (!guard.ok) return guard;
  const notices = await searchCatalogNotices(guard.session, input.q, isoToday());
  return { ok: true, notices };
}

export async function loadCuratedForEditAction(input: { id: string }): Promise<Result<{ record: CuratedRecord }>> {
  const guard = await requireInstitutionRole("curator");
  if (!guard.ok) return guard;
  const { data } = await guard.admin.from("curated_opportunities").select(CURATED_COLUMNS).eq("id", input.id).is("deleted_at", null).maybeSingle();
  if (!data) return { ok: false, error: "Record not found." };
  return { ok: true, record: data as CuratedRecord };
}
