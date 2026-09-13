"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPursuitStage, type PursuitStage } from "@/lib/outreach/matches";
import { OUTCOME_LABEL, type Outcome, type OutreachStage } from "@/lib/outreach/types";
import { REVIEW_BADGES_TAG } from "@/lib/review/badges";
import { requireTeamRole, type TeamActor } from "@/lib/team/require-team";

/**
 * The Outreach board's writes, on the match (README §5 "Move it on"). Each
 * verb changes the `outreach_recipients` row it names and logs the change on
 * the notice's activity, keyed to the investigator so the thread can show it.
 *
 * The notice's own stage is not the board's unit any more, but the surfaces
 * that read it are still there, so a match that moves ahead of its notice
 * pulls the notice along: pursuing → Developing, submitted → Submitted. It
 * never moves a notice back — "a notice is busy when any of its matches is".
 */

type Fail = { ok: false; error: string };
type Result = { ok: true } | Fail;
const uuid = z.string().uuid();
const MISSING_COLUMN = /could not find the .*column|column .* does not exist|schema cache/i;
const MIGRATION = "supabase/migrations/20260930100000_outreach_match_stage.sql";

function revalidate(itemId: string) {
  revalidatePath("/outreach");
  revalidatePath(`/outreach?item=${itemId}`);
  revalidatePath("/home");
  revalidatePath("/review");
  revalidateTag(REVIEW_BADGES_TAG);
}

type Guarded = { admin: SupabaseClient; actor: TeamActor; recipient: { id: string; item_id: string; investigator_id: string; status: string; pursuit_stage: PursuitStage | null }; item: { id: string; stage: OutreachStage; opportunity_id: string }; name: string };

/** The recipient, its item and the actor — refused unless the item is the actor's team's. */
async function guardRecipient(recipientId: string): Promise<({ ok: true } & Guarded) | Fail> {
  const id = uuid.safeParse(recipientId);
  if (!id.success) return { ok: false, error: "Invalid match." };
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const { data, error } = await guard.admin
    .from("outreach_recipients")
    .select("id, item_id, investigator_id, status, pursuit_stage, investigators(full_name), outreach_items!inner(id, team_id, stage, opportunity_id)")
    .eq("id", id.data)
    .eq("kind", "person")
    .is("removed_at", null)
    .eq("outreach_items.team_id", guard.actor.teamId)
    .maybeSingle();
  if (error) {
    if (MISSING_COLUMN.test(error.message)) return { ok: false, error: `The match columns are not on the database yet — apply ${MIGRATION} first.` };
    return { ok: false, error: error.message };
  }
  if (!data) return { ok: false, error: "That match is not on your team's board." };
  const r = data as unknown as { id: string; item_id: string; investigator_id: string | null; status: string; pursuit_stage: PursuitStage | null; investigators: { full_name: string } | Array<{ full_name: string }> | null; outreach_items: { id: string; stage: OutreachStage; opportunity_id: string } | Array<{ id: string; stage: OutreachStage; opportunity_id: string }> | null };
  const item = Array.isArray(r.outreach_items) ? r.outreach_items[0] : r.outreach_items;
  const inv = Array.isArray(r.investigators) ? r.investigators[0] : r.investigators;
  if (!item || !r.investigator_id) return { ok: false, error: "That match is not on your team's board." };
  return { ok: true, admin: guard.admin, actor: guard.actor, recipient: { id: r.id, item_id: r.item_id, investigator_id: r.investigator_id, status: r.status, pursuit_stage: r.pursuit_stage ?? null }, item, name: inv?.full_name ?? "the investigator" };
}

async function log(g: Guarded, kind: "note" | "stage_change" | "owner_changed" | "next_action" | "outcome" | "parked", text: string, payload: Record<string, unknown> = {}) {
  await g.admin.from("outreach_activity").insert({ item_id: g.item.id, team_id: g.actor.teamId, actor_id: g.actor.userId, actor_name: g.actor.fullName ?? "Teammate", kind, text, payload: { investigator_id: g.recipient.investigator_id, ...payload } });
  await g.admin.from("outreach_items").update({ last_activity_at: new Date().toISOString() }).eq("id", g.item.id);
}

