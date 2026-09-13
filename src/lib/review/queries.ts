/**
 * The Review page's reads (README §2 and §"State management" "Data fetching").
 *
 * Three loaders, each bounded and none per row:
 *
 *   - **`loadQueuePairs`** — the queue's pairs: every Strong and Moderate row
 *     on an open notice (one read, joined to the notice), the Exploratory rows
 *     of those notices (one read, best first), capped by the policy in
 *     `queue.ts`, with archived people dropped (one read). Shared by the page
 *     and the sidebar badge so the two never count different rows.
 *   - **`loadReviewQueue`** — the aside: the queued notices in decision order
 *     with their counts, over the team's decisions (one read).
 *   - **`loadReviewNotice`** — the selected notice: the header facts, and its
 *     rows through `loadNoticeFit`, the same loader the opportunity page's
 *     aside uses, so a pair carries one verdict wherever it is shown. Around
 *     the rows: this notice's Outreach contact states, the people's other
 *     conversations in this team (the history line and the clash warning),
 *     standing pair flags, and the two head counts the footer's line needs.
 *
 * Nothing here is a model call, and nothing here writes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadTeamFitEngine, type FitEngine } from "@/lib/fit/flag";
import { MISSING_TABLE } from "@/lib/fit/results";
import { pairFlagLabel, type PairFlagReason } from "@/lib/fit/row-actions";
import type { EvidenceSummary, Tier } from "@/lib/fit/types";
import type { PanelContent } from "@/lib/fit/verdict-panel";
import { loadNoticeProfiles } from "@/lib/fit/verdict-profiles";
import { eligibilityRestrictions, type FitVerdicts, type Tone } from "@/lib/fit/verdicts";
import { normalizeAgencyDisplayName } from "@/lib/funding-opportunities/agency-display";
import { resolveFundingOpportunityDescription } from "@/lib/funding-opportunities/display-text";
import { fundingListRowScope, type FundingListRowBucket } from "@/lib/funding-opportunities/funding-list-row-scope";
import { loadContactStates, loadNoticeFit, noticeFitEmptyText } from "@/lib/funding-opportunities/notice-fit";
import { cycleFactsFromRow, daysBetween, dueDisplay, fmtMonD, internalRoutingDate, isNihNotice, type CycleColumns, type RoutingRule } from "@/lib/funding-opportunities/receipt-cycles";
import { personInitials } from "@/lib/investigators/sources";
import { DECISION_COLUMNS, effectiveDecision, fromDecisionRow, matchKey, type DecisionRow, type MatchDecision } from "@/lib/review/decisions";
import { academicRank, capExploratory, cardTitleOf, EXPLORATORY_CAP, keyStats, listedPairs, noticeCounts, noticeMetaLine, orderQueue, pursuitVerdict, QUEUE_TIERS, routingOf, type KeyStat, type NoticeCounts, type PursuitVerdict, type QueueNotice, type QueuePair } from "@/lib/review/queue";

// ---------------------------------------------------------------------------
// Notice rows
// ---------------------------------------------------------------------------

const NOTICE_COLUMNS = "id, title, opportunity_number, agency, agency_code, activity_code, funding_instrument, award_ceiling, close_date, next_due, receipt_cycles, cycles_source, standard_dates_apply, expiration_date, forecasted, status, loi_due, loi_note, nih_ic_tokens";

type NoticeRow = CycleColumns & {
  id: string;
  title: string;
  opportunity_number: string | null;
  agency: string | null;
  agency_code: string | null;
  activity_code: string | null;
  funding_instrument: string | null;
  award_ceiling: number | string | null;
  loi_due: string | null;
  loi_note: string | null;
  nih_ic_tokens: string[] | null;
};

const bucketOf = (fo: NoticeRow, today: string): FundingListRowBucket => fundingListRowScope({ status: fo.status ?? null, close_date: fo.close_date, forecasted: fo.forecasted }, new Date(`${today}T00:00:00Z`));

/** The next deadline and its distance, from the notice's own receipt cycles. */
function dueOf(fo: NoticeRow, today: string): { date: string | null; days: number | null } {
  const due = dueDisplay(cycleFactsFromRow(fo), today);
  if (!due.date || due.tone === "closed" || due.tone === "muted" || due.tone === "forecast") return { date: null, days: null };
  return { date: due.date, days: daysBetween(today, due.date) };
}

