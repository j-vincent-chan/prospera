/**
 * The fit card's own decisions (fit-UX PR 3; brief: `docs/fit-ux/README.md`
 * §"Screens / views" 1 and §"Interactions & behaviour",
 * `AUDIT_AND_DECISIONS.md` §3f–§3h). Pure: counts, filtering, the selection
 * rules, the audience gate and the class strings. No JSX, so every rule below
 * is unit-testable under the repo's `node` vitest environment and
 * `verdict-list.tsx` is markup over it.
 *
 * Three rules this module exists to keep:
 *
 *   1. **The chip counts come from the rows.** The README says so twice, and
 *      says why: an earlier draft hardcoded the labels and immediately
 *      misstated a count. `filterChips` takes the labels of the rows that are
 *      actually listed and derives every number and every chip's existence
 *      from them.
 *   2. **The audience is a gate, not a style.** D7's PI view is not the
 *      strategist's list with some controls hidden by CSS: `audienceRules`
 *      returns what that view *has*, and `verdict-list.tsx` cannot draw a
 *      checkbox, a compare button, a bulk action or the ruled-out toggle
 *      without asking. `fitVerdicts` already returns `action: null` for the
 *      same audience, so the per-row button is gone by the same means (§3h).
 *   3. **Ruled-out rows are counted apart.** §3f puts them behind the footer
 *      toggle, so they are not in "All *n*" and not in any tier chip — the
 *      prototype's header reads `All 5 · Strong 1 · Moderate 1 · Exploratory 2
 *      · Can't assess 1` beside a footer that reads "Show 1 ruled out".
 */
import type { VerdictLabel } from "@/lib/fit/verdicts";
import type { FitAudience } from "@/lib/fit/explain-view";
import type { RuledOutReason } from "@/lib/fit/verdict-fields";
import { VERDICT_LABEL_TEXT } from "@/components/fit/verdict-row-view";

// ---------------------------------------------------------------------------
// Filters (README §"Interactions & behaviour": single-select, counts from data)
// ---------------------------------------------------------------------------

/**
 * The filter's states.
 *
 * The README writes the last one as `"unknown"`; it is `cannot_assess` here so
 * that the filter's ids are exactly the `VerdictLabel` ids a row can carry
 * (plus `all`). A filter that named a label the union does not have would be a
 * chip that can never match, and nothing in the type system would say so.
 * `ruled_out` is deliberately not a filter: those rows are behind the footer
 * toggle (§3f), not behind a chip.
 */
export type FitFilter = "all" | "strong" | "moderate" | "exploratory" | "cannot_assess";

/** The order the chips are drawn in: the whole list, then the labels best-first. */
export const FILTER_ORDER: readonly FitFilter[] = ["all", "strong", "moderate", "exploratory", "cannot_assess"];

/**
 * A chip's word. The four label chips reuse `VERDICT_LABEL_TEXT`, so the chip
 * and the pill on the row it filters to cannot drift apart — except that the
 * chip drops "match" ("Strong", not "Strong match"), which is the prototype's
 * own header and keeps five chips inside the card header at 1366px.
 */
export const FILTER_WORD: Record<FitFilter, string> = {
  all: "All",
  strong: VERDICT_LABEL_TEXT.strong.replace(/\s+match$/i, ""),
  moderate: VERDICT_LABEL_TEXT.moderate.replace(/\s+match$/i, ""),
  exploratory: VERDICT_LABEL_TEXT.exploratory,
  cannot_assess: VERDICT_LABEL_TEXT.cannot_assess,
};

export type FilterChip = { id: FitFilter; label: string; count: number };

/**
 * Pure. The header's chips, counted from the labels of the rows the card
 * lists. A chip whose count is zero is omitted; `All` is always drawn, even at
 * zero, because it is the state the card is in when a filter has emptied it —
 * without it there would be no way back.
 *
 * `ruled_out` labels are ignored rather than counted into `all`: they are not
 * listed until the footer toggle asks for them, and counting them would make
 * "All 6" list five rows.
 */
