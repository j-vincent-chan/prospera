"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { FLAG_REASON_MAX, flagRow, parseFlagInput, type FlagInput } from "@/lib/fit/inspect/flags";
import { FIT_LABELS_MIGRATION, MISSING_TABLE_RE } from "@/lib/fit/inspect/load";
import { TAXONOMY_VERSION } from "@/lib/fit/taxonomy";
import { createClient } from "@/lib/supabase/server";

/**
 * "Flag as wrong" on the profile inspector (plan § PR 1.6): an admin says an
 * axis, a category or the whole stored profile is wrong. Writes one
 * `fit_labels` row with source `profile_flag`, the caller as `labeler` and
 * the taxonomy version as `engine_version`, then revalidates the page.
 *
 * Auth: `requireAdmin` on the session client (profiles.role = 'admin').
 * Validation: the shape here (strings, bounded), then `parseFlagInput` — one
 * subject UUID, axis in the six, category in the taxonomy when given, reason
 * ≤ FLAG_REASON_MAX. The insert uses the same session client, so RLS applies.
 */
const inputSchema = z.object({
  investigatorId: z.string().max(64).nullish(),
  opportunityId: z.string().max(64).nullish(),
  axisReason: z.string().max(200).nullish(),
  reason: z.string().max(FLAG_REASON_MAX * 4).nullish(),
});

export type FlagFitProfileResult = { ok: true; id: string } | { ok: false; error: string };

export async function flagFitProfile(input: FlagInput): Promise<FlagFitProfileResult> {
  const shape = inputSchema.safeParse(input);
  if (!shape.success) return { ok: false, error: shape.error.issues[0]?.message ?? "Invalid input" };
  const parsed = parseFlagInput(shape.data);
  if (!parsed.ok) return parsed;

  const supabase = createClient();
  const admin = await requireAdmin(supabase);
  if (!admin.ok) return { ok: false, error: admin.error };

  const { data, error } = await supabase
    .from("fit_labels")
    .insert(flagRow(parsed.value, admin.userId, TAXONOMY_VERSION))
    .select("id")
    .single();
  if (error) {
    if (MISSING_TABLE_RE.test(error.message)) return { ok: false, error: `fit_labels is not on the database yet — apply ${FIT_LABELS_MIGRATION} first.` };
    return { ok: false, error: error.message };
  }

  if (parsed.value.investigator_id) revalidatePath(`/investigators/${parsed.value.investigator_id}/fit`);
  if (parsed.value.opportunity_id) revalidatePath(`/opportunities/${parsed.value.opportunity_id}/fit`);
  revalidatePath("/admin/fit");
  return { ok: true, id: String((data as { id: string }).id) };
}
