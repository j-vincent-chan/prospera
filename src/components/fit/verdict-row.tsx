"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  DisclosurePanel,
  type VerdictRowDisclosure,
  type VerdictRowEvidence,
} from "@/components/fit/verdict-row-disclosure";
import {
  ACTION_BUTTON,
  CAVEAT_TONE,
  CHIP_BASE,
  CHIP_ORDER,
  CHIP_TONE,
  DUE_CAPTION,
  DUE_TONE,
  DUE_URGENT_WORD,
  DUE_URGENT_WORD_CLASS,
  gapHeading,
  panelIdFor,
  ROW_GRID,
  rowWrapClass,
  selectBoxClass,
  selectLabel,
  STACKED_BOX,
  STACKED_LABEL_INLINE,
  titleIdFor,
  TITLE_CLASS,
  TITLE_LINK_HOVER,
  toggleLabel,
  VERDICT_LABEL_PILL,
  VERDICT_LABEL_TEXT,
  type DueTone,
  type RowSubject,
  type RowVariant,
} from "@/components/fit/verdict-row-view";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import type { FitVerdicts, Tone } from "@/lib/fit/verdicts";
import { cn } from "@/lib/utils/cn";

/**
 * One `FitVerdicts` row (fit-UX PR 2; brief: `docs/fit-ux/README.md`
 * §"Screens / views" 1, `AUDIT_AND_DECISIONS.md` §3a–§3c).
 *
 * **A client component, and the boundary is the whole row.** An earlier draft
 * called this a server component and split the disclosure toggle into a
 * one-`<button>` client module to keep it so. That was not true and would not
 * have survived PR 3: five of the props below are functions that land on
 * `onClick`, so a Server Component parent passing any of them throws at
 * request time ("Event handlers cannot be passed to Client Component props")
 * while `tsc`, `next lint` and `next build` all stay green, because the routes
 * are `force-dynamic`. And the working shape — the client shell the README
 * §"State management" already specifies — pulls this module into the browser
 * bundle regardless, so the split bought nothing. `"use client"` is here, the
 * shell above it is a client component, and everything below is plain markup.
 *
 * The **data** props stay serializable, so a server page can load rows and
 * hand them down through that shell without this file caring.
 *
 * The row's shape is the brief's four fixed slots (§3b), in order: what it is
 * → why → the one caveat → the next move, with the three verdicts (approach,
 * eligibility, evidence) as chips between the caveat and the disclosure and
 * the deadline in its own column.
 *
 * **Nothing disqualifying lives inside the disclosure** (§3c). A failed gate
 * is the caveat, in `danger`, on the row; an unverified rule is the
 * eligibility chip, on the row; thin evidence is the evidence chip, on the
 * row. `verdict-row-disclosure.tsx` cannot see `FitVerdicts` at all — see its
 * header for what that does and does not enforce.
 *
 * **An inert control is worse than none**, applied to all four: the checkbox,
 * the action, the disclosure toggle and the panel are each drawn only when
 * something can act on them. A read-only row is a valid row; it just carries
 * no controls.
 *
 * State is the caller's. `open` and `selected` arrive as props because "one
 * row open at a time" and "at most three selected" are the list's rules
 * (README §"Interactions & behaviour"), not this component's; PR 3's client
 * shell holds them.
 */

export type { VerdictRowDisclosure, VerdictRowEvidence };

export type VerdictRowProps = {
  /** Stable row id. Only used to name the disclosure region and its label. */
  id: string;
  /** The judgment, from `fitVerdicts` (PR 1). */
  verdicts: FitVerdicts;
  /** The notice's or the person's name. */
  title: string;
  /** Links the title. Omitted, the title renders as text. */
  href?: string;
  /** "NINDS · PAR-26-041 · R01 · $500k direct / yr". */
  meta?: string | null;
  /** The right-hand column's one field: a deadline on a notice, a status on a person. */
  due?: { text: string; tone?: DueTone };
  /** Which way the row reads — it changes the caption and the disclosure's heading, never the verdicts. */
  subject?: RowSubject;
  /** The four-column grid, or the aside's stacked reading. */
  variant?: RowVariant;
  /** Whether the 18px checkbox is drawn at all. False in the PI view (§3h). */
  selectable?: boolean;
  selected?: boolean;
  /** Without it the checkbox is not drawn, whatever `selectable` says. */
  onSelect?: () => void;
  /** Whether the disclosure is showing. The list decides; see §"Interactions & behaviour". */
  open?: boolean;
  /** Without it the toggle is not drawn, and the panel only renders if `open`. */
  onToggle?: () => void;
  disclosure?: VerdictRowDisclosure;
  /** "All evidence and components →" (PR 4's deep view). */
  onDeep?: () => void;
  /** "This is wrong…". */
  onFlag?: () => void;
  /** The row's one verb. Without it the button is not drawn; `verdicts.action` is already `null` for the PI. */
  onAction?: () => void;
  /** Drop the top border — the first row under a card header draws its own. */
  first?: boolean;
  className?: string;
};

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** One verdict, as a chip. The tone is a background pair over text that already says it. */
function VerdictChip({ text, tone }: { text: string; tone: Tone }) {
  if (!text) return null;
  return <span className={cn(CHIP_BASE, CHIP_TONE[tone])}>{text}</span>;
}

/**
 * The 18px selection box (README's row table, column 18px). Hidden entirely in
 * the PI view, and never drawn without `onSelect`: a checkbox that announces
 * `aria-checked="false"` and can never be checked is worse than no checkbox.
 */
function SelectBox({ selected, onSelect, label }: { selected: boolean; onSelect: () => void; label: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={selected} aria-label={label} onClick={onSelect} className={selectBoxClass(selected)}>
      <span aria-hidden>✓</span>
    </button>
  );
}

