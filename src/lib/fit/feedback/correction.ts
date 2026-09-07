/**
 * The one-click profile correction (plan § PR 3.2; spec §12 "Dismiss — wrong
 * type of research … propose a profile correction ('lower `clinical_trials`
 * from 0.35 to 0.15?') that the investigator or strategist confirms in one
 * click"). Pure: the row a confirmation writes to `fit_corrections`, built
 * from the stored investigator profile and the dismissal's sub-reason.
 *
 * Reuses PR 3.1's correction machinery (judge/corrections.ts): the path
 * grammar (`paradigm:clinical_trials` → `paradigm.recent.clinical_trials`,
 * the flat form the reconciler also uses; `materials:animal_mouse` →
 * `materials.animal_mouse`; unit / design / objective likewise; topic never —
 * a topical argument reopens no gate), `readCorrectionPath` for the stored
 * weight, `fromMatches` / `coerceTo` for the values, and the row shape
 * `alreadyDecided` and PR 3.3's apply / reject read. What differs from the
 * judge's corrections is the evidence bar: the reconciler must cite ≥ 2
 * verified items carrying the category's family (F11, D40); a person's
 * dismissal *is* the evidence here (§12 lists it as the strongest signal),
 * recorded in `evidence.dismissal` with `via: "dismissal"`, and PR 3.3's
 * queue is the check before it persists (D6). `kind` is `profile_weight`
 * (an axis weight; provisional route, D6), `status` `proposed`,
 * `proposed_by` whoever confirmed.
 *
 * The proposed value follows the spec's example (0.35 → 0.15): the weight
 * is lowered to `PROPOSED_WEIGHT_STEP` below the axis's Poor gate
 * (`paradigm.gates.poor_below` 0.25, `unit.gates.poor_below` 0.20; the
 * paradigm gate for the axes that have none) — below the gate the category
 * no longer supports a notice that requires it — or, when it already sits
 * below the gate, one step lower; never below 0 (0 removes the key). A
 * category the profile does not carry cannot be lowered: no proposal.
 */
import { applyCorrectionToProfile, coerceTo, fromMatches, parseCorrectionPath, readCorrectionPath, type CorrectionDismissal, type NewCorrectionRow, type ParsedPath } from "@/lib/fit/judge/corrections";
import { parseAxisSubReason } from "@/lib/fit/goldset/reasons";
import { axisLabel, categoryDisplay, type InspectAxis } from "@/lib/fit/inspect/labels";
import { paradigmGates, unitGates } from "@/lib/fit/taxonomy";
import type { CorrectionAuthor, InvestigatorFitProfile } from "@/lib/fit/types";

/** How far below the gate a confirmed "wrong type of research" lowers the weight (spec §12's 0.35 → 0.15 with the 0.25 paradigm gate). Proposed home: `taxonomy.json › feedback.correction_step` (no taxonomy edit in this PR). */
export const PROPOSED_WEIGHT_STEP = 0.1;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The Poor gate of an axis's weight (the value below which the category stops supporting a requirement); the paradigm gate where the taxonomy has none. */
export function axisPoorGate(axis: InspectAxis | string): number {
  if (axis === "unit") return unitGates().poor_below;
  return paradigmGates().poor_below;
}

/** Pure. The weight a "wrong type of research" confirmation proposes: one step below the axis gate, or one step below the current value when it is already under the gate; never negative. */
export function proposedWeight(from: number, axis: InspectAxis | string): number {
  const gate = axisPoorGate(axis);
  return Math.max(0, round2(Math.min(from, gate) - PROPOSED_WEIGHT_STEP));
}

/** Pure. The investigator-profile path behind a sub-reason: `<axis>:<category>` → the 3.1 grammar's path; null for an axis-only sub-reason, the topic axis, or an unknown id. */
export function correctionPathFor(axisReason: string | null | undefined): { parsed: ParsedPath; axis: InspectAxis; category: string } | null {
  const sub = parseAxisSubReason(axisReason);
  if (!sub.ok || !sub.value.category) return null;
  const parsed = parseCorrectionPath("investigator", `${sub.value.axis}.${sub.value.category}`);
  if (!parsed || parsed.value !== "weight") return null;
  return { parsed, axis: sub.value.axis, category: sub.value.category };
}

export type CorrectionPreview = {
  /** The stored path (`paradigm.recent.clinical_trials`). */
  path: string;
  axis: InspectAxis;
  category: string;
  /** "Paradigm · Clinical trials". */
  label: string;
  from: number;
  to: number;
  /** "Lower Clinical trials (paradigm, recent view) from 0.35 to 0.15 on the fit profile?" */
  sentence: string;
};

