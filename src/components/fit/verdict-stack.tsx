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
 * One verb is wired, and only where it is true: **Add to outreach** puts the
 * person on this notice's Outreach item, creating the item in Triage if there
 * is not one — which is exactly what the words say. The other labels ("See
 * what's missing", "Keep as a lead", "Read the notice") have no
 * person-and-notice mechanism on this surface, so no button is drawn for them
 * rather than one that goes nowhere; the card's own "Review in Outreach" is
 * where those rows continue.
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
  const [open, setOpen] = useState<string | null>(null);

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
          open={open === r.id}
          onToggle={r.disclosure ? () => setOpen((o) => (o === r.id ? null : r.id)) : undefined}
          disclosure={r.disclosure}
          onAction={r.verdicts.action?.label === "Add to outreach" ? () => add(r) : undefined}
        />
      ))}
    </div>
  );
}
