"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { confirmLibraryItemAction, reopenFlagAction, resolveFlagAction, restoreLibraryItemAction, sendReviewReminderAction, stewardDecisionAction } from "@/app/actions/library-actions";
import { TrustPill } from "@/components/library/library-item-sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import type { LibraryRow, QueueData } from "@/lib/institution/library";
import { cn } from "@/lib/utils/cn";

type DialogState = { kind: "changes"; item: LibraryRow } | { kind: "remove"; item: LibraryRow; from: "pending" | "published" } | { kind: "resolve"; flagId: string; item: LibraryRow } | null;

export function QueueScreen({ data }: { data: QueueData }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [note, setNote] = useState("");
  const [asCurated, setAsCurated] = useState<Record<string, boolean>>({});
  const total = data.pending.length + data.flagged.length + data.pastReview.length;

  const publish = (item: LibraryRow) =>
    start(async () => {
      const res = await stewardDecisionAction({ itemId: item.id, decision: "publish", trustTier: asCurated[item.id] ? "curated" : "community" });
      if (!res.ok) return toast({ message: res.error, tone: "error" });
      toast({ message: res.message });
      router.refresh();
    });
  const changes = () => {
    if (dialog?.kind !== "changes") return;
    const item = dialog.item;
    start(async () => {
      const res = await stewardDecisionAction({ itemId: item.id, decision: "changes", note });
      if (!res.ok) return toast({ message: res.error, tone: "error" });
      setDialog(null);
      setNote("");
      toast({ message: res.message });
      router.refresh();
    });
  };
  const remove = () => {
    if (dialog?.kind !== "remove") return;
    const { item, from } = dialog;
    start(async () => {
      const res = await stewardDecisionAction({ itemId: item.id, decision: "remove", note });
      if (!res.ok) return toast({ message: res.error, tone: "error" });
      setDialog(null);
      setNote("");
      toast({ message: `Removed “${item.title.slice(0, 40)}”`, action: { label: "Undo", onClick: () => void restoreLibraryItemAction({ itemId: item.id, status: from === "pending" ? "pending_review" : "published" }).then(() => router.refresh()) } });
      router.refresh();
    });
  };
  const resolve = () => {
    if (dialog?.kind !== "resolve") return;
    const { flagId } = dialog;
    start(async () => {
      const res = await resolveFlagAction({ flagId, resolution: note });
      if (!res.ok) return toast({ message: res.error, tone: "error" });
      setDialog(null);
      setNote("");
      toast({ message: "Flag resolved", action: { label: "Undo", onClick: () => void reopenFlagAction({ flagId }).then(() => router.refresh()) } });
      router.refresh();
    });
  };
  const remind = (item: LibraryRow) =>
    start(async () => {
      const res = await sendReviewReminderAction({ itemId: item.id });
      if (!res.ok) return toast({ message: res.error, tone: "error" });
      toast({ message: res.message });
      router.refresh();
    });
  const confirm = (item: LibraryRow) =>
    start(async () => {
      const res = await confirmLibraryItemAction({ itemId: item.id });
      if (!res.ok) return toast({ message: res.error, tone: "error" });
      toast({ message: res.message });
      router.refresh();
    });

  const Row = ({ item, children, sub }: { item: LibraryRow; children: React.ReactNode; sub?: React.ReactNode }) => (
    <div className="flex items-center gap-4 border-t border-line-row px-5 py-3">
      <div className="min-w-0 flex-1">
        <Link href={`/library?item=${item.id}`} className="block truncate text-body font-medium text-ink hover:text-teal">{item.title}</Link>
        <p className="mb-0 mt-0.5 truncate text-meta text-ink-muted">{item.meta} · {item.source}</p>
        {sub ? <p className="mb-0 mt-1 text-meta text-ink-body">{sub}</p> : null}
      </div>
      <TrustPill tier={item.trust} />
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      <Link href="/library" className="text-dense text-ink-muted hover:text-navy">← Proposal library</Link>
      <header>
        <p className="mb-1 mt-0 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">UCSF · Library stewards</p>
        <h1 className="m-0 text-h1 font-semibold text-ink">Steward queue</h1>
        <p className="mb-0 mt-1.5 text-body text-ink-muted">{total ? `${total} item${total === 1 ? "" : "s"} need a steward` : "Nothing waiting. New uploads, reader flags and past-due reviews land here."} · uploaders are emailed on every decision</p>
      </header>

      <Section title="Awaiting review before public" count={data.pending.length} empty="No uploads waiting for review.">
        {data.pending.map((it) => (
          <Row key={it.id} item={it} sub={<>Submitted {it.submitted}{it.findings ? <> · <span className="text-warning-dark">Found in the document: {it.findings}</span></> : " · nothing sensitive detected"}</>}>
            <label className="flex items-center gap-1.5 text-meta text-ink-body"><Checkbox checked={Boolean(asCurated[it.id])} onChange={(e) => setAsCurated({ ...asCurated, [it.id]: e.target.checked })} />Publish as Curated</label>
            <Button variant="secondary" size={28} onClick={() => { setNote(""); setDialog({ kind: "changes", item: it }); }} disabled={pending}>Request changes…</Button>
            <Button variant="destructive-outline" size={28} onClick={() => { setNote(""); setDialog({ kind: "remove", item: it, from: "pending" }); }} disabled={pending}>Remove…</Button>
            <Button variant="primary" size={28} onClick={() => publish(it)} disabled={pending}>Approve &amp; publish</Button>
          </Row>
        ))}
      </Section>

      <Section title="Flagged by readers" count={data.flagged.length} empty="No open flags.">
        {data.flagged.map((fl) => (
          <Row key={fl.flagId} item={fl.item} sub={<>{fl.by} · {fl.when} · <span className="font-medium text-ink">{fl.reason}</span>{fl.note ? ` · “${fl.note}”` : ""}</>}>
            <Button variant="secondary" size={28} onClick={() => { setNote(""); setDialog({ kind: "resolve", flagId: fl.flagId, item: fl.item }); }} disabled={pending}>Resolve…</Button>
            <Button variant="destructive-outline" size={28} onClick={() => { setNote(""); setDialog({ kind: "remove", item: fl.item, from: "published" }); }} disabled={pending}>Remove item…</Button>
          </Row>
        ))}
      </Section>

      <Section title="Past review date" count={data.pastReview.length} empty="Every published item is within its review date." tone={data.pastReview.length ? "warning" : undefined}>
        {data.pastReview.map((it) => (
          <Row key={it.id} item={it} sub={<>Review was due <span className="font-medium text-warning-dark">{it.reviewDue}</span>{it.reminded ? ` · reminder sent ${it.reminded}` : " · no reminder sent yet"}</>}>
            <Button variant="secondary" size={28} onClick={() => remind(it)} disabled={pending}>{it.reminded ? "Remind again" : "Send reminder"}</Button>
            <Button variant="secondary" size={28} onClick={() => confirm(it)} disabled={pending}>Confirm accurate</Button>
            <Button variant="destructive-outline" size={28} onClick={() => { setNote(""); setDialog({ kind: "remove", item: it, from: "published" }); }} disabled={pending}>Remove…</Button>
          </Row>
        ))}
      </Section>

      {data.changesRequested.length ? (
        <Section title="Changes requested · waiting on the uploader" count={data.changesRequested.length} empty="">
          {data.changesRequested.map((it) => (
            <Row key={it.id} item={it} sub={it.note ? `“${it.note}”` : undefined}>
              <Button variant="secondary" size={28} onClick={() => publish(it)} disabled={pending}>Publish anyway</Button>
              <Button variant="destructive-outline" size={28} onClick={() => { setNote(""); setDialog({ kind: "remove", item: it, from: "pending" }); }} disabled={pending}>Remove…</Button>
            </Row>
          ))}
        </Section>
      ) : null}

      <Dialog open={dialog?.kind === "changes"} onClose={() => setDialog(null)} title="Request changes" description="The uploader gets your note by email. The item stays visible only to them and the stewards until a new version arrives." footer={<><Button variant="secondary" size={32} onClick={() => setDialog(null)}>Cancel</Button><Button variant="primary" size={32} onClick={changes} disabled={pending || !note.trim()}>Send to uploader</Button></>}>
        <Field label="What should change?" labelSize={12}>{({ id }) => <Textarea id={id} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Redact the collaborator names on page 4 and the unpublished figure 2." />}</Field>
      </Dialog>
      <Dialog open={dialog?.kind === "remove"} onClose={() => setDialog(null)} title="Remove from the library?" description="The item disappears for everyone but the stewards. The uploader is notified. You can undo from the toast." footer={<><Button variant="secondary" size={32} onClick={() => setDialog(null)}>Cancel</Button><Button variant="destructive" size={32} onClick={remove} disabled={pending}>Remove</Button></>}>
        <Field label="Reason" labelSize={12} hint="optional">{({ id }) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      </Dialog>
      <Dialog open={dialog?.kind === "resolve"} onClose={() => setDialog(null)} title="Resolve the flag" description="Say what you did (or why no change was needed). It goes in the item's history." footer={<><Button variant="secondary" size={32} onClick={() => setDialog(null)}>Cancel</Button><Button variant="primary" size={32} onClick={resolve} disabled={pending}>Resolve</Button></>}>
        <Field label="Resolution" labelSize={12}>{({ id }) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Uploader replaced the file · no change needed" />}</Field>
      </Dialog>
    </div>
  );
}

function Section({ title, count, empty, tone, children }: { title: string; count: number; empty: string; tone?: "warning"; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <h2 className="m-0 text-section font-semibold uppercase text-ink">{title}</h2>
        <span className={cn("text-dense font-semibold", tone === "warning" ? "text-warning-dark" : "text-ink")}>{count}</span>
      </div>
      {count ? children : <div className="px-5 py-4 text-dense text-ink-muted">{empty}</div>}
    </section>
  );
}
