"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addRecipientsAction, createOutreachItemAction } from "@/app/actions/outreach-actions";
import { VerdictRow } from "@/components/fit/verdict-row";
import type { VerdictRowDisclosure } from "@/components/fit/verdict-row-disclosure";
import type { DueTone } from "@/components/fit/verdict-row-view";
import { useToast } from "@/components/ui/toast";
import type { FitVerdicts } from "@/lib/fit/verdicts";

/**
 * The 340px aside's list (fit-UX PR 3; D-d, README §"Screens / views" 2).
 *
 * D-d: "the aside stays an aside". The four-column row is for the
 * investigator page and the Outreach workspace; here the same component is
 * rendered in its **stacked** variant — label inline with the name, chips
 * wrapped, the action full width — for the top rows only, with "See all *n* in
 * Outreach →" underneath. The verdicts and the copy do not change between the
 * variants; the subject does, and with it the right-hand column's caption:
 * `subject="person"` makes it **Status**, never Deadline.
 *
 * **This is the client boundary on the opportunity page.** The page loads and
 * builds the verdicts; this holds the one piece of state the aside has (which
 * row's disclosure is open, one at a time) and creates the handlers.
 *
 * Two verbs are wired, on `VerdictAction.id` rather than on its copy, and only
 * where they are true:
 *
 *   - **`add_to_outreach`** puts the person on this notice's Outreach item,
 *     creating the item in Triage if there is not one — exactly what the words
 *     say.
 *   - **`open_in_outreach`** opens that item. The engine gives this verb to any
 *     row flagged `in_pipeline`, which is the common case here — the board is
 *     the office's queue — and gating on the label string `"Add to outreach"`
 *     meant every one of those people had **no control at all** on a surface
 *     that already renders `/outreach?item=…` twice.
 *
 * The other ids (`see_whats_missing`, `keep_as_lead`, `read_notice`,
 * `dismiss`) have no person-and-notice mechanism on this surface, so no button
 * is drawn for them rather than one that goes nowhere; the card's own "Review
 * in Outreach" is where those rows continue.
 */

export type VerdictStackRow = {
  id: string;
  verdicts: FitVerdicts;
  title: string;
  href?: string;
  meta?: string | null;
  due?: { text: string; tone?: DueTone } | null;
  disclosure?: VerdictRowDisclosure;
};

export function VerdictStack({ rows, opportunityId, itemId }: { rows: readonly VerdictStackRow[]; opportunityId: string; itemId: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  /** One disclosure open at a time (README §"Interactions & behaviour"). */
  const [openRow, setOpenRow] = useState<string | null>(null);

  const add = (row: VerdictStackRow) =>
    startTransition(async () => {
      let target = itemId;
      if (!target) {
        const created = await createOutreachItemAction(opportunityId);
        if (!created.ok) return toast({ message: created.error, tone: "error" });
        target = created.itemId;
      }
      const r = await addRecipientsAction({ itemId: target, investigatorIds: [row.id], origin: "suggested" });
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      router.refresh();
      const id = target;
      toast({ message: r.added.length ? `Added ${row.title} to recipients` : `${row.title} is already a recipient`, action: { label: "Open", onClick: () => router.push(`/outreach?item=${id}`) } });
    });

  const open = () =>
    startTransition(async () => {
      // Not a write: `createOutreachItemAction` hands back the existing item
      // when the notice has one, and a row flagged `in_pipeline` does.
      const target = itemId ?? (await createOutreachItemAction(opportunityId).then((r) => (r.ok ? r.itemId : null)));
      if (!target) return toast({ message: "Could not open this notice in Outreach.", tone: "error" });
      router.push(`/outreach?item=${target}`);
    });

  /** The verb's mechanism on this surface, or null when it has none. */
  const actionFor = (row: VerdictStackRow): (() => void) | undefined => {
    switch (row.verdicts.action?.id) {
      case "add_to_outreach":
        return () => add(row);
      case "open_in_outreach":
        return open;
      default:
        return undefined;
    }
  };

  return (
    <div className={pending ? "opacity-90" : undefined}>
      {rows.map((r, i) => (
        <VerdictRow
          key={r.id}
          id={r.id}
          first={i === 0}
          variant="stacked"
          subject="person"
          verdicts={r.verdicts}
          title={r.title}
          href={r.href}
          meta={r.meta}
          due={r.due ?? undefined}
          open={openRow === r.id}
          onToggle={r.disclosure ? () => setOpenRow((o) => (o === r.id ? null : r.id)) : undefined}
          disclosure={r.disclosure}
          onAction={actionFor(r)}
        />
      ))}
    </div>
  );
}
