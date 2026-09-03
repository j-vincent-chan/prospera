"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addRecipientsAction, createOutreachItemAction } from "@/app/actions/outreach-actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";

/** "Open in Outreach →" on Opportunity Detail: opens the existing item or creates one in Triage. */
export function OpenInOutreachButton({ opportunityId, itemId, label = "Open in Outreach →", size = 36, className }: { opportunityId: string; itemId: string | null; label?: string; size?: 36 | 32; className?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="primary"
      size={size}
      className={className}
      disabled={pending}
      onClick={() => {
        if (itemId) return router.push(`/outreach?item=${itemId}`);
        startTransition(async () => {
          const r = await createOutreachItemAction(opportunityId);
          if (!r.ok) return toast({ message: r.error, tone: "error" });
          if (r.created) toast({ message: "Saved to outreach · Triage" });
          router.push(`/outreach?item=${r.itemId}`);
        });
      }}
    >
      {pending ? "Opening…" : label}
    </Button>
  );
}

/** "Add to outreach" on Investigator Detail: pick an in-play opportunity and add the person as a recipient. */
export function AddToOutreachButton({ investigatorId, investigatorName, items }: { investigatorId: string; investigatorName: string; items: Array<{ id: string; title: string; stage: string }> }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState(items[0]?.id ?? "");
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>Add to outreach</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Add ${investigatorName} to outreach`}
        description={items.length ? "Choose the opportunity; they join its Selected recipients. Nothing is sent until you compose." : "No opportunities are in play yet. Save one from Opportunities first."}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={pending || !itemId} onClick={() => startTransition(async () => { const r = await addRecipientsAction({ itemId, investigatorIds: [investigatorId], origin: "you" }); if (!r.ok) return toast({ message: r.error, tone: "error" }); setOpen(false); toast({ message: r.added.length ? `Added ${investigatorName} to recipients` : `${investigatorName} is already a recipient`, action: { label: "Open", onClick: () => router.push(`/outreach?item=${itemId}`) } }); })}>{pending ? "Adding…" : "Add as recipient"}</Button>
          </>
        }
      >
        {items.length ? (
          <div className="py-2">
            <Field label="Opportunity" labelSize={12}>{({ id }) => <Select id={id} value={itemId} onChange={(e) => setItemId(e.target.value)} className="w-full">{items.map((i) => <option key={i.id} value={i.id}>{i.title.slice(0, 90)}{i.title.length > 90 ? "…" : ""} · {i.stage}</option>)}</Select>}</Field>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
