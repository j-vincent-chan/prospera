"use client";

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { SECTION_KEYS, SECTION_LABELS, type SectionKey } from "@/lib/outreach/draft-chat";
import * as v from "@/lib/outreach/draft-view";

/** One turn as the panel shows it; the page keeps what an assistant turn replaced, for Undo. */
export type ChatTurnView =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; text: string; changed: string[]; undone: boolean; error: boolean };

/**
 * Message — Draft outreach (R37): the panel under the preview. A section
 * select, the chosen section as a textarea with its source line (and the
 * "why you" toggle when the sharper line exists), then the chat: what the
 * strategist asked, what Prospera did, Undo on each rewrite. Presentational
 * — every text lives in the page's draft state, so a hand edit and a rewrite
 * are the same kind of change and the preview follows both.
 */
export function DraftChatPanel({
  focus,
  onFocus,
  text,
  onText,
  source,
  note,
  toggle,
  turns,
  pending,
  onAsk,
  onUndo,
}: {
  focus: SectionKey;
  onFocus: (key: SectionKey) => void;
  text: string;
  onText: (text: string) => void;
  /** "from the notice · Part 2 · Section II" — where the section came from, "· edited by you" once changed. */
  source: string;
  /** "same for the 2 recipients on this notice", or null. */
  note: string | null;
  /** The "why you" row: its note always, the toggle only when the sharper line exists. */
  toggle: { note: string; button: { label: string; onClick: () => void } | null } | null;
  turns: ChatTurnView[];
  pending: boolean;
  onAsk: (instruction: string) => void;
  onUndo: (turnId: string) => void;
}) {
  const [input, setInput] = useState("");
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const label = SECTION_LABELS[focus];

  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [text, focus]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, pending]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = input.trim();
    if (!q || pending) return;
    onAsk(q);
    setInput("");
  };

  return (
    <section className={v.CHAT} aria-label={v.CHAT_TITLE}>
      <div className={v.CHAT_HEAD}>
        <div>
          <p className={v.EYEBROW}>{v.CHAT_TITLE}</p>
          <p className={v.CHAT_SUB}>{v.CHAT_SUBTITLE}</p>
        </div>
        <label className={v.CHAT_SECTION_LABEL}>
          <span>Section</span>
          <Select size={32} value={focus} onChange={(e) => onFocus(e.target.value as SectionKey)}>
            {SECTION_KEYS.map((k) => (
              <option key={k} value={k}>{SECTION_LABELS[k]}</option>
            ))}
          </Select>
        </label>
      </div>

      <div className={v.CHAT_EDITOR}>
        <div className={v.CHAT_EDITOR_HEAD}>
          <label htmlFor="draft-section" className={v.EYEBROW}>{label}</label>
          <p className={v.BEAT_SOURCE}>{source}</p>
        </div>
        <textarea id="draft-section" ref={areaRef} rows={1} className={v.BEAT_TEXT} value={text} onChange={(e) => onText(e.target.value)} />
        {note ? <p className={v.BEAT_NOTE}>{note}</p> : null}
        {toggle ? (
          <div className={v.TOGGLE_ROW}>
            {toggle.button ? (
              <button type="button" className={v.TOGGLE_BTN} onClick={toggle.button.onClick}>{toggle.button.label}</button>
            ) : null}
            <span className={v.BEAT_NOTE}>{toggle.note}</span>
          </div>
        ) : null}
      </div>

      <div ref={logRef} className={v.CHAT_LOG} role="log" aria-live="polite">
        {turns.length === 0 && !pending ? <p className={v.CHAT_EMPTY_TEXT}>{v.CHAT_EMPTY}</p> : null}
        {turns.map((t) => (
          <div key={t.id} className={v.CHAT_TURN}>
            <p className={v.CHAT_ROLE}>{t.role === "user" ? "You" : "Prospera"}</p>
            <div>
              <p className={t.role === "assistant" && t.error ? v.CHAT_TEXT_ERROR : v.CHAT_TEXT}>{t.text}</p>
              {t.role === "assistant" && t.changed.length ? (
                <p className={v.CHAT_META}>
                  <span>{v.changedNote(t.changed)}</span>
                  <button type="button" className={v.CHAT_UNDO} onClick={() => onUndo(t.id)} disabled={t.undone}>{t.undone ? v.UNDONE : v.UNDO}</button>
                </p>
              ) : null}
            </div>
          </div>
        ))}
        {pending ? (
          <div className={v.CHAT_TURN}>
            <p className={v.CHAT_ROLE}>Prospera</p>
            <p className={v.CHAT_TEXT_THINKING}>{v.CHAT_THINKING}</p>
          </div>
        ) : null}
      </div>

      <form className={v.CHAT_FORM} onSubmit={submit}>
        <input className={v.CHAT_INPUT} value={input} onChange={(e) => setInput(e.target.value)} placeholder={v.chatPlaceholder(label)} aria-label={v.chatPlaceholder(label)} disabled={pending} />
        <Button type="submit" variant="secondary" size={32} disabled={pending || !input.trim()}>Ask</Button>
        <div className={v.CHAT_STARTERS_ROW}>
          <span>Try</span>
          {v.CHAT_STARTERS.map((s) => (
            <button key={s.label} type="button" className={v.CHAT_STARTER} disabled={pending} onClick={() => onAsk(s.ask)}>{s.label}</button>
          ))}
        </div>
      </form>
    </section>
  );
}
