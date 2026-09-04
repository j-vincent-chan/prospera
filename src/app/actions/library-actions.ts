"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fmtMonDY, isoToday } from "@/lib/funding-opportunities/receipt-cycles";
import { logAudit } from "@/lib/institution/audit";
import { sendFlagEmail, sendStewardDecisionEmail } from "@/lib/institution/emails";
import { LIBRARY_MAX_BYTES, LIBRARY_MIME, embedLibraryItem, excerptOf, extractDocumentText, scanSensitive, suggestTags, summarizeFindings, type LibraryItemRecord, type SensitiveFindings } from "@/lib/institution/library";
import { requireInstitutionRole } from "@/lib/institution/roles";
import { FLAG_REASONS, type ContentType, type FlagReason } from "@/lib/institution/types";

type Ok<T> = { ok: true } & T;
type Fail = { ok: false; error: string };
type Result<T = Record<never, never>> = Ok<T> | Fail;

function revalidate() {
  revalidatePath("/library");
  revalidatePath("/library/queue");
  revalidatePath("/library/awards");
  revalidatePath("/team/data-sources");
}

async function event(admin: Parameters<typeof logAudit>[0], itemId: string, kind: string, text: string, actor: { userId: string; fullName: string | null; email: string | null }) {
  await admin.from("library_item_events").insert({ item_id: itemId, kind, text, actor_id: actor.userId, actor_name: actor.fullName ?? actor.email });
}

const metadata = z.object({
  title: z.string().trim().min(3, "Give the item a title.").max(240),
  content_type: z.enum(["institutional_description", "specific_aims", "research_strategy", "dms_plan", "letter_of_support", "budget_justification", "human_subjects"]),
  outcome: z.enum(["funded", "not_funded", "template"]).nullable().optional(),
  sponsor: z.string().trim().max(80).nullable().optional(),
  mechanism: z.string().trim().max(20).nullable().optional(),
  department: z.string().trim().max(120).nullable().optional(),
  funding_year: z.string().trim().max(12).nullable().optional(),
  linked_award_number: z.string().trim().max(40).nullable().optional(),
  review_due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
});

/**
 * Step 1 of the upload flow: stash the file, extract text, scan for sensitive
 * content. Creates the item as a draft owned by the uploader (only they and
 * stewards can see it) so steps 2–3 only patch metadata.
 */
export async function stageLibraryUploadAction(formData: FormData): Promise<Result<{ itemId: string; findings: SensitiveFindings; findingsLine: string | null; excerpt: string; extractionError: string | null; suggestedTitle: string }>> {
  const guard = await requireInstitutionRole(null);
  if (!guard.ok) return guard;
  const file = formData.get("file");
  const contentType = String(formData.get("content_type") ?? "");
  if (contentType === "rates") return { ok: false, error: "Rates and required language can't be uploaded. They come from OSR's rate agreement." };
  if (!(file instanceof File)) return { ok: false, error: "Choose a PDF or Word file." };
  if (file.size > LIBRARY_MAX_BYTES) return { ok: false, error: "Files must be 25 MB or smaller." };
  const mime = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : file.name.toLowerCase().endsWith(".docx") ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "");
  if (!LIBRARY_MIME.has(mime)) return { ok: false, error: "Only PDF and Word (.docx) files are accepted." };
  const { admin, actor } = guard;
  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = mime === "application/pdf" ? "pdf" : mime.endsWith("document") ? "docx" : "doc";
  const storagePath = `${actor.userId}/${randomBytes(8).toString("hex")}.${ext}`;
  const { error: upErr } = await admin.storage.from("library").upload(storagePath, buffer, { contentType: mime, upsert: false });
  if (upErr) return { ok: false, error: `Upload failed: ${upErr.message}` };
  const extracted = await extractDocumentText(buffer, mime);
  const findings = scanSensitive(extracted.text);
  const excerpt = excerptOf(extracted.text);
  const suggestedTitle = file.name.replace(/\.(pdf|docx?)$/i, "").replace(/[_-]+/g, " ").trim().slice(0, 120);
  const type = (["institutional_description", "specific_aims", "research_strategy", "dms_plan", "letter_of_support", "budget_justification", "human_subjects"].includes(contentType) ? contentType : "research_strategy") as ContentType;
  const { data, error } = await admin
    .from("library_items")
    .insert({ title: suggestedTitle || "Untitled upload", content_type: type, trust_tier: "community", uploader_id: actor.userId, uploader_name: actor.fullName ?? actor.email, uploader_department: actor.department, review_status: "pending_review", excerpt, extracted_text: extracted.text || null, sensitive_findings: findings, storage_path: storagePath, file_name: file.name.slice(0, 200), file_size: file.size, mime_type: mime, review_due: `${Number(isoToday().slice(0, 4)) + 1}${isoToday().slice(4)}` })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not create the item." };
  const itemId = (data as { id: string }).id;
  await admin.from("library_item_versions").insert({ item_id: itemId, version: 1, storage_path: storagePath, file_name: file.name.slice(0, 200), file_size: file.size, mime_type: mime, uploaded_by: actor.userId, uploaded_by_name: actor.fullName ?? actor.email });
  await event(admin, itemId, "uploaded", "Uploaded", actor);
  return { ok: true, itemId, findings, findingsLine: summarizeFindings(findings), excerpt, extractionError: extracted.error, suggestedTitle };
}

