"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { markDiscoverVisitAction } from "@/app/actions/data-source-actions";
import { decideMatchAction, dismissNoticeAction, loadFocusProfileAction, setReviewExploratoryAction, tagConfirmationAction, undoClearedAction, undoDecisionAction } from "@/app/actions/review-actions";
import { CompareDrawer } from "@/components/review/compare-drawer";
import { AssessmentDrawer, OpportunityDrawer, ProfileDrawer } from "@/components/review/focus-drawers";
import { FocusView, type DrawerKind, type FocusRow } from "@/components/review/focus-view";
import { MatchRow, type Density } from "@/components/review/match-row";
import { NoticeHeader } from "@/components/review/notice-header";
import { NoticeQueue } from "@/components/review/notice-queue";
import { ALSO, ALSO_CHIP, ALSO_LABEL, ALSO_WHEN, ALSO_WHEN_TONE, BTN_PRIMARY_30, BTN_SECONDARY_30, BTN_WARN_26, BULK_BANNER, BULK_TEXT, CARD, EMPTY_ROWS, FILTER_CHIP, FILTER_CHIP_TONE, FILTER_CHIPS, FILTER_EMPTY, FOOTER_NOTE, H1, HEADER_ACTIONS_GROUP, LAYOUT, LEADS_SWITCH, LEADS_SWITCH_TONE, MAIN_COLUMN, PAGE, PAGE_HEADER, QUEUED_BAR, QUEUED_GHOST, QUEUED_TEXT, QUEUED_WHITE, ROWS_DECIDED, ROWS_FOOTER, ROWS_HEADER, ROWS_TITLE, STALE, STALE_LINK, SUB, SUB_LINK } from "@/components/review/review-view";
import { useToast } from "@/components/ui/toast";
import type { FitEngine } from "@/lib/fit/flag";
import type { MatchDecision } from "@/lib/review/decisions";
import { filterLabel, passesFilter, type ReviewFilter } from "@/lib/review/calls";
import { compareButtonLabel } from "@/lib/review/compare";
import { focusActions, type FocusProfile } from "@/lib/review/focus";
import type { OvernightData } from "@/lib/review/overnight-queries";
import type { ReviewNoticeData } from "@/lib/review/queries";
import { bulkNoteText, decidedLine, firstUndecided, footerLine, nextUndecided, noticeCounts, noticeVerdictPill, queuedLine, stepCursor, type QueueNotice } from "@/lib/review/queue";
import { NOTICE_DISMISSED, scopeOfReason, type DecisionStatus, type StrengthTagId } from "@/lib/review/reasons";
import { cn } from "@/lib/utils/cn";
import { useSubmitTransition } from "@/lib/hooks/use-submit-transition";

export type ReviewMode = "list" | "focus";

export type ReviewScreenProps = {
  engine: FitEngine;
  available: boolean;
  decisionsAvailable: boolean;
  notices: readonly QueueNotice[];
  /** Confirmed matches across the queue as the server counted them. */
  confirmedInQueue: number;
  selectedId: string | null;
  notice: ReviewNoticeData | null;
  viewerId: string;
  /** R35: owners and admins adjudicate disagreements. */
  viewerIsAdmin: boolean;
  /** R35: from `?filter=` — Everything, Needs your call, Disagreements. */
  filter?: ReviewFilter;
  /** The viewer's leads switch (R32): whether the queue was read with the three best Exploratory leads per notice. */
  showExploratory: boolean;
  /** From `?mode=`: Focus mode survives a navigation to the next notice because it is in the URL. */
  mode?: ReviewMode;
  /** N2: the strip under the title — what arrived since the viewer last looked, the stale-feed warning, and the office's other business. Null when the caller does not read it. */
  overnight?: OvernightData | null;
  density?: Density;
};

type BulkNote = { n: number; whole: boolean; ids: string[] };

