import Link from "next/link";
import type { ReactNode } from "react";
import { DisclosureToggle } from "@/components/fit/verdict-row-toggle";
import {
  ACTION_BUTTON,
  CAVEAT_TONE,
  CHIP_BASE,
  CHIP_TONE,
  DUE_CAPTION,
  DUE_TONE,
  gapHeading,
  panelIdFor,
  titleIdFor,
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
 * §"Screens / views" 1, `AUDIT_AND_DECISIONS.md` §3a–§3c). **Server
 * component** — no state, no effect, no browser API; every colour decision
 * lives in `verdict-row-view.ts` and every class is an existing token. The
 * only thing shipped to the browser is `DisclosureToggle`, one `<button>`.
 *
 * The row's shape is the brief's four fixed slots (§3b), in order: what it is
 * → why → the one caveat → the next move, with the three verdicts (approach,
 * eligibility, evidence) as chips between the caveat and the disclosure and
 * the deadline in its own column.
 *
 * **Nothing disqualifying lives inside the disclosure** (§3c). A failed gate
 * is the caveat, in `danger`, on the row; an unverified rule is the
 * eligibility chip, on the row; thin evidence is the evidence chip, on the
 * row. The disclosure adds only why and what it rests on — open it or not,
 * the decision is already legible.
 *
 * State is the caller's. `open` and `selected` arrive as props because "one
 * row open at a time" and "at most three selected" are the list's rules
 * (README §"Interactions & behaviour"), not this component's; PR 3's client
 * shell holds them. Handlers are optional: a row rendered from a server
 * parent with none passed is a valid read-only row — it just carries no
 * controls — and a row rendered from PR 3's client shell carries all of them.
 */
export type VerdictRowEvidence = {
  id: string;
  /** The item as the disclosure names it — a paper title, a project title. */
  title: string;
  /** "Nature Immunology · Mar 2025 · matched neuroinflammation, microglia". */
  meta?: string | null;
  /** The source's name — "PubMed", "RePORTER". Rendered with a ↗ and linked when `href` is set. */
  source?: string | null;
  href?: string | null;
};

export type VerdictRowDisclosure = {
  /** "Why you are seeing this" — one paragraph. */
  why: string;
  /** The bullets under the label `gapHeading` picks. Never disqualifying (§3c). */
  gaps: readonly string[];
  /** "What this rests on" — 2–3 cards. */
  items: readonly VerdictRowEvidence[];
};

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
  onSelect?: () => void;
  /** Whether the disclosure is showing. The list decides; see §"Interactions & behaviour". */
  open?: boolean;
  /** Passed by a client parent. Without it the toggle is not drawn — an inert control is worse than none. */
  onToggle?: () => void;
  disclosure?: VerdictRowDisclosure;
  /** "All evidence and components →" (PR 4's deep view). */
  onDeep?: () => void;
  /** "This is wrong…". */
  onFlag?: () => void;
  /** The row's one verb. `verdicts.action` is already `null` for the PI. */
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

/** The 18px selection box (README's row table, column 18px). Hidden entirely in the PI view. */
function SelectBox({ selected, onSelect, label }: { selected: boolean; onSelect?: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={label}
      onClick={onSelect}
      className={cn(
        "mt-[3px] inline-flex h-[18px] w-[18px] items-center justify-center rounded-[4px] border text-meta leading-none",
        selected ? "border-teal bg-teal text-white" : "border-line-control bg-card text-transparent",
      )}
    >
      <span aria-hidden>✓</span>
    </button>
  );
}

/** One evidence card in "What this rests on". */
function EvidenceCard({ item }: { item: VerdictRowEvidence }) {
  return (
    <div className="rounded-tile border border-line bg-card px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2.5">
        <p className="m-0 text-dense font-medium leading-[1.4] text-ink">{item.title}</p>
        {item.source ? (
          item.href ? (
            <a href={item.href} target="_blank" rel="noreferrer" className="whitespace-nowrap text-micro font-medium text-teal hover:text-navy">
              {item.source} ↗
            </a>
          ) : (
            <span className="whitespace-nowrap text-micro font-medium text-ink-muted">{item.source}</span>
          )
        ) : null}
      </div>
      {item.meta ? <p className="mb-0 mt-[3px] text-meta text-ink-muted">{item.meta}</p> : null}
    </div>
  );
}

const SECTION_LABEL = "text-label font-semibold uppercase tracking-[0.08em] text-ink-muted";

/**
 * The disclosure's contents. Always rendered and hidden with `hidden` rather
 * than unmounted, so the toggle's `aria-controls` never points at nothing.
 */
