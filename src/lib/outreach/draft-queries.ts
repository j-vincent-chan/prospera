/**
 * Message — Draft outreach (README §6): the loader behind `/outreach/draft`.
 *
 * The draft set is every match that is **Ready to send** on the team's board
 * — a person on an open notice with no message yet — plus, when the link
 * names one, a single contacted match for a follow-up. For each, the four
 * beats are composed by `beats.ts` from what the notice and the match hold:
 *
 *   - the notice's own facts and its fit profile (award, period, the Guide
 *     section they were read from, the constraints, the routing date);
 *   - the match's first cited evidence item, from `fit_results` when the
 *     engine has assessed the pair, else from the item's suggestion snapshot
 *     (the legacy engine's reasons), else nothing — and the beat says so;
 *   - the team's closing line and signature.
 *
 * A saved draft (`outreach_items.draft`, the Compose tab's own column) wins
 * over the composed text, so the strategist's edits survive a reload.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadTeamFitEngine } from "@/lib/fit/flag";
import type { OutreachEmailCard } from "@/lib/email/outreach-email-html";
import type { OpportunityFitProfile } from "@/lib/fit/types";
import { loadNoticeProfiles } from "@/lib/fit/verdict-profiles";
import { normalizeAgencyDisplayName } from "@/lib/funding-opportunities/agency-display";
import { loadNoticeFit } from "@/lib/funding-opportunities/notice-fit";
import { cycleFactsFromRow, dueDisplay, internalRoutingDate, isNihNotice, type RoutingRule } from "@/lib/funding-opportunities/receipt-cycles";
import { evidenceBeat, knowBeat, nextBeat, relevantBeat, sharpBeat, shortTitleOf, subjectOf, yearOf, type Beat, type BeatEvidence, type BeatNotice } from "@/lib/outreach/beats";
import { DEFAULT_PERSONAL_LINE, signoffOf } from "@/lib/outreach/draft";
import { CARD_COLUMNS, noticeCardOf, type CardRow } from "@/lib/outreach/email-card";
import { loadRecipientCommunities } from "@/lib/outreach/recipient-community";
import type { SuggestionReason } from "@/lib/outreach/types";
import { categoryDisplay, sortedWeights } from "@/lib/fit/inspect/labels";

const MISSING_COLUMN = /could not find the .*column|column .* does not exist|schema cache/i;

export type WhyYouAlt = "evidence" | "sharp";

export type DraftRecipient = {
  /** The `outreach_recipients` row — the match. */
  id: string;
  itemId: string;
  opportunityId: string;
  investigatorId: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string | null;
  dept: string | null;
  /** The research community the email's footer names for this person ("ImmunoX"); null names none. */
  community: string | null;
  /** A contacted match named by the link: the message is a follow-up, not a first note. */
  followUp: boolean;
  contactedAt: string | null;
  noticeNumber: string | null;
  noticeTitle: string;
  /** "Why you": the evidence-led line and, when the notice's profile can say it, the sharper one. */
  whyYou: { evidence: Beat; sharp: Beat | null };
  /** The saved "why you" text and variant, when a draft was saved with this person in it. */
  savedHook: string | null;
  savedAlt: WhyYouAlt | null;
};

export type DraftNoticeGroup = {
  itemId: string;
  opportunityId: string;
  number: string | null;
  title: string;
  href: string;
  subject: string;
  /** Beats 1, 3 and 4 — one text per notice; the saved draft's text when there is one, the composed source label always. */
  beats: { relevant: Beat; know: Beat; next: Beat };
  /** The notice card the HTML email shows; the Draft page previews it, the send action loads the same card server-side. */
  card: OutreachEmailCard;
  savedAt: string | null;
};

export type DraftSet = {
  recipients: DraftRecipient[];
  notices: DraftNoticeGroup[];
  sender: { name: string; title: string | null; signoff: string };
  team: { name: string; fromAddress: string | null; replyTo: string | null; perInvestigatorLimit: number; sendingIdentity: string | null; sendingAddress: string | null };
  /** `teams.outreach_closing_line`, null for the default; `closingAvailable` is false before its migration. */
  closingLine: string | null;
  closingAvailable: boolean;
};

type SavedDraft = { subject?: string; body?: string; mode?: "one" | "personalized"; to?: string[]; hooks?: Record<string, string>; beats?: { relevant?: string; know?: string; next?: string }; alt?: Record<string, WhyYouAlt> };

type ItemRow = {
  id: string;
  opportunity_id: string;
  stage: string;
  draft: SavedDraft | null;
  draft_saved_at: string | null;
  funding_opportunities: (CardRow & { loi_due: string | null; loi_note: string | null }) | Array<CardRow & { loi_due: string | null; loi_note: string | null }> | null;
};

