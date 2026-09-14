"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useEffect } from "react";
import { recordReplyAction, removeRecipientAction } from "@/app/actions/outreach-actions";
import { logMatchCallAction, restoreMatchStageAction, setMatchNextStepAction, setMatchOwnerAction, setMatchStageAction } from "@/app/actions/outreach-match-actions";
import { undoDecisionAction } from "@/app/actions/review-actions";
import { OutreachWorkspace } from "@/components/outreach/outreach-workspace";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Pill, type PillVariant } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import type { MatchBoard } from "@/lib/outreach/match-queries";
import { draftLabel, FILTER_ORDER, filterLabel, GROUP_ORDER, GROUP_TITLE, groupCount, groupSub, headerLine, matchesFilter, type MatchAction, type MatchFilter, type MatchRow, type PillTone } from "@/lib/outreach/matches";
import type { WorkspaceData } from "@/lib/outreach/queries";
import { OUTCOME_LABEL, type Outcome } from "@/lib/outreach/types";
import { cn } from "@/lib/utils/cn";
import { useSubmitTransition } from "@/lib/hooks/use-submit-transition";

type Props = {
  board: MatchBoard;
  workspace: WorkspaceData | null;
  workspaceTab: "recipients" | "compose" | "activity";
  evidenceFor: string | null;
  viewer: { id: string; name: string; title: string | null; isAdmin?: boolean };
  /** `?item=` named an item the loader could not find on this team: say so instead of landing in silence. */
  missingItem?: boolean;
};

/** The board's URL, with the workspace open on an item when one is named. */
export function boardHref(input: { item?: string | null; tab?: string | null; evidence?: string | null }): string {
  const p = new URLSearchParams();
  if (input.item) p.set("item", input.item);
  if (input.tab && input.tab !== "recipients") p.set("tab", input.tab);
  if (input.evidence) p.set("evidence", input.evidence);
  const qs = p.toString();
  return qs ? `/outreach?${qs}` : "/outreach";
}

// ---------------------------------------------------------------------------
// The design's table (README §5): every class a token, none named twice.
// ---------------------------------------------------------------------------

const H1 = "m-0 text-h1 font-semibold text-ink";
const SUB = "mb-0 mt-[7px] text-body text-ink-muted";
const DRAFT_BTN = "inline-flex h-[34px] shrink-0 items-center whitespace-nowrap rounded-control border border-navy bg-navy px-3 text-body font-medium text-white hover:border-navy-hover hover:bg-navy-hover";
const CHIP = "inline-flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-control border px-3 text-dense font-medium";
const CHIP_STATE = { on: "border-navy bg-navy text-white", off: "border-line bg-card text-ink-body hover:border-line-control" } as const;
const GROUP = "overflow-hidden rounded-card border border-line bg-card";
const GROUP_HEAD = "flex flex-wrap items-baseline justify-between gap-4 border-b border-line bg-footer-bar px-[18px] py-3";
const GROUP_TITLE_CLASS = "m-0 text-body font-semibold text-ink";
const GROUP_SUB = "text-meta text-ink-muted";
const GROUP_COUNT = "text-meta tabular-nums text-ink-muted";
/**
 * `minmax(180px,1.1fr) minmax(0,1.6fr) 132px 150px 116px`, gap 14, min-width 940 inside a scrolling wrap — from `md`.
 * Below `md` the table becomes cards (Mobile v2 §Responsive rules): one column per row, no header row, the owner
 * on the left like everything else.
 */