/** The notice follows its most advanced match, and never moves back. */
async function pullItemForward(g: Guarded, stage: PursuitStage) {
  const rank: Record<OutreachStage, number> = { triage: 0, contacting: 1, developing: 2, submitted: 3, outcome: 4, parked: -1 };
  const target: OutreachStage | null = stage === "pursuing" ? "developing" : stage === "submitted" ? "submitted" : null;
  if (!target || g.item.stage === "parked" || rank[g.item.stage] >= rank[target]) return;
  const patch: Record<string, unknown> = { stage: target, last_activity_at: new Date().toISOString() };
  if (target === "submitted") patch.submitted_at = new Date().toISOString();
  await g.admin.from("outreach_items").update(patch).eq("id", g.item.id);
}

// ---------------------------------------------------------------------------
// Stage: Mark pursuing · Record submitted · Record outcome · Park · Close
// ---------------------------------------------------------------------------

const stageInput = z.object({
  recipientId: uuid,
  stage: z.enum(["pursuing", "submitted", "outcome", "parked", "closed"]),
  outcome: z.enum(["funded", "not_funded", "withdrawn", "not_submitted", "pending"]).nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
});

/** `previous` is what Undo restores: the match's stage before, and the notice's stage before the pull. */
export async function setMatchStageAction(input: z.input<typeof stageInput>): Promise<Result & { previous?: { stage: PursuitStage | null; itemStage: OutreachStage } }> {
  const shape = stageInput.safeParse(input);
  if (!shape.success) return { ok: false, error: shape.error.issues[0]?.message ?? "Invalid request." };
  const v = shape.data;
  if (v.stage === "outcome" && !v.outcome) return { ok: false, error: "Choose an outcome first." };
  const g = await guardRecipient(v.recipientId);
  if (!g.ok) return g;
  if (!isPursuitStage(v.stage)) return { ok: false, error: "Unknown stage." };
  const now = new Date().toISOString();
  const { error } = await g.admin
    .from("outreach_recipients")
    .update({ pursuit_stage: v.stage, pursuit_outcome: v.stage === "outcome" ? v.outcome : null, pursuit_note: v.note?.trim() || null, pursuit_changed_at: now })
    .eq("id", g.recipient.id);
  if (error) {
    if (MISSING_COLUMN.test(error.message)) return { ok: false, error: `The match columns are not on the database yet — apply ${MIGRATION} first.` };
    return { ok: false, error: error.message };
  }
  const words: Record<PursuitStage, string> = { pursuing: `marked ${g.name} pursuing`, submitted: `recorded ${g.name}'s application as submitted`, outcome: `recorded the outcome for ${g.name} · ${v.outcome ? OUTCOME_LABEL[v.outcome as Outcome] : ""}`, parked: `parked ${g.name}'s match${v.note ? ` · ${v.note.trim()}` : ""}`, closed: `closed ${g.name}'s match${v.note ? ` · ${v.note.trim()}` : " · not this cycle"}` };
  await log(g, v.stage === "outcome" ? "outcome" : v.stage === "parked" ? "parked" : "stage_change", words[v.stage], { pursuit_stage: v.stage, outcome: v.outcome ?? null });
  const previous = { stage: g.recipient.pursuit_stage, itemStage: g.item.stage };
  await pullItemForward(g, v.stage);
  revalidate(g.item.id);
  return { ok: true, previous };
}

const ITEM_STAGES: OutreachStage[] = ["triage", "contacting", "developing", "submitted", "outcome", "parked"];

/**
 * Undo for a stage change: the match back to the stage before it (null = no
 * pursuit), and the notice back too if the change had pulled it forward and
 * nothing else has moved it since.
 */
