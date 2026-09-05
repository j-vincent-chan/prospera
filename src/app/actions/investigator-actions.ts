"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { sendBiosketchRequestEmail } from "@/lib/email/send-investigator-emails";
import { buildSelfDeclaredColumns, mergeImportedMaterials, parseDegrees, readSelfDeclaredAxes, selfDeclaredInputSchema } from "@/lib/fit/self-declared";
import { normalizeProfilesUrlName } from "@/lib/ingestion/ucsf-profiles/client";
import { importRowSchema, orcidWarning, type ImportRowInput } from "@/lib/investigators/import-mapping";
import { buildInvestigatorFeatureRow } from "@/lib/investigators/normalize-investigator-features";
import { ORCID_PROBLEM, parseOrcid } from "@/lib/investigators/orcid";
import { syncOrcidSource } from "@/lib/investigators/record-orcid";
import {
  refreshInvestigatorSources,
  summarizeOutcomes,
  syncSourceCountsFromCaches,
  touchSource,
  type RefreshableSource,
  type SourceRefreshOutcome,
} from "@/lib/investigators/refresh-sources";
import type { IdentityMethod, IdentityStatus, SourceState } from "@/lib/investigators/sources";
import { requireTeamRole, requireUser } from "@/lib/team/require-team";

type Ok<T> = { ok: true } & T;
type Fail = { ok: false; error: string };
type Result<T> = Ok<T> | Fail;
type Done = { ok: true } | Fail;

const uuid = z.string().uuid();
const REFRESHABLE: RefreshableSource[] = ["profiles", "orcid", "reporter", "pubmed", "trials"];

function revalidateInvestigator(id?: string) {
  revalidatePath("/investigators");
  if (id) revalidatePath(`/investigators/${id}`);
}

/** Bound a refresh so a server action never hangs on a slow external API. */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  const out = await Promise.race([p, timeout]);
  if (timer) clearTimeout(timer);
  return out;
}

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

export async function refreshSourcesAction(
  investigatorId: string,
  sources: RefreshableSource[] | "all" = "all",
): Promise<Result<{ outcomes: SourceRefreshOutcome[]; summary: string; timedOut: boolean }>> {
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const id = uuid.safeParse(investigatorId);
  if (!id.success) return { ok: false, error: "Invalid investigator." };
  const list = sources === "all" ? "all" : sources.filter((s) => REFRESHABLE.includes(s));

  const outcomes = await withTimeout(refreshInvestigatorSources(guard.admin, id.data, list), 55_000);
  revalidateInvestigator(id.data);
  if (!outcomes) {
    return { ok: true, outcomes: [], summary: "Still fetching in the background; the nightly refresh finishes anything left.", timedOut: true };
  }
  return { ok: true, outcomes, summary: summarizeOutcomes(outcomes), timedOut: false };
}

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

const identifiersSchema = z.object({
  nihProfileId: z.string().trim().max(32).nullable().optional(),
  orcid: z.string().trim().max(64).nullable().optional(),
  profilesUrlName: z.string().trim().max(200).nullable().optional(),
  email: z.string().trim().max(320).nullable().optional(),
});

export type IdentifiersPatch = z.infer<typeof identifiersSchema>;

