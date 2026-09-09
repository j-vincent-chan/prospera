"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { dismissOpportunitiesAction, restoreOpportunitiesAction, saveOpportunitiesAction, setWatchAction } from "@/app/actions/opportunity-actions";
import { createOutreachItemAction } from "@/app/actions/outreach-actions";
import { FitStatePanel } from "@/components/fit/fit-state-card";
import { FitRowControls } from "@/components/fit/fit-row-controls";
import { VerdictRow } from "@/components/fit/verdict-row";
import type { VerdictRowDisclosure } from "@/components/fit/verdict-row-disclosure";
import { inspectorHref, RECAP_HEADING, RECAP_ORDER, RECAP_TONE } from "@/components/outreach/audit-sections";
import { EvidenceView } from "@/components/outreach/evidence-view";
import {
  audienceRules,
  CARD_FOOTER,
  CARD_HEADER,
  CARD_HEADER_ACTIONS,
  CARD_HEADER_CHIPS,
  CARD_TITLE,
  comparedRows,
  FILTER_EMPTY,
  filterChipClass,
  filterChips,
  FOOTER_EVIDENCE_TONE,
  FOOTER_NOTE,
  FOOTER_TOGGLE,
  listsLabel,
  matchesFilter,
  MIN_COMPARED,
  ruledOutLabel,
  sharedEvidenceVerdict,
  sharedRuledOutReason,
  SORT_NOTE,
  toggleSelected,
  type FitFilter,
  type RuledOutReason,
} from "@/components/fit/verdict-list-view";
import { ACTION_BUTTON, CHIP_ORDER, CHIPS_WITHOUT_EVIDENCE, DUE_CAPTION, DUE_TONE, VERDICT_LABEL_PILL, VERDICT_LABEL_TEXT, type DueTone, type RowSubject } from "@/components/fit/verdict-row-view";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { useToast } from "@/components/ui/toast";
import type { FitAudience } from "@/lib/fit/explain-view";
import type { AuditContent, AuditItemGroup } from "@/lib/fit/audit-view";
import type { FitState, FitStateAction } from "@/lib/fit/surface-states";
import type { PanelContent } from "@/lib/fit/verdict-panel";
import type { FitVerdicts } from "@/lib/fit/verdicts";
import { cn } from "@/lib/utils/cn";

