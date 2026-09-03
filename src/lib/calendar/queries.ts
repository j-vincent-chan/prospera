/**
 * Calendar read model: sponsor deadlines, LOIs, internal (OSR) routing dates
 * and next actions for everything in outreach, plus manual entries.
 * Limited-submission competitions join when the institutional layer lands.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { cycleFactsFromRow, internalRoutingDate, upcomingCycles, type CycleColumns, type RoutingRule } from "@/lib/funding-opportunities/receipt-cycles";
import { STAGE_LABEL, type OutreachStage } from "@/lib/outreach/types";

export type CalendarKind = "sponsor" | "internal" | "loi" | "limited";

export type CalendarEvent = {
  id: string;
  date: string; // YYYY-MM-DD
  kind: CalendarKind;
  /** Short label for the month cell. */
  label: string;
  /** Full title for the list and tooltip. */
  title: string;
  /** Second line in the Next 14 days list. */
  detail: string;
  href: string | null;
  itemId: string | null;
  manual: boolean;
};

export const KIND_LABEL: Record<CalendarKind, string> = { sponsor: "Sponsor deadline", internal: "Internal (OSR) deadline", loi: "LOI", limited: "Limited submission" };

const shortTitle = (t: string) => t.replace(/\s+\((R|U|K|P|F|T|D)\d{2}[^)]*\)\s*$/i, "").replace(/^(Notice of Special Interest|NOSI):?\s*/i, "NOSI: ").slice(0, 60);

export async function loadCalendarEvents(db: SupabaseClient, teamId: string, routing: RoutingRule, range: { from: string; to: string }): Promise<CalendarEvent[]> {
  const [{ data: items }, { data: entries }, { data: members }] = await Promise.all([
    db
      .from("outreach_items")
      .select("id, stage, owner_id, next_action, next_action_date, funding_opportunities(id, title, opportunity_number, agency_code, activity_code, close_date, next_due, receipt_cycles, cycles_source, standard_dates_apply, expiration_date, forecasted, status, loi_due, loi_note, raw_payload_json)")
      .eq("team_id", teamId)
      .not("stage", "in", '("outcome","parked")'),
    db.from("calendar_entries").select("id, title, kind, date, notes, item_id, opportunity_id").eq("team_id", teamId).is("deleted_at", null).gte("date", range.from).lte("date", range.to),
    db.from("team_memberships").select("user_id, profiles(full_name)").eq("team_id", teamId),
  ]);
  const memberName = new Map(((members ?? []) as Array<{ user_id: string; profiles: { full_name: string | null } | { full_name: string | null }[] | null }>).map((m) => [m.user_id, (Array.isArray(m.profiles) ? m.profiles[0] : m.profiles)?.full_name?.trim().split(/\s+/)[0] || "Teammate"]));
  const inRange = (d: string) => d >= range.from && d <= range.to;
  const out: CalendarEvent[] = [];

  for (const raw of (items ?? []) as Array<Record<string, unknown>>) {
    const fo = (Array.isArray(raw.funding_opportunities) ? raw.funding_opportunities[0] : raw.funding_opportunities) as Record<string, unknown> | null;
    if (!fo) continue;
    const stage = STAGE_LABEL[raw.stage as OutreachStage];
    const title = String(fo.title ?? "");
    const facts = cycleFactsFromRow(fo as unknown as CycleColumns);
    const dues = upcomingCycles(facts.cycles, range.from, facts.expirationDate).map((c) => c.due);
    const dueDates = dues.length ? dues : facts.closeDate && !facts.isNih ? [facts.closeDate] : fo.next_due ? [String(fo.next_due)] : [];
    for (const due of dueDates.filter(inRange).slice(0, 3)) {
      out.push({ id: `sponsor-${raw.id}-${due}`, date: due, kind: "sponsor", label: `${shortTitle(title)} due`, title: `${shortTitle(title)} — application due`, detail: `Sponsor deadline · ${stage}`, href: `/opportunities/${fo.id}`, itemId: raw.id as string, manual: false });
      const osr = internalRoutingDate(due, routing);
      if (inRange(osr)) out.push({ id: `osr-${raw.id}-${due}`, date: osr, kind: "internal", label: `OSR: ${shortTitle(title)}`, title: `OSR routing — ${shortTitle(title)}`, detail: `Internal deadline · ${routing.days} ${routing.dayType} day${routing.days === 1 ? "" : "s"} before sponsor`, href: `/outreach?item=${raw.id}`, itemId: raw.id as string, manual: false });
    }
    if (fo.loi_due && inRange(String(fo.loi_due))) out.push({ id: `loi-${raw.id}`, date: String(fo.loi_due), kind: "loi", label: `LOI: ${shortTitle(title)}`, title: `Letter of intent — ${shortTitle(title)}`, detail: `LOI · ${fo.loi_note ? String(fo.loi_note).slice(0, 40) : "see notice"}`, href: `/opportunities/${fo.id}`, itemId: raw.id as string, manual: false });
    if (raw.next_action_date && inRange(String(raw.next_action_date))) {
      const who = raw.owner_id ? memberName.get(String(raw.owner_id)) ?? "Teammate" : "Unassigned";
      out.push({ id: `next-${raw.id}`, date: String(raw.next_action_date), kind: "internal", label: `${String(raw.next_action ?? "Next action")} · ${shortTitle(title).slice(0, 24)}`, title: `${String(raw.next_action ?? "Next action")} — ${shortTitle(title)}`, detail: `Next action · ${who}`, href: `/outreach?item=${raw.id}`, itemId: raw.id as string, manual: false });
    }
  }
  for (const e of (entries ?? []) as Array<{ id: string; title: string; kind: CalendarKind; date: string; notes: string | null; item_id: string | null; opportunity_id: string | null }>) {
    out.push({ id: `manual-${e.id}`, date: e.date, kind: e.kind, label: e.title.slice(0, 48), title: e.title, detail: `${KIND_LABEL[e.kind]}${e.notes ? ` · ${e.notes.slice(0, 60)}` : " · added by the team"}`, href: e.item_id ? `/outreach?item=${e.item_id}` : e.opportunity_id ? `/opportunities/${e.opportunity_id}` : null, itemId: e.item_id, manual: true });
  }
  const order: Record<CalendarKind, number> = { sponsor: 0, limited: 1, loi: 2, internal: 3 };
  return out.sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind]);
}

export function monthRange(month: string): { from: string; to: string; gridFrom: string; gridTo: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const last = new Date(Date.UTC(y, m, 0));
  const gridStart = new Date(first);
  gridStart.setUTCDate(1 - first.getUTCDay());
  const gridEnd = new Date(last);
  gridEnd.setUTCDate(last.getUTCDate() + (6 - last.getUTCDay()));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(first), to: iso(last), gridFrom: iso(gridStart), gridTo: iso(gridEnd) };
}
