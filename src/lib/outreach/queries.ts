/**
 * Read models for the Outreach board and workspace.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { cycleFactsFromRow, dueDisplay, followingDueDatesLabel, internalRoutingDate, type CycleColumns, type DueTone, type RoutingRule } from "@/lib/funding-opportunities/receipt-cycles";
import { personInitials } from "@/lib/investigators/sources";
import { parseProfile } from "@/lib/outreach/profile";
import {
  DEFAULT_SUGGESTION_OPTIONS,
  type ChecklistRow,
  type CommunityTier,
  type Coverage,
  type EvidenceGroup,
  type OpportunityProfile,
  type Outcome,
  type OutreachStage,
  type RecipientStatus,
  type SuggestionFlag,
  type SuggestionOptions,
  type SuggestionReason,
  type SuggestionTier,
  type SuggestionsState,
} from "@/lib/outreach/types";

export type BoardCard = {
  id: string;
  opportunityId: string;
  title: string;
  meta: string;
  stage: OutreachStage;
  deadline: { text: string; tone: "urgent" | "neutral" | "closed" };
  communities: string[];
  recipients: { total: number; contacted: number; interested: number; suggested: number };
  owner: { id: string | null; name: string };
  nextAction: string | null;
  nextActionDate: string | null;
  nextActionOverdue: boolean;
  primary: { label: string; kind: "review_recipients" | "review_suggestions" | "compose" | "advance" | "outcome" | "unpark" };
  outcome: Outcome | null;
  parkedReason: string | null;
  lastActivityAt: string;
};

export type BoardData = {
  cards: BoardCard[];
  counts: Record<OutreachStage, number>;
  metrics: { inPlay: number; piLinked: number; contacted: number; interested: number; overdue: number };
  summary: string;
  actions: Array<{ n: number; title: string; detail: string; tone: "danger" | "teal" | "warning" | "success"; href: string }>;
  communities: Array<{ id: string; label: string; slug: string }>;
};

const isoToday = () => new Date().toISOString().slice(0, 10);

function deadlineChip(row: Record<string, unknown>, today: string): BoardCard["deadline"] {
  const facts = cycleFactsFromRow(row as unknown as CycleColumns);
  const due = dueDisplay(facts, today);
  if (due.tone === "urgent") return { text: due.primary.replace(/^Due in (\d+) days.*$/, "$1 days left").replace(/·.*$/, "").trim(), tone: "urgent" };
  if (due.tone === "closed") return { text: "Closed", tone: "closed" };
  if (due.date) return { text: `Closes ${due.primary.split(" · ").slice(-1)[0] ?? due.primary}`, tone: "neutral" };
  return { text: due.primary, tone: "neutral" };
}

export async function loadBoard(db: SupabaseClient, teamId: string, filters: { stage: OutreachStage; community: string | null }): Promise<BoardData> {
  const today = isoToday();
  const [{ data: items }, { data: communities }, { data: members }] = await Promise.all([
    db
      .from("outreach_items")
      .select("id, opportunity_id, stage, outcome, parked_reason, owner_id, next_action, next_action_date, suggestions_state, last_activity_at, submitted_at, outcome_at, funding_opportunities(id, title, agency, agency_code, opportunity_number, funding_instrument, close_date, next_due, receipt_cycles, cycles_source, standard_dates_apply, expiration_date, open_date, forecasted, status, raw_payload_json)")
      .eq("team_id", teamId)
      .order("last_activity_at", { ascending: false }),
    db.from("pipeline_communities").select("id, label, slug").order("sort_order"),
    db.from("team_memberships").select("user_id, profiles(full_name, email)").eq("team_id", teamId),
  ]);
  const itemIds = ((items ?? []) as Array<{ id: string }>).map((i) => i.id);
  const [{ data: recips }, { data: suggs }] = itemIds.length
    ? await Promise.all([
        db.from("outreach_recipients").select("item_id, kind, status, community_id, origin").in("item_id", itemIds).is("removed_at", null),
        db.from("outreach_suggestions").select("item_id, tier, status").in("item_id", itemIds).eq("status", "active").neq("tier", "exploratory"),
      ])
    : [{ data: [] }, { data: [] }];
  const memberName = new Map(((members ?? []) as Array<{ user_id: string; profiles: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null }>).map((m) => {
    const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    return [m.user_id, p?.full_name?.trim() || p?.email || "Teammate"];
  }));
  const communityLabel = new Map(((communities ?? []) as Array<{ id: string; label: string }>).map((c) => [c.id, c.label]));
  const recBy = new Map<string, Array<{ kind: string; status: string; community_id: string | null }>>();
  for (const r of (recips ?? []) as Array<{ item_id: string; kind: string; status: string; community_id: string | null }>) recBy.set(r.item_id, [...(recBy.get(r.item_id) ?? []), r]);
  const sugBy = new Map<string, number>();
  for (const s of (suggs ?? []) as Array<{ item_id: string }>) sugBy.set(s.item_id, (sugBy.get(s.item_id) ?? 0) + 1);

  const counts: Record<OutreachStage, number> = { triage: 0, contacting: 0, developing: 0, submitted: 0, outcome: 0, parked: 0 };
  const all: BoardCard[] = [];
  let piLinked = 0;
  let contacted = 0;
  let interested = 0;
  let overdue = 0;
  for (const raw of (items ?? []) as Array<Record<string, unknown>>) {
    const fo = (Array.isArray(raw.funding_opportunities) ? raw.funding_opportunities[0] : raw.funding_opportunities) as Record<string, unknown> | null;
    if (!fo) continue;
    const stage = raw.stage as OutreachStage;
    counts[stage] += 1;
    const recs = recBy.get(raw.id as string) ?? [];
    const people = recs.filter((r) => r.kind === "person");
    const comms = recs.filter((r) => r.kind === "community").map((r) => communityLabel.get(r.community_id ?? "") ?? "Community");
    const rc = { total: people.length, contacted: people.filter((r) => r.status !== "selected").length, interested: people.filter((r) => r.status === "replied_interested").length, suggested: sugBy.get(raw.id as string) ?? 0 };
    const nextDate = (raw.next_action_date as string | null) ?? null;
    const isOverdue = Boolean(nextDate && nextDate < today && !["outcome", "parked"].includes(stage));
    if (!["outcome", "parked"].includes(stage)) {
      if (rc.total > 0) piLinked += 1;
      if (rc.contacted > 0) contacted += 1;
      if (rc.interested > 0) interested += 1;
      if (isOverdue) overdue += 1;
    }
    const primary: BoardCard["primary"] =
      stage === "parked" ? { label: "Resume", kind: "unpark" }
      : stage === "submitted" ? { label: "Record outcome", kind: "outcome" }
      : stage === "triage" && rc.total === 0 ? { label: rc.suggested ? "Review suggestions" : "Review recipients", kind: rc.suggested ? "review_suggestions" : "review_recipients" }
      : stage === "triage" && rc.contacted === 0 ? { label: "Compose outreach", kind: "compose" }
      : stage === "triage" ? { label: "Review recipients", kind: "review_recipients" }
      : stage === "contacting" ? { label: rc.interested ? "Move to Developing" : "Review recipients", kind: rc.interested ? "advance" : "review_recipients" }
      : stage === "developing" ? { label: "Move to Submitted", kind: "advance" }
      : { label: "Open workspace", kind: "review_recipients" };
    all.push({
      id: raw.id as string,
      opportunityId: fo.id as string,
      title: String(fo.title ?? ""),
      meta: [fo.agency, fo.opportunity_number, typeof fo.funding_instrument === "string" ? fo.funding_instrument.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : null].filter(Boolean).join(" · "),
      stage,
      deadline: deadlineChip(fo, today),
      communities: comms,
      recipients: rc,
      owner: { id: (raw.owner_id as string | null) ?? null, name: raw.owner_id ? memberName.get(raw.owner_id as string) ?? "Teammate" : "Unassigned" },
      nextAction: (raw.next_action as string | null) ?? null,
      nextActionDate: nextDate,
      nextActionOverdue: isOverdue,
      primary,
      outcome: (raw.outcome as Outcome | null) ?? null,
      parkedReason: (raw.parked_reason as string | null) ?? null,
      lastActivityAt: String(raw.last_activity_at),
    });
  }
  const inPlay = counts.triage + counts.contacting + counts.developing + counts.submitted;
  const fy = new Date().getUTCMonth() >= 6 ? new Date().getUTCFullYear() + 1 : new Date().getUTCFullYear();
  const fyStart = `${fy - 1}-07-01`;
  const submittedFy = ((items ?? []) as Array<Record<string, unknown>>).filter((i) => String(i.submitted_at ?? "").slice(0, 10) >= fyStart || ((i.stage === "outcome" || i.stage === "submitted") && String(i.outcome_at ?? i.last_activity_at).slice(0, 10) >= fyStart)).length;
  const fundedFy = ((items ?? []) as Array<Record<string, unknown>>).filter((i) => i.outcome === "funded" && String(i.outcome_at ?? i.last_activity_at).slice(0, 10) >= fyStart).length;
  const suggestionsToReview = all.filter((c) => !["outcome", "parked"].includes(c.stage) && c.recipients.suggested > 0);
  const needCommunity = all.filter((c) => !["outcome", "parked"].includes(c.stage) && c.communities.length === 0);
  const overdueCards = all.filter((c) => c.nextActionOverdue);
  const interestedCards = all.filter((c) => !["outcome", "parked"].includes(c.stage) && c.recipients.interested > 0);
  const shortTitles = (cards: BoardCard[]) => cards.slice(0, 2).map((c) => c.title.replace(/\s*\(.*$/, "").slice(0, 40)).join(" and ");

  const cards = all.filter((c) => c.stage === filters.stage && (!filters.community || c.communities.includes(communityLabel.get(filters.community) ?? "")));
  return {
    cards,
    counts,
    metrics: { inPlay, piLinked, contacted, interested, overdue },
    summary: `${inPlay} opportunit${inPlay === 1 ? "y" : "ies"} in play · ${overdue} overdue next action${overdue === 1 ? "" : "s"} · ${interested} interested PI${interested === 1 ? "" : "s"} · FY${String(fy).slice(-2)} so far: ${submittedFy} submitted, ${fundedFy} funded`,
    actions: [
      { n: overdueCards.length, title: "Overdue next actions", detail: overdueCards.length ? `${shortTitles(overdueCards)}.` : "Nothing overdue.", tone: "danger", href: "/outreach" },
      { n: suggestionsToReview.reduce((n, c) => n + c.recipients.suggested, 0), title: "Suggestions to review", detail: `Across ${suggestionsToReview.length} opportunit${suggestionsToReview.length === 1 ? "y" : "ies"}. Nothing is sent until you decide.`, tone: "teal", href: suggestionsToReview[0] ? `/outreach?item=${suggestionsToReview[0].id}` : "/outreach" },
      { n: needCommunity.length, title: "Tag research communities", detail: "Routing and suggestions depend on it.", tone: "warning", href: needCommunity[0] ? `/outreach?item=${needCommunity[0].id}` : "/outreach" },
      { n: interestedCards.length, title: "Follow up with interested PI", detail: interestedCards.length ? `${shortTitles(interestedCards)}.` : "No replies yet.", tone: "success", href: interestedCards[0] ? `/outreach?item=${interestedCards[0].id}` : "/outreach" },
    ],
    communities: (communities ?? []) as Array<{ id: string; label: string; slug: string }>,
  };
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export type WorkspaceRecipient = {
  id: string;
  kind: "person" | "community";
  investigatorId: string | null;
  communityId: string | null;
  name: string;
  initials: string;
  meta: string;
  email: string | null;
  lastName: string;
  origin: "you" | "suggested";
  status: RecipientStatus;
  statusLine: string;
  statusKind: "neutral" | "warn" | "good" | "teal";
  contactedAt: string | null;
  contactCount: number;
  hook: string | null;
  quarterSends: number;
  doNotContact: boolean;
};

export type WorkspaceSuggestion = {
  id: string;
  investigatorId: string;
  name: string;
  initials: string;
  dept: string;
  rank: string;
  email: string | null;
  tier: SuggestionTier;
  coverage: Coverage;
  flags: SuggestionFlag[];
  reasons: SuggestionReason[];
  checklist: ChecklistRow[];
  groups: EvidenceGroup[];
  summary: string | null;
  identityLine: string;
  freshLine: string;
  freshWarn: boolean;
  historyLine: string | null;
  historyKind: "good" | "warn" | null;
  isNew: boolean;
  status: "active" | "added" | "dismissed" | "excluded";
  excludedReason: string | null;
  dismissedReason: string | null;
  snapshotAt: string;
};

export type WorkspaceCommunity = {
  id: string;
  name: string;
  full: string;
  tier: CommunityTier;
  reason: string;
  alignment: string[];
  memberMatches: number;
  memberTotal: number;
  tagged: boolean;
  dismissed: boolean;
  evaluatedAt: string | null;
};

export type WorkspaceActivity = { id: string; who: string; what: string; when: string; kind: string; createdAt: string };

export type WorkspaceData = {
  item: {
    id: string;
    stage: OutreachStage;
    outcome: Outcome | null;
    outcomeNote: string | null;
    parkedReason: string | null;
    parkedFrom: OutreachStage | null;
    ownerId: string | null;
    nextAction: string | null;
    nextActionDate: string | null;
    suggestionsState: SuggestionsState;
    suggestionsError: string | null;
    suggestionsGeneratedAt: string | null;
    suggestionsProfileVersion: number | null;
    options: SuggestionOptions;
    noticeChangedSince: boolean;
    noticeChangedAt: string | null;
    draft: { subject?: string; body?: string; mode?: "one" | "personalized"; to?: string[]; hooks?: Record<string, string> };
    draftSavedAt: string | null;
  };
  notice: {
    id: string;
    title: string;
    agency: string | null;
    number: string | null;
    instrument: string | null;
    activityCode: string | null;
    clinicalTrialNote: string | null;
    awardCeiling: number | null;
    dueLine: string;
    dueTone: DueTone;
    followingLine: string | null;
    routingDate: string | null;
    dueDate: string | null;
    multiPi: boolean;
    noticeUrl: string | null;
  };
  profile: OpportunityProfile;
  communities: WorkspaceCommunity[];
  recipients: WorkspaceRecipient[];
  suggestions: WorkspaceSuggestion[];
  activity: WorkspaceActivity[];
  members: Array<{ id: string; name: string }>;
  team: { name: string; replyTo: string | null; sendingIdentity: string; perInvestigatorLimit: number; signature: string | null; fromAddress: string | null };
  viewer: { id: string; name: string; title: string | null; initials: string };
  directoryCount: number;
};

const STATUS_KIND: Record<RecipientStatus, WorkspaceRecipient["statusKind"]> = { selected: "neutral", contacted: "warn", replied_interested: "good", replied_maybe: "teal", replied_not_now: "warn", declined: "warn", bounced: "warn" };

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
  return `${sameDay ? "Today" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" })} · ${time}`;
}

export async function loadWorkspace(db: SupabaseClient, teamId: string, itemId: string, viewer: { id: string; name: string; title: string | null }, routing: RoutingRule): Promise<WorkspaceData | null> {
  const { data: row } = await db
    .from("outreach_items")
    .select("*, funding_opportunities(*)")
    .eq("id", itemId)
    .eq("team_id", teamId)
    .maybeSingle();
  if (!row) return null;
  const raw = row as Record<string, unknown>;
  const fo = (Array.isArray(raw.funding_opportunities) ? raw.funding_opportunities[0] : raw.funding_opportunities) as Record<string, unknown>;
  const today = isoToday();
  const facts = cycleFactsFromRow(fo as unknown as CycleColumns);
  const due = dueDisplay(facts, today);
  const following = followingDueDatesLabel(facts, today);
  const dueDate = due.date ?? null;
  const routingDate = dueDate ? internalRoutingDate(dueDate, routing) : null;

  const [{ data: recRows }, { data: sugRows }, { data: evalRows }, { data: communities }, { data: actRows }, { data: members }, { data: team }, { count: directoryCount }] = await Promise.all([
    db.from("outreach_recipients").select("*, investigators(id, full_name, first_name, last_name, email, home_department, division, research_community_id, do_not_contact_at), pipeline_communities(id, label)").eq("item_id", itemId).is("removed_at", null).order("added_at"),
    db.from("outreach_suggestions").select("*, investigators(id, full_name, email, home_department, division, rank, research_community_id, raw_profile_json)").eq("item_id", itemId).order("score", { ascending: false }),
    db.from("outreach_community_evaluations").select("*").eq("item_id", itemId),
    db.from("pipeline_communities").select("id, label, slug").order("sort_order"),
    db.from("outreach_activity").select("id, actor_name, kind, text, created_at").eq("item_id", itemId).order("created_at", { ascending: false }).limit(60),
    db.from("team_memberships").select("user_id, profiles(full_name, email)").eq("team_id", teamId),
    db.from("teams").select("name, reply_to_email, sending_identity, sending_address, per_investigator_limit, signature").eq("id", teamId).maybeSingle(),
    db.from("investigators").select("id", { count: "exact", head: true }).is("archived_at", null),
  ]);

  const commLabel = new Map(((communities ?? []) as Array<{ id: string; label: string }>).map((c) => [c.id, c.label]));
  const personIds = ((recRows ?? []) as Array<{ investigator_id: string | null }>).map((r) => r.investigator_id).filter((x): x is string => Boolean(x));
  const { quarterSendCounts } = await import("@/lib/outreach/send");
  const sends = await quarterSendCounts(db, teamId, personIds);

  const recipients: WorkspaceRecipient[] = ((recRows ?? []) as Array<Record<string, unknown>>).map((r) => {
    const inv = (Array.isArray(r.investigators) ? r.investigators[0] : r.investigators) as Record<string, unknown> | null;
    const com = (Array.isArray(r.pipeline_communities) ? r.pipeline_communities[0] : r.pipeline_communities) as { id: string; label: string } | null;
    const status = r.status as RecipientStatus;
    const name = inv ? String(inv.full_name) : com?.label ?? "Community";
    const contactedAt = (r.contacted_at as string | null) ?? null;
    const statusLine =
      status === "selected" ? (r.kind === "community" ? "Tagged" : "Selected")
      : status === "contacted" ? `Contacted ${contactedAt ? fmtWhen(contactedAt).split(" · ")[0] : ""} · no reply`
      : status === "replied_interested" ? `Interested${r.replied_at ? ` · ${fmtWhen(String(r.replied_at)).split(" · ")[0]}` : ""}`
      : status === "replied_maybe" ? "Replied Maybe"
      : status === "replied_not_now" ? "Replied Not now"
      : status === "declined" ? "Declined"
      : "Bounced";
    return {
      id: r.id as string,
      kind: r.kind as "person" | "community",
      investigatorId: (r.investigator_id as string | null) ?? null,
      communityId: (r.community_id as string | null) ?? null,
      name,
      initials: personInitials(name),
      meta: inv
        ? [inv.home_department, inv.division, inv.research_community_id ? commLabel.get(String(inv.research_community_id)) : null].filter(Boolean).join(" · ")
        : "Community message · no contact address on file",
      email: inv ? ((inv.email as string | null) ?? null) : null,
      lastName: inv ? (String(inv.last_name ?? "").trim() || String(inv.full_name).split(/\s+/).slice(-1)[0] || "Colleague") : name,
      origin: r.origin as "you" | "suggested",
      status,
      statusLine,
      statusKind: STATUS_KIND[status],
      contactedAt,
      contactCount: Number(r.contact_count ?? 0),
      hook: (r.hook as string | null) ?? null,
      quarterSends: inv ? sends.get(String(inv.id)) ?? 0 : 0,
      doNotContact: Boolean(inv?.do_not_contact_at),
    };
  });

  const suggestions: WorkspaceSuggestion[] = ((sugRows ?? []) as Array<Record<string, unknown>>).map((s) => {
    const inv = (Array.isArray(s.investigators) ? s.investigators[0] : s.investigators) as Record<string, unknown> | null;
    const name = inv ? String(inv.full_name) : "Investigator";
    const rawProfile = (inv?.raw_profile_json ?? {}) as Record<string, unknown>;
    const rank = typeof rawProfile.title === "string" ? rawProfile.title : inv?.rank && !/^(member|associate|leadership_committee)$/i.test(String(inv.rank)) ? String(inv.rank) : "rank not on file";
    return {
      id: s.id as string,
      investigatorId: s.investigator_id as string,
      name,
      initials: personInitials(name),
      dept: [inv?.home_department, inv?.research_community_id ? commLabel.get(String(inv.research_community_id)) : null].filter(Boolean).join(" · ") || "—",
      rank,
      email: inv ? ((inv.email as string | null) ?? null) : null,
      tier: s.tier as SuggestionTier,
      coverage: s.coverage as Coverage,
      flags: (s.flags as SuggestionFlag[]) ?? [],
      reasons: (s.reasons as SuggestionReason[]) ?? [],
      checklist: (s.checklist as ChecklistRow[]) ?? [],
      groups: ((s.evidence as { groups?: EvidenceGroup[] } | null)?.groups ?? []) as EvidenceGroup[],
      summary: (s.summary as string | null) ?? null,
      identityLine: String(s.identity_line ?? "not checked"),
      freshLine: String(s.fresh_line ?? ""),
      freshWarn: Boolean(s.fresh_warn),
      historyLine: (s.history_line as string | null) ?? null,
      historyKind: (s.history_kind as "good" | "warn" | null) ?? null,
      isNew: Boolean(s.is_new),
      status: s.status as WorkspaceSuggestion["status"],
      excludedReason: (s.excluded_reason as string | null) ?? null,
      dismissedReason: (s.dismissed_reason as string | null) ?? null,
      snapshotAt: String(s.snapshot_at),
    };
  });

  const taggedCommunities = new Set(recipients.filter((r) => r.kind === "community").map((r) => r.communityId));
  const evalBy = new Map(((evalRows ?? []) as Array<Record<string, unknown>>).map((e) => [e.community_id as string, e]));
  const communitiesOut: WorkspaceCommunity[] = ((communities ?? []) as Array<{ id: string; label: string; slug: string }>).map((c) => {
    const e = evalBy.get(c.id);
    return {
      id: c.id,
      name: c.label,
      full: c.label,
      tier: (e?.tier as CommunityTier | undefined) ?? "cant_evaluate",
      reason: (e?.reason as string | undefined) ?? "Not evaluated yet. Generate suggestions to evaluate the monitored communities.",
      alignment: (e?.alignment as string[] | undefined) ?? [],
      memberMatches: Number(e?.member_matches ?? 0),
      memberTotal: Number(e?.member_total ?? 0),
      tagged: taggedCommunities.has(c.id),
      dismissed: Boolean(e?.dismissed_at),
      evaluatedAt: (e?.evaluated_at as string | undefined) ?? null,
    };
  });

  const memberList = ((members ?? []) as Array<{ user_id: string; profiles: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null }>).map((m) => {
    const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    return { id: m.user_id, name: p?.full_name?.trim() || p?.email || "Teammate" };
  });
  const t = (team ?? {}) as { name?: string; reply_to_email?: string | null; sending_identity?: string; sending_address?: string | null; per_investigator_limit?: number; signature?: string | null };
  const noticeUpdated = (fo.updated_at as string | null) ?? null;
  const seen = (raw.notice_version_seen as string | null) ?? null;
  const summary = (fo.raw_payload_json as { summary?: Record<string, unknown> } | null)?.summary ?? {};
  const noticeUrl = typeof summary.additional_info_url === "string" ? summary.additional_info_url : typeof fo.guide_url === "string" ? fo.guide_url : null;

  return {
    item: {
      id: raw.id as string,
      stage: raw.stage as OutreachStage,
      outcome: (raw.outcome as Outcome | null) ?? null,
      outcomeNote: (raw.outcome_note as string | null) ?? null,
      parkedReason: (raw.parked_reason as string | null) ?? null,
      parkedFrom: (raw.parked_from as OutreachStage | null) ?? null,
      ownerId: (raw.owner_id as string | null) ?? null,
      nextAction: (raw.next_action as string | null) ?? null,
      nextActionDate: (raw.next_action_date as string | null) ?? null,
      suggestionsState: raw.suggestions_state as SuggestionsState,
      suggestionsError: (raw.suggestions_error as string | null) ?? null,
      suggestionsGeneratedAt: (raw.suggestions_generated_at as string | null) ?? null,
      suggestionsProfileVersion: (raw.suggestions_profile_version as number | null) ?? null,
      options: { ...DEFAULT_SUGGESTION_OPTIONS, ...((raw.suggestion_options as Partial<SuggestionOptions> | null) ?? {}) },
      noticeChangedSince: Boolean(seen && noticeUpdated && noticeUpdated > seen && raw.suggestions_state === "ready"),
      noticeChangedAt: noticeUpdated,
      draft: ((raw.draft as WorkspaceData["item"]["draft"] | null) ?? {}),
      draftSavedAt: (raw.draft_saved_at as string | null) ?? null,
    },
    notice: {
      id: fo.id as string,
      title: String(fo.title ?? ""),
      agency: (fo.agency as string | null) ?? null,
      number: (fo.opportunity_number as string | null) ?? null,
      instrument: typeof fo.funding_instrument === "string" ? fo.funding_instrument.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : null,
      activityCode: (fo.activity_code as string | null) ?? null,
      clinicalTrialNote: (fo.clinical_trial_note as string | null) ?? null,
      awardCeiling: typeof fo.award_ceiling === "number" ? fo.award_ceiling : null,
      dueLine: due.primary + (due.tone === "urgent" || due.tone === "normal" ? (facts.isNih && dueDate ? ", 5:00 PM PT" : "") : ""),
      dueTone: due.tone,
      followingLine: following,
      routingDate,
      dueDate,
      multiPi: /multi-?pi|multiple pi/i.test(String(fo.rd_collaboration ?? "")) || /multi_pi/.test(String(fo.rd_collaboration ?? "")),
      noticeUrl,
    },
    profile: parseProfile(raw.profile),
    communities: communitiesOut,
    recipients,
    suggestions,
    activity: ((actRows ?? []) as Array<{ id: string; actor_name: string; kind: string; text: string; created_at: string }>).map((a) => ({ id: a.id, who: a.actor_name, what: a.kind === "note" ? `note: “${a.text}”` : a.text, when: fmtWhen(a.created_at), kind: a.kind, createdAt: a.created_at })),
    members: memberList,
    team: { name: t.name ?? "Team", replyTo: t.reply_to_email ?? null, sendingIdentity: t.sending_identity ?? "strategist_via_prospera", perInvestigatorLimit: t.per_investigator_limit ?? 2, signature: t.signature ?? null, fromAddress: (process.env.RESEND_FROM_EMAIL ?? "").replace(/^.*<([^>]+)>.*$/, "$1") || null },
    viewer: { ...viewer, initials: personInitials(viewer.name) },
    directoryCount: directoryCount ?? 0,
  };
}
