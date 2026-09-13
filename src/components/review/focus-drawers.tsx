"use client";

import { CHIP_BASE, CHIP_TONE, gapHeading, VERDICT_LABEL_PILL, VERDICT_LABEL_TEXT } from "@/components/fit/verdict-row-view";
import { focusLabelOf, type FocusRow } from "@/components/review/focus-view";
import {
  ASSESS_CAVEAT,
  ASSESS_DEEP,
  ASSESS_FOOTER,
  ASSESS_GAP,
  ASSESS_REASON,
  ASSESS_SIGNALS,
  CAVEAT_TONE,
  CHECK_CRITERION,
  CHECK_MARK,
  CHECK_NOTE,
  CHECK_ROW,
  DRAWER_BODY,
  DRAWER_EYEBROW,
  DRAWER_EYEBROW_TEAL,
  DRAWER_EYEBROW_WARN,
  DRAWER_FOOTER,
  DRAWER_FOOTER_LINK,
  DRAWER_FOOTER_NOTE,
  DRAWER_META,
  DRAWER_SECTION,
  DRAWER_SOURCE,
  DRAWER_TEXT,
  DRAWER_TITLE,
  DRAWER_TITLE_SM,
  DRAWER_WIDTH,
  DRAWER_WIDTH_ASSESSMENT,
  FACT_KEY,
  FACT_ROW,
  FACT_VALUE,
  FOCUS_PRIMARY,
  FOCUS_SECONDARY,
  GRANT_NUMBER,
  GRANT_SPONSOR,
  GRANT_STATE,
  ITEM_META,
  ITEM_RELEVANCE,
  ITEM_ROLE,
  ITEM_TITLE,
  KEYCAP,
  NOT_CHECKED,
  NOT_CHECKED_TEXT,
  NOT_CHECKED_TITLE,
  OBJECTIVE_DETAIL,
  OBJECTIVE_NUMBER,
  OBJECTIVE_ROW,
  OBJECTIVE_TITLE,
  SMALL_TEXT,
  TERM_HEAD,
  TERM_LABEL,
  TERM_ROW,
  TERM_SOURCE,
  TERM_VALUE,
} from "@/components/review/review-view";
import { Pill } from "@/components/ui/pill";
import { SlideOver } from "@/components/ui/slide-over";
import { CHECK_GLYPH, focusActions, type FocusProfile } from "@/lib/review/focus";
import type { ReviewNoticeHeader } from "@/lib/review/queries";
import type { DecisionStatus } from "@/lib/review/reasons";
import { cn } from "@/lib/utils/cn";

/**
 * The three drawers (README §4), on the app's `SlideOver`: the same scrim,
 * focus trap and Esc as every other panel in the system, at the widths the
 * brief gives. What differs from the prototype is the close control —
 * `SlideOver`'s own icon button rather than a bordered × — because one
 * close button per app is the right number.
 */

// ---------------------------------------------------------------------------
// Investigator profile
// ---------------------------------------------------------------------------

export function ProfileDrawer({ open, onClose, row, profile }: { open: boolean; onClose: () => void; row: FocusRow; profile: FocusProfile | null }) {
  const pubs = profile?.publications ?? [];
  const grants = profile?.grants ?? [];
  return (
    <SlideOver
      open={open}
      onClose={onClose}
      label={`Investigator profile: ${row.name}`}
      width={DRAWER_WIDTH}
      header={
        <div className="min-w-0">
          <p className={DRAWER_EYEBROW}>Investigator profile</p>
          <p className={DRAWER_TITLE}>{row.name}</p>
          {row.identity || row.card.stage ? <p className={DRAWER_META}>{[row.identity, row.card.stage].filter(Boolean).join(" · ")}</p> : null}
        </div>
      }
    >
      <div className={DRAWER_BODY}>
        <p className={DRAWER_EYEBROW}>Research summary</p>
        {profile?.summary ? (
          <>
            <p className={DRAWER_TEXT}>{profile.summary.text}</p>
            <p className={DRAWER_SOURCE}>{profile.summary.source}</p>
          </>
        ) : (
          <p className={cn(DRAWER_TEXT, "text-ink-muted")}>{profile ? "No research summary on file." : "Reading the profile…"}</p>
        )}

        <div className={DRAWER_SECTION}>
          <p className={DRAWER_EYEBROW}>Funding-relevant facts</p>
          {row.card.facts.length ? (
            row.card.facts.map((f) => (
              <div key={f.key} className={FACT_ROW}>
                <span className={FACT_KEY}>{f.key}</span>
                <span className={FACT_VALUE}>{f.value}</span>
              </div>
            ))
          ) : (
            <p className={SMALL_TEXT}>No fit profile on file for this person.</p>
          )}
        </div>

        <div className={DRAWER_SECTION}>
          <p className={DRAWER_EYEBROW}>All publications · {pubs.length}</p>
          {pubs.length ? (
            pubs.map((p) => (
              <div key={p.id} className="mt-[11px]">
                <div className="flex items-start justify-between gap-3">
                  <p className={cn(ITEM_TITLE, "m-0")}>{p.title}</p>
                  {p.role ? <span className={p.roleLead ? ITEM_ROLE.lead : ITEM_ROLE.other}>{p.role}</span> : null}
                </div>
                <p className={cn(ITEM_META, "m-0 mt-0.5")}>
                  {p.meta} · PMID {p.pmid}
                </p>
                {p.relevance ? <p className={cn(ITEM_RELEVANCE, "m-0 mt-1")}>{p.relevance}</p> : null}
              </div>
            ))
          ) : (
            <p className={SMALL_TEXT}>{profile ? "No publications on file." : "Reading…"}</p>
          )}
        </div>

        <div className={DRAWER_SECTION}>
          <p className={DRAWER_EYEBROW}>All funded awards · {grants.length}</p>
          {grants.length ? (
            grants.map((g) => (
              <div key={g.id} className="mt-[11px]">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="m-0 min-w-0">
                    <span className={GRANT_NUMBER}>{g.number}</span>
                    {g.sponsor ? <span className={cn(GRANT_SPONSOR, "ml-2")}>{g.sponsor}</span> : null}
                  </p>
                  <span className={g.active ? GRANT_STATE.active : GRANT_STATE.closed}>{g.active ? "Active" : "Closed"}</span>
                </div>
                <p className="mb-0 mt-[3px] text-dense leading-[1.45] text-ink">{g.title}</p>
                <p className="mb-0 mt-0.5 text-micro text-ink-muted">{g.line}</p>
                {g.relevance ? <p className={cn(ITEM_RELEVANCE, "m-0 mt-1")}>{g.relevance}</p> : null}
              </div>
            ))
          ) : (
            <p className={SMALL_TEXT}>{profile ? "No awards on file." : "Reading…"}</p>
          )}
        </div>
      </div>
    </SlideOver>
  );
}

