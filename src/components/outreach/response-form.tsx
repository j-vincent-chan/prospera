"use client";

import { useState } from "react";
import { respondFromEmailAction } from "@/app/actions/outreach-response-actions";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useSubmitTransition } from "@/lib/hooks/use-submit-transition";
import { RESPONSE_LABEL, type OutreachResponse, type ResponseContext } from "@/lib/outreach/response-types";
import { cn } from "@/lib/utils/cn";

/**
 * The public response page (design: Prospera Outreach Email prototype, the
 * response states). Two states of the same card:
 *
 *   answer — the notice named, the ask ("Interested in exploring this?"),
 *            two 44px choice buttons with the emailed choice pre-selected,
 *            an optional note whose prompt follows the choice, Send.
 *   done   — "Recorded." with what happens next, and "Change my answer".
 *
 * Nothing is written until Send. A person who already answered and opens the
 * link again sees the done state; opening a different button's link shows the
 * answer state pre-set to that button, with a line saying it will replace the
 * earlier answer.
 */
export function ResponseForm({ token, ctx, initial }: { token: string; ctx: ResponseContext; initial: OutreachResponse | null }) {
  const toast = useToast();
  const [pending, startTransition] = useSubmitTransition();
  const [choice, setChoice] = useState<OutreachResponse | null>(initial ?? ctx.response);
  const [note, setNote] = useState(ctx.responseNote ?? "");
  const [done, setDone] = useState<OutreachResponse | null>(ctx.response && !initial ? ctx.response : null);
  const [recordedAt, setRecordedAt] = useState<string | null>(ctx.respondedAt);

  const send = () => {
    if (!choice) return;
    startTransition(async () => {
      const r = await respondFromEmailAction({ token, response: choice, note: note.trim() || null });
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      setDone(choice);
      setRecordedAt(new Date().toISOString());
    });
  };

  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null);

  return (
    <section className="w-full max-w-[560px] overflow-hidden rounded-card border border-line bg-card">
      <div className="border-b border-line-row px-6 py-5 sm:px-8">
        <p className="m-0 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">{ctx.noticeNumber ?? "Funding opportunity"}</p>
        <h1 className="mb-0 mt-1.5 text-[20px] font-semibold leading-[1.25] tracking-[-0.015em] text-ink [text-wrap:balance]">{ctx.noticeTitle}</h1>
        <p className="mb-0 mt-2 text-meta text-ink-muted">
          {ctx.strategistName} wrote to you about this{when(ctx.sentAt) ? ` on ${when(ctx.sentAt)}` : ""}.
        </p>
      </div>

      {done ? (
        <div className="px-6 py-6 sm:px-8">
          <p className="m-0 text-[17px] font-semibold text-ink">Recorded.</p>
          <p className="mb-0 mt-2 text-body leading-[1.6] text-ink-body">
            {done === "interested" ? `${ctx.strategistName} will see this on your match and follow up within a couple of days.` : `Thanks for saying so. ${ctx.strategistName} won’t follow up on this one.`}
            {ctx.replyTo ? (
              <>
                {" "}You can also write directly to{" "}
                <a href={`mailto:${ctx.replyTo}`} className="text-teal hover:text-navy">
                  {ctx.replyTo}
                </a>
                .
              </>
            ) : null}
          </p>
          <p className="mb-0 mt-4 text-meta text-ink-muted">
            You answered “{RESPONSE_LABEL[done]}”{when(recordedAt) ? ` on ${when(recordedAt)}` : ""}.{" "}
            <button type="button" onClick={() => setDone(null)} className="font-medium text-teal hover:text-navy">
              Change my answer
            </button>
          </p>
        </div>
      ) : (
        <div className="px-6 py-6 sm:px-8">
          <p className="m-0 text-[17px] font-semibold text-ink">Interested in exploring this?</p>
          <div className="mt-3.5 flex flex-wrap gap-2" role="radiogroup" aria-label="Your answer">
            <Choice on={choice === "interested"} onClick={() => setChoice("interested")}>
              I’m interested
            </Choice>
            <Choice on={choice === "pass"} onClick={() => setChoice("pass")}>
              Not this time
            </Choice>
          </div>
          {ctx.response && ctx.response !== choice ? <p className="mb-0 mt-3 text-meta text-warning-dark">You answered “{RESPONSE_LABEL[ctx.response]}” earlier. Sending this replaces it.</p> : null}

          {choice ? (
            <div className="mt-5">
              <label htmlFor="response-note" className="mb-1.5 block text-meta font-medium text-ink-body">
                {choice === "interested" ? `Anything ${ctx.strategistFirstName} should know first?` : "Why not this one?"} <span className="font-normal text-ink-muted">{choice === "interested" ? "Optional." : `Optional — it helps ${ctx.strategistFirstName} send you fewer of these.`}</span>
              </label>
              <Textarea id="response-note" value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[96px] leading-[1.6]" maxLength={1000} />
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button type="button" onClick={send} disabled={!choice || pending} className="inline-flex h-11 items-center rounded-control border border-navy bg-navy px-5 text-[15px] font-semibold text-white disabled:opacity-50">
              {pending ? "Sending…" : choice === "pass" ? "Send · not this time" : "Send · I’m interested"}
            </button>
            <p className="m-0 text-meta leading-normal text-ink-muted">Nothing is recorded until you send. You can also just reply to the email.</p>
          </div>
        </div>
      )}
    </section>
  );
}

/** A 44px choice button: navy when chosen, white with the control border otherwise. */
function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onClick} className={cn("inline-flex h-11 items-center rounded-control border px-5 text-[15px] font-semibold", on ? "border-navy bg-navy text-white" : "border-line-control bg-card text-ink hover:bg-canvas")}>
      {children}
    </button>
  );
}
