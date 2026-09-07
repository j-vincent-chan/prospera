/**
 * The strategist review queue's view model (plan § PR 3.3, `/team/fit-review`).
 * Pure: rows in, four sections out. Everything that touches Supabase is in
 * `load.ts`; everything that writes is in
 * `src/app/actions/fit-review-actions.ts`.
 *
 * The four sections, and what each is read from:
 *
 *   1 AI-flagged leads          `fit_results.adjudication.reconciliation.review.kind`
 *                               = `ai_flagged_lead` — the judge saw a fit the
 *                               structure did not and could not express it as a
 *                               correction (§16 R6, post-rule 6, the scout's
 *                               latent fit). Nothing to approve: the strategist
 *                               reads the note, opens both inspectors, and marks
 *                               it reviewed.
 *   2 Notice corrections        `fit_corrections` `target = 'opportunity_profile'`,
 *                               `status = 'proposed'` — a misread requirement.
 *                               Global: approving re-scores every investigator
 *                               against that notice, so the item carries the
 *                               count that re-score touches.
 *   3 Ungrounded dissents       `review.kind = 'ungrounded_dissent'` — the blind
 *                               pass read the pair lower than the structure and
 *                               the skeptic found nothing to ground it (R4, and
 *                               the below-Strong completion). The engine's tier
 *                               stands; the queue shows the dissent so a person
 *                               can see whether the model is right.
 *   4 Profile-weight            `fit_corrections` `target = 'investigator_profile'`,
 *     corrections               `status = 'proposed'`, any `proposed_by` — the
 *                               judge's weight corrections (D6) and the one-click
 *                               confirmations from a "wrong type of research"
 *                               dismissal (PR 3.2, D46). A 3.2 proposal writes one
 *                               row per stored paradigm view; both views are one
 *                               item here, decided together, because the engine
 *                               picks the view (`chooseView`) and lowering one
 *                               alone would leave the other to re-open the gate.
 *
 * `reviewed` and `reJudging` come from outside the two tables: the review
 * state from `fit_adjudications.reviewed_by / reviewed_at` (this PR's
 * migration), and "re-judging" from the subjects the approve action put back
 * in the judge's queue (`investigator_fit_profiles.fit_judged_at = NULL`) or
 * whose applied correction still owes a re-score
 * (`fit_corrections.rescored_at IS NULL`). A pair marked re-judging shows the
 * engine's tier until the nightly judge reaches it.
 */
import { correctionPathLabel } from "@/lib/fit/feedback/correction";
import { correctionView, type CorrectionView } from "@/lib/fit/feedback/load";
import { evidenceHash, type CorrectionRow, type CorrectionTargetTable } from "@/lib/fit/judge/corrections";
import type { Adjudication, ReviewKind, ShownConfidence } from "@/lib/fit/judge/types";
import { FIT_RESCORE_SYNC_MAX_INVESTIGATORS } from "@/lib/fit/service";
import type { CorrectionKind, Tier } from "@/lib/fit/types";

export const REVIEW_QUEUE_PATH = "/team/fit-review";

/** The two review kinds the queue lists; the other three (`structured_miss`, `gate_correction`, `pending_confirmation`) are decided through their correction rows, not on their own. */
export const QUEUED_REVIEW_KINDS: readonly ReviewKind[] = ["ai_flagged_lead", "ungrounded_dissent"];

export type ReviewSectionId = "leads" | "notice_corrections" | "dissents" | "profile_corrections";

export const REVIEW_SECTION_TITLE: Record<ReviewSectionId, string> = {
  leads: "AI-flagged leads",
  notice_corrections: "Pending notice corrections",
  dissents: "Ungrounded dissents",
  profile_corrections: "Profile-weight corrections awaiting confirmation",
};

export const REVIEW_SECTION_BLURB: Record<ReviewSectionId, string> = {
  leads: "The judge saw a fit the structure did not, and could not express it as a correction. Read it, open both inspectors, mark it reviewed.",
  notice_corrections: "A misread requirement in a notice profile. Approving applies it to the stored notice and re-scores every investigator against that notice.",
  dissents: "The blind pass read the pair lower than the engine and the skeptic found nothing to ground it. The engine's tier stands; check whether it should.",
  profile_corrections: "Axis weights on an investigator's fit profile, proposed by the judge or confirmed from a “wrong type of research” dismissal. Nothing changes until a strategist approves (D6).",
};

// ---------------------------------------------------------------------------
// Rows in
// ---------------------------------------------------------------------------

