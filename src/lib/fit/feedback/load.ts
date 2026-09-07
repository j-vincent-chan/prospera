/**
 * Supabase reads behind the correction surfaces (plan § PR 3.2): the
 * `fit_corrections` rows an inspector page lists, and the "wrong type of
 * research" dismissals that still await their one-click confirmation on the
 * investigator's page. Server-side only; the view models and the pairing
 * rule are pure and tested. Nothing here writes — the actions do
 * (src/app/actions/fit-correction-actions.ts, outreach-actions.ts).
 *
 * Both tables may be missing (migrations written, not applied): every read
 * answers `available: false` instead of throwing, the inspector's rule.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDismissalCorrection, correctionPathLabel, type CorrectionPreview } from "@/lib/fit/feedback/correction";
import { WRONG_RESEARCH_TYPE } from "@/lib/fit/feedback/dismissal";
import { CORRECTIONS_MIGRATION, MISSING_TABLE, type CorrectionRow, type CorrectionTargetTable, type NewCorrectionRow } from "@/lib/fit/judge/corrections";
import type { CorrectionAuthor, CorrectionKind, CorrectionStatus, InvestigatorFitProfile } from "@/lib/fit/types";

export { CORRECTIONS_MIGRATION };

export const DISMISSALS_MIGRATION = "supabase/migrations/20260920100000_outreach_dismissal_reasons.sql";

/** PostgREST's message for a column the schema cache does not know (the 3.2 migration not applied yet). */
export const MISSING_COLUMN = /could not find the .*column|column .* does not exist|schema cache/i;

// ---------------------------------------------------------------------------
// Corrections as the inspector lists them
// ---------------------------------------------------------------------------

export type CorrectionView = {
  id: string;
  target: CorrectionTargetTable;
  path: string;
  /** "Paradigm · Clinical trials". */
  pathLabel: string;
  from: string;
  to: string;
  kind: CorrectionKind;
  proposedBy: CorrectionAuthor;
  status: CorrectionStatus;
  /** "judge" (the reconciler), "dismissal" (a person's one-click confirmation) or the stored `via`. */
  via: string;
  /** What it rests on: the dismissal ("wrong type of research · paradigm:clinical_trials"), or the ids / quote the judge cited. */
  evidenceLine: string;
  pair: { investigator_id: string; opportunity_id: string } | null;
  createdAt: string;
  decidedAt: string | null;
};

const fmtValue = (v: unknown): string => {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return v.toFixed(2);
  if (Array.isArray(v)) return v.length ? v.map(String).join(", ") : "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
};

/** Pure. One stored row as the inspector shows it. */
export function correctionView(row: CorrectionRow): CorrectionView {
  const ev = row.evidence ?? { ids: [], quote: null, section: null, confidence: "medium", pair: null };
  const via = ev.via === "dismissal" ? "dismissal" : ev.via === "reconciler" || row.proposed_by === "judge" ? "judge" : (ev.via ?? row.proposed_by);
  const evidenceLine = ev.dismissal
    ? `${ev.dismissal.reason.replace(/_/g, " ")} · ${ev.dismissal.axis_reason}${ev.dismissal.at ? ` · dismissed ${ev.dismissal.at.slice(0, 10)}` : ""}`
    : ev.quote
      ? `“${ev.quote.slice(0, 160)}${ev.quote.length > 160 ? "…" : ""}”${ev.section ? ` — ${ev.section}` : ""}`
      : ev.ids?.length
        ? `cites ${ev.ids.join(", ")}`
        : "no evidence recorded";
  return {
    id: row.id,
    target: row.target,
    path: row.path,
    pathLabel: correctionPathLabel(row.target, row.path),
    from: fmtValue(row.from_value),
    to: fmtValue(row.to_value),
    kind: row.kind,
    proposedBy: row.proposed_by,
    status: row.status,
    via,
    evidenceLine,
    pair: ev.pair ?? null,
    createdAt: row.created_at,
    decidedAt: row.decided_at ?? null,
  };
}

const STATUS_ORDER: Record<CorrectionStatus, number> = { proposed: 0, applied: 1, rejected: 2 };