/** Step 2: describe it. */
export async function describeLibraryUploadAction(input: { itemId: string } & z.input<typeof metadata>): Promise<Result> {
  const guard = await requireInstitutionRole(null);
  if (!guard.ok) return guard;
  const parsed = metadata.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const v = parsed.data;
  const { admin, actor } = guard;
  const { data: item } = await admin.from("library_items").select("id, uploader_id, review_status").eq("id", input.itemId).maybeSingle();
  const it = item as { id: string; uploader_id: string | null; review_status: string } | null;
  if (!it || (it.uploader_id !== actor.userId && !actor.roles.includes("library_steward"))) return { ok: false, error: "You can only edit your own uploads." };
  const tags = v.tags?.length ? v.tags : suggestTags({ content_type: v.content_type, sponsor: v.sponsor ?? null, mechanism: v.mechanism ?? null, outcome: v.outcome ?? null, linked_award_number: v.linked_award_number ?? null });
  const { error } = await admin.from("library_items").update({ title: v.title, content_type: v.content_type, outcome: v.outcome ?? null, sponsor: v.sponsor || null, mechanism: v.mechanism || null, department: v.department || null, funding_year: v.funding_year || null, linked_award_number: v.linked_award_number || null, review_due: v.review_due, tags, updated_at: new Date().toISOString() }).eq("id", input.itemId);
  if (error) return { ok: false, error: error.message };
  if (it.review_status === "published") await event(admin, input.itemId, "metadata_updated", "Details updated", actor);
  return { ok: true };
}