export type DismissalCorrectionInput = {
  investigatorId: string;
  profile: InvestigatorFitProfile;
  axisReason: string;
  proposedBy: Exclude<CorrectionAuthor, "judge">;
  dismissal: CorrectionDismissal;
  /** The pair the dismissal came from (the suggestion's notice); null when unknown. */
  pair: { investigator_id: string; opportunity_id: string } | null;
};

export type DismissalCorrection = { ok: true; row: NewCorrectionRow; preview: CorrectionPreview; /** The profile as it would read after the correction (for a preview; nothing is written here). */ patched: InvestigatorFitProfile } | { ok: false; reason: string };

/** Pure. The `fit_corrections` row a confirmation writes for one dismissal, or why none can be proposed. */
export function buildDismissalCorrection(input: DismissalCorrectionInput): DismissalCorrection {
  const target = correctionPathFor(input.axisReason);
  if (!target) {
    const sub = parseAxisSubReason(input.axisReason);
    if (!sub.ok) return { ok: false, reason: sub.error };
    if (sub.value.axis === "topic") return { ok: false, reason: "Topic never gates, so a topic dismissal proposes no correction; it is recorded as a negative label." };
    return { ok: false, reason: `"${axisLabel(sub.value.axis)}" names an axis but no category; pick the category (which kind of ${axisLabel(sub.value.axis).toLowerCase()}) to propose a correction.` };
  }
  const { parsed, axis, category } = target;
  const stored = readCorrectionPath(input.profile, parsed);
  const from = typeof stored === "number" && Number.isFinite(stored) ? stored : 0;
  const label = `${axisLabel(axis)} · ${categoryDisplay(axis, category).label}`;
  if (from <= 0) return { ok: false, reason: `The fit profile does not carry ${label} (weight 0); there is nothing to lower — the dismissal is recorded as a label.` };
  const to = proposedWeight(from, axis);
  const coerced = coerceTo(parsed, to, stored);
  if ("error" in coerced) return { ok: false, reason: coerced.error };
  if (!fromMatches(parsed, from, stored)) return { ok: false, reason: `The stored value at ${parsed.path} moved; reload and try again.` };
  if (Math.abs((coerced.value as number) - from) < 1e-9) return { ok: false, reason: `${label} is already ${from.toFixed(2)}.` };
  const pathKey = parsed.keys.join(".");
  const row: NewCorrectionRow = {
    target: "investigator_profile",
    target_id: input.investigatorId,
    path: parsed.path,
    from_value: from,
    to_value: coerced.value,
    evidence: { ids: [], quote: null, section: null, confidence: "high", pair: input.pair ? { ...input.pair } : null, via: "dismissal", dismissal: { ...input.dismissal } },
    kind: "profile_weight",
    proposed_by: input.proposedBy,
    status: "proposed",
    decided_by: null,
    decided_at: null,
  };
  const view = parsed.keys[1] === "recent" ? `${categoryDisplay(axis, category).label} (${axisLabel(axis).toLowerCase()}, recent view)` : `${categoryDisplay(axis, category).label} (${axisLabel(axis).toLowerCase()})`;
  const preview: CorrectionPreview = { path: pathKey, axis, category, label, from, to: coerced.value as number, sentence: `Lower ${view} from ${from.toFixed(2)} to ${(coerced.value as number).toFixed(2)} on the fit profile?` };
  return { ok: true, row, preview, patched: applyCorrectionToProfile(input.profile, { target: "investigator", path: parsed.path, to: coerced.value }) };
}

/** Pure. A stored correction's path back to "Paradigm · Clinical trials" (the inspector's labels); an unknown path is shown as is. */
export function correctionPathLabel(target: "investigator_profile" | "opportunity_profile", path: string): string {
  const parsed = parseCorrectionPath(target === "investigator_profile" ? "investigator" : "notice", path);
  if (!parsed) return path;
  const [head, second, third] = parsed.keys;
  if (target === "investigator_profile") {
    if (head === "paradigm" && third) return `${axisLabel("paradigm")} · ${categoryDisplay("paradigm", third).label}${second === "career" ? " (career view)" : ""}`;
    if (head === "characteristics" && second) return `Characteristics · ${second.replace(/_/g, " ")}`;
    if (head && second) return `${axisLabel(head)} · ${categoryDisplay(head, second).label}`;
    return path;
  }
  if (head === "paradigm" && second && third) return `Notice paradigm ${second.replace(/_/g, " ")} · ${categoryDisplay("paradigm", third).label}`;
  if (head && second) return `Notice ${axisLabel(head).toLowerCase()} · ${second.replace(/_/g, " ")}`;
  return path;
}