export function filterChips(labels: readonly VerdictLabel[]): FilterChip[] {
  const counted = labels.filter((l) => l !== "ruled_out");
  const count = (id: FitFilter) => (id === "all" ? counted.length : counted.filter((l) => l === id).length);
  return FILTER_ORDER.filter((id) => id === "all" || count(id) > 0).map((id) => ({ id, label: `${FILTER_WORD[id]} ${count(id)}`, count: count(id) }));
}

/** Pure. The rows one filter shows. */
export function matchesFilter(label: VerdictLabel, filter: FitFilter): boolean {
  return filter === "all" ? label !== "ruled_out" : label === filter;
}

/**
 * Pure. The chip's classes. Active is the navy fill the prototype uses for the
 * selected filter; idle is the card's own border and body text.
 */
export function filterChipClass(active: boolean): string {
  return [
    "inline-flex h-[26px] shrink-0 items-center whitespace-nowrap rounded-control border px-2.5 text-meta font-medium",
    active ? "border-navy bg-navy text-white" : "border-line bg-card text-ink-body hover:border-line-control",
  ].join(" ");
}

// ---------------------------------------------------------------------------
// Selection and compare (README §"Interactions & behaviour")
// ---------------------------------------------------------------------------

/** "Select up to 3 rows; selecting a fourth drops the oldest." */
export const MAX_SELECTED = 3;

/** Compare needs two columns to be a comparison. */
export const MIN_COMPARED = 2;

/**
 * Pure. Toggling one row's checkbox.
 *
 * Selecting past the cap drops the **oldest** rather than refusing the click:
 * a checkbox that silently does nothing is the same fault as one that cannot
 * be checked. Deselecting is unconditional.
 */
export function toggleSelected(selected: readonly string[], id: string, max: number = MAX_SELECTED): string[] {
  if (selected.includes(id)) return selected.filter((s) => s !== id);
  const next = [...selected, id];
  return next.length > max ? next.slice(next.length - max) : next;
}

/**
 * Pure. The compare columns: the selected rows **in list order**, not click
 * order (README §"Interactions & behaviour"). Rows that have left the list —
 * a filter changed under the selection — drop out, which is also why
 * `comparing` can end up with fewer than two columns and fall back to the
 * list.
 */
export function comparedRows<R>(rows: readonly R[], selected: readonly string[], idOf: (r: R) => string): R[] {
  const set = new Set(selected);
  return rows.filter((r) => set.has(idOf(r)));
}

// ---------------------------------------------------------------------------
// Audience (D7, §3h)
// ---------------------------------------------------------------------------

export type AudienceRules = {
  /** The 18px checkbox is drawn at all. */
  selectable: boolean;
  /** The header's "Compare *n*". */
  compare: boolean;
  /** The header's "Add *n* to recipients" — people-facing lists only. */
  bulk: boolean;
  /** The footer's "Show *n* ruled out". */
  ruledOut: boolean;
  /** Exploratory and Can't assess rows are listed at all. */
  exploratory: boolean;
};

/**
 * Pure. What a view has.
 *
 * The PI's own page (§3h) is "the same list, minus strategist tooling":
 * Strong and Moderate only, no checkboxes, no compare, no bulk actions, no
 * ruled-out toggle — and no per-row action, which `fitVerdicts` already
 * enforces by returning `action: null` for this audience, so it is not
 * repeated here. Every one of these is a *capability*, not a class name: the
 * markup asks before it draws.
 */
export function audienceRules(audience: FitAudience): AudienceRules {
  const strategist = audience === "strategist";
  return { selectable: strategist, compare: strategist, bulk: strategist, ruledOut: strategist, exploratory: strategist };
}

// ---------------------------------------------------------------------------
// The footer (§3f, §3j)
// ---------------------------------------------------------------------------