/** Step 3: visibility + consent. */
export async function finishLibraryUploadAction(input: { itemId: string; visibility: "review" | "publish"; consent: boolean }): Promise<Result<{ status: "pending_review" | "published"; ahead: number; message: string }>> {
  const guard = await requireInstitutionRole(null);
  if (!guard.ok) return guard;
  if (!input.consent) return { ok: false, error: "Please confirm you have the right to share this document." };
  const { admin, actor } = guard;
  const { data: item } = await admin.from("library_items").select("id, uploader_id, title, content_type").eq("id", input.itemId).maybeSingle();
  const it = item as { id: string; uploader_id: string | null; title: string; content_type: ContentType } | null;
  if (!it || it.uploader_id !== actor.userId) return { ok: false, error: "You can only submit your own uploads." };
  const now = new Date().toISOString();
  const publish = input.visibility === "publish";
  const { error } = await admin.from("library_items").update({ consent_at: now, review_status: publish ? "published" : "pending_review", ...(publish ? { last_confirmed_at: now, last_confirmed_by: actor.userId, last_confirmed_by_name: actor.fullName ?? actor.email } : {}), updated_at: now }).eq("id", input.itemId);
  if (error) return { ok: false, error: error.message };
  await event(admin, input.itemId, publish ? "published" : "submitted_for_review", publish ? "Published" : "Uploaded for review", actor);
  const { count } = await admin.from("library_items").select("id", { count: "exact", head: true }).eq("review_status", "pending_review").is("removed_at", null).lt("created_at", now).neq("id", input.itemId);
  void embedLibraryItem(admin, input.itemId);
  revalidate();
  return { ok: true, status: publish ? "published" : "pending_review", ahead: count ?? 0, message: publish ? "Published to all of UCSF" : "Upload is in the steward queue" };
}

/** Abandoning the flow before consent removes the staged draft and its file. */
export async function discardLibraryUploadAction(input: { itemId: string }): Promise<Result> {
  const guard = await requireInstitutionRole(null);
  if (!guard.ok) return guard;
  const { admin, actor } = guard;
  const { data: item } = await admin.from("library_items").select("id, uploader_id, consent_at, storage_path").eq("id", input.itemId).maybeSingle();
  const it = item as { id: string; uploader_id: string | null; consent_at: string | null; storage_path: string | null } | null;
  if (!it || it.uploader_id !== actor.userId || it.consent_at) return { ok: true };
  if (it.storage_path) await admin.storage.from("library").remove([it.storage_path]);
  await admin.from("library_items").delete().eq("id", input.itemId);
  return { ok: true };
}

export async function getLibraryDownloadUrlAction(input: { itemId: string }): Promise<Result<{ url: string; fileName: string }>> {
  const guard = await requireInstitutionRole(null);
  if (!guard.ok) return guard;
  const { session, admin } = guard;
  const { data: item } = await session.from("library_items").select("id, storage_path, file_name").eq("id", input.itemId).maybeSingle();
  const it = item as { id: string; storage_path: string | null; file_name: string | null } | null;
  if (!it?.storage_path) return { ok: false, error: "No file is attached to this item." };
  const { data, error } = await admin.storage.from("library").createSignedUrl(it.storage_path, 60 * 30, { download: it.file_name ?? undefined });
  if (error || !data) return { ok: false, error: error?.message ?? "Could not sign the download." };
  await admin.rpc("increment_library_download", { p_item_id: it.id }).then(async (r) => {
    if (r.error) {
      const { data: cur } = await admin.from("library_items").select("download_count").eq("id", it.id).maybeSingle();
      await admin.from("library_items").update({ download_count: ((cur as { download_count: number } | null)?.download_count ?? 0) + 1 }).eq("id", it.id);
    }
  });
  return { ok: true, url: data.signedUrl, fileName: it.file_name ?? "document" };
}

/** Uploader or steward re-confirms accuracy; review due moves a year out. */
export async function confirmLibraryItemAction(input: { itemId: string }): Promise<Result<{ reviewDue: string; message: string }>> {
  const guard = await requireInstitutionRole(null);
  if (!guard.ok) return guard;
  const { admin, actor } = guard;
  const { data: item } = await admin.from("library_items").select("id, uploader_id, review_due").eq("id", input.itemId).maybeSingle();
  const it = item as { id: string; uploader_id: string | null; review_due: string | null } | null;
  if (!it) return { ok: false, error: "Item not found." };
  if (it.uploader_id !== actor.userId && !actor.roles.includes("library_steward")) return { ok: false, error: "Only the uploader or a steward can confirm this item." };
  const today = isoToday();
  const reviewDue = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
  const now = new Date().toISOString();
  const { error } = await admin.from("library_items").update({ last_confirmed_at: now, last_confirmed_by: actor.userId, last_confirmed_by_name: actor.fullName ?? actor.email, review_due: reviewDue, reminder_sent_at: null, updated_at: now }).eq("id", input.itemId);
  if (error) return { ok: false, error: error.message };
  await event(admin, input.itemId, "confirmed", `Confirmed still accurate by ${actor.fullName ?? "the uploader"}`, actor);
  revalidate();
  return { ok: true, reviewDue, message: `Marked as confirmed accurate today · review due ${fmtMonDY(reviewDue)}` };
}

