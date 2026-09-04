/**
 * Notifications: the personal daily digest and the immediate emails, driven
 * by each person's preference matrix (Settings) and digest time.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendTransactionalTextEmail } from "@/lib/email/send-transactional-text";
import { band, brandAttachments, button, escapeHtml, paragraph, renderEmail, section } from "@/lib/email/team-email-html";
import { cycleFactsFromRow, dueDisplay, type CycleColumns } from "@/lib/funding-opportunities/receipt-cycles";
import { fmtMonD } from "@/lib/investigators/sources";
import { sourceHealth } from "@/lib/data-sources/status";
import { siteUrl } from "@/lib/team/urls";
import type { NotificationEventType } from "@/lib/team/types";

const PT = "America/Los_Angeles";

export function ptParts(now = new Date()): { hour: number; weekday: number; dateKey: string } {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: PT, hour: "numeric", hour12: false, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = Object.fromEntries(f.formatToParts(now).map((p) => [p.type, p.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday ?? "Sun");
  return { hour: Number(parts.hour) % 24, weekday, dateKey: `${parts.year}-${parts.month}-${parts.day}` };
}

type Prefs = Partial<Record<NotificationEventType, { immediate: boolean; digest: boolean }>>;

async function prefsFor(db: SupabaseClient, userIds: string[]): Promise<Map<string, Prefs>> {
  const out = new Map<string, Prefs>();
  if (!userIds.length) return out;
  const { data } = await db.from("notification_preferences").select("user_id, event_type, immediate, digest").in("user_id", userIds);
  for (const r of (data ?? []) as Array<{ user_id: string; event_type: NotificationEventType; immediate: boolean; digest: boolean }>) {
    const p = out.get(r.user_id) ?? {};
    p[r.event_type] = { immediate: r.immediate, digest: r.digest };
    out.set(r.user_id, p);
  }
  return out;
}

export type DigestSection = { title: string; lines: Array<{ text: string; href: string | null; tone?: "danger" | "success" }> };

/** Build the digest for one member: only the sections they opted into, only when there is something to say. */
export async function buildDigest(db: SupabaseClient, user: { id: string; email: string; name: string; teamId: string; teamName: string; role: string; since: string; prefs: Prefs }): Promise<DigestSection[]> {
  const today = new Date().toISOString().slice(0, 10);
  const sections: DigestSection[] = [];
  const on = (k: NotificationEventType) => Boolean(user.prefs[k]?.digest);

  if (on("next_actions_due")) {
    const { data } = await db.from("outreach_items").select("id, next_action, next_action_date, funding_opportunities(title)").eq("team_id", user.teamId).eq("owner_id", user.id).not("stage", "in", '("outcome","parked")').not("next_action_date", "is", null).lte("next_action_date", new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)).order("next_action_date");
    const lines = ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
      const fo = (Array.isArray(r.funding_opportunities) ? r.funding_opportunities[0] : r.funding_opportunities) as { title: string } | null;
      const d = Math.round((new Date(`${r.next_action_date}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000);
      const when = d < 0 ? `Overdue by ${-d} day${d === -1 ? "" : "s"} · ${fmtMonD(String(r.next_action_date))}` : d === 0 ? `Due today` : `Due in ${d} day${d === 1 ? "" : "s"} · ${fmtMonD(String(r.next_action_date))}`;
      return { text: `${r.next_action ?? "Next action"} — ${fo?.title ?? "Opportunity"} · ${when}`, href: `/outreach?item=${r.id}`, tone: d < 0 ? ("danger" as const) : undefined };
    });
    if (lines.length) sections.push({ title: "Your next actions", lines });
  }
  if (on("pi_reply")) {
    const { data } = await db.from("outreach_recipients").select("id, status, replied_at, reply_note, item_id, investigators(full_name), outreach_items!inner(team_id, funding_opportunities(title))").eq("outreach_items.team_id", user.teamId).like("status", "replied_%").gte("replied_at", user.since).order("replied_at", { ascending: false }).limit(20);
    const lines = ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
      const inv = (Array.isArray(r.investigators) ? r.investigators[0] : r.investigators) as { full_name: string } | null;
      const oi = (Array.isArray(r.outreach_items) ? r.outreach_items[0] : r.outreach_items) as { funding_opportunities: { title: string } | { title: string }[] | null } | null;
      const fo = Array.isArray(oi?.funding_opportunities) ? oi?.funding_opportunities[0] : oi?.funding_opportunities;
      const label = r.status === "replied_interested" ? "Interested" : r.status === "replied_maybe" ? "Maybe" : "Not this cycle";
      return { text: `${inv?.full_name ?? "Investigator"} replied ${label} · ${fo?.title ?? "Opportunity"}${r.reply_note ? ` · “${String(r.reply_note).slice(0, 80)}”` : ""}`, href: `/outreach?item=${r.item_id}`, tone: r.status === "replied_interested" ? ("success" as const) : undefined };
    });
    if (lines.length) sections.push({ title: "PI replies", lines });
  }
  if (on("watched_forecasts")) {
    const { data } = await db.from("opportunity_watches").select("opportunity_id, funding_opportunities(title, forecasted, posted_date, next_due, updated_at)").eq("team_id", user.teamId);
    const lines = ((data ?? []) as Array<Record<string, unknown>>).flatMap((w) => {
      const fo = (Array.isArray(w.funding_opportunities) ? w.funding_opportunities[0] : w.funding_opportunities) as Record<string, unknown> | null;
      if (!fo || fo.forecasted || !fo.updated_at || String(fo.updated_at) < user.since) return [];
      return [{ text: `Watched forecast posted — ${fo.title}${fo.next_due ? ` · first due ${fmtMonD(String(fo.next_due))}` : ""}`, href: `/opportunities/${w.opportunity_id}` }];
    });
    if (lines.length) sections.push({ title: "Watched forecasts", lines });
  }
  if (on("saved_search_matches")) {
    const { fetchSavedFundingSearchesForTeam } = await import("@/lib/funding-opportunities/saved-funding-search-query");
    const { getSavedSearchMatchStats } = await import("@/lib/funding-opportunities/funding-search-notification-query");
    const { parseSavedFundingListState } = await import("@/lib/funding-opportunities/saved-funding-list-state");
    const searches = (await fetchSavedFundingSearchesForTeam(db, user.teamId).catch(() => ({ rows: [] }))).rows;
    const lines: DigestSection["lines"] = [];
    for (const s of searches.slice(0, 8)) {
      const state = parseSavedFundingListState(s.state);
      if (!state) continue;
      const stats = await getSavedSearchMatchStats(db, state, { lastViewedAt: user.since, includeForecasted: s.alert_forecasted_notices ?? true }).catch(() => null);
      const n = stats?.newMatchesSinceViewed ?? 0;
      if (n > 0) lines.push({ text: `“${s.name}” — ${n} new notice${n === 1 ? "" : "s"}`, href: "/opportunities" });
    }
    if (lines.length) sections.push({ title: "Saved searches", lines });
  }
  if (on("access_requests") && user.role !== "member") {
    const { data } = await db.from("team_access_requests").select("id, requested_at, profiles(full_name)").eq("team_id", user.teamId).eq("status", "pending");
    const lines = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({ text: `${((Array.isArray(r.profiles) ? r.profiles[0] : r.profiles) as { full_name: string } | null)?.full_name ?? "Someone"} asked to join ${user.teamName} · ${fmtMonD(String(r.requested_at))}`, href: "/team?tab=requests" }));
    if (lines.length) sections.push({ title: "Access requests", lines });
  }
  if (on("data_source_failing") && user.role !== "member") {
    const health = await sourceHealth(db);
    const lines = health.sources.filter((s) => s.status === "failing").map((s) => ({ text: `${s.name} is failing · ${s.coverage}`, href: "/team/data-sources", tone: "danger" as const }));
    if (lines.length) sections.push({ title: "Data sources", lines });
  }

  // Closing soon rides along whenever anything else is in the digest.
  if (sections.length) {
    const { data } = await db.from("outreach_items").select("id, funding_opportunities(id, title, close_date, next_due, receipt_cycles, cycles_source, expiration_date, forecasted, status, agency_code, opportunity_number, raw_payload_json)").eq("team_id", user.teamId).not("stage", "in", '("outcome","parked")');
    const lines = ((data ?? []) as Array<Record<string, unknown>>).flatMap((r) => {
      const fo = (Array.isArray(r.funding_opportunities) ? r.funding_opportunities[0] : r.funding_opportunities) as Record<string, unknown> | null;
      if (!fo) return [];
      const due = dueDisplay(cycleFactsFromRow(fo as unknown as CycleColumns), today);
      if (!due.date || due.date < today) return [];
      const d = Math.round((new Date(`${due.date}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000);
      return d <= 14 ? [{ text: `${fo.title} · ${due.primary}`, href: `/outreach?item=${r.id}`, tone: d <= 7 ? ("danger" as const) : undefined }] : [];
    });
    if (lines.length) sections.push({ title: "Closing in the next 14 days", lines: lines.slice(0, 8) });
  }
  return sections;
}

