"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { flagFitPair, requestFitConsult, undoFitPairFlag, withdrawFitConsult } from "@/app/actions/fit-row-actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import type { FitAudience } from "@/lib/fit/explain-view";
import { pairFlagReasons, pairFlagVerb, type PairFlagReason } from "@/lib/fit/row-actions";
import type { VerdictAction } from "@/lib/fit/verdicts";
import { cn } from "@/lib/utils/cn";

const VERB_VARIANT: Record<VerdictAction["kind"], "primary" | "secondary" | "ghost"> = { primary: "primary", secondary: "secondary", quiet: "ghost" };

/**
 * The row's controls: the label's verb, and "this match is wrong" beside it.
 *
 * §3h left both open. The verb for a PI is now "Ask my strategist" (D-n),
 * which opens a note box rather than firing straight away — the question the
 * strategist needs answered is usually "why now?", and a request with a
 * sentence in it is worth more than one without. The wrong-match control is
 * new for both audiences (D-o) and is deliberately quiet: it is a correction,
 * not a call to action.
 */
export function FitRowControls({
  investigatorId,
  opportunityId,
  audience,
  label,
  verb,
  onVerb,
  stacked = false,
}: {
  investigatorId: string;
  opportunityId: string;
  audience: FitAudience;
  label: string;
  /** The verdict's own verb. `ask_strategist` is handled here; everything else defers to `onVerb`. */
  verb: VerdictAction | null;
  onVerb?: () => void;
  stacked?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [askOpen, setAskOpen] = useState(false);
  const [note, setNote] = useState("");
  const [flagOpen, setFlagOpen] = useState(false);
  const [reason, setReason] = useState<PairFlagReason | null>(null);
  const [flagNote, setFlagNote] = useState("");
  const reasons = pairFlagReasons(audience);

  const ask = () =>
    start(async () => {
      const r = await requestFitConsult({ investigatorId, opportunityId, note: note.trim() || null, label: label as "strong" | "moderate" });
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      setAskOpen(false);
      setNote("");
      toast({
        message: r.promise,
        action: r.duplicate || !r.id ? undefined : { label: "Undo", onClick: () => start(async () => { await withdrawFitConsult({ id: r.id }); router.refresh(); }) },
      });
      router.refresh();
    });

  const flag = () =>
    start(async () => {
      if (!reason) return;
      const r = await flagFitPair({ investigatorId, opportunityId, reason, note: flagNote.trim() || null, label });
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      setFlagOpen(false);
      setReason(null);
      setFlagNote("");
      toast({
        message: r.message,
        duration: 8000,
        action: { label: "Undo", onClick: () => start(async () => { await undoFitPairFlag({ id: r.id }); router.refresh(); }) },
      });
      router.refresh();
    });

  return (
    <>
      <span className={cn("flex items-center gap-1.5", stacked && "w-full flex-col-reverse items-stretch gap-2")}>
        <button
          type="button"
          onClick={() => setFlagOpen(true)}
          disabled={pending}
          className={cn("whitespace-nowrap rounded-control px-2 py-1 text-meta text-ink-muted hover:bg-line-row hover:text-ink", stacked && "w-full py-1.5")}
        >
          {pairFlagVerb(audience)}
        </button>
        {verb ? (
          <Button
            variant={VERB_VARIANT[verb.kind]}
            size={32}
            disabled={pending}
            onClick={verb.id === "ask_strategist" ? () => setAskOpen(true) : onVerb}
            className={stacked ? "w-full" : undefined}
          >
            {verb.label}
          </Button>
        ) : null}
      </span>

      <Dialog
        open={askOpen}
        onClose={() => setAskOpen(false)}
        title="Ask your strategist about this"
        description="This goes to the research development strategist who follows your community. It does not put you into the office's outreach queue, and nothing is sent to the funder."
        footer={
          <>
            <Button variant="secondary" size={32} onClick={() => setAskOpen(false)}>Cancel</Button>
            <Button variant="primary" size={32} onClick={ask} disabled={pending}>{pending ? "Sending…" : "Send"}</Button>
          </>
        }
      >
        <Field label="Anything you want them to know" labelSize={12} hint="optional" help="A sentence is enough. Why now, what you already have, or what you would need.">
          {({ id }) => <Textarea id={id} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="I have preliminary data on this and could be ready for the spring cycle." autoFocus />}
        </Field>
      </Dialog>

      <Dialog
        open={flagOpen}
        onClose={() => setFlagOpen(false)}
        title={pairFlagVerb(audience)}
        description={audience === "investigator" ? "This tells the engine the pairing is wrong, and takes it off your list. It does not contact anyone." : "This records the pairing as wrong. It is not a dismissal from an outreach queue and not a flag on the person's profile."}
        footer={
          <>
            <Button variant="secondary" size={32} onClick={() => setFlagOpen(false)}>Cancel</Button>
            <Button variant="primary" size={32} onClick={flag} disabled={pending || !reason}>{pending ? "Recording…" : "Record"}</Button>
          </>
        }
      >
        <div className="flex flex-col gap-2 py-1">
          {reasons.map((r) => (
            <label key={r.id} className={cn("flex cursor-pointer items-center gap-2.5 rounded-[8px] border px-3 py-2.5 text-body", reason === r.id ? "border-teal bg-teal-tint/40 text-ink" : "border-line-control text-ink")}>
              <input type="radio" name="pair-flag-reason" checked={reason === r.id} onChange={() => setReason(r.id)} className="accent-navy" />
              {r.label}
            </label>
          ))}
          <Field label="Anything to add" labelSize={12} hint="optional">
            {({ id }) => <Textarea id={id} rows={2} value={flagNote} onChange={(e) => setFlagNote(e.target.value)} />}
          </Field>
        </div>
      </Dialog>
    </>
  );
}