/** Readers ask the uploader to refresh an item; the uploader is emailed once per request. */
export async function requestLibraryUpdateAction(input: { itemId: string; note?: string | null }): Promise<Result<{ message: string }>> {
  const guard = await requireInstitutionRole(null);
  if (!guard.ok) return guard;
  const { admin, actor } = guard;
  const { data: item } = await admin.from("library_items").select("id, title, uploader_id, profiles:uploader_id(email)").eq("id", input.itemId).maybeSingle();
  const it = item as { id: string; title: string; uploader_id: string | null; profiles: { email: string | null } | { email: string | null }[] | null } | null;
  if (!it) return { ok: false, error: "Item not found." };
  await event(admin, input.itemId, "update_requested", `Update requested by ${actor.fullName ?? "a reader"}${input.note ? ` · “${input.note.slice(0, 80)}”` : ""}`, actor);
  const email = (Array.isArray(it.profiles) ? it.profiles[0] : it.profiles)?.email ?? null;
  if (email) await sendFlagEmail({ to: email, title: it.title, reason: "Update requested", note: input.note ?? null, by: actor.fullName ?? "A reader", itemId: it.id });
  revalidate();
  return { ok: true, message: "Update requested · the uploader is notified" };
}

export async function flagLibraryItemAction(input: { itemId: string; reason: FlagReason; note?: string | null }): Promise<Result<{ flagId: string; message: string }>> {
  const guard = await requireInstitutionRole(null);
  if (!guard.ok) return guard;
  if (!FLAG_REASONS.some((r) => r.key === input.reason)) return { ok: false, error: "Pick a reason." };
  const { admin, actor } = guard;
  const { data: item } = await admin.from("library_items").select("id, title, uploader_id, profiles:uploader_id(email)").eq("id", input.itemId).maybeSingle();
  const it = item as { id: string; title: string; uploader_id: string | null; profiles: { email: string | null } | { email: string | null }[] | null } | null;
  if (!it) return { ok: false, error: "Item not found." };
  const { data, error } = await admin.from("library_item_flags").insert({ item_id: input.itemId, reason: input.reason, note: input.note?.trim() || null, flagged_by: actor.userId, flagged_by_name: actor.fullName ?? actor.email }).select("id").single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not flag." };
  const label = FLAG_REASONS.find((r) => r.key === input.reason)!.label;
  await event(admin, input.itemId, "flagged", `Flagged by ${actor.fullName ?? "a reader"} · ${label}`, actor);
  const email = (Array.isArray(it.profiles) ? it.profiles[0] : it.profiles)?.email ?? null;
  if (email && it.uploader_id !== actor.userId) await sendFlagEmail({ to: email, title: it.title, reason: label, note: input.note ?? null, by: actor.fullName ?? "A reader", itemId: it.id });
  revalidate();
  return { ok: true, flagId: (data as { id: string }).id, message: "Flagged for the stewards · the uploader is notified" };
}

export async function withdrawFlagAction(input: { flagId: string }): Promise<Result> {
  const guard = await requireInstitutionRole(null);
  if (!guard.ok) return guard;
  const { error } = await guard.admin.from("library_item_flags").delete().eq("id", input.flagId).eq("flagged_by", guard.actor.userId).is("resolved_at", null);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}