function digestHtml(input: { name: string; teamName: string; sections: DigestSection[]; dateLine: string }): string {
  const rows = input.sections.map((s) =>
    section(
      `<p style="margin:0 0 8px;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#64748b">${escapeHtml(s.title)}</p>` +
        s.lines.map((l) => `<p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:${l.tone === "danger" ? "#b42318" : l.tone === "success" ? "#1e6b3a" : "#0b1d3a"}">${l.href ? `<a href="${escapeHtml(siteUrl() + l.href)}" style="color:inherit;text-decoration:none">${escapeHtml(l.text)}</a>` : escapeHtml(l.text)}</p>`).join(""),
    ),
  );
  return renderEmail({
    siteUrl: siteUrl(),
    preheader: input.sections.map((s) => `${s.title}: ${s.lines.length}`).join(" · "),
    headerMeta: `Daily digest · ${input.dateLine}`,
    rows: [
      band({ label: input.teamName, title: `Good morning, ${escapeHtml(input.name.split(/\s+/)[0] ?? "")}`, subtitle: `${input.sections.reduce((n, s) => n + s.lines.length, 0)} things to look at today` }),
      ...rows,
      section(`${button({ href: `${siteUrl()}/home`, label: "Open Home" })}<div style="margin-top:12px">${paragraph("You get this digest at the time set in Settings → Notifications. Turn sections off there, or switch any of them to immediate emails.", { muted: true, size: 13 })}</div>`),
    ],
  });
}

