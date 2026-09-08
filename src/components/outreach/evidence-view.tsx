"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { JudgedMark } from "@/components/fit/judged-mark";
import { ACTION_BUTTON, disclosureSections, VERDICT_LABEL_PILL, VERDICT_LABEL_TEXT, type RowSubject } from "@/components/fit/verdict-row-view";
import {
  APPROACH_GRID,
  APPROACH_LABEL,
  AUDIT_CARD,
  AUDIT_HEADER,
  AUDIT_META,
  AUDIT_TITLE,
  AUDIT_TITLE_LINK_HOVER,
  AXIS_LABEL,
  AXIS_ROW,
  AXIS_TONE,
  BACK_LINK,
  BARS_NOTE_CLASS,
  BULLETS,
  CAVEAT_TONE,
  ELIGIBILITY_HEADING,
  ELIGIBILITY_STATE_CLASS,
  FLAG_EVIDENCE,
  GROUP_ACTION,
  GROUP_EMPTY_ROW,
  HEADER_CONTROLS,
  INFERRED_MARK,
  INSPECTOR_LINK,
  INTERNALS_BOX,
  INTERNALS_NOTE,
  INTERNALS_NOTE_CLASS,
  INTERNALS_SUMMARY,
  INTERNALS_SUMMARY_CLASS,
  ITEM_CARD,
  ITEM_LINK,
  ITEM_META,
  ITEM_QUOTE,
  ITEM_TITLE,
  ITEMS_LABEL,
  NO_ELIGIBILITY_RULES,
  NO_NOTICE_PROFILE,
  NO_REQUIREMENTS,
  NOT_SCORED,
  NOT_THIS_PERSON,
  PANEL_BOX,
  PANEL_HEADING,
  PANEL_TITLE,
  PROSE,
  PROVENANCE_NOTE,
  PROVENANCE_STRIP,
  QUIET_LINK,
  RECAP_COLUMN,
  RECAP_DIVIDER,
  RECAP_GRID,
  RECAP_HEADING,
  RECAP_LABEL,
  RECAP_ORDER,
  RECAP_TONE,
  REQUIREMENT_STATE_CLASS,
  REQUIREMENTS_HEADING,
  RULE_NAME,
  RULE_HEADING,
  RULE_QUOTE,
  RULE_ROW,
  RULE_STATE,
  RULE_TABLE,
  RULES_GRID,
  SECTION_BOX,
  SECTION_LABEL,
} from "@/components/outreach/audit-sections";
import { ComponentBars } from "@/components/outreach/component-bars";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import {
  ELIGIBILITY_STATE_TEXT,
  identityReviewId,
  REQUIREMENT_STATE_TEXT,
  type AuditContent,
  type AuditItem,
  type AuditItemGroup,
  type ApproachRow,
  type AuditRule,
} from "@/lib/fit/audit-view";
import type { PanelContent } from "@/lib/fit/verdict-panel";
import type { FitVerdicts } from "@/lib/fit/verdicts";
import { cn } from "@/lib/utils/cn";

