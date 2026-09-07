"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { proposeProfileCorrection } from "@/app/actions/fit-correction-actions";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { CorrectionPreview } from "@/lib/fit/feedback/correction";
import { cn } from "@/lib/utils/cn";

export type ProposalCard = {
  investigatorId: string;
  /** The person the correction is about, for the sentence. */
  name: string;
  axisReason: string;
  /** The dismissal the correction rests on; the action refuses without a readable one. */
  suggestionId: string;
  preview: CorrectionPreview;
  /** The notice the dismissal came from, when known. */
  noticeTitle?: string | null;
};

/**
 * The one-click profile-correction confirmation (plan § PR 3.2; spec §12):
 * "Lower Clinical trials from 0.35 to 0.15 on the fit profile?" with one
 * button. Confirming writes a proposed `fit_corrections` row through
 * `proposeProfileCorrection` (`proposed_by` = the viewer's role: the
 * investigator on their own page, else a strategist); nothing is applied
 * until PR 3.3's queue approves. Used inline after a dismissal in Outreach
 * and in the investigator page's "Profile corrections" card.
 */
export function ProposeCorrectionBanner({ proposal, onDone, className }: { proposal: ProposalCard; onDone?: (outcome: "proposed" | "dismissed") => void; className?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const confirm = () =>
    startTransition(async () => {
      const r = await proposeProfileCorrection({ investigatorId: proposal.investigatorId, axisReason: proposal.axisReason, suggestionId: proposal.suggestionId });
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      setDone(r.duplicate ? "Already proposed · awaiting review" : `Proposed as ${r.proposedBy === "investigator" ? "the investigator" : "a strategist"} · awaiting review`);
      toast({ message: r.duplicate ? "This correction is already proposed." : `Proposed: ${r.preview.label} ${r.preview.edits.map((e) => `${e.view ? `${e.view} ` : ""}${e.from.toFixed(2)} → ${e.to.toFixed(2)}`).join(", ")}. It appears in the fit inspector and the review queue.` });
      router.refresh();
      onDone?.("proposed");
    });
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 rounded-tile border border-navy/30 bg-navy-tint px-3 py-2.5 text-dense text-ink", className)}>
      <div className="min-w-0">
        <p className="m-0 font-medium">
          Profile correction · {proposal.name}
          {proposal.noticeTitle ? <span className="font-normal text-ink-muted"> · from a dismissal on “{proposal.noticeTitle}”</span> : null}
        </p>
        <p className="mb-0 mt-0.5 leading-normal">{proposal.preview.sentence}</p>
        <p className="mb-0 mt-0.5 text-meta text-ink-muted">
          {proposal.preview.label} · <code className="font-mono">{proposal.preview.paths.join(" · ")}</code> · goes to the review queue; nothing changes until a strategist approves it.{" "}
          <Link href={`/investigators/${proposal.investigatorId}/fit`} className="text-teal hover:text-navy">
            Fit profile →
          </Link>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {done ? (
          <span className="text-meta font-medium text-success">{done}</span>
        ) : (
          <>
            <Button variant="primary" size={28} disabled={pending} onClick={confirm}>
              {pending ? "Proposing…" : "Propose correction"}
            </Button>
            <button type="button" className="text-meta font-medium text-ink-muted hover:text-ink" onClick={() => onDone?.("dismissed")}>
              Not now
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** The investigator page's card: every dismissal-derived correction still awaiting its click. */
export function PendingCorrections({ proposals }: { proposals: ProposalCard[] }) {
  const [hidden, setHidden] = useState<string[]>([]);
  const shown = proposals.filter((p) => !hidden.includes(p.preview.path));
  if (!shown.length) return null;
  return (
    <section className="rounded-card border border-line bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <h2 className="m-0 whitespace-nowrap text-[15px] font-semibold text-ink">Profile corrections</h2>
        <span className="text-right text-meta text-ink-muted">
          {shown.length} from “wrong type of research” dismissal{shown.length === 1 ? "" : "s"} · one click to propose
        </span>
      </div>
      <div className="flex flex-col gap-2 px-5 py-4">
        {shown.map((p) => (
          <ProposeCorrectionBanner key={p.preview.path} proposal={p} onDone={(outcome) => (outcome === "dismissed" ? setHidden((h) => [...h, p.preview.path]) : undefined)} />
        ))}
      </div>
    </section>
  );
}