export type DigestRunResult = { considered: number; sent: number; skippedEmpty: number; failed: number };

/** Hourly: send the digest to everyone whose digest hour is now in Pacific time and who hasn't had one today. */
/**
 * `window: "hour"` sends to members whose digest hour is now (an hourly cron);
 * `window: "day"` sends to everyone not yet sent today (a once-a-day cron —
 * Vercel's Hobby plan allows daily crons only, so production runs at 8 AM PT).
 */
export async function runDigests(db: SupabaseClient, now = new Date(), opts: { window?: "hour" | "day" } = {}): Promise<DigestRunResult> {
  const { hour, weekday, dateKey } = ptParts(now);
  const window = opts.window ?? "hour";
  const result: DigestRunResult = { considered: 0, sent: 0, skippedEmpty: 0, failed: 0 };
  const { data: profiles } = await db.from("profiles").select("id, email, full_name, current_team_id, digest_time, digest_weekdays_only, last_digest_sent_at").not("current_team_id", "is", null).not("email", "is", null);
  const rows = (profiles ?? []) as Array<{ id: string; email: string; full_name: string | null; current_team_id: string; digest_time: string; digest_weekdays_only: boolean; last_digest_sent_at: string | null }>;
  const due = rows.filter((p) => (window === "day" || Number(p.digest_time.split(":")[0]) === hour) && (!p.digest_weekdays_only || (weekday >= 1 && weekday <= 5)) && (!p.last_digest_sent_at || ptParts(new Date(p.last_digest_sent_at)).dateKey !== dateKey));
  if (!due.length) return result;
  const prefs = await prefsFor(db, due.map((p) => p.id));
  const { data: teams } = await db.from("teams").select("id, name").in("id", Array.from(new Set(due.map((p) => p.current_team_id))));
  const teamName = new Map(((teams ?? []) as Array<{ id: string; name: string }>).map((t) => [t.id, t.name]));
  const { data: memberships } = await db.from("team_memberships").select("user_id, team_id, role").in("user_id", due.map((p) => p.id));
  const roleOf = new Map(((memberships ?? []) as Array<{ user_id: string; team_id: string; role: string }>).map((m) => [`${m.user_id}:${m.team_id}`, m.role]));

  for (const p of due) {
    const userPrefs = prefs.get(p.id) ?? {};
    if (!Object.values(userPrefs).some((v) => v?.digest)) continue;
    result.considered += 1;
    const since = p.last_digest_sent_at ?? new Date(now.getTime() - 24 * 3_600_000).toISOString();
    try {
      const sections = await buildDigest(db, { id: p.id, email: p.email, name: p.full_name?.trim() || p.email, teamId: p.current_team_id, teamName: teamName.get(p.current_team_id) ?? "your team", role: roleOf.get(`${p.id}:${p.current_team_id}`) ?? "member", since, prefs: userPrefs });
      if (!sections.length) {
        result.skippedEmpty += 1;
        await db.from("profiles").update({ last_digest_sent_at: now.toISOString() }).eq("id", p.id);
        continue;
      }
      const dateLine = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: PT }).format(now);
      const res = await sendTransactionalTextEmail({
        to: p.email,
        subject: `Prospera digest · ${dateLine} · ${sections.reduce((n, s) => n + s.lines.length, 0)} items`,
        html: digestHtml({ name: p.full_name?.trim() || "there", teamName: teamName.get(p.current_team_id) ?? "Prospera", sections, dateLine }),
        attachments: brandAttachments(),
        text: sections.map((s) => `${s.title.toUpperCase()}\n${s.lines.map((l) => `- ${l.text}${l.href ? ` ${siteUrl()}${l.href}` : ""}`).join("\n")}`).join("\n\n"),
      });
      if (res.ok) {
        result.sent += 1;
        await db.from("profiles").update({ last_digest_sent_at: now.toISOString() }).eq("id", p.id);
      } else result.failed += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}

