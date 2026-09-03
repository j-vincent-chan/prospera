"use server";

import { randomBytes } from "crypto";
import { loadBiosketchRequest } from "@/lib/investigators/biosketch-request";
import { createServiceRoleClient } from "@/lib/supabase/admin-service";

/**
 * Public actions behind the emailed biosketch link. No Prospera session is
 * involved: the 48-hex token is the credential, and it only ever reaches the
 * one biosketch row it was minted for.
 */

type Result = { ok: true } | { ok: false; error: string };

const MAX_PDF_BYTES = 10 * 1024 * 1024;

export async function submitBiosketchAction(formData: FormData): Promise<Result> {
  const admin = createServiceRoleClient();
  if (!admin) return { ok: false, error: "Service unavailable." };
  const token = String(formData.get("token") ?? "");
  const request = await loadBiosketchRequest(admin, token);
  if (!request) return { ok: false, error: "This link is no longer valid." };

  const file = formData.get("file");
  const documentDate = String(formData.get("documentDate") ?? "").trim();
  const writtenFor = String(formData.get("writtenFor") ?? "").trim().slice(0, 200);
  const authorize = formData.get("authorize") === "on" || formData.get("authorize") === "true";
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Attach your biosketch as a PDF." };
  if (file.size > MAX_PDF_BYTES) return { ok: false, error: "The PDF is over 10 MB." };
  if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) return { ok: false, error: "The file must be a PDF." };
  if (!/^\d{4}-\d{2}$/.test(documentDate)) return { ok: false, error: "Tell us the month the document was written." };
  if (!authorize) return { ok: false, error: "Tick the authorization box to share the document." };

  const storagePath = `${request.investigatorId}/${randomBytes(8).toString("hex")}.pdf`;
  const { error: upErr } = await admin.storage.from("biosketches").upload(storagePath, Buffer.from(await file.arrayBuffer()), { contentType: "application/pdf", upsert: false });
  if (upErr) return { ok: false, error: `Upload failed: ${upErr.message}` };

  const now = new Date().toISOString();
  const { error } = await admin
    .from("investigator_sources")
    .update({
      state: "on_file",
      item_count: 1,
      identity_method: "self",
      storage_path: storagePath,
      document_date: `${documentDate}-01`,
      written_for: writtenFor || null,
      authorized_at: now,
      authorized_by: `Dr. ${request.investigatorName.trim().split(/\s+/).slice(-1)[0]}`,
      revoked_at: null,
      declined_at: null,
      last_refreshed_at: now,
      last_error: null,
      request_token: randomBytes(24).toString("hex"),
      updated_at: now,
    })
    .eq("investigator_id", request.investigatorId)
    .eq("source", "biosketch");
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function declineBiosketchAction(token: string): Promise<Result> {
  const admin = createServiceRoleClient();
  if (!admin) return { ok: false, error: "Service unavailable." };
  const request = await loadBiosketchRequest(admin, token);
  if (!request) return { ok: false, error: "This link is no longer valid." };
  const now = new Date().toISOString();
  const { error } = await admin
    .from("investigator_sources")
    .update({ state: "declined", declined_at: now, request_token: null, updated_at: now })
    .eq("investigator_id", request.investigatorId)
    .eq("source", "biosketch");
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Withdraw a previously given authorization from the same link. */
export async function withdrawBiosketchAction(token: string): Promise<Result> {
  const admin = createServiceRoleClient();
  if (!admin) return { ok: false, error: "Service unavailable." };
  const request = await loadBiosketchRequest(admin, token);
  if (!request) return { ok: false, error: "This link is no longer valid." };
  const now = new Date().toISOString();
  const { error } = await admin
    .from("investigator_sources")
    .update({ state: "revoked", revoked_at: now, request_token: null, updated_at: now })
    .eq("investigator_id", request.investigatorId)
    .eq("source", "biosketch");
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
