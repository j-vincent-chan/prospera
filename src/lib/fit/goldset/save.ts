/**
 * The pure half of the labeling page's server action (plan § PR 2.4):
 * input validation for one gold label — exactly one subject (a roster
 * investigator UUID, or the fixture case id of a synthetic investigator),
 * the notice UUID, the two naming a pair of the manifest, the label through
 * `parseGoldLabel` — and the subject columns the row gets. The action
 * (src/app/actions/fit-goldset-actions.ts) checks the admin role, assigns
 * the slot and inserts.
 */
import { z } from "zod";
import type { LabelSubject } from "@/lib/fit/goldset/labels";
import type { ManifestPair } from "@/lib/fit/goldset/manifest";
import { parseGoldLabel, type GoldLabelValue } from "@/lib/fit/goldset/reasons";
import { isSyntheticId, pairKey, SYNTHETIC_PREFIX } from "@/lib/fit/goldset/stratify";

export type SaveGoldLabelInput = {
  /** The roster investigator (UUID) — or null with `syntheticSource` set. */
  investigatorId?: string | null;
  /** The fixture case id of a synthetic investigator (`ManifestPair.synthetic_source`) — or null with `investigatorId` set. */
  syntheticSource?: string | null;
  opportunityId?: string | null;
  tier?: string | null;
  reason?: string | null;
  axisReason?: string | null;
};

/** The label, the manifest's investigator id (`subject`: the UUID, or `synthetic:<case>`) and the two subject columns it becomes. */
export type ParsedSave = GoldLabelValue & LabelSubject & { subject: string; opportunity_id: string; pair: ManifestPair };

export type ParseSaveResult = { ok: true; value: ParsedSave } | { ok: false; error: string };

const uuid = z.string().uuid();
/** A fixture case id: `2_cvd_epi_vs_mito_mechanism`, `7a_hsr_vs_beta_cell_mechanism`. */
const SYNTHETIC_SOURCE_RE = /^[a-z0-9][a-z0-9_.-]{0,63}$/i;

export const ONE_SUBJECT = "Name one subject: an investigator id or a synthetic source, not both.";
export const NO_SUBJECT = "Missing subject: an investigator id or a synthetic source.";

/** Pure. Validates the action input against the manifest's pairs. */
export function parseSaveGoldLabel(input: SaveGoldLabelInput, pairsByKey: ReadonlyMap<string, ManifestPair>): ParseSaveResult {
  const investigatorId = (input.investigatorId ?? "").trim();
  const syntheticSource = (input.syntheticSource ?? "").trim();
  const opportunityId = (input.opportunityId ?? "").trim();
  if (investigatorId && syntheticSource) return { ok: false, error: ONE_SUBJECT };
  if (!investigatorId && !syntheticSource) return { ok: false, error: NO_SUBJECT };
  if (investigatorId && !uuid.safeParse(investigatorId).success) {
    return { ok: false, error: isSyntheticId(investigatorId) ? "A synthetic pair is named by its synthetic source, not by an investigator id." : "Invalid investigator id." };
  }
  if (syntheticSource && !SYNTHETIC_SOURCE_RE.test(syntheticSource)) return { ok: false, error: "Invalid synthetic source." };
  if (!uuid.safeParse(opportunityId).success) return { ok: false, error: "Invalid opportunity id." };
  const subject = investigatorId || `${SYNTHETIC_PREFIX}${syntheticSource}`;
  const pair = pairsByKey.get(pairKey(subject, opportunityId));
  if (!pair) return { ok: false, error: "This pair is not in the gold set." };
  const label = parseGoldLabel({ tier: input.tier, reason: input.reason, axis_reason: input.axisReason });
  if (!label.ok) return label;
  return { ok: true, value: { ...label.value, subject, investigator_id: investigatorId || null, synthetic_source: syntheticSource || null, opportunity_id: opportunityId, pair } };
}
