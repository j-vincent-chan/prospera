/**
 * The strategist review queue's view model (plan § PR 3.3, `/team/fit-review`).
 * Pure: rows in, four sections out. Everything that touches Supabase is in
 * `load.ts`; everything that writes is in
 * `src/app/actions/fit-review-actions.ts`.
 *
 * The four sections, and what each is read from:
 *
 *   1 AI-flagged leads          `fit_adjudications.reconciliation.result.review.kind`
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
 * **Sections 1 and 3 are read from `fit_adjudications`, not from
 * `fit_results.adjudication`.** The blob on the result row is a derived copy:
 * the nightly sweep drops it the moment the profile versions move, which is
 * exactly what an approved correction does — so on the 2026-09 data 22 of the
 * 36 review items the judge had raised were invisible on the results table
 * while all 36 were still on `fit_adjudications`. The adjudication row is the
 * record; `fit_results` is joined only for the tier and score the pair is
 * *shown* at (a pair whose result row is gone falls back to the judged tier).
 *
 * `reviewed` is a column on the same adjudication row (`reviewed_by` /
 * `reviewed_at`, this PR's migration), so it costs no read of its own.
 * "Re-judging" is the subjects an approved correction still owes a re-score
 * for (`fit_corrections.status = 'applied' AND rescored_at IS NULL`, either
 * target) — **not** `investigator_fit_profiles.fit_judged_at IS NULL`, which
 * is true of every investigator the nightly judge has not reached yet (141 of
 * 144 on the 2026-09 roster) and says nothing about this queue. A pair marked
 * re-judging shows the engine's tier until the nightly reaches it.
 */
import { correctionPathLabel } from "@/lib/fit/feedback/correction";
import { correctionView, type CorrectionView } from "@/lib/fit/feedback/load";
import { evidenceHash, type CorrectionRow, type CorrectionTargetTable } from "@/lib/fit/judge/corrections";
import type { Reconciliation, ReviewKind, ShownConfidence } from "@/lib/fit/judge/types";
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
 * One `fit_adjudications` row carrying a review item, as
 * `FIT_ADJUDICATION_REVIEW_COLUMNS` aliases it. The alias fields are optional
 * and the `reconciliation` blob is the fallback, so a caller that read the
 * whole row (a script, a fixture) gets the same view. Note the stored shape:
 * the `Reconciliation` the code derived is under `reconciliation.result`, and
 * `reconciliation.engine` is the engine's own tier and score at judgment time.
 */
export type ReviewAdjudicationRow = {
  investigator_id: string;
  opportunity_id: string;
  /** When the pair was judged — the row's own `created_at`. */
  created_at: string;
  /** This PR's column; absent before the migration (nothing can be marked reviewed, so nothing is). */
  reviewed_at?: string | null;
  review_kind?: ReviewKind | string | null;
  review_note?: string | null;
  judged_tier?: Tier | null;
  judged_from?: Tier | null;
  judged_confidence?: ShownConfidence | null;
  blind_verdict?: Tier | null;
  reconciliation?: { result?: Partial<Reconciliation> | null; engine?: { tier?: Tier | null } | null } | null;
  blind?: { verdict?: Tier | null } | null;
};

/** The tier and score a pair is shown at, from its `fit_results` row; absent when the sweep has dropped the pair. */
export type ShownResult = { tier: Tier; score: number; rationale: string | null };

/** Pure. The stage-8 scalars of an adjudication row: the aliases PostgREST returned, or the stored blob when a caller read that instead. */
export function reviewFieldsOf(row: ReviewAdjudicationRow): { kind: ReviewKind | null; note: string; judgedAt: string | null; judgedTier: Tier | null; engineTier: Tier | null; confidence: ShownConfidence | null; blind: Tier | null } {
  const rec = row.reconciliation?.result ?? null;
  return {
    kind: (row.review_kind ?? rec?.review?.kind ?? null) as ReviewKind | null,
    note: row.review_note ?? rec?.review?.note ?? "",
    judgedAt: row.created_at ?? null,
    judgedTier: row.judged_tier ?? rec?.tier ?? null,
    engineTier: row.judged_from ?? rec?.tier_structured ?? row.reconciliation?.engine?.tier ?? null,
    confidence: row.judged_confidence ?? rec?.confidence ?? null,
    blind: row.blind_verdict ?? row.blind?.verdict ?? null,
  };
}

