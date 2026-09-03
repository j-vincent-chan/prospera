"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fmtMonD } from "@/lib/investigators/sources";
import { hookFromReasons } from "@/lib/outreach/draft";
import { parseProfile } from "@/lib/outreach/profile";
import { sendOutreach, type SendTarget } from "@/lib/outreach/send";
import { canMove, stageChangeText } from "@/lib/outreach/stages";
import { runSuggestions } from "@/lib/outreach/suggest";
import { DISMISS_REASON_LABEL, FACETS, STAGES, type DismissReason, type FacetKey, type OpportunityProfile, type Outcome, type OutreachStage, type SuggestionOptions, type SuggestionReason } from "@/lib/outreach/types";
import { requireTeamRole } from "@/lib/team/require-team";
import type { SupabaseClient } from "@supabase/supabase-js";

type Fail = { ok: false; error: string };
type Ok<T> = { ok: true } & T;
type Result<T = Record<never, never>> = Ok<T> | Fail;

const uuid = z.string().uuid();

function revalidate(itemId?: string) {
  revalidatePath("/outreach");
  revalidatePath("/opportunities");
  revalidatePath("/home");
  if (itemId) revalidatePath(`/outreach?item=${itemId}`);
}

async function guardItem(itemId: string) {
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const id = uuid.safeParse(itemId);
  if (!id.success) return { ok: false as const, error: "Invalid item." };
  const { data } = await guard.admin.from("outreach_items").select("id, team_id, stage, outcome, opportunity_id, profile, profile_version, suggestion_options, parked_from").eq("id", id.data).eq("team_id", guard.actor.teamId).maybeSingle();
  if (!data) return { ok: false as const, error: "Outreach item not found." };
  return { ...guard, item: data as { id: string; team_id: string; stage: OutreachStage; outcome: Outcome | null; opportunity_id: string; profile: unknown; profile_version: number; suggestion_options: Partial<SuggestionOptions> | null; parked_from: OutreachStage | null } };
}

async function log(admin: SupabaseClient, input: { itemId: string; teamId: string; actorId: string | null; actorName: string; kind: string; text: string; payload?: Record<string, unknown>; mentions?: string[] }) {
  await admin.from("outreach_activity").insert({ item_id: input.itemId, team_id: input.teamId, actor_id: input.actorId, actor_name: input.actorName, kind: input.kind, text: input.text, payload: input.payload ?? {}, mentions: input.mentions ?? [] });
  await admin.from("outreach_items").update({ last_activity_at: new Date().toISOString() }).eq("id", input.itemId);
}

// ---------------------------------------------------------------------------
// Items and stages
// ---------------------------------------------------------------------------

export async function createOutreachItemAction(opportunityId: string): Promise<Result<{ itemId: string; created: boolean }>> {
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const id = uuid.safeParse(opportunityId);
  if (!id.success) return { ok: false, error: "Invalid opportunity." };
  const { data: existing } = await guard.admin.from("outreach_items").select("id").eq("team_id", guard.actor.teamId).eq("opportunity_id", id.data).maybeSingle();
  if (existing) return { ok: true, itemId: (existing as { id: string }).id, created: false };
  const { data, error } = await guard.admin.from("outreach_items").insert({ team_id: guard.actor.teamId, opportunity_id: id.data, created_by: guard.actor.userId, owner_id: guard.actor.userId }).select("id").single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not add the opportunity." };
  const itemId = (data as { id: string }).id;
  await log(guard.admin, { itemId, teamId: guard.actor.teamId, actorId: guard.actor.userId, actorName: guard.actor.fullName ?? "Teammate", kind: "created", text: "saved to outreach · Triage" });
  revalidate(itemId);
  return { ok: true, itemId, created: true };
}

