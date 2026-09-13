/**
 * Read models for the Outreach board and workspace.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { evidenceIdsToResolve, judgedOf, needsProfileFallback, rationaleView, type JudgedView } from "@/lib/fit/explain-view";
import { loadTeamFitEngine, type FitEngine } from "@/lib/fit/flag";
import { EMPTY_LOOKUP } from "@/lib/fit/inspect/evidence";
import { loadEvidenceLookup } from "@/lib/fit/inspect/load";
import { loadFitVerdictsForNoticeInvestigators, type FitResultsRead, type FitResultVerdictRow } from "@/lib/fit/results";
import type { Components, Tier } from "@/lib/fit/types";
import { auditView, type AuditContent } from "@/lib/fit/audit-view";
import { verdictPanel, type PanelContent } from "@/lib/fit/verdict-panel";
import { EMPTY_INVESTIGATOR_PROFILES, EMPTY_NOTICE_PROFILES, loadInvestigatorProfiles, loadNoticeProfiles, noticeInputFor, type InvestigatorProfiles, type NoticeProfiles } from "@/lib/fit/verdict-profiles";
import { fitVerdicts, type FitVerdicts } from "@/lib/fit/verdicts";
import { cycleFactsFromRow, dueDisplay, followingDueDatesLabel, internalRoutingDate, isoToday, type CycleColumns, type DueTone, type RoutingRule } from "@/lib/funding-opportunities/receipt-cycles";
import { resolveNoticeLinks } from "@/lib/funding-opportunities/notice-links";
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
  /** PR 3.2: the `wrong_research_type` sub-reason (`<axis>` or `<axis>:<category>`); null otherwise, and before the 3.2 migration. */
  axisReason: string | null;
  /** PR 3.2, fit-v1 only: the pair's `fit_results` components and stage-8 marker for the evidence view; null under legacy or when the pair has no row. */
  fit: SuggestionFit | null;
  snapshotAt: string;
};

/**
 * What a fit-v1 suggestion carries beside its snapshot: the evidence view's
 * component bars (PR 3.2 — P U D T M O K A from `fit_results.components`, the
 * caps and the stage-8 marker) and, from fit-UX PR 3, the row's own judgment
 * and disclosure, so the recipients tab draws the same `VerdictRow` as the
 * other two surfaces instead of its own bullets, dots and coverage line.
 */