const TABLE_WRAP = "overflow-x-auto";
const TABLE_MIN = "md:min-w-[940px]";
const COLS = "grid grid-cols-1 gap-1.5 md:grid-cols-[minmax(180px,1.1fr)_minmax(0,1.6fr)_132px_150px_116px] md:gap-3.5";
const HEAD_ROW = `${COLS} border-b border-line-row px-[18px] py-[9px] max-md:hidden`;
const EYEBROW = "text-label font-semibold uppercase tracking-[0.08em] text-ink-muted";
const ROW_BTN = `${COLS} w-full items-center px-[18px] py-3 text-left hover:bg-canvas`;
const ROW_WRAP = "border-t border-line-row";
const ROW_WRAP_OPEN = "bg-teal-tint/20";
const NAME = "block text-body font-semibold leading-[1.35] text-ink";
const DEPT = "mt-0.5 block text-micro text-ink-muted";
const NOTICE = "block truncate text-dense leading-[1.4] text-ink";
const NUMBER = "mt-0.5 block font-mono text-micro text-ink-muted";
const NEXT = { plain: "text-meta text-ink", urgent: "text-meta font-semibold text-danger" } as const;
const OWNER = "text-meta text-ink-body md:text-right";
/** Thread beside the verbs from `lg`; stacked below it. */
const EXPANDED = "grid grid-cols-1 gap-[26px] border-t border-line-row bg-footer-bar px-[18px] pb-4 pt-3.5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]";
const THREAD_CARD = "mt-2 rounded-tile border border-line bg-card px-3 py-2.5";
const THREAD_WHEN = "m-0 text-micro text-ink-muted";
const THREAD_TEXT = "mb-0 mt-0.5 text-dense leading-normal text-ink";
const CARRIED = "mb-0 mt-2 text-dense leading-[1.55] text-ink";
const MOVE = "mt-2 flex flex-wrap gap-2";
const EMPTY = "m-0 px-[18px] py-4 text-dense text-ink-muted";

const PILL_VARIANT: Record<PillTone, PillVariant> = { good: "status-good", warn: "status-forecasted", plain: "status-plain", new: "status-new", danger: "status-overdue" };

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

/**
 * Outreach, re-based on matches (README §5): each row is one investigator on
 * one notice, grouped by what it needs from the strategist. The notice
 * kanban is gone; the workspace (`?item=`) still opens over the board for
 * the notice's recipients, compose tab and activity.
 */
