/**
 * The office's other business for Discover's overnight strip (`lib/review/overnight-queries.ts`, "Also waiting"):
 * what the old Home listed under "Needs your attention" that is not one of
 * Today's three queues — access requests, a former member's items to
 * reassign, a PI's consult request, overdue next actions on a notice,
 * saved-search hits, a watched forecast that posted, internal deadlines,
 * outcomes left unrecorded — and whether the funding feed is stale.
 *
 * Trimmed to that (2026-09-13): the KPI tiles, "Closing in the next 30
 * days", the saved-search card, the PI-replies card and the greeting went
 * with the old Home, so their reads went too. The per-notice "Tag community"
 * nudge went with the kanban's triage column.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { cycleFactsFromRow, dueDisplay, type CycleColumns } from "@/lib/funding-opportunities/receipt-cycles";
import { loadSavedSearchMatchStats } from "@/lib/funding-opportunities/funding-catalog-cache";
import { liveInstitutionDeadlines } from "@/lib/institution/curated";
import { fetchSavedFundingSearchesForTeam } from "@/lib/funding-opportunities/saved-funding-search-query";
import { fundingListHref } from "@/lib/funding-opportunities/funding-list-url";
import { parseSavedFundingListState } from "@/lib/funding-opportunities/saved-funding-list-state";
import { fmtMonD, fmtMonDYear } from "@/lib/investigators/sources";

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

export type Housekeeping = {
  feedStale: { hours: number; since: string } | null;
  actions: AttentionItem[];
};

const isoToday = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86_400_000);
const shortTitle = (title: unknown) => String(title ?? "").replace(/\s+\((R|U|K|P|F|T|D)\d{2}[^)]*\)\s*$/i, "");

export async function loadHousekeeping(db: SupabaseClient, input: { teamId: string; teamName: string; userId: string; role: "owner" | "admin" | "member"; lastVisitAt: string | null }): Promise<Housekeeping> {
  const today = isoToday();
  const since = input.lastVisitAt ?? new Date(Date.now() - 7 * 86_400_000).toISOString();

  const [{ data: items }, { data: sync }, { data: requests }, { data: former }, { data: watches }, savedSearchesRes, { data: memberRows }] = await Promise.all([
    db
      .from("outreach_items")
      .select("id, stage, owner_id, next_action, next_action_date, created_at, submitted_at, outcome, last_activity_at, funding_opportunities(id, title, agency, agency_code, opportunity_number, activity_code, close_date, next_due, receipt_cycles, cycles_source, standard_dates_apply, expiration_date, forecasted, status, raw_payload_json)")
      .eq("team_id", input.teamId)
      .not("stage", "in", '("outcome","parked")'),
    db.from("sync_job_logs").select("status, started_at, finished_at").eq("job_type", "simpler_grants_sync").order("started_at", { ascending: false }).limit(2),
    input.role === "member" ? Promise.resolve({ data: [] }) : db.from("team_access_requests").select("id, note, requested_at, profiles!user_id(full_name, department)").eq("team_id", input.teamId).eq("status", "pending").order("requested_at"),
    input.role === "member" ? Promise.resolve({ data: [] }) : db.from("team_former_members").select("user_id, full_name, left_at").eq("team_id", input.teamId).gte("left_at", new Date(Date.now() - 30 * 86_400_000).toISOString()),
    db.from("opportunity_watches").select("opportunity_id, funding_opportunities(id, title, forecasted, posted_date, next_due, close_date)").eq("team_id", input.teamId),
    fetchSavedFundingSearchesForTeam(db, input.teamId),
    db.from("team_memberships").select("user_id").eq("team_id", input.teamId),
  ]);
  const savedSearches = savedSearchesRes.rows;

  const rows = (items ?? []) as Array<Record<string, unknown>>;
  const inPlay = rows.map((r) => {
    const fo = (Array.isArray(r.funding_opportunities) ? r.funding_opportunities[0] : r.funding_opportunities) as Record<string, unknown> | null;
    const due = fo ? dueDisplay(cycleFactsFromRow(fo as unknown as CycleColumns), today) : null;
    return { r, fo, due };
  });

  // Recipients for the items in play (the "PIs linked" count on a next action).
  const itemIds = rows.map((r) => r.id as string);
  const { data: recips } = itemIds.length
    ? await db.from("outreach_recipients").select("id, item_id, kind, status").in("item_id", itemIds).is("removed_at", null)
    : { data: [] };
  const recBy = new Map<string, Array<Record<string, unknown>>>();
  for (const x of (recips ?? []) as Array<Record<string, unknown>>) recBy.set(x.item_id as string, [...(recBy.get(x.item_id as string) ?? []), x]);

  // Names in a second read: `team_memberships` has two relationships to
  // `profiles`, so PostgREST refuses the embed and the old read got no names
  // ("Teammate" for every owner).
  const memberIds = ((memberRows ?? []) as Array<{ user_id: string }>).map((m) => m.user_id);
  const profiles = memberIds.length ? await db.from("profiles").select("id, full_name, email").in("id", memberIds) : { data: [] as Array<{ id: string; full_name: string | null; email: string | null }> };
  const memberName = new Map(((profiles.data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map((p) => [p.id, p.full_name?.trim() || p.email || "Teammate"]));
  const ownerLabel = (id: string | null) => (id === input.userId ? "you" : id ? memberName.get(id) ?? "Teammate" : "Unassigned");

  // Feed freshness.
  const syncRows = (sync ?? []) as Array<{ status: string; started_at: string; finished_at: string | null }>;
  const lastOk = syncRows.find((s) => s.status === "success");
  const lastAt = lastOk?.finished_at ?? lastOk?.started_at ?? null;
  const hours = lastAt ? Math.floor((Date.now() - new Date(lastAt).getTime()) / 3_600_000) : null;
  const feedStale = hours != null && hours >= 24 ? { hours, since: fmtMonD(lastAt!) } : null;

  // Saved-search hits since each search was last viewed.
  const searchStats = new Map<string, { newMatches: number; href: string }>();
  await Promise.all(
    savedSearches.slice(0, 8).map(async (sr) => {
      const st = parseSavedFundingListState(sr.state);
      if (!st) return;
      const href = fundingListHref({ ...st, savedSearchId: sr.id }).replace(/^\/funding-opportunities/, "/opportunities");
      try {
        const stats = await loadSavedSearchMatchStats(db, st, { lastViewedAt: sr.last_viewed_at ?? since, includeForecasted: sr.alert_forecasted_notices ?? true });
        searchStats.set(sr.id, { newMatches: stats.newMatchesSinceViewed, href });
      } catch {
        searchStats.set(sr.id, { newMatches: 0, href });
      }
    }),
  );

  // The list, in the old Home's order.
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
    const people = (recBy.get(r.id as string) ?? []).filter((x) => x.kind === "person");
    const interested = people.filter((x) => x.status === "replied_interested").length;
    const meta = [`Owner: ${ownerLabel(r.owner_id as string | null)}`, people.length ? `${people.length} PI${people.length === 1 ? "" : "s"} linked` : null, interested ? `${interested} interested` : null].filter(Boolean).join(" · ");
    const title = `${r.next_action ?? "Next action"} — ${shortTitle(fo?.title)}${fo?.activity_code ? ` (${fo.activity_code})` : ""}`;
    if (d < 0) actions.push({ key: `overdue-${r.id}`, title, meta, when: `Overdue by ${-d} day${d === -1 ? "" : "s"} · ${fmtMonD(String(r.next_action_date))}`, whenTone: "danger", dot: "danger", dotLabel: "Overdue", cta: "Open", href: `/outreach?item=${r.id}` });
    else actions.push({ key: `due-${r.id}`, title, meta, when: d === 0 ? `Due today · ${fmtMonD(String(r.next_action_date))}` : `Due in ${d} day${d === 1 ? "" : "s"} · ${fmtMonD(String(r.next_action_date))}`, whenTone: "neutral", dot: "warning", dotLabel: "Due soon", cta: "Open", href: `/outreach?item=${r.id}` });
  }
  for (const sr of savedSearches) {
    const st = searchStats.get(sr.id);
    const n = st?.newMatches ?? 0;
    if (n > 0) actions.push({ key: `search-${sr.id}`, title: `Saved search “${sr.name}” — ${n} new notice${n === 1 ? "" : "s"} since ${sr.last_viewed_at ? fmtMonD(sr.last_viewed_at) : "your last visit"}`, meta: "Open to review the new matches", when: "New", whenTone: "teal", dot: "teal", dotLabel: "Saved search", cta: "Review", href: st?.href ?? "/opportunities" });
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
  // An investigator asked their strategist about one of their own fit rows
  // (§3h). It is a person waiting on an answer, so it sits above the office's
  // own housekeeping and names who owes it.
  try {
    const { data: consults } = await db
      .from("fit_consult_requests")
      .select("id, created_at, note, strategist_id, verdict_label, investigator_id, investigators(full_name), funding_opportunities(id, title)")
      .eq("team_id", input.teamId)
      .eq("status", "open")
      .order("created_at", { ascending: true })
      .limit(8);
    for (const c of (consults ?? []) as Array<Record<string, unknown>>) {
      const inv = (Array.isArray(c.investigators) ? c.investigators[0] : c.investigators) as { full_name: string | null } | null;
      const fo = (Array.isArray(c.funding_opportunities) ? c.funding_opportunities[0] : c.funding_opportunities) as { id: string; title: string } | null;
      if (!inv || !fo) continue;
      const days = Math.max(0, Math.floor((Date.now() - new Date(String(c.created_at)).getTime()) / 86_400_000));
      const mine = c.strategist_id === input.userId;
      const note = typeof c.note === "string" && c.note.trim() ? ` · “${c.note.trim().slice(0, 70)}${c.note.trim().length > 70 ? "…" : ""}”` : "";
      actions.push({
        key: `consult-${String(c.id)}`,
        title: `${inv.full_name ?? "An investigator"} asked about ${shortTitle(fo.title)}`,
        meta: `${mine ? "Your community" : c.strategist_id ? "Another strategist's community" : "No strategist on the community"}${note}`,
        when: days === 0 ? "Asked today" : `Waiting ${days} day${days === 1 ? "" : "s"}`,
        whenTone: days >= 3 ? "warning" : "teal",
        dot: days >= 3 ? "warning" : "teal",
        dotLabel: "Asked by a PI",
        cta: "Open",
        href: `/investigators/${String((c as { investigator_id?: string }).investigator_id ?? "")}`,
      });
    }
  } catch {
    // fit_consult_requests may not be on an older database
  }
  const { data: submittedRows } = await db.from("outreach_items").select("id, submitted_at").eq("team_id", input.teamId).eq("stage", "submitted").lte("submitted_at", new Date(Date.now() - 14 * 86_400_000).toISOString());
  const submitted = (submittedRows ?? []) as Array<{ id: string; submitted_at: string | null }>;
  if (submitted.length) {
    const oldest = submitted.map((s) => s.submitted_at).filter(Boolean).sort()[0];
    actions.push({ key: "outcomes", title: `Record outcomes — ${submitted.length} item${submitted.length === 1 ? "" : "s"} left Submitted without a result`, meta: "Reports stay empty until outcomes are recorded · Funded / Not funded / Withdrawn", when: oldest ? `Since ${fmtMonD(oldest)}` : "Waiting", whenTone: "warning", dot: "warning", dotLabel: "Needs outcome", cta: "Record", href: "/outreach" });
  }

  return { feedStale, actions };
}
