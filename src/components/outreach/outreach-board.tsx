"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setStageAction, unparkAction } from "@/app/actions/outreach-actions";
import { OutreachWorkspace } from "@/components/outreach/outreach-workspace";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import type { BoardCard, BoardData, WorkspaceData } from "@/lib/outreach/queries";
import { nextStage } from "@/lib/outreach/stages";
import { OUTCOME_LABEL, STAGE_LABEL, STAGE_TAB_LABEL, STAGES, type Outcome, type OutreachStage } from "@/lib/outreach/types";
import { cn } from "@/lib/utils/cn";

type Props = {
  board: BoardData;
  stage: OutreachStage;
  community: string | null;
  workspace: WorkspaceData | null;
  workspaceTab: "recipients" | "compose" | "activity";
  evidenceFor: string | null;
  viewer: { id: string; name: string; title: string | null };
};

export function boardHref(input: { stage?: OutreachStage; community?: string | null; item?: string | null; tab?: string | null; evidence?: string | null }): string {
  const p = new URLSearchParams();
  if (input.stage && input.stage !== "triage") p.set("stage", input.stage);
  if (input.community) p.set("community", input.community);
  if (input.item) p.set("item", input.item);
  if (input.tab && input.tab !== "recipients") p.set("tab", input.tab);
  if (input.evidence) p.set("evidence", input.evidence);
  const qs = p.toString();
  return qs ? `/outreach?${qs}` : "/outreach";
}

const chip = (bg: string, fg: string) => cn("inline-flex h-[22px] items-center rounded-full px-2 text-meta font-medium", bg, fg);

