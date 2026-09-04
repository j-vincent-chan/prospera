/**
 * Communities v2 read models: the monitored-community selector, one
 * community's overview (brief, open fits, roster, leads, outreach counts,
 * saved searches, themes) and the full roster / fits tabs.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { cycleFactsFromRow, daysBetween, dueDisplay, fmtMonD, type CycleColumns } from "@/lib/funding-opportunities/receipt-cycles";
import { personInitials } from "@/lib/investigators/sources";
import { agencyShortName } from "@/lib/opportunities/list-model";
import { STAGE_TAB_LABEL, STAGES, type OutreachStage } from "@/lib/outreach/types";

export type CommunityOption = { id: string; slug: string; label: string; active: boolean; memberCount: number };

export type CommunityRecord = {
  id: string;
  slug: string;
  label: string;
  mission: string | null;
  focus: string | null;
  keywords: string[];
  populations: string[];
  active: boolean;
  strategist_id: string | null;
  listserv: string | null;
  brief_text: string | null;
  brief_generated_at: string | null;
  brief_model: string | null;
  fits_refreshed_at: string | null;
  updated_at: string;
};
export const COMMUNITY_COLUMNS = "id, slug, label, mission, focus, keywords, populations, active, strategist_id, listserv, brief_text, brief_generated_at, brief_model, fits_refreshed_at, updated_at";

export type RosterRow = { investigatorId: string; name: string; initials: string; dept: string; role: "lead" | "member"; signals: number; signalsLabel: string; fits: number; addedAt: string };
export type FitRow = { opportunityId: string; title: string; meta: string; who: string; whoFull: string; fitCount: number; close: { label: string; urgent: boolean }; closeIso: string | null; cta: { label: string; kind: "stage" | "watching" | "save"; itemId: string | null }; score: number };

export type CommunityOverview = {
  community: CommunityRecord;
  options: CommunityOption[];
  meta: { members: number; leads: number; openFits: number; signals12mo: number };
  brief: { text: string | null; generatedAt: string | null; stale: boolean };
  fits: { rows: FitRow[]; total: number; refreshedAt: string | null; embeddedMembers: number };
  roster: { rows: RosterRow[]; total: number };
  leads: { names: string; strategist: string | null; listserv: string | null };
  outreach: { stages: Array<{ key: OutreachStage; name: string; n: number }>; total: number };
  searches: Array<{ id: string; name: string; newMatches: number; href: string }>;
  themes: Array<{ label: string; n: number; pct: number }>;
  profileComplete: boolean;
};

export async function loadCommunityOptions(db: SupabaseClient): Promise<CommunityOption[]> {
  const [{ data: comms }, { data: members }] = await Promise.all([
    db.from("pipeline_communities").select("id, slug, label, active, monitored, sort_order").eq("monitored", true).order("sort_order"),
    db.from("community_members").select("community_id"),
  ]);
  const counts = new Map<string, number>();
  for (const m of (members ?? []) as Array<{ community_id: string }>) counts.set(m.community_id, (counts.get(m.community_id) ?? 0) + 1);
  return ((comms ?? []) as Array<{ id: string; slug: string; label: string; active: boolean }>).map((c) => ({ id: c.id, slug: c.slug, label: c.label, active: c.active, memberCount: counts.get(c.id) ?? 0 }));
}

const shortTitle = (t: string) => t.replace(/\s+\((R|U|K|P|F|T|D)\d{2}[^)]*\)\s*$/i, "");
const lastName = (full: string) => full.trim().split(/\s+/).slice(-1)[0] ?? full;

type MemberRaw = { investigator_id: string; role: "lead" | "member"; added_at: string; investigators: { id: string; full_name: string; home_department: string | null; division: string | null; archived_at: string | null } | { id: string; full_name: string; home_department: string | null; division: string | null; archived_at: string | null }[] | null };

async function loadMembers(db: SupabaseClient, communityId: string) {
  const { data } = await db.from("community_members").select("investigator_id, role, added_at, investigators(id, full_name, home_department, division, archived_at)").eq("community_id", communityId);
  return ((data ?? []) as unknown as MemberRaw[])
    .map((m) => ({ ...m, inv: (Array.isArray(m.investigators) ? m.investigators[0] : m.investigators) ?? null }))
    .filter((m) => m.inv && !m.inv.archived_at)
    .map((m) => ({ investigatorId: m.investigator_id, role: m.role, addedAt: m.added_at, name: m.inv!.full_name, dept: [m.inv!.home_department, m.inv!.division].filter(Boolean).join(" · ") || "Department not on file" }));
}

/** Signals in the last 12 months per member: publications, competing grants (by fiscal year) and trials. */
async function signalCounts(db: SupabaseClient, investigatorIds: string[], today: string): Promise<{ perMember: Map<string, number>; recentPubTitles: Array<{ investigatorId: string; title: string }> }> {
  const perMember = new Map<string, number>();
  const recentPubTitles: Array<{ investigatorId: string; title: string }> = [];
  if (!investigatorIds.length) return { perMember, recentPubTitles };
  const since = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  const fy = Number(today.slice(0, 4)) + (Number(today.slice(5, 7)) >= 10 ? 1 : 0);
  const [{ data: pubs }, { data: grants }, { data: trials }] = await Promise.all([
    db.from("investigator_publications").select("investigator_id, title, publication_date").in("investigator_id", investigatorIds).gte("publication_date", since).neq("identity_status", "rejected"),
    db.from("investigator_nih_grants").select("investigator_id, fiscal_year").in("investigator_id", investigatorIds).gte("fiscal_year", fy - 1),
    db.from("investigator_clinical_trials").select("investigator_id, last_update_date").in("investigator_id", investigatorIds).gte("last_update_date", since),
  ]);
  const bump = (id: string) => perMember.set(id, (perMember.get(id) ?? 0) + 1);
  for (const p of (pubs ?? []) as Array<{ investigator_id: string; title: string }>) {
    bump(p.investigator_id);
    recentPubTitles.push({ investigatorId: p.investigator_id, title: p.title });
  }
  for (const g of (grants ?? []) as Array<{ investigator_id: string }>) bump(g.investigator_id);
  for (const t of (trials ?? []) as Array<{ investigator_id: string }>) bump(t.investigator_id);
  return { perMember, recentPubTitles };
}

