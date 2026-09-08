"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { dismissOpportunitiesAction, restoreOpportunitiesAction, saveOpportunitiesAction, setWatchAction } from "@/app/actions/opportunity-actions";
import { VerdictRow } from "@/components/fit/verdict-row";
import type { VerdictRowDisclosure } from "@/components/fit/verdict-row-disclosure";
import {
  audienceRules,
  CARD_FOOTER,
  CARD_HEADER,
  CARD_TITLE,
  comparedRows,
  filterChipClass,
  filterChips,
  FOOTER_NOTE,
  FOOTER_TOGGLE,
  matchesFilter,
  MIN_COMPARED,
  ruledOutLabel,
  sharedRuledOutReason,
  SORT_NOTE,
  toggleSelected,
  type FitFilter,
  type RuledOutReason,
} from "@/components/fit/verdict-list-view";
import { DUE_CAPTION, DUE_TONE, VERDICT_LABEL_PILL, VERDICT_LABEL_TEXT, type DueTone } from "@/components/fit/verdict-row-view";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { useToast } from "@/components/ui/toast";
import type { FitAudience } from "@/lib/fit/explain-view";
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
 * `{ open, deep, selected, comparing, filter, showRuledOut }`. `deep` is PR 4's
 * audit view — the hook is here and the row's "All evidence and components →"
 * sets it, but nothing renders it yet, so `onDeep` is not passed down and the
 * link is not drawn (PR 2's rule: an inert control is worse than none).
 *
 * The rules the list owns rather than the row: one disclosure open at a time,
 * at most three selected with a fourth dropping the oldest, and compare in
 * list order. All three live in `verdict-list-view.ts`, so they are unit-tested
 * rather than asserted about JSX.
 *
 * **The verbs are wired to mechanisms that already exist**, one per label, and
 * each does what the word says:
 *
 *   | verb | what it does |
 *   |---|---|
 *   | Add to outreach | `saveOpportunitiesAction` — the notice enters Triage |
 *   | See what's missing | opens this row's disclosure, whose bullets are the gap |
 *   | Keep as a lead | `setWatchAction` — the team's own "watch next cycle" |
 *   | Read the notice | the notice page |
 *   | Dismiss | `dismissOpportunitiesAction` — the team's own dismissal |
 *
 * No new server action, and no button that goes nowhere.
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
  /** §3f: shown only while the footer's toggle is on. */
  ruledOut?: boolean;
  /** Why it was ruled out, for the footer's parenthetical. */
  ruledOutReason?: RuledOutReason | null;
};

export type VerdictListProps = {
  title: string;
  rows: readonly VerdictListRow[];
  audience: FitAudience;
  /** The card footer's one provenance line (§3j). */
  provenance: string;
  /** Rendered instead of the rows when the list is empty; the card keeps its shape (§3i). */
  empty?: string;
  /**
   * PR 4's audit view. False here, and deliberately: the `deep` state below is
   * the hook README §"State management" asks for — it is the list that has to
   * outlive the view for "back restores the list, its filter and its
   * selection" to mean anything — but nothing renders the view yet, so the
   * row's "All evidence and components →" link is not drawn. PR 4 passes
   * `true` and renders on `deep`.
   */
  deepView?: boolean;
};

// ---------------------------------------------------------------------------
// Compare (§3g)
// ---------------------------------------------------------------------------

