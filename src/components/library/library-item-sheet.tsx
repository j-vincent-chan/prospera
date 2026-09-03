"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { addLibraryVersionAction, confirmLibraryItemAction, flagLibraryItemAction, getLibraryDownloadUrlAction, requestLibraryUpdateAction, withdrawFlagAction } from "@/app/actions/library-actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { SlideOver } from "@/components/ui/slide-over";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import type { LibraryItemDetail } from "@/lib/institution/library";
import { FLAG_REASONS, type FlagReason, type TrustTier } from "@/lib/institution/types";

export function TrustPill({ tier }: { tier: TrustTier }) {
  return tier === "osr" ? <Pill variant="trust-osr">OSR-verified</Pill> : tier === "curated" ? <Pill variant="trust-curated">Curated</Pill> : <Pill variant="trust-community">Community</Pill>;
}

export function LibraryItemSheet({ detail, open, onClose, viewerIsSteward }: { detail: LibraryItemDetail | null; open: boolean; onClose: () => void; viewerIsSteward: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [flagOpen, setFlagOpen] = useState(false);
  const [reason, setReason] = useState<FlagReason>("outdated");
  const [note, setNote] = useState("");
  const [versionOpen, setVersionOpen] = useState(false);
  const [versionNote, setVersionNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  if (!detail) return null;
  const { item, row } = detail;
  const canEdit = detail.mine || viewerIsSteward;

  const download = () =>
    start(async () => {
      const res = await getLibraryDownloadUrlAction({ itemId: item.id });
      if (!res.ok) return toast({ message: res.error, tone: "error" });
      window.open(res.url, "_blank", "noopener");
      router.refresh();
    });
  const copyCitation = async () => {
    try {
      await navigator.clipboard.writeText(detail.citation);
      toast({ message: "Citation copied" });
    } catch {
      toast({ message: "Couldn't access the clipboard", tone: "error" });
    }
  };
  const confirm = () =>
    start(async () => {
      const res = detail.canConfirm ? await confirmLibraryItemAction({ itemId: item.id }) : await requestLibraryUpdateAction({ itemId: item.id });
      if (!res.ok) return toast({ message: res.error, tone: "error" });
      toast({ message: res.message });
      router.refresh();
    });
  const flag = () =>
    start(async () => {
      const res = await flagLibraryItemAction({ itemId: item.id, reason, note });
      if (!res.ok) return toast({ message: res.error, tone: "error" });
      setFlagOpen(false);
      setNote("");
      toast({ message: res.message, action: { label: "Undo", onClick: () => void withdrawFlagAction({ flagId: res.flagId }).then(() => router.refresh()) } });
      router.refresh();
    });
  const addVersion = () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return toast({ message: "Choose a file first", tone: "error" });
    const fd = new FormData();
    fd.set("item_id", item.id);
    fd.set("note", versionNote);
    fd.set("file", file);
    start(async () => {
      const res = await addLibraryVersionAction(fd);
      if (!res.ok) return toast({ message: res.error, tone: "error" });
      setVersionOpen(false);
      setVersionNote("");
      toast({ message: `Version ${res.version} uploaded · review due moved a year out` });
      router.refresh();
    });
  };

  return (
    <>
      <SlideOver
        open={open}
        onClose={onClose}
        label="Library item"
        width={640}
        header={
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <TrustPill tier={item.trust_tier} />
              <span className="text-meta text-ink-muted">{detail.typeLabel}</span>
              {item.review_status === "pending_review" ? <Pill variant="status-draft">In the steward queue</Pill> : item.review_status === "changes_requested" ? <Pill variant="status-needs-review">Changes requested</Pill> : null}
            </div>
            <h2 className="m-0 text-title font-semibold text-ink">{item.title}</h2>
            <p className="mb-0 mt-1.5 text-meta text-ink-muted">{row.meta}</p>
          </div>
        }
        footer={
          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-2">
              <Button variant="secondary" size={32} onClick={download} disabled={pending || !item.file_name}>Download</Button>
              <Button variant="secondary" size={32} onClick={copyCitation}>Copy citation</Button>
              {canEdit ? <Button variant="ghost" size={32} onClick={() => setVersionOpen(true)}>New version</Button> : null}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size={32} onClick={() => setFlagOpen(true)}>Flag an issue</Button>
              <Button variant="primary" size={32} onClick={confirm} disabled={pending}>{detail.confirmLabel}</Button>
            </div>
          </div>
        }
      >
        <div className="flex flex-col gap-[18px] px-6 py-5">
          {row.stale ? <div className="rounded-[8px] border border-warning-border bg-warning-tint px-3 py-2.5 text-dense leading-normal text-warning-dark">Past its review date ({row.confirmed}). Treat as historical until the uploader or a steward re-confirms it.</div> : null}
          {item.review_status === "changes_requested" && item.steward_note ? <div className="rounded-[8px] border border-warning-border bg-warning-tint px-3 py-2.5 text-dense leading-normal text-warning-dark">A steward asked for changes: “{item.steward_note}”. Upload a new version to send it back for review.</div> : null}
          <section>
            <p className="mb-2 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">Provenance</p>
            <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2.5 text-dense">
              {detail.provenance.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-ink-muted">{k}</dt>
                  <dd className="m-0 font-medium text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section>
            <p className="mb-2 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">Excerpt</p>
            <blockquote className="m-0 border-l-2 border-line-control bg-canvas px-3.5 py-3 text-body leading-relaxed text-ink-on-tint">{item.excerpt || "No text could be extracted from this file. Download the original to read it."}</blockquote>
            <p className="mb-0 mt-1.5 text-meta text-ink-muted">Shared for calibration of scope and framing. Do not copy language into a submission.</p>
          </section>
          {item.tags.length ? (
            <section>
              <p className="mb-2 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">Tags</p>
              <div className="flex flex-wrap gap-1">{item.tags.map((t) => <Pill key={t} variant="tag">{t}</Pill>)}</div>
            </section>
          ) : null}
          <section>
            <p className="mb-2 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">History</p>
            <div className="rounded-[8px] border border-line">
              {detail.history.length ? detail.history.map((h, i) => (
                <div key={i} className="flex justify-between gap-3 border-t border-line-row px-3 py-2 text-dense first:border-t-0">
                  <span className="text-ink">{h.what}</span>
                  <span className="whitespace-nowrap text-ink-muted">{h.when}</span>
                </div>
              )) : <div className="px-3 py-2 text-dense text-ink-muted">No history yet.</div>}
            </div>
          </section>
        </div>
      </SlideOver>

      <Dialog
        open={flagOpen}
        onClose={() => setFlagOpen(false)}
        title="Flag an issue"
        description="The stewards and the uploader are notified. Nothing is removed until a steward acts."
        footer={<><Button variant="secondary" size={32} onClick={() => setFlagOpen(false)}>Cancel</Button><Button variant="primary" size={32} onClick={flag} disabled={pending}>Flag for the stewards</Button></>}
      >
        <div className="flex flex-col gap-3 py-1">
          <Field label="What's wrong?" labelSize={12}>{({ id }) => <Select id={id} size={32} value={reason} onChange={(e) => setReason(e.target.value as FlagReason)}>{FLAG_REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</Select>}</Field>
          <Field label="Note" labelSize={12} hint="optional">{({ id }) => <Textarea id={id} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Which page or figure, and why" />}</Field>
        </div>
      </Dialog>

      <Dialog
        open={versionOpen}
        onClose={() => setVersionOpen(false)}
        title="Upload a new version"
        description="The original stays downloadable from the history; search text, excerpt and review date refresh from the new file."
        footer={<><Button variant="secondary" size={32} onClick={() => setVersionOpen(false)}>Cancel</Button><Button variant="primary" size={32} onClick={addVersion} disabled={pending}>Upload version {item.version + 1}</Button></>}
      >
        <div className="flex flex-col gap-3 py-1">
          <Field label="File" labelSize={12} help="PDF or Word, up to 25 MB.">{({ id }) => <input id={id} ref={fileRef} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="block text-dense text-ink" />}</Field>
          <Field label="What changed" labelSize={12} hint="optional">{({ id }) => <Textarea id={id} rows={2} value={versionNote} onChange={(e) => setVersionNote(e.target.value)} placeholder="Updated research expenditures" />}</Field>
        </div>
      </Dialog>
    </>
  );
}
