"use client";

import { Fragment, useEffect, useState } from "react";
import { BTN_PRIMARY_30, BTN_SECONDARY_30, COMPARE_ACTIONS, COMPARE_CELL, COMPARE_CELL_TONE, COMPARE_DECIDED, COMPARE_HEAD_CELL, COMPARE_IDENTITY, COMPARE_LABEL, COMPARE_LINE, COMPARE_NAME, COMPARE_PICK, COMPARE_PICKS, COMPARE_PICKS_NOTE, COMPARE_PICK_TONE, COMPARE_TABLE, COMPARE_TITLE, COMPARE_WIDTH } from "@/components/review/review-view";
import { Pill, type PillVariant } from "@/components/ui/pill";
import { SlideOver } from "@/components/ui/slide-over";
import type { Tier } from "@/lib/fit/types";
import { compareHeading, compareRows, COMPARE_MAX, defaultPicks, togglePick } from "@/lib/review/compare";
import type { ReviewRow } from "@/lib/review/queries";
import type { DecisionStatus } from "@/lib/review/reasons";
import { cn } from "@/lib/utils/cn";

/**
 * Side-by-side comparison of two or three candidates on one notice (the
 * brief's "Not built — decided but open"), on the app's `SlideOver` like the
 * three Focus drawers. Every cell is what the row already shows
 * (`lib/review/compare.ts`); the verbs at the foot of each column are the
 * list's own Confirm and Watch. Dismissing needs a reason, so it stays in
 * the list where the reasons are.
 */

const TIER_PILL: Record<Tier, PillVariant> = { strong: "tier-strong-square", moderate: "tier-moderate-square", exploratory: "tier-exploratory-square", poor: "tier-exploratory-square" };
const TIER_WORD: Record<Tier, string> = { strong: "Strong match", moderate: "Moderate match", exploratory: "Exploratory", poor: "Poor" };

export function CompareDrawer({ open, onClose, rows, limited, cap, decisionsAvailable, onDecide }: { open: boolean; onClose: () => void; rows: readonly ReviewRow[]; limited: boolean; cap: string | null; decisionsAvailable: boolean; onDecide: (investigatorId: string, status: DecisionStatus) => void }) {
  const [picks, setPicks] = useState<string[]>(() => defaultPicks(rows));
  // Each opening starts from the ranked default, so a decision made in the list is reflected.
  useEffect(() => {
    if (open) setPicks(defaultPicks(rows));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const table = compareRows(rows, picks);
  const heading = compareHeading({ limited, cap, candidates: table.columns.length });
  const columns = `160px repeat(${Math.max(1, table.columns.length)}, minmax(0, 1fr))`;

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      label="Compare candidates"
      width={COMPARE_WIDTH}
      header={
        <div className="min-w-0">
          <h2 className={COMPARE_TITLE}>{heading.title}</h2>
          <p className={COMPARE_LINE}>{heading.line}</p>
        </div>
      }
    >
      <div className={COMPARE_PICKS} aria-label="Candidates">
        {rows.map((r) => {
          const on = picks.includes(r.investigatorId);
          return (
            <button key={r.investigatorId} type="button" aria-pressed={on} onClick={() => setPicks((p) => togglePick(p, r.investigatorId))} className={cn(COMPARE_PICK, on ? COMPARE_PICK_TONE.on : COMPARE_PICK_TONE.off)}>
              {r.name}
            </button>
          );
        })}
        <span className={COMPARE_PICKS_NOTE}>up to {COMPARE_MAX} at once · the newest replaces the oldest</span>
      </div>

      <div className={COMPARE_TABLE} style={{ gridTemplateColumns: columns }} role="table" aria-label="Candidates side by side">
        <div className={COMPARE_HEAD_CELL} />
        {table.columns.map((c) => (
          <div key={c.investigatorId} className={COMPARE_HEAD_CELL} role="columnheader">
            <p className={COMPARE_NAME}>{c.name}</p>
            <p className={COMPARE_IDENTITY}>{c.identity ?? "—"}</p>
            <Pill variant={TIER_PILL[c.tier]}>{TIER_WORD[c.tier]}</Pill>
          </div>
        ))}
        {table.criteria.map((cr) => (
          <Fragment key={cr.key}>
            <div className={COMPARE_LABEL} role="rowheader">{cr.label}</div>
            {cr.cells.map((cell, i) => (
              <div key={`${cr.key}-${table.columns[i]?.investigatorId ?? i}`} className={cn(COMPARE_CELL, COMPARE_CELL_TONE[cell.tone])} role="cell">
                {cell.text}
              </div>
            ))}
          </Fragment>
        ))}
        <div />
        {table.columns.map((c) => (
          <div key={`act-${c.investigatorId}`} className={COMPARE_ACTIONS}>
            {c.undecided && decisionsAvailable ? (
              <>
                <button type="button" onClick={() => onDecide(c.investigatorId, "confirmed")} className={BTN_PRIMARY_30}>Confirm match</button>
                <button type="button" onClick={() => onDecide(c.investigatorId, "watch")} className={BTN_SECONDARY_30}>Watch</button>
              </>
            ) : (
              <span className={COMPARE_DECIDED}>{c.decision}{c.undecided ? " · decisions cannot be recorded yet" : ""}</span>
            )}
          </div>
        ))}
      </div>
    </SlideOver>
  );
}
