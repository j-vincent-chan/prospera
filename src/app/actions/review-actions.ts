"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addRecipientsAction, createOutreachItemAction } from "@/app/actions/outreach-actions";
import { TAXONOMY_VERSION } from "@/lib/fit/taxonomy";
import { cycleFactsFromRow, dueDisplay, isoToday, type CycleColumns } from "@/lib/funding-opportunities/receipt-cycles";
import { REVIEW_BADGES_TAG } from "@/lib/review/badges";
import { DECISION_COLUMNS, fromDecisionRow, type DecisionRow, type MatchDecision } from "@/lib/review/decisions";
import { watchResurfaceOn } from "@/lib/review/queue";
import { BIOSKETCH_REQUESTED, isDecisionReason, isStrengthTagId, NOTICE_DISMISSED, reasonTrainsEngine, scopeOfReason, type DecisionScope, type DecisionStatus } from "@/lib/review/reasons";
import { requireTeamRole } from "@/lib/team/require-team";

/**
 * The Review page's writes (README §"Interactions & behaviour" "Decision
 * model"): one `fit_match_decisions` row per match, and the side effects each
 * status has elsewhere in the app —
 *
 *   - **confirmed** → the match is queued for outreach: the notice's Outreach
 *     item is created if it has none, and the person is added as a
 *     `suggested` recipient in `selected` status. That is what makes the
 *     match appear in Outreach and in the Message recipient list; nothing is
 *     sent. The outreach write goes first, so a failure there leaves no
 *     decision that claims a queue place it does not have.
 *   - **rejected** with a notice-scoped reason → every other undecided match
 *     the caller names is also rejected, `auto = true`, and those ids come
 *     back so the bulk banner's Undo can clear exactly them. A reason that is
 *     a fit judgment (`reasonTrainsEngine`) is also written to `fit_labels`
 *     as a `dismissal`, so the next calibration sees it; the person-scoped
 *     "do not contact" is written to the investigator profile, the same
 *     columns the Outreach dismissal already uses.
 *   - **watch** → `resurface_on` is 30 days before the deadline, computed here
 *     from the notice's own receipt cycles rather than trusted from the page.
 *
 * Undo deletes the decision and reverses what it did: a queued recipient that
 * has not been contacted is removed, a do-not-contact set by this user is
 * cleared, the dismissal label this user wrote is deleted.
 *
 * Every write is team-scoped through `requireTeamRole("member")`; the match
 * is checked against `fit_results` so a decision can only be recorded about
 * a pair the engine actually produced.
 */

const MISSING_TABLE = /could not find the table|schema cache|does not exist/i;
const MIGRATION = "supabase/migrations/20260929100000_fit_match_decisions.sql";

type Fail = { ok: false; error: string };
const uuid = z.string().uuid();

function revalidate() {
  revalidatePath("/review");
  revalidatePath("/outreach");
  revalidateTag(REVIEW_BADGES_TAG);
}

/** The pairs among `investigatorIds` the engine produced for this notice — a decision about anything else is refused. */
async function knownPairs(db: SupabaseClient, opportunityId: string, investigatorIds: readonly string[]): Promise<Set<string>> {
  if (!investigatorIds.length) return new Set();
  const { data } = await db.from("fit_results").select("investigator_id").eq("opportunity_id", opportunityId).in("investigator_id", investigatorIds);
  return new Set(((data ?? []) as Array<{ investigator_id: string }>).map((r) => r.investigator_id));
}

async function noticeDueDate(db: SupabaseClient, opportunityId: string, today: string): Promise<string | null> {
  const { data } = await db.from("funding_opportunities").select("close_date, next_due, receipt_cycles, cycles_source, standard_dates_apply, expiration_date, forecasted, status, agency_code, opportunity_number, raw_payload_json").eq("id", opportunityId).maybeSingle();
  if (!data) return null;
  const due = dueDisplay(cycleFactsFromRow(data as CycleColumns), today);
  return due.date ?? null;
}