/** The page's URL for a notice, keeping Focus mode when it is on. */
export const reviewHref = (noticeId: string, focus: boolean, filter: ReviewFilter = "all"): string => `/review?notice=${noticeId}${focus ? "&mode=focus" : ""}${filter !== "all" ? `&filter=${filter}` : ""}`;

const typing = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable));
};

/**
 * Review (README §2 list mode, §3 Focus mode, §4 the drawers). The client
 * boundary: the server page loads the queue and the selected notice and hands
 * them down as plain data; every handler — decide, undo, the bulk clear, the
 * tags, the keyboard, the drawers — is created here.
 *
 * **State**: `cursor`, `rejecting` (the row with its reasons open), `open`
 * (the row with its assessment expanded, list mode), `bulkNote`, `focus`,
 * `drawer` (the one open drawer), the on-demand Focus profiles, plus `local`
 * — the decisions made since the server rendered. Each write lands
 * optimistically, the server action runs, and `router.refresh()` brings the
 * page back into agreement (which clears `local`, because the props it
 * overrode are new). A failed write reverts the row and says why.
 *
 * **`decide` advances** (README §"Interactions & behaviour"): to the next
 * undecided match on this notice; failing that, to the next notice in the
 * queue with something undecided — a navigation, since the queue is the URL,
 * and Focus mode rides along in `?mode=focus`. With nothing undecided
 * anywhere, Focus mode shows "Every suggestion is decided."
 *
 * **Keys**: list mode J / K · C · X · W · E · F; Focus mode 1 / 2 / 3 · J / K ·
 * Esc (the open drawer closes itself; then the reasons panel; then Focus) ·
 * F. Never while a modifier is held or the target is a field.
 */