// ---------------------------------------------------------------------------
// 1. The queue's pairs
// ---------------------------------------------------------------------------

export type QueuePairsRead = {
  /** False when `fit_results` is not on the database. */
  available: boolean;
  /** The listed pairs — the policy applied, archived people dropped. */
  pairs: QueuePair[];
  notices: Map<string, NoticeRow>;
  /** Every surfaced row's tier per queued notice, before the cap — the pursuit line and the footer count what the cap hid. */
  byTier: Map<string, Record<Tier, number>>;
};

const EMPTY_TIERS = (): Record<Tier, number> => ({ strong: 0, moderate: 0, exploratory: 0, poor: 0 });

export async function loadQueuePairs(db: SupabaseClient, today: string): Promise<QueuePairsRead> {
  const empty: QueuePairsRead = { available: true, pairs: [], notices: new Map(), byTier: new Map() };
  const sm = await db
    .from("fit_results")
    .select(`investigator_id, opportunity_id, tier, score, funding_opportunities!inner(${NOTICE_COLUMNS})`)
    .in("tier", QUEUE_TIERS)
    .limit(1000);
  if (sm.error) {
    if (MISSING_TABLE.test(sm.error.message)) return { ...empty, available: false };
    throw new Error(`fit_results: ${sm.error.message}`);
  }
  type Joined = { investigator_id: string; opportunity_id: string; tier: Tier; score: number | string; funding_opportunities: NoticeRow | NoticeRow[] | null };
  const notices = new Map<string, NoticeRow>();
  const pairs: QueuePair[] = [];
  for (const r of (sm.data ?? []) as Joined[]) {
    const fo = Array.isArray(r.funding_opportunities) ? r.funding_opportunities[0] : r.funding_opportunities;
    if (!fo || bucketOf(fo, today) === "closed") continue;
    notices.set(fo.id, fo);
    pairs.push({ investigatorId: r.investigator_id, opportunityId: r.opportunity_id, tier: r.tier, score: Number(r.score) });
  }
  if (!notices.size) return empty;

  // The Exploratory rows of the queued notices, best first. `capExploratory`
  // keeps the head of each notice's list, so a truncated read loses only the
  // rows the cap would have dropped anyway.
  const ex = await db
    .from("fit_results")
    .select("investigator_id, opportunity_id, tier, score")
    .in("opportunity_id", Array.from(notices.keys()))
    .eq("tier", "exploratory")
    .order("score", { ascending: false })
    .limit(3000);
  if (ex.error) throw new Error(`fit_results: ${ex.error.message}`);
  for (const r of (ex.data ?? []) as Array<{ investigator_id: string; opportunity_id: string; tier: Tier; score: number | string }>) {
    pairs.push({ investigatorId: r.investigator_id, opportunityId: r.opportunity_id, tier: r.tier, score: Number(r.score) });
  }
  const byTier = new Map<string, Record<Tier, number>>();
  for (const p of pairs) {
    const t = byTier.get(p.opportunityId) ?? EMPTY_TIERS();
    t[p.tier] += 1;
    byTier.set(p.opportunityId, t);
  }

  // Archived people drop out before the cap settles: a slack of two so an
  // archived Exploratory lead is replaced by the next best, not by a gap.
  const loose = listedPairs(pairs, EXPLORATORY_CAP + 2);
  const ids = Array.from(new Set(loose.map((p) => p.investigatorId)));
  const live = await db.from("investigators").select("id").in("id", ids).is("archived_at", null);
  if (live.error) throw new Error(`investigators: ${live.error.message}`);
  const liveIds = new Set(((live.data ?? []) as Array<{ id: string }>).map((r) => r.id));
  const byNotice = new Map<string, QueuePair[]>();
  for (const p of loose) if (liveIds.has(p.investigatorId)) byNotice.set(p.opportunityId, [...(byNotice.get(p.opportunityId) ?? []), p]);
  const listed: QueuePair[] = [];
  for (const rows of byNotice.values()) listed.push(...capExploratory(rows, EXPLORATORY_CAP));
  return { available: true, pairs: listed, notices, byTier };
}

// ---------------------------------------------------------------------------
// Decisions and profile facts, for a set of pairs
// ---------------------------------------------------------------------------