type RecipientRow = {
  id: string;
  item_id: string;
  investigator_id: string | null;
  status: string;
  contacted_at: string | null;
  hook: string | null;
  investigators: { full_name: string; last_name: string | null; email: string | null; home_department: string | null; do_not_contact_at: string | null; research_community_id: string | null } | Array<{ full_name: string; last_name: string | null; email: string | null; home_department: string | null; do_not_contact_at: string | null; research_community_id: string | null }> | null;
};

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
const lastNameOf = (full: string, last: string | null): string => last?.trim() || full.trim().split(/\s+/).slice(-1)[0] || full;
const firstNameOf = (full: string): string => full.trim().split(/\s+/)[0] || full;

/** `teams.outreach_closing_line`, null for the default (and null before the column exists). */
export async function loadClosingLine(db: SupabaseClient, teamId: string): Promise<string | null> {
  const { data, error } = await db.from("teams").select("outreach_closing_line").eq("id", teamId).maybeSingle();
  if (error) return null;
  return (data as { outreach_closing_line?: string | null } | null)?.outreach_closing_line?.trim() || null;
}

/** The first real evidence item a rationale cites — a resolved title that is evidence, not a prior. */
function firstEvidence(refs: ReadonlyArray<{ kind: string; title: string; meta: string | null; resolved: boolean; prior: boolean }>): BeatEvidence | null {
  const pick = refs.find((r) => r.resolved && !r.prior) ?? refs.find((r) => r.resolved) ?? null;
  if (!pick) return null;
  const kind: BeatEvidence["kind"] = pick.kind === "publication" || pick.kind === "grant" || pick.kind === "trial" || pick.kind === "biosketch" || pick.kind === "profiles" ? pick.kind : "other";
  return { kind, title: pick.title, meta: pick.meta, year: yearOf(pick.meta) };
}

/** The legacy engine's strongest reason as an evidence item: its source names the kind, its quote the title. */
function evidenceFromReason(r: SuggestionReason | undefined): BeatEvidence | null {
  if (!r) return null;
  const quoted = r.text.match(/“([^”]+)”/)?.[1] ?? r.title ?? null;
  if (r.source.startsWith("PubMed")) return { kind: "publication", title: quoted ?? "your recent paper", meta: r.source.replace(/^PubMed\s*·\s*/, "") || null, year: yearOf(r.source) };
  if (r.source.startsWith("RePORTER")) return { kind: "grant", title: quoted ?? "", meta: r.source.replace(/^RePORTER\s*·\s*/, "") || null, year: yearOf(r.source) };
  if (r.source.startsWith("Biosketch")) return { kind: "biosketch", title: quoted ?? "", meta: null, year: null };
  if (r.source.startsWith("Profiles")) return { kind: "profiles", title: quoted ?? "", meta: null, year: null };
  return null;
}

/** The research approaches the profile requires (all of `required`, any of `required_any`), as labels, best-weighted first. */
function requiredApproachesOf(profile: OpportunityFitProfile | null): string[] {
  if (!profile) return [];
  const ids = [...sortedWeights(profile.paradigm.required), ...sortedWeights(profile.paradigm.required_any)].map((w) => w.id);
  return Array.from(new Set(ids)).map((id) => categoryDisplay("paradigm", id).label);
}