/** New version of an existing item (uploader or steward). Text, excerpt and embedding are refreshed. */
export async function addLibraryVersionAction(formData: FormData): Promise<Result<{ version: number }>> {
  const guard = await requireInstitutionRole(null);
  if (!guard.ok) return guard;
  const itemId = String(formData.get("item_id") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, 200);
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Choose a PDF or Word file." };
  if (file.size > LIBRARY_MAX_BYTES) return { ok: false, error: "Files must be 25 MB or smaller." };
  const mime = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  if (!LIBRARY_MIME.has(mime)) return { ok: false, error: "Only PDF and Word (.docx) files are accepted." };
  const { admin, actor } = guard;
  const { data: item } = await admin.from("library_items").select("id, uploader_id, version").eq("id", itemId).maybeSingle();
  const it = item as { id: string; uploader_id: string | null; version: number } | null;
  if (!it || (it.uploader_id !== actor.userId && !actor.roles.includes("library_steward"))) return { ok: false, error: "Only the uploader or a steward can add a version." };
  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = mime === "application/pdf" ? "pdf" : "docx";
  const storagePath = `${it.uploader_id ?? actor.userId}/${randomBytes(8).toString("hex")}.${ext}`;
  const { error: upErr } = await admin.storage.from("library").upload(storagePath, buffer, { contentType: mime, upsert: false });
  if (upErr) return { ok: false, error: `Upload failed: ${upErr.message}` };
  const extracted = await extractDocumentText(buffer, mime);
  const version = it.version + 1;
  const now = new Date().toISOString();
  const today = isoToday();
  const { error } = await admin.from("library_items").update({ version, storage_path: storagePath, file_name: file.name.slice(0, 200), file_size: file.size, mime_type: mime, extracted_text: extracted.text || null, excerpt: excerptOf(extracted.text), sensitive_findings: scanSensitive(extracted.text), last_confirmed_at: now, last_confirmed_by: actor.userId, last_confirmed_by_name: actor.fullName ?? actor.email, review_due: `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`, reminder_sent_at: null, updated_at: now }).eq("id", itemId);
  if (error) return { ok: false, error: error.message };
  await admin.from("library_item_versions").insert({ item_id: itemId, version, storage_path: storagePath, file_name: file.name.slice(0, 200), file_size: file.size, mime_type: mime, note: note || null, uploaded_by: actor.userId, uploaded_by_name: actor.fullName ?? actor.email });
  await event(admin, itemId, "version_added", note ? `${note} (v${version})` : `New version v${version} uploaded`, actor);
  void embedLibraryItem(admin, itemId);
  revalidate();
  return { ok: true, version };
}

// ---------------------------------------------------------------------------
// Steward queue
// ---------------------------------------------------------------------------

async function uploaderEmail(admin: Parameters<typeof logAudit>[0], itemId: string): Promise<{ title: string; email: string | null; item: LibraryItemRecord } | null> {
  const { data } = await admin.from("library_items").select("*, profiles:uploader_id(email)").eq("id", itemId).maybeSingle();
  if (!data) return null;
  const row = data as LibraryItemRecord & { profiles: { email: string | null } | { email: string | null }[] | null };
  return { title: row.title, email: (Array.isArray(row.profiles) ? row.profiles[0] : row.profiles)?.email ?? null, item: row };
}

