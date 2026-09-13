"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { saveDraftAction, sendOutreachAction } from "@/app/actions/outreach-actions";
import { Button } from "@/components/ui/button";
import { OutreachEmailPreview } from "@/components/outreach/email-preview";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { PREVIEW_ASSETS, renderOutreachEmail } from "@/lib/email/outreach-email-html";
import { assembleBody } from "@/lib/outreach/beats";
import type { DraftNoticeGroup, DraftRecipient, DraftSet, WhyYouAlt } from "@/lib/outreach/draft-queries";
import { replyToFor, senderLabel } from "@/lib/outreach/sender";
import * as v from "@/lib/outreach/draft-view";
import { cn } from "@/lib/utils/cn";
import { useSubmitTransition } from "@/lib/hooks/use-submit-transition";

/**
 * Message — Draft outreach (design_handoff_prospera_review_outreach README
 * §6). One message per match, assembled from four beats; the strategist edits
 * any of them, and "why you" — the only sentence that changes per recipient —
 * can be swapped between the evidence-led line and the sharper one when the
 * notice's profile can say it.
 *
 * Beats 1, 3 and 4 and the subject are one text per notice (the send path is
 * one message per notice, personalised per recipient), so editing them edits
 * every recipient on that notice, and the beat says so. "Save as draft" writes
 * the Compose tab's own draft column; "Send N · individually" is the existing
 * send action once per notice. Nothing is contacted until you send.
 */

type ItemEdit = { subject: string; relevant: string; know: string; next: string };

