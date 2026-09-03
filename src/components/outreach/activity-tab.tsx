"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addNoteAction } from "@/app/actions/outreach-actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { personInitials } from "@/lib/investigators/sources";
import type { WorkspaceData } from "@/lib/outreach/queries";
import { cn } from "@/lib/utils/cn";

const DOT: Record<string, string> = { reply: "bg-success", outreach_sent: "bg-teal", note: "bg-line-control" };

export function ActivityTab({ data, viewer }: { data: WorkspaceData; viewer: { name: string } }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const submit = () =>
    startTransition(async () => {
      const r = await addNoteAction(data.item.id, note);
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      setNote("");
      router.refresh();
    });
  return (
    <div className="px-6 py-5">
      <section className="rounded-card border border-line">
        <div className="flex items-start gap-2.5 border-b border-line-row px-3.5 py-3">
          <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-teal-tint text-[10px] font-semibold text-teal">{personInitials(viewer.name)}</span>
          <div className="flex flex-1 flex-col gap-2">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note… use @ to mention a teammate" className="min-h-[56px] text-dense" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit(); }} />
            {note.trim() ? <div className="flex justify-end"><Button variant="primary" size={28} onClick={submit} disabled={pending}>{pending ? "Adding…" : "Add note"}</Button></div> : null}
          </div>
        </div>
        {data.activity.length === 0 ? <p className="m-0 px-3.5 py-4 text-dense text-ink-muted">No activity yet.</p> : null}
        {data.activity.map((ev) => (
          <div key={ev.id} className="flex items-start gap-2.5 border-b border-line-row px-3.5 py-2.5">
            <span aria-hidden className={cn("mt-1.5 block h-2 w-2 shrink-0 rounded-full", DOT[ev.kind] ?? "bg-line-control")} />
            <div className="min-w-0 flex-1">
              <p className="m-0 text-dense leading-[1.45] text-ink"><span className="font-medium">{ev.who}</span> {ev.what}</p>
              <p className="mb-0 mt-0.5 text-meta text-ink-muted">{ev.when}</p>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
