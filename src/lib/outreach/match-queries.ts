/**
 * The Outreach board's read (README §5): every live person recipient on the
 * team's notices, as a match row. Bounded reads, none per row:
 *
 *   1. the team's items with their notice (one read);
 *   2. the person recipients on them, with the match columns the migration
 *      added (one read — and, when those columns are not on the database
 *      yet, the same read without them, so the board still lists and says it
 *      cannot move anything);
 *   3. the team's members, for owner names and the in-place owner picker;
 *   4. the Review confirmations, for "Carried from the match" and the
 *      Unconfirm verb;
 *   5. what was sent to each person and the calls logged, for the thread.
 *
 * `countNeedsYouToday` is the sidebar badge's read: the same rows, counted.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { MISSING_TABLE } from "@/lib/fit/results";
import { cycleFactsFromRow, daysBetween, dueDisplay, fmtMonD, internalRoutingDate, type CycleColumns, type RoutingRule } from "@/lib/funding-opportunities/receipt-cycles";
import { carriedLine, matchView, sortRows, type MatchFilter, type MatchGroup, type MatchRow, type PursuitStage, type ThreadEntry } from "@/lib/outreach/matches";
import { matchesFilter, FILTER_ORDER } from "@/lib/outreach/matches";
import type { OutreachStage, RecipientStatus } from "@/lib/outreach/types";
import { loadTeamDecisions } from "@/lib/review/queries";

export type MatchBoard = {
  rows: MatchRow[];
  counts: Record<MatchGroup, number>;
  filterCounts: Record<MatchFilter, number>;
  replyWindowDays: number;
  /** Ready-to-send matches, for the header's "Draft N messages". */
  ready: number;
  /** The compose tab of the first notice with a ready match. */
  draftHref: string | null;
  members: Array<{ id: string; name: string }>;
  /** False until the match-stage migration is applied: rows list, verbs are withheld. */
  available: boolean;
};

const DEFAULT_REPLY_WINDOW = 7;
const MISSING_COLUMN = /could not find the .*column|column .* does not exist|schema cache/i;

/** The team's reply window, or the default when the column is not on the database yet. Never throws. */
export async function loadReplyWindowDays(db: SupabaseClient, teamId: string): Promise<number> {
  const { data, error } = await db.from("teams").select("reply_window_days").eq("id", teamId).maybeSingle();
  if (error || !data) return DEFAULT_REPLY_WINDOW;
  const n = (data as { reply_window_days?: unknown }).reply_window_days;
  return typeof n === "number" && n >= 3 && n <= 21 ? n : DEFAULT_REPLY_WINDOW;
}

type ItemRow = {
  id: string;
  opportunity_id: string;
  stage: OutreachStage;
  owner_id: string | null;
  funding_opportunities: (CycleColumns & { id: string; title: string; opportunity_number: string | null }) | Array<CycleColumns & { id: string; title: string; opportunity_number: string | null }> | null;
};

type RecipientRow = {
  id: string;
  item_id: string;
  investigator_id: string | null;
  status: RecipientStatus;
  origin: "you" | "suggested";
  contacted_at: string | null;
  replied_at: string | null;
  reply_note: string | null;
  added_at: string;
  pursuit_stage?: PursuitStage | null;
  next_step?: string | null;
  next_step_date?: string | null;
  owner_id?: string | null;
  investigators: { full_name: string; home_department: string | null; research_community_id: string | null } | Array<{ full_name: string; home_department: string | null; research_community_id: string | null }> | null;
};