/** Top themes over the last 12 months: members' profile tags that recur in their recent publication titles; falls back to roster tag frequency. */
async function topThemes(db: SupabaseClient, investigatorIds: string[], recentPubTitles: Array<{ investigatorId: string; title: string }>): Promise<Array<{ label: string; n: number; pct: number }>> {
  if (!investigatorIds.length) return [];
  const { data: feats } = await db.from("investigator_profile_features").select("investigator_id, science_tags, disease_tags, method_tags").in("investigator_id", investigatorIds);
  const tagsBy = new Map<string, string[]>();
  for (const f of (feats ?? []) as Array<{ investigator_id: string; science_tags: string[]; disease_tags: string[]; method_tags: string[] }>) tagsBy.set(f.investigator_id, [...(f.science_tags ?? []), ...(f.disease_tags ?? []), ...(f.method_tags ?? [])].map((t) => t.trim().toLowerCase()).filter(Boolean));
  const counts = new Map<string, number>();
  const norm = (s: string) => s.toLowerCase();
  for (const p of recentPubTitles) {
    const title = norm(p.title);
    for (const tag of new Set(tagsBy.get(p.investigatorId) ?? [])) {
      const words = tag.split(/[\s/-]+/).filter((w) => w.length > 3);
      if (!words.length) continue;
      const hits = words.filter((w) => title.includes(w)).length;
      if (hits >= Math.max(1, Math.ceil(words.length / 2))) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  if (counts.size < 3) {
    for (const tags of tagsBy.values()) for (const t of new Set(tags)) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  // No curated tags on file: fall back to recurring phrases in the last 12 months of publication titles.
  if (counts.size < 3 && recentPubTitles.length) {
    const phrases = titlePhrases(recentPubTitles.map((p) => p.title));
    for (const [phrase, n] of phrases) counts.set(phrase, n);
  }
  const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const max = top[0]?.[1] ?? 1;
  return top.map(([label, n]) => ({ label: label.replace(/(^|\s)\S/g, (m) => m.toUpperCase()), n, pct: Math.round((n / max) * 100) }));
}

const TITLE_STOP = new Set(["the", "and", "of", "in", "for", "with", "a", "an", "to", "on", "by", "from", "at", "as", "is", "are", "its", "into", "via", "using", "based", "study", "studies", "analysis", "role", "roles", "effect", "effects", "among", "between", "during", "after", "novel", "new", "human", "patients", "patient", "cells", "cell", "disease", "diseases", "clinical", "trial", "results", "case", "report", "review", "model", "models", "associated", "association", "risk", "data", "approach", "toward", "towards", "versus", "vs", "de", "la", "cohort", "outcomes", "outcome", "adults", "children", "united", "states", "california", "san", "francisco", "response", "responses", "treatment", "therapy", "impact", "evidence", "high", "low", "early", "late", "long", "term", "first", "second", "two", "one", "single", "multi", "large", "small", "national", "randomized", "controlled", "phase", "year", "years", "people", "living", "among", "across", "within", "without", "related", "specific", "general", "potential", "current", "recent", "implications", "insights", "perspective", "perspectives", "update", "overview"]);

/** Top recurring two-word phrases (then single words) across titles. */
export function titlePhrases(titles: string[], top = 4): Array<[string, number]> {
  const bigrams = new Map<string, number>();
  const unigrams = new Map<string, number>();
  for (const t of titles) {
    const words = t.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !TITLE_STOP.has(w) && !/^\d+$/.test(w));
    const seenB = new Set<string>();
    const seenU = new Set<string>();
    for (let i = 0; i < words.length; i += 1) {
      if (!seenU.has(words[i])) {
        seenU.add(words[i]);
        unigrams.set(words[i], (unigrams.get(words[i]) ?? 0) + 1);
      }
      if (i + 1 < words.length) {
        const b = `${words[i]} ${words[i + 1]}`;
        if (!seenB.has(b)) {
          seenB.add(b);
          bigrams.set(b, (bigrams.get(b) ?? 0) + 1);
        }
      }
    }
  }
  const good = Array.from(bigrams.entries()).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, top);
  if (good.length >= top) return good;
  const used = new Set(good.flatMap(([p]) => p.split(" ")));
  const singles = Array.from(unigrams.entries()).filter(([w, n]) => n >= 3 && !used.has(w)).sort((a, b) => b[1] - a[1]).slice(0, top - good.length);
  return [...good, ...singles];
}

export async function loadCommunityOverview(db: SupabaseClient, communityId: string, opts: { teamId: string | null; today: string }): Promise<CommunityOverview | null> {
  const [{ data: rec }, options] = await Promise.all([db.from("pipeline_communities").select(COMMUNITY_COLUMNS).eq("id", communityId).maybeSingle(), loadCommunityOptions(db)]);
  if (!rec) return null;
  const community = rec as CommunityRecord;
  const members = await loadMembers(db, communityId);
  const ids = members.map((m) => m.investigatorId);
  const [{ perMember, recentPubTitles }, { data: fitsRaw }, { count: fitsCount }, { data: embeds }, { data: strategist }, outreach, searches] = await Promise.all([
    signalCounts(db, ids, opts.today),
    db.from("community_fits").select("opportunity_id, investigator_ids, strong_count, potential_count, score, funding_opportunities(id, title, agency, agency_code, opportunity_number, activity_code, close_date, next_due, receipt_cycles, cycles_source, standard_dates_apply, expiration_date, forecasted, status, posted_date, raw_payload_json)").eq("community_id", communityId).order("score", { ascending: false }).limit(60),
    db.from("community_fits").select("opportunity_id", { count: "exact", head: true }).eq("community_id", communityId),
    ids.length ? db.from("investigator_embeddings").select("investigator_id").in("investigator_id", ids) : Promise.resolve({ data: [] }),
    community.strategist_id ? db.from("profiles").select("full_name, email").eq("id", community.strategist_id).maybeSingle() : Promise.resolve({ data: null }),
    loadOutreachCounts(db, communityId, opts.teamId),
    loadCommunitySearches(db, communityId, opts.teamId),
  ]);
  const themes = await topThemes(db, ids, recentPubTitles);

  // Fits table (open notices only; the cache is refreshed nightly and on demand).
  const fitRows: Array<{ raw: Record<string, unknown>; fo: Record<string, unknown> }> = [];
  for (const r of (fitsRaw ?? []) as Array<Record<string, unknown>>) {
    const fo = (Array.isArray(r.funding_opportunities) ? r.funding_opportunities[0] : r.funding_opportunities) as Record<string, unknown> | null;
    if (!fo) continue;
    const due = dueDisplay(cycleFactsFromRow(fo as unknown as CycleColumns), opts.today);
    if (due.tone === "closed") continue;
    fitRows.push({ raw: r, fo });
  }
  const oppIds = fitRows.map((f) => String(f.fo.id));
  const [{ data: items }, { data: watches }] = await Promise.all([
    opts.teamId && oppIds.length ? db.from("outreach_items").select("id, opportunity_id, stage").eq("team_id", opts.teamId).in("opportunity_id", oppIds) : Promise.resolve({ data: [] }),
    opts.teamId && oppIds.length ? db.from("opportunity_watches").select("opportunity_id").eq("team_id", opts.teamId).in("opportunity_id", oppIds) : Promise.resolve({ data: [] }),
  ]);
  const itemBy = new Map(((items ?? []) as Array<{ id: string; opportunity_id: string; stage: OutreachStage }>).map((i) => [i.opportunity_id, i]));
  const watched = new Set(((watches ?? []) as Array<{ opportunity_id: string }>).map((w) => w.opportunity_id));
  const nameBy = new Map(members.map((m) => [m.investigatorId, m.name]));
  const fits: FitRow[] = fitRows.map(({ raw, fo }) => {
    const invIds = (raw.investigator_ids as string[]) ?? [];
    const names = invIds.map((id) => nameBy.get(id)).filter((x): x is string => Boolean(x));
    const due = dueDisplay(cycleFactsFromRow(fo as unknown as CycleColumns), opts.today);
    const forecast = Boolean(fo.forecasted) || due.tone === "forecast";
    const closeIso = due.date ?? null;
    const days = closeIso ? daysBetween(opts.today, closeIso) : null;
    const close = forecast ? { label: closeIso ? `Opens ~${fmtMonD(closeIso, opts.today)}` : "Forecasted", urgent: false } : days != null ? { label: days <= 0 ? `Due today · ${fmtMonD(closeIso!, opts.today)}` : `Due in ${days} day${days === 1 ? "" : "s"}`, urgent: days <= 30 } : { label: due.primary, urgent: false };
    const item = itemBy.get(String(fo.id));
    const cta: FitRow["cta"] = item ? { label: `In ${STAGE_TAB_LABEL[item.stage] ?? item.stage}`, kind: "stage", itemId: item.id } : watched.has(String(fo.id)) ? { label: "Watching", kind: "watching", itemId: null } : { label: "Save", kind: "save", itemId: null };
    const fitCount = invIds.length;
    return {
      opportunityId: String(fo.id),
      title: shortTitle(String(fo.title)),
      meta: `${agencyShortName((fo.agency as string | null) ?? null, (fo.agency_code as string | null) ?? null)}${fo.opportunity_number ? ` · ${String(fo.opportunity_number)}` : ""}${forecast ? " · forecasted" : ""} · ${fitCount} investigator${fitCount === 1 ? "" : "s"} fit`,
      who: names.map(lastName).slice(0, 3).join(" · ") + (names.length > 3 ? ` +${names.length - 3}` : ""),
      whoFull: names.join(", "),
      fitCount,
      close,
      closeIso,
      cta,
      score: Number(raw.score),
    };
  });

  // Roster (sorted: leads first, then signals).
  const fitsPer = new Map<string, number>();
  for (const f of fitRows) for (const id of (f.raw.investigator_ids as string[]) ?? []) fitsPer.set(id, (fitsPer.get(id) ?? 0) + 1);
  const rosterRows: RosterRow[] = members
    .map((m) => {
      const n = perMember.get(m.investigatorId) ?? 0;
      return { investigatorId: m.investigatorId, name: m.name, initials: personInitials(m.name), dept: m.dept, role: m.role, signals: n, signalsLabel: n ? `${n} signal${n === 1 ? "" : "s"}` : "no data", fits: fitsPer.get(m.investigatorId) ?? 0, addedAt: m.addedAt };
    })
    .sort((a, b) => Number(b.role === "lead") - Number(a.role === "lead") || b.signals - a.signals || a.name.localeCompare(b.name));
  const leads = rosterRows.filter((r) => r.role === "lead");
  const signals12mo = Array.from(perMember.values()).reduce((a, b) => a + b, 0);
  const strategistRow = strategist as { full_name: string | null; email: string | null } | null;
  const generatedAt = community.brief_generated_at;
  const stale = Boolean(generatedAt && daysBetween(generatedAt.slice(0, 10), opts.today) > 30);

  return {
    community,
    options,
    meta: { members: members.length, leads: leads.length, openFits: Math.max(fitsCount ?? 0, fits.length), signals12mo },
    brief: { text: community.brief_text, generatedAt, stale },
    fits: { rows: fits, total: Math.max(fitsCount ?? 0, fits.length), refreshedAt: community.fits_refreshed_at, embeddedMembers: (embeds ?? []).length },
    roster: { rows: rosterRows, total: rosterRows.length },
    leads: { names: leads.length ? leads.map((l) => lastName(l.name)).join(" · ") : "Not set", strategist: strategistRow?.full_name?.trim() || strategistRow?.email || null, listserv: community.listserv },
    outreach,
    searches,
    themes,
    profileComplete: Boolean(community.focus?.trim() || community.keywords.length),
  };
}

async function loadOutreachCounts(db: SupabaseClient, communityId: string, teamId: string | null): Promise<CommunityOverview["outreach"]> {
  const stages: Array<{ key: OutreachStage; name: string; n: number }> = STAGES.filter((s) => s !== "parked").map((s) => ({ key: s, name: STAGE_TAB_LABEL[s] ?? s, n: 0 }));
  if (!teamId) return { stages, total: 0 };
  const { data: recs } = await db.from("outreach_recipients").select("item_id, outreach_items!inner(id, team_id, stage)").eq("kind", "community").eq("community_id", communityId).is("removed_at", null).eq("outreach_items.team_id", teamId);
  const seen = new Set<string>();
  for (const r of (recs ?? []) as unknown as Array<{ item_id: string; outreach_items: { stage: OutreachStage } | { stage: OutreachStage }[] | null }>) {
    if (seen.has(r.item_id)) continue;
    seen.add(r.item_id);
    const it = Array.isArray(r.outreach_items) ? r.outreach_items[0] : r.outreach_items;
    const st = stages.find((s) => s.key === it?.stage);
    if (st) st.n += 1;
  }
  return { stages, total: stages.reduce((n, s) => n + s.n, 0) };
}

async function loadCommunitySearches(db: SupabaseClient, communityId: string, teamId: string | null): Promise<CommunityOverview["searches"]> {
  if (!teamId) return [];
  const { data } = await db.from("saved_funding_searches").select("id, name, state, last_viewed_at, alert_forecasted_notices").eq("team_id", teamId).eq("community_id", communityId).order("name");
  const rows = (data ?? []) as Array<{ id: string; name: string; state: unknown; last_viewed_at: string | null; alert_forecasted_notices: boolean | null }>;
  const { getSavedSearchMatchStats } = await import("@/lib/funding-opportunities/funding-search-notification-query");
  const { parseSavedFundingListState } = await import("@/lib/funding-opportunities/saved-funding-list-state");
  const { fundingListHref } = await import("@/lib/funding-opportunities/funding-list-url");
  const out: CommunityOverview["searches"] = [];
  for (const r of rows) {
    const st = parseSavedFundingListState(r.state);
    const href = st ? fundingListHref({ ...st, savedSearchId: r.id }).replace(/^\/funding-opportunities/, "/opportunities") : "/opportunities";
    let n = 0;
    if (st) {
      try {
        n = (await getSavedSearchMatchStats(db, st, { lastViewedAt: r.last_viewed_at, includeForecasted: r.alert_forecasted_notices !== false })).newMatchesSinceViewed;
      } catch {
        n = 0;
      }
    }
    out.push({ id: r.id, name: r.name, newMatches: n, href });
  }
  return out;
}

/** Team saved searches not yet linked to any community (for the "Link a saved search" picker). */
export async function loadLinkableSearches(db: SupabaseClient, teamId: string | null): Promise<Array<{ id: string; name: string; communityId: string | null }>> {
  if (!teamId) return [];
  const { data } = await db.from("saved_funding_searches").select("id, name, community_id").eq("team_id", teamId).order("name");
  return ((data ?? []) as Array<{ id: string; name: string; community_id: string | null }>).map((r) => ({ id: r.id, name: r.name, communityId: r.community_id }));
}

/** Directory search for "Add members": name or department, excluding current roster. */
export async function searchDirectoryForRoster(db: SupabaseClient, q: string, excludeIds: string[], limit = 8): Promise<Array<{ id: string; name: string; dept: string; community: string | null }>> {
  const term = q.trim().replace(/[%_*,()]/g, " ").trim();
  if (term.length < 2) return [];
  const { data } = await db.from("investigators").select("id, full_name, home_department, division, pipeline_communities(label)").is("archived_at", null).or(`full_name.ilike.*${term}*,home_department.ilike.*${term}*`).order("last_name").limit(limit + excludeIds.length);
  return ((data ?? []) as unknown as Array<{ id: string; full_name: string; home_department: string | null; division: string | null; pipeline_communities: { label: string } | { label: string }[] | null }>)
    .filter((r) => !excludeIds.includes(r.id))
    .slice(0, limit)
    .map((r) => ({ id: r.id, name: r.full_name, dept: [r.home_department, r.division].filter(Boolean).join(" · ") || "Department not on file", community: (Array.isArray(r.pipeline_communities) ? r.pipeline_communities[0] : r.pipeline_communities)?.label ?? null }));
}
