/**
 * The fit row's presentation table (fit-UX PR 2; brief: `docs/fit-ux/README.md`
 * §"Screens / views" 1 and `AUDIT_AND_DECISIONS.md` §3a–§3c). Pure: label →
 * words, tone → Tailwind classes, verdict → heading. No JSX, so the row's
 * decisions are unit-testable under the repo's `node` vitest environment —
 * `verdict-row.tsx` is markup over these maps and holds no colour, copy,
 * ordering or layout logic of its own.
 *
 * Four rules the maps exist to keep:
 *
 *   1. **Colour never carries meaning alone** (`ui/pill.tsx`'s header). Every
 *      tone here is a background/text pair applied to text that already says
 *      the same thing — "Not eligible · ESI only" is legible in greyscale, and
 *      an urgent deadline carries `DUE_URGENT_WORD` beside the red.
 *   2. **Every class is an existing token.** No hex, no new colour: the
 *      mapping from the prototype's literal styles to the token set is the
 *      README's "Design tokens" table.
 *   3. **No class string may name one utility group twice.** `cn` is a plain
 *      join, not a class merger (see `lib/utils/cn.ts` and `ui/pill.tsx`'s
 *      comment), so `"gap-7 … gap-4"` does not resolve to `gap-4` — it
 *      resolves to whichever rule Tailwind emitted last, which is a fact about
 *      the generated stylesheet rather than about this file. Every conflict of
 *      that shape is therefore a bug; `verdict-row-view.test.ts` asserts none
 *      of the strings below contains one.
 *   4. **Nothing here may depend on the declaration order of
 *      `tailwind.config.ts`.** `ACTION_BUTTON.quiet` used to be `ghost` plus a
 *      `text-ink-muted` override, which beat `ghost`'s own `text-ink` only
 *      because `ink.DEFAULT` is declared above `ink.muted`; reordering that
 *      object would have flipped every quiet action's colour. Quiet is now its
 *      own `Button` variant and overrides nothing.
 */
import type { ButtonVariant } from "@/components/ui/button";
import type { PillVariant } from "@/components/ui/pill";
import { FIT_TIER_LABEL } from "@/lib/fit/tier-display";
import type { ActionKind, CaveatTone, Tone, VerdictLabel } from "@/lib/fit/verdicts";

/**
 * Which way the row reads. The verdicts and copy do not change between the
 * two (README §"Screens / views" 2) — the subject does: a notice-facing row
 * is one a strategist would *write*, a people-facing row one they would
 * *contact*, and the right-hand column is captioned accordingly.
 */
export type RowSubject = "notice" | "person";

/** The right-hand column's tone: a live deadline, an urgent one, or one far off or closed. */
export type DueTone = "normal" | "urgent" | "quiet";

/** The row's two shapes: the four-column grid, and the aside's stacked reading (README §"Screens / views" 2). */
export type RowVariant = "grid" | "stacked";

// ---------------------------------------------------------------------------
// The grid (README's row table)
// ---------------------------------------------------------------------------

/**
 * The four-column row, as a value rather than a literal in the markup — a
 * `toContain` on the source file is satisfied by a comment, and this PR's
 * first draft had exactly that hole.
 *
 * **Two declared departures from the README's `18px 104px minmax(0,1fr)
 * 132px`, both forced by measurement at 1366px** — the app's minimum width
 * (`min-w-page`) and `AUDIT_AND_DECISIONS.md` §5's acceptance criterion. There
 * the fit card is 706px and the flexible column 368px (sidebar 240 + `px-page`
 * 80 + aside 320 + gap 20), and both fixed tracks are too small for their own
 * content:
 *
 *   - **label** — "Moderate match" measures 113.0px at 12px/600 in Geist and
 *     overflowed the 104px track by 9.0px. The floor is 118px so all five
 *     labels resolve to the same width and titles stay aligned down the list;
 *     `max-content` is the ceiling so no future label can overflow again.
 *   - **action** — `Button` is `shrink-0`, so a label wider than the track
 *     does not wrap or compress, it spills *left* over the reason text:
 *     "See what's missing" measured 143.4px and "Complete the profile"
 *     152.9px, the latter putting 6.9px of an opaque button box on top of the
 *     caveat, where `elementFromPoint` returned the button — it took the
 *     clicks as well as the space. 132px stays the floor the README asks for;
 *     `max-content` lets a longer verb take the room it needs out of the
 *     flexible column instead of out of the text.
 */