export async function restoreMatchStageAction(input: { recipientId: string; stage: PursuitStage | null; itemStage?: OutreachStage }): Promise<Result> {
  const g = await guardRecipient(input.recipientId);
  if (!g.ok) return g;
  if (input.stage != null && !isPursuitStage(input.stage)) return { ok: false, error: "Unknown stage." };
  if (input.itemStage != null && !ITEM_STAGES.includes(input.itemStage)) return { ok: false, error: "Unknown stage." };
  const { error } = await g.admin.from("outreach_recipients").update({ pursuit_stage: input.stage, pursuit_outcome: null, pursuit_note: null, pursuit_changed_at: new Date().toISOString() }).eq("id", g.recipient.id);
  if (error) return { ok: false, error: error.message };
  const pulledTo = g.recipient.pursuit_stage === "pursuing" ? "developing" : g.recipient.pursuit_stage === "submitted" ? "submitted" : null;
  const itemBack = input.itemStage && input.itemStage !== g.item.stage && g.item.stage === pulledTo;
  if (itemBack) await g.admin.from("outreach_items").update({ stage: input.itemStage, ...(g.item.stage === "submitted" ? { submitted_at: null } : {}) }).eq("id", g.item.id);
  await log(g, "stage_change", `restored ${g.name}'s match${input.stage ? ` to ${input.stage}` : ""}${itemBack ? ` and the notice to ${input.itemStage}` : ""}`);
  revalidate(g.item.id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Owner, next step, a logged call
// ---------------------------------------------------------------------------

export async function setMatchOwnerAction(input: { recipientId: string; ownerId: string | null }): Promise<Result> {
  if (input.ownerId != null && !uuid.safeParse(input.ownerId).success) return { ok: false, error: "Invalid owner." };
  const g = await guardRecipient(input.recipientId);
  if (!g.ok) return g;
  const { error } = await g.admin.from("outreach_recipients").update({ owner_id: input.ownerId }).eq("id", g.recipient.id);
  if (error) return { ok: false, error: error.message };
  let name = "Unassigned";
  if (input.ownerId) {
    const { data } = await g.admin.from("profiles").select("full_name, email").eq("id", input.ownerId).maybeSingle();
    name = (data as { full_name?: string | null; email?: string | null } | null)?.full_name ?? (data as { email?: string | null } | null)?.email ?? "a teammate";
  }
  await log(g, "owner_changed", `set the owner of ${g.name}'s match to ${name}`);
  revalidate(g.item.id);
  return { ok: true };
}

const nextStepInput = z.object({ recipientId: uuid, text: z.string().trim().max(120), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() });

/** "Hand to OSR" and any other next step the strategist names, with its day. */
export async function setMatchNextStepAction(input: z.input<typeof nextStepInput>): Promise<Result> {
  const shape = nextStepInput.safeParse(input);
  if (!shape.success) return { ok: false, error: shape.error.issues[0]?.message ?? "Invalid request." };
  const g = await guardRecipient(shape.data.recipientId);
  if (!g.ok) return g;
  const text = shape.data.text || null;
  const { error } = await g.admin.from("outreach_recipients").update({ next_step: text, next_step_date: text ? shape.data.date : null }).eq("id", g.recipient.id);
  if (error) return { ok: false, error: error.message };
  await log(g, "next_action", text ? `set the next step for ${g.name}: ${text}${shape.data.date ? ` by ${shape.data.date}` : ""}` : `cleared the next step for ${g.name}`);
  revalidate(g.item.id);
  return { ok: true };
}

const callInput = z.object({ recipientId: uuid, note: z.string().trim().min(1).max(1000) });

/** "Log a call": a note on the notice's activity, keyed to the person so the match's thread shows it. */
export async function logMatchCallAction(input: z.input<typeof callInput>): Promise<Result> {
  const shape = callInput.safeParse(input);
  if (!shape.success) return { ok: false, error: "Write a line about the call." };
  const g = await guardRecipient(shape.data.recipientId);
  if (!g.ok) return g;
  await log(g, "note", `call with ${g.name} — ${shape.data.note}`, { call: true });
  revalidate(g.item.id);
  return { ok: true };
}