/** Pure. Proposed first, then applied, then rejected; newest first inside a status. */
export function sortCorrections<R extends { status: CorrectionStatus; created_at: string }>(rows: readonly R[]): R[] {
  return [...rows].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}

export type CorrectionsRead = { available: boolean; rows: CorrectionView[]; error: string | null };

const CORRECTION_COLUMNS = "id, target, target_id, path, from_value, to_value, evidence, kind, proposed_by, status, decided_by, created_at, decided_at";

/** Every correction on one profile (the inspector's "Proposed corrections" card): proposed first, newest first. */
export async function loadCorrectionsFor(db: SupabaseClient, target: CorrectionTargetTable, targetId: string): Promise<CorrectionsRead> {
  const { data, error } = await db.from("fit_corrections").select(CORRECTION_COLUMNS).eq("target", target).eq("target_id", targetId).order("created_at", { ascending: false }).limit(200);
  if (error) {
    if (MISSING_TABLE.test(error.message)) return { available: false, rows: [], error: null };
    return { available: true, rows: [], error: error.message };
  }
  return { available: true, rows: sortCorrections((data ?? []) as CorrectionRow[]).map(correctionView), error: null };
}

// ---------------------------------------------------------------------------
// Dismissals awaiting their one-click confirmation
// ---------------------------------------------------------------------------

/** One "wrong type of research" dismissal of the investigator, as the confirmation needs it. */
export type DismissalSignal = {
  suggestionId: string;
  itemId: string;
  opportunityId: string | null;
  noticeTitle: string | null;
  axisReason: string;
  dismissedBy: string | null;
  dismissedAt: string | null;
};

export type DismissalsRead = { available: boolean; rows: DismissalSignal[]; error: string | null };

type SuggestionRow = { id: string; item_id: string; axis_reason: string | null; dismissed_by: string | null; dismissed_at: string | null; outreach_items: { opportunity_id: string; funding_opportunities: { title: string } | { title: string }[] | null } | Array<{ opportunity_id: string; funding_opportunities: { title: string } | { title: string }[] | null }> | null };

/** The investigator's `wrong_research_type` dismissals that name a category (the ones a correction can be built from), newest first; `available: false` before the 3.2 migration. RLS scopes the rows to the viewer's teams. */
export async function loadWrongTypeDismissals(db: SupabaseClient, investigatorId: string): Promise<DismissalsRead> {
  const { data, error } = await db
    .from("outreach_suggestions")
    .select("id, item_id, axis_reason, dismissed_by, dismissed_at, outreach_items(opportunity_id, funding_opportunities(title))")
    .eq("investigator_id", investigatorId)
    .eq("status", "dismissed")
    .eq("dismissed_reason", WRONG_RESEARCH_TYPE)
    .order("dismissed_at", { ascending: false })
    .limit(50);
  if (error) {
    if (MISSING_COLUMN.test(error.message)) return { available: false, rows: [], error: null };
    return { available: true, rows: [], error: error.message };
  }
  const rows: DismissalSignal[] = [];
  for (const r of (data ?? []) as SuggestionRow[]) {
    if (!r.axis_reason) continue;
    const item = Array.isArray(r.outreach_items) ? r.outreach_items[0] : r.outreach_items;
    const fo = item ? (Array.isArray(item.funding_opportunities) ? item.funding_opportunities[0] : item.funding_opportunities) : null;
    rows.push({ suggestionId: r.id, itemId: r.item_id, opportunityId: item?.opportunity_id ?? null, noticeTitle: fo?.title ?? null, axisReason: r.axis_reason, dismissedBy: r.dismissed_by, dismissedAt: r.dismissed_at });
  }
  return { available: true, rows, error: null };
}

export type PendingProposal = { signal: DismissalSignal; preview: CorrectionPreview; row: NewCorrectionRow };

export type PendingProposals = { pending: PendingProposal[]; /** Dismissals that propose nothing, with why (an axis-only sub-reason, a category the profile does not carry, already proposed …). */ skipped: Array<{ signal: DismissalSignal; reason: string }> };

/**
 * Pure. The rows a confirmation would still write: a dismissal is pending
 * while no correction on the same path is open or applied and none was
 * rejected on that very dismissal (a later dismissal may propose the same
 * edit again — the rejection was of the earlier signal). One proposal per
 * path: two dismissals naming the same category collapse to the newest.
 */