export async function stewardDecisionAction(input: { itemId: string; decision: "publish" | "changes" | "remove"; note?: string | null; trustTier?: "curated" | "community" }): Promise<Result<{ message: string }>> {
  const guard = await requireInstitutionRole("library_steward");
  if (!guard.ok) return guard;
  const { admin, actor } = guard;
  const target = await uploaderEmail(admin, input.itemId);
  if (!target) return { ok: false, error: "Item not found." };
  const now = new Date().toISOString();
  const note = input.note?.trim() || null;
  if (input.decision === "changes" && !note) return { ok: false, error: "Tell the uploader what to change." };
  const patch =
    input.decision === "publish"
      ? { review_status: "published", steward_note: note, reviewed_by: actor.userId, reviewed_at: now, last_confirmed_at: now, last_confirmed_by: actor.userId, last_confirmed_by_name: actor.fullName ?? actor.email, ...(input.trustTier ? { trust_tier: input.trustTier } : {}), updated_at: now }
      : input.decision === "changes"
        ? { review_status: "changes_requested", steward_note: note, reviewed_by: actor.userId, reviewed_at: now, updated_at: now }
        : { review_status: "removed", steward_note: note, reviewed_by: actor.userId, reviewed_at: now, removed_at: now, removed_by: actor.userId, updated_at: now };
  const { error } = await admin.from("library_items").update(patch).eq("id", input.itemId);
  if (error) return { ok: false, error: error.message };
  const text = input.decision === "publish" ? `Steward review passed${note ? ` · ${note}` : ""}` : input.decision === "changes" ? `Changes requested · ${note}` : `Removed by a steward${note ? ` · ${note}` : ""}`;
  await event(admin, input.itemId, input.decision === "publish" ? "published" : input.decision === "changes" ? "changes_requested" : "removed", text, actor);
  await logAudit(admin, { entityType: "library_item", entityId: input.itemId, action: `steward_${input.decision}`, actorId: actor.userId, actorName: actor.fullName, details: { note } });
  if (input.decision === "publish") void embedLibraryItem(admin, input.itemId);
  if (target.email && target.item.uploader_id !== actor.userId) await sendStewardDecisionEmail({ to: target.email, title: target.title, decision: input.decision === "publish" ? "published" : input.decision === "changes" ? "changes_requested" : "removed", note, itemId: input.itemId });
  revalidate();
  return { ok: true, message: input.decision === "publish" ? "Published to all of UCSF · the uploader is notified" : input.decision === "changes" ? "Changes requested · the uploader is notified" : "Removed from the library · the uploader is notified" };
}

export async function restoreLibraryItemAction(input: { itemId: string; status?: "published" | "pending_review" }): Promise<Result> {
  const guard = await requireInstitutionRole("library_steward");
  if (!guard.ok) return guard;
  const { admin, actor } = guard;
  const { error } = await admin.from("library_items").update({ removed_at: null, removed_by: null, review_status: input.status ?? "published", updated_at: new Date().toISOString() }).eq("id", input.itemId);
  if (error) return { ok: false, error: error.message };
  await event(admin, input.itemId, "restored", "Restored by a steward", actor);
  revalidate();
  return { ok: true };
}

export async function resolveFlagAction(input: { flagId: string; resolution: string }): Promise<Result> {
  const guard = await requireInstitutionRole("library_steward");
  if (!guard.ok) return guard;
  const { admin, actor } = guard;
  const { data: flag } = await admin.from("library_item_flags").select("id, item_id").eq("id", input.flagId).maybeSingle();
  if (!flag) return { ok: false, error: "Flag not found." };
  const { error } = await admin.from("library_item_flags").update({ resolved_at: new Date().toISOString(), resolved_by: actor.userId, resolution: input.resolution.trim().slice(0, 200) || "Resolved" }).eq("id", input.flagId);
  if (error) return { ok: false, error: error.message };
  await event(admin, (flag as { item_id: string }).item_id, "flag_resolved", `Flag resolved · ${input.resolution.trim().slice(0, 80) || "no change needed"}`, actor);
  revalidate();
  return { ok: true };
}

export async function reopenFlagAction(input: { flagId: string }): Promise<Result> {
  const guard = await requireInstitutionRole("library_steward");
  if (!guard.ok) return guard;
  const { error } = await guard.admin.from("library_item_flags").update({ resolved_at: null, resolved_by: null, resolution: null }).eq("id", input.flagId);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}