/**
 * The fit card's interactive shell (fit-UX PR 3; brief: `docs/fit-ux/README.md`
 * §"Screens / views" 1, §"Interactions & behaviour", §"State management").
 *
 * **This is the client boundary on the investigator page.** The page and
 * `fit-opportunities.tsx` are server components: they do the reads, run
 * `fitVerdicts`, and hand this component plain serializable rows. Every
 * handler — select, disclose, compare, the row's verb — is created here, which
 * is what C7 requires: `VerdictRow` is a client component and a server parent
 * passing it a function throws at request time while `tsc`, `next lint` and
 * `next build` all stay green (the fit routes are `force-dynamic`).
 *
 * The state is exactly README §"State management":
 * `{ open, deep, selected, comparing, filter, showRuledOut }`. **`deep` is the
 * audit layer, wired in PR 4**: the row's "All evidence and components →" sets
 * it and this component renders `EvidenceView` in the card's place. Nothing is
 * unmounted to do it — `filter`, `selected`, `showRuledOut` and `open` all
 * outlive the view, which is what makes "← Back to the list restores the list,
 * its filter and its selection" true rather than a claim. The link is drawn
 * per row, only where a row actually carries an audit (PR 2's rule: an inert
 * control is worse than none).
 *
 * The rules the list owns rather than the row: one disclosure open at a time,
 * at most three selected with a fourth dropping the oldest, and compare in
 * list order. All three live in `verdict-list-view.ts`, so they are unit-tested
 * rather than asserted about JSX.
 *
 * **The verbs are wired to mechanisms that already exist**, one per
 * `VerdictAction.id`, and each does what the word says:
 *
 *   | id | verb | what it does |
 *   |---|---|---|
 *   | `add_to_outreach` | Add to outreach | `saveOpportunitiesAction` — the notice enters Triage |
 *   | `see_whats_missing` | See what's missing | opens this row's disclosure, whose bullets are the gap |
 *   | `keep_as_lead` | Keep as a lead | `setWatchAction` — the team's own "watch next cycle" |
 *   | `read_notice` | Read the notice | the notice page |
 *   | `dismiss` | Dismiss | `dismissOpportunitiesAction` — the team's own dismissal |
 *   | `open_in_outreach` | Open in Outreach | the notice's existing Outreach item |
 *
 * **The dispatch is on the id, never on the label.** It was on the label, and
 * the label the pipeline case carries — "Open in Outreach" — matched no branch,
 * so it fell through to `saveOpportunitiesAction`: a button that navigated
 * nowhere, wrote, and toasted "Saved … to outreach · Triage" about a notice
 * already sitting on that board. `createOutreachItemAction` returns the
 * existing item without writing when there is one, which is why it is the
 * mechanism for a row the engine has already flagged `in_pipeline`.
 *
 * No new server action, and no button that goes nowhere.
 *
 * **No "This is wrong…" here, and that is a gap rather than an omission.**
 * §3's "flag-as-wrong everywhere" is kept by mechanisms that exist:
 * `flagFitProfile` flags an *axis of a stored profile* and is behind
 * `requireAdmin` (the two `/fit` inspectors), and the workspace's wrong-type
 * dismissal is about a **person** on a notice. Neither is "this notice is a
 * wrong match for this investigator", which is what a link on this card would
 * promise, and wiring the words to the nearest available mechanism is exactly
 * the fault W6 names on the other surface. So the row's `onFlag` is not
 * supplied and no link is drawn. A per-row flag for this direction needs a
 * mechanism first — flagged for the pilot decision alongside §3h's own gap.
 */

export type VerdictListRow = {
  /** Stable id — the notice's. */
  id: string;
  verdicts: FitVerdicts;
  title: string;
  href?: string;
  meta?: string | null;
  due?: { text: string; tone?: DueTone } | null;
  disclosure?: VerdictRowDisclosure;
  /**
   * PR 4's audit layer. Supplied, the disclosure draws "All evidence and
   * components →" and the card replaces itself with the audit view; omitted,
   * neither exists — an inert link into a view with nothing in it is the same
   * mistake as an uncheckable checkbox.
   */
  audit?: { content: AuditContent; panel: PanelContent; items: readonly AuditItemGroup[] };
  /** §3f: shown only while the footer's toggle is on. */
  ruledOut?: boolean;
  /** Why it was ruled out, for the footer's parenthetical. */
  ruledOutReason?: RuledOutReason | null;
};

export type VerdictListProps = {
  title: string;
  rows: readonly VerdictListRow[];
  audience: FitAudience;
  /** Which way the rows read — it captions the right-hand field and heads the disclosure, and never leaks a notice's caption onto a person. */
  subject?: RowSubject;
  /** The card footer's one provenance line (§3j). */
  provenance: string;
  /**
   * §3i's state for a card with no rows to list, drawn between this card's own
   * header and footer so the shape, the chips and the provenance survive it.
   * Supplied by the loader's selector, never written here.
   *
   * It is drawn only when the card has **no rows at all**; a filter that has
   * emptied a populated list gets `FILTER_EMPTY` instead, because "nothing
   * clears the bar" is an answer about the assessment and not about the chip
   * that happens to be pressed.
   */
  empty?: FitState;
  /**
   * PR 4's audit view links to the admin fit inspector, which is behind
   * `requireAdmin`. Passed only for an admin viewer; a non-admin gets no link
   * rather than one that 403s, the same gate the investigator page already
   * puts on "Fit profile (admin) →".
   */
  viewerIsAdmin?: boolean;
  /**
   * The fixed side of every pair on this card — the investigator, when the
   * rows are notices. Supplied, each row gets the §3h controls: the PI's
   * "Ask my strategist" and, for both audiences, "this match is wrong".
   * Omitted, the row keeps the bare verb it had, so a surface that has no
   * second id cannot render a control that would post half a pair.
   */
  pairInvestigatorId?: string | null;
};

