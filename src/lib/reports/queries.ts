/**
 * Reports: what the office surfaced, pursued and won in a period.
 * Every number here comes from outreach items and their messages, replies and
 * recorded outcomes — which is why Home nudges for outcomes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { OUTCOME_LABEL, type Outcome } from "@/lib/outreach/types";

export type ReportPeriod = "fy_to_date" | "last_quarter" | "previous_fy";

export type ReportsData = {
  periodLabel: string;
  range: { from: string; to: string };
  funnel: Array<{ n: number; label: string; sub: string; height: number; color: string }>;
  outcomes: Array<{ id: string; title: string; meta: string; status: string; tone: "success" | "neutral" | "danger" | "warning"; amount: string }>;
  byCommunity: Array<{ id: string; name: string; outreach: number; submitted: number; funded: number }>;
  responsiveness: { postedToTriaged: string; replyRate: string; leadTime: string };
  needsOutcomes: number;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** UCSF fiscal years run Jul 1 – Jun 30; FY27 starts Jul 1, 2026. */
export function periodRange(period: ReportPeriod, now = new Date()): { from: string; to: string; label: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const fy = m >= 6 ? y + 1 : y;
  const fyStart = new Date(Date.UTC(fy - 1, 6, 1));
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  if (period === "previous_fy") {
    const from = iso(new Date(Date.UTC(fy - 2, 6, 1)));
    const to = iso(new Date(Date.UTC(fy - 1, 5, 30)));
    return { from, to, label: `FY${String(fy - 1).slice(-2)} (${fmt(from)}, ${fy - 2} – ${fmt(to)}, ${fy - 1})` };
  }
  if (period === "last_quarter") {
    const q = Math.floor(m / 3);
    const start = new Date(Date.UTC(y, (q - 1) * 3, 1));
    const end = new Date(Date.UTC(y, q * 3, 0));
    return { from: iso(start), to: iso(end), label: `Last quarter (${fmt(iso(start))} – ${fmt(iso(end))})` };
  }
  return { from: iso(fyStart), to: iso(now), label: `FY${String(fy).slice(-2)} to date (${fmt(iso(fyStart))} – ${fmt(iso(now))})` };
}

function money(n: number): string {
  if (!n) return "—";
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `$${Math.round(n / 1000)}K` : `$${Math.round(n)}`;
}