export function DraftScreen({ set, initialMatch, from }: { set: DraftSet; initialMatch: string | null; from: v.DraftFrom }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useSubmitTransition();
  const { recipients, notices, sender } = set;
  const sentAs = senderLabel({ identity: set.team.sendingIdentity, senderName: sender.name, teamName: set.team.name });
  const replyTo = replyToFor({ identity: set.team.sendingIdentity, sendingAddress: set.team.sendingAddress, replyToEmail: set.team.replyTo, senderEmail: null });
  const first = recipients.find((r) => r.id === initialMatch) ?? recipients.find((r) => r.email) ?? recipients[0] ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(first?.id ?? null);
  const [edits, setEdits] = useState<Record<string, ItemEdit>>(() => Object.fromEntries(notices.map((g) => [g.itemId, { subject: g.subject, relevant: g.beats.relevant.text, know: g.beats.know.text, next: g.beats.next.text }])));
  const [alt, setAlt] = useState<Record<string, WhyYouAlt>>(() => Object.fromEntries(recipients.map((r) => [r.id, r.savedAlt ?? "evidence"])));
  const [hooks, setHooks] = useState<Record<string, string>>(() => Object.fromEntries(recipients.map((r) => [r.id, r.savedHook ?? (r.savedAlt === "sharp" && r.whyYou.sharp ? r.whyYou.sharp.text : r.whyYou.evidence.text)])));
  const [dirty, setDirty] = useState<Set<string>>(() => new Set());
  const [savedAt, setSavedAt] = useState<Record<string, string | null>>(() => Object.fromEntries(notices.map((g) => [g.itemId, g.savedAt])));
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [sent, setSent] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const current = recipients.find((r) => r.id === selectedId) ?? null;
  const group = current ? notices.find((g) => g.itemId === current.itemId) ?? null : null;
  const sendable = useMemo(() => recipients.filter((r) => r.email), [recipients]);
  // One name each: the same person on three notices is one missing address.
  const noEmail = useMemo(() => Array.from(new Set(recipients.filter((r) => !r.email).map((r) => r.name))), [recipients]);
  const onNotice = (g: DraftNoticeGroup) => recipients.filter((r) => r.itemId === g.itemId);
  const counts = { matches: recipients.filter((r) => !r.followUp).length, followUps: recipients.filter((r) => r.followUp).length };

  const markDirty = (itemId: string) => setDirty((d) => new Set(d).add(itemId));
  const setBeat = (itemId: string, key: keyof ItemEdit, value: string) => {
    setEdits((e) => ({ ...e, [itemId]: { ...e[itemId]!, [key]: value } }));
    markDirty(itemId);
  };
  const setHook = (r: DraftRecipient, value: string) => {
    setHooks((h) => ({ ...h, [r.id]: value }));
    markDirty(r.itemId);
  };
  const toggleAlt = (r: DraftRecipient) => {
    const next: WhyYouAlt = alt[r.id] === "sharp" ? "evidence" : "sharp";
    setAlt((a) => ({ ...a, [r.id]: next }));
    setHook(r, next === "sharp" && r.whyYou.sharp ? r.whyYou.sharp.text : r.whyYou.evidence.text);
  };

  /** The composed "why you" for the variant a recipient is on. */
  const composedHook = (r: DraftRecipient) => (alt[r.id] === "sharp" && r.whyYou.sharp ? r.whyYou.sharp.text : r.whyYou.evidence.text);
  /** True when the strategist changed a beat from what Prospera composed — the only text worth saving, so a later reload still composes from the current notice and team settings. */
  const edited = (g: DraftNoticeGroup, key: keyof ItemEdit) => (key === "subject" ? edits[g.itemId]!.subject !== g.subject : edits[g.itemId]![key] !== g.beats[key].text);
  const hookEdited = (r: DraftRecipient) => (hooks[r.id] ?? "") !== composedHook(r);

  /** What `saveDraftAction` and `sendOutreachAction` receive for one notice: subject, the assembled body, and each recipient's "why you". Only edited texts are kept in the saved draft. */
  const payloadFor = (g: DraftNoticeGroup) => {
    const e = edits[g.itemId]!;
    const people = onNotice(g);
    const keep = (key: "relevant" | "know" | "next") => (edited(g, key) ? e[key] : undefined);
    return {
      subject: e.subject,
      body: assembleBody({ relevant: e.relevant, know: e.know, next: e.next }, sender.signoff),
      hooks: Object.fromEntries(people.map((r) => [r.id, hooks[r.id] ?? ""])),
      email: { relevant: e.relevant, know: e.know, next: e.next },
      people,
      savedSubject: edited(g, "subject") ? e.subject : undefined,
      savedHooks: Object.fromEntries(people.filter(hookEdited).map((r) => [r.id, hooks[r.id] ?? ""])),
      beats: { relevant: keep("relevant"), know: keep("know"), next: keep("next") },
      alt: Object.fromEntries(people.map((r) => [r.id, alt[r.id] ?? "evidence"])),
    };
  };

  const save = () =>
    startTransition(async () => {
      const targets = notices.filter((g) => dirty.has(g.itemId) || !savedAt[g.itemId]);
      if (!targets.length) return toast({ message: "Nothing changed since the last save." });
      let failed = 0;
      for (const g of targets) {
        const p = payloadFor(g);
        const r = await saveDraftAction(g.itemId, { subject: p.savedSubject, body: p.body, mode: "personalized", to: p.people.map((x) => x.id), hooks: p.savedHooks, beats: p.beats, alt: p.alt });
        if (!r.ok) {
          failed += 1;
          toast({ message: r.error, tone: "error" });
          continue;
        }
        setSavedAt((s) => ({ ...s, [g.itemId]: r.savedAt }));
        setDirty((d) => {
          const n = new Set(d);
          n.delete(g.itemId);
          return n;
        });
      }
      if (!failed) toast({ message: targets.length === 1 ? "Draft saved" : `${targets.length} drafts saved` });
    });

  const send = () =>
    startTransition(async () => {
      let sentCount = 0;
      const failed: Array<{ name: string; error: string }> = [];
      for (const g of notices) {
        const p = payloadFor(g);
        const ids = p.people.filter((r) => r.email).map((r) => r.id);
        if (!ids.length) continue;
        const r = await sendOutreachAction({ itemId: g.itemId, subject: p.subject, body: p.body, mode: "personalized", recipientIds: ids, hooks: p.hooks, email: p.email });
        if (!r.ok) {
          failed.push(...p.people.filter((x) => ids.includes(x.id)).map((x) => ({ name: x.name, error: r.error })));
          continue;
        }
        sentCount += r.sent;
        failed.push(...r.failed);
      }
      setConfirmOpen(false);
      if (failed.length) toast({ message: failed.map((f) => `${f.name}: ${f.error}`).join(" · "), tone: "error", duration: 10_000 });
      if (!sentCount) return;
      setSent(sentCount);
      toast({ message: v.SENT_NOTE });
      router.push("/outreach");
    });

  if (!current || !group) {
    return (
      <div className={v.PAGE}>
        <Link href={v.backHref(from)} className={v.BACK}>{v.backLabel(from)}</Link>
        <h1 className={v.H1}>Draft outreach</h1>
        <p className={v.SUB}>{v.draftSubline(counts)}</p>
        <div className={cn(v.EMPTY, "mt-[18px]")}>
          <p className={v.EMPTY_TITLE}>Nothing to draft</p>
          <p className={v.EMPTY_TEXT}>A message is drafted for every confirmed match with no message yet. {v.NOTHING_SENT}</p>
          <div className={v.EMPTY_LINKS}>
            <Link href="/review" className={v.EMPTY_LINK}>Confirm a match in Review →</Link>
            <Link href="/outreach" className={v.EMPTY_LINK}>Open outreach →</Link>
          </div>
        </div>
      </div>
    );
  }

  const edit = edits[group.itemId]!;
  const shared = v.sharedNote(onNotice(group).length);
  const currentAlt = alt[current.id] ?? "evidence";
  const whySource = `${currentAlt === "sharp" && current.whyYou.sharp ? current.whyYou.sharp.source : current.whyYou.evidence.source}${hookEdited(current) ? v.EDITED : ""}`;
  const sourceOf = (key: "relevant" | "know" | "next") => `${group.beats[key].source}${edited(group, key) ? v.EDITED : ""}`;
  const stamp = v.stampText({ savedAt: savedAt[group.itemId] ?? null, dirty: dirty.has(group.itemId), now });
  const previewHtml = preview
    ? renderOutreachEmail({
        subject: edit.subject,
        preheader: hooks[current.id] ?? "",
        greeting: `Dear Dr. ${current.lastName},`,
        relevant: edit.relevant,
        whyYou: hooks[current.id] ?? "",
        know: edit.know,
        next: edit.next,
        card: group.card,
        sender: { name: sender.name, title: sender.title, email: replyTo },
        community: current.community,
        urls: { interested: "#", pass: "#" },
        assets: PREVIEW_ASSETS,
      })
    : null;

  return (
    <div className={v.PAGE}>
      <Link href={v.backHref(from)} className={v.BACK}>{v.backLabel(from)}</Link>
      <h1 className={v.H1}>Draft outreach</h1>
      <p className={v.SUB}>{v.draftSubline(counts)}</p>

      <div className={v.LAYOUT}>
        <aside className={v.ASIDE} aria-label="Recipients">
          <p className={v.ASIDE_LABEL}>Recipients</p>
          {recipients.map((r) => {
            const selected = r.id === current.id;
            const state = v.recipientState({ selected, email: r.email });
            return (
              <button key={r.id} type="button" aria-pressed={selected} onClick={() => setSelectedId(r.id)} className={cn(v.RECIPIENT, selected ? v.RECIPIENT_TONE.selected : v.RECIPIENT_TONE.idle)}>
                <p className={v.RECIPIENT_NAME}>{r.name}</p>
                <p className={v.RECIPIENT_NOTICE}>{[r.noticeNumber, r.noticeTitle].filter(Boolean).join(" · ")}</p>
                <p className={state === "No email on file" ? v.RECIPIENT_STATE_WARN : v.RECIPIENT_STATE}>{r.followUp && state !== "No email on file" ? `${state} · follow-up` : state}</p>
              </button>
            );
          })}
          <p className={v.ASIDE_NOTE}>{v.asideNote(sentAs)}</p>
        </aside>

        <div className={v.MAIN}>
          <section className={v.CARD} aria-label={`Message to ${current.name}`}>
            <div className={v.TO_ROW}>
              <span className={v.TO_LABEL}>To</span>
              <span className={current.email ? v.TO_ADDRESS : v.TO_MISSING}>{current.email ?? `${current.name} · no email on file`}</span>
            </div>
            <div className={v.SUBJECT_BLOCK}>
              <label htmlFor="draft-subject" className={v.EYEBROW}>Subject</label>
              <input id="draft-subject" className={v.SUBJECT_INPUT} value={edit.subject} onChange={(e) => setBeat(group.itemId, "subject", e.target.value)} />
              {shared ? <p className={v.BEAT_NOTE}>{shared}</p> : null}
            </div>

            <BeatRow id="beat-relevant" label="Why it is relevant" source={sourceOf("relevant")} value={edit.relevant} onChange={(t) => setBeat(group.itemId, "relevant", t)} note={shared} />
            <BeatRow id="beat-why-you" label="Why you" source={whySource} value={hooks[current.id] ?? ""} onChange={(t) => setHook(current, t)} note={null}>
              <div className={v.TOGGLE_ROW}>
                {current.whyYou.sharp ? (
                  <button type="button" className={v.TOGGLE_BTN} onClick={() => toggleAlt(current)}>{v.toggleLabel(currentAlt)}</button>
                ) : null}
                <span className={v.BEAT_NOTE}>{v.TOGGLE_NOTE}</span>
              </div>
            </BeatRow>
            <BeatRow id="beat-know" label="What to know" source={sourceOf("know")} value={edit.know} onChange={(t) => setBeat(group.itemId, "know", t)} note={shared} />
            <BeatRow id="beat-next" label="Next step" source={sourceOf("next")} value={edit.next} onChange={(t) => setBeat(group.itemId, "next", t)} note={shared} />

            <div className={v.FOOTER}>
              {sent != null ? (
                <p className={v.FOOTER_NOTE}><span className={v.SENT_LABEL}>Sent ✓</span> {v.SENT_NOTE}</p>
              ) : (
                <p className={v.FOOTER_NOTE}>{v.footerNote(sentAs)}</p>
              )}
              <div className={v.FOOTER_ACTIONS}>
                <span className={v.STAMP}>{stamp}</span>
                <Button variant="secondary" size={32} onClick={() => setPreview((p) => !p)}>{preview ? "Hide preview" : `Preview as ${current.firstName}`}</Button>
                <Button variant="secondary" size={32} onClick={save} disabled={pending || sent != null}>Save as draft</Button>
                <Button variant="primary" size={32} onClick={() => setConfirmOpen(true)} disabled={pending || sent != null || sendable.length === 0}>{v.sendLabel(sendable.length)}</Button>
              </div>
            </div>
          </section>

          {previewHtml ? (
            <div>
              <p className={v.BEAT_NOTE}>What {current.name} receives · the two buttons are live in the sent message, inert here</p>
              <div className="mt-2">
                <OutreachEmailPreview html={previewHtml} title={`Email preview for ${current.name}`} />
              </div>
            </div>
          ) : null}

          {noEmail.length ? (
            <p className={v.WARN}>
              {noEmail.join(", ")} {noEmail.length === 1 ? "has" : "have"} no email on file and will be skipped. Add the address on the investigator’s page, then come back.
            </p>
          ) : null}
        </div>
      </div>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={`Send ${sendable.length} ${sendable.length === 1 ? "message" : "messages"}, individually?`}
        description={`Each goes out as “${sentAs}”${set.team.fromAddress ? ` from ${set.team.fromAddress}` : ""}; replies go to ${replyTo ?? "your address"} and thread onto the match. Each recipient is marked Contacted on their own match — never the notice.`}
        width={460}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={send} disabled={pending}>{pending ? "Sending…" : v.sendLabel(sendable.length)}</Button>
          </>
        }
      >
        <div className="py-1">
          {sendable.map((r) => (
            <div key={r.id} className={v.CONFIRM_ROW}>
              <span className={v.CONFIRM_NAME}>{r.name}</span>
              <span className={v.CONFIRM_EMAIL}>{r.email}</span>
            </div>
          ))}
        </div>
      </Dialog>
    </div>
  );
}

/** One beat: the label and its source on the left, the editable text on the right. */
function BeatRow({ id, label, source, value, onChange, note, children }: { id: string; label: string; source: string; value: string; onChange: (text: string) => void; note: string | null; children?: ReactNode }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <div className={v.BEAT}>
      <div>
        <label htmlFor={id} className={v.EYEBROW}>{label}</label>
        <p className={v.BEAT_SOURCE}>{source}</p>
      </div>
      <div>
        <textarea id={id} ref={ref} rows={1} className={v.BEAT_TEXT} value={value} onChange={(e) => onChange(e.target.value)} />
        {note ? <p className={v.BEAT_NOTE}>{note}</p> : null}
        {children}
      </div>
    </div>
  );
}