export async function setStageAction(input: { itemId: string; stage: OutreachStage; outcome?: Outcome | null; outcomeNote?: string | null; parkedReason?: string | null }): Promise<Result<{ previous: OutreachStage }>> {
  const g = await guardItem(input.itemId);
  if (!g.ok) return g;
  if (!STAGES.includes(input.stage)) return { ok: false, error: "Unknown stage." };
  const outcome = input.outcome ?? g.item.outcome;
  const check = canMove(g.item.stage, input.stage, input.stage === "outcome" ? outcome : g.item.outcome);
  if (!check.ok) return { ok: false, error: check.reason };
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { stage: input.stage, last_activity_at: now };
  if (input.stage === "submitted") patch.submitted_at = now;
  if (input.stage === "outcome") {
    patch.outcome = outcome;
    patch.outcome_note = input.outcomeNote ?? null;
    patch.outcome_at = now;
  }
  if (input.stage === "parked") {
    patch.parked_reason = input.parkedReason ?? null;
    patch.parked_from = g.item.stage;
  } else {
    patch.parked_reason = null;
    patch.parked_from = null;
  }
  const { error } = await g.admin.from("outreach_items").update(patch).eq("id", g.item.id);
  if (error) return { ok: false, error: error.message };
  await log(g.admin, { itemId: g.item.id, teamId: g.item.team_id, actorId: g.actor.userId, actorName: g.actor.fullName ?? "Teammate", kind: input.stage === "parked" ? "parked" : input.stage === "outcome" ? "outcome" : "stage_change", text: input.stage === "parked" ? `parked${input.parkedReason ? ` · ${input.parkedReason}` : ""}` : stageChangeText(input.stage, outcome), payload: { from: g.item.stage, to: input.stage } });
  revalidate(g.item.id);
  return { ok: true, previous: g.item.stage };
}

export async function unparkAction(itemId: string): Promise<Result<{ stage: OutreachStage }>> {
  const g = await guardItem(itemId);
  if (!g.ok) return g;
  const to = g.item.parked_from ?? "triage";
  const { error } = await g.admin.from("outreach_items").update({ stage: to, parked_reason: null, parked_from: null, last_activity_at: new Date().toISOString() }).eq("id", g.item.id);
  if (error) return { ok: false, error: error.message };
  await log(g.admin, { itemId: g.item.id, teamId: g.item.team_id, actorId: g.actor.userId, actorName: g.actor.fullName ?? "Teammate", kind: "stage_change", text: `resumed · ${stageChangeText(to)}` });
  revalidate(g.item.id);
  return { ok: true, stage: to };
}

export async function setOwnerAction(itemId: string, ownerId: string | null): Promise<Result> {
  const g = await guardItem(itemId);
  if (!g.ok) return g;
  if (ownerId && !uuid.safeParse(ownerId).success) return { ok: false, error: "Invalid owner." };
  const { error } = await g.admin.from("outreach_items").update({ owner_id: ownerId }).eq("id", g.item.id);
  if (error) return { ok: false, error: error.message };
  let name = "Unassigned";
  if (ownerId) {
    const { data } = await g.admin.from("profiles").select("full_name, email").eq("id", ownerId).maybeSingle();
    name = (data as { full_name?: string | null; email?: string | null } | null)?.full_name ?? (data as { email?: string | null } | null)?.email ?? "a teammate";
  }
  await log(g.admin, { itemId: g.item.id, teamId: g.item.team_id, actorId: g.actor.userId, actorName: g.actor.fullName ?? "Teammate", kind: "owner_changed", text: `set the owner to ${name}` });
  revalidate(g.item.id);
  return { ok: true };
}

export async function setNextActionAction(itemId: string, input: { text: string; date: string | null }): Promise<Result> {
  const g = await guardItem(itemId);
  if (!g.ok) return g;
  const text = input.text.trim().slice(0, 200);
  const date = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : null;
  const { error } = await g.admin.from("outreach_items").update({ next_action: text || null, next_action_date: date }).eq("id", g.item.id);
  if (error) return { ok: false, error: error.message };
  await log(g.admin, { itemId: g.item.id, teamId: g.item.team_id, actorId: g.actor.userId, actorName: g.actor.fullName ?? "Teammate", kind: "next_action", text: text ? `set the next action · ${text}${date ? ` · due ${fmtMonD(date)}` : ""}` : "cleared the next action" });
  revalidate(g.item.id);
  return { ok: true };
}

