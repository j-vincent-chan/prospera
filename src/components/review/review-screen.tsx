"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { decideMatchAction, dismissNoticeAction, tagConfirmationAction, undoClearedAction, undoDecisionAction } from "@/app/actions/review-actions";
import { MatchRow, type Density } from "@/components/review/match-row";
import { NoticeHeader } from "@/components/review/notice-header";
import { NoticeQueue } from "@/components/review/notice-queue";
import { BTN_SECONDARY_30, BTN_WARN_26, BULK_BANNER, BULK_TEXT, CARD, EMPTY_ROWS, FOOTER_NOTE, H1, LAYOUT, MAIN_COLUMN, PAGE, PAGE_HEADER, QUEUED_BAR, QUEUED_GHOST, QUEUED_TEXT, QUEUED_WHITE, ROWS_DECIDED, ROWS_FOOTER, ROWS_HEADER, ROWS_TITLE } from "@/components/review/review-view";
import { useToast } from "@/components/ui/toast";
import type { FitEngine } from "@/lib/fit/flag";
import type { MatchDecision } from "@/lib/review/decisions";
import type { ReviewNoticeData } from "@/lib/review/queries";
import { bulkNoteText, decidedLine, firstUndecided, footerLine, nextUndecided, noticeCounts, noticeVerdictPill, queuedLine, stepCursor, type QueueNotice } from "@/lib/review/queue";
import { NOTICE_DISMISSED, scopeOfReason, type DecisionStatus, type StrengthTagId } from "@/lib/review/reasons";
import { cn } from "@/lib/utils/cn";

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
  density?: Density;
};

type BulkNote = { n: number; whole: boolean; ids: string[] };

/**
 * Review, list mode (README §2). The client boundary: the server page loads
 * the queue and the selected notice and hands them down as plain data; every
 * handler — decide, undo, the bulk clear, the tags, the keyboard — is created
 * here.
 *
 * **State** is the README's list-mode subset: `cursor`, `rejecting` (the row
 * with its reasons open), `open` (the row with its assessment expanded),
 * `bulkNote`, plus `local`, the decisions made since the server rendered —
 * each write lands optimistically, the server action runs, and
 * `router.refresh()` brings the page back into agreement (which clears
 * `local`, because the props it overrode are new). A failed write reverts the
 * row and says why.
 *
 * **`decide` advances** (README §"Interactions & behaviour"): to the next
 * undecided match on this notice; failing that, to the next notice in the
 * queue with something undecided, which is a navigation, since the queue is
 * the URL.
 */
