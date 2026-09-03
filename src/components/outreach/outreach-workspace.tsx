"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { sendOutreachAction, setNextActionAction, setOwnerAction, setStageAction, setSuggestionsModeAction } from "@/app/actions/outreach-actions";
import { ActivityTab } from "@/components/outreach/activity-tab";
import { ComposeTab, type ComposeState } from "@/components/outreach/compose-tab";
import { RecipientsTab } from "@/components/outreach/recipients-tab";
import { ParkDialog } from "@/components/outreach/outreach-board";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SlideOver } from "@/components/ui/slide-over";
import { useToast } from "@/components/ui/toast";
import { fmtMonD } from "@/lib/investigators/sources";
import { buildBody, buildSubject, hookFromReasons } from "@/lib/outreach/draft";
import type { WorkspaceData } from "@/lib/outreach/queries";
import { STAGE_LABEL } from "@/lib/outreach/types";
import { cn } from "@/lib/utils/cn";

type Tab = "recipients" | "compose" | "activity";

export function OutreachWorkspace({ data, tab: initialTab, evidenceFor, viewer, onClose, hrefFor }: { data: WorkspaceData; tab: Tab; evidenceFor: string | null; viewer: { id: string; name: string; title: string | null }; onClose: () => void; hrefFor: (patch: { tab?: string | null; evidence?: string | null }) => string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [evidence, setEvidence] = useState<string | null>(evidenceFor);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [parkOpen, setParkOpen] = useState(false);
  const [nextAction, setNextAction] = useState(data.item.nextAction ?? "");
  const [nextDate, setNextDate] = useState(data.item.nextActionDate ?? "");
  const composeRef = useRef<ComposeState | null>(null);
  const [sendReady, setSendReady] = useState<{ count: number; list: Array<{ name: string; email: string }> }>({ count: 0, list: [] });

  useEffect(() => {
    router.replace(hrefFor({ tab, evidence }), { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, evidence]);

  const people = data.recipients.filter((r) => r.kind === "person");
  const communities = data.recipients.filter((r) => r.kind === "community");
  const selectedSummary = `${people.length} ${people.length === 1 ? "person" : "people"} · ${communities.length} ${communities.length === 1 ? "community" : "communities"}`;
  const owner = data.members.find((m) => m.id === data.item.ownerId);

  const sender = { name: viewer.name, title: viewer.title, signature: data.team.signature };
  const draftNotice = { title: data.notice.title, opportunityNumber: data.notice.number, agency: data.notice.agency, activityCode: data.notice.activityCode, clinicalTrialNote: data.notice.clinicalTrialNote, dueDate: data.notice.dueDate, awardCeiling: data.notice.awardCeiling, projectYears: null, multiPi: data.notice.multiPi, routingDate: data.notice.routingDate };
  const defaultDraft = { subject: data.item.draft.subject ?? buildSubject(draftNotice), body: data.item.draft.body ?? buildBody(draftNotice, sender, data.item.draft.mode ?? "personalized"), mode: data.item.draft.mode ?? ("personalized" as const) };

  const saveNext = () =>
    startTransition(async () => {
      if ((nextAction || "") === (data.item.nextAction ?? "") && (nextDate || "") === (data.item.nextActionDate ?? "")) return;
      const r = await setNextActionAction(data.item.id, { text: nextAction, date: nextDate || null });
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      router.refresh();
    });

  const send = () => {
    const c = composeRef.current;
    if (!c) return;
    startTransition(async () => {
      const r = await sendOutreachAction({ itemId: data.item.id, subject: c.subject, body: c.body, mode: c.mode, recipientIds: c.to, hooks: c.hooks });
      setConfirmOpen(false);
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      toast({ message: `Sent to ${r.sent} · ${data.item.stage === "triage" ? "moved to Contacting · " : ""}recipients marked Contacted${r.failed.length ? ` · ${r.failed.length} failed` : ""}` });
      if (r.failed.length) toast({ message: r.failed.map((f) => `${f.name}: ${f.error}`).join(" · "), tone: "error", duration: 10_000 });
      setTab("recipients");
      router.refresh();
    });
  };

  return (
    <SlideOver
      open
      onClose={onClose}
      label="Outreach workspace"
      width={880}
      header={
        <div className="min-w-0">
          <p className="m-0 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">{STAGE_LABEL[data.item.stage]} · {owner?.name ?? "Unassigned"}</p>
          <h2 className="mb-0 mt-1 text-[18px] font-semibold leading-[1.3] tracking-[-0.01em] text-ink">{data.notice.title}</h2>
          <p className="mb-0 mt-1.5 text-meta text-ink-muted">
            {[data.notice.agency, data.notice.number, data.notice.instrument].filter(Boolean).join(" · ")} ·{" "}
            <span className={cn("font-medium", data.notice.dueTone === "urgent" ? "text-danger" : data.notice.dueTone === "closed" ? "text-ink-muted" : "text-ink")}>{data.notice.dueLine}</span>
            {data.notice.followingLine ? ` · ${data.notice.followingLine}` : ""}
            {data.notice.routingDate ? ` · internal routing ${fmtMonD(data.notice.routingDate)}` : ""} ·{" "}
            <Link href={`/opportunities/${data.notice.id}`} className="text-teal hover:text-navy">Full notice →</Link>
          </p>
        </div>
      }
      footer={
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-meta text-ink-muted">Owner</span>
            <Select size={30} value={data.item.ownerId ?? ""} onChange={(e) => startTransition(async () => { const r = await setOwnerAction(data.item.id, e.target.value || null); if (!r.ok) return toast({ message: r.error, tone: "error" }); router.refresh(); })}>
              {data.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              <option value="">Unassigned</option>
            </Select>
            <span className="ml-2 text-meta text-ink-muted">Next action</span>
            <Input size={32} value={nextAction} onChange={(e) => setNextAction(e.target.value)} onBlur={saveNext} placeholder="e.g. Confirm PI interest" className="min-w-[140px] flex-1 text-dense" />
            <Input size={32} type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} onBlur={saveNext} className="w-[150px] text-dense" />
          </div>
          {tab === "recipients" ? (
            <div className="flex items-center justify-between gap-2">
              {data.item.suggestionsState === "ready" || data.item.suggestionsState === "outdated" ? (
                <button type="button" className="text-dense font-medium text-ink-muted hover:text-ink" onClick={() => startTransition(async () => { const r = await setSuggestionsModeAction(data.item.id, "manual"); if (!r.ok) return toast({ message: r.error, tone: "error" }); router.refresh(); })}>Skip suggestions</button>
              ) : <span />}
              <div className="ml-auto flex gap-2">
                <Button variant="secondary" size={32} onClick={() => setParkOpen(true)}>Park</Button>
                <Button variant="primary" size={32} onClick={() => setTab("compose")}>Compose outreach · {selectedSummary}</Button>
              </div>
            </div>
          ) : null}
          {tab === "compose" ? (
            <div className="flex items-center justify-between gap-2">
              <DraftStamp savedAt={data.item.draftSavedAt} />
              <div className="flex gap-2">
                <Button variant="secondary" size={32} onClick={() => setTab("recipients")}>Back</Button>
                <Button variant="primary" size={32} disabled={pending || sendReady.count === 0} onClick={() => setConfirmOpen(true)}>Send {sendReady.count || ""}</Button>
              </div>
            </div>
          ) : null}
        </div>
      }
    >
      <div role="tablist" className="flex gap-6 border-b border-line px-6">
        {([["recipients", `Recipients`, data.recipients.length], ["compose", "Message", null], ["activity", "Notes & activity", data.activity.length]] as const).map(([key, label, count]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => { setTab(key); setEvidence(null); }} className={cn("inline-flex gap-1 border-b-2 py-2.5 text-body font-medium", tab === key ? "border-navy text-ink" : "border-transparent text-ink-muted hover:text-ink")}>
            {label} {count != null ? <span className="text-ink-muted">{count}</span> : null}
          </button>
        ))}
      </div>

      {tab === "recipients" ? <RecipientsTab data={data} evidenceFor={evidence} onEvidence={setEvidence} viewer={viewer} /> : null}
      {tab === "compose" ? (
        <ComposeTab
          data={data}
          defaultDraft={defaultDraft}
          sender={sender}
          notice={draftNotice}
          hookFor={(r) => r.hook ?? hookFromReasons(data.suggestions.find((s) => s.investigatorId === r.investigatorId)?.reasons ?? [], { contactedAt: r.contactedAt, routingDate: data.notice.routingDate, communityName: r.kind === "community" ? r.name : null })}
          onState={(s) => { composeRef.current = s; setSendReady({ count: s.to.length, list: s.toList }); }}
          onEditRecipients={() => setTab("recipients")}
        />
      ) : null}
      {tab === "activity" ? <ActivityTab data={data} viewer={viewer} /> : null}

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={`Send to ${sendReady.count} ${sendReady.count === 1 ? "recipient" : "recipients"}?`}
        description={`Sent individually as “${viewer.name} via Prospera” from ${data.team.fromAddress ?? "the verified sender"}; replies go to ${data.team.replyTo ?? "your address"} and are recorded here. Each person is marked Contacted${data.item.stage === "triage" ? " and the item moves to Contacting" : ""}.`}
        width={460}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={send} disabled={pending}>{pending ? "Sending…" : `Send ${sendReady.count}`}</Button>
          </>
        }
      >
        <div className="py-1">
          {sendReady.list.map((c) => (
            <div key={c.email + c.name} className="flex justify-between gap-3 border-b border-line-row py-2 text-dense">
              <span className="whitespace-nowrap font-medium text-ink">{c.name}</span>
              <span className="truncate text-ink-muted">{c.email}</span>
            </div>
          ))}
        </div>
      </Dialog>
      <ParkDialog card={parkOpen ? { id: data.item.id, title: data.notice.title } : null} onClose={() => setParkOpen(false)} onDone={() => { setParkOpen(false); router.refresh(); }} />
      {data.item.stage === "submitted" ? null : null}
      <span className="hidden">{setStageAction.name}</span>
    </SlideOver>
  );
}

function DraftStamp({ savedAt }: { savedAt: string | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!savedAt) return <span className="text-meta text-ink-muted">Draft not saved yet</span>;
  const mins = Math.max(0, Math.round((Date.now() - new Date(savedAt).getTime()) / 60_000));
  return <span className="text-meta text-ink-muted">Draft saved · {mins === 0 ? "just now" : `${mins} min ago`}</span>;
}