function DisclosurePanel({
  id,
  labelledBy,
  open,
  heading,
  disclosure,
  onDeep,
  onFlag,
  stacked,
}: {
  id: string;
  labelledBy: string;
  open: boolean;
  heading: string;
  disclosure: VerdictRowDisclosure;
  onDeep?: () => void;
  onFlag?: () => void;
  stacked: boolean;
}) {
  const linkClass = "rounded-control text-meta font-medium text-teal hover:text-navy";
  return (
    <div
      id={id}
      role="region"
      aria-labelledby={labelledBy}
      hidden={!open}
      className={cn(
        "border-t border-line-row bg-footer-bar pb-[18px] pt-4",
        // The grid variant indents to the title column (20px + 104px + 14px + 18px);
        // the stacked variant has no title column to align with.
        stacked ? "px-4" : "pl-[156px] pr-5",
      )}
    >
      <div className={cn("grid gap-7", stacked ? "grid-cols-1 gap-4" : "grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]")}>
        <div>
          <p className={cn("mb-1.5 mt-0", SECTION_LABEL)}>Why you are seeing this</p>
          <p className="m-0 text-body leading-relaxed text-ink">{disclosure.why}</p>
          {disclosure.gaps.length ? (
            <>
              <p className={cn("mb-1.5 mt-3.5", SECTION_LABEL)}>{heading}</p>
              <ul className="m-0 list-disc space-y-[5px] pl-[18px] text-body leading-[1.5] text-ink">
                {disclosure.gaps.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
        <div>
          <p className={cn("mb-2 mt-0", SECTION_LABEL)}>What this rests on</p>
          <div className="flex flex-col gap-2">
            {disclosure.items.map((it) => (
              <EvidenceCard key={it.id} item={it} />
            ))}
          </div>
          {onDeep || onFlag ? (
            <div className="mt-3 flex flex-wrap gap-3.5">
              {onDeep ? (
                <button type="button" onClick={onDeep} className={linkClass}>
                  All evidence and components →
                </button>
              ) : null}
              {onFlag ? (
                <button type="button" onClick={onFlag} className={linkClass}>
                  This is wrong…
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
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
  const label = VERDICT_LABEL_TEXT[verdicts.label];

  const tierLabel = (
    <Pill variant={VERDICT_LABEL_PILL[verdicts.label]}>{label}</Pill>
  );

  const titleNode = href ? (
    <Link id={titleId} href={href} className="text-[15px] font-semibold leading-[1.4] text-ink hover:text-teal">
      {title}
    </Link>
  ) : (
    <span id={titleId} className="text-[15px] font-semibold leading-[1.4] text-ink">
      {title}
    </span>
  );

  // Split so the stacked variant can put the label beside the title and still
  // give the reason, caveat and chips the aside's full 340px — at that width a
  // chip row indented past the label wraps to four lines.
  const detail: ReactNode = (
    <>
      {meta ? <p className="mb-0 mt-[3px] text-meta text-ink-muted">{meta}</p> : null}
      <p className="mb-0 mt-2 text-body leading-[1.5] text-ink">{verdicts.reason}</p>
      <p className={cn("mb-0 mt-1.5 text-body leading-[1.5]", CAVEAT_TONE[verdicts.caveat.tone])}>{verdicts.caveat.text}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <VerdictChip text={verdicts.approach.text} tone={verdicts.approach.tone} />
        <VerdictChip text={verdicts.eligibility.text} tone={verdicts.eligibility.tone} />
        <VerdictChip text={verdicts.evidence.text} tone={verdicts.evidence.tone} />
        {disclosure && onToggle ? <DisclosureToggle panelId={panelId} open={open} onToggle={onToggle} /> : null}
      </div>
    </>
  );

  const dueNode = due ? (
    <span className={cn("whitespace-nowrap", DUE_TONE[due.tone ?? "normal"])}>{due.text}</span>
  ) : null;

  const actionNode = verdicts.action ? (
    <Button
      variant={ACTION_BUTTON[verdicts.action.kind].variant}
      size={32}
      onClick={onAction}
      className={cn(ACTION_BUTTON[verdicts.action.kind].className, stacked && "w-full")}
    >
      {verdicts.action.label}
    </Button>
  ) : null;

  const panel =
    disclosure != null ? (
      <DisclosurePanel
        id={panelId}
        labelledBy={titleId}
        open={open}
        heading={gapHeading(verdicts.label, subject)}
        disclosure={disclosure}
        onDeep={onDeep}
        onFlag={onFlag}
        stacked={stacked}
      />
    ) : null;

  // Selection tints the row (README §"Interactions & behaviour"). Rows do not
  // change on hover: the flat system uses borders, not elevation.
  const wrap = cn(!first && "border-t border-line-row", selected && "bg-teal-tint/30", className);

  if (stacked) {
    return (
      <div className={wrap}>
        <div className="px-4 py-3.5">
          <div className="flex items-start gap-2.5">
            <span className="shrink-0 pt-[1px]">{tierLabel}</span>
            <p className="mb-0 mt-0 min-w-0 flex-1">{titleNode}</p>
          </div>
          {detail}
          {due || actionNode ? (
            <div className="mt-3 flex flex-col gap-2">
              {due ? (
                <p className="m-0 flex items-baseline gap-1.5">
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
      <div className="grid grid-cols-[18px_104px_minmax(0,1fr)_132px] items-start gap-3.5 px-5 py-3.5">
        <div className="w-[18px]">
          {selectable ? <SelectBox selected={selected} onSelect={onSelect} label={`Select ${title}`} /> : null}
        </div>
        <div className="pt-[1px]">{tierLabel}</div>
        <div className="min-w-0">
          <p className="mb-0 mt-0">{titleNode}</p>
          {detail}
        </div>
        <div className="flex flex-col items-end gap-2">
          {dueNode}
          {actionNode}
        </div>
      </div>
      {panel}
    </div>
  );
}