/** Immediate email to members who opted in for one event type; sent once per key. */
export async function notifyImmediate(db: SupabaseClient, input: { teamId: string; eventType: NotificationEventType; key: string; subject: string; text: string; href: string; adminsOnly?: boolean; excludeUserId?: string | null }): Promise<number> {
  const { data: members } = await db.from("team_memberships").select("user_id, role, profiles(email, full_name)").eq("team_id", input.teamId);
  const rows = ((members ?? []) as Array<{ user_id: string; role: string; profiles: { email: string | null; full_name: string | null } | { email: string | null; full_name: string | null }[] | null }>).filter((m) => !input.adminsOnly || m.role !== "member").filter((m) => m.user_id !== input.excludeUserId);
  const prefs = await prefsFor(db, rows.map((m) => m.user_id));
  let sent = 0;
  for (const m of rows) {
    if (!prefs.get(m.user_id)?.[input.eventType]?.immediate) continue;
    const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    if (!p?.email) continue;
    const { error } = await db.from("notification_log").insert({ user_id: m.user_id, key: input.key });
    if (error) continue; // already sent
    const res = await sendTransactionalTextEmail({
      to: p.email,
      subject: input.subject,
      text: `${input.text}\n\n${siteUrl()}${input.href}`,
      html: renderEmail({ siteUrl: siteUrl(), preheader: input.text.slice(0, 120), headerMeta: "Prospera notification", rows: [section(`${paragraph(escapeHtml(input.text))}<div style="margin-top:14px">${button({ href: `${siteUrl()}${input.href}`, label: "Open in Prospera" })}</div>`)] }),
      attachments: brandAttachments(),
    });
    if (res.ok) sent += 1;
  }
  return sent;
}

/** Owners and admins hear once per failing episode of a source. */
export async function notifyFailingSources(db: SupabaseClient): Promise<number> {
  const health = await sourceHealth(db);
  const failing = health.sources.filter((s) => s.status === "failing");
  if (!failing.length) return 0;
  const { data: teams } = await db.from("teams").select("id, name").is("archived_at", null);
  let sent = 0;
  for (const t of (teams ?? []) as Array<{ id: string; name: string }>) {
    for (const s of failing) {
      const stamp = health.runs.find((r) => r.what.startsWith(s.name) && r.result === "Failed")?.id ?? new Date().toISOString().slice(0, 10);
      sent += await notifyImmediate(db, { teamId: t.id, eventType: "data_source_failing", key: `data_source_failing:${s.key}:${stamp}`, subject: `${s.name} is failing`, text: `${s.name} has failed twice in a row. ${s.coverage}. New notices and deadline changes may be missing until it recovers.`, href: "/team/data-sources", adminsOnly: true });
    }
  }
  return sent;
}