/**
 * The disclosure's toggle. It deliberately does not own the open state — a
 * local `useState` would be a second source of truth and would let two rows
 * sit open at once, which is PR 3's list invariant to keep. A real `<button>`
 * with `aria-expanded` and `aria-controls` over a region that is always in the
 * DOM while this button exists, so the reference never dangles.
 */
function DisclosureToggle({ panelId, open, onToggle }: { panelId: string; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" aria-expanded={open} aria-controls={panelId} onClick={onToggle} className="ml-1 rounded-control text-meta font-medium text-teal hover:text-navy">
      {toggleLabel(open)}
    </button>
  );
}

// ---------------------------------------------------------------------------
// The row
// ---------------------------------------------------------------------------

export function VerdictRow({
  id,
  verdicts,
  title,
  href,
  meta,
  due,
  subject = "notice",
  variant = "grid",
  selectable = false,
  selected = false,
  onSelect,
  open = false,
  onToggle,
  disclosure,
  onDeep,
  onFlag,
  onAction,
  first = false,
  className,
}: VerdictRowProps) {
  const stacked = variant === "stacked";
  const panelId = panelIdFor(id);
  const titleId = titleIdFor(id);
  const dueTone = due?.tone ?? "normal";

  const tierLabel = (
    <Pill variant={VERDICT_LABEL_PILL[verdicts.label]} className={stacked ? STACKED_LABEL_INLINE : undefined}>
      {VERDICT_LABEL_TEXT[verdicts.label]}
    </Pill>
  );

  const titleNode = href ? (
    <Link id={titleId} href={href} className={cn(TITLE_CLASS, TITLE_LINK_HOVER)}>
      {title}
    </Link>
  ) : (
    <span id={titleId} className={TITLE_CLASS}>
      {title}
    </span>
  );

  // The panel is drawn only when something can reveal it: with a toggle, or
  // already open. `disclosure` without either used to render a hidden region
  // no control anywhere could open.
  const panel =
    disclosure && (onToggle || open) ? (
      <DisclosurePanel
        id={panelId}
        labelledBy={titleId}
        open={open}
        heading={gapHeading(verdicts.label, subject)}
        disclosure={disclosure}
        onDeep={onDeep}
        onFlag={onFlag}
        variant={variant}
      />
    ) : null;

  const detail: ReactNode = (
    <>
      {meta ? <p className="mt-[3px] text-meta text-ink-muted">{meta}</p> : null}
      <p className="mt-2 text-body leading-[1.5] text-ink">{verdicts.reason}</p>
      <p className={cn("mt-1.5 text-body leading-[1.5]", CAVEAT_TONE[verdicts.caveat.tone])}>{verdicts.caveat.text}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {CHIP_ORDER.map((axis) => (
          <VerdictChip key={axis} text={verdicts[axis].text} tone={verdicts[axis].tone} />
        ))}
        {disclosure && onToggle ? <DisclosureToggle panelId={panelId} open={open} onToggle={onToggle} /> : null}
      </div>
    </>
  );

  // Urgency is a word before it is a colour: 13px medium → semibold is close
  // to invisible, so red would otherwise carry the deadline alone — the one
  // thing `ui/pill.tsx` says never to do.
  const dueNode = due ? (
    <>
      {dueTone === "urgent" ? <span className={DUE_URGENT_WORD_CLASS}>{DUE_URGENT_WORD[subject]}</span> : null}
      <span className={cn("whitespace-nowrap", DUE_TONE[dueTone])}>{due.text}</span>
    </>
  ) : null;

  // Drawn only with a handler: a navy "Add to outreach" that does nothing is
  // the same mistake as an uncheckable checkbox.
  const actionNode =
    verdicts.action && onAction ? (
      <Button variant={ACTION_BUTTON[verdicts.action.kind].variant} size={32} onClick={onAction} className={stacked ? "w-full" : undefined}>
        {verdicts.action.label}
      </Button>
    ) : null;

  const wrap = rowWrapClass({ first, selected, className });

  if (stacked) {
    return (
      <div className={wrap}>
        <div className={STACKED_BOX}>
          {/* The label sits inline with the title rather than in a flex row
              beside it, so the meta, reason, caveat and chips share the title's
              left edge instead of starting 106px to its left and reading as
              the pill's. Measured at 340px: left-aligned, the block keeps its
              full 306px and the chip row stays at three lines; indenting it
              past the label instead costs a fourth (72.2px → 99.6px). */}
          <p>
            {tierLabel}
            {titleNode}
          </p>
          {detail}
          {due || actionNode ? (
            <div className="mt-3 flex flex-col gap-2">
              {due ? (
                <p className="flex flex-wrap items-baseline gap-1.5">
                  <span className="text-meta text-ink-muted">{DUE_CAPTION[subject]}</span>
                  {dueNode}
                </p>
              ) : null}
              {actionNode}
            </div>
          ) : null}
        </div>
        {panel}
      </div>
    );
  }

  return (
    <div className={wrap}>
      <div className={ROW_GRID}>
        <div className="w-[18px]">{selectable && onSelect ? <SelectBox selected={selected} onSelect={onSelect} label={selectLabel(title)} /> : null}</div>
        <div className="pt-[1px]">{tierLabel}</div>
        <div className="min-w-0">
          <p>{titleNode}</p>
          {detail}
        </div>
        <div className="flex flex-col items-end gap-2">
          {dueNode ? <div className="flex flex-col items-end leading-tight">{dueNode}</div> : null}
          {actionNode}
        </div>
      </div>
      {panel}
    </div>
  );
}
