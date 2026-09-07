/**
 * The one-click profile correction (plan § PR 3.2; spec §12 "Dismiss — wrong
 * type of research … propose a profile correction ('lower `clinical_trials`
 * from 0.35 to 0.15?') that the investigator or strategist confirms in one
 * click"). Pure: the rows a confirmation writes to `fit_corrections`, built
 * from the stored investigator profile and the dismissal's sub-reason.
 *
 * Reuses PR 3.1's correction machinery (judge/corrections.ts): the path
 * grammar (`paradigm:clinical_trials` → `paradigm.recent.clinical_trials` and
 * `paradigm.career.clinical_trials`; `materials:animal_mouse` →
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
 * One proposal, one row per stored view. The paradigm axis is scored from
 * the recent view unless it is thin, then from the career view
 * (`chooseView`, §7 stage 2): lowering the recent weight alone leaves the
 * career weight to re-open the gate the moment the recent view thins, so a
 * paradigm dismissal proposes `paradigm.recent.<category>` and, when the
 * career view carries the category too, `paradigm.career.<category>` — the
 * set is one proposal (one preview sentence, one confirmation), stored as
 * one row per path so PR 3.3 applies each through the 3.1 grammar. The
 * other axes have one view and one row.
 *
 * The proposed value follows the spec's example (0.35 → 0.15): the weight
 * is lowered to `feedback.correction_step` below the axis's Poor gate
 * (`paradigm.gates.poor_below`, `unit.gates.poor_below`; design, materials
 * and objective have no gate and borrow `feedback.correction_gate_fallback_axis`'s
 * — D47) — below the gate the category no longer supports a notice that
 * requires it — or, when it already sits below the gate, one step lower;
 * never below 0 (0 removes the key). A category the profile carries in no
 * view cannot be lowered: no proposal.
 */
import { applyCorrectionToProfile, coerceTo, evidenceHash, fromMatches, parseCorrectionPath, readCorrectionPath, type CorrectionDismissal, type CorrectionEvidence, type NewCorrectionRow, type ParsedPath } from "@/lib/fit/judge/corrections";
import { parseAxisSubReason } from "@/lib/fit/goldset/reasons";
import { axisLabel, categoryDisplay, type InspectAxis } from "@/lib/fit/inspect/labels";
import { correctionGateFallbackAxis, correctionStep, paradigmGates, unitGates } from "@/lib/fit/taxonomy";
import type { CorrectionAuthor, InvestigatorFitProfile } from "@/lib/fit/types";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The Poor gate of an axis's weight (the value below which the category stops supporting a requirement); an axis without one borrows `feedback.correction_gate_fallback_axis`'s. */
export function axisPoorGate(axis: InspectAxis | string): number {
  if (axis === "unit") return unitGates().poor_below;
  if (axis === "paradigm") return paradigmGates().poor_below;
  return axisPoorGate(correctionGateFallbackAxis());
}

/** Pure. The weight a "wrong type of research" confirmation proposes: `feedback.correction_step` below the axis gate, or one step below the current value when it is already under the gate; never negative. */
export function proposedWeight(from: number, axis: InspectAxis | string): number {
  const gate = axisPoorGate(axis);
  return Math.max(0, round2(Math.min(from, gate) - correctionStep()));
}

/** Pure. The investigator-profile paths behind a sub-reason: `<axis>:<category>` → the 3.1 grammar's paths (both paradigm views for the paradigm axis); null for an axis-only sub-reason, the topic axis, or an unknown id. */
export function correctionPathsFor(axisReason: string | null | undefined): { paths: ParsedPath[]; axis: InspectAxis; category: string } | null {
  const sub = parseAxisSubReason(axisReason);
  if (!sub.ok || !sub.value.category) return null;
  const { axis, category } = sub.value;
  const raw = axis === "paradigm" ? [`paradigm.recent.${category}`, `paradigm.career.${category}`] : [`${axis}.${category}`];
  const paths: ParsedPath[] = [];
  for (const r of raw) {
    const parsed = parseCorrectionPath("investigator", r);
    if (!parsed || parsed.value !== "weight") return null;
    paths.push(parsed);
  }
  return { paths, axis, category };
}

/** The 3.1 view segment of a stored path (`paradigm.recent.x` → recent); null for a one-view axis. */
const viewOf = (p: Pick<ParsedPath, "keys">): "recent" | "career" | null => (p.keys[0] === "paradigm" && (p.keys[1] === "recent" || p.keys[1] === "career") ? p.keys[1] : null);

/** One row's edit as the preview names it. */
export type CorrectionEdit = {
  /** The stored path (`paradigm.recent.clinical_trials`). */
  path: string;
  /** The paradigm view the path is in; null for a one-view axis. */
  view: "recent" | "career" | null;
  from: number;
  to: number;
};

export type CorrectionPreview = {
  /** The first stored path — the key a list uses for the set. */
  path: string;
  /** Every stored path of the set, `edits`' order. */
  paths: string[];
  axis: InspectAxis;
  category: string;
  /** "Paradigm · Clinical trials". */
  label: string;
  /** The first edit's values (the toast's line). */
  from: number;
  to: number;
  /** One per row: recent first, then career, or the one row of a one-view axis. */
  edits: CorrectionEdit[];
  /** "Lower Clinical trials (paradigm) from 0.81 to 0.15 in the recent view and from 0.70 to 0.15 in the career view on the fit profile?" */
  sentence: string;
};

