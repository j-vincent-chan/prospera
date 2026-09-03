"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { saveDraftAction } from "@/app/actions/outreach-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fmtMonD } from "@/lib/investigators/sources";
import { buildBody, buildSubject, DEFAULT_PERSONAL_LINE, renderForRecipient, type DraftNotice, type DraftSender } from "@/lib/outreach/draft";
import type { WorkspaceData, WorkspaceRecipient } from "@/lib/outreach/queries";
import { cn } from "@/lib/utils/cn";

export type ComposeState = { subject: string; body: string; mode: "one" | "personalized"; to: string[]; hooks: Record<string, string>; toList: Array<{ name: string; email: string }> };

export function ComposeTab({ data, defaultDraft, sender, notice, hookFor, onState, onEditRecipients }: { data: WorkspaceData; defaultDraft: { subject: string; body: string; mode: "one" | "personalized" }; sender: DraftSender; notice: DraftNotice; hookFor: (r: WorkspaceRecipient) => string; onState: (s: ComposeState) => void; onEditRecipients: () => void }) {
  const recipients = data.recipients;
  const defaultTo = useMemo(() => data.item.draft.to ?? recipients.filter((r) => r.status === "selected" && !r.doNotContact).map((r) => r.id), [data.item.draft.to, recipients]);
  const [to, setTo] = useState<string[]>(defaultTo.filter((id) => recipients.some((r) => r.id === id)));
  const [mode, setMode] = useState<"one" | "personalized">(defaultDraft.mode);
  const [subject, setSubject] = useState(defaultDraft.subject);
  const [body, setBody] = useState(defaultDraft.body);
  const [hooks, setHooks] = useState<Record<string, string>>(() => Object.fromEntries(recipients.map((r) => [r.id, data.item.draft.hooks?.[r.id] ?? hookFor(r)])));
  const [preview, setPreview] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toList = recipients.filter((r) => to.includes(r.id));
  useEffect(() => {
    onState({ subject, body, mode, to, hooks, toList: toList.map((r) => ({ name: r.name, email: r.email ?? "no email on file" })) });
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void saveDraftAction(data.item.id, { subject, body, mode, to, hooks }); }, 1500);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, body, mode, to, hooks]);

  const contactedUnchecked = recipients.filter((r) => r.status !== "selected" && r.kind === "person" && !to.includes(r.id));
  const limitHits = toList.filter((r) => r.kind === "person" && r.quarterSends >= data.team.perInvestigatorLimit && data.team.perInvestigatorLimit > 0);
  const noEmail = toList.filter((r) => !r.email);
  const first = toList[0];
  const previewText = first ? renderForRecipient({ subject, body, lastName: first.lastName, personalLine: mode === "personalized" ? hooks[first.id] ?? DEFAULT_PERSONAL_LINE : null }) : null;

  const regenerate = () => {
    setSubject(buildSubject(notice));
    setBody(buildBody(notice, sender, mode));
  };
  const switchMode = (m: "one" | "personalized") => {
    setMode(m);
    setBody((b) => (b === buildBody(notice, sender, mode) ? buildBody(notice, sender, m) : b));
  };

  return (
    <div className="flex flex-col gap-[18px] px-6 py-5">
      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <p className="m-0 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">To · {to.length} of {recipients.length} recipients</p>
          <button type="button" onClick={onEditRecipients} className="text-meta font-medium text-teal hover:text-navy">Edit recipients</button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {recipients.map((r) => {
            const on = to.includes(r.id);
            const note = r.status !== "selected" && r.contactedAt ? `contacted ${fmtMonD(r.contactedAt)}` : r.kind === "community" ? "lead + listserv" : r.origin === "suggested" ? "Suggested" : "";
            return (
              <label key={r.id} className={cn("inline-flex h-8 cursor-pointer items-center gap-2 whitespace-nowrap rounded-full border pl-2.5 pr-3 text-dense font-medium", on ? "border-teal bg-teal-tint text-teal" : "border-line-control bg-card text-ink-body", r.doNotContact && "opacity-50")}>
                <input type="checkbox" checked={on} disabled={r.doNotContact} onChange={() => setTo((t) => (on ? t.filter((x) => x !== r.id) : [...t, r.id]))} className="m-0 h-3.5 w-3.5 accent-teal" />
                {r.name}
                {note ? <span className="text-[11px] font-normal opacity-80">{note}</span> : null}
              </label>
            );
          })}
          {recipients.length === 0 ? <p className="m-0 text-dense text-ink-muted">No recipients yet. Add people or tag a community on the Recipients tab.</p> : null}
        </div>
        {contactedUnchecked.length ? (
          <div className="mt-2 rounded-tile border border-warning-border bg-warning-tint px-3 py-2 text-dense leading-normal text-warning-dark">
            {contactedUnchecked.map((r) => `${r.name} already received outreach on this opportunity${r.contactedAt ? ` on ${fmtMonD(r.contactedAt)}` : ""} (${r.status === "contacted" ? "no reply yet" : r.statusLine.toLowerCase()})`).join("; ")}. {contactedUnchecked.length === 1 ? "They’re" : "They’re"} unchecked so nothing goes twice — check {contactedUnchecked.length === 1 ? "them" : "anyone"} to send a follow-up instead.
          </div>
        ) : null}
        {limitHits.length ? <div className="mt-2 rounded-tile border border-warning-border bg-warning-tint px-3 py-2 text-dense leading-normal text-warning-dark">{limitHits.map((r) => r.name).join(", ")} already reached the team limit of {data.team.perInvestigatorLimit} messages this quarter. Send will refuse them until next quarter.</div> : null}
        {noEmail.length ? <div className="mt-2 rounded-tile border border-warning-border bg-warning-tint px-3 py-2 text-dense leading-normal text-warning-dark">{noEmail.map((r) => r.name).join(", ")} {noEmail.length === 1 ? "has" : "have"} no email on file and will be skipped.</div> : null}
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1.5">
          <button type="button" onClick={() => switchMode("one")} className={cn("h-[30px] rounded-control border px-3 text-dense font-medium", mode === "one" ? "border-navy bg-navy text-white" : "border-line-control bg-card text-ink")}>One message</button>
          <button type="button" onClick={() => switchMode("personalized")} className={cn("h-[30px] rounded-control border px-3 text-dense font-medium", mode === "personalized" ? "border-navy bg-navy text-white" : "border-line-control bg-card text-ink")}>Personalized</button>
        </div>
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap text-meta text-ink-muted">Drafted from the notice brief</span>
          <Button variant="secondary" size={28} onClick={regenerate}>Regenerate draft</Button>
        </div>
      </section>

      <section className="flex flex-col gap-2.5">
        <div>
          <label htmlFor="compose-subject" className="mb-1.5 block text-meta font-medium text-ink-body">Subject</label>
          <Input id="compose-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div>
          <label htmlFor="compose-body" className="mb-1.5 block text-meta font-medium text-ink-body">Message <span className="font-normal text-ink-muted">— {mode === "personalized" ? "the bracketed line is replaced per recipient" : "same text to everyone"}</span></label>
          <Textarea id="compose-body" value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[200px] leading-[1.6]" />
        </div>
      </section>

      {mode === "personalized" && toList.length ? (
        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <p className="m-0 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">Personal line per recipient</p>
            <span className="text-meta text-ink-muted">From each profile · replaces the bracketed line</span>
          </div>
          <div className="rounded-card border border-line">
            {toList.map((r) => (
              <div key={r.id} className="grid grid-cols-[28px_150px_minmax(0,1fr)] items-center gap-3 border-t border-line-row px-3.5 py-2.5 first:border-t-0">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-tint text-[11px] font-semibold text-teal">{r.initials}</span>
                <p className="m-0 truncate text-dense font-medium text-ink">{r.name}</p>
                <Input size={32} value={hooks[r.id] ?? ""} onChange={(e) => setHooks((h) => ({ ...h, [r.id]: e.target.value }))} className="text-dense" />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-canvas px-3.5 py-3">
        <p className="m-0 text-meta leading-normal text-ink-body">
          Each message is sent separately as <span className="font-medium text-ink">{sender.name} via Prospera</span> from {data.team.fromAddress ?? "the verified sender"}, reply-to {data.team.replyTo ?? "your address"}, so replies are recorded even if staff change. Team limit: {data.team.perInvestigatorLimit} messages per investigator per quarter. Nothing is sent until you confirm.
        </p>
        <Button variant="secondary" size={28} onClick={() => setPreview((p) => !p)} disabled={!first}>{preview ? "Hide preview" : `Preview as ${first ? first.name.split(" ")[0] : "recipient"}`}</Button>
      </section>
      {preview && previewText ? (
        <section className="whitespace-pre-wrap rounded-card border border-line px-6 py-5 text-body leading-[1.65] text-ink">
          <p className="mb-2.5 mt-0 text-label font-semibold uppercase tracking-[0.08em] text-ink-muted">Preview · as received by {first?.name}</p>
          <p className="m-0 font-medium">{previewText.subject}</p>
          {"\n"}
          {previewText.body}
        </section>
      ) : null}
    </div>
  );
}