/**
 * The audit layer (fit-UX PR 4; brief: `docs/fit-ux/README.md` §"Screens /
 * views" 4, `AUDIT_AND_DECISIONS.md` §3d–§3e).
 *
 * **No new route.** This replaces the list in place and hands it back
 * untouched: the surfaces above it hold `deep` beside `filter` and `selected`,
 * so "← Back to the list" restores all three (README §"State management";
 * `verdict-list.tsx` and `recipients-tab.tsx` are the two shells).
 *
 * What it replaces: the old evidence view — a rationale, eight numeric
 * component bars, a four-cell 2×2 checklist and the evidence groups, with the
 * disqualifying facts arriving as one red cell in that grid (§2.3, §2.5). The
 * eight sections below are the brief's, in the brief's order, mirroring the
 * row's: what it is → the three verdicts → why → the two instruments the row
 * cannot carry → the items → and last, collapsed, the numbers.
 *
 * **The two rule tables are kept apart, and that is load-bearing** (§3e).
 * "Eligibility · who may apply" is career stage, institution and prior
 * support; "Notice requirements · what the application must contain" is human
 * subjects, required materials, required designs and the clinical-trial
 * allowance, assessed against the evidence. Merging them is what makes a row
 * read as blocked when it is merely unwritable, and vice versa. The split is
 * structural in `lib/fit/audit-view.ts`, which derives each table from a
 * disjoint set of fields; this file renders two boxes and never reorders them.
 *
 * **Nothing decisive is inside the `<details>`.** The internals block carries
 * component values, floors, caps and the stage-8 marker — inputs to the
 * verdicts above, not a second opinion on them — and every fact that decides
 * the outcome is already in the recap, the caveat and the two tables, above
 * the fold. That is §3c applied to this view: the same rule the row's
 * disclosure keeps.
 *
 * **Data props are plain and serializable**; every control is drawn only with
 * its handler, and the flag control only with its own label beside it — PR 3's
 * `3b` rule, so no surface inherits words written for another mechanism.
 */

export type AuditFit = {
  verdicts: FitVerdicts;
  /** "Why you are seeing this" and the bullets under the heading the label picks. The same content the row's disclosure shows. */
  panel: PanelContent;
  audit: AuditContent;
};

/**
 * What a surface with no `fit_results` row can still show. Under
 * `teams.fit_engine = 'legacy'` there is no scored pair, so there are no
 * verdicts, no approach comparison, no rule tables and no components — and
 * this view says so rather than drawing eight empty instruments. D-a keeps the
 * legacy path working untouched; this is that path.
 */
export type AuditLegacy = {
  label: ReactNode;
  summary: string | null;
  /** The snapshot's own warnings, shown as the checks they are. */
  checks: readonly string[];
};

