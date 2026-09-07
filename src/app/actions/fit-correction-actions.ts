"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fitAudienceFor } from "@/lib/fit/explain-view";
import { buildDismissalCorrection, type CorrectionPreview } from "@/lib/fit/feedback/correction";
import { WRONG_RESEARCH_TYPE } from "@/lib/fit/feedback/dismissal";
import { CORRECTIONS_MIGRATION, MISSING_COLUMN, priorCorrectionFor } from "@/lib/fit/feedback/load";
import { MISSING_TABLE, supabaseCorrectionStore, type CorrectionDismissal } from "@/lib/fit/judge/corrections";
import type { CorrectionAuthor, InvestigatorFitProfile } from "@/lib/fit/types";
import { requireUser } from "@/lib/team/require-team";

/**
 * The one-click profile-correction confirmation (plan § PR 3.2; spec §12):
 * a "wrong type of research" dismissal that names a category becomes one
 * `fit_corrections` row — `target investigator_profile`, the axis path,
 * `from_value` the stored weight, `to_value` per feedback/correction.ts,
 * `kind profile_weight`, `status proposed`, the dismissal as evidence — for
 * PR 3.3's queue to approve. Nothing is applied here (D6).
 *
 * `proposed_by`: `investigator` when the signed-in user is the profile's
 * own investigator (email is the only link between a sign-in and a directory
 * record — the onboarding rule, the same one D7 uses), else `strategist`.
 *
 * Auth: any signed-in user (`requireUser`); the insert goes through the
 * session client, so `fit_corrections`' RLS (authenticated) applies. The
 * dismissal row is read through the session client too: a strategist
 * confirming from Outreach is a member of the team that dismissed; a PI
 * confirming from their own page may not be, in which case the row is not
 * readable and the correction records the dismissal by sub-reason only.
 */
const inputSchema = z.object({
  investigatorId: z.string().uuid(),
  axisReason: z.string().min(1).max(200),
  suggestionId: z.string().uuid().nullish(),
  itemId: z.string().uuid().nullish(),
});

export type ProposeCorrectionInput = z.input<typeof inputSchema>;

export type ProposeCorrectionResult = { ok: true; id: string; preview: CorrectionPreview; proposedBy: CorrectionAuthor; /** "already proposed" — nothing new written. */ duplicate: boolean } | { ok: false; error: string };

type SuggestionRow = { id: string; item_id: string; investigator_id: string; dismissed_reason: string | null; axis_reason: string | null; dismissed_by: string | null; dismissed_at: string | null; outreach_items: { opportunity_id: string } | { opportunity_id: string }[] | null };

export async function proposeProfileCorrection(input: ProposeCorrectionInput): Promise<ProposeCorrectionResult> {
  const shape = inputSchema.safeParse(input);
  if (!shape.success) return { ok: false, error: shape.error.issues[0]?.message ?? "Invalid input" };
  const { investigatorId, axisReason, suggestionId, itemId } = shape.data;

  const user = await requireUser();
  if (!user.ok) return { ok: false, error: user.error };
  const db = user.session;

  const { data: inv, error: invErr } = await db.from("investigators").select("id, email, full_name").eq("id", investigatorId).is("archived_at", null).maybeSingle();
  if (invErr) return { ok: false, error: invErr.message };
  if (!inv) return { ok: false, error: "Investigator not found." };
  const proposedBy: Exclude<CorrectionAuthor, "judge"> = fitAudienceFor({ email: user.email }, { email: (inv as { email: string | null }).email }) === "investigator" ? "investigator" : "strategist";

  // The dismissal behind the proposal, when its row is readable; a missing 3.2 column or an unreadable row leaves the sub-reason as the record.
  let dismissal: CorrectionDismissal = { reason: WRONG_RESEARCH_TYPE, axis_reason: axisReason, suggestion_id: suggestionId ?? null, item_id: itemId ?? null, by: null, at: null };
  let opportunityId: string | null = null;
  if (suggestionId) {
    const { data: sug, error: sugErr } = await db.from("outreach_suggestions").select("id, item_id, investigator_id, dismissed_reason, axis_reason, dismissed_by, dismissed_at, outreach_items(opportunity_id)").eq("id", suggestionId).maybeSingle();
    if (sugErr && !MISSING_COLUMN.test(sugErr.message)) return { ok: false, error: sugErr.message };
    const row = (sug as SuggestionRow | null) ?? null;
    if (row) {
      if (row.investigator_id !== investigatorId) return { ok: false, error: "That dismissal is not about this investigator." };
      if (row.dismissed_reason !== WRONG_RESEARCH_TYPE) return { ok: false, error: "Only a “wrong type of research” dismissal proposes a profile correction." };
      const item = Array.isArray(row.outreach_items) ? row.outreach_items[0] : row.outreach_items;
      opportunityId = item?.opportunity_id ?? null;
      dismissal = { reason: WRONG_RESEARCH_TYPE, axis_reason: row.axis_reason ?? axisReason, suggestion_id: row.id, item_id: row.item_id, by: row.dismissed_by, at: row.dismissed_at };
    }
  }

  const store = supabaseCorrectionStore(db);
  let profile: InvestigatorFitProfile | null;
  try {
    profile = (await store.loadProfile("investigator_profile", investigatorId)) as InvestigatorFitProfile | null;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!profile) return { ok: false, error: "This investigator has no stored fit profile yet; the nightly fit-profiles run builds it." };

  const built = buildDismissalCorrection({ investigatorId, profile, axisReason: dismissal.axis_reason, proposedBy, dismissal, pair: opportunityId ? { investigator_id: investigatorId, opportunity_id: opportunityId } : null });
  if (!built.ok) return { ok: false, error: built.reason };

  try {
    const existing = await store.listCorrections({ target: "investigator_profile", target_id: investigatorId });
    const prior = priorCorrectionFor(built.row, existing);
    if (prior) {
      if (prior.status === "rejected") return { ok: false, error: "A strategist rejected this correction for this dismissal; it is not proposed again." };
      return { ok: true, id: prior.id, preview: built.preview, proposedBy, duplicate: true };
    }
    const id = await store.insertCorrection(built.row);
    revalidatePath(`/investigators/${investigatorId}`);
    revalidatePath(`/investigators/${investigatorId}/fit`);
    return { ok: true, id, preview: built.preview, proposedBy, duplicate: false };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (MISSING_TABLE.test(message)) return { ok: false, error: `fit_corrections is not on the database yet — apply ${CORRECTIONS_MIGRATION} first.` };
    return { ok: false, error: message };
  }
}
