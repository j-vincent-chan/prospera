"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runFundingChat, type FundingChatMessage, type FundingChatSource } from "@/lib/ai/funding-chat";
import { requireTeamRole } from "@/lib/team/require-team";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const uuid = z.string().uuid();

function revalidateOpportunities() {
  revalidatePath("/opportunities");
  revalidatePath("/home");
}

// ---------------------------------------------------------------------------
// Dismiss (team-level) with Undo
// ---------------------------------------------------------------------------

export async function dismissOpportunitiesAction(input: { opportunityIds: string[] }): Promise<Result<{ dismissed: number }>> {
  const ids = z.array(uuid).min(1).max(500).safeParse(input.opportunityIds);
  if (!ids.success) return { ok: false, error: "Nothing to dismiss." };
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const { admin, actor } = guard;

  // Insert only what the team hasn't dismissed yet (no ON CONFLICT: the
  // unique key arrives with 20260904110000_dismissed_unique_index.sql).
  const { data: existing } = await admin
    .from("dismissed_funding_opportunities")
    .select("opportunity_id")
    .eq("team_id", actor.teamId)
    .in("opportunity_id", ids.data);
  const have = new Set(((existing ?? []) as Array<{ opportunity_id: string }>).map((r) => r.opportunity_id));
  const rows = ids.data
    .filter((id) => !have.has(id))
    .map((opportunity_id) => ({ team_id: actor.teamId, user_id: actor.userId, dismissed_by: actor.userId, opportunity_id }));
  if (rows.length) {
    const { error } = await admin.from("dismissed_funding_opportunities").insert(rows);
    if (error) return { ok: false, error: error.message };
  }

  // A dismissed notice leaves the team's saved list.
  await admin.from("saved_funding_opportunities").delete().eq("team_id", actor.teamId).in("opportunity_id", ids.data);
  revalidateOpportunities();
  return { ok: true, dismissed: ids.data.length };
}

