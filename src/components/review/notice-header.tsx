"use client";

import Link from "next/link";
import { useState } from "react";
import { Pill } from "@/components/ui/pill";
import type { ReviewNoticeHeader } from "@/lib/review/queries";
import { dismissAllLabel } from "@/lib/review/queue";
import { BTN_OPEN, BTN_SECONDARY_30, BTN_TERTIARY_30, CARD, FLAG, HEADER_ACTIONS, HEADER_BOX, HEADER_LINE1, HEADER_TOP, KEY_DATES, KEY_LABEL, KEY_VALUE, KEY_VALUE_TONE, META, META_LINE, NUMBER, PURSUIT_BUTTON, PURSUIT_CARET, PURSUIT_DOT, PURSUIT_LINE, SUMMARY, SUMMARY_CLAMPED, TEXT_LINK, TITLE } from "@/components/review/review-view";
import { cn } from "@/lib/utils/cn";

/** The summary is clamped to three lines; a toggle is drawn only when there is more than that to read. */
const SUMMARY_TOGGLE_CHARS = 300;

/**
 * The notice header card (README §2 "Notice header card"): number, meta and
 * flag; the title; the pursuit verdict with its one line of reasoning; the
 * three key dates; the meta line; the summary clamped to three lines.
 *
 * Two controls on the right: "Open opportunity ↗" (the notice's page — the
 * detail drawer arrives with Focus mode) and "Dismiss all N matches", which
 * becomes "Undo" once a whole-notice dismissal stands.
 */
export function NoticeHeader({
  header,
  verdict,
  undecided,
  bulkWhole,
  canDecide,
  onDismissAll,
  onUndoBulk,
}: {
  header: ReviewNoticeHeader;
  verdict: { text: string; tone: "good" | "plain" } | null;
  undecided: number;
  /** A "Dismiss all" stands: the button reads Undo. */
  bulkWhole: boolean;
  canDecide: boolean;
  onDismissAll: () => void;
  onUndoBulk: () => void;
}) {
  const [pursuitOpen, setPursuitOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const longSummary = header.summary.length > SUMMARY_TOGGLE_CHARS;

  return (
    <section className={CARD}>
      <div className={HEADER_BOX}>
        <div className={HEADER_TOP}>
          <div className="min-w-0 flex-[1_1_360px]">
            <p className={HEADER_LINE1}>
              <span className={NUMBER}>{header.number ?? "—"}</span>
              {header.meta ? <span className={META}>{header.meta}</span> : null}
              {header.flag ? <span className={FLAG}>{header.flag}</span> : null}
              {verdict ? <Pill variant={verdict.tone === "good" ? "status-good" : "status-plain"}>{verdict.text}</Pill> : null}
            </p>
            <h2 className={TITLE} title={header.fullTitle}>
              {header.title}
            </h2>
          </div>
          <div className={HEADER_ACTIONS}>
            <Link href={header.href} className={BTN_OPEN}>
              Open opportunity <span aria-hidden>↗</span>
            </Link>
            {bulkWhole ? (
              <button type="button" onClick={onUndoBulk} className={BTN_SECONDARY_30}>
                Undo
              </button>
            ) : undecided > 0 && canDecide ? (
              <button type="button" onClick={onDismissAll} className={BTN_TERTIARY_30}>
                {dismissAllLabel(undecided)}
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-3">
          <button type="button" onClick={() => setPursuitOpen((v) => !v)} aria-expanded={pursuitOpen} className={PURSUIT_BUTTON}>
            <span className={PURSUIT_DOT[header.pursuit.tone]} aria-hidden />
            <span>
              {header.pursuit.verdict}
              <span className={PURSUIT_CARET} aria-hidden>
                {pursuitOpen ? " ▴" : " ▾"}
              </span>
            </span>
          </button>
          {pursuitOpen ? <p className={PURSUIT_LINE}>{header.pursuit.line}</p> : null}
        </div>

        <div className={KEY_DATES}>
          {header.keyStats.map((s) => (
            <div key={s.label} className="flex-none">
              <p className={cn(KEY_VALUE, s.urgent ? KEY_VALUE_TONE.urgent : KEY_VALUE_TONE.normal)}>{s.value}</p>
              <p className={KEY_LABEL}>{s.label}</p>
            </div>
          ))}
        </div>
        {header.metaLine ? <p className={META_LINE}>{header.metaLine}</p> : null}

        {header.summary ? (
          <>
            <p className={cn(SUMMARY, !summaryOpen && SUMMARY_CLAMPED)}>{header.summary}</p>
            {longSummary ? (
              <button type="button" onClick={() => setSummaryOpen((v) => !v)} aria-expanded={summaryOpen} className={TEXT_LINK}>
                {summaryOpen ? "Show less" : "Read the full purpose"}
              </button>
            ) : null}
          </>
        ) : (
          <p className={cn(SUMMARY, "text-ink-muted")}>No summary in the synced notice.</p>
        )}
      </div>
    </section>
  );
}