export function OutreachBoard({ board, stage, community, workspace, workspaceTab, evidenceFor, viewer }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [outcomeFor, setOutcomeFor] = useState<BoardCard | null>(null);
  const [parkFor, setParkFor] = useState<BoardCard | null>(null);

  const open = (card: BoardCard, tab?: "recipients" | "compose" | "activity") => router.push(boardHref({ stage, community, item: card.id, tab }));

  const move = (card: BoardCard, to: OutreachStage) =>
    startTransition(async () => {
      const r = await setStageAction({ itemId: card.id, stage: to });
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      router.refresh();
      toast({
        message: `Moved to ${STAGE_LABEL[to]}`,
        action: { label: "Undo", onClick: () => startTransition(async () => { const u = await setStageAction({ itemId: card.id, stage: r.previous }); if (!u.ok) return toast({ message: u.error, tone: "error" }); router.refresh(); }) },
      });
    });

  const primary = (card: BoardCard) => {
    switch (card.primary.kind) {
      case "review_recipients":
      case "review_suggestions":
        return open(card, "recipients");
      case "compose":
        return open(card, "compose");
      case "advance": {
        const to = nextStage(card.stage);
        if (to) move(card, to);
        return;
      }
      case "outcome":
        return setOutcomeFor(card);
      case "unpark":
        return startTransition(async () => {
          const r = await unparkAction(card.id);
          if (!r.ok) return toast({ message: r.error, tone: "error" });
          router.refresh();
          toast({ message: `Resumed · ${STAGE_LABEL[r.stage]}` });
        });
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-h1 font-semibold tracking-[-0.02em] text-ink">Outreach</h1>
          <p className="mb-0 mt-1.5 text-body text-ink-muted">{board.summary}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/reports" className="inline-flex h-9 items-center rounded-control border border-line-control bg-card px-3.5 text-body font-medium text-ink hover:bg-canvas">Reports</Link>
          <Link href="/opportunities" className="inline-flex h-9 items-center rounded-control border border-navy bg-navy px-3.5 text-body font-medium text-white hover:bg-navy-hover">Add opportunity</Link>
        </div>
      </header>

      <div className="grid grid-cols-5 gap-3">
        {([
          ["In play", board.metrics.inPlay, "text-ink"],
          ["PI linked", board.metrics.piLinked, "text-ink"],
          ["Contacted", board.metrics.contacted, "text-ink"],
          ["Interested", board.metrics.interested, "text-success"],
          ["Overdue", board.metrics.overdue, "text-danger"],
        ] as const).map(([label, value, color]) => (
          <div key={label} className="rounded-card border border-line bg-card px-4 py-3.5">
            <p className="m-0 text-meta text-ink-muted">{label}</p>
            <p className={cn("mb-0 mt-1.5 text-[24px] font-semibold tracking-[-0.02em] tabular", color)}>{value}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-4 border-b border-line">
        <div className="flex gap-6" role="tablist">
          {STAGES.map((s) => (
            <Link
              key={s}
              role="tab"
              aria-selected={s === stage}
              href={boardHref({ stage: s, community })}
              className={cn("border-b-2 pb-2.5 pt-2 text-body font-medium", s === "parked" && "ml-3", s === stage ? "border-navy text-ink" : "border-transparent text-ink-muted hover:text-ink")}
            >
              {STAGE_TAB_LABEL[s]} <span className={cn("ml-1", s === stage ? "text-ink-muted" : "")}>{board.counts[s]}</span>
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-2 pb-2">
          <span className="text-meta text-ink-muted">Community</span>
          <Link href={boardHref({ stage })} className={cn("inline-flex h-7 items-center whitespace-nowrap rounded-full px-2.5 text-dense font-medium", !community ? "border border-teal bg-teal-tint text-teal" : "border border-line-control bg-card text-ink")}>All</Link>
          {board.communities.map((c) => (
            <Link key={c.id} href={boardHref({ stage, community: c.id })} className={cn("inline-flex h-7 items-center whitespace-nowrap rounded-full px-2.5 text-dense font-medium", community === c.id ? "border border-teal bg-teal-tint text-teal" : "border border-line-control bg-card text-ink")}>{c.label}</Link>
          ))}
        </div>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex flex-col gap-3">
          {board.cards.length === 0 ? (
            <EmptyState
              title={stage === "triage" ? "Nothing in Triage" : `Nothing in ${STAGE_TAB_LABEL[stage]}`}
              description={stage === "triage" ? "Save a notice from Opportunities and it lands here with suggestions ready to review." : "Items move here from the workspace footer or a card’s primary action."}
              actions={stage === "triage" ? <Link href="/opportunities" className="inline-flex h-8 items-center rounded-control border border-navy bg-navy px-3 text-dense font-medium text-white">Add opportunity</Link> : undefined}
            />
          ) : (
            board.cards.map((c) => (
              <article key={c.id} className="rounded-card border border-line bg-card">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 px-5 py-4">
                  <div className="min-w-0">
                    <Link href={`/opportunities/${c.opportunityId}`} className="text-[15px] font-medium leading-[1.4] text-ink hover:text-teal">{c.title}</Link>
                    <p className="mb-0 mt-1 text-meta text-ink-muted">{c.meta}</p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      <span className={chip(c.deadline.tone === "urgent" ? "bg-danger-tint" : "bg-line-row", c.deadline.tone === "urgent" ? "text-danger" : "text-ink-body")}>{c.deadline.text}</span>
                      <span className={chip(c.communities.length ? "bg-line-row" : "bg-warning-tint", c.communities.length ? "text-ink-body" : "text-warning")}>{c.communities.length ? c.communities.join(" · ") : "Needs community"}</span>
                      <span className={chip(c.recipients.interested ? "bg-success-tint" : c.recipients.suggested || c.recipients.contacted ? "bg-teal-tint" : "bg-line-row", c.recipients.interested ? "text-success" : c.recipients.suggested || c.recipients.contacted ? "text-teal" : "text-ink-body")}>
                        {c.recipients.total === 0 ? "No recipients" : `${c.recipients.total} recipient${c.recipients.total === 1 ? "" : "s"}`}
                        {c.recipients.contacted ? ` · ${c.recipients.contacted} contacted` : c.recipients.total ? " · not contacted" : ""}
                        {c.recipients.interested ? ` · ${c.recipients.interested} interested` : ""}
                        {c.recipients.suggested ? ` · ${c.recipients.suggested} suggested` : ""}
                      </span>
                      {c.stage === "outcome" && c.outcome ? <span className={chip(c.outcome === "funded" ? "bg-success-tint" : "bg-line-row", c.outcome === "funded" ? "text-success" : "text-ink-body")}>{OUTCOME_LABEL[c.outcome]}</span> : null}
                      {c.stage === "parked" && c.parkedReason ? <span className={chip("bg-line-row", "text-ink-body")}>{c.parkedReason}</span> : null}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="m-0 text-meta text-ink-muted">Owner</p>
                    <p className={cn("mb-0 mt-0.5 text-body font-medium", c.owner.id ? "text-ink" : "text-warning")}>{c.owner.name}</p>
                    {c.nextAction ? (
                      <p className={cn("mb-0 mt-2 max-w-[220px] text-meta", c.nextActionOverdue ? "text-danger" : "text-ink-muted")}>
                        {c.nextAction}{c.nextActionDate ? ` · ${c.nextActionOverdue ? "overdue" : "due"} ${new Date(`${c.nextActionDate}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}` : ""}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-b-card border-t border-line-row bg-footer-bar px-5 py-2.5">
                  <div className="flex gap-2">
                    <Button variant="primary" size={28} onClick={() => primary(c)} disabled={pending}>{c.primary.label}</Button>
                    <Button variant="secondary" size={28} onClick={() => open(c)}>Open workspace</Button>
                  </div>
                  <Menu
                    label={`More for ${c.title}`}
                    align="end"
                    width={230}
                    trigger={({ toggle, triggerProps }) => (
                      <button type="button" onClick={toggle} {...triggerProps} aria-label="More" className="inline-flex h-7 w-7 items-center justify-center rounded-control text-ink-muted hover:bg-line-row hover:text-ink">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
                      </button>
                    )}
                  >
                    <MenuItem href={`/opportunities/${c.opportunityId}`}>Open notice</MenuItem>
                    <MenuItem onSelect={() => open(c, "activity")}>Notes &amp; activity</MenuItem>
                    <MenuSeparator />
                    {STAGES.filter((s) => s !== c.stage && s !== "parked" && s !== "outcome").map((s) => (
                      <MenuItem key={s} onSelect={() => move(c, s)}>Move to {STAGE_LABEL[s]}</MenuItem>
                    ))}
                    {c.stage !== "outcome" ? <MenuItem onSelect={() => setOutcomeFor(c)}>Record outcome…</MenuItem> : null}
                    {c.stage !== "parked" ? <MenuItem onSelect={() => setParkFor(c)}>Park…</MenuItem> : null}
                  </Menu>
                </div>
              </article>
            ))
          )}
        </div>

        <aside className="flex flex-col gap-3 rounded-card border border-line bg-card px-5 py-4">
          <p className="m-0 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">Next actions</p>
          {board.actions.map((a) => (
            <Link key={a.title} href={a.href} className="flex items-start gap-3 border-t border-line-row py-2.5">
              <span className={cn("inline-flex h-7 min-w-7 shrink-0 items-center justify-center rounded-control px-1.5 text-dense font-semibold tabular", a.tone === "danger" ? "bg-danger-tint text-danger" : a.tone === "teal" ? "bg-teal-tint text-teal" : a.tone === "warning" ? "bg-warning-tint text-warning" : "bg-success-tint text-success")}>{a.n}</span>
              <span>
                <span className="block text-body font-medium text-ink">{a.title}</span>
                <span className="mt-0.5 block text-meta leading-normal text-ink-muted">{a.detail}</span>
              </span>
            </Link>
          ))}
        </aside>
      </div>

      <OutcomeDialog card={outcomeFor} onClose={() => setOutcomeFor(null)} onDone={() => { setOutcomeFor(null); router.refresh(); }} />
      <ParkDialog card={parkFor} onClose={() => setParkFor(null)} onDone={() => { setParkFor(null); router.refresh(); }} />

      {workspace ? (
        <OutreachWorkspace key={workspace.item.id} data={workspace} tab={workspaceTab} evidenceFor={evidenceFor} viewer={viewer} onClose={() => router.push(boardHref({ stage, community }))} hrefFor={(patch) => boardHref({ stage, community, item: workspace.item.id, ...patch })} />
      ) : null}
    </div>
  );
}

export function OutcomeDialog({ card, onClose, onDone }: { card: { id: string; title: string } | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<Outcome>("pending");
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  return (
    <Dialog
      open={Boolean(card)}
      onClose={onClose}
      title="Record the outcome"
      description={card?.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={pending} onClick={() => startTransition(async () => { if (!card) return; const r = await setStageAction({ itemId: card.id, stage: "outcome", outcome, outcomeNote: note, outcomeAmount: amount.trim() ? Number(amount.replace(/[^0-9.]/g, "")) : null }); if (!r.ok) return toast({ message: r.error, tone: "error" }); toast({ message: `Outcome recorded · ${OUTCOME_LABEL[outcome]}` }); onDone(); })}>{pending ? "Saving…" : "Save outcome"}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 py-2">
        <Field label="Outcome" labelSize={12}>{({ id }) => <Select id={id} value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome)} className="w-full">{(Object.keys(OUTCOME_LABEL) as Outcome[]).map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}</Select>}</Field>
        <Field label="Total costs (optional)" labelSize={12} help="Feeds the Reports funnel, e.g. 1900000 for $1.9M.">{({ id }) => <Input id={id} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="$" />}</Field>
        <Field label="Note (optional)" labelSize={12}>{({ id }) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[72px]" />}</Field>
      </div>
    </Dialog>
  );
}

export function ParkDialog({ card, onClose, onDone }: { card: { id: string; title: string } | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  return (
    <Dialog
      open={Boolean(card)}
      onClose={onClose}
      title="Park this opportunity"
      description="It leaves the active stages and can be resumed later from the Parked tab."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={pending} onClick={() => startTransition(async () => { if (!card) return; const r = await setStageAction({ itemId: card.id, stage: "parked", parkedReason: reason.trim() || null }); if (!r.ok) return toast({ message: r.error, tone: "error" }); toast({ message: "Parked", action: { label: "Undo", onClick: () => startTransition(async () => { const u = await unparkAction(card.id); if (!u.ok) return toast({ message: u.error, tone: "error" }); onDone(); }) } }); onDone(); })}>{pending ? "Parking…" : "Park"}</Button>
        </>
      }
    >
      <div className="py-2">
        <Field label="Why (optional)" labelSize={12} help="e.g. waiting for the next cycle, PI on leave">{({ id }) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-[64px]" />}</Field>
      </div>
    </Dialog>
  );
}