export type DecisionsRead = { available: boolean; byKey: Map<string, MatchDecision> };

/** The team's decisions — every row, since the outreach count needs the confirmations on notices that have since left the queue. */
export async function loadTeamDecisions(db: SupabaseClient, teamId: string): Promise<DecisionsRead> {
  const { data, error } = await db.from("fit_match_decisions").select(DECISION_COLUMNS).eq("team_id", teamId).limit(5000);
  if (error) {
    if (MISSING_TABLE.test(error.message)) return { available: false, byKey: new Map() };
    throw new Error(`fit_match_decisions: ${error.message}`);
  }
  const byKey = new Map<string, MatchDecision>();
  for (const r of (data ?? []) as DecisionRow[]) {
    const d = fromDecisionRow(r);
    if (d) byKey.set(matchKey(d.opportunityId, d.investigatorId), d);
  }
  return { available: true, byKey };
}

/** The people among `ids` marked do-not-contact on the profile. */
async function loadDoNotContact(db: SupabaseClient, ids: readonly string[]): Promise<Set<string>> {
  const uniq = Array.from(new Set(ids));
  if (!uniq.length) return new Set();
  const { data, error } = await db.from("investigators").select("id").in("id", uniq).not("do_not_contact_at", "is", null);
  if (error) {
    console.warn(`[review] investigators: ${error.message}`);
    return new Set();
  }
  return new Set(((data ?? []) as Array<{ id: string }>).map((r) => r.id));
}

// ---------------------------------------------------------------------------
// 2. The sidebar's counts
// ---------------------------------------------------------------------------

export type ReviewBadges = { review: number; outreach: number };

export async function loadReviewBadges(db: SupabaseClient, opts: { teamId: string; today: string }): Promise<ReviewBadges> {
  const engine = await loadTeamFitEngine(db, opts.teamId);
  if (engine !== "fit-v1") return { review: 0, outreach: 0 };
  const [queue, decisions] = await Promise.all([loadQueuePairs(db, opts.today), loadTeamDecisions(db, opts.teamId)]);
  if (!queue.available) return { review: 0, outreach: 0 };
  const dnc = await loadDoNotContact(db, queue.pairs.map((p) => p.investigatorId));
  const review = queue.pairs.filter((p) => !effectiveDecision(decisions.byKey.get(matchKey(p.opportunityId, p.investigatorId)), opts.today) && !dnc.has(p.investigatorId)).length;

  // "Needs you today", the one category this build produces: a confirmed
  // match whose recipient row is still `selected` — or missing, which is a
  // confirmation whose queue place needs making good, and still needs a
  // message.
  const confirmed = Array.from(decisions.byKey.values()).filter((d) => d.status === "confirmed");
  let outreach = 0;
  if (confirmed.length) {
    const { data } = await db
      .from("outreach_recipients")
      .select("investigator_id, status, outreach_items!inner(team_id, opportunity_id)")
      .eq("outreach_items.team_id", opts.teamId)
      .eq("kind", "person")
      .is("removed_at", null)
      .in("investigator_id", Array.from(new Set(confirmed.map((d) => d.investigatorId))));
    const status = new Map<string, string>();
    for (const r of (data ?? []) as Array<{ investigator_id: string; status: string; outreach_items: { opportunity_id: string } | { opportunity_id: string }[] | null }>) {
      const item = Array.isArray(r.outreach_items) ? r.outreach_items[0] : r.outreach_items;
      if (item) status.set(matchKey(item.opportunity_id, r.investigator_id), r.status);
    }
    outreach = confirmed.filter((d) => (status.get(matchKey(d.opportunityId, d.investigatorId)) ?? "selected") === "selected").length;
  }
  return { review, outreach };
}

// ---------------------------------------------------------------------------
// 3. The aside
// ---------------------------------------------------------------------------

export type ReviewQueue = {
  engine: FitEngine;
  /** False when `fit_results` is missing; the page says so instead of drawing an empty queue. */
  available: boolean;
  /** False when `fit_match_decisions` is missing: rows still list, nothing can be decided. */
  decisionsAvailable: boolean;
  notices: QueueNotice[];
  /** Undecided listed rows across the queue — the badge's number, for the page's own copy. */
  undecided: number;
  /** Confirmed matches across the queue, for the queued bar. */
  confirmed: number;
  pairs: QueuePairsRead;
  decisions: Map<string, MatchDecision>;
  doNotContact: Set<string>;
  limited: Set<string>;
};

