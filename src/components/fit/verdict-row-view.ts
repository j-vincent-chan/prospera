/**
 * The fit row's presentation table (fit-UX PR 2; brief: `docs/fit-ux/README.md`
 * §"Screens / views" 1 and `AUDIT_AND_DECISIONS.md` §3a–§3c). Pure: label →
 * words, tone → Tailwind classes, verdict → heading. No JSX, so the row's
 * decisions are unit-testable under the repo's `node` vitest environment —
 * `verdict-row.tsx` is markup over these maps and holds no colour logic of
 * its own.
 *
 * Two rules the maps exist to keep:
 *
 *   1. **Colour never carries meaning alone** (`ui/pill.tsx`'s header). Every
 *      tone here is a background/text pair applied to text that already says
 *      the same thing — "Not eligible · ESI only" is legible in greyscale.
 *   2. **Every class is an existing token.** No hex, no new colour: the
 *      mapping from the prototype's literal styles to the token set is the
 *      README's "Design tokens" table.
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

/** Label → the square `Pill` variant that renders it (README's row table, column 104px). */
export const VERDICT_LABEL_PILL: Record<VerdictLabel, PillVariant> = {
  strong: "tier-strong-square",
  moderate: "tier-moderate-square",
  exploratory: "tier-exploratory-square",
  cannot_assess: "tier-cannot-assess-square",
  ruled_out: "tier-ruled-out-square",
};

// ---------------------------------------------------------------------------
// The verdict chips (column 3)
// ---------------------------------------------------------------------------

/** Shared chip shape: 5px radius, 12px medium — smaller than the label it sits under. */
export const CHIP_BASE = "inline-flex items-center whitespace-nowrap rounded-[5px] px-2 py-0.5 text-meta font-medium";

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
 * One field, two captions (README §"Screens / views" 2): a notice has a
 * deadline, a person has a status. Read only by the stacked variant, where
 * the column header that carries this on the grid does not exist.
 */
export const DUE_CAPTION: Record<RowSubject, string> = { notice: "Deadline", person: "Status" };

/**
 * Action kind → the existing `Button`. `quiet` is `ghost` re-toned to
 * `ink-muted`: the README's quiet action is transparent and muted, and
 * `ghost` is `text-ink`.
 */
export const ACTION_BUTTON: Record<ActionKind, { variant: ButtonVariant; className?: string }> = {
  primary: { variant: "primary" },
  secondary: { variant: "secondary" },
  quiet: { variant: "ghost", className: "text-ink-muted hover:text-ink" },
};

// ---------------------------------------------------------------------------
// The disclosure
// ---------------------------------------------------------------------------

/** The toggle's two readings (README §"Verdict chips"). */
export const toggleLabel = (open: boolean): string => (open ? "Hide the reasoning" : "Why, and what it rests on");

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
 * None of these headings is disqualifying (§3c). A failed gate reaches the
 * row as the caveat and the eligibility chip, both above the fold; the list
 * here is what a person could *do*.
 */
export const GAP_HEADING: Record<RowSubject, Record<VerdictLabel, string>> = {
  notice: {
    strong: "Worth checking before you write",
    moderate: "Worth checking before you write",
    exploratory: "What would have to be true",
    cannot_assess: "Before this can be assessed",
    ruled_out: "Why it is ruled out",
  },
  person: {
    strong: "Worth checking before you contact",
    moderate: "Worth checking before you contact",
    exploratory: "What would have to be true",
    cannot_assess: "Before this can be assessed",
    ruled_out: "Why it is ruled out",
  },
};

/** The heading for one row. */
export const gapHeading = (label: VerdictLabel, subject: RowSubject = "notice"): string => GAP_HEADING[subject][label];

// ---------------------------------------------------------------------------
// Ids — the toggle's `aria-controls` and the region's `aria-labelledby`
// ---------------------------------------------------------------------------

/** The disclosure region's id. The row id is the caller's; it is not parsed here. */
export const panelIdFor = (rowId: string): string => `fit-row-${rowId}-why`;

/** The title's id, which names the disclosure region for a screen reader. */
export const titleIdFor = (rowId: string): string => `fit-row-${rowId}-title`;