export async function sendReviewReminderAction(input: { itemId: string }): Promise<Result<{ message: string }>> {
  const guard = await requireInstitutionRole("library_steward");
  if (!guard.ok) return guard;
  const { admin, actor } = guard;
  const target = await uploaderEmail(admin, input.itemId);
  if (!target) return { ok: false, error: "Item not found." };
  if (!target.email) return { ok: false, error: "The uploader has no email on file." };
  const { sendReviewReminderEmail } = await import("@/lib/institution/emails");
  const r = await sendReviewReminderEmail({ to: target.email, title: target.title, reviewDue: target.item.review_due ? fmtMonDY(target.item.review_due) : "—", itemId: input.itemId });
  if (!r.ok) return { ok: false, error: r.error };
  await admin.from("library_items").update({ reminder_sent_at: new Date().toISOString() }).eq("id", input.itemId);
  await event(admin, input.itemId, "reminder_sent", "Review date passed · reminder sent to uploader", actor);
  revalidate();
  return { ok: true, message: `Reminder sent to ${target.item.uploader_name ?? "the uploader"}` };
}

/** Steward-maintained OSR rate schedule (never an upload). Replaces the whole list. */
export async function saveInstitutionRatesAction(input: { rows: Array<{ label: string; value: string }>; agreementLabel: string | null; effectiveFrom: string | null; sourceUrl: string | null }): Promise<Result> {
  const guard = await requireInstitutionRole("library_steward");
  if (!guard.ok) return guard;
  const rows = input.rows.map((r) => ({ label: r.label.trim().slice(0, 120), value: r.value.trim().slice(0, 40) })).filter((r) => r.label && r.value);
  if (input.sourceUrl && !/^https?:\/\//i.test(input.sourceUrl.trim())) return { ok: false, error: "The source link must start with http(s)://" };
  const { admin, actor } = guard;
  const now = new Date().toISOString();
  await admin.from("institution_rates").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (rows.length) {
    const { error } = await admin.from("institution_rates").insert(rows.map((r, i) => ({ ...r, sort_order: i, agreement_label: input.agreementLabel?.trim() || null, effective_from: input.effectiveFrom || null, source_url: input.sourceUrl?.trim() || null, verified_by: actor.userId, verified_by_name: actor.fullName ?? actor.email, verified_at: now, updated_at: now })));
    if (error) return { ok: false, error: error.message };
  }
  await logAudit(admin, { entityType: "institution_rates", action: "replace", actorId: actor.userId, actorName: actor.fullName, details: { rows: rows.length, agreement: input.agreementLabel } });
  revalidate();
  return { ok: true };
}

export async function saveReferenceRateAction(input: { mechanism: string; fiscalYear: number; rate: number; label?: string; sourceUrl: string | null }): Promise<Result> {
  const guard = await requireInstitutionRole("library_steward");
  if (!guard.ok) return guard;
  const mech = input.mechanism.trim().toUpperCase().slice(0, 12);
  if (!mech || !Number.isInteger(input.fiscalYear) || input.fiscalYear < 2000 || input.fiscalYear > 2100 || !(input.rate >= 0 && input.rate <= 100)) return { ok: false, error: "Enter a mechanism, fiscal year and a rate between 0 and 100." };
  const { error } = await guard.admin.from("reference_success_rates").upsert({ mechanism: mech, fiscal_year: input.fiscalYear, rate: input.rate, label: input.label?.trim() || "NIH-wide", source_url: input.sourceUrl?.trim() || null, entered_by: guard.actor.userId, entered_by_name: guard.actor.fullName ?? guard.actor.email }, { onConflict: "mechanism,fiscal_year,label" });
  if (error) return { ok: false, error: error.message };
  revalidate();
  revalidatePath("/opportunities");
  return { ok: true };
}

export async function deleteReferenceRateAction(input: { id: string }): Promise<Result> {
  const guard = await requireInstitutionRole("library_steward");
  if (!guard.ok) return guard;
  const { error } = await guard.admin.from("reference_success_rates").delete().eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true };
}