export function OutreachBoard({ board, workspace, workspaceTab, evidenceFor, viewer, missingItem = false }: Props) {
  const router = useRouter();
  const toast = useToast();
  useEffect(() => {
    if (!missingItem) return;
    toast({ message: "That opportunity is not on your team's board — the link may be old.", tone: "error" });
    router.replace("/outreach");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingItem]);
  const [pending, startTransition] = useSubmitTransition();
  const [filter, setFilter] = useState<MatchFilter>("all");
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [reply, setReply] = useState<MatchRow | null>(null);
  const [outcomeFor, setOutcomeFor] = useState<MatchRow | null>(null);
  const [note, setNote] = useState<{ row: MatchRow; kind: "call" | "park" } | null>(null);

  const visible = useMemo(() => board.rows.filter((r) => matchesFilter(r, filter, viewer.id)), [board.rows, filter, viewer.id]);
  const groups = useMemo(() => GROUP_ORDER.map((g) => ({ group: g, rows: visible.filter((r) => r.view.group === g) })).filter((g) => g.rows.length), [visible]);

  const done = (message: string, undo?: () => Promise<{ ok: boolean; error?: string }>) => {
    router.refresh();
    toast({
      message,
      action: undo
        ? {
            label: "Undo",
            onClick: () =>
              startTransition(async () => {
                const u = await undo();
                if (!u.ok) return toast({ message: u.error ?? "Could not undo.", tone: "error" });
                router.refresh();
              }),
          }
        : undefined,
    });
  };

  const run = (row: MatchRow, action: MatchAction) => {
    switch (action.id) {
      case "draft":
      case "nudge":
        return router.push(row.composeHref);
      case "log_reply":
        return setReply(row);
      case "log_call":
        return setNote({ row, kind: "call" });
      case "park":
        return setNote({ row, kind: "park" });
      case "record_outcome":
        return setOutcomeFor(row);
      default:
        break;
    }
    startTransition(async () => {
      switch (action.id) {
        case "mark_pursuing":
        case "record_submitted": {
          const stage = action.id === "mark_pursuing" ? "pursuing" : "submitted";
          const r = await setMatchStageAction({ recipientId: row.recipientId, stage });
          if (!r.ok) return toast({ message: r.error, tone: "error" });
          const previous = r.previous;
          return done(stage === "pursuing" ? `${row.name} is pursuing ${row.noticeNumber ?? "this notice"}` : `Recorded ${row.name}'s application as submitted`, () => restoreMatchStageAction({ recipientId: row.recipientId, stage: previous?.stage ?? null, itemStage: previous?.itemStage }));
        }
        case "log_no_reply":
        case "close": {
          const r = await setMatchStageAction({ recipientId: row.recipientId, stage: "closed", note: action.id === "log_no_reply" ? "no reply" : "not this cycle" });
          if (!r.ok) return toast({ message: r.error, tone: "error" });
          const previous = r.previous;
          return done(`Closed ${row.name}'s match${action.id === "log_no_reply" ? " · no reply" : " · not this cycle"}`, () => restoreMatchStageAction({ recipientId: row.recipientId, stage: previous?.stage ?? null, itemStage: previous?.itemStage }));
        }
        case "hand_to_osr": {
          const r = await setMatchNextStepAction({ recipientId: row.recipientId, text: "OSR routing", date: row.routingDate });
          if (!r.ok) return toast({ message: r.error, tone: "error" });
          return done(`Next step for ${row.name}: OSR routing${row.routingDate ? ` ${row.routingDate}` : ""}`, () => setMatchNextStepAction({ recipientId: row.recipientId, text: "", date: null }));
        }
        case "unconfirm": {
          const r = row.confirmed ? await undoDecisionAction({ opportunityId: row.opportunityId, investigatorId: row.investigatorId }) : await removeRecipientAction(row.recipientId);
          if (!r.ok) return toast({ message: r.error, tone: "error" });
          return done(row.confirmed ? `${row.name} is no longer confirmed for ${row.noticeNumber ?? "this notice"}` : `Removed ${row.name} from ${row.noticeNumber ?? "this notice"}`);
        }
        default:
          return;
      }
    });
  };

  const setOwner = (row: MatchRow, ownerId: string | null) =>
    startTransition(async () => {
      const r = await setMatchOwnerAction({ recipientId: row.recipientId, ownerId });
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      router.refresh();
    });

  return (
    <div className={cn("mx-auto w-full max-w-[1720px]", pending && "opacity-90")}>
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className={H1}>Outreach</h1>
          <p className={SUB}>{headerLine(board.counts)}</p>
        </div>
        {board.draftHref ? (
          <Link href={board.draftHref} className={DRAFT_BTN}>
            {draftLabel(board.ready)}
          </Link>
        ) : null}
      </div>

      {!board.available ? <p className="mt-4 rounded-card border border-warning-border bg-warning-tint px-4 py-2.5 text-dense text-warning-dark">The match columns are not on the database yet — the rows list, but nothing here can move a match until the migration is applied.</p> : null}

      <div className="mt-[18px] flex flex-wrap gap-1.5">
        {FILTER_ORDER.map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f} className={cn(CHIP, filter === f ? CHIP_STATE.on : CHIP_STATE.off)}>
            {filterLabel(f, board.replyWindowDays)} <span className="opacity-65">{board.filterCounts[f]}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-4">
        {groups.length ? (
          groups.map(({ group, rows }) => (
            <section key={group} className={GROUP} aria-label={GROUP_TITLE[group]}>
              <div className={GROUP_HEAD}>
                <div className="flex flex-wrap items-baseline gap-2.5">
                  <h2 className={GROUP_TITLE_CLASS}>{GROUP_TITLE[group]}</h2>
                  <span className={GROUP_SUB}>{groupSub(group, board.replyWindowDays)}</span>
                </div>
                <span className={GROUP_COUNT}>{groupCount(rows.length)}</span>
              </div>
              <div className={TABLE_WRAP}>
                <div className={TABLE_MIN}>
                  <div className={HEAD_ROW}>
                    <span className={EYEBROW}>Investigator</span>
                    <span className={EYEBROW}>Opportunity</span>
                    <span className={EYEBROW}>State</span>
                    <span className={EYEBROW}>Next step</span>
                    <span className={cn(EYEBROW, "text-right")}>Owner</span>
                  </div>
                  {rows.map((row, i) => {
                    const open = openRow === row.recipientId;
                    return (
                      <div key={row.recipientId} className={cn(i > 0 && ROW_WRAP, open && ROW_WRAP_OPEN)}>
                        <button type="button" onClick={() => setOpenRow(open ? null : row.recipientId)} aria-expanded={open} className={ROW_BTN}>
                          <span className="min-w-0">
                            <span className={NAME}>{row.name}</span>
                            {row.dept ? <span className={DEPT}>{row.dept}</span> : null}
                          </span>
                          <span className="min-w-0">
                            <span className={NOTICE}>{row.noticeTitle}</span>
                            {row.noticeNumber ? <span className={NUMBER}>{row.noticeNumber}</span> : null}
                          </span>
                          <span>
                            <Pill variant={PILL_VARIANT[row.view.pill.tone]}>{row.view.pill.text}</Pill>
                          </span>
                          <span className="min-w-0">
                            <span className={row.view.next.urgent ? NEXT.urgent : NEXT.plain}>{row.view.next.text}</span>
                          </span>
                          <span className={OWNER}>{row.ownerName}</span>
                        </button>
                        {open ? (
                          <div className={EXPANDED}>
                            <div>
                              <p className={cn(EYEBROW, "m-0")}>Thread</p>
                              {row.thread.length ? (
                                row.thread.map((t, j) => (
                                  <div key={`${j}-${t.when}`} className={THREAD_CARD}>
                                    <p className={THREAD_WHEN}>{t.head}</p>
                                    {t.body ? <p className={THREAD_TEXT}>{t.body}</p> : null}
                                  </div>
                                ))
                              ) : (
                                <p className="mb-0 mt-2 text-dense text-ink-muted">Nothing has been sent to {row.name.split(/\s+/)[0]} about this notice yet.</p>
                              )}
                            </div>
                            <div>
                              <p className={cn(EYEBROW, "m-0")}>Carried from the match</p>
                              <p className={CARRIED}>{row.carried}</p>
                              <p className={cn(EYEBROW, "mb-0 mt-4")}>Move it on</p>
                              <div className={MOVE}>
                                {row.view.actions.map((a) => (
                                  <Button key={a.id} variant={a.kind === "primary" ? "primary" : "secondary"} size={28} disabled={pending || (!board.available && a.id !== "draft" && a.id !== "nudge")} onClick={() => run(row, a)}>
                                    {a.label}
                                  </Button>
                                ))}
                              </div>
                              <div className="mt-4 flex items-center gap-2.5">
                                <span className={cn(EYEBROW, "shrink-0")}>Owner</span>
                                <Select value={row.ownerId ?? ""} disabled={pending || !board.available} onChange={(e) => setOwner(row, e.target.value || null)} className="h-7 text-dense">
                                  <option value="">Unassigned</option>
                                  {board.members.map((m) => (
                                    <option key={m.id} value={m.id}>
                                      {m.id === viewer.id ? "You" : m.name}
                                    </option>
                                  ))}
                                </Select>
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          ))
        ) : (
          <section className={GROUP}>
            <p className={EMPTY}>{board.rows.length ? "No match in this filter. Choose another chip, or Everything, to see the rest." : "No match is waiting on you. Confirm one in Discover and it appears here as Ready to send; nothing is contacted until you decide."}</p>
          </section>
        )}
      </div>

      <ReplyDialog row={reply} onClose={() => setReply(null)} onDone={() => { setReply(null); router.refresh(); }} />
      <MatchOutcomeDialog row={outcomeFor} onClose={() => setOutcomeFor(null)} onDone={() => { setOutcomeFor(null); router.refresh(); }} />
      <NoteDialog target={note} onClose={() => setNote(null)} onDone={() => { setNote(null); router.refresh(); }} />

      {workspace ? (
        <OutreachWorkspace key={workspace.item.id} data={workspace} tab={workspaceTab} evidenceFor={evidenceFor} viewer={viewer} onClose={() => router.push(boardHref({}))} hrefFor={(patch) => boardHref({ item: workspace.item.id, ...patch })} />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialogs on the match
// ---------------------------------------------------------------------------

const REPLY_KINDS: Array<{ id: "replied_interested" | "replied_maybe" | "replied_not_now" | "declined"; label: string }> = [
  { id: "replied_interested", label: "Interested" },
  { id: "replied_maybe", label: "Maybe — asked a question" },
  { id: "replied_not_now", label: "Not now" },
  { id: "declined", label: "Declined" },
];

function ReplyDialog({ row, onClose, onDone }: { row: MatchRow | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [pending, startTransition] = useSubmitTransition();
  const [kind, setKind] = useState<(typeof REPLY_KINDS)[number]["id"]>("replied_interested");
  const [text, setText] = useState("");
  return (
    <Dialog
      open={Boolean(row)}
      onClose={onClose}
      title="Log a reply"
      description={row ? `${row.name} · ${row.noticeNumber ?? row.noticeTitle}` : undefined}
      footer={
        <>
          <Button variant="secondary" size={32} onClick={onClose}>Cancel</Button>
          <Button variant="primary" size={32} disabled={pending} onClick={() => startTransition(async () => { if (!row) return; const r = await recordReplyAction({ recipientId: row.recipientId, kind, note: text.trim() || null }); if (!r.ok) return toast({ message: r.error, tone: "error" }); toast({ message: `Recorded ${row.name}'s reply` }); setText(""); onDone(); })}>{pending ? "Saving…" : "Record"}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 py-2">
        <Field label="What they said" labelSize={12}>{({ id }) => <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="w-full">{REPLY_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</Select>}</Field>
        <Field label="Their words (optional)" labelSize={12}>{({ id }) => <Textarea id={id} value={text} onChange={(e) => setText(e.target.value)} className="min-h-[72px]" />}</Field>
      </div>
    </Dialog>
  );
}

function MatchOutcomeDialog({ row, onClose, onDone }: { row: MatchRow | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [pending, startTransition] = useSubmitTransition();
  const [outcome, setOutcome] = useState<Outcome>("pending");
  const [note, setNote] = useState("");
  return (
    <Dialog
      open={Boolean(row)}
      onClose={onClose}
      title="Record the outcome"
      description={row ? `${row.name} · ${row.noticeNumber ?? row.noticeTitle}` : undefined}
      footer={
        <>
          <Button variant="secondary" size={32} onClick={onClose}>Cancel</Button>
          <Button variant="primary" size={32} disabled={pending} onClick={() => startTransition(async () => { if (!row) return; const r = await setMatchStageAction({ recipientId: row.recipientId, stage: "outcome", outcome, note: note.trim() || null }); if (!r.ok) return toast({ message: r.error, tone: "error" }); toast({ message: `Outcome recorded · ${OUTCOME_LABEL[outcome]}` }); onDone(); })}>{pending ? "Saving…" : "Save outcome"}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 py-2">
        <Field label="Outcome" labelSize={12}>{({ id }) => <Select id={id} value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome)} className="w-full">{(Object.keys(OUTCOME_LABEL) as Outcome[]).map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}</Select>}</Field>
        <Field label="Note (optional)" labelSize={12}>{({ id }) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[72px]" />}</Field>
      </div>
    </Dialog>
  );
}

function NoteDialog({ target, onClose, onDone }: { target: { row: MatchRow; kind: "call" | "park" } | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [pending, startTransition] = useSubmitTransition();
  const [text, setText] = useState("");
  const call = target?.kind === "call";
  return (
    <Dialog
      open={Boolean(target)}
      onClose={onClose}
      title={call ? "Log a call" : "Park this match"}
      description={target ? `${target.row.name} · ${target.row.noticeNumber ?? target.row.noticeTitle}` : undefined}
      footer={
        <>
          <Button variant="secondary" size={32} onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            size={32}
            disabled={pending || (call && !text.trim())}
            onClick={() =>
              startTransition(async () => {
                if (!target) return;
                const r = call ? await logMatchCallAction({ recipientId: target.row.recipientId, note: text.trim() }) : await setMatchStageAction({ recipientId: target.row.recipientId, stage: "parked", note: text.trim() || null });
                if (!r.ok) return toast({ message: r.error, tone: "error" });
                toast({ message: call ? `Logged the call with ${target.row.name}` : `Parked ${target.row.name}'s match` });
                setText("");
                onDone();
              })
            }
          >
            {pending ? "Saving…" : call ? "Log it" : "Park"}
          </Button>
        </>
      }
    >
      <div className="py-2">
        <Field label={call ? "What was said" : "Why (optional)"} labelSize={12} help={call ? undefined : "e.g. waiting for the next cycle, PI on leave"}>{({ id }) => <Textarea id={id} value={text} onChange={(e) => setText(e.target.value)} className="min-h-[72px]" autoFocus />}</Field>
      </div>
    </Dialog>
  );
}