/**
 * One `fit_results` row carrying a review item, as
 * `FIT_RESULT_REVIEW_COLUMNS` aliases it. The alias fields are optional and
 * `adjudication` is the fallback, so a caller that read the whole blob (a
 * script, a fixture) gets the same view.
 */
export type ReviewResultRow = {
  investigator_id: string;
  opportunity_id: string;
  tier: Tier;
  score: number;
  rationale: string | null;
  review_kind?: ReviewKind | string | null;
  review_note?: string | null;
  judged_at?: string | null;
  judged_tier?: Tier | null;
  judged_from?: Tier | null;
  judged_confidence?: ShownConfidence | null;
  blind_verdict?: Tier | null;
  adjudication?: Adjudication | null;
};

/** Pure. The stage-8 scalars of a row: the aliases PostgREST returned, or the blob when a caller read that instead. */
export function reviewFieldsOf(row: ReviewResultRow): { kind: ReviewKind | null; note: string; judgedAt: string | null; judgedTier: Tier | null; engineTier: Tier | null; confidence: ShownConfidence | null; blind: Tier | null } {
  const rec = row.adjudication?.reconciliation ?? null;
  return {
    kind: (row.review_kind ?? rec?.review?.kind ?? null) as ReviewKind | null,
    note: row.review_note ?? rec?.review?.note ?? "",
    judgedAt: row.judged_at ?? row.adjudication?.judged_at ?? null,
    judgedTier: row.judged_tier ?? rec?.tier ?? null,
    engineTier: row.judged_from ?? rec?.tier_structured ?? null,
    confidence: row.judged_confidence ?? rec?.confidence ?? null,
    blind: row.blind_verdict ?? row.adjudication?.blind?.verdict ?? null,
  };
}

export type SubjectNames = {
  /** investigator id → full name. */
  investigators: ReadonlyMap<string, string | null>;
  /** opportunity id → its number and title. */
  notices: ReadonlyMap<string, { number: string | null; title: string | null }>;
};

export type ReviewQueueInput = {
  /** `fit_results` rows whose review kind is one of `QUEUED_REVIEW_KINDS`. */
  reviewRows: readonly ReviewResultRow[];
  /** `${investigator_id}:${opportunity_id}` → when it was marked reviewed. */
  reviewed: ReadonlyMap<string, string>;
  /** `fit_corrections` rows with `status = 'proposed'`. */
  corrections: readonly CorrectionRow[];
  names: SubjectNames;
  /** opportunity id → how many investigators a re-score of that notice touches. */
  rescoreCounts: ReadonlyMap<string, number>;
  /** Investigators put back in the judge's queue (`fit_judged_at IS NULL`) — their judged pairs read "re-judging" until the nightly runs. */
  reJudgingInvestigators: ReadonlySet<string>;
  /** Notices whose applied correction still owes its re-score (`rescored_at IS NULL`). */
  reJudgingNotices: ReadonlySet<string>;
};

// ---------------------------------------------------------------------------
// Items out
// ---------------------------------------------------------------------------

export type ReviewPair = {
  investigator_id: string;
  opportunity_id: string;
  investigator: string;
  notice: string;
  /** The inspector pages the plan asks each lead to link to. */
  investigatorHref: string;
  noticeHref: string;
  investigatorInspectorHref: string;
  noticeInspectorHref: string;
};

export type LeadItem = {
  /** `${investigator_id}:${opportunity_id}` — the key "mark reviewed" is sent with. */
  key: string;
  kind: Extract<ReviewKind, "ai_flagged_lead" | "ungrounded_dissent">;
  pair: ReviewPair;
  /** The review item's note: the judge's rationale for a lead, the dissent line for a dissent. */
  note: string;
  /** The row's own sentence. */
  rationale: string | null;
  /** The tier the pair is shown at now. */
  tier: Tier;
  /** The engine's tier before stage 8 — for a dissent, "the engine's tier" the plan asks for. */
  engineTier: Tier | null;
  blindVerdict: Tier | null;
  confidence: ShownConfidence | null;
  score: number;
  judgedAt: string | null;
  reviewed: boolean;
  reviewedAt: string | null;
  /** The investigator is back in the judge's queue: this row shows the engine's tier until the nightly re-judges it. */
  reJudging: boolean;
};

export type CorrectionEdit = { id: string; path: string; pathLabel: string; from: string; to: string };

