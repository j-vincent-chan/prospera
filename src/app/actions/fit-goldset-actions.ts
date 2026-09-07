"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { assignSlots, FIT_LABELS_SYNTHETIC_MIGRATION, goldLabelRow, isMissingSyntheticColumn, latestByLabeler, sameLabel, SLOT_LABEL } from "@/lib/fit/goldset/labels";
import { loadGoldLabels, loadLabelerIdentities } from "@/lib/fit/goldset/load";
import { GOLDSET_MANIFEST, LABELER_CONFIG, LABELER_CONFIG_VALUES, LABELERS_PATH, manifestPairByKey } from "@/lib/fit/goldset/manifest";
import { cannotLabelReason } from "@/lib/fit/goldset/page-view";
import { parseSaveGoldLabel, type SaveGoldLabelInput } from "@/lib/fit/goldset/save";
import { pairKey } from "@/lib/fit/goldset/stratify";
import { FIT_LABELS_MIGRATION, MISSING_TABLE_RE } from "@/lib/fit/inspect/load";
import { createClient } from "@/lib/supabase/server";

/**
 * Save one gold label from `/admin/fit-labels` (plan § PR 2.4). Writes one
 * `fit_labels` row with source `gold`, the caller as `labeler` and the
 * manifest's engine version, in the caller's slot: labeler A or B —
 * configured in docs/fit-engine/goldset/labelers.json, else by order of
 * first label — or the adjudicator, configured only (goldset/labels.ts). A
 * person without a slot is refused and told why. A synthetic pair's row
 * carries the fixture case in `synthetic_source` with `investigator_id`
 * NULL, and is refused with the migration's path while that column is not
 * on the database. The table is append-only,
 * so a re-save inserts a newer row (readers take the latest per pair and
 * labeler); an identical re-save writes nothing.
 *
 * Auth: `requireAdmin` on the session client (profiles.role = 'admin'); the
 * insert goes through the same client, so RLS applies. Validation: the Zod
 * shape here, then `parseSaveGoldLabel` (exactly one subject — the
 * investigator UUID or the synthetic source — and the notice UUID naming a
 * manifest pair; tier
 * in the taxonomy's four; reason from `taxonomy.json › feedback.reasons`,
 * required for the tiers `reason_required_tiers` names; axis sub-reason
 * `<axis>` or `<axis>:<category>` valid against the taxonomy and required by
 * "wrong type of research").
 */
const inputSchema = z.object({
  investigatorId: z.string().max(64).nullish(),
  syntheticSource: z.string().max(64).nullish(),
  opportunityId: z.string().max(64).nullish(),
  tier: z.string().max(32).nullish(),
  reason: z.string().max(64).nullish(),
  axisReason: z.string().max(200).nullish(),
});

const SYNTHETIC_MIGRATION_ERROR = `fit_labels.synthetic_source is not on the database yet — apply ${FIT_LABELS_SYNTHETIC_MIGRATION} to label synthetic pairs here.`;

export type SaveGoldLabelResult = { ok: true; id: string | null; slot: string; unchanged: boolean } | { ok: false; error: string };

export async function saveGoldLabel(input: SaveGoldLabelInput): Promise<SaveGoldLabelResult> {
  const shape = inputSchema.safeParse(input);
  if (!shape.success) return { ok: false, error: shape.error.issues[0]?.message ?? "Invalid input" };
  const parsed = parseSaveGoldLabel(shape.data, manifestPairByKey());
  if (!parsed.ok) return parsed;

  const supabase = createClient();
  const admin = await requireAdmin(supabase);
  if (!admin.ok) return { ok: false, error: admin.error };

  const labels = await loadGoldLabels(supabase);
  if (!labels.available) return { ok: false, error: `fit_labels is not on the database yet — apply ${FIT_LABELS_MIGRATION} first.` };
  if (labels.error) return { ok: false, error: labels.error };
  if (parsed.value.synthetic_source && !labels.synthetic_available) return { ok: false, error: SYNTHETIC_MIGRATION_ERROR };
  const identities = await loadLabelerIdentities(supabase, [admin.userId, ...labels.rows.map((r) => r.labeler), ...LABELER_CONFIG_VALUES]);
  const assignment = assignSlots(LABELER_CONFIG, identities, labels.rows, admin.userId);
  if (!assignment.current) return { ok: false, error: cannotLabelReason(assignment, LABELER_CONFIG, LABELERS_PATH) ?? "You have no labeler slot." };

  const { value } = parsed;
  const stored = latestByLabeler(labels.rows).get(pairKey(value.subject, value.opportunity_id))?.get(admin.userId) ?? null;
  if (sameLabel(stored, value)) return { ok: true, id: stored?.id ?? null, slot: SLOT_LABEL[assignment.current], unchanged: true };

  const { data, error } = await supabase
    .from("fit_labels")
    .insert(goldLabelRow({ investigator_id: value.investigator_id, synthetic_source: value.synthetic_source, opportunity_id: value.opportunity_id, tier: value.tier, reason: value.reason, axis_reason: value.axis_reason, labeler: admin.userId, engine_version: GOLDSET_MANIFEST.engine_version }))
    .select("id")
    .single();
  if (error) {
    if (isMissingSyntheticColumn(error.message)) return { ok: false, error: SYNTHETIC_MIGRATION_ERROR };
    if (MISSING_TABLE_RE.test(error.message)) return { ok: false, error: `fit_labels is not on the database yet — apply ${FIT_LABELS_MIGRATION} first.` };
    return { ok: false, error: error.message };
  }
  revalidatePath("/admin/fit-labels");
  return { ok: true, id: String((data as { id: string }).id), slot: SLOT_LABEL[assignment.current], unchanged: false };
}