/** Pure. The preview of a set of edits on one category: the sentence names each paradigm view, one-view axes read as before. */
export function previewFor(axis: InspectAxis, category: string, edits: readonly CorrectionEdit[]): CorrectionPreview {
  if (!edits.length) throw new Error("previewFor: a preview needs at least one edit");
  const name = categoryDisplay(axis, category).label;
  const label = `${axisLabel(axis)} · ${name}`;
  const lower = axisLabel(axis).toLowerCase();
  const range = (e: CorrectionEdit) => `from ${e.from.toFixed(2)} to ${e.to.toFixed(2)}`;
  const sentence =
    edits.length === 1
      ? `Lower ${name} (${lower}${edits[0]!.view ? `, ${edits[0]!.view} view` : ""}) ${range(edits[0]!)} on the fit profile?`
      : `Lower ${name} (${lower}) ${edits.map((e) => `${range(e)} in the ${e.view ?? "stored"} view`).join(" and ")} on the fit profile?`;
  return { path: edits[0]!.path, paths: edits.map((e) => e.path), axis, category, label, from: edits[0]!.from, to: edits[0]!.to, edits: [...edits], sentence };
}

export type DismissalCorrectionInput = {
  investigatorId: string;
  profile: InvestigatorFitProfile;
  axisReason: string;
  proposedBy: Exclude<CorrectionAuthor, "judge">;
  dismissal: CorrectionDismissal;
  /** The pair the dismissal came from (the suggestion's notice); null when unknown. */
  pair: { investigator_id: string; opportunity_id: string } | null;
};

export type DismissalCorrection = {
  ok: true;
  /** One `fit_corrections` row per stored path, `preview.edits`' order. */
  rows: NewCorrectionRow[];
  preview: CorrectionPreview;
  /** The profile as it would read after every row is applied (for a preview; nothing is written here). */
  patched: InvestigatorFitProfile;
} | { ok: false; reason: string };

/** Pure. The `fit_corrections` rows a confirmation writes for one dismissal (one per stored view that carries the category), or why none can be proposed. */
export function buildDismissalCorrection(input: DismissalCorrectionInput): DismissalCorrection {
  const target = correctionPathsFor(input.axisReason);
  if (!target) {
    const sub = parseAxisSubReason(input.axisReason);
    if (!sub.ok) return { ok: false, reason: sub.error };
    if (sub.value.axis === "topic") return { ok: false, reason: "Topic never gates, so a topic dismissal proposes no correction; it is recorded as a negative label." };
    return { ok: false, reason: `"${axisLabel(sub.value.axis)}" names an axis but no category; pick the category (which kind of ${axisLabel(sub.value.axis).toLowerCase()}) to propose a correction.` };
  }
  const { paths, axis, category } = target;
  const label = `${axisLabel(axis)} · ${categoryDisplay(axis, category).label}`;
  const rows: NewCorrectionRow[] = [];
  const edits: CorrectionEdit[] = [];
  let patched = input.profile;
  for (const parsed of paths) {
    const stored = readCorrectionPath(input.profile, parsed);
    const from = typeof stored === "number" && Number.isFinite(stored) ? stored : 0;
    if (from <= 0) continue; // this view does not carry the category
    const to = proposedWeight(from, axis);
    const coerced = coerceTo(parsed, to, stored);
    if ("error" in coerced) return { ok: false, reason: coerced.error };
    if (!fromMatches(parsed, from, stored)) return { ok: false, reason: `The stored value at ${parsed.path} moved; reload and try again.` };
    const value = coerced.value as number;
    if (Math.abs(value - from) < 1e-9) return { ok: false, reason: `${label} is already ${from.toFixed(2)}.` };
    // The same digest the judge's rows carry (PR 3.3), so a rejection of this dismissal's argument is found by the indexed lookup and not only by re-hashing the evidence.
    const evidence: CorrectionEvidence = { ids: [], quote: null, section: null, confidence: "high", pair: input.pair ? { ...input.pair } : null, via: "dismissal", dismissal: { ...input.dismissal } };
    rows.push({
      target: "investigator_profile",
      target_id: input.investigatorId,
      path: parsed.path,
      from_value: from,
      to_value: value,
      evidence,
      evidence_hash: evidenceHash(evidence),
      kind: "profile_weight",
      proposed_by: input.proposedBy,
      status: "proposed",
      decided_by: null,
      decided_at: null,
    });
    edits.push({ path: parsed.path, view: viewOf(parsed), from, to: value });
    patched = applyCorrectionToProfile(patched, { target: "investigator", path: parsed.path, to: value });
  }
  if (!rows.length) return { ok: false, reason: `The fit profile does not carry ${label} (weight 0${axis === "paradigm" ? " in both views" : ""}); there is nothing to lower — the dismissal is recorded as a label.` };
  return { ok: true, rows, preview: previewFor(axis, category, edits), patched };
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