// ---------------------------------------------------------------------------
// Opportunity detail
// ---------------------------------------------------------------------------

export function OpportunityDrawer({ open, onClose, header }: { open: boolean; onClose: () => void; header: ReviewNoticeHeader }) {
  const d = header.detail;
  return (
    <SlideOver
      open={open}
      onClose={onClose}
      label={`Opportunity detail: ${header.title}`}
      width={DRAWER_WIDTH}
      header={
        <div className="min-w-0">
          <p className={DRAWER_EYEBROW}>Opportunity detail</p>
          <p className={DRAWER_TITLE}>{header.title}</p>
          <p className={DRAWER_META}>
            <span className="font-mono font-semibold text-ink">{header.number ?? "—"}</span>
            {header.meta ? ` · ${header.meta}` : ""}
          </p>
        </div>
      }
      footer={
        <div className={DRAWER_FOOTER}>
          <p className={DRAWER_FOOTER_NOTE}>{d.provenance ?? "No fit profile has been built for this notice yet."}</p>
          {header.fullNoticeUrl ? (
            <a href={header.fullNoticeUrl} target="_blank" rel="noreferrer" className={DRAWER_FOOTER_LINK}>
              Full notice ↗
            </a>
          ) : null}
        </div>
      }
    >
      <div className={DRAWER_BODY}>
        <p className={DRAWER_EYEBROW}>Funding purpose</p>
        <p className={cn(DRAWER_TEXT, !header.summary && "text-ink-muted")}>{header.summary || "No summary in the synced notice."}</p>
        <p className={DRAWER_SOURCE}>{d.summarySource}</p>

        <div className={DRAWER_SECTION}>
          <p className={DRAWER_EYEBROW}>Research objectives</p>
          {d.objectives.length ? (
            d.objectives.map((o, i) => (
              <div key={o} className={cn(OBJECTIVE_ROW, "mt-[11px]")}>
                <span className={OBJECTIVE_NUMBER}>{i + 1}</span>
                <span className={OBJECTIVE_TITLE}>{o}</span>
              </div>
            ))
          ) : (
            <p className={SMALL_TEXT}>The notice profile names no objective category.</p>
          )}
          {d.objectiveQuote ? (
            <p className={OBJECTIVE_DETAIL}>
              {d.objectiveQuote.section}: “{d.objectiveQuote.text}”
            </p>
          ) : null}
        </div>

        <div className={DRAWER_SECTION}>
          <p className={DRAWER_EYEBROW_WARN}>Not in scope</p>
          {d.notInScope.length ? d.notInScope.map((x) => <p key={x} className={cn(SMALL_TEXT, "mt-2")}>{x}</p>) : <p className={cn(SMALL_TEXT, "mt-2")}>The notice names nothing as non-responsive.</p>}
        </div>

        <div className={DRAWER_SECTION}>
          <p className={DRAWER_EYEBROW_TEAL}>Why Prospera surfaced this</p>
          <p className={cn(SMALL_TEXT, "mt-2 text-dense leading-[1.6]")}>{d.why}</p>
        </div>

        <div className={DRAWER_SECTION}>
          <p className={DRAWER_EYEBROW}>Terms and eligibility</p>
          {d.terms.length ? (
            d.terms.map((t) => (
              <div key={`${t.label}-${t.source}`} className={TERM_ROW}>
                <div className={TERM_HEAD}>
                  <span className={TERM_LABEL}>{t.label}</span>
                  <span className={TERM_SOURCE}>{t.source}</span>
                </div>
                <p className={TERM_VALUE}>{t.value}</p>
              </div>
            ))
          ) : (
            <p className={SMALL_TEXT}>No quoted terms on file for this notice.</p>
          )}
        </div>
      </div>
    </SlideOver>
  );
}