/**
 * Why a set of rows was ruled out. The reason itself is derived where the
 * `caps` and `components` still are — `lib/fit/verdict-fields.ts`
 * `ruledOutReasonOf` — because the client shell is handed plain serializable
 * rows; only the copy is here.
 */
export type { RuledOutReason };

/**
 * Pure. The reason a set of rows shares, or null when they do not share one.
 * Takes the reasons rather than the rows: the loader computes each row's with
 * `ruledOutReasonOf` while it still holds `caps` and `components`, and the
 * client shell — which is handed plain serializable props — only has to agree.
 */
export function sharedRuledOutReason(reasons: readonly (RuledOutReason | null | undefined)[]): RuledOutReason | null {
  if (!reasons.length || reasons.some((r) => !r)) return null;
  const distinct = new Set(reasons as RuledOutReason[]);
  return distinct.size === 1 ? (Array.from(distinct)[0] as RuledOutReason) : null;
}

/**
 * Pure. The footer's toggle (§3f: "Show 1 ruled out (eligibility)"). The
 * parenthetical is only written when every hidden row was ruled out for the
 * same reason — naming one of three reasons would be a claim about the other
 * two.
 */
export function ruledOutLabel(open: boolean, count: number, reason: RuledOutReason | null): string {
  const noun = `${count} ruled out`;
  if (open) return `Hide the ${noun}`;
  return reason ? `Show ${noun} (${reason})` : `Show ${noun}`;
}

/**
 * Pure. The card's provenance line — stated **once per card** (§3j), not once
 * per row, and phrased for whoever is reading (§3h).
 *
 * `refreshed` is the newest `computed_at` across the shown rows: the sweep is
 * nightly, and a date the rows themselves carry is a fact, where "refreshed
 * nightly" alone is a claim about a cron schedule the page cannot see.
 */
export function provenanceLine(opts: { audience: FitAudience; corpus: number; noun: string; refreshed?: string | null }): string {
  const n = new Intl.NumberFormat("en-US").format(Math.max(0, opts.corpus));
  const noun = opts.corpus === 1 ? opts.noun : `${opts.noun}s`;
  const when = opts.refreshed ? ` · assessed ${opts.refreshed}` : "";
  if (opts.audience === "investigator") return `Assessed against ${n} ${noun} · the list refreshes nightly · your strategist sees the same assessment${when}`;
  return `${n} ${noun} assessed · refreshed nightly${when}`;
}

// ---------------------------------------------------------------------------
// The card's chrome
// ---------------------------------------------------------------------------

/** The card header (README §"Screens / views" 1: `flex items-center justify-between gap-4 border-b border-line px-5 py-3`). */
export const CARD_HEADER = "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-5 py-3";

/** The card header's title. */
export const CARD_TITLE = "m-0 mr-2 whitespace-nowrap text-[15px] font-semibold text-ink";

/** The card footer (README: `border-t border-line-row bg-footer-bar px-5 py-[11px]`). */
export const CARD_FOOTER = "flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-t border-line-row bg-footer-bar px-5 py-[11px]";

/** The footer's ruled-out toggle. */
export const FOOTER_TOGGLE = "whitespace-nowrap text-dense font-medium text-ink-body hover:text-ink";

/** The footer's provenance. */
export const FOOTER_NOTE = "text-meta leading-normal text-ink-muted";

/**
 * What the header says about the order, on the right of the chips.
 *
 * **Not the prototype's "Sorted by deadline".** The list is `compareFitRows`'
 * order — tier rank, then score — and each tier is read bounded and separately
 * (`loadInvestigatorFitSurface` stops once the Recommended group is full), so
 * a deadline sort would reorder a truncated set and the sentence would be
 * false about both the order and what is in it. The order is named for what it
 * is instead.
 */
export const SORT_NOTE = "Best fit first";