const shiftIso = (iso: string, days: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

async function readDecision(db: SupabaseClient, teamId: string, opportunityId: string, investigatorId: string): Promise<{ ok: true; decision: MatchDecision | null } | Fail> {
  const { data, error } = await db.from("fit_match_decisions").select(DECISION_COLUMNS).eq("team_id", teamId).eq("opportunity_id", opportunityId).eq("investigator_id", investigatorId).maybeSingle();
  if (error) {
    if (MISSING_TABLE.test(error.message)) return { ok: false, error: `fit_match_decisions is not on the database yet — apply ${MIGRATION} first.` };
    return { ok: false, error: error.message };
  }
  return { ok: true, decision: data ? fromDecisionRow(data as DecisionRow) : null };
}

// ---------------------------------------------------------------------------
// decide(match, status, reason?, scope?)
// ---------------------------------------------------------------------------

const decideInput = z.object({
  opportunityId: uuid,
  investigatorId: uuid,
  status: z.enum(["confirmed", "rejected", "watch"]),
  reason: z.string().trim().max(80).nullable().optional(),
  /** The verdict label the row carried, kept on the record for calibration. */
  label: z.string().trim().max(40).nullable().optional(),
  /** Notice-scoped reasons: the other undecided matches on the notice, to clear with `auto = true`. */
  alsoClear: z.array(uuid).max(200).optional(),
});

export type DecideResult = { ok: true; decision: MatchDecision; /** The matches a notice-scoped reason also cleared. */ cleared: string[]; /** The Outreach item a confirmation queued into. */ itemId: string | null } | Fail;

export async function decideMatchAction(input: z.input<typeof decideInput>): Promise<DecideResult> {
  const shape = decideInput.safeParse(input);
  if (!shape.success) return { ok: false, error: shape.error.issues[0]?.message ?? "Invalid decision." };
  const v = shape.data;
  const reason = v.reason?.trim() || null;
  if (reason && !isDecisionReason(reason)) return { ok: false, error: "That reason is not one the page offers." };
  if (v.status === "confirmed" && reason && !isStrengthTagId(reason)) return { ok: false, error: "A confirmation carries a strength tag or nothing." };
  if (v.status === "watch" && reason && reason !== BIOSKETCH_REQUESTED) return { ok: false, error: "A watch carries no reason but a biosketch request." };

  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const { admin, actor } = guard;
  const today = isoToday();

  const known = await knownPairs(admin, v.opportunityId, [v.investigatorId, ...(v.alsoClear ?? [])]);
  if (!known.has(v.investigatorId)) return { ok: false, error: "That match is not one the engine produced for this notice." };
  const scope: DecisionScope = v.status === "rejected" ? scopeOfReason(reason) : "pair";
  const also = scope === "notice" ? (v.alsoClear ?? []).filter((id) => id !== v.investigatorId && known.has(id)) : [];

  // A confirmation is a queue place in Outreach. Take it before recording the
  // decision, so the record never claims a place the write failed to make.
  let itemId: string | null = null;
  if (v.status === "confirmed") {
    const item = await createOutreachItemAction(v.opportunityId);
    if (!item.ok) return item;
    const added = await addRecipientsAction({ itemId: item.itemId, investigatorIds: [v.investigatorId], origin: "suggested" });
    if (!added.ok) return added;
    itemId = item.itemId;
  }

  const now = new Date().toISOString();
  const resurfaceOn = v.status === "watch" ? watchResurfaceOn(await noticeDueDate(admin, v.opportunityId, today), today, shiftIso) : null;
  const row = {
    team_id: actor.teamId,
    opportunity_id: v.opportunityId,
    investigator_id: v.investigatorId,
    status: v.status satisfies DecisionStatus,
    reason,
    scope,
    auto: false,
    resurface_on: resurfaceOn,
    verdict_label: v.label?.trim() || null,
    decided_by: actor.userId,
    decided_at: now,
    updated_at: now,
  };
  const { data, error } = await admin.from("fit_match_decisions").upsert(row, { onConflict: "team_id,opportunity_id,investigator_id" }).select(DECISION_COLUMNS).single();
  if (error) {
    if (MISSING_TABLE.test(error.message)) return { ok: false, error: `fit_match_decisions is not on the database yet — apply ${MIGRATION} first.` };
    return { ok: false, error: error.message };
  }
  const decision = fromDecisionRow(data as DecisionRow);
  if (!decision) return { ok: false, error: "The decision was written in a shape this build cannot read." };

  let cleared: string[] = [];
  if (v.status === "rejected") {
    if (also.length) {
      // Only rows with no decision yet: `ignoreDuplicates` is ON CONFLICT DO
      // NOTHING, so a teammate's earlier decision on one of them stands, and
      // what comes back is exactly the set this reason cleared.
      // No verdict label on an auto row: the label is the reader's reading of
      // the row they tapped, and a cleared row was never read.
      const { data: bulk, error: bulkErr } = await admin
        .from("fit_match_decisions")
        .upsert(
          also.map((investigator_id) => ({ ...row, investigator_id, auto: true, verdict_label: null })),
          { onConflict: "team_id,opportunity_id,investigator_id", ignoreDuplicates: true },
        )
        .select("investigator_id");
      if (bulkErr) return { ok: false, error: bulkErr.message };
      cleared = ((bulk ?? []) as Array<{ investigator_id: string }>).map((r) => r.investigator_id);
    }
    if (scope === "person") {
      await admin.from("investigators").update({ do_not_contact_at: now, do_not_contact_by: actor.userId, do_not_contact_reason: "Set from a Review dismissal" }).eq("id", v.investigatorId).is("do_not_contact_at", null);
    }
    if (reasonTrainsEngine(reason)) {
      // The tapped pair only: the auto-cleared rows are inferences, not labels.
      await admin.from("fit_labels").insert({ investigator_id: v.investigatorId, opportunity_id: v.opportunityId, tier: "poor", reason, axis_reason: null, labeler: actor.userId, engine_version: TAXONOMY_VERSION, source: "dismissal" });
    }
  }

  revalidate();
  return { ok: true, decision, cleared, itemId };
}

// ---------------------------------------------------------------------------
// "Dismiss all N matches"
// ---------------------------------------------------------------------------

const dismissNoticeInput = z.object({ opportunityId: uuid, investigatorIds: z.array(uuid).min(1).max(200) });

export type DismissNoticeResult = { ok: true; cleared: string[] } | Fail;

/** Rejects every undecided match named, with reason "the notice is not worth pursuing" and `auto = true`, so the banner's Undo clears exactly them. */
export async function dismissNoticeAction(input: z.input<typeof dismissNoticeInput>): Promise<DismissNoticeResult> {
  const shape = dismissNoticeInput.safeParse(input);
  if (!shape.success) return { ok: false, error: shape.error.issues[0]?.message ?? "Invalid request." };
  const v = shape.data;
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const { admin, actor } = guard;
  const known = await knownPairs(admin, v.opportunityId, v.investigatorIds);
  const ids = v.investigatorIds.filter((id) => known.has(id));
  if (!ids.length) return { ok: false, error: "None of those matches belongs to this notice." };
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("fit_match_decisions")
    .upsert(
      ids.map((investigator_id) => ({ team_id: actor.teamId, opportunity_id: v.opportunityId, investigator_id, status: "rejected", reason: NOTICE_DISMISSED, scope: "notice", auto: true, resurface_on: null, verdict_label: null, decided_by: actor.userId, decided_at: now, updated_at: now })),
      { onConflict: "team_id,opportunity_id,investigator_id", ignoreDuplicates: true },
    )
    .select("investigator_id");
  if (error) {
    if (MISSING_TABLE.test(error.message)) return { ok: false, error: `fit_match_decisions is not on the database yet — apply ${MIGRATION} first.` };
    return { ok: false, error: error.message };
  }
  revalidate();
  return { ok: true, cleared: ((data ?? []) as Array<{ investigator_id: string }>).map((r) => r.investigator_id) };
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

const pairInput = z.object({ opportunityId: uuid, investigatorId: uuid });

/** Deletes the row's decision and reverses its side effects. */
export async function undoDecisionAction(input: z.input<typeof pairInput>): Promise<{ ok: true } | Fail> {
  const shape = pairInput.safeParse(input);
  if (!shape.success) return { ok: false, error: "Invalid request." };
  const v = shape.data;
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const { admin, actor } = guard;

  const current = await readDecision(admin, actor.teamId, v.opportunityId, v.investigatorId);
  if (!current.ok) return current;
  const d = current.decision;
  if (!d) return { ok: true };

  const { error } = await admin.from("fit_match_decisions").delete().eq("team_id", actor.teamId).eq("opportunity_id", v.opportunityId).eq("investigator_id", v.investigatorId);
  if (error) return { ok: false, error: error.message };

  if (d.status === "confirmed") {
    // Leave the queue — but only a place nobody has used: a recipient already
    // contacted is a fact about the person, not a queued draft.
    const { data: item } = await admin.from("outreach_items").select("id").eq("team_id", actor.teamId).eq("opportunity_id", v.opportunityId).maybeSingle();
    const itemId = (item as { id?: string } | null)?.id;
    if (itemId) {
      await admin.from("outreach_recipients").update({ removed_at: new Date().toISOString(), removed_by: actor.userId }).eq("item_id", itemId).eq("kind", "person").eq("investigator_id", v.investigatorId).eq("status", "selected").is("removed_at", null);
    }
  }
  if (d.status === "rejected") {
    if (d.scope === "person") {
      await admin.from("investigators").update({ do_not_contact_at: null, do_not_contact_by: null, do_not_contact_reason: null }).eq("id", v.investigatorId).eq("do_not_contact_by", actor.userId);
    }
    if (reasonTrainsEngine(d.reason)) {
      await admin.from("fit_labels").delete().eq("investigator_id", v.investigatorId).eq("opportunity_id", v.opportunityId).eq("labeler", actor.userId).eq("source", "dismissal").eq("reason", d.reason!);
    }
  }
  revalidate();
  return { ok: true };
}

const undoClearedInput = z.object({ opportunityId: uuid, investigatorIds: z.array(uuid).min(1).max(200) });

/** The bulk banner's Undo: deletes the `auto` rows a notice-scoped reason or "Dismiss all" wrote, and nothing decided by hand. */
export async function undoClearedAction(input: z.input<typeof undoClearedInput>): Promise<{ ok: true; restored: number } | Fail> {
  const shape = undoClearedInput.safeParse(input);
  if (!shape.success) return { ok: false, error: "Invalid request." };
  const v = shape.data;
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const { data, error } = await guard.admin.from("fit_match_decisions").delete().eq("team_id", guard.actor.teamId).eq("opportunity_id", v.opportunityId).in("investigator_id", v.investigatorIds).eq("auto", true).select("investigator_id");
  if (error) return { ok: false, error: error.message };
  revalidate();
  return { ok: true, restored: (data ?? []).length };
}

// ---------------------------------------------------------------------------
// The confirmation's optional strength tag
// ---------------------------------------------------------------------------

const tagInput = z.object({ opportunityId: uuid, investigatorId: uuid, tag: z.enum(["science_right", "timing_right", "needs_money"]).nullable() });

/** "optional — tags the confirmation for calibration": the confirmation's reason, set or cleared. */
export async function tagConfirmationAction(input: z.input<typeof tagInput>): Promise<{ ok: true } | Fail> {
  const shape = tagInput.safeParse(input);
  if (!shape.success) return { ok: false, error: "Invalid request." };
  const v = shape.data;
  const guard = await requireTeamRole("member");
  if (!guard.ok) return guard;
  const { error } = await guard.admin.from("fit_match_decisions").update({ reason: v.tag, updated_at: new Date().toISOString() }).eq("team_id", guard.actor.teamId).eq("opportunity_id", v.opportunityId).eq("investigator_id", v.investigatorId).eq("status", "confirmed");
  if (error) return { ok: false, error: error.message };
  revalidatePath("/review");
  return { ok: true };
}