// ---------------------------------------------------------------------------
// Prospera's assessment
// ---------------------------------------------------------------------------

export function AssessmentDrawer({ open, onClose, row, noticeNumber, canDecide, onDecide, onOpenReasons }: { open: boolean; onClose: () => void; row: FocusRow; noticeNumber: string | null; canDecide: boolean; onDecide: (status: DecisionStatus, reason: string | null) => void; onOpenReasons: () => void }) {
  const label = focusLabelOf(row);
  const actions = focusActions(label);
  const undecided = !row.decision && !row.doNotContact;
  const gaps = row.disclosure?.gaps ?? [];
  return (
    <SlideOver
      open={open}
      onClose={onClose}
      label={`Prospera's assessment of ${row.name}`}
      width={DRAWER_WIDTH_ASSESSMENT}
      header={
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={DRAWER_EYEBROW_TEAL}>Prospera&apos;s assessment</p>
            <p className={DRAWER_TITLE_SM}>{row.name}</p>
            <p className={cn(DRAWER_META, "mt-0.5")}>
              considered for <span className="font-mono font-semibold text-ink">{noticeNumber ?? "this notice"}</span>
            </p>
          </div>
          <Pill variant={VERDICT_LABEL_PILL[label]} className="mt-0.5">
            {VERDICT_LABEL_TEXT[label]}
          </Pill>
        </div>
      }
      footer={
        undecided && canDecide ? (
          <div className={ASSESS_FOOTER}>
            {actions.map((a) => (
              <button key={a.key} type="button" onClick={() => (a.opensReasons ? onOpenReasons() : onDecide(a.status, a.reason))} className={a.kind === "primary" ? FOCUS_PRIMARY : FOCUS_SECONDARY}>
                <span className={KEYCAP} aria-hidden>
                  {a.key}
                </span>
                {a.label}
              </button>
            ))}
          </div>
        ) : undefined
      }
    >
      <div className={DRAWER_BODY}>
        <p className={ASSESS_REASON}>{row.verdicts.reason}</p>
        <p className={cn(ASSESS_CAVEAT, CAVEAT_TONE[row.verdicts.caveat.tone])}>{row.verdicts.caveat.text}</p>
        {row.disclosure?.why ? <p className={ASSESS_DEEP}>{row.disclosure.why}</p> : null}

        <div className={DRAWER_SECTION}>
          {row.checks.assessed && row.checks.rows.length ? (
            <>
              <p className={DRAWER_EYEBROW}>Notice requirements, checked against {row.name}</p>
              {row.checks.rows.map((c) => (
                <div key={c.key} className={CHECK_ROW}>
                  <span className={CHECK_MARK[c.mark]} aria-label={c.mark === "yes" ? "Met" : c.mark === "no" ? "Not met" : "Unknown"}>
                    {CHECK_GLYPH[c.mark]}
                  </span>
                  <span className="min-w-0">
                    <span className={CHECK_CRITERION}>{c.criterion}</span>
                    {c.note ? <span className={CHECK_NOTE}>{c.note}</span> : null}
                  </span>
                </div>
              ))}
            </>
          ) : row.checks.assessed ? (
            <>
              <p className={DRAWER_EYEBROW}>Notice requirements, checked against {row.name}</p>
              <p className={SMALL_TEXT}>The notice states no eligibility rule and no requirement the engine checks structurally; the verdict rests on research approach, design and topic.</p>
            </>
          ) : (
            <div className={NOT_CHECKED}>
              <p className={NOT_CHECKED_TITLE}>Not checked against this notice</p>
              <p className={NOT_CHECKED_TEXT}>Prospera has not run this notice&apos;s requirements against this investigator, so nothing here has been verified either way. Treat the strength as a topic signal only.</p>
            </div>
          )}
        </div>

        {gaps.length ? (
          <div className={DRAWER_SECTION}>
            <p className={DRAWER_EYEBROW_WARN}>{gapHeading(label, "person")}</p>
            {gaps.map((g, i) => (
              <p key={`${i}-${g}`} className={ASSESS_GAP}>
                {g}
              </p>
            ))}
          </div>
        ) : null}

        {row.chips.length ? (
          <div className={DRAWER_SECTION}>
            <p className={DRAWER_EYEBROW}>Signals</p>
            <div className={ASSESS_SIGNALS}>
              {row.chips.map((c) => (
                <span key={c.text} className={cn(CHIP_BASE, CHIP_TONE[c.tone])}>
                  {c.text}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </SlideOver>
  );
}