/** One comparison column: the same slots as the row, stacked as label → value. */
function CompareColumn({ row, onRemove }: { row: VerdictListRow; onRemove: () => void }) {
  const cells: Array<[string, string, string]> = [
    ["Approach", row.verdicts.approach.text, row.verdicts.approach.tone],
    ["Eligibility", row.verdicts.eligibility.text, row.verdicts.eligibility.tone],
    ["Evidence", row.verdicts.evidence.text, row.verdicts.evidence.tone],
  ];
  const toneClass: Record<string, string> = { ok: "text-ink", caution: "text-warning", blocking: "text-danger" };
  return (
    <div className="overflow-hidden rounded-card border border-line">
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
      <dl className="m-0 grid grid-cols-[84px_minmax(0,1fr)] gap-x-2.5 gap-y-2 px-3.5 py-3 text-dense leading-[1.45]">
        {cells.map(([k, v, tone]) => (
          <div key={k} className="contents">
            <dt className="text-ink-muted">{k}</dt>
            <dd className={cn("m-0", toneClass[tone] ?? "text-ink")}>{v}</dd>
          </div>
        ))}
        {row.due ? (
          <div className="contents">
            <dt className="text-ink-muted">{DUE_CAPTION.notice}</dt>
            <dd className={cn("m-0", DUE_TONE[row.due.tone ?? "normal"])}>{row.due.text}</dd>
          </div>
        ) : null}
        <div className="contents">
          <dt className="text-ink-muted">Caveat</dt>
          <dd className="m-0 text-ink">{row.verdicts.caveat.text}</dd>
        </div>
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export function VerdictList({ title, rows, audience, provenance, empty, deepView = false }: VerdictListProps) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState<string | null>(null);
  // PR 4's audit view. The state is here because §"State management" puts it
  // here and because "back restores the list, its filter and its selection"
  // only works if the list outlives the view; nothing renders it yet.
  const [deep, setDeep] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [filter, setFilter] = useState<FitFilter>("all");
  const [showRuledOut, setShowRuledOut] = useState(false);

  const rules = audienceRules(audience);
  const listed = useMemo(() => rows.filter((r) => !r.ruledOut), [rows]);
  const ruled = useMemo(() => rows.filter((r) => r.ruledOut), [rows]);
  const chips = useMemo(() => filterChips(listed.map((r) => r.verdicts.label)), [listed]);
  const visible = useMemo(() => listed.filter((r) => matchesFilter(r.verdicts.label, filter)), [listed, filter]);
  const shown = useMemo(() => (rules.ruledOut && showRuledOut ? [...visible, ...ruled] : visible), [rules.ruledOut, showRuledOut, visible, ruled]);
  const compared = useMemo(() => comparedRows(shown, selected, (r) => r.id), [shown, selected]);
  const ruledReason = useMemo(() => sharedRuledOutReason(ruled.map((r) => r.ruledOutReason)), [ruled]);

  const select = (id: string) => setSelected((s) => toggleSelected(s, id));
  const toggle = (id: string) => setOpen((o) => (o === id ? null : id));

  /** The row's one verb, each on a mechanism the app already has. */
  const act = (row: VerdictListRow) => {
    const label = row.verdicts.action?.label;
    if (label === "See what's missing") return toggle(row.id);
    if (label === "Read the notice") return router.push(`/opportunities/${row.id}`);
    startTransition(async () => {
      if (label === "Keep as a lead") {
        const r = await setWatchAction({ opportunityIds: [row.id], watching: true });
        if (!r.ok) return toast({ message: r.error, tone: "error" });
        return toast({ message: `Watching ${row.title} for the next cycle`, action: { label: "Undo", onClick: () => startTransition(async () => { await setWatchAction({ opportunityIds: [row.id], watching: false }); router.refresh(); }) } });
      }
      if (label === "Dismiss") {
        const r = await dismissOpportunitiesAction({ opportunityIds: [row.id] });
        if (!r.ok) return toast({ message: r.error, tone: "error" });
        router.refresh();
        return toast({ message: `Dismissed ${row.title}`, action: { label: "Undo", onClick: () => startTransition(async () => { await restoreOpportunitiesAction({ opportunityIds: [row.id] }); router.refresh(); }) } });
      }
      // "Add to outreach": the notice enters the team's Triage board.
      const r = await saveOpportunitiesAction({ opportunityIds: [row.id], saved: true });
      if (!r.ok) return toast({ message: r.error, tone: "error" });
      router.refresh();
      toast({ message: `Saved ${row.title} to outreach · Triage`, action: r.itemId ? { label: "Open", onClick: () => router.push(`/outreach?item=${r.itemId}`) } : undefined });
    });
  };

  const header = (
    <div className={CARD_HEADER}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h2 className={CARD_TITLE}>{title}</h2>
        {chips.map((c) => (
          <button key={c.id} type="button" onClick={() => setFilter(c.id)} aria-pressed={filter === c.id} className={filterChipClass(filter === c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="whitespace-nowrap text-meta text-ink-muted">{SORT_NOTE}</span>
        {rules.compare && selected.length >= MIN_COMPARED && !comparing ? (
          <Button variant="primary" size={28} onClick={() => setComparing(true)}>
            Compare {selected.length}
          </Button>
        ) : null}
      </div>
    </div>
  );

  const footer = (
    <div className={CARD_FOOTER}>
      {rules.ruledOut && ruled.length ? (
        <button type="button" onClick={() => setShowRuledOut((v) => !v)} className={FOOTER_TOGGLE}>
          {ruledOutLabel(showRuledOut, ruled.length, ruledReason)}
        </button>
      ) : (
        <span />
      )}
      <span className={FOOTER_NOTE}>{provenance}</span>
    </div>
  );

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
                onRemove={() => {
                  const next = selected.filter((s) => s !== r.id);
                  setSelected(next);
                  if (comparedRows(shown, next, (x) => x.id).length < MIN_COMPARED) setComparing(false);
                }}
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
            subject="notice"
            selectable={rules.selectable}
            selected={selected.includes(r.id)}
            onSelect={rules.selectable ? () => select(r.id) : undefined}
            open={open === r.id || deep === r.id}
            onToggle={r.disclosure ? () => toggle(r.id) : undefined}
            disclosure={r.disclosure}
            onDeep={deepView ? () => setDeep(r.id) : undefined}
            onAction={r.verdicts.action ? () => act(r) : undefined}
          />
        ))
      ) : (
        <p className="m-0 border-t border-line-row px-5 py-4 text-dense leading-normal text-ink-muted">{empty ?? "Nothing in this filter."}</p>
      )}
      {footer}
    </section>
  );
}
