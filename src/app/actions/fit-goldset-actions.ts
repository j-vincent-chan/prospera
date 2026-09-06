"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { assignSlots, goldLabelRow, latestByLabeler, sameLabel, SLOT_LABEL } from "@/lib/fit/goldset/labels";
import { loadGoldLabels, loadLabelerIdentities } from "@/lib/fit/goldset/load";
import { GOLDSET_MANIFEST, LABELER_CONFIG, manifestPairByKey } from "@/lib/fit/goldset/manifest";
import { parseSaveGoldLabel, type SaveGoldLabelInput } from "@/lib/fit/goldset/save";
import { pairKey } from "@/lib/fit/goldset/stratify";
import { FIT_LABELS_MIGRATION, MISSING_TABLE_RE } from "@/lib/fit/inspect/load";
import { createClient } from "@/lib/supabase/server";

/**
 * Save one gold label from `/admin/fit-labels` (plan § PR 2.4). Writes one
 * `fit_labels` row with source `gold`, the caller as `labeler` and the
 * manifest's engine version, in the caller's slot: labeler A, B or the
 * adjudicator — configured in docs/fit-engine/goldset/labelers.json, else
 * by order of first label (goldset/labels.ts). A fourth person has no slot
 * and is refused. The table is append-only, so a re-save inserts a newer row
 * (readers take the latest per pair and labeler); an identical re-save
 * writes nothing.
 *
 * Auth: `requireAdmin` on the session client (profiles.role = 'admin'); the
 * insert goes through the same client, so RLS applies. Validation: the Zod
 * shape here, then `parseSaveGoldLabel` (UUIDs naming a manifest pair; tier
 * in the taxonomy's four; reason from the feedback list, required for
 * Exploratory / Poor; axis sub-reason `<axis>:<category>` valid against the
 * taxonomy and required by "wrong type of research").
 */
const inputSchema = z.object({
  investigatorId: z.string().max(64).nullish(),
  opportunityId: z.string().max(64).nullish(),
  tier: z.string().max(32).nullish(),
  reason: z.string().max(64).nullish(),
  axisReason: z.string().max(200).nullish(),
});

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
  const identities = await loadLabelerIdentities(supabase, { ids: [admin.userId, ...labels.rows.map((r) => r.labeler).filter((x): x is string => Boolean(x))], emails: [LABELER_CONFIG.a, LABELER_CONFIG.b, LABELER_CONFIG.adjudicator].filter((x): x is string => Boolean(x)) });
  const assignment = assignSlots(LABELER_CONFIG, identities, labels.rows, admin.userId);
  if (!assignment.current) {
    return { ok: false, error: assignment.mode === "configured" ? "You are not one of the configured labelers (docs/fit-engine/goldset/labelers.json)." : "All three labeler slots are taken; a fourth person cannot label this set." };
  }

  const { value } = parsed;
  const stored = latestByLabeler(labels.rows).get(pairKey(value.investigator_id, value.opportunity_id))?.get(admin.userId) ?? null;
  if (sameLabel(stored, value)) return { ok: true, id: stored?.id ?? null, slot: SLOT_LABEL[assignment.current], unchanged: true };

  const { data, error } = await supabase
    .from("fit_labels")
    .insert(goldLabelRow({ investigator_id: value.investigator_id, opportunity_id: value.opportunity_id, tier: value.tier, reason: value.reason, axis_reason: value.axis_reason, labeler: admin.userId, engine_version: GOLDSET_MANIFEST.engine_version }))
    .select("id")
    .single();
  if (error) {
    if (MISSING_TABLE_RE.test(error.message)) return { ok: false, error: `fit_labels is not on the database yet — apply ${FIT_LABELS_MIGRATION} first.` };
    return { ok: false, error: error.message };
  }
  revalidatePath("/admin/fit-labels");
  return { ok: true, id: String((data as { id: string }).id), slot: SLOT_LABEL[assignment.current], unchanged: false };
}