export const ROW_GRID =
  "grid grid-cols-[18px_minmax(118px,max-content)_minmax(0,1fr)_minmax(132px,max-content)] items-start gap-3.5 px-5 py-3.5";

/** The stacked reading has no columns: one padded block (README §"Screens / views" 2). */
export const STACKED_BOX = "px-4 py-3.5";

/**
 * The label when it sits *inline* with the title, which is the stacked
 * variant's whole trick: at 340px it keeps "label and title" on one line
 * (README §"Screens / views" 2) while leaving the meta, reason, caveat and
 * chips on the title's own left edge. `align-[-2px]` seats the 12px pill on
 * the 15px title's baseline; the pill is `inline-flex`, whose baseline is its
 * own first line's.
 */
export const STACKED_LABEL_INLINE = "mr-2 align-[-2px]";

/**
 * Pure. The row's wrapper. The selected tint and the row divider live here
 * rather than inline so that removing either is a test failure and not a
 * silent one (README §"Interactions & behaviour": selected rows tint, and rows
 * do **not** change on hover — the flat system uses borders, not elevation).
 */
export function rowWrapClass(opts: { first?: boolean; selected?: boolean; className?: string }): string {
  return [!opts.first && "border-t border-line-row", opts.selected && "bg-teal-tint/30", opts.className]
    .filter(Boolean)
    .join(" ");
}

// ---------------------------------------------------------------------------
// The label (column 2)
// ---------------------------------------------------------------------------

/**
 * The five words a row's label can carry. The three engine tiers come from
 * `FIT_TIER_LABEL` rather than being retyped, so the decision surface and the
 * admin inspectors cannot drift apart on the vocabulary (D33).
 */
export const VERDICT_LABEL_TEXT: Record<VerdictLabel, string> = {
  strong: FIT_TIER_LABEL.strong,
  moderate: FIT_TIER_LABEL.potential,
  exploratory: FIT_TIER_LABEL.exploratory,
  cannot_assess: "Can't assess",
  ruled_out: "Ruled out",
};

/**
 * Label → the square `Pill` variant that renders it (README's row table,
 * column 104px). The mapping is 1:1 by name and is asserted entry by entry:
 * asserting only that the five are distinct let a Strong match render the grey
 * "Ruled out" pill.
 */
export const VERDICT_LABEL_PILL: Record<VerdictLabel, PillVariant> = {
  strong: "tier-strong-square",
  moderate: "tier-moderate-square",
  exploratory: "tier-exploratory-square",
  cannot_assess: "tier-cannot-assess-square",
  ruled_out: "tier-ruled-out-square",
};

// ---------------------------------------------------------------------------
// The title (column 3)
// ---------------------------------------------------------------------------

/** The row's title, linked or not (README's row table, column flex). */
export const TITLE_CLASS = "text-[15px] font-semibold leading-[1.4] text-ink";

/** Added when the title is a `<Link>`; the app's link hover, not a per-component one. */
export const TITLE_LINK_HOVER = "hover:text-teal";

// ---------------------------------------------------------------------------
// The verdict chips (column 3)
// ---------------------------------------------------------------------------

/**
 * The three verdicts, in the order §3a fixes them: approach, then eligibility,
 * then evidence — is this the same *kind* of research, may this person
 * *apply*, and what does the assessment *rest on*. The row maps over this
 * array rather than writing three chips out, so the order is a value a test
 * can pin instead of a property of the JSX.
 */
export const CHIP_ORDER = ["approach", "eligibility", "evidence"] as const;