const BASE_RECIPIENT_COLUMNS = "id, item_id, investigator_id, status, origin, contacted_at, replied_at, reply_note, added_at, investigators(full_name, home_department, research_community_id)";
const MATCH_RECIPIENT_COLUMNS = `${BASE_RECIPIENT_COLUMNS}, pursuit_stage, next_step, next_step_date, owner_id`;

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export async function loadMatchBoard(db: SupabaseClient, opts: { teamId: string; viewerId: string; routing: RoutingRule | null; today: string }): Promise<MatchBoard> {
  const { teamId, today } = opts;
  const [replyWindowDays, items, members, communities, decisions] = await Promise.all([
    loadReplyWindowDays(db, teamId),
    db.from("outreach_items").select("id, opportunity_id, stage, owner_id, funding_opportunities(id, title, opportunity_number, close_date, next_due, receipt_cycles, cycles_source, standard_dates_apply, expiration_date, forecasted, status, agency_code, raw_payload_json)").eq("team_id", teamId),
    db.from("team_memberships").select("user_id").eq("team_id", teamId),
    db.from("pipeline_communities").select("id, label"),
    loadTeamDecisions(db, teamId).catch(() => ({ available: false, byKey: new Map() })),
  ]);
  if (items.error) throw new Error(`outreach_items: ${items.error.message}`);
  const itemRows = (items.data ?? []) as ItemRow[];
  const empty: MatchBoard = { rows: [], counts: { now: 0, waiting: 0, progress: 0 }, filterCounts: { all: 0, mine: 0, deadline30: 0, noreply: 0 }, replyWindowDays, ready: 0, draftHref: null, members: [], available: true };
  // Names in a second read: `team_memberships` has two relationships to
  // `profiles`, so PostgREST refuses the embed (the kanban's loader asked for
  // it and silently got no members, which is why its owners read "Teammate").
  const memberIds = ((members.data ?? []) as Array<{ user_id: string }>).map((m) => m.user_id);
  const profiles = memberIds.length ? await db.from("profiles").select("id, full_name, email").in("id", memberIds) : { data: [] as Array<{ id: string; full_name: string | null; email: string | null }>, error: null };
  const profileBy = new Map(((profiles.data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map((p) => [p.id, p]));
  const memberList = memberIds.map((id) => ({ id, name: profileBy.get(id)?.full_name?.trim() || profileBy.get(id)?.email || "Teammate" }));
  const memberName = new Map(memberList.map((m) => [m.id, m.name]));
  const communityLabel = new Map(((communities.data ?? []) as Array<{ id: string; label: string }>).map((c) => [c.id, c.label]));
  if (!itemRows.length) return { ...empty, members: memberList };
  const itemIds = itemRows.map((i) => i.id);

  // The match columns, or — before the migration — the row without them.
  let available = true;
  const readRecipients = async (columns: string): Promise<{ data: unknown; error: { message: string } | null }> => db.from("outreach_recipients").select(columns).in("item_id", itemIds).eq("kind", "person").is("removed_at", null);
  let recips = await readRecipients(MATCH_RECIPIENT_COLUMNS);
  if (recips.error && MISSING_COLUMN.test(recips.error.message)) {
    available = false;
    recips = await readRecipients(BASE_RECIPIENT_COLUMNS);
  }
  if (recips.error) throw new Error(`outreach_recipients: ${recips.error.message}`);
  const recipientRows = ((recips.data ?? []) as RecipientRow[]);
  if (!recipientRows.length) return { ...empty, members: memberList, available };

  // What was sent to each person, and the calls logged about them.
  const investigatorIds = Array.from(new Set(recipientRows.map((r) => r.investigator_id).filter((x): x is string => Boolean(x))));
  const [sent, notes] = await Promise.all([
    db.from("outreach_message_recipients").select("investigator_id, sent_at, rendered_subject, status, outreach_messages!inner(item_id, team_id, subject, sender_name, sent_at)").eq("outreach_messages.team_id", teamId).in("investigator_id", investigatorIds).eq("status", "sent"),
    db.from("outreach_activity").select("item_id, actor_name, text, created_at, payload").in("item_id", itemIds).eq("kind", "note").order("created_at", { ascending: true }).limit(500),
  ]);
  for (const e of [sent.error, notes.error]) if (e) console.warn(`[outreach] ${e.message}`);
  const threadBy = new Map<string, ThreadEntry[]>();
  const push = (key: string, entry: ThreadEntry) => threadBy.set(key, [...(threadBy.get(key) ?? []), entry]);
  for (const s of (sent.data ?? []) as Array<{ investigator_id: string | null; sent_at: string | null; rendered_subject: string | null; outreach_messages: { item_id: string; subject: string; sender_name: string | null; sent_at: string | null } | Array<{ item_id: string; subject: string; sender_name: string | null; sent_at: string | null }> | null }>) {
    const m = one(s.outreach_messages);
    if (!m || !s.investigator_id) continue;
    const when = s.sent_at ?? m.sent_at;
    if (!when) continue;
    push(`${m.item_id}:${s.investigator_id}`, { when, kind: "sent", head: `${fmtMonD(when.slice(0, 10), today)} · ${m.sender_name ? `${m.sender_name} sent` : "you sent"}`, body: s.rendered_subject ?? m.subject });
  }
  for (const n of (notes.data ?? []) as Array<{ item_id: string; actor_name: string; text: string; created_at: string; payload: { investigator_id?: string; call?: boolean } | null }>) {
    const inv = n.payload?.investigator_id;
    if (!inv) continue;
    // A logged call's activity text is "call with <name> — <what was said>", written for the notice's feed; the thread already knows who.
    const call = n.payload?.call === true;
    push(`${n.item_id}:${inv}`, { when: n.created_at, kind: "note", head: `${fmtMonD(n.created_at.slice(0, 10), today)} · ${n.actor_name}${call ? " logged a call" : ""}`, body: call ? n.text.replace(/^call with [^—]+ — /, "") : n.text });
  }

  const rows: MatchRow[] = [];
  for (const r of recipientRows) {
    const item = itemRows.find((i) => i.id === r.item_id);
    const fo = item ? one(item.funding_opportunities) : null;
    const inv = one(r.investigators);
    if (!item || !fo || !inv || !r.investigator_id) continue;
    const due = dueDisplay(cycleFactsFromRow(fo), today);
    const dueDate = due.date && due.tone !== "closed" && due.tone !== "muted" && due.tone !== "forecast" ? due.date : null;
    const routingDate = dueDate && opts.routing ? internalRoutingDate(dueDate, opts.routing) : null;
    const decision = decisions.byKey.get(`${item.opportunity_id}:${r.investigator_id}`);
    const confirmed = decision?.status === "confirmed";
    const view = matchView({
      status: r.status,
      contactedAt: r.contacted_at,
      pursuitStage: r.pursuit_stage ?? null,
      nextStep: r.next_step ?? null,
      nextStepDate: r.next_step_date ?? null,
      itemStage: item.stage,
      routingDate,
      confirmed,
      replyWindowDays,
      today,
    });
    if (!view) continue;
    const thread = [...(threadBy.get(`${item.id}:${r.investigator_id}`) ?? [])];
    if (r.status.startsWith("replied_")) {
      // A reply logged before `replied_at` was recorded still happened; say so without inventing a day.
      const first = inv.full_name.split(/\s+/)[0];
      const replied = `${first} replied ${r.status.replace("replied_", "").replace("_", " ")}`;
      thread.push(r.replied_at ? { when: r.replied_at, kind: "reply", head: `${fmtMonD(r.replied_at.slice(0, 10), today)} · ${replied}`, body: r.reply_note } : { when: r.contacted_at ?? r.added_at, kind: "reply", head: `${replied} · day not recorded`, body: r.reply_note });
    }
    thread.sort((a, b) => a.when.localeCompare(b.when));
    const ownerId = r.owner_id ?? item.owner_id ?? null;
    rows.push({
      recipientId: r.id,
      itemId: item.id,
      investigatorId: r.investigator_id,
      opportunityId: item.opportunity_id,
      name: inv.full_name,
      dept: [inv.home_department?.trim() || null, inv.research_community_id ? communityLabel.get(inv.research_community_id) ?? null : null].filter(Boolean).join(" · ") || null,
      noticeTitle: fo.title,
      noticeNumber: fo.opportunity_number,
      dueDate,
      dueDays: dueDate ? daysBetween(today, dueDate) : null,
      ownerId,
      ownerName: ownerId === opts.viewerId ? "You" : ownerId ? memberName.get(ownerId) ?? "Teammate" : "Unassigned",
      view,
      thread,
      carried: carriedLine({ confirmedAt: decision?.status === "confirmed" ? decision.decidedAt : null, verdictLabel: decision?.verdictLabel ?? null, tag: decision?.reason ?? null, addedAt: r.added_at, origin: r.origin, routingDate, today }),
      confirmed,
      routingDate,
      composeHref: `/outreach/draft?match=${r.id}`,
    });
  }

  const sorted = sortRows(rows);
  const counts: Record<MatchGroup, number> = { now: 0, waiting: 0, progress: 0 };
  for (const row of sorted) counts[row.view.group] += 1;
  const filterCounts = Object.fromEntries(FILTER_ORDER.map((f) => [f, sorted.filter((row) => matchesFilter(row, f, opts.viewerId)).length])) as Record<MatchFilter, number>;
  const readyRows = sorted.filter((row) => row.view.state === "ready");
  return { rows: sorted, counts, filterCounts, replyWindowDays, ready: readyRows.length, draftHref: readyRows.length ? "/outreach/draft" : null, members: memberList, available };
}

/** The sidebar's Outreach count: rows in "Needs you today". Never throws. */
export async function countNeedsYouToday(db: SupabaseClient, teamId: string, today: string): Promise<number> {
  try {
    const board = await loadMatchBoard(db, { teamId, viewerId: "", routing: null, today });
    return board.counts.now;
  } catch (e) {
    if (!(e instanceof Error && MISSING_TABLE.test(e.message))) console.warn(`[outreach] badge: ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  }
}