export async function loadReviewQueue(db: SupabaseClient, opts: { teamId: string; today: string; fitEngine: FitEngine }): Promise<ReviewQueue> {
  const none: ReviewQueue = { engine: opts.fitEngine, available: true, decisionsAvailable: true, notices: [], undecided: 0, confirmed: 0, pairs: { available: true, pairs: [], notices: new Map(), byTier: new Map() }, decisions: new Map(), doNotContact: new Set(), limited: new Set() };
  if (opts.fitEngine !== "fit-v1") return none;
  const [pairs, decisions, limitedRows] = await Promise.all([
    loadQueuePairs(db, opts.today),
    loadTeamDecisions(db, opts.teamId),
    db.from("limited_submission_overlays").select("opportunity_id").eq("status", "published").is("deleted_at", null).not("opportunity_id", "is", null),
  ]);
  if (!pairs.available) return { ...none, available: false };
  const limited = new Set(((limitedRows.data ?? []) as Array<{ opportunity_id: string }>).map((r) => r.opportunity_id));
  const doNotContact = await loadDoNotContact(db, pairs.pairs.map((p) => p.investigatorId));

  const byNotice = new Map<string, QueuePair[]>();
  for (const p of pairs.pairs) byNotice.set(p.opportunityId, [...(byNotice.get(p.opportunityId) ?? []), p]);
  const items: QueueNotice[] = [];
  let undecided = 0;
  let confirmed = 0;
  for (const [id, rows] of byNotice) {
    const fo = pairs.notices.get(id);
    if (!fo) continue;
    const counts = noticeCounts(rows.map((p) => ({ tier: p.tier, decision: effectiveDecision(decisions.byKey.get(matchKey(id, p.investigatorId)), opts.today), doNotContact: doNotContact.has(p.investigatorId) })));
    undecided += counts.undecided;
    confirmed += counts.confirmed;
    const due = dueOf(fo, opts.today);
    items.push({ id, number: fo.opportunity_number, title: fo.title, dueDate: due.date, dueDays: due.days, limited: limited.has(id), counts });
  }
  return { engine: opts.fitEngine, available: true, decisionsAvailable: decisions.available, notices: orderQueue(items), undecided, confirmed, pairs, decisions: decisions.byKey, doNotContact, limited };
}

// ---------------------------------------------------------------------------
// 4. The selected notice
// ---------------------------------------------------------------------------

export type ReviewRow = {
  investigatorId: string;
  opportunityId: string;
  name: string;
  initials: string;
  href: string;
  /** "Dermatology · ImmunoX · Associate Professor". */
  identity: string | null;
  tier: Tier;
  verdicts: FitVerdicts;
  /** The three verdicts as chips, in the fixed order approach · eligibility · evidence. */
  chips: Array<{ text: string; tone: Tone }>;
  disclosure: PanelContent | null;
  /** "3 verified publications · 2 awards · 1 trial. Biosketch not on file." */
  coverage: string | null;
  decision: MatchDecision | null;
  doNotContact: boolean;
  /** This notice's Outreach status, when the surface looked: "Not contacted", "Contacted Sep 4 · no reply". */
  contact: string | null;
  /** The person's last conversation in this team on another notice. */
  history: { text: string; tone: "muted" | "warn" } | null;
  /** A teammate is mid-conversation with this person: the clash warning's sentence. */
  clash: string | null;
  /** A standing "this match is wrong" flag by a teammate — the row reads as ruled out. */
  flag: { reason: PairFlagReason; by: string | null } | null;
};

export type ReviewNoticeHeader = {
  id: string;
  number: string | null;
  /** "NIH · NIAID · cooperative agreement · U19". */
  meta: string;
  /** "Limited submission" / "Career stage gated", or null. */
  flag: string | null;
  title: string;
  fullTitle: string;
  href: string;
  pursuit: PursuitVerdict;
  keyStats: KeyStat[];
  metaLine: string;
  summary: string;
  dueDate: string | null;
};