export type SuggestionFit = {
  tier: Tier;
  score: number;
  components: Components;
  caps: string[];
  judged: JudgedView | null;
  /** fit-UX PR 3: label, the three verdicts, one reason, one caveat, one action. */
  verdicts: FitVerdicts;
  /** fit-UX PR 3: "Why, and what it rests on". */
  disclosure: PanelContent;
  /** fit-UX PR 4: the audit layer — the approach comparison, the two rule tables and the internals block. Derived from the same two profiles the verdicts are, with no read of its own. */
  audit: AuditContent;
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
  /**
   * fit-UX final round (B6): the verdict block did not produce what it should
   * have — the `fit_results` read errored, or the whole block threw and its
   * `catch` cleared the map. Every fit-v1 row then falls back to the
   * pre-redesign row, and the tab says so instead of reverting in silence.
   */
  fitReadFailed: boolean;
  communities: WorkspaceCommunity[];
  recipients: WorkspaceRecipient[];
  suggestions: WorkspaceSuggestion[];
  activity: WorkspaceActivity[];
  members: Array<{ id: string; name: string }>;
  team: {
    name: string;
    replyTo: string | null;
    sendingIdentity: string;
    sendingAddress: string | null;
    perInvestigatorLimit: number;
    signature: string | null;
    fromAddress: string | null;
    /** The acting team's `teams.fit_engine` (PR 2.3): the tooltip the tier pills carry. A snapshot records no engine, so a snapshot made before a flip carries the new text until suggestions are regenerated. */
    fitEngine: FitEngine;
  };
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

/** What the fit reads answer with: the flag they were gated on, the ids they covered, and the three reads' own `{available, error}` results. */
type FitReads = {
  engine: FitEngine;
  ids: string[];
  read: FitResultsRead<FitResultVerdictRow>;
  notices: NoticeProfiles;
  investigators: InvestigatorProfiles;
};

/** No verdict rows, and no read failed — the shape for a legacy team and for an item with nothing to assess. */
const EMPTY_VERDICTS: FitResultsRead<FitResultVerdictRow> = { rows: [], available: true, error: null };

/**
 * Pure. Which of an item's suggestions the workspace needs a verdict for
 * (fit-UX follow-up, L2).
 *
 * Every suggestion status but one can reach a `VerdictRow`: `active` rows are
 * the list, and `dismissed` rows are behind a client-side toggle, so their
 * verdicts have to be in the payload. **`excluded` cannot** — `recipients-tab.tsx`
 * builds `visible` from `active` and `dismissed` only, and an eligibility-
 * excluded person appears once, as a name and a reason, in the "excluded by
 * eligibility" list. There is no row, no disclosure and no audit view for
 * them, so reading a verdict row, a fit profile, their evidence ids and
 * building an `auditView` per person is work with no reader.
 *
 * Distinct, because two suggestion rows for one person would read that
 * person's 26KB profile twice.
 */
export function rowsForFitVerdicts(rows: ReadonlyArray<{ investigator_id: string; status: string }>): string[] {
  return Array.from(new Set(rows.filter((r) => r.status !== "excluded" && r.investigator_id).map((r) => r.investigator_id)));
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
  const fo = (Array.isArray(raw.funding_opportunities) ? raw.funding_opportunities[0] : raw.funding_opportunities) as Record<string, unknown> | null | undefined;
  // An item whose notice row did not come back with it — a deleted notice, a
  // join the read did not resolve. Every line below reads `fo`, so this used
  // to be a `TypeError` inside the `Promise.all` that `outreach/page.tsx`
  // awaits: a 500 on the whole board, not an empty workspace. `null` is the
  // answer the caller already handles.
  if (!fo) return null;
  const today = isoToday();
  const facts = cycleFactsFromRow(fo as unknown as CycleColumns);
  const due = dueDisplay(facts, today);
  const following = followingDueDatesLabel(facts, today);
  const dueDate = due.date ?? null;
  const routingDate = dueDate ? internalRoutingDate(dueDate, routing) : null;

  // ---- The fit reads, started **beside** the block below, not after it (L2) ----
  //
  // Measured on the ADRN item (83 suggestions, warm, against the real
  // database): the block below takes ~500ms, all of it the one 724KB
  // `outreach_suggestions` read; the three fit reads take ~800ms, 650 of it
  // the 2.15MB `investigator_fit_profiles` read. Chained, that is 1.3s of
  // wall clock for two sets of reads that share nothing but a list of
  // investigator ids.
  //
  // So the ids are read on their own — two columns on the item's index, ~120ms
  // — and the fit reads are **kicked off** here and awaited after the block,
  // which puts them side by side instead of end to end. Reading
  // `outreach_suggestions` twice is the price, and it is the small read that
  // is paid twice.
  //
  // `loadTeamFitEngine` moves up with it: the flag decides whether the fit
  // reads happen at all, so leaving it in the block would have made the block
  // the thing they wait for.
  const fitReads = Promise.all([
    db.from("outreach_suggestions").select("investigator_id, status").eq("item_id", itemId),
    loadTeamFitEngine(db, teamId),
  ]).then(async ([keys, engine]): Promise<FitReads> => {
    if (engine !== "fit-v1") return { engine, ids: [], read: EMPTY_VERDICTS, notices: EMPTY_NOTICE_PROFILES, investigators: EMPTY_INVESTIGATOR_PROFILES };
    const ids = rowsForFitVerdicts((keys.data ?? []) as Array<{ investigator_id: string; status: string }>);
    if (!ids.length) return { engine, ids, read: EMPTY_VERDICTS, notices: EMPTY_NOTICE_PROFILES, investigators: EMPTY_INVESTIGATOR_PROFILES };
    const [read, notices, investigators] = await Promise.all([
      loadFitVerdictsForNoticeInvestigators(db, String(fo.id), ids),
      loadNoticeProfiles(db, [String(fo.id)]),
      loadInvestigatorProfiles(db, ids),
    ]);
    return { engine, ids, read, notices, investigators };
  });

  const [{ data: recRows }, { data: sugRows }, { data: evalRows }, { data: communities }, { data: actRows }, { data: members }, { data: team }, { count: directoryCount }] = await Promise.all([
    db.from("outreach_recipients").select("*, investigators(id, full_name, first_name, last_name, email, home_department, division, research_community_id, do_not_contact_at), pipeline_communities(id, label)").eq("item_id", itemId).is("removed_at", null).order("added_at"),
    db.from("outreach_suggestions").select("*, investigators(id, full_name, email, home_department, division, rank, research_community_id, raw_profile_json)").eq("item_id", itemId).order("score", { ascending: false }),
    db.from("outreach_community_evaluations").select("*").eq("item_id", itemId),
    db.from("pipeline_communities").select("id, label, slug").order("sort_order"),
    db.from("outreach_activity").select("id, actor_name, kind, text, created_at").eq("item_id", itemId).order("created_at", { ascending: false }).limit(60),
    // `profiles!user_id`: `team_memberships` has two foreign keys to `profiles` (user_id, invited_by), so an unhinted embed is refused by PostgREST — and the refusal used to be swallowed, leaving the owner select with "Unassigned" alone. `lib/supabase/embeds.test.ts` guards the class.
    db.from("team_memberships").select("user_id, profiles!user_id(full_name, email)").eq("team_id", teamId),
    db.from("teams").select("name, reply_to_email, sending_identity, sending_address, per_investigator_limit, signature").eq("id", teamId).maybeSingle(),
    db.from("investigators").select("id", { count: "exact", head: true }).is("archived_at", null),
  ]);

  const commLabel = new Map(((communities ?? []) as Array<{ id: string; label: string }>).map((c) => [c.id, c.label]));
  const personIds = ((recRows ?? []) as Array<{ investigator_id: string | null }>).map((r) => r.investigator_id).filter((x): x is string => Boolean(x));
  const { quarterSendCounts } = await import("@/lib/outreach/send");
  const sends = await quarterSendCounts(db, teamId, personIds);

  // fit-v1 only: the verdict rows behind the item's suggestions and the two
  // profiles a verdict is read against (C3) — three bounded reads for the
  // notice and the suggested people, none per person, then one evidence
  // lookup. The three were started above, beside the block, and land here.
  //
  // **Three legs, not five** (fit-UX follow-up, L2). PR 3 wrote this as a
  // chain: item → block → verdicts → the two profiles → the evidence lookup,
  // with each leg a full round trip to Supabase and only the last of them
  // actually depending on the one before it. The verdict read and the two
  // profile reads share nothing but a list of investigator ids, and the block
  // shares nothing with any of them.
  //
  // The narrowing is `rowsForFitVerdicts`: an eligibility-**excluded**
  // suggestion never renders a verdict row (`recipients-tab.tsx` lists those
  // as names under "excluded by eligibility"), so it was paying for a verdict
  // row, a 26KB fit profile, its evidence ids and a whole `auditView` that
  // nothing can open.
  //
  // **The whole block degrades.** `outreach/page.tsx` awaits `loadWorkspace`
  // inside a `Promise.all`, so anything that throws here takes the board down
  // with the workspace — and what this block produces is bars, chips and
  // sentences *about* suggestions that are already loaded. It reads that way on
  // purpose: the evidence lookup below has carried `.catch(() => EMPTY_LOOKUP)`
  // since PR 3.2 for exactly this reason, and every read in it now answers
  // rather than throws. `fitReads` is `.catch`-ed for the same reason: it is
  // started before this `try` opens, so a rejection there would be unhandled
  // rather than degraded.
  const fitByPerson = new Map<string, SuggestionFit>();
  // B6: whether the verdicts on this item are the verdicts, or the stale
  // fallback. The `catch` below used to clear the map and say nothing, so a
  // fit-v1 team saw every row revert to the pre-redesign one — bullets, dots,
  // coverage line and `fit_results.rationale` whole, values and `Caps — …`
  // included — with no signal anywhere on the page. The tab states it.
  let fitReadFailed = false;
  const fits = await fitReads.catch((e: unknown): FitReads => {
    console.warn(`[outreach] fit reads: ${e instanceof Error ? e.message : String(e)}`);
    return { engine: "fit-v1", ids: [], read: { rows: [], available: true, error: "fit reads failed" }, notices: EMPTY_NOTICE_PROFILES, investigators: EMPTY_INVESTIGATOR_PROFILES };
  });
  const fitEngine = fits.engine;
  if (fitEngine === "fit-v1") {
    try {
      const { read, notices: noticeProfiles, investigators: investigatorProfiles } = fits;
      if (read.error) console.warn(`[outreach] fit_results verdicts: ${read.error}`);
      // A read that errored is a failed read, not "no rows": every row it
      // would have carried falls back, and that is the same degradation the
      // `catch` is for.
      if (read.error) fitReadFailed = true;
      if (read.rows.length) {
        for (const e of [noticeProfiles.error, investigatorProfiles.error]) if (e) console.warn(`[outreach] ${e}`);
        const provenanceFor = (id: string) => investigatorProfiles.profiles.get(id)?.provenance ?? null;
        const lookup = await loadEvidenceLookup(db, read.rows.flatMap((r) => evidenceIdsToResolve(r, { profileProvenance: needsProfileFallback(r) ? provenanceFor(r.investigator_id) : null }))).catch(() => EMPTY_LOOKUP);
        const { notice, noticeComplete } = noticeInputFor(noticeProfiles, String(fo.id));
        for (const r of read.rows) {
          const investigator = investigatorProfiles.profiles.get(r.investigator_id) ?? null;
          const rationale = rationaleView(r, lookup, { profileProvenance: provenanceFor(r.investigator_id) });
          // The workspace is a strategist surface: the board, the queue and the
          // dismissal reasons are the office's, and D7's PI audience never reaches it.
          //
          // **One input object, two view models.** `fitVerdicts` and `auditView`
          // read the same `row`, `notice` and `investigator`; building the audit
          // from a separately-assembled object is how the row and the view it
          // opens come to disagree about which notice profile was checked.
          const input = { row: r, notice, investigator, lookup, audience: "strategist" as const, noticeComplete };
          const verdicts = fitVerdicts(input);
          fitByPerson.set(r.investigator_id, { tier: r.tier, score: Number(r.score), components: r.components, caps: r.caps ?? [], judged: judgedOf(r), verdicts, disclosure: verdictPanel({ row: r, label: verdicts.label, rationale, notice }), audit: auditView(input) });
        }
      }
    } catch (e) {
      console.warn(`[outreach] fit verdicts: ${e instanceof Error ? e.message : String(e)}`);
      fitByPerson.clear();
      fitReadFailed = true;
    }
  }

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
    const snapshotTitle = (s.evidence as { title?: string | null } | null)?.title ?? null;
    const rank = snapshotTitle ?? (typeof rawProfile.title === "string" ? rawProfile.title : inv?.rank && !/^(member|associate|leadership_committee)$/i.test(String(inv.rank)) ? String(inv.rank) : "rank not on file");
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
      axisReason: (s.axis_reason as string | null | undefined) ?? null,
      fit: fitByPerson.get(s.investigator_id as string) ?? null,
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
  const noticeUrl = resolveNoticeLinks({
    guide_url: fo.guide_url as string | null,
    guide_fetch_status: fo.guide_fetch_status as string | null,
    source_system: fo.source_system as string | null,
    source_opportunity_id: fo.source_opportunity_id as string | null,
    raw_payload_json: fo.raw_payload_json,
  }).primary?.url ?? null;

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
    /** B6: the verdict block degraded — the read errored or the whole block threw — so every row on this item is the stored snapshot rather than the assessment. */
    fitReadFailed,
    communities: communitiesOut,
    recipients,
    suggestions,
    activity: ((actRows ?? []) as Array<{ id: string; actor_name: string; kind: string; text: string; created_at: string }>).map((a) => ({ id: a.id, who: a.actor_name, what: a.kind === "note" ? `note: “${a.text}”` : a.text, when: fmtWhen(a.created_at), kind: a.kind, createdAt: a.created_at })),
    members: memberList,
    team: { name: t.name ?? "Team", replyTo: t.reply_to_email ?? null, sendingIdentity: t.sending_identity ?? "strategist_via_prospera", sendingAddress: t.sending_address ?? null, perInvestigatorLimit: t.per_investigator_limit ?? 2, signature: t.signature ?? null, fromAddress: (process.env.RESEND_FROM_EMAIL ?? "").replace(/^.*<([^>]+)>.*$/, "$1") || null, fitEngine },
    viewer: { ...viewer, initials: personInitials(viewer.name) },
    directoryCount: directoryCount ?? 0,
  };
}