export type CorrectionItem = {
  /** The first row id — what the approve / reject action is sent. */
  key: string;
  /** Every row the decision covers (a 3.2 paradigm proposal: the recent view and the career view). */
  ids: string[];
  target: CorrectionTargetTable;
  targetId: string;
  /** The investigator's name, or the notice's number and title. */
  subject: string;
  subjectHref: string;
  inspectorHref: string;
  /** "Paradigm · Clinical trials" — the label of the first edit, without the view suffix. */
  title: string;
  edits: CorrectionEdit[];
  kind: CorrectionKind;
  proposedBy: CorrectionView["proposedBy"];
  via: string;
  evidenceLine: string;
  createdAt: string;
  /** Notice corrections: how many investigators approving re-scores; null for an investigator correction (always one person). */
  rescoreInvestigators: number | null;
  /** True when the approve action can afford the re-score itself; false = the nightly prelude takes it. */
  rescoreSynchronous: boolean;
  /** The subject already owes a re-score or a re-judge from an earlier approval. */
  reJudging: boolean;
};

export type ReviewSection<Item> = {
  id: ReviewSectionId;
  title: string;
  blurb: string;
  items: Item[];
  /** Items awaiting a decision (what the tab count shows). */
  count: number;
  /** Leads and dissents already marked reviewed, kept out of `items`. */
  reviewed: number;
};

export type ReviewQueue = {
  leads: ReviewSection<LeadItem>;
  noticeCorrections: ReviewSection<CorrectionItem>;
  dissents: ReviewSection<LeadItem>;
  profileCorrections: ReviewSection<CorrectionItem>;
  /** The four counts, in the plan's order. */
  counts: Record<ReviewSectionId, number>;
  total: number;
  /** Subjects an earlier approval left waiting for their re-score or re-judge. */
  reJudging: number;
};

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

export const pairKey = (investigatorId: string, opportunityId: string): string => `${investigatorId}:${opportunityId}`;

/** Pure. The name a notice is shown by: its number, its title, or its id. */
export function noticeLabel(id: string, names: SubjectNames): string {
  const n = names.notices.get(id);
  if (!n) return id;
  return [n.number, n.title].filter(Boolean).join(" · ") || id;
}