/** One of the three verdict axes a row can draw as a chip. */
export type ChipAxis = (typeof CHIP_ORDER)[number];

/**
 * The two chips left when the evidence verdict is the same on every row of a
 * card and has moved to the footer (L5, `verdict-list-view.sharedEvidenceVerdict`).
 * A slice of `CHIP_ORDER` rather than a second literal, so the order stays one
 * value.
 */
export const CHIPS_WITHOUT_EVIDENCE = CHIP_ORDER.filter((axis) => axis !== "evidence");

/**
 * Shared chip shape: 5px radius, 12px medium — smaller than the label it sits
 * under. `max-w-full` and no `whitespace-nowrap`: in the 340px aside
 * "Different approach · basic discovery vs implementation" is 325.9px against
 * a 306px column and a nowrap chip hung 3.9px outside the card. A chip that
 * cannot fit its line breaks inside itself; one that fits is untouched, since
 * a flex container wraps the line before it shrinks the item.
 */
export const CHIP_BASE = "inline-flex max-w-full items-center rounded-[5px] px-2 py-0.5 text-meta font-medium";

/** Chip tone → its background/text pair. Neutral, caution, blocking (README §"Verdict chips"). */
export const CHIP_TONE: Record<Tone, string> = {
  ok: "bg-line-row text-ink-body",
  caution: "bg-warning-tint text-warning",
  blocking: "bg-danger-tint text-danger",
};

// ---------------------------------------------------------------------------
// The caveat line (column 3)
// ---------------------------------------------------------------------------

/**
 * Caveat tone → weight and colour. `quiet` is body grey and stays regular
 * weight: a row with no material caveat must not read as a warning, which is
 * §2.4's complaint about strength and confidence being visually fused.
 */
export const CAVEAT_TONE: Record<CaveatTone, string> = {
  quiet: "text-ink-body",
  caution: "font-medium text-warning",
  blocking: "font-medium text-danger",
};

// ---------------------------------------------------------------------------
// The right-hand column (column 4)
// ---------------------------------------------------------------------------

/** Deadline tone → its type. Urgent is the only one that recruits `danger`. */
export const DUE_TONE: Record<DueTone, string> = {
  normal: "text-dense font-medium text-ink",
  urgent: "text-dense font-semibold text-danger",
  quiet: "text-dense text-ink-muted",
};

/**
 * The word an urgent right-hand field carries above the date, or `null` for a
 * direction that has no urgent state.
 *
 * Without it urgency is red plus a 13px medium→semibold step, which at that
 * size is close to invisible — colour doing the work alone, which is the one
 * rule `ui/pill.tsx` states at the top of the file. The caller owns the field's
 * text ("Oct 5 · 28 days"), so the word is the component's to add, and it is
 * subject-aware for the same reason the caption is: a notice closes, a person
 * does not. "Closing soon" is the vocabulary the app already uses for a
 * deadline inside 30 days (`saved-funding-list-state.ts`, `list-state.ts`).
 *
 * D-l left "is a people-facing status ever urgent?" to this PR, and the answer
 * is **no**: the only candidate was `contacted`, and "has not replied inside
 * the reply window" needs a reply window, which nothing in
 * `outreach_recipients` or the workspace defines (see
 * `verdict-fields.personStatus`). A contacted person is a fact, not an alarm,
 * and inventing a threshold to colour one red is exactly the invention A4
 * forbids. `person: null` records the decision where the word would have been.
 */
export const DUE_URGENT_WORD: Record<RowSubject, string | null> = { notice: "Closing soon", person: null };

/** The urgency word's own type. Smaller than the field it marks, and the same red. */
export const DUE_URGENT_WORD_CLASS = "text-micro font-semibold text-danger";

/**
 * One field, two captions (README §"Screens / views" 2): a notice has a
 * deadline, a person has a status. Read only by the stacked variant, where
 * the column header that carries this on the grid does not exist.
 */
export const DUE_CAPTION: Record<RowSubject, string> = { notice: "Deadline", person: "Status" };