export type ReviewNoticeData = {
  header: ReviewNoticeHeader;
  rows: ReviewRow[];
  /** Why there are no rows, when there are none. */
  emptyText: string | null;
  counts: NoticeCounts;
  /** The footer's facts. */
  ruledOutEligibility: number;
  belowFloors: number;
  hiddenExploratory: number;
  /** The notice's Outreach item, once it has one. */
  itemId: string | null;
  profilesDegraded: boolean;
};

type ContactRow = {
  investigator_id: string;
  status: string;
  contacted_at: string | null;
  replied_at: string | null;
  outreach_items: { opportunity_id: string; owner_id: string | null; funding_opportunities: { opportunity_number: string | null } | { opportunity_number: string | null }[] | null } | { opportunity_id: string; owner_id: string | null; funding_opportunities: { opportunity_number: string | null } | { opportunity_number: string | null }[] | null }[] | null;
};

const REPLY_WORDS: Record<string, string> = { contacted: "no reply", replied_interested: "replied, interested", replied_maybe: "replied, maybe", replied_not_now: "replied, not now", declined: "declined" };

/** "D. Reyes" */
const shortName = (full: string | null | undefined): string | null => {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  return parts.length === 1 ? parts[0]! : `${parts[0]![0]}. ${parts[parts.length - 1]}`;
};

const firstName = (full: string): string => full.trim().split(/\s+/)[0] || full;

/** Pure. "3 verified publications · 2 awards · 1 trial. Biosketch not on file." */
export function coverageLine(summary: EvidenceSummary | null): string | null {
  if (!summary) return null;
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const parts = [n(summary.publications_verified, "verified publication", "verified publications"), n(summary.grants, "award", "awards"), n(summary.trials, "trial", "trials")];
  return `${parts.join(" · ")}. Biosketch ${summary.biosketch === "on_file" ? "on file" : "not on file"}.`;
}

