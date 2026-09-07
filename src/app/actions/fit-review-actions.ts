"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { applyCorrection, rejectCorrection, reverseCorrection, supabaseCorrectionStore, MISSING_TABLE, type CorrectionRow, type CorrectionTargetTable } from "@/lib/fit/judge/corrections";
import { CORRECTIONS_MIGRATION } from "@/lib/fit/feedback/load";
import { countInvestigatorsForNotice, REVIEW_STATE_MIGRATION } from "@/lib/fit/review/load";
import { refusesOwnProfile, requireStrategist } from "@/lib/fit/review/guard";
import { REVIEW_QUEUE_PATH } from "@/lib/fit/review/queue";
import { FIT_RESCORE_SYNC_MAX_INVESTIGATORS, rankForInvestigator, rankForNotice, supabaseFitStore } from "@/lib/fit/service";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The strategist review queue's writes (plan § PR 3.3). Three actions, all
 * gated by `requireStrategist` (a signed-in member of a team — see
 * `lib/fit/review/guard.ts` on why that is "strategist" here) and all writing
 * through the service-role client the guard returns, because approving a
 * notice correction touches every investigator's rows.
 *
 * **Approve** (`decideCorrection` with `decision: "approve"`) runs PR 3.1's
 * `applyCorrection` on every row of the proposal — it re-checks `from_value`
 * against the stored profile, patches the profile JSON and flips the row to
 * `applied` with `decided_by` / `decided_at` — and then does the three things
 * the 3.1 validation handed to this PR:
 *
 *   1 **Re-queue for the judge.** A patched profile hashes differently, so
 *     every stored adjudication of that subject stops matching and every
 *     judged pair falls back to the engine's tier. The pairs must be judged
 *     again, *including the ones the judge had lowered* — so the subject's
 *     investigators get `investigator_fit_profiles.fit_judged_at = NULL` and
 *     lead the nightly judge's order (F3). The action never calls the model
 *     itself: a page write is not where an LLM call belongs (CLAUDE.md), and
 *     a top pair costs ≈ 6 calls.
 *   2 **Drop the stale stage-8 blob.** `fit_results.adjudication` is cleared
 *     for the subject's rows, so no surface shows a "judged" marker derived
 *     from a profile that has since changed. The queue shows those pairs as
 *     "re-judging" until the nightly runs.
 *   3 **Re-score.** An investigator correction is one `rankForInvestigator`
 *     and runs here. A notice correction re-scores every investigator against
 *     that notice: it runs here while the count is at or under
 *     `FIT_RESCORE_SYNC_MAX_INVESTIGATORS`, and otherwise
 *     `fit_corrections.rescored_at` is left NULL for the nightly fit-results
 *     prelude (`rescoreAppliedCorrections`), which sweeps exactly those
 *     notices before the roster order. Either way the acceptance holds:
 *     "approving a notice correction re-scores every investigator against
 *     that notice within the nightly job".
 *
 * **Reject** flips a `proposed` row to `rejected`; on an `applied` row it goes
 * through `reverseCorrection`, which puts `from_value` back in the stored
 * profile first and refuses (writing nothing) when the stored value is no
 * longer the one the correction wrote. A rejection is what makes the
 * correction's evidence hash unusable for ever: the judge and the one-click
 * confirmation both look it up before proposing, so a rejected argument never
 * reappears.
 *
 * **Mark reviewed** stamps `fit_adjudications.reviewed_by / reviewed_at` for
 * one pair — the AI-flagged leads and ungrounded dissents have nothing to
 * approve, only to be read and cleared.
 */

const idsSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(8) });
const pairSchema = z.object({ investigatorId: z.string().uuid(), opportunityId: z.string().uuid(), reviewed: z.boolean().optional() });

export type DecideCorrectionInput = z.input<typeof idsSchema> & { decision: "approve" | "reject" };

export type DecideCorrectionResult =
  | {
      ok: true;
      decision: "approve" | "reject";
      /** The rows decided. */
      ids: string[];
      target: CorrectionTargetTable;
      targetId: string;
      /** Investigators whose `fit_judged_at` was cleared — they lead the nightly judge. */
      reQueued: number;
      /** The re-score ran here; false = `rescored_at` left NULL for the nightly prelude. */
      rescored: boolean;
      /** Pairs the re-score wrote (0 when it was deferred). */
      pairs: number;
      /** How many investigators the subject's re-score touches. */
      investigators: number | null;
      message: string;
    }
  | { ok: false; error: string };