export async function loadDraftSet(
  db: SupabaseClient,
  opts: { teamId: string; viewer: { id: string | null; name: string; title: string | null }; routing: RoutingRule | null; today: string; itemId?: string | null; matchId?: string | null },
): Promise<DraftSet> {
  const { teamId, today } = opts;
  const FO = `${CARD_COLUMNS}, loi_due, loi_note`;
  let itemsQ = db.from("outreach_items").select(`id, opportunity_id, stage, draft, draft_saved_at, funding_opportunities(${FO})`).eq("team_id", teamId).neq("stage", "parked");
  if (opts.itemId) itemsQ = itemsQ.eq("id", opts.itemId);
  const readTeam = (cols: string) => db.from("teams").select(cols).eq("id", teamId).maybeSingle();
  const [items, teamRead, fitEngine] = await Promise.all([itemsQ, readTeam("name, signature, reply_to_email, per_investigator_limit, sending_identity, sending_address, outreach_closing_line"), loadTeamFitEngine(db, teamId)]);
  if (items.error) throw new Error(`outreach_items: ${items.error.message}`);
  let closingAvailable = true;
  let team = teamRead;
  if (team.error && MISSING_COLUMN.test(team.error.message)) {
    closingAvailable = false;
    team = await readTeam("name, signature, reply_to_email, per_investigator_limit, sending_identity, sending_address");
  }
  const t = ((team.data ?? {}) as { name?: string; signature?: string | null; reply_to_email?: string | null; per_investigator_limit?: number; sending_identity?: string | null; sending_address?: string | null; outreach_closing_line?: string | null });
  const closingLine = t.outreach_closing_line?.trim() || null;
  const sender = { name: opts.viewer.name, title: opts.viewer.title, signoff: signoffOf({ name: opts.viewer.name, title: opts.viewer.title, signature: t.signature ?? null }) };
  const teamOut = { name: t.name ?? "Team", fromAddress: (process.env.RESEND_FROM_EMAIL ?? "").replace(/^.*<([^>]+)>.*$/, "$1") || null, replyTo: t.reply_to_email ?? null, perInvestigatorLimit: t.per_investigator_limit ?? 2, sendingIdentity: t.sending_identity ?? null, sendingAddress: t.sending_address ?? null };
  const empty: DraftSet = { recipients: [], notices: [], sender, team: teamOut, closingLine, closingAvailable };

  const itemRows = (items.data ?? []) as ItemRow[];
  if (!itemRows.length) return empty;
  const itemIds = itemRows.map((i) => i.id);

  const recips = await db
    .from("outreach_recipients")
    .select("id, item_id, investigator_id, status, contacted_at, hook, investigators(full_name, last_name, email, home_department, do_not_contact_at, research_community_id)")
    .in("item_id", itemIds)
    .eq("kind", "person")
    .is("removed_at", null);
  if (recips.error) throw new Error(`outreach_recipients: ${recips.error.message}`);
  const wanted = ((recips.data ?? []) as RecipientRow[]).filter((r) => {
    const inv = one(r.investigators);
    if (!inv || !r.investigator_id) return false;
    if (r.id === opts.matchId) return r.status !== "declined";
    return r.status === "selected" && !inv.do_not_contact_at;
  });
  if (!wanted.length) return empty;

  const usedItems = itemRows.filter((i) => wanted.some((r) => r.item_id === i.id));
  const oppIds = Array.from(new Set(usedItems.map((i) => i.opportunity_id)));
  const [profiles, overlays, suggestions, fits, communities] = await Promise.all([
    loadNoticeProfiles(db, oppIds),
    db.from("limited_submission_overlays").select("opportunity_id, cap").in("opportunity_id", oppIds).eq("status", "published").is("deleted_at", null),
    db.from("outreach_suggestions").select("item_id, investigator_id, reasons").in("item_id", usedItems.map((i) => i.id)),
    fitEngine === "fit-v1"
      ? Promise.all(oppIds.map((id) => loadNoticeFit(db, { opportunityId: id, statusBucket: "open", fitEngine, limit: 500, audience: "strategist", mode: "summary" }).then((f) => [id, f] as const).catch(() => [id, null] as const)))
      : Promise.resolve([] as ReadonlyArray<readonly [string, Awaited<ReturnType<typeof loadNoticeFit>> | null]>),
    loadRecipientCommunities(db, {
      investigators: wanted.flatMap((r) => (r.investigator_id ? [{ id: r.investigator_id, primaryCommunityId: one(r.investigators)?.research_community_id ?? null }] : [])),
      communityIds: [],
      senderId: opts.viewer.id,
    }),
  ]);
  const capBy = new Map<string, number | null>();
  const limited = new Set<string>();
  for (const o of (overlays.data ?? []) as Array<{ opportunity_id: string; cap: number | null }>) {
    limited.add(o.opportunity_id);
    capBy.set(o.opportunity_id, o.cap);
  }
  const reasonBy = new Map<string, SuggestionReason[]>();
  for (const s of (suggestions.data ?? []) as Array<{ item_id: string; investigator_id: string; reasons: SuggestionReason[] | null }>) reasonBy.set(`${s.item_id}:${s.investigator_id}`, s.reasons ?? []);
  const fitBy = new Map<string, BeatEvidence | null>();
  for (const [oppId, fit] of fits) for (const m of fit?.matches ?? []) fitBy.set(`${oppId}:${m.investigatorId}`, firstEvidence(m.rationale.evidence));

  // ---- one notice group per item ----
  const notices: DraftNoticeGroup[] = [];
  const noticeBy = new Map<string, { group: DraftNoticeGroup; beat: BeatNotice; saved: SavedDraft }>();
  for (const item of usedItems) {
    const fo = one(item.funding_opportunities);
    if (!fo) continue;
    const profile = profiles.profiles.get(item.opportunity_id) ?? null;
    const due = dueDisplay(cycleFactsFromRow(fo), today);
    const dueDate = due.date && due.tone !== "closed" && due.tone !== "muted" && due.tone !== "forecast" ? due.date : null;
    const routingDate = dueDate && opts.routing ? internalRoutingDate(dueDate, opts.routing) : null;
    const isLimited = limited.has(item.opportunity_id);
    const cap = capBy.get(item.opportunity_id) ?? null;
    const ceiling = profile?.mechanism.ceiling_direct_per_year ?? (fo.award_ceiling == null ? null : Number(fo.award_ceiling)) ?? null;
    const beat: BeatNotice = {
      sponsor: isNihNotice(fo) ? "NIH" : (normalizeAgencyDisplayName(fo.agency) ?? fo.agency_code ?? null),
      number: fo.opportunity_number,
      shortTitle: shortTitleOf(fo.title),
      dueDate,
      ceilingPerYear: ceiling && Number.isFinite(ceiling) && ceiling > 0 ? ceiling : null,
      periodYears: profile?.mechanism.period_years ?? null,
      awardSection: profile?.provenance?.["mechanism.ceiling_direct_per_year"]?.section ?? null,
      limited: isLimited,
      cap,
      consortiumRequired: profile?.team.consortium_required === true,
      requiredPartners: profile?.team.required_partners ?? [],
      clinicalTrial: profile?.mechanism.clinical_trial ?? null,
      humanMaterialsRequired: profile?.materials.human_required === true,
      loiDue: fo.loi_due,
      routingDate,
      requiredApproaches: requiredApproachesOf(profile),
      population: profile?.population?.trim() || null,
    };
    const saved = item.draft ?? {};
    const composed = { relevant: relevantBeat(beat, today), know: knowBeat(beat, today), next: nextBeat(closingLine) };
    const group: DraftNoticeGroup = {
      itemId: item.id,
      opportunityId: item.opportunity_id,
      number: fo.opportunity_number,
      title: beat.shortTitle,
      href: `/opportunities/${fo.id}`,
      subject: saved.subject?.trim() || subjectOf(beat, today),
      beats: {
        relevant: { text: saved.beats?.relevant?.trim() || composed.relevant.text, source: composed.relevant.source },
        know: { text: saved.beats?.know?.trim() || composed.know.text, source: composed.know.source },
        next: { text: saved.beats?.next?.trim() || composed.next.text, source: composed.next.source },
      },
      card: noticeCardOf({ fo, profile, today }),
      savedAt: item.draft_saved_at,
    };
    notices.push(group);
    noticeBy.set(item.id, { group, beat, saved });
  }

  // ---- one recipient per match ----
  const recipients: DraftRecipient[] = [];
  for (const r of wanted) {
    const n = noticeBy.get(r.item_id);
    const inv = one(r.investigators);
    if (!n || !inv || !r.investigator_id) continue;
    const followUp = r.status !== "selected";
    const evidence = fitBy.get(`${n.group.opportunityId}:${r.investigator_id}`) ?? evidenceFromReason(reasonBy.get(`${r.item_id}:${r.investigator_id}`)?.[0]) ?? null;
    const contactedAt = followUp ? r.contacted_at : null;
    const inSaved = (n.saved.to ?? []).includes(r.id);
    recipients.push({
      id: r.id,
      itemId: r.item_id,
      opportunityId: n.group.opportunityId,
      investigatorId: r.investigator_id,
      name: inv.full_name,
      firstName: firstNameOf(inv.full_name),
      lastName: lastNameOf(inv.full_name, inv.last_name),
      email: inv.email?.trim() || null,
      dept: inv.home_department?.trim() || null,
      community: communities.people.get(r.investigator_id) ?? null,
      followUp,
      contactedAt,
      noticeNumber: n.group.number,
      noticeTitle: n.group.title,
      whyYou: { evidence: evidenceBeat(evidence, contactedAt, n.beat.routingDate, today), sharp: sharpBeat(n.beat, contactedAt) },
      // The old Compose tab autosaved its default line as the hook; that is not a strategist's sentence, so it does not win over a composed one.
      savedHook: inSaved ? [n.saved.hooks?.[r.id]?.trim(), r.hook?.trim()].find((h) => h && h !== DEFAULT_PERSONAL_LINE) ?? null : null,
      savedAlt: inSaved ? (n.saved.alt?.[r.id] ?? null) : null,
    });
  }
  // Notice order: nearest deadline first, then number; recipients follow their notice, first names alphabetical inside it.
  const order = new Map(notices.map((g, i) => [g.itemId, i]));
  recipients.sort((a, b) => (order.get(a.itemId)! - order.get(b.itemId)!) || a.name.localeCompare(b.name));
  return { recipients, notices, sender, team: teamOut, closingLine, closingAvailable };
}