export type EvidenceViewProps = {
  /** Which way the pair reads. It captions nothing here, but it picks the disclosure headings and the inspector route. */
  subject: RowSubject;
  title: string;
  href?: string | null;
  meta?: string | null;
  /**
   * The strip's own sentence (§3j — provenance said once). The surface owns
   * the words: the workspace quotes a stored snapshot and dates it, the
   * investigator page's list is assessed nightly against a corpus and says so.
   * A date typed here would be a claim about a timestamp
   * `FIT_RESULT_VERDICT_COLUMNS` does not carry.
   */
  provenance: string;
  /** The scored pair. `null` under the legacy engine. */
  fit: AuditFit | null;
  /** Rendered instead of the recap, approach and rule sections when `fit` is null. */
  legacy?: AuditLegacy;
  /** The snapshot's own warnings, listed under the checks heading beside the analysis. */
  checks?: readonly string[];
  items: readonly AuditItemGroup[];
  /** The admin fit inspector. Passed only for an admin viewer — both routes are behind `requireAdmin`. */
  inspectorHref?: string | null;
  onBack: () => void;
  /** The surface's own words for where back goes. */
  backLabel?: string;
  /** The flag control. Drawn only with `flagLabel` beside it. */
  onFlag?: () => void;
  flagLabel?: string;
  /** The row's one verb, from `verdicts.action`. */
  onAction?: () => void;
  /** A surface with more than one verb supplies its own cluster instead. */
  actions?: ReactNode;
  /** C4: publications only. Without it no identity control is drawn. */
  onNotThisPerson?: (publicationId: string, title: string) => void;
  /**
   * B8: where "Flag evidence" goes — the subject's own record, which is where
   * the evidence behind this assessment is corrected. The pre-PR-4 footer
   * carried this link and the rebuilt view dropped it; it is a different
   * mechanism from the header's flag control, which opens the wrong-type
   * dialog. Omitted and the link is not drawn.
   */
  evidenceHref?: string | null;
  pending?: boolean;
};

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function AxisPanel({ title, rows }: { title: string; rows: readonly ApproachRow[] }) {
  return (
    <div className={PANEL_BOX}>
      <p className={PANEL_HEADING}>{title}</p>
      <div>
        {rows.map((r) => (
          <div key={r.axis} className={AXIS_ROW}>
            <span className={AXIS_LABEL}>{r.label}</span>
            <span className={AXIS_TONE[r.tone]}>{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RuleTable<State extends string>({
  heading,
  variant,
  rules,
  stateText,
  stateClass,
  empty,
}: {
  heading: string;
  variant: "eligibility" | "requirements";
  rules: ReadonlyArray<AuditRule<State>>;
  stateText: Record<State, string>;
  stateClass: Record<State, string>;
  empty: string;
}) {
  return (
    <div>
      <p className={cn(RULE_HEADING, SECTION_LABEL)}>{heading}</p>
      <div className={RULE_TABLE}>
        {rules.length ? (
          rules.map((r) => (
            <div key={r.key} className={RULE_ROW[variant]}>
              <span className="min-w-0">
                <span className={RULE_NAME}>{r.rule}</span>
                {r.quote ? <span className={RULE_QUOTE}> “{r.quote.quote}”</span> : null}
              </span>
              <span className={cn(RULE_STATE, stateClass[r.state])}>{stateText[r.state]}</span>
            </div>
          ))
        ) : (
          <p className="m-0 px-3 py-2.5 text-dense leading-[1.45] text-ink-muted">{empty}</p>
        )}
      </div>
    </div>
  );
}

function ItemCard({ item, onNotThisPerson }: { item: AuditItem; onNotThisPerson?: (publicationId: string, title: string) => void }) {
  // C4 — the identity control is offered on publications only, and only where
  // the id the action needs is actually on the item.
  const publicationId = identityReviewId(item);
  return (
    <div className={ITEM_CARD}>
      <div className="flex items-baseline justify-between gap-3">
        <p className={ITEM_TITLE}>{item.title}</p>
        <div className="flex shrink-0 items-center gap-3">
          {item.link ? (
            <a href={item.link.href} target="_blank" rel="noreferrer" className={ITEM_LINK}>
              {item.link.label}
            </a>
          ) : null}
          {publicationId && onNotThisPerson ? (
            <button type="button" onClick={() => onNotThisPerson(publicationId, item.title)} className={QUIET_LINK}>
              {NOT_THIS_PERSON}
            </button>
          ) : null}
        </div>
      </div>
      {item.meta ? <p className={ITEM_META}>{item.meta}</p> : null}
      {item.quote ? <blockquote className={ITEM_QUOTE}>“{item.quote}”</blockquote> : null}
      {item.matched ? (
        <p className="mb-0 mt-1.5 text-meta text-ink-body">
          <span className="text-ink-muted">Matched: </span>
          {item.matched}
        </p>
      ) : null}
      {item.inferred ? (
        <p className="mb-0 mt-1.5 text-meta text-ink-body">
          <span className={INFERRED_MARK}>Inferred</span>
          {item.inferred}
        </p>
      ) : null}
      {item.identity ? <p className={cn("mb-0 mt-1.5 text-meta", item.identity.kind === "ok" ? "text-success" : "text-warning")}>{item.identity.text}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export function EvidenceView({
  subject,
  title,
  href,
  meta,
  provenance,
  fit,
  legacy,
  checks,
  items,
  inspectorHref,
  onBack,
  backLabel = "← Back to the list",
  onFlag,
  flagLabel,
  onAction,
  actions,
  onNotThisPerson,
  evidenceHref,
  pending = false,
}: EvidenceViewProps) {
  const verdicts = fit?.verdicts ?? null;
  const audit = fit?.audit ?? null;
  const flag = onFlag && flagLabel ? { onFlag, flagLabel } : null;
  const sections = verdicts ? disclosureSections(verdicts.label, subject, { gaps: fit?.panel.gaps, checks }) : [];

  return (
    <section className={cn(AUDIT_CARD, pending && "opacity-90")}>
      {/* AUDIT-SECTION 1 provenance */}
      <div className={PROVENANCE_STRIP}>
        <button type="button" onClick={onBack} className={BACK_LINK}>
          {backLabel}
        </button>
        <span className={PROVENANCE_NOTE}>{provenance}</span>
      </div>

      {/* AUDIT-SECTION 2 header */}
      <header className={AUDIT_HEADER}>
        <div className="min-w-0">
          {verdicts ? <Pill variant={VERDICT_LABEL_PILL[verdicts.label]}>{VERDICT_LABEL_TEXT[verdicts.label]}</Pill> : legacy?.label}
          {href ? (
            <Link href={href} className={cn(AUDIT_TITLE, "block", AUDIT_TITLE_LINK_HOVER)}>
              {title}
            </Link>
          ) : (
            <h2 className={AUDIT_TITLE}>{title}</h2>
          )}
          {meta ? <p className={AUDIT_META}>{meta}</p> : null}
        </div>
        <div className={HEADER_CONTROLS}>
          {flag ? (
            <button type="button" onClick={flag.onFlag} className={QUIET_LINK}>
              {flag.flagLabel}
            </button>
          ) : null}
          {/* The row's own verb, drawn on the row's own terms: with a handler,
              or not at all. A surface with a control cluster supplies it. */}
          {actions ??
            (verdicts?.action && onAction ? (
              <Button variant={ACTION_BUTTON[verdicts.action.kind].variant} size={32} onClick={onAction}>
                {verdicts.action.label}
              </Button>
            ) : null)}
        </div>
      </header>

      {/* AUDIT-SECTION 3 recap */}
      {verdicts ? (
        <div className={RECAP_GRID}>
          {RECAP_ORDER.map((axis, i) => (
            <div key={axis} className={cn(RECAP_COLUMN, i > 0 && RECAP_DIVIDER)}>
              <p className={RECAP_LABEL}>{RECAP_HEADING[axis]}</p>
              <p className={cn("m-0 text-body leading-[1.45]", RECAP_TONE[verdicts[axis].tone])}>{verdicts[axis].text}</p>
            </div>
          ))}
        </div>
      ) : null}

      {/* AUDIT-SECTION 4 why */}
      <div className={SECTION_BOX}>
        {verdicts ? <p className={cn("mb-3 mt-0 max-w-[78ch] text-body leading-[1.5]", CAVEAT_TONE[verdicts.caveat.tone])}>{verdicts.caveat.text}</p> : null}
        <p className={cn("mb-1.5 mt-0", SECTION_LABEL)}>Why you are seeing this</p>
        <p className={cn("m-0", PROSE)}>{fit?.panel.why ?? legacy?.summary ?? "No summary yet."}</p>
        {(fit ? sections : legacyChecks(legacy, checks)).map((s) => (
          <div key={s.heading}>
            <p className={cn("mb-1.5 mt-4", SECTION_LABEL)}>{s.heading}</p>
            <ul className={BULLETS}>
              {s.bullets.map((b, i) => (
                <li key={`${i}-${b}`}>{b}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {audit ? (
        <>
          {/* AUDIT-SECTION 5 approach */}
          <div className={SECTION_BOX}>
            <p className={cn("mb-2.5 mt-0", SECTION_LABEL)}>{APPROACH_LABEL}</p>
            <div className={APPROACH_GRID}>
              <AxisPanel title={PANEL_TITLE.notice} rows={audit.notice} />
              <AxisPanel title={PANEL_TITLE.evidence} rows={audit.evidence} />
            </div>
          </div>

          {/* AUDIT-SECTION 6 rules */}
          <div className={RULES_GRID}>
            <RuleTable
              heading={ELIGIBILITY_HEADING}
              variant="eligibility"
              rules={audit.eligibility}
              stateText={ELIGIBILITY_STATE_TEXT}
              stateClass={ELIGIBILITY_STATE_CLASS}
              empty={audit.requirements.length || audit.eligibility.length ? NO_ELIGIBILITY_RULES : NO_NOTICE_PROFILE}
            />
            <RuleTable
              heading={REQUIREMENTS_HEADING}
              variant="requirements"
              rules={audit.requirements}
              stateText={REQUIREMENT_STATE_TEXT}
              stateClass={REQUIREMENT_STATE_CLASS}
              empty={audit.requirements.length || audit.eligibility.length ? NO_REQUIREMENTS : NO_NOTICE_PROFILE}
            />
          </div>
        </>
      ) : null}

      {/* AUDIT-SECTION 7 items */}
      <div className={SECTION_BOX}>
        <p className={cn("mb-2.5 mt-0", SECTION_LABEL)}>{ITEMS_LABEL}</p>
        <div className="flex flex-col gap-4">
          {items.map((g) => (
            <div key={g.key}>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <p className="m-0 text-dense font-medium text-ink">{g.title}</p>
                {g.meta ? <span className="text-meta text-ink-muted">{g.meta}</span> : null}
              </div>
              {g.items.length ? (
                <div className="flex flex-col gap-2">
                  {g.items.map((it) => (
                    <ItemCard key={it.id} item={it} onNotThisPerson={onNotThisPerson} />
                  ))}
                </div>
              ) : (
                /* B8: an empty group offers the thing that would fill it —
                   "Add profile ID", "Request biosketch", "Send reminder" —
                   which is what `EvidenceGroup.action` has always carried and
                   what the rebuilt section dropped. */
                <div className={GROUP_EMPTY_ROW}>
                  <p className="m-0 text-dense leading-normal text-ink-muted">{g.empty ?? "Nothing on file."}</p>
                  {g.action ? (
                    <Link href={g.action.href} className={GROUP_ACTION}>
                      {g.action.label}
                    </Link>
                  ) : null}
                </div>
              )}
            </div>
          ))}
        </div>
        {/* B8: and the footer's route to the record the evidence comes from. */}
        {evidenceHref ? (
          <p className="mb-0 mt-3.5">
            <Link href={evidenceHref} className={QUIET_LINK}>
              {FLAG_EVIDENCE}
            </Link>
          </p>
        ) : null}
      </div>

      {/* AUDIT-SECTION 8 internals */}
      {audit ? (
        <details className="border-t border-line">
          <summary className={INTERNALS_SUMMARY_CLASS}>{INTERNALS_SUMMARY}</summary>
          <div className={INTERNALS_BOX}>
            <p className={INTERNALS_NOTE_CLASS}>{INTERNALS_NOTE}</p>
            {audit.scored ? <ComponentBars rows={audit.components} /> : <p className="m-0 text-dense leading-normal text-ink-muted">{NOT_SCORED}</p>}
            <p className={BARS_NOTE_CLASS}>
              {[audit.internals.score, audit.internals.caps].filter(Boolean).join(" · ")}
              {audit.internals.judged ? (
                <>
                  {" · "}
                  <JudgedMark judged={audit.internals.judged} />
                </>
              ) : null}
            </p>
            {inspectorHref ? (
              <p className="mb-0 mt-2 text-meta">
                <Link href={inspectorHref} className={QUIET_LINK}>
                  {INSPECTOR_LINK}
                </Link>
              </p>
            ) : null}
          </div>
        </details>
      ) : null}
    </section>
  );
}

/** The legacy path's one bullet group: the snapshot's warnings, under the words the row uses for them. */
function legacyChecks(legacy: AuditLegacy | undefined, checks: readonly string[] | undefined): Array<{ heading: string; bullets: readonly string[] }> {
  const bullets = [...(legacy?.checks ?? []), ...(checks ?? [])];
  return bullets.length ? [{ heading: "Worth checking", bullets }] : [];
}