export type MarkReviewedResult = { ok: true; reviewed: boolean; rows: number } | { ok: false; error: string };

const UUID_CHUNK = 50;

/** The proposal's rows, read fresh; every row must name the same target and be decidable. */
async function loadRows(store: ReturnType<typeof supabaseCorrectionStore>, ids: readonly string[]): Promise<{ ok: true; rows: CorrectionRow[] } | { ok: false; error: string }> {
  const rows: CorrectionRow[] = [];
  for (const id of ids) {
    const row = await store.loadCorrection(id);
    if (!row) return { ok: false, error: `No correction ${id}.` };
    rows.push(row);
  }
  const first = rows[0]!;
  if (rows.some((r) => r.target !== first.target || r.target_id !== first.target_id)) return { ok: false, error: "Those corrections are on different profiles; decide them separately." };
  return { ok: true, rows };
}

/** D6: an investigator may not decide a correction to their own fit profile. One read, and only for an investigator target. */
async function ownProfileRefusal(db: SupabaseClient, actor: { authEmail: string | null }, target: CorrectionTargetTable, targetId: string): Promise<string | null> {
  if (target !== "investigator_profile") return null;
  const { data } = await db.from("investigators").select("email").eq("id", targetId).maybeSingle();
  return refusesOwnProfile(actor, (data as { email: string | null } | null) ?? null);
}

/** The subject's investigators go back in the judge's queue, and their `fit_results` rows lose the now-stale stage-8 blob. */
async function reQueueForJudge(db: SupabaseClient, target: CorrectionTargetTable, targetId: string): Promise<number> {
  let investigatorIds: string[];
  if (target === "investigator_profile") investigatorIds = [targetId];
  else {
    const { data } = await db.from("fit_results").select("investigator_id").eq("opportunity_id", targetId).not("adjudication", "is", null).limit(2000);
    investigatorIds = Array.from(new Set(((data ?? []) as Array<{ investigator_id: string }>).map((r) => r.investigator_id)));
  }
  for (let i = 0; i < investigatorIds.length; i += UUID_CHUNK) {
    await db.from("investigator_fit_profiles").update({ fit_judged_at: null }).in("investigator_id", investigatorIds.slice(i, i + UUID_CHUNK));
  }
  // Every judged row of the subject reverts to the engine's tier: the stored adjudication was keyed on the profile this correction just changed, so it no longer applies — including the pairs the judge had LOWERED.
  const clear = db.from("fit_results").update({ adjudication: null }).not("adjudication", "is", null);
  await (target === "investigator_profile" ? clear.eq("investigator_id", targetId) : clear.eq("opportunity_id", targetId));
  return investigatorIds.length;
}