export async function loadReports(db: SupabaseClient, teamId: string, period: ReportPeriod, communityId: string | null): Promise<ReportsData> {
  const { from, to, label } = periodRange(period);
  const fromTs = `${from}T00:00:00Z`;
  const toTs = `${to}T23:59:59Z`;
  const [{ data: items }, { data: communities }, { count: postedInPeriod }] = await Promise.all([
    db
      .from("outreach_items")
      .select("id, stage, outcome, outcome_amount, outcome_at, submitted_at, created_at, funding_opportunities(id, title, agency, opportunity_number, activity_code, posted_date, next_due, close_date, nih_ic_tokens)")
      .eq("team_id", teamId),
    db.from("pipeline_communities").select("id, label").order("sort_order"),
    db.from("funding_opportunities").select("id", { count: "exact", head: true }).gte("posted_date", from).lte("posted_date", to),
  ]);
  const rows = (items ?? []) as Array<Record<string, unknown>>;
  const itemIds = rows.map((r) => r.id as string);
  const [{ data: recips }, { data: sends }, { data: touched }] = await Promise.all([
    itemIds.length ? db.from("outreach_recipients").select("item_id, kind, community_id, investigator_id, status, contacted_at, replied_at, investigators(full_name)").in("item_id", itemIds).is("removed_at", null) : Promise.resolve({ data: [] }),
    itemIds.length ? db.from("outreach_message_recipients").select("investigator_id, sent_at, outreach_messages!inner(item_id, team_id)").eq("outreach_messages.team_id", teamId).eq("status", "sent").gte("sent_at", fromTs).lte("sent_at", toTs) : Promise.resolve({ data: [] }),
    db.from("dismissed_funding_opportunities").select("opportunity_id, created_at").eq("team_id", teamId).gte("created_at", fromTs).lte("created_at", toTs),
  ]);
  const recBy = new Map<string, Array<Record<string, unknown>>>();
  for (const r of (recips ?? []) as Array<Record<string, unknown>>) recBy.set(r.item_id as string, [...(recBy.get(r.item_id as string) ?? []), r]);
  const sendRows = (sends ?? []) as Array<{ investigator_id: string | null; sent_at: string; outreach_messages: { item_id: string } | { item_id: string }[] }>;
  const sentItems = new Set(sendRows.map((s) => (Array.isArray(s.outreach_messages) ? s.outreach_messages[0] : s.outreach_messages)?.item_id).filter(Boolean));
  const sentPeople = new Set(sendRows.map((s) => s.investigator_id).filter(Boolean));

  const fo = (r: Record<string, unknown>) => (Array.isArray(r.funding_opportunities) ? r.funding_opportunities[0] : r.funding_opportunities) as Record<string, unknown> | null;
  const inCommunity = (r: Record<string, unknown>) => !communityId || (recBy.get(r.id as string) ?? []).some((x) => x.kind === "community" && x.community_id === communityId);
  const scoped = rows.filter(inCommunity);

  const triaged = scoped.filter((r) => String(r.created_at) >= fromTs && String(r.created_at) <= toTs);
  const outreach = scoped.filter((r) => sentItems.has(r.id as string));
  const submitted = scoped.filter((r) => r.submitted_at && String(r.submitted_at) >= fromTs && String(r.submitted_at) <= toTs);
  const funded = scoped.filter((r) => r.outcome === "funded" && r.outcome_at && String(r.outcome_at) >= fromTs && String(r.outcome_at) <= toTs);
  const fundedTotal = funded.reduce((n, r) => n + (Number(r.outcome_amount) || 0), 0);
  const surfaced = (postedInPeriod ?? 0) > 0 ? (touched ?? []).length + triaged.length : triaged.length;
  const codes = new Map<string, number>();
  for (const r of submitted) {
    const c = String(fo(r)?.activity_code ?? "other");
    codes.set(c, (codes.get(c) ?? 0) + 1);
  }
  const max = Math.max(surfaced, 1);
  const h = (n: number) => Math.max(14, Math.round((n / max) * 120));
  const funnel = [
    { n: surfaced, label: "Surfaced", sub: "saved, watched or dismissed in the period", height: h(surfaced), color: "#e2e8f0" },
    { n: triaged.length, label: "Triaged", sub: "saved to outreach", height: h(triaged.length), color: "#cbd5e1" },
    { n: outreach.length, label: "Outreach sent", sub: `to ${sentPeople.size} investigator${sentPeople.size === 1 ? "" : "s"}`, height: h(outreach.length), color: "#9fd3d9" },
    { n: submitted.length, label: "Submitted", sub: codes.size ? Array.from(codes.entries()).map(([c, n]) => `${n} ${c}`).join(" · ") : "record submissions in Outreach", height: h(submitted.length), color: "#0e6b78" },
    { n: funded.length, label: "Funded", sub: fundedTotal ? `${money(fundedTotal)} total costs` : "amounts recorded with outcomes", height: h(funded.length), color: "#0b1d3a" },
  ];

  const tone: Record<Outcome, "success" | "neutral" | "danger" | "warning"> = { funded: "success", pending: "neutral", not_funded: "danger", withdrawn: "warning", not_submitted: "warning" };
  const outcomes = scoped
    .filter((r) => (r.stage === "submitted" || r.stage === "outcome") && ((r.submitted_at && String(r.submitted_at) >= fromTs && String(r.submitted_at) <= toTs) || (r.outcome_at && String(r.outcome_at) >= fromTs && String(r.outcome_at) <= toTs)))
    .sort((a, b) => (String(a.submitted_at ?? a.outcome_at) < String(b.submitted_at ?? b.outcome_at) ? 1 : -1))
    .map((r) => {
      const f = fo(r);
      const recs = recBy.get(r.id as string) ?? [];
      const pi = recs.find((x) => x.status === "replied_interested") ?? recs.find((x) => x.kind === "person");
      const piName = ((Array.isArray(pi?.investigators) ? pi?.investigators[0] : pi?.investigators) as { full_name?: string } | null)?.full_name?.split(/\s+/).slice(-1)[0];
      const ic = Array.isArray(f?.nih_ic_tokens) ? (f!.nih_ic_tokens as string[])[0] : null;
      const status = r.outcome ? OUTCOME_LABEL[r.outcome as Outcome] : "Pending";
      return { id: r.id as string, title: `${String(f?.title ?? "").replace(/\s+\((R|U|K|P|F|T|D)\d{2}[^)]*\)\s*$/i, "")}${f?.activity_code ? ` (${f.activity_code})` : ""}`, meta: [piName, ic, r.submitted_at ? `submitted ${new Date(String(r.submitted_at)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}` : r.outcome_at ? `${status.toLowerCase()} ${new Date(String(r.outcome_at)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}` : null].filter(Boolean).join(" · "), status, tone: r.outcome ? tone[r.outcome as Outcome] : "neutral", amount: money(Number(r.outcome_amount) || 0) };
    });

  const byCommunity = ((communities ?? []) as Array<{ id: string; label: string }>).map((c) => {
    const mine = rows.filter((r) => (recBy.get(r.id as string) ?? []).some((x) => x.kind === "community" && x.community_id === c.id));
    return { id: c.id, name: c.label, outreach: mine.filter((r) => sentItems.has(r.id as string)).length, submitted: mine.filter((r) => submitted.includes(r)).length, funded: mine.filter((r) => funded.includes(r)).length };
  });

  const lags = triaged.map((r) => (fo(r)?.posted_date ? (new Date(String(r.created_at)).getTime() - new Date(`${fo(r)!.posted_date}T00:00:00Z`).getTime()) / 86_400_000 : null)).filter((x): x is number => x != null && x >= 0).sort((a, b) => a - b);
  const median = lags.length ? lags[Math.floor(lags.length / 2)]! : null;
  const contacted = ((recips ?? []) as Array<Record<string, unknown>>).filter((x) => x.kind === "person" && x.status !== "selected" && x.contacted_at && String(x.contacted_at) >= fromTs && String(x.contacted_at) <= toTs);
  const replied = contacted.filter((x) => String(x.status).startsWith("replied_") || x.status === "declined");
  const leads = sendRows.map((s) => {
    const item = rows.find((r) => r.id === (Array.isArray(s.outreach_messages) ? s.outreach_messages[0] : s.outreach_messages)?.item_id);
    const due = item ? (fo(item)?.next_due ?? fo(item)?.close_date) : null;
    return due ? (new Date(`${due}T00:00:00Z`).getTime() - new Date(s.sent_at).getTime()) / 86_400_000 : null;
  }).filter((x): x is number => x != null && x > 0);
  const lead = leads.length ? leads.reduce((a, b) => a + b, 0) / leads.length : null;

  return {
    periodLabel: label,
    range: { from, to },
    funnel,
    outcomes,
    byCommunity,
    responsiveness: { postedToTriaged: median != null ? `${median.toFixed(1)} d` : "—", replyRate: contacted.length ? `${Math.round((replied.length / contacted.length) * 100)}%` : "—", leadTime: lead != null ? `${Math.round(lead)} d` : "—" },
    needsOutcomes: rows.filter((r) => r.stage === "submitted").length,
  };
}