/**
 * Action kind → the existing `Button`. All three are plain variants: the
 * quiet action used to be `ghost` re-toned with `text-ink-muted`, which beat
 * `ghost`'s `text-ink` only through Tailwind's emission order, and which
 * carried `ghost`'s `hover:bg-line-row` — a hover fill the prototype's quiet
 * action does not have. `Button`'s own `quiet` variant is the README's
 * "border-transparent bg-transparent text-ink-muted" with the prototype's 4px
 * of side padding, and overrides nothing.
 */
export const ACTION_BUTTON: Record<ActionKind, { variant: ButtonVariant }> = {
  primary: { variant: "primary" },
  secondary: { variant: "secondary" },
  quiet: { variant: "quiet" },
};

// ---------------------------------------------------------------------------
// The selection box (column 1)
// ---------------------------------------------------------------------------

/** Pure. The 18px box's classes (README's row table, column 18px). */
export function selectBoxClass(selected: boolean): string {
  return [
    "mt-[3px] inline-flex h-[18px] w-[18px] items-center justify-center rounded-[4px] border text-meta leading-none",
    selected ? "border-teal bg-teal text-white" : "border-line-control bg-card text-transparent",
  ].join(" ");
}

/** Pure. What a screen reader hears on the row's checkbox. */
export const selectLabel = (title: string): string => `Select ${title}`;

// ---------------------------------------------------------------------------
// The disclosure
// ---------------------------------------------------------------------------

/** The toggle's two readings (README §"Verdict chips"). */
export const toggleLabel = (open: boolean): string => (open ? "Hide the reasoning" : "Why, and what it rests on");

/**
 * The panel's outer padding. The grid variant indents past the label column,
 * to the gap before the title — `px-5` 20 + the 18px box + a 14px gap + the
 * label track 118 = 170px. That is the prototype's own relationship (it
 * indents 156px against a title column at 170px, i.e. one gap short of it);
 * the number moves with `ROW_GRID`'s label track and nothing else. The stacked
 * variant has no title column to align with.
 */
export const DISCLOSURE_BOX: Record<RowVariant, string> = {
  grid: "border-t border-line-row bg-footer-bar pb-[18px] pl-[170px] pr-5 pt-4",
  stacked: "border-t border-line-row bg-footer-bar px-4 pb-[18px] pt-4",
};

/**
 * The panel's two columns, or the stacked variant's one.
 *
 * Written as one complete string per variant rather than a shared prefix plus
 * a variant suffix: the first draft was `cn("grid gap-7", stacked ?
 * "grid-cols-1 gap-4" : …)`, which emits `gap-7 … gap-4` and renders at 28px,
 * because `cn` joins and `.gap-4` precedes `.gap-7` in the generated
 * stylesheet. Rule 3 at the top of this file.
 */
export const DISCLOSURE_GRID: Record<RowVariant, string> = {
  grid: "grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-7",
  stacked: "grid grid-cols-1 gap-4",
};

/** The uppercase heading over each half of the panel. */
export const SECTION_LABEL = "text-label font-semibold uppercase tracking-[0.08em] text-ink-muted";

/**
 * The heading over bullets that are things to **check**, not things the
 * assessment turned on — the snapshot's own warnings (identity unverified, a
 * stale profile), the freshness line and the contact history.
 *
 * One field, two captions, like `DUE_CAPTION`: a notice is written, a person
 * is contacted. It is the same string a Strong or Moderate row's own analysis
 * is headed with, which is why `disclosureSections` merges the two groups
 * there rather than drawing the heading twice.
 */
export const CHECKS_HEADING: Record<RowSubject, string> = { notice: "Worth checking before you write", person: "Worth checking before you contact" };

