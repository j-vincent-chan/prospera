/**
 * The pure half of the labeling page's server action (plan § PR 2.4):
 * input validation for one gold label — both ids UUIDs naming a pair of the
 * manifest, the label through `parseGoldLabel` — and the row it becomes.
 * The action (src/app/actions/fit-goldset-actions.ts) checks the admin role,
 * assigns the slot and inserts.
 */
import { z } from "zod";
import type { ManifestPair } from "@/lib/fit/goldset/manifest";
import { parseGoldLabel, type GoldLabelValue } from "@/lib/fit/goldset/reasons";
import { isSyntheticId, pairKey } from "@/lib/fit/goldset/stratify";

/** Why a synthetic pair cannot be saved: `fit_labels.investigator_id` is a foreign key to `investigators`. */
export const SYNTHETIC_CANNOT_SAVE = "This pair is synthetic (built from the adversarial fixture): fit_labels.investigator_id is a foreign key to investigators, so its label is kept in the CSV, not saved here.";

export type SaveGoldLabelInput = {
  investigatorId?: string | null;
  opportunityId?: string | null;
  tier?: string | null;
  reason?: string | null;
  axisReason?: string | null;
};

export type ParsedSave = GoldLabelValue & { investigator_id: string; opportunity_id: string; pair: ManifestPair };

export type ParseSaveResult = { ok: true; value: ParsedSave } | { ok: false; error: string };

const uuid = z.string().uuid();

/** Pure. Validates the action input against the manifest's pairs. */
export function parseSaveGoldLabel(input: SaveGoldLabelInput, pairsByKey: ReadonlyMap<string, ManifestPair>): ParseSaveResult {
  const investigatorId = (input.investigatorId ?? "").trim();
  const opportunityId = (input.opportunityId ?? "").trim();
  if (isSyntheticId(investigatorId)) return { ok: false, error: SYNTHETIC_CANNOT_SAVE };
  if (!uuid.safeParse(investigatorId).success) return { ok: false, error: "Invalid investigator id." };
  if (!uuid.safeParse(opportunityId).success) return { ok: false, error: "Invalid opportunity id." };
  const pair = pairsByKey.get(pairKey(investigatorId, opportunityId));
  if (!pair) return { ok: false, error: "This pair is not in the gold set." };
  const label = parseGoldLabel({ tier: input.tier, reason: input.reason, axis_reason: input.axisReason });
  if (!label.ok) return label;
  return { ok: true, value: { ...label.value, investigator_id: investigatorId, opportunity_id: opportunityId, pair } };
}