export async function updateIdentifiersAction(
  investigatorId: string,
  patch: IdentifiersPatch,
  opts: { refresh?: RefreshableSource[] } = {},
): Promise<Result<{ summary: string | null }>> {
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const id = uuid.safeParse(investigatorId);
  if (!id.success) return { ok: false, error: "Invalid investigator." };
  const parsed = identifiersSchema.safeParse(patch);
  if (!parsed.success) return { ok: false, error: "Check the value and try again." };
  const p = parsed.data;

  const update: Record<string, unknown> = {};
  if (p.nihProfileId !== undefined) {
    const digits = p.nihProfileId?.replace(/\D/g, "") ?? "";
    if (p.nihProfileId && !digits) return { ok: false, error: "A RePORTER profile ID is digits only." };
    update.nih_profile_id = digits || null;
  }
  if (p.orcid !== undefined) {
    if (p.orcid) {
      const parsedOrcid = parseOrcid(p.orcid);
      if (!parsedOrcid.ok) return { ok: false, error: ORCID_PROBLEM[parsedOrcid.reason] };
      update.orcid = parsedOrcid.orcid;
    } else update.orcid = null;
  }
  if (p.profilesUrlName !== undefined) {
    if (p.profilesUrlName) {
      const norm = normalizeProfilesUrlName(p.profilesUrlName);
      if (!norm) return { ok: false, error: "Paste the profiles.ucsf.edu link or the first.last part of it." };
      update.profiles_url_name = norm;
    } else update.profiles_url_name = null;
  }
  if (p.email !== undefined) {
    if (p.email) {
      if (!z.string().email().safeParse(p.email).success) return { ok: false, error: "Enter a valid email address." };
      update.email = p.email.toLowerCase();
    } else update.email = null;
  }
  if (!Object.keys(update).length) return { ok: true, summary: null };

  let previousOrcid: string | null = null;
  if (update.orcid !== undefined) {
    const { data: before } = await guard.admin.from("investigators").select("orcid").eq("id", id.data).maybeSingle();
    previousOrcid = (before as { orcid?: string | null } | null)?.orcid ?? null;
  }
  const { error } = await guard.admin.from("investigators").update(update).eq("id", id.data);
  if (error) return { ok: false, error: error.message };

  // Keep the source rows' identifiers in step even before a refresh runs.
  if (update.nih_profile_id !== undefined) {
    await touchSource(guard.admin, id.data, "reporter", {
      external_id: (update.nih_profile_id as string | null) ?? null,
      identity_method: update.nih_profile_id ? "profile_id" : null,
      state: update.nih_profile_id ? "available" : "unavailable",
      last_error: null,
    });
  }
  if (update.orcid !== undefined) {
    await syncOrcidSource(guard.admin, id.data, (update.orcid as string | null) ?? null, previousOrcid, "entered on the profile page");
  }
  if (update.profiles_url_name !== undefined) {
    await touchSource(guard.admin, id.data, "profiles", { external_id: (update.profiles_url_name as string | null) ?? null, identity_method: update.profiles_url_name ? "manual" : null, last_error: null });
  }

  let summary: string | null = null;
  if (opts.refresh?.length) {
    const outcomes = await withTimeout(refreshInvestigatorSources(guard.admin, id.data, opts.refresh), 50_000);
    summary = outcomes ? summarizeOutcomes(outcomes) : "Fetching continues in the background.";
  }
  revalidateInvestigator(id.data);
  return { ok: true, summary };
}