function pairOf(row: { investigator_id: string; opportunity_id: string }, names: SubjectNames): ReviewPair {
  return {
    investigator_id: row.investigator_id,
    opportunity_id: row.opportunity_id,
    investigator: names.investigators.get(row.investigator_id) || row.investigator_id,
    notice: noticeLabel(row.opportunity_id, names),
    investigatorHref: `/investigators/${row.investigator_id}`,
    noticeHref: `/opportunities/${row.opportunity_id}`,
    investigatorInspectorHref: `/investigators/${row.investigator_id}/fit`,
    noticeInspectorHref: `/opportunities/${row.opportunity_id}/fit`,
  };
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Pure. Newest judgment first, then the higher score, then the pair — the queue's order for leads and dissents. */
export function compareLeads(a: LeadItem, b: LeadItem): number {
  return cmp(b.judgedAt ?? "", a.judgedAt ?? "") || b.score - a.score || cmp(a.key, b.key);
}

/** Pure. Newest proposal first, then the row id. */
export function compareCorrections(a: CorrectionItem, b: CorrectionItem): number {
  return cmp(b.createdAt, a.createdAt) || cmp(a.key, b.key);
}

/**
 * Pure. The key rows of one proposal share: a "wrong type of research"
 * confirmation (PR 3.2) writes one row per stored paradigm view from one
 * dismissal, and the queue decides them together. Every other row — the
 * judge's, a confirmation without a dismissal on file — is its own item.
 */
export function proposalKey(row: CorrectionRow): string {
  const suggestion = row.evidence?.dismissal?.suggestion_id ?? null;
  return suggestion ? `${row.target}:${row.target_id}:dismissal:${suggestion}:${row.evidence_hash ?? evidenceHash(row.evidence)}` : `row:${row.id}`;
}

/** Pure. "Paradigm · Clinical trials (career view)" → "Paradigm · Clinical trials" — one title over the views the item groups. */
export const withoutViewSuffix = (label: string): string => label.replace(/\s*\((?:career|recent) view\)$/, "");

function correctionItem(rows: CorrectionRow[], input: ReviewQueueInput): CorrectionItem {
  const first = rows[0]!;
  const view = correctionView(first);
  const isNotice = first.target === "opportunity_profile";
  const count = isNotice ? (input.rescoreCounts.get(first.target_id) ?? null) : null;
  return {
    key: first.id,
    ids: rows.map((r) => r.id),
    target: first.target,
    targetId: first.target_id,
    subject: isNotice ? noticeLabel(first.target_id, input.names) : input.names.investigators.get(first.target_id) || first.target_id,
    subjectHref: isNotice ? `/opportunities/${first.target_id}` : `/investigators/${first.target_id}`,
    inspectorHref: isNotice ? `/opportunities/${first.target_id}/fit` : `/investigators/${first.target_id}/fit`,
    title: withoutViewSuffix(view.pathLabel),
    edits: rows.map((r) => {
      const v = correctionView(r);
      return { id: r.id, path: r.path, pathLabel: correctionPathLabel(r.target, r.path), from: v.from, to: v.to };
    }),
    kind: first.kind,
    proposedBy: view.proposedBy,
    via: view.via,
    evidenceLine: view.evidenceLine,
    createdAt: first.created_at,
    rescoreInvestigators: count,
    rescoreSynchronous: !isNotice || (count !== null && count <= FIT_RESCORE_SYNC_MAX_INVESTIGATORS),
    reJudging: isNotice ? input.reJudgingNotices.has(first.target_id) : input.reJudgingInvestigators.has(first.target_id),
  };
}

const section = <Item>(id: ReviewSectionId, items: Item[], reviewed = 0): ReviewSection<Item> => ({ id, title: REVIEW_SECTION_TITLE[id], blurb: REVIEW_SECTION_BLURB[id], items, count: items.length, reviewed });

/** Pure. The queue as `/team/fit-review` renders it. Reviewed leads and dissents are counted, not listed; every correction row that is still `proposed` is listed. */
export function queueView(input: ReviewQueueInput): ReviewQueue {
  const leads: LeadItem[] = [];
  const dissents: LeadItem[] = [];
  let leadsReviewed = 0;
  let dissentsReviewed = 0;
  for (const row of input.reviewRows) {
    const f = reviewFieldsOf(row);
    if (f.kind !== "ai_flagged_lead" && f.kind !== "ungrounded_dissent") continue;
    const key = pairKey(row.investigator_id, row.opportunity_id);
    const reviewedAt = input.reviewed.get(key) ?? null;
    const item: LeadItem = {
      key,
      kind: f.kind,
      pair: pairOf(row, input.names),
      note: f.note,
      rationale: row.rationale ?? null,
      tier: row.tier,
      engineTier: f.engineTier,
      blindVerdict: f.blind,
      confidence: f.confidence,
      score: Number(row.score),
      judgedAt: f.judgedAt,
      reviewed: reviewedAt !== null,
      reviewedAt,
      reJudging: input.reJudgingInvestigators.has(row.investigator_id) || input.reJudgingNotices.has(row.opportunity_id),
    };
    if (item.reviewed) {
      if (f.kind === "ai_flagged_lead") leadsReviewed += 1;
      else dissentsReviewed += 1;
      continue;
    }
    (f.kind === "ai_flagged_lead" ? leads : dissents).push(item);
  }
  leads.sort(compareLeads);
  dissents.sort(compareLeads);

  const grouped = new Map<string, CorrectionRow[]>();
  for (const row of input.corrections) {
    if (row.status !== "proposed") continue;
    const key = proposalKey(row);
    const found = grouped.get(key);
    if (found) found.push(row);
    else grouped.set(key, [row]);
  }
  const noticeItems: CorrectionItem[] = [];
  const profileItems: CorrectionItem[] = [];
  for (const rows of grouped.values()) {
    // Oldest row of a set is the item's identity (the first path the proposal wrote).
    rows.sort((a, b) => cmp(a.created_at, b.created_at) || cmp(a.id, b.id));
    const item = correctionItem(rows, input);
    (item.target === "opportunity_profile" ? noticeItems : profileItems).push(item);
  }
  noticeItems.sort(compareCorrections);
  profileItems.sort(compareCorrections);

  const out = {
    leads: section("leads", leads, leadsReviewed),
    noticeCorrections: section("notice_corrections", noticeItems),
    dissents: section("dissents", dissents, dissentsReviewed),
    profileCorrections: section("profile_corrections", profileItems),
  };
  const counts: Record<ReviewSectionId, number> = { leads: out.leads.count, notice_corrections: out.noticeCorrections.count, dissents: out.dissents.count, profile_corrections: out.profileCorrections.count };
  return {
    ...out,
    counts,
    total: counts.leads + counts.notice_corrections + counts.dissents + counts.profile_corrections,
    reJudging: input.reJudgingInvestigators.size + input.reJudgingNotices.size,
  };
}