/** Undo for dismiss, and the "Restore" affordance in the Dismissed filter. */
export async function restoreOpportunitiesAction(input: { opportunityIds: string[] }): Promise<Result> {
  const ids = z.array(uuid).min(1).max(500).safeParse(input.opportunityIds);
  if (!ids.success) return { ok: false, error: "Nothing to restore." };
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const { error } = await guard.admin
    .from("dismissed_funding_opportunities")
    .delete()
    .eq("team_id", guard.actor.teamId)
    .in("opportunity_id", ids.data);
  if (error) return { ok: false, error: error.message };
  revalidateOpportunities();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Watch next cycle
// ---------------------------------------------------------------------------

export async function setWatchAction(input: { opportunityIds: string[]; watching: boolean }): Promise<Result> {
  const ids = z.array(uuid).min(1).max(500).safeParse(input.opportunityIds);
  if (!ids.success) return { ok: false, error: "Nothing selected." };
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const { admin, actor } = guard;

  if (input.watching) {
    const rows = ids.data.map((opportunity_id) => ({ team_id: actor.teamId, opportunity_id, created_by: actor.userId }));
    const { error } = await admin.from("opportunity_watches").upsert(rows, { onConflict: "team_id,opportunity_id", ignoreDuplicates: true });
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await admin.from("opportunity_watches").delete().eq("team_id", actor.teamId).in("opportunity_id", ids.data);
    if (error) return { ok: false, error: error.message };
  }
  revalidateOpportunities();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Save to outreach (team-level saved list; becomes Triage in step 5)
// ---------------------------------------------------------------------------

export async function saveOpportunitiesAction(input: { opportunityIds: string[]; saved: boolean }): Promise<Result<{ changed: number; itemId?: string }>> {
  const ids = z.array(uuid).min(1).max(500).safeParse(input.opportunityIds);
  if (!ids.success) return { ok: false, error: "Nothing selected." };
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const { admin, actor } = guard;

  if (!input.saved) {
    // Only untouched Triage items can be removed from the board; anything with history stays and is parked instead.
    const { data: items } = await admin.from("outreach_items").select("id, stage").eq("team_id", actor.teamId).in("opportunity_id", ids.data);
    const rows = (items ?? []) as Array<{ id: string; stage: string }>;
    const itemIds = rows.map((r) => r.id);
    const { data: touched } = itemIds.length ? await admin.from("outreach_messages").select("item_id").in("item_id", itemIds) : { data: [] };
    const keep = new Set(((touched ?? []) as Array<{ item_id: string }>).map((t) => t.item_id));
    const removable = rows.filter((r) => r.stage === "triage" && !keep.has(r.id)).map((r) => r.id);
    const toPark = rows.filter((r) => !removable.includes(r.id)).map((r) => r.id);
    if (removable.length) await admin.from("outreach_items").delete().in("id", removable);
    if (toPark.length) await admin.from("outreach_items").update({ stage: "parked", parked_reason: "Removed from Opportunities", last_activity_at: new Date().toISOString() }).in("id", toPark).neq("stage", "parked");
    revalidateOpportunities();
    revalidatePath("/outreach");
    return { ok: true, changed: rows.length };
  }

  const { data: existing } = await admin.from("outreach_items").select("id, opportunity_id").eq("team_id", actor.teamId).in("opportunity_id", ids.data);
  const have = new Map(((existing ?? []) as Array<{ id: string; opportunity_id: string }>).map((r) => [r.opportunity_id, r.id]));
  const rows = ids.data.filter((id) => !have.has(id)).map((opportunity_id) => ({ team_id: actor.teamId, opportunity_id, created_by: actor.userId, owner_id: actor.userId }));
  let firstId = have.get(ids.data[0]!) ?? null;
  if (rows.length) {
    const { data: inserted, error } = await admin.from("outreach_items").insert(rows).select("id, opportunity_id");
    if (error) return { ok: false, error: error.message };
    const ins = (inserted ?? []) as Array<{ id: string; opportunity_id: string }>;
    if (!firstId) firstId = ins.find((r) => r.opportunity_id === ids.data[0])?.id ?? ins[0]?.id ?? null;
    if (ins.length) {
      await admin.from("outreach_activity").insert(ins.map((r) => ({ item_id: r.id, team_id: actor.teamId, actor_id: actor.userId, actor_name: actor.fullName ?? "Teammate", kind: "created", text: "saved to outreach · Triage" })));
    }
  }
  await admin.from("dismissed_funding_opportunities").delete().eq("team_id", actor.teamId).in("opportunity_id", ids.data);
  revalidateOpportunities();
  revalidatePath("/outreach");
  return { ok: true, changed: rows.length, itemId: firstId ?? undefined };
}

// ---------------------------------------------------------------------------
// Saved searches (v2 dialog: name, visibility, alert mode, forecasted)
// ---------------------------------------------------------------------------

export async function saveSearchV2Action(input: {
  name: string;
  state: unknown;
  visibility: "personal" | "team";
  alerts: "weekly" | "daily" | "none";
  includeForecasted: boolean;
}): Promise<Result<{ id: string }>> {
  const parsed = z
    .object({
      name: z.string().trim().min(1, "Give the search a name.").max(120),
      visibility: z.enum(["personal", "team"]),
      alerts: z.enum(["weekly", "daily", "none"]),
      includeForecasted: z.boolean(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const { admin, actor } = guard;

  const { data, error } = await admin
    .from("saved_funding_searches")
    .insert({
      user_id: actor.userId,
      team_id: actor.teamId,
      name: parsed.data.name,
      state: input.state,
      visibility: parsed.data.visibility,
      email_notifications_enabled: parsed.data.alerts !== "none",
      alert_frequency: parsed.data.alerts === "daily" ? "daily" : "weekly",
      alert_forecasted_notices: parsed.data.includeForecasted,
      alert_rdsg_owner_ids: [],
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not save the search." };
  revalidateOpportunities();
  return { ok: true, id: (data as { id: string }).id };
}

export async function deleteSavedSearchV2Action(input: { id: string }): Promise<Result> {
  if (!uuid.safeParse(input.id).success) return { ok: false, error: "Invalid search." };
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const { admin, actor } = guard;
  const { data } = await admin.from("saved_funding_searches").select("user_id").eq("id", input.id).eq("team_id", actor.teamId).maybeSingle();
  const owner = (data as { user_id?: string } | null)?.user_id;
  if (!owner) return { ok: false, error: "Search not found." };
  if (owner !== actor.userId && actor.role === "member") return { ok: false, error: "Only the person who saved it, or an admin, can delete this search." };
  const { error } = await admin.from("saved_funding_searches").delete().eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  revalidateOpportunities();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Ask
// ---------------------------------------------------------------------------

export type AskOutcome =
  | { kind: "answer"; answer: string; sources: FundingChatSource[] }
  | { kind: "empty"; question: string; answer: string }
  | { kind: "scope"; question: string; answer: string }
  | { kind: "limit"; limit: number; usedBy: number }
  | { kind: "error"; message: string };

const SCOPE_PATTERNS = /\b(send|email|e-mail|message|contact|notify|reach out to)\b[^.?!]{0,80}\b(pi|pis|investigator|investigators|dr\.?|professor|him|her|them|team)\b|\b(mark|move|update|change|delete|remove|archive)\b[^.?!]{0,60}\b(record|stage|status|outreach|item)\b/i;

/** Ask the catalog a question; enforces the team's daily allowance and the "read-only" scope. */
export async function askOpportunitiesAction(input: { messages: FundingChatMessage[] }): Promise<Result<{ outcome: AskOutcome }>> {
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const { admin, actor } = guard;

  const messages = (input.messages ?? []).filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim()).slice(-12);
  const question = [...messages].reverse().find((m) => m.role === "user")?.content.trim() ?? "";
  if (!question) return { ok: false, error: "Ask something first." };

  // Actions Ask must never take by itself (README: never sends or changes a record without a button press).
  if (SCOPE_PATTERNS.test(question)) {
    return {
      ok: true,
      outcome: {
        kind: "scope",
        question,
        answer: `I can’t send email or change outreach records from here. “${question}” needs a message you review first. I can draft it and open it in Outreach with the recipients selected.`,
      },
    };
  }

  const { data: usage, error: usageErr } = await admin.rpc("record_ask_usage", { p_team: actor.teamId, p_user: actor.userId });
  if (usageErr) return { ok: true, outcome: { kind: "error", message: `Ask couldn’t record usage: ${usageErr.message}` } };
  const u = (Array.isArray(usage) ? usage[0] : usage) as { count: number; daily_limit: number; user_count: number } | null;
  if (u && u.daily_limit > 0 && u.count > u.daily_limit) {
    return { ok: true, outcome: { kind: "limit", limit: u.daily_limit, usedBy: u.user_count } };
  }

  const timeout = new Promise<{ ok: false; error: string }>((resolve) => setTimeout(() => resolve({ ok: false, error: "timeout" }), 20_000));
  const result = await Promise.race([runFundingChat(guard.session, messages), timeout]);
  if (!result.ok) {
    return { ok: true, outcome: { kind: "error", message: result.error === "timeout" ? "The service didn’t respond within 20 seconds; nothing was changed." : result.error } };
  }
  if (result.sources.length === 0) {
    return { ok: true, outcome: { kind: "empty", question, answer: result.answer } };
  }
  return { ok: true, outcome: { kind: "answer", answer: result.answer, sources: result.sources } };
}