export async function setInvestigatorCommunityAction(investigatorId: string, communityId: string | null): Promise<Done> {
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const id = uuid.safeParse(investigatorId);
  if (!id.success) return { ok: false, error: "Invalid investigator." };
  if (communityId && !uuid.safeParse(communityId).success) return { ok: false, error: "Invalid community." };
  const { error } = await guard.admin.from("investigators").update({ research_community_id: communityId }).eq("id", id.data);
  if (error) return { ok: false, error: error.message };
  revalidateInvestigator(id.data);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Biosketch
// ---------------------------------------------------------------------------

async function teamName(admin: SupabaseClient, teamId: string): Promise<string> {
  const { data } = await admin.from("teams").select("name").eq("id", teamId).maybeSingle();
  return (data as { name?: string } | null)?.name ?? "the research development team";
}

export async function requestBiosketchAction(
  investigatorId: string,
  kind: "request" | "reminder" | "update",
): Promise<Result<{ sentTo: string }>> {
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const id = uuid.safeParse(investigatorId);
  if (!id.success) return { ok: false, error: "Invalid investigator." };

  const { data: inv } = await guard.admin.from("investigators").select("id, full_name, email").eq("id", id.data).maybeSingle();
  if (!inv) return { ok: false, error: "Investigator not found." };
  const email = (inv.email as string | null)?.trim();
  if (!email) return { ok: false, error: "A biosketch request needs an email address." };

  const { data: current } = await guard.admin.from("investigator_sources").select("*").eq("investigator_id", id.data).eq("source", "biosketch").maybeSingle();
  const row = current as { state?: SourceState; request_token?: string | null; document_date?: string | null } | null;
  if (row?.state === "declined") return { ok: false, error: `${inv.full_name} declined to share a biosketch. Ask them directly instead.` };

  const token = row?.request_token && kind !== "update" ? row.request_token : randomBytes(24).toString("hex");
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { request_token: token, requested_by: guard.actor.userId, last_error: null };
  if (kind === "reminder") patch.reminder_sent_at = now;
  else patch.requested_at = now;
  if (kind !== "update") patch.state = "requested";
  await touchSource(guard.admin, id.data, "biosketch", patch);

  try {
    await sendBiosketchRequestEmail({
      to: email,
      investigatorName: inv.full_name,
      strategistName: guard.actor.fullName,
      teamName: await teamName(guard.admin, guard.actor.teamId),
      token,
      kind,
      currentDocumentDate: row?.document_date ?? null,
    });
  } catch (e) {
    await touchSource(guard.admin, id.data, "biosketch", { last_error: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: `The email could not be sent: ${e instanceof Error ? e.message : String(e)}` };
  }
  revalidateInvestigator(id.data);
  return { ok: true, sentTo: email };
}

const MAX_PDF_BYTES = 10 * 1024 * 1024;

/** A strategist records a biosketch they received directly, with the authorization they were given. */
export async function recordBiosketchAction(formData: FormData): Promise<Done> {
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const id = uuid.safeParse(formData.get("investigatorId"));
  if (!id.success) return { ok: false, error: "Invalid investigator." };

  const file = formData.get("file");
  const documentDate = String(formData.get("documentDate") ?? "").trim();
  const writtenFor = String(formData.get("writtenFor") ?? "").trim();
  const authorizedBy = String(formData.get("authorizedBy") ?? "").trim();
  const authorizedAt = String(formData.get("authorizedAt") ?? "").trim();
  const personalStatement = String(formData.get("personalStatement") ?? "").trim();
  const contributionsRaw = String(formData.get("contributions") ?? "").trim();
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(documentDate)) return { ok: false, error: "Give the document's date (month and year)." };
  if (!authorizedBy) return { ok: false, error: "Who authorized the use of this biosketch?" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(authorizedAt)) return { ok: false, error: "When was it authorized?" };

  let storagePath: string | null = null;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_PDF_BYTES) return { ok: false, error: "The PDF is over 10 MB." };
    if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) return { ok: false, error: "Upload the biosketch as a PDF." };
    storagePath = `${id.data}/${randomBytes(8).toString("hex")}.pdf`;
    const { error } = await guard.admin.storage.from("biosketches").upload(storagePath, Buffer.from(await file.arrayBuffer()), { contentType: "application/pdf", upsert: false });
    if (error) return { ok: false, error: `Upload failed: ${error.message}` };
  }

  const contributions = contributionsRaw
    ? contributionsRaw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
        const [title, ...rest] = l.split(/\s+[—–:-]\s+/);
        return { title: title ?? l, summary: rest.join(" ") };
      })
    : [];

  await touchSource(guard.admin, id.data, "biosketch", {
    state: "on_file",
    item_count: 1,
    identity_method: "self",
    last_refreshed_at: new Date().toISOString(),
    last_error: null,
    ...(storagePath ? { storage_path: storagePath } : {}),
    document_date: documentDate.length === 7 ? `${documentDate}-01` : documentDate,
    written_for: writtenFor || null,
    authorized_by: authorizedBy,
    authorized_at: `${authorizedAt}T12:00:00Z`,
    revoked_at: null,
    declined_at: null,
    personal_statement: personalStatement || null,
    contributions,
  } as Parameters<typeof touchSource>[3]);
  revalidateInvestigator(id.data);
  return { ok: true };
}

export type BiosketchSnapshot = { state: SourceState; revoked_at: string | null };

export async function revokeBiosketchAction(investigatorId: string): Promise<Result<{ snapshot: BiosketchSnapshot }>> {
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const id = uuid.safeParse(investigatorId);
  if (!id.success) return { ok: false, error: "Invalid investigator." };
  const { data } = await guard.admin.from("investigator_sources").select("state, revoked_at").eq("investigator_id", id.data).eq("source", "biosketch").maybeSingle();
  const snapshot: BiosketchSnapshot = { state: ((data as { state?: SourceState } | null)?.state ?? "not_requested") as SourceState, revoked_at: (data as { revoked_at?: string | null } | null)?.revoked_at ?? null };
  await touchSource(guard.admin, id.data, "biosketch", { state: "revoked", meta: {} });
  await guard.admin.from("investigator_sources").update({ revoked_at: new Date().toISOString() }).eq("investigator_id", id.data).eq("source", "biosketch");
  revalidateInvestigator(id.data);
  return { ok: true, snapshot };
}