export function ReviewScreen({ engine, available, decisionsAvailable, notices, confirmedInQueue, selectedId, notice, viewerId, viewerIsAdmin, showExploratory, filter = "all", mode = "list", density = "comfortable", overnight = null }: ReviewScreenProps) {
  const router = useRouter();
  const toast = useToast();
  const [switching, startSwitch] = useSubmitTransition();
  const [, startTransition] = useSubmitTransition();
  /** The leads switch writes the viewer's preference and re-reads the page; the badge does not move (R32). */
  const toggleLeads = () =>
    startSwitch(async () => {
      const r = await setReviewExploratoryAction(!showExploratory);
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      router.refresh();
    });
  const [local, setLocal] = useState<Map<string, MatchDecision | null>>(new Map());
  const [cursor, setCursor] = useState(() => (notice ? firstUndecided(notice.rows.map((r) => ({ undecided: !r.decision && !r.doNotContact }))) : 0));
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [bulk, setBulk] = useState<BulkNote | null>(null);
  const [itemId, setItemId] = useState<string | null>(notice?.itemId ?? null);
  const [focus, setFocusState] = useState(mode === "focus");
  /** The side-by-side comparison (the brief's open item): opens over the list, on the same rows. */
  const [compare, setCompare] = useState(false);
  const [drawer, setDrawer] = useState<DrawerKind | null>(null);
  const [profiles, setProfiles] = useState<Map<string, FocusProfile>>(new Map());
  const [profileLoading, setProfileLoading] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  // N2: stamp the visit once the page has rendered, as Today did, so the strip's window moves forward across days
  // (the window is floored at the Pacific day, so the line does not change under the viewer on a refresh).
  const hasOvernight = overnight !== null;
  useEffect(() => {
    if (!hasOvernight) return;
    const t = setTimeout(() => { void markDiscoverVisitAction(); }, 4000);
    return () => clearTimeout(t);
  }, [hasOvernight]);

  // New props are the server's answer to the last write: the overrides are
  // spent. The cursor keeps its place; a new notice starts it at the first
  // undecided row.
  const noticeId = notice?.header.id ?? null;
  useEffect(() => {
    setLocal(new Map());
    setItemId(notice?.itemId ?? null);
  }, [notice]);
  useEffect(() => {
    setCursor(notice ? firstUndecided(notice.rows.map((r) => ({ undecided: !r.decision && !r.doNotContact }))) : 0);
    setRejecting(null);
    setOpen(null);
    setBulk(null);
    setDrawer(null);
  }, [noticeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const allRows: FocusRow[] = useMemo(() => (notice?.rows ?? []).map((r) => ({ ...r, decision: local.has(r.investigatorId) ? (local.get(r.investigatorId) ?? null) : r.decision })), [notice, local]);
  const viewer = useMemo(() => ({ id: viewerId, isAdmin: viewerIsAdmin }), [viewerId, viewerIsAdmin]);
  // R35: under a filter the list shows only the rows it names; counts and bulk verbs still speak for the whole notice.
  const rows: FocusRow[] = useMemo(() => (filter === "all" ? allRows : allRows.filter((r) => passesFilter(r.decision, filter, viewer))), [allRows, filter, viewer]);
  const counts = useMemo(() => noticeCounts(allRows.map((r) => ({ tier: r.tier, decision: r.decision, doNotContact: r.doNotContact }))), [allRows]);
  const undecidedIds = useMemo(() => allRows.filter((r) => !r.decision && !r.doNotContact).map((r) => r.investigatorId), [allRows]);
  const shownNotices = useMemo(() => (filter === "all" ? notices : notices.filter((n) => (filter === "calls" ? n.calls : n.disagreements) > 0)), [notices, filter]);
  const filterTotals = useMemo(() => ({ calls: notices.reduce((n, x) => n + x.calls, 0), disagreements: notices.reduce((n, x) => n + x.disagreements, 0) }), [notices]);
  const confirmedTotal = notice ? confirmedInQueue - notice.counts.confirmed + counts.confirmed : confirmedInQueue;
  const queueTotals = useMemo(() => {
    const undecided = notices.reduce((n, x) => n + x.counts.undecided, 0);
    const total = notices.reduce((n, x) => n + x.counts.suggested, 0);
    return { undecided: notice ? undecided - notice.counts.undecided + counts.undecided : undecided, total };
  }, [notices, notice, counts.undecided]);
  const current = rows[Math.min(cursor, Math.max(0, rows.length - 1))] ?? null;

  /**
   * Focus mode is in the URL so a navigation to the next notice keeps it. The
   * state flips at once; the URL follows through the router's own replace,
   * because a bare `history.replaceState` was undone by the next
   * `router.refresh()` — the router restored the URL it knew, and a reload
   * then reopened the mode the reader had just left.
   */
  const setFocus = useCallback(
    (on: boolean) => {
      setFocusState(on);
      setDrawer(null);
      setRejecting(null);
      setOpen(null);
      if (noticeId) router.replace(reviewHref(noticeId, on, filter), { scroll: false });
    },
    [noticeId, router, filter],
  );

  // Focus mode reads the candidate's evidence when they come into view, once per person per page.
  useEffect(() => {
    if (!focus || !current || profiles.has(current.investigatorId) || profileLoading === current.investigatorId) return;
    const id = current.investigatorId;
    const cited = current.citedIds;
    setProfileLoading(id);
    loadFocusProfileAction({ investigatorId: id, citedIds: cited }).then((r) => {
      if (r.ok) setProfiles((m) => new Map(m).set(id, r.profile));
      else toast({ message: r.error, tone: "error" });
      setProfileLoading((x) => (x === id ? null : x));
    });
  }, [focus, current, profiles, profileLoading, toast]);

  const override = useCallback((entries: Array<[string, MatchDecision | null]>) => {
    setLocal((m) => {
      const next = new Map(m);
      for (const [id, d] of entries) next.set(id, d);
      return next;
    });
  }, []);
  const revert = useCallback((ids: string[]) => {
    setLocal((m) => {
      const next = new Map(m);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  /** The next notice in the queue with something undecided, or null. */
  const nextNoticeWithWork = useCallback((): QueueNotice | null => {
    const at = notices.findIndex((n) => n.id === noticeId);
    for (let step = 1; step <= notices.length; step++) {
      const n = notices[(at + step) % notices.length]!;
      if (n.id !== noticeId && n.counts.undecided > 0) return n;
    }
    return null;
  }, [notices, noticeId]);

  /** After a decision: the next undecided row here, else the next notice with one. */
  const advance = useCallback(
    (decidedId: string) => {
      const after = rows.map((r) => ({ undecided: r.investigatorId !== decidedId && !r.decision && !r.doNotContact }));
      const here = rows.findIndex((r) => r.investigatorId === decidedId);
      const next = nextUndecided(after, here < 0 ? cursor : here);
      if (next != null) return setCursor(next);
      const n = nextNoticeWithWork();
      if (n) router.push(reviewHref(n.id, focus, filter));
    },
    [rows, cursor, nextNoticeWithWork, router, focus, filter],
  );

  const decide = useCallback(
    (investigatorId: string, status: DecisionStatus, reason: string | null) => {
      if (!notice || !decisionsAvailable) return;
      const row = rows.find((r) => r.investigatorId === investigatorId);
      if (!row) return;
      const scope = status === "rejected" ? scopeOfReason(reason) : "pair";
      const also = scope === "notice" ? undecidedIds.filter((id) => id !== investigatorId) : [];
      const now = new Date().toISOString();
      const mine = (id: string, auto: boolean): MatchDecision => ({ opportunityId: notice.header.id, investigatorId: id, status, reason, scope, auto, resurfaceOn: null, verdictLabel: auto ? null : row.verdicts.label, decidedBy: viewerId, decidedAt: now });
      override([[investigatorId, mine(investigatorId, false)], ...also.map((id): [string, MatchDecision] => [id, mine(id, true)])]);
      setRejecting(null);
      setDrawer(null);
      advance(investigatorId);
      startTransition(async () => {
        const r = await decideMatchAction({ opportunityId: notice.header.id, investigatorId, status, reason, label: row.verdicts.label, alsoClear: also });
        if (!r.ok) {
          revert([investigatorId, ...also]);
          toast({ message: r.error, tone: "error" });
          return;
        }
        if (also.length) {
          // Only the rows the server actually cleared: a teammate's earlier decision on one of them stands.
          revert(also.filter((id) => !r.cleared.includes(id)));
          if (r.cleared.length) setBulk({ n: r.cleared.length, whole: false, ids: r.cleared });
        }
        // The server's record replaces the optimistic one: it carries the
        // watch's return day, which the page could not compute.
        override([[investigatorId, r.decision]]);
        if (r.itemId) setItemId(r.itemId);
        router.refresh();
      });
    },
    [notice, decisionsAvailable, rows, undecidedIds, viewerId, override, revert, advance, toast, router, startTransition],
  );

  const undo = useCallback(
    (investigatorId: string) => {
      if (!notice) return;
      override([[investigatorId, null]]);
      startTransition(async () => {
        const r = await undoDecisionAction({ opportunityId: notice.header.id, investigatorId });
        if (!r.ok) {
          revert([investigatorId]);
          toast({ message: r.error, tone: "error" });
          return;
        }
        router.refresh();
      });
    },
    [notice, override, revert, toast, router, startTransition],
  );

  const undoBulk = useCallback(() => {
    if (!notice || !bulk) return;
    const ids = bulk.ids;
    override(ids.map((id): [string, null] => [id, null]));
    setBulk(null);
    startTransition(async () => {
      const r = await undoClearedAction({ opportunityId: notice.header.id, investigatorIds: ids });
      if (!r.ok) {
        revert(ids);
        toast({ message: r.error, tone: "error" });
        return;
      }
      router.refresh();
    });
  }, [notice, bulk, override, revert, toast, router, startTransition]);

  const dismissAll = useCallback(() => {
    if (!notice || !undecidedIds.length) return;
    const ids = undecidedIds;
    const now = new Date().toISOString();
    override(ids.map((id): [string, MatchDecision] => [id, { opportunityId: notice.header.id, investigatorId: id, status: "rejected", reason: NOTICE_DISMISSED, scope: "notice", auto: true, resurfaceOn: null, verdictLabel: null, decidedBy: viewerId, decidedAt: now }]));
    setRejecting(null);
    setBulk({ n: ids.length, whole: true, ids });
    startTransition(async () => {
      const r = await dismissNoticeAction({ opportunityId: notice.header.id, investigatorIds: ids });
      if (!r.ok) {
        revert(ids);
        setBulk(null);
        toast({ message: r.error, tone: "error" });
        return;
      }
      setBulk({ n: r.cleared.length, whole: true, ids: r.cleared });
      router.refresh();
    });
  }, [notice, undecidedIds, viewerId, override, revert, toast, router, startTransition]);

  const tag = useCallback(
    (investigatorId: string, tagId: StrengthTagId | null) => {
      if (!notice) return;
      const row = rows.find((r) => r.investigatorId === investigatorId);
      if (!row?.decision || row.decision.status !== "confirmed") return;
      override([[investigatorId, { ...row.decision, reason: tagId }]]);
      startTransition(async () => {
        const r = await tagConfirmationAction({ opportunityId: notice.header.id, investigatorId, tag: tagId });
        if (!r.ok) toast({ message: r.error, tone: "error" });
        router.refresh();
      });
    },
    [notice, rows, override, toast, router, startTransition],
  );

  /** "Skip this match": the next undecided row, without deciding this one. */
  const skip = useCallback(() => {
    const next = nextUndecided(
      rows.map((r) => ({ undecided: !r.decision && !r.doNotContact })),
      cursor,
    );
    setRejecting(null);
    if (next != null) setCursor(next);
  }, [rows, cursor]);

  /** "Skip the rest of this notice →": the next notice, in the same mode. */
  const skipNotice = useCallback(() => {
    const at = notices.findIndex((n) => n.id === noticeId);
    const n = notices.length > 1 && at >= 0 ? notices[(at + 1) % notices.length]! : null;
    if (n) router.push(reviewHref(n.id, focus, filter));
  }, [notices, noticeId, router, focus, filter]);

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "f" && rows.length) {
        e.preventDefault();
        return setFocus(!focus);
      }
      if (!rows.length) return;
      const row = rows[Math.min(cursor, rows.length - 1)]!;
      const undecided = !row.decision && !row.doNotContact;
      if (k === "j" || k === "k") {
        e.preventDefault();
        const next = stepCursor(cursor, k === "j" ? 1 : -1, rows.length);
        setCursor(next);
        setRejecting(null);
        if (!focus) rowRefs.current.get(rows[next]!.investigatorId)?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (focus) {
        // The open drawer takes Esc itself (SlideOver's modal contract); the
        // chain below is what is left once it has closed.
        if (e.key === "Escape") {
          if (drawer) return;
          e.preventDefault();
          if (rejecting) return setRejecting(null);
          return setFocus(false);
        }
        if ((k === "1" || k === "2" || k === "3") && undecided && decisionsAvailable) {
          e.preventDefault();
          const label = row.flag && !row.decision ? "ruled_out" : row.verdicts.label;
          const a = focusActions(label).find((x) => x.key === k)!;
          if (a.opensReasons) return setRejecting((r) => (r === row.investigatorId ? null : row.investigatorId));
          return decide(row.investigatorId, a.status, a.reason);
        }
        return;
      }
      if (k === "c" && undecided) {
        e.preventDefault();
        decide(row.investigatorId, "confirmed", null);
      } else if (k === "x" && undecided) {
        e.preventDefault();
        setRejecting((r) => (r === row.investigatorId ? null : row.investigatorId));
      } else if (k === "w" && undecided) {
        e.preventDefault();
        decide(row.investigatorId, "watch", null);
      } else if (k === "e" && row.disclosure) {
        e.preventDefault();
        setOpen((o) => (o === row.investigatorId ? null : row.investigatorId));
      } else if (e.key === "Escape" && rejecting) {
        e.preventDefault();
        setRejecting(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, cursor, rejecting, decide, focus, drawer, decisionsAvailable, setFocus]);

  const at = notices.findIndex((n) => n.id === noticeId);
  const nextNotice = notices.length > 1 && at >= 0 ? notices[(at + 1) % notices.length]! : null;
  const draftHref = `/outreach/draft?from=review${itemId ? `&item=${itemId}` : ""}`;
  // On a limited submission the choice is which one, so the comparison leads and Focus mode follows.
  const limited = notice?.header.flag === "Limited submission";
  const cap = notice?.header.detail.facts.find((f) => f.label === "Submissions")?.value ?? null;
  const ready = engine === "fit-v1" && available && notices.length > 0;

  return (
    <div className={PAGE}>
      <div className={PAGE_HEADER}>
        <h1 className={H1}>Discover</h1>
        <div className={HEADER_ACTIONS_GROUP}>
          {engine === "fit-v1" && available ? (
            <button type="button" role="switch" aria-checked={showExploratory} onClick={toggleLeads} disabled={switching} className={cn(LEADS_SWITCH, showExploratory ? LEADS_SWITCH_TONE.on : LEADS_SWITCH_TONE.off)} title="Off: a notice lists its Strong and Moderate matches. On: the three best Exploratory leads too. Your setting only.">
              {`Exploratory leads · ${showExploratory ? "on" : "off"}`}
            </button>
          ) : null}
          {ready && !focus ? (
            <div className={FILTER_CHIPS} role="group" aria-label="Show">
              {(["all", "calls", "disagreements"] as const).map((f) => (
                <Link key={f} href={selectedId ? reviewHref(selectedId, false, f) : `/review${f === "all" ? "" : `?filter=${f}`}`} aria-pressed={filter === f} className={cn(FILTER_CHIP, filter === f ? FILTER_CHIP_TONE.on : FILTER_CHIP_TONE.off)}>
                  {filterLabel(f, f === "calls" ? filterTotals.calls : filterTotals.disagreements)}
                </Link>
              ))}
            </div>
          ) : null}
          {ready && notice && rows.length >= 2 && !focus ? (
            <button type="button" onClick={() => setCompare(true)} className={limited ? BTN_PRIMARY_30 : BTN_SECONDARY_30}>
              {compareButtonLabel(limited)}
            </button>
          ) : null}
          {ready && notice && rows.length ? (
            focus ? (
              <button type="button" onClick={() => setFocus(false)} className={BTN_SECONDARY_30}>
                ← Back to list mode
              </button>
            ) : (
              <button type="button" onClick={() => setFocus(true)} className={limited ? BTN_SECONDARY_30 : BTN_PRIMARY_30}>
                Focus mode
              </button>
            )
          ) : null}
        </div>
      </div>

      {overnight ? (
        <p className={SUB}>
          {overnight.line.map((s) => (s.href ? <Link key={s.text} href={s.href} className={SUB_LINK}>{s.text}</Link> : <span key={s.text}>{s.text}</span>))}
        </p>
      ) : null}
      {overnight?.feedStale ? (
        <div role="status" className={STALE}>
          <span><span className="font-semibold">Funding feed is {overnight.feedStale.hours} hours old.</span> New notices and deadline changes since {overnight.feedStale.since} may be missing.</span>
          <Link href="/team/data-sources" className={STALE_LINK}>Data sources →</Link>
        </div>
      ) : null}
      {overnight?.also.length ? (
        <nav className={ALSO} aria-label="Also waiting">
          <span className={ALSO_LABEL}>Also waiting</span>
          {overnight.also.map((a) => (
            <Link key={a.key} href={a.href} title={a.meta} className={ALSO_CHIP}>
              <span className="truncate">{a.title}</span>
              <span className={cn(ALSO_WHEN, ALSO_WHEN_TONE[a.whenTone])}>{a.when}</span>
            </Link>
          ))}
        </nav>
      ) : null}

      {engine !== "fit-v1" ? (
        <StateCard title="Discover needs the fit engine." body="This team is on the legacy suggestion engine, which ranks people per notice inside Outreach. Discover reads the fit engine's nightly results." />
      ) : !available ? (
        <StateCard title="Fit results are not available yet." body="The nightly fit-results run has not written anything this page can read." />
      ) : !notices.length ? (
        <StateCard title="Nothing is waiting for a decision." body="A notice enters this queue when the directory holds a Strong or Moderate match for it. Nothing is contacted until you decide." />
      ) : focus && notice ? (
        <>
          {!decisionsAvailable ? <p className="mt-3 rounded-card border border-warning-border bg-warning-tint px-4 py-2.5 text-dense text-warning-dark">Decisions cannot be recorded yet — the match-decisions migration has not been applied. The rows read; nothing here writes.</p> : null}
          <FocusView
            header={notice.header}
            rows={rows}
            cursor={cursor}
            noticeIndex={Math.max(0, at)}
            noticeCount={notices.length}
            queueUndecided={queueTotals.undecided}
            queueTotal={queueTotals.total}
            confirmedTotal={confirmedTotal}
            profile={current ? (profiles.get(current.investigatorId) ?? null) : null}
            profileLoading={Boolean(current && profileLoading === current.investigatorId)}
            rejecting={Boolean(current && rejecting === current.investigatorId)}
            undecidedOnNotice={undecidedIds.length}
            canDecide={decisionsAvailable}
            onDecide={decide}
            onOpenReasons={() => current && setRejecting((r) => (r === current.investigatorId ? null : current.investigatorId))}
            onSkip={skip}
            onSkipNotice={skipNotice}
            onJump={(i) => {
              setCursor(i);
              setRejecting(null);
            }}
            onOpenDrawer={setDrawer}
            onExitFocus={() => setFocus(false)}
          />
          {current ? (
            <>
              <ProfileDrawer open={drawer === "profile"} onClose={() => setDrawer(null)} row={current} profile={profiles.get(current.investigatorId) ?? null} />
              <OpportunityDrawer open={drawer === "opportunity"} onClose={() => setDrawer(null)} header={notice.header} />
              <AssessmentDrawer
                open={drawer === "assessment"}
                onClose={() => setDrawer(null)}
                row={current}
                noticeNumber={notice.header.number}
                canDecide={decisionsAvailable}
                onDecide={(status, reason) => decide(current.investigatorId, status, reason)}
                onOpenReasons={() => {
                  setDrawer(null);
                  setRejecting(current.investigatorId);
                }}
              />
            </>
          ) : null}
        </>
      ) : (
        <div className={LAYOUT}>
          <NoticeQueue notices={shownNotices} selectedId={selectedId} counts={notice ? counts : null} filter={filter} />

          <div className={MAIN_COLUMN}>
            {notice ? (
              <>
                {!decisionsAvailable ? (
                  <p className="m-0 rounded-card border border-warning-border bg-warning-tint px-4 py-2.5 text-dense text-warning-dark">Decisions cannot be recorded yet — the match-decisions migration has not been applied. The rows read; nothing here writes.</p>
                ) : null}
                <NoticeHeader header={notice.header} verdict={noticeVerdictPill(counts)} undecided={undecidedIds.length} bulkWhole={Boolean(bulk?.whole)} canDecide={decisionsAvailable} onDismissAll={dismissAll} onUndoBulk={undoBulk} />

                <section className={CARD}>
                  {bulk ? (
                    <div className={BULK_BANNER} role="status">
                      <p className={BULK_TEXT}>{bulkNoteText(bulk)}</p>
                      <button type="button" onClick={undoBulk} className={BTN_WARN_26}>
                        Undo
                      </button>
                    </div>
                  ) : null}
                  <div className={ROWS_HEADER}>
                    <div className="flex items-baseline gap-3">
                      <h3 className={ROWS_TITLE}>Suggested investigators</h3>
                      <span className={ROWS_DECIDED}>{decidedLine(counts)}</span>
                    </div>
                  </div>

                  {!rows.length && filter !== "all" ? (
                    <p className={FILTER_EMPTY}>{filter === "calls" ? "Nothing on this notice waits on your call." : "No decision on this notice disagrees with Prospera or with a teammate."}</p>
                  ) : null}
                  {rows.length ? (
                    rows.map((r, i) => (
                      <MatchRow
                        key={r.investigatorId}
                        ref={(el) => {
                          if (el) rowRefs.current.set(r.investigatorId, el);
                          else rowRefs.current.delete(r.investigatorId);
                        }}
                        row={r}
                        focused={i === cursor}
                        open={open === r.investigatorId}
                        rejecting={rejecting === r.investigatorId}
                        density={density}
                        undecidedOnNotice={undecidedIds.length}
                        canDecide={decisionsAvailable}
                        onFocus={() => setCursor(i)}
                        onDecide={(status, reason) => decide(r.investigatorId, status, reason)}
                        onOpenReasons={() => {
                          setCursor(i);
                          setRejecting((x) => (x === r.investigatorId ? null : r.investigatorId));
                        }}
                        onUndo={() => undo(r.investigatorId)}
                        onToggle={() => setOpen((o) => (o === r.investigatorId ? null : r.investigatorId))}
                        onTag={(t) => tag(r.investigatorId, t)}
                      />
                    ))
                  ) : (
                    <p className={cn(EMPTY_ROWS, "border-t border-line-row")}>{notice.emptyText ?? "No suggested investigators on this notice."}</p>
                  )}

                  <div className={ROWS_FOOTER}>
                    <p className={FOOTER_NOTE}>{footerLine({ ruledOutEligibility: notice.ruledOutEligibility, belowFloors: notice.belowFloors, hiddenExploratory: notice.hiddenExploratory, leadsShown: showExploratory }) ?? "Every match the engine surfaced for this notice is listed."}</p>
                    {nextNotice ? (
                      <Link href={reviewHref(nextNotice.id, false, filter)} className={BTN_SECONDARY_30}>
                        Next notice →
                      </Link>
                    ) : null}
                  </div>
                </section>
              </>
            ) : (
              <StateCard title="Pick a notice." body="Choose a notice on the left to see its suggested investigators." />
            )}
          </div>
        </div>
      )}

      {confirmedTotal > 0 && engine === "fit-v1" ? (
        <div className={QUEUED_BAR} role="status">
          <p className={QUEUED_TEXT}>{queuedLine(confirmedTotal)}</p>
          <div className="flex gap-2">
            <Link href="/outreach" className={QUEUED_GHOST}>
              Review the pipeline
            </Link>
            <Link href={draftHref} className={QUEUED_WHITE}>
              Draft outreach →
            </Link>
          </div>
        </div>
      ) : null}
      {notice ? <CompareDrawer open={compare} onClose={() => setCompare(false)} rows={rows} limited={limited} cap={cap} decisionsAvailable={decisionsAvailable} onDecide={(investigatorId, status) => decide(investigatorId, status, null)} /> : null}
    </div>
  );
}

function StateCard({ title, body }: { title: string; body: string }) {
  return (
    <section className={cn(CARD, "mt-4 px-5 py-4")}>
      <p className="m-0 text-[15px] font-semibold text-ink">{title}</p>
      <p className="mb-0 mt-1 max-w-[72ch] text-dense leading-normal text-ink-muted">{body}</p>
    </section>
  );
}
