"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  consultNotification,
  consultPromise,
  isPairFlagReason,
  pairFlagConfirmation,
  pairFlagHandoff,
  pairFlagReasons,
  routeConsult,
  type PairFlagReason,
} from "@/lib/fit/row-actions";
import { TAXONOMY_VERSION } from "@/lib/fit/taxonomy";
import { notifyImmediate } from "@/lib/notifications/digest";
import { requireUser } from "@/lib/team/require-team";
import type { FitAudience } from "@/lib/fit/explain-view";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The two row mechanisms §3h left open. Both are written by ordinary users —
 * an investigator about their own row, a strategist about a row they are
 * reading — so neither goes through `requireAdmin` the way the profile-flag
 * inspector does.
 *
 * The audience is decided the same way the surfaces decide it (D7): the
 * sign-in email as the auth server reports it, against the directory record's.
 * `profiles.email` is editable and is never used for this.
 */

const MISSING_TABLE = /could not find the table|schema cache|does not exist/i;
const UNIQUE_VIOLATION = /duplicate key|unique constraint/i;

type Fail = { ok: false; error: string };

const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase() || null;

type InvestigatorRow = { id: string; full_name: string | null; email: string | null; research_community_id: string | null };

/** The caller's relationship to this investigator, by the D7 rule. */
async function audienceFor(db: SupabaseClient, investigatorId: string, authEmail: string | null): Promise<{ ok: true; audience: FitAudience; investigator: InvestigatorRow } | Fail> {
  const { data, error } = await db.from("investigators").select("id, full_name, email, research_community_id").eq("id", investigatorId).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "That investigator is not in the directory." };
  const inv = data as InvestigatorRow;
  const a = norm(authEmail);
  const b = norm(inv.email);
  return { ok: true, audience: a && b && a === b ? "investigator" : "strategist", investigator: inv };
}

// ---------------------------------------------------------------------------
// 1. "Ask my strategist" (§3h, D-n)
// ---------------------------------------------------------------------------

const consultInput = z.object({
  investigatorId: z.string().uuid(),
  opportunityId: z.string().uuid(),
  note: z.string().trim().max(2000).nullable().optional(),
  /** The label the PI was reading, stored so the strategist opens the same row. */
  label: z.enum(["strong", "moderate"]),
});

export type ConsultResult = { ok: true; id: string; promise: string; duplicate: boolean } | Fail;

/**
 * The PI's per-row action. Creates one open request per pair, routed to the
 * strategist who owns their community, and notifies the office through the
 * ordinary notification preferences.
 *
 * Only the investigator themselves may ask: a strategist reading someone
 * else's page has the whole of Outreach and does not need to send themselves
 * a request.
 */
export async function requestFitConsult(input: z.input<typeof consultInput>): Promise<ConsultResult> {
  const shape = consultInput.safeParse(input);
  if (!shape.success) return { ok: false, error: shape.error.issues[0]?.message ?? "Invalid request." };
  const v = shape.data;

  const guard = await requireUser();
  if (!guard.ok) return guard;
  const { admin, userId, authEmail, fullName } = guard;

  const who = await audienceFor(admin, v.investigatorId, authEmail);
  if (!who.ok) return who;
  if (who.audience !== "investigator") return { ok: false, error: "Only the investigator can ask about their own row." };

  const [{ data: community }, { data: notice }, { data: me }] = await Promise.all([
    who.investigator.research_community_id
      ? admin.from("pipeline_communities").select("id, strategist_id, label").eq("id", who.investigator.research_community_id).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from("funding_opportunities").select("id, title").eq("id", v.opportunityId).maybeSingle(),
    admin.from("profiles").select("current_team_id").eq("id", userId).maybeSingle(),
  ]);
  if (!notice) return { ok: false, error: "That notice is no longer in the catalog." };

  const c = community as { id: string; strategist_id: string | null; label: string } | null;
  const routing = routeConsult({ communityId: c?.id ?? null, strategistId: c?.strategist_id ?? null });

  // The office's team: the owning strategist's, else the asker's own.
  const { data: strat } = routing.strategistId
    ? await admin.from("profiles").select("id, full_name, current_team_id").eq("id", routing.strategistId).maybeSingle()
    : { data: null };
  const strategist = strat as { id: string; full_name: string | null; current_team_id: string | null } | null;
  const teamId = strategist?.current_team_id ?? (me as { current_team_id?: string | null } | null)?.current_team_id ?? null;

  const row = {
    investigator_id: v.investigatorId,
    opportunity_id: v.opportunityId,
    requested_by: userId,
    note: v.note?.trim() || null,
    community_id: routing.communityId,
    strategist_id: routing.strategistId,
    team_id: teamId,
    verdict_label: v.label,
  };
  const { data, error } = await admin.from("fit_consult_requests").insert(row).select("id").single();
  if (error) {
    if (MISSING_TABLE.test(error.message)) return { ok: false, error: "fit_consult_requests is not on the database yet — apply 20260924100000_fit_row_actions.sql first." };
    if (UNIQUE_VIOLATION.test(error.message)) {
      const { data: open } = await admin.from("fit_consult_requests").select("id").eq("investigator_id", v.investigatorId).eq("opportunity_id", v.opportunityId).eq("status", "open").maybeSingle();
      return { ok: true, id: String((open as { id?: string } | null)?.id ?? ""), promise: "You have already asked about this one. Your strategist still has it.", duplicate: true };
    }
    return { ok: false, error: error.message };
  }
  const id = String((data as { id: string }).id);

  if (teamId) {
    const n = consultNotification({
      investigatorName: who.investigator.full_name?.trim() || fullName || "An investigator",
      noticeTitle: String((notice as { title: string }).title),
      note: row.note,
      label: v.label,
    });
    const owner = strategist?.full_name?.trim();
    await notifyImmediate(admin, {
      teamId,
      eventType: "fit_consult_request",
      key: `fit-consult:${id}`,
      subject: n.subject,
      text: owner ? `${n.text}\n\nThis community is ${owner}'s.` : n.text,
      href: `/investigators/${v.investigatorId}`,
      excludeUserId: userId,
    }).catch(() => 0);
  }

  revalidatePath(`/investigators/${v.investigatorId}`);
  revalidatePath("/home");
  return { ok: true, id, promise: consultPromise(routing, strategist?.full_name?.trim() ?? null), duplicate: false };
}