export async function restoreBiosketchAction(investigatorId: string, snapshot: BiosketchSnapshot): Promise<Done> {
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const id = uuid.safeParse(investigatorId);
  if (!id.success) return { ok: false, error: "Invalid investigator." };
  await guard.admin.from("investigator_sources").update({ state: snapshot.state, revoked_at: snapshot.revoked_at }).eq("investigator_id", id.data).eq("source", "biosketch");
  revalidateInvestigator(id.data);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Identity review (confirm / not this person)
// ---------------------------------------------------------------------------

const KIND_TABLE = { publication: "investigator_publications", grant: "investigator_nih_grants", trial: "investigator_clinical_trials" } as const;

export type IdentityPrevious = { identity_method: IdentityMethod; identity_status: IdentityStatus; reviewed_at: string | null };

export async function reviewIdentityAction(input: {
  investigatorId: string;
  kind: keyof typeof KIND_TABLE;
  itemId: string;
  decision: "confirm" | "reject";
}): Promise<Result<{ previous: IdentityPrevious }>> {
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const id = uuid.safeParse(input.investigatorId);
  const item = uuid.safeParse(input.itemId);
  if (!id.success || !item.success || !(input.kind in KIND_TABLE)) return { ok: false, error: "Invalid item." };
  const table = KIND_TABLE[input.kind];
  const { data: before } = await guard.admin.from(table).select("identity_method, identity_status, reviewed_at").eq("id", item.data).eq("investigator_id", id.data).maybeSingle();
  if (!before) return { ok: false, error: "Item not found." };
  const previous = before as IdentityPrevious;
  const { error } = await guard.admin
    .from(table)
    .update({
      identity_status: input.decision === "confirm" ? "verified" : "rejected",
      identity_method: input.decision === "confirm" ? "manual" : previous.identity_method,
      match_confidence: input.decision === "confirm" ? "high" : "low",
      reviewed_at: new Date().toISOString(),
      reviewed_by: guard.actor.userId,
    })
    .eq("id", item.data);
  if (error) return { ok: false, error: error.message };
  await syncSourceCountsFromCaches(guard.admin, id.data);
  revalidateInvestigator(id.data);
  return { ok: true, previous };
}

export async function undoIdentityReviewAction(input: { investigatorId: string; kind: keyof typeof KIND_TABLE; itemId: string; previous: IdentityPrevious }): Promise<Done> {
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const id = uuid.safeParse(input.investigatorId);
  const item = uuid.safeParse(input.itemId);
  if (!id.success || !item.success || !(input.kind in KIND_TABLE)) return { ok: false, error: "Invalid item." };
  const { error } = await guard.admin
    .from(KIND_TABLE[input.kind])
    .update({
      identity_method: input.previous.identity_method,
      identity_status: input.previous.identity_status,
      match_confidence: input.previous.identity_status === "verified" ? "high" : "medium",
      reviewed_at: input.previous.reviewed_at,
      reviewed_by: input.previous.reviewed_at ? guard.actor.userId : null,
    })
    .eq("id", item.data);
  if (error) return { ok: false, error: error.message };
  await syncSourceCountsFromCaches(guard.admin, id.data);
  revalidateInvestigator(id.data);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Create / edit / archive
// ---------------------------------------------------------------------------

const formSchema = z.object({
  first_name: z.string().trim().min(1, "First name is required").max(120),
  last_name: z.string().trim().min(1, "Last name is required").max(120),
  middle_initial: z.string().trim().max(4).optional().default(""),
  email: z.string().trim().max(320).optional().default(""),
  home_department: z.string().trim().max(300).optional().default(""),
  division: z.string().trim().max(300).optional().default(""),
  rank: z.string().trim().max(120).optional().default(""),
  research_community_id: z.string().uuid().nullable().optional().default(null),
  research_focus: z.string().trim().max(8000).optional().default(""),
  orcid: z.string().trim().max(64).optional().default(""),
  nih_profile_id: z.string().trim().max(32).optional().default(""),
  profiles_url_name: z.string().trim().max(200).optional().default(""),
  title_series: z.string().trim().max(120).optional().default(""),
  /** "MD, PhD" as typed; split by parseDegrees. */
  degrees: z.string().trim().max(200).optional().default(""),
  /** The "How you do research" section (PR 0.7); absent = leave those columns untouched. */
  research: selfDeclaredInputSchema.optional(),
});

export type InvestigatorFormInput = z.input<typeof formSchema>;

export async function saveInvestigatorAction(
  input: InvestigatorFormInput & { id?: string },
  opts: { fetchAfter?: boolean } = {},
): Promise<Result<{ id: string; fullName: string; created: boolean; refreshSummary: string | null }>> {
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const parsed = formSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const d = parsed.data;
  if (d.email && !z.string().email().safeParse(d.email).success) return { ok: false, error: "Enter a valid email address." };
  const parsedOrcid = d.orcid ? parseOrcid(d.orcid) : null;
  if (parsedOrcid && !parsedOrcid.ok) return { ok: false, error: ORCID_PROBLEM[parsedOrcid.reason] };
  const orcid = parsedOrcid?.ok ? parsedOrcid.orcid : null;
  const nihProfileId = d.nih_profile_id ? d.nih_profile_id.replace(/\D/g, "") : "";
  if (d.nih_profile_id && !nihProfileId) return { ok: false, error: "A RePORTER profile ID is digits only." };
  const profilesUrlName = d.profiles_url_name ? normalizeProfilesUrlName(d.profiles_url_name) : null;
  const existingId = input.id ? uuid.safeParse(input.id) : null;
  if (existingId && !existingId.success) return { ok: false, error: "Invalid investigator." };

  const fullName = `${d.first_name} ${d.last_name}`.trim();
  const row = {
    first_name: d.first_name,
    last_name: d.last_name,
    middle_initial: d.middle_initial || null,
    full_name: fullName,
    email: d.email ? d.email.toLowerCase() : null,
    home_department: d.home_department || null,
    division: d.division || null,
    rank: d.rank || null,
    research_community_id: d.research_community_id,
    orcid,
    nih_profile_id: nihProfileId || null,
    profiles_url_name: profilesUrlName,
    title_series: d.title_series || null,
    degrees: parseDegrees(d.degrees),
  };
  const now = new Date().toISOString();

  let id: string;
  let created = false;
  let previousOrcid: string | null = null;
  if (existingId?.success) {
    const { data: prev } = await guard.admin.from("investigators").select("raw_profile_json, orcid, self_declared_axes").eq("id", existingId.data).maybeSingle();
    const prevRow = prev as { raw_profile_json?: Record<string, unknown>; orcid?: string | null; self_declared_axes?: unknown } | null;
    const rawPrev = (prevRow?.raw_profile_json ?? {}) as Record<string, unknown>;
    previousOrcid = prevRow?.orcid ?? null;
    const declared = d.research ? buildSelfDeclaredColumns(d.research, readSelfDeclaredAxes(prevRow?.self_declared_axes), now) : {};
    const { error } = await guard.admin
      .from("investigators")
      .update({ ...row, ...declared, raw_profile_json: { ...rawPrev, primary_research_area: d.research_focus, source: rawPrev.source ?? "manual_entry" } })
      .eq("id", existingId.data);
    if (error) return { ok: false, error: error.message };
    id = existingId.data;
  } else {
    if (row.email) {
      const { data: dup } = await guard.admin.from("investigators").select("id, full_name").ilike("email", row.email).is("archived_at", null).maybeSingle();
      if (dup) return { ok: false, error: `${(dup as { full_name: string }).full_name} already has that email. Open their profile to edit it.` };
    }
    const declared = d.research ? buildSelfDeclaredColumns(d.research, null, now) : {};
    const { data: inserted, error } = await guard.admin
      .from("investigators")
      .insert({ ...row, ...declared, affiliations: [], raw_profile_json: { ...row, primary_research_area: d.research_focus, source: "manual_entry", added_by: guard.actor.userId } })
      .select("id")
      .single();
    if (error || !inserted) return { ok: false, error: error?.message ?? "Could not add the investigator." };
    id = (inserted as { id: string }).id;
    created = true;
  }

  const feats = buildInvestigatorFeatureRow({ primary_research_area: d.research_focus, division: d.division, rank: d.rank });
  await guard.admin.from("investigator_profile_features").upsert({ investigator_id: id, ...feats }, { onConflict: "investigator_id" });

  // Identifier changes flow to the source rows immediately.
  await touchSource(guard.admin, id, "reporter", { external_id: row.nih_profile_id, identity_method: row.nih_profile_id ? "profile_id" : null, state: row.nih_profile_id ? "available" : "unavailable" });
  await syncOrcidSource(guard.admin, id, orcid, previousOrcid, "entered in edit profile");
  if (profilesUrlName) await touchSource(guard.admin, id, "profiles", { external_id: profilesUrlName, identity_method: "manual" });

  let refreshSummary: string | null = null;
  if (opts.fetchAfter) {
    const outcomes = await withTimeout(refreshInvestigatorSources(guard.admin, id, ["profiles", "orcid", "reporter", "pubmed"]), 50_000);
    refreshSummary = outcomes ? summarizeOutcomes(outcomes) : "Fetching continues in the background; the nightly refresh finishes anything left.";
  }
  revalidateInvestigator(id);
  return { ok: true, id, fullName, created, refreshSummary };
}

// ---------------------------------------------------------------------------
// Self-declared axes from onboarding (PR 0.7)
// ---------------------------------------------------------------------------

const selfDeclaredSaveSchema = z.object({
  investigatorId: uuid,
  research: selfDeclaredInputSchema,
  orcid: z.string().trim().max(64).optional().default(""),
});

export type SelfDeclaredSaveInput = z.input<typeof selfDeclaredSaveSchema>;

/**
 * "How do you do research?" from onboarding. The signed-in person saves the
 * directory record that carries their email; anyone else needs a team
 * membership. Writes the rating grid, materials and aspirations; do_not_suggest
 * is not on the onboarding step and is left alone. A blank ORCID keeps the one
 * on file (clearing it is an edit-sheet action).
 */
export async function saveSelfDeclaredAction(input: SelfDeclaredSaveInput): Promise<Result<{ orcid: string | null }>> {
  const parsed = selfDeclaredSaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const parsedOrcid = parsed.data.orcid ? parseOrcid(parsed.data.orcid) : null;
  if (parsedOrcid && !parsedOrcid.ok) return { ok: false, error: ORCID_PROBLEM[parsedOrcid.reason] };

  const user = await requireUser();
  if (!user.ok) return user;
  const { data } = await user.admin
    .from("investigators")
    .select("id, email, orcid, self_declared_axes")
    .eq("id", parsed.data.investigatorId)
    .is("archived_at", null)
    .maybeSingle();
  const inv = data as { id: string; email: string | null; orcid: string | null; self_declared_axes: unknown } | null;
  if (!inv) return { ok: false, error: "Investigator not found." };
  const isSelf = Boolean(user.email && inv.email && inv.email.trim().toLowerCase() === user.email);
  if (!isSelf) {
    const guard = await requireTeamRole("member");
    if (!guard.ok) return { ok: false, error: "That directory record isn't yours." };
  }

  const now = new Date().toISOString();
  const { self_declared_axes, aspirations } = buildSelfDeclaredColumns(parsed.data.research, readSelfDeclaredAxes(inv.self_declared_axes), now);
  const orcid = parsedOrcid?.ok ? parsedOrcid.orcid : inv.orcid;
  const { error } = await user.admin.from("investigators").update({ self_declared_axes, aspirations, orcid }).eq("id", inv.id);
  if (error) return { ok: false, error: error.message };
  await syncOrcidSource(user.admin, inv.id, orcid, inv.orcid, "entered in onboarding");
  revalidateInvestigator(inv.id);
  return { ok: true, orcid };
}

export async function archiveInvestigatorAction(investigatorId: string): Promise<Result<{ fullName: string }>> {
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const id = uuid.safeParse(investigatorId);
  if (!id.success) return { ok: false, error: "Invalid investigator." };
  const { data, error } = await guard.admin
    .from("investigators")
    .update({ archived_at: new Date().toISOString(), archived_by: guard.actor.userId })
    .eq("id", id.data)
    .select("full_name")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  revalidateInvestigator(id.data);
  return { ok: true, fullName: (data as { full_name?: string } | null)?.full_name ?? "Investigator" };
}

export async function restoreInvestigatorAction(investigatorId: string): Promise<Done> {
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const id = uuid.safeParse(investigatorId);
  if (!id.success) return { ok: false, error: "Invalid investigator." };
  const { error } = await guard.admin.from("investigators").update({ archived_at: null, archived_by: null }).eq("id", id.data);
  if (error) return { ok: false, error: error.message };
  revalidateInvestigator(id.data);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// CSV import (rows already mapped to Prospera fields on the client)
// ---------------------------------------------------------------------------

// The row schema and the column → field mapping live in
// src/lib/investigators/import-mapping.ts (pure, tested over the pilot sheets).
export type { ImportRowInput };

export type ImportResult = {
  created: number;
  updated: number;
  errors: Array<{ line: number; message: string }>;
  /** Rows that imported with something left out (an ORCID that failed validation). */
  warnings: Array<{ line: number; message: string }>;
  ids: string[];
};

export async function importInvestigatorRowsAction(input: {
  rows: ImportRowInput[];
  updateExisting: boolean;
  defaultCommunityId: string | null;
  fileName: string | null;
}): Promise<Result<ImportResult>> {
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  if (!Array.isArray(input.rows) || input.rows.length === 0) return { ok: false, error: "Nothing to import." };
  if (input.rows.length > 2000) return { ok: false, error: "Import at most 2,000 rows at a time." };
  if (input.defaultCommunityId && !uuid.safeParse(input.defaultCommunityId).success) return { ok: false, error: "Invalid community." };

  const { data: communityRows } = await guard.admin.from("pipeline_communities").select("id, slug, label");
  const communityByKey = new Map<string, string>();
  for (const c of (communityRows ?? []) as Array<{ id: string; slug: string; label: string }>) {
    communityByKey.set(c.slug.toLowerCase(), c.id);
    communityByKey.set(c.label.toLowerCase(), c.id);
    communityByKey.set(c.label.toLowerCase().replace(/[^a-z0-9]+/g, ""), c.id);
  }
  const resolveCommunity = (names: string[]): string | null => {
    for (const n of names) {
      const k = n.trim().toLowerCase();
      const hit = communityByKey.get(k) ?? communityByKey.get(k.replace(/[^a-z0-9]+/g, ""));
      if (hit) return hit;
    }
    return input.defaultCommunityId;
  };

  const result: ImportResult = { created: 0, updated: 0, errors: [], warnings: [], ids: [] };
  for (const raw of input.rows) {
    const parsed = importRowSchema.safeParse(raw);
    if (!parsed.success) {
      result.errors.push({ line: typeof raw?.line === "number" ? raw.line : 0, message: parsed.error.issues[0]?.message ?? "Invalid row" });
      continue;
    }
    const d = parsed.data;
    if (!d.first_name || !d.last_name) {
      result.errors.push({ line: d.line, message: "First and last name are required" });
      continue;
    }
    if (d.email && !z.string().email().safeParse(d.email).success) {
      result.errors.push({ line: d.line, message: `“${d.email}” is not a valid email` });
      continue;
    }
    // The wizard already validated; a bad value that still arrives is reported and left out — the row imports.
    const parsedOrcid = d.orcid ? parseOrcid(d.orcid) : null;
    const orcid = parsedOrcid?.ok ? parsedOrcid.orcid : null;
    if (parsedOrcid && !parsedOrcid.ok) result.warnings.push({ line: d.line, message: orcidWarning(d.orcid, parsedOrcid.reason) });
    const nihProfileId = d.nih_profile_id.replace(/\D/g, "") || null;
    const email = d.email ? d.email.toLowerCase() : null;
    const fullName = `${d.first_name} ${d.last_name}`.trim();
    const communityId = resolveCommunity(d.communities);

    const base = {
      first_name: d.first_name,
      last_name: d.last_name,
      middle_initial: d.middle_initial || null,
      full_name: fullName,
      email,
      home_department: d.home_department || null,
      division: d.division || null,
      rank: d.rank || null,
      nih_profile_id: nihProfileId,
      orcid,
      research_community_id: communityId,
      title_series: d.title_series || null,
    };
    // self_declared_materials is derived from clinical_samples / biobanks, which are kept on the raw profile themselves.
    const rawProfile = { ...d, extra: undefined, self_declared_materials: undefined, ...d.extra, source: "csv", file_name: input.fileName, imported_by: guard.actor.userId };
    const now = new Date().toISOString();

    let id: string | null = null;
    type ExistingRow = { id: string; raw_profile_json: unknown; orcid: string | null; self_declared_axes: unknown };
    let existing: ExistingRow | null = null;
    if (email) {
      const { data } = await guard.admin.from("investigators").select("id, raw_profile_json, orcid, self_declared_axes").ilike("email", email).is("archived_at", null).maybeSingle();
      existing = (data as ExistingRow | null) ?? null;
    }
    if (existing) {
      if (!input.updateExisting) {
        result.errors.push({ line: d.line, message: `${fullName} is already in the directory (${email}); skipped` });
        continue;
      }
      const patch: Record<string, unknown> = { raw_profile_json: { ...((existing.raw_profile_json as Record<string, unknown> | null) ?? {}), ...rawProfile } };
      for (const [k, v] of Object.entries(base)) if (v != null && v !== "") patch[k] = v;
      // Materials the intake sheet implies are added to what the person declared; ratings are never touched.
      const prevAxes = readSelfDeclaredAxes(existing.self_declared_axes);
      const nextAxes = mergeImportedMaterials(prevAxes, d.self_declared_materials, now);
      if (nextAxes !== prevAxes) patch.self_declared_axes = nextAxes;
      const { error } = await guard.admin.from("investigators").update(patch).eq("id", existing.id);
      if (error) {
        result.errors.push({ line: d.line, message: error.message });
        continue;
      }
      id = existing.id;
      result.updated += 1;
    } else {
      const { data: inserted, error } = await guard.admin
        .from("investigators")
        .insert({ ...base, affiliations: d.communities, raw_profile_json: rawProfile, self_declared_axes: mergeImportedMaterials(null, d.self_declared_materials, now) })
        .select("id")
        .single();
      if (error || !inserted) {
        result.errors.push({ line: d.line, message: error?.message ?? "Insert failed" });
        continue;
      }
      id = (inserted as { id: string }).id;
      result.created += 1;
    }

    const feats = buildInvestigatorFeatureRow({
      primary_research_area: d.primary_research_area,
      secondary_research_areas: d.secondary_research_areas,
      primary_disease_focus: d.primary_disease_focus,
      secondary_disease_focuses: d.secondary_disease_focuses,
      technological_expertise: d.technological_expertise,
      clinical_samples: d.clinical_samples,
      biobanks: d.biobanks,
      small_grants: d.small_grants,
      large_grants: d.large_grants,
      affiliations: d.communities.join("; "),
      research_summary: d.research_summary,
      division: d.division,
      rank: d.rank,
    });
    await guard.admin.from("investigator_profile_features").upsert({ investigator_id: id, ...feats }, { onConflict: "investigator_id" });
    if (nihProfileId) await touchSource(guard.admin, id, "reporter", { external_id: nihProfileId, identity_method: "profile_id", state: "available" });
    if (orcid) await syncOrcidSource(guard.admin, id, orcid, existing?.orcid ?? null, `imported from ${input.fileName ?? "CSV"}`);
    result.ids.push(id);
  }

  revalidatePath("/investigators");
  return { ok: true, ...result };
}

/** Which of these emails already belong to someone in the directory (import preview). */
export async function previewImportEmailsAction(emails: string[]): Promise<Result<{ existing: string[] }>> {
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const clean = Array.from(new Set(emails.map((e) => String(e).trim().toLowerCase()).filter((e) => e.includes("@")))).slice(0, 2000);
  if (!clean.length) return { ok: true, existing: [] };
  const existing: string[] = [];
  for (let i = 0; i < clean.length; i += 200) {
    const { data } = await guard.admin.from("investigators").select("email").is("archived_at", null).in("email", clean.slice(i, i + 200));
    for (const r of (data ?? []) as Array<{ email: string | null }>) if (r.email) existing.push(r.email.toLowerCase());
  }
  return { ok: true, existing };
}
