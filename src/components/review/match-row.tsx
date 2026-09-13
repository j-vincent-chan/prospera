"use client";

import Link from "next/link";
import { forwardRef } from "react";
import { CHIP_BASE, CHIP_TONE, gapHeading, VERDICT_LABEL_PILL, VERDICT_LABEL_TEXT } from "@/components/fit/verdict-row-view";
import {
  ACTIONS,
  ASSESSMENT,
  ASSESSMENT_CHIPS,
  ASSESSMENT_COMPACT,
  ASSESSMENT_GRID,
  ASSESSMENT_WHY,
  AVATAR,
  BTN_WARN_26,
  CAVEAT,
  CALL_LINE,
  CALL_LINE_TONE,
  CAVEAT_TONE,
  CLASH_PANEL,
  CLASH_TEXT,
  CONFIRMED_HINT,
  CONFIRMED_NOTE,
  CONFIRMED_TEXT,
  COVERAGE,
  disclosureLabel,
  EVIDENCE_CARD,
  EVIDENCE_LINK,
  EVIDENCE_LIST,
  EVIDENCE_META,
  EVIDENCE_TITLE,
  EYEBROW,
  GAP_LIST,
  HISTORY,
  IDENTITY,
  MATCH_DISCLOSURE,
  MATCH_PRIMARY,
  MATCH_SECONDARY,
  MATCH_UNDO,
  MATCH_WATCH,
  REASON,
  REASON_CHIP,
  REASON_HINT,
  REASONS_CHIPS,
  REASONS_PANEL,
  REASONS_PROMPT,
  ROW_BASE,
  ROW_BODY,
  ROW_GRID,
  ROW_LINE1,
  ROW_NAME,
  ROW_NAME_LINK,
  ROW_PAD,
  ROW_TONE,
  STATUS_TEXT,
  STRENGTH_TAG,
  STRENGTH_TAG_STATE,
  assessmentIdFor,
} from "@/components/review/review-view";
import { Pill } from "@/components/ui/pill";
import type { VerdictLabel } from "@/lib/fit/verdicts";
import type { MatchDecision } from "@/lib/review/decisions";
import { flagStatusText, type ReviewRow } from "@/lib/review/queries";
import { REVIEW_REASONS, rowVerbs, statusText, STRENGTH_TAGS, type DecisionStatus, type StrengthTagId } from "@/lib/review/reasons";
import { cn } from "@/lib/utils/cn";

export type Density = "comfortable" | "compact";

export type MatchRowProps = {
  row: ReviewRow & { decision: MatchDecision | null };
  focused: boolean;
  open: boolean;
  rejecting: boolean;
  density: Density;
  /** Undecided matches on the notice, this one included — the notice-scoped chips say "clears all N". */
  undecidedOnNotice: number;
  /** False while `fit_match_decisions` is not on the database: rows read, nothing decides. */
  canDecide: boolean;
  onFocus: () => void;
  onDecide: (status: DecisionStatus, reason: string | null) => void;
  onOpenReasons: () => void;
  onUndo: () => void;
  onToggle: () => void;
  onTag: (tag: StrengthTagId | null) => void;
};

/**
 * One match (README §2 "Rows"): avatar; name · tier pill · status; identity;
 * reason; caveat; the action row. Under it, one of the row's three panels —
 * the dismiss reasons, the confirmed note with the clash warning, or the
 * expanded assessment.
 *
 * The label the row shows is the verdict's, except that a standing pair flag
 * by a teammate reads as **Ruled out** with "Keep it ruled out" / "Reinstate"
 * — a prior human correction, which the README's ruled-out row is.
 */