// ---------------------------------------------------------------------------
// Compare (§3g)
// ---------------------------------------------------------------------------

/**
 * One comparison column: the same slots as the row, stacked as label → value,
 * **including the fourth** — §3g says the columns compare "on the same slots",
 * and screenshot 05 puts each column's verb at its foot. A column without it
 * compares three rows and then makes the strategist go back to the list to act
 * on the one they picked, which is the comparison's whole purpose dropped at
 * the last step.
 *
 * The right-hand field is captioned from `subject`, not from a constant: this
 * is the caption-crossing hazard the README warns about in as many words ("do
 * not let the notice caption leak onto a person"), and `DUE_CAPTION.notice`
 * written here was that leak waiting for the first people-facing list.
 */
function CompareColumn({ row, subject, onRemove, onAction }: { row: VerdictListRow; subject: RowSubject; onRemove: () => void; onAction?: () => void }) {
  // The three verdicts' order, headings and tones are `audit-sections.ts`'s —
  // the audit view's recap and this comparison are the same three cells said
  // twice, and until fit-UX PR 5's sweep this file wrote its own copy of all
  // three. They had already drifted: `RECAP_TONE.caution` is `font-medium
  // text-warning` and the local map's was `text-warning`, so a caution here
  // was carried by colour alone — D-l's rule ("colour never carries meaning
  // alone") broken by a duplicate rather than by a decision.
  const cells = RECAP_ORDER.map((axis) => [axis, RECAP_HEADING[axis], row.verdicts[axis]] as const);
  return (
    <div className="flex flex-col overflow-hidden rounded-card border border-line">
      <div className="border-b border-line-row px-3.5 py-3">
        <div className="flex items-center justify-between gap-2.5">
          <Pill variant={VERDICT_LABEL_PILL[row.verdicts.label]}>{VERDICT_LABEL_TEXT[row.verdicts.label]}</Pill>
          <button type="button" onClick={onRemove} aria-label={`Remove ${row.title} from the comparison`} className="text-meta text-ink-muted hover:text-ink">
            Remove
          </button>
        </div>
        <p className="mb-0 mt-2 text-body font-semibold leading-[1.45] text-ink">{row.title}</p>
        {row.meta ? <p className="mb-0 mt-1 text-meta text-ink-muted">{row.meta}</p> : null}
      </div>
      <dl className="m-0 grid flex-1 grid-cols-[84px_minmax(0,1fr)] content-start gap-x-2.5 gap-y-2 px-3.5 py-3 text-dense leading-[1.45]">
        {cells.map(([axis, heading, verdict]) => (
          <div key={axis} className="contents">
            <dt className="text-ink-muted">{heading}</dt>
            <dd className={cn("m-0", RECAP_TONE[verdict.tone])}>{verdict.text}</dd>
          </div>
        ))}
        {row.due ? (
          <div className="contents">
            <dt className="text-ink-muted">{DUE_CAPTION[subject]}</dt>
            <dd className={cn("m-0", DUE_TONE[row.due.tone ?? "normal"])}>{row.due.text}</dd>
          </div>
        ) : null}
        <div className="contents">
          <dt className="text-ink-muted">Caveat</dt>
          <dd className="m-0 text-ink">{row.verdicts.caveat.text}</dd>
        </div>
      </dl>
      {/* The row's fourth slot. Drawn on the same terms as on the row itself:
          with a handler, or not at all — the PI's `action` is already null. */}
      {row.verdicts.action && onAction ? (
        <div className="px-3.5 pb-3.5">
          <Button variant={ACTION_BUTTON[row.verdicts.action.kind].variant} size={32} onClick={onAction} className="w-full">
            {row.verdicts.action.label}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export function VerdictList({ title, rows, audience, subject = "notice", provenance, empty, viewerIsAdmin = false, pairInvestigatorId = null }: VerdictListProps) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState<string | null>(null);
  // PR 4's audit view. The state is here because §"State management" puts it
  // here and because "back restores the list, its filter and its selection"
  // only works if the list outlives the view: `filter`, `selected`,
  // `showRuledOut` and `open` are all still mounted while the audit renders,
  // so "← Back to the list" restores every one of them untouched.
  const [deep, setDeep] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [filter, setFilter] = useState<FitFilter>("all");
  const [showRuledOut, setShowRuledOut] = useState(false);

  const rules = useMemo(() => audienceRules(audience), [audience]);
  // §3h is enforced on the **label**, not on the tier the loader read: a Strong
  // pair whose notice profile is incomplete is labelled `cannot_assess`, and a
  // tier-side gate alone put that row — and a "Can't assess 1" chip — on the
  // PI's own page.
  const audienceRows = useMemo(() => rows.filter((r) => listsLabel(r.verdicts.label, rules)), [rows, rules]);
  const listed = useMemo(() => audienceRows.filter((r) => !r.ruledOut), [audienceRows]);
  const ruled = useMemo(() => audienceRows.filter((r) => r.ruledOut), [audienceRows]);
  const chips = useMemo(() => filterChips(listed.map((r) => r.verdicts.label)), [listed]);
  const visible = useMemo(() => listed.filter((r) => matchesFilter(r.verdicts.label, filter)), [listed, filter]);
  const shown = useMemo(() => (rules.ruledOut && showRuledOut ? [...visible, ...ruled] : visible), [rules.ruledOut, showRuledOut, visible, ruled]);
  const compared = useMemo(() => comparedRows(shown, selected, (r) => r.id), [shown, selected]);
  const ruledReason = useMemo(() => sharedRuledOutReason(ruled.map((r) => r.ruledOutReason)), [ruled]);
  // L5: the evidence verdict is a fact about the investigator, so on the
  // investigator→notices card it is the same sentence on every row. Computed
  // over every row this audience lists — ruled-out rows included — so the
  // footer's line does not change when the toggle is pressed.
  const sharedEvidence = useMemo(() => sharedEvidenceVerdict(audienceRows, subject), [audienceRows, subject]);
  const rowChips = sharedEvidence ? CHIPS_WITHOUT_EVIDENCE : CHIP_ORDER;
  // Resolved over every row this audience lists, not over `shown`: the filter
  // and the ruled-out toggle are still live while the audit view is open, and
  // a deep row that fell out of the current filter must still render rather
  // than silently dropping the reader back to the list.
  const deepRow = useMemo(() => (deep ? audienceRows.find((r) => r.id === deep && r.audit) ?? null : null), [deep, audienceRows]);

  // A comparison that has lost a column is over. `comparing` used to be cleared
  // only by "Back to the list" and by removing a column from inside it, so a
  // filter change that dropped the set below two fell back to the list with the
  // flag still set: the "Compare *n*" button stayed hidden, and selecting a
  // second row jumped straight back into the comparison without being asked.
  useEffect(() => {
    if (comparing && compared.length < MIN_COMPARED) setComparing(false);
  }, [comparing, compared.length]);

  const select = (id: string) => setSelected((s) => toggleSelected(s, id));
  const toggle = (id: string) => setOpen((o) => (o === id ? null : id));

  /**
   * The one mechanism a §3i state on this card can ask for: reveal the
   * ruled-out rows the loader already has, which is the footer toggle's own
   * behaviour reached from the state's sentence. Undefined when this audience
   * has no ruled-out rows, so `FitStatePanel` draws no button at all rather
   * than one that does nothing (PR 3's `3b`).
   */
  const onStateAction =
    rules.ruledOut && ruled.length
      ? (id: FitStateAction["id"]) => {
          if (id !== "show_nearest") return;
          setFilter("all");
          setShowRuledOut(true);
        }
      : undefined;

  /** The row's one verb, dispatched on `action.id` and each on a mechanism the app already has. */
  const act = (row: VerdictListRow) => {
    const action = row.verdicts.action;
    if (!action) return;
    if (action.id === "see_whats_missing") return toggle(row.id);
    if (action.id === "read_notice") return router.push(`/opportunities/${row.id}`);
    startTransition(async () => {
      switch (action.id) {
        case "open_in_outreach": {
          // The pair is already on the board; this opens the item rather than
          // making a second one — `createOutreachItemAction` returns the
          // existing row untouched (`created: false`).
          const r = await createOutreachItemAction(row.id);
          if (!r.ok) return toast({ message: r.error, tone: "error" });
          return router.push(`/outreach?item=${r.itemId}`);
        }
        case "keep_as_lead": {
          const r = await setWatchAction({ opportunityIds: [row.id], watching: true });
          if (!r.ok) return toast({ message: r.error, tone: "error" });
          return toast({ message: `Watching ${row.title} for the next cycle`, action: { label: "Undo", onClick: () => startTransition(async () => { await setWatchAction({ opportunityIds: [row.id], watching: false }); router.refresh(); }) } });
        }
        case "dismiss": {
          const r = await dismissOpportunitiesAction({ opportunityIds: [row.id] });
          if (!r.ok) return toast({ message: r.error, tone: "error" });
          router.refresh();
          return toast({ message: `Dismissed ${row.title}`, action: { label: "Undo", onClick: () => startTransition(async () => { await restoreOpportunitiesAction({ opportunityIds: [row.id] }); router.refresh(); }) } });
        }
        default: {
          // `add_to_outreach`: the notice enters the team's Triage board.
          const r = await saveOpportunitiesAction({ opportunityIds: [row.id], saved: true });
          if (!r.ok) return toast({ message: r.error, tone: "error" });
          router.refresh();
          return toast({ message: `Saved ${row.title} to outreach · Triage`, action: r.itemId ? { label: "Open", onClick: () => router.push(`/outreach?item=${r.itemId}`) } : undefined });
        }
      }
    });
  };

  const header = (
    <div className={CARD_HEADER}>
      <div className={CARD_HEADER_CHIPS}>
        <h2 className={CARD_TITLE}>{title}</h2>
        {chips.map((c) => (
          <button key={c.id} type="button" onClick={() => setFilter(c.id)} aria-pressed={filter === c.id} className={filterChipClass(filter === c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      {/* Always this box, empty or not: the chips lay out against the same
          width whether or not a comparison is available, so the header's
          height cannot change under the selection. */}
      <div className={CARD_HEADER_ACTIONS}>
        {rules.compare && selected.length >= MIN_COMPARED && !comparing ? (
          <Button variant="primary" size={28} onClick={() => setComparing(true)}>
            Compare {selected.length}
          </Button>
        ) : null}
      </div>
    </div>
  );

  // §3i's answer carries its own offer to show the ruled-out rows ("Show the
  // 12 nearest, and why they fell short"), and the footer's toggle is the same
  // mechanism. Measured at 1366px, an empty card drew both — the same reveal
  // twice, 90px apart, which is §2.7's repetition. The footer's is dropped
  // while the state is showing; the moment the rows appear the state is gone
  // and the toggle is back, reading "Hide the 12 ruled out".
  const stateShowing = Boolean(empty) && !listed.length;

  const footer = (
    <div className={CARD_FOOTER}>
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
        {rules.ruledOut && ruled.length && !(stateShowing && !showRuledOut) ? (
          <button type="button" onClick={() => setShowRuledOut((v) => !v)} className={FOOTER_TOGGLE}>
            {ruledOutLabel(showRuledOut, ruled.length, ruledReason)}
          </button>
        ) : null}
        <span className={FOOTER_NOTE}>{SORT_NOTE}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
        {sharedEvidence ? <span className={FOOTER_EVIDENCE_TONE[sharedEvidence.tone]}>{sharedEvidence.text}</span> : null}
        <span className={FOOTER_NOTE}>{provenance}</span>
      </div>
    </div>
  );

  // ---- The audit layer replaces the list in place (README §"Screens / views" 4) ----
  if (deepRow?.audit) {
    return (
      <EvidenceView
        subject={subject}
        title={deepRow.title}
        href={deepRow.href}
        meta={deepRow.meta}
        provenance={provenance}
        fit={{ verdicts: deepRow.verdicts, panel: deepRow.audit.panel, audit: deepRow.audit.content }}
        items={deepRow.audit.items}
        inspectorHref={viewerIsAdmin ? inspectorHref(subject, deepRow.id) : null}
        onBack={() => setDeep(null)}
        onAction={deepRow.verdicts.action ? () => act(deepRow) : undefined}
        pending={pending}
      />
    );
  }

  if (comparing && compared.length >= MIN_COMPARED) {
    return (
      <section className="rounded-card border border-line bg-card">
        {header}
        <div className="px-5 pb-5 pt-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="m-0 text-dense text-ink-muted">Comparing {compared.length} · your filters and selection are kept</p>
            <button type="button" onClick={() => setComparing(false)} className="text-dense font-medium text-teal hover:text-navy">
              ← Back to the list
            </button>
          </div>
          <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${compared.length}, minmax(0,1fr))` }}>
            {compared.map((r) => (
              <CompareColumn
                key={r.id}
                row={r}
                subject={subject}
                onAction={r.verdicts.action ? () => act(r) : undefined}
                onRemove={() => setSelected((s) => s.filter((x) => x !== r.id))}
              />
            ))}
          </div>
        </div>
        {footer}
      </section>
    );
  }

  return (
    <section className={cn("rounded-card border border-line bg-card", pending && "opacity-90")}>
      {header}
      {shown.length ? (
        shown.map((r, i) => (
          <VerdictRow
            key={r.id}
            id={r.id}
            first={i === 0}
            verdicts={r.verdicts}
            title={r.title}
            href={r.href}
            meta={r.meta}
            due={r.due ?? undefined}
            subject={subject}
            selectable={rules.selectable}
            selected={selected.includes(r.id)}
            onSelect={rules.selectable ? () => select(r.id) : undefined}
            open={open === r.id}
            onToggle={r.disclosure ? () => toggle(r.id) : undefined}
            disclosure={r.disclosure}
            onDeep={r.audit ? () => setDeep(r.id) : undefined}
            onAction={r.verdicts.action ? () => act(r) : undefined}
            actions={
              pairInvestigatorId && subject === "notice" ? (
                <FitRowControls
                  investigatorId={pairInvestigatorId}
                  opportunityId={r.id}
                  audience={audience}
                  label={r.verdicts.label}
                  verb={r.verdicts.action}
                  onVerb={r.verdicts.action ? () => act(r) : undefined}
                />
              ) : undefined
            }
            chips={rowChips}
          />
        ))
      ) : stateShowing && empty ? (
        // §3i, inside the card. `listed`, not `audienceRows`: a card whose only
        // content is ruled-out rows has nothing listed, and that is exactly the
        // case §3i's answer is for — measured at 1366px, gating on
        // `audienceRows` put "No row in this filter." where the answer belongs
        // on every such card, because the twelve rows behind the footer toggle
        // counted as content.
        //
        // "Show the *n* nearest" is handed a mechanism only where there is one
        // — the ruled-out rows are strategist tooling (D7) and `nearest` is
        // already 0 without them, so this is the second gate on the same fact
        // rather than the only one.
        <div className="border-t border-line-row">
          <FitStatePanel state={empty} onAction={onStateAction} />
        </div>
      ) : (
        <p className="m-0 border-t border-line-row px-5 py-4 text-dense leading-normal text-ink-muted">{FILTER_EMPTY}</p>
      )}
      {footer}
    </section>
  );
}
