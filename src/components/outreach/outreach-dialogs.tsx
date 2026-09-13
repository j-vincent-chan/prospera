"use client";

import { useState } from "react";
import { setStageAction, unparkAction } from "@/app/actions/outreach-actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { OUTCOME_LABEL, type Outcome } from "@/lib/outreach/types";
import { useSubmitTransition } from "@/lib/hooks/use-submit-transition";

/**
 * The two notice-level dialogs the workspace still uses. They moved here from
 * the old board file when the kanban was replaced by the match board; they
 * act on the notice's `outreach_items` row, as before.
 */

export function OutcomeDialog({ card, onClose, onDone }: { card: { id: string; title: string } | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [pending, startTransition] = useSubmitTransition();
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
  const [pending, startTransition] = useSubmitTransition();
  const [reason, setReason] = useState("");
  return (
    <Dialog
      open={Boolean(card)}
      onClose={onClose}
      title="Park this opportunity"
      description="It leaves the active stages and can be resumed later from the workspace."
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