/**
 * The heading over the disclosure's bullet list.
 *
 * The README names three ("What would have to be true" / "Worth checking
 * before you write" / "Why it is ruled out"); the prototype carries a fourth
 * for `Can't assess`, whose bullets are what would let the notice be assessed
 * at all rather than what would make the pair work. Both are kept: "what
 * would have to be true" reads as a science gap, which is the wrong claim
 * about a notice whose text never parsed.
 *
 * None of these headings is disqualifying (§3c). "Why it is ruled out" heads a
 * list on a row whose caveat already carries the block in red, above the fold:
 * the panel elaborates a decision the row has already made, it does not hold
 * it. The heading is a *label*, and it is the only thing the panel learns from
 * the verdicts — see `verdict-row-disclosure.tsx`, which cannot see them.
 */
export const GAP_HEADING: Record<RowSubject, Record<VerdictLabel, string>> = {
  notice: {
    strong: CHECKS_HEADING.notice,
    moderate: CHECKS_HEADING.notice,
    exploratory: "What would have to be true",
    cannot_assess: "Before this can be assessed",
    ruled_out: "Why it is ruled out",
  },
  person: {
    strong: CHECKS_HEADING.person,
    moderate: CHECKS_HEADING.person,
    exploratory: "What would have to be true",
    cannot_assess: "Before this can be assessed",
    ruled_out: "Why it is ruled out",
  },
};

/** The heading for one row. */
export const gapHeading = (label: VerdictLabel, subject: RowSubject = "notice"): string => GAP_HEADING[subject][label];

/** One labelled bullet group inside the disclosure. A heading, never a fact (§3c). */
export type DisclosureSection = { heading: string; bullets: readonly string[] };

/**
 * Pure. The disclosure's bullet groups: the row's own analysis under the
 * heading its label picks, and things worth checking under theirs.
 *
 * **Two lists, never one.** The Outreach row used to concatenate the
 * snapshot's warnings onto the engine's gap sentences and take the first five
 * of the result, which did both of the things it must not: with three flags
 * plus a freshness line plus a contact history, every sentence the engine
 * wrote was evicted; and the survivors were drawn under a heading chosen from
 * the label, so a dismissed Poor row headed "Identity unverified: name-only
 * match" with **Why it is ruled out** — which is not why it was ruled out —
 * and an Exploratory row headed the same bullets "What would have to be true",
 * which reads as *the identity must be unverified for this to work*.
 *
 * So each group keeps its own heading, and the analysis is never displaced:
 * the two are separate arrays and neither is truncated by the other. The one
 * case they merge is a Strong or Moderate row, where the label's own heading
 * **is** `CHECKS_HEADING` — drawing it twice would be a repetition, not a
 * distinction — and there the checks come first, as the surface's own warnings
 * about the person before the notice's conditions on the application.
 */
export function disclosureSections(label: VerdictLabel, subject: RowSubject, parts: { gaps?: readonly string[]; checks?: readonly string[] }): DisclosureSection[] {
  const said = (xs: readonly string[] | undefined) => (xs ?? []).filter((x) => typeof x === "string" && x.trim().length > 0);
  const gaps = said(parts.gaps);
  const checks = said(parts.checks);
  const gapsHeading = gapHeading(label, subject);
  const checksHeading = CHECKS_HEADING[subject];
  if (!checks.length) return gaps.length ? [{ heading: gapsHeading, bullets: gaps }] : [];
  if (gapsHeading === checksHeading) return [{ heading: gapsHeading, bullets: [...checks, ...gaps] }];
  const out: DisclosureSection[] = [];
  if (gaps.length) out.push({ heading: gapsHeading, bullets: gaps });
  out.push({ heading: checksHeading, bullets: checks });
  return out;
}

// ---------------------------------------------------------------------------
// Ids — the toggle's `aria-controls` and the region's `aria-labelledby`
// ---------------------------------------------------------------------------

/** The disclosure region's id. The row id is the caller's; it is not parsed here. */
export const panelIdFor = (rowId: string): string => `fit-row-${rowId}-why`;

/** The title's id, which names the disclosure region for a screen reader. */
export const titleIdFor = (rowId: string): string => `fit-row-${rowId}-title`;
