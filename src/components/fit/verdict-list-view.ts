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
import type { FitVerdicts, Tone, VerdictLabel } from "@/lib/fit/verdicts";
import type { FitAudience } from "@/lib/fit/explain-view";
import type { FitEngine } from "@/lib/fit/flag";
import { plainOrNull } from "@/lib/fit/decision-text";
import type { RuledOutReason } from "@/lib/fit/verdict-fields";
import { VERDICT_LABEL_TEXT, type RowSubject } from "@/components/fit/verdict-row-view";

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
  /** The footer's "Show *n* ruled out". */
  ruledOut: boolean;
  /** Labels past Moderate — Exploratory and Can't assess — are listed at all. */
  beyondModerate: boolean;
};

/**
 * Pure. What a view has.
 *
 * The PI's own page (§3h) is "the same list, minus strategist tooling":
 * Strong and Moderate only, no checkboxes, no compare, no ruled-out toggle —
 * and no per-row action, which `fitVerdicts` already enforces by returning
 * `action: null` for this audience, so it is not repeated here. Every one of
 * these is a *capability*, not a class name: the markup asks before it draws.
 *
 * **`beyondModerate` is the gate, and it is applied to the label rather than
 * to the tier.** Reading only the Strong and Moderate tiers is not the same
 * promise: `verdictLabelOf` returns `cannot_assess` for a Strong pair whose
 * notice profile is incomplete, so a tier-side filter alone put a **Can't
 * assess** row, and a "Can't assess 1" chip, in the PI's own header — the row
 * §3h exists to keep off that page, and one screenshot 08 does not have.
 *
 * There was a third rule here, `bulk` ("Add *n* to recipients" on people-facing
 * lists). It is gone: this component is the notice-facing list on the
 * investigator page, the aside is `VerdictStack` (three rows, no selection),
 * and the Outreach workspace has its own selection bar. A capability computed,
 * documented and unit-tested with no surface able to draw it is worse than the
 * gap it papers over, and it is the same fault as a button that goes nowhere.
 */
export function audienceRules(audience: FitAudience): AudienceRules {
  const strategist = audience === "strategist";
  return { selectable: strategist, compare: strategist, ruledOut: strategist, beyondModerate: strategist };
}