export function pendingProposals(input: { investigatorId: string; profile: InvestigatorFitProfile; signals: readonly DismissalSignal[]; existing: readonly CorrectionRow[]; proposedBy: Exclude<CorrectionAuthor, "judge"> }): PendingProposals {
  const pending: PendingProposal[] = [];
  const skipped: PendingProposals["skipped"] = [];
  const seenPaths = new Set<string>();
  for (const signal of input.signals) {
    const built = buildDismissalCorrection({
      investigatorId: input.investigatorId,
      profile: input.profile,
      axisReason: signal.axisReason,
      proposedBy: input.proposedBy,
      dismissal: { reason: WRONG_RESEARCH_TYPE, axis_reason: signal.axisReason, suggestion_id: signal.suggestionId, item_id: signal.itemId, by: signal.dismissedBy, at: signal.dismissedAt },
      pair: signal.opportunityId ? { investigator_id: input.investigatorId, opportunity_id: signal.opportunityId } : null,
    });
    if (!built.ok) {
      skipped.push({ signal, reason: built.reason });
      continue;
    }
    if (seenPaths.has(built.row.path)) {
      skipped.push({ signal, reason: "a newer dismissal already proposes this edit" });
      continue;
    }
    const prior = priorCorrectionFor(built.row, input.existing);
    if (prior) {
      skipped.push({ signal, reason: prior.status === "rejected" ? "rejected before on this dismissal" : `already ${prior.status}` });
      seenPaths.add(built.row.path);
      continue;
    }
    seenPaths.add(built.row.path);
    pending.push({ signal, preview: built.preview, row: built.row });
  }
  return { pending, skipped };
}

/** Pure. The stored row that makes a dismissal's proposal redundant: an open or applied correction on the same path, or a rejection of this very dismissal (by suggestion id). */
export function priorCorrectionFor(row: NewCorrectionRow, existing: readonly CorrectionRow[]): CorrectionRow | null {
  const mine = row.evidence?.dismissal?.suggestion_id ?? null;
  return (
    existing.find((e) => e.target === row.target && e.target_id === row.target_id && e.path === row.path && (e.status === "proposed" || e.status === "applied" || (e.status === "rejected" && mine !== null && e.evidence?.dismissal?.suggestion_id === mine))) ?? null
  );
}

export type PendingProposalsRead = PendingProposals & { /** Both the dismissal column and `fit_corrections` are on the database. */ available: boolean; /** The investigator has a stored fit profile. */ profiled: boolean; error: string | null };

/** The investigator page's pending confirmations: three reads (dismissals, corrections, the stored profile), nothing per row. */
export async function loadPendingProposals(db: SupabaseClient, investigatorId: string, proposedBy: Exclude<CorrectionAuthor, "judge">): Promise<PendingProposalsRead> {
  const none: PendingProposalsRead = { pending: [], skipped: [], available: true, profiled: false, error: null };
  const dismissals = await loadWrongTypeDismissals(db, investigatorId);
  if (!dismissals.available) return { ...none, available: false };
  if (dismissals.error) return { ...none, error: dismissals.error };
  if (!dismissals.rows.length) return none;
  const [{ data: corrections, error: corrErr }, { data: prof, error: profErr }] = await Promise.all([
    db.from("fit_corrections").select(CORRECTION_COLUMNS).eq("target", "investigator_profile").eq("target_id", investigatorId).limit(500),
    db.from("investigator_fit_profiles").select("profile").eq("investigator_id", investigatorId).maybeSingle(),
  ]);
  if (corrErr) {
    if (MISSING_TABLE.test(corrErr.message)) return { ...none, available: false };
    return { ...none, error: corrErr.message };
  }
  if (profErr) {
    if (MISSING_TABLE.test(profErr.message)) return none;
    return { ...none, error: profErr.message };
  }
  const profile = (prof as { profile?: InvestigatorFitProfile } | null)?.profile ?? null;
  if (!profile) return none;
  return { ...pendingProposals({ investigatorId, profile, signals: dismissals.rows, existing: (corrections ?? []) as CorrectionRow[], proposedBy }), available: true, profiled: true, error: null };
}