export async function withdrawFitConsult(input: { id: string }): Promise<{ ok: true } | Fail> {
  if (!z.string().uuid().safeParse(input.id).success) return { ok: false, error: "Invalid request." };
  const guard = await requireUser();
  if (!guard.ok) return guard;
  const { error } = await guard.admin
    .from("fit_consult_requests")
    .update({ status: "withdrawn", updated_at: new Date().toISOString() })
    .eq("id", input.id)
    .eq("requested_by", guard.userId)
    .eq("status", "open");
  if (error) return { ok: false, error: error.message };
  revalidatePath("/home");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 2. "This match is wrong" (a pair flag)
// ---------------------------------------------------------------------------

const pairFlagInput = z.object({
  investigatorId: z.string().uuid(),
  opportunityId: z.string().uuid(),
  reason: z.string().min(1),
  note: z.string().trim().max(1000).nullable().optional(),
  /** The label being contradicted, kept so METRICS can weigh a wrong Strong differently from a wrong Moderate. */
  label: z.string().nullable().optional(),
});

export type PairFlagResult = { ok: true; id: string; message: string; handoff: "identity" | "profile_correction" | null; duplicate: boolean } | Fail;

/**
 * "This match is wrong", said at the row by either audience. Distinct from
 * the two controls that existed: a profile flag is about an axis of the
 * person, a dismissal moves someone out of one notice's outreach queue.
 * A pair flag says the pairing itself is wrong and names both ids.
 */
export async function flagFitPair(input: z.input<typeof pairFlagInput>): Promise<PairFlagResult> {
  const shape = pairFlagInput.safeParse(input);
  if (!shape.success) return { ok: false, error: shape.error.issues[0]?.message ?? "Invalid input." };
  const v = shape.data;
  if (!isPairFlagReason(v.reason)) return { ok: false, error: "Pick a reason." };
  const reason = v.reason as PairFlagReason;

  const guard = await requireUser();
  if (!guard.ok) return guard;
  const { admin, userId, authEmail } = guard;

  const who = await audienceFor(admin, v.investigatorId, authEmail);
  if (!who.ok) return who;
  // Each audience may only give a reason its own vocabulary offers: a PI is
  // never recorded as having judged how the notice was read.
  if (!pairFlagReasons(who.audience).some((r) => r.id === reason)) return { ok: false, error: "That reason is not one you can give here." };

  const row = {
    investigator_id: v.investigatorId,
    opportunity_id: v.opportunityId,
    tier: v.label ?? null,
    reason,
    axis_reason: v.note?.trim() || null,
    labeler: userId,
    engine_version: TAXONOMY_VERSION,
    source: "pair_flag",
  };
  const { data, error } = await admin.from("fit_labels").insert(row).select("id").single();
  if (error) {
    if (MISSING_TABLE.test(error.message)) return { ok: false, error: "fit_labels is not on the database yet — apply the fit-labels migration first." };
    if (UNIQUE_VIOLATION.test(error.message)) {
      // Saying it again is the same opinion, possibly with a new reason.
      const { data: updated, error: upErr } = await admin
        .from("fit_labels")
        .update({ reason, axis_reason: row.axis_reason, tier: row.tier })
        .eq("investigator_id", v.investigatorId)
        .eq("opportunity_id", v.opportunityId)
        .eq("labeler", userId)
        .eq("source", "pair_flag")
        .select("id")
        .single();
      if (upErr) return { ok: false, error: upErr.message };
      return { ok: true, id: String((updated as { id: string }).id), message: pairFlagConfirmation(reason, who.audience), handoff: pairFlagHandoff(reason), duplicate: true };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath(`/investigators/${v.investigatorId}`);
  revalidatePath(`/opportunities/${v.opportunityId}`);
  return { ok: true, id: String((data as { id: string }).id), message: pairFlagConfirmation(reason, who.audience), handoff: pairFlagHandoff(reason), duplicate: false };
}

export async function undoFitPairFlag(input: { id: string }): Promise<{ ok: true } | Fail> {
  if (!z.string().uuid().safeParse(input.id).success) return { ok: false, error: "Invalid flag." };
  const guard = await requireUser();
  if (!guard.ok) return guard;
  const { error } = await guard.admin.from("fit_labels").delete().eq("id", input.id).eq("labeler", guard.userId).eq("source", "pair_flag");
  if (error) return { ok: false, error: error.message };
  revalidatePath("/investigators");
  return { ok: true };
}
