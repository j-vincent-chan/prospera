/**
 * Read model for Home (the design's Today page).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { cycleFactsFromRow, dueDisplay, type CycleColumns } from "@/lib/funding-opportunities/receipt-cycles";
import { getSavedSearchMatchStats } from "@/lib/funding-opportunities/funding-search-notification-query";
import { liveInstitutionDeadlines } from "@/lib/institution/curated";
import { fetchSavedFundingSearchesForTeam } from "@/lib/funding-opportunities/saved-funding-search-query";
import { fundingListHref } from "@/lib/funding-opportunities/funding-list-url";
import { parseSavedFundingListState } from "@/lib/funding-opportunities/saved-funding-list-state";
import { fmtMonD, fmtMonDYear, personInitials } from "@/lib/investigators/sources";
import { STAGE_LABEL, type OutreachStage } from "@/lib/outreach/types";

export type AttentionItem = {
  key: string;
  title: string;
  meta: string;
  when: string;
  whenTone: "danger" | "warning" | "teal" | "neutral";
  dot: "danger" | "warning" | "teal" | "neutral";
  dotLabel: string;
  cta: string;
  href: string;
};

export type HomeData = {
  greeting: string;
  meta: string;
  feedStale: { hours: number; since: string } | null;
  kpis: Array<{ label: string; value: number; sub: string; tone: "danger" | "success" | "neutral"; href: string }>;
  actions: AttentionItem[];
  closing: Array<{ id: string; itemId: string; title: string; meta: string; stage: string; days: string; urgent: boolean }>;
  searches: Array<{ id: string; name: string; meta: string; count: number; href: string }>;
  replies: Array<{ id: string; name: string; initials: string; status: string; tone: "success" | "warning" | "neutral"; meta: string; itemId: string }>;
  newThisWeek: { posted: number; matched: number };
};

const isoToday = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86_400_000);

function greetingFor(name: string, now = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "America/Los_Angeles" }).format(now));
  const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const first = name.trim().split(/\s+/)[0] || "there";
  return `Good ${part}, ${first}`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
}

export async function loadHome(db: SupabaseClient, input: { teamId: string; teamName: string; userId: string; role: "owner" | "admin" | "member"; name: string; lastVisitAt: string | null }): Promise<HomeData> {
  const today = isoToday();
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const since = input.lastVisitAt ?? new Date(Date.now() - 7 * 86_400_000).toISOString();

  const [{ data: items }, { data: sync }, { count: postedWeek }, { data: requests }, { data: former }, { data: watches }, savedSearchesRes] = await Promise.all([
    db
      .from("outreach_items")
      .select("id, stage, owner_id, next_action, next_action_date, created_at, submitted_at, outcome, last_activity_at, funding_opportunities(id, title, agency, agency_code, opportunity_number, activity_code, close_date, next_due, receipt_cycles, cycles_source, standard_dates_apply, expiration_date, forecasted, status, raw_payload_json)")
      .eq("team_id", input.teamId)
      .not("stage", "in", '("outcome","parked")'),
    db.from("sync_job_logs").select("status, started_at, finished_at").eq("job_type", "simpler_grants_sync").order("started_at", { ascending: false }).limit(2),
    db.from("funding_opportunities").select("id", { count: "exact", head: true }).gte("posted_date", weekAgo),
    input.role === "member" ? Promise.resolve({ data: [] }) : db.from("team_access_requests").select("id, note, requested_at, profiles(full_name, department)").eq("team_id", input.teamId).eq("status", "pending").order("requested_at"),
    input.role === "member" ? Promise.resolve({ data: [] }) : db.from("team_former_members").select("user_id, full_name, left_at").eq("team_id", input.teamId).gte("left_at", new Date(Date.now() - 30 * 86_400_000).toISOString()),
    db.from("opportunity_watches").select("opportunity_id, funding_opportunities(id, title, forecasted, posted_date, next_due, close_date)").eq("team_id", input.teamId),
    fetchSavedFundingSearchesForTeam(db, input.teamId),
    Promise.resolve(null),
  ]);
  const savedSearches = savedSearchesRes.rows;

  const rows = (items ?? []) as Array<Record<string, unknown>>;
  const inPlay = rows.map((r) => {
    const fo = (Array.isArray(r.funding_opportunities) ? r.funding_opportunities[0] : r.funding_opportunities) as Record<string, unknown> | null;
    const due = fo ? dueDisplay(cycleFactsFromRow(fo as unknown as CycleColumns), today) : null;
    return { r, fo, due };
  });

  // Recipients for the items in play (PI counts, replies).
  const itemIds = rows.map((r) => r.id as string);
  const { data: recips } = itemIds.length
    ? await db.from("outreach_recipients").select("id, item_id, kind, status, replied_at, investigators(full_name)").in("item_id", itemIds).is("removed_at", null)
    : { data: [] };
  const recBy = new Map<string, Array<Record<string, unknown>>>();
  for (const x of (recips ?? []) as Array<Record<string, unknown>>) recBy.set(x.item_id as string, [...(recBy.get(x.item_id as string) ?? []), x]);
  const { data: members } = await db.from("team_memberships").select("user_id, profiles(full_name)").eq("team_id", input.teamId);
  const memberName = new Map(((members ?? []) as Array<{ user_id: string; profiles: { full_name: string | null } | { full_name: string | null }[] | null }>).map((m) => [m.user_id, (Array.isArray(m.profiles) ? m.profiles[0] : m.profiles)?.full_name?.trim() || "Teammate"]));
  const ownerLabel = (id: string | null) => (id === input.userId ? "you" : id ? memberName.get(id) ?? "Teammate" : "Unassigned");

  // Feed freshness.
  const syncRows = (sync ?? []) as Array<{ status: string; started_at: string; finished_at: string | null }>;
  const lastOk = syncRows.find((s) => s.status === "success");
  const lastAt = lastOk?.finished_at ?? lastOk?.started_at ?? null;
  const hours = lastAt ? Math.floor((Date.now() - new Date(lastAt).getTime()) / 3_600_000) : null;
  const feedStale = hours != null && hours >= 24 ? { hours, since: fmtMonD(lastAt!) } : null;

  // KPIs.
  const overdue = inPlay.filter(({ r }) => r.next_action_date && String(r.next_action_date) < today);
  const closing = inPlay.filter(({ due }) => due?.date && due.date >= today && daysBetween(due.date, today) <= 30 && (due.tone === "urgent" || due.tone === "normal")).sort((a, b) => (a.due!.date! < b.due!.date! ? -1 : 1));
  const searchStats = new Map<string, { newMatches: number; href: string }>();
  await Promise.all(
    savedSearches.slice(0, 8).map(async (sr) => {
      const st = parseSavedFundingListState(sr.state);
      if (!st) return;
      const href = fundingListHref({ ...st, savedSearchId: sr.id }).replace(/^\/funding-opportunities/, "/opportunities");
      try {
        const stats = await getSavedSearchMatchStats(db, st, { lastViewedAt: sr.last_viewed_at ?? since, includeForecasted: sr.alert_forecasted_notices ?? true });
        searchStats.set(sr.id, { newMatches: stats.newMatchesSinceViewed, href });
      } catch {
        searchStats.set(sr.id, { newMatches: 0, href });
      }
    }),
  );
  const newMatches = Array.from(searchStats.values()).reduce((n, s) => n + s.newMatches, 0);
  const replies = ((recips ?? []) as Array<Record<string, unknown>>).filter((x) => String(x.status).startsWith("replied_") && x.replied_at && String(x.replied_at) >= since);
  const interested = replies.filter((x) => x.status === "replied_interested").length;
  const maybe = replies.filter((x) => x.status === "replied_maybe").length;

  // Attention list, in the design's order.
  const actions: AttentionItem[] = [];
  const reqRows = (requests ?? []) as Array<{ id: string; note: string | null; requested_at: string; profiles: { full_name: string | null; department: string | null } | { full_name: string | null; department: string | null }[] | null }>;
  reqRows.slice(0, 2).forEach((q, i) => {
    const p = Array.isArray(q.profiles) ? q.profiles[0] : q.profiles;
    actions.push({ key: `req-${q.id}`, title: `Access request — ${p?.full_name ?? "Someone"}${p?.department ? ` (${p.department})` : ""} wants to join ${input.teamName}`, meta: `Requested ${fmtMonD(q.requested_at)}${q.note ? ` · “${q.note.slice(0, 60)}${q.note.length > 60 ? "…" : ""}”` : ""} · Owner action`, when: `${i + 1} of ${reqRows.length} request${reqRows.length === 1 ? "" : "s"}`, whenTone: "teal", dot: "teal", dotLabel: "Team", cta: "Review", href: "/team?tab=requests" });
  });
  for (const f of (former ?? []) as Array<{ user_id: string | null; full_name: string; left_at: string }>) {
    if (!f.user_id) continue;
    const theirs = inPlay.filter(({ r }) => r.owner_id === f.user_id);
    if (!theirs.length) continue;
    const titles = theirs.slice(0, 2).map(({ fo }) => String(fo?.title ?? "").replace(/\s*\(.*$/, "").slice(0, 36)).join(", ");
    actions.push({ key: `former-${f.user_id}`, title: `Reassign ${theirs.length} next action${theirs.length === 1 ? "" : "s"} — ${f.full_name} left the team ${fmtMonD(f.left_at)}`, meta: `${titles}${theirs.length > 2 ? ` and ${theirs.length - 2} more` : ""} are still assigned to them`, when: "Owner action", whenTone: "warning", dot: "warning", dotLabel: "Needs reassignment", cta: "Reassign", href: "/outreach" });
  }
  const dated = inPlay.filter(({ r }) => r.next_action_date).sort((a, b) => (String(a.r.next_action_date) < String(b.r.next_action_date) ? -1 : 1));
  for (const { r, fo } of dated) {
    const d = daysBetween(String(r.next_action_date), today);
    if (d > 7) continue;
    const recs = recBy.get(r.id as string) ?? [];
    const people = recs.filter((x) => x.kind === "person");
    const meta = [`Owner: ${ownerLabel(r.owner_id as string | null)}`, people.length ? `${people.length} PI${people.length === 1 ? "" : "s"} linked` : null, people.filter((x) => x.status === "replied_interested").length ? `${people.filter((x) => x.status === "replied_interested").length} interested` : null].filter(Boolean).join(" · ");
    const title = `${r.next_action ?? "Next action"} — ${String(fo?.title ?? "").replace(/\s+\((R|U|K|P|F|T|D)\d{2}[^)]*\)\s*$/i, "")}${fo?.activity_code ? ` (${fo.activity_code})` : ""}`;
    if (d < 0) actions.push({ key: `overdue-${r.id}`, title, meta, when: `Overdue by ${-d} day${d === -1 ? "" : "s"} · ${fmtMonD(String(r.next_action_date))}`, whenTone: "danger", dot: "danger", dotLabel: "Overdue", cta: "Open", href: `/outreach?item=${r.id}` });
    else actions.push({ key: `due-${r.id}`, title, meta, when: d === 0 ? `Due today · ${fmtMonD(String(r.next_action_date))}` : `Due in ${d} day${d === 1 ? "" : "s"} · ${fmtMonD(String(r.next_action_date))}`, whenTone: "neutral", dot: "warning", dotLabel: "Due soon", cta: "Open", href: `/outreach?item=${r.id}` });
  }
  const searchesOut: HomeData["searches"] = [];
  for (const sr of savedSearches) {
    const st = searchStats.get(sr.id);
    const n = st?.newMatches ?? 0;
    const href = st?.href ?? "/opportunities";
    const alerts = sr.email_notifications_enabled ? (sr.alert_frequency === "daily" ? "Daily digest" : "Weekly digest") : "Alerts off";
    searchesOut.push({ id: sr.id, name: sr.name, meta: `${alerts}${n ? ` · ${n} new` : ""}`, count: n, href });
    if (n > 0) actions.push({ key: `search-${sr.id}`, title: `Saved search “${sr.name}” — ${n} new notice${n === 1 ? "" : "s"} since ${sr.last_viewed_at ? fmtMonD(sr.last_viewed_at) : "your last visit"}`, meta: "Open to review the new matches", when: "New", whenTone: "teal", dot: "teal", dotLabel: "Saved search", cta: "Review", href });
  }
  for (const w of (watches ?? []) as Array<{ opportunity_id: string; funding_opportunities: Record<string, unknown> | Record<string, unknown>[] | null }>) {
    const fo = Array.isArray(w.funding_opportunities) ? w.funding_opportunities[0] : w.funding_opportunities;
    if (!fo || fo.forecasted || !fo.posted_date || String(fo.posted_date) < new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10)) continue;
    actions.push({ key: `watch-${w.opportunity_id}`, title: `Watched forecast posted — ${String(fo.title)}`, meta: `Forecast became a notice ${fmtMonD(String(fo.posted_date))}${fo.next_due ? ` · first due ${fmtMonDYear(String(fo.next_due))}` : ""}`, when: "Posted", whenTone: "teal", dot: "teal", dotLabel: "Watched", cta: "Open", href: `/opportunities/${w.opportunity_id}` });
  }
  // Institutional layer: published, current internal programs and limited-submission nominations due within 14 days.
  try {
    const horizon = new Date(new Date(`${today}T00:00:00Z`).getTime() + 14 * 86_400_000).toISOString().slice(0, 10);
    for (const d of await liveInstitutionDeadlines(db, today, { from: today, to: horizon })) {
      const days = daysBetween(today, d.date);
      const when = days === 0 ? `Due today · ${fmtMonD(d.date)}` : `Due in ${days} day${days === 1 ? "" : "s"} · ${fmtMonD(d.date)}`;
      if (d.kind === "limited_nomination") actions.push({ key: d.key, title: `Internal nomination — ${d.title}`, meta: `${d.detail} · Limited submissions scope`, when, whenTone: days <= 7 ? "warning" : "neutral", dot: "warning", dotLabel: "Limited submission", cta: "Express interest", href: d.href });
      else actions.push({ key: d.key, title: `${d.kind === "internal_loi" ? "LOI due" : "Application due"} — ${d.title}`, meta: `${d.detail} · Internal (UCSF) scope`, when, whenTone: days <= 7 ? "warning" : "neutral", dot: "neutral", dotLabel: "Internal (UCSF)", cta: "View", href: d.href });
    }
  } catch {
    // institutional tables may not exist yet on an older database
  }
  const { data: submittedRows } = await db.from("outreach_items").select("id, submitted_at").eq("team_id", input.teamId).eq("stage", "submitted").lte("submitted_at", new Date(Date.now() - 14 * 86_400_000).toISOString());
  const submitted = (submittedRows ?? []) as Array<{ id: string; submitted_at: string | null }>;
  if (submitted.length) {
    const oldest = submitted.map((s) => s.submitted_at).filter(Boolean).sort()[0];
    actions.push({ key: "outcomes", title: `Record outcomes — ${submitted.length} item${submitted.length === 1 ? "" : "s"} left Submitted without a result`, meta: "Reports stay empty until outcomes are recorded · Funded / Not funded / Withdrawn", when: oldest ? `Since ${fmtMonD(oldest)}` : "Waiting", whenTone: "warning", dot: "warning", dotLabel: "Needs outcome", cta: "Record", href: "/outreach?stage=submitted" });
  }
  for (const { r, fo } of inPlay.filter(({ r }) => r.stage === "triage").sort((a, b) => (String(a.r.created_at) < String(b.r.created_at) ? -1 : 1))) {
    const recs = recBy.get(r.id as string) ?? [];
    if (recs.some((x) => x.kind === "community")) continue;
    const age = Math.floor((Date.now() - new Date(String(r.created_at)).getTime()) / 86_400_000);
    actions.push({ key: `tag-${r.id}`, title: `Tag community — ${String(fo?.title ?? "").replace(/\s+\((R|U|K|P|F|T|D)\d{2}[^)]*\)\s*$/i, "")}${fo?.activity_code ? ` (${fo.activity_code})` : ""}`, meta: `${ownerLabel(r.owner_id as string | null) === "Unassigned" ? "Unassigned" : `Owner: ${ownerLabel(r.owner_id as string | null)}`} · ${recs.filter((x) => x.kind === "person").length ? `${recs.filter((x) => x.kind === "person").length} PI${recs.filter((x) => x.kind === "person").length === 1 ? "" : "s"} linked` : "no PIs linked"}`, when: `Untriaged ${age} day${age === 1 ? "" : "s"}`, whenTone: "neutral", dot: "neutral", dotLabel: "Untriaged", cta: "Triage", href: `/outreach?item=${r.id}` });
    if (actions.length >= 12) break;
  }

  const repliesOut = replies
    .sort((a, b) => (String(a.replied_at) < String(b.replied_at) ? 1 : -1))
    .slice(0, 4)
    .map((x) => {
      const inv = (Array.isArray(x.investigators) ? x.investigators[0] : x.investigators) as { full_name: string } | null;
      const item = inPlay.find(({ r }) => r.id === x.item_id);
      const status = x.status === "replied_interested" ? "Interested" : x.status === "replied_maybe" ? "Maybe" : "Not this cycle";
      return { id: x.id as string, name: inv?.full_name ?? "Investigator", initials: personInitials(inv?.full_name ?? "?"), status, tone: (x.status === "replied_interested" ? "success" : x.status === "replied_maybe" ? "warning" : "neutral") as "success" | "warning" | "neutral", meta: `${String(item?.fo?.title ?? "").replace(/\s+\((R|U|K|P|F|T|D)\d{2}[^)]*\)\s*$/i, "")}${item?.fo?.activity_code ? ` (${item.fo.activity_code})` : ""} · replied ${fmtMonD(String(x.replied_at))}`, itemId: x.item_id as string };
    });

  const now = new Date();
  const dateLine = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Los_Angeles" }).format(now);
  return {
    greeting: greetingFor(input.name, now),
    meta: `${dateLine} · ${lastAt ? `opportunities synced ${fmtTime(lastAt)}` : "opportunities not synced yet"} · ${postedWeek ?? 0} new notice${postedWeek === 1 ? "" : "s"} this week`,
    feedStale,
    kpis: [
      { label: "Overdue next actions", value: overdue.length, sub: "in Outreach", tone: overdue.length ? "danger" : "neutral", href: "/outreach" },
      { label: "Closing within 30 days", value: closing.length, sub: "saved opportunities", tone: "neutral", href: "/outreach" },
      { label: "New saved-search matches", value: newMatches, sub: "since your last visit", tone: "neutral", href: "/opportunities" },
      { label: "PI replies to review", value: replies.length, sub: replies.length ? [interested ? `${interested} interested` : null, maybe ? `${maybe} maybe` : null, replies.length - interested - maybe ? `${replies.length - interested - maybe} not now` : null].filter(Boolean).join(" · ") : "none since your last visit", tone: replies.length ? "success" : "neutral", href: "/outreach" },
    ],
    actions,
    closing: closing.slice(0, 8).map(({ r, fo, due }) => {
      const d = daysBetween(due!.date!, today);
      return { id: fo!.id as string, itemId: r.id as string, title: String(fo!.title), meta: [fo!.agency === "National Institutes of Health" ? "NIH" : fo!.agency, fo!.opportunity_number].filter(Boolean).join(" · "), stage: STAGE_LABEL[r.stage as OutreachStage], days: d === 0 ? `Due today · ${fmtMonD(due!.date!)}` : `Due in ${d} day${d === 1 ? "" : "s"} · ${fmtMonD(due!.date!)}`, urgent: d <= 30 };
    }),
    searches: searchesOut,
    replies: repliesOut,
    newThisWeek: { posted: postedWeek ?? 0, matched: newMatches },
  };
}