export async function addNoteAction(itemId: string, text: string): Promise<Result> {
  const g = await guardItem(itemId);
  if (!g.ok) return g;
  const t = text.trim().slice(0, 4000);
  if (!t) return { ok: false, error: "Write something first." };
  const { data: members } = await g.admin.from("team_memberships").select("user_id, profiles(full_name)").eq("team_id", g.item.team_id);
  const mentions: string[] = [];
  for (const m of (members ?? []) as Array<{ user_id: string; profiles: { full_name: string | null } | { full_name: string | null }[] | null }>) {
    const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    const first = p?.full_name?.trim().split(/\s+/)[0];
    if (first && new RegExp(`@${first}\\b`, "i").test(t)) mentions.push(m.user_id);
  }
  await log(g.admin, { itemId: g.item.id, teamId: g.item.team_id, actorId: g.actor.userId, actorName: g.actor.fullName ?? "Teammate", kind: "note", text: t, mentions });
  revalidate(g.item.id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Recipients and communities
// ---------------------------------------------------------------------------

export async function addRecipientsAction(input: { itemId: string; investigatorIds?: string[]; communityIds?: string[]; origin?: "you" | "suggested" }): Promise<Result<{ added: string[] }>> {
  const g = await guardItem(input.itemId);
  if (!g.ok) return g;
  const people = z.array(uuid).max(200).safeParse(input.investigatorIds ?? []);
  const comms = z.array(uuid).max(50).safeParse(input.communityIds ?? []);
  if (!people.success || !comms.success) return { ok: false, error: "Invalid selection." };
  const origin = input.origin ?? "you";
  const added: string[] = [];
  const now = new Date().toISOString();

  if (people.data.length) {
    const { data: inv } = await g.admin.from("investigators").select("id, full_name, do_not_contact_at").in("id", people.data);
    const { data: existing } = await g.admin.from("outreach_recipients").select("id, investigator_id, removed_at").eq("item_id", g.item.id).eq("kind", "person").in("investigator_id", people.data);
    const existingBy = new Map(((existing ?? []) as Array<{ id: string; investigator_id: string; removed_at: string | null }>).map((r) => [r.investigator_id, r]));
    for (const p of (inv ?? []) as Array<{ id: string; full_name: string; do_not_contact_at: string | null }>) {
      const prev = existingBy.get(p.id);
      if (prev && !prev.removed_at) continue;
      if (prev) await g.admin.from("outreach_recipients").update({ removed_at: null, removed_by: null, origin, status: "selected", added_by: g.actor.userId, added_at: now }).eq("id", prev.id);
      else {
        const { data: sug } = await g.admin.from("outreach_suggestions").select("reasons").eq("item_id", g.item.id).eq("investigator_id", p.id).maybeSingle();
        const hook = sug ? hookFromReasons(((sug as { reasons?: SuggestionReason[] }).reasons ?? []) as SuggestionReason[], {}) : null;
        await g.admin.from("outreach_recipients").insert({ item_id: g.item.id, kind: "person", investigator_id: p.id, origin, status: "selected", hook, added_by: g.actor.userId });
      }
      added.push(p.full_name);
    }
    await g.admin.from("outreach_suggestions").update({ status: "added" }).eq("item_id", g.item.id).in("investigator_id", people.data);
  }
  if (comms.data.length) {
    const { data: cs } = await g.admin.from("pipeline_communities").select("id, label").in("id", comms.data);
    const { data: existing } = await g.admin.from("outreach_recipients").select("id, community_id, removed_at").eq("item_id", g.item.id).eq("kind", "community").in("community_id", comms.data);
    const existingBy = new Map(((existing ?? []) as Array<{ id: string; community_id: string; removed_at: string | null }>).map((r) => [r.community_id, r]));
    for (const c of (cs ?? []) as Array<{ id: string; label: string }>) {
      const prev = existingBy.get(c.id);
      if (prev && !prev.removed_at) continue;
      if (prev) await g.admin.from("outreach_recipients").update({ removed_at: null, removed_by: null, added_by: g.actor.userId, added_at: now }).eq("id", prev.id);
      else await g.admin.from("outreach_recipients").insert({ item_id: g.item.id, kind: "community", community_id: c.id, origin, status: "selected", added_by: g.actor.userId });
      await g.admin.from("outreach_community_evaluations").update({ dismissed_at: null, dismissed_by: null }).eq("item_id", g.item.id).eq("community_id", c.id);
      added.push(c.label);
      await log(g.admin, { itemId: g.item.id, teamId: g.item.team_id, actorId: g.actor.userId, actorName: g.actor.fullName ?? "Teammate", kind: "community_tagged", text: `tagged ${c.label}` });
    }
  }
  if (people.data.length && added.length) {
    await log(g.admin, { itemId: g.item.id, teamId: g.item.team_id, actorId: g.actor.userId, actorName: g.actor.fullName ?? "Teammate", kind: "recipient_added", text: `added ${added.join(", ")} to recipients` });
  }
  revalidate(g.item.id);
  return { ok: true, added };
}

export async function removeRecipientAction(recipientId: string): Promise<Result<{ itemId: string; name: string }>> {
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const id = uuid.safeParse(recipientId);
  if (!id.success) return { ok: false, error: "Invalid recipient." };
  const { data: r } = await guard.admin.from("outreach_recipients").select("id, item_id, kind, investigator_id, community_id, origin, investigators(full_name), pipeline_communities(label), outreach_items!inner(team_id)").eq("id", id.data).eq("outreach_items.team_id", guard.actor.teamId).maybeSingle();
  if (!r) return { ok: false, error: "Recipient not found." };
  const row = r as unknown as { id: string; item_id: string; kind: string; investigator_id: string | null; community_id: string | null; origin: string; investigators: { full_name: string } | { full_name: string }[] | null; pipeline_communities: { label: string } | { label: string }[] | null };
  const inv = Array.isArray(row.investigators) ? row.investigators[0] : row.investigators;
  const com = Array.isArray(row.pipeline_communities) ? row.pipeline_communities[0] : row.pipeline_communities;
  const name = inv?.full_name ?? com?.label ?? "Recipient";
  await guard.admin.from("outreach_recipients").update({ removed_at: new Date().toISOString(), removed_by: guard.actor.userId }).eq("id", row.id);
  if (row.kind === "person" && row.investigator_id) await guard.admin.from("outreach_suggestions").update({ status: "active" }).eq("item_id", row.item_id).eq("investigator_id", row.investigator_id).eq("status", "added");
  await log(guard.admin, { itemId: row.item_id, teamId: guard.actor.teamId, actorId: guard.actor.userId, actorName: guard.actor.fullName ?? "Teammate", kind: row.kind === "community" ? "community_removed" : "recipient_removed", text: `removed ${name}${row.kind === "community" ? " from this opportunity" : " from recipients"}` });
  revalidate(row.item_id);
  return { ok: true, itemId: row.item_id, name };
}

export async function restoreRecipientAction(recipientId: string): Promise<Result> {
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const id = uuid.safeParse(recipientId);
  if (!id.success) return { ok: false, error: "Invalid recipient." };
  const { data: r } = await guard.admin.from("outreach_recipients").select("id, item_id, kind, investigator_id, outreach_items!inner(team_id)").eq("id", id.data).eq("outreach_items.team_id", guard.actor.teamId).maybeSingle();
  if (!r) return { ok: false, error: "Recipient not found." };
  const row = r as unknown as { id: string; item_id: string; kind: string; investigator_id: string | null };
  await guard.admin.from("outreach_recipients").update({ removed_at: null, removed_by: null }).eq("id", row.id);
  if (row.kind === "person" && row.investigator_id) await guard.admin.from("outreach_suggestions").update({ status: "added" }).eq("item_id", row.item_id).eq("investigator_id", row.investigator_id);
  revalidate(row.item_id);
  return { ok: true };
}

export async function dismissCommunityAction(itemId: string, communityId: string, dismissed: boolean): Promise<Result> {
  const g = await guardItem(itemId);
  if (!g.ok) return g;
  if (!uuid.safeParse(communityId).success) return { ok: false, error: "Invalid community." };
  const { error } = await g.admin.from("outreach_community_evaluations").upsert({ item_id: g.item.id, community_id: communityId, tier: "not_suggested", dismissed_at: dismissed ? new Date().toISOString() : null, dismissed_by: dismissed ? g.actor.userId : null }, { onConflict: "item_id,community_id", ignoreDuplicates: false });
  if (error) {
    const { error: e2 } = await g.admin.from("outreach_community_evaluations").update({ dismissed_at: dismissed ? new Date().toISOString() : null, dismissed_by: dismissed ? g.actor.userId : null }).eq("item_id", g.item.id).eq("community_id", communityId);
    if (e2) return { ok: false, error: e2.message };
  }
  revalidate(g.item.id);
  return { ok: true };
}

export async function searchDirectoryAction(q: string, itemId: string): Promise<Result<{ people: Array<{ id: string; name: string; meta: string; email: string | null; alreadyAdded: boolean }> }>> {
  const g = await guardItem(itemId);
  if (!g.ok) return g;
  const term = q.trim().slice(0, 80);
  if (term.length < 2) return { ok: true, people: [] };
  const pattern = `%${term.replace(/[%_]/g, "")}%`;
  const [{ data: rows }, { data: added }] = await Promise.all([
    g.admin.from("investigators").select("id, full_name, email, home_department, division, pipeline_communities(label)").is("archived_at", null).or(`full_name.ilike.${pattern},home_department.ilike.${pattern},division.ilike.${pattern},email.ilike.${pattern}`).order("full_name").limit(8),
    g.admin.from("outreach_recipients").select("investigator_id").eq("item_id", g.item.id).eq("kind", "person").is("removed_at", null),
  ]);
  const addedSet = new Set(((added ?? []) as Array<{ investigator_id: string }>).map((a) => a.investigator_id));
  return {
    ok: true,
    people: ((rows ?? []) as Array<Record<string, unknown>>).map((r) => {
      const c = (Array.isArray(r.pipeline_communities) ? r.pipeline_communities[0] : r.pipeline_communities) as { label: string } | null;
      return { id: r.id as string, name: String(r.full_name), meta: [r.home_department, r.division, c?.label].filter(Boolean).join(" · "), email: (r.email as string | null) ?? null, alreadyAdded: addedSet.has(r.id as string) };
    }),
  };
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

export async function regenerateSuggestionsAction(itemId: string, options?: Partial<SuggestionOptions>): Promise<Result<{ suggested: number; excluded: number; communities: number }>> {
  const g = await guardItem(itemId);
  if (!g.ok) return g;
  if (options) await g.admin.from("outreach_items").update({ suggestion_options: { ...(g.item.suggestion_options ?? {}), ...options } }).eq("id", g.item.id);
  const r = await runSuggestions(g.admin, g.item.id, { id: g.actor.userId, name: g.actor.fullName ?? "Teammate" });
  revalidate(g.item.id);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, suggested: r.suggested, excluded: r.excluded, communities: r.communities };
}

export async function setSuggestionsModeAction(itemId: string, mode: "manual" | "ready"): Promise<Result> {
  const g = await guardItem(itemId);
  if (!g.ok) return g;
  const { error } = await g.admin.from("outreach_items").update({ suggestions_state: mode }).eq("id", g.item.id);
  if (error) return { ok: false, error: error.message };
  revalidate(g.item.id);
  return { ok: true };
}

export async function dismissSuggestionAction(input: { itemId: string; suggestionIds: string[]; reason: DismissReason }): Promise<Result<{ previous: Array<{ id: string; status: string }>; names: string[] }>> {
  const g = await guardItem(input.itemId);
  if (!g.ok) return g;
  const ids = z.array(uuid).min(1).max(200).safeParse(input.suggestionIds);
  if (!ids.success) return { ok: false, error: "Nothing selected." };
  const { data: rows } = await g.admin.from("outreach_suggestions").select("id, status, investigator_id, investigators(full_name)").eq("item_id", g.item.id).in("id", ids.data);
  const list = (rows ?? []) as Array<{ id: string; status: string; investigator_id: string; investigators: { full_name: string } | { full_name: string }[] | null }>;
  const now = new Date().toISOString();
  await g.admin.from("outreach_suggestions").update({ status: "dismissed", dismissed_reason: input.reason || null, dismissed_by: g.actor.userId, dismissed_at: now }).eq("item_id", g.item.id).in("id", ids.data);
  const names = list.map((r) => (Array.isArray(r.investigators) ? r.investigators[0] : r.investigators)?.full_name ?? "Investigator");
  if (input.reason === "do_not_contact") {
    await g.admin.from("investigators").update({ do_not_contact_at: now, do_not_contact_by: g.actor.userId, do_not_contact_reason: "Set from an outreach dismissal" }).in("id", list.map((r) => r.investigator_id));
  }
  const label = input.reason ? DISMISS_REASON_LABEL[input.reason] : "";
  await log(g.admin, { itemId: g.item.id, teamId: g.item.team_id, actorId: g.actor.userId, actorName: g.actor.fullName ?? "Teammate", kind: "suggestion_dismissed", text: `dismissed ${names.join(", ")}${label ? ` · ${label}` : ""}`, payload: { reason: input.reason } });
  revalidate(g.item.id);
  return { ok: true, previous: list.map((r) => ({ id: r.id, status: r.status })), names };
}

export async function restoreSuggestionsAction(input: { itemId: string; previous: Array<{ id: string; status: string }>; undoDoNotContact?: boolean }): Promise<Result> {
  const g = await guardItem(input.itemId);
  if (!g.ok) return g;
  for (const p of input.previous.slice(0, 200)) {
    if (!uuid.safeParse(p.id).success) continue;
    await g.admin.from("outreach_suggestions").update({ status: ["active", "added", "excluded"].includes(p.status) ? p.status : "active", dismissed_reason: null, dismissed_by: null, dismissed_at: null }).eq("item_id", g.item.id).eq("id", p.id);
  }
  if (input.undoDoNotContact) {
    const { data: rows } = await g.admin.from("outreach_suggestions").select("investigator_id").eq("item_id", g.item.id).in("id", input.previous.map((p) => p.id));
    const ids = ((rows ?? []) as Array<{ investigator_id: string }>).map((r) => r.investigator_id);
    if (ids.length) await g.admin.from("investigators").update({ do_not_contact_at: null, do_not_contact_by: null, do_not_contact_reason: null }).in("id", ids).eq("do_not_contact_by", g.actor.userId);
  }
  revalidate(g.item.id);
  return { ok: true };
}

export async function updateProfileAction(itemId: string, facets: Record<FacetKey, string[]>): Promise<Result<{ previous: OpportunityProfile; removedSuggestions: number; profileVersion: number }>> {
  const g = await guardItem(itemId);
  if (!g.ok) return g;
  const previous = parseProfile(g.item.profile);
  const next: OpportunityProfile = { ...previous, version: previous.version + 1, editedBy: g.actor.userId, editedAt: new Date().toISOString(), facets: Object.fromEntries(FACETS.map((f) => [f.key, Array.from(new Set((facets[f.key] ?? []).map((s) => String(s).trim()).filter((s) => s && s.length <= 60))).slice(0, 12)])) as Record<FacetKey, string[]> };
  const { count: before } = await g.admin.from("outreach_suggestions").select("id", { count: "exact", head: true }).eq("item_id", g.item.id).eq("status", "active");
  const { error } = await g.admin.from("outreach_items").update({ profile: next, profile_version: next.version }).eq("id", g.item.id);
  if (error) return { ok: false, error: error.message };
  const removed = FACETS.flatMap((f) => previous.facets[f.key].filter((t) => !next.facets[f.key].includes(t)));
  const addedTerms = FACETS.flatMap((f) => next.facets[f.key].filter((t) => !previous.facets[f.key].includes(t)));
  await log(g.admin, { itemId: g.item.id, teamId: g.item.team_id, actorId: g.actor.userId, actorName: g.actor.fullName ?? "Teammate", kind: "profile_edited", text: `edited the opportunity profile${removed.length ? ` · removed ${removed.map((t) => `“${t}”`).join(", ")}` : ""}${addedTerms.length ? ` · added ${addedTerms.map((t) => `“${t}”`).join(", ")}` : ""} · v${next.version}` });
  const r = await runSuggestions(g.admin, g.item.id, { id: g.actor.userId, name: g.actor.fullName ?? "Teammate" });
  const { count: after } = await g.admin.from("outreach_suggestions").select("id", { count: "exact", head: true }).eq("item_id", g.item.id).eq("status", "active");
  revalidate(g.item.id);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, previous, removedSuggestions: Math.max(0, (before ?? 0) - (after ?? 0)), profileVersion: next.version };
}

export async function restoreProfileAction(itemId: string, previous: OpportunityProfile): Promise<Result> {
  const g = await guardItem(itemId);
  if (!g.ok) return g;
  const restored: OpportunityProfile = { ...parseProfile(previous), version: g.item.profile_version + 1, editedBy: g.actor.userId, editedAt: new Date().toISOString() };
  const { error } = await g.admin.from("outreach_items").update({ profile: restored, profile_version: restored.version }).eq("id", g.item.id);
  if (error) return { ok: false, error: error.message };
  await runSuggestions(g.admin, g.item.id, { id: g.actor.userId, name: g.actor.fullName ?? "Teammate" });
  revalidate(g.item.id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Compose and send
// ---------------------------------------------------------------------------

const draftSchema = z.object({
  subject: z.string().max(400).optional(),
  body: z.string().max(20_000).optional(),
  mode: z.enum(["one", "personalized"]).optional(),
  to: z.array(uuid).max(200).optional(),
  hooks: z.record(z.string(), z.string().max(400)).optional(),
});

export async function saveDraftAction(itemId: string, draft: z.input<typeof draftSchema>): Promise<Result<{ savedAt: string }>> {
  const g = await guardItem(itemId);
  if (!g.ok) return g;
  const parsed = draftSchema.safeParse(draft);
  if (!parsed.success) return { ok: false, error: "Draft could not be saved." };
  const savedAt = new Date().toISOString();
  const { error } = await g.admin.from("outreach_items").update({ draft: parsed.data, draft_saved_at: savedAt }).eq("id", g.item.id);
  if (error) return { ok: false, error: error.message };
  if (parsed.data.hooks) {
    for (const [recipientId, hook] of Object.entries(parsed.data.hooks)) {
      if (uuid.safeParse(recipientId).success) await g.admin.from("outreach_recipients").update({ hook }).eq("id", recipientId).eq("item_id", g.item.id);
    }
  }
  return { ok: true, savedAt };
}

export async function sendOutreachAction(input: { itemId: string; subject: string; body: string; mode: "one" | "personalized"; recipientIds: string[]; hooks: Record<string, string> }): Promise<Result<{ sent: number; failed: Array<{ name: string; error: string }> }>> {
  const g = await guardItem(input.itemId);
  if (!g.ok) return g;
  const ids = z.array(uuid).min(1).max(200).safeParse(input.recipientIds);
  if (!ids.success) return { ok: false, error: "Pick at least one recipient." };
  const [{ data: recs }, { data: team }] = await Promise.all([
    g.admin.from("outreach_recipients").select("id, kind, investigator_id, community_id, hook, investigators(full_name, last_name, email, do_not_contact_at), pipeline_communities(label)").eq("item_id", g.item.id).is("removed_at", null).in("id", ids.data),
    g.admin.from("teams").select("reply_to_email, per_investigator_limit").eq("id", g.item.team_id).maybeSingle(),
  ]);
  const targets: SendTarget[] = [];
  const skipped: string[] = [];
  for (const r of (recs ?? []) as Array<Record<string, unknown>>) {
    const inv = (Array.isArray(r.investigators) ? r.investigators[0] : r.investigators) as { full_name: string; last_name: string | null; email: string | null; do_not_contact_at: string | null } | null;
    const com = (Array.isArray(r.pipeline_communities) ? r.pipeline_communities[0] : r.pipeline_communities) as { label: string } | null;
    const name = inv?.full_name ?? com?.label ?? "Recipient";
    const email = inv?.email?.trim() ?? null;
    if (!email) {
      skipped.push(name);
      continue;
    }
    targets.push({ recipientId: r.id as string, kind: r.kind as "person" | "community", investigatorId: (r.investigator_id as string | null) ?? null, communityId: (r.community_id as string | null) ?? null, name, lastName: inv?.last_name?.trim() || name.split(/\s+/).slice(-1)[0] || name, email, personalLine: input.hooks[r.id as string] ?? (r.hook as string | null) ?? null });
  }
  if (!targets.length) return { ok: false, error: skipped.length ? `${skipped.join(", ")} ${skipped.length === 1 ? "has" : "have"} no email address on file.` : "No recipients to send to." };
  const t = (team ?? {}) as { reply_to_email?: string | null; per_investigator_limit?: number };
  const res = await sendOutreach(g.admin, {
    itemId: g.item.id,
    teamId: g.item.team_id,
    sender: { id: g.actor.userId, name: g.actor.fullName ?? "Prospera", email: g.actor.email },
    team: { replyToEmail: t.reply_to_email ?? null, perInvestigatorLimit: t.per_investigator_limit ?? 2 },
    subject: input.subject,
    body: input.body,
    mode: input.mode,
    targets,
  });
  revalidate(g.item.id);
  if (!res.ok) return res;
  return { ok: true, sent: res.sent, failed: [...res.failed, ...skipped.map((name) => ({ name, error: "No email address on file" }))] };
}

export async function recordReplyAction(input: { recipientId: string; kind: "replied_interested" | "replied_maybe" | "replied_not_now" | "declined"; note: string | null }): Promise<Result> {
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const id = uuid.safeParse(input.recipientId);
  if (!id.success) return { ok: false, error: "Invalid recipient." };
  const { data: r } = await guard.admin.from("outreach_recipients").select("id, item_id, investigators(full_name), outreach_items!inner(team_id)").eq("id", id.data).eq("outreach_items.team_id", guard.actor.teamId).maybeSingle();
  if (!r) return { ok: false, error: "Recipient not found." };
  const row = r as unknown as { id: string; item_id: string; investigators: { full_name: string } | { full_name: string }[] | null };
  const name = (Array.isArray(row.investigators) ? row.investigators[0] : row.investigators)?.full_name ?? "Recipient";
  const now = new Date().toISOString();
  await guard.admin.from("outreach_recipients").update({ status: input.kind, replied_at: now, reply_note: input.note?.trim().slice(0, 1000) || null, reply_source: "manual" }).eq("id", row.id);
  const label = input.kind === "replied_interested" ? "Interested" : input.kind === "replied_maybe" ? "Maybe" : input.kind === "replied_not_now" ? "Not now" : "Declined";
  await log(guard.admin, { itemId: row.item_id, teamId: guard.actor.teamId, actorId: guard.actor.userId, actorName: name, kind: "reply", text: `replied ${label}${input.note ? ` · “${input.note.trim().slice(0, 120)}”` : ""} (recorded by ${guard.actor.fullName ?? "a teammate"})` });
  revalidate(row.item_id);
  return { ok: true };
}