export async function loadReviewNotice(
  db: SupabaseClient,
  opts: { teamId: string; opportunityId: string; today: string; routing: RoutingRule | null; viewerId: string; queue: ReviewQueue },
): Promise<ReviewNoticeData | null> {
  const { queue, today } = opts;
  const fo = queue.pairs.notices.get(opts.opportunityId);
  if (!fo) return null;
  const tiers = queue.pairs.byTier.get(opts.opportunityId) ?? EMPTY_TIERS();

  const [detail, overlay, profiles, fit, poor, poorE, item] = await Promise.all([
    db.from("funding_opportunities").select("description, raw_payload_json").eq("id", opts.opportunityId).maybeSingle(),
    db.from("limited_submission_overlays").select("cap").eq("opportunity_id", opts.opportunityId).eq("status", "published").is("deleted_at", null).maybeSingle(),
    loadNoticeProfiles(db, [opts.opportunityId]),
    loadNoticeFit(db, { opportunityId: opts.opportunityId, statusBucket: bucketOf(fo, today), fitEngine: queue.engine, limit: 500, exploratoryCap: EXPLORATORY_CAP, audience: "strategist", mode: "verdicts" }),
    db.from("fit_results").select("investigator_id", { count: "exact", head: true }).eq("opportunity_id", opts.opportunityId).eq("tier", "poor"),
    db.from("fit_results").select("investigator_id", { count: "exact", head: true }).eq("opportunity_id", opts.opportunityId).eq("tier", "poor").eq("components->>E", "0"),
    db.from("outreach_items").select("id").eq("team_id", opts.teamId).eq("opportunity_id", opts.opportunityId).maybeSingle(),
  ]);
  const itemId = (item.data as { id?: string } | null)?.id ?? null;
  const profile = profiles.profiles.get(opts.opportunityId) ?? null;
  const cap = (overlay.data as { cap?: number | null } | null)?.cap ?? null;
  const limited = queue.limited.has(opts.opportunityId);

  // ---- the header ----
  const due = dueOf(fo, today);
  const routing = routingOf(due.date, opts.routing, today, internalRoutingDate);
  const ceiling = profile?.mechanism.ceiling_direct_per_year ?? (fo.award_ceiling == null ? null : Number(fo.award_ceiling)) ?? null;
  const restrictions = eligibilityRestrictions(profile?.eligibility);
  const careerGated = restrictions.some((r) => r.includes("early-stage") || r.includes("new investigators"));
  const agencyShort = isNihNotice(fo) ? "NIH" : normalizeAgencyDisplayName(fo.agency) ?? fo.agency_code ?? null;
  const institutes = (fo.nih_ic_tokens ?? []).slice(0, 2).join(", ") || null;
  const header: ReviewNoticeHeader = {
    id: fo.id,
    number: fo.opportunity_number,
    meta: [agencyShort, institutes, fo.funding_instrument?.replace(/_/g, " ").toLowerCase() || null, fo.activity_code].filter(Boolean).join(" · "),
    flag: limited ? "Limited submission" : careerGated ? "Career stage gated" : null,
    title: cardTitleOf(fo.title),
    fullTitle: fo.title,
    href: `/opportunities/${fo.id}`,
    pursuit: pursuitVerdict({ byTier: tiers, dueDays: due.days, routingDays: routing.days, limited, cap }),
    keyStats: keyStats({ dueDate: due.date, dueDays: due.days, routingDate: routing.date, routingDays: routing.days, ceilingPerYear: ceiling, periodYears: profile?.mechanism.period_years ?? null, today }),
    metaLine: noticeMetaLine({ activityCode: fo.activity_code, instrument: fo.funding_instrument, loiDue: fo.loi_due, loiNote: fo.loi_note, limited, cap, today }),
    summary: detail.data ? resolveFundingOpportunityDescription(detail.data as { description?: unknown; raw_payload_json?: unknown }) : "",
    dueDate: due.date,
  };

  // ---- the rows ----
  const ids = fit.matches.map((m) => m.investigatorId);
  const [contact, people, others, flags] = ids.length
    ? await Promise.all([
        loadContactStates(db, itemId, ids),
        db.from("investigators").select("id, rank, research_community_id, do_not_contact_at").in("id", ids),
        db
          .from("outreach_recipients")
          .select("investigator_id, status, contacted_at, replied_at, outreach_items!inner(opportunity_id, owner_id, team_id, funding_opportunities(opportunity_number))")
          .eq("outreach_items.team_id", opts.teamId)
          .neq("outreach_items.opportunity_id", opts.opportunityId)
          .eq("kind", "person")
          .is("removed_at", null)
          .in("status", ["contacted", "replied_interested", "replied_maybe", "replied_not_now", "declined"])
          .in("investigator_id", ids),
        db.from("fit_labels").select("investigator_id, reason, labeler").eq("opportunity_id", opts.opportunityId).eq("source", "pair_flag").in("investigator_id", ids),
      ])
    : [new Map(), { data: [] }, { data: [] }, { data: [] }];
  for (const e of [people, others, flags]) if ("error" in e && e.error) console.warn(`[review] ${e.error.message}`);

  type PersonRow = { id: string; rank: string | null; research_community_id: string | null; do_not_contact_at: string | null };
  const personBy = new Map(((people.data ?? []) as PersonRow[]).map((p) => [p.id, p]));
  // The community's label, read on its own: `investigators` has two
  // relationships to `pipeline_communities`, so PostgREST refuses the embed.
  const communityIds = Array.from(new Set(Array.from(personBy.values()).map((p) => p.research_community_id).filter((x): x is string => Boolean(x))));
  const communityLabel = new Map<string, string>();
  if (communityIds.length) {
    const { data } = await db.from("pipeline_communities").select("id, label").in("id", communityIds);
    for (const c of (data ?? []) as Array<{ id: string; label: string }>) communityLabel.set(c.id, c.label);
  }

  // The latest conversation per person on another notice, and who owns it.
  const latest = new Map<string, { status: string; when: string; number: string | null; ownerId: string | null }>();
  for (const r of (others.data ?? []) as ContactRow[]) {
    const it = Array.isArray(r.outreach_items) ? r.outreach_items[0] : r.outreach_items;
    if (!it) continue;
    const when = r.replied_at ?? r.contacted_at;
    if (!when) continue;
    const prev = latest.get(r.investigator_id);
    if (prev && prev.when >= when) continue;
    const fo2 = Array.isArray(it.funding_opportunities) ? it.funding_opportunities[0] : it.funding_opportunities;
    latest.set(r.investigator_id, { status: r.status, when, number: fo2?.opportunity_number ?? null, ownerId: it.owner_id });
  }
  const flagBy = new Map<string, { reason: PairFlagReason; labeler: string | null }>();
  for (const f of (flags.data ?? []) as Array<{ investigator_id: string; reason: string | null; labeler: string | null }>) if (f.reason) flagBy.set(f.investigator_id, { reason: f.reason as PairFlagReason, labeler: f.labeler });
  const nameIds = Array.from(new Set([...Array.from(latest.values()).map((l) => l.ownerId), ...Array.from(flagBy.values()).map((f) => f.labeler)].filter((x): x is string => Boolean(x))));
  const names = new Map<string, string | null>();
  if (nameIds.length) {
    const { data } = await db.from("profiles").select("id, full_name").in("id", nameIds);
    for (const p of (data ?? []) as Array<{ id: string; full_name: string | null }>) names.set(p.id, p.full_name);
  }

  const rows: ReviewRow[] = fit.matches.map((m) => {
    const person = personBy.get(m.investigatorId);
    const community = person?.research_community_id ? communityLabel.get(person.research_community_id) ?? null : null;
    const verdicts = m.verdicts!;
    const last = latest.get(m.investigatorId);
    let history: ReviewRow["history"] = null;
    let clash: string | null = null;
    if (last) {
      const day = last.when.slice(0, 10);
      const about = last.number ? ` about ${last.number}` : "";
      const teammate = last.ownerId && last.ownerId !== opts.viewerId;
      const active = last.status === "contacted" && daysBetween(day, today) <= 30;
      const who = teammate ? (shortName(names.get(last.ownerId!)) ?? "A teammate") : "You";
      history = { text: `${who} contacted ${firstName(m.fullName)} ${fmtMonD(day, today)}${about} — ${REPLY_WORDS[last.status] ?? last.status.replace(/_/g, " ")}.`, tone: teammate && active ? "warn" : "muted" };
      if (teammate && active) clash = `Someone else is already mid-conversation with ${firstName(m.fullName)} — ${who} contacted them ${fmtMonD(day, today)}${about}. Reply pending. Two notes in a week from the same office reads badly.`;
    }
    const flag = flagBy.get(m.investigatorId);
    return {
      investigatorId: m.investigatorId,
      opportunityId: opts.opportunityId,
      name: m.fullName,
      initials: personInitials(m.fullName),
      href: `/investigators/${m.investigatorId}`,
      identity: [m.department?.trim() || null, community, academicRank(person?.rank)].filter(Boolean).join(" · ") || null,
      tier: m.fitTier,
      verdicts,
      chips: [verdicts.approach, verdicts.eligibility, verdicts.evidence].filter((v) => v.text).map((v) => ({ text: v.text, tone: v.tone })),
      disclosure: m.disclosure,
      coverage: coverageLine(m.evidenceSummary),
      decision: effectiveDecision(queue.decisions.get(matchKey(opts.opportunityId, m.investigatorId)), today),
      doNotContact: Boolean(person?.do_not_contact_at) || queue.doNotContact.has(m.investigatorId),
      contact: contact.get(m.investigatorId)?.text ?? null,
      history,
      clash,
      flag: flag ? { reason: flag.reason, by: shortName(flag.labeler ? names.get(flag.labeler) : null) } : null,
    };
  });

  const counts = noticeCounts(rows.map((r) => ({ tier: r.tier, decision: r.decision, doNotContact: r.doNotContact })));
  return {
    header,
    rows,
    emptyText: rows.length ? null : noticeFitEmptyText(fit),
    counts,
    ruledOutEligibility: poorE.count ?? 0,
    belowFloors: Math.max(0, (poor.count ?? 0) - (poorE.count ?? 0)),
    hiddenExploratory: Math.max(0, tiers.exploratory - counts.byTier.exploratory),
    itemId,
    profilesDegraded: fit.profilesDegraded,
  };
}

/** "Ruled out · wrong research area · D. Reyes" — the status text for a standing pair flag on an undecided row. */
export function flagStatusText(flag: NonNullable<ReviewRow["flag"]>): string {
  return `Ruled out · ${pairFlagLabel(flag.reason, "strategist").toLowerCase()}${flag.by ? ` · ${flag.by}` : ""}`;
}

// Re-exported so the page can key its aside on the same ids the loader used.
export { listedPairs };