export type SubjectNames = {
  /** investigator id → full name. */
  investigators: ReadonlyMap<string, string | null>;
  /** opportunity id → its number and title. */
  notices: ReadonlyMap<string, { number: string | null; title: string | null }>;
};

export type ReviewQueueInput = {
  /** The newest `fit_adjudications` row per pair whose review kind is one of `QUEUED_REVIEW_KINDS`. */
  reviewRows: readonly ReviewAdjudicationRow[];
  /** `${investigator_id}:${opportunity_id}` → the tier and score the pair is shown at (`fit_results`). */
  results: ReadonlyMap<string, ShownResult>;
  /** `fit_corrections` rows with `status = 'proposed'`. */
  corrections: readonly CorrectionRow[];
  names: SubjectNames;
  /** opportunity id → how many investigators a re-score of that notice touches. */
  rescoreCounts: ReadonlyMap<string, number>;
  /** Investigators whose applied correction still owes its re-score (`rescored_at IS NULL`). */
  reJudgingInvestigators: ReadonlySet<string>;
  /** Notices whose applied correction still owes its re-score (`rescored_at IS NULL`). */
  reJudgingNotices: ReadonlySet<string>;
  /** A read that came back full: there are more rows than the page took. Per read, so it covers both sections that read shares. */
  truncated?: { reviewRows?: boolean; corrections?: boolean };
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
  /** The tier the pair is shown at now (`fit_results`), or the judged tier when the result row is gone. */
  tier: Tier;
  /** The engine's tier before stage 8 — for a dissent, "the engine's tier" the plan asks for. */
  engineTier: Tier | null;
  blindVerdict: Tier | null;
  confidence: ShownConfidence | null;
  score: number;
  /** False when no `fit_results` row backs the pair any more: the tier shown is the judged one. */
  scored: boolean;
  judgedAt: string | null;
  reviewed: boolean;
  reviewedAt: string | null;
  /** An approved correction on this pair's investigator or notice still owes its re-score: the row reads the engine's tier until the nightly takes it. */
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
  /** Notice corrections: how many investigators approving re-scores; null for an investigator correction (always one person) and for a notice past `RESCORE_COUNT_MAX_NOTICES`, whose count was not read. */
  rescoreInvestigators: number | null;
  /** True when the approve action can afford the re-score itself; false = the nightly prelude takes it. Never true on an unread count — the action decides for itself on the count it reads. */
  rescoreSynchronous: boolean;
  /** The subject already owes a re-score from an earlier approval. */
  reJudging: boolean;
  /** Other proposals on a path this one touches — approving one leaves the others unappliable (their `from_value` no longer matches). They sort next to each other. */
  competing: number;
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
  /** The read this section came from hit `REVIEW_ROW_LIMIT`: there are older items it did not take. */
  truncated: boolean;
};

export type ReviewQueue = {
  leads: ReviewSection<LeadItem>;
  noticeCorrections: ReviewSection<CorrectionItem>;
  dissents: ReviewSection<LeadItem>;
  profileCorrections: ReviewSection<CorrectionItem>;
  /** The four counts, in the plan's order. */
  counts: Record<ReviewSectionId, number>;
  total: number;
  /** Subjects an earlier approval left waiting for their re-score. */
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
    competing: 0,
  };
}

/**
 * Pure. Items that touch a path in common are one competition: approving any
 * one of them moves the stored value, and the others can no longer be applied
 * (their `from_value` stops matching). They are counted on each other and
 * sorted adjacently, so the strategist decides a path once instead of
 * approving two proposals of it in a row and being refused the second.
 *
 * A union-find over `(target, target_id, path)` — an item may hold two paths
 * (a 3.2 dismissal's two views), so "shares a path" is transitive: A and B on
 * `paradigm.recent.x`, B and C on `paradigm.career.x` is one group of three.
 */
