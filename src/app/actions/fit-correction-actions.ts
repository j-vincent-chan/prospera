"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fitAudienceFor } from "@/lib/fit/explain-view";
import { buildDismissalCorrection, type CorrectionPreview } from "@/lib/fit/feedback/correction";
import { WRONG_RESEARCH_TYPE } from "@/lib/fit/feedback/dismissal";
import { CORRECTIONS_MIGRATION, MISSING_COLUMN, openProposal } from "@/lib/fit/feedback/load";
import { MISSING_TABLE, rejectionBlocking, supabaseCorrectionStore, type CorrectionDismissal } from "@/lib/fit/judge/corrections";
import type { CorrectionAuthor, InvestigatorFitProfile } from "@/lib/fit/types";
import { requireUser } from "@/lib/team/require-team";

/**
 * The one-click profile-correction confirmation (plan § PR 3.2; spec §12):
 * a "wrong type of research" dismissal that names a category becomes
 * `fit_corrections` rows — `target investigator_profile`, one row per stored
 * path (both paradigm views when the career view carries the category),
 * `from_value` the stored weight, `to_value` per feedback/correction.ts,
 * `kind profile_weight`, `status proposed`, the dismissal as evidence — for
 * PR 3.3's queue to approve. Nothing is applied here (D6).
 *
 * Before any row is written the store is asked whether this argument was
 * rejected before (`rejectionBlocking`, PR 3.3's indexed `evidence_hash`
 * lookup): a rejected correction never reappears, whether the judge or a
 * person raises it again.
 *
 * `proposed_by`: `investigator` when the signed-in user is the profile's
 * own investigator — the sign-in email as the auth server reports it
 * (`requireUser().authEmail`, from `auth.getUser()`), never the editable
 * `profiles.email`, against the directory record's (the onboarding rule, the
 * same one D7 uses) — else `strategist`.
 *
 * Auth: any signed-in user (`requireUser`); every read and the insert go
 * through the session client, so RLS applies. The dismissal is the
 * evidence, so its row must be readable: a strategist confirming from
 * Outreach is a member of the team that dismissed; a PI confirming from
 * their own page must be too — an unreadable row (another team's, or one
 * since restored) refuses the confirmation rather than proposing on a
 * sub-reason the server cannot see. Before the 3.2 migration the row is
 * read without `axis_reason` and the sub-reason given is the record.
 */
const inputSchema = z.object({
  investigatorId: z.string().uuid(),
  axisReason: z.string().min(1).max(200),
  suggestionId: z.string().uuid(),
});

export type ProposeCorrectionInput = z.input<typeof inputSchema>;

export type ProposeCorrectionResult = { ok: true; /** The rows written (or found) — one per path; `id` is the first. */ ids: string[]; id: string; preview: CorrectionPreview; proposedBy: CorrectionAuthor; /** "already proposed" — nothing new written. */ duplicate: boolean } | { ok: false; error: string };

type SuggestionRow = { id: string; item_id: string; investigator_id: string; dismissed_reason: string | null; axis_reason?: string | null; dismissed_by: string | null; dismissed_at: string | null; outreach_items: { opportunity_id: string } | { opportunity_id: string }[] | null };

const SUGGESTION_COLUMNS = "id, item_id, investigator_id, dismissed_reason, dismissed_by, dismissed_at, outreach_items(opportunity_id)";
/** The same read once the 3.2 migration has added `axis_reason`. */
const SUGGESTION_COLUMNS_WITH_AXIS = "id, item_id, investigator_id, dismissed_reason, axis_reason, dismissed_by, dismissed_at, outreach_items(opportunity_id)";

export async function proposeProfileCorrection(input: ProposeCorrectionInput): Promise<ProposeCorrectionResult> {
  const shape = inputSchema.safeParse(input);
  if (!shape.success) return { ok: false, error: shape.error.issues[0]?.message ?? "Invalid input" };
  const { investigatorId, axisReason, suggestionId } = shape.data;

  const user = await requireUser();
  if (!user.ok) return { ok: false, error: user.error };
  const db = user.session;

  const { data: inv, error: invErr } = await db.from("investigators").select("id, email, full_name").eq("id", investigatorId).is("archived_at", null).maybeSingle();
  if (invErr) return { ok: false, error: invErr.message };
  if (!inv) return { ok: false, error: "Investigator not found." };
  const proposedBy: Exclude<CorrectionAuthor, "judge"> = fitAudienceFor({ email: user.authEmail }, { email: (inv as { email: string | null }).email }) === "investigator" ? "investigator" : "strategist";

  // The dismissal behind the proposal: the row must be readable (RLS: the viewer's teams). Before the 3.2 migration `axis_reason` is not a column; re-read without it so the ownership and reason checks still run.
  const first = await db.from("outreach_suggestions").select(SUGGESTION_COLUMNS_WITH_AXIS).eq("id", suggestionId).maybeSingle();
  const read = first.error && MISSING_COLUMN.test(first.error.message) ? await db.from("outreach_suggestions").select(SUGGESTION_COLUMNS).eq("id", suggestionId).maybeSingle() : first;
  if (read.error) return { ok: false, error: read.error.message };
  const row = (read.data as SuggestionRow | null) ?? null;
  if (!row) return { ok: false, error: "That dismissal is not readable: it belongs to a team you are not a member of, or it was restored. A correction needs the dismissal it rests on." };
  if (row.investigator_id !== investigatorId) return { ok: false, error: "That dismissal is not about this investigator." };
  if (row.dismissed_reason !== WRONG_RESEARCH_TYPE) return { ok: false, error: "Only a “wrong type of research” dismissal proposes a profile correction." };
  const item = Array.isArray(row.outreach_items) ? row.outreach_items[0] : row.outreach_items;
  const opportunityId = item?.opportunity_id ?? null;
  const dismissal: CorrectionDismissal = { reason: WRONG_RESEARCH_TYPE, axis_reason: row.axis_reason ?? axisReason, suggestion_id: row.id, item_id: row.item_id, by: row.dismissed_by, at: row.dismissed_at };

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
    const open = openProposal(built, existing);
    if (open.rejected) return { ok: false, error: "A strategist rejected this correction for this dismissal; it is not proposed again." };
    if (!open.rows.length || !open.preview) return { ok: true, ids: open.prior ? [open.prior.id] : [], id: open.prior?.id ?? "", preview: built.preview, proposedBy, duplicate: true };
    // PR 3.3's never-reappear rule, asked of the store rather than of the rows in hand: `listRejected` is the indexed (target, target_id, path, evidence_hash) lookup, so a rejection past the 500 rows `listCorrections` reads still blocks — the same check `judgePair` makes before it proposes.
    for (const r of open.rows) {
      const blocked = await rejectionBlocking(store, r);
      if (blocked) return { ok: false, error: "A strategist rejected this correction on this evidence; it is not proposed again." };
    }
    const ids: string[] = [];
    for (const r of open.rows) ids.push(await store.insertCorrection(r));
    revalidatePath(`/investigators/${investigatorId}`);
    revalidatePath(`/investigators/${investigatorId}/fit`);
    return { ok: true, ids, id: ids[0]!, preview: open.preview, proposedBy, duplicate: false };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (MISSING_TABLE.test(message)) return { ok: false, error: `fit_corrections is not on the database yet — apply ${CORRECTIONS_MIGRATION} first.` };
    return { ok: false, error: message };
  }
}