export function ReviewScreen({ engine, available, decisionsAvailable, notices, confirmedInQueue, selectedId, notice, viewerId, density = "comfortable" }: ReviewScreenProps) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [local, setLocal] = useState<Map<string, MatchDecision | null>>(new Map());
  const [cursor, setCursor] = useState(() => (notice ? firstUndecided(notice.rows.map((r) => ({ undecided: !r.decision && !r.doNotContact }))) : 0));
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [bulk, setBulk] = useState<BulkNote | null>(null);
  const [itemId, setItemId] = useState<string | null>(notice?.itemId ?? null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

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
  }, [noticeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => (notice?.rows ?? []).map((r) => ({ ...r, decision: local.has(r.investigatorId) ? (local.get(r.investigatorId) ?? null) : r.decision })), [notice, local]);
  const counts = useMemo(() => noticeCounts(rows.map((r) => ({ tier: r.tier, decision: r.decision, doNotContact: r.doNotContact }))), [rows]);
  const undecidedIds = useMemo(() => rows.filter((r) => !r.decision && !r.doNotContact).map((r) => r.investigatorId), [rows]);
  const confirmedTotal = notice ? confirmedInQueue - notice.counts.confirmed + counts.confirmed : confirmedInQueue;

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

  /** After a decision: the next undecided row here, else the next notice with one. */
  const advance = useCallback(
    (decidedId: string) => {
      const after = rows.map((r) => ({ undecided: r.investigatorId !== decidedId && !r.decision && !r.doNotContact }));
      const here = rows.findIndex((r) => r.investigatorId === decidedId);
      const next = nextUndecided(after, here < 0 ? cursor : here);
      if (next != null) return setCursor(next);
      const at = notices.findIndex((n) => n.id === noticeId);
      for (let step = 1; step <= notices.length; step++) {
        const n = notices[(at + step) % notices.length]!;
        if (n.id !== noticeId && n.counts.undecided > 0) return router.push(`/review?notice=${n.id}`);
      }
    },
    [rows, cursor, notices, noticeId, router],
  );

  const decide = useCallback(
    (investigatorId: string, status: DecisionStatus, reason: string | null) => {
      if (!notice || !decisionsAvailable) return;
      const row = rows.find((r) => r.investigatorId === investigatorId);
      if (!row) return;
      const scope = status === "rejected" ? scopeOfReason(reason) : "pair";
      const also = scope === "notice" ? undecidedIds.filter((id) => id !== investigatorId) : [];
      const now = new Date().toISOString();
      const mine = (id: string, auto: boolean): MatchDecision => ({ opportunityId: notice.header.id, investigatorId: id, status, reason, scope, auto, resurfaceOn: null, verdictLabel: row.verdicts.label, decidedBy: viewerId, decidedAt: now });
      override([[investigatorId, mine(investigatorId, false)], ...also.map((id): [string, MatchDecision] => [id, mine(id, true)])]);
      setRejecting(null);
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
        if (r.itemId) setItemId(r.itemId);
        router.refresh();
      });
    },
    [notice, decisionsAvailable, rows, undecidedIds, viewerId, override, revert, advance, toast, router],
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
    [notice, override, revert, toast, router],
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
  }, [notice, bulk, override, revert, toast, router]);

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
  }, [notice, undecidedIds, viewerId, override, revert, toast, router]);

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
    [notice, rows, override, toast, router],
  );

  // ---- keyboard (README §2 "Keyboard (list mode)"): J / K · C · X · W · E ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (!rows.length) return;
      const k = e.key.toLowerCase();
      const row = rows[Math.min(cursor, rows.length - 1)]!;
      const undecided = !row.decision && !row.doNotContact;
      if (k === "j" || k === "k") {
        e.preventDefault();
        const next = stepCursor(cursor, k === "j" ? 1 : -1, rows.length);
        setCursor(next);
        rowRefs.current.get(rows[next]!.investigatorId)?.scrollIntoView({ block: "nearest" });
      } else if (k === "c" && undecided) {
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
  }, [rows, cursor, rejecting, decide]);

  const at = notices.findIndex((n) => n.id === noticeId);
  const nextNotice = notices.length > 1 && at >= 0 ? notices[(at + 1) % notices.length]! : null;
  const draftHref = itemId ? `/outreach?item=${itemId}&tab=compose` : "/outreach";

  return (
    <div className={PAGE}>
      <div className={PAGE_HEADER}>
        <h1 className={H1}>Review</h1>
      </div>

      {engine !== "fit-v1" ? (
        <StateCard title="Review needs the fit engine." body="This team is on the legacy suggestion engine, which ranks people per notice inside Outreach. Review reads the fit engine's nightly results." />
      ) : !available ? (
        <StateCard title="Fit results are not available yet." body="The nightly fit-results run has not written anything this page can read." />
      ) : !notices.length ? (
        <StateCard title="Nothing is waiting for a decision." body="A notice enters this queue when the directory holds a Strong or Moderate match for it. Nothing is contacted until you decide." />
      ) : (
        <div className={LAYOUT}>
          <NoticeQueue notices={notices} selectedId={selectedId} counts={notice ? counts : null} />

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
                    <p className={FOOTER_NOTE}>{footerLine({ ruledOutEligibility: notice.ruledOutEligibility, belowFloors: notice.belowFloors, hiddenExploratory: notice.hiddenExploratory }) ?? "Every match the engine surfaced for this notice is listed."}</p>
                    {nextNotice ? (
                      <Link href={`/review?notice=${nextNotice.id}`} className={BTN_SECONDARY_30}>
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