export const MatchRow = forwardRef<HTMLDivElement, MatchRowProps>(function MatchRow({ row, focused, open, rejecting, density, undecidedOnNotice, canDecide, onFocus, onDecide, onOpenReasons, onUndo, onToggle, onTag }, ref) {
  const label: VerdictLabel = row.flag && !row.decision ? "ruled_out" : row.verdicts.label;
  const decision = row.decision;
  const settled = Boolean(decision) || row.doNotContact;
  const undecided = !settled;
  const status = row.flag && !decision ? { text: flagStatusText(row.flag), tone: "dismissed" as const } : statusText({ decision, doNotContact: row.doNotContact, teammateActive: Boolean(row.clash), contact: row.contact });
  const verbs = rowVerbs(label);
  const tone = focused ? ROW_TONE.focused : decision?.status === "rejected" ? ROW_TONE.rejected : settled ? ROW_TONE.decided : ROW_TONE.default;
  const panelId = assessmentIdFor(row.opportunityId, row.investigatorId);
  const gaps = row.disclosure?.gaps ?? [];

  return (
    <div ref={ref} className={cn(ROW_BASE, ROW_PAD[density], tone)} onClick={onFocus} data-focused={focused ? "true" : undefined}>
      <div className={ROW_GRID}>
        <span className={AVATAR} aria-hidden>
          {row.initials}
        </span>
        <div className={ROW_BODY}>
          <div className={ROW_LINE1}>
            <p className={ROW_NAME}>
              <Link href={row.href} className={ROW_NAME_LINK} onClick={(e) => e.stopPropagation()}>
                {row.name}
              </Link>
            </p>
            <Pill variant={VERDICT_LABEL_PILL[label]}>{VERDICT_LABEL_TEXT[label]}</Pill>
            <p className={STATUS_TEXT[status.tone]}>{status.text}</p>
          </div>
          {row.identity ? <p className={IDENTITY}>{row.identity}</p> : null}
          <p className={REASON}>{row.verdicts.reason}</p>
          <p className={cn(CAVEAT, CAVEAT_TONE[row.verdicts.caveat.tone])}>{row.verdicts.caveat.text}</p>
          {row.call ? <p className={cn(CALL_LINE, row.needsYourCall ? CALL_LINE_TONE.mine : CALL_LINE_TONE.other)}>{row.call}</p> : null}

          <div className={ACTIONS}>
            {undecided && canDecide ? (
              <>
                <button type="button" onClick={(e) => { e.stopPropagation(); onDecide(verbs.primary.status, verbs.primary.reason); }} className={MATCH_PRIMARY}>
                  {verbs.primary.label}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (verbs.secondary.status) onDecide(verbs.secondary.status, verbs.secondary.reason);
                    else onOpenReasons();
                  }}
                  className={MATCH_SECONDARY}
                  aria-expanded={verbs.secondary.status ? undefined : rejecting}
                >
                  {verbs.secondary.label}
                </button>
                <button type="button" onClick={(e) => { e.stopPropagation(); onDecide("watch", null); }} className={MATCH_WATCH}>
                  Watch
                </button>
              </>
            ) : null}
            {decision && canDecide ? (
              <button type="button" onClick={(e) => { e.stopPropagation(); onUndo(); }} className={MATCH_UNDO}>
                Undo
              </button>
            ) : null}
            {row.disclosure ? (
              <button type="button" onClick={(e) => { e.stopPropagation(); onToggle(); }} aria-expanded={open} aria-controls={panelId} className={MATCH_DISCLOSURE}>
                {disclosureLabel(open)}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {rejecting && undecided ? (
        <div className={REASONS_PANEL} role="group" aria-label="Why is this wrong?">
          <p className={REASONS_PROMPT}>Why is this wrong? One tap — it is kept as a label for the notice&apos;s next calibration.</p>
          <div className={REASONS_CHIPS}>
            {REVIEW_REASONS.map((r) => (
              <button key={r.id} type="button" onClick={(e) => { e.stopPropagation(); onDecide("rejected", r.id); }} className={REASON_CHIP}>
                {r.label}
                {r.hint ? <span className={REASON_HINT}>{r.hint(undecidedOnNotice)}</span> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {decision?.status === "confirmed" ? (
        <>
          <div className={CONFIRMED_NOTE}>
            <p className={CONFIRMED_TEXT}>Queued for outreach.</p>
            {STRENGTH_TAGS.map((t) => {
              const on = decision.reason === t.id;
              return (
                <button key={t.id} type="button" aria-pressed={on} onClick={(e) => { e.stopPropagation(); onTag(on ? null : t.id); }} className={cn(STRENGTH_TAG, on ? STRENGTH_TAG_STATE.on : STRENGTH_TAG_STATE.off)}>
                  {t.label}
                </button>
              );
            })}
            <span className={CONFIRMED_HINT}>optional — tags the confirmation for calibration</span>
          </div>
          {row.clash ? (
            <div className={CLASH_PANEL} role="note">
              <p className={CLASH_TEXT}>{row.clash}</p>
              <button type="button" onClick={(e) => { e.stopPropagation(); onUndo(); }} className={BTN_WARN_26}>
                Leave it with them
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {open && row.disclosure ? (
        <div id={panelId} role="region" aria-label={`Prospera's assessment of ${row.name}`} className={density === "compact" ? ASSESSMENT_COMPACT : ASSESSMENT} onClick={(e) => e.stopPropagation()}>
          <div className={ASSESSMENT_GRID}>
            <div>
              <p className={EYEBROW}>Why you are seeing this</p>
              <p className={ASSESSMENT_WHY}>{row.disclosure.why}</p>
              {row.chips.length ? (
                <div className={ASSESSMENT_CHIPS}>
                  {row.chips.map((c) => (
                    <span key={c.text} className={cn(CHIP_BASE, CHIP_TONE[c.tone])}>
                      {c.text}
                    </span>
                  ))}
                </div>
              ) : null}
              {row.history ? <p className={HISTORY[row.history.tone]}>{row.history.text}</p> : null}
              {gaps.length ? (
                <>
                  <p className={cn(EYEBROW, "mt-3.5")}>{gapHeading(label, "person")}</p>
                  <ul className={GAP_LIST}>
                    {gaps.map((g, i) => (
                      <li key={`${i}-${g}`}>{g}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
            <div>
              <p className={EYEBROW}>What this rests on</p>
              {row.disclosure.items.length ? (
                <div className={EVIDENCE_LIST}>
                  {row.disclosure.items.map((it) => (
                    <div key={it.id} className={EVIDENCE_CARD}>
                      <div className="flex items-baseline justify-between gap-2.5">
                        <p className={EVIDENCE_TITLE}>{it.title}</p>
                        {it.source ? (
                          it.href ? (
                            <a href={it.href} target="_blank" rel="noreferrer" className={EVIDENCE_LINK}>
                              {it.source} ↗
                            </a>
                          ) : (
                            <span className="whitespace-nowrap text-micro font-medium text-ink-muted">{it.source}</span>
                          )
                        ) : null}
                      </div>
                      {it.meta ? <p className={EVIDENCE_META}>{it.meta}</p> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className={cn(COVERAGE, "mt-2")}>No item is linked to this assessment yet.</p>
              )}
              {row.coverage ? <p className={COVERAGE}>{row.coverage}</p> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
});