/** Approve or reject one proposal (a 3.2 paradigm confirmation is two rows and one decision). */
export async function decideCorrection(input: DecideCorrectionInput): Promise<DecideCorrectionResult> {
  const shape = idsSchema.safeParse(input);
  if (!shape.success) return { ok: false, error: shape.error.issues[0]?.message ?? "Invalid input" };
  const decision = input.decision === "approve" || input.decision === "reject" ? input.decision : null;
  if (!decision) return { ok: false, error: "A decision is approve or reject." };
  const ids = Array.from(new Set(shape.data.ids));

  const guard = await requireStrategist();
  if (!guard.ok) return { ok: false, error: guard.error };
  const db = guard.admin;
  const store = supabaseCorrectionStore(db);

  try {
    if (await store.tableMissing()) return { ok: false, error: `fit_corrections is not on the database yet — apply ${CORRECTIONS_MIGRATION} first.` };
    const loaded = await loadRows(store, ids);
    if (!loaded.ok) return loaded;
    const rows = loaded.rows;
    const target = rows[0]!.target;
    const targetId = rows[0]!.target_id;

    const refusal = await ownProfileRefusal(db, guard.actor, target, targetId);
    if (refusal) return { ok: false, error: refusal };

    const now = new Date();
    const decidedBy = guard.actor.userId;
    const failures: string[] = [];
    let changed = 0;
    for (const row of rows) {
      if (decision === "approve") {
        // Re-scored once for the subject below, not per row.
        const out = await applyCorrection(store, row.id, { decidedBy, now: () => now });
        if (out.ok) changed += 1;
        else failures.push(out.error);
      } else if (row.status === "applied") {
        const out = await reverseCorrection(store, row.id, { decidedBy, now: () => now });
        if (out.ok) changed += 1;
        else failures.push(out.error);
      } else {
        const out = await rejectCorrection(store, row.id, { decidedBy, now: () => now });
        if (out.ok) changed += 1;
        else failures.push(out.error ?? "could not reject");
      }
    }
    if (!changed) return { ok: false, error: failures[0] ?? "Nothing to decide: those corrections were already decided." };

    // A rejection that changed nothing in the profile (a `proposed` row) needs no re-score.
    const profileChanged = decision === "approve" || rows.some((r) => r.status === "applied");
    let reQueued = 0;
    let rescored = false;
    let pairs = 0;
    let investigators: number | null = null;
    if (profileChanged) {
      reQueued = await reQueueForJudge(db, target, targetId);
      investigators = target === "opportunity_profile" ? await countInvestigatorsForNotice(db, targetId) : 1;
      const affordable = target === "investigator_profile" || (investigators !== null && investigators <= FIT_RESCORE_SYNC_MAX_INVESTIGATORS);
      if (affordable) {
        try {
          const fit = supabaseFitStore(db);
          const ranked = target === "investigator_profile" ? await rankForInvestigator(fit, targetId, { write: true, now: () => now }) : await rankForNotice(fit, targetId, { write: true, now: () => now });
          pairs = ranked?.results.length ?? 0;
          rescored = true;
        } catch {
          // The re-score is best-effort here; leaving `rescored_at` NULL hands it to the nightly prelude, which owns the acceptance criterion.
          rescored = false;
        }
      }
      if (rescored) for (const row of rows) await store.updateCorrection(row.id, { rescored_at: now.toISOString() });
    }

    revalidatePath(REVIEW_QUEUE_PATH);
    revalidatePath(target === "investigator_profile" ? `/investigators/${targetId}/fit` : `/opportunities/${targetId}/fit`);
    revalidatePath(target === "investigator_profile" ? `/investigators/${targetId}` : `/opportunities/${targetId}`);

    const what = decision === "approve" ? "Applied" : "Rejected";
    const scoreNote = !profileChanged
      ? ""
      : rescored
        ? ` ${pairs} pair${pairs === 1 ? "" : "s"} re-scored${reQueued ? `; ${reQueued} investigator${reQueued === 1 ? "" : "s"} queued for re-judging` : ""}.`
        : ` ${investigators ?? "every"} investigator${investigators === 1 ? "" : "s"} will be re-scored by tonight's fit-results run${reQueued ? `; ${reQueued} queued for re-judging` : ""}.`;
    return {
      ok: true,
      decision,
      ids: rows.map((r) => r.id),
      target,
      targetId,
      reQueued,
      rescored,
      pairs,
      investigators,
      message: `${what} ${changed} correction${changed === 1 ? "" : "s"}.${scoreNote}${failures.length ? ` ${failures.length} row could not be decided: ${failures[0]}` : ""}`,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (MISSING_TABLE.test(message)) return { ok: false, error: `fit_corrections is not on the database yet — apply ${CORRECTIONS_MIGRATION} first.` };
    return { ok: false, error: message };
  }
}

/**
 * "Mark reviewed" on an AI-flagged lead or an ungrounded dissent: stamps
 * every stored adjudication of the pair (a pair judged again at new profile
 * versions writes a new, unreviewed row, so a lead raised by fresh evidence
 * comes back). `reviewed: false` puts it back in the queue.
 */
export async function markPairReviewed(input: z.input<typeof pairSchema>): Promise<MarkReviewedResult> {
  const shape = pairSchema.safeParse(input);
  if (!shape.success) return { ok: false, error: shape.error.issues[0]?.message ?? "Invalid input" };
  const { investigatorId, opportunityId } = shape.data;
  const reviewed = shape.data.reviewed !== false;

  const guard = await requireStrategist();
  if (!guard.ok) return { ok: false, error: guard.error };

  const patch = reviewed ? { reviewed_by: guard.actor.userId, reviewed_at: new Date().toISOString() } : { reviewed_by: null, reviewed_at: null };
  const { error, count } = await guard.admin.from("fit_adjudications").update(patch, { count: "exact" }).eq("investigator_id", investigatorId).eq("opportunity_id", opportunityId);
  if (error) {
    if (MISSING_TABLE.test(error.message)) return { ok: false, error: `The review state is not on the database yet — apply ${REVIEW_STATE_MIGRATION} first.` };
    return { ok: false, error: error.message };
  }
  revalidatePath(REVIEW_QUEUE_PATH);
  return { ok: true, reviewed, rows: count ?? 0 };
}