export function competingGroups<T extends { key: string; target: CorrectionTargetTable; targetId: string; edits: Array<{ path: string }> }>(items: readonly T[]): Map<string, string[]> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x);
    if (p === undefined || p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const [ra, rb] = [find(a), find(b)];
    if (ra !== rb) parent.set(rb, ra);
  };
  const byPath = new Map<string, string>();
  for (const item of items) {
    parent.set(item.key, parent.get(item.key) ?? item.key);
    for (const e of item.edits) {
      const pathKey = `${item.target}:${item.targetId}:${e.path}`;
      const owner = byPath.get(pathKey);
      if (owner) union(owner, item.key);
      else byPath.set(pathKey, item.key);
    }
  }
  const groups = new Map<string, string[]>();
  for (const item of items) {
    const root = find(item.key);
    const found = groups.get(root);
    if (found) found.push(item.key);
    else groups.set(root, [item.key]);
  }
  return groups;
}

/** Pure. `competing` filled in and the items ordered so a competition sits together: the group's newest proposal decides where the group goes, newest inside it. */
export function withCompeting(items: CorrectionItem[]): CorrectionItem[] {
  const groups = competingGroups(items);
  const groupOf = new Map<string, string[]>();
  for (const keys of groups.values()) for (const k of keys) groupOf.set(k, keys);
  for (const item of items) item.competing = (groupOf.get(item.key)?.length ?? 1) - 1;
  const byKey = new Map(items.map((i) => [i.key, i] as const));
  const rank = new Map<string, { createdAt: string; key: string }>();
  for (const keys of groups.values()) {
    const members = keys.map((k) => byKey.get(k)!).sort(compareCorrections);
    const head = members[0]!;
    for (const k of keys) rank.set(k, { createdAt: head.createdAt, key: head.key });
  }
  return [...items].sort((a, b) => {
    const ra = rank.get(a.key)!;
    const rb = rank.get(b.key)!;
    return cmp(rb.createdAt, ra.createdAt) || cmp(ra.key, rb.key) || compareCorrections(a, b);
  });
}

const section = <Item>(id: ReviewSectionId, items: Item[], over: { reviewed?: number; truncated?: boolean } = {}): ReviewSection<Item> => ({ id, title: REVIEW_SECTION_TITLE[id], blurb: REVIEW_SECTION_BLURB[id], items, count: items.length, reviewed: over.reviewed ?? 0, truncated: over.truncated ?? false });

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
    const reviewedAt = row.reviewed_at ?? null;
    const shown = input.results.get(key) ?? null;
    const item: LeadItem = {
      key,
      kind: f.kind,
      pair: pairOf(row, input.names),
      note: f.note,
      rationale: shown?.rationale ?? null,
      // No result row: the sweep dropped the pair (it is no longer a candidate), so the judged tier is the only tier there is.
      tier: shown?.tier ?? f.judgedTier ?? "poor",
      engineTier: f.engineTier,
      blindVerdict: f.blind,
      confidence: f.confidence,
      score: Number(shown?.score ?? 0),
      scored: shown !== null,
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

  // The read's cap is shared by the two sections it feeds, so a full read truncates both.
  const rowsTruncated = input.truncated?.reviewRows ?? false;
  const correctionsTruncated = input.truncated?.corrections ?? false;
  const out = {
    leads: section("leads", leads, { reviewed: leadsReviewed, truncated: rowsTruncated }),
    noticeCorrections: section("notice_corrections", withCompeting(noticeItems), { truncated: correctionsTruncated }),
    dissents: section("dissents", dissents, { reviewed: dissentsReviewed, truncated: rowsTruncated }),
    profileCorrections: section("profile_corrections", withCompeting(profileItems), { truncated: correctionsTruncated }),
  };
  const counts: Record<ReviewSectionId, number> = { leads: out.leads.count, notice_corrections: out.noticeCorrections.count, dissents: out.dissents.count, profile_corrections: out.profileCorrections.count };
  return {
    ...out,
    counts,
    total: counts.leads + counts.notice_corrections + counts.dissents + counts.profile_corrections,
    reJudging: input.reJudgingInvestigators.size + input.reJudgingNotices.size,
  };
}
