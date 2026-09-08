"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { refreshSourcesAction } from "@/app/actions/investigator-actions";
import { ACTION_BUTTON } from "@/components/fit/verdict-row-view";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { FitState, FitStateAction, FitStateBanner } from "@/lib/fit/surface-states";
import { cn } from "@/lib/utils/cn";

/**
 * §3i's states, drawn (fit-UX PR 5; brief: `docs/fit-ux/README.md` §"Screens /
 * views" 5). Markup over `lib/fit/surface-states.ts`, which owns every word
 * and every count — this file chooses no copy and computes no number, so the
 * four states are unit-tested as values rather than asserted about JSX, the
 * same split as `verdict-row-view.ts` under the row.
 *
 * **The card keeps its shape.** `FitStateCard` draws the same
 * `rounded-card border border-line bg-card` section with the same header the
 * populated card has — title on the left, the state's `when` caption on the
 * right where the populated card puts "Sorted by…" — so a strategist landing
 * on an unprofiled investigator sees the same object in the same place, saying
 * something different. `FitStatePanel` is the body alone, for the surfaces that
 * already have a card around it: `VerdictList` renders it between its own
 * header and footer, so the filter chips and the provenance line survive a
 * state that has no rows.
 *
 * **Every control is drawn with its mechanism, or not at all** (PR 3's `3b`).
 * There are exactly three kinds here:
 *
 *   | action | mechanism |
 *   |---|---|
 *   | `refresh_sources` | `refreshSourcesAction` — the same server action the page header's own button calls |
 *   | any action with `href` | a `Link`; no handler needed |
 *   | `show_nearest`, `show_anyway`, `reassess` | the surface's own state or action, passed in as `onAction` |
 *
 * An action whose `id` reaches `onAction` with no `onAction` supplied is not
 * rendered. That is the rule, not a fallback: the surfaces are what know
 * whether they can reveal ruled-out rows or re-run an assessment, and a button
 * that goes nowhere is the fault §3h names.
 */

function StateAction({ action, investigatorId, onAction }: { action: FitStateAction; investigatorId?: string; onAction?: (id: FitStateAction["id"]) => void }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const variant = ACTION_BUTTON[action.kind].variant;

  if (action.href) {
    return (
      <Link href={action.href} className="inline-flex">
        <Button variant={variant} size={32}>
          {action.label}
        </Button>
      </Link>
    );
  }

  if (action.id === "refresh_sources") {
    if (!investigatorId) return null;
    const refresh = () =>
      startTransition(async () => {
        const r = await refreshSourcesAction(investigatorId, "all");
        if (!r.ok) return toast({ message: r.error, tone: "error" });
        toast({ message: r.summary });
        router.refresh();
      });
    return (
      <Button variant={variant} size={32} onClick={refresh} disabled={pending}>
        {pending ? "Refreshing…" : action.label}
      </Button>
    );
  }

  if (!onAction) return null;
  return (
    <Button variant={variant} size={32} onClick={() => onAction(action.id)}>
      {action.label}
    </Button>
  );
}

export type FitStatePanelProps = {
  state: FitState;
  /** Required by `refresh_sources`; without it that action is not drawn. */
  investigatorId?: string;
  /** The surface's own mechanism for `show_nearest` / `show_anyway` / `reassess`. */
  onAction?: (id: FitStateAction["id"]) => void;
  className?: string;
};

/** The state's body: headline, one paragraph, and the actions. Centred, the prototype's own treatment for a card with nothing in it. */
export function FitStatePanel({ state, investigatorId, onAction, className }: FitStatePanelProps) {
  return (
    <div className={cn("px-5 py-6 text-center", className)}>
      <p className="m-0 text-[15px] font-semibold text-ink">{state.headline}</p>
      <p className="mx-auto mb-0 mt-1.5 max-w-[62ch] text-body leading-[1.55] text-ink-body">{state.body}</p>
      {state.actions.length ? (
        <div className="mt-3.5 flex flex-wrap justify-center gap-2.5">
          {state.actions.map((a) => (
            <StateAction key={a.id} action={a} investigatorId={investigatorId} onAction={onAction} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The amber banner §3i's third state carries, above rows that are still shown.
 * `note` sits under the sentence rather than beside it so the aside's 340px and
 * the workspace's full width lay out the same way; the Reassess control is
 * `shrink-0` and appears only where the surface has one.
 */
export function FitStateBannerRow({ banner, onAction, pending }: { banner: FitStateBanner; onAction?: (id: FitStateAction["id"]) => void; pending?: boolean }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-warning-border bg-warning-tint px-5 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="m-0 text-dense leading-[1.5] text-warning-dark">{banner.text}</p>
        {banner.note ? <p className="mb-0 mt-1 text-meta leading-normal text-warning-dark opacity-90">{banner.note}</p> : null}
      </div>
      {banner.action && onAction ? (
        <Button variant="secondary" size={28} className="shrink-0 border-warning-border text-warning-dark" disabled={pending} onClick={() => onAction(banner.action!.id)}>
          {banner.action.label}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * A whole card in a state — header, optional banner, body. Used where there is
 * no populated card to sit inside: the investigator page's "Funding that fits"
 * before a profile exists.
 */
export function FitStateCard({ title, state, banner, investigatorId, onAction }: { title: string; state: FitState; banner?: FitStateBanner | null; investigatorId?: string; onAction?: (id: FitStateAction["id"]) => void }) {
  return (
    <section className="rounded-card border border-line bg-card">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line px-5 py-3">
        <h2 className="m-0 text-[15px] font-semibold text-ink">{title}</h2>
        <span className="text-meta text-ink-muted">{state.when}</span>
      </div>
      {banner ? <FitStateBannerRow banner={banner} onAction={onAction} /> : null}
      <FitStatePanel state={state} investigatorId={investigatorId} onAction={onAction} />
    </section>
  );
}