/** The labels a view lists, after labelling (§3h). */
export function listsLabel(label: VerdictLabel, rules: Pick<AudienceRules, "beyondModerate">): boolean {
  return rules.beyondModerate || label === "strong" || label === "moderate";
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
 * What the footer says when the counterpart fit profiles could not be read —
 * the table is not on the database, or the read errored. Without it a missing
 * table and a missing row are the same row on screen: "Approach not
 * established · no notice profile on file" is a claim about *this notice*, and
 * it is the wrong claim when nothing was read for any of them.
 */
export const PROFILES_DEGRADED_NOTE = "fit profiles could not be read, so approach and eligibility are unverified on these rows";

/**
 * **A fit-v1 row that fell back to the pre-redesign row says so** (fit-UX
 * final round, B6).
 *
 * `outreach/queries.ts` wraps the whole verdict block in a `try`, and its
 * `catch` calls `fitByPerson.clear()` — so one stored profile the taxonomy no
 * longer knows takes the verdicts off **every** row on the item, and each of
 * them falls to `SuggestionRow`'s legacy branch. That branch renders
 * `orderedReasons`, whose first entry is `fit_results.rationale` **whole**:
 * eight component clauses with their values and `Caps — paradigm_gate
 * (exploratory: P 0.45 < 0.45)`, on a fit-v1 team, with nothing on screen
 * saying the row is not the row it should be. The same happens for one person
 * whose `fit_results` row is simply missing.
 *
 * Two things follow, and this is the first: the fallback is **stated**. The
 * second is in `SuggestionRow`, which de-numbers the snapshot's reasons on
 * that path so §2.5 holds even while degraded.
 */
export function fitRowsDegradedNote(opts: { engine: FitEngine; readFailed: boolean; missing: number; shown: number }): string | null {
  if (opts.engine !== "fit-v1") return null;
  if (opts.readFailed) return "The fit assessment could not be read for this notice, so these rows show the stored Outreach snapshot instead of the verdicts.";
  if (opts.missing <= 0) return null;
  const which = opts.missing === opts.shown ? "these rows show" : opts.missing === 1 ? "one row shows" : `${opts.missing} rows show`;
  return `No fit assessment is stored for ${opts.missing === 1 ? "one of these people" : `${opts.missing} of these people`}, so ${which} the stored Outreach snapshot instead of the verdicts.`;
}

/**
 * Pure. The snapshot's own reason lines as the **fallback** row shows them
 * (B6, second half).
 *
 * A fit-v1 row with no `fit` renders `orderedReasons`, and on a fit-v1 team
 * the first of those is `fit_results.rationale` **whole** — `Paradigm 0.45 —
 * Clinical trials (yours 0.85) … · Caps — paradigm_gate (exploratory: P 0.45 <
 * 0.45)`. Degrading is one thing; degrading into the inspector's voice on a
 * decision surface is §2.5 all over again, on the path nobody looks at.
 *
 * **Only under fit-v1.** A legacy team's reasons come from the legacy
 * suggestion engine and are its own prose; D-a says that path is untouched, so
 * the engine flag gates the de-numbering rather than the shape of the text.
 */
export function fallbackReasonLines<R extends { text: string }>(reasons: readonly R[], engine: FitEngine): R[] {
  if (engine !== "fit-v1") return [...reasons];
  return reasons.map((r) => ({ ...r, text: plainOrNull(r.text) ?? "" })).filter((r) => r.text.length > 0);
}

/**
 * Pure. The card's provenance line — stated **once per card** (§3j), not once
 * per row, and phrased for whoever is reading (§3h).
 *
 * There was a `refreshed` argument here, for the newest `computed_at` across
 * the shown rows. No caller ever supplied one and none could: `computed_at` is
 * not in `FIT_RESULT_VERDICT_COLUMNS`, so half of this function — and the test
 * over it — was dead. It is gone rather than paid for with a column the
 * surfaces do not otherwise need.
 */
export function provenanceLine(opts: { audience: FitAudience; corpus: number | null; noun: string; /** Neither counterpart profile read landed (§3i). */ degraded?: boolean }): string {
  const degraded = opts.degraded ? ` · ${PROFILES_DEGRADED_NOTE}` : "";
  // B5: `null` is a count that did not come back, and the card does not state
  // a corpus it could not read. "0 open notices assessed" under five rows is
  // worse than saying nothing about the corpus at all.
  if (opts.corpus === null) {
    const noun = `${opts.noun}s`;
    if (opts.audience === "investigator") return `Assessed nightly against the open ${noun} · the count could not be read just now · your strategist sees the same assessment${degraded}`;
    return `Assessed nightly against the open ${noun} · the count could not be read just now${degraded}`;
  }
  const n = new Intl.NumberFormat("en-US").format(Math.max(0, opts.corpus));
  const noun = opts.corpus === 1 ? opts.noun : `${opts.noun}s`;
  if (opts.audience === "investigator") return `Assessed against ${n} ${noun} · the list refreshes nightly · your strategist sees the same assessment${degraded}`;
  return `${n} ${noun} assessed · refreshed nightly${degraded}`;
}

// ---------------------------------------------------------------------------
// The card's chrome
// ---------------------------------------------------------------------------

/**
 * The card header (README §"Screens / views" 1: `flex items-center
 * justify-between gap-4 border-b border-line px-5 py-3`).
 *
 * **`flex-nowrap`, and the right-hand slot reserves its width.** The header
 * used to wrap: measured at 1366px on the investigator page (card 706px, so
 * 664px between the `px-5` rails), the five data-derived chips are 566.6px and
 * the right cluster — "Sorted by…" plus "Compare *n*" — 168.1px, which with
 * the 16px gap is 750.7px. So the moment a strategist selected a second row
 * the cluster wrapped to its own line, the header went 51px → 87px, and every
 * row below it moved down 36px: a layout that jumps because of what the user
 * just did, and data-dependent besides (five chips is the prototype's own
 * header, and a sixth would do it at rest).
 *
 * Two changes, and between them the header's height no longer depends on the
 * selection at all:
 *
 *   - the order note moved to the **footer**, beside the provenance it belongs
 *     with — both are statements about the list as a whole (§3j), and the
 *     README's placement is not worth a jumping header;
 *   - the right slot is `shrink-0` and always `CARD_HEADER_ACTION_W` wide,
 *     whether or not the Compare button is in it, so the chips are laid out
 *     against the same width in both states. If they ever wrap, they wrap
 *     identically selected and unselected.
 *
 * Measured against the repo's compiled Tailwind at 1366px, in Geist: the title
 * and five chips are 561.2px, the reserved slot 90px and the gap 12px, which
 * is 663.2px inside the card's 666px of inner width — one line, at rest and
 * with a selection, and the header 51px in both. The stability is structural
 * (a reserved slot cannot change width); the single line is the measurement,
 * and a sixth chip would take both states to two lines together rather than
 * one state to two on a click.
 */
export const CARD_HEADER = "flex flex-nowrap items-center justify-between gap-x-3 border-b border-line px-5 py-3";

/** The chips half: it takes the room that is left and wraps inside itself rather than pushing the right slot down. */
export const CARD_HEADER_CHIPS = "flex min-w-0 flex-1 flex-wrap items-center gap-2";

/**
 * The right slot's reserved width — "Compare 3" at `Button size={28}` measures
 * 89.3px, the widest thing it ever holds — and its fixed height, so an empty
 * slot and a slot with a button are the same box (the button is `h-7`, a chip
 * `h-[26px]`, and without this the header would still move 2px). The number is
 * here rather than in the markup so a change to the button's copy or padding
 * is a change to one value.
 */
export const CARD_HEADER_ACTIONS = "flex h-7 w-[90px] shrink-0 items-center justify-end";

/** The card header's title. No `mr-2`: the chips row's own `gap-2` is that 8px, and the doubled gap was 8 of the 12 the header needed to keep one line. */
export const CARD_TITLE = "m-0 whitespace-nowrap text-[15px] font-semibold text-ink";

/** The card footer (README: `border-t border-line-row bg-footer-bar px-5 py-[11px]`). */
export const CARD_FOOTER = "flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-t border-line-row bg-footer-bar px-5 py-[11px]";

/** The footer's ruled-out toggle. */
export const FOOTER_TOGGLE = "whitespace-nowrap text-dense font-medium text-ink-body hover:text-ink";

/** The footer's provenance. */
export const FOOTER_NOTE = "text-meta leading-normal text-ink-muted";

/**
 * The footer's shared-evidence line, coloured the way the chip it replaces was
 * (L5). `ok` keeps the muted footer voice — a well-evidenced profile is the
 * unremarkable case and a teal line in the footer would compete with the rows.
 */
export const FOOTER_EVIDENCE_TONE: Record<Tone, string> = {
  ok: "text-meta leading-normal text-ink-body",
  caution: "text-meta font-medium leading-normal text-warning",
  blocking: "text-meta font-medium leading-normal text-danger",
};

/**
 * Pure. The evidence verdict when it is a fact about the **card** rather than
 * about the row (fit-UX follow-up, L5).
 *
 * The evidence verdict describes the *investigator*: how much work the
 * assessment rests on, by kind, with the thin-evidence and confidence caps
 * named. On the investigator page every row is a different notice assessed
 * against **one** person, so it is the same sentence on every row —
 * `Well evidenced · 118 papers, 9 awards`, ten times down one card, measured
 * live. That is §3j's "provenance once per card, not once per row" arriving
 * in a different field, and §2.7's repetition.
 *
 * On the notice→people surfaces the subject of the chip changes with the row,
 * so it stays on the row. Two conditions, and both are needed:
 *
 *   - **`subject === "notice"`** — the rows are notices, so the evidence's
 *     subject is constant *by construction*. Sameness alone is not enough: a
 *     three-person aside whose three people happen to read alike would move a
 *     per-person fact into a footer that claims it is the card's.
 *   - **every listed row says the same thing** — a card is never given a
 *     footer line that contradicts a row it is not showing.
 *
 * `null` means the chip stays where it is. The rows passed in are the ones the
 * card lists for this audience, ruled-out rows included: a footer line that
 * ignored the rows behind the toggle would change the moment the toggle was
 * pressed.
 *
 * **The words must match; the tone is read off the rows that are not ruled
 * out.** Measured live on `/investigators/d319da9b-…`: all fifteen rows say
 * `Well evidenced · 118 papers, 9 awards` and two *tones* are in play, because
 * D-e's coherence pass forbids an `ok` chip under a `Ruled out` label and
 * repaints the five ruled-out rows amber — tone only, the words untouched.
 * That tone is a fact about the **label**, not about the evidence, so
 * comparing it would let the coherence pass defeat the deduplication and
 * leave the sentence on all fifteen rows. A ruled-out row loses nothing by it:
 * its label, its blocking caveat and its other two chips all still carry D-e's
 * rule.
 */
export function sharedEvidenceVerdict(rows: ReadonlyArray<{ verdicts: Pick<FitVerdicts, "evidence" | "label"> }>, subject: RowSubject): { text: string; tone: Tone } | null {
  if (subject !== "notice" || rows.length < 2) return null;
  const text = rows[0]!.verdicts.evidence.text;
  if (!text.trim() || !rows.every((r) => r.verdicts.evidence.text === text)) return null;
  // The plain reading: rows whose tone is the evidence verdict's own, not one
  // the label overrode. A card of nothing but ruled-out rows falls back to
  // theirs, which are then all the same.
  const plain = rows.filter((r) => r.verdicts.label !== "ruled_out");
  const read = plain.length ? plain : rows;
  const tone = read[0]!.verdicts.evidence.tone;
  return read.every((r) => r.verdicts.evidence.tone === tone) ? { text, tone } : null;
}

/**
 * What the card says about the order.
 *
 * **Not the prototype's "Sorted by deadline".** The list is `compareFitRows`'
 * order — tier rank, then score — and each tier is read bounded and separately
 * (`loadInvestigatorFitSurface` stops once the Recommended group is full), so
 * a deadline sort would reorder a truncated set and the sentence would be
 * false about both the order and what is in it. The order is named for what it
 * is instead.
 *
 * **In the footer, not the header** (see `CARD_HEADER`): it is a statement
 * about the whole list, like the provenance it now sits beside, and keeping it
 * out of the header is what lets the header's height stop depending on the
 * selection.
 */
export const SORT_NOTE = "Best fit first";

/**
 * What the card says when a **filter** has emptied a list that has rows in it
 * (fit-UX PR 5).
 *
 * Not a §3i state, and that is the point. The card used to draw its one
 * `empty` string for both cases, so a strategist who clicked "Strong 0"… could
 * not, because a zero chip is omitted — but who clicked "Moderate 1" and then
 * dismissed that row got "Nothing open is worth your attention right now"
 * under a header still reading "All 4". The answer §3i writes is about the
 * whole assessment; this is about the chip that is pressed, and it says which
 * one and how to leave it.
 */
export const FILTER_EMPTY = "No row in this filter. Choose another chip, or All, to see the rest.";
